"use strict";

const assert = require("assert");
const path = require("path");
const root = path.resolve(__dirname, "..");
const { getFrozenLegacyReferenceByYear } = require("./fixtures/v8.0-legacy-historical-reference");
const baseline = require(path.join(root, "resources", "app", "out", "main", "historical-system", "historical-baseline"));
const legacyApi = require(path.join(root, "resources", "app", "out", "main", "game-data", "legacy-historical-reference"));

for (let year = 800; year <= 1400; year += 1) {
  const frozen = getFrozenLegacyReferenceByYear(year);
  assert.deepStrictEqual(baseline.getLegacyReferenceByYear(year), frozen, `baseline parity failed for ${year}`);
  assert.deepStrictEqual(legacyApi.getHistoricalReferenceByYear(year), frozen, `legacy API parity failed for ${year}`);
}

const boundaries = [874, 875, 906, 907, 959, 960, 975, 976, 999, 1000, 1021, 1022, 1049, 1050, 1062, 1063, 1084, 1085, 1099, 1100, 1125, 1126, 1141, 1142, 1161, 1162, 1188, 1189, 1233, 1234, 1259, 1260, 1278, 1279];
for (const year of boundaries) assert.deepStrictEqual(baseline.getLegacyReferenceByYear(year), getFrozenLegacyReferenceByYear(year), `boundary parity failed for ${year}`);

assert.strictEqual(baseline.getPeriodByYear(874).key, "tang_before_875");
assert.strictEqual(baseline.getPeriodByYear(1279).key, "yuan_foundation_1279_onward");
for (const value of ["1000", null, undefined, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
  assert.deepStrictEqual(legacyApi.getHistoricalReferenceByYear(value), getFrozenLegacyReferenceByYear(value), `legacy coercion parity failed for ${String(value)}`);
}
assert.strictEqual(baseline.getBaselineSnapshot(1010).schemaVersion, 1);
console.log("VOTC v8.0 Historical Baseline parity: PASS (800-1400, explicit boundaries, event/figure order)");
