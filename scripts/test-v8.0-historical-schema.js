"use strict";

const assert = require("assert");
const path = require("path");
const root = path.resolve(__dirname, "..");
const { dataset } = require(path.join(root, "resources", "app", "out", "main", "historical-system", "historical-baseline"));
const schema = require(path.join(root, "resources", "app", "out", "main", "historical-system", "schema"));

const clone = () => JSON.parse(JSON.stringify(dataset));
assert.doesNotThrow(() => schema.validateHistoricalDataset(clone()));

const duplicatePeriod = clone();
duplicatePeriod.periods.push({ ...duplicatePeriod.periods[0] });
assert.throws(() => schema.validateHistoricalDataset(duplicatePeriod), /historical_period_duplicate/);

const overlap = clone();
overlap.periods[1].startYear = 874;
assert.throws(() => schema.validateHistoricalDataset(overlap), /historical_period_overlap/);

const gap = clone();
gap.periods[1].startYear = 876;
assert.throws(() => schema.validateHistoricalDataset(gap), /historical_period_gap/);

const missingOpenStart = clone();
missingOpenStart.periods[0].startYear = 1;
assert.throws(() => schema.validateHistoricalDataset(missingOpenStart), /historical_period_start_not_unbounded/);

const missingOpenEnd = clone();
missingOpenEnd.periods[missingOpenEnd.periods.length - 1].endYearExclusive = 1401;
assert.throws(() => schema.validateHistoricalDataset(missingOpenEnd), /historical_period_end_not_unbounded/);

const invalidRange = clone();
invalidRange.periods[1].endYearExclusive = invalidRange.periods[1].startYear;
assert.throws(() => schema.validateHistoricalDataset(invalidRange), /historical_period_invalid_range/);

const unknownFigure = clone();
unknownFigure.periods[1].notableFigureKeys.push("missing_figure");
assert.throws(() => schema.validateHistoricalDataset(unknownFigure), /historical_period_unknown_figure/);

const unknownEvent = clone();
unknownEvent.periods[1].notableEventKeys.push("missing_event");
assert.throws(() => schema.validateHistoricalDataset(unknownEvent), /historical_period_unknown_event/);

const duplicateFact = clone();
const fact = { factId: "fixture_fact", figureKey: null, type: "role", value: "fixture", validFrom: 1000, validTo: 1001, sensitivity: "high", dependencies: [] };
duplicateFact.facts.push(fact, { ...fact });
assert.throws(() => schema.validateHistoricalDataset(duplicateFact), /historical_fact_duplicate/);

const invalidSensitivity = clone();
invalidSensitivity.events[0].sensitivity = "unknown";
assert.throws(() => schema.validateHistoricalDataset(invalidSensitivity), /historical_event_invalid_sensitivity/);

const malformedDate = clone();
malformedDate.events[0].date.month = 13;
assert.throws(() => schema.validateHistoricalDataset(malformedDate), /month_out_of_range/);

const invalidYear = clone();
invalidYear.events[0].date.year = 0;
assert.throws(() => schema.validateHistoricalDataset(invalidYear), /year_out_of_range/);

const impossibleDate = clone();
impossibleDate.events[0].date = { year: 1010, month: 2, day: 30 };
assert.throws(() => schema.validateHistoricalDataset(impossibleDate), /day_out_of_range/);

const mismatchedFactOwner = clone();
mismatchedFactOwner.facts.push({ factId: "fixture_fact_owner", figureKey: mismatchedFactOwner.figures[1].figureKey, type: "role", value: "fixture", validFrom: 1000, validTo: 1001, sensitivity: "high", dependencies: [] });
mismatchedFactOwner.figures[0].historicalFactIds.push("fixture_fact_owner");
assert.throws(() => schema.validateHistoricalDataset(mismatchedFactOwner), /historical_figure_fact_owner_mismatch/);

assert(Object.isFrozen(dataset), "validated runtime dataset must be immutable");
assert(Object.isFrozen(dataset.periods), "runtime period collection must be immutable");
assert(Object.isFrozen(dataset.periods[0].notableEventKeys), "nested runtime data must be immutable");
assert.throws(() => {
  dataset.periods[0].context = "mutated after validation";
}, TypeError);

console.log("VOTC v8.0 Historical schema: PASS (IDs, ranges, references, sensitivity, dates)");
