"use strict";

const nodeFs = require("fs");
const nodeZlib = require("zlib");

const SAVE_KINDS = [
  "TEXT_UNCOMPRESSED",
  "BINARY_UNCOMPRESSED",
  "UNIFIED_TEXT_ZIP",
  "UNIFIED_BINARY_ZIP",
  "SPLIT_TEXT_ZIP",
  "SPLIT_BINARY_ZIP"
];
const MAX_METADATA_BYTES = 4 * 1024 * 1024;
const MAX_GAMESTATE_BYTES = 768 * 1024 * 1024;
const MAX_SAVE_BYTES = MAX_GAMESTATE_BYTES + MAX_METADATA_BYTES + 64 * 1024 * 1024;

function readUInt16(buffer, offset) {
  if (offset + 2 > buffer.length) throw new Error("save_container_truncated");
  return buffer.readUInt16LE(offset);
}

function readUInt32(buffer, offset) {
  if (offset + 4 > buffer.length) throw new Error("save_container_truncated");
  return buffer.readUInt32LE(offset);
}

function parseSaveHeader(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 24 || buffer.toString("ascii", 0, 3) !== "SAV") throw new Error("invalid_save_header");
  const version = Number.parseInt(buffer.toString("ascii", 3, 5), 16);
  const kind = Number.parseInt(buffer.toString("ascii", 5, 7), 16);
  const metadataLength = Number.parseInt(buffer.toString("ascii", 15, 23), 16);
  const newline = buffer.indexOf(10, 0, "ascii");
  if (!Number.isInteger(version) || !Number.isInteger(kind) || !Number.isInteger(metadataLength) || newline < 0 || (newline !== 23 && newline !== 31)) throw new Error("invalid_save_header");
  if (metadataLength < 0 || metadataLength > MAX_METADATA_BYTES) throw new Error("save_metadata_too_large");
  return {
    version,
    kind,
    kindName: SAVE_KINDS[kind] || "UNKNOWN",
    random: buffer.subarray(7, 15).toString("hex"),
    metadataLength,
    headerLength: newline + 1
  };
}

function parseMetadata(text) {
  const read = (pattern) => text.match(pattern)?.[1] || null;
  return {
    metaDate: read(/(?:^|\r?\n)meta_date=([^\r\n]+)/),
    saveGameVersion: read(/(?:^|\r?\n)save_game_version=([^\r\n]+)/),
    gameVersion: read(/(?:^|\r?\n)version="([^"]+)"/),
    playerName: read(/(?:^|\r?\n)meta_player_name="([^"]*)"/),
    titleName: read(/(?:^|\r?\n)meta_title_name="([^"]*)"/),
    ironman: read(/(?:^|\r?\n)ironman=([^\r\n]+)/)
  };
}

function findZipEndOfDirectory(zip) {
  const minOffset = Math.max(0, zip.length - 65557);
  for (let offset = zip.length - 22; offset >= minOffset; offset -= 1) {
    if (zip.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  throw new Error("zip_end_of_directory_not_found");
}

function extractZipEntry(zip, entryName, zlib = nodeZlib) {
  const endOffset = findZipEndOfDirectory(zip);
  const entryCount = readUInt16(zip, endOffset + 10);
  const centralOffset = readUInt32(zip, endOffset + 16);
  let cursor = centralOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (readUInt32(zip, cursor) !== 0x02014b50) throw new Error("zip_central_directory_invalid");
    const compression = readUInt16(zip, cursor + 10);
    const compressedSize = readUInt32(zip, cursor + 20);
    const uncompressedSize = readUInt32(zip, cursor + 24);
    const nameLength = readUInt16(zip, cursor + 28);
    const extraLength = readUInt16(zip, cursor + 30);
    const commentLength = readUInt16(zip, cursor + 32);
    const localOffset = readUInt32(zip, cursor + 42);
    const name = zip.toString("utf8", cursor + 46, cursor + 46 + nameLength);
    cursor += 46 + nameLength + extraLength + commentLength;
    if (name !== entryName) continue;
    if (uncompressedSize > MAX_GAMESTATE_BYTES) throw new Error("gamestate_too_large");
    if (readUInt32(zip, localOffset) !== 0x04034b50) throw new Error("zip_local_header_invalid");
    const localNameLength = readUInt16(zip, localOffset + 26);
    const localExtraLength = readUInt16(zip, localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > zip.length) throw new Error("zip_entry_truncated");
    const compressed = zip.subarray(dataStart, dataEnd);
    const output = compression === 0 ? compressed : compression === 8 ? zlib.inflateRawSync(compressed, { maxOutputLength: MAX_GAMESTATE_BYTES + 1 }) : null;
    if (!output) throw new Error("zip_compression_unsupported");
    if (output.length !== uncompressedSize || output.length > MAX_GAMESTATE_BYTES) throw new Error("zip_entry_size_invalid");
    return output;
  }
  throw new Error("zip_gamestate_not_found");
}

function classifyContainer(header, body) {
  const isZip = body.length >= 4 && body.readUInt32LE(0) === 0x04034b50;
  if (header.kind === 0) return isZip ? "UNSUPPORTED_CONTAINER" : "PLAIN_TEXT_SAVE";
  if (header.kind === 2) return isZip ? "UNIFIED_TEXT_ZIP" : "UNSUPPORTED_CONTAINER";
  if ([1, 3, 5].includes(header.kind)) return "BINARY_CONTAINER";
  if (header.kind === 4) return "UNSUPPORTED_CONTAINER";
  return "UNKNOWN";
}

function readSavePreamble(savePath, { fs = nodeFs } = {}) {
  const stat = fs.statSync(savePath);
  if (!stat.isFile()) throw new Error("save_path_not_file");
  if (stat.size <= 0 || stat.size > MAX_SAVE_BYTES) throw new Error("save_file_size_invalid");
  const descriptor = fs.openSync(savePath, "r");
  try {
    const headerBuffer = Buffer.alloc(Math.min(64, stat.size));
    const headerBytes = fs.readSync(descriptor, headerBuffer, 0, headerBuffer.length, 0);
    const header = parseSaveHeader(headerBuffer.subarray(0, headerBytes));
    const tailLength = header.metadataLength + 4;
    const tail = Buffer.alloc(tailLength);
    const tailBytes = fs.readSync(descriptor, tail, 0, tailLength, header.headerLength);
    if (tailBytes < header.metadataLength) throw new Error("save_metadata_truncated");
    const metadata = parseMetadata(tail.toString("utf8", 0, header.metadataLength));
    const bodyPrefix = tail.subarray(header.metadataLength, tailBytes);
    const containerKind = /^yes$/i.test(metadata.ironman || "") ? "IRONMAN_UNREADABLE" : classifyContainer(header, bodyPrefix);
    return { stat, header, metadata, containerKind };
  } finally {
    fs.closeSync(descriptor);
  }
}

function readSaveContainer(savePath, { fs = nodeFs, zlib = nodeZlib } = {}) {
  const stat = fs.statSync(savePath);
  if (stat.size <= 0 || stat.size > MAX_SAVE_BYTES) throw new Error("save_file_size_invalid");
  const file = fs.readFileSync(savePath);
  const header = parseSaveHeader(file.subarray(0, Math.min(file.length, 64)));
  const metadataStart = header.headerLength;
  const metadataEnd = metadataStart + header.metadataLength;
  if (metadataEnd > file.length) throw new Error("save_metadata_truncated");
  const metadataText = file.toString("utf8", metadataStart, metadataEnd);
  const metadata = parseMetadata(metadataText);
  const body = file.subarray(metadataEnd);
  const containerKind = /^yes$/i.test(metadata.ironman || "") ? "IRONMAN_UNREADABLE" : classifyContainer(header, body);
  if (containerKind !== "PLAIN_TEXT_SAVE" && containerKind !== "UNIFIED_TEXT_ZIP") {
    return { header, metadata, containerKind, gamestate: null };
  }
  const gamestate = containerKind === "PLAIN_TEXT_SAVE" ? body : extractZipEntry(body, "gamestate", zlib);
  if (gamestate.length > MAX_GAMESTATE_BYTES) throw new Error("gamestate_too_large");
  return { header, metadata, containerKind, gamestate };
}

module.exports = {
  MAX_GAMESTATE_BYTES,
  MAX_SAVE_BYTES,
  SAVE_KINDS,
  classifyContainer,
  extractZipEntry,
  parseMetadata,
  parseSaveHeader,
  readSaveContainer,
  readSavePreamble
};
