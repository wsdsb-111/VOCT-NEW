"use strict";

const assert = require("assert");
const { buildKinshipGraph: buildCurrentKinshipGraph, buildLegacyStructuralKinshipGraph: buildKinshipGraph } = require("../resources/app/out/main/worldline/character-kinship-graph");
const { buildFamilyEntityFactBundle } = require("../resources/app/out/main/worldline/family-entity-fact-bundle");
const { getTargetedKinshipGraph, currentDirectParentFilter } = require("../resources/app/out/main/worldline/kinship-graph-cache");

const campaignToken = "votc8c-202610180006";
const date = "1175.1.1";
const totalDays = 430000;
function currentProof(childId, parentId) {
  return { source: "CK3_DIRECT_PARENT", sourceOwnerId: childId, childId, parentId,
    relationType: "parent", sourceRelation: "parents", publicStatus: "PUBLIC_LEGAL_PARENT",
    knowledgeStatus: "UNKNOWN", campaignToken, sourceSnapshotId: `${date}/${totalDays}` };
}
function currentGameData(characters) {
  return { characters, campaignToken, date, totalDays };
}

const completeCharacters = new Map([
  [1, { id: 1, fullName: "父亲", children: [{ id: 2, directParentEvidence: currentProof(2, 1) }] }],
  [2, { id: 2, fullName: "孩子", gender: "male", parents: [{ id: 1, ...currentProof(2, 1) }] }]
]);
const completeData = currentGameData(completeCharacters);
const completeGraph = buildCurrentKinshipGraph(completeCharacters, { directParentEvidenceFilter: currentDirectParentFilter(completeData) });
assert.equal(buildFamilyEntityFactBundle({ graph: completeGraph, responderId: 1, targetRuntimeId: 2, relationTypes: ["CHILD_OF"] }).sourceComplete, true);

const partialGraph = buildKinshipGraph({ 1: { id: 1, fullName: "父亲", children: [2] } });
assert.equal(buildFamilyEntityFactBundle({ graph: partialGraph, responderId: 1, targetRuntimeId: 2, relationTypes: ["CHILD_OF"] }).sourceComplete, false);

const cappedCharacters = new Map([
  [1, { id: 1, fullName: "父亲", children: [{ id: 2, directParentEvidence: currentProof(2, 1) }] }],
  [2, { id: 2, fullName: "孩子", gender: "male", parents: [{ id: 1, ...currentProof(2, 1) }],
    children: [{ id: 3, directParentEvidence: currentProof(3, 2) }] }],
  [3, { id: 3, fullName: "孙辈", parents: [{ id: 2, ...currentProof(3, 2) }] }]
]);
const cappedGraph = getTargetedKinshipGraph({ ...currentGameData(cappedCharacters),
  contentFingerprint: "family-source-cap",
}, [1], { maxDepth: 3, maxNodes: 2 });
assert.equal(buildFamilyEntityFactBundle({ graph: cappedGraph, responderId: 1, targetRuntimeId: 2, relationTypes: ["CHILD_OF"] }).sourceComplete, false);

console.log("V8.8.2 Family Source Complete: PASS");
