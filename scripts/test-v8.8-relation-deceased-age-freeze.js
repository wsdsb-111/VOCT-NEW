"use strict";

const assert = require("assert");
const { resolveCharacterAge } = require("../resources/app/out/main/worldline/character-age-service");
const { formatDeathFact } = require("../resources/app/out/main/worldline/character-temporal-facts");

const age = resolveCharacterAge({ alive: false, birth: "1100.1.1", deathDate: "1150.1.1", age: 99 }, { currentGameDate: "1200.1.1" });
assert.equal(age.age, null, "an ordinary current-age value and unverified birth/death arithmetic cannot establish deceased age");
assert.equal(age.label, "ageAtDeath");
assert.equal(age.source, "AGE_AT_DEATH_UNAVAILABLE");
assert.equal(age.calculatedCalendarAge, 50);
assert.equal(age.diagnosticCode, "CALENDAR_AGE_UNVERIFIED");

const explicitDeath = {
  id: 2,
  alive: false,
  birth: "1100.1.1",
  deathDate: "1150.1.1",
  ageAtDeath: 49,
  ageAtDeathSource: "CK3_AGE_AT_DEATH"
};
const explicitAge = resolveCharacterAge(explicitDeath, { currentGameDate: "1200.1.1" });
assert.equal(explicitAge.age, 49);
assert.equal(explicitAge.source, "CK3_AGE_AT_DEATH");
assert.match(formatDeathFact(explicitDeath, { currentGameDate: "1200.1.1" }).text, /终年49岁/,
  "explicit CK3 age at death remains displayable");
console.log("V8.8 Relation Deceased Age Freeze: PASS");
