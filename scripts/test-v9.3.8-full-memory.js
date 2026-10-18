"use strict";

const assert = require("node:assert/strict");
const { createAdversarialFixtureData, createFixtureEngine, makeCandidateRequest, seedAdversarialFixture } = require("./test-v9.3.6-independent-qa");
const { normalizeGameDate } = require("../src/app/main/worldline/character-temporal-facts");
const { resolveMemoryBudget } = require("../src/app/main/memory-system/memory-budget-policy");

function run() {
  for (const [participantCount, cap] of [[2, 80000], [3, 84000], [4, 88000], [6, 88000]]) {
    const plan = resolveMemoryBudget({ participantCount, contextWindowTokens: 128000, providerHeadroomTokens: 128000, policyRevision: "v9.3.8" });
    assert.equal(plan.memoryBudgetTokens, cap);
    assert.equal(resolveMemoryBudget({ participantCount, contextWindowTokens: 128000, providerHeadroomTokens: 1234 }).memoryBudgetTokens, 1234);
  }
  const fixture = createAdversarialFixtureData();
  const template = fixture.pairSummaries[0].summaries[0];
  const summary = (counterpartId, date, marker) => ({ ...template, characterId: counterpartId,
    characterName: counterpartId === 1 ? "甲" : "玛蒂尔达", date,
    totalDays: normalizeGameDate(date).serial, finalizationId: marker, conversationId: marker,
    participants: [{ id: 2, name: "乙" }, { id: counterpartId, name: counterpartId === 1 ? "甲" : "玛蒂尔达" }],
    content: `${marker}：过去商议税收的完整叙事。${"完整正文。".repeat(90)}\n【需要长期记住的事项】\n- ${marker}：约定核查税收。\n【其他事项】\n${marker}_END` });
  fixture.pairSummaries = [
    { ownerId: 2, counterpartId: 1, summaries: [summary(1, "1199.1.1", "RECENT_NEW"), summary(1, "1198.1.1", "RECENT_OLD"),
      summary(1, "1190.1.1", "TIME_A"), summary(1, "1190.2.1", "TIME_B"), summary(1, "1190.3.1", "TIME_C")] },
    { ownerId: 2, counterpartId: 3, summaries: [summary(3, "1190.1.1", "THIRD_A"), summary(3, "1190.2.1", "THIRD_B"),
      summary(3, "1190.3.1", "THIRD_C")] }
  ];
  const test = createFixtureEngine("v938-full-memory");
  try {
    seedAdversarialFixture(test.engine, fixture);
    const profiles = [{ id: 1, name: "甲" }, { id: 2, name: "乙" }, { id: 3, name: "玛蒂尔达" }];
    const request = overrides => makeCandidateRequest(fixture, "nameOnly", { budgetPolicyRevision: "v9.3.8",
      entityProfiles: profiles, tokenBudget: 80000, ...overrides });
    const baseline = test.engine.retrieveForResponder(request());
    assert.equal(baseline.direct.length, 2);
    assert(baseline.directStableText.includes("RECENT_NEW_END"));
    assert(baseline.directStableText.includes("RECENT_OLD_END"));
    assert.equal(baseline.pairMemoryMetrics.recentSummaryTruncated, false);
    assert.equal(baseline.pairMemoryMetrics.playerLedgerOmittedCount, 0);
    assert.equal(baseline.extra.length, 0, "L0 cannot open third-person sources");
    assert.equal(baseline.pairMemoryMetrics.playerLedgerInjectedCount, 5);
    assert.equal(baseline.pairMemoryMetrics.recentSummaryReferencedItems, 2,
      "both fully rendered Recent sources participate in exact source/revision/item de-duplication");
    const input = request({ playerContent: "1190年我们当时关于税收具体谈过什么？再说1190年你和玛蒂尔达的谈话中关于税收具体说了什么？" });
    const mixed = test.engine.retrieveForResponder(input);
    if (mixed.extra.length !== 6) console.log(JSON.stringify({ decision: mixed.thirdPersonDecision, temporal: mixed.temporal,
      metrics: mixed.pairMemoryMetrics, routes: mixed.extra.map(e => e.routeKind) }));
    assert.equal(mixed.thirdPersonDecision.level, "L2");
    assert.equal(mixed.direct.length, 2);
    assert.equal(mixed.extra.filter(e => e.routeKind === "third_person_source").length, 3);
    assert.equal(mixed.extra.filter(e => e.routeKind === "dynamic_extra").length, 3);
    assert.equal(new Set([...mixed.direct, ...mixed.extra].map(e => e.memory.memoryId)).size, 8);
    for (const marker of ["TIME_A", "TIME_B", "TIME_C", "THIRD_A", "THIRD_B", "THIRD_C"]) {
      assert(mixed.temporalExtraText.includes(marker + "_END"), marker + " must retain its full source text");
    }
    assert.equal(mixed.pairMemoryMetrics.playerLedgerOmittedCount, 0);
    assert.throws(() => test.engine.retrieveForResponder({ ...input, tokenBudget: 100 }), error => {
      assert.equal(error.code, "MEMORY_CONTEXT_OVERFLOW");
      assert(error.memoryBudgetDetails.requiredTokens > 100);
      assert.equal(error.memoryBudgetDetails.availableTokens, 100);
      assert(error.memoryBudgetDetails.breakdown.recent > 0);
      assert(error.memoryBudgetDetails.breakdown.temporal > 0);
      assert(error.memoryBudgetDetails.breakdown.thirdPerson > 0);
      return true;
    });
    const cache = new Map();
    const frozen = test.engine.retrieveForResponder(request({ sessionRecallCache: cache }));
    const again = test.engine.retrieveForResponder(request({ sessionRecallCache: cache, turnEpoch: 2 }));
    assert.equal(frozen.directStableText, again.directStableText);
    assert.equal(again.pairMemoryMetrics.frozenSnapshotReuse, true);
    const relationship = test.engine.retrieveForResponder(request({ playerContent: "你以前和玛蒂尔达关系怎么样？" }));
    assert.equal(relationship.thirdPersonDecision.level, "L1");
    assert.equal(relationship.extra.length, 0);
    const future = test.engine.retrieveForResponder(request({ playerContent: "明年我们与玛蒂尔达准备做什么？" }));
    assert.equal(future.extra.length, 0);
    const recovered = test.engine.retrieveForResponder(input);
    assert.equal(recovered.temporalExtraText, mixed.temporalExtraText, "overflow cannot mutate stored sources");
    console.log("PASS V9.3.8 full Recent2, concurrent time3/third3, scope, freeze and explicit overflow");
  } finally {
    test.cleanup();
  }
}

if (require.main === module) run();
module.exports = { run };
