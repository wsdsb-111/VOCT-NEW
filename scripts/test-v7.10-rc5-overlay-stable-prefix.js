"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { OVERLAY_CONTENT, OVERLAY_VERSION, prepareActionMessages } = require("../resources/app/out/main/actions/action-prompt-compatibility-overlay");
const { LLMManager, TokenCounter } = require("../resources/app/out/main/provider-service");
const { createUsageAnalytics } = require("../resources/app/out/main/analytics/usage-analytics");
const retention = require("../resources/app/out/main/usage-analytics-retention");

const officialMessages = [
  { role: "system", content: "You are an action selection engine in a roleplay AI system." },
  { role: "system", content: "Recent messages:\nplayer: completed event" },
  { role: "system", content: "Characters in this conversation (order matches CK3 global list):\n0: Player (id=1)" },
  { role: "system", content: "Available Actions:\n\nisInjured\ncharacterIsKilled" },
  { role: "system", content: "Examples of correct JSON output:\n{\"actions\":[]}" },
  { role: "user", content: "Given everything above, select the actions (if any) that should be executed right now." }
];

const stageA = prepareActionMessages(officialMessages, { overlayEnabled: false, stablePrefixEnabled: false });
assert.strictEqual(stageA.messages, officialMessages, "Stage A must preserve the official prompt object and order exactly");
assert.strictEqual(stageA.experimentStage, "A");
assert.strictEqual(stageA.overlayApplied, false);
assert.strictEqual(stageA.stablePrefixApplied, false);

const stageB = prepareActionMessages(officialMessages, { overlayEnabled: true, stablePrefixEnabled: false });
assert.strictEqual(stageB.experimentStage, "B");
assert.deepStrictEqual(stageB.blockMessages.map((message) => message.blockId), [
  "action_system_intro",
  "action_state_transition_rules",
  "action_recent_messages",
  "action_roster",
  "action_available_actions",
  "action_examples",
  "action_final_instruction"
]);

const stageC = prepareActionMessages(officialMessages, { overlayEnabled: true, stablePrefixEnabled: true });
assert.strictEqual(stageC.experimentStage, "C");
assert.strictEqual(stageC.stablePrefixApplied, true);
assert.deepStrictEqual(stageC.blockMessages.map((message) => message.blockId), [
  "action_system_intro",
  "action_state_transition_rules",
  "action_available_actions",
  "action_examples",
  "action_roster",
  "action_recent_messages",
  "action_final_instruction"
]);
assert(stageC.messages.every((message) => !("blockId" in message)), "blockId metadata must not be serialized to the provider");

const invalid = prepareActionMessages(officialMessages.slice(0, 5), { overlayEnabled: true, stablePrefixEnabled: true });
assert.strictEqual(invalid.stablePrefixApplied, false);
assert.strictEqual(invalid.overlayApplied, false);
assert.strictEqual(invalid.failureReason, "official_message_count_unverifiable");
assert.deepStrictEqual(invalid.messages, officialMessages.slice(0, 5), "invalid metadata must fail open to official order");
const swapped = [...officialMessages];
[swapped[2], swapped[3]] = [swapped[3], swapped[2]];
const unverifiableOrder = prepareActionMessages(swapped, { overlayEnabled: true, stablePrefixEnabled: true });
assert.strictEqual(unverifiableOrder.stablePrefixApplied, false);
assert.strictEqual(unverifiableOrder.failureReason, "official_message_contract_2_unverifiable");
assert.deepStrictEqual(unverifiableOrder.messages, swapped, "unverifiable official order must not be reordered");

assert.strictEqual(OVERLAY_VERSION, "state-transition-overlay/v1");
assert(TokenCounter.estimateTokens(OVERLAY_CONTENT) <= 450, "RC5 overlay must stay within the 450-token target");
assert(OVERLAY_CONTENT.includes('Ordinary punching or beating maps to injuryType "wounded"'));
assert(OVERLAY_CONTENT.includes("SOURCE = victim and TARGET = killer"));
assert(OVERLAY_CONTENT.includes("one sexual encounter alone do not establish these states"));
assert(OVERLAY_CONTENT.includes("threats, plans, commands, questions, attempts, misses, blocks, hypotheticals"));

let stored = null;
const memoryFs = {
  existsSync: () => stored !== null,
  readFileSync: () => stored,
  mkdirSync() {},
  writeFileSync: (_file, content) => { stored = content; }
};
const UsageAnalytics = createUsageAnalytics({ fs: memoryFs, dataDir: "memory", analyticsFile: "memory/usage.json", retention, createPromptFingerprint: (value) => String(value || "").length.toString(16) });
const analytics = new UsageAnalytics();
let serializedRequest = null;
const manager = new LLMManager({
  settingsRepository: { getActionsProviderConfig: () => ({ providerType: "deepseek", defaultModel: "deepseek-v4-flash", defaultParameters: {}, actionSchemaDeliveryMode: "optimized_local_validation", deepseekActionStateTransitionRecallOverlay: true, deepseekActionStablePrefixOptimization: true }) },
  providerRegistry: { createProvider: () => ({ async chatCompletion(request) { serializedRequest = request; return { content: '{"actions":[]}', usage: { prompt_tokens: 500, completion_tokens: 5, total_tokens: 505, prompt_cache_hit_tokens: 350, prompt_cache_miss_tokens: 150 } }; } }) },
  usageAnalytics: analytics,
  TokenCounter,
  PromptBuilder: {}
});

(async () => {
  await manager.sendActionsRequest(officialMessages, "votc_actions", { type: "object", properties: { actions: { type: "array" } }, required: ["actions"] });
  assert.deepStrictEqual(serializedRequest.messages.map((message) => message.content.split("\n")[0]), stageC.messages.map((message) => message.content.split("\n")[0]));
  const [entry] = analytics.read().entries;
  assert.strictEqual(entry.actionExperimentStage, "C");
  assert.strictEqual(entry.overlayApplied, true);
  assert.strictEqual(entry.overlayVersion, OVERLAY_VERSION);
  assert(entry.overlayTokenEstimate > 0 && entry.overlayTokenEstimate <= 450);
  assert.strictEqual(entry.stablePrefixApplied, true);
  assert.strictEqual(entry.stablePrefixFailureReason, null);
  assert.strictEqual(entry.providerSerializedOrder, "deepseek_intro_state_transition_rules_actions_examples_roster_recent_actions_recent_messages_final");
  assert.deepStrictEqual(entry.blocks.filter((block) => block.tokens > 0).map((block) => block.id), [
    "action_system_intro",
    "action_state_transition_rules",
    "action_available_actions",
    "action_examples",
    "action_roster",
    "action_recent_messages",
    "action_final_instruction"
  ]);
  const report = analytics.getReport();
  assert.strictEqual(report.actionExperiments.stages[0].stage, "C");
  assert.strictEqual(report.actionExperiments.stablePrefixApplied, 1);

  const root = path.resolve(__dirname, "..");
  const mainSource = fs.readFileSync(path.join(root, "resources/app/out/main/main.js"), "utf8");
  const settingsSource = fs.readFileSync(path.join(root, "resources/app/out/main/config/settings-repository.js"), "utf8");
  const rendererSource = fs.readFileSync(path.join(root, "resources/app/out/renderer/assets/index-Dn3qWlAB.js"), "utf8");
  assert(mainSource.includes("deepseekActionStateTransitionRecallOverlay: false"), "overlay must default off");
  assert(settingsSource.includes("deepseekActionStateTransitionRecallOverlay: config.deepseekActionStateTransitionRecallOverlay === true"), "overlay must require explicit opt-in");
  assert(rendererSource.includes("关键动作召回"));
  assert(rendererSource.includes("RC5 Action A/B/C 元数据"));
  assert(rendererSource.includes("可用但未选择不自动算 SELECTOR_MISS"));
  console.log("VOTC v7.10-RC5 Overlay/Stable Prefix: PASS (A/B/C isolation, <=450 tokens, blockId order, fail-open metadata, UI)");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
