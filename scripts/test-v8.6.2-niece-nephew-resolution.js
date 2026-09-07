"use strict";
const assert = require("assert");
const { buildKinshipGraph } = require("../resources/app/out/main/worldline/character-kinship-graph");
const { familyCharacters } = require("./v8.6.2-test-fixtures");
const relation = buildKinshipGraph(familyCharacters()).relationBetween("1", "9").relation;
assert.equal(relation.type, "NIECE_NEPHEW_OF");
assert.equal(relation.label, "晚辈近亲");
console.log("V8.6.2 Niece Nephew Resolution: PASS");
