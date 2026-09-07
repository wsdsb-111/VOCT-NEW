"use strict";
const assert = require("assert");
const { buildKinshipGraph } = require("../resources/app/out/main/worldline/character-kinship-graph");
const { familyCharacters } = require("./v8.6.2-test-fixtures");
const relation = buildKinshipGraph(familyCharacters()).relationBetween("13", "1").relation;
assert.equal(relation.type, "DECEASED_SPOUSE_OF");
assert.equal(relation.label, "亡妻");
console.log("V8.6.2 Deceased Spouse: PASS");
