"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { normalizeGameDate } = require("../src/app/main/worldline/character-temporal-facts");
const {
  createAdversarialFixtureData,
  createFixtureEngine,
  makeCandidateRequest,
  makePromptRuntime,
  seedAdversarialFixture
} = require("./test-v9.3.6-independent-qa");
const { Conversation } = require("../src/app/main/conversation/conversation");
const { LLMManager, TokenCounter } = require("../src/app/main/provider-service");

const names = new Map([[1, "甲"], [2, "乙"], [3, "玛蒂尔达"]]);

function makeSummary(fixture, ownerId, counterpartId, finalizationId, matter, date = "1199.1.1") {
  return {
    date,
    totalDays: normalizeGameDate(date).serial,
    content: `RB_SOURCE_${finalizationId}：最近对话记录。\n\n【需要长期记住的事项】\n- ${matter}\n【其他事项】\n仅用于隔离合成 QA。`,
    playerId: ownerId,
    playerName: names.get(ownerId),
    characterId: counterpartId,
    characterName: names.get(counterpartId),
    perspectiveOwnerId: ownerId,
    campaignToken: fixture.campaignToken,
    campaignBinding: { status: "bound", source: "qa_fixture", version: 1 },
    finalizationId,
    conversationId: "conversation-" + finalizationId,
    conversationType: "pair",
    participants: [{ id: ownerId, name: names.get(ownerId) }, { id: counterpartId, name: names.get(counterpartId) }]
  };
}

function makeResponderFixture() {
  const fixture = createAdversarialFixtureData();
  fixture.pairSummaries = [
    { ownerId: 2, counterpartId: 1, summaries: [makeSummary(fixture, 2, 1, "rb-b-player", "RB_B_PLAYER_ANCHOR_SENTINEL：乙对甲的固定事项。重视玩家关系。這段用于预算测试。")] },
    { ownerId: 2, counterpartId: 3, summaries: [makeSummary(fixture, 2, 3, "rb-b-c", "RB_B_TO_C_HISTORY_SENTINEL：乙与玛蒂尔达核对了边境税收安排。")] },
    { ownerId: 3, counterpartId: 1, summaries: [makeSummary(fixture, 3, 1, "rb-c-player", "RB_C_PLAYER_ANCHOR_SENTINEL：玛蒂尔达对甲的固定事项。她记得共同核对账册。") ] },
    { ownerId: 3, counterpartId: 2, summaries: [makeSummary(fixture, 3, 2, "rb-c-b-private", "RB_C_TO_B_PRIVATE_SENTINEL：玛蒂尔达对乙的私人事项。") ] }
  ];
  return fixture;
}

const profiles = [
  { id: 1, name: "甲", aliases: ["甲"] },
  { id: 2, name: "乙", aliases: ["乙"] },
  { id: 3, name: "玛蒂尔达", aliases: ["玛蒂尔达"] }
];

function retrieve(engine, fixture, responderId, conversationId, sessionRecallCache, tokenBudget, turnEpoch = 7) {
  return engine.retrieveForResponder(makeCandidateRequest(fixture, "relationship", {
    characterId: responderId,
    playerContent: "你还记得玛蒂尔达吗？",
    entityProfiles: profiles,
    conversationId,
    sceneRevision: "rb-scene-1",
    turnEpoch,
    activeParticipantIds: [1, 2, 3],
    sessionRecallCache,
    tokenBudget,
    estimateTokens: value => TokenCounter.estimateTokens(String(value || "")),
    estimateMessageTokens: message => TokenCounter.estimateMessageTokens(message)
  }));
}

function checkFrozenBudgetPolicy() {
  const conversation = Object.create(Conversation.prototype);
  conversation.frozenMemoryBudget = null;
  assert.equal(conversation.getMemoryTokenBudget(262144, [1, 2], 100000), 80000,
    "two-person memory budget freezes at its 80000-token cap");
  assert.equal(conversation.getMemoryTokenBudget(1048576, [1, 2, 3, 4], 100000), 80000,
    "later participants cannot silently raise the first frozen tier");
  assert.equal(conversation.frozenMemoryBudget.participantCount, 2);
  assert.equal(conversation.getMemoryTokenBudget(1048576, [1, 2, 3, 4], 1200), 1200,
    "reduced Provider headroom still tightens a frozen allocation");
  assert.equal(conversation.getMemoryTokenBudget(1048576, [1, 2, 3, 4], 100000), 80000,
    "restored headroom cannot expand beyond the frozen tier");

  const fourPersonConversation = Object.create(Conversation.prototype);
  fourPersonConversation.frozenMemoryBudget = null;
  assert.equal(fourPersonConversation.getMemoryTokenBudget(1048576, [1, 2, 3, 4], 100000), 96000,
    "a separate conversation that starts with four participants may use the 96000-token cap");
}

function checkResponderIsolationAndPromptBudget() {
  const fixture = makeResponderFixture();
  const test = createFixtureEngine("v9361-responder-isolation");
  try {
    seedAdversarialFixture(test.engine, fixture);
    const sessionRecallCache = new Map();
    const b = retrieve(test.engine, fixture, 2, "rb-shared-conversation", sessionRecallCache, 4800);
    assert.equal(b.thirdPersonDecision.level, "L1", "B may use the current player's explicit C-history question");
    assert(b.directStableText.includes("RB_B_PLAYER_ANCHOR_SENTINEL"), "B's fixed Recent1 is B→Player");
    assert(b.temporalExtraText?.includes("RB_B_TO_C_HISTORY_SENTINEL"), "B's authorized dynamic context may use B→C");

    const c = retrieve(test.engine, fixture, 3, "rb-shared-conversation", sessionRecallCache, 4800);
    assert.equal(c.thirdPersonDecision.level, "L0", "C cannot inherit B's dynamic target binding");
    assert(c.directStableText.includes("RB_C_PLAYER_ANCHOR_SENTINEL"), "C's first fixed history is C→Player");
    assert(!c.directStableText.includes("RB_B_PLAYER_ANCHOR_SENTINEL"), "C cannot inherit B's frozen Recent1");
    assert(!c.playerLedgerFrozenText?.includes("RB_C_TO_B_PRIVATE_SENTINEL"), "C→B history is not C→Player history");
    assert(!JSON.stringify(c).includes("RB_B_TO_C_HISTORY_SENTINEL"), "C cannot inherit B's B→C snapshot");
    assert.notEqual(c.baselineSnapshotId, b.baselineSnapshotId, "each responder gets its own frozen snapshot identity");
    assert.equal(sessionRecallCache.get(3)?.historyBinding ?? null, null,
      "B's history authorization must remain under B's responder cache key");

    const runtime = makePromptRuntime();
    const bPrompt = runtime.build("normal", b, 2);
    const cPrompt = runtime.build("normal", c, 3);
    assert(runtime.builder.getMemoryBlockTokenCount(bPrompt) <= b.tokenBudget,
      "B's complete rendered memory stays within the same retrieved budget");
    assert(runtime.builder.getMemoryBlockTokenCount(cPrompt) <= c.tokenBudget,
      "C's complete rendered memory stays within the same retrieved budget");
    assert(bPrompt.messages.some(message => String(message.content).includes("RB_B_PLAYER_ANCHOR_SENTINEL")));
    assert(cPrompt.messages.some(message => String(message.content).includes("RB_C_PLAYER_ANCHOR_SENTINEL")));
    assert(!cPrompt.messages.some(message => String(message.content).includes("RB_B_TO_C_HISTORY_SENTINEL")));

    const lowBudget = test.engine.retrieveForResponder(makeCandidateRequest(fixture, "nameOnly", {
      characterId: 2,
      playerContent: "玛蒂尔达刚刚走了。",
      entityProfiles: profiles,
      conversationId: "rb-shared-conversation",
      sceneRevision: "rb-scene-1",
      turnEpoch: 8,
      activeParticipantIds: [1, 2, 3],
      sessionRecallCache,
      tokenBudget: 240,
      estimateTokens: value => TokenCounter.estimateTokens(String(value || "")),
      estimateMessageTokens: message => TokenCounter.estimateMessageTokens(message)
    }));
    const lowPrompt = runtime.build("normal", lowBudget, 2);
    assert(lowBudget.pairMemoryMetrics.finalInjectedTokens <= 240,
      "a cache reuse after Provider headroom falls cannot overfill the reduced budget");
    assert(runtime.builder.getMemoryBlockTokenCount(lowPrompt) <= 240,
      "the final PromptBuilder rendering also fits the reduced memory budget");
    return { bLevel: b.thirdPersonDecision.level, cLevel: c.thirdPersonDecision.level,
      responderSnapshotsDistinct: b.baselineSnapshotId !== c.baselineSnapshotId,
      bPromptTokens: runtime.builder.getMemoryBlockTokenCount(bPrompt),
      cPromptTokens: runtime.builder.getMemoryBlockTokenCount(cPrompt), lowPromptTokens: runtime.builder.getMemoryBlockTokenCount(lowPrompt) };
  } finally {
    test.cleanup();
  }
}

function memoryMetadata(memoryText) {
  const fingerprint = crypto.createHash("sha256").update(memoryText, "utf8").digest("hex").slice(0, 16);
  return {
    memoryBudgetTokens: 128,
    renderedMemoryTokens: 32,
    blocks: [{ id: "memory-player-ledger-frozen", type: "memory_player_ledger_frozen",
      messageStartPosition: 0, messageCount: 1, tokens: 16, fingerprint }]
  };
}

function makeGuardedLlmManager() {
  const settingsRepository = {
    getActiveProviderConfig: () => ({ providerType: "openai-compatible", customName: "fixture",
      defaultModel: "synthetic-model", defaultParameters: { max_tokens: 128 } }),
    getGlobalStreamSetting: () => true,
    getChatPromptV89Settings: () => ({ chatPromptV89OutboundDiagnostics: false })
  };
  const manager = new LLMManager({ settingsRepository, providerRegistry: {}, usageAnalytics: null,
    TokenCounter, PromptBuilder: null });
  const capabilities = { providerType: "openai-compatible", modelId: "synthetic-model",
    contextWindow: 1024, maxOutputTokens: 128 };
  const sent = [];
  const controls = [];
  let capabilityResolver = null;
  manager.getProviderInstance = () => ({ synthetic: true });
  manager.getProviderCapabilities = () => capabilityResolver
    ? new Promise(resolve => { capabilityResolver = resolve; })
    : Promise.resolve(capabilities);
  manager.releaseCapabilities = () => {
    const release = capabilityResolver;
    capabilityResolver = null;
    release?.(capabilities);
  };
  manager.createControl = (_config, _route, _signal, metadata) => {
    const control = {
      requestType: metadata.requestType || "chat",
      check: () => metadata.beforeSendGuard?.(),
      dispose() {}
    };
    controls.push(control);
    return control;
  };
  manager.generate = (_provider, request, _config, _resolved, control) => {
    control.check();
    sent.push({ requestType: control.requestType, messages: request.messages });
    return Promise.resolve({ content: "续写完成。", finish_reason: "stop" });
  };
  manager.trackUsage = promise => promise;
  return { manager, sent, controls, capabilities, setCapabilityResolver(value) { capabilityResolver = value; } };
}

async function checkStreamingContinuationGuard() {
  const guarded = makeGuardedLlmManager();
  Conversation.configure({ llmManager: guarded.manager });
  const conversation = Object.create(Conversation.prototype);
  conversation.id = "rb-stream-continuation";
  conversation.isResponseCurrent = () => true;
  const responseState = { controller: new AbortController() };
  const npc = { id: 2 };
  const memoryText = "预算冻结的记忆块。";
  const metadata = memoryMetadata(memoryText);
  const originalMessages = [
    { role: "system", content: memoryText },
    { role: "user", content: "请回答宫廷问题。" }
  ];

  const completed = await conversation.completeTruncatedResponse(originalMessages, "前半段已经输出。",
    responseState, npc, null, metadata);
  assert.equal(completed, "前半段已经输出。续写完成。", "a valid LENGTH continuation appends only its new text");
  assert.equal(guarded.sent.length, 1, "the synthetic Provider transport receives the validated continuation once");
  assert.equal(guarded.sent[0].requestType, "chat_continuation");
  assert(guarded.sent[0].messages.some(message => message.role === "assistant" && message.content === "前半段已经输出。"));
  assert(guarded.sent[0].messages.some(message => message.role === "user" && message.content.includes("从刚才截断的位置继续")));

  const safeMemoryText = "预算冻结的记忆块。";
  const mutationMessages = [
    { role: "system", content: safeMemoryText },
    { role: "user", content: "简短问题。" }
  ];
  guarded.setCapabilityResolver(() => {});
  const mutation = guarded.manager.sendChatRequest(mutationMessages, responseState.controller.signal, true,
    memoryMetadata(safeMemoryText));
  await Promise.resolve();
  mutationMessages[0].content += "在 capability lookup 期间发生了变化";
  guarded.manager.releaseCapabilities();
  await assert.rejects(mutation, /chat_memory_budget_request_changed_before_send/,
    "a changed frozen memory block must be rejected at the actual beforeSend guard");
  assert.equal(guarded.sent.length, 1, "a beforeSend rejection must make no Provider transport call");

  await assert.rejects(conversation.completeTruncatedResponse(originalMessages, "長".repeat(5000),
    responseState, npc, null, metadata), /chat_request_budget_exceeded/,
  "a grown streaming continuation is re-budgeted against the full context before transport");
  assert.equal(guarded.sent.length, 1, "an over-context continuation must not reach Provider transport");
  return { safeContinuationTransportCalls: 1, mutationRejectedBeforeSend: true,
    oversizedContinuationRejected: true, maximumContextWindow: guarded.capabilities.contextWindow };
}

async function run() {
  checkFrozenBudgetPolicy();
  const isolation = checkResponderIsolationAndPromptBudget();
  const streaming = await checkStreamingContinuationGuard();
  console.log("V9.3.6.1 responder budget: PASS (frozen tiers, isolated Prompt snapshots, continuation guard)");
  console.log(JSON.stringify({ frozenTwoPersonTokens: 80000, laterFourPersonTokens: 80000,
    reducedHeadroomTokens: 1200, isolation, streaming }));
}

if (require.main === module) {
  run().catch(error => {
    console.error(error.stack || error.message || error);
    process.exitCode = 1;
  });
}

module.exports = { run };
