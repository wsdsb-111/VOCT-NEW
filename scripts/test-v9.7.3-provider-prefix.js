"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const { createFixture, createPromptRuntime } = require("./fixtures/v9.4/legacy-layout-fixtures");
const { DeepseekProvider, OpenAICompatibleProvider, ZhipuProvider } = require("../resources/app/out/main/providers");
const { prepareGlmAppendLayout } = require("../src/app/main/prompts/glm-append-layout");
const mainDir = path.resolve(__dirname, "../src/app/main");
const routes = [["deepseek", "deepseek-v4-flash", DeepseekProvider],
  ["openai-compatible", "deepseek-v4-flash-0731", OpenAICompatibleProvider],
  ["zhipu", "glm-5.3-flash", ZhipuProvider]];
const multiset = messages => messages.map(message => JSON.stringify(message)).sort();

for (const [providerType, defaultModel, Provider] of routes) {
  const config = { providerType, defaultModel, glmClearThinking: true };
  const fixture = createFixture("v813-success-frozen");
  const runtime = createPromptRuntime(mainDir, fixture);
  const build = (mode = "v9") => runtime.PromptBuilder.buildMessagesWithTokenCount(fixture.history, fixture.responder,
    fixture.gameData, fixture.currentSessionSummary, fixture.memoryContext, config, { promptPlanMode: mode });
  assert.equal(build().promptPlan.layoutRevision, "v9_4_static_first_1", "speaker examples retain their original order");
  fixture.promptSettings.blocks.find(block => block.type === "examples").enabled = false;
  const first = build();
  const legacy = build("legacy");
  assert.equal(first.promptPlan.layoutRevision, providerType === "openai-compatible" ? "v9_7_3_compatible_history_prefix_2" : "v9_7_3_history_prefix_1");
  assert.deepEqual(multiset(first.messages), multiset(legacy.messages));
  const blocks = first.promptPlan.blocks;
  const input = blocks.findIndex(block => block.legacyType === "current_user");
  assert.equal(blocks[input - 1].kind, "APPEND_ONLY_HISTORY");
  assert(blocks.findIndex(block => block.id === "live-character-state") > input);
  assert(blocks.findIndex(block => block.legacyType === "instruction") > input);
  const provider = new Provider();
  const wire = current => provider.buildDiagnosticRequest({ model: defaultModel, stream: true, messages: current.messages }, config).messages;
  fixture.responder.gold = 222;
  fixture.history.push({ role: "assistant", content: "new reply" }, { role: "user", content: "next turn" });
  const second = build();
  const inputEnd = first.serialized.messageSpans.find(span => span.blockId === blocks[input].id).end;
  assert.deepEqual(wire(second).slice(0, inputEnd), wire(first).slice(0, inputEnd), "first real user message stays in the wire prefix despite live state change");
  assert.notDeepEqual(wire(second).slice(inputEnd), wire(first).slice(inputEnd));
  assert(second.messages.some(message => message.content.includes("222")), "live state stays current");
  if (providerType === "openai-compatible") {
    fixture.history.splice(0, fixture.history.length, { role: "user", content: "first player line" });
    const opening = build();
    const openingEnd = wire(opening).findIndex(message => message.content === "first player line") + 1;
    assert(openingEnd > 0 && openingEnd <= wire(opening).findIndex(message => message.content.includes("222")));
    assert.deepEqual(multiset(opening.messages), multiset(build("legacy").messages));
    fixture.responder.gold = 333;
    fixture.history.push({ role: "assistant", content: "opening reply" }, { role: "user", content: "second player line" });
    assert.deepEqual(wire(build()).slice(0, openingEnd), wire(opening).slice(0, openingEnd), "cold opening becomes reusable without rewriting player history");
  }
  if (providerType !== "zhipu") assert.equal(prepareGlmAppendLayout(second, config, null).receipt, null);
  fixture.promptSettings.blocks.find(block => block.type === "instruction").enabled = false;
  assert.equal(build().promptPlan.layoutRevision, "v9_4_static_first_1", "no reorder without a response instruction");
}

// Isolate GLM's tail-only change using the normal examples-inclusive layout.
const fixture = createFixture("v813-success-frozen");
const runtime = createPromptRuntime(mainDir, fixture);
const config = { providerType: "zhipu", defaultModel: "glm-5.3-flash", glmClearThinking: true };
const buildGlm = () => runtime.PromptBuilder.buildMessagesWithTokenCount(fixture.history, fixture.responder,
  fixture.gameData, fixture.currentSessionSummary, fixture.memoryContext, config);
const original = buildGlm();
const first = prepareGlmAppendLayout(original, config, null);
assert.strictEqual(first.build.serialized, original.serialized, "the initial request is not rebuilt a second time");
fixture.history.push({ role: "assistant", content: "reply" }, { role: "user", content: "latest input" });
// Change only the rendered tail; changing prompt settings would invalidate the receipt.
const canonical = buildGlm();
const { fingerprint, planSeal } = require("../src/app/main/prompts/prompt-plan-contract");
const { serializePromptPlan } = require("../src/app/main/prompts/prompt-plan-serializer");
const updatedSuffix = { role: "system", content: "updated suffix" };
const plan = { ...canonical.promptPlan, diagnostics: { ...canonical.promptPlan.diagnostics },
  blocks: canonical.promptPlan.blocks.map(block => block.id === "suffix"
    ? { ...block, content: updatedSuffix.content, messages: [updatedSuffix],
      cache: { ...block.cache, contentFingerprint: fingerprint([updatedSuffix.content, [updatedSuffix]]) } } : block) };
plan.diagnostics.planFingerprint = planSeal(plan);
const serialized = serializePromptPlan(plan);
const next = prepareGlmAppendLayout({ ...canonical, messages: serialized.messages, promptPlan: plan, serialized }, config, first.receipt);
assert.equal(next.build.glmAppendLayoutApplied, true);
assert.deepEqual(next.build.messages.at(-1), { role: "system", content: "updated suffix" });
assert.deepEqual(next.build.messages.slice(0, -first.receipt.tailCount).slice(0, first.build.messages.length - first.receipt.tailCount),
  first.build.messages.slice(0, -first.receipt.tailCount));
assert.deepEqual(multiset(next.build.messages), multiset(serialized.messages));
// V9.8.1's split profile layout is rolled back; GLM retains the V9.8.0 history-first request order.
const rollbackFixture = createFixture("v813-success-frozen");
const rollbackRuntime = createPromptRuntime(mainDir, rollbackFixture);
const rollbackDescription = rollbackFixture.promptSettings.blocks.find(block => block.type === "description");
rollbackDescription.id = "character-description";
rollbackDescription.scriptPath = path.resolve(__dirname, "../src/app/default_userdata/prompts/character_description/standard/pListMccTest2.js");
rollbackFixture.promptSettings.blocks.find(block => block.type === "examples").enabled = false;
const rollbackConfig = { providerType: "zhipu", defaultModel: "glm-5.3-flash", glmClearThinking: true };
const rolledBack = rollbackRuntime.PromptBuilder.buildMessagesWithTokenCount(rollbackFixture.history, rollbackFixture.responder,
  rollbackFixture.gameData, rollbackFixture.currentSessionSummary, rollbackFixture.memoryContext, rollbackConfig);
const rollbackBlocks = rolledBack.promptPlan.blocks;
const historyIndex = rollbackBlocks.findIndex(block => block.legacyType === "history");
const descriptionIndex = rollbackBlocks.findIndex(block => block.id === "character-description-live");
const responderFactsIndex = rollbackBlocks.findIndex(block => block.id === "responder-game-facts");
assert.equal(rolledBack.promptPlan.layoutRevision, "v9_7_3_history_prefix_1");
assert(!rollbackBlocks.some(block => ["glm-responder-profile", "glm-identity-rules"].includes(block.id)));
assert(historyIndex >= 0 && descriptionIndex > historyIndex && responderFactsIndex > historyIndex);
assert(rollbackBlocks[responderFactsIndex].content.includes("私下交谈和信件"));
assert(rollbackBlocks[responderFactsIndex].content.includes("只能引用本请求"));
console.log("PASS V9.8.0 GLM message order rollback and retained identity rules");

console.log("PASS V9.7.3 provider prefix: production builders/adapters, live-state breakpoints, legacy/custom fallback and GLM tail freshness");
