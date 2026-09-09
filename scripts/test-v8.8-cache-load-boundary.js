"use strict";

const assert = require("assert");
const { HistoricalEntityBindingCache } = require("../resources/app/out/main/worldline/historical-entity-binding");
const { getTargetedKinshipGraph } = require("../resources/app/out/main/worldline/kinship-graph-cache");
const { resolveRelationMention } = require("../resources/app/out/main/worldline/relation-mention-resolver");

const snapshot = (fingerprint, childId) => ({ contentFingerprint: fingerprint, participantRelationRevision: 1, characters: { 1: { id: 1, children: [childId] }, [childId]: { id: childId, gender: "male" } } });
const firstSnapshot = snapshot("save-a", 2);
const first = getTargetedKinshipGraph(firstSnapshot, ["1"]);
assert.strictEqual(getTargetedKinshipGraph(firstSnapshot, ["1"]), first);
assert.equal(resolveRelationMention({ query: "你的儿子", responderId: 1, graph: first }).targetRuntimeId, "2");
firstSnapshot.characters[1].children = [3];
firstSnapshot.characters[3] = { id: 3, gender: "male" };
firstSnapshot.participantRelationRevision++;
const mutated = getTargetedKinshipGraph(firstSnapshot, ["1"]);
assert.notStrictEqual(mutated, first);
assert.equal(resolveRelationMention({ query: "你的儿子", responderId: 1, graph: mutated }).targetRuntimeId, "3");
const loaded = getTargetedKinshipGraph(snapshot("save-b", 4), ["1"]);
assert.equal(resolveRelationMention({ query: "你的儿子", responderId: 1, graph: loaded }).targetRuntimeId, "4");
const oversizedCharacters = { 1: { id: 1, children: Array.from({ length: 80 }, (_, index) => index + 2) } };
for (let id = 2; id <= 81; id++) oversizedCharacters[id] = { id, gender: id === 81 ? "male" : "female" };
const incomplete = getTargetedKinshipGraph({ contentFingerprint: "oversized", characters: oversizedCharacters }, ["1"], { maxNodes: 50 });
const incompleteResult = resolveRelationMention({ query: "你的儿子", responderId: 1, graph: incomplete });
assert.equal(incompleteResult.status, "RELATION_SOURCE_INCOMPLETE", "a truncated candidate domain must not resolve a partial unique match");
assert(incompleteResult.candidates.length <= 50);

const bindings = new HistoricalEntityBindingCache({ maxEntries: 2 });
const bindingSnapshot = { characters: { 1: { gender: "male" } }, definitionToRuntime: { figure: "1" }, runtimeToDefinitions: { 1: ["figure"] } };
const resolveBranch = branchId => bindings.resolve({ snapshot: bindingSnapshot, candidateDefinitionIds: ["figure"], scope: { campaignId: "campaign", branchId, checkpointId: "checkpoint", datasetRevision: "dataset" } });
assert.equal(resolveBranch("branch-a").bindingScope.branchId, "branch-a");
assert.equal(resolveBranch("branch-b").bindingScope.branchId, "branch-b");
assert.equal(resolveBranch("branch-c").bindingScope.branchId, "branch-c");
assert.equal(bindings.entries.size, 2, "binding cache must stay bounded across branch switches");
console.log("V8.8 Cache Load Boundary: PASS");
