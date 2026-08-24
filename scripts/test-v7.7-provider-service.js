"use strict";

const assert = require("assert");
const path = require("path");

const root = path.resolve(__dirname, "..");
const { ProviderRegistry, TokenCounter, LLMManager } = require(path.join(root, "resources", "app", "out", "main", "provider-service.js"));
const { registerProviderImplementations } = require(path.join(root, "resources", "app", "out", "main", "providers"));

const shippedRegistry = new ProviderRegistry();
registerProviderImplementations(shippedRegistry);
assert.deepStrictEqual(shippedRegistry.getRegisteredTypes(), [
  "openrouter",
  "openai-compatible",
  "ollama",
  "player2",
  "deepseek",
  "gemini"
]);

const calls = [];
class CapturingProvider {
  async chatCompletion(request, config) {
    calls.push({ request, config });
    return {
      content: "ok",
      usage: { prompt_tokens: 12, completion_tokens: 3, total_tokens: 15 }
    };
  }
  async listModels(config) {
    return [{ id: config.defaultModel, contextLength: 131072 }];
  }
  async testConnection(config) {
    return { success: true, providerType: config.providerType };
  }
}

const chatConfig = {
  providerType: "deepseek",
  customName: "Chat Provider",
  defaultModel: "chat-model",
  defaultParameters: { temperature: 0.7 }
};
const actionConfig = {
  providerType: "openrouter",
  customName: "Action Provider",
  defaultModel: "action-model",
  defaultParameters: { temperature: 0.8, max_tokens: 999 }
};
const summaryConfig = {
  providerType: "gemini",
  customName: "Summary Provider",
  defaultModel: "summary-model",
  defaultParameters: { temperature: 0.4 }
};
const savedConfigs = [];
const settingsRepository = {
  getActiveProviderConfig: () => chatConfig,
  getActionsProviderConfig: () => actionConfig,
  getSummaryProviderConfig: () => summaryConfig,
  getGlobalStreamSetting: () => true,
  saveProviderConfig: (config) => savedConfigs.push(config)
};
const registry = new ProviderRegistry();
for (const providerType of ["deepseek", "openrouter", "gemini"]) {
  registry.register(providerType, CapturingProvider);
}
const usageRecords = [];
const usageAnalytics = {
  record(metadata, usage) {
    usageRecords.push({ metadata, usage });
  }
};
const PromptBuilder = {
  prepareSummaryMessages(messages) {
    return [{ role: "system", content: "prepared" }, ...messages];
  },
  getSummaryPromptBlocks() {
    return [{ id: "summary", label: "Summary", type: "summary", tokens: 1 }];
  }
};
const service = new LLMManager({
  settingsRepository,
  providerRegistry: registry,
  usageAnalytics,
  TokenCounter,
  PromptBuilder
});

(async () => {
  await service.sendChatRequest([{ role: "user", content: "你好" }], undefined, false, { character: "甲" });
  await service.sendActionsRequest(
    [{ role: "user", content: "动作" }],
    "action_selection",
    { type: "object", properties: {} },
    undefined,
    { character: "乙" }
  );
  await service.sendSummaryRequest(
    [{ role: "user", content: "摘要" }],
    undefined,
    { requestType: "final_summary", character: "丙" }
  );

  assert.strictEqual(calls.length, 3);
  const [chatCall, actionCall, summaryCall] = calls;

  assert.strictEqual(chatCall.config, chatConfig, "chat must use the active conversation provider");
  assert.strictEqual(chatCall.request.model, "chat-model");
  assert.strictEqual(chatCall.request.stream, true);
  assert.deepStrictEqual(chatCall.request.thinking, { type: "enabled" });
  assert.strictEqual(chatCall.request.max_tokens, 4096);

  assert.strictEqual(actionCall.config, actionConfig, "actions must use the selected action provider");
  assert.strictEqual(actionCall.request.model, "action-model");
  assert.strictEqual(actionCall.request.stream, false);
  assert.deepStrictEqual(actionCall.request.thinking, { type: "disabled" });
  assert.strictEqual(actionCall.request.max_tokens, 512);
  assert.strictEqual(actionCall.request.response_format.type, "json_schema");

  assert.strictEqual(summaryCall.config, summaryConfig, "summaries must use the selected summary provider");
  assert.strictEqual(summaryCall.request.model, "summary-model");
  assert.strictEqual(summaryCall.request.stream, false);
  assert.strictEqual(summaryCall.request.thinking, undefined, "non-DeepSeek structured summaries must not receive a provider-specific thinking parameter");
  assert.deepStrictEqual(summaryCall.request.response_format, { type: "json_object" });
  assert.strictEqual(summaryCall.request.messages[0].content, "prepared");

  assert.deepStrictEqual(usageRecords.map((entry) => entry.metadata.requestType), ["chat", "action", "final_summary"]);
  assert.deepStrictEqual(usageRecords.map((entry) => entry.metadata.providerType), ["deepseek", "openrouter", "gemini"]);
  assert.deepStrictEqual(usageRecords.map((entry) => entry.metadata.model), ["chat-model", "action-model", "summary-model"]);
  assert(usageRecords.every((entry) => entry.usage.total_tokens === 15));

  assert.strictEqual(await service.getCurrentContextLength(), 131072);
  assert.deepStrictEqual(await service.testProviderConnection(), { success: true, providerType: "deepseek" });
  service.setCustomContextLength(64000);
  assert.strictEqual(savedConfigs[0].customContextLength, 64000);

  console.log("VOTC v7.7 Provider Service: PASS (chat/action/summary routing, parameters, usage and context settings)");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
