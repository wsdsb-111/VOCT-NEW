"use strict";

const assert = require("node:assert/strict");
const {
  finalizePromptBuild,
  extendContinuationProof,
  preflightPromptPlan
} = require("../src/app/main/prompts/prompt-plan-compat");
const { serializePromptPlan } = require("../src/app/main/prompts/prompt-plan-serializer");
const { validatePromptPlan, planSeal } = require("../src/app/main/prompts/prompt-plan-contract");
const { createEffectiveRequestSnapshot, fingerprintMessages } = require("../src/app/main/providers/effective-request");
const { SCOPE, authorizedInputs, makeProof, makeSnapshot, resealPlan } = require("./fixtures/v9.4/prompt-plan-security-fixture");

function expectCode(action, code, label = code) {
  assert.throws(action, error => error?.code === code, `${label}: expected ${code}`);
}

function preflight(proof, overrides = {}) {
  const snapshot = overrides.snapshot || makeSnapshot(proof.serialized.messages);
  const expectedScope = overrides.expectedScope || SCOPE;
  return preflightPromptPlan({
    snapshot,
    proof,
    budget: overrides.budget || { safe: true },
    expectedScope,
    proofVerifier: Object.prototype.hasOwnProperty.call(overrides, "proofVerifier") ? overrides.proofVerifier : (() => true)
  });
}

function testPreSendScopeSealAndAuthority() {
  const proof = makeProof({ duplicateHistoryRole: true });
  const result = preflight(proof);
  assert.deepEqual(result, { ok: true, effectiveRequestFingerprint: makeSnapshot(proof.serialized.messages).effectiveRequestFingerprint });
  for (const key of ["ownerId", "campaignToken", "conversationId", "logicalTurnEpoch"]) {
    const expectedScope = { ...SCOPE, [key]: typeof SCOPE[key] === "number" ? SCOPE[key] + 1 : `${SCOPE[key]}-other` };
    expectCode(() => preflight(proof, { expectedScope }), "PLAN_SCOPE_MISMATCH", `scope_${key}_mismatch`);
  }

  let verifierCalls = 0;
  preflightPromptPlan({ snapshot: makeSnapshot(proof.serialized.messages), proof, budget: { safe: true }, expectedScope: SCOPE,
    proofVerifier: plan => { verifierCalls++; return plan.inputRevisions.source === "fixture-source-r7"; } });
  assert.equal(verifierCalls, 1, "the trusted source verifier rechecks each pre-send plan exactly once");

  const revoked = makeProof();
  expectCode(() => preflight(revoked, { proofVerifier: () => false }), "PLAN_SOURCE_REVOKED", "revoked_source_is_rejected");
  expectCode(() => preflight({ ...revoked, ownerEvidence: false }), "PLAN_SOURCE_PROOF_REQUIRED", "missing_owner_evidence_is_rejected");
  expectCode(() => preflight(revoked, { proofVerifier: undefined }), "PLAN_SOURCE_VERIFIER_REQUIRED", "missing_live_verifier_is_rejected");

  const tampered = makeProof();
  tampered.plan.scope.logicalTurnEpoch += 1;
  expectCode(() => preflight(tampered), "PLAN_CHANGED_BEFORE_SEND", "changed_plan_seal_is_rejected");
  assert.equal(tampered.plan.diagnostics.planFingerprint !== planSeal(tampered.plan), true,
    "the tamper fixture changes the sealed fields without refreshing the seal");

  for (const field of ["requestType", "providerRoute", "promptProfileId", "budget"]) {
    const changed = makeProof();
    if (field === "requestType") changed.plan.requestType = "action";
    else if (field === "providerRoute") changed.plan.providerRoute.modelId = "different-synthetic-model";
    else if (field === "promptProfileId") changed.plan.promptProfileId = "different-synthetic-profile";
    else changed.plan.budget.effectiveInputBudgetTokens = 1;
    expectCode(() => preflight(changed), "PLAN_CHANGED_BEFORE_SEND", `seal_covers_${field}`);
  }

  const staleAdapterInput = makeProof();
  const wrongSnapshot = makeSnapshot(staleAdapterInput.serialized.messages, { adapterInputMessagesFingerprint: "0".repeat(64) });
  expectCode(() => preflight(staleAdapterInput, { snapshot: wrongSnapshot }), "PLAN_EFFECTIVE_MESSAGES_CHANGED",
    "adapter-entry message fingerprint must match the Plan serialization");

  const changedSpan = makeProof();
  changedSpan.serialized.messageSpans[0].contributions[0].startOffset += 1;
  expectCode(() => preflight(changedSpan), "PLAN_EFFECTIVE_MESSAGES_CHANGED",
    "a caller cannot alter serialized message span evidence while retaining the Plan and request messages");

  const changedMetadata = makeProof();
  changedMetadata.serialized.blockMetadata[0].messageStartPosition += 1;
  expectCode(() => preflight(changedMetadata), "PLAN_EFFECTIVE_MESSAGES_CHANGED",
    "a caller cannot alter serialized block metadata while retaining the Plan and request messages");

  expectCode(() => preflight(makeProof(), { budget: { safe: false } }), "PROMPT_PLAN_INPUT_BUDGET_EXCEEDED",
    "unsafe final budget blocks the Plan");
}

function makeGeminiProof(modelId) {
  const proof = makeProof();
  proof.plan.providerRoute.providerType = "gemini";
  proof.plan.providerRoute.modelId = modelId;
  resealPlan(proof.plan);
  proof.serialized = serializePromptPlan(proof.plan);
  return proof;
}

function makeGeminiSnapshot(proof, modelId, operation) {
  const messages = proof.serialized.messages;
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:${operation}?key=fixture-key`;
  return createEffectiveRequestSnapshot({
    requestType: "chat",
    providerType: "gemini",
    protocol: "gemini_generate_content",
    method: "POST",
    endpoint,
    stream: operation === "streamGenerateContent",
    payload: {
      systemInstruction: { role: "user", parts: [{ text: "synthetic Gemini system instruction" }] },
      contents: [{ role: "user", parts: [{ text: "synthetic Gemini request body" }] }],
      generationConfig: { maxOutputTokens: 128 }
    },
    adapterInputMessagesFingerprint: fingerprintMessages(messages),
    planStatus: "PROMPT_PLAN_V9",
    ownerEvidence: "PRESENT"
  });
}

function testGeminiRouteModelBinding() {
  const effectiveModel = "fixture-gemini-effective-model";
  for (const operation of ["generateContent", "streamGenerateContent"]) {
    const proof = makeGeminiProof(effectiveModel);
    const snapshot = makeGeminiSnapshot(proof, effectiveModel, operation);
    assert.equal(snapshot.payload.model, undefined, "Gemini model selection is carried in the endpoint, not payload.model");
    assert.equal(preflight(proof, { snapshot }).ok, true,
      `${operation}: the endpoint model must match the authorized Plan route`);
  }

  const configuredDefault = "fixture-gemini-config-default";
  const overriddenEffectiveModel = "fixture-gemini-defaultParameters-override";
  const overridden = makeGeminiProof(configuredDefault);
  const snapshot = makeGeminiSnapshot(overridden, overriddenEffectiveModel, "generateContent");
  expectCode(() => preflight(overridden, { snapshot }), "PLAN_PROVIDER_ROUTE_CHANGED",
    "a Gemini defaultParameters.model override cannot diverge from the sealed Plan model");
}

function makeLegacyBuild(messages, blocks) {
  return { messages, blocks, promptProfile: { id: "synthetic-security-profile", layoutId: "v813" } };
}

function testLegacyCustomFallbackIsNarrow() {
  const options = {
    requestType: "chat",
    scope: { ...SCOPE },
    revisionSnapshot: { source: "fixture-source-r7" },
    providerConfig: { providerType: "synthetic", defaultModel: "synthetic-model" },
    promptSettings: { synthetic: true },
    mode: "v9"
  };
  const customOnly = makeLegacyBuild(
    [{ role: "legacy-invalid-role", content: "CUSTOM_UNREPRESENTABLE|fixture" }],
    [{ block: { id: "custom-script", type: "custom", role: "system", label: "Synthetic Custom" },
      content: "CUSTOM_UNREPRESENTABLE|fixture", tokens: 4, messageSpan: { start: 0, end: 1 } }]
  );
  const fallback = finalizePromptBuild(customOnly, options);
  assert.equal(fallback.promptPlanMode, "legacy");
  assert.equal(fallback.promptPlanStatus, "LEGACY_OBSERVED");
  assert.equal(fallback.promptPlanFallbackReason, "CUSTOM_LEGACY_MESSAGE_UNREPRESENTABLE");
  assert.deepEqual(fallback.messages, customOnly.messages,
    "an invalid message owned solely by a declared legacy custom block keeps the existing compatibility fallback");

  const mixed = makeLegacyBuild(
    [
      { role: "legacy-invalid-role", content: "CUSTOM_UNREPRESENTABLE|fixture" },
      { role: "legacy-invalid-role", content: "HISTORY_UNREPRESENTABLE|fixture" }
    ],
    [
      { block: { id: "custom-script", type: "custom", role: "system", label: "Synthetic Custom" },
        content: "CUSTOM_UNREPRESENTABLE|fixture", tokens: 4, messageSpan: { start: 0, end: 1 } },
      { block: { id: "history", type: "history", role: "user", label: "Synthetic History" },
        content: "HISTORY_UNREPRESENTABLE|fixture", tokens: 4, messageSpan: { start: 1, end: 2 } }
    ]
  );
  expectCode(() => finalizePromptBuild(mixed, options), "PLAN_BLOCK_ROLE_INVALID",
    "an invalid history message mixed with a custom-script message must not use the custom fallback");
}

function testSameTextCannotRestoreChangedSourceAuthority() {
  const original = makeProof();
  const changed = makeProof();
  changed.plan.inputRevisions.source = "fixture-source-r8";
  changed.plan.blocks.forEach(block => {
    if (block.permission.authorizedAtRevision === "fixture-source-r7") block.permission.authorizedAtRevision = "fixture-source-r8";
  });
  resealPlan(changed.plan);
  changed.serialized = serializePromptPlan(changed.plan);
  assert.deepEqual(changed.serialized.messages, original.serialized.messages,
    "a source-revision change can leave the prompt text byte-for-byte identical");
  assert.equal(changed.serialized.serializedFingerprint, original.serialized.serializedFingerprint,
    "identical messages retain the same serialized-message fingerprint");
  expectCode(() => preflight(changed, { proofVerifier: plan => plan.inputRevisions.source === "fixture-source-r7" }),
    "PLAN_SOURCE_REVOKED", "the live source verifier rejects same-text changed-source proof");
}

function testV9OrderingAndCustomTemplateLifecycle() {
  const { buildPromptPlanV9 } = require("../src/app/main/prompts/prompt-plan-builder");
  const authorized = authorizedInputs({ duplicateHistoryRole: true });
  const plan = buildPromptPlanV9({
    authorizedInputs: authorized,
    requestType: "chat",
    layoutId: "v813",
    promptProfileId: "synthetic-security-profile",
    scope: { ...SCOPE },
    revisionSnapshot: { source: "fixture-source-r7" },
    mode: "v9",
    estimateTokens: text => Math.ceil(String(text).length / 5)
  });
  const serialized = serializePromptPlan(plan);
  const kinds = plan.blocks.map(block => block.kind);
  assert.deepEqual(kinds.slice(0, 3), ["GLOBAL_STATIC", "CONVERSATION_FROZEN", "RESPONDER_FROZEN"],
    "explicit static and successfully frozen context precede append-only history");
  const firstDynamicIndex = kinds.findIndex(kind => ["DYNAMIC_WORLDLINE", "CURRENT_TURN", "QUERY_DYNAMIC_MEMORY"].includes(kind));
  assert(kinds.slice(3, firstDynamicIndex).every(kind => kind === "APPEND_ONLY_HISTORY"));
  assert(firstDynamicIndex > 3, "append-only history follows the frozen prefix");
  assert(kinds.slice(firstDynamicIndex).every(kind => ["DYNAMIC_WORLDLINE", "CURRENT_TURN"].includes(kind)),
    "fresh runtime and current-turn context follows history");
  const custom = plan.blocks.find(block => block.id === "custom-live-template");
  assert.equal(custom.kind, "DYNAMIC_WORLDLINE", "custom templates stay dynamic even if legacy metadata calls them stable/frozen");
  assert.equal(custom.lifecycle.state, "DYNAMIC");
  assert.equal(custom.cache.stableCandidate, false);
  const duplicateRoleBodies = serialized.messages.filter(message => message.role === "user").map(message => message.content);
  assert.deepEqual(duplicateRoleBodies, ["HISTORY_USER_1|fixture", "HISTORY_USER_2|fixture", "CURRENT_TURN|fixture"],
    "same-role messages remain separate physical messages in declared order");

  const legacyOrdered = buildPromptPlanV9({
    authorizedInputs: authorizedInputs(), requestType: "chat", layoutId: "v813", promptProfileId: "synthetic-security-profile",
    scope: { ...SCOPE }, revisionSnapshot: { source: "fixture-source-r7" }, mode: "legacy"
  });
  assert.equal(legacyOrdered.blocks[0].id, "custom-live-template", "legacy compatibility retains the old authorized block order");
  assert.equal(legacyOrdered.blocks[2].id, "global-cache-anchor");
}

function testSerializerSpanAndSharedMessageFailures() {
  const proof = makeProof();
  const missingPart = JSON.parse(JSON.stringify(proof.plan));
  missingPart.messageGroups = missingPart.messageGroups.slice(1);
  expectCode(() => serializePromptPlan(missingPart), "PLAN_MESSAGE_PART_UNCOVERED", "a missing block span is rejected");

  const duplicatePart = JSON.parse(JSON.stringify(proof.plan));
  duplicatePart.messageGroups.splice(1, 0, JSON.parse(JSON.stringify(duplicatePart.messageGroups[0])));
  expectCode(() => serializePromptPlan(duplicatePart), "PLAN_MESSAGE_PART_INVALID", "a duplicated span contribution is rejected");

  const shared = JSON.parse(JSON.stringify(proof.plan));
  const staticIndex = shared.blocks.findIndex(block => block.id === "global-cache-anchor");
  const frozenIndex = shared.blocks.findIndex(block => block.id === "session-frozen");
  const staticBlock = shared.blocks[staticIndex];
  const frozenBlock = shared.blocks[frozenIndex];
  const staticGroupIndex = shared.messageGroups.findIndex(group => group.parts[0]?.blockId === staticBlock.id);
  const frozenGroupIndex = shared.messageGroups.findIndex(group => group.parts[0]?.blockId === frozenBlock.id);
  shared.messageGroups.splice(Math.max(staticGroupIndex, frozenGroupIndex), 1);
  shared.messageGroups.splice(Math.min(staticGroupIndex, frozenGroupIndex), 1);
  shared.messageGroups.splice(Math.min(staticGroupIndex, frozenGroupIndex), 0, {
    parts: [{ blockId: staticBlock.id, index: 0 }, { blockId: frozenBlock.id, index: 0 }], separator: "\n<synthetic-boundary>\n"
  });
  const sharedOutput = serializePromptPlan(shared);
  const sharedPosition = sharedOutput.messages.findIndex(message => message.content.includes("GLOBAL_STATIC|fixture"));
  assert.equal(sharedOutput.messages[sharedPosition].content,
    "GLOBAL_STATIC|fixture\n<synthetic-boundary>\nCONVERSATION_FROZEN|fixture");
  assert.deepEqual(sharedOutput.messageSpans.find(span => span.blockId === frozenBlock.id).contributions[0], {
    messagePosition: sharedPosition,
    partIndex: 0,
    startOffset: "GLOBAL_STATIC|fixture\n<synthetic-boundary>\n".length,
    endOffset: "GLOBAL_STATIC|fixture\n<synthetic-boundary>\nCONVERSATION_FROZEN|fixture".length
  }, "shared physical messages preserve contribution offsets");

  const roleMismatch = JSON.parse(JSON.stringify(shared));
  const secondPart = roleMismatch.messageGroups.find(group => group.parts.length === 2).parts[1];
  const mismatched = roleMismatch.blocks.find(block => block.id === secondPart.blockId);
  mismatched.role = "assistant";
  mismatched.messages[0].role = "assistant";
  mismatched.cache.contentFingerprint = require("../src/app/main/prompts/prompt-plan-contract").fingerprint([
    mismatched.content, mismatched.messages
  ]);
  expectCode(() => serializePromptPlan(roleMismatch), "PLAN_SHARED_MESSAGE_ROLE_MISMATCH",
    "a shared physical message cannot combine different roles");
}

function testContinuationKeepsAuthorizedPrefixAndSources() {
  const proof = makeProof({ duplicateHistoryRole: true });
  const originalMessages = JSON.parse(JSON.stringify(proof.serialized.messages));
  const originalSources = JSON.stringify(proof.plan.blocks.map(block => ({ id: block.id,
    sourceRefs: block.permission.sourceRefs, authorizedAtRevision: block.permission.authorizedAtRevision })));
  const extra = { role: "user", content: "CONTINUATION_EXTRA_CURRENT_TURN|fixture" };
  const extended = extendContinuationProof(proof, [...originalMessages, extra], messages => messages.length * 3);
  assert.deepEqual(extended.serialized.messages.slice(0, originalMessages.length), originalMessages,
    "continuation preserves every original provider message exactly as-is");
  assert.deepEqual(extended.serialized.messages.at(-1), extra, "continuation appends the newly authorized turn message");
  assert.equal(extended.plan.blocks.at(-1).kind, "CURRENT_TURN");
  assert.equal(extended.plan.blocks.at(-1).lifecycle.state, "DYNAMIC");
  assert.equal(JSON.stringify(extended.plan.blocks.slice(0, -1).map(block => ({ id: block.id,
    sourceRefs: block.permission.sourceRefs, authorizedAtRevision: block.permission.authorizedAtRevision }))), originalSources,
  "continuation does not alter existing source references or their authorization revisions");
  validatePromptPlan(extended.plan, { phase: "PRE_SEND", proofVerifier: () => true });

  const changedPrefix = makeProof();
  const beforeFailure = JSON.stringify(changedPrefix);
  const altered = JSON.parse(JSON.stringify(changedPrefix.serialized.messages));
  altered[0].content += "|changed";
  expectCode(() => extendContinuationProof(changedPrefix, [...altered, extra], () => 3),
    "PLAN_CONTINUATION_PREFIX_CHANGED", "changed continuation prefix is rejected without fallback");
  assert.equal(JSON.stringify(changedPrefix), beforeFailure, "failed continuation validation leaves the original proof intact");
  expectCode(() => extendContinuationProof(changedPrefix, changedPrefix.serialized.messages, () => 3),
    "PLAN_CONTINUATION_PREFIX_CHANGED", "a continuation cannot silently reuse the original request after no new message");
}

function testMissingAuthoritativeSpanFailsClosed() {
  const authorized = authorizedInputs();
  delete authorized.blocks[0].messageSpan;
  expectCode(() => {
    const { buildPromptPlanV9 } = require("../src/app/main/prompts/prompt-plan-builder");
    return buildPromptPlanV9({ authorizedInputs: authorized, requestType: "chat", layoutId: "v813",
      promptProfileId: "synthetic-security-profile", scope: { ...SCOPE }, mode: "v9" });
  }, "PLAN_MESSAGE_SPAN_INVALID", "a prompt block without an authoritative span cannot become a Plan");
}

function run() {
  testPreSendScopeSealAndAuthority();
  testGeminiRouteModelBinding();
  testLegacyCustomFallbackIsNarrow();
  testSameTextCannotRestoreChangedSourceAuthority();
  testV9OrderingAndCustomTemplateLifecycle();
  testSerializerSpanAndSharedMessageFailures();
  testContinuationKeepsAuthorizedPrefixAndSources();
  testMissingAuthoritativeSpanFailsClosed();
  console.log("PASS V9.4 PromptPlan schema, source authority, layout order, spans, and continuation preservation");
}

if (require.main === module) run();
module.exports = { run };
