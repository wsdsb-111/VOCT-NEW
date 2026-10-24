"use strict";

const HELLO_MARKER = "VOTC:BRIDGE_HELLO";
const MAX_HELLO_LINE_BYTES = 4096;
const MAX_CAPABILITIES = 32;
const REQUIRED_FIELDS = ["schema", "protocol", "mod", "upstream", "revision", "load", "caps"];

function failure(reasonCode) {
  return { ok: false, reasonCode };
}

function parseInteger(value, minimum = 0) {
  if (!/^(?:0|[1-9]\d{0,8})$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= minimum ? parsed : null;
}

function parseVersion(value) {
  if (!/^(?:0|[1-9]\d{0,5})\.(?:0|[1-9]\d{0,5})\.(?:0|[1-9]\d{0,5})$/.test(value)) return null;
  return value;
}

function parseProtocol(value) {
  const match = /^(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})$/.exec(value);
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2]) };
}

function parseCapabilities(value) {
  if (!value) return null;
  const entries = value.split(",");
  if (!entries.length || entries.length > MAX_CAPABILITIES) return null;

  const capabilities = {};
  for (const entry of entries) {
    const match = /^(!)?([a-z][a-z0-9_]{0,63}):((?:0|[1-9]\d{0,8}))$/.exec(entry);
    if (!match || Object.hasOwn(capabilities, match[2])) return null;
    const revision = Number(match[3]);
    if (!Number.isSafeInteger(revision) || revision < 1) return null;
    capabilities[match[2]] = { revision, required: Boolean(match[1]) };
  }
  return capabilities;
}

/**
 * Parse only the dedicated Bridge Hello marker. Other log rows return null;
 * malformed rows that carry the exact marker return a safe reason code.
 */
function parseBridgeHello(input) {
  if (input === null || input === undefined) return null;
  const line = Buffer.isBuffer(input) ? input.toString("utf8") : String(input);
  const markerIndex = line.indexOf(HELLO_MARKER);
  if (markerIndex < 0) return null;

  const following = line[markerIndex + HELLO_MARKER.length];
  if (following && following !== "/") return null;
  if (Buffer.byteLength(line, "utf8") > MAX_HELLO_LINE_BYTES) return failure("HELLO_TOO_LONG");
  if (line.indexOf(HELLO_MARKER, markerIndex + HELLO_MARKER.length) >= 0) return failure("HELLO_DUPLICATE_MARKER");

  const body = line.slice(markerIndex + HELLO_MARKER.length).replace(/\r$/, "");
  if (!body.startsWith("/;/")) return failure("HELLO_SEPARATOR_INVALID");
  const fields = body.slice(3).split("/;/");
  if (fields.some(field => !field)) return failure("HELLO_FIELD_INVALID");
  if (fields.length < REQUIRED_FIELDS.length) return failure("HELLO_FIELD_MISSING");

  const values = Object.create(null);
  for (const field of fields) {
    const separator = field.indexOf("=");
    if (separator <= 0 || separator === field.length - 1 || field.indexOf("=", separator + 1) >= 0) return failure("HELLO_FIELD_INVALID");
    const key = field.slice(0, separator);
    const value = field.slice(separator + 1);
    if (!/^[a-z][a-z0-9_]{0,63}$/.test(key) || !/^[A-Za-z0-9_.:,!-]{1,2048}$/.test(value)) return failure("HELLO_FIELD_INVALID");
    if (Object.hasOwn(values, key)) return failure("HELLO_FIELD_DUPLICATE");
    values[key] = value;
  }

  for (let index = 0; index < REQUIRED_FIELDS.length; index += 1) {
    const key = REQUIRED_FIELDS[index];
    if (fields[index]?.slice(0, fields[index].indexOf("=")) !== key) return failure("HELLO_FIELD_ORDER_INVALID");
    if (!Object.hasOwn(values, key)) return failure("HELLO_FIELD_MISSING");
  }

  const knownKeys = new Set(REQUIRED_FIELDS);
  for (const key of Object.keys(values)) {
    if (knownKeys.has(key)) continue;
    if (key.startsWith("required_")) return failure("HELLO_UNKNOWN_REQUIRED_FIELD");
    if (!key.startsWith("x_")) return failure("HELLO_UNKNOWN_FIELD");
    if (!/^[a-z][a-z0-9_]{0,61}$/.test(key.slice(2))) return failure("HELLO_OPTIONAL_FIELD_INVALID");
  }

  const schemaVersion = parseInteger(values.schema, 1);
  if (schemaVersion === null) return failure("HELLO_SCHEMA_INVALID");
  const bridgeProtocol = parseProtocol(values.protocol);
  if (!bridgeProtocol) return failure("HELLO_PROTOCOL_INVALID");
  const modBaseVersion = parseVersion(values.mod);
  if (!modBaseVersion) return failure("HELLO_MOD_VERSION_INVALID");
  const upstreamBaseVersion = parseVersion(values.upstream);
  if (!upstreamBaseVersion) return failure("HELLO_UPSTREAM_VERSION_INVALID");
  const voctBridgeRevision = parseInteger(values.revision, 1);
  if (voctBridgeRevision === null) return failure("HELLO_BRIDGE_REVISION_INVALID");
  if (!/^votc-load-[A-Za-z0-9_.-]{1,120}$/.test(values.load)) return failure("HELLO_LOAD_TOKEN_INVALID");
  const capabilities = parseCapabilities(values.caps);
  if (!capabilities) return failure("HELLO_CAPABILITIES_INVALID");

  const hello = {
    schemaVersion,
    bridgeProtocol,
    modBaseVersion,
    upstreamBaseVersion,
    voctBridgeRevision,
    loadEpoch: values.load,
    capabilities
  };

  return { ok: true, hello };
}

module.exports = { HELLO_MARKER, parseBridgeHello };
