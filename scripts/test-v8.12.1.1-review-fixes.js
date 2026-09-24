"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { MemoryEngine } = require("../resources/app/out/main/memory-system/memory-engine");
const { MemoryTrace } = require("../resources/app/out/main/memory-system/memory-trace");
const { createMemoryRecord, memoryMatchesCampaign } = require("../resources/app/out/main/memory-system/memory-types");
const { buildPerspectiveSummaryMap, validatePerspectiveSummaryMap } = require("../resources/app/out/main/memory-system/perspective-projector");
const { buildDualTemporalIndex } = require("../resources/app/out/main/memory-system/summary-date-index");
const { detectTemporalAxisIntent, normalizeTemporalRefs } = require("../resources/app/out/main/memory-system/temporal-anchor-extractor");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v81211-"));
try {
  const engine = new MemoryEngine({ baseDir: path.join(root, "memory"), trace: new MemoryTrace({ logger: { log() {} } }) });
  const folder = (id, campaignToken) => createMemoryRecord({
    memoryId: id, type: "folder_summary", content: id, eventDate: "1150.6.12", totalDays: 6000,
    participants: [1, 2], knownBy: [2], provenance: { folderOwnerId: 2, counterpartId: 1, campaignToken }
  });
  const campaignA = folder("campaign-a-summary", "campaign-a");
  const campaignB = folder("campaign-b-summary", "campaign-b");
  const legacy = folder("legacy-summary", null);
  engine.store.saveMemory(createMemoryRecord({ memoryId: "campaign-b-internal", type: "event", content: "other campaign",
    participants: [1, 2], knownBy: [2], provenance: { campaignToken: "campaign-b" } }));
  engine.store.saveMemory(createMemoryRecord({ memoryId: "legacy-internal", type: "event", content: "legacy campaign",
    participants: [1, 2], knownBy: [2], provenance: { campaignToken: null } }));
  assert.equal(memoryMatchesCampaign(campaignA, "campaign-a"), true);
  assert.equal(memoryMatchesCampaign(campaignB, "campaign-a"), false);
  assert.equal(memoryMatchesCampaign(legacy, "campaign-a"), false);
  assert.equal(memoryMatchesCampaign(legacy, null), true);
  assert.equal(memoryMatchesCampaign(campaignA, null), false);
  const input = { characterId: 2, directCounterpartIds: [1], ownerFolderMemories: [campaignA, campaignB, legacy],
    campaignToken: "campaign-a", query: "以前的事情", currentGameDate: "1152.6.12", currentTotalDays: 6700,
    conversationId: "conversation-a", sceneRevision: "scene-a", tokenBudget: 3000, estimateTokens: text => text.length,
    sessionRecallCache: new Map(), turnEpoch: 1 };
  const scoped = engine.retrieveForResponder(input);
  assert(scoped.direct.length > 0);
  assert(scoped.direct.concat(scoped.stable, scoped.extra).every(entry => entry.memory.memoryId === campaignA.memoryId));
  assert.equal(engine.retrieveTurnRecall({ characterId: 2, query: "以前的事情", ownerFolderMemories: [campaignA, campaignB, legacy], campaignToken: "campaign-a" }).candidateCount, 1);
  assert.equal(engine.retrieveForResponder({ ...input, ownerFolderMemories: [legacy], officialSummary: {
    sourceType: "CK3_OFFICIAL_RECOLLECTION", campaignToken: "campaign-b", playerId: 2, memoryCount: 1, content: "other campaign" },
    sessionRecallCache: new Map() }).direct.length, 0);
  assert.equal(buildDualTemporalIndex([campaignA, campaignB, legacy], { ownerId: 2, counterpartId: 1, campaignToken: "campaign-a", currentGameDate: "1152.6.12", currentTotalDays: 6700 }).length, 1);
  assert.equal(buildDualTemporalIndex([campaignA, campaignB, legacy], { ownerId: 2, counterpartId: 1, campaignToken: null, currentGameDate: "1152.6.12", currentTotalDays: 6700 }).length, 1);

  const privateMemory = createMemoryRecord({ memoryId: "private-war", type: "event", content: "1145年我亲眼见到战事", participants: [2], subjects: [1],
    knownBy: [2], visibility: "private", eventDate: "1150.6.12", provenance: { messageIds: [7], campaignToken: "campaign-a" } });
  const context = { conversationId: "conversation-a", date: "1150.6.12", participants: [1, 2, 3].map(id => ({ id, name: `P${id}` })),
    messages: [{ id: 7, name: "P2", content: "1145年我亲眼见到战事" }] };
  const extraction = { summarySegments: [], memories: [privateMemory] };
  engine.attachTemporalEvidence(context, extraction);
  assert.deepEqual(privateMemory.provenance.temporalRefs[0].sourceMemoryIds, [privateMemory.memoryId]);
  assert.deepEqual(privateMemory.provenance.temporalRefs[0].segmentIds, []);
  const projections = buildPerspectiveSummaryMap(context, extraction);
  assert.equal(validatePerspectiveSummaryMap(context, extraction, projections).success, true);
  assert.equal(projections.get("2->1").temporalRefs.length, 1);
  assert.equal(projections.get("1->2").temporalRefs.length, 0);
  assert.equal(projections.get("3->1").temporalRefs.length, 0);
  projections.get("1->2").temporalRefs = projections.get("2->1").temporalRefs;
  assert.equal(validatePerspectiveSummaryMap(context, extraction, projections).success, false);
  engine.store.saveMemory(privateMemory);
  const restarted = new MemoryEngine({ baseDir: path.join(root, "memory"), trace: new MemoryTrace({ logger: { log() {} } }) });
  assert.deepEqual(restarted.store.getMemory(privateMemory.memoryId).provenance.temporalRefs[0].sourceMemoryIds, [privateMemory.memoryId]);
  const projected = folder("private-projection", "campaign-a");
  projected.provenance.temporalRefs = projections.get("2->1").temporalRefs;
  projected.provenance.perspectiveMemoryIds = projections.get("2->1").memoryIds;
  assert.equal(buildDualTemporalIndex([projected], { ownerId: 2, counterpartId: 1, campaignToken: "campaign-a", currentGameDate: "1152.6.12", currentTotalDays: 6700 }).filter(entry => entry.axis === "event").length, 1);
  assert.deepEqual(normalizeTemporalRefs([{ ...privateMemory.provenance.temporalRefs[0], sourceMemoryIds: [""] }]), []);
  const unbound = folder("unbound", "campaign-a");
  unbound.provenance.temporalRefs = normalizeTemporalRefs([{ ...projected.provenance.temporalRefs[0], sourceMemoryIds: [], segmentIds: [] }]);
  assert.equal(buildDualTemporalIndex([unbound], { ownerId: 2, counterpartId: 1, campaignToken: "campaign-a", currentGameDate: "1152.6.12", currentTotalDays: 6700 }).filter(entry => entry.axis === "event").length, 0);

  const utterances = [
    ["五年前我们聊了什么", "CONVERSATION"], ["那一年你说了什么", "CONVERSATION"],
    ["当时他讲了什么", "CONVERSATION"], ["七年前我问了什么", "CONVERSATION"],
    ["那天你告知我什么", "CONVERSATION"], ["那年我们提到了谁", "CONVERSATION"],
    ["当年你回答了什么", "CONVERSATION"], ["去年我们讨论什么", "CONVERSATION"],
    ["五年前你跟我说过什么", "CONVERSATION"], ["那时你谈起什么", "CONVERSATION"],
    ["五年前发生了什么", "EVENT"], ["那一年他登基了吗", "EVENT"],
    ["去年谁继承王位", "EVENT"], ["当时那场战争怎样", "EVENT"],
    ["七年前谁被俘", "EVENT"], ["那年谁即位", "EVENT"],
    ["五年前你说了那场战争什么", "MIXED"], ["那一年我们聊了登基", "MIXED"],
    ["当时你讲了婚礼什么", "MIXED"], ["去年我们问过战争吗", "MIXED"],
    ["那年你告知我继承的事", "MIXED"], ["那时我们讨论过叛乱", "MIXED"]
  ];
  for (const [query, expected] of utterances) assert.equal(detectTemporalAxisIntent(query), expected, query);
  console.log(`V8.12.1.1 review fixes: PASS (${utterances.length} axis utterances)`);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
