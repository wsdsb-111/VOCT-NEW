"use strict";
const assert = require("assert");
const { buildDeathFact } = require("../resources/app/out/main/worldline/character-temporal-facts");
const fact = buildDeathFact({ id: 123, alive: false, birth: "1120.1.1", deathDate: "1171.9.2", killerId: 456, killerName: "折彦瑜", deathReason: "MURDER" }, { currentGameDate: "1171.9.20" });
assert.deepStrictEqual([fact.deceasedId, fact.deathDate, fact.killerId, fact.killerName], ["123", "1171.9.2", "456", "折彦瑜"]);
assert.equal(fact.sourceTier, "GAME_TRUTH");
console.log("V8.6.2 Death Fact: PASS");
