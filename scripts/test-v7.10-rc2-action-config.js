"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const normalizeEol = (text) => String(text || "").replace(/\r\n/g, "\n");
const readSource = (...segments) => normalizeEol(fs.readFileSync(path.join(root, ...segments), "utf8"));
const mainSource = readSource("resources", "app", "out", "main", "main.js");
const rendererSource = readSource("resources", "app", "out", "renderer", "assets", "index-Dn3qWlAB.js");
const actionEngineSource = readSource("resources", "app", "out", "main", "actions", "action-engine.js");
const settingsRepositorySource = readSource("resources", "app", "out", "main", "config", "settings-repository.js");
const providerServicePath = path.join(root, "resources", "app", "out", "main", "provider-service.js");
const providerServiceSource = normalizeEol(fs.readFileSync(providerServicePath, "utf8"));
const { LLMManager, TokenCounter } = require(providerServicePath);
const { createActionEngine } = require(path.join(root, "resources", "app", "out", "main", "actions", "action-engine"));
const { buildStructuredResponseJsonSchema, buildStructuredResponseSchema } = require(path.join(root, "resources", "app", "out", "main", "actions", "schema"));

const actionConfig = {
  instanceId: "deepseek-actions",
  providerType: "deepseek",
  customName: "DeepSeek Actions",
  defaultModel: "deepseek-v4-flash",
  defaultParameters: { temperature: 0.1, max_tokens: 512 },
  useMinimizedActionsSchema: false,
  actionSchemaDeliveryMode: "optimized_local_validation",
  deepseekActionStablePrefixOptimization: false
};
const chatConfig = {
  instanceId: "openrouter",
  providerType: "openrouter",
  defaultModel: "chat-model",
  defaultParameters: { temperature: 0.7, max_tokens: 2048 }
};
const summaryConfig = {
  instanceId: "openai-compatible",
  providerType: "openai-compatible",
  defaultModel: "summary-model",
  defaultParameters: { temperature: 0.4, max_tokens: 4096 }
};
const requests = [];
const provider = {
  async chatCompletion(request, config) {
    requests.push({ request, config });
    return { content: config === actionConfig ? '{"actions":[]}' : "ok", usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } };
  }
};
const manager = new LLMManager({
  settingsRepository: {
    getActiveProviderConfig: () => chatConfig,
    getActionsProviderConfig: () => actionConfig,
    getSummaryProviderConfig: () => summaryConfig,
    getGlobalStreamSetting: () => false
  },
  providerRegistry: { createProvider: () => provider },
  usageAnalytics: { record() {} },
  TokenCounter,
  PromptBuilder: { prepareSummaryMessages: (messages) => messages, getSummaryPromptBlocks: () => [] }
});

(async () => {
  assert.strictEqual(normalizeEol("first\r\nsecond\r\n"), "first\nsecond\n", "source assertions must be independent of Windows checkout EOL");
  await manager.sendChatRequest([{ role: "user", content: "chat" }], undefined, false);
  await manager.sendActionsRequest([{ role: "user", content: "action" }], "votc_actions", { type: "object", properties: {}, required: [] });
  await manager.sendSummaryRequest([{ role: "user", content: "summary" }]);

  const [chatRequest, actionRequest, summaryRequest] = requests;
  assert.strictEqual(chatRequest.config, chatConfig);
  assert.deepStrictEqual({ temperature: chatRequest.request.temperature, max_tokens: chatRequest.request.max_tokens }, chatConfig.defaultParameters, "Chat Provider defaults must remain independent");
  assert.strictEqual(actionRequest.config, actionConfig);
  assert.strictEqual(actionRequest.request.temperature, 0.1);
  assert.strictEqual(actionRequest.request.max_tokens, 512);
  assert.strictEqual(actionConfig.useMinimizedActionsSchema, false);
  assert.strictEqual(actionConfig.actionSchemaDeliveryMode, "optimized_local_validation");
  assert.strictEqual(actionConfig.deepseekActionStablePrefixOptimization, false);
  assert.strictEqual(summaryRequest.config, summaryConfig);
  assert.strictEqual(summaryRequest.request.temperature, summaryConfig.defaultParameters.temperature, "Summary Provider defaults must remain independent");

  assert(mainSource.includes('defaultModel: "deepseek-v4-flash"'));
  assert(mainSource.includes('defaultParameters: { temperature: 0.7, max_tokens: 2048 },\n    useMinimizedActionsSchema: false'), "DeepSeek base config must use the official Full Action schema without changing Chat defaults");
  assert(mainSource.includes('actionSchemaDeliveryMode: "optimized_local_validation"'), "DeepSeek must default to local-only Full Schema delivery for RC3");
  assert(mainSource.includes('deepseekActionStablePrefixOptimization: false'), "stable-prefix optimization must remain disabled before real A/B validation");
  assert(rendererSource.includes('useMinimizedActionsSchema: false'), "UI defaults must use the official Full Action schema for DeepSeek");
  assert(rendererSource.includes("RC3 仍构建官方 Full Schema，并在本地用于官方 ActionEngine 校验"), "Chinese UI must explain the RC3 Full Schema transport decision");
  assert(rendererSource.includes("须完成 50 次真实 A/B 后再启用"), "UI must disclose the stable-prefix real A/B gate");
  assert(!actionEngineSource.includes('actionsConfig?.providerType === "deepseek"'), "DeepSeek compatibility must not modify the official ActionEngine");
  assert(settingsRepositorySource.includes('useMinimizedActionsSchema: false'), "saved DeepSeek minimized settings must be normalized in the provider config layer");
  assert(settingsRepositorySource.includes('actionSchemaDeliveryMode: config.actionSchemaDeliveryMode || "optimized_local_validation"'), "saved DeepSeek settings must default to RC3 schema transport");
  assert(settingsRepositorySource.includes('deepseekActionStablePrefixOptimization: config.deepseekActionStablePrefixOptimization === true'), "stable-prefix must require explicit opt-in");
  const actionMethod = providerServiceSource.slice(providerServiceSource.indexOf("async sendActionsRequest"), providerServiceSource.indexOf("async sendSummaryRequest"));
  assert(!actionMethod.includes("temperature: 0.1") && !actionMethod.includes("max_tokens: 512"), "Action tuning must remain configuration-driven");
  let selectedSchema = null;
  const ActionEngine = createActionEngine({
    actionRegistry: {
      getAllActions: () => [{
        id: "noOp",
        definition: {
          check: async () => ({ canExecute: true, validTargetCharacterIds: [] }),
          args: [],
          description: "No operation"
        }
      }],
      registerValidation() {}
    },
    settingsRepository: {
      getLanguage: () => "en",
      getActionsProviderConfig: () => ({ ...actionConfig, useMinimizedActionsSchema: false }),
      getActionApprovalSettings: () => ({ approvalMode: "all" })
    },
    llmManager: {
      sendActionsRequest: async (_messages, _schemaName, jsonSchema) => {
        selectedSchema = jsonSchema;
        return { content: '{"actions":[]}' };
      }
    },
    ActionPromptBuilder: { buildActionMessages: () => [{ role: "user", content: "action" }] },
    ActionSandbox: {},
    ActionEffectWriter: {},
    buildStructuredResponseJsonSchema,
    buildStructuredResponseSchema,
    healJsonResponseWithLogging: JSON.parse,
    resolveI18nString: (value) => value,
    logVerboseLLM() {}
  });
  await ActionEngine.evaluateForCharacter({ gameData: { characters: new Map() } }, { id: 1, shortName: "NPC", fullName: "NPC" });
  const expectedFullSchema = buildStructuredResponseJsonSchema({ availableActions: [{ signature: "noOp", args: [], requiresTarget: false, validTargetCharacterIds: [], description: "No operation" }] }, false);
  assert.deepStrictEqual(selectedSchema, expectedFullSchema, "DeepSeek must use the official Full schema even if an old setting requests minimized");
  console.log("VOTC v7.10-RC3 Action Config: PASS (Full Schema local validation, deduplicated transport, stable-prefix opt-in, chat/summary isolation)");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
