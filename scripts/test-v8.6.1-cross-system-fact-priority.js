"use strict";

const assert = require("assert");
const { buildSubjectiveWorldView } = require("../resources/app/out/main/worldline/subjective-world-builder");

const view = buildSubjectiveWorldView({ responder: { id: "1" }, scope: { asOf: "1170.6.6", sameCourt: true, completeness: "COMPLETE" }, candidates: [
  { factId: "memory-location", entityId: "2", field: "LOCATION", value: "去年驻守开封", sourceTier: "PERSONAL_MEMORY", knowledgeLevel: "PERSONAL_MEMORY", ownerId: "1", authorizationComplete: true },
  { factId: "truth-location", entityId: "2", field: "LOCATION", value: "当前位于临安", sourceTier: "GAME_TRUTH", knowledgeLevel: "COURT_PUBLIC", public: true, temporalSafe: true },
  { factId: "memory-narrative", entityId: "1", field: "MEMORY", value: "去年曾在开封相见", sourceTier: "PERSONAL_MEMORY", knowledgeLevel: "PERSONAL_MEMORY", ownerId: "1", authorizationComplete: true }
] });
assert(view.allowedFacts.some((fact) => fact.value === "当前位于临安"), "Current Game Truth must win a structured LOCATION conflict");
assert(!view.allowedFacts.some((fact) => fact.value === "去年驻守开封"), "stale structured Memory cannot override current LOCATION");
assert(view.allowedFacts.some((fact) => fact.value === "去年曾在开封相见"), "historical narrative Memory remains available under its own MEMORY key");
console.log("V8.6.1 Cross-System Fact Priority: PASS (current fact wins, historical narrative remains)");
