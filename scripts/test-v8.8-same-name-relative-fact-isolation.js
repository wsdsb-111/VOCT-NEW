"use strict";

const assert = require("assert");
const { buildKinshipGraph } = require("../resources/app/out/main/worldline/character-kinship-graph");
const { buildFamilyEntityFactBundle } = require("../resources/app/out/main/worldline/family-entity-fact-bundle");

const graph = buildKinshipGraph({
  1: { id: 1, fullName: "父亲", gender: "male", children: [2, 3] },
  2: { id: 2, fullName: "李青", gender: "male", alive: true, location: "京师" },
  3: { id: 3, fullName: "李青", gender: "male", alive: false, deathDate: "1175.1.1" }
});
const first = buildFamilyEntityFactBundle({ graph, responderId: 1, targetRuntimeId: 2, temporal: { currentGameDate: "1175.2.1" } });
const second = buildFamilyEntityFactBundle({ graph, responderId: 1, targetRuntimeId: 3, temporal: { currentGameDate: "1175.2.1" } });
assert.equal(first.name, second.name);
assert.equal(first.entityId, "2");
assert.equal(second.entityId, "3");
assert.equal(first.lifeStatus, "ALIVE");
assert.equal(second.lifeStatus, "DEAD");
console.log("V8.8 Same Name Relative Fact Isolation: PASS");
