"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { MemoryEngine } = require("../resources/app/out/main/memory-system/memory-engine");
const { LetterSummaryFinalization } = require("../resources/app/out/main/memory-system/letter-summary-finalization");
const { buildEntityContext } = require("../resources/app/out/main/memory-system/entity-context");
const memorySystem = require("../resources/app/out/main/memory-system");
const { createGameData } = require("../resources/app/out/main/game-data/game-data");
const { createSummariesManager } = require("../resources/app/out/main/summaries/summaries-manager");

const campaignToken = "letter-memory-campaign";
const acceptedLetter = () => ({
  campaignToken,
  letterId: "letter-17",
  senderId: 1,
  recipientId: 2,
  sourceDate: "1038.4.1",
  acceptedDate: "1038.4.4",
  sourceTotalDays: 100,
  acceptedTotalDays: 103,
  text: "我把玉印留在内库，请你收好。",
  reply: "玉印已经妥善收存。",
  participantProfiles: [
    { id: 1, shortName: "赵祯", fullName: "宋仁宗赵祯" },
    { id: 2, shortName: "李师师", fullName: "东京名伎李师师" }
  ],
  mentionedEntities: [],
  relationshipEvidence: []
});

function createHarness() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "votc-letter-summary-finalization-"));
  const summariesDir = path.join(root, "summaries");
  const memoryEngine = new MemoryEngine({ baseDir: path.join(root, "memory"), summaryFoldersDir: summariesDir,
    trace: { record() {} } });
  const GameData = createGameData({ fs, path, memorySystem, memoryEngine, summariesDir, getHistoricalReferenceByYear: () => null });
  const provider = { summaries: 0, summaryResults: [], summaryPrompts: [], summaryOptions: [], projections: [] };
  const persistSummary = (summary, context) => {
    provider.projections.push({ summary, context: structuredClone(context) });
    return GameData.saveRecoveredSummary(summary, context);
  };
  const createService = () => new LetterSummaryFinalization({
    memoryEngine,
    getSummarySettings: () => ({ letterSummaryPrompt: "configured-letter-summary" }),
    requestSummary: async (prompt, options) => {
      provider.summaries++;
      provider.summaryPrompts.push(structuredClone(prompt));
      provider.summaryOptions.push(structuredClone(options));
      if (provider.summaryHold) {
        provider.summaryEntered = true;
        await new Promise(resolve => { provider.releaseSummary = resolve; });
      }
      const next = provider.summaryResults.shift();
      if (next instanceof Error) throw next;
      return next || { content: "双方通过信件确认玉印已留存于内库。", finish_reason: "stop" };
    },
    persistSummary,
    isCampaignCurrent: token => token === campaignToken
  });
  return { root, summariesDir, memoryEngine, provider, createService, service: createService(), persistSummary };
}

function folderFor(summariesDir, owner, counterpart) {
  const folder = path.join(summariesDir, memorySystem.getCharacterStorageDirectoryName(owner, owner.shortName));
  const file = path.join(folder, `与${memorySystem.getCharacterPersonalName(counterpart, counterpart.shortName)}的对话.json`);
  return { folder, file };
}

function testLetterNameEvidenceRequiresValidatedSource() {
  const fragment = { fragmentId: "letter_fragment", sourceLetterId: "letter-name-test",
    text: "赵祯托李师师转交玉印。", sourceRole: "user", sourceMessageIds: [], messageId: null,
    sourceTextVerified: true, visibilityEvidence: "validated_letter", speakerId: 1, recipientIds: [2],
    knownBy: [1, 2], presentIds: [], visibility: "private", entityIds: [] };
  const input = { ownerId: 2, campaignToken, date: "1038.4.1", fragments: [fragment],
    participantProfiles: acceptedLetter().participantProfiles, mentionedEntities: [], relationshipEvidence: [] };
  const verified = buildEntityContext(input);
  const namedSender = verified.entityNameEvidence.find(row => row.entityId === 1);
  assert(namedSender?.evidence.some(item => item.source === "SOURCE_EXPLICIT_NAME"
    && item.sourceLetterId === fragment.sourceLetterId), "a source-backed letter may establish its exact written name");

  for (const invalid of [
    { ...fragment, sourceLetterId: "" },
    { ...fragment, sourceTextVerified: false }
  ]) {
    const rejected = buildEntityContext({ ...input, fragments: [invalid] });
    assert(!rejected.entityNameEvidence.some(row => row.entityId === 1
      && row.evidence.some(item => item.source === "SOURCE_EXPLICIT_NAME")),
    "missing letter identity or source verification cannot authorize a named entity");
  }
}

async function testAcceptedLetterPersistsBothLegacyOwners() {
  const harness = createHarness();
  try {
    assert.equal(harness.memoryEngine.memory4, undefined, "letter summary finalization runs without a Memory4 coordinator");
    const accepted = { ...acceptedLetter(), mentionedEntities: [{ id: 3, shortName: "沈括", fullName: "沈括" }] };
    const job = harness.service.captureAccepted(accepted);
    assert(Object.isFrozen(job), "the caller receives an immutable recovery reference");
    assert.match(job.recoveryPath, /recovery[\\/]letter-summary[\\/]letter_[a-f0-9]{64}\.json$/,
      "letter summary recovery is isolated under the Legacy summary namespace");
    assert(fs.existsSync(job.recoveryPath), "accepted work is persisted before any provider request");
    assert(!path.basename(job.recoveryPath).includes(accepted.text));
    assert.equal(harness.provider.summaries, 0);

    const result = await harness.service.finalize(job);
    assert.equal(result.status, "COMPLETE", JSON.stringify(result));
    assert.equal(harness.provider.summaries, 1);
    assert.equal(harness.provider.summaryOptions[0].requestType, "letter_summary");
    assert.equal(harness.provider.projections.length, 1);
    assert.equal(harness.provider.projections[0].context.campaignToken, campaignToken);
    assert.equal(harness.provider.projections[0].context.date, accepted.acceptedDate);
    assert.equal(harness.provider.projections[0].context.totalDays, accepted.acceptedTotalDays);
    assert.deepEqual(harness.provider.projections[0].context.participants.map(person => person.id).sort(), [1, 2]);

    const summaryMessages = harness.provider.summaryPrompts[0];
    assert(summaryMessages[0].content.includes("third person") && summaryMessages[0].content.includes("主人"));
    assert(summaryMessages[0].content.includes("configured-letter-summary"), "the configured Legacy summary prompt is used");
    const summaryInput = JSON.parse(summaryMessages[1].content);
    assert(Array.isArray(summaryInput.nameEvidence));
    assert(summaryInput.nameEvidence.some(row => row.ownerId === 1
      && row.entities.some(entity => entity.entityId === 1 && entity.evidence.some(item => item.source === "OWNER_SELF"))));
    assert(!JSON.stringify(summaryInput.nameEvidence).includes("沈括")
      && !summaryInput.nameEvidence.some(row => row.entities.some(entity => entity.entityId === 3)),
    "unmentioned backend profiles are not sent without scoped source evidence");

    assert.equal(harness.memoryEngine.store.listAllMemories().length, 1, "the Legacy correspondence is saved once");
    const [episode] = harness.memoryEngine.store.listAllEpisodes();
    assert(episode.commitMarker, "the Legacy episode commit marker is retained");
    assert.equal(episode.campaignToken, campaignToken);
    assert.deepEqual(episode.participants.map(person => person.id).sort(), [1, 2]);
    const ownerFiles = new Map();
    for (const [owner, counterpart] of [[accepted.participantProfiles[0], accepted.participantProfiles[1]],
      [accepted.participantProfiles[1], accepted.participantProfiles[0]]]) {
      const { file } = folderFor(harness.summariesDir, owner, counterpart);
      const rows = JSON.parse(fs.readFileSync(file, "utf8"));
      const projection = rows.find(row => row.finalizationId === `letter_${job.jobId}`);
      assert(projection, `the accepted letter summary is persisted in owner ${owner.id}'s Legacy folder`);
      assert.equal(projection.date, accepted.acceptedDate);
      assert.equal(projection.content, "双方通过信件确认玉印已留存于内库。");
      assert.equal(projection.sourceLetterId, accepted.letterId);
      ownerFiles.set(owner.id, { file, projection });
    }

    const recipientProjection = ownerFiles.get(2).projection;
    const resolvedSpoof = harness.memoryEngine.resolveSummaryProjection({ ...recipientProjection, sourceLetterId: "forged-letter-id" }, 2, 1);
    assert.equal(resolvedSpoof.sourceLetterId, accepted.letterId,
      "the accepted Legacy episode, not a caller-supplied sourceLetterId, authorizes the letter source");
    const summariesManager = createSummariesManager({ fs, path, summariesDir: harness.summariesDir,
      memoryEngine: harness.memoryEngine, memorySystem, getCurrentConversation: () => null });
    const deleted = await summariesManager.deleteSummary(2, 1, 0);
    assert.equal(deleted.success, true, JSON.stringify(deleted));
    assert.equal(fs.existsSync(ownerFiles.get(2).file), false, "the selected recipient projection is removed");
    assert.equal(fs.existsSync(ownerFiles.get(1).file), true, "deleting one Legacy owner does not remove the sender projection");
    const [letterMemory] = harness.memoryEngine.store.listAllMemories();
    assert.deepEqual(letterMemory.knownBy, [1], "Legacy Forget revokes only the deleted recipient's exact knowledge");
    const forgotten = harness.memoryEngine.store.listForgottenSummaryProjections();
    assert.equal(forgotten.length, 1);
    assert.equal(forgotten[0].sourceLetterId, accepted.letterId, "Forget records the source proven by the committed episode");

    const pending = harness.service.readJob(job.jobId);
    pending.narrative.status = "PENDING";
    pending.narrative.projectionStatus = "PENDING";
    pending.narrative.markerStatus = "PENDING";
    harness.service.writeJob(pending);
    const retried = await harness.service.finalize(job, { manual: true });
    assert.equal(retried.status, "MANUAL_BLOCKED", JSON.stringify(retried));
    assert.equal(retried.archiveStatus, "SUMMARY_MANUAL_BLOCKED");
    assert.equal(retried.deliveryStatus, "DELIVERED", "a Legacy Forget block does not change the completed game delivery receipt");
    assert.equal(retried.senderProjection.status, "COMPLETE", "the sender's valid projection remains proven");
    assert.equal(retried.recipientProjection.status, "FORGOTTEN", "the recipient's Forget tombstone blocks recovery");
    assert.equal(fs.existsSync(ownerFiles.get(2).file), false, "a pending retry cannot recreate the forgotten recipient projection");
    assert.equal(JSON.parse(fs.readFileSync(ownerFiles.get(1).file, "utf8")).length, 1,
      "the retained sender summary is neither removed nor duplicated");
    const blockedRetry = await harness.service.retryPending({ activeCampaignToken: campaignToken, manual: true });
    assert(blockedRetry.some(row => row.status === "MANUAL_BLOCKED"),
      "retry reports the terminal Forget block without replaying Legacy finalization");
    assert.equal(harness.provider.summaries, 1);
  } finally {
    fs.rmSync(harness.root, { recursive: true, force: true });
  }
}

async function testInvalidAcceptanceIsNotCaptured() {
  const harness = createHarness();
  try {
    assert.throws(() => harness.service.captureAccepted({ ...acceptedLetter(), acceptedTotalDays: 99 }), /letter_memory_context_invalid/);
    assert.throws(() => harness.service.captureAccepted({ ...acceptedLetter(), letterId: " " }), /letter_memory_context_invalid/);
    assert.equal(fs.readdirSync(path.join(harness.root, "memory", "recovery", "letter-summary")).length, 0);
    assert.equal(harness.provider.summaries, 0);
    assert.equal(harness.memoryEngine.store.listAllMemories().length, 0);
  } finally { fs.rmSync(harness.root, { recursive: true, force: true }); }
}

async function testSummaryRetrySurvivesRestartWithoutDuplicateLegacyWrites() {
  const harness = createHarness();
  try {
    harness.provider.summaryResults.push({ content: "截断的摘要", finish_reason: "length" });
    const job = harness.service.captureAccepted(acceptedLetter());
    const failed = await harness.service.finalize(job);
    assert.equal(failed.status, "FAILED_NARRATIVE");
    assert.equal(harness.memoryEngine.store.listAllMemories().length, 0, "failed narrative creates no public Legacy record");
    assert.equal(harness.provider.projections.length, 0, "failed narrative is not projected to summary folders");

    const restarted = harness.createService();
    harness.provider.summaryResults.push(new Error("fixture retry failure"));
    const failedAgain = await restarted.retryPending({ activeCampaignToken: campaignToken, manual: true });
    assert(failedAgain.some(row => row.status === "FAILED_NARRATIVE"));
    assert(fs.existsSync(job.recoveryPath), "failed retry keeps the accepted recovery job");
    assert.equal(harness.memoryEngine.store.listAllMemories().length, 0);
    assert.equal(harness.provider.projections.length, 0);

    const retried = await harness.createService().retryPending({ activeCampaignToken: campaignToken, manual: true });
    assert(retried.some(row => row.status === "COMPLETE"));
    assert.equal(harness.provider.summaries, 3, "each retry asks for a complete summary response");
    assert.equal(harness.memoryEngine.store.listAllMemories().length, 1);
    assert.equal(harness.memoryEngine.store.listAllEpisodes().length, 1);
    assert.equal(harness.provider.projections.length, 1);
  } finally { fs.rmSync(harness.root, { recursive: true, force: true }); }
}

async function testConcurrentFinalizeAndRetryShareOneSummaryRequest() {
  const harness = createHarness();
  try {
    harness.provider.summaryHold = true;
    const job = harness.service.captureAccepted(acceptedLetter());
    const first = harness.service.finalize(job);
    while (!harness.provider.summaryEntered) await new Promise(resolve => setTimeout(resolve, 1));
    const duplicate = harness.service.finalize(job, { manual: true });
    const retry = harness.service.retryPending({ activeCampaignToken: campaignToken, manual: true });
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(harness.provider.summaries, 1, "parallel automatic/manual entrypoints share one provider request");
    harness.provider.releaseSummary();
    const [result, sameResult, retryResults] = await Promise.all([first, duplicate, retry]);
    assert.equal(result.status, "COMPLETE");
    assert.equal(sameResult.status, "COMPLETE");
    assert(retryResults.some(row => row.status === "COMPLETE"));
    assert.equal(harness.provider.summaries, 1);
    assert.equal(harness.memoryEngine.store.listAllMemories().length, 1);
    assert.equal(harness.memoryEngine.store.listAllEpisodes().length, 1);
    assert.equal(harness.provider.projections.length, 1);
  } finally { fs.rmSync(harness.root, { recursive: true, force: true }); }
}

async function main() {
  const mainSource = fs.readFileSync(path.join(__dirname, "../resources/app/out/main/main.js"), "utf8");
  assert.match(mainSource, /memoryEngine\.letterSummaryFinalization\s*=\s*new LetterSummaryFinalization/,
    "production wires the generic Legacy LetterSummaryFinalization service");
  assert.match(mainSource, /getSummarySettings:\s*\(\)\s*=>\s*settingsRepository\.getSummaryPromptSettings\(\)/,
    "production letter finalization uses the existing summary settings repository");
  testLetterNameEvidenceRequiresValidatedSource();
  await testAcceptedLetterPersistsBothLegacyOwners();
  await testInvalidAcceptanceIsNotCaptured();
  await testSummaryRetrySurvivesRestartWithoutDuplicateLegacyWrites();
  await testConcurrentFinalizeAndRetryShareOneSummaryRequest();
  console.log("V8.14.2 Legacy Letter Summary Finalization: PASS");
}

main().catch(error => { console.error(error); process.exitCode = 1; });
