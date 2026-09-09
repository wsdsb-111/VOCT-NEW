"use strict";

const assert = require("assert");
const { resolveHistoricalEntityBinding } = require("../resources/app/out/main/worldline/historical-entity-binding");
const { resolveHistoricalIdentity } = require("../resources/app/out/main/worldline/historical-identity-resolver");

const result = resolveHistoricalEntityBinding({
  snapshot: { playthroughId: "campaign-1", definitionToRuntime: { historical_a: "10" }, runtimeToDefinitions: { 10: ["historical_a"] }, characters: { 10: { id: 10, gender: "male" } } },
  candidateDefinitionIds: ["historical_a"], definitionRecord: { metadata: { gender: "female" } }, scope: { campaignId: "campaign-1", branchId: "branch-a" }
});
assert.equal(result.status, "IDENTITY_CONFLICT_GENDER");
const queryResult = resolveHistoricalIdentity({
  alias: "测试人物",
  candidateDefinitionIds: ["historical_a"],
  definitionRecords: [{ definitionId: "historical_a", displayName: "测试人物", names: ["测试人物"], metadata: { gender: "male" }, sourceComplete: true }],
  snapshot: { definitionToRuntime: { historical_a: "10" }, runtimeToDefinitions: { 10: ["historical_a"] }, characters: { 10: { id: 10, fullName: "测试人物", gender: "male", evidence: { conflicts: { gender: true } } } } },
  sourceComplete: true
});
assert.equal(queryResult.status, "REJECTED");
assert.equal(queryResult.reason, "GENDER_CONFLICT");
console.log("V8.8 Historical Gender Conflict: PASS");
