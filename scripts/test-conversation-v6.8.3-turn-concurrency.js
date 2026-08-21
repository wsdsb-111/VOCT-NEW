"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const actionSystem = require(path.join(root, "resources", "app", "out", "main", "action-system"));
globalThis.__V67ActionSystem = actionSystem;
const source = fs.readFileSync(path.join(root, "resources", "app", "out", "main", "main.js"), "utf8");
const { getConversationClass } = require("./conversation-test-helper");

globalThis.createMessage = (message) => ({ type: "message", ...message });
globalThis.createError = (message) => ({ type: "error", ...message });
globalThis.logVerboseLLM = () => {};
globalThis.createPromptFingerprint = () => "fingerprint";
globalThis.PromptBuilder = {
  buildMessagesWithTokenCount: () => ({ messages: [], blocks: [] })
};
globalThis.settingsRepository = {
  getActiveProviderConfig: () => ({ providerType: "test" }),
  getGlobalStreamSetting: () => true
};
globalThis.usageAnalytics = { record: () => {} };

const streams = [];
globalThis.llmManager = {
  sendChatRequest: async () => streams.shift()
};
const Conversation = getConversationClass();

function deferredStream() {
  const pending = [];
  let finished = false;
  return {
    push(chunk) {
      const waiter = pending.shift();
      if (waiter) waiter({ value: chunk, done: false });
    },
    finish() {
      finished = true;
      const waiter = pending.shift();
      if (waiter) waiter({ value: undefined, done: true });
    },
    [Symbol.asyncIterator]() {
      return {
        next: () => finished ? Promise.resolve({ value: undefined, done: true }) : new Promise((resolve) => pending.push(resolve))
      };
    }
  };
}

function createConversation() {
  const conversation = Object.create(Conversation.prototype);
  conversation.messages = [];
  conversation.nextId = 1;
  conversation.turnEpoch = 1;
  conversation.activeResponse = null;
  conversation.currentStreamController = null;
  conversation.currentSummary = "";
  conversation.lastSummarizedMessageIndex = 0;
  conversation.npcQueue = [];
  conversation.isPaused = false;
  conversation.inactiveParticipantIds = new Map();
  conversation.gameData = { characters: new Map(), mentionedCharactersInContext: new Set() };
  conversation.emitUpdate = () => {};
  conversation.checkAndSummarizeIfNeeded = async () => {};
  conversation.getHistory = () => conversation.messages;
  conversation.estimateTokenCount = () => 0;
  conversation.actionEvaluations = [];
  conversation.evaluateCompletedActions = async (npc, messageId, message, responseState) => {
    if (conversation.isResponseCurrent(responseState, npc)) conversation.actionEvaluations.push({ npcId: npc.id, messageId, content: message.content });
  };
  const generationManager = new actionSystem.GenerationManager(conversation, { recordSkipped: () => {} });
  conversation.runtime = { generationManager, turnManager: null, approvalManager: null };
  conversation.generationManager = generationManager;
  return conversation;
}

(async () => {
  const npcA = { id: 2, fullName: "旧角色", shortName: "旧角色" };
  const npcB = { id: 3, fullName: "新角色", shortName: "新角色" };
  const streamA = deferredStream();
  const streamB = deferredStream();
  streams.push(streamA, streamB);
  const conversation = createConversation();

  const responseA = conversation.respondAs(npcA, 1);
  await new Promise((resolve) => setImmediate(resolve));
  conversation.turnEpoch = 2;
  conversation.cancelActiveResponse("superseded_by_new_user_turn");
  const responseB = conversation.respondAs(npcB, 2);
  await new Promise((resolve) => setImmediate(resolve));
  const activeB = conversation.activeResponse;

  streamA.push({ delta: { content: "旧内容" } });
  streamA.finish();
  await responseA;
  assert.strictEqual(conversation.activeResponse, activeB, "old response finally must not clear the new active response");
  assert(!conversation.messages.some((message) => message.name === npcA.fullName || message.type === "error"), "stale response must leave no placeholder or error card");

  streamB.push({ delta: { content: "新内容" } });
  streamB.finish();
  await responseB;
  assert.deepStrictEqual(conversation.messages.filter((message) => message.role === "assistant").map((message) => message.content), ["新内容"], "only current response chunks may reach the transcript");
  assert.deepStrictEqual(conversation.actionEvaluations, [{ npcId: npcB.id, messageId: activeB.messageId, content: "新内容" }], "stale response must not trigger action evaluation");

  console.log("VOTC v6.8.3 turn concurrency: PASS (stale chunks, actions, errors and finally are isolated)");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
