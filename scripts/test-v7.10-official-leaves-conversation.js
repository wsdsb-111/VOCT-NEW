"use strict";

const assert = require("assert");
const path = require("path");

const root = path.resolve(__dirname, "..");
const { Conversation } = require(path.join(root, "resources", "app", "out", "main", "conversation", "conversation"));
const leavesConversation = require(path.join(root, "resources", "app", "default_userdata", "actions", "standard", "z_leavesConversation.js"));

const player = { id: 1, shortName: "玩家", fullName: "玩家" };
const npcA = { id: 2, shortName: "甲", fullName: "甲" };
const npcB = { id: 3, shortName: "乙", fullName: "乙" };
let summaryFailure = false;
let capturedPrompt = null;
const summaryText = "乙记得自己在场期间与玩家及甲进行了完整交谈，双方明确交换了意见，也确认了各自的立场与后续安排。";
const memoryEngine = {
  ensureConversationState(conversation) {
    return conversation.memoryState;
  },
  observeParticipants(conversation, characterIds, messageId) {
    for (const characterId of characterIds) {
      if (!conversation.memoryState.participantPresence.some((window) => window.characterId === Number(characterId) && window.leftAtMessageId == null)) {
        conversation.memoryState.participantPresence.push({ characterId: Number(characterId), joinedAtMessageId: messageId, leftAtMessageId: null });
      }
    }
  },
  markParticipantLeft(conversation, characterId, messageId) {
    const window = [...conversation.memoryState.participantPresence].reverse().find((entry) => entry.characterId === Number(characterId) && entry.leftAtMessageId == null);
    if (window) window.leftAtMessageId = messageId;
  },
  checkpointConversation() {
    return null;
  }
};

Conversation.configure({
  memoryEngine,
  llmManager: {
    async sendSummaryRequest(prompt) {
      capturedPrompt = prompt;
      if (summaryFailure) throw new Error("summary unavailable");
      return { content: summaryText };
    }
  },
  TokenCounter: { calculateTotalTokens: () => 1, estimateMessageTokens: () => 1 },
  createMessage: (entry) => ({ ...entry, type: "message" })
});

function makeConversation(windows, messages = []) {
  const saved = [];
  const conversation = Object.create(Conversation.prototype);
  conversation.id = "official-leaves-test";
  conversation.gameData = {
    playerID: player.id,
    playerName: player.fullName,
    date: "1000.1.1",
    totalDays: 100,
    characters: new Map([[player.id, player], [npcA.id, npcA], [npcB.id, npcB]]),
    saveCharacterSummary(characterId, summary) { saved.push({ characterId, summary }); }
  };
  conversation.messages = messages;
  conversation.nextId = messages.reduce((highest, message) => Math.max(highest, Number(message.id) + 1), 0);
  conversation.currentSummary = "PREJOIN_GLOBAL_SECRET";
  conversation.lastSummarizedMessageIndex = 0;
  conversation.memoryState = { participantPresence: windows.map((window) => ({ ...window })) };
  conversation.presenceInitialized = true;
  conversation.presentCharacterIds = new Set([2, 3]);
  conversation.waitingCharacterIds = new Set();
  conversation.temporarilyAbsentCharacterIds = new Map();
  conversation.departedCharacterIds = new Set();
  conversation.inactiveParticipantIds = new Map();
  conversation.summaryParticipantProfiles = new Map();
  conversation.npcQueue = [];
  conversation.customQueue = null;
  conversation.pendingActionApprovals = new Map();
  conversation.leaveEvents = [];
  conversation.joinEvents = [];
  conversation.activeResponse = null;
  conversation.isPaused = false;
  conversation.emitUpdate = () => {};
  conversation.invalidateApprovalsForCharacter = () => {};
  return { conversation, saved };
}

function officialPrompt(conversation) {
  return [
    { role: "system", content: "You are summarizing from 乙's perspective." },
    { role: "system", content: `Previous summary of this conversation:\n\n${conversation.currentSummary}` },
    { role: "system", content: `Full conversation:\n${conversation.getHistory().map((message) => `${message.name}: ${message.content}`).join("\n")}` },
    { role: "user", content: "Create a comprehensive personal summary." }
  ];
}

assert.strictEqual(typeof Conversation.prototype.createCharacterLeavingSummary, "function", "official leavesConversation compatibility API must exist");

(async () => {
  const normal = makeConversation(
    [{ characterId: 3, joinedAtMessageId: 0, leftAtMessageId: null }],
    [
      { id: 0, role: "user", name: "玩家", content: "三人会谈开始。" },
      { id: 1, role: "assistant", name: "甲", content: "我先陈述意见。" },
      { id: 2, role: "assistant", name: "乙", content: "我同意继续商议。" }
    ]
  );
  summaryFailure = false;
  capturedPrompt = null;
  const result = await leavesConversation.run({
    gameData: normal.conversation.gameData,
    sourceCharacter: npcA,
    targetCharacter: npcB,
    runGameEffect() {},
    conversation: normal.conversation,
    dryRun: false,
    lang: "zh"
  });
  assert.strictEqual(result.sentiment, "neutral");
  assert.strictEqual(normal.saved.length, 1, "successful summary must be saved by the official action");
  assert.strictEqual(normal.saved[0].summary.content, summaryText);
  assert(!normal.conversation.gameData.characters.has(npcB.id), "normal three-person leave must remove the target");

  const failed = makeConversation(
    [{ characterId: 3, joinedAtMessageId: 0, leftAtMessageId: null }],
    [{ id: 0, role: "user", name: "玩家", content: "请退下。" }]
  );
  summaryFailure = true;
  await leavesConversation.run({
    gameData: failed.conversation.gameData,
    sourceCharacter: npcA,
    targetCharacter: npcB,
    runGameEffect() {},
    conversation: failed.conversation,
    dryRun: false,
    lang: "zh"
  });
  assert.strictEqual(failed.saved.length, 0, "failed summary must not create an empty record");
  assert(!failed.conversation.gameData.characters.has(npcB.id), "summary failure must not block official participant removal");

  const midJoinMessages = [
    { id: 0, role: "user", name: "玩家", content: "PREJOIN_SECRET_0" },
    { id: 1, role: "assistant", name: "甲", content: "PREJOIN_SECRET_1" },
    { id: 2, role: "system", name: "System", content: "乙入内" },
    { id: 3, role: "user", name: "玩家", content: "VISIBLE_TURN_1" },
    { id: 4, role: "assistant", name: "乙", content: "VISIBLE_TURN_2" },
    { id: 5, role: "assistant", name: "甲", content: "VISIBLE_TURN_3" },
    { id: 6, role: "user", name: "玩家", content: "VISIBLE_TURN_4" },
    { id: 7, role: "assistant", name: "乙", content: "VISIBLE_TURN_5" },
    { id: 8, role: "assistant", name: "甲", content: "VISIBLE_TURN_6" }
  ];
  const midJoin = makeConversation([{ characterId: 3, joinedAtMessageId: 2, leftAtMessageId: null }], midJoinMessages);
  summaryFailure = false;
  capturedPrompt = null;
  const midJoinSummary = await midJoin.conversation.createCharacterLeavingSummary(3, officialPrompt(midJoin.conversation));
  const midJoinSerialized = JSON.stringify(capturedPrompt);
  assert(midJoinSummary.length >= 40, "5-7 visible turns must produce a non-short leaving summary");
  assert(!midJoinSerialized.includes("PREJOIN_SECRET"), "mid-join summary must exclude pre-join dialogue");
  assert(!midJoinSerialized.includes("PREJOIN_GLOBAL_SECRET"), "mid-join summary must exclude the shared rolling summary");
  for (let turn = 1; turn <= 6; turn++) assert(midJoinSerialized.includes(`VISIBLE_TURN_${turn}`));

  const temporary = makeConversation(
    [{ characterId: 3, joinedAtMessageId: 0, leftAtMessageId: null }],
    [
      { id: 0, role: "user", name: "玩家", content: "BEFORE_AWAY_1" },
      { id: 1, role: "assistant", name: "乙", content: "BEFORE_AWAY_2" }
    ]
  );
  temporary.conversation.nextId = 2;
  await temporary.conversation.temporarilyLeaveCharacter(3, "away");
  temporary.conversation.messages.push(
    { id: 3, role: "user", name: "玩家", content: "ABSENT_SECRET_1" },
    { id: 4, role: "assistant", name: "甲", content: "ABSENT_SECRET_2" }
  );
  temporary.conversation.nextId = 5;
  await temporary.conversation.returnTemporaryCharacter(3);
  temporary.conversation.messages.push(
    { id: 6, role: "user", name: "玩家", content: "AFTER_RETURN_1" },
    { id: 7, role: "assistant", name: "乙", content: "AFTER_RETURN_2" }
  );
  capturedPrompt = null;
  await temporary.conversation.createCharacterLeavingSummary(3, officialPrompt(temporary.conversation));
  const temporarySerialized = JSON.stringify(capturedPrompt);
  assert(temporarySerialized.includes("BEFORE_AWAY_1") && temporarySerialized.includes("AFTER_RETURN_2"));
  assert(!temporarySerialized.includes("ABSENT_SECRET"), "temporary-away interval must be absent from the leaving summary prompt");
  assert(!temporarySerialized.includes("PREJOIN_GLOBAL_SECRET"), "multi-window presence must not reuse the shared rolling summary");

  console.log("VOTC v7.10 Official leavesConversation Compatibility: PASS");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
