"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const system = require(path.join(root, "resources", "app", "out", "main", "action-system"));
const mainSource = fs.readFileSync(path.join(root, "resources", "app", "out", "main", "main.js"), "utf8");
const conversationSource = fs.readFileSync(path.join(root, "resources", "app", "out", "main", "action-system", "conversation.js"), "utf8");
const runtimeSource = fs.readFileSync(path.join(root, "resources", "app", "out", "main", "action-system", "conversation-runtime.js"), "utf8");

(async () => {
const responders = [{ id: 2, shortName: "甲" }, { id: 3, shortName: "乙" }, { id: 4, shortName: "丙" }];
const responses = [];
const conversation = {
  id: "synthetic",
  messages: [],
  turnEpoch: 0,
  npcQueue: [],
  isPaused: false,
  cancelActiveResponse: () => false,
  respondAs: async (npc, epoch) => responses.push(`${epoch}:${npc.id}`),
  emitUpdate: () => {}
};
const turnManager = new system.ConversationTurnManager(conversation);
for (let turn = 1; turn <= 30; turn++) {
  const state = turnManager.startUserTurn({ playerMessageId: turn, activeParticipantIds: [1, 2, 3, 4] });
  assert.strictEqual(state.epoch, turn);
  assert(Object.isFrozen(state) && Object.isFrozen(state.activeParticipantIds), "turn contract must be immutable");
  turnManager.fillQueue({ customQueue: responders, npcs: [], persistCustomQueue: true });
  await turnManager.processQueue(state.epoch);
  assert.strictEqual(conversation.npcQueue.length, 0, "each turn queue must drain independently");
}
assert.strictEqual(responses.length, 90, "30 synthetic turns must dispatch every responder once");
assert.deepStrictEqual(responses.slice(-3), ["30:2", "30:3", "30:4"]);

const skipped = [];
const generationConversation = {
  turnEpoch: 1,
  messages: [{ id: 9, isStreaming: true }],
  npcQueue: [],
  isPaused: false,
  emitUpdate: () => {},
  isCharacterAvailableForConversation: () => true
};
const generationManager = new system.GenerationManager(generationConversation, { recordSkipped: (state, reason) => skipped.push([state.responseId, reason]) });
const state = generationManager.start({ turnEpoch: 1, messageId: 9, npcId: 2 });
assert.strictEqual(state.status, "active");
assert.strictEqual(generationManager.isCurrent(state, responders[0]), true);
generationManager.cancel("superseded_by_new_user_turn");
assert.strictEqual(state.status, "stale");
assert.strictEqual(state.controller.signal.aborted, true);
assert.deepStrictEqual(skipped, [["1:9:2", "superseded_by_new_user_turn"]]);
assert.strictEqual(generationConversation.messages.length, 0, "stale streaming placeholder must be removed");

assert(!mainSource.includes("new AbortController()"), "Conversation must not construct AbortController directly");
assert(conversationSource.includes("actionSystem.createConversationRuntime(this"), "Conversation must delegate service wiring to its runtime");
assert(runtimeSource.includes("new ConversationTurnManager(conversation)"), "Conversation runtime must own the turn-manager boundary");
assert(runtimeSource.includes("new GenerationManager(conversation"), "Conversation runtime must own the generation-manager boundary");
assert(runtimeSource.includes("approvalManager: createApprovalManager()"), "Conversation runtime must own the approval-manager boundary");

console.log("VOTC v6.9-C managers: PASS (30 turns, responder queue, generation cancellation and service ownership)");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
