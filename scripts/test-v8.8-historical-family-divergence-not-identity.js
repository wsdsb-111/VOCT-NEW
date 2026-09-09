"use strict";

const assert = require("assert");
const { resolveHistoricalEntityBinding } = require("../resources/app/out/main/worldline/historical-entity-binding");

const result = resolveHistoricalEntityBinding({
  snapshot: { playthroughId: "campaign", definitionToRuntime: { figure: "10" }, runtimeToDefinitions: { 10: ["figure"] }, characters: { 10: { id: 10, gender: "male", parents: { father: 99 }, children: [88], spouse: 77 } } },
  candidateDefinitionIds: ["figure"],
  definitionRecord: { metadata: { gender: "male", parents: [], children: [], spouses: [] } },
  scope: { campaignId: "campaign", branchId: "branch", checkpointId: "checkpoint" }
});
assert.equal(result.status, "RESOLVED_RUNTIME", "current-family divergence must not replace Definition-ID identity");
console.log("V8.8 Historical Family Divergence Not Identity: PASS");
