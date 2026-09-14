"use strict";

const assert = require("assert");
const path = require("path");

const root = path.resolve(__dirname, "..");
const { createSettingsRepository } = require(path.join(root, "resources", "app", "out", "main", "config", "settings-repository.js"));

class Store {
  static stores = new Map();

  constructor({ name }) {
    this.name = name;
    this.path = `${name}.json`;
    if (!Store.stores.has(name)) Store.stores.set(name, {});
  }

  get store() {
    return Store.stores.get(this.name);
  }

  get(key, fallback) {
    return Object.prototype.hasOwnProperty.call(this.store, key) ? this.store[key] : fallback;
  }

  set(key, value) {
    this.store[key] = value;
  }
}

class SecureProviderSecrets {
  isAvailable() { return false; }
  hydrateSettings(settings) { return settings; }
  sealSettings(settings) { return settings; }
  migratePlaintextSettings(settings) { return { migrated: false, deferred: false, settings }; }
}

const providerTypes = ["player2", "openai-compatible", "deepseek", "zhipu"];
const defaultProviderConfigs = {
  player2: { apiKey: "player-key", baseUrl: "http://localhost:4315/v1", defaultModel: "player2-model", defaultParameters: { temperature: 0.7 } },
  "openai-compatible": { apiKey: "compatible-key", baseUrl: "https://compatible.example/v1", defaultModel: "old-compatible", defaultParameters: { temperature: 0.2, max_tokens: 2048 } },
  deepseek: { apiKey: "action-key", baseUrl: "https://api.deepseek.com", defaultModel: "deepseek-chat", defaultParameters: { temperature: 0.7 } },
  zhipu: { apiKey: "zhipu-key", baseUrl: "https://open.bigmodel.cn/api/paas/v4", defaultModel: "glm-old", defaultParameters: { temperature: 0.2, max_tokens: 4096 } }
};
const promptConfigManager = {
  getDefaultMainTemplateContent: () => "main",
  getDefaultLetterMainTemplateContent: () => "letter",
  getDefaultBlocks: () => [],
  getDefaultLetterBlocks: () => [],
  normalizeSettings: (settings) => settings
};
const SettingsRepository = createSettingsRepository({
  Store,
  schema: {},
  SecureProviderSecrets,
  electron: { safeStorage: {} },
  providerTypes,
  defaultProviderConfigs,
  defaultActiveProvider: "player2",
  promptConfigManager,
  logVerboseLLM: () => {},
  hashPromptAsset: () => "fixture",
  path,
  fs: { existsSync: () => false },
  promptsDir: "prompts",
  defaultPromptsDir: "defaults",
  defaultMainTemplatePath: "system/default.hbs",
  legacyBundledPromptHashes: {}
});

const repository = new SettingsRepository();
repository.setActionsProviderInstanceId("deepseek");
repository.setSummaryProviderInstanceId("deepseek");
const before = repository.getLLMSettings();
const result = repository.ensureV89ChatPresets();
const after = repository.getLLMSettings();

assert.strictEqual(result.success, true);
assert.strictEqual(after.activeProviderInstanceId, before.activeProviderInstanceId, "creating presets must not switch NPC Messages");
assert.strictEqual(after.actionsProviderInstanceId, before.actionsProviderInstanceId, "creating presets must not switch Actions");
assert.strictEqual(after.summaryProviderInstanceId, before.summaryProviderInstanceId, "creating presets must not switch Summaries");
const glm = repository.getProviderConfigById("v89-chat-glm53f-low");
assert.strictEqual(glm.providerType, "zhipu");
assert.strictEqual(glm.defaultModel, "glm-5.3-flash");
assert.strictEqual(glm.glmReasoningEffort, "low");
assert.strictEqual(glm.glmClearThinking, true);
assert.strictEqual(glm.customContextLength, 90000);
assert.strictEqual(glm.apiKey, "zhipu-key", "GLM preset must reuse the configured Zhipu credential");
const deepseek = repository.getProviderConfigById("v89-chat-dsv4f-0731");
assert.strictEqual(deepseek.providerType, "openai-compatible");
assert.strictEqual(deepseek.defaultModel, "deepseek-v4-flash-0731");
assert.strictEqual(deepseek.customContextLength, 90000);
assert.strictEqual(deepseek.apiKey, "compatible-key", "DeepSeek preset must reuse the configured OpenAI-compatible credential");
repository.ensureV89ChatPresets();
assert.strictEqual(repository.getLLMSettings().presets.filter((preset) => preset.instanceId.startsWith("v89-chat-")).length, 2, "preset creation must be idempotent");
assert.deepStrictEqual(repository.getChatPromptV89Settings(), {
  chatPromptV89Layout: true,
  chatPromptV89OutboundDiagnostics: true,
  chatPromptV89RuntimeProfileSplit: true
});

repository.saveChatPromptV89Settings({ chatPromptV89RuntimeProfileSplit: false });
assert.strictEqual(new SettingsRepository().getChatPromptV89Settings().chatPromptV89RuntimeProfileSplit, false, "explicit rollback must survive restart after the one-time v7 upgrade");

console.log("VOTC V8.9 provider presets: PASS (GLM/DeepSeek targets, credential reuse, idempotency, Action/Summary isolation)");
