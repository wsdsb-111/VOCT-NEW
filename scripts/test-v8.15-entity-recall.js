"use strict";

const assert = require("node:assert/strict");
const { MemoryEngine } = require("../resources/app/out/main/memory-system/memory-engine");
const { MentionTracker } = require("../resources/app/out/main/memory-system/mention-tracker");

const ownerId = 2;
const targetId = 3;
const campaignToken = "campaign-entity-recall";

function summary(memoryId, counterpartId, content, subjects = [counterpartId]) {
  return {
    memoryId,
    type: "folder_summary",
    content,
    canonicalText: content,
    tags: [],
    participants: [ownerId, counterpartId],
    subjects,
    knownBy: [ownerId],
    visibility: "private",
    importance: 0.7,
    eventDate: "867.1.1",
    totalDays: 1,
    provenance: {
      folderOwnerId: ownerId,
      counterpartId,
      counterpartIds: [counterpartId],
      campaignToken,
      finalizationId: memoryId
    }
  };
}

function retrieve({ activeIds, explicitTargetEntityIds = [], query = "C 为什么这么做？", memory4Enabled = false, querySpeakerId = 1 }) {
  const memories = [
    summary("summary-a", 1, "A 与 B 在朝会上商议边境事务。"),
    summary("summary-c-recent", targetId, "C 在宴会上拒绝了这项请求。"),
    summary("summary-c-older", 4, "C 早年曾为边境事务提出另一套办法。", [targetId])
  ];
  const calls = [];
  const store = {
    index: { memories: {} },
    getFolderSummaryRevision: () => 1,
    getFolderSummarySnapshotRevision: () => 1,
    loadFolderSummariesForCharacter: () => memories,
    loadDirectPairSummaries: (requestedOwnerId, counterpartId, rows) => rows.filter(memory =>
      Number(memory.provenance.folderOwnerId) === Number(requestedOwnerId)
      && Number(memory.provenance.counterpartId) === Number(counterpartId)),
    searchOwnerFolderForEntity: (requestedOwnerId, entityId, aliases, rows) => {
      calls.push({ requestedOwnerId, entityId, aliases });
      return rows.filter(memory => Number(memory.provenance.folderOwnerId) === Number(requestedOwnerId)
        && (Number(memory.provenance.counterpartId) === Number(entityId) || memory.subjects.includes(Number(entityId))));
    },
    queryMemories: () => [],
    getCharacterKnowledge: () => [],
    getFolderSummaryLoadDiagnostics: () => null,
    getFolderSummaryCacheMetrics: () => ({})
  };
  const engine = new MemoryEngine({ store, trace: { record() {} } });
  let plannerOptions = null;
  if (memory4Enabled) engine.memory4Recall = {
    plan(options) {
      plannerOptions = options;
      return { items: [], text: "【Memory4 packet】", tokens: 0, diagnostics: {}, query: {}, focus: null };
    }
  };
  const result = engine.retrieveForResponder({
    characterId: ownerId,
    query,
    directCounterpartIds: activeIds.filter(id => id !== ownerId),
    activeParticipantIds: activeIds,
    querySpeakerId,
    explicitTargetEntityIds,
    entityProfiles: [
      { id: ownerId, shortName: "B" },
      { id: targetId, shortName: "C", firstName: "C", fullName: "C" }
    ],
    gameData: { characters: new Map([[targetId, { id: targetId, shortName: "C", firstName: "C", fullName: "C" }]]) },
    ownerFolderMemories: memories,
    currentGameDate: "867.1.1",
    currentTotalDays: 1,
    campaignToken,
    conversationId: "conversation-entity-recall",
    sceneRevision: "scene-1",
    turnEpoch: 1,
    memoryEngine3Enabled: true,
    memory4RecallEnabled: memory4Enabled,
    temporalSummaryRecallEnabled: true,
    tokenBudget: 1200,
    estimateTokens: text => Math.ceil(String(text || "").length / 4)
  });
  return { result, calls, plannerOptions };
}

function testActivePresenceDoesNotChangeExplicitTargetEligibility() {
  const twoPerson = retrieve({ activeIds: [1, ownerId], explicitTargetEntityIds: [targetId] });
  const threePerson = retrieve({ activeIds: [1, ownerId, targetId], explicitTargetEntityIds: [targetId] });
  const targetIds = recall => recall.result.entityTargetRecall?.selectedIds || [];

  assert.deepEqual(targetIds(twoPerson).sort(), ["summary-c-older", "summary-c-recent"]);
  assert.deepEqual(targetIds(threePerson).sort(), ["summary-c-older", "summary-c-recent"]);
  assert.deepEqual(twoPerson.result.entityTargetRecall?.candidateIds.sort(), ["summary-c-older", "summary-c-recent"]);
  assert.deepEqual(threePerson.result.entityTargetRecall?.candidateIds.sort(), ["summary-c-older", "summary-c-recent"]);
  assert.match(twoPerson.result.temporalExtraText, /C 早年曾为边境事务提出另一套办法/);
  assert.match(threePerson.result.temporalExtraText, /C 早年曾为边境事务提出另一套办法/);
  const directHit = threePerson.result.direct.find(entry => entry.memory.memoryId === "summary-c-recent");
  assert.deepEqual(directHit?.explicitTargetEntityIds, [targetId]);
  assert.ok(directHit?.routeKinds.includes("entity_target"));
  assert.equal((threePerson.result.directText.match(/C 在宴会上拒绝了这项请求/g) || []).length, 1);
  assert.ok(!threePerson.result.temporalExtraText?.includes("C 在宴会上拒绝了这项请求"));
}

function testGenericQueryDoesNotRetrieveEveryActiveEntity() {
  const { result, calls } = retrieve({ activeIds: [1, ownerId, targetId], explicitTargetEntityIds: [], query: "今日天气如何？" });
  assert.equal(result.entityTargetRecall?.candidateCount, 0);
  assert.deepEqual(calls, []);
  assert.ok(!result.temporalExtraText?.includes("C 早年曾为边境事务提出另一套办法"));
}

function testMemory4ReceivesIndependentTargetAndPresenceSets() {
  const activeTarget = retrieve({ activeIds: [1, ownerId, targetId], explicitTargetEntityIds: [targetId], memory4Enabled: true });
  const generic = retrieve({ activeIds: [1, ownerId, targetId], explicitTargetEntityIds: [], query: "今日天气如何？", memory4Enabled: true });
  assert.deepEqual(activeTarget.plannerOptions.explicitTargetEntityIds, [targetId]);
  assert.deepEqual(activeTarget.plannerOptions.activeParticipantIds, [1, ownerId, targetId]);
  assert.deepEqual(activeTarget.plannerOptions.mentionedOutOfSceneIds, []);
  assert.deepEqual(generic.plannerOptions.explicitTargetEntityIds, []);
  assert.deepEqual(generic.plannerOptions.activeParticipantIds, [1, ownerId, targetId]);
  assert.deepEqual(generic.plannerOptions.entityIds, [1]);
  assert.match(activeTarget.result.temporalExtraText, /Memory4 packet/);
}

function testExplicitTargetsKeepPlayerAndExcludeOnlyResponder() {
  const { result } = retrieve({ activeIds: [1, ownerId, targetId], explicitTargetEntityIds: [1, ownerId, targetId] });
  assert.deepEqual(result.entityTargetRecall?.explicitTargetEntityIds, [1, targetId]);
  assert.ok(result.entityTargetRecall?.candidateIds.includes("summary-a"));
}

function testUniqueFullNameOverridesOverlappingAmbiguousTitle() {
  const tracker = new MentionTracker();
  const candidates = [
    { id: 10, shortName: "King Arlen", fullName: "King Arlen", primaryTitle: "King" },
    { id: 11, shortName: "King Beryl", fullName: "King Beryl", primaryTitle: "King" }
  ];
  assert.deepEqual(tracker.findMentionedCharacterIds([{ role: "user", content: "King Arlen 当时为何拒绝？" }], { candidates }), [10]);
  assert.equal(tracker.lastScanUnresolved, false);
}

function testAmbiguousTitleAloneRemainsUnresolved() {
  const tracker = new MentionTracker();
  const candidates = [
    { id: 10, shortName: "King Arlen", fullName: "King Arlen", primaryTitle: "King" },
    { id: 11, shortName: "King Beryl", fullName: "King Beryl", primaryTitle: "King" }
  ];
  assert.deepEqual(tracker.findMentionedCharacterIds([{ role: "user", content: "King 为何拒绝？" }], { candidates }), []);
  assert.equal(tracker.lastScanUnresolved, true);
}

function testUniqueNameCanBindAdjacentAmbiguousTitle() {
  const tracker = new MentionTracker();
  const candidates = [
    { id: 3, shortName: "赵光义", fullName: "赵光义", primaryTitle: "皇帝" },
    { id: 4, shortName: "赵匡义", fullName: "赵匡义", primaryTitle: "皇帝" }
  ];
  assert.deepEqual(tracker.findMentionedCharacterIds([{ role: "user", content: "皇帝赵光义当时怎么说" }], { candidates }), [3]);
  assert.equal(tracker.lastScanUnresolved, false);
}

function testSeparateAmbiguousTitleStillBlocksIdentityResolution() {
  const tracker = new MentionTracker();
  const candidates = [
    { id: 3, shortName: "赵光义", fullName: "赵光义", primaryTitle: "皇帝" },
    { id: 4, shortName: "赵匡义", fullName: "赵匡义", primaryTitle: "皇帝" }
  ];
  assert.deepEqual(tracker.findMentionedCharacterIds([{ role: "user", content: "赵光义和皇帝各怎么说" }], { candidates }), [3]);
  assert.equal(tracker.lastScanUnresolved, true);
}

function testUnrelatedUniqueNameDoesNotResolveAdjacentTitle() {
  const tracker = new MentionTracker();
  const candidates = [
    { id: 3, shortName: "赵光义", fullName: "赵光义", primaryTitle: "皇帝" },
    { id: 4, shortName: "赵匡义", fullName: "赵匡义", primaryTitle: "皇帝" },
    { id: 5, shortName: "旁人", fullName: "旁人" }
  ];
  assert.deepEqual(tracker.findMentionedCharacterIds([{ role: "user", content: "旁人皇帝各怎么说" }], { candidates }), [5]);
  assert.equal(tracker.lastScanUnresolved, true);
}

testActivePresenceDoesNotChangeExplicitTargetEligibility();
testGenericQueryDoesNotRetrieveEveryActiveEntity();
testMemory4ReceivesIndependentTargetAndPresenceSets();
testExplicitTargetsKeepPlayerAndExcludeOnlyResponder();
testUniqueFullNameOverridesOverlappingAmbiguousTitle();
testAmbiguousTitleAloneRemainsUnresolved();
testUniqueNameCanBindAdjacentAmbiguousTitle();
testSeparateAmbiguousTitleStillBlocksIdentityResolution();
testUnrelatedUniqueNameDoesNotResolveAdjacentTitle();
console.log("PASS v8.15 explicit entity recall routing");
