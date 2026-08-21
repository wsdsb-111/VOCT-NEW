"use strict";

const assert = require("assert");
const path = require("path");

const root = path.resolve(__dirname, "..");
const { Conversation } = require(path.join(root, "resources", "app", "out", "main", "action-system", "conversation"));

const turnManager = { kind: "turn" };
const generationManager = { kind: "generation" };
const approvalManager = { kind: "approval" };
const conversation = {
  runtime: { turnManager, generationManager, approvalManager },
  turnManager: { stale: true },
  generationManager: { stale: true },
  approvalManager: { stale: true }
};

assert.strictEqual(Conversation.prototype.getTurnManager.call(conversation), turnManager);
assert.strictEqual(Conversation.prototype.getGenerationManager.call(conversation), generationManager);
assert.strictEqual(Conversation.prototype.getApprovalManager.call(conversation), approvalManager);

for (const [getter, managerKey, errorCode] of [
  ["getTurnManager", "turnManager", "conversation_turn_manager_not_initialized"],
  ["getGenerationManager", "generationManager", "conversation_generation_manager_not_initialized"],
  ["getApprovalManager", "approvalManager", "conversation_approval_manager_not_initialized"]
]) {
  const missing = { runtime: {}, [managerKey]: null };
  assert.throws(() => Conversation.prototype[getter].call(missing), new RegExp(errorCode));
}

console.log("VOTC v6.9.1 follow-up runtime ownership: PASS (runtime-owned managers never rebuild)");
