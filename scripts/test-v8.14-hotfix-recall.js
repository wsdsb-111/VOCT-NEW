"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { MemoryEngine } = require("../resources/app/out/main/memory-system/memory-engine");
const { MemoryStore } = require("../resources/app/out/main/memory-system/memory-store");
const turnRecall = require("../resources/app/out/main/memory-system/turn-recall");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "votc-hotfix-recall-"));
const summaryFoldersDir = path.join(root, "summaries");
const campaignToken = "recall-test-campaign";
const estimateTokens = text => Math.ceil(String(text || "").length / 2);

function ownerFolder(ownerId) {
  return path.join(summaryFoldersDir, `${ownerId}_fixture`);
}

function writeSummaries(ownerId, summaries, { fileName = "与主角的对话.json", bom = false } = {}) {
  const folder = ownerFolder(ownerId);
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, fileName), `${bom ? "\uFEFF" : ""}${JSON.stringify(summaries)}`, "utf8");
}

function summary(ownerId, counterpartId, finalizationId, content, totalDays, extra = {}) {
  return {
    playerId: counterpartId,
    characterId: ownerId,
    perspectiveOwnerId: ownerId,
    playerName: "主角",
    characterName: `角色${ownerId}`,
    content,
    date: "867年1月1日",
    totalDays,
    finalizationId,
    campaignToken,
    campaignBinding: { status: "bound", source: "test_fixture", version: 1 },
    ...extra
  };
}

function retrieve(engine, state, options) {
  return engine.retrieveForResponder({
    directCounterpartIds: [10],
    querySpeakerId: 10,
    sessionRecallCache: state.responderRecallCache,
    mentionedRecallCache: state.mentionedRecallCache,
    tokenBudget: 1200,
    estimateTokens,
    ...options
  });
}

(async () => {
  try {
    const store = new MemoryStore({ baseDir: path.join(root, "store"), summaryFoldersDir });
    const engine = new MemoryEngine({ store, trace: { record() {} } });
    const oldTailFact = `${"旧日往事，城中风声渐远。".repeat(100)}我们约定将玄鹤铜牌交给北门守卫保管。`;
    writeSummaries(20, [
      summary(20, 10, "old-tail-fact", oldTailFact, 10),
      summary(20, 10, "recent-unrelated", "最近一次谈到的是城墙修缮与巡夜安排。", 290),
      summary(20, 10, "other-campaign", "异世活动标记，不得进入本局召回。", 280, { campaignToken: "other-campaign" }),
      summary(20, 10, "unresolved-campaign", "未绑定活动标记，不得进入本局召回。", 270,
        { campaignBinding: { status: "unresolved", reason: "FIXTURE_UNRESOLVED", version: 1 } }),
      summary(20, 31, "wrong-owner", "错误所有权候选不得进入召回。", 260,
        { playerId: 31, characterId: 32, perspectiveOwnerId: 32 })
    ], { bom: true });

    const known = store.saveMemory({ memoryId: "known-durable", type: "promise", content: "角色知晓的长期约定。",
      participants: [20, 10], subjects: [10], importance: 0.95, provenance: { campaignToken } });
    store.markKnownBy(20, known.memoryId);
    store.saveMemory({ memoryId: "unknown-durable", type: "promise", content: "未进入角色知识索引的约定。",
      participants: [20, 10], subjects: [10], importance: 0.95, provenance: { campaignToken } });

    const snapshot = store.loadFolderSummariesForCharacter(20);
    const state = engine.createConversationState("targeted-recall");
    const selected = retrieve(engine, state, { characterId: 20, query: "你还记得玄鹤铜牌吗", ownerFolderMemories: snapshot, campaignToken, turnEpoch: 1 });
    assert(selected.direct.some(entry => entry.memory.content.includes("玄鹤铜牌")), "explicit direct-pair recall keeps the matching tail fact");
    assert(selected.direct.some(entry => entry.memory.content.length < oldTailFact.length), "query-focused excerpt reaches token fitting before truncation");
    assert(!JSON.stringify([...selected.direct, ...selected.extra].map(entry => entry.memory.content)).includes("异世活动标记"));
    assert(!JSON.stringify([...selected.direct, ...selected.extra].map(entry => entry.memory.content)).includes("未绑定活动标记"));

    const diagnostic = state.recallDiagnostics.get(20);
    assert(diagnostic, "conversation recall diagnostics are keyed by numeric responder ID");
    assert.equal(diagnostic.queryFingerprint.length, 16);
    assert(!JSON.stringify(diagnostic).includes("玄鹤铜牌"), "diagnostics do not retain the private query");
    assert.equal(diagnostic.stages.folderSummary.status, "SNAPSHOT_HIT", "a supplied current snapshot is explicitly fresh");
    assert.equal(diagnostic.folderCacheHit, true);
    assert.equal(diagnostic.stages.folderSummary.recordsParsed, 5);
    assert.equal(diagnostic.stages.folderSummary.ownerRejectedCount, 1);
    assert.equal(diagnostic.stages.campaign.acceptedCount, 2);
    assert.equal(diagnostic.stages.campaign.rejectedCount, 2);
    assert(diagnostic.selectedOverviewIds.some(id => selected.direct.some(entry => entry.memory.memoryId === id)));
    assert.deepEqual(diagnostic.injectedBlockIds, []);
    assert.equal(diagnostic.injectedTokens, null);
    assert.equal(diagnostic.injectionStatus, "PENDING");
    assert.equal(diagnostic.stages.knowledge.internalIndexedCount, 2);
    assert.equal(diagnostic.stages.knowledge.knowledgeRecordCount, 1);
    assert.equal(diagnostic.stages.knowledge.knowledgeAcceptedCount, 1);

    const wrongOwner = { memoryId: "forged-owner", participants: [20, 10],
      provenance: { folderOwnerId: 999, counterpartId: 10, counterpartIds: [10] } };
    const missingOwnerParticipant = { memoryId: "missing-owner", participants: [10],
      provenance: { folderOwnerId: 20, counterpartId: 10, counterpartIds: [10] } };
    assert.deepEqual(store.loadDirectPairSummaries(20, 10, [wrongOwner, missingOwnerParticipant]), [],
      "direct-pair routing rejects mismatched folder owner and missing owner participation");

    const uncampaignedState = engine.createConversationState("campaign-fail-closed");
    const uncampaigned = retrieve(engine, uncampaignedState, { characterId: 20, query: "你还记得玄鹤铜牌吗",
      ownerFolderMemories: snapshot, campaignToken: null, turnEpoch: 2 });
    assert.equal(uncampaigned.direct.length, 0, "missing active campaign fails closed");
    assert.equal(uncampaignedState.recallDiagnostics.get(20).campaignStatus, "UNRESOLVED");

    const ownerlessState = engine.createConversationState("owner-fail-closed");
    const ownerless = retrieve(engine, ownerlessState, { characterId: null, query: "你还记得玄鹤铜牌吗",
      ownerFolderMemories: snapshot, campaignToken, turnEpoch: 3 });
    assert.equal(ownerless.direct.length, 0, "missing owner fails closed");
    assert.equal(ownerlessState.recallDiagnostics.size, 0);

    const noSnapshotState = engine.createConversationState("snapshot-omitted");
    const noSnapshot = retrieve(engine, noSnapshotState, { characterId: 20, query: "你还记得玄鹤铜牌吗", campaignToken, turnEpoch: 4 });
    assert(noSnapshot.direct.length > 0, "omitted optional snapshot reloads from the owner store");
    assert.equal(noSnapshotState.recallDiagnostics.get(20).stages.folderSummary.status, "CACHE_HIT");
    assert.equal(noSnapshotState.recallDiagnostics.get(20).folderCacheHit, true,
      "no supplied snapshot is an explicit false freshness flag, then the owner-store cache is used");
    assert.equal(noSnapshotState.recallDiagnostics.get(20).stages.folderSummary.filesParsed, null,
      "parsed counts stay nullable on a cache hit");

    const seenRows = [1, 2, 3, 4].map(index => summary(30, 10, `seen-${index}`,
      `第${index}次共同核验青鸾玉印，并记录保管安排。`, index * 10));
    writeSummaries(30, seenRows);
    const seenSnapshot = store.loadFolderSummariesForCharacter(30);
    const seenState = engine.createConversationState("seen-boundary");
    const seenRecall = retrieve(engine, seenState, { characterId: 30, query: "你还记得青鸾玉印吗",
      ownerFolderMemories: seenSnapshot, campaignToken, turnEpoch: 7 });
    assert(seenRecall.extra.length > 0, "dynamic detail candidates are selected for the current recall query");
    const dynamicEntry = seenRecall.extra[0];
    assert.equal(engine.commitDynamicSummaryRecall(30, seenState.responderRecallCache, 7).committedCount, 0,
      "selection alone does not mark a summary seen");
    assert.equal(engine.commitDynamicSummaryRecall(30, seenState.responderRecallCache, 7, {
      providerSucceeded: true, injectedBlockIds: [], injectedMemoryIds: [dynamicEntry.memory.memoryId], injectedTokens: dynamicEntry.tokens
    }).committedCount, 0, "provider success without actual block evidence does not mark a summary seen");
    const committed = engine.commitDynamicSummaryRecall(30, seenState.responderRecallCache, 7, {
      providerSucceeded: true, injectedBlockIds: ["memory-temporal-extra"],
      injectedMemoryIds: [dynamicEntry.memory.memoryId], injectedTokens: dynamicEntry.tokens
    });
    assert.equal(committed.committedCount, 1);
    assert(seenState.responderRecallCache.get(30).seenDynamicSummaries.has(engine.getRouteMemoryKey(dynamicEntry.memory)));
    assert.deepEqual(seenState.recallDiagnostics.get(30).injectedBlockIds, ["memory-temporal-extra"]);
    assert.equal(seenState.recallDiagnostics.get(30).injectedTokens, dynamicEntry.tokens);
    assert.equal(seenState.recallDiagnostics.get(30).seenCommitStatus, "COMMITTED");

    writeSummaries(40, [summary(40, 10, "before-invalidation", "旧摘要没有本轮询问的风铃石。", 10)]);
    const oldSnapshot = store.loadFolderSummariesForCharacter(40);
    const oldRevision = store.getFolderSummarySnapshotRevision(oldSnapshot);
    writeSummaries(40, [summary(40, 10, "before-invalidation", "旧摘要没有本轮询问的风铃石。", 10),
      summary(40, 10, "newly-committed", "新提交摘要记载了风铃石的去向。", 20)]);
    engine.invalidateSummaryFolderCache();
    assert(store.getFolderSummaryRevision(40) > oldRevision, "all-owner invalidation advances cached owner revisions");
    const invalidationState = engine.createConversationState("all-cache-invalidation");
    const afterInvalidation = retrieve(engine, invalidationState, { characterId: 40, query: "你还记得风铃石吗",
      ownerFolderMemories: oldSnapshot, campaignToken, turnEpoch: 8 });
    assert(afterInvalidation.direct.some(entry => entry.memory.content.includes("风铃石")),
      "a newly committed summary is visible after all-owner invalidation despite an old caller snapshot");
    assert.equal(invalidationState.recallDiagnostics.get(40).stages.folderSummary.status, "LOADED");
    assert.equal(invalidationState.recallDiagnostics.get(40).folderCacheHit, false, "an invalidated snapshot is not fresh");
    assert.equal(invalidationState.recallDiagnostics.get(40).stages.folderSummary.filesParsed, 1);
    assert.equal(turnRecall.detectIntent("你还记得我们上次谈过什么吗").triggered, true);

    console.log("INC02 recall regression passed: directed tail recall, owner/campaign fail-closed, diagnostics, knowledge, Seen boundary, and all-cache invalidation.");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
