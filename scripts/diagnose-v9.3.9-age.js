"use strict";

const fs = require("fs");
const { collectAgeDiagnostic } = require("../src/app/main/worldline/age-diagnostics");

const inputPath = process.argv[2];
const usage = `Usage: node scripts/diagnose-v9.3.9-age.js <observations.json>
Input JSON shape (repeat the exact same snapshotId for every stage):
{"characterId":123,"snapshotId":"same-date/totalDays","observations":{"ck3Panel":{"age":17,"snapshotId":"same-date/totalDays"},"rawCharacter":{"age":17,"snapshotId":"same-date/totalDays"},"parsedCharacter":{"age":17,"snapshotId":"same-date/totalDays"},"canonicalProfile":{"age":17,"snapshotId":"same-date/totalDays"},"resolvedAge":{"age":17,"snapshotId":"same-date/totalDays"},"familyFact":{"age":17,"snapshotId":"same-date/totalDays"},"prompt":{"age":17,"snapshotId":"same-date/totalDays"},"modelAnswer":{"age":17,"snapshotId":"same-date/totalDays"}}}
Output contains only the first mismatch, age values, and a per-run hashed character ID.`;
if (inputPath === "--help" && process.argv.length === 3) {
  console.log(usage);
} else if (!inputPath || process.argv.length !== 3) {
  console.error(usage);
  process.exitCode = 1;
} else {
  try {
    const input = JSON.parse(fs.readFileSync(inputPath, "utf8"));
    console.log(JSON.stringify(collectAgeDiagnostic(input)));
  } catch {
    console.error("Could not read or parse diagnosis input.");
    process.exitCode = 1;
  }
}
