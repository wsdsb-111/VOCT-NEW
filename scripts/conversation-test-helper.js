"use strict";

const events = require("events");
const path = require("path");
const uuid = { v4: () => "test-conversation" };

const root = path.resolve(__dirname, "..");
const actionSystem = require(path.join(root, "resources", "app", "out", "main", "action-system"));

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

function getConversationClass() {
  return actionSystem.Conversation.configure({
    actionSystem,
    ActionEngine: globalProxy("ActionEngine"),
    settingsRepository: globalProxy("settingsRepository"),
    usageAnalytics: globalProxy("usageAnalytics"),
    llmManager: globalProxy("llmManager"),
    runFileManager: globalProxy("runFileManager"),
    parseLog: globalFunction("parseLog"),
    createError: globalFunction("createError"),
    createMessage: globalFunction("createMessage"),
    createActionApproval: globalFunction("createActionApproval"),
    createActionFeedback: globalFunction("createActionFeedback"),
    createSummaryImport: globalFunction("createSummaryImport"),
    createCharacterLeavingSummary: globalFunction("createCharacterLeavingSummary"),
    createFinalSummary: globalFunction("createFinalSummary"),
    createPromptFingerprint: globalFunction("createPromptFingerprint"),
    cleanLogFile: globalFunction("cleanLogFile"),
    resolveI18nString: globalFunction("resolveI18nString"),
    PromptBuilder: globalProxy("PromptBuilder"),
    TokenCounter: globalProxy("TokenCounter"),
    logVerboseLLM: (...args) => globalThis.logVerboseLLM?.(...args),
    events,
    uuid,
    path
  });
}

module.exports = { getConversationClass };
