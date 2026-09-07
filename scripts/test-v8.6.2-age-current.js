"use strict";
const assert = require("assert");
const { resolveCharacterAge } = require("../resources/app/out/main/worldline/character-age-service");
assert.deepStrictEqual(resolveCharacterAge({ alive: true, birth: "1150.9.21", age: 99 }, "1171.9.20"), { age: 20, label: "age", source: "BIRTH_CURRENT_DATE", conflict: true });
console.log("V8.6.2 Current Age: PASS");
