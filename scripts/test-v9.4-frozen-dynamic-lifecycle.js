"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { normalizeGameDate } = require("../src/app/main/worldline/character-temporal-facts");
const {
  createAdversarialFixtureData,
  createFixtureEngine,
  makeCandidateRequest
} = require("./test-v9.3.6-independent-qa");
const { createFixture, createPromptRuntime } = require("./fixtures/v9.4/legacy-layout-fixtures");
const { Conversation } = require("../src/app/main/conversation/conversation");

const REPO_ROOT = path.resolve(__dirname, "..");
const MAIN_DIR = path.join(REPO_ROOT, "src", "app", "main");
const PLAYER_ID = 1;
const RESPONDER_ID = 2;
const THIRD_PARTY_ID = 3;
const CONVERSATION_ID = "v94-synthetic-freeze-conversation";
const QUERY = "1190年我们当时关于税收具体谈过什么？再说1190年你和玛蒂尔达的谈话中关于税收具体说了什么？";
const PROFILES = [
  { id: PLAYER_ID, name: "甲" },
  { id: RESPONDER_ID, name: "乙" },
  { id: THIRD_PARTY_ID, name: "玛蒂尔达" }
];

function makeSummary(base, ownerId, counterpartId, date, marker) {
  const names = new Map([[PLAYER_ID, "甲"], [RESPONDER_ID, "乙"], [THIRD_PARTY_ID, "玛蒂尔达"]]);
  return {
    ...base,
    characterId: counterpartId,
    characterName: names.get(counterpartId),
    date,
    totalDays: normalizeGameDate(date).serial,
    finalizationId: marker,
    conversationId: marker,
    participants: [{ id: ownerId, name: names.get(ownerId) }, { id: counterpartId, name: names.get(counterpartId) }],
    content: `${marker}_BODY：${date}年围绕边境税收和贸易通行费进行了具体商议。${"税收细节和后续约定。".repeat(12)}\n【需要长期记住的事项】\n- ${marker}_LEDGER：约定复核税收。\n【其他事项】\n${marker}_END`
  };
}

function makeMemoryFixture() {
  const fixture = createAdversarialFixtureData();
  const base = fixture.pairSummaries[0].summaries[0];
  fixture.pairSummaries = [
    {
      ownerId: RESPONDER_ID,
      counterpartId: PLAYER_ID,
      summaries: Array.from({ length: 7 }, (_, index) => makeSummary(base, RESPONDER_ID, PLAYER_ID,
        `1190.${index + 1}.1`, `V94_TIME_${index}`))
    },
    {
      ownerId: RESPONDER_ID,
      counterpartId: THIRD_PARTY_ID,
      summaries: Array.from({ length: 4 }, (_, index) => makeSummary(base, RESPONDER_ID, THIRD_PARTY_ID,
        `1190.${index + 1}.1`, `V94_THIRD_${index}`))
    }
  ];
  fixture.currentGameDate = "1200.1.1";
  fixture.currentTotalDays = normalizeGameDate(fixture.currentGameDate).serial;
  return fixture;
}

function buildRequest(fixture, cache, turnEpoch, conversationId = CONVERSATION_ID) {
  return makeCandidateRequest(fixture, "nameOnly", {
    budgetPolicyRevision: "v9.3.9",
    tokenBudget: 96000,
    sessionRecallCache: cache,
    activeParticipantIds: [PLAYER_ID, RESPONDER_ID, THIRD_PARTY_ID],
    entityProfiles: PROFILES,
    conversationId,
    turnEpoch,
    playerContent: QUERY
  });
}

function projectedText(entries) {
  return (entries || []).map(entry => String(entry?.frozenText || "")).join("\n\n");
}

function occurrenceCount(messages, marker) {
  return messages.reduce((sum, message) => sum + String(message.content || "").split(marker).length - 1, 0);
}

function planText(block) {
  return typeof block.content === "string" ? block.content
    : (block.messages || []).map(message => message.content || "").join("\n\n");
}

function assertPlanProjection({ runtime, fixture, history, memoryContext, pendingMarkers, frozenMarkers }) {
  const cacheV2FrozenSnapshots = { conversation: null, responders: new Map(), prefixByResponder: new Map() };
  const context = {
    ...memoryContext,
    activeParticipantIds: [PLAYER_ID, RESPONDER_ID, THIRD_PARTY_ID],
    playerAnchorId: PLAYER_ID,
    respondingCharacterId: RESPONDER_ID,
    freezePromptPrefix: true,
    cacheV2FrozenSnapshots
  };
  const built = runtime.PromptBuilder.buildMessagesWithTokenCount(
    history,
    fixture.responder,
    fixture.gameData,
    fixture.currentSessionSummary,
    context,
    fixture.definition.providerConfig,
    { promptPlanMode: "v9" }
  );

  assert.equal(built.promptPlanMode, "v9");
  assert(built.promptPlan && built.serialized, "V9 mode returns its Plan and serializer output for QA");
  assert.deepEqual(built.messages, built.serialized.messages, "V9 outbound messages must be the actual serialized Plan messages");

  const planBlocks = built.promptPlan.blocks;
  const messageSpans = built.serialized.messageSpans;
  const currentPlayerMessage = history[history.length - 1].content;
  const currentTurnPosition = built.serialized.messages.findIndex(message =>
    message.role === "user" && String(message.content).includes(currentPlayerMessage));
  assert(currentTurnPosition >= 0, "the current player message must remain in serialized messages");
  const appendOnlySpans = planBlocks.filter(block => block.kind === "APPEND_ONLY_HISTORY")
    .map(block => messageSpans.find(span => span.blockId === block.id)).filter(Boolean);
  const historyEnd = Math.max(-1, ...appendOnlySpans.flatMap(span => span.contributions.map(item => item.messagePosition)));
  assert(historyEnd >= 0, "the prompt must preserve an explicitly mapped append-only history window");

  for (const { marker, kind } of [
    ...frozenMarkers.map(marker => ({ marker, kind: "RESPONDER_FROZEN" })),
    ...pendingMarkers.map(marker => ({ marker, kind: "QUERY_DYNAMIC_MEMORY" }))
  ]) {
    const matchingBlocks = planBlocks.filter(block => planText(block).includes(marker));
    assert.equal(matchingBlocks.length, 1, `${marker}: projected memory source must map to one semantic block`);
    assert.equal(matchingBlocks[0].kind, kind, `${marker}: source must retain its committed/pending lifecycle kind`);
    assert.equal(occurrenceCount(built.serialized.messages, marker), 1,
      `${marker}: source must occur once in the final serialized messages`);
    const span = messageSpans.find(item => item.blockId === matchingBlocks[0].id);
    assert(span, `${marker}: semantic block must have an explicit serialized span`);
    const markerPosition = built.serialized.messages.findIndex(message => String(message.content).includes(marker));
    if (kind === "RESPONDER_FROZEN") {
      assert(markerPosition < appendOnlySpans[0].start, `${marker}: successfully committed memory precedes mutable history`);
      assert.equal(matchingBlocks[0].lifecycle?.state, "FROZEN");
    } else {
      assert(markerPosition > historyEnd, `${marker}: uncommitted query memory remains after append-only history`);
      assert(markerPosition < currentTurnPosition,
        `${marker}: query-driven memory context precedes the current turn text that requested it`);
      assert.equal(matchingBlocks[0].lifecycle?.state, "DYNAMIC");
    }
  }
  return built;
}

function run() {
  const fixture = makeMemoryFixture();
  const harness = createFixtureEngine("v94-frozen-dynamic-lifecycle");
  try {
    const names = new Map([[PLAYER_ID, "甲"], [RESPONDER_ID, "乙"], [THIRD_PARTY_ID, "玛蒂尔达"]]);
    for (const pair of fixture.pairSummaries) {
      const folder = path.join(harness.engine.store.summaryFoldersDir, `${pair.ownerId}_${names.get(pair.ownerId)}`);
      const file = path.join(folder, `与${names.get(pair.counterpartId)}的对话.json`);
      fs.mkdirSync(folder, { recursive: true });
      fs.writeFileSync(file, JSON.stringify(pair.summaries, null, 2), "utf8");
      harness.engine.store.invalidateFolderSummaryCache([pair.ownerId]);
    }
    const cache = new Map();
    const sourceResolver = harness.engine.store.pairLedger.resolveSource.bind(harness.engine.store.pairLedger);
    let sourceResolveCount = 0;
    harness.engine.store.pairLedger.resolveSource = (...args) => {
      sourceResolveCount += 1;
      return sourceResolver(...args);
    };

    const selected = harness.engine.retrieveForResponder(buildRequest(fixture, cache, 1));
    assert(selected.frozenDynamicText, "the query must retrieve a synthetic time/third-party summary bundle");
    assert.equal(selected.committedDynamicPlanSources?.length || 0, 0,
      "first-time query sources are not promoted before provider success");
    assert(selected.pendingDynamicPlanSources?.length > 0,
      "retrieved query sources are projected as pending Plan inputs before provider success");
    const pendingText = projectedText(selected.pendingDynamicPlanSources);
    assert(pendingText.includes("V94_TIME_") && pendingText.includes("V94_THIRD_"),
      "pending projection preserves both time and third-party source text");
    for (const entry of selected.pendingDynamicPlanSources) {
      assert.equal(typeof entry.key, "string", "pending projection carries an opaque source key");
      assert.equal(typeof entry.frozenText, "string");
    }

    const promptFixture = createFixture("v813-query-dynamic");
    promptFixture.responder = { ...promptFixture.responder, id: RESPONDER_ID, shortName: "乙", fullName: "乙 of Fixture" };
    const promptCharacters = new Map([
      [PLAYER_ID, { id: PLAYER_ID, shortName: "甲", fullName: "甲 of Fixture", age: 28, traits: [] }],
      [RESPONDER_ID, promptFixture.responder],
      [THIRD_PARTY_ID, { id: THIRD_PARTY_ID, shortName: "玛蒂尔达", fullName: "玛蒂尔达 of Fixture", age: 35, traits: [] }]
    ]);
    promptFixture.gameData = {
      ...promptFixture.gameData,
      campaignToken: fixture.campaignToken,
      date: fixture.currentGameDate,
      year: 1200,
      totalDays: fixture.currentTotalDays,
      playerID: PLAYER_ID,
      playerName: "甲",
      characters: promptCharacters,
      getMentionableCharacterProfiles: () => promptCharacters,
      findMentionedCharacterIdsInHistory: () => [],
      getMentionedCharactersInfo: () => ""
    };
    promptFixture.history = buildRequest(fixture, cache, 1).history;
    promptFixture.currentSessionSummary = "";
    const runtime = createPromptRuntime(MAIN_DIR, promptFixture);
    const pendingMarkers = selected.pendingDynamicPlanSources.map(entry => entry.frozenText.match(/V94_(?:TIME|THIRD)_\d+_BODY/)?.[0])
      .filter(Boolean);
    assert(pendingMarkers.length > 0, "synthetic memory projection must expose recognizable sentinels");
    const pendingBuild = assertPlanProjection({ runtime, fixture: promptFixture, history: promptFixture.history,
      memoryContext: selected, pendingMarkers, frozenMarkers: [] });

    const injectedIds = selected.extra.map(entry => String(entry.memory.memoryId));
    Conversation.configure({ memoryEngine: harness.engine, TokenCounter: runtime.TokenCounter });
    const conversation = Object.create(Conversation.prototype);
    conversation.memoryState = { responderRecallCache: cache };
    const commit = harness.engine.commitDynamicSummaryRecall.bind(harness.engine);
    let injected = null;
    let injectionEvidence = null;
    harness.engine.commitDynamicSummaryRecall = (...args) => {
      injectionEvidence = args[3];
      injected = commit(...args);
      return injected;
    };
    conversation.retainDynamicSummaryRecall(RESPONDER_ID, 101, { ...pendingBuild,
      blocks: pendingBuild.blocks.filter(entry => entry.block.id !== "memory-dynamic-pending") }, 1);
    assert.equal(injected, null, "a pending source omitted from the actual Prompt must not commit");
    conversation.retainDynamicSummaryRecall(RESPONDER_ID, 101, pendingBuild, 1);
    assert(injected, "the actual Conversation success callback must recognize the emitted pending block");
    assert.deepEqual(injectionEvidence.injectedBlockIds, ["memory-dynamic-pending"]);
    assert.equal(injected.committedCount, injectedIds.length,
      "only successfully injected time/third-party sources become frozen projections");
    const sourceCountAfterCommit = sourceResolveCount;
    const reused = harness.engine.retrieveForResponder(buildRequest(fixture, cache, 2));
    assert.equal(reused.frozenDynamicText, selected.frozenDynamicText, "later turn reuses the complete committed source snapshot");
    assert.equal(reused.pendingDynamicPlanSources?.length || 0, 0, "reusing a committed snapshot creates no pending query block");
    assert.equal(reused.committedDynamicPlanSources?.length, injected.committedCount,
      "successful commit exposes only committed source key/text projections");
    assert.equal(sourceResolveCount, sourceCountAfterCommit,
      "a frozen reuse does not reopen source summaries or repeat source retrieval");

    const committedMarkers = reused.committedDynamicPlanSources.map(entry => entry.frozenText.match(/V94_(?:TIME|THIRD)_\d+_BODY/)?.[0])
      .filter(Boolean);
    const committedBuild = assertPlanProjection({ runtime, fixture: promptFixture, history: promptFixture.history,
      memoryContext: reused, pendingMarkers: [], frozenMarkers: committedMarkers });
    conversation.retainDynamicSummaryRecall(RESPONDER_ID, 102, committedBuild, 2);
    assert.equal(injected.committedCount, 0, "a later successful reuse cannot consume the recall quota again");
    const repeatedBuild = assertPlanProjection({ runtime, fixture: promptFixture, history: promptFixture.history,
      memoryContext: reused, pendingMarkers: [], frozenMarkers: committedMarkers });
    assert.deepEqual(repeatedBuild.serialized.messages, committedBuild.serialized.messages,
      "repeated construction from the same frozen source snapshot stays byte-identical");

    // A mixed state is intentionally synthetic: the committed projection comes from MemoryEngine;
    // the extra pending source proves that the legacy aggregate text cannot freeze the whole bundle.
    const pendingSentinel = "V94_PENDING_AFTER_COMMIT_ONLY";
    const mixedContext = {
      ...reused,
      frozenDynamicText: `${reused.frozenDynamicText}\n\n${pendingSentinel}`,
      pendingDynamicPlanSources: [{ key: "synthetic-pending-source-key", frozenText: pendingSentinel }]
    };
    const mixedBuild = assertPlanProjection({ runtime, fixture: promptFixture, history: promptFixture.history,
      memoryContext: mixedContext, pendingMarkers: [pendingSentinel], frozenMarkers: committedMarkers });
    const committedBlockTexts = mixedBuild.promptPlan.blocks.filter(block => block.kind === "RESPONDER_FROZEN").map(planText).join("\n");
    assert(!committedBlockTexts.includes(pendingSentinel),
      "the compatibility aggregate frozenDynamicText must never promote a pending source into the frozen prefix");
    const state = cache.get(RESPONDER_ID);
    const unsent = { ...state.frozenDynamicSources[0], frozenText: pendingSentinel,
      memory: { ...state.frozenDynamicSources[0].memory, memoryId: "V94_UNSENT_PENDING_SOURCE" } };
    const previousPending = state.pendingDynamicSources;
    const previousExtra = state.dynamicExtra;
    state.pendingDynamicSources = [unsent];
    state.dynamicExtra = [...state.frozenDynamicSources, unsent];
    harness.engine.commitDynamicSummaryRecall = (_owner, _cache, _turn, evidence) => {
      injectionEvidence = evidence;
      return { committedCount: 0 };
    };
    conversation.retainDynamicSummaryRecall(RESPONDER_ID, 103, committedBuild, 2);
    assert(!injectionEvidence.injectedMemoryIds.includes(unsent.memory.memoryId),
      "reusing only the committed block must not mark an unsent pending source as injected");
    conversation.retainDynamicSummaryRecall(RESPONDER_ID, 103, mixedBuild, 2);
    assert.deepEqual(injectionEvidence.injectedMemoryIds, [unsent.memory.memoryId],
      "a mixed request commits only its emitted pending source IDs");
    state.pendingDynamicSources = previousPending;
    state.dynamicExtra = previousExtra;
    harness.engine.commitDynamicSummaryRecall = commit;

    const nextConversationCache = new Map();
    const fresh = harness.engine.retrieveForResponder(buildRequest(fixture, nextConversationCache, 1, `${CONVERSATION_ID}-next`));
    assert.equal(fresh.committedDynamicPlanSources?.length || 0, 0,
      "a new conversation does not inherit responder-frozen dynamic source projections");
    assert(!committedMarkers.some(marker => projectedText(fresh.committedDynamicPlanSources).includes(marker)),
      "frozen source text is isolated to its original conversation");
    assert(pendingBuild.serialized.messageSpans.length > 0, "pending construction still supplies full span diagnostics");
  } finally {
    harness.cleanup();
  }
  console.log("PASS V9.4 committed/pending dynamic memory lifecycle (PromptPlan classification, physical order, exactly-once injection, and no repeated source resolution)");
}

if (require.main === module) run();
module.exports = { run };
