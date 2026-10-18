"use strict";

const assert = require("assert");
const path = require("path");

const root = path.resolve(__dirname, "..");
const {
  DEFAULT_CONTEXT_WINDOW,
  isValidContextLength,
  resolveContextMode,
  resolveProviderCapabilities,
  planRequestBudget,
  validateContextConfiguration
} = require(path.join(root, "src", "app", "main", "providers", "request-budget.js"));
const { capabilityCacheKey } = require(path.join(root, "src", "app", "main", "providers", "provider-capabilities.js"));
const { LLMManager } = require(path.join(root, "src", "app", "main", "provider-service.js"));
const { registerIpcHandlers } = require(path.join(root, "src", "app", "main", "ipc", "register-ipc.js"));
const { resolveMemoryBudget } = require(path.join(root, "src", "app", "main", "memory-system", "memory-budget-policy.js"));
const { createSettingsRepository } = require(path.join(root, "src", "app", "main", "config", "settings-repository.js"));

assert.strictEqual(DEFAULT_CONTEXT_WINDOW, 8192);
assert.strictEqual(resolveContextMode({}), "auto", "missing legacy custom value defaults to Auto");
assert.strictEqual(resolveContextMode({ customContextLength: null }), "auto", "null custom value is treated as Auto");
assert.strictEqual(resolveContextMode({ customContextLength: 90000 }), "custom", "legacy explicit 90K remains Custom");
assert.strictEqual(resolveContextMode({ contextMode: "auto", customContextLength: 90000 }), "auto", "an explicit Auto choice takes precedence over a retained old value");

for (const value of [256, 90000, 131072, 1048576, 2000000]) {
  assert.strictEqual(isValidContextLength(value), true, `${value} is a valid integer context setting`);
}
for (const value of [0, -1, "120000", 1.5, NaN, Infinity, 2000001, null]) {
  assert.strictEqual(isValidContextLength(value), false, `${String(value)} must fail strict context validation`);
}
assert.doesNotThrow(() => validateContextConfiguration({ customContextLength: 90000 }), "legacy explicit 90K settings remain valid");
assert.doesNotThrow(() => validateContextConfiguration({ contextMode: "auto", customContextLength: null }), "Auto with an empty retained custom value is valid");
for (const config of [
  { contextMode: "custom" },
  { contextMode: "custom", customContextLength: null },
  { contextMode: "custom", customContextLength: "120000" },
  { contextMode: "auto", customContextLength: 2000001 },
  { contextMode: "bogus", customContextLength: 90000 },
  null,
  []
]) {
  assert.throws(() => validateContextConfiguration(config), `invalid context config must be rejected: ${JSON.stringify(config)}`);
}

for (const contextLength of [131072, 262144, 1048576]) {
  const capabilities = resolveProviderCapabilities(
    { providerType: "openrouter", defaultModel: "model-a", contextMode: "auto" },
    { id: "model-a", contextLength, contextLengthSource: "provider_native" }
  );
  assert.strictEqual(capabilities.contextWindow, contextLength, "Auto must use native metadata above the old 90K limit");
  assert.strictEqual(capabilities.contextWindowSource, "provider_native");
}

const legacyMetadata = resolveProviderCapabilities(
  { providerType: "openrouter", defaultModel: "model-legacy", contextMode: "auto" },
  { id: "model-legacy", contextLength: 131072 }
);
assert.strictEqual(legacyMetadata.contextWindow, 131072, "legacy internal metadata without provenance remains compatible");
assert.strictEqual(legacyMetadata.contextWindowSource, "provider_metadata", "compatibility metadata is not labeled as native");

const legacy90k = resolveProviderCapabilities(
  { providerType: "zhipu", defaultModel: "glm-model", customContextLength: 90000 },
  null
);
assert.strictEqual(legacy90k.contextMode, "custom");
assert.strictEqual(legacy90k.contextWindow, 90000, "legacy explicit 90K must not be silently upgraded");
assert.strictEqual(legacy90k.contextWindowSource, "user_provided_unverified");

for (const invalidConfig of [
  { contextMode: "custom", customContextLength: 0 },
  { contextMode: "custom" },
  { contextMode: "custom", customContextLength: "120000" },
  { contextMode: "custom", customContextLength: 1.5 },
  { customContextLength: 0 },
  { customContextLength: "120000" },
  { contextMode: "bogus", customContextLength: 90000 },
  { contextMode: "auto", customContextLength: 0 }
]) {
  const fallback = resolveProviderCapabilities(
    { providerType: "openrouter", defaultModel: "model-large", ...invalidConfig },
    { id: "model-large", contextLength: 1048576, contextLengthSource: "provider_native" }
  );
  assert.strictEqual(fallback.contextWindow, 8192, "persisted invalid context settings must not silently upgrade to native capacity");
  assert.strictEqual(fallback.contextWindowSource, "invalid_configuration_fallback");
}
const invalidWithSmallerNative = resolveProviderCapabilities(
  { providerType: "openrouter", defaultModel: "model-small", contextMode: "custom", customContextLength: 0 },
  { id: "model-small", contextLength: 4096, contextLengthSource: "provider_native" }
);
assert.strictEqual(invalidWithSmallerNative.contextWindow, 4096, "invalid configuration fallback respects a smaller trusted native window");
assert.strictEqual(invalidWithSmallerNative.contextWindowSource, "invalid_configuration_fallback");
const invalidWholeConfig = resolveProviderCapabilities(
  null,
  { id: "model-large", contextLength: 1048576, contextLengthSource: "provider_native" }
);
assert.strictEqual(invalidWholeConfig.contextWindow, 8192, "a malformed persisted config also fails closed");
assert.strictEqual(invalidWholeConfig.contextWindowSource, "invalid_configuration_fallback");

const autoUnknown = resolveProviderCapabilities(
  { providerType: "openai-compatible", defaultModel: "unknown-model", contextMode: "auto", customContextLength: 90000 },
  { id: "unknown-model", contextLength: 1048576, contextLengthSource: "bundled_unverified" }
);
assert.strictEqual(autoUnknown.contextWindow, DEFAULT_CONTEXT_WINDOW, "unknown Auto capacity uses the conservative fallback");
assert.strictEqual(autoUnknown.contextWindowSource, "safe_fallback");

const userProvided = resolveProviderCapabilities(
  { providerType: "openai-compatible", defaultModel: "unknown-model", contextMode: "custom", customContextLength: 120000 },
  null
);
assert.strictEqual(userProvided.contextWindow, 120000, "Custom is allowed for generic endpoints without verified metadata");
assert.strictEqual(userProvided.contextWindowSource, "user_provided_unverified");

const nativeClamp = resolveProviderCapabilities(
  { providerType: "openrouter", defaultModel: "model-small", contextMode: "custom", customContextLength: 120000 },
  { id: "model-small", contextLength: 65536, contextLengthSource: "provider_native" }
);
assert.strictEqual(nativeClamp.contextWindow, 65536, "Custom cannot exceed a trusted provider-native maximum");
assert.strictEqual(nativeClamp.contextWindowSource, "provider_native_cap");

const mismatchedModel = resolveProviderCapabilities(
  { providerType: "openrouter", defaultModel: "model-a", contextMode: "auto" },
  { id: "model-b", contextLength: 1048576, contextLengthSource: "provider_native" }
);
assert.strictEqual(mismatchedModel.contextWindow, DEFAULT_CONTEXT_WINDOW, "metadata for another model must not affect the current model");
const forgedRendererMetadata = resolveProviderCapabilities(
  { providerType: "openai-compatible", defaultModel: "model-a", contextMode: "auto", modelNativeContext: 1048576 },
  null
);
assert.strictEqual(forgedRendererMetadata.contextWindow, DEFAULT_CONTEXT_WINDOW, "renderer config fields cannot forge native metadata");

const unsafePlan = planRequestBudget({
  messages: [{ role: "user", content: "fixture" }],
  capabilities: autoUnknown,
  requestedOutputTokens: 2048,
  countTokens: () => 10000
});
assert.strictEqual(unsafePlan.safe, false, "a prompt over Auto's effective fallback budget is rejected by the request planner");

const largeContextMemory = resolveMemoryBudget({
  participantCount: 4,
  contextWindowTokens: 1048576,
  providerHeadroomTokens: 1048576
});
assert.strictEqual(largeContextMemory.policyBudgetTokens, 96000, "1M context does not raise the current 4+ person memory cap");
assert.strictEqual(largeContextMemory.memoryBudgetTokens, 96000);

const settingsStores = new Map();
class FixtureStore {
  constructor({ name }) {
    this.name = name;
    this.path = `${name}.json`;
    if (!settingsStores.has(name)) settingsStores.set(name, {});
  }
  get store() { return settingsStores.get(this.name); }
  get(key, fallback) { return Object.prototype.hasOwnProperty.call(this.store, key) ? this.store[key] : fallback; }
  set(key, value) { this.store[key] = value; }
}
class FixtureProviderSecrets {
  isAvailable() { return false; }
  hydrateSettings(settings) { return settings; }
  sealSettings(settings) { return settings; }
}
const settingsRepositoryFactory = createSettingsRepository({
  Store: FixtureStore,
  schema: {},
  SecureProviderSecrets: FixtureProviderSecrets,
  electron: { safeStorage: {} },
  providerTypes: ["player2", "openai-compatible", "deepseek", "zhipu"],
  defaultProviderConfigs: {
    player2: { defaultModel: "player2-model" },
    "openai-compatible": { defaultModel: "compatible-model" },
    deepseek: { defaultModel: "deepseek-model" },
    zhipu: { defaultModel: "glm-model" }
  },
  defaultActiveProvider: "player2",
  promptConfigManager: {
    getDefaultMainTemplateContent: () => "main",
    getDefaultLetterMainTemplateContent: () => "letter",
    getDefaultBlocks: () => [],
    getDefaultLetterBlocks: () => [],
    normalizeSettings: (settings) => settings
  },
  logVerboseLLM: () => {},
  hashPromptAsset: () => "fixture",
  path,
  fs: { existsSync: () => false },
  promptsDir: "prompts",
  defaultPromptsDir: "defaults",
  defaultMainTemplatePath: "system/default.hbs",
  legacyBundledPromptHashes: {}
});
const settingsRepository = new settingsRepositoryFactory();
settingsRepository.ensureV89ChatPresets();
for (const id of ["v89-chat-glm53f-low", "v89-chat-dsv4f-0731"]) {
  const preset = settingsRepository.getProviderConfigById(id);
  assert.strictEqual(preset.customContextLength, 90000, `${id} keeps its historical explicit 90K limit`);
  assert.strictEqual(preset.contextMode, "custom", `${id} keeps explicit 90K semantics after base defaults move to Auto`);
}
assert.throws(() => settingsRepository.saveProviderConfig({ instanceId: "bad-custom", contextMode: "custom", customContextLength: null }), "settings persistence rejects an invalid Custom setting");
const emptyAutoConfig = { instanceId: "openai-compatible", providerType: "openai-compatible", contextMode: "auto", customContextLength: null };
const savedAutoConfig = settingsRepository.saveProviderConfig(emptyAutoConfig);
assert.strictEqual(Object.prototype.hasOwnProperty.call(savedAutoConfig, "customContextLength"), false,
  "Auto clears an empty Custom value before the persisted number schema sees it");
assert.strictEqual(emptyAutoConfig.customContextLength, null, "normalization does not mutate the caller config");

const baseCacheConfig = { instanceId: "fixture", providerType: "openrouter", defaultModel: "model-a", contextMode: "auto" };
assert.notStrictEqual(
  capabilityCacheKey(baseCacheConfig, "CHAT"),
  capabilityCacheKey({ ...baseCacheConfig, defaultModel: "model-b" }, "CHAT"),
  "model changes must invalidate capability cache keys"
);
assert.notStrictEqual(
  capabilityCacheKey(baseCacheConfig, "CHAT"),
  capabilityCacheKey({ ...baseCacheConfig, contextMode: "custom", customContextLength: 90000 }, "CHAT"),
  "Auto/Custom changes must invalidate capability cache keys"
);

const listCalls = [];
const manager = new LLMManager({
  settingsRepository: {},
  providerRegistry: {
    createProvider: (config) => ({
      listModels: async () => {
        listCalls.push(config.defaultModel);
        return [{ id: config.defaultModel, contextLength: config.defaultModel === "model-a" ? 131072 : 262144, contextLengthSource: "provider_native" }];
      }
    })
  }
});

(async () => {
  const modelA = await manager.getProviderCapabilities("CHAT", null, null, baseCacheConfig);
  const modelAAgain = await manager.getProviderCapabilities("CHAT", null, null, baseCacheConfig);
  const modelB = await manager.getProviderCapabilities("CHAT", null, null, { ...baseCacheConfig, defaultModel: "model-b" });
  assert.strictEqual(modelA.contextWindow, 131072);
  assert.strictEqual(modelAAgain.contextWindow, 131072);
  assert.strictEqual(modelB.contextWindow, 262144, "switching models recomputes the provider capability");
  assert.deepStrictEqual(listCalls, ["model-a", "model-b"], "same-model capability lookup is cached, model switch refreshes metadata");

  const handlers = new Map();
  const savedConfigs = [];
  let appliedContext = null;
  registerIpcHandlers({
    electron: { ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) } },
    settingsRepository: { saveProviderConfig: (config) => { savedConfigs.push(config); return config; } },
    llmManager: { setCustomContextLength: (value) => { appliedContext = value; } },
    conversationManager: { onConversationUpdate: () => {} }
  });

  const saveConfig = handlers.get("llm:saveProviderConfig");
  assert.throws(() => saveConfig(null, { contextMode: "custom", customContextLength: null }), "IPC rejects an invalid Custom config before persistence");
  assert.strictEqual(savedConfigs.length, 0, "invalid Custom config must not reach settings persistence");
  assert.throws(() => saveConfig(null, { contextMode: "auto", customContextLength: "120000" }), "IPC rejects a nonnumeric JSON custom setting");
  const oldExplicitConfig = { instanceId: "legacy", providerType: "zhipu", defaultModel: "glm-model", customContextLength: 90000 };
  assert.strictEqual(saveConfig(null, oldExplicitConfig), oldExplicitConfig, "IPC keeps a valid legacy config without contextMode");
  assert.strictEqual(savedConfigs.length, 1);

  const setContext = handlers.get("llm:setCustomContextLength");
  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    assert.throws(() => setContext(null, 0), "IPC rejects invalid numeric Custom input");
  } finally {
    console.error = originalConsoleError;
  }
  assert.strictEqual(appliedContext, null, "invalid IPC input must not reach the context setter");
  setContext(null, 90000);
  assert.strictEqual(appliedContext, 90000, "valid explicit 90K remains accepted by the setter IPC");

  console.log("V9.3.6.1 Context Auto/Custom, metadata, IPC and request-budget checks passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
