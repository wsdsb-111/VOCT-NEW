"use strict";
const assert = require("assert");
const { resolveCharacterAge } = require("../resources/app/out/main/worldline/character-age-service");
const age = resolveCharacterAge({ alive: false, birth: "1120.1.1", deathDate: "1171.9.2", age: 99 }, "1200.1.1");
assert.equal(age.age, 51);
assert.equal(age.label, "ageAtDeath");
console.log("V8.6.2 Age At Death: PASS");
