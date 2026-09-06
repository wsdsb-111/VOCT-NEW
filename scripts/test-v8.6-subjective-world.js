"use strict";

const assert = require("assert");
const { buildSubjectiveWorldView } = require("../resources/app/out/main/worldline/subjective-world-builder");

const candidates = [
  { id: "self:1:name", factId: "self:1:name", entityId: "1", field: "NAME", value: "甲", sourceTier: "GAME_TRUTH", knowledgeLevel: "SELF", selfKnowledgeVerified: true },
  { id: "secret:x", factId: "secret:x", entityId: "9", field: "SECRET", value: "不得泄露的秘密正文", sourceTier: "PERSONAL_MEMORY", knowledgeLevel: "SECRET", knownBy: ["1"], authorizationComplete: true },
  { id: "public:war", factId: "public:war", entityId: "w1", field: "WAR", value: "公开战争", sourceTier: "ANNUAL_DELTA", knowledgeLevel: "PUBLIC_WORLD", public: true, temporalSafe: true },
  ...Array.from({ length: 130 }, (_, index) => ({ id: `extra:${index}`, factId: `extra:${index}`, entityId: `e${index}`, field: "NOTE", value: `候选 ${index}`, sourceTier: "ANNUAL_DELTA", knowledgeLevel: "PUBLIC_WORLD", public: true, temporalSafe: true }))
];

const owner = buildSubjectiveWorldView({ responder: { id: "1" }, candidates, scope: { sameCourt: true, sameRealm: true, asOf: "1170.6.6", verificationMode: "CHECKPOINT", completeness: "COMPLETE" }, checkpointId: "checkpoint" });
assert(owner.allowedFacts.some((fact) => fact.factId === "secret:x"), "authorized owner retains the secret fact");
assert.equal(owner.candidateCount, 128, "candidate processing has a hard bound");
assert.equal(owner.truncated, true);
assert(owner.allowedFacts.length <= 24, "normal subjective DTO remains bounded");

const other = buildSubjectiveWorldView({ responder: { id: "2" }, candidates, scope: { sameCourt: true, sameRealm: true, asOf: "1170.6.6", verificationMode: "CHECKPOINT", completeness: "COMPLETE" }, checkpointId: "checkpoint" });
assert(!JSON.stringify(other).includes("不得泄露的秘密正文"), "unauthorized secret content never reaches another responder DTO");
assert.equal(other.filteredCount >= 1, true);
assert.equal(other.allowedFacts.some((fact) => fact.factId === "secret:x"), false);

const tenResponders = Array.from({ length: 10 }, (_, index) => buildSubjectiveWorldView({ responder: { id: String(index + 10) }, candidates, scope: { sameCourt: true, sameRealm: true, asOf: "1170.6.6", verificationMode: "CHECKPOINT", completeness: "COMPLETE" }, checkpointId: "checkpoint" }));
assert(tenResponders.every((view) => view.candidateCount === 128 && view.allowedFacts.length <= 24), "1/5/10 responder policy work remains bounded per prepared candidate pool");

console.log("V8.6 Subjective World: PASS (field policy, secret redaction, 128/24 bounds and responder isolation)");
