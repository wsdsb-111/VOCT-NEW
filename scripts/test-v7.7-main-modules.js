"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const mainPath = path.join(root, "resources", "app", "out", "main", "main.js");
const providerPath = path.join(root, "resources", "app", "out", "main", "providers", "index.js");
const ipcPath = path.join(root, "resources", "app", "out", "main", "ipc", "register-ipc.js");
const providerServicePath = path.join(root, "resources", "app", "out", "main", "provider-service.js");
const mainSource = fs.readFileSync(mainPath, "utf8");
const providerSource = fs.readFileSync(providerPath, "utf8");
const ipcSource = fs.readFileSync(ipcPath, "utf8");

assert(mainSource.split(/\r?\n/).length <= 6700, "V7.7 stage-two main.js line budget must remain below 6700");
assert(mainSource.includes('require("./providers")'));
assert(mainSource.includes('require("./ipc/register-ipc")'));
assert(mainSource.includes('require("./provider-service")'));
assert(!mainSource.includes("class BaseProvider"), "provider implementations must not return to main.js");
assert(!mainSource.includes("class ProviderRegistry"), "provider registry must not return to main.js");
assert(!mainSource.includes("class LLMManager"), "provider request orchestration must not return to main.js");
assert(!mainSource.includes("electron.ipcMain.handle("), "IPC handlers must not return to main.js");
assert(require(providerServicePath).LLMManager, "Provider Service must export LLMManager");

const providers = require(providerPath);
const registrations = [];
providers.registerProviderImplementations({
  register(providerId, ProviderClass) {
    registrations.push([providerId, ProviderClass]);
  }
});
assert.deepStrictEqual(registrations.map(([providerId]) => providerId), [
  "openrouter",
  "openai-compatible",
  "ollama",
  "player2",
  "deepseek",
  "gemini"
]);
assert(registrations.every(([, ProviderClass]) => typeof ProviderClass === "function"));
assert.throws(() => new providers.DeepseekProvider().validateConfig({}), /API key is required/);
assert(providerSource.includes("transformedRequest.thinking"), "DeepSeek thinking forwarding must survive extraction");
const providerServiceSource = fs.readFileSync(providerServicePath, "utf8");
assert(providerServiceSource.includes('thinking: { type: "enabled" }'), "DeepSeek chat thinking configuration must remain unchanged");
assert(providerServiceSource.includes("max_tokens: 4096"), "DeepSeek output budget must remain unchanged");

const { registerIpcHandlers } = require(ipcPath);
const handlers = new Map();
let updateCallback = null;
const settingsSentinel = { locale: "zh-CN", source: "v7.7-test" };
const runtime = {
  electron: {
    ipcMain: {
      handle(channel, handler) {
        assert(!handlers.has(channel), `duplicate IPC channel: ${channel}`);
        handlers.set(channel, handler);
      }
    }
  },
  settingsRepository: {
    getAppSettings: () => settingsSentinel
  },
  conversationManager: {
    onConversationUpdate(callback) {
      updateCallback = callback;
    }
  }
};
registerIpcHandlers(runtime);
assert.strictEqual(handlers.size, 99, "all existing IPC channels, v7.9 action-mode channels, temporary-presence channels and the dedicated fixed Player2 protocol channel must remain registered");
for (const channel of [
  "toggle-config-panel",
  "llm:getAppSettings",
  "llm:getActionSystemMode",
  "llm:saveActionSystemMode",
  "actions:getAll",
  "shell:openPlayer2",
  "conversation:temporarilyLeaveCharacter",
  "conversation:returnTemporaryCharacter",
  "conversation:getMemoryOverview",
  "conversation:getPromptPreview"
]) {
  assert(handlers.has(channel), `missing IPC channel: ${channel}`);
}
assert.strictEqual(handlers.get("llm:getAppSettings")(), settingsSentinel);
assert.strictEqual(typeof updateCallback, "function", "conversation update forwarding must remain registered");
assert.strictEqual((ipcSource.match(/electron\.ipcMain\.handle\(/g) || []).length, 99);

let toggleCount = 0;
runtime.chatWindow = { webContents: { send(channel) { if (channel === "toggle-settings") toggleCount += 1; } } };
assert.strictEqual(handlers.get("toggle-config-panel")(), true);
assert.strictEqual(toggleCount, 1, "IPC callbacks must resolve the current chat window at invocation time");

console.log("VOTC v7.7 main modules: PASS (Provider Service, 6 providers, 99 IPC channels, dynamic window forwarding, main.js < 6700 lines)");
