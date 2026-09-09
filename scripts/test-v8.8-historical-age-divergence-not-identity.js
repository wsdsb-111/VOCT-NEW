"use strict";

const assert = require("assert");
const { resolveHistoricalEntityBinding } = require("../resources/app/out/main/worldline/historical-entity-binding");

const result = resolveHistoricalEntityBinding({
  snapshot: { playthroughId: "campaign-1", definitionToRuntime: { historical_a: "10" }, runtimeToDefinitions: { 10: ["historical_a"] }, characters: { 10: { id: 10, gender: "male", age: 70, children: [99], spouse: 42 } } },
  candidateDefinitionIds: ["historical_a"], definitionRecord: { metadata: { gender: "male", birthDate: "1100.1.1", children: [], spouses: [] } }, scope: { campaignId: "campaign-1", branchId: "branch-a" }
});
assert.equal(result.status, "RESOLVED_RUNTIME");
console.log("V8.8 Historical Age Divergence Not Identity: PASS");
