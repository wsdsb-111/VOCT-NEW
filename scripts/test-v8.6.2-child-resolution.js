"use strict";
const assert = require("assert");
const { buildKinshipGraph } = require("../resources/app/out/main/worldline/character-kinship-graph");
const { familyCharacters } = require("./v8.6.2-test-fixtures");
const relation = buildKinshipGraph(familyCharacters()).relationBetween("1", "2").relation;
assert.equal(relation.type, "CHILD_OF");
assert.equal(relation.label, "儿子");
console.log("V8.6.2 Child Resolution: PASS");
