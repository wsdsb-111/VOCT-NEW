"use strict";

const nodeFs = require("fs");
const nodePath = require("path");

const VALID_VERDICTS = new Set(["CORRECT", "INCORRECT", "SHOULD_BE_AMBIGUOUS", "SHOULD_BE_RESOLVED", "SHOULD_BE_UNRESOLVED", "UNKNOWN"]);

function validateGroundTruthRecord(record) {
  if (!record || typeof record !== "object" || Array.isArray(record)) throw new Error("ground_truth_record_required");
  if (record.schemaVersion !== 1) throw new Error("ground_truth_schema_unsupported");
  for (const key of ["captureId", "capturedAt", "figureKey", "resolverStatus"]) {
    if (typeof record[key] !== "string" || !record[key]) throw new Error(`ground_truth_${key}_required`);
  }
  if (!VALID_VERDICTS.has(record.verdict)) throw new Error("ground_truth_verdict_invalid");
  return record;
}

class HistoricalGroundTruthStore {
  constructor({ rootDir, fs = nodeFs, path = nodePath }) {
    if (typeof rootDir !== "string" || !rootDir) throw new Error("ground_truth_root_required");
    this.fs = fs;
    this.path = path;
    this.recordsPath = path.join(rootDir, "diagnostics", "historical-figure-ground-truth", "records.jsonl");
  }

  getFilePath() {
    return this.recordsPath;
  }

  append(record) {
    try {
      validateGroundTruthRecord(record);
      this.fs.mkdirSync(this.path.dirname(this.recordsPath), { recursive: true });
      this.fs.appendFileSync(this.recordsPath, `${JSON.stringify(record)}\n`, "utf8");
      return record;
    } catch (error) {
      throw new Error(`ground_truth_save_failed:${error.message}`);
    }
  }
}

module.exports = { HistoricalGroundTruthStore, VALID_VERDICTS, validateGroundTruthRecord };
