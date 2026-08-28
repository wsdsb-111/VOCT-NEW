"use strict";

const assert = require("assert");
const { LLMManager } = require("../resources/app/out/main/provider-service");
const { createUsageAnalytics } = require("../resources/app/out/main/analytics/usage-analytics");
const retention = require("../resources/app/out/main/usage-analytics-retention");

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
const config = { providerType: "deepseek", defaultModel: "deepseek-chat", defaultParameters: {}, customName: "DeepSeek" };
const manager = new LLMManager({
  settingsRepository: { getActionsProviderConfig: () => config },
  providerRegistry: {
    createProvider: () => ({
      async chatCompletion(request) {
        requests.push(request);
        return { content: '{"ok":true}', usage: { prompt_tokens: 100, completion_tokens: 5, total_tokens: 105, prompt_cache_hit_tokens: 80, prompt_cache_miss_tokens: 20 } };
      }
    })
  },
  usageAnalytics: analytics,
  TokenCounter: {
    calculateTotalTokens: (messages) => messages.reduce((sum, message) => sum + Math.ceil(message.content.length / 4), 0),
    estimateTokens: (value) => Math.ceil(String(value || "").length / 4)
  },
  PromptBuilder: {}
});

(async () => {
  const messages = [
    { role: "system", content: "stable" },
    { role: "user", content: "dynamic" }
  ];
  const schema = { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"] };
  await manager.sendActionsRequest(messages, "votc_social_consequence_v1", schema, null, {
    actionStage: "social_consequence_judge",
    actionSystemMode: "precision",
    blocks: messages.map((message, index) => ({ id: `message-${index}`, label: `Message ${index}`, type: "social_message", position: index, tokens: 2, content: message.content }))
  });
  assert.strictEqual(requests.length, 1);
  assert.strictEqual(requests[0].messages, messages, "provider request messages and response_format schema must remain separate at the service boundary");
  assert.strictEqual(requests[0].response_format.json_schema.name, "votc_social_consequence_v1");
  const [entry] = analytics.read().entries;
  assert(entry.schemaTokenEstimate > 0);
  assert(entry.schemaFingerprint);
  assert.strictEqual(entry.schemaCacheRole, "provider_injected_system_message");
  assert.strictEqual(entry.providerSerializedOrder, "messages_then_provider_injected_schema_then_response_format");
  assert.strictEqual(entry.blocks.some((block) => block.id === "social-schema" || block.type === "social_schema"), false, "schema must not be fabricated as a normal Social prompt block");
  assert(entry.estimatedSerializedPromptTokens > entry.estimatedPromptTokens, "DeepSeek provider-side schema injection must be represented separately in the serialized estimate");
  const report = analytics.getReport();
  assert.strictEqual(report.structuredSchemas.requests, 1);
  assert.strictEqual(report.structuredSchemas.schemaTokenEstimate, entry.schemaTokenEstimate);
  console.log("VOTC v7.9.2 structured schema analytics: PASS (schema tokens, fingerprint, cache role and serialized order)");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
