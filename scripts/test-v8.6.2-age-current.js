"use strict";
const assert = require("assert");
const { resolveCharacterAge } = require("../resources/app/out/main/worldline/character-age-service");
assert.deepStrictEqual(resolveCharacterAge({ alive: true, birth: "1150.9.21", age: 99, ageSource: "CK3_CURRENT_AGE" }, "1171.9.20"), {
  age: 99,
  label: "age",
  source: "CK3_CURRENT_AGE",
  ageSource: "CK3_CURRENT_AGE",
  conflict: true,
  rawAge: 99,
  calculatedCalendarAge: 20,
  asOfGameDate: "1171.9.20"
});
console.log("V8.6.2 Current Age: PASS");
