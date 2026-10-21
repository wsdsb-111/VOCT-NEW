"use strict";

const assert = require("node:assert/strict");
const { Conversation } = require("../src/app/main/conversation/conversation");
const { ConversationTurnManager } = require("../src/app/main/conversation/conversation-turn-manager");
const { GenerationManager } = require("../src/app/main/conversation/generation-manager");

function fixture({ stream = false, failRewrite = false, revokeBeforeSend = false, supersede = false } = {}) {
  const npc = { id: 2, fullName: "测试乙", shortName: "乙" };
  const c = Object.create(Conversation.prototype);
  Object.assign(c, {
    id: "v9393-narration", conversationEpoch: 1, nextId: 11, isActive: true, isPaused: false,
    gameData: { playerID: 1, campaignToken: "v9393-campaign", date: "1200.1.1", totalDays: 100,
      scene: "scene", location: "room", locationController: 1, characters: new Map([[2, npc]]) },
    messages: [{ id: 10, role: "user", speakerCharacterId: 1, content: "你好。" }],
    npcQueue: [], pendingActionApprovals: new Map(), generationAttemptsByMessageId: new Map(),
    memoryAttemptDiagnosticsByOwner: new Map(), dynamicRecallHistory: new Map(),
    cacheV2FrozenSnapshots: { prefixByResponder: new Map() },
    memoryState: { rollingState: { segments: [] }, responderRecallCache: new Map() },
    contextBudgetDiagnostics: {}
  });
  const turns = new ConversationTurnManager(c);
  const generation = new GenerationManager(c);
  c.runtime = { turnManager: turns, generationManager: generation };
  const sceneRevision = JSON.stringify(["scene", "room", 1]);
  turns.startUserTurn({ playerMessageId: 10, activeParticipantIds: [1, 2], playerCharacterId: 1,
    conversationId: c.id, sceneRevision, campaignToken: c.gameData.campaignToken });
  c.emitUpdate = () => {};
  c.getNpcList = () => [npc];
  c.isCharacterAvailableForConversation = () => true;
  c.getPromptHistoryForCharacter = () => c.getHistory();
  c.getPromptSummaryForCharacter = () => "";
  c.checkAndSummarizeIfNeeded = async () => ({ playerCenteredRecallEnabled: true, tokenBudget: 1000 });
  c.estimateTokenCount = messages => Math.ceil(JSON.stringify(messages).length / 4);
  c.recordCharacterDisclosures = () => {};
  c.retainDynamicSummaryRecall = () => {};
  const counts = { requests: 0, actions: 0, confirmations: 0, prompts: [] };
  let validSources = true;
  c.scheduleActionConfirmation = () => { counts.confirmations += 1; };
  Conversation.configure({
    memoryEngine: { trace: { record() {} }, validatePlayerMemoryContext: () => ({ valid: validSources, reason: "FORGOTTEN" }) },
    PromptBuilder: {
      buildMessagesWithTokenCount: (history, _npc, _gameData, _summary, _memoryContext, _provider, options = {}) => ({
        messages: [
          ...history.map(({ role, content }) => ({ role, content })),
          ...(options.currentTurnInstructions ? [{ role: "user", content: options.currentTurnInstructions }] : [])
        ],
        blocks: []
      }),
      getMemoryBlockTokenCount: () => 0
    },
    TokenCounter: { estimateTokens: text => Math.ceil(String(text).length / 4) },
    createPromptFingerprint: text => String(text),
    createMessage: fields => ({ ...fields, type: "message" }),
    createError: fields => ({ ...fields, type: "error" }),
    createActionFeedback: fields => ({ ...fields, type: "action-feedback" }),
    settingsRepository: {
      getActiveProviderConfig: () => ({ providerType: "openai-compatible" }),
      getGlobalStreamSetting: () => stream,
      getChatPromptV813Layout: () => false,
      getGenerateFollowingMessagesSetting: () => true,
      getPauseOnRegenerationSetting: () => false,
      getActionApprovalSettings: () => ({ pauseOnApproval: false })
    },
    llmManager: { async sendChatRequest(messages, _signal, _noStream, metadata) {
      if (revokeBeforeSend && counts.requests === 1) validSources = false;
      metadata.beforeSendGuard();
      counts.requests += 1;
      counts.prompts.push(messages);
      if (failRewrite && counts.requests === 2) throw new Error("synthetic transport failure");
      if (supersede && counts.requests === 2) {
        c.messages.push({ id: c.nextId++, role: "user", speakerCharacterId: 1, content: "下一轮。" });
        turns.startUserTurn({ playerMessageId: c.messages.at(-1).id, activeParticipantIds: [1, 2],
          playerCharacterId: 1, conversationId: c.id, sceneRevision, campaignToken: c.gameData.campaignToken });
      }
      const content = counts.requests === 1 ? "原台词。" : "重写台词。";
      if (stream) return (async function* () {
        yield { delta: { content } };
        return { content, finish_reason: "stop" };
      })();
      return { content, finish_reason: "stop" };
    } },
    ActionEngine: { async evaluateForCharacter() {
      counts.actions += 1;
      return { autoApproved: [{ actionId: "opinion", success: true,
        feedback: { message: "既有动作结果", sentiment: "neutral" }, lifecycle: "ACKNOWLEDGED" }], needsApproval: [] };
    } },
    usageAnalytics: { record() {} }, logVerboseLLM() {}
  });
  return { c, npc, counts };
}

async function runCase(options = {}) {
  const { c, npc, counts } = fixture(options);
  await c.respondAs(npc);
  const original = c.messages.find(message => message.role === "assistant");
  const feedback = c.messages.find(message => message.type === "action-feedback");
  assert(original && feedback, "the real completed response must have an actual action feedback entry");
  assert.equal(c.generationAttemptsByMessageId.get(original.id).hasActionOutcome, true);
  const originalId = original.id;
  const feedbackBytes = JSON.stringify(feedback);
  const turnBefore = c.getTurnManager().currentTurn;
  c.isPaused = true;
  const queue = [...c.npcQueue];
  const result = await c.regenerateMessage(originalId);
  if (options.revokeBeforeSend || options.supersede || options.failRewrite) {
    assert.equal(result.success, false, "failed or superseded narration cannot commit");
    assert.equal(original.content, "原台词。", "the original response survives failed rewrites");
    if (options.failRewrite) {
      const error = c.messages.find(message => message.type === "error");
      assert.equal(c.generationAttemptsByMessageId.get(error.id).narrationRewriteOf, originalId);
      const retry = await c.regenerateError(error.id);
      assert.equal(retry.success, true, "error retry must stay narration-only");
      assert.equal(original.content, "重写台词。");
    }
  } else {
    assert.equal(result.success, true, "a current reply with completed actions must allow narration-only regeneration");
    assert.equal(result.mode, "NARRATION_ONLY");
    assert.equal(original.content, "重写台词。");
    assert.equal(original.id, originalId);
    assert.equal(c.messages.filter(message => message.role === "assistant").length, 1);
    assert.equal(c.messages.filter(message => message.role === "user").length, 1);
    assert.deepEqual(c.npcQueue, queue);
    assert.equal(c.isPaused, true, "text-only regeneration preserves the queue pause state");
    assert.equal(c.getTurnManager().currentTurn, turnBefore, "text-only regeneration does not create a player turn");
    assert.match(counts.prompts.at(-1).at(-1).content, /不.*动作|不得.*动作/u);
  }
  assert.equal(counts.actions, 1, "rewrites and failed-rewrite retries must never re-evaluate or dispatch actions");
  assert.equal(counts.confirmations, 1, "an existing ACK/readback must never be scheduled again");
  assert.equal(c.messages.find(message => message.id === feedback.id), feedback);
  assert.equal(JSON.stringify(feedback), feedbackBytes, "the original feedback and ACK status remain byte-identical");
  if (options.revokeBeforeSend) assert.equal(counts.requests, 1, "Forget/source invalidation blocks before transport");
}

(async () => {
  await runCase();
  await runCase({ stream: true });
  await runCase({ failRewrite: true });
  await runCase({ revokeBeforeSend: true });
  await runCase({ supersede: true });
  console.log("V9.3.9.3 narration regeneration: PASS (actual respondAs, action/ACK preservation, streaming, failure retry, Forget and superseded turn)");
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
