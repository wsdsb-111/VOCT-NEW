"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const { Conversation, tokenCountOrNull, formatMemoryContextOverflow } = require("../src/app/main/conversation/conversation");
const { createConversationManager } = require("../src/app/main/conversation/conversation-manager");
const { ConversationTurnManager } = require("../src/app/main/conversation/conversation-turn-manager");

function makeConversation() {
  const conversation = Object.create(Conversation.prototype);
  Object.assign(conversation, {
    id: "context-usage-conversation",
    conversationEpoch: 8,
    turnEpoch: 12,
    contextUsageByResponder: new Map(),
    contextUsageRevision: 0,
    contextUsageSceneRevision: null,
    gameData: { scene: "scene-a", location: "court-a", locationController: 4 },
    eventEmitter: new EventEmitter(),
    isResponseCurrent: responseState => responseState?.current === true
  });
  return conversation;
}

function makeUsageRow(conversation, overrides = {}) {
  return {
    conversationId: conversation.id,
    conversationEpoch: conversation.conversationEpoch,
    turnEpoch: conversation.turnEpoch,
    sceneRevision: conversation.contextUsageSceneRevision,
    responderId: 27,
    requestId: 91,
    responderName: "马蒂尔达",
    contextWindowTokens: 64000,
    inputTokens: 4000,
    outputTokens: 800,
    usedTokens: 4800,
    remainingContextTokens: 59200,
    phase: "completed",
    ...overrides
  };
}

function testUsageSnapshotScopeAndReset() {
  const conversation = makeConversation();
  const updates = [];
  conversation.onContextUsageUpdate(snapshot => updates.push(snapshot));
  assert.equal(conversation.resetContextUsageScene(), true);
  const sceneRevision = conversation.contextUsageSceneRevision;
  const responseState = { current: true };
  assert.equal(conversation.publishContextUsage(makeUsageRow(conversation), responseState), true);
  assert.equal(conversation.getContextUsageSnapshot().responders.length, 1);
  const initialUsageRevision = conversation.getContextUsageSnapshot().responders[0].usageRevision;
  assert.equal(initialUsageRevision, conversation.contextUsageRevision,
    "each responder update carries the monotonic snapshot revision for stable latest-request selection");

  assert.equal(conversation.publishContextUsage(makeUsageRow(conversation, { turnEpoch: 11 }), responseState), false,
    "a prior turn cannot publish into the current responder snapshot");
  assert.equal(conversation.publishContextUsage(makeUsageRow(conversation, { conversationEpoch: 7 }), responseState), false,
    "a prior conversation epoch cannot publish");
  assert.equal(conversation.publishContextUsage(makeUsageRow(conversation, { sceneRevision: "old-scene" }), responseState), false,
    "a prior scene cannot publish");
  assert.equal(conversation.publishContextUsage(makeUsageRow(conversation, { conversationId: "other-conversation" }), responseState), false,
    "a different conversation cannot publish");
  assert.equal(conversation.publishContextUsage(makeUsageRow(conversation), { current: false }), false,
    "a stale generation cannot publish");

  assert.equal(conversation.publishContextUsage(makeUsageRow(conversation, { phase: "streaming" }), responseState), true);
  assert(conversation.getContextUsageSnapshot().responders[0].usageRevision > initialUsageRevision,
    "stream updates advance the row revision monotonically");
  assert.equal(conversation.publishContextUsage(makeUsageRow(conversation, { phase: "cancelled" }), { current: false }), true,
    "a stale/cancelled generation may settle its still-latest request row");
  assert.equal(conversation.getContextUsageSnapshot().responders[0].phase, "cancelled");
  assert.equal(conversation.publishContextUsage(makeUsageRow(conversation, { requestId: 92, phase: "streaming" }), responseState), true);
  assert.equal(conversation.publishContextUsage(makeUsageRow(conversation, { phase: "failed" }), { current: false }), false,
    "a terminal update from an older request cannot replace a newer request row");
  assert.equal(conversation.publishContextUsage(makeUsageRow(conversation, { requestId: 92, turnEpoch: 11, phase: "cancelled" }), { current: false }), false,
    "terminal settlement remains scoped to the current turn");
  assert.equal(conversation.publishContextUsage(makeUsageRow(conversation, { requestId: 92, sceneRevision: "old-scene", phase: "cancelled" }), { current: false }), false,
    "terminal settlement remains scoped to the current scene");

  conversation.gameData.scene = "scene-b";
  assert.equal(conversation.resetContextUsageScene(), true);
  assert.notEqual(conversation.contextUsageSceneRevision, sceneRevision);
  assert.equal(conversation.getContextUsageSnapshot().responders.length, 0,
    "a scene change clears the previous per-responder rows");
  assert.equal(updates.at(-1).phase, "reset");

  const partialStub = Object.create(Conversation.prototype);
  assert.deepEqual(partialStub.getContextUsageSnapshot().responders, [], "narrow test stubs tolerate missing usage maps");
  assert.equal(partialStub.resetContextUsageScene(), true, "narrow test stubs tolerate missing emitters");
}

function testTurnBoundariesClearOldStreamingUsageBeforeCancellation() {
  const conversation = makeConversation();
  const updates = [];
  const cancellations = [];
  conversation.onContextUsageUpdate(snapshot => updates.push(snapshot));
  conversation.resetContextUsageScene();
  conversation.cancelActiveResponse = reason => cancellations.push({ reason, remainingRows: conversation.contextUsageByResponder.size });
  const turnManager = new ConversationTurnManager(conversation);
  const responseState = { current: true };
  conversation.publishContextUsage(makeUsageRow(conversation, { phase: "streaming" }), responseState);

  const turn = turnManager.startUserTurn({ playerMessageId: 41, playerCharacterId: 1, activeParticipantIds: [27],
    conversationId: conversation.id, sceneRevision: "scene-a", campaignToken: null });
  assert.equal(updates.at(-1).turnEpoch, turn.epoch);
  assert.equal(updates.at(-1).responders.length, 0, "a new player turn clears prior in-flight request rows");
  assert.deepEqual(cancellations.at(-1), { reason: "superseded_by_new_user_turn", remainingRows: 0 },
    "the old response is cancelled after stale UI rows are removed");

  conversation.publishContextUsage(makeUsageRow(conversation, { phase: "streaming" }), responseState);
  const regenerated = turnManager.startRegenerationTurn({ playerMessageId: 41, playerCharacterId: 1,
    conversationId: conversation.id, sceneRevision: "scene-a", campaignToken: null });
  assert(regenerated);
  assert.equal(updates.at(-1).turnEpoch, regenerated.epoch);
  assert.equal(updates.at(-1).responders.length, 0, "a regeneration boundary also clears the superseded stream row");
  assert.deepEqual(cancellations.at(-1), { reason: "superseded_by_regeneration", remainingRows: 0 });
}

function testOverflowFormattingAndUnknownUsage() {
  assert.equal(tokenCountOrNull(null), null, "missing usage is unknown, not zero");
  assert.equal(tokenCountOrNull("0"), null, "string usage is not treated as a provider-reported number");
  assert.equal(tokenCountOrNull(0), 0, "a real provider-reported zero remains valid");
  assert.equal(tokenCountOrNull(-1), null);

  const message = formatMemoryContextOverflow({
    requiredTokens: 96,
    availableTokens: 80,
    breakdown: { recent: 25, official: 8, ledger: 30, stable: 7, temporal: 12, thirdPerson: 14 }
  });
  for (const text of ["需要 96 Token", "可用 80 Token", "最近记忆 25", "官方追忆 8",
    "玩家关系事项簿 30", "稳定记忆 7", "时间记忆 12", "第三人记忆 14", "未发送给服务商"]) {
    assert(message.includes(text), `overflow text must include ${text}`);
  }
}

function testManagerRejectsDetachedConversationEvents() {
  let nextId = 0;
  class FakeConversation {
    constructor({ conversationEpoch }) {
      this.id = `manager-conversation-${++nextId}`;
      this.conversationEpoch = conversationEpoch;
      this.turnEpoch = 0;
      this.contextUsageRevision = 0;
      this.contextUsageByResponder = new Map();
      this.events = new EventEmitter();
    }
    onConversationUpdate(callback) { this.events.on("conversation", callback); }
    onContextUsageUpdate(callback) { this.events.on("context", callback); }
    getContextUsageSnapshot(phase = "snapshot") {
      return { conversationId: this.id, conversationEpoch: this.conversationEpoch,
        turnEpoch: this.turnEpoch, sceneRevision: null, revision: this.contextUsageRevision,
        phase, responders: [...this.contextUsageByResponder.values()] };
    }
    emitContext(snapshot) { this.events.emit("context", snapshot); }
    finalizeConversation() { return Promise.resolve({ success: true }); }
  }
  class FinalizationCoordinator {
    enqueue(_id, finalize) { return Promise.resolve(finalize()); }
    drain() { return Promise.resolve(); }
  }
  const ConversationManager = createConversationManager({ events: { EventEmitter }, memorySystem: { FinalizationCoordinator },
    Conversation: FakeConversation, PromptBuilder: {}, createActionFeedback: () => ({}), logVerboseLLM: () => {} });
  const manager = new ConversationManager();
  const updates = [];
  manager.onContextUsageUpdate(snapshot => updates.push(snapshot));
  const first = manager.createConversation();
  const second = manager.createConversation();
  const latest = updates.at(-1);
  first.emitContext({ ...first.getContextUsageSnapshot("update"), revision: 99, phase: "completed",
    responders: [{ responderId: 27, responderName: "旧会话角色" }] });
  assert.equal(updates.at(-1), latest, "a detached conversation cannot repopulate the current UI snapshot");
  assert.equal(manager.getContextUsageSnapshot().conversationId, second.id);
}

function testRendererAndBridgeExposeInlineContextAndOverflow() {
  const renderer = fs.readFileSync(path.join(__dirname, "../src/app/renderer/assets/index-Dn3qWlAB.js"), "utf8");
  const css = fs.readFileSync(path.join(__dirname, "../src/app/renderer/ui-comfort.css"), "utf8");
  const preload = fs.readFileSync(path.join(__dirname, "../src/app/preload/preload.js"), "utf8");
  assert(renderer.includes('const VOTC_FEATURE_VERSION = "V9.3.9"'));
  assert(renderer.includes("ContextUsageIndicator"));
  assert(renderer.includes("inputHeadroomBeforeSendTokens"));
  assert(renderer.includes("memory-budget-overflow-grid"));
  assert(renderer.includes("用户设置，未经服务商确认"));
  assert(renderer.includes("本场对话上下文") && renderer.includes("本次回应者："));
  assert(renderer.includes("const row = responders[0]") && renderer.includes("usageRevision"),
    "the inline UI selects one latest responder request using its monotonic row revision");
  assert(renderer.includes("本次请求输入（完整 Prompt）"),
    "the input count describes the whole outgoing prompt, not only player-entered text");
  assert(!renderer.includes("按各人物最近一次请求"), "the main UI no longer presents separate NPC context windows");
  assert(css.includes(".context-usage-indicator") && css.includes("max-height: min(18vh, 104px)"),
    "the indicator remains in normal flow with constrained height");
  assert(preload.includes('"conversation:getContextUsage"') && preload.includes('"conversation:contextUsageUpdated"'));
}

function main() {
  testUsageSnapshotScopeAndReset();
  testTurnBoundariesClearOldStreamingUsageBeforeCancellation();
  testOverflowFormattingAndUnknownUsage();
  testManagerRejectsDetachedConversationEvents();
  testRendererAndBridgeExposeInlineContextAndOverflow();
  console.log("V9.3.8 context usage UI/runtime scope checks passed.");
}

main();
