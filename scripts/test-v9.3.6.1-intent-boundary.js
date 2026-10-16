"use strict";

const assert = require("node:assert/strict");
const {
  createAdversarialFixtureData,
  createFixtureEngine,
  makeCandidateRequest,
  seedAdversarialFixture
} = require("./test-v9.3.6-independent-qa");

const profiles = [
  { id: 1, name: "甲", aliases: ["甲"] },
  { id: 2, name: "乙", aliases: ["乙"] },
  { id: 3, name: "玛蒂尔达", aliases: ["玛蒂尔达"] },
  { id: 4, name: "丁大人", aliases: ["丁大人"] }
];

function trackPairReads(engine) {
  const calls = { reads: [], resolves: [] };
  const pairLedger = engine.store.pairLedger;
  const read = pairLedger.read.bind(pairLedger);
  const resolveSource = pairLedger.resolveSource.bind(pairLedger);
  pairLedger.read = (scope, ...args) => {
    calls.reads.push({ ownerId: Number(scope.ownerId), counterpartId: Number(scope.counterpartId) });
    return read(scope, ...args);
  };
  pairLedger.resolveSource = (scope, pointer, ...args) => {
    calls.resolves.push({ ownerId: Number(scope.ownerId), counterpartId: Number(scope.counterpartId),
      sourceSummaryKey: pointer?.sourceSummaryKey || null });
    return resolveSource(scope, pointer, ...args);
  };
  return calls;
}

function retrieve(engine, fixture, content, overrides = {}) {
  const request = makeCandidateRequest(fixture, "nameOnly", {
    playerContent: content,
    entityProfiles: profiles,
    conversationId: "v9361-intent-boundary",
    sceneRevision: "v9361-intent-scene",
    ...overrides
  });
  return engine.retrieveForResponder(request);
}

function countScope(calls, collection, counterpartId) {
  return calls[collection].filter(entry => entry.ownerId === 2 && entry.counterpartId === counterpartId).length;
}

function run() {
  const fixture = createAdversarialFixtureData();
  const dSummary = fixture.pairSummaries.find(pair => pair.ownerId === 2 && pair.counterpartId === 4).summaries[0];
  dSummary.content = dSummary.content.replace("【其他事项】", "- D_RELATIONSHIP_ONLY：丁大人和乙一直互相信任，并共同守护了一段友谊。\n【其他事项】");
  const test = createFixtureEngine("v9361-intent-boundary");
  try {
    seedAdversarialFixture(test.engine, fixture);
    const calls = trackPairReads(test.engine);
    const l0Cases = [
      ["IN-01", "记得把信交给玛蒂尔达。"],
      ["IN-02", "记得通知玛蒂尔达明天赴宴。"],
      ["IN-03", "接下来你准备怎么安排玛蒂尔达？"],
      ["IN-04", "之后还要不要和玛蒂尔达见面？"],
      ["IN-05", "玛蒂尔达现在在哪里？"],
      ["IN-11", "丁说“我记得玛蒂尔达”，你怎么看？"],
      ["IN-12", "别回忆玛蒂尔达以前的事，只说今天安排。"]
    ];
    const checks = [];
    for (const [id, content] of l0Cases) {
      calls.reads.length = 0;
      calls.resolves.length = 0;
      const result = retrieve(test.engine, fixture, content);
      assert.equal(result.thirdPersonDecision.level, "L0", `${id}: current/future or quoted/denied text stays L0`);
      assert.equal(countScope(calls, "reads", 3), 0, `${id}: L0 must not read the real B→C PairLedger index`);
      assert.equal(countScope(calls, "resolves", 3), 0, `${id}: L0 must not resolve a B→C Legacy source`);
      checks.push({ id, level: result.thirdPersonDecision.level, thirdPersonIndexReads: 0, sourceResolves: 0 });
    }

    calls.reads.length = 0;
    calls.resolves.length = 0;
    const missingTurn = retrieve(test.engine, fixture, "你还记得玛蒂尔达吗？", { trustedPlayerTurn: null });
    assert.equal(missingTurn.thirdPersonDecision.level, "L0", "an untrusted current player turn cannot grant history access");
    assert.equal(countScope(calls, "reads", 3), 0, "no trusted turn must not read the third-person index");
    assert.equal(countScope(calls, "resolves", 3), 0, "no trusted turn must not open a third-person source");
    checks.push({ id: "IN-TRUSTED-TURN", level: "L0", thirdPersonIndexReads: 0, sourceResolves: 0 });

    calls.reads.length = 0;
    calls.resolves.length = 0;
    const l1 = retrieve(test.engine, fixture, "你还记得玛蒂尔达吗？");
    assert.equal(l1.thirdPersonDecision.level, "L1", "an explicit historical relationship question remains authorized");
    assert.deepEqual(l1.thirdPersonDecision.targetCharacterIds, [3]);
    assert(countScope(calls, "reads", 3) > 0, "L1 must query the real B→C index");
    assert.equal(countScope(calls, "resolves", 3), 0, "L1 must remain index-only");
    checks.push({ id: "IN-06", level: "L1", thirdPersonIndexReads: countScope(calls, "reads", 3), sourceResolves: 0 });

    calls.reads.length = 0;
    calls.resolves.length = 0;
    const l2 = retrieve(test.engine, fixture, "1090年你和玛蒂尔达具体争执过什么？");
    assert.equal(l2.thirdPersonDecision.level, "L2", "an explicit past-event detail question remains authorized");
    assert.deepEqual(l2.thirdPersonDecision.targetCharacterIds, [3]);
    assert(countScope(calls, "resolves", 3) <= 2, "L2 must keep the total source-open limit at two");
    checks.push({ id: "IN-08", level: "L2", thirdPersonIndexReads: countScope(calls, "reads", 3),
      sourceResolves: countScope(calls, "resolves", 3) });

    const sessionRecallCache = new Map();
    const first = retrieve(test.engine, fixture, "你以前和玛蒂尔达关系怎么样？", {
      sessionRecallCache, turnEpoch: 1, conversationId: "v9361-followup", sceneRevision: "scene-followup"
    });
    assert.equal(first.thirdPersonDecision.level, "L1");
    calls.reads.length = 0;
    calls.resolves.length = 0;
    const followup = retrieve(test.engine, fixture, "那后来呢？", {
      sessionRecallCache, turnEpoch: 2, conversationId: "v9361-followup", sceneRevision: "scene-followup"
    });
    assert.equal(followup.thirdPersonDecision.level, "L1", "a valid adjacent binding may only grant L1");
    assert.deepEqual(followup.thirdPersonDecision.targetCharacterIds, [3]);
    assert.equal(countScope(calls, "resolves", 3), 0, "a follow-up cannot inherit prior L2 source permission");
    checks.push({ id: "IN-09", level: "L1", sourceResolves: 0 });

    calls.reads.length = 0;
    calls.resolves.length = 0;
    const mixed = retrieve(test.engine, fixture, "记得把信交给玛蒂尔达。你以前和丁大人关系怎么样？", {
      entityProfiles: profiles
    });
    assert.equal(mixed.thirdPersonDecision.level, "L1", "a separate explicit history question survives a mixed turn");
    assert.deepEqual(mixed.thirdPersonDecision.targetCharacterIds, [4],
      "the current instruction's target cannot be added to the separate historical question");
    const mixedThirdPersonItems = mixed.pairMemoryItems.filter(item =>
      item.routeKind === "third_direct_pair" || item.routeKind === "third_cross_pair");
    assert(mixedThirdPersonItems.some(item => item.text.includes("D_RELATIONSHIP_ONLY")),
      "future instructions must not pollute the separate historical question's relevance terms");
    assert(mixedThirdPersonItems.every(item => item.targetCharacterId === 4),
      "the current instruction cannot inject C-only indexed matters");
    assert(countScope(calls, "reads", 4) > 0, "the separate historical question may read only B→D");
    assert.equal(countScope(calls, "resolves", 3), 0, "the current instruction cannot open B→C sources");
    checks.push({ id: "IN-MIXED-TARGETS", level: "L1", targetCharacterIds: mixed.thirdPersonDecision.targetCharacterIds,
      injectedTargetIds: [...new Set(mixedThirdPersonItems.map(item => item.targetCharacterId))],
      dIndexReads: countScope(calls, "reads", 4) });

    console.log("V9.3.6.1 intent boundary: PASS (" + checks.length + " checks)");
    console.log(JSON.stringify(checks));
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
