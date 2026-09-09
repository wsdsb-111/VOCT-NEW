"use strict";

const assert = require("assert");
const { resolveHistoricalEntityBinding } = require("../resources/app/out/main/worldline/historical-entity-binding");

const snapshot = {
  playthroughId: "campaign",
  characters: { 10: { id: 10, fullName: "同名人物", gender: "male" }, 20: { id: 20, fullName: "同名人物", gender: "male" } },
  definitionToRuntime: { figure_a: "10", figure_b: "20" },
  runtimeToDefinitions: { 10: ["figure_a"], 20: ["figure_b"] }
};
const scope = { campaignId: "campaign", branchId: "branch", checkpointId: "checkpoint" };
assert.equal(resolveHistoricalEntityBinding({ snapshot, candidateDefinitionIds: ["figure_a"], scope }).runtimeId, "10");
assert.equal(resolveHistoricalEntityBinding({ snapshot, candidateDefinitionIds: ["figure_b"], scope }).runtimeId, "20");
console.log("V8.8 Historical Same-name Definition Binding: PASS");
