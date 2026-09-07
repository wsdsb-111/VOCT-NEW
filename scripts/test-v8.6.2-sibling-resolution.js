"use strict";
const assert = require("assert");
const { buildKinshipGraph } = require("../resources/app/out/main/worldline/character-kinship-graph");
const { familyCharacters } = require("./v8.6.2-test-fixtures");
const relation = buildKinshipGraph(familyCharacters()).relationBetween("4", "1").relation;
assert.equal(relation.type, "SIBLING_OF");
assert.equal(relation.source, "DERIVED_SHARED_PARENT");
console.log("V8.6.2 Sibling Resolution: PASS");
