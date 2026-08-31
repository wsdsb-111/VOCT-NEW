"use strict";

const assert = require("assert");
const path = require("path");
const root = path.resolve(__dirname, "..");
const { figures } = require(path.join(root, "resources", "app", "out", "main", "historical-system", "historical-data", "figures"));
const { figureMatchingRecords } = require(path.join(root, "resources", "app", "out", "main", "historical-system", "historical-data", "figure-matching"));
const { validateFigureMatchingDataset } = require(path.join(root, "resources", "app", "out", "main", "historical-system", "schema"));

assert.doesNotThrow(() => validateFigureMatchingDataset(figureMatchingRecords, figures));
assert.strictEqual(figureMatchingRecords.length, figures.length, "every baseline figure must declare resolver readiness");
assert.strictEqual(figureMatchingRecords.filter((record) => record.resolverReady).length, 14, "V8.3 calibration cohort must contain 14 reviewed figures");
assert(figureMatchingRecords.filter((record) => record.resolverReady).every((record) => record.reviewed && record.sources.length > 0));

const clone = () => JSON.parse(JSON.stringify(figureMatchingRecords));
const assertInvalid = (mutate, pattern) => {
  const records = clone();
  mutate(records);
  assert.throws(() => validateFigureMatchingDataset(records, figures), pattern);
};

assertInvalid((records) => records.push({ ...records[0] }), /figure_matching_duplicate/);
assertInvalid((records) => { records[0].figureKey = "missing_figure"; }, /figure_matching_unknown_figure/);
assertInvalid((records) => { records[0].resolverReady = "yes"; }, /resolver_ready_must_be_a_boolean/);
assertInvalid((records) => { records[0].intrinsic.gender = "other"; }, /gender_invalid/);
assertInvalid((records) => { records[0].hints.cultures = "汉"; }, /figure_matching_cultures.*must_be_a_string_array/);
assertInvalid((records) => { records[0].familyHints = [{ relation: "uncle", names: ["某人"] }]; }, /family_relation_invalid/);

console.log("VOTC v8.3 Figure Data: PASS (48 readiness records, 14 reviewed calibration figures, fail-closed schema)");
