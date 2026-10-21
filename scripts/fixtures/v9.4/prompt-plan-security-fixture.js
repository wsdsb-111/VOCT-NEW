"use strict";

const { buildPromptPlanV9 } = require("../../../src/app/main/prompts/prompt-plan-builder");
const { planSeal } = require("../../../src/app/main/prompts/prompt-plan-contract");
const { serializePromptPlan } = require("../../../src/app/main/prompts/prompt-plan-serializer");
const { createEffectiveRequestSnapshot, fingerprintMessages } = require("../../../src/app/main/providers/effective-request");

const SCOPE = Object.freeze({
  campaignToken: "fixture-campaign-771",
  conversationId: "fixture-conversation-42",
  ownerId: 48002,
  responderId: 48002,
  playerId: 48001,
  conversationEpoch: 3,
  logicalTurnEpoch: 19,
  sourceSnapshotId: "fixture-checkpoint-5"
});

function authorizedInputs({ duplicateHistoryRole = false } = {}) {
  const messages = [];
  const blocks = [];
  const add = (id, type, content, { role = "system", stable = false, lifecycle = null, semanticKind = null } = {}) => {
    const start = messages.length;
    messages.push({ role, content });
    blocks.push({ block: { id, type, label: `Synthetic ${id}`, role, stable, lifecycle, semanticKind }, content,
      tokens: Math.ceil(content.length / 5), messageSpan: { start, end: messages.length } });
  };

  // These are deliberately in legacy order. The V9 layout should promote only
  // explicitly static/frozen meanings, while custom runtime text remains fresh.
  add("custom-live-template", "custom", "CUSTOM_TEMPLATE_DYNAMIC|fixture", {
    stable: true, lifecycle: "GLOBAL_STATIC", semanticKind: "GLOBAL_STATIC"
  });
  add("conversation-history", "history", "HISTORY_USER_1|fixture", { role: "user" });
  if (duplicateHistoryRole) add("conversation-history-2", "history", "HISTORY_USER_2|fixture", { role: "user" });
  add("global-cache-anchor", "cache_anchor", "GLOBAL_STATIC|fixture", { stable: true });
  add("session-frozen", "session_context", "CONVERSATION_FROZEN|fixture", { lifecycle: "CONVERSATION_FROZEN" });
  add("responder-frozen", "memory_stable", "RESPONDER_FROZEN|fixture", { stable: true, lifecycle: "RESPONDER_FROZEN" });
  add("current-player-turn", "current_user", "CURRENT_TURN|fixture", { role: "user" });

  return { messages, blocks };
}

function makePlan({ mode = "v9", duplicateHistoryRole = false, scope = SCOPE } = {}) {
  return buildPromptPlanV9({
    authorizedInputs: authorizedInputs({ duplicateHistoryRole }),
    requestType: "chat",
    layoutId: "v813",
    promptProfileId: "synthetic-security-profile",
    scope: { ...scope },
    revisionSnapshot: {
      promptSettings: "fixture-prompt-r3",
      conversation: "fixture-conversation-r8",
      memory: "fixture-memory-r11",
      knowledge: "fixture-knowledge-r2",
      worldline: "fixture-worldline-r4",
      source: "fixture-source-r7"
    },
    providerConfig: { providerType: "synthetic", defaultModel: "synthetic-model" },
    promptSettings: { synthetic: true },
    mode,
    estimateTokens: text => Math.ceil(String(text).length / 5)
  });
}

function makeProof(options = {}) {
  const plan = makePlan(options);
  const serialized = serializePromptPlan(plan);
  return { plan, serialized, ownerEvidence: true };
}

function makeSnapshot(messages, { adapterInputMessagesFingerprint = fingerprintMessages(messages) } = {}) {
  return createEffectiveRequestSnapshot({
    requestType: "chat",
    providerType: "synthetic",
    protocol: "openai_chat_completions",
    endpoint: "https://provider.fixture.invalid/v1/chat/completions",
    method: "POST",
    stream: false,
    payload: { model: "synthetic-model", messages, stream: false, max_tokens: 128 },
    adapterInputMessagesFingerprint,
    planStatus: "PROMPT_PLAN_V9",
    ownerEvidence: "PRESENT"
  });
}

function resealPlan(plan) {
  plan.diagnostics.planFingerprint = planSeal(plan);
  return plan;
}

module.exports = { SCOPE, authorizedInputs, makePlan, makeProof, makeSnapshot, resealPlan };
