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

const PLAYER_ID = 1;
const RESPONDER_A = 2;
const RESPONDER_B = 3;
const CONVERSATION_ID = "v94-synthetic-responder-isolation";
const QUERY = "1190年我们当时关于税收具体谈过什么？";
const names = new Map([[PLAYER_ID, "甲"], [RESPONDER_A, "乙"], [RESPONDER_B, "玛蒂尔达"]]);

function makeSummary(base, ownerId, index, marker) {
  const ownerName = names.get(ownerId);
  const date = `1190.${index + 1}.1`;
  return {
    ...base,
    playerId: ownerId,
    playerName: ownerName,
    perspectiveOwnerId: ownerId,
    characterId: PLAYER_ID,
    characterName: names.get(PLAYER_ID),
    date,
    totalDays: normalizeGameDate(date).serial,
    finalizationId: `v94-responder-${ownerId}-${index}`,
    conversationId: `v94-responder-source-${ownerId}-${index}`,
    participants: [{ id: ownerId, name: ownerName }, { id: PLAYER_ID, name: names.get(PLAYER_ID) }],
    content: `${marker}_BODY：1190年${ownerName}与甲具体商议边境税收、通行费和复核日期。\n` +
      `【需要长期记住的事项】\n- ${marker}_MATTER：甲与${ownerName}约定复核税收。\n` +
      `【其他事项】\n${marker}_END`
  };
}

function makeFixture() {
  const fixture = createAdversarialFixtureData();
  const base = fixture.pairSummaries.find(pair => pair.ownerId === RESPONDER_A && pair.counterpartId === PLAYER_ID).summaries[0];
  fixture.pairSummaries = [
    { ownerId: RESPONDER_A, counterpartId: PLAYER_ID,
      summaries: Array.from({ length: 5 }, (_, index) => makeSummary(base, RESPONDER_A, index, `V94_OWNER_A_ONLY_${index}`)) },
    { ownerId: RESPONDER_B, counterpartId: PLAYER_ID,
      summaries: Array.from({ length: 5 }, (_, index) => makeSummary(base, RESPONDER_B, index, `V94_OWNER_B_ONLY_${index}`)) }
  ];
  fixture.currentGameDate = "1200.1.1";
  fixture.currentTotalDays = normalizeGameDate(fixture.currentGameDate).serial;
  return fixture;
}

function request(fixture, ownerId, turnEpoch, cache, conversationId = CONVERSATION_ID) {
  return makeCandidateRequest(fixture, "nameOnly", {
    characterId: ownerId,
    conversationId,
    turnEpoch,
    sceneRevision: `${conversationId}-scene`,
    playerContent: QUERY,
    sessionRecallCache: cache,
    activeParticipantIds: [PLAYER_ID, ownerId],
    entityProfiles: [...names].map(([id, name]) => ({ id, name })),
    participantCount: 2,
    budgetPolicyRevision: "v9.3.9",
    tokenBudget: 80000
  });
}

function commit(engine, cache, ownerId, turnEpoch, context) {
  const injectedMemoryIds = context.extra.map(entry => String(entry.memory.memoryId));
  return engine.commitDynamicSummaryRecall(ownerId, cache, turnEpoch, {
    providerSucceeded: true,
    injectedBlockIds: ["memory-dynamic-frozen"],
    injectedMemoryIds,
    injectedTokens: context.selectedTokens
  });
}

function run() {
  const fixture = makeFixture();
  const harness = createFixtureEngine("v94-responder-isolation");
  try {
    for (const pair of fixture.pairSummaries) {
      const folder = path.join(harness.engine.store.summaryFoldersDir, `${pair.ownerId}_${names.get(pair.ownerId)}`);
      const file = path.join(folder, `与${names.get(pair.counterpartId)}的对话.json`);
      fs.mkdirSync(folder, { recursive: true });
      fs.writeFileSync(file, JSON.stringify(pair.summaries, null, 2), "utf8");
      harness.engine.store.invalidateFolderSummaryCache([pair.ownerId]);
    }
    const cache = new Map();
    const resolver = harness.engine.store.pairLedger.resolveSource.bind(harness.engine.store.pairLedger);
    let sourceResolutions = 0;
    harness.engine.store.pairLedger.resolveSource = (...args) => {
      sourceResolutions++;
      return resolver(...args);
    };

    const ownerA = harness.engine.retrieveForResponder(request(fixture, RESPONDER_A, 1, cache));
    assert(ownerA.frozenDynamicText?.includes("V94_OWNER_A_ONLY"),
      `responder A retrieves only its fictional source: ${JSON.stringify({ text: ownerA.frozenDynamicText,
        metrics: ownerA.pairMemoryMetrics, extras: ownerA.extra?.map(entry => entry.routeKind) })}`);
    assert.equal(ownerA.committedDynamicPlanSources?.length || 0, 0, "unanswered source is not committed");
    assert(ownerA.pendingDynamicPlanSources?.some(entry => entry.frozenText.includes("V94_OWNER_A_ONLY")),
      "pending projection is owned by responder A");
    assert.equal(commit(harness.engine, cache, RESPONDER_A, 1, ownerA).committedCount, ownerA.extra.length,
      "successful injection commits responder A's own query sources");

    const ownerB = harness.engine.retrieveForResponder(request(fixture, RESPONDER_B, 1, cache));
    assert(ownerB.frozenDynamicText?.includes("V94_OWNER_B_ONLY"), "responder B retrieves its own fictional source");
    assert(!ownerB.frozenDynamicText?.includes("V94_OWNER_A_ONLY"), "responder B never inherits responder A's committed text");
    assert(ownerB.pendingDynamicPlanSources?.some(entry => entry.frozenText.includes("V94_OWNER_B_ONLY")),
      "pending plan sources remain responder-scoped");
    assert.equal(ownerB.committedDynamicPlanSources?.length || 0, 0,
      "responder A's commit does not appear as responder B's frozen projection");

    const sourceResolutionsAfterB = sourceResolutions;
    const ownerAReuse = harness.engine.retrieveForResponder(request(fixture, RESPONDER_A, 2, cache));
    assert.equal(ownerAReuse.frozenDynamicText, ownerA.frozenDynamicText,
      "responder A reuses its own committed source snapshot byte-for-byte");
    assert.equal(ownerAReuse.pendingDynamicPlanSources?.length || 0, 0);
    assert(ownerAReuse.committedDynamicPlanSources?.some(entry => entry.frozenText.includes("V94_OWNER_A_ONLY")));
    assert.equal(sourceResolutions, sourceResolutionsAfterB,
      "reusing A's frozen memory does not resolve the stored source again");

    const otherConversation = harness.engine.retrieveForResponder(request(fixture, RESPONDER_A, 1, cache,
      `${CONVERSATION_ID}-next`));
    assert.equal(otherConversation.committedDynamicPlanSources?.length || 0, 0,
      "a new conversation resets the same responder's frozen source scope");
    assert(!otherConversation.committedDynamicPlanSources?.some(entry => entry.frozenText.includes("V94_OWNER_A_ONLY")));
  } finally {
    harness.cleanup();
  }
  console.log("PASS V9.4 responder and conversation isolation for committed dynamic memory sources");
}

if (require.main === module) run();
module.exports = { run };
