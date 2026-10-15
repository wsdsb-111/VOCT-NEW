"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const sourceVersionPath = require.resolve("../src/app/main/version");
require.cache[sourceVersionPath] = {
  id: sourceVersionPath, filename: sourceVersionPath, loaded: true,
  exports: require("../resources/app/out/main/version")
};
const { LetterSummaryFinalization } = require("../src/app/main/memory-system/letter-summary-finalization");
const { createLetterManager } = require("../src/app/main/letters/letter-manager");
const { createGameData } = require("../src/app/main/game-data/game-data");
const { MemoryEngine } = require("../src/app/main/memory-system/memory-engine");
const memorySystem = require("../src/app/main/memory-system");
const { createSummariesManager } = require("../src/app/main/summaries/summaries-manager");

const campaignToken = "v935-letter-summary-campaign";
const letter = () => ({
  campaignToken,
  letterId: "v935-letter-17",
  senderId: 1,
  recipientId: 2,
  sourceDate: "1038.4.1",
  acceptedDate: "1038.4.4",
  sourceTotalDays: 100,
  acceptedTotalDays: 103,
  text: "我把玉印留在内库，请你收好。",
  reply: "玉印已经妥善收存。",
  participantProfiles: [
    { id: 1, name: "赵祯", shortName: "赵祯", fullName: "宋仁宗赵祯" },
    { id: 2, name: "李师师", shortName: "李师师", fullName: "东京名伎李师师" }
  ],
  mentionedEntities: [],
  relationshipEvidence: []
});

function createHarness() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v935-letter-summary-"));
  const summariesDir = path.join(root, "summaries");
  const memoryEngine = new MemoryEngine({ baseDir: path.join(root, "memory"), summaryFoldersDir: summariesDir,
    trace: { record() {} } });
  const GameData = createGameData({ fs, path, memorySystem, memoryEngine, summariesDir,
    getHistoricalReferenceByYear: () => null });
  const provider = { requests: 0, persistenceCalls: 0, requestTypes: [] };
  const persistNormally = (summary, context) => {
    provider.persistenceCalls++;
    return GameData.saveRecoveredSummary(summary, context);
  };
  const createService = (persistSummary = persistNormally) => {
    const service = new LetterSummaryFinalization({
      memoryEngine,
      getSummarySettings: () => ({ letterSummaryPrompt: "synthetic letter summary" }),
      requestSummary: async (_prompt, options) => {
        provider.requests++;
        provider.requestTypes.push(options.requestType);
        return { content: "双方通过信件确认玉印已留存于内库。", finish_reason: "stop" };
      },
      persistSummary,
      isCampaignCurrent: token => token === campaignToken
    });
    memoryEngine.letterSummaryFinalization = service;
    return service;
  };
  return { root, summariesDir, memoryEngine, GameData, provider, persistNormally, createService };
}

function rowFor(harness, ownerId, counterpartId, finalizationId) {
  const counterpart = letter().participantProfiles.find(profile => profile.id === counterpartId);
  const file = harness.memoryEngine.store.getSummaryConversationFile(ownerId, counterpartId, counterpart.shortName);
  if (!file || !fs.existsSync(file)) return { file, row: null };
  const rows = JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
  return { file, row: rows.find(row => row.finalizationId === finalizationId) || null };
}

function createLetterManagerForTest(harness, dataDir) {
  const { LetterManager } = createLetterManager({
    settingsRepository: { getCK3UserFolderPath: () => null, getCK3DebugLogPath: () => null },
    fs, path, TailFile: class {}, readline: {}, parseLog: async () => null,
    letterPromptBuilder: {}, llmManager: {}, PromptBuilder: {}, TokenCounter: {},
    memoryEngine: harness.memoryEngine, dataDir, autoStartLogTailing: false,
    letterEffectTransport: { getState: () => ({}) }, scanRunAcksForPendingCommands: () => []
  });
  return new LetterManager();
}

async function testAcceptedPersistenceIsNotBidirectionalProof() {
  const harness = createHarness();
  try {
    const accepted = letter();
    const partialWriter = (summary, context) => {
      harness.provider.persistenceCalls++;
      // GameData truthfully reports success for the permitted direction only.
      return harness.GameData.saveRecoveredSummary(summary, {
        ...context, excludedSummaryOwnerIds: [accepted.recipientId]
      });
    };
    const firstService = harness.createService(partialWriter);
    const job = firstService.captureAccepted(accepted);
    const failed = await firstService.finalize(job);
    assert.equal(failed.status, "FAILED_NARRATIVE", JSON.stringify(failed));
    assert.equal(failed.archiveStatus, "SUMMARY_RETRYABLE_FAILED");
    assert.equal(failed.senderProjection.status, "COMPLETE");
    assert.equal(failed.recipientProjection.status, "MISSING");
    assert.equal(harness.provider.requests, 1);
    assert.deepEqual(harness.provider.requestTypes, ["letter_summary"], "no separate extraction request is allowed");
    assert.equal(harness.provider.persistenceCalls, 1);
    const sender = rowFor(harness, accepted.senderId, accepted.recipientId, `letter_${job.jobId}`);
    assert(sender.row, "the sender's real Legacy projection was committed");
    assert.equal(rowFor(harness, accepted.recipientId, accepted.senderId, `letter_${job.jobId}`).row, null,
      "an accepted writer result cannot manufacture a recipient proof");
    const senderBytes = fs.readFileSync(sender.file);

    const restartedService = harness.createService();
    const retried = await restartedService.retryPending({ activeCampaignToken: campaignToken, manual: true });
    assert.equal(retried.length, 1);
    assert.equal(retried[0].status, "COMPLETE", JSON.stringify(retried[0]));
    assert.equal(retried[0].archiveStatus, "SUMMARY_COMPLETE");
    assert.equal(retried[0].senderProjection.status, "COMPLETE");
    assert.equal(retried[0].recipientProjection.status, "COMPLETE");
    assert.equal(harness.provider.requests, 1, "a durable generated summary is reused after restart");
    assert.equal(harness.provider.persistenceCalls, 2, "retry calls only the idempotent Legacy writer");
    assert.deepEqual(fs.readFileSync(sender.file), senderBytes, "a verified direction is not rewritten on retry");
    for (const [ownerId, counterpartId] of [[1, 2], [2, 1]]) {
      const { row } = rowFor(harness, ownerId, counterpartId, `letter_${job.jobId}`);
      assert(row, `owner ${ownerId} has a real directed Legacy row`);
      assert.equal(row.sourceRevision, retried[0].sourceRevision, "new rows carry the verified source revision");
      assert.equal(Number(row.playerId), ownerId);
      assert.equal(Number(row.characterId), counterpartId);
      assert.equal(row.sourceLetterId, accepted.letterId);
    }
    assert.equal(harness.memoryEngine.store.listAllMemories().length, 1);
    assert.equal(harness.memoryEngine.store.listAllEpisodes().length, 1);
    assert.equal(harness.memoryEngine.memory4, undefined);
    assert.doesNotMatch(fs.readFileSync(require.resolve("../src/app/main/memory-system/letter-summary-finalization"), "utf8"),
      /letter-effect-transport|letter_effect/, "archive retry has no CK3 Effect transport dependency");
  } finally { fs.rmSync(harness.root, { recursive: true, force: true }); }
}

async function testForgetDuringCrashRecoveryDoesNotResurrectRecipient() {
  const harness = createHarness();
  try {
    const accepted = letter();
    const service = harness.createService();
    const job = service.captureAccepted(accepted);
    const saveEpisode = harness.memoryEngine.store.saveEpisode.bind(harness.memoryEngine.store);
    harness.memoryEngine.store.saveEpisode = () => { throw new Error("synthetic_crash_before_completion_marker"); };
    const interrupted = await service.finalize(job);
    assert.equal(interrupted.status, "FAILED_NARRATIVE");
    assert.equal(interrupted.summaryStatus, "COMPLETE");
    assert.equal(interrupted.projectionStatus, "COMPLETE");
    assert.equal(interrupted.legacyStatus, "COMPLETE");
    assert.equal(interrupted.markerStatus, "PENDING");
    assert.equal(harness.provider.requests, 1);
    const recipient = rowFor(harness, accepted.recipientId, accepted.senderId, `letter_${job.jobId}`);
    const sender = rowFor(harness, accepted.senderId, accepted.recipientId, `letter_${job.jobId}`);
    assert(recipient.row && sender.row, "both projections were durable before the injected crash");

    const summariesManager = createSummariesManager({ fs, path, summariesDir: harness.summariesDir,
      memoryEngine: harness.memoryEngine, memorySystem, getCurrentConversation: () => null });
    const recipientIndex = JSON.parse(fs.readFileSync(recipient.file, "utf8"))
      .findIndex(row => row.finalizationId === `letter_${job.jobId}`);
    const deleted = await summariesManager.deleteSummary(accepted.recipientId, accepted.senderId, recipientIndex);
    assert.equal(deleted.success, true, JSON.stringify(deleted));
    assert.equal(fs.existsSync(recipient.file), false, "Forget removes only the recipient's selected projection");
    assert.equal(fs.existsSync(sender.file), true, "the sender's projection is retained");
    assert.deepEqual(service.summaryContext(service.readJob(job.jobId)).excludedSummaryOwnerIds, [accepted.recipientId],
      "the durable Forget ledger is recognized by letter-summary recovery before any retry write");

    const legacyRecoveryDir = path.join(harness.memoryEngine.store.paths.recovery,
      "memory4-recovery", "LETTER_MEMORY_FINALIZATION");
    fs.mkdirSync(legacyRecoveryDir, { recursive: true });
    const legacySentinel = path.join(legacyRecoveryDir, "sentinel.json");
    const sentinelBytes = Buffer.from("legacy-recovery-must-remain-inert\n", "utf8");
    fs.writeFileSync(legacySentinel, sentinelBytes);

    harness.memoryEngine.store.saveEpisode = saveEpisode;
    const restarted = harness.createService();
    const retry = await restarted.retryPending({ activeCampaignToken: campaignToken, manual: true });
    assert.equal(retry.length, 1);
    assert.equal(retry[0].status, "MANUAL_BLOCKED", JSON.stringify(retry[0]));
    assert.equal(retry[0].archiveStatus, "SUMMARY_MANUAL_BLOCKED");
    assert.equal(retry[0].recipientProjection.status, "FORGOTTEN");
    assert.equal(retry[0].senderProjection.status, "COMPLETE");
    assert.equal(harness.provider.requests, 1, "recovery does not ask the model again");
    assert.equal(fs.existsSync(recipient.file), false, "archive retry never restores forgotten knowledge");
    assert.equal(JSON.parse(fs.readFileSync(sender.file, "utf8")).length, 1,
      "the unaffected sender projection is not duplicated or removed");
    assert.deepEqual(fs.readFileSync(legacySentinel), sentinelBytes,
      "runtime retry does not scan or mutate old Memory4 recovery material");
  } finally { fs.rmSync(harness.root, { recursive: true, force: true }); }
}

async function testCompletedArchiveRechecksForgetBeforeReportingComplete() {
  const harness = createHarness();
  try {
    const accepted = letter();
    const service = harness.createService();
    const job = service.captureAccepted(accepted);
    const completed = await service.finalize(job);
    assert.equal(completed.status, "COMPLETE");
    const recipient = rowFor(harness, accepted.recipientId, accepted.senderId, "letter_" + job.jobId);
    const sender = rowFor(harness, accepted.senderId, accepted.recipientId, "letter_" + job.jobId);
    assert(recipient.row && sender.row);

    const summariesManager = createSummariesManager({ fs, path, summariesDir: harness.summariesDir,
      memoryEngine: harness.memoryEngine, memorySystem, getCurrentConversation: () => null });
    const recipientIndex = JSON.parse(fs.readFileSync(recipient.file, "utf8"))
      .findIndex(row => row.finalizationId === "letter_" + job.jobId);
    const deleted = await summariesManager.deleteSummary(accepted.recipientId, accepted.senderId, recipientIndex);
    assert.equal(deleted.success, true, JSON.stringify(deleted));

    const afterForget = harness.createService().getJobStatus(job.jobId);
    assert.equal(afterForget.status, "MANUAL_BLOCKED", JSON.stringify(afterForget));
    assert.equal(afterForget.archiveStatus, "SUMMARY_MANUAL_BLOCKED");
    assert.equal(afterForget.recipientProjection.status, "FORGOTTEN");
    const retry = await harness.createService().retryPending({ activeCampaignToken: campaignToken, manual: true });
    assert.equal(retry.length, 1);
    assert.equal(retry[0].status, "MANUAL_BLOCKED");
    assert.equal(harness.provider.requests, 1, "a complete archive is never regenerated after Forget");
    assert.equal(harness.provider.persistenceCalls, 1, "Forget status checking does not rewrite either projection");
    assert.equal(fs.existsSync(recipient.file), false);
    assert.equal(JSON.parse(fs.readFileSync(sender.file, "utf8")).length, 1);
  } finally { fs.rmSync(harness.root, { recursive: true, force: true }); }
}

async function testV934RowsRemainVerifiableWithoutRewriting() {
  const harness = createHarness();
  try {
    const service = harness.createService();
    const job = service.captureAccepted(letter());
    const completed = await service.finalize(job);
    assert.equal(completed.status, "COMPLETE");
    const jobRecord = JSON.parse(fs.readFileSync(job.recoveryPath, "utf8"));
    delete jobRecord.sourceRevision;
    delete jobRecord.legacySourceRevision;
    delete jobRecord.narrative.projections;
    harness.memoryEngine.store.writeJson(job.recoveryPath, jobRecord);
    for (const [ownerId, counterpartId] of [[1, 2], [2, 1]]) {
      const { file } = rowFor(harness, ownerId, counterpartId, `letter_${job.jobId}`);
      const rows = JSON.parse(fs.readFileSync(file, "utf8"));
      delete rows.find(row => row.finalizationId === `letter_${job.jobId}`).sourceRevision;
      harness.memoryEngine.store.writeJson(file, rows);
    }
    const senderFile = rowFor(harness, 1, 2, `letter_${job.jobId}`).file;
    const senderBytes = fs.readFileSync(senderFile);
    const status = harness.createService().getJobStatus(job.jobId);
    assert.equal(status.status, "COMPLETE", JSON.stringify(status));
    assert.equal(status.senderProjection.sourceRevisionStatus, "LEGACY_FINALIZATION_BOUND");
    assert.equal(status.recipientProjection.sourceRevisionStatus, "LEGACY_FINALIZATION_BOUND");
    assert.equal(harness.provider.requests, 1);
    assert.equal(harness.provider.persistenceCalls, 1, "legacy complete rows are verified without rewrite");
    assert.deepEqual(fs.readFileSync(senderFile), senderBytes);
    const marker = harness.memoryEngine.store.findEpisodeByFinalization("letter_" + job.jobId,
      "letter_" + job.jobId, campaignToken);
    assert(marker);
    delete harness.memoryEngine.store.index.episodes[marker.episodeId];
    harness.memoryEngine.store.saveIndex();
    const unproven = harness.createService().getJobStatus(job.jobId);
    assert.equal(unproven.status, "MANUAL_BLOCKED", JSON.stringify(unproven));
    assert.equal(unproven.senderProjection.status, "CONFLICT");
    assert.equal(unproven.senderProjection.errorCode, "LETTER_SUMMARY_LEGACY_MARKER_UNVERIFIED");
    assert.equal(harness.provider.requests, 1, "an unproven legacy row is never regenerated");
    assert.deepEqual(fs.readFileSync(senderFile), senderBytes, "an unproven legacy row is never rewritten");
  } finally { fs.rmSync(harness.root, { recursive: true, force: true }); }
}

function testArchiveStateSurvivesLetterManagerRestart() {
  const harness = createHarness();
  try {
    const dataDir = path.join(harness.root, "letter-data");
    const manager = createLetterManagerForTest(harness, dataDir);
    manager.updateLetterArchiveStatus("v935-letter-status", {
      deliveryStatus: "DELIVERED", archiveJobId: "a".repeat(64), archiveStatus: "SUMMARY_RETRYABLE_FAILED",
      archiveRetryAllowed: true, archiveRetryMode: "AUTOMATIC", summaryStatus: "save_failed",
      summaryError: "LETTER_SUMMARY_PROJECTION_MISSING", summaryStage: "COMPLETE", projectionStage: "FAILED",
      senderLegacyArchive: { ownerId: 1, counterpartId: 2, status: "COMPLETE", targetFileId: "legacy_" + "b".repeat(24) },
      recipientLegacyArchive: { ownerId: 2, counterpartId: 1, status: "MISSING", errorCode: "LETTER_SUMMARY_PROJECTION_MISSING" }
    });
    const persisted = JSON.parse(fs.readFileSync(path.join(dataDir, "pending-letters.json"), "utf8"));
    assert.equal(persisted.letterArchiveStatuses.length, 1);
    assert(!JSON.stringify(persisted.letterArchiveStatuses).includes(letter().text), "archive state omits letter body text");

    const restarted = createLetterManagerForTest(harness, dataDir);
    const status = restarted.getLetterStatus("v935-letter-status");
    assert.equal(status.deliveryStatus, "DELIVERED");
    assert.equal(status.archiveStatus, "SUMMARY_RETRYABLE_FAILED");
    assert.equal(status.archiveRetryAllowed, true);
    assert.equal(status.senderLegacyArchive.status, "COMPLETE");
    assert.equal(status.recipientLegacyArchive.status, "MISSING");
  } finally { fs.rmSync(harness.root, { recursive: true, force: true }); }
}

async function main() {
  await testAcceptedPersistenceIsNotBidirectionalProof();
  await testForgetDuringCrashRecoveryDoesNotResurrectRecipient();
  await testCompletedArchiveRechecksForgetBeforeReportingComplete();
  await testV934RowsRemainVerifiableWithoutRewriting();
  testArchiveStateSurvivesLetterManagerRestart();
  console.log("V9.3.5 Letter Summary Bidirectional Finalization: PASS");
}

main().catch(error => { console.error(error); process.exitCode = 1; });
