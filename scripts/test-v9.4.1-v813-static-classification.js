"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const { CASES, createFixture, createPromptRuntime } = require("./fixtures/v9.4/legacy-layout-fixtures");
const { buildPromptPlanV9 } = require("../src/app/main/prompts/prompt-plan-builder");
const { calculatePlanPrefix } = require("../src/app/main/prompts/prompt-plan-prefix");
const { preflightPromptPlan } = require("../src/app/main/prompts/prompt-plan-compat");
const { createEffectiveRequestSnapshot, fingerprintMessages } = require("../src/app/main/providers/effective-request");
const mainDir = path.resolve(__dirname, "../src/app/main");
let checks = 0;
function build(id, mode = "v9", mutate = () => {}) {
  const fixture = createFixture(id);
  mutate(fixture);
  const { PromptBuilder } = createPromptRuntime(mainDir, fixture);
  return PromptBuilder.buildMessagesWithTokenCount(fixture.history, fixture.responder, fixture.gameData,
    fixture.currentSessionSummary, fixture.memoryContext, fixture.definition.providerConfig, { promptPlanMode: mode });
}
function verifyHoist(result) {
  const expected = ["main-system-stable_global", "main-system-stable_history_rp"];
  const prefix = calculatePlanPrefix(result.promptPlan, result.serialized);
  const history = result.promptPlan.blocks.find(block => block.kind === "APPEND_ONLY_HISTORY");
  for (const id of expected) {
    const block = result.promptPlan.blocks.find(entry => entry.id === id);
    assert(block, `${id}: actual hoisted block exists`);
    assert.equal(block.kind, "GLOBAL_STATIC", `${id}: trusted V813 hoist must retain global static classification`);
    const span = result.serialized.messageSpans.find(entry => entry.blockId === id);
    assert(span.end <= prefix.messageCount, `${id}: physical messages belong to the continuous prefix`);
    if (history) assert(block.order < history.order, `${id}: static message precedes history`);
    assert.deepEqual(result.messages.slice(span.start, span.end), block.messages);
    assert(!block.content.includes("Lady Mira"));
  }
  assert(result.promptPlan.blocks.find(block => block.id.endsWith("stable_history_rp")).content.includes("【当前回应角色】"));
  assert.equal(prefix.source, "LOCAL_ESTIMATE");
  assert.equal(prefix.prefixFingerprint, result.promptPlanPrefix.prefixFingerprint);
  const prefixIds = new Set(result.serialized.messageSpans.filter(span => span.end <= prefix.messageCount && span.end > span.start).map(span => span.blockId));
  assert.equal(prefix.stablePrefixCandidateTokens, result.promptPlan.blocks.filter(block => prefixIds.has(block.id)).reduce((sum, block) => sum + block.tokens.estimated, 0));
  checks++;
}

// The first assertion fails on e6bdc71: these two hoisted blocks were DYNAMIC_WORLDLINE.
verifyHoist(build("v813-query-dynamic"));
for (const memory of ["absent", "normal", "long"]) {
  verifyHoist(build("v813-success-frozen", "v9", fixture => {
    if (memory === "absent") fixture.memoryContext = { conversationId: "v941-fixture", sourceCampaignToken: fixture.gameData.campaignToken };
    if (memory === "long") fixture.memoryContext.directStableText += "\n" + "SYNTHETIC LEGAL MEMORY ".repeat(600);
  }));
}
for (const id of ["v813-query-dynamic", "glm_cache_v2", "deepseek_v89-v6", "v5", "v6", "v7"]) {
  for (const variable of ["{{gameData.date}}", "{{unknown}}", "{{character.gold}}", "{{fullName}} {{gameData.scene}}", "{{character.shortName}}", "{{#if character}}private{{/if}}"]) {
    const result = build(id, "v9", fixture => {
    fixture.promptSettings.mainTemplate = `{{! VOTC_SEGMENT:stable_global }}UNSAFE_GLOBAL ${variable}\n{{! VOTC_SEGMENT:stable_history_rp }}UNSAFE_RP ${variable}`;
    });
    for (const block of result.promptPlan.blocks.filter(entry => ["main", "main_segment"].includes(entry.legacyType))) assert.notEqual(block.kind, "GLOBAL_STATIC", `${id}/${variable}`);
    checks++;
  }
}
for (const role of ["user", "assistant"]) {
  const result = build("glm_cache_v2", "v9", fixture => {
    fixture.promptSettings.blocks.find(block => block.type === "main").role = role;
  });
  assert(result.promptPlan.blocks.filter(block => block.legacyType === "main_segment").every(block => block.kind !== "GLOBAL_STATIC"));
  checks++;
}
const swapped = ["Mira", "Second Responder"].map(name => build("v813-query-dynamic", "v9", fixture => {
  fixture.responder.fullName = name;
  fixture.responder.shortName = name;
  fixture.gameData.date = name === "Mira" ? "1175.6.14" : "1175.6.15";
}));
assert.deepEqual(...swapped.map(result => result.promptPlan.blocks.filter(block => block.id.startsWith("main-system-stable_")).map(block => block.messages)));
for (const type of ["main", "main_segment", "custom", "description", "examples"]) {
  const message = { role: "system", content: "FORGED_PRIVATE_RUNTIME" };
  const plan = buildPromptPlanV9({ authorizedInputs: { messages: [message], blocks: [{ block: { id: "forged", type, stable: true, lifecycle: "GLOBAL_STATIC", semanticKind: "GLOBAL_STATIC" }, content: message.content, tokens: 5, messageSpan: { start: 0, end: 1 } }] }, layoutId: "v813", promptProfileId: "fixture", mode: "v9" });
  assert.equal(plan.blocks[0].kind, "DYNAMIC_WORLDLINE", `${type}: untrusted semanticKind must not promote a runtime definition`);
  checks++;
}
for (const definition of CASES) {
  const legacy = build(definition.id, "legacy");
  const shadow = build(definition.id, "shadow");
  const current = build(definition.id);
  assert.deepEqual(shadow.messages, legacy.messages);
  assert.deepEqual(current.messages.map(JSON.stringify).sort(), legacy.messages.map(JSON.stringify).sort());
  assert.equal(current.totalTokens, legacy.totalTokens);
  assert.deepEqual(current.messages[0], legacy.messages[0]);
  for (const entry of current.blocks) assert(["GLOBAL_STATIC", "CONVERSATION_FROZEN", "RESPONDER_FROZEN", "DYNAMIC"].includes(entry.block.lifecycle));
  const proof = { plan: current.promptPlan, serialized: current.serialized, ownerEvidence: true };
  for (const stream of [false, true]) {
    const snapshot = createEffectiveRequestSnapshot({ requestType: "chat", providerType: definition.providerConfig.providerType,
      protocol: "openai_chat_completions", endpoint: "https://fixture.invalid/chat/completions", stream,
      payload: { model: definition.providerConfig.defaultModel, messages: current.messages, stream, max_tokens: 256 }, adapterInputMessagesFingerprint: fingerprintMessages(current.messages) });
    assert(preflightPromptPlan({ snapshot, proof, budget: { safe: true }, expectedScope: current.promptPlan.scope, proofVerifier: () => true }).ok);
    assert.throws(() => preflightPromptPlan({ snapshot: { ...snapshot, adapterInputMessagesFingerprint: "changed" }, proof, budget: { safe: true }, proofVerifier: () => true }), error => error.code === "PLAN_EFFECTIVE_MESSAGES_CHANGED");
  }
  checks++;
}
console.log(`PASS V9.4.1 static classification (${checks} cases; trusted hoist, unsafe variables, responder swap, forged semantics, seven layouts and preflight)`);
