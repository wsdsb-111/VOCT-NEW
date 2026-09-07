"use strict";

const assert = require("assert");
const { buildKinshipGraph } = require("../resources/app/out/main/worldline/character-kinship-graph");
const { normalizeSpouseRecords } = require("../resources/app/out/main/worldline/canonical-spouse-record");

const directSiblingGraph = buildKinshipGraph(new Map([
  [1, { id: 1, fullName: "甲", gender: "male" }],
  [2, { id: 2, fullName: "乙", gender: "female", evidence: { relations: [{ ownerId: 1, relationType: "sibling", source: "1.siblings", confidence: 1 }] } }]
]));
const sibling = directSiblingGraph.relationBetween(2, 1).relation;
assert(sibling && sibling.type === "SIBLING_OF");
assert.equal(sibling.source, "LOG_DIRECT");

const nameOnly = normalizeSpouseRecords({ id: 1, consort: "王氏" });
assert.deepStrictEqual(nameOnly.map((record) => [record.runtimeId, record.name, record.relationType]), [[null, "王氏", "UNKNOWN_CONSORT"]]);
assert.equal(buildKinshipGraph({ 1: { id: 1, consort: "王氏" } }).relationsTo(1).length, 0, "name-only consort must not invent a runtime edge");

const bound = buildKinshipGraph({
  1: { id: 1, spouses: [{ id: 3, name: "李氏", alive: false, deathDate: "1170.1.1" }] },
  3: { id: 3, name: "李氏", gender: "female", alive: false, deathDate: "1170.1.1" }
}).relationBetween(3, 1).relation;
assert(bound && bound.type === "DECEASED_SPOUSE_OF");
console.log("V8.7.0 Direct Sibling / Consort: PASS (LOG_DIRECT sibling and name-only spouse safety)");
