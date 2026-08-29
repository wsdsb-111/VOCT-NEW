"use strict";

const path = require("path");

const root = path.resolve(__dirname, "..");
const actionSystem = require(path.join(root, "resources", "app", "out", "main", "action-system"));
const { LegacyActionEngineV3 } = require(path.join(root, "resources", "app", "out", "main", "action-system", "action-engine"));

function globalProxy(name) {
  return new Proxy({}, {
    get(_target, property) {
      const owner = globalThis[name];
      const value = owner?.[property];
      return typeof value === "function" ? value.bind(owner) : value;
    }
  });
}

function globalFunction(name) {
  return (...args) => {
    const fn = globalThis[name];
    if (typeof fn !== "function") throw new Error(`Missing test dependency: ${name}`);
    return fn(...args);
  };
}

function getActionEngine() {
  return LegacyActionEngineV3.configure({
    actionRegistry: globalProxy("actionRegistry"),
    settingsRepository: globalProxy("settingsRepository"),
    usageAnalytics: globalProxy("usageAnalytics"),
    llmManager: globalProxy("llmManager"),
    ActionPromptBuilder: globalProxy("ActionPromptBuilder"),
    ActionSandbox: globalProxy("ActionSandbox"),
    ActionEffectWriter: globalProxy("ActionEffectWriter"),
    buildStructuredResponseJsonSchema: globalFunction("buildStructuredResponseJsonSchema"),
    buildStructuredResponseSchema: globalFunction("buildStructuredResponseSchema"),
    healJsonResponseWithLogging: globalFunction("healJsonResponseWithLogging"),
    resolveI18nString: globalFunction("resolveI18nString"),
    logVerboseLLM: (...args) => globalThis.logVerboseLLM?.(...args)
  });
}

module.exports = { actionSystem, getActionEngine };
