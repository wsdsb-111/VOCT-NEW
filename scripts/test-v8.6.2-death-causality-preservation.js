"use strict";
const assert = require("assert");
const { buildDeathFact } = require("../resources/app/out/main/worldline/character-temporal-facts");
const input = { id: "A", alive: false, deathDate: "1171.9.2", killerId: "B", deathReason: "MURDER" };
const early = buildDeathFact(input, { currentGameDate: "1171.9.3" });
const later = buildDeathFact(input, { currentGameDate: "1172.9.3" });
assert.deepStrictEqual([early.deceasedId, early.killerId, early.deathDate], [later.deceasedId, later.killerId, later.deathDate]);
assert.notEqual(early.derivedTemporalPresentation.relativeLabel, later.derivedTemporalPresentation.relativeLabel);
console.log("V8.6.2 Death Causality Preservation: PASS");
