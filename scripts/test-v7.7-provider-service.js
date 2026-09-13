"use strict";

const assert = require("assert");
const path = require("path");

const root = path.resolve(__dirname, "..");
const { ProviderRegistry, TokenCounter, LLMManager } = require(path.join(root, "resources", "app", "out", "main", "provider-service.js"));
const { registerProviderImplementations, OpenRouterProvider, OpenAICompatibleProvider, Player2Provider, DeepseekProvider, GeminiProvider } = require(path.join(root, "resources", "app", "out", "main", "providers"));

const shippedRegistry = new ProviderRegistry();
registerProviderImplementations(shippedRegistry);
assert.deepStrictEqual(shippedRegistry.getRegisteredTypes(), [
  "openrouter",
  "openai-compatible",
  "zhipu",
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
  providerType: "deepseek",
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
    { requestType: "final_summary", character: "丙", maxTokens: 8192 }
  );
  await service.sendSummaryRequest(
    [{ role: "user", content: "摘要兜底" }],
    undefined,
    { requestType: "final_summary", character: "丙", summaryAttempt: 2, maxTokens: 8192 }
  );
  await service.sendSummaryRequest(
    [{ role: "user", content: "摘要恢复" }],
    undefined,
    { requestType: "memory_recovery", character: "丙", maxTokens: 2048 }
  );

  assert.strictEqual(calls.length, 5);
  const [chatCall, actionCall, summaryCall, fallbackSummaryCall, recoverySummaryCall] = calls;

  assert.strictEqual(chatCall.config, chatConfig, "chat must use the active conversation provider");
  assert.strictEqual(chatCall.request.model, "chat-model");
  assert.strictEqual(chatCall.request.stream, true);
  assert.deepStrictEqual(chatCall.request.thinking, { type: "enabled" });
  assert.strictEqual(chatCall.request.max_tokens, 4096);

  assert.strictEqual(actionCall.config, actionConfig, "actions must use the selected action provider");
  assert.strictEqual(actionCall.request.model, "action-model");
  assert.strictEqual(actionCall.request.stream, false);
  assert.strictEqual(actionCall.request.thinking, undefined, "action routing must not impose provider-specific thinking parameters");
  assert.strictEqual(actionCall.request.temperature, 0.8);
  assert.strictEqual(actionCall.request.max_tokens, 999);
  assert.strictEqual(actionCall.request.response_format.type, "json_schema");

  assert.strictEqual(summaryCall.config, summaryConfig, "summaries must use the selected summary provider");
  assert.strictEqual(summaryCall.request.model, "summary-model");
  assert.strictEqual(summaryCall.request.stream, false);
  assert.deepStrictEqual(summaryCall.request.thinking, { type: "disabled" }, "DeepSeek final summaries must disable thinking to protect structured output");
  assert.strictEqual(summaryCall.request.max_tokens, 8192, "final summaries must use the configured output token limit");
  assert.deepStrictEqual(summaryCall.request.response_format, { type: "json_object" });
  assert.strictEqual(summaryCall.request.messages[0].content, "prepared");
  assert.deepStrictEqual(fallbackSummaryCall.request.thinking, { type: "disabled" }, "final-summary retries must remain non-thinking");
  assert.strictEqual(fallbackSummaryCall.request.max_tokens, 8192, "final-summary retries must retain the configured output token limit");
  assert.deepStrictEqual(recoverySummaryCall.request.thinking, { type: "disabled" }, "memory recovery must remain deterministic and non-thinking");
  assert.strictEqual(recoverySummaryCall.request.max_tokens, 2048, "memory recovery must use the configured final-summary output token limit");

  assert.deepStrictEqual(usageRecords.map((entry) => entry.metadata.requestType), ["chat", "action", "final_summary", "final_summary", "memory_recovery"]);
  assert.deepStrictEqual(usageRecords.map((entry) => entry.metadata.providerType), ["deepseek", "openrouter", "deepseek", "deepseek", "deepseek"]);
  assert.deepStrictEqual(usageRecords.map((entry) => entry.metadata.model), ["chat-model", "action-model", "summary-model", "summary-model", "summary-model"]);
  assert(usageRecords.every((entry) => entry.usage.total_tokens === 15));

  const usageOnlyChunk = { id: "usage", choices: [], usage: { prompt_tokens: 7, completion_tokens: 2, total_tokens: 9 } };
  for (const Provider of [OpenRouterProvider, OpenAICompatibleProvider, Player2Provider, DeepseekProvider]) {
    const provider = new Provider();
    const openAIClient = { chat: { completions: { create: async () => (async function* () {
      yield { id: "stream", choices: [{ delta: { content: "ok" }, finish_reason: "stop" }] };
      yield usageOnlyChunk;
    })() } } };
    const iterator = provider._streamChatCompletion({ model: "fixture" }, openAIClient)[Symbol.asyncIterator]();
    let finalResponse;
    while (true) {
      const step = await iterator.next();
      if (step.done) { finalResponse = step.value; break; }
    }
    assert.deepStrictEqual(finalResponse.usage, usageOnlyChunk.usage, `${provider.providerId} must retain a final usage-only stream chunk`);
  }
  assert.deepStrictEqual(new GeminiProvider().parseGeminiStreamChunk({ responseId: "gemini", usageMetadata: { promptTokenCount: 8, candidatesTokenCount: 3, totalTokenCount: 11 } }).usage, { prompt_tokens: 8, completion_tokens: 3, total_tokens: 11 });

  const estimatedRecords = [];
  const estimateManager = new LLMManager({
    settingsRepository: { getActiveProviderConfig: () => ({ providerType: "openai-compatible", defaultModel: "fixture", defaultParameters: {} }), getGlobalStreamSetting: () => false },
    providerRegistry: { createProvider: () => ({ chatCompletion: async () => ({ content: "provider omitted usage" }) }) },
    usageAnalytics: { record: (metadata, usage) => estimatedRecords.push({ metadata, usage }) },
    TokenCounter,
    PromptBuilder: {}
  });
  await estimateManager.sendChatRequest([{ role: "user", content: "fixture prompt" }]);
  assert.strictEqual(estimatedRecords[0].usage.votc_estimated, true, "a provider without usage must still produce explicitly estimated token statistics");
  assert(estimatedRecords[0].usage.prompt_tokens > 0 && estimatedRecords[0].usage.completion_tokens > 0);

  assert.strictEqual(await service.getCurrentContextLength(), 131072);
  assert.deepStrictEqual(await service.testProviderConnection(), { success: true, providerType: "deepseek" });
  service.setCustomContextLength(64000);
  assert.strictEqual(savedConfigs[0].customContextLength, 64000);

  console.log("VOTC v7.7 Provider Service: PASS (chat/action/summary routing, parameters, usage and context settings)");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
