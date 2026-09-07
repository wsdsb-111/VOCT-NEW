"use strict";
const assert = require("assert");
const { resolveCharacterSex } = require("../resources/app/out/main/worldline/character-demographic-normalizer");
const { resolveKinshipLabel } = require("../resources/app/out/main/worldline/kinship-label-resolver");
assert.deepStrictEqual(resolveCharacterSex({ snapshot: { gender: "female" }, live: { gender: "male" } }), { sex: "female", source: "CURRENT_SNAPSHOT" });
assert.equal(resolveKinshipLabel({ type: "PARENT_OF", sex: "female" }), "母亲");
assert.equal(resolveKinshipLabel({ type: "SIBLING_OF", sex: "unknown" }), "兄弟姐妹");
console.log("V8.6.2 Sex Label Consistency: PASS");
