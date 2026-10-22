"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const { createSettingsRepository } = require(path.join(root, "src", "app", "main", "config", "settings-repository.js"));
const { registerIpcHandlers } = require(path.join(root, "src", "app", "main", "ipc", "register-ipc.js"));

const stores = new Map();
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

const SettingsRepository = createSettingsRepository({
  Store: FixtureStore,
  schema: {},
  SecureProviderSecrets: FixtureProviderSecrets,
  electron: { safeStorage: {} },
  providerTypes: ["player2"],
  defaultProviderConfigs: { player2: { defaultModel: "fixture-model" } },
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

stores.set("votc-llm-config", { language: "en" });
let repository = new SettingsRepository();
assert.strictEqual(repository.getUiLanguage(), "zh-CN", "a missing UI language defaults to Chinese without writing a migration");
assert.strictEqual(repository.getLanguage(), "en", "the legacy language keeps its existing default");
assert.strictEqual(Object.prototype.hasOwnProperty.call(repository.store.store, "uiLanguage"), false,
  "reading the default UI language does not write the legacy settings store");

repository.saveUiLanguage("en-US");
assert.strictEqual(repository.getLanguage(), "en", "saving a UI language leaves the legacy language unchanged");
repository = new SettingsRepository();
assert.strictEqual(repository.getUiLanguage(), "en-US", "the saved UI language survives repository restart");
repository.saveUiLanguage("zh-CN");
repository = new SettingsRepository();
assert.strictEqual(repository.getUiLanguage(), "zh-CN", "the UI language switches back and survives restart");
assert.strictEqual(repository.getLanguage(), "en", "restarting after UI changes preserves the old Action language");

for (const invalid of ["zh", "en", "ru", "", null, undefined, {}, []]) {
  const before = JSON.stringify(repository.store.store);
  assert.throws(() => repository.saveUiLanguage(invalid), /ui_language_invalid/, `invalid UI language is rejected: ${String(invalid)}`);
  assert.strictEqual(JSON.stringify(repository.store.store), before, "invalid UI language writes no settings");
}

repository.store.set("uiLanguage", "fr");
assert.strictEqual(repository.getUiLanguage(), "zh-CN", "an unsupported stored UI language falls back safely");
assert.strictEqual(repository.getLanguage(), "en", "invalid UI language data does not change legacy language");
repository.saveUiLanguage("en-US");
assert.deepStrictEqual(repository.getLanguagePreferences(), {
  uiLanguage: "en-US",
  promptLanguage: "en",
  gameLanguage: "unknown",
  promptLanguageSource: "legacy-action-language"
}, "language preferences report the legacy Action language and unknown game language explicitly");

repository.saveLanguage("en");
assert.strictEqual(repository.getLanguage(), "en", "the old saveLanguage/getLanguage pair retains its stored value");
assert.strictEqual(repository.getUiLanguage(), "en-US", "the old language API does not overwrite the UI language");

const handlers = new Map();
registerIpcHandlers({
  electron: { ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) } },
  settingsRepository: repository,
  llmManager: {},
  conversationManager: { onConversationUpdate: () => {} }
});
assert.strictEqual(handlers.get("llm:getUiLanguage")(), "en-US", "the UI-language IPC reads the independent setting");
handlers.get("llm:saveUiLanguage")(null, "zh-CN");
assert.strictEqual(handlers.get("llm:getLanguage")(), "en", "the existing language IPC remains unchanged");
assert.deepStrictEqual(handlers.get("llm:getLanguagePreferences")(), {
  uiLanguage: "zh-CN",
  promptLanguage: "en",
  gameLanguage: "unknown",
  promptLanguageSource: "legacy-action-language"
}, "the preferences IPC returns the complete read-only language view");
assert.throws(() => handlers.get("llm:saveUiLanguage")(null, "zh"), /ui_language_invalid/,
  "the UI-language IPC rejects values outside its allowlist");

const mainSource = fs.readFileSync(path.join(root, "src", "app", "main", "main.js"), "utf8");
assert.match(mainSource, /uiLanguage:\s*\{\s*type:\s*"string",\s*default:\s*"zh-CN"\s*\}/,
  "the Main settings schema declares the independent UI-language default");
const preloadSource = fs.readFileSync(path.join(root, "src", "app", "preload", "preload.js"), "utf8");
assert.match(preloadSource, /getUiLanguage:\s*\(\)\s*=>\s*electron\.ipcRenderer\.invoke\("llm:getUiLanguage"\)/);
assert.match(preloadSource, /saveUiLanguage:\s*\(language\)\s*=>\s*electron\.ipcRenderer\.invoke\("llm:saveUiLanguage",\s*language\)/);
assert.match(preloadSource, /getLanguagePreferences:\s*\(\)\s*=>\s*electron\.ipcRenderer\.invoke\("llm:getLanguagePreferences"\)/);

console.log("VOTC V9.5 independent UI language settings and IPC checks passed");
