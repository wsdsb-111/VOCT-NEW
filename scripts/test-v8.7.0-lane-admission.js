"use strict";

const assert = require("assert");
const { buildSubjectiveWorldView } = require("../resources/app/out/main/worldline/subjective-world-builder");

const filler = Array.from({ length: 140 }, (_, index) => ({
  factId: `other:${index}`,
  entityId: `other:${index}`,
  field: "OTHER",
  value: `低优先级事实 ${index}`,
  sourceTier: "HISTORICAL_BASELINE",
  knowledgeLevel: "PUBLIC_WORLD",
  public: true,
  temporalSafe: true
}));
const direct = {
  factId: "observation:critical",
  entityId: "2",
  field: "LOCATION",
  value: "亲眼见到乙在临安",
  sourceTier: "DIRECT_OBSERVATION",
  knowledgeLevel: "DIRECT_OBSERVATION",
  temporalSafe: true
};
const view = buildSubjectiveWorldView({
  responder: { id: "1" },
  candidates: [...filler, direct],
  directObservationFactIds: [direct.factId],
  scope: { asOf: "1171.9.20", verificationMode: "LIVE", completeness: "COMPLETE" }
});
assert.equal(view.candidateCount, 128);
assert(view.policyFacts.some((fact) => fact.factId === direct.factId), "direct observation must survive the 128 candidate cap");
console.log("V8.7.0 Lane Admission: PASS (priority-aware bounded candidates)");
