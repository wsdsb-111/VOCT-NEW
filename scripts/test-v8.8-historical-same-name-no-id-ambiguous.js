"use strict";

const assert = require("assert");
const { resolveHistoricalEntityBinding } = require("../resources/app/out/main/worldline/historical-entity-binding");

const result = resolveHistoricalEntityBinding({ snapshot: { playthroughId: "campaign-1" }, candidateDefinitionIds: ["historical_a", "historical_b"], scope: { campaignId: "campaign-1", branchId: "branch-a" } });
assert.equal(result.status, "AMBIGUOUS");
assert.equal(result.reason, "DEFINITION_ID_DUPLICATE");
console.log("V8.8 Historical Same Name No ID Ambiguous: PASS");
