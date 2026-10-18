"use strict";

const assert = require("node:assert/strict");
const { createAdversarialFixtureData, createFixtureEngine, makeCandidateRequest, seedAdversarialFixture } = require("./test-v9.3.6-independent-qa");
const { normalizeGameDate } = require("../src/app/main/worldline/character-temporal-facts");
const { resolveMemoryBudget } = require("../src/app/main/memory-system/memory-budget-policy");
const { discardPendingSources } = require("../src/app/main/memory-system/dynamic-summary-freeze");

function makeFixture() {
  const fixture = createAdversarialFixtureData();
  const base = fixture.pairSummaries[0].summaries[0];
  const summary = (ownerId, counterpartId, date, marker) => ({ ...base, characterId: counterpartId,
    characterName: counterpartId === 1 ? "甲" : "玛蒂尔达", date,
    totalDays: normalizeGameDate(date).serial, finalizationId: marker, conversationId: marker,
    participants: [{ id: ownerId, name: "乙" }, { id: counterpartId, name: counterpartId === 1 ? "甲" : "玛蒂尔达" }],
    content: marker + "：过去商议税收的完整叙事。" + "完整正文。".repeat(80)
      + "\n【需要长期记住的事项】\n- " + marker + "：约定核查税收。\n【其他事项】\n" + marker + "_END" });
  fixture.pairSummaries = [
    { ownerId: 2, counterpartId: 1, summaries: [summary(2, 1, "1199.1.1", "RECENT_NEW"),
      summary(2, 1, "1198.1.1", "RECENT_OLD"),
      ...Array.from({ length: 7 }, (_, i) => summary(2, 1, "1190." + (i + 1) + ".1", "TIME_" + i)),
      summary(2, 1, "1180.1.1", "OTHER_TOPIC")] },
    { ownerId: 2, counterpartId: 3, summaries: Array.from({ length: 4 }, (_, i) =>
      summary(2, 3, "1190." + (i + 1) + ".1", "THIRD_" + i)) },
    { ownerId: 3, counterpartId: 1, summaries: [summary(3, 1, "1199.1.1", "OWNER3_RECENT"),
      summary(3, 1, "1198.1.1", "OWNER3_RECENT2"), summary(3, 1, "1190.1.1", "OWNER3_PRIVATE")] }
  ];
  return fixture;
}

function run() {
  for (const [participantCount, cap, ratio] of [[2, 80000, 0.65], [3, 84000, 0.70], [4, 96000, 0.75], [6, 96000, 0.75]]) {
    const plan = resolveMemoryBudget({ participantCount, contextWindowTokens: 192000, providerHeadroomTokens: 192000 });
    assert.equal(plan.memoryBudgetTokens, cap);
    assert.equal(plan.proportionalTokens, 192000 * ratio);
    assert.equal(resolveMemoryBudget({ participantCount, contextWindowTokens: 192000, providerHeadroomTokens: 1000 }).memoryBudgetTokens, 1000);
  }
  for (const participantCount of [2, 3, 4, 6]) {
    const fixture = makeFixture();
    const test = createFixtureEngine("v939-frozen-" + participantCount);
    try {
      seedAdversarialFixture(test.engine, fixture);
      const cache = new Map();
      const participantIds = Array.from({ length: participantCount }, (_, i) => i + 1);
      const profiles = [{ id: 1, name: "甲" }, { id: 2, name: "乙" }, { id: 3, name: "玛蒂尔达" }];
      const query = "1190年我们当时关于税收具体谈过什么？再说1190年你和玛蒂尔达的谈话中关于税收具体说了什么？";
      const request = overrides => makeCandidateRequest(fixture, "nameOnly", {
        budgetPolicyRevision: "v9.3.9", tokenBudget: 96000, sessionRecallCache: cache,
        activeParticipantIds: participantIds, entityProfiles: profiles, ...overrides });
      let resolvedCount = 0;
      const resolveSource = test.engine.store.pairLedger.resolveSource.bind(test.engine.store.pairLedger);
      test.engine.store.pairLedger.resolveSource = (...args) => { resolvedCount++; return resolveSource(...args); };
      const selected = test.engine.retrieveForResponder(request({ playerContent: query }));
      const temporalLimit = participantCount >= 4 ? 3 : 5;
      assert.equal(selected.extra.filter(row => row.routeKind === "dynamic_extra").length, temporalLimit);
      assert.equal(selected.extra.filter(row => row.routeKind === "third_person_source").length, 3);
      assert.equal(selected.direct.length, 2);
      assert(selected.frozenDynamicText.includes("_END"));
      assert(!selected.frozenDynamicText.includes("本轮"));
      assert.equal(selected.temporalExtraText, null);
      const evidence = { providerSucceeded: true, injectedBlockIds: ["memory-dynamic-frozen"],
        injectedMemoryIds: selected.extra.map(row => row.memory.memoryId), injectedTokens: selected.selectedTokens };
      assert.equal(test.engine.commitDynamicSummaryRecall(2, cache, 1, { ...evidence, providerSucceeded: false }).committedCount, 0);
      assert.equal(cache.get(2).frozenDynamicSources, undefined);
      assert.equal(test.engine.commitDynamicSummaryRecall(2, cache, 1, evidence).committedCount, temporalLimit + 3);
      const sourceCountAfterCommit = resolvedCount;
      const reused = test.engine.retrieveForResponder(request({ turnEpoch: 2 }));
      assert.equal(reused.frozenDynamicText, selected.frozenDynamicText, "ordinary later turns retain full frozen text");
      assert.equal(reused.pairMemoryMetrics.frozenDynamicCount, temporalLimit + 3);
      assert.equal(resolvedCount, sourceCountAfterCommit, "reusing a snapshot never reopens its summaries");
      const repeated = test.engine.retrieveForResponder(request({ turnEpoch: 3, playerContent: query }));
      assert.equal(repeated.frozenDynamicText, selected.frozenDynamicText);
      assert.equal(resolvedCount, sourceCountAfterCommit, "repeating a successful query uses its frozen snapshot");
      const capped = test.engine.retrieveForResponder(request({ turnEpoch: 4,
        playerContent: "1180年我们当时关于税收具体谈过什么？" }));
      assert.equal(capped.frozenDynamicText, selected.frozenDynamicText);
      assert(!capped.frozenDynamicText.includes("OTHER_TOPIC_END"));
      const other = test.engine.retrieveForResponder(request({ characterId: 3, turnEpoch: 5,
        playerContent: "1190年我们当时关于税收具体谈过什么？" }));
      assert.equal(other.frozenDynamicText, null, "global quota is not per responder");
      assert(!JSON.stringify(other).includes("TIME_0_END"), "a global counter never shares another responder's private text");
      assert.equal(test.engine.validatePlayerMemoryContext(reused, {
        campaignToken: "other-campaign", playerID: 1, date: fixture.currentGameDate
      }, reused.conversationId).valid, false);
      const fresh = test.engine.retrieveForResponder(request({ conversationId: "new-conversation", turnEpoch: 1 }));
      assert.equal(fresh.frozenDynamicText, null, "new conversations do not inherit snapshots");
      const cancelled = test.engine.retrieveForResponder(request({ conversationId: "new-conversation", turnEpoch: 2, playerContent: query }));
      assert(cancelled.extra.length > 0);
      discardPendingSources(cache, 2, 2);
      assert.equal(cache.get(2).pendingDynamicSources.length, 0);
      assert.equal((cache.get(2).frozenDynamicSources || []).length, 0, "cancelled candidates were never committed");
      assert.throws(() => test.engine.retrieveForResponder(request({ conversationId: "overflow", tokenBudget: 100, playerContent: query })),
        error => error.code === "MEMORY_CONTEXT_OVERFLOW" && error.memoryBudgetDetails.requiredTokens > 100);
    } finally { test.cleanup(); }
  }
  console.log("PASS V9.3.9 time5/third3, 4+ time3/third3, global lifetime quotas, full frozen reuse, failed admission and scope isolation");
}

if (require.main === module) run();
module.exports = { run };
