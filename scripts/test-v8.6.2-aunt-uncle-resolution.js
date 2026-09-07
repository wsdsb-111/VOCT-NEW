"use strict";
const assert = require("assert");
const { buildKinshipGraph } = require("../resources/app/out/main/worldline/character-kinship-graph");
const { familyCharacters } = require("./v8.6.2-test-fixtures");
const relation = buildKinshipGraph(familyCharacters()).relationBetween("9", "1").relation;
assert.equal(relation.type, "AUNT_UNCLE_OF");
assert.equal(relation.label, "叔伯");
console.log("V8.6.2 Aunt Uncle Resolution: PASS");
