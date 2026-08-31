"use strict";

const assert = require("assert");
const path = require("path");
const root = path.resolve(__dirname, "..");
const gate = require(path.join(root, "resources", "app", "out", "main", "historical-system", "temporal-knowledge-gate"));

assert.deepStrictEqual(gate.parseGameDateStrict("1010年5月3日"), { valid: true, year: 1010, month: 5, day: 3, precision: "day", reason: null });
assert.strictEqual(gate.parseGameDateStrict("1010年").precision, "year");
assert.strictEqual(gate.parseGameDateStrict("1010-05-03").valid, true);
assert.strictEqual(gate.parseGameDateStrict("not-a-date").valid, false);
assert.strictEqual(gate.parseGameDateStrict("1010年2月30日").valid, false);

const event = (year, month = null, day = null) => ({ date: { year, month, day } });
assert.strictEqual(gate.isEventAvailable(event(960), "1010年5月3日"), true);
assert.strictEqual(gate.isEventAvailable(event(1004), "1010年5月3日"), true);
assert.strictEqual(gate.isEventAvailable(event(1022), "1010年5月3日"), false);
assert.strictEqual(gate.isEventAvailable(event(1127), "1010年5月3日"), false);
assert.strictEqual(gate.isEventAvailable(event(1279), "1010年5月3日"), false);
assert.strictEqual(gate.isEventAvailable(event(null), "1010年5月3日"), false);
assert.strictEqual(gate.isEventAvailable(event(1010, 5, 3), "1010年5月3日"), true);
assert.strictEqual(gate.isEventAvailable(event(1010, 5, 4), "1010年5月3日"), false);
assert.strictEqual(gate.isEventAvailable(event(1010, 5, 1), "invalid"), false);

assert.strictEqual(gate.isFactAvailable({ validFrom: 1004, validTo: 1006 }, "1010年"), true);
assert.strictEqual(gate.isFactAvailable({ validFrom: null }, "1010年"), false);
assert.strictEqual(gate.isFigureKnowledgeAvailable({ life: { birthYear: 961 }, activeWindow: { earliestYear: 980 } }, "1010年"), true);
assert.strictEqual(gate.isFigureKnowledgeAvailable({ life: { birthYear: 961 }, activeWindow: { earliestYear: null } }, "1010年"), false, "birth alone must not imply public knowledge");

assert.strictEqual(gate.evaluateDateAvailability({ year: 1010, month: 6, day: 1 }, "1010年").status, gate.TEMPORAL_STATUS.UNKNOWN);
assert.strictEqual(gate.evaluateDateAvailability({ year: 1010, month: 5, day: null }, "1010年5月3日").status, gate.TEMPORAL_STATUS.UNKNOWN);
assert.strictEqual(gate.evaluateDateAvailability(1004, "invalid").status, gate.TEMPORAL_STATUS.UNKNOWN);
assert.deepStrictEqual(gate.filterEventsForDate([event(1004), event(1127)], "1010年").map((item) => item.date.year), [1004]);

console.log("VOTC v8.0 Temporal Knowledge Gate: PASS (past/future/day boundaries and fail-safe unknowns)");
