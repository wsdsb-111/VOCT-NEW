"use strict";

const { createHash } = require("node:crypto");
const CHUNK_BYTES = 64 * 1024;
const MAX_SCAN_BYTES = 32 * 1024 * 1024;
const identityOf = stat => `${Number(stat.birthtimeMs) || 0}:${Number(stat.ino) || 0}`;
const digest = buffer => createHash("sha256").update(buffer).digest("hex");
const yieldTurn = () => new Promise(resolve => setImmediate(resolve));

function readAt(fs, fd, position, length) {
  const buffer = Buffer.alloc(length);
  let offset = 0;
  while (offset < length) {
    const count = fs.readSync(fd, buffer, offset, length - offset, position + offset);
    if (!count) break;
    offset += count;
  }
  return buffer.subarray(0, offset);
}

function parseReceipt(line) {
  const match = line.match(/VOTC:LETTER_RECEIPT\/;\/([A-Za-z0-9_.:-]+)\/;\/([a-f0-9]{32})\/;\/([A-Za-z0-9_.-]+)\/;\/(\d+)\/;\/(\d+)\/;\/(\d+)\/;\/([^\r\n]+)/);
  return match ? { letterId: match[1], token: match[2], campaignToken: match[3], playerId: Number(match[4]),
    aiId: Number(match[5]), totalDays: Number(match[6]), date: match[7].trim() } : null;
}

function captureSessionProof(fs, filePath, scan) {
  if (!scan?.sessionId || !Number.isSafeInteger(scan.sessionBoundaryOffset) || !Number.isSafeInteger(scan.logSize)) return null;
  const fd = fs.openSync(filePath, "r");
  try {
    const stat = fs.fstatSync(fd);
    if (identityOf(stat) !== scan.logIdentity || stat.size !== scan.logSize) return null;
    const marker = readAt(fs, fd, scan.sessionBoundaryOffset, Math.min(1024, stat.size - scan.sessionBoundaryOffset));
    const newline = marker.indexOf(10);
    if (newline < 0 || marker.subarray(0, newline).toString("utf8").trim() !== `VOTC:LOAD_SESSION/;/${scan.sessionId}`
      || stat.size && readAt(fs, fd, stat.size - 1, 1)[0] !== 10) return null;
    const anchorOffset = Math.max(0, stat.size - 64);
    return { logIdentity: scan.logIdentity, device: Number(stat.dev) || 0, sessionId: scan.sessionId,
      boundaryOffset: scan.sessionBoundaryOffset, dispatchOffset: stat.size, anchorOffset,
      anchorHash: digest(readAt(fs, fd, anchorOffset, stat.size - anchorOffset)) };
  } finally { fs.closeSync(fd); }
}

function proofMatches(fs, fd, stat, proof, scan) {
  return !!(proof && scan.sessionId === proof.sessionId && scan.sessionBoundaryOffset === proof.boundaryOffset
    && identityOf(stat) === proof.logIdentity && (Number(stat.dev) || 0) === proof.device
    && stat.size >= proof.dispatchOffset && proof.dispatchOffset >= proof.boundaryOffset
    && Number.isSafeInteger(proof.anchorOffset) && proof.anchorOffset === Math.max(0, proof.dispatchOffset - 64)
    && digest(readAt(fs, fd, proof.anchorOffset, proof.dispatchOffset - proof.anchorOffset)) === proof.anchorHash);
}

async function findReceipt(fs, filePath, proof, scan, validate) {
  const started = Date.now();
  let bytesRead = 0;
  if (!proof || !scan?.sessionId) return { status: "AMBIGUOUS_OR_STALE", reason: "RECEIPT_SESSION_UNPROVEN" };
  const fd = fs.openSync(filePath, "r");
  try {
    const stat = fs.fstatSync(fd);
    if (!proofMatches(fs, fd, stat, proof, scan) || stat.size !== scan.logSize) {
      return { status: "AMBIGUOUS_OR_STALE", reason: "RECEIPT_SESSION_CHANGED" };
    }
    if (stat.size - proof.dispatchOffset > MAX_SCAN_BYTES) {
      return { status: "NO_VERIFIABLE_RECEIPT", reason: "RECOVERY_SCAN_BUDGET_EXCEEDED" };
    }
    let offset = proof.dispatchOffset, pending = Buffer.alloc(0), candidate = null;
    while (offset < stat.size) {
      const chunk = readAt(fs, fd, offset, Math.min(CHUNK_BYTES, stat.size - offset));
      if (!chunk.length) return { status: "AMBIGUOUS_OR_STALE", reason: "RECEIPT_LOG_CHANGED" };
      offset += chunk.length; bytesRead += chunk.length;
      pending = Buffer.concat([pending, chunk]);
      let newline;
      while ((newline = pending.indexOf(10)) >= 0) {
        const line = pending.subarray(0, newline).toString("utf8");
        pending = pending.subarray(newline + 1);
        if (/VOTC:LOAD_SESSION\/;\//.test(line)) return { status: "AMBIGUOUS_OR_STALE", reason: "RECEIPT_NEW_LOAD" };
        const receipt = parseReceipt(line);
        if (receipt && validate(receipt)) candidate = receipt;
      }
      if (pending.length > CHUNK_BYTES) return { status: "AMBIGUOUS_OR_STALE", reason: "RECEIPT_LINE_TOO_LONG" };
      await yieldTurn();
    }
    if (/VOTC:LOAD/.test(pending.toString("utf8"))) return { status: "AMBIGUOUS_OR_STALE", reason: "RECEIPT_PARTIAL_LOAD" };
    const final = fs.fstatSync(fd), named = fs.statSync(filePath);
    if (identityOf(final) !== identityOf(stat) || identityOf(named) !== identityOf(stat)
      || final.size !== stat.size || named.size !== stat.size || final.mtimeMs !== stat.mtimeMs
      || !proofMatches(fs, fd, final, proof, scan)) return { status: "AMBIGUOUS_OR_STALE", reason: "RECEIPT_LOG_CHANGED" };
    return { status: candidate ? "RECOVERED_VERIFIED" : "NO_VERIFIABLE_RECEIPT", reason: candidate ? null : "RECEIPT_NOT_FOUND",
      receipt: candidate, logSize: stat.size, logMtimeMs: stat.mtimeMs, bytesRead, durationMs: Date.now() - started };
  } finally { fs.closeSync(fd); }
}

module.exports = { parseReceipt, captureSessionProof, findReceipt };
