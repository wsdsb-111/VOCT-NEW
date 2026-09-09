"use strict";

const assert = require("assert");
const path = require("path");
const root = path.resolve(__dirname, "..");
const { figures } = require(path.join(root, "resources", "app", "out", "main", "historical-system", "historical-data", "figures"));
const { figureMatchingRecords } = require(path.join(root, "resources", "app", "out", "main", "historical-system", "historical-data", "figure-matching"));
const { validateFigureMatchingDataset } = require(path.join(root, "resources", "app", "out", "main", "historical-system", "schema"));

assert.doesNotThrow(() => validateFigureMatchingDataset(figureMatchingRecords, figures));
assert.strictEqual(figureMatchingRecords.length, figures.length, "every historical definition must retain a matching metadata record");
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

console.log("VOTC v8.8 Historical Definition Data: PASS (current Definition-ID metadata remains schema-safe)");
