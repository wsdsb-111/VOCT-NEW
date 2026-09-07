"use strict";

const assert = require("assert");
const { buildSubjectiveWorldView } = require("../resources/app/out/main/worldline/subjective-world-builder");
const { buildSubjectiveWorldTurnRecall } = require("../resources/app/out/main/worldline/subjective-prompt-context");

const candidates = [
  ...Array.from({ length: 24 }, (_, index) => ({
    factId: `memory:${index}`,
    entityId: "1",
    field: "MEMORY",
    contentRef: `summary://${index}`,
    sourceTier: "PERSONAL_MEMORY",
    knowledgeLevel: "PERSONAL_MEMORY",
    ownerId: "1",
    authorizationComplete: true
  })),
  {
    factId: "world:late",
    entityId: "war:late",
    field: "WAR",
    value: "迟到候选中的公开战争仍须进入提示词",
    sourceTier: "GAME_TRUTH",
    knowledgeLevel: "PUBLIC_WORLD",
    public: true,
    temporalSafe: true
  }
];

const view = buildSubjectiveWorldView({
  responder: { id: "1" },
  candidates,
  scope: { asOf: "1170.6.6", verificationMode: "CHECKPOINT", completeness: "COMPLETE" },
  checkpointId: "checkpoint"
});
const recall = buildSubjectiveWorldTurnRecall(view);

assert.equal(view.policyFacts.length, 24, "policy facts keep their independent 24-item bound");
assert(view.promptFacts.some((fact) => fact.factId === "world:late"), "renderable prompt facts are selected independently from metadata-only facts");
assert(recall.text?.includes("迟到候选中的公开战争仍须进入提示词"), "the late world fact reaches Subjective World prompt output");

console.log("V8.6.2 Subjective Output Starvation: PASS (independent prompt selection preserves world output)");
