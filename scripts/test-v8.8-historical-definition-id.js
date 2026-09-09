"use strict";

const assert = require("assert");
const { resolveHistoricalEntityBinding } = require("../resources/app/out/main/worldline/historical-entity-binding");

const snapshot = {
  playthroughId: "campaign-1",
  definitionToRuntime: { historical_a: "10", historical_b: "11" },
  runtimeToDefinitions: { 10: ["historical_a"], 11: ["historical_b"] },
  characters: { 10: { id: 10, fullName: "同名", gender: "male", age: 18, children: [99] }, 11: { id: 11, fullName: "同名", gender: "male" } }
};
const scope = { campaignId: "campaign-1", branchId: "branch-a", checkpointId: "checkpoint-a", datasetRevision: "dataset-a" };
const first = resolveHistoricalEntityBinding({ snapshot, candidateDefinitionIds: ["historical_a"], definitionRecord: { metadata: { gender: "male" } }, scope });
const second = resolveHistoricalEntityBinding({ snapshot, candidateDefinitionIds: ["historical_b"], definitionRecord: { metadata: { gender: "male" } }, scope });
assert.equal(first.status, "RESOLVED_RUNTIME");
assert.equal(first.runtimeId, "10");
assert.equal(second.runtimeId, "11");
assert.equal(first.bindingScope.branchId, "branch-a");
console.log("V8.8 Historical Definition ID: PASS");
