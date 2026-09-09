"use strict";

const assert = require("assert");
const { resolveCharacterAge } = require("../resources/app/out/main/worldline/character-age-service");

const age = resolveCharacterAge({ alive: false, birth: "1100.1.1", deathDate: "1150.1.1", age: 99 }, { currentGameDate: "1200.1.1" });
assert.equal(age.age, 50);
assert.equal(age.label, "ageAtDeath");
assert.equal(age.source, "BIRTH_DEATH_DATES");
console.log("V8.8 Relation Deceased Age Freeze: PASS");
