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
const { createUsageAnalytics } = require("../resources/app/out/main/analytics/usage-analytics");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v815-prefix-"));

function makeLetterProjection(engine, ownerId, counterpartId, { campaignToken, conversationId, finalizationId,
  letterId, content, date } = {}) {
  const summary = {
    date,
    content,
    playerId: ownerId,
    characterId: counterpartId,
    perspectiveOwnerId: ownerId,
    campaignToken,
    conversationId,
    finalizationId,
    sourceLetterId: letterId,
    perspectiveMemoryIds: [],
    perspectiveSummarySegmentIds: []
  };
  const folder = path.join(engine.store.summaryFoldersDir, `${ownerId}_owner-${ownerId}`);
  const file = path.join(folder, `与owner-${counterpartId}的对话.json`);
  engine.store.writeJson(file, [summary]);
  return { summary, file };
}

function testRecallStateInvalidation(engine) {
  const messages = [{ role: "assistant", content: "Actual current dialogue remains." }];
  const rollingState = { currentSummary: "Actual rolling dialogue remains." };
  const profile = { name: "Responder profile" };
  const conversation = {
    id: "fixture",
    messages,
    rollingState,
    cacheV2FrozenSnapshots: {
      conversation: "Frozen scene",
      responders: new Map([["2", profile]]),
      prefixByResponder: new Map([["2", { directMemory: "Forgotten fact" }]])
    },
    dynamicRecallHistory: new Map([[2, new Map([["turn", { text: "Forgotten fact" }]])]]),
    gameData: {
      characters: new Map([[2, {
        name: "Responder",
        conversationSummaries: ["Forgotten fact"],
        conversationCache: new Map([["pair", "Forgotten fact"]]),
        dynamicMemoryCache: "Forgotten fact"
      }]]),
      mentionedCharactersInContext: new Set([3])
    }
  };
  const state = engine.ensureConversationState(conversation);
  state.responderRecallCache.set(2, { stable: ["Forgotten fact"], direct: ["Forgotten fact"], dynamicExtra: ["Forgotten fact"] });
  state.turnRecallCache.set("turn", "Forgotten fact");
  state.mentionedRecallCache.set(2, "Forgotten fact");

  engine.invalidateConversationRecallState(conversation);

  assert.equal(conversation.cacheV2FrozenSnapshots.prefixByResponder.size, 0,
    "Forget invalidates the frozen memory prefix used by later prompts");
  assert.equal(state.responderRecallCache.size, 0);
  assert.equal(state.turnRecallCache.size, 0);
  assert.equal(state.mentionedRecallCache.size, 0);
  assert.equal(conversation.dynamicRecallHistory.size, 0);
  assert.deepEqual(conversation.gameData.characters.get(2).conversationSummaries, []);
  assert.equal(conversation.gameData.characters.get(2).conversationCache.size, 0);
  assert.equal(conversation.gameData.characters.get(2).dynamicMemoryCache, null);
  assert.equal(conversation.gameData.mentionedCharactersInContext.size, 0);
  assert.strictEqual(conversation.messages, messages);
  assert.strictEqual(conversation.rollingState, rollingState);
  assert.strictEqual(conversation.cacheV2FrozenSnapshots.responders.get("2"), profile);
  assert.equal(conversation.cacheV2FrozenSnapshots.conversation, "Frozen scene");
}

function testLetterScopedForget(engine) {
  const campaignToken = "v815-letter-forget-campaign";
  const conversationId = "letter-conversation-fixture";
  const finalizationId = "letter-finalization-fixture";
  const letterId = "letter-source-fixture";
  const date = "1164.1.1";
  const content = "合成信件摘要：甲确认将玉印交由乙保管。";
  const memory = engine.recordLetterMemory({ senderId: 1, recipientId: 2, content, date,
    totalDays: 424000, letterId, campaignToken, campaignBinding: { status: "bound", source: "qa-fixture" } });
  const memoryId = memory.memoryId;
  engine.store.saveEpisode({
    episodeId: "qa_letter_episode",
    conversationId,
    finalizationId,
    campaignToken,
    date,
    totalDays: 424000,
    participants: [{ id: 1, name: "甲" }, { id: 2, name: "乙" }],
    memoryIds: [memoryId],
    sessionSummary: content,
    summarySegments: [{ segmentId: "letter-qa-segment", content, participants: [1, 2], knownBy: [1, 2],
      visibility: "known_group", provenance: { sourceLetterId: letterId } }],
    letterId,
    letterPayloadHash: "qa-letter-payload-hash"
  });

  const ownerProjection = makeLetterProjection(engine, 2, 1, {
    campaignToken, conversationId, finalizationId, letterId, content, date
  });
  const otherOwnerProjection = makeLetterProjection(engine, 1, 2, {
    campaignToken, conversationId, finalizationId, letterId, content, date
  });
  engine.store.invalidateFolderSummaryCache([1, 2]);
  assert.equal(engine.store.loadFolderSummariesForCharacter(2).length, 1);
  assert.equal(engine.store.loadFolderSummariesForCharacter(1).length, 1);

  const result = engine.forgetSummaryProjection(ownerProjection.summary, { ownerId: 2, counterpartId: 1 });
  assert.equal(result.status, "FORGOTTEN");
  assert.equal(engine.store.getMemory(memoryId).knownBy.includes(2), false,
    "the shared letter source revokes only the selected Owner's authorization");
  assert.equal(engine.store.getMemory(memoryId).knownBy.includes(1), true);
  assert.equal(engine.store.loadFolderSummariesForCharacter(2).length, 0,
    "the forgotten Owner's still-present Legacy projection is suppressed by the Store ledger");
  assert.equal(engine.store.loadFolderSummariesForCharacter(1).length, 1,
    "the other Owner's independently authorized projection remains available");

  const letters = new LetterSummaryFinalization({ memoryEngine: engine });
  const job = { jobId: "letter-fixture", conversationId, finalizationId,
    narrative: { memoryId }, context: { campaignToken, senderId: 1, recipientId: 2, letterId } };
  assert.deepEqual(letters.getForgottenOwnerIds(job), [2],
    "letter finalization suppresses only the forgotten Owner projection");
  assert.equal(engine.store.isSummaryProjectionForgotten(otherOwnerProjection.summary, { ownerId: 1, counterpartId: 2 }), false);
  assert.deepEqual(letters.getForgottenOwnerIds({ ...job, context: { ...job.context, campaignToken: "other-campaign" } }), [],
    "the same letter identity in another Campaign is outside the Forget scope");
}

function testLegacyRejectedAnalytics(rootDir) {
  const UsageAnalytics = createUsageAnalytics({ fs, dataDir: rootDir, analyticsFile: path.join(rootDir, "analytics.json"),
    retention: require("../resources/app/out/main/usage-analytics-retention"), createPromptFingerprint: () => "fixture" });
  const analytics = new UsageAnalytics();
  analytics.record({ requestType: "memory_recall", entityRecallDiagnostics: { explicitTargetEntityIds: [3],
    activeParticipantIds: [1, 2, 3], mentionedOutOfSceneIds: [], entityTargetSelectedIds: ["fixture-memory"],
    entityTargetCandidateCount: 1, legacyRejected: { forgotten: 2, secretBody: "must not persist" },
    query: "must not persist" } }, null);
  const diagnostics = analytics.read().entries[0].entityRecallDiagnostics;
  assert.deepEqual(diagnostics.explicitTargetEntityIds, [3]);
  assert.equal(diagnostics.legacyRejected.forgotten, 2);
  assert.equal(JSON.stringify(diagnostics).includes("must not persist"), false);
}

try {
  const engine = new MemoryEngine({ baseDir: path.join(root, "memory"), summaryFoldersDir: path.join(root, "summaries") });
  testRecallStateInvalidation(engine);
  testLetterScopedForget(engine);
  testLegacyRejectedAnalytics(root);
  console.log("V8.15 memory prefix invalidation: PASS (Legacy Forget clears frozen recall and remains Owner/Campaign scoped)");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
