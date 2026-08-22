"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const actionsDir = path.join(root, "resources", "app", "default_userdata", "actions", "standard");
globalThis.__V67ActionSystem = require(path.join(root, "resources", "app", "out", "main", "action-system"));
globalThis.actionRegistry = {
  getAllActions: () => fs.readdirSync(actionsDir).filter((file) => file.endsWith(".js")).map((file) => {
    const definition = require(path.join(actionsDir, file));
    return { id: definition.signature, definition };
  })
};
const { getActionEngine } = require("./action-engine-test-helper");
const ActionEngine = getActionEngine();

const memoryContext = {
  engineVersion: "2.2",
  stableText: "长期记忆：乙昨日杀死了俘虏，并把丙关进地牢。",
  relevantText: "人物目录摘要：甲曾与乙正式成为恋人。"
};
const harmlessReply = { id: 10, role: "assistant", name: "乙", content: "今日天气不错，我们继续商谈粮草吧。" };
const explicitReply = { id: 11, role: "assistant", name: "乙", content: "我已经把丙关进地牢。" };
const npc = { id: 2, shortName: "乙" };
const harmlessPlan = ActionEngine.buildTurnEvaluationPlan({ playerMessage: null, player: null, npcMessage: harmlessReply, npc });
assert.strictEqual(harmlessPlan.length, 1);
assert.strictEqual(harmlessPlan[0].message, harmlessReply, "action evaluation must receive only the completed response message");
assert.strictEqual(ActionEngine.shouldEvaluateForMessage({ actionGateProcessedTriggers: new Set(), memoryContext }, harmlessPlan[0].message).shouldEvaluate, false, "action words inside retrieved memory must not create a ghost action");
assert.strictEqual(ActionEngine.shouldEvaluateForMessage({ actionGateProcessedTriggers: new Set(), memoryContext }, explicitReply).shouldEvaluate, true, "an explicit completed action in the current response must still be evaluated");
for (let index = 0; index < 100; index++) {
  const conversation = { actionGateProcessedTriggers: new Set(), memoryContext };
  assert.strictEqual(ActionEngine.shouldEvaluateForMessage(conversation, { ...harmlessReply, id: 1000 + index }).shouldEvaluate, false, `memory isolation stress ${index}`);
  assert.strictEqual(ActionEngine.shouldEvaluateForMessage(conversation, { ...explicitReply, id: 2000 + index }).shouldEvaluate, true, `current-response action stress ${index}`);
}

const conversationSource = fs.readFileSync(path.join(root, "resources", "app", "out", "main", "action-system", "conversation.js"), "utf8");
const evaluationBlock = conversationSource.slice(conversationSource.indexOf("async evaluateCompletedActions"), conversationSource.indexOf("async handleActionResults"));
assert(evaluationBlock.includes("evaluation.message"), "completed action evaluation must use the response message boundary");
assert(!evaluationBlock.includes("memoryContext"), "retrieved memory must not be concatenated into action evaluation text");

console.log("VOTC v7.2 action-memory integration: PASS (100 memory-isolated current-response action checks)");
