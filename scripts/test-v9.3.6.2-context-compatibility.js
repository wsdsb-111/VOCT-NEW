"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const mainSource = fs.readFileSync(path.join(root, "src", "app", "main", "main.js"), "utf8");
const rendererSource = fs.readFileSync(path.join(root, "src", "app", "renderer", "assets", "index-Dn3qWlAB.js"), "utf8");
const zhLocale = fs.readFileSync(path.join(root, "src", "app", "renderer", "v95", "i18n", "locales", "zh-CN.js"), "utf8");
const enLocale = fs.readFileSync(path.join(root, "src", "app", "renderer", "v95", "i18n", "locales", "en-US.js"), "utf8");
const {
  DEFAULT_CONTEXT_WINDOW,
  planRequestBudget,
  resolveContextMode,
  resolveProviderCapabilities
} = require(path.join(root, "src", "app", "main", "providers", "request-budget.js"));
const { registerIpcHandlers } = require(path.join(root, "src", "app", "main", "ipc", "register-ipc.js"));
const { createSettingsRepository } = require(path.join(root, "src", "app", "main", "config", "settings-repository.js"));

const zhipuDefault = mainSource.match(/zhipu:\s*\{([\s\S]*?)\r?\n  \}\r?\n};/);
assert(zhipuDefault, "the bundled Zhipu base config must remain explicit");
assert.ok(/contextMode:\s*"custom"/.test(zhipuDefault[1]), "new GLM defaults to an explicit Custom compatibility setting");
assert.ok(/customContextLength:\s*90000/.test(zhipuDefault[1]), "new GLM defaults to the 90K compatibility value");
const rendererZhipuDefault = rendererSource.match(/zhipu:\s*\{([\s\S]*?)\r?\n  \}\r?\n};/);
assert(rendererZhipuDefault, "the Renderer fallback Zhipu config must remain explicit");
assert.ok(/contextMode:\s*"custom"/.test(rendererZhipuDefault[1]), "Renderer fallback defaults new GLM to Custom");
assert.ok(/customContextLength:\s*90000/.test(rendererZhipuDefault[1]), "Renderer fallback defaults new GLM to 90K");

function createSettingsFixture(initialProviders = []) {
  const stores = new Map([[
    "votc-llm-config",
    { llmSettings: { providers: initialProviders, presets: [], activeProviderInstanceId: "zhipu" } }
  ]]);
  class FixtureStore {
    constructor({ name }) {
      this.name = name;
      this.path = `${name}.json`;
      if (!stores.has(name)) stores.set(name, {});
    }
    get store() { return stores.get(this.name); }
    get(key, fallback) { return Object.prototype.hasOwnProperty.call(this.store, key) ? this.store[key] : fallback; }
    set(key, value) { this.store[key] = value; }
  }
  class FixtureProviderSecrets {
    isAvailable() { return false; }
    hydrateSettings(settings) { return settings; }
    sealSettings(settings) { return settings; }
  }
  const factory = createSettingsRepository({
    Store: FixtureStore,
    schema: {},
    SecureProviderSecrets: FixtureProviderSecrets,
    electron: { safeStorage: {} },
    providerTypes: ["player2", "openai-compatible", "deepseek", "zhipu"],
    defaultProviderConfigs: {
      player2: { defaultModel: "player2-model" },
      "openai-compatible": { defaultModel: "compatible-model" },
      deepseek: { defaultModel: "deepseek-model" },
      zhipu: { defaultModel: "glm-5.3-flash", contextMode: "custom", customContextLength: 90000 }
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
  return new factory();
}

const newProviderDefaults = createSettingsFixture().getLLMSettings().providers.find((provider) => provider.instanceId === "zhipu");
assert.strictEqual(newProviderDefaults.contextMode, "custom", "a missing GLM instance receives the new compatibility default");
assert.strictEqual(newProviderDefaults.customContextLength, 90000);
const existingAutoDefaults = createSettingsFixture([{
  instanceId: "zhipu",
  providerType: "zhipu",
  defaultModel: "glm-legacy",
  contextMode: "auto"
}]).getLLMSettings().providers.find((provider) => provider.instanceId === "zhipu");
assert.strictEqual(existingAutoDefaults.contextMode, "auto", "initializing defaults does not rewrite an existing Auto choice");
assert.strictEqual(existingAutoDefaults.customContextLength, undefined, "old Auto data is not filled with the 90K value");

const legacyAuto = { providerType: "zhipu", defaultModel: "glm-legacy", contextMode: "auto" };
assert.strictEqual(resolveContextMode(legacyAuto), "auto", "existing Auto remains Auto");
const autoCapabilities = resolveProviderCapabilities(legacyAuto, null);
assert.strictEqual(autoCapabilities.contextWindow, DEFAULT_CONTEXT_WINDOW, "unknown legacy Auto keeps the conservative 8K fallback");
assert.strictEqual(autoCapabilities.contextWindowSource, "safe_fallback", "8K fallback is not presented as native capability");

const compatibilityDefault = { providerType: "zhipu", defaultModel: "glm-5.3-flash", contextMode: "custom", customContextLength: 90000 };
const compatibilityCapabilities = resolveProviderCapabilities(compatibilityDefault, null);
assert.strictEqual(compatibilityCapabilities.contextWindow, 90000, "the explicit GLM compatibility setting is effective when native capacity is unknown");
assert.strictEqual(compatibilityCapabilities.contextWindowSource, "user_provided_unverified", "90K remains explicitly unverified");

for (const customContextLength of [120000, 1048576]) {
  const capabilities = resolveProviderCapabilities({ ...compatibilityDefault, customContextLength }, null);
  assert.strictEqual(capabilities.contextWindow, customContextLength, "valid Custom values above 90K remain available");
}
const nativeCapped = resolveProviderCapabilities(
  { ...compatibilityDefault, customContextLength: 120000 },
  { id: compatibilityDefault.defaultModel, contextLength: 65536, contextLengthSource: "provider_native" }
);
assert.strictEqual(nativeCapped.contextWindow, 65536, "a verified native capability still caps Custom");
assert.strictEqual(nativeCapped.contextWindowSource, "provider_native_cap");

const malformed = resolveProviderCapabilities(
  { providerType: "zhipu", defaultModel: "glm-bad", contextMode: "custom", customContextLength: 0 },
  { id: "glm-bad", contextLength: 1048576, contextLengthSource: "provider_native" }
);
assert.strictEqual(malformed.contextWindow, DEFAULT_CONTEXT_WINDOW, "bad persisted context config falls back safely");
assert.strictEqual(malformed.contextWindowSource, "invalid_configuration_fallback");

const tinyCapabilities = resolveProviderCapabilities(
  { providerType: "zhipu", defaultModel: "glm-tiny", contextMode: "custom", customContextLength: 256 },
  null
);
const tinyBudget = planRequestBudget({
  messages: [{ role: "user", content: "fixture" }],
  capabilities: tinyCapabilities,
  requestedOutputTokens: tinyCapabilities.maxOutputTokens,
  countTokens: () => 1
});
assert.strictEqual(tinyBudget.reservedOutputTokens, 256, "tiny Custom leaves its output reserve visible to the planner");
assert.strictEqual(tinyBudget.outputReserveTokens, 256, "the planner exposes output reserve for diagnostics");
assert.strictEqual(tinyBudget.effectiveInputBudget, 0, "a 256-token window has no usable input after reserve and overhead");
assert.strictEqual(tinyBudget.usableInputBudget, 0, "the planner exposes zero usable input for the settings UI");
assert.strictEqual(tinyBudget.budgetStatus, "NO_USABLE_INPUT", "the planner marks a context that cannot carry input");
assert.strictEqual(tinyBudget.safe, false, "the actual request guard rejects a prompt that cannot fit");

for (const [key, zh, en] of [
  ["mode", 'mode: "模式："', 'mode: "Mode:"'],
  ["source", 'source: "来源："', 'source: "Source:"'],
  ["configured", 'configured: "已配置："', 'configured: "Configured:"'],
  ["verifiedNative", 'verifiedNative: "服务商原生已验证："', 'verifiedNative: "Verified native:"'],
  ["unknownUnverified", 'unknownUnverified: "未知／未核实"', 'unknownUnverified: "Unknown / unverified"'],
  ["effective", 'effective: "有效值："', 'effective: "Effective:"'],
  ["useCompatibility", 'useCompatibility: "使用 90K 兼容设置"', 'useCompatibility: "Use 90K compatibility setting"'],
  ["keepAuto", 'keepAuto: "保持 Auto"', 'keepAuto: "Keep Auto"'],
  ["custom", 'custom: "自定义"', 'custom: "Custom"'],
  ["availableInput", 'availableInput: "可用输入（空消息预算估算）: "', 'availableInput: "Available input (empty-message budget estimate): "'],
  ["outputReserve", 'outputReserve: "输出预留: "', 'outputReserve: "Output reserve: "']
]) {
  assert(rendererSource.includes(`v95Runtime.t("legacyUi.provider.${key}")`), `ContextLengthField must use the ${key} translation`);
  assert(zhLocale.includes(zh) && enLocale.includes(en), `ContextLengthField ${key} must retain its meaning in both locales`);
}
assert.ok(/modelContextSource === "provider_native" \? modelContext : null/.test(rendererSource),
  "Verified Native shows only explicitly trusted provider-native metadata");
assert.ok(/chooseContextMode\("custom",\s*90000\)/.test(rendererSource), "the compatibility action selects Custom 90K");
assert.ok(/chooseContextMode\("auto"\)/.test(rendererSource), "the Auto action preserves the user's explicit choice");
assert.ok(/onContextModeChange\("custom",\s*customValue\)/.test(rendererSource), "Custom selection writes its actual configured value");
assert.ok(/max:\s*"2000000"/.test(rendererSource), "the Custom control keeps the full supported range");
assert.ok(/effectiveInputBudget/.test(rendererSource), "the UI shows available input room");
assert.ok(/outputReserveTokens/.test(rendererSource), "the UI shows output reserve");
assert.ok(/Math\.max\(0,\s*effectiveContext\s*-\s*outputReserveTokens\s*-\s*32\s*-\s*safetyMarginTokens\)/.test(rendererSource),
  "the UI computes available input from the same output and safety reserves");
assert(rendererSource.includes('v95Runtime.t("legacyUi.provider.noAvailableInput")')
  && zhLocale.includes('noAvailableInput: "此设置无法为当前输出预留、安全余量和协议开销留下可用输入；请提高 Custom 值或降低输出上限。发送时仍会由预算守卫阻止不合适的请求。"')
  && enLocale.includes('noAvailableInput: "This setting leaves no available input after the output reserve, safety margin, and protocol overhead.'),
  "the UI explains why a 256-token context cannot carry a normal prompt");

const handlers = new Map();
const savedConfigs = [];
registerIpcHandlers({
  electron: { ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) } },
  settingsRepository: { saveProviderConfig: (config) => { savedConfigs.push(config); return config; } },
  llmManager: {},
  conversationManager: { onConversationUpdate: () => {} }
});
const saveProviderConfig = handlers.get("llm:saveProviderConfig");
const chosenConfig = {
  instanceId: "zhipu",
  providerType: "zhipu",
  defaultModel: "glm-5.3-flash",
  contextMode: "custom",
  customContextLength: 90000
};
assert.strictEqual(saveProviderConfig(null, chosenConfig), chosenConfig, "the existing save IPC accepts the user's explicit compatibility selection");
assert.deepStrictEqual(savedConfigs, [chosenConfig], "the selected mode and context value reach persistence unchanged");
assert(rendererSource.includes('contextMode: ["auto", "custom"].includes(editingConfig.contextMode)'),
  "the settings UI maps its selected context mode into the saved config");
assert(rendererSource.includes("customContextLength: editingConfig.customContextLength"),
  "the settings UI maps the selected Custom value into the saved config");
assert(rendererSource.includes("window.llmConfigAPI.saveProviderConfig(configToSave)"),
  "the settings UI sends its selected config through the save IPC");

console.log("V9.3.6.2 GLM context compatibility, UI choices, IPC persistence, and budget checks passed");
