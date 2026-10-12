"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const os = require("node:os");
const path = require("node:path");
const appRoot = process.env.VOTC_V923_TEST_SOURCE_ROOT || path.resolve(__dirname, "../src/app");
const appPackagePath = path.resolve(appRoot, "main", "../../package.json");
if (!fs.existsSync(appPackagePath)) {
  const resolveFilename = Module._resolveFilename;
  const versionFile = path.join(appRoot, "main", "version.js");
  const workspacePackage = path.resolve(__dirname, "../package.json");
  Module._resolveFilename = function(request, parent, ...args) {
    if (request === "../../package.json" && parent?.filename === versionFile) return workspacePackage;
    return resolveFilename.call(this, request, parent, ...args);
  };
}
const fromApp = (...parts) => require(path.join(appRoot, ...parts));
const { MemoryStore } = fromApp("main", "memory-system", "memory-store");
const { Memory4Coordinator } = fromApp("main", "memory-system", "memory4-coordinator");
const { createProjectionLineage } = fromApp("main", "memory-system", "memory4-forget");
const { hash } = fromApp("main", "memory-system", "memory4-contract");
const { normalizeGameDate } = fromApp("main", "worldline", "character-temporal-facts");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v923-derived-recovery-"));
const estimateTokens = text => Math.ceil(String(text).length / 2);
let checks = 0, failures = 0, sequence = 0;

async function check(name, run) {
  try {
    await run();
    checks++;
    console.log("PASS " + name);
  } catch (error) {
    failures++;
    console.error("FAIL " + name + ": " + (error.stack || error.message));
  }
}

function fixture(name = "fixture") {
  const directory = path.join(root, `${name}-${++sequence}`);
  const summaryFoldersDir = path.join(directory, "summaries");
  for (const id of [1, 2, 3]) fs.mkdirSync(path.join(summaryFoldersDir, `${id}_fixture`), { recursive: true });
  const base = new MemoryStore({ baseDir: path.join(directory, "memory"), summaryFoldersDir });
  const derivedCalls = [];
  const durableCalls = [];
  const coordinator = makeCoordinator(base, derivedCalls);
  return { base, coordinator, directory, summaryFoldersDir, derivedCalls, durableCalls };
}

function makeCoordinator(base, derivedCalls) {
  const coordinator = new Memory4Coordinator(base);
  coordinator.configureDerived({ isCampaignCurrent: () => true, estimateTokens,
    requestCompression: async (_prompt, options) => {
      derivedCalls.push(options.requestType || "UNKNOWN");
      throw new Error("qa_derived_llm_sentinel");
    } });
  return coordinator;
}

function restart(sample) {
  sample.base = new MemoryStore({ baseDir: path.join(sample.directory, "memory"), summaryFoldersDir: sample.summaryFoldersDir });
  sample.coordinator = makeCoordinator(sample.base, sample.derivedCalls);
  return sample.coordinator;
}

function contextFor({ campaignToken, conversationId, date = "1174.1.1", ownerId = 2, counterpartId = 1, text,
  visibility = "private", legacy = false }) {
  const content = text || "合成持久记忆来源。";
  return { campaignToken, conversationId, finalizationId: `${conversationId}-final`, episodeId: `${conversationId}-episode`,
    date, totalDays: normalizeGameDate(date).serial, participants: [{ id: counterpartId }, { id: ownerId }],
    participantPresence: [counterpartId, ownerId].map(characterId => ({ characterId, joinedAtMessageId: 0, leftAtMessageId: null })),
    messages: [{ id: 1, role: "user", speakerCharacterId: ownerId, content,
      memory4Fragments: [{ start: 0, end: content.length, visibility, sourceType: "spoken", recipientIds: [], entityIds: [counterpartId] }] }],
    ...(legacy ? { legacyMemories: legacy } : {}) };
}

function durableResponse(prompt) {
  const payload = JSON.parse(prompt[1].content);
  const entries = payload.fragments.map(fragment => ({ memoryType: "MAJOR_EXPERIENCE", text: fragment.text,
    fragmentIds: [fragment.fragmentId], entityIds: fragment.entityIds, participantIds: fragment.participantIds,
    topics: ["合成事实"], eventTime: { status: "unknown" } }));
  return { content: JSON.stringify({ status: entries.length ? "STORE" : "NO_DURABLE_CONTENT", entries }), finish_reason: "stop" };
}

function addCommittedDetail(sample, { text = "已提交的合成耐久事实。", date = "1169.1.1", campaignToken = "v923-recovery-campaign",
  finalizationId = null, ownerId = 2, counterpartId = 1 } = {}) {
  const conversationId = finalizationId ? finalizationId.replace(/-final$/, "") : `v923-committed-${++sequence}`;
  const context = contextFor({ campaignToken, conversationId, date, ownerId, counterpartId, text });
  const snapshot = sample.coordinator.buildOwnerSnapshot(context, ownerId);
  const fragment = snapshot.fragments[0];
  const result = sample.coordinator.store.commitOwner(snapshot, { status: "STORE", entries: [{ memoryType: "MAJOR_EXPERIENCE",
    text, fragmentIds: [fragment.fragmentId], entityIds: fragment.entityIds, participantIds: fragment.presentIds,
    topics: ["合成事实"], eventTime: { status: "unknown" } }] });
  return { context, snapshot, scope: { campaignToken, ownerId }, entryId: result.entryIds[0], index: sample.coordinator.store.loadIndex({ campaignToken, ownerId }) };
}

function persistProjectionLineage(snapshot, counterpartId = 1) {
  const fragment = snapshot.fragments[0];
  const lineage = createProjectionLineage({ campaignToken: snapshot.campaignToken, ownerId: snapshot.ownerId,
    conversationId: snapshot.conversationId, finalizationId: snapshot.finalizationId, counterpartId,
    segmentIds: [fragment.fragmentId], sourceSegmentIds: [fragment.fragmentId], sourceMessageIds: [fragment.messageId] });
  snapshot.projectionLineages = [lineage];
  return lineage;
}

function addLegacyFixture(sample, { ownerId = 2, counterpartId = 1, campaignToken = "v923-legacy-campaign", date = "1164.1.1",
  text = "十年前的合成旧档事实。" } = {}) {
  const sourceMemoryId = `v923-legacy-fact-${++sequence}`;
  const source = sample.base.saveMemory({ memoryId: sourceMemoryId, type: "event", subtype: "legacy_fact", content: text,
    eventDate: date, totalDays: normalizeGameDate(date).serial, participants: [ownerId, counterpartId], subjects: [counterpartId],
    knownBy: [ownerId], visibility: "known_group", source: "spoken",
    provenance: { campaignToken, folderOwnerId: ownerId, extractionMode: "user_edited_summary", speakerIds: [counterpartId],
      counterpartId } });
  const summary = { playerId: ownerId, characterId: counterpartId, characterName: `人物${counterpartId}`, date,
    totalDays: normalizeGameDate(date).serial, campaignToken, campaignBinding: { status: "bound" }, engineVersion: "2.5",
    conversationId: `v923-legacy-conversation-${sequence}`, finalizationId: `v923-legacy-finalization-${sequence}`,
    perspectiveMemoryIds: [sourceMemoryId], perspectiveSummarySegmentIds: [`legacy-segment-${sequence}`], sourceMessageIds: [1],
    content: `【人物${ownerId}能够知道并记住的本场内容】\n- ${source.content}` };
  const folder = path.join(sample.summaryFoldersDir, `${ownerId}_fixture`);
  sample.base.writeJson(path.join(folder, `与人物${counterpartId}的对话.json`), [summary]);
  sample.base.invalidateFolderSummaryCache([ownerId]);
  const memory = sample.base.loadFolderSummariesForCharacter(ownerId).find(item => item.provenance.perspectiveMemoryIds.includes(sourceMemoryId));
  assert(memory, "legacy fixture is a valid owner-scoped folder summary");
  return { memory, source, scope: { campaignToken, ownerId } };
}

async function flushImmediateQueue() {
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
}

async function main() {
  await check("DER-03: a committed DERIVED_REBUILD_FAILED record survives five recoveries without Durable or Derived replay", async () => {
    const sample = fixture("committed-derived-failure");
    const detail = addCommittedDetail(sample, { text: "已提交派生失败样本。".repeat(700) });
    const recoveryFile = sample.coordinator.saveRecovery(detail.snapshot, { status: "DERIVED_REBUILD_FAILED", retryCount: 0,
      lastError: "fixture_prior_derived_failure" });
    const beforeIndex = sample.coordinator.store.loadIndex(detail.scope);
    const beforeRecord = beforeIndex.finalizations[hash(detail.snapshot.finalizationId)];
    const beforeEntryHash = beforeIndex.entries[detail.entryId].bodyHash;
    const requestDurable = async () => { sample.durableCalls.push("unexpected"); throw new Error("committed Durable must not be re-extracted"); };

    const outcomes = [];
    for (let attempt = 0; attempt < 5; attempt++) {
      if (attempt) restart(sample);
      outcomes.push(...await sample.coordinator.recoverPending(requestDurable, { activeCampaignToken: detail.scope.campaignToken,
        isCurrent: () => true, isNarrativeCommitted: () => true }));
    }

    const afterIndex = sample.coordinator.store.loadIndex(detail.scope);
    assert.equal(afterIndex.finalizations[hash(detail.snapshot.finalizationId)].sourceRevision, beforeRecord.sourceRevision);
    assert.equal(afterIndex.entries[detail.entryId].bodyHash, beforeEntryHash, "recovery must not rewrite committed Detail");
    assert.deepEqual(sample.durableCalls, [], "committed recovery must not call the Durable extractor");
    assert.deepEqual(sample.derivedCalls, [], "five recovery passes must not regenerate Year/Life");
    assert.equal(outcomes[0]?.status, "SKIPPED_DERIVED_POLICY");
    assert.equal(outcomes[0]?.durableStatus, "STORE");
    assert.equal(outcomes.length <= 1, true, "a retired derived-only Recovery is closed after its first verified pass");
    assert.equal(fs.existsSync(recoveryFile), false, "verified derived-only recovery should be safely retired");
  });

  await check("DER-04: uncommitted PENDING remains a real Durable recovery and commits without Derived calls", async () => {
    const sample = fixture("pending-durable");
    const context = contextFor({ campaignToken: "v923-pending-campaign", conversationId: "v923-pending", text: "尚未提交的合成耐久事实。" });
    const snapshot = sample.coordinator.buildOwnerSnapshot(context, 2);
    const recoveryFile = sample.coordinator.saveRecovery(snapshot, { status: "PENDING", retryCount: 0, lastError: null });
    const results = await sample.coordinator.recoverPending(async prompt => {
      sample.durableCalls.push("memory4_durable");
      return durableResponse(prompt);
    }, { activeCampaignToken: context.campaignToken, isCurrent: () => true, isNarrativeCommitted: () => true });

    const index = sample.coordinator.store.loadIndex({ campaignToken: context.campaignToken, ownerId: 2 });
    const committed = index.finalizations[hash(snapshot.finalizationId)];
    assert.equal(sample.durableCalls.length, 1, "uncommitted PENDING must continue through the Durable extractor");
    assert.equal(committed.status, "STORE");
    assert.equal(committed.entryIds.length, 1);
    assert.equal(results[0].status, "STORE");
    assert.equal(results[0].derivedGenerationStatus, "SKIPPED_DERIVED_POLICY");
    assert.deepEqual(sample.derivedCalls, []);
    assert.equal(fs.existsSync(recoveryFile), false);
  });

  await check("DER-05: converted and unconverted Legacy paths preserve conversion while suppressing only post-conversion Derived", async () => {
    const convertedSample = fixture("legacy-converted");
    const convertedLegacy = addLegacyFixture(convertedSample, { text: "已转换的合成 Legacy 来源。".repeat(300) });
    let extractionCalls = 0;
    convertedSample.coordinator.configureDerived({ requestExtraction: async prompt => {
      extractionCalls++;
      return durableResponse(prompt);
    } });
    const initial = await convertedSample.coordinator.recompressLegacy(convertedLegacy.scope, {
      memoryId: convertedLegacy.memory.memoryId, expectedSourceHash: null, rebuildDerived: false });
    await flushImmediateQueue();
    assert.equal(initial.status, "COMPLETE");
    const before = convertedSample.coordinator.store.loadIndex(convertedLegacy.scope);
    assert(Object.values(before.entries).some(row => row.legacyMemoryIds?.includes(convertedLegacy.source.memoryId)
      || row.legacyRefs?.some(ref => ref.memoryId === convertedLegacy.source.memoryId)));
    const retry = await convertedSample.coordinator.recompressLegacy(convertedLegacy.scope, {
      memoryId: convertedLegacy.memory.memoryId, expectedSourceHash: null, rebuildDerived: true });
    const after = convertedSample.coordinator.store.loadIndex(convertedLegacy.scope);
    assert.equal(retry.status, "ALREADY_CONVERTED");
    assert.equal(retry.derived?.status, "SKIPPED_DERIVED_POLICY");
    assert.equal(extractionCalls, 1, "converted Legacy must not be re-extracted");
    assert.deepEqual(after.entries, before.entries, "converted Durable bodies and index rows stay unchanged");
    assert.deepEqual(convertedSample.derivedCalls, []);

    const unconvertedSample = fixture("legacy-unconverted");
    const unconvertedLegacy = addLegacyFixture(unconvertedSample, { campaignToken: "v923-unconverted-campaign",
      text: "尚未转换的合成 Legacy 来源。".repeat(300) });
    let unconvertedExtractions = 0;
    unconvertedSample.coordinator.configureDerived({ requestExtraction: async prompt => {
      unconvertedExtractions++;
      return durableResponse(prompt);
    } });
    const converted = await unconvertedSample.coordinator.recompressLegacy(unconvertedLegacy.scope, {
      memoryId: unconvertedLegacy.memory.memoryId, rebuildDerived: true });
    const index = unconvertedSample.coordinator.store.loadIndex(unconvertedLegacy.scope);
    assert.equal(unconvertedExtractions, 1, "unconverted Legacy still performs its necessary Durable conversion");
    assert.equal(converted.derived?.status, "SKIPPED_DERIVED_POLICY");
    assert(Object.values(index.entries).some(row => row.legacyRefs?.some(ref => ref.memoryId === unconvertedLegacy.source.memoryId)));
    assert.deepEqual(unconvertedSample.derivedCalls, []);

    const failedSample = fixture("legacy-conversion-failed");
    const failedLegacy = addLegacyFixture(failedSample, { campaignToken: "v923-failed-conversion-campaign" });
    const originalSummary = fs.readFileSync(path.join(failedSample.summaryFoldersDir, "2_fixture", "与人物1的对话.json"));
    failedSample.coordinator.configureDerived({ requestExtraction: async () => {
      failedSample.durableCalls.push("memory4_durable");
      throw new Error("qa_durable_conversion_sentinel");
    } });
    const failedConversion = await failedSample.coordinator.recompressLegacy(failedLegacy.scope, {
      memoryId: failedLegacy.memory.memoryId, rebuildDerived: true });
    assert.equal(failedConversion.status, "EXTRACTION_FAILED");
    assert.equal(failedConversion.retained, true, "failed Durable conversion must keep Legacy available");
    assert.equal(Object.keys(failedSample.coordinator.store.loadIndex(failedLegacy.scope).entries).length, 0);
    assert.deepEqual(fs.readFileSync(path.join(failedSample.summaryFoldersDir, "2_fixture", "与人物1的对话.json")), originalSummary);
    assert.deepEqual(failedSample.derivedCalls, []);
  });

  await check("DER-12: a different Campaign recovery remains byte-identical and never crosses scope", async () => {
    const sample = fixture("campaign-mismatch");
    const context = contextFor({ campaignToken: "foreign-v923-campaign", conversationId: "foreign-v923-recovery" });
    const snapshot = sample.coordinator.buildOwnerSnapshot(context, 2);
    const file = sample.coordinator.saveRecovery(snapshot, { status: "PENDING", retryCount: 0, lastError: null });
    const original = fs.readFileSync(file);
    const results = await sample.coordinator.recoverPending(async prompt => {
      sample.durableCalls.push("cross-scope");
      return durableResponse(prompt);
    }, { activeCampaignToken: "active-v923-campaign", isNarrativeCommitted: () => true });

    assert.equal(results[0].status, "CAMPAIGN_MISMATCH");
    assert.deepEqual(fs.readFileSync(file), original);
    assert.deepEqual(sample.durableCalls, []);
    assert.deepEqual(sample.derivedCalls, []);

    const archive = fixture("no-active-campaign");
    const archivedContext = contextFor({ campaignToken: "archived-v923-campaign", conversationId: "archived-v923-recovery" });
    const archivedSnapshot = archive.coordinator.buildOwnerSnapshot(archivedContext, 2);
    const archivedFile = archive.coordinator.saveRecovery(archivedSnapshot, { status: "PENDING", retryCount: 0, lastError: null });
    const archivedBytes = fs.readFileSync(archivedFile);
    const noCampaign = await archive.coordinator.recoverPending(async () => {
      archive.durableCalls.push("no-active-campaign");
      return durableResponse([]);
    }, { activeCampaignToken: null, isNarrativeCommitted: () => true });
    assert.equal(noCampaign[0].status, "CAMPAIGN_MISMATCH");
    assert.deepEqual(fs.readFileSync(archivedFile), archivedBytes, "read-only/no-campaign recovery remains byte-identical");
    assert.deepEqual(archive.durableCalls, []);
    assert.deepEqual(archive.derivedCalls, []);
  });

  await check("DER-13: malformed Recovery JSON is reported without changing or deleting its bytes", async () => {
    const sample = fixture("bad-json");
    const file = path.join(sample.coordinator.recoveryDir, `${"a".repeat(64)}.json`);
    const original = Buffer.from("{\"schemaVersion\":1,\"snapshot\":\n", "utf8");
    fs.writeFileSync(file, original);
    const results = await sample.coordinator.recoverPending(async prompt => {
      sample.durableCalls.push("unexpected");
      return durableResponse(prompt);
    }, { activeCampaignToken: "v923-bad-json-campaign", isNarrativeCommitted: () => true });

    assert.equal(results[0].status, "RECOVERY_UNVERIFIED");
    assert.equal(results[0].reason, "memory4_recovery_corrupt");
    assert.equal(results[0].error, "memory4_recovery_corrupt", "the legacy diagnostic error field remains compatible");
    assert.deepEqual(fs.readFileSync(file), original);
    assert.equal(sample.coordinator.getRecoveryStatus("v923-bad-json-campaign").invalid, 1);
    assert.deepEqual(sample.durableCalls, []);
    assert.deepEqual(sample.derivedCalls, []);
  });

  await check("DER-13: a schema-valid old Recovery with missing status stays UNKNOWN and byte-identical", async () => {
    const sample = fixture("missing-recovery-fields");
    const context = contextFor({ campaignToken: "v923-old-recovery-campaign", conversationId: "v923-old-recovery" });
    const snapshot = sample.coordinator.buildOwnerSnapshot(context, 2);
    const file = sample.coordinator.saveRecovery(snapshot, { status: "PENDING", retryCount: 0, lastError: null });
    const oldRecord = JSON.parse(fs.readFileSync(file, "utf8"));
    delete oldRecord.status;
    delete oldRecord.retryCount;
    const original = Buffer.from(JSON.stringify(oldRecord, null, 2), "utf8");
    fs.writeFileSync(file, original);
    const results = await sample.coordinator.recoverPending(async () => {
      sample.durableCalls.push("unknown-recovery");
      return durableResponse([]);
    }, { activeCampaignToken: context.campaignToken, isNarrativeCommitted: () => true });

    assert.equal(results[0].status, "RECOVERY_UNVERIFIED");
    assert.equal(results[0].reason, "RECOVERY_STATUS_UNKNOWN");
    assert.deepEqual(fs.readFileSync(file), original);
    assert.deepEqual(sample.durableCalls, []);
    assert.deepEqual(sample.derivedCalls, []);
  });

  await check("DER-08/13: a forgotten PENDING source is rejected before Durable send and its Recovery is safely closed", async () => {
    const sample = fixture("forgotten-pending");
    const context = contextFor({ campaignToken: "v923-forget-campaign", conversationId: "v923-forget-pending",
      text: "已忘记的合成来源不得再发送。" });
    const snapshot = sample.coordinator.buildOwnerSnapshot(context, 2);
    const lineage = persistProjectionLineage(snapshot);
    sample.coordinator.store.persistForgottenProjection({ campaignToken: snapshot.campaignToken, ownerId: snapshot.ownerId }, lineage);
    const file = sample.coordinator.saveRecovery(snapshot, { status: "PENDING", retryCount: 0, lastError: null });
    const results = await sample.coordinator.recoverPending(async prompt => {
      sample.durableCalls.push("forgotten-source");
      return durableResponse(prompt);
    }, { activeCampaignToken: snapshot.campaignToken, isNarrativeCommitted: () => true });

    assert.equal(results[0].status, "FORGOTTEN");
    assert.deepEqual(sample.durableCalls, []);
    assert.equal(Object.keys(sample.coordinator.store.loadIndex({ campaignToken: snapshot.campaignToken, ownerId: snapshot.ownerId }).entries).length, 0);
    assert.equal(fs.existsSync(file), false);
    assert.deepEqual(sample.derivedCalls, []);
  });

  await check("DER-03/08: a committed source-revision mismatch fails closed without extraction or index changes", async () => {
    const sample = fixture("source-mismatch");
    const detail = addCommittedDetail(sample, { text: "已提交事实不可由冲突 revision 重放。" });
    const recoverySnapshot = { ...detail.snapshot, sourceRevision: "different-source-revision" };
    const file = sample.coordinator.saveRecovery(recoverySnapshot, { status: "DERIVED_REBUILD_FAILED", retryCount: 0,
      lastError: "fixture_source_mismatch" });
    const before = sample.coordinator.store.loadIndex(detail.scope);
    const beforeRevision = before.revision;
    const beforeEntryIds = Object.keys(before.entries);
    const results = await sample.coordinator.recoverPending(async prompt => {
      sample.durableCalls.push("source-mismatch");
      return durableResponse(prompt);
    }, { activeCampaignToken: detail.scope.campaignToken, isNarrativeCommitted: () => true });

    assert.notEqual(results[0].status, "STORE");
    assert.equal(sample.coordinator.store.loadIndex(detail.scope).revision, beforeRevision);
    assert.deepEqual(Object.keys(sample.coordinator.store.loadIndex(detail.scope).entries), beforeEntryIds);
    assert.deepEqual(sample.durableCalls, []);
    assert.deepEqual(sample.derivedCalls, []);
    assert.equal(fs.existsSync(file), true, "unproven source state must not be silently discarded");
  });
}

main().then(() => {
  console.log(`V9.2.3 derived recovery QA: ${checks} PASS, ${failures} FAIL`);
  if (failures) process.exitCode = 1;
}).catch(error => { console.error(error.stack || error.message); process.exitCode = 1; })
  .finally(() => {
    assert(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(root, { recursive: true, force: true });
  });
