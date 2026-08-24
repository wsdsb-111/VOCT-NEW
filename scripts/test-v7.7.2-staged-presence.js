"use strict";

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const memorySystem = require(path.join(root, "resources", "app", "out", "main", "memory-system"));
const { Conversation } = require(path.join(root, "resources", "app", "out", "main", "action-system", "conversation"));
const { KnowledgeService, buildPerspectiveSummaryMap, validatePerspectiveSummaryMap } = memorySystem;

const player = { id: 1, firstName: "玩家", shortName: "玩家", fullName: "玩家" };
const npcA = { id: 2, firstName: "甲", shortName: "甲", fullName: "甲" };
const npcB = { id: 3, firstName: "乙", shortName: "乙", fullName: "乙" };

function createPresenceMemoryStub() {
  return {
    ensureConversationState(conversation) {
      if (!conversation.memoryState) conversation.memoryState = { participantPresence: [] };
      return conversation.memoryState;
    },
    observeParticipants(conversation, characterIds, messageId) {
      const state = this.ensureConversationState(conversation);
      for (const value of characterIds || []) {
        const characterId = Number(value);
        if (!state.participantPresence.some((window) => window.characterId === characterId && window.leftAtMessageId == null)) {
          state.participantPresence.push({ characterId, joinedAtMessageId: messageId, leftAtMessageId: null });
        }
      }
      return state.participantPresence;
    },
    markParticipantLeft(conversation, characterId, messageId) {
      const state = this.ensureConversationState(conversation);
      const window = [...state.participantPresence].reverse().find((entry) => entry.characterId === Number(characterId) && entry.leftAtMessageId == null);
      if (window) window.leftAtMessageId = messageId;
      return window || null;
    }
  };
}

const memoryStub = createPresenceMemoryStub();
Conversation.configure({
  memoryEngine: memoryStub,
  createMessage: (input) => ({ ...input, type: "message", datetime: new Date(0) }),
  createPromptFingerprint: (value) => crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, 16),
  PromptBuilder: {
    prepareSummaryMessages: (messages) => messages
  }
});

function makeConversation() {
  const conversation = Object.create(Conversation.prototype);
  conversation.id = "presence-test";
  conversation.gameData = {
    playerID: player.id,
    playerName: player.shortName,
    date: "1000.1.1",
    totalDays: 10,
    characters: new Map([[player.id, player], [npcA.id, npcA], [npcB.id, npcB]])
  };
  conversation.messages = [];
  conversation.nextId = 0;
  conversation.npcQueue = [];
  conversation.customQueue = null;
  conversation.isPaused = false;
  conversation.activeResponse = null;
  conversation.inactiveParticipantIds = new Map();
  conversation.summaryParticipantProfiles = new Map();
  conversation.memoryState = { participantPresence: [] };
  conversation.emitUpdate = () => {};
  conversation.invalidateApprovalsForCharacter = () => {};
  conversation.createCharacterLeavingSummary = async (_characterId, prompt, participantIds) => {
    conversation.leavingSummaryPrompt = prompt;
    conversation.leavingSummaryParticipantIds = participantIds;
    return "离场前摘要";
  };
  return conversation;
}

(async () => {
  const defaultConversation = makeConversation();
  defaultConversation.initializePresence();
  assert.deepStrictEqual(defaultConversation.getNpcList().map((character) => character.id).sort(), [2, 3], "缺省必须保持全部已选 NPC 开场在场");

  const stagedConversation = makeConversation();
  stagedConversation.initializePresence([npcA.id]);
  assert.deepStrictEqual(stagedConversation.getNpcList().map((character) => character.id), [npcA.id], "候场 NPC 不得进入回应列表");
  assert.deepStrictEqual(stagedConversation.getPresenceState().waitingIds, [npcB.id]);
  const joinResult = await stagedConversation.joinWaitingCharacter(npcB.id);
  assert.strictEqual(joinResult.success, true);
  assert.strictEqual(stagedConversation.messages.at(-1).kind, "presence_join");
  assert.strictEqual(stagedConversation.messages.at(-1).content, "【乙入内】");
  assert.strictEqual(stagedConversation.npcQueue.length, 0, "加入当轮不得热插队补嘴");
  assert.deepStrictEqual(stagedConversation.getNpcList().map((character) => character.id).sort(), [2, 3]);
  assert.deepStrictEqual(stagedConversation.memoryState.participantPresence, [{ characterId: 3, joinedAtMessageId: 0, leftAtMessageId: null }]);

  const leavingConversation = makeConversation();
  leavingConversation.initializePresence();
  leavingConversation.messages.push(
    { id: 0, role: "user", name: "玩家", content: "密谈开始" },
    { id: 1, role: "assistant", name: "甲", content: "我听见了" },
    { id: 2, role: "assistant", name: "乙", content: "我也听见了" }
  );
  leavingConversation.nextId = 3;
  memoryStub.observeParticipants(leavingConversation, [1, 2, 3], 0);
  const leaveResult = await leavingConversation.leavePresentCharacter(npcB.id);
  assert.strictEqual(leaveResult.success, true);
  assert.strictEqual(leaveResult.summaryGenerated, true, "主动离场后必须立即开始生成离场前摘要");
  assert.strictEqual(leavingConversation.messages.at(-1).kind, "presence_leave");
  assert.strictEqual(leavingConversation.messages.at(-1).content, "【乙离场】");
  assert.strictEqual(leavingConversation.memoryState.participantPresence.find((window) => window.characterId === 3).leftAtMessageId, 3);
  leavingConversation.messages.push({ id: 4, role: "user", name: "玩家", content: "离场后的秘密" });
  assert(!leavingConversation.getHistoryForCharacter(3).some((message) => message.id >= 3), "离场行及离场后的正文不得进入离场角色可见历史");
  assert(leavingConversation.leavingSummaryPrompt.some((message) => message.content.includes("密谈开始")), "离场摘要必须包含离场前历史");
  assert(!leavingConversation.leavingSummaryPrompt.some((message) => message.content.includes("离场后的秘密")), "离场摘要快照不得引用未来消息");
  assert.deepStrictEqual([...leavingConversation.leavingSummaryParticipantIds].sort(), [1, 2, 3], "多人场景的离场摘要必须覆盖与离场者共同在场的人物");
  assert.deepStrictEqual(leavingConversation.getSummaryParticipantIds(), [1, 2, 3], "离场角色仍是本场实际参与者并应获得离场前摘要文件");
  assert.strictEqual((await leavingConversation.joinWaitingCharacter(3)).success, false, "已离场角色不得在同一场重新入内");

  const initialWaitingConversation = makeConversation();
  initialWaitingConversation.initializePresence();
  const stageResult = await initialWaitingConversation.leavePresentCharacter(npcB.id);
  assert.strictEqual(stageResult.status, "waiting", "第一句之前请离场应转为候场而不是生成空摘要");
  assert.strictEqual(initialWaitingConversation.messages.length, 0);

  const knowledge = new KnowledgeService({ store: {} });
  const presence = [
    { characterId: 1, joinedAtMessageId: 0, leftAtMessageId: null },
    { characterId: 2, joinedAtMessageId: 0, leftAtMessageId: null },
    { characterId: 3, joinedAtMessageId: 5, leftAtMessageId: 9 }
  ];
  const episode = { participantPresence: presence, conversationStartMessageId: 0, conversationEndMessageId: 12 };
  const baseMemory = { visibility: "participants", participants: [1, 2, 3], provenance: { messageIds: [] } };
  assert.deepStrictEqual(knowledge.resolveKnownBy({ ...baseMemory, provenance: { messageIds: [2] } }, episode), [1, 2], "入场前消息不得写入候场角色 knownBy");
  assert.deepStrictEqual(knowledge.resolveKnownBy({ ...baseMemory, provenance: { messageIds: [6] } }, episode), [1, 2, 3], "入场后且离场前消息应对该角色可见");
  assert.deepStrictEqual(knowledge.resolveKnownBy({ ...baseMemory, provenance: { messageIds: [10] } }, episode), [1, 2], "离场后的消息不得写入离场角色 knownBy");
  assert.deepStrictEqual(knowledge.resolveKnownBy({ ...baseMemory, visibility: "public", provenance: { messageIds: [10] } }, episode), [1, 2], "public 记忆也必须服从在场窗口");

  const participants = [player, npcA, npcB];
  const extraction = {
    sessionSummary: "窗口测试",
    memories: [
      { memoryId: "before", type: "secret", content: "入场前只谈乙的秘密。", participants: [1, 2], subjects: [3], knownBy: [1, 2], provenance: { messageIds: [2], speakerIds: [1] } },
      { memoryId: "inside", type: "event", content: "乙入场后共同议事。", participants: [1, 2, 3], subjects: [3], knownBy: [1, 2, 3], provenance: { messageIds: [6], speakerIds: [1, 3] } },
      { memoryId: "after", type: "secret", content: "乙离场后又谈到乙。", participants: [1, 2], subjects: [3], knownBy: [1, 2, 3], provenance: { messageIds: [10], speakerIds: [1] } }
    ]
  };
  const projections = buildPerspectiveSummaryMap({ participants, participantPresence: presence }, extraction);
  assert.strictEqual(validatePerspectiveSummaryMap({ participants, participantPresence: presence }, extraction, projections).success, true);
  assert(!projections.get("1->3").content.includes("入场前"), "player→B 不得包含 B 入场前内容");
  assert(projections.get("1->3").content.includes("共同议事"));
  assert(!projections.get("3->1").content.includes("离场后"), "B→player 不得包含 B 离场后内容，即使 knownBy 被错误标记");

  for (let participantCount = 2; participantCount <= 6; participantCount++) {
    const group = Array.from({ length: participantCount }, (_, index) => ({ id: index + 20, name: `人物${index + 1}` }));
    const lateCharacter = group.at(-1);
    const groupPresence = group.map((participant, index) => ({
      characterId: participant.id,
      joinedAtMessageId: participantCount > 2 && index === participantCount - 1 ? 5 : 0,
      leftAtMessageId: participantCount > 2 && index === participantCount - 1 ? 9 : null
    }));
    const groupExtraction = {
      sessionSummary: `${participantCount} 人窗口测试`,
      memories: [{
        memoryId: `inside_${participantCount}`,
        type: "event",
        content: `${participantCount} 人在共同在场窗口内议事。`,
        participants: group.map((participant) => participant.id),
        subjects: [],
        knownBy: group.map((participant) => participant.id),
        provenance: { messageIds: [6], speakerIds: group.map((participant) => participant.id) }
      }]
    };
    const groupContext = { participants: group, participantPresence: groupPresence };
    const groupProjections = buildPerspectiveSummaryMap(groupContext, groupExtraction);
    assert.strictEqual(groupProjections.size, participantCount * (participantCount - 1), `${participantCount} 人必须生成完整有向视角文件`);
    assert.strictEqual(validatePerspectiveSummaryMap(groupContext, groupExtraction, groupProjections).success, true);
    if (participantCount > 2) {
      assert(groupProjections.get(`${group[0].id}->${lateCharacter.id}`).content.includes("共同在场窗口"), "迟到角色在重叠窗口内的共同内容必须进入对应配对摘要");
    }
  }

  const actionLeaveConversation = makeConversation();
  actionLeaveConversation.initializePresence();
  actionLeaveConversation.messages.push({ id: 0, role: "user", name: "玩家", content: "动作离席前的对话" });
  actionLeaveConversation.nextId = 1;
  memoryStub.observeParticipants(actionLeaveConversation, [1, 2, 3], 0);
  actionLeaveConversation.removeCharacterFromConversation(npcB.id);
  assert.strictEqual(actionLeaveConversation.memoryState.participantPresence.find((window) => window.characterId === npcB.id).leftAtMessageId, 1, "动作脚本移除角色也必须关闭在场窗口");
  assert(actionLeaveConversation.departedCharacterIds.has(npcB.id));

  const prefixBefore = Conversation.buildPromptBlockMetadata({ blocks: [
    { block: { id: "anchor", type: "cache_anchor", label: "Anchor" }, content: "same", tokens: 1 },
    { block: { id: "presence", type: "presence_roster", label: "Current Presence" }, content: "甲", tokens: 1 },
    { block: { id: "current", type: "current_user", label: "Current" }, content: "第一句", tokens: 1 }
  ] });
  const prefixAfter = Conversation.buildPromptBlockMetadata({ blocks: [
    { block: { id: "anchor", type: "cache_anchor", label: "Anchor" }, content: "same", tokens: 1 },
    { block: { id: "presence", type: "presence_roster", label: "Current Presence" }, content: "甲、乙", tokens: 1 },
    { block: { id: "current", type: "current_user", label: "Current" }, content: "第二句", tokens: 1 }
  ] });
  assert.strictEqual(prefixBefore.prefixFingerprint, prefixAfter.prefixFingerprint, "在场名单变化不得改变 history 前冻结指纹");

  const preloadSource = fs.readFileSync(path.join(root, "resources", "app", "out", "preload", "preload.js"), "utf8");
  const ipcSource = fs.readFileSync(path.join(root, "resources", "app", "out", "main", "ipc", "register-ipc.js"), "utf8");
  const rendererSource = fs.readFileSync(path.join(root, "resources", "app", "out", "renderer", "assets", "index-Dn3qWlAB.js"), "utf8");
  assert(preloadSource.includes("joinWaitingCharacter") && preloadSource.includes("leavePresentCharacter"), "preload 必须公开入内和离场操作");
  assert(ipcSource.includes("conversation:joinWaitingCharacter") && ipcSource.includes("conversation:leavePresentCharacter"), "主进程必须注册入内和离场 IPC");
  assert(rendererSource.includes("请入内") && rendererSource.includes("请离场") && rendererSource.includes("设为候场"), "聊天 UI 必须提供候场、入内和离场按钮");

  console.log("VOTC v7.7.2 staged presence: PASS (waiting, join, leave, visible history, knowledge windows, pair projection and UI contracts)");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
