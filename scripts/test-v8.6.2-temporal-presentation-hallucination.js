"use strict";
const assert = require("assert");
const { formatDeathFact } = require("../resources/app/out/main/worldline/character-temporal-facts");
const result = formatDeathFact({ id: 1, alive: false, deathDate: "1171.9.2" }, { currentGameDate: "1171.9.20" });
assert(result.text.includes("2周前"));
assert(!result.text.includes("昨日"));
console.log("V8.6.2 Temporal Presentation Hallucination Guard: PASS");
