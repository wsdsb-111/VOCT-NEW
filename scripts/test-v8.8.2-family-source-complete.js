"use strict";

const assert = require("assert");
const { buildKinshipGraph } = require("../resources/app/out/main/worldline/character-kinship-graph");
const { buildFamilyEntityFactBundle } = require("../resources/app/out/main/worldline/family-entity-fact-bundle");
const { getTargetedKinshipGraph } = require("../resources/app/out/main/worldline/kinship-graph-cache");

const completeGraph = buildKinshipGraph({
  1: { id: 1, fullName: "父亲", children: [2] },
  2: { id: 2, fullName: "孩子", gender: "male" }
});
assert.equal(buildFamilyEntityFactBundle({ graph: completeGraph, responderId: 1, targetRuntimeId: 2, relationTypes: ["CHILD_OF"] }).sourceComplete, true);

const partialGraph = buildKinshipGraph({ 1: { id: 1, fullName: "父亲", children: [2] } });
assert.equal(buildFamilyEntityFactBundle({ graph: partialGraph, responderId: 1, targetRuntimeId: 2, relationTypes: ["CHILD_OF"] }).sourceComplete, false);

const cappedGraph = getTargetedKinshipGraph({
  contentFingerprint: "family-source-cap",
  characters: {
    1: { id: 1, fullName: "父亲", children: [2] },
    2: { id: 2, fullName: "孩子", gender: "male", children: [3] },
    3: { id: 3, fullName: "孙辈" }
  }
}, [1], { maxDepth: 3, maxNodes: 2 });
assert.equal(buildFamilyEntityFactBundle({ graph: cappedGraph, responderId: 1, targetRuntimeId: 2, relationTypes: ["CHILD_OF"] }).sourceComplete, false);

console.log("V8.8.2 Family Source Complete: PASS");
