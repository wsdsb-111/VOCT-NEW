"use strict";

const assert = require("assert");
const { buildSubjectiveWorldView } = require("../resources/app/out/main/worldline/subjective-world-builder");

const view = buildSubjectiveWorldView({
  responder: { id: "1" },
  candidates: [
    {
      factId: "memory:1",
      entityId: "1",
      field: "MEMORY",
      contentRef: "summary://1",
      sourceTier: "PERSONAL_MEMORY",
      knowledgeLevel: "PERSONAL_MEMORY",
      ownerId: "1",
      authorizationComplete: true
    },
    {
      factId: "world:war",
      entityId: "war:1",
      field: "WAR",
      value: "本国正在进行一场公开战争",
      sourceTier: "GAME_TRUTH",
      knowledgeLevel: "PUBLIC_WORLD",
      public: true,
      temporalSafe: true
    }
  ],
  scope: { asOf: "1170.6.6", verificationMode: "CHECKPOINT", completeness: "COMPLETE" },
  checkpointId: "checkpoint"
});

assert(view.policyFacts.some((fact) => fact.factId === "memory:1"), "authorized memory metadata remains available to policy and diagnostics");
assert(!view.promptFacts.some((fact) => fact.factId === "memory:1"), "metadata-only memory facts cannot consume prompt output slots");
assert(view.promptFacts.some((fact) => fact.factId === "world:war"), "renderable world facts remain available to the prompt");
assert.deepStrictEqual(view.allowedFacts, view.policyFacts, "allowedFacts remains a compatibility alias for policyFacts");

console.log("V8.6.2 Policy vs Prompt Facts: PASS (policy metadata cannot starve renderable prompt facts)");
