"use strict";

const assert = require("assert");
const path = require("path");

const root = path.resolve(__dirname, "..");
const { Conversation } = require(path.join(root, "resources", "app", "out", "main", "action-system", "conversation"));

delete globalThis.actionRegistry;

const action = { id: "approved-action" };
const calls = [];
const fakeRegistry = {
  getById(actionId) {
    calls.push(["getById", actionId]);
    return action;
  },
  isActionDisabled(actionId) {
    calls.push(["isActionDisabled", actionId]);
    return true;
  }
};
class FakeApprovalManager {
  constructor(_conversation, dependencies) {
    this.dependencies = dependencies;
  }
}
const actionSystem = {
  ApprovalManager: FakeApprovalManager,
  actionDecisionTrace: { normalizeSkipReason: (_stage, reason) => reason }
};

Conversation.configure({
  actionSystem,
  ActionEngine: { runInvocation: async () => null },
  actionRegistry: fakeRegistry,
  settingsRepository: {
    getActionApprovalSettings: () => ({ approvalMode: "all" }),
    getLanguage: () => "zh"
  },
  usageAnalytics: { record: () => {} },
  createActionApproval: (input) => input,
  resolveI18nString: (value) => value.zh || value.en
});

const conversation = {
  getActionSystem: () => actionSystem,
  addActionFeedback: () => {}
};
const manager = Conversation.prototype.createApprovalManager.call(conversation);

assert.strictEqual(manager.dependencies.getAction("approved-action"), action);
assert.strictEqual(manager.dependencies.isActionDisabled("approved-action"), true);
assert.deepStrictEqual(calls, [
  ["getById", "approved-action"],
  ["isActionDisabled", "approved-action"]
]);

console.log("VOTC v6.9.1 follow-up conversation DI: PASS (explicit registry without global fallback)");
