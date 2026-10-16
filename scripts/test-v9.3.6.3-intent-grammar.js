"use strict";

const assert = require("node:assert/strict");
const {
  ROUTE_SCHEMA_VERSION,
  classifyTemporalIntent
} = require("../src/app/main/memory-system/pair-memory-routing");
const {
  createAdversarialFixtureData,
  createFixtureEngine,
  makeCandidateRequest,
  seedAdversarialFixture
} = require("./test-v9.3.6-independent-qa");
const { normalizeGameDate } = require("../src/app/main/worldline/character-temporal-facts");

const PLAYER_ID = 1;
const OWNER_ID = 2;
const TARGET_C = 3;
const TARGET_D = 4;
const profiles = [
  { id: PLAYER_ID, name: "甲", aliases: ["甲"] },
  { id: OWNER_ID, name: "乙", aliases: ["乙"] },
  { id: TARGET_C, name: "玛蒂尔达", aliases: ["玛蒂尔达"] },
  { id: TARGET_D, name: "丁大人", mentionAliases: ["丁"] }
];

function trackPairLedger(engine) {
  const calls = { reads: [], resolves: [] };
  const ledger = engine.store.pairLedger;
  const read = ledger.read.bind(ledger);
  const resolveSource = ledger.resolveSource.bind(ledger);
  ledger.read = (scope, ...args) => {
    calls.reads.push({ ownerId: Number(scope.ownerId), counterpartId: Number(scope.counterpartId) });
    return read(scope, ...args);
  };
  ledger.resolveSource = (scope, pointer, ...args) => {
    calls.resolves.push({ ownerId: Number(scope.ownerId), counterpartId: Number(scope.counterpartId) });
    return resolveSource(scope, pointer, ...args);
  };
  return calls;
}

function clearCalls(calls) {
  calls.reads.length = 0;
  calls.resolves.length = 0;
}

function retrieve(engine, fixture, playerContent, overrides = {}) {
  return engine.retrieveForResponder(makeCandidateRequest(fixture, "nameOnly", {
    playerContent,
    entityProfiles: profiles,
    conversationId: "v9363-int03",
    sceneRevision: "v9363-int03-scene",
    ...overrides
  }));
}

function thirdPersonCalls(calls, collection) {
  return calls[collection].filter(entry => entry.ownerId === OWNER_ID && entry.counterpartId !== PLAYER_ID);
}

function addFixtureDetails(fixture) {
  const cSummary = fixture.pairSummaries.find(pair => pair.ownerId === OWNER_ID && pair.counterpartId === TARGET_C).summaries[0];
  cSummary.date = "1090.1.1";
  cSummary.totalDays = normalizeGameDate(cSummary.date).serial;
  cSummary.content = cSummary.content.replace("【其他事项】",
    "- C_1090_DISPUTE_SOURCE：乙与玛蒂尔达在1090年因边境税收发生具体争执，完整经过留在此来源。\n【其他事项】");
  const dSummary = fixture.pairSummaries.find(pair => pair.ownerId === OWNER_ID && pair.counterpartId === TARGET_D).summaries[0];
  dSummary.date = "1090.1.1";
  dSummary.totalDays = normalizeGameDate(dSummary.date).serial;
  dSummary.content = dSummary.content.replace("QA_SOURCE_bd-hears-c：合成 Legacy 叙事。",
    "D_DETAIL_SOURCE：丁大人与乙当年交换密信的完整原委。");
  dSummary.content = dSummary.content.replace("【其他事项】",
    "- D_RELATIONSHIP_ONLY：丁大人与乙当年关系融洽，曾一起讨论税收安排。\n【其他事项】");
}

function run() {
  const fixture = createAdversarialFixtureData();
  addFixtureDetails(fixture);
  const test = createFixtureEngine("v9363-int03-grammar");
  try {
    seedAdversarialFixture(test.engine, fixture);
    const calls = trackPairLedger(test.engine);
    const rows = [];
    const runRow = (id, playerContent, expectedLevel, expectedTargets, overrides = {}) => {
      clearCalls(calls);
      const result = retrieve(test.engine, fixture, playerContent, overrides);
      const level = result.thirdPersonDecision.level;
      const thirdReads = thirdPersonCalls(calls, "reads").length;
      const thirdResolves = thirdPersonCalls(calls, "resolves").length;
      const thirdItems = result.pairMemoryItems.filter(item => item.routeKind === "third_direct_pair"
        || item.routeKind === "third_cross_pair");
      assert.equal(level, expectedLevel,
        `${id}: exact L0/L1/L2 level; decision=${JSON.stringify(result.thirdPersonDecision)}`);
      assert.deepEqual(result.thirdPersonDecision.targetCharacterIds, expectedTargets, `${id}: exact authorized targets`);
      assert(thirdItems.every(item => expectedTargets.includes(item.targetCharacterId)),
        `${id}: injected PairLedger items stay within the authorized target set`);
      if (expectedLevel === "L0") {
        assert.equal(thirdReads, 0, `${id}: L0 must perform zero third-person PairLedger reads`);
        assert.equal(thirdResolves, 0, `${id}: L0 must perform zero third-person source resolves`);
        assert.equal(thirdItems.length, 0, `${id}: L0 injects no third-person PairLedger item`);
      } else if (expectedLevel === "L1") {
        assert(thirdReads > 0, `${id}: L1 must read the real third-person PairLedger index`);
        assert.equal(thirdResolves, 0, `${id}: L1 remains index-only`);
      } else {
        assert.equal(expectedLevel, "L2", `${id}: known historical access level`);
        assert(thirdReads > 0, `${id}: L2 must read the real third-person PairLedger index`);
        const metricAttempts = Number(result.pairMemoryMetrics?.totalSourceResolveAttemptCount) || 0;
        assert(Math.max(thirdResolves, metricAttempts) <= 2,
          `${id}: L2 source attempts, including failed/fallback attempts, stay at two or fewer`);
      }
      const row = { id, level, targets: result.thirdPersonDecision.targetCharacterIds,
        thirdPersonPairLedgerReads: thirdReads, thirdPersonSourceResolveAttempts: thirdResolves,
        reportedSourceResolveAttempts: Number(result.pairMemoryMetrics?.totalSourceResolveAttemptCount) || 0,
        injectedTargets: [...new Set(thirdItems.map(item => item.targetCharacterId))] };
      rows.push(row);
      return result;
    };
    const bindC = (cache, conversationId, sceneRevision = "v9363-bound-scene") => {
      const setup = retrieve(test.engine, fixture, "你以前和玛蒂尔达关系怎么样？", {
        sessionRecallCache: cache, turnEpoch: 1, conversationId, sceneRevision
      });
      assert.equal(setup.thirdPersonDecision.level, "L1", `${conversationId}: setup grants index-only history`);
      assert.deepEqual(setup.thirdPersonDecision.targetCharacterIds, [TARGET_C]);
      const state = cache.get(OWNER_ID);
      assert.equal(state.routeSchemaVersion, ROUTE_SCHEMA_VERSION, `${conversationId}: cache is tagged with route schema`);
      assert.equal(state.namedTargetFocus?.characterId, TARGET_C, `${conversationId}: setup preserves the unique named target focus`);
      assert.equal(state.historyBinding.routeSchemaVersion, ROUTE_SCHEMA_VERSION,
        `${conversationId}: follow-up binding is tagged with route schema`);
    };

    runRow("S01", "政变之后你和玛蒂尔达发生了什么？", "L2", [TARGET_C]);
    runRow("S02", "登基之后你和玛蒂尔达关系如何？", "L1", [TARGET_C]);

    const s03Cache = new Map();
    bindC(s03Cache, "v9363-s03");
    runRow("S03", "审判以后你们有没有见过面？", "L1", [TARGET_C], {
      sessionRecallCache: s03Cache, turnEpoch: 2, conversationId: "v9363-s03", sceneRevision: "v9363-bound-scene"
    });

    const s04Cache = new Map();
    bindC(s04Cache, "v9363-s04");
    runRow("S04", "继承争议结束之后，你们的关系发生过变化吗？", "L1", [TARGET_C], {
      sessionRecallCache: s04Cache, turnEpoch: 2, conversationId: "v9363-s04", sceneRevision: "v9363-bound-scene"
    });

    runRow("S05", "当年政变之后你是怎么处理玛蒂尔达的？", "L2", [TARGET_C]);
    runRow("S06", "等政变结束之后，你准备怎么安排玛蒂尔达？", "L0", []);
    runRow("S07", "政变之后要不要通知玛蒂尔达？", "L0", []);
    runRow("S08", "记得政变之后把信给玛蒂尔达。", "L0", []);
    runRow("S09", "不要回忆政变之后的事。", "L0", []);
    runRow("S10", "别说废话。登基之后你和玛蒂尔达关系如何？", "L1", [TARGET_C]);

    const s11 = runRow("S11", "不谈玛蒂尔达。政变之后你与丁大人关系如何？", "L1", [TARGET_D]);
    assert(s11.pairMemoryItems.filter(item => item.routeKind === "third_direct_pair"
      || item.routeKind === "third_cross_pair").every(item => item.targetCharacterId === TARGET_D),
    "S11: the separately denied C target is not injected into the D history query");

    runRow("S12", "“政变之后你和玛蒂尔达发生了什么？”是什么意思？", "L0", []);
    runRow("S13", "NPC说“政变之后你们怎样了？”", "L0", [], { trustedPlayerTurn: null });

    const s14Cache = new Map();
    bindC(s14Cache, "v9363-s14");
    runRow("S14", "那后来呢？", "L1", [TARGET_C], {
      sessionRecallCache: s14Cache, turnEpoch: 2, conversationId: "v9363-s14", sceneRevision: "v9363-bound-scene"
    });

    const s15Cache = new Map();
    bindC(s15Cache, "v9363-s15", "v9363-original-scene");
    runRow("S15", "那后来呢？", "L0", [], {
      sessionRecallCache: s15Cache, turnEpoch: 2, conversationId: "v9363-s15", sceneRevision: "v9363-changed-scene"
    });

    runRow("S16", "政变之后怎么办？", "L0", []);

    const s17Cache = new Map();
    bindC(s17Cache, "v9363-s17");
    runRow("S17", "曾经的政变之后你和她如何相处？", "L1", [TARGET_C], {
      sessionRecallCache: s17Cache, turnEpoch: 2, conversationId: "v9363-s17", sceneRevision: "v9363-bound-scene"
    });

    runRow("S18", "现在你打算怎么处理与玛蒂尔达的旧事？", "L0", []);
    const s19 = runRow("S19", "记得把信交给玛蒂尔达。你以前和丁大人关系如何？", "L1", [TARGET_D]);
    const s19Items = s19.pairMemoryItems.filter(item => item.routeKind === "third_direct_pair"
      || item.routeKind === "third_cross_pair");
    assert(s19Items.every(item => item.targetCharacterId === TARGET_D),
      "S19: the current C instruction cannot pollute historical D retrieval");
    assert(s19Items.some(item => item.text.includes("D_RELATIONSHIP_ONLY")),
      "S19: the historical D clause remains the actual relevance query");

    runRow("S20", "战争之后你和玛蒂尔达发生了什么？", "L2", [TARGET_C]);
    runRow("S21", "等政变结束之后你和玛蒂尔达关系如何？", "L0", []);

    const s01Intent = classifyTemporalIntent("政变之后你和玛蒂尔达发生了什么？");
    assert(s01Intent.clauses[0].historicalEvidence.includes("EVENT_AFTER_RECALL"),
      "S01: a non-whitelisted event plus a retrospective predicate creates structured historical evidence");
    assert.equal(s01Intent.clauses[0].mayRequestSourceDetail, true, "S01 explicitly requests event detail");
    const s02Intent = classifyTemporalIntent("登基之后你和玛蒂尔达关系如何？");
    assert(s02Intent.clauses[0].historicalEvidence.includes("EVENT_AFTER_RECALL"), "S02 uses the same generic event grammar");
    assert.equal(s02Intent.clauses[0].mayRequestSourceDetail, false, "S02 relationship wording stays L1");
    assert.equal(s02Intent.clauses[0].kind, "PAST_HISTORY");
    const futureIntent = classifyTemporalIntent("等政变结束之后你准备怎么安排玛蒂尔达");
    assert.equal(futureIntent.clauses[0].kind, "CURRENT_FUTURE");
    assert(futureIntent.clauses[0].futureEvidence.includes("FUTURE_DEPENDENCY"),
      "a future-dependent event clause remains current/future despite its time connector");
    const futureRelationshipIntent = classifyTemporalIntent("等政变结束之后你和玛蒂尔达关系如何？");
    assert.equal(futureRelationshipIntent.clauses[0].kind, "AMBIGUOUS",
      "an event-wait dependency blocks historical authorization even when the clause only asks about a relationship");
    assert(futureRelationshipIntent.clauses[0].futureEvidence.includes("FUTURE_DEPENDENCY"));

    const staleCache = new Map();
    bindC(staleCache, "v9363-schema-invalidation");
    const staleState = staleCache.get(OWNER_ID);
    staleState.routeSchemaVersion = "v936-third-person-route-1";
    staleState.dynamicKey = "legacy-route-dynamic-key";
    staleState.dynamicResult = { decision: { level: "L2", targetCharacterIds: [TARGET_C] }, text: "stale route result" };
    clearCalls(calls);
    const staleFollowup = retrieve(test.engine, fixture, "那后来呢？", {
      sessionRecallCache: staleCache, turnEpoch: 2, conversationId: "v9363-schema-invalidation",
      sceneRevision: "v9363-bound-scene"
    });
    assert.equal(staleFollowup.thirdPersonDecision.level, "L0", "a prior route schema cannot authorize a new follow-up");
    assert.deepEqual(staleFollowup.thirdPersonDecision.targetCharacterIds, []);
    assert.equal(staleState.routeSchemaVersion, ROUTE_SCHEMA_VERSION);
    assert.equal(staleState.historyBinding, null, "the old history binding is invalidated with its route schema");
    assert.notEqual(staleState.dynamicKey, "legacy-route-dynamic-key", "the dynamic result cache is invalidated with its route schema");
    assert.equal(thirdPersonCalls(calls, "reads").length, 0, "stale route cache cannot trigger third-person PairLedger reads");
    assert.equal(thirdPersonCalls(calls, "resolves").length, 0, "stale route cache cannot resolve third-person sources");

    assert.equal(rows.length, 21, "S01-S20 plus S21 ran through MemoryEngine and PairLedger");
    console.log(`V9.3.6.3 INT-03 intent grammar: PASS (${rows.length}/21 rows; route=${ROUTE_SCHEMA_VERSION})`);
    console.log(JSON.stringify(rows));
  } finally {
    test.cleanup();
  }
}

if (require.main === module) {
  try { run(); } catch (error) {
    console.error(error.stack || error.message || error);
    process.exitCode = 1;
  }
}

module.exports = { run };
