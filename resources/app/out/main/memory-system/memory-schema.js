"use strict";

const CURRENT_MEMORY_SCHEMA_VERSION = 2;
const MIN_READABLE_MEMORY_SCHEMA_VERSION = 1;
const CURRENT_SUMMARY_SCHEMA_VERSION = 2;

function getSchemaVersion(value, fallback = MIN_READABLE_MEMORY_SCHEMA_VERSION) {
  const version = Number(value?.schemaVersion);
  return Number.isInteger(version) ? version : fallback;
}

function assertReadableSchema(value, label = "memory_document") {
  const version = getSchemaVersion(value);
  if (version < MIN_READABLE_MEMORY_SCHEMA_VERSION || version > CURRENT_MEMORY_SCHEMA_VERSION) {
    throw new Error(`${label}_unsupported_schema:${version}`);
  }
  return version;
}

function upgradeMemoryRecord(input = {}) {
  const sourceVersion = input.schemaVersion == null ? CURRENT_MEMORY_SCHEMA_VERSION : assertReadableSchema(input, "memory_record");
  if (sourceVersion === CURRENT_MEMORY_SCHEMA_VERSION) return { ...input };
  return {
    ...input,
    schemaVersion: CURRENT_MEMORY_SCHEMA_VERSION,
    migratedFromSchemaVersion: sourceVersion
  };
}

function normalizeSummaryRecord(input = {}) {
  const sourceVersion = getSchemaVersion(input);
  if (sourceVersion > CURRENT_SUMMARY_SCHEMA_VERSION) throw new Error(`summary_record_unsupported_schema:${sourceVersion}`);
  return { ...input, schemaVersion: CURRENT_SUMMARY_SCHEMA_VERSION };
}

module.exports = {
  CURRENT_MEMORY_SCHEMA_VERSION,
  MIN_READABLE_MEMORY_SCHEMA_VERSION,
  CURRENT_SUMMARY_SCHEMA_VERSION,
  getSchemaVersion,
  assertReadableSchema,
  upgradeMemoryRecord,
  normalizeSummaryRecord
};
