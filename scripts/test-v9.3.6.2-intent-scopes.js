"use strict";

const assert = require("node:assert/strict");
const {
  classifyTemporalIntent,
  removeQuotedText
} = require("../src/app/main/memory-system/pair-memory-routing");
const {
  createAdversarialFixtureData,
  createFixtureEngine,
  makeCandidateRequest,
  seedAdversarialFixture
} = require("./test-v9.3.6-independent-qa");
const { normalizeGameDate } = require("../src/app/main/worldline/character-temporal-facts");

const profiles = [
  { id: 1, name: "甲", aliases: ["甲"] },
  { id: 2, name: "乙", aliases: ["乙"] },
  { id: 3, name: "玛蒂尔达", aliases: ["玛蒂尔达"] },
  { id: 4, name: "丁大人", mentionAliases: ["丁"] }
];

function trackPairReads(engine) {
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

function retrieve(engine, fixture, content, overrides = {}) {
  const request = makeCandidateRequest(fixture, "nameOnly", {
    playerContent: content,
    entityProfiles: profiles,
    conversationId: "v9362-intent-scopes",
    sceneRevision: "v9362-intent-scene",
    ...overrides
  });
  return engine.retrieveForResponder(request);
}

function scopeCount(calls, collection, counterpartId) {
  return calls[collection].filter(entry => entry.ownerId === 2 && entry.counterpartId === counterpartId).length;
}

function clearCalls(calls) {
  calls.reads.length = 0;
  calls.resolves.length = 0;
}

function run() {
  const fixture = createAdversarialFixtureData();
  const cSummary = fixture.pairSummaries.find(pair => pair.ownerId === 2 && pair.counterpartId === 3).summaries[0];
  cSummary.date = "1090.1.1";
  cSummary.totalDays = normalizeGameDate(cSummary.date).serial;
  cSummary.content = cSummary.content.replace("【其他事项】",
    "- C_1090_DISPUTE_SOURCE：乙与玛蒂尔达在1090年因边境税收发生具体争执，完整经过留在此来源。\n【其他事项】");
  const dSummary = fixture.pairSummaries.find(pair => pair.ownerId === 2 && pair.counterpartId === 4).summaries[0];
  dSummary.date = "1090.1.1";
  dSummary.totalDays = normalizeGameDate(dSummary.date).serial;
  dSummary.content = dSummary.content.replace("QA_SOURCE_bd-hears-c：合成 Legacy 叙事。",
    "D_DETAIL_SOURCE：丁大人与乙当年交换密信的完整原委。");
  dSummary.content = dSummary.content.replace("【其他事项】", "- D_RELATIONSHIP_ONLY：丁大人与乙当年关系融洽，曾一起讨论税收安排。\n【其他事项】");
  const test = createFixtureEngine("v9362-intent-scopes");
  try {
    seedAdversarialFixture(test.engine, fixture);
    const calls = trackPairReads(test.engine);
    const matrixResults = [];
    const runMatrixRow = (id, content, expectedLevels, expectedTargets, overrides = {}, playerId = 1) => {
      clearCalls(calls);
      const result = retrieve(test.engine, fixture, content, overrides);
      const level = result.thirdPersonDecision.level;
      const thirdPersonReads = calls.reads.filter(entry => entry.ownerId === 2 && entry.counterpartId !== playerId).length;
      const thirdPersonSourceResolves = calls.resolves.filter(entry => entry.ownerId === 2 && entry.counterpartId !== playerId).length;
      const thirdPersonItems = result.pairMemoryItems.filter(item => item.routeKind === "third_direct_pair"
        || item.routeKind === "third_cross_pair");
      assert(expectedLevels.includes(level), `${id}: expected ${expectedLevels.join(" or ")}, got ${level}`);
      assert.deepEqual(result.thirdPersonDecision.targetCharacterIds, expectedTargets, `${id}: authorized target IDs`);
      assert(thirdPersonItems.every(item => expectedTargets.includes(item.targetCharacterId)),
        `${id}: injected third-person items must stay within authorized targets`);
      if (level === "L0") {
        assert.equal(thirdPersonReads, 0, `${id}: L0 must perform zero third-person PairLedger reads`);
        assert.equal(thirdPersonSourceResolves, 0, `${id}: L0 must perform zero third-person source resolves`);
        assert.equal(thirdPersonItems.length, 0, `${id}: L0 must inject no third-person item`);
      } else if (level === "L1") {
        assert(thirdPersonReads > 0, `${id}: L1 must traverse a real third-person PairLedger index`);
        assert.equal(thirdPersonSourceResolves, 0, `${id}: L1 must remain index-only`);
      } else {
        assert.equal(level, "L2", `${id}: unexpected history level`);
        assert(thirdPersonReads > 0, `${id}: L2 must traverse a real third-person PairLedger index`);
        assert(thirdPersonSourceResolves <= 2, `${id}: L2 source resolve attempts must stay at two or fewer`);
      }
      matrixResults.push({ id, level, targets: result.thirdPersonDecision.targetCharacterIds,
        thirdPersonIndexReads: thirdPersonReads, sourceResolveAttempts: thirdPersonSourceResolves,
        injectedTargets: [...new Set(thirdPersonItems.map(item => item.targetCharacterId))] });
      return result;
    };

    runMatrixRow("INT-01", "玛蒂尔达后来怎么样了？", ["L1"], [3]);
    runMatrixRow("INT-02", "战争之后你和玛蒂尔达发生了什么？", ["L1", "L2"], [3]);
    runMatrixRow("INT-03", "当年你和玛蒂尔达准备如何攻城？", ["L1"], [3]);
    runMatrixRow("INT-04", "记得把信交给玛蒂尔达。", ["L0"], []);
    runMatrixRow("INT-05", "接下来你准备怎么安排玛蒂尔达？", ["L0"], []);
    runMatrixRow("INT-06", "之后还要不要见玛蒂尔达？", ["L0"], []);
    runMatrixRow("INT-07", "别说废话。你以前和玛蒂尔达关系怎么样？", ["L1"], [3]);
    runMatrixRow("INT-08", "不要回忆玛蒂尔达。你当年和丁大人关系如何？", ["L1"], [4]);
    runMatrixRow("INT-09", "只谈现在，别提以前的事。", ["L0"], []);

    const boundFollowupCache = new Map();
    const boundFollowupConversation = "v9362-int10-binding";
    const boundFollowupScene = "v9362-int10-scene";
    const boundPrelude = retrieve(test.engine, fixture, "你以前和玛蒂尔达关系怎么样？", {
      sessionRecallCache: boundFollowupCache, turnEpoch: 1,
      conversationId: boundFollowupConversation, sceneRevision: boundFollowupScene
    });
    assert.equal(boundPrelude.thirdPersonDecision.level, "L1", "INT-10 setup establishes a valid history binding");
    assert.deepEqual(boundPrelude.thirdPersonDecision.targetCharacterIds, [3]);
    runMatrixRow("INT-10", "那后来呢？", ["L1"], [3], {
      sessionRecallCache: boundFollowupCache, turnEpoch: 2,
      conversationId: boundFollowupConversation, sceneRevision: boundFollowupScene
    });

    runMatrixRow("INT-11/no-binding", "那后来呢？", ["L0"], [], {
      sessionRecallCache: new Map(), turnEpoch: 2,
      conversationId: "v9362-int11-unbound", sceneRevision: "v9362-int11-scene"
    });
    const sceneBindingCache = new Map();
    const scenePrelude = retrieve(test.engine, fixture, "你以前和玛蒂尔达关系怎么样？", {
      sessionRecallCache: sceneBindingCache, turnEpoch: 1,
      conversationId: "v9362-int11-scene", sceneRevision: "v9362-int11-original"
    });
    assert.equal(scenePrelude.thirdPersonDecision.level, "L1", "INT-11 scene setup establishes a binding");
    const changedScene = runMatrixRow("INT-11/changed-scene", "那后来呢？", ["L0"], [], {
      sessionRecallCache: sceneBindingCache, turnEpoch: 2,
      conversationId: "v9362-int11-scene", sceneRevision: "v9362-int11-changed"
    });
    const playerBindingCache = new Map();
    const playerPrelude = retrieve(test.engine, fixture, "你以前和玛蒂尔达关系怎么样？", {
      sessionRecallCache: playerBindingCache, turnEpoch: 1,
      conversationId: "v9362-int11-player", sceneRevision: "v9362-int11-player-scene"
    });
    assert.equal(playerPrelude.thirdPersonDecision.level, "L1", "INT-11 player setup establishes a binding");
    const changedPlayer = runMatrixRow("INT-11/changed-player", "那后来呢？", ["L0"], [], {
      sessionRecallCache: playerBindingCache, turnEpoch: 2, trustedPlayerAnchorId: 5,
      conversationId: "v9362-int11-player", sceneRevision: "v9362-int11-player-scene"
    }, 5);
    const int11Variants = matrixResults.splice(-3);
    matrixResults.push({ id: "INT-11", level: "L0", targets: [], variants: int11Variants });
    assert.equal(changedScene.thirdPersonDecision.level, "L0");
    assert.equal(changedPlayer.thirdPersonDecision.level, "L0");

    runMatrixRow("INT-12", "“你们在战争之后发生了什么？”这句话是什么意思？", ["L0"], []);
    runMatrixRow("INT-13", "1090年和玛蒂尔达的具体争执经过是什么？", ["L2"], [3]);
    const int14 = runMatrixRow("INT-14", "我明天见玛蒂尔达。你过去与丁大人有何交情？", ["L1"], [4]);
    const int14Items = int14.pairMemoryItems.filter(item => item.routeKind === "third_direct_pair"
      || item.routeKind === "third_cross_pair");
    assert(int14Items.every(item => item.targetCharacterId === 4), "INT-14 may inject only D-targeted matters");
    const sameNameProfiles = [...profiles, { id: 5, name: "玛蒂尔达", aliases: ["玛蒂尔达"] }];
    runMatrixRow("INT-15", "你以前和玛蒂尔达关系怎么样？", ["L0"], [], { entityProfiles: sameNameProfiles });
    const npcMessageId = 9016;
    const npcHistory = [...fixture.history,
      { id: npcMessageId, role: "user", speakerCharacterId: 1, addresseeId: 2, content: "请继续。" },
      { id: npcMessageId + 1, role: "assistant", speakerCharacterId: 3, content: "你以前和玛蒂尔达关系怎么样？" }];
    runMatrixRow("INT-16", "请继续。", ["L0"], [], {
      turnEpoch: 16, currentPlayerMessageId: npcMessageId, history: npcHistory,
      conversationId: "v9362-int16-npc", sceneRevision: "v9362-int16-scene"
    });

    for (const text of ["玛蒂尔达后来怎么样了？", "战争之后你和玛蒂尔达发生了什么？"]) {
      clearCalls(calls);
      const result = retrieve(test.engine, fixture, text);
      assert.notEqual(result.thirdPersonDecision.level, "L0", `${text}: past event wording must permit history`);
      assert.deepEqual(result.thirdPersonDecision.targetCharacterIds, [3], `${text}: only the named target is authorized`);
      assert(scopeCount(calls, "reads", 3) > 0, `${text}: the real B→C PairLedger index is read`);
      if (result.thirdPersonDecision.level === "L1") {
        assert.equal(scopeCount(calls, "resolves", 3), 0, `${text}: L1 stays index-only`);
      } else {
        assert.equal(result.thirdPersonDecision.level, "L2", `${text}: any detail request uses the existing L2 level`);
        assert(scopeCount(calls, "resolves", 3) <= 2, `${text}: L2 keeps the bounded source-resolution contract`);
      }
    }

    assert.equal(classifyTemporalIntent("当年你准备如何攻城？").kind, "PAST_HISTORY",
      "a past anchor makes ‘prepared’ historical rather than a current plan");
    assert.equal(classifyTemporalIntent("接下来你准备怎么安排玛蒂尔达？").kind, "CURRENT_FUTURE");
    assert.equal(classifyTemporalIntent("你打算如何安排玛蒂尔达？").kind, "CURRENT_FUTURE");

    for (const text of ["记得把信交给玛蒂尔达。", "接下来打算如何安排玛蒂尔达？", "之后还要不要见玛蒂尔达？",
      "不要回忆玛蒂尔达。只谈今天的安排。"] ) {
      clearCalls(calls);
      const result = retrieve(test.engine, fixture, text);
      assert.equal(result.thirdPersonDecision.level, "L0", `${text}: reminder/current intent stays L0`);
      assert.equal(calls.reads.filter(entry => entry.ownerId === 2 && entry.counterpartId !== 1).length, 0,
        `${text}: L0 cannot read any third-person PairLedger scope`);
      assert.equal(calls.resolves.filter(entry => entry.ownerId === 2 && entry.counterpartId !== 1).length, 0,
        `${text}: L0 cannot resolve a third-person source`);
      assert.equal(result.pairMemoryItems.filter(item => item.routeKind === "third_direct_pair"
        || item.routeKind === "third_cross_pair").length, 0, `${text}: L0 injects no third-person item`);
    }

    clearCalls(calls);
    const fillerThenHistory = retrieve(test.engine, fixture, "别说废话。你以前和玛蒂尔达关系怎么样？");
    assert.equal(fillerThenHistory.thirdPersonDecision.level, "L1",
      "a non-history ‘别说’ clause cannot deny the later historical question");
    assert.deepEqual(fillerThenHistory.thirdPersonDecision.targetCharacterIds, [3]);
    assert(scopeCount(calls, "reads", 3) > 0);
    assert.equal(scopeCount(calls, "resolves", 3), 0);

    clearCalls(calls);
    const scopedDenial = retrieve(test.engine, fixture,
      "不要谈玛蒂尔达以前的事，但说说你当年和丁大人的关系里提到过哪些税收安排？");
    assert.equal(scopedDenial.thirdPersonDecision.level, "L1",
      "a denial for C cannot cancel a separately named historical query about D");
    assert.deepEqual(scopedDenial.thirdPersonDecision.targetCharacterIds, [4]);
    const scopedItems = scopedDenial.pairMemoryItems.filter(item => item.routeKind === "third_direct_pair"
      || item.routeKind === "third_cross_pair");
    assert(scopedItems.every(item => item.targetCharacterId === 4), "only D-targeted matters may be injected");
    assert(scopedItems.some(item => item.text.includes("D_RELATIONSHIP_ONLY")), "the authorized D matter remains retrievable");
    assert.equal(scopeCount(calls, "resolves", 3), 0, "L1 does not open Legacy source text");

    const targetDenialCache = new Map();
    retrieve(test.engine, fixture, "你以前和玛蒂尔达关系怎么样？", {
      sessionRecallCache: targetDenialCache, turnEpoch: 1,
      conversationId: "v9362-target-denial", sceneRevision: "v9362-target-denial-scene"
    });
    assert.equal(targetDenialCache.get(2)?.namedTargetFocus?.characterId, 3,
      "the setup turn establishes C as the recent named target");
    clearCalls(calls);
    const deniedTargetAnaphora = retrieve(test.engine, fixture,
      "不要谈玛蒂尔达。你以前和她关系怎么样？", {
        sessionRecallCache: targetDenialCache, turnEpoch: 2,
        conversationId: "v9362-target-denial", sceneRevision: "v9362-target-denial-scene"
      });
    assert.equal(deniedTargetAnaphora.thirdPersonDecision.level, "L0",
      "a unique named-target denial blocks using the prior C focus to resolve a later pronoun");
    assert.deepEqual(deniedTargetAnaphora.thirdPersonDecision.targetCharacterIds, []);
    assert.equal(deniedTargetAnaphora.thirdPersonDecision.denialDetected, true);
    assert.equal(calls.reads.filter(entry => entry.ownerId === 2 && entry.counterpartId !== 1).length, 0,
      "the denied pronoun cannot read any third-person PairLedger scope");
    assert.equal(calls.resolves.filter(entry => entry.ownerId === 2 && entry.counterpartId !== 1).length, 0);

    clearCalls(calls);
    const deniedCExplicitD = retrieve(test.engine, fixture,
      "不要谈玛蒂尔达。不过你以前和丁大人关系怎么样？", {
        sessionRecallCache: targetDenialCache, turnEpoch: 3,
        conversationId: "v9362-target-denial", sceneRevision: "v9362-target-denial-scene"
      });
    assert.equal(deniedCExplicitD.thirdPersonDecision.level, "L1",
      "a C-scoped denial does not suppress a separately named D history request");
    assert.deepEqual(deniedCExplicitD.thirdPersonDecision.targetCharacterIds, [4]);
    const deniedCExplicitDItems = deniedCExplicitD.pairMemoryItems.filter(item => item.routeKind === "third_direct_pair"
      || item.routeKind === "third_cross_pair");
    assert(deniedCExplicitDItems.every(item => item.targetCharacterId === 4),
      "the role-scoped denial leaves injected third-person matters targeted only to D");
    assert(scopeCount(calls, "reads", 4) > 0);
    assert.equal(scopeCount(calls, "resolves", 4), 0);

    clearCalls(calls);
    const scopedDetail = retrieve(test.engine, fixture,
      "不要谈玛蒂尔达以前的事，但请说说丁大人1090年具体如何交换密信的？");
    assert.equal(scopedDetail.thirdPersonDecision.level, "L2");
    assert.deepEqual(scopedDetail.thirdPersonDecision.targetCharacterIds, [4]);
    assert.equal(scopedDetail.pairMemoryMetrics.legacyFallbackUsed, true,
      "an index miss exercises the existing bounded Legacy detail fallback: "
        + JSON.stringify({ decision: scopedDetail.thirdPersonDecision, metrics: scopedDetail.pairMemoryMetrics }));
    assert(scopedDetail.pairMemorySources.some(entry => entry.memory.content.includes("D_DETAIL_SOURCE")),
      "the D-only detail query opens its matching source");
    assert(scopedDetail.pairMemorySources.every(entry => entry.routeCharacterIds.includes(4)),
      "a denied C clause cannot affect the Legacy fallback target scope");
    assert(calls.resolves.length <= 2, "all L2 detail paths retain the two-source attempt limit");

    const quotedOnly = '他说「她说『你以前和玛蒂尔达如何』，别回忆丁大人」；我只想问今日安排。';
    assert.equal(removeQuotedText(quotedOnly), "他说 ；我只想问今日安排。");
    clearCalls(calls);
    const quoted = retrieve(test.engine, fixture, quotedOnly);
    assert.equal(quoted.thirdPersonDecision.level, "L0", "nested quoted history and denial cannot authorize retrieval");
    assert.equal(calls.reads.filter(entry => entry.ownerId === 2 && entry.counterpartId !== 1).length, 0);
    assert.equal(calls.resolves.filter(entry => entry.ownerId === 2 && entry.counterpartId !== 1).length, 0);

    clearCalls(calls);
    const quoteThenHistory = retrieve(test.engine, fixture,
      "他说「她转述『不要回忆玛蒂尔达以前的事』」；你以前和丁大人关系怎么样？");
    assert.equal(quoteThenHistory.thirdPersonDecision.level, "L1",
      "nested quoted denial cannot suppress a separate unquoted historical clause");
    assert.deepEqual(quoteThenHistory.thirdPersonDecision.targetCharacterIds, [4]);
    assert.equal(calls.resolves.length, 0, "the quoted denial does not add source permission");

    const sessionRecallCache = new Map();
    retrieve(test.engine, fixture, "你以前和玛蒂尔达关系怎么样？", {
      sessionRecallCache, turnEpoch: 1, conversationId: "v9362-denied-anaphora", sceneRevision: "v9362-denied-scene"
    });
    clearCalls(calls);
    const ambiguousAnaphora = retrieve(test.engine, fixture,
      "不要回忆玛蒂尔达以前的事；不过请说说这件事当年怎么发生的", {
        sessionRecallCache, turnEpoch: 2, conversationId: "v9362-denied-anaphora", sceneRevision: "v9362-denied-scene"
      });
    assert.equal(ambiguousAnaphora.thirdPersonDecision.level, "L0",
      "an anaphoric historical clause cannot inherit the target denied in the same message");
    assert.deepEqual(ambiguousAnaphora.thirdPersonDecision.targetCharacterIds, []);
    assert.equal(calls.reads.filter(entry => entry.ownerId === 2 && entry.counterpartId !== 1).length, 0,
      "an unresolved target behind a denial fails closed before any third-person PairLedger read");
    assert.equal(calls.resolves.filter(entry => entry.ownerId === 2 && entry.counterpartId !== 1).length, 0);

    assert.equal(matrixResults.length, 16, "the complete INT-01 through INT-16 acceptance matrix ran through MemoryEngine");
    console.log(`V9.3.6.2 intent scopes: PASS (${matrixResults.length}/16 matrix rows)`);
    console.log(JSON.stringify(matrixResults));
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
