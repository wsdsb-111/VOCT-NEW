"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { MemoryEngine } = require("../resources/app/out/main/memory-system");
const { LetterMemoryFinalization } = require("../resources/app/out/main/memory-system/letter-memory-finalization");
const { createProjectionLineage } = require("../resources/app/out/main/memory-system/memory4-forget");
const { createUsageAnalytics } = require("../resources/app/out/main/analytics/usage-analytics");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v815-prefix-"));
try {
  const engine = new MemoryEngine({ baseDir: path.join(root, "memory"), summaryFoldersDir: path.join(root, "summaries") });
  const messages = [{ role: "assistant", content: "Actual current dialogue remains." }];
  const rollingState = { currentSummary: "Actual rolling dialogue remains." };
  const profile = { name: "Responder profile" };
  const conversation = { id: "fixture", messages, rollingState,
    cacheV2FrozenSnapshots: { conversation: "Frozen scene", responders: new Map([["2", profile]]),
      prefixByResponder: new Map([["2", { directMemory: "Forgotten fact" }]]) },
    dynamicRecallHistory: new Map([[2, new Map([["turn", { text: "Forgotten fact" }]])]]),
    gameData: { characters: new Map([[2, { conversationSummaries: ["Forgotten fact"],
      conversationCache: new Map([["pair", "Forgotten fact"]]), dynamicMemoryCache: "Forgotten fact" }]]),
      mentionedCharactersInContext: new Set([3]) } };
  const state = engine.ensureConversationState(conversation);
  state.responderRecallCache.set(2, { memory4Focus: "Forgotten fact", seenDynamicSummaries: new Set(["forgotten"]) });
  state.turnRecallCache.set("turn", "Forgotten fact");
  state.mentionedRecallCache.set(2, "Forgotten fact");
  engine.invalidateConversationRecallState(conversation);
  assert.equal(conversation.cacheV2FrozenSnapshots.prefixByResponder.size, 0,
    "forget invalidates the actual PromptBuilder frozen memory prefix");
  assert.equal(state.responderRecallCache.size, 0);
  assert.equal(state.turnRecallCache.size, 0);
  assert.equal(state.mentionedRecallCache.size, 0);
  assert.equal(conversation.dynamicRecallHistory.size, 0);
  assert.deepEqual(conversation.gameData.characters.get(2).conversationSummaries, []);
  assert.equal(conversation.gameData.characters.get(2).conversationCache.size, 0);
  assert.equal(conversation.gameData.characters.get(2).dynamicMemoryCache, null);
  assert.strictEqual(conversation.messages, messages);
  assert.strictEqual(conversation.rollingState, rollingState);
  assert.strictEqual(conversation.cacheV2FrozenSnapshots.responders.get("2"), profile);
  assert.equal(conversation.cacheV2FrozenSnapshots.conversation, "Frozen scene");
  conversation.gameData.campaignToken = "fixture-campaign";
  conversation.disclosureProfilesByResponder = new Map([["fixture-campaign:2", new Map([[3, [
    { factId: "revoked", factEpoch: 1, effectiveKnown: true },
    { factId: "retained", factEpoch: 1, effectiveKnown: true }
  ]]])]]);
  engine.memory4 = { createProfileReadContext: () => ({}), getCurrentDisclosures: () => [
    { factId: "revoked", factEpoch: 1, effectiveKnown: false },
    { factId: "retained", factEpoch: 1, effectiveKnown: true },
    { factId: "new-mid-scene", factEpoch: 1, effectiveKnown: true }
  ] };
  engine.pruneConversationDisclosures(conversation, 2);
  assert.deepEqual(conversation.disclosureProfilesByResponder.get("fixture-campaign:2").get(3).map(fact => fact.factId), ["retained"],
    "forget revokes frozen disclosures without granting new mid-scene facts");
  const letters = new LetterMemoryFinalization({ memoryEngine: engine });
  const job = { jobId: "letter-fixture", conversationId: "letter-conversation", finalizationId: "letter-finalization",
    payloadHash: "letter-payload", narrative: { memoryId: "legacy-letter" }, context: {
      campaignToken: "fixture-campaign", senderId: 1, recipientId: 2, letterId: "letter",
      sourceDate: "1164.1.1", acceptedDate: "1164.1.2", sourceTotalDays: 1, acceptedTotalDays: 2,
      text: "The sender confirms the letter fact.", reply: "The recipient acknowledges the letter fact.",
      participantProfiles: [{ id: 1, name: "Sender" }, { id: 2, name: "Recipient" }] } };
  const snapshot = letters.buildOwnerSnapshot(job, 2, null);
  const lineage = snapshot.projectionLineages[0];
  assert.equal(lineage.projectionId, createProjectionLineage({ campaignToken: "fixture-campaign", ownerId: 2,
    counterpartId: 1, conversationId: job.conversationId, finalizationId: job.finalizationId }).projectionId);
  assert.deepEqual(lineage.sourceSegmentIds.slice().sort(), snapshot.fragments.map(fragment => fragment.fragmentId).sort());
  assert.deepEqual(snapshot.counterpartIds, [], "letter lineage does not fabricate physical Presence");
  const UsageAnalytics = createUsageAnalytics({ fs, dataDir: root, analyticsFile: path.join(root, "analytics.json"),
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
  console.log("V8.15 memory prefix invalidation: PASS (memory caches cleared, current dialogue/profile retained)");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
