"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const path = require("node:path");
const { Conversation } = require("../src/app/main/conversation/conversation");
const { ConversationTurnManager } = require("../src/app/main/conversation/conversation-turn-manager");
const { GenerationManager } = require("../src/app/main/conversation/generation-manager");
const { createEffectiveRequestSnapshot, fingerprintMessages } = require("../src/app/main/providers/effective-request");
const { createFixture, createPromptRuntime } = require("./fixtures/v9.4/legacy-layout-fixtures");

const mainDir = path.resolve(__dirname, "../src/app/main");
const fingerprint = value => crypto.createHash("sha256").update(String(value || ""), "utf8").digest("hex");
const REWRITE_INSTRUCTION = "请只重新表达你在本轮的最后一条台词，不要续写新一轮，也不要重新回应其后的发言。已经发生的游戏动作及其结果保持不变；不得撤销、重复或新增动作，只输出替换台词。";
const CONTINUATION_INSTRUCTION = "请从刚才截断的位置继续完成上一条回复，不要重复已写内容。";

function makeConversation({ scenario = "rewrite", initialOutcome = null, mutateBeforeGuard = null } = {}) {
  const fixture = createFixture("v813-success-frozen");
  const runtime = createPromptRuntime(mainDir, fixture);
  const npc = fixture.responder;
  const memoryContext = {
    ...fixture.memoryContext,
    conversationId: "v94-main-chain-conversation",
    characterKnowledgeRevision: "knowledge-fixture-r1",
    sourceSceneRevision: JSON.stringify([fixture.gameData.scene || null, fixture.gameData.location || null,
      fixture.gameData.locationController || null]),
    tokenBudget: 10000
  };
  const original = { id: 11, role: "assistant", speakerCharacterId: npc.id,
    name: npc.fullName, content: "最初的台词。" };
  const conversation = Object.create(Conversation.prototype);
  Object.assign(conversation, {
    id: memoryContext.conversationId,
    conversationEpoch: 4,
    nextId: 12,
    isActive: true,
    isPaused: false,
    gameData: fixture.gameData,
    messages: [
      { id: 10, role: "user", speakerCharacterId: fixture.gameData.playerID, content: "请谈谈此事。" },
      original
    ],
    npcQueue: [],
    pendingActionApprovals: new Map(),
    generationAttemptsByMessageId: new Map(),
    memoryAttemptDiagnosticsByOwner: new Map(),
    dynamicRecallHistory: new Map(),
    memoryState: { rollingState: { segments: [] }, responderRecallCache: new Map() },
    contextBudgetDiagnostics: {},
    cacheV2FrozenSnapshots: memoryContext.cacheV2FrozenSnapshots
  });
  const turnManager = new ConversationTurnManager(conversation);
  const generationManager = new GenerationManager(conversation);
  conversation.runtime = { turnManager, generationManager };
  const sceneRevision = JSON.stringify([fixture.gameData.scene || null, fixture.gameData.location || null,
    fixture.gameData.locationController || null]);
  turnManager.startUserTurn({ playerMessageId: 10, activeParticipantIds: [fixture.gameData.playerID, npc.id],
    playerCharacterId: fixture.gameData.playerID, conversationId: conversation.id, sceneRevision,
    campaignToken: fixture.gameData.campaignToken });

  let knowledgeRevision = memoryContext.characterKnowledgeRevision;
  const counts = { requestCalls: 0, transportCalls: 0, requests: [], initialSerializedMessages: null,
    initialSourceRefs: null, continuationExtra: null, retained: [] };
  conversation.emitUpdate = () => {};
  conversation.isCharacterAvailableForConversation = () => true;
  conversation.getNpcList = () => [npc];
  conversation.getPromptHistoryForCharacter = () => conversation.getHistory();
  conversation.getPromptSummaryForCharacter = () => fixture.currentSessionSummary;
  conversation.checkAndSummarizeIfNeeded = async () => memoryContext;
  conversation.estimateTokenCount = messages => runtime.TokenCounter.calculateTotalTokens(messages);
  conversation.getCharacterDisclosureContext = () => ({ characterKnowledgeRevision: knowledgeRevision });
  conversation.retainDynamicSummaryRecall = (...args) => { counts.retained.push(args); };
  conversation.recordCharacterDisclosures = () => {};
  conversation.publishContextUsage = () => {};
  conversation.resetContextUsageScene = () => {};
  conversation.scheduleActionConfirmation = () => {};

  const settingsRepository = {
    getActiveProviderConfig: () => ({ providerType: "openai-compatible", defaultModel: "synthetic-v94" }),
    getGlobalStreamSetting: () => false,
    getChatPromptV813Layout: () => true,
    getGenerateFollowingMessagesSetting: () => true,
    getPauseOnRegenerationSetting: () => false,
    getActionApprovalSettings: () => ({ pauseOnApproval: false })
  };
  const memoryEngine = {
    trace: { record() {} },
    validatePlayerMemoryContext: () => ({ valid: true, reason: null })
  };
  const llmSpy = {
    async sendChatRequest(messages, _signal, _noStream, metadata) {
      counts.requestCalls += 1;
      counts.requests.push({ messages, metadata });
      const proof = metadata.promptPlanProof;
      assert(proof?.plan && proof?.serialized, "respondAs must pass the actual PromptBuilder Plan to its LLM boundary");
      assert.equal(proof.plan.layoutId, "v813", "the injected real PromptBuilder must use this deterministic V813 fixture");

      if (counts.requestCalls === 1) {
        counts.initialSerializedMessages = JSON.parse(JSON.stringify(proof.serialized.messages));
        counts.initialSourceRefs = proof.plan.blocks.map(block => [block.id, [...block.permission.sourceRefs]]);
        const rewriteBlock = proof.plan.blocks.find(block => block.id === "narration-rewrite-instruction");
        assert(rewriteBlock, "the narration rewrite instruction must be a semantic Plan block");
        assert.deepEqual(rewriteBlock.messages, [{ role: "user", content: REWRITE_INSTRUCTION }]);
        assert(proof.serialized.messages.some(message => message.role === "user" && message.content === REWRITE_INSTRUCTION),
          "the exact regeneration-only instruction must reach the serialized prompt");
      } else {
        assert.equal(metadata.requestType, "chat_continuation", "a truncated narration must use the bounded continuation request");
        assert.deepEqual(messages.slice(0, counts.initialSerializedMessages.length), counts.initialSerializedMessages,
          "continuation must preserve every original PromptBuilder message byte-for-byte and in order");
        const extra = messages.slice(counts.initialSerializedMessages.length);
        counts.continuationExtra = extra;
        assert.deepEqual(extra, [
          { role: "assistant", content: "截断片段 fixture。" },
          { role: "user", content: CONTINUATION_INSTRUCTION }
        ], "the continuation contains only its new current-turn messages after the original prefix");
        const extension = proof.plan.blocks.find(block => block.kind === "CURRENT_TURN"
          && block.id.startsWith("continuation-current-turn-"));
        assert(extension, "the continuation messages need their own current-turn Plan block");
        assert.deepEqual(extension.messages, extra, "the Plan must declare both continuation messages");
        assert.deepEqual(proof.serialized.messages, messages, "the continuation Plan serialization must equal the outbound messages");
        assert.deepEqual(proof.plan.blocks.filter(block => !block.id.startsWith("continuation-current-turn-"))
          .map(block => [block.id, block.permission.sourceRefs]), counts.initialSourceRefs,
        "extending the proof must preserve every original source reference");
      }

      if (mutateBeforeGuard) mutateBeforeGuard({ fixture, conversation, memoryContext,
        setKnowledgeRevision: value => { knowledgeRevision = value; } });
      const snapshot = createEffectiveRequestSnapshot({
        requestType: metadata.requestType,
        providerType: "openai-compatible",
        protocol: "openai_chat_completions",
        endpoint: "https://fixture.invalid/v1/chat/completions",
        stream: false,
        payload: { model: "synthetic-v94", messages, stream: false, max_tokens: 128 },
        adapterInputMessagesFingerprint: fingerprintMessages(messages),
        planStatus: "PROMPT_PLAN_V9",
        ownerEvidence: "PRESENT"
      });
      assert.equal(metadata.beforeTransportGuard(snapshot, proof, { safe: true }).ok, true,
        "real respondAs proof must pass its pre-transport preflight when sources remain current");
      counts.transportCalls += 1;

      if (scenario === "continuation" && counts.requestCalls === 1) {
        return { content: "截断片段 fixture。", finish_reason: "length" };
      }
      return { content: counts.requestCalls === 1 ? "重写后的台词。" : "补充完成。", finish_reason: "stop" };
    }
  };

  Conversation.configure({
    memoryEngine,
    PromptBuilder: runtime.PromptBuilder,
    TokenCounter: runtime.TokenCounter,
    createPromptFingerprint: fingerprint,
    createMessage: fields => ({ type: "message", ...fields }),
    createError: fields => ({ type: "error", ...fields }),
    createActionFeedback: fields => ({ type: "action-feedback", ...fields }),
    settingsRepository,
    llmManager: llmSpy,
    ActionEngine: { async evaluateForCharacter() { throw new Error("narration rewrite must not re-run actions"); } },
    usageAnalytics: { record() {} },
    logVerboseLLM() {}
  });
  return { fixture, runtime, conversation, npc, original, counts, setKnowledgeRevision: value => { knowledgeRevision = value; } };
}

async function runRewriteCase() {
  const state = makeConversation();
  const result = await state.conversation.respondAs(state.npc, state.conversation.turnEpoch,
    { narrationRewriteOf: state.original.id });
  assert.deepEqual(result, { success: true, mode: "NARRATION_ONLY" });
  assert.equal(state.original.content, "重写后的台词。");
  assert.equal(state.counts.requestCalls, 1);
  assert.equal(state.counts.transportCalls, 1);
  assert.equal(state.counts.retained.length, 1, "a complete response reaches the memory success callback exactly once");
  assert.equal(state.counts.retained[0][2].promptPlanMode, "v9");
}

async function runContinuationCase() {
  const state = makeConversation({ scenario: "continuation" });
  const result = await state.conversation.respondAs(state.npc, state.conversation.turnEpoch,
    { narrationRewriteOf: state.original.id });
  assert.deepEqual(result, { success: true, mode: "NARRATION_ONLY" });
  assert.equal(state.original.content, "截断片段 fixture。补充完成。");
  assert.equal(state.counts.requestCalls, 2);
  assert.equal(state.counts.transportCalls, 2);
  assert.equal(state.counts.retained.length, 1, "partial continuation attempts do not commit their own memory receipts");
}

async function runRevocationCase(kind) {
  const mutateBeforeGuard = ({ fixture, setKnowledgeRevision }) => {
    if (kind === "date") fixture.gameData.date = "1175.6.15";
    else setKnowledgeRevision("knowledge-fixture-r2");
  };
  const state = makeConversation({ mutateBeforeGuard });
  const result = await state.conversation.respondAs(state.npc, state.conversation.turnEpoch,
    { narrationRewriteOf: state.original.id });
  assert.equal(result.success, false, `${kind}: stale source must leave narration unchanged`);
  assert.equal(state.original.content, "最初的台词。", `${kind}: no stale rewrite may commit`);
  assert.equal(state.counts.requestCalls, 1, `${kind}: no fallback request may be attempted`);
  assert.equal(state.counts.transportCalls, 0, `${kind}: pre-send source revocation must prevent outbound transport`);
  assert.equal(state.counts.retained.length, 0, `${kind}: failed requests cannot invoke the memory success callback`);
}

(async () => {
  await runRewriteCase();
  await runContinuationCase();
  await runRevocationCase("date");
  await runRevocationCase("knowledge");
  console.log("PASS V9.4 Conversation Plan main chain (real PromptBuilder, narration instruction block, proof-preserving continuation, date and knowledge revocation before transport)");
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
