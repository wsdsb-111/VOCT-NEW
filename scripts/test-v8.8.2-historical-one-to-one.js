"use strict";

const assert = require("assert");
const { HistoricalEntityBindingCache, resolveHistoricalEntityBinding } = require("../resources/app/out/main/worldline/historical-entity-binding");

const scope = { campaignId: "campaign", branchId: "branch", checkpointId: "checkpoint", datasetRevision: "dataset" };
const conflicted = {
  characters: { 10: { id: 10, fullName: "同一运行时人物", gender: "male" } },
  definitionToRuntime: { historical_a: "10", historical_b: "10" },
  runtimeToDefinitions: { 10: ["historical_a", "historical_b"] }
};
const result = resolveHistoricalEntityBinding({ snapshot: conflicted, candidateDefinitionIds: ["historical_a"], scope });
assert.equal(result.status, "AMBIGUOUS");
assert.equal(result.reason, "DEFINITION_RUNTIME_BINDING_CONFLICT");

const cache = new HistoricalEntityBindingCache();
const mutable = {
  characters: { 10: { id: 10, fullName: "人物", gender: "male" } },
  definitionToRuntime: { historical_a: "10" },
  runtimeToDefinitions: { 10: ["historical_a"] }
};
assert.equal(cache.resolve({ snapshot: mutable, candidateDefinitionIds: ["historical_a"], scope }).status, "RESOLVED_RUNTIME");
mutable.runtimeToDefinitions[10] = ["historical_a", "historical_b"];
assert.equal(cache.resolve({ snapshot: mutable, candidateDefinitionIds: ["historical_a"], scope }).status, "AMBIGUOUS", "cache key must include reciprocal definitions");

console.log("V8.8.2 Historical One-to-one: PASS");
