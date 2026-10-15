"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const sourceVersionPath = require.resolve("../src/app/main/version");
require.cache[sourceVersionPath] = {
  id: sourceVersionPath,
  filename: sourceVersionPath,
  loaded: true,
  exports: require("../resources/app/out/main/version")
};
const { MemoryEngine } = require("../src/app/main/memory-system/memory-engine");
const { LetterSummaryFinalization } = require("../src/app/main/memory-system/letter-summary-finalization");
const { createMemoryId } = require("../src/app/main/memory-system/memory-types");
const { createProjectionLineage } = require("../src/app/main/memory-system/legacy-source-lineage");
const memorySystem = require("../src/app/main/memory-system");
const { createGameData } = require("../src/app/main/game-data/game-data");
const { createSummariesManager } = require("../src/app/main/summaries/summaries-manager");
const { normalizeGameDate } = require("../src/app/main/worldline/character-temporal-facts");

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v934-legacy-forget-"));
const baseDir = path.join(temporary, "memory");
const summariesDir = path.join(temporary, "summaries");
const campaignToken = "v934-qa-legacy-forget-campaign";
const content = "甲曾亲口告诉乙，QA_FORGET_SENTINEL 银色密匣的暗号是‘白鹭归港’；此事只来自这篇合成旧对话摘要。";
const date = "1170.1.1";
const currentGameDate = "1174.1.1";
const totalDays = normalizeGameDate(date).serial;
const currentTotalDays = normalizeGameDate(currentGameDate).serial;
const failures = [];
let passed = 0;

function check(name, action) {
  try {
    action();
    passed++;
    console.log(`PASS ${name}`);
  } catch (error) {
    failures.push(name);
    console.error(`FAIL ${name}: ${error.stack || error.message || error}`);
  }
}

function snapshotFiles(directory) {
  if (!fs.existsSync(directory)) return null;
  const snapshot = {};
  const visit = current => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) visit(target);
      else if (entry.isFile()) snapshot[path.relative(directory, target)] = fs.readFileSync(target).toString("base64");
    }
  };
  visit(directory);
  return snapshot;
}

function seedProjection(engine, ownerId, { suffix, segmentId }) {
  const conversationId = `qa-legacy-forget-${suffix}`;
  const sourceSegmentIds = [`qa-source-${suffix}`];
  const sourceMessageIds = [ownerId * 100 + 1];
  const memoryId = createMemoryId(`qa_legacy_source_${ownerId}`);
  const lineage = createProjectionLineage({ campaignToken, ownerId, counterpartId: 1,
    conversationId, segmentIds: [segmentId], sourceSegmentIds, sourceMessageIds });
  const memory = engine.store.saveMemory({
    memoryId,
    type: "information",
    subtype: "legacy_projection_source",
    eventDate: date,
    totalDays,
    participants: [ownerId, 1],
    subjects: [1],
    content,
    importance: 0.99,
    confidence: 1,
    source: "imported",
    visibility: "known_group",
    knownBy: [ownerId],
    provenance: {
      campaignToken,
      campaignBinding: { status: "bound", source: "qa-fixture" },
      conversationId,
      projectionId: lineage.projectionId,
      projectionLineages: [lineage],
      sourceSegmentIds,
      sourceMessageIds,
      segmentIds: [segmentId],
      perspectiveSummarySegmentIds: [segmentId],
      counterpartId: 1,
      perspectiveMemoryIds: [memoryId]
    }
  });
  engine.store.markKnownBy(ownerId, memory.memoryId, { awareness: "imported", acquiredAt: totalDays });
  const summary = {
    date,
    totalDays,
    content,
    playerId: ownerId,
    playerName: ownerId === 2 ? "乙" : "丙",
    characterId: 1,
    characterName: "甲",
    perspectiveOwnerId: ownerId,
    campaignToken,
    campaignBinding: { status: "bound", source: "qa-fixture" },
    conversationId,
    engineVersion: "3.0",
    perspectiveMemoryIds: [memory.memoryId],
    perspectiveSummarySegmentIds: [segmentId],
    sourceSegmentIds,
    sourceMessageIds,
    projectionId: lineage.projectionId,
    participants: [{ id: ownerId, name: ownerId === 2 ? "乙" : "丙" }, { id: 1, name: "甲" }]
  };
  const ownerName = ownerId === 2 ? "乙" : "丙";
  const file = path.join(engine.store.summaryFoldersDir, `${ownerId}_${ownerName}`, "与甲的对话.json");
  engine.store.writeJson(file, [summary]);
  engine.store.invalidateFolderSummaryCache([ownerId]);
  return { summary, memoryId: memory.memoryId, file };
}

function retrievalArgs(ownerId, ownerFolderMemories, conversationId, query, overrides = {}) {
  return {
    characterId: ownerId,
    query,
    directCounterpartIds: [],
    activeParticipantIds: [ownerId],
    mentionedEntityIds: [],
    mentionedEntityNames: { 1: ["甲"] },
    entityProfiles: [{ id: 1, name: "甲" }, { id: ownerId, name: ownerId === 2 ? "乙" : "丙" }],
    ownerFolderMemories,
    campaignToken,
    conversationId,
    sceneRevision: 1,
    currentGameDate,
    currentTotalDays,
    memoryEngine3Enabled: true,
    tokenBudget: 1800,
    estimateTokens: value => Math.ceil(String(value || "").length / 2),
    ...overrides
  };
}

async function testAcceptedLetterCrashForgetRecovery() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v934-letter-crash-"));
  const letterMemoryDir = path.join(root, "memory");
  const letterSummariesDir = path.join(root, "summaries");
  const letterCampaign = "v934-qa-letter-crash-campaign";
  const letterSummary = "甲与乙确认，玉印已妥善留存在内库。";
  const accepted = {
    campaignToken: letterCampaign,
    letterId: "v934-letter-crash-1",
    senderId: 1,
    recipientId: 2,
    sourceDate: "1170.1.1",
    acceptedDate: "1170.1.3",
    sourceTotalDays: normalizeGameDate("1170.1.1").serial,
    acceptedTotalDays: normalizeGameDate("1170.1.3").serial,
    text: "我把玉印留在内库，请你收好。",
    reply: "玉印已经妥善收存。",
    participantProfiles: [
      { id: 1, name: "甲", shortName: "甲", fullName: "甲" },
      { id: 2, name: "乙", shortName: "乙", fullName: "乙" }
    ],
    mentionedEntities: [],
    relationshipEvidence: []
  };
  const provider = { requestTypes: [] };
  const createService = memoryEngine => {
    const GameData = createGameData({ fs, path, memorySystem, memoryEngine,
      summariesDir: letterSummariesDir, getHistoricalReferenceByYear: () => null });
    return new LetterSummaryFinalization({
      memoryEngine,
      getSummarySettings: () => ({ letterSummaryPrompt: "synthetic letter summary" }),
      requestSummary: async (_prompt, options) => {
        provider.requestTypes.push(options.requestType);
        return { content: letterSummary, finish_reason: "stop" };
      },
      persistSummary: (summary, context) => GameData.saveRecoveredSummary(summary, context),
      isCampaignCurrent: token => token === letterCampaign
    });
  };
  const createManager = memoryEngine => createSummariesManager({ fs, path,
    summariesDir: letterSummariesDir, memoryEngine, memorySystem, getCurrentConversation: () => null });
  const sourceEngine = new MemoryEngine({ baseDir: letterMemoryDir,
    summaryFoldersDir: letterSummariesDir, trace: { record() {} } });
  try {
    const firstService = createService(sourceEngine);
    sourceEngine.letterSummaryFinalization = firstService;
    const jobRef = firstService.captureAccepted(accepted);
    const recordLetterMemory = sourceEngine.recordLetterMemory.bind(sourceEngine);
    sourceEngine.recordLetterMemory = () => { throw new Error("synthetic_crash_before_recordLetterMemory"); };

    const interrupted = await firstService.finalize(jobRef, { manual: true });
    assert.equal(interrupted.status, "FAILED_NARRATIVE");
    const pendingJob = firstService.readJob(jobRef.jobId);
    assert.equal(pendingJob.narrative.summaryStatus, "COMPLETE");
    assert.equal(pendingJob.narrative.projectionStatus, "COMPLETE",
      "the crash is after the durable Legacy summary projection");
    assert.equal(pendingJob.narrative.legacyStatus, "PENDING");
    assert.equal(sourceEngine.store.listAllMemories().length, 0);
    assert.equal(sourceEngine.store.listAllEpisodes().length, 0);
    assert.equal(sourceEngine.memory4, undefined, "the accepted letter uses the Legacy engine without a Durable coordinator");
    await firstService.finalize(jobRef, { manual: true });
    await firstService.finalize(jobRef, { manual: true });
    assert.equal(firstService.readJob(jobRef.jobId).retryCount, 3,
      "repeated post-projection failures reach the automatic retry cap without requesting another summary");

    const manager = createManager(sourceEngine);
    const recipientFile = manager.findSummaryFilePath(2, 1).playerPerspectivePath;
    const senderFile = manager.findSummaryFilePath(1, 2).playerPerspectivePath;
    assert(fs.existsSync(recipientFile), "the recipient Legacy row was committed before the injected crash");
    assert(fs.existsSync(senderFile), "the sender Legacy row was committed before the injected crash");
    const [recipientRow] = JSON.parse(fs.readFileSync(recipientFile, "utf8"));
    assert.equal(recipientRow.sourceLetterId, accepted.letterId);
    assert.deepEqual(recipientRow.perspectiveMemoryIds, []);
    assert.equal(sourceEngine.resolveSummaryProjection(recipientRow, 2, 1).sourceLetterId, accepted.letterId,
      "the injected finalization service proves the orphaned row from its validated persisted job");

    const forgedRows = [
      { ...recipientRow, content: recipientRow.content + "伪造" },
      { ...recipientRow, date: "1170.1.4" },
      { ...recipientRow, campaignToken: "v934-qa-foreign-campaign" },
      { ...recipientRow, finalizationId: "letter_" + "a".repeat(64) }
    ];
    for (const forged of forgedRows) {
      assert.throws(() => sourceEngine.resolveSummaryProjection(forged, 2, 1),
        /LEGACY_SUMMARY_MEMORY_MAPPING_INCOMPLETE/,
        "mismatched job identity, summary, date, or campaign cannot authorize the orphan row");
    }

    const deleted = await manager.deleteSummary(2, 1, 0);
    assert.equal(deleted.success, true, JSON.stringify(deleted));
    assert.equal(fs.existsSync(recipientFile), false, "the selected orphaned recipient projection is deleted");
    assert.equal(fs.existsSync(senderFile), true, "the other owner's projection survives the scoped Forget");
    assert.equal(sourceEngine.store.isSummaryProjectionForgotten(recipientRow, { ownerId: 2, counterpartId: 1 }), true,
      "Forget commits its Legacy tombstone through MemoryStore");

    sourceEngine.recordLetterMemory = recordLetterMemory;
    const restartedEngine = new MemoryEngine({ baseDir: letterMemoryDir,
      summaryFoldersDir: letterSummariesDir, trace: { record() {} } });
    const restartedService = createService(restartedEngine);
    restartedEngine.letterSummaryFinalization = restartedService;
    assert.equal(restartedEngine.resolveSummaryProjection(recipientRow, 2, 1).sourceLetterId, accepted.letterId,
      "a restarted service still validates the pending job before recovery");

    const automatic = await restartedService.retryPending({ activeCampaignToken: letterCampaign });
    assert(automatic.some(row => row.status === "MANUAL_BLOCKED"),
      "a forgotten owner blocks recovery even after the bounded retry cap");
    assert.equal(provider.requestTypes.length, 1, "a capped automatic retry does not regenerate the completed summary");
    const recovered = await restartedService.retryPending({ activeCampaignToken: letterCampaign, manual: true });
    assert(recovered.some(row => row.status === "MANUAL_BLOCKED"), JSON.stringify(recovered));
    assert.equal(provider.requestTypes.length, 1, "a completed summary is reused; Forget recovery makes no second model request");
    assert.deepEqual(provider.requestTypes, ["letter_summary"], "recovery performs no Durable/provider outbound");
    const finalizationSource = fs.readFileSync(require.resolve("../src/app/main/memory-system/letter-summary-finalization"), "utf8");
    assert.doesNotMatch(finalizationSource, /letter-effect-transport|letter_effect/,
      "the recovery service has no game Effect transport dependency");
    assert.equal(restartedEngine.store.listAllEpisodes().length, 0, "a forgotten recipient prevents letter marker recovery");
    assert.equal(restartedEngine.store.listAllMemories().length, 0, "a forgotten recipient prevents recreating letter memory");
    assert.equal(restartedService.getJobStatus(jobRef.jobId).archiveStatus, "SUMMARY_MANUAL_BLOCKED");
    assert.equal(fs.existsSync(recipientFile), false, "recovery cannot recreate the forgotten owner's Legacy row");
    assert.equal(JSON.parse(fs.readFileSync(senderFile, "utf8")).length, 1,
      "the retained sender row remains singular after recovery");
    assert.equal(restartedEngine.loadOwnerFolderMemories(2).some(memory => memory.content === letterSummary), false,
      "the forgotten recipient cannot reload the letter summary");
    assert.equal(restartedEngine.loadOwnerFolderMemories(1).some(memory => memory.content === letterSummary), true,
      "the other owner's valid same-fact summary remains available");
    assert.equal(restartedEngine.memory4, undefined);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

async function checkAsync(name, action) {
  try {
    await action();
    passed++;
    console.log("PASS " + name);
  } catch (error) {
    failures.push(name);
    console.error("FAIL " + name + ": " + (error.stack || error.message || error));
  }
}

const engine = new MemoryEngine({ baseDir, summaryFoldersDir: summariesDir, trace: { record() {} } });
let source;
let otherOwner;
let conversation;
let extraConversation;

try {
  source = seedProjection(engine, 2, { suffix: "owner2", segmentId: "qa-segment-owner2" });
  otherOwner = seedProjection(engine, 3, { suffix: "owner3", segmentId: "qa-segment-owner3" });
  const ownerSnapshot = engine.loadOwnerFolderMemories(2);
  conversation = {
    id: "qa-active-conversation",
    dynamicRecallHistory: new Map(),
    cacheV2FrozenSnapshots: { prefixByResponder: new Map() }
  };
  const state = engine.ensureConversationState(conversation);
  extraConversation = {
    id: "qa-extra-conversation",
    dynamicRecallHistory: new Map(),
    cacheV2FrozenSnapshots: { prefixByResponder: new Map() }
  };
  const extraState = engine.ensureConversationState(extraConversation);
  const query = "甲，你还记得银色密匣的暗号吗？";
  const args = retrievalArgs(2, ownerSnapshot, conversation.id, query);

  check("synthetic Legacy projection has valid owner/campaign/pair lineage", () => {
    assert.equal(engine.store.isSummaryProjectionForgotten(source.summary, { ownerId: 2, counterpartId: 1 }), false);
    assert.equal(engine.resolveSummaryProjection(source.summary, 2, 1).memoryIds.includes(source.memoryId), true);
  });

  check("prewarm stable/fixed, direct, Extra and conversation recall caches", () => {
    const directContext = engine.retrieveForResponder({ ...args, directCounterpartIds: [1], activeParticipantIds: [1, 2],
      sessionRecallCache: state.responderRecallCache, mentionedRecallCache: state.mentionedRecallCache, turnEpoch: 1 });
    assert(directContext.stableText.includes("QA_FORGET_SENTINEL"), "fixed stable lane contains the source memory");
    assert(directContext.directStableText.includes("QA_FORGET_SENTINEL"), "direct frozen summary contains the source");
    assert(state.responderRecallCache.get(2).stable.some(entry => entry.memory.content.includes("QA_FORGET_SENTINEL")));
    assert(state.responderRecallCache.get(2).direct.some(entry => entry.memory.content.includes("QA_FORGET_SENTINEL")));

    const extraContext = engine.retrieveForResponder({ ...retrievalArgs(2, ownerSnapshot, extraConversation.id, query),
      mentionedEntityIds: [1], mentionedEntityNames: { 1: ["甲"] }, activeParticipantIds: [2],
      sessionRecallCache: extraState.responderRecallCache, mentionedRecallCache: extraState.mentionedRecallCache, turnEpoch: 1 });
    assert(extraContext.stableText.includes("QA_FORGET_SENTINEL"), "fixed stable lane also survives in another active conversation");
    assert(extraContext.extra.some(entry => entry.memory.content.includes("QA_FORGET_SENTINEL")), "Extra contains the source summary");
    assert(extraState.responderRecallCache.get(2).dynamicExtra.some(entry => entry.memory.content.includes("QA_FORGET_SENTINEL")));
    const turn = engine.retrieveTurnRecall({ characterId: 2, query, entityIds: [1], participantIds: [1, 2], ownerFolderMemories: ownerSnapshot,
      currentTotalDays, campaignToken, tokenBudget: 256, estimateTokens: args.estimateTokens,
      cache: state.turnRecallCache, turnEpoch: 1 });
    assert(turn.text.includes("QA_FORGET_SENTINEL"), "turn recall cache contains the source");
    conversation.dynamicRecallHistory.set(2, directContext.directStableText);
    conversation.cacheV2FrozenSnapshots.prefixByResponder.set(2, { text: `${directContext.stableText}\n${directContext.directStableText}` });
    extraConversation.dynamicRecallHistory.set(2, extraContext.temporalExtraText);
    extraConversation.cacheV2FrozenSnapshots.prefixByResponder.set(2, { text: extraContext.temporalExtraText });
  });

  check("wrong Owner and Campaign cannot forget the source", () => {
    const before = snapshotFiles(temporary);
    assert.throws(() => engine.forgetSummaryProjection(source.summary, { ownerId: 3, counterpartId: 1 }), /legacy_summary_owner_mismatch/);
    const foreignCampaign = { ...source.summary, campaignToken: "v934-qa-foreign-campaign" };
    foreignCampaign.projectionId = createProjectionLineage({ campaignToken: foreignCampaign.campaignToken, ownerId: 2,
      counterpartId: 1, conversationId: foreignCampaign.conversationId, segmentIds: foreignCampaign.perspectiveSummarySegmentIds }).projectionId;
    assert.throws(() => engine.forgetSummaryProjection(foreignCampaign, { ownerId: 2, counterpartId: 1 }), /LEGACY_SUMMARY_MEMORY_MAPPING_INCOMPLETE/);
    assert.deepEqual(snapshotFiles(temporary), before, "rejected cross-scope Forget leaves the atomic store unchanged");
  });

  check("Forget commits through Store writer and clears all warmed conversation history", () => {
    const before = snapshotFiles(temporary);
    const result = engine.forgetSummaryProjection(source.summary, {
      ownerId: 2,
      counterpartId: 1,
      invalidateConversations: [conversation, extraConversation],
      reason: "V934_INDEPENDENT_QA"
    });
    assert.equal(result.status, "FORGOTTEN");
    assert.notDeepEqual(snapshotFiles(temporary), before, "Store writer persisted the Forget transaction");
    assert.equal(engine.store.isSummaryProjectionForgotten(source.summary, { ownerId: 2, counterpartId: 1 }), true);
    assert.equal(conversation.cacheV2FrozenSnapshots.prefixByResponder.size, 0, "frozen fixed/direct prompt snapshots were cleared");
    assert.equal(conversation.dynamicRecallHistory.size, 0, "dynamic Extra history was cleared");
    assert.equal(conversation.memoryState.responderRecallCache.size, 0, "direct/stable/Extra responder caches were cleared");
    assert.equal(conversation.memoryState.turnRecallCache.size, 0, "turn-level recall cache was cleared");
    assert.equal(conversation.memoryState.mentionedRecallCache.size, 0, "mentioned-source cache was cleared");
    assert.equal(extraConversation.cacheV2FrozenSnapshots.prefixByResponder.size, 0);
    assert.equal(extraConversation.dynamicRecallHistory.size, 0);
    assert.equal(extraConversation.memoryState.responderRecallCache.size, 0, "Extra cache in another active conversation was cleared");
    assert.equal(engine.store.getMemory(source.memoryId), null, "the private owner-only source memory was deleted");
  });

  check("new same-Owner retrieval cannot inject Legacy source after Forget", () => {
    const freshSnapshot = engine.loadOwnerFolderMemories(2);
    assert.equal(freshSnapshot.some(memory => memory.content.includes("QA_FORGET_SENTINEL")), false);
    const fresh = engine.retrieveForResponder({ ...retrievalArgs(2, freshSnapshot, conversation.id, query),
      directCounterpartIds: [1], activeParticipantIds: [1, 2], querySpeakerId: 1,
      mentionedEntityIds: [1], sessionRecallCache: conversation.memoryState.responderRecallCache,
      mentionedRecallCache: conversation.memoryState.mentionedRecallCache, turnEpoch: 2 });
    assert(![fresh.stableText, fresh.directStableText, fresh.temporalExtraText, fresh.relevantText].filter(Boolean).join(" ").includes("QA_FORGET_SENTINEL"));
    const freshTurn = engine.retrieveTurnRecall({ characterId: 2, query, entityIds: [1], participantIds: [1, 2], ownerFolderMemories: freshSnapshot,
      currentTotalDays, campaignToken, tokenBudget: 256, estimateTokens: args.estimateTokens,
      cache: conversation.memoryState.turnRecallCache, turnEpoch: 2 });
    assert(!String(freshTurn.text || "").includes("QA_FORGET_SENTINEL"));
    const freshExtra = engine.retrieveForResponder({ ...retrievalArgs(2, freshSnapshot, extraConversation.id, query),
      mentionedEntityIds: [1], activeParticipantIds: [2], sessionRecallCache: extraConversation.memoryState.responderRecallCache,
      mentionedRecallCache: extraConversation.memoryState.mentionedRecallCache, turnEpoch: 2 });
    assert(![freshExtra.stableText, freshExtra.temporalExtraText, freshExtra.relevantText].filter(Boolean).join(" ").includes("QA_FORGET_SENTINEL"));
  });

  check("restart keeps same-Owner Forget while another Owner retains same fact", () => {
    const restarted = new MemoryEngine({ baseDir, summaryFoldersDir: summariesDir, trace: { record() {} } });
    const owner2AfterRestart = restarted.loadOwnerFolderMemories(2);
    assert.equal(owner2AfterRestart.some(memory => memory.content.includes("QA_FORGET_SENTINEL")), false);
    assert.equal(restarted.store.isSummaryProjectionForgotten(source.summary, { ownerId: 2, counterpartId: 1 }), true);
    const owner2Context = restarted.retrieveForResponder({ ...retrievalArgs(2, owner2AfterRestart, "qa-after-restart", query),
      directCounterpartIds: [1], activeParticipantIds: [1, 2], querySpeakerId: 1,
      sessionRecallCache: new Map(), mentionedRecallCache: new Map(), turnEpoch: 3 });
    assert(![owner2Context.stableText, owner2Context.directStableText, owner2Context.temporalExtraText].filter(Boolean).join(" ").includes("QA_FORGET_SENTINEL"));

    const owner3AfterRestart = restarted.loadOwnerFolderMemories(3);
    assert(owner3AfterRestart.some(memory => memory.content.includes("QA_FORGET_SENTINEL")));
    assert.equal(restarted.store.isSummaryProjectionForgotten(otherOwner.summary, { ownerId: 3, counterpartId: 1 }), false);
    const owner3Context = restarted.retrieveForResponder({ ...retrievalArgs(3, owner3AfterRestart, "qa-owner3", query),
      directCounterpartIds: [1], activeParticipantIds: [1, 3], querySpeakerId: 1,
      sessionRecallCache: new Map(), mentionedRecallCache: new Map(), turnEpoch: 1 });
    assert(owner3Context.directStableText.includes("QA_FORGET_SENTINEL"), "other Owner's valid same-fact summary remains recallable");
  });

} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}

(async () => {
  await checkAsync("accepted Letter summary crash, scoped Forget and restart recovery", testAcceptedLetterCrashForgetRecovery);
  console.log(`V9.3.4 Legacy Forget recall: ${passed} PASS / ${failures.length} FAIL`);
  if (failures.length) process.exitCode = 1;
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
