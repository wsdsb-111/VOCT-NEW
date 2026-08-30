"use strict";

const assert = require("assert");
const { LLMManager, TokenCounter } = require("../resources/app/out/main/provider-service");
const { createUsageAnalytics } = require("../resources/app/out/main/analytics/usage-analytics");
const retention = require("../resources/app/out/main/usage-analytics-retention");
const { buildStructuredResponseJsonSchema } = require("../resources/app/out/main/actions/schema");

let stored = null;
const memoryFs = {
  existsSync: () => stored !== null,
  readFileSync: () => stored,
  mkdirSync() {},
  writeFileSync: (_file, content) => { stored = content; }
};
const UsageAnalytics = createUsageAnalytics({
  fs: memoryFs,
  dataDir: "memory",
  analyticsFile: "memory/usage.json",
  retention,
  createPromptFingerprint: (value) => String(value || "").length.toString(16)
});
const analytics = new UsageAnalytics();
const requests = [];
const config = { providerType: "deepseek", defaultModel: "deepseek-v4-flash", defaultParameters: { temperature: 0.1, max_tokens: 512 }, useMinimizedActionsSchema: false, actionSchemaDeliveryMode: "optimized_local_validation", deepseekActionStablePrefixOptimization: false };
const manager = new LLMManager({
  settingsRepository: { getActionsProviderConfig: () => config },
  providerRegistry: {
    createProvider: () => ({
      async chatCompletion(request) {
        requests.push(request);
        return { content: '{"actions":[]}', usage: { prompt_tokens: 100, completion_tokens: 5, total_tokens: 105, prompt_cache_hit_tokens: 80, prompt_cache_miss_tokens: 20 } };
      }
    })
  },
  usageAnalytics: analytics,
  TokenCounter,
  PromptBuilder: {}
});

const messages = [
  { role: "system", content: "You are an action selection engine in a roleplay AI system." },
  { role: "system", content: "Recent messages:\nplayer: hello" },
  { role: "system", content: "Characters in this conversation (order matches CK3 global list):\n0: Player (id=1)" },
  { role: "system", content: "Available Actions:\n\nnoOp" },
  { role: "system", content: "Examples of correct JSON output:\n{\"actions\":[]}" },
  { role: "user", content: "Given everything above, select the actions (if any) that should be executed right now." }
];
const availableActions = [{
  signature: "changeOpinionOf",
  requiresTarget: true,
  validTargetCharacterIds: [1, 2, 3],
  args: [{ name: "value", type: "number", min: -100, max: 100, required: true }]
}, {
  signature: "setEmotion",
  requiresTarget: false,
  validTargetCharacterIds: [1, 2, 3],
  args: [{ name: "emotion", type: "enum", options: ["anger", "joy", "fear"], required: true }]
}];

(async () => {
  const fullSchema = buildStructuredResponseJsonSchema({ availableActions }, false);
  const minimizedSchema = buildStructuredResponseJsonSchema({ availableActions }, true);
  assert.notDeepStrictEqual(minimizedSchema, fullSchema, "official Schema variants must remain distinct");

  await manager.sendActionsRequest(messages, "votc_actions", fullSchema, null);
  assert.strictEqual(requests.length, 1);
  assert.strictEqual(requests[0].messages, messages, "analytics metadata must not change the official Action prompt");
  assert.strictEqual(requests[0].temperature, 0.1);
  assert.strictEqual(requests[0].max_tokens, 512);

  const [entry] = analytics.read().entries;
  const expectedBlockIds = [
    "action_system_intro",
    "action_recent_messages",
    "action_recent_actions",
    "action_roster",
    "action_available_actions",
    "action_provider_schema",
    "action_examples",
    "action_final_instruction"
  ];
  assert.deepStrictEqual(entry.blocks.map((block) => block.id), expectedBlockIds);
  assert.strictEqual(entry.blocks.find((block) => block.id === "action_recent_actions").tokens, 0, "omitted Recent actions remains an explicit zero-token block");
  assert.strictEqual(entry.blocks.reduce((sum, block) => sum + block.tokens, 0), entry.estimatedSerializedPromptTokens, "optimized Action block totals must exclude the non-serialized local schema");
  assert(entry.schemaTokenEstimate > 0, "the official Full Schema must remain measured locally");
  assert.strictEqual(entry.blocks.find((block) => block.id === "action_provider_schema").tokens, 0, "local-only schema must contribute zero provider input tokens");
  assert.strictEqual(entry.schemaCacheRole, "local_validation_only");
  assert.strictEqual(entry.actionSchemaDeliveryMode, "optimized_local_validation");
  const report = analytics.getReport();
  assert.strictEqual(report.blocks.filter((block) => block.key.startsWith("action_")).length, 8, "existing Usage Analytics must expose all Action blocks");
  console.log("VOTC v7.10-RC3 Action Token Metadata: PASS (8 blocks, local Full Schema fingerprint and provider serialization truth)");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
