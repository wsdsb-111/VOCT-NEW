"use strict";

const { buildPromptPlanV9 } = require("./prompt-plan-builder");
const { resolvePlanMode } = require("./prompt-plan-layouts");
const { serializePromptPlan } = require("./prompt-plan-serializer");
const { calculatePlanPrefix } = require("./prompt-plan-prefix");
const { requirePlan } = require("./prompt-plan-errors");
const { fingerprint, planSeal, validatePromptPlan, ROLES } = require("./prompt-plan-contract");
const { fingerprintMessages } = require("../providers/effective-request");

function finalizePromptBuild(legacyBuild, inputs) {
  const mode = resolvePlanMode(inputs.mode);
  let promptPlan, serialized;
  try {
    promptPlan = buildPromptPlanV9({ ...inputs, mode, authorizedInputs: legacyBuild,
      layoutId: legacyBuild.promptProfile.layoutId, promptProfileId: legacyBuild.promptProfile.id });
    serialized = serializePromptPlan(promptPlan);
  } catch (error) {
    // Unrepresentable legacy script messages keep the existing source guard and final provider budget.
    // Invalid scopes, revoked sources, duplicate IDs or missing spans never use this compatibility path.
    const invalidPositions = legacyBuild.messages.flatMap((message, index) =>
      !ROLES.includes(message?.role) || typeof message?.content !== "string" ? [index] : []);
    const onlyLegacyScriptMessages = invalidPositions.length > 0 && invalidPositions.every(index => legacyBuild.blocks.some(entry =>
      ["custom", "description", "examples"].includes(entry.block?.type) && entry.messageSpan
      && index >= entry.messageSpan.start && index < entry.messageSpan.end));
    if (!["PLAN_MESSAGE_INVALID", "PLAN_BLOCK_ROLE_INVALID"].includes(error.code) || !onlyLegacyScriptMessages) throw error;
    return { ...legacyBuild, promptPlanMode: "legacy", promptPlanStatus: "LEGACY_OBSERVED",
      promptPlanFallbackReason: "CUSTOM_LEGACY_MESSAGE_UNREPRESENTABLE" };
  }
  if (mode !== "v9") requirePlan(JSON.stringify(serialized.messages) === JSON.stringify(legacyBuild.messages), "PLAN_LEGACY_SHADOW_MISMATCH");
  const prefix = calculatePlanPrefix(promptPlan, serialized);
  const sourceById = new Map(legacyBuild.blocks.map(entry => [entry.block.id, entry]));
  const outputBlocks = promptPlan.blocks.map(block => ({ ...(sourceById.get(block.legacyBlockId) || {}),
    block: { ...(sourceById.get(block.legacyBlockId)?.block || {}), id: block.id, type: block.legacyType,
      stable: block.cache.stableCandidate,
      lifecycle: ["GLOBAL_STATIC", "CONVERSATION_FROZEN", "RESPONDER_FROZEN"].includes(block.kind) ? block.kind : "DYNAMIC",
      semanticKind: block.kind },
    content: block.content, tokens: block.tokens.estimated,
    messageSpan: { start: serialized.messageSpans.find(span => span.blockId === block.id).start,
      end: serialized.messageSpans.find(span => span.blockId === block.id).end } }));
  return { ...legacyBuild, ...(mode === "v9" ? {
    messages: serialized.messages, blocks: outputBlocks, staticTokens: prefix.stablePrefixCandidateTokens,
    actualStablePrefixTokens: prefix.stablePrefixCandidateTokens,
    globalStaticTokens: promptPlan.blocks.filter(block => block.kind === "GLOBAL_STATIC").reduce((sum, block) => sum + block.tokens.estimated, 0),
    conversationFrozenTokens: promptPlan.blocks.filter(block => block.kind === "CONVERSATION_FROZEN").reduce((sum, block) => sum + block.tokens.estimated, 0),
    responderFrozenTokens: promptPlan.blocks.filter(block => block.kind === "RESPONDER_FROZEN").reduce((sum, block) => sum + block.tokens.estimated, 0),
    declaredStaticTokens: promptPlan.blocks.filter(block => block.cache.stableCandidate).reduce((sum, block) => sum + block.tokens.estimated, 0),
    dynamicTokens: promptPlan.blocks.filter(block => !block.cache.stableCandidate).reduce((sum, block) => sum + block.tokens.estimated, 0),
    dynamicTailTokens: promptPlan.blocks.filter(block => !block.cache.stableCandidate).reduce((sum, block) => sum + block.tokens.estimated, 0)
  } : {}), promptPlan, serialized, messageSpans: serialized.messageSpans, promptPlanMode: mode, promptPlanPrefix: prefix };
}

function preflightPromptPlan({ snapshot, proof, budget, expectedScope, proofVerifier }) {
  requirePlan(proof?.plan && proof?.serialized && proof.ownerEvidence === true, "PLAN_SOURCE_PROOF_REQUIRED");
  validatePromptPlan(proof.plan, { phase: "PRE_SEND", proofVerifier });
  requirePlan(proof.plan.providerRoute.providerType === snapshot.providerType, "PLAN_PROVIDER_ROUTE_CHANGED");
  if (typeof snapshot.payload?.model === "string") requirePlan(proof.plan.providerRoute.modelId === snapshot.payload.model, "PLAN_PROVIDER_ROUTE_CHANGED");
  if (snapshot.providerType === "gemini") {
    let pathname = "";
    try { pathname = decodeURIComponent(new URL(snapshot.endpoint.display).pathname); } catch {}
    const modelPath = `/models/${proof.plan.providerRoute.modelId}`;
    requirePlan(pathname.endsWith(`${modelPath}:generateContent`) || pathname.endsWith(`${modelPath}:streamGenerateContent`), "PLAN_PROVIDER_ROUTE_CHANGED");
  }
  for (const [key, value] of Object.entries(expectedScope || {})) {
    requirePlan(proof.plan.scope[key] === value, "PLAN_SCOPE_MISMATCH");
  }
  const current = serializePromptPlan(proof.plan);
  requirePlan(current.serializedFingerprint === proof.serialized.serializedFingerprint
    && JSON.stringify(current.messages) === JSON.stringify(proof.serialized.messages)
    && JSON.stringify(current.messageSpans) === JSON.stringify(proof.serialized.messageSpans)
    && JSON.stringify(current.blockMetadata) === JSON.stringify(proof.serialized.blockMetadata)
    && fingerprintMessages(current.messages) === snapshot.adapterInputMessagesFingerprint, "PLAN_EFFECTIVE_MESSAGES_CHANGED");
  requirePlan(budget?.safe === true, "PROMPT_PLAN_INPUT_BUDGET_EXCEEDED");
  return { ok: true, effectiveRequestFingerprint: snapshot.effectiveRequestFingerprint };
}

// The existing bounded continuation coordinator is the sole caller. It supplies already-authorized extra turn messages.
function extendContinuationProof(proof, messages, estimateTokens) {
  const original = proof.serialized.messages;
  requirePlan(messages.length > original.length
    && JSON.stringify(messages.slice(0, original.length)) === JSON.stringify(original), "PLAN_CONTINUATION_PREFIX_CHANGED");
  const extra = messages.slice(original.length).map(message => ({ ...message }));
  const plan = { ...proof.plan, blocks: [...proof.plan.blocks], messageGroups: [...proof.plan.messageGroups] };
  const id = `continuation-current-turn-${plan.blocks.length}`;
  const content = extra.map(message => `${message.role}: ${message.content}`).join("\n\n");
  plan.blocks.push({ id, legacyBlockId: id, legacyType: "current_turn", kind: "CURRENT_TURN", role: extra[0].role,
    order: plan.blocks.length, content, messages: extra,
    permission: { status: "AUTHORIZED", ownerId: plan.scope.ownerId, campaignToken: plan.scope.campaignToken,
      sourceRefs: [fingerprint(["COORDINATOR_CONTINUATION", plan.planId])], authorizedAtRevision: plan.inputRevisions.source, visibility: "RESPONDER_ONLY" },
    lifecycle: { state: "DYNAMIC", freezeScope: "NONE", invalidationRevision: plan.inputRevisions.source },
    cache: { stableCandidate: false, prefixEligible: false, contentFingerprint: fingerprint([content, extra]) },
    tokens: { estimated: estimateTokens(extra), source: "LOCAL_ESTIMATE" } });
  extra.forEach((message, index) => plan.messageGroups.push({ parts: [{ blockId: id, index }], separator: "" }));
  plan.diagnostics = { ...plan.diagnostics, planFingerprint: planSeal(plan) };
  proof.plan = plan;
  proof.serialized = serializePromptPlan(plan);
  return proof;
}

module.exports = { finalizePromptBuild, preflightPromptPlan, extendContinuationProof };
