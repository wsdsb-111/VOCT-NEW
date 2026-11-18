"use strict";
const assert = require("node:assert/strict");
const path = require("node:path");
const crypto = require("node:crypto");
const { createFixture, createPromptRuntime } = require("./fixtures/v9.4/legacy-layout-fixtures");
const { prepareGlmAppendLayout, REVISION } = require("../src/app/main/prompts/glm-append-layout");
const { fingerprint, planSeal } = require("../src/app/main/prompts/prompt-plan-contract");
const { preflightPromptPlan } = require("../src/app/main/prompts/prompt-plan-compat");
const { fingerprintMessages } = require("../src/app/main/providers/effective-request");
const config = { providerType: "zhipu", defaultModel: "glm-5.3-flash", glmClearThinking: true };
const f = createFixture("v813-success-frozen");
const runtime = createPromptRuntime(path.resolve(__dirname, "../src/app/main"), f);
const build = () => runtime.PromptBuilder.buildMessagesWithTokenCount(f.history, f.responder, f.gameData,
  f.currentSessionSummary, f.memoryContext, config);
const first = prepareGlmAppendLayout(build(), config, null);
assert.equal(first.build.glmAppendLayoutApplied, false);
let previous = first;
for (let turn = 0; turn < 3; turn++) {
  f.history.push({ role: "assistant", content: `NPC REPLY ${turn}` }, { role: "user", content: `PLAYER TURN ${turn}` });
  const canonical = build();
  const next = prepareGlmAppendLayout(canonical, config, previous.receipt);
  assert.equal(next.build.glmAppendLayoutApplied, true);
  const reusableLength = previous.build.messages.length - previous.receipt.tailCount;
  assert.deepEqual(next.build.messages.slice(0, reusableLength), previous.build.messages.slice(0, reusableLength));
  assert.deepEqual(next.build.messages.slice(-previous.receipt.tailCount), canonical.messages.slice(-previous.receipt.tailCount), "response instruction and suffix remain last");
  assert.deepEqual(next.build.messages.map(fingerprint).sort(), canonical.messages.map(fingerprint).sort(), "no message added, omitted, edited or role changed");
  assert.equal(next.build.totalTokens, canonical.totalTokens);
  assert(next.build.promptPlan.blocks.every((block, index) => block === canonical.promptPlan.blocks[index]), "source-bound blocks are not cloned or re-authorized");
  assert.equal(next.build.promptPlan.layoutRevision, REVISION);
  const proof = { plan: next.build.promptPlan, serialized: next.build.serialized, ownerEvidence: true };
  const snapshot = { providerType: "zhipu", payload: { model: config.defaultModel }, adapterInputMessagesFingerprint: fingerprintMessages(next.build.messages) };
  assert.equal(preflightPromptPlan({ snapshot, proof, budget: { safe: true }, proofVerifier: () => true }).ok, true);
  assert.throws(() => preflightPromptPlan({ snapshot, proof, budget: { safe: true }, proofVerifier: () => false }), /PLAN_SOURCE_REVOKED/);
  for (const span of next.build.serialized.messageSpans) {
    const metadata = next.build.serialized.blockMetadata.find(block => block.id === span.blockId);
    const positions = [...new Set(span.contributions.map(part => part.messagePosition))];
    assert.equal(metadata.messageCount, positions.length);
    if (metadata.messagePositions) assert.deepEqual(metadata.messagePositions, positions);
  }
  assert(next.build.serialized.blockMetadata.some(block => block.messagePositions), "discontiguous history has explicit positions");
  previous = next;
}
assert(!JSON.stringify(previous.receipt).includes("NPC REPLY"), "receipts cannot retain prompt bodies");
assert.equal(prepareGlmAppendLayout(build(), config, previous.receipt).build.glmAppendLayoutApplied, false, "regeneration without history growth cannot reuse");
f.history.push({ role: "assistant", content: "NEXT REPLY" }, { role: "user", content: "NEXT TURN" });
const canonical = build();
const fallback = (candidate, route = config, receipt = previous.receipt, options) => {
  const result = prepareGlmAppendLayout(candidate, route, receipt, options);
  assert.notEqual(result.build.glmAppendLayoutApplied, true);
  assert.deepEqual(result.build.messages, candidate.messages);
};
fallback(canonical, { ...config, providerType: "openrouter" });
fallback(canonical, { ...config, defaultModel: "different-glm" });
fallback(canonical, { ...config, glmClearThinking: false });
fallback({ ...canonical, promptProfile: { ...canonical.promptProfile, adapterEnabled: false } });
fallback(canonical, config, previous.receipt, { disabled: true });
fallback(canonical, config, { ...previous.receipt, orderRefs: previous.receipt.orderRefs.map(() => "h:0") });
fallback(canonical, config, { ...previous.receipt, wireHashes: previous.receipt.wireHashes.map(() => "changed") });
for (const [section, keys] of [["scope", ["conversationId", "playerId", "conversationEpoch", "sourceSnapshotId"]],
  ["inputRevisions", ["promptSettings", "source", "memory", "knowledge", "worldline"]]]) {
  for (const key of keys) {
    const plan = { ...canonical.promptPlan, [section]: { ...canonical.promptPlan[section], [key]: "changed" }, diagnostics: { ...canonical.promptPlan.diagnostics } };
    plan.diagnostics.planFingerprint = planSeal(plan);
    fallback({ ...canonical, promptPlan: plan });
  }
}
assert.throws(() => prepareGlmAppendLayout({ ...canonical, promptPlan: { ...canonical.promptPlan,
  scope: { ...canonical.promptPlan.scope, campaignToken: "wrong-campaign" } } }, config, previous.receipt), /PLAN_SCOPE_MISMATCH/);
f.responder.gold = 999;
const changedState = build();
fallback(changedState);
assert(changedState.messages.some(message => message.content.includes("999")), "current state stays live");
f.responder.gold = 123;
f.history[0].content = "EDITED HISTORY";
fallback(build());
(async () => {
  const { Conversation } = require("../src/app/main/conversation/conversation");
  const { ProviderRegistry, LLMManager } = require("../src/app/main/provider-service");
  Conversation.configure({ createPromptFingerprint: text => crypto.createHash("sha256").update(String(text)).digest("hex").slice(0, 16) });
  const metadata = Conversation.buildPromptBlockMetadata(previous.build);
  let transports = 0;
  class FixtureProvider {
    async listModels() { return [{ id: config.defaultModel, contextLength: 90000, contextLengthSource: "provider_native" }]; }
    async chatCompletion(_request, _config, control) { control.beforeSend(); transports++; return { content: "OK", finish_reason: "stop" }; }
  }
  const registry = new ProviderRegistry();
  registry.register("zhipu", FixtureProvider);
  const manager = new LLMManager({ providerRegistry: registry, TokenCounter: runtime.TokenCounter, PromptBuilder: {}, usageAnalytics: { record() {} },
    settingsRepository: { getActiveProviderConfig: () => ({ ...config, defaultParameters: { max_tokens: 128 } }),
      getGlobalStreamSetting: () => false, getChatPromptV89Settings: () => ({ chatPromptV89OutboundDiagnostics: false }) } });
  const requestMetadata = { requestType: "chat", memoryBudgetTokens: 10000,
    renderedMemoryTokens: runtime.PromptBuilder.getMemoryBlockTokenCount(previous.build), blocks: metadata.blocks };
  await manager.sendChatRequest(previous.build.messages, null, true, requestMetadata);
  assert.equal(transports, 1, "noncontiguous history must pass the real memory budget guard without overlap");
  const index = metadata.blocks.findIndex(block => block.messagePositions);
  for (const positions of [[0], [metadata.blocks[index].messageStartPosition, metadata.blocks[index].messageStartPosition],
    [...metadata.blocks[index].messagePositions].reverse()]) {
    const bad = metadata.blocks.map((block, position) => position === index ? { ...block, messagePositions: positions } : block);
    await assert.rejects(manager.sendChatRequest(previous.build.messages, null, true, { ...requestMetadata, blocks: bad }), /chat_memory_budget_block_mapping_invalid/);
  }
  assert.equal(transports, 1, "invalid positions must fail before transport");
  console.log("PASS V9.7.2 GLM append layout: exact permutation, stable sent prefix, source proofs, live-state/scope/edit fallbacks and real memory-budget mapping guards");
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
