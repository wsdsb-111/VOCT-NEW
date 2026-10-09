"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { LetterMemoryFinalization } = require("../resources/app/out/main/memory-system/letter-memory-finalization");
const { buildMemory4EntityContext } = require("../resources/app/out/main/memory-system/memory4-entity-context");
const { MemoryEngine } = require("../resources/app/out/main/memory-system/memory-engine");
const { hash } = require("../resources/app/out/main/memory-system/memory4-contract");
const memorySystem = require("../resources/app/out/main/memory-system");
const { createGameData } = require("../resources/app/out/main/game-data/game-data");

const campaignToken = "letter-memory-campaign";
const context = () => ({
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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "votc-letter-memory-finalization-"));
  const recoveryDir = path.join(root, "memory4-recovery");
  fs.mkdirSync(recoveryDir, { recursive: true });
  const episodes = new Map();
  const memories = new Map();
  const provider = { summaries: 0, durable: [], summaryResults: [], summaryPrompts: [], failOwnerIds: new Set(), projections: [] };
  const engine = {
    store: {
      paths: { memory4Recovery: recoveryDir },
      readJson(filePath, fallback) {
        return fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, "utf8")) : fallback;
      },
      writeJson(filePath, value) {
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, JSON.stringify(value), "utf8");
      },
      saveEpisode(episode) { episodes.set(episode.episodeId, episode); return episode; },
      listAllEpisodes() { return [...episodes.values()]; },
      listAllMemories() { return [...memories.values()]; },
      getMemory(memoryId) { return memories.get(memoryId) || null; }
    },
    memory4: {
      async finishOwner(snapshot, requestDurable) {
        provider.durable.push(structuredClone(snapshot));
        await requestDurable("fixture durable prompt", { ownerId: snapshot.ownerId, campaignToken: snapshot.campaignToken });
        if (provider.failOwnerIds.has(snapshot.ownerId)) {
          provider.failOwnerIds.delete(snapshot.ownerId);
          return { ownerId: snapshot.ownerId, status: "EXTRACTION_FAILED", error: "fixture_owner_failure" };
        }
        return { ownerId: snapshot.ownerId, status: "NO_DURABLE_CONTENT", entryIds: [] };
      }
    },
    isMemory4NarrativeCommitted(scope) {
      const episode = [...episodes.values()].find(item => item.conversationId === scope.conversationId
        && item.finalizationId === scope.finalizationId && item.campaignToken === scope.campaignToken && item.commitMarker);
      return !!episode && (scope.ownerId == null || episode.participants.some(person => person.id === scope.ownerId));
    },
    recordLetterMemory(record) {
      const memory = { ...record, memoryId: `legacy_${memories.size + 1}` };
      memories.set(memory.memoryId, memory);
      return memory;
    }
  };
  const requestSummary = async prompt => {
    provider.summaries++;
    provider.summaryPrompts.push(structuredClone(prompt));
    if (provider.summaryHold) {
      provider.summaryEntered = true;
      await new Promise(resolve => { provider.releaseSummary = resolve; });
    }
    const next = provider.summaryResults.shift();
    if (next instanceof Error) throw next;
    return next || { content: "双方通过信件确认玉印已留存于内库。" };
  };
  const requestDurable = async (prompt, options) => {
    provider.durableRequests = (provider.durableRequests || 0) + 1;
    provider.durableOwners = [...(provider.durableOwners || []), options.ownerId];
    return { content: JSON.stringify({ status: "NO_DURABLE_CONTENT", entries: [] }) };
  };
  const persistSummary = async (summary, summaryContext) => {
    provider.projections.push({ summary, context: structuredClone(summaryContext) });
    return { success: true, participantCount: summaryContext.participants.length };
  };
  const createService = () => new LetterMemoryFinalization({ memoryEngine: engine, requestSummary, requestDurable,
    persistSummary, isCampaignCurrent: token => token === campaignToken });
  const service = createService();
  return { root, recoveryDir, episodes, memories, provider, engine, service,
    createService,
    close() { fs.rmSync(root, { recursive: true, force: true }); } };
}

async function testValidatedAcceptanceAndOwnerSnapshots() {
  const harness = createHarness();
  try {
    const accepted = { ...context(), mentionedEntities: [{ id: 3, shortName: "沈括", fullName: "沈括" }] };
    const job = harness.service.captureAccepted(accepted);
    assert(Object.isFrozen(job), "the caller receives an immutable recovery job");
    assert.match(path.basename(job.recoveryPath), /^letter_[a-f0-9]{64}\.json$/,
      "letter recovery is namespaced away from coordinator hash snapshots");
    assert(fs.existsSync(job.recoveryPath), "accepted work is durable before any provider request");
    assert(!path.basename(job.recoveryPath).includes(accepted.text));
    assert.equal(harness.provider.summaries, 0, "captureAccepted never generates a summary before its caller starts finalization");
    assert.equal(harness.provider.durable.length, 0);

    const result = await harness.service.finalize(job);
    assert.equal(result.status, "COMPLETE", JSON.stringify(result));
    assert.equal(harness.provider.summaries, 1);
    assert.equal(harness.provider.projections.length, 1, "the accepted summary is projected to the ordinary directed summary folders");
    const projection = harness.provider.projections[0];
    assert.equal(projection.context.campaignToken, campaignToken);
    assert.equal(projection.context.date, accepted.acceptedDate);
    assert.equal(projection.context.totalDays, accepted.acceptedTotalDays);
    assert.equal(projection.context.currentCampaignNative, true);
    assert(projection.context.conversationId && projection.context.finalizationId && projection.context.commitMarker);
    assert.deepEqual(projection.context.participants.map(person => person.id).sort(), [1, 2]);
    const summaryMessages = harness.provider.summaryPrompts[0];
    assert(summaryMessages[0].content.includes("third person") && summaryMessages[0].content.includes("主人"));
    const summaryInput = JSON.parse(summaryMessages[1].content);
    assert(Array.isArray(summaryInput.nameEvidence));
    assert(summaryInput.nameEvidence.some(row => row.ownerId === 1
      && row.entities.some(entity => entity.entityId === 1 && entity.evidence.some(item => item.source === "OWNER_SELF"))));
    assert(!JSON.stringify(summaryInput.nameEvidence).includes("沈括")
      && !summaryInput.nameEvidence.some(row => row.entities.some(entity => entity.entityId === 3)),
    "unmentioned backend profiles are not sent without scoped source evidence");
    assert.equal(harness.memories.size, 1, "the legacy correspondence is saved once after acceptance");
    assert.equal(harness.episodes.size, 1, "a committed episode marker is saved with the legacy record");
    const [episode] = harness.episodes.values();
    assert(episode.commitMarker);
    assert.equal(episode.campaignToken, campaignToken);
    assert.deepEqual(episode.participants.map(person => person.id).sort(), [1, 2]);
    assert.equal(harness.provider.durable.length, 2, "each letter owner receives an independent durable archive");
    for (const snapshot of harness.provider.durable) {
      assert.equal(snapshot.skipKnownEvidence, true);
      assert.equal(snapshot.presentMessageCount, 0);
      assert.deepEqual(snapshot.counterpartIds, [], "letters never fabricate a physical/direct-conversation counterpart");
      assert(snapshot.fragments.every(fragment => fragment.recipientIds.length === 1
        && fragment.recipientIds[0] === (fragment.speakerId === 1 ? 2 : 1)));
      assert(snapshot.fragments.length >= 1);
      assert(snapshot.fragments.every(fragment => fragment.visibilityEvidence === "validated_letter"));
      assert(snapshot.fragments.every(fragment => fragment.presentIds.length === 0));
      assert(snapshot.fragments.every(fragment => fragment.knownBy.slice().sort().join() === "1,2"));
      assert(snapshot.fragments.some(fragment => fragment.text === accepted.text));
      assert(snapshot.fragments.some(fragment => fragment.text === accepted.reply));
      assert(snapshot.fragments.some(fragment => fragment.text === accepted.text && fragment.eventDate === accepted.sourceDate
        && fragment.acquiredDate === accepted.acceptedDate));
      assert(snapshot.fragments.some(fragment => fragment.text === accepted.reply && fragment.eventDate === accepted.acceptedDate
        && fragment.acquiredDate === accepted.acceptedDate));
      assert(snapshot.entityNameEvidence.some(row => row.entityId === snapshot.ownerId
        && row.evidence.some(item => item.source === "OWNER_SELF")), "owner self naming is authorized");
      assert(!snapshot.entityNameEvidence.some(row => row.entityId === (snapshot.ownerId === 1 ? 2 : 1)
        && row.evidence.some(item => item.source === "OWNER_DIRECT_RELATIONSHIP")),
      "a profile name is not exposed without exact letter or scoped relationship evidence");
    }
    assert.equal(harness.provider.durableOwners.sort().join(), "1,2");
    assert.equal(harness.engine.isMemory4NarrativeCommitted({ conversationId: episode.conversationId,
      finalizationId: episode.finalizationId, campaignToken, ownerId: 1 }) ?? true, true);
  } finally { harness.close(); }
}

function testLetterNameEvidenceRequiresValidatedSource() {
  const fragment = { fragmentId: "letter_fragment", sourceLetterId: "letter-name-test",
    text: "赵祯托李师师转交玉印。", sourceRole: "user", sourceMessageIds: [], messageId: null,
    sourceTextVerified: true, visibilityEvidence: "validated_letter", speakerId: 1, recipientIds: [2],
    knownBy: [1, 2], presentIds: [], visibility: "private", entityIds: [] };
  const input = { ownerId: 2, campaignToken, date: "1038.4.1", fragments: [fragment],
    participantProfiles: context().participantProfiles, mentionedEntities: [], relationshipEvidence: [] };
  const verified = buildMemory4EntityContext(input);
  const namedSender = verified.entityNameEvidence.find(row => row.entityId === 1);
  assert(namedSender?.evidence.some(item => item.source === "SOURCE_EXPLICIT_NAME"
    && item.sourceLetterId === fragment.sourceLetterId), "a source-backed letter may establish its exact written name");

  for (const invalid of [
    { ...fragment, sourceLetterId: "" },
    { ...fragment, sourceTextVerified: false }
  ]) {
    const rejected = buildMemory4EntityContext({ ...input, fragments: [invalid] });
    assert(!rejected.entityNameEvidence.some(row => row.entityId === 1
      && row.evidence.some(item => item.source === "SOURCE_EXPLICIT_NAME")),
    "missing letter identity or source verification cannot authorize a named entity");
  }
}

async function testInvalidAcceptanceIsNotCaptured() {
  const harness = createHarness();
  try {
    assert.throws(() => harness.service.captureAccepted({ ...context(), acceptedTotalDays: 99 }),
      /letter_memory_context_invalid/);
    assert.throws(() => harness.service.captureAccepted({ ...context(), letterId: " " }),
      /letter_memory_context_invalid/);
    assert.equal(fs.readdirSync(harness.recoveryDir).length, 0);
    assert.equal(harness.provider.summaries, 0);
    assert.equal(harness.memories.size, 0);
  } finally { harness.close(); }
}

async function testSummaryRetryDoesNotRepeatSuccessfulOwners() {
  const harness = createHarness();
  try {
    harness.provider.summaryResults.push({ content: "截断的摘要", finish_reason: "length" });
    const job = harness.service.captureAccepted(context());
    const failed = await harness.service.finalize(job);
    assert.notEqual(failed.status, "COMPLETE");
    assert.equal(harness.memories.size, 0, "failed summary creates no public legacy memory");
    assert.equal(harness.provider.projections.length, 0, "failed summary is not projected to public summary folders");
    assert.equal(harness.provider.durable.length, 0, "durable extraction waits for a usable narrative summary");

    const restarted = harness.createService();
    harness.provider.summaryResults.push(new Error("fixture retry failure"));
    const failedAgain = await restarted.retryPending({ activeCampaignToken: campaignToken, manual: true });
    assert(failedAgain.some(row => row.status === "FAILED_NARRATIVE"));
    assert(fs.existsSync(job.recoveryPath), "a failed retry across service restart keeps its accepted recovery job");
    assert.equal(harness.memories.size, 0);
    assert.equal(harness.provider.projections.length, 0);

    const retried = await harness.createService().retryPending({ activeCampaignToken: campaignToken, manual: true });
    assert(retried.some(row => row.status === "COMPLETE"));
    assert.equal(harness.provider.summaries, 3, "each retry asks for a new, complete summary response");
    assert.equal(harness.memories.size, 1);
    assert.equal(harness.provider.projections.length, 1);
    assert.equal(harness.provider.durable.length, 2);
  } finally { harness.close(); }
}

async function testConcurrentFinalizeAndRetryShareOneFlight() {
  const harness = createHarness();
  try {
    harness.provider.summaryHold = true;
    const job = harness.service.captureAccepted(context());
    const first = harness.service.finalize(job);
    while (!harness.provider.summaryEntered) await new Promise(resolve => setTimeout(resolve, 1));
    const duplicate = harness.service.finalize(job, { manual: true });
    const retry = harness.service.retryPending({ activeCampaignToken: campaignToken, manual: true });
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(harness.provider.summaries, 1, "parallel automatic/manual entrypoints share a provider request");
    harness.provider.releaseSummary();
    const [result, sameResult, retryResults] = await Promise.all([first, duplicate, retry]);
    assert.equal(result.status, "COMPLETE");
    assert.equal(sameResult.status, "COMPLETE");
    assert(retryResults.some(row => row.status === "COMPLETE"));
    assert.equal(harness.provider.summaries, 1);
    assert.equal(harness.memories.size, 1);
    assert.equal(harness.provider.projections.length, 1);
    assert.equal(harness.provider.durable.length, 2);
  } finally { harness.close(); }
}

async function testOwnerFailuresRetryIndependentlyAndNoDurableRetainsLegacy() {
  const harness = createHarness();
  try {
    harness.provider.failOwnerIds.add(2);
    const job = harness.service.captureAccepted(context());
    const first = await harness.service.finalize(job);
    assert.notEqual(first.status, "COMPLETE");
    assert.equal(harness.memories.size, 1);
    assert.equal(harness.provider.projections.length, 1);
    assert.equal(harness.provider.durableOwners.join(), "1,2");

    harness.provider.failOwnerIds.add(2);
    const restarted = harness.createService();
    const failedAgain = await restarted.retryPending({ activeCampaignToken: campaignToken, manual: true });
    assert(failedAgain.some(row => row.status === "PARTIAL_FAILURE"));
    assert.equal(harness.provider.durableOwners.join(), "1,2,2", "a restarted retry only retries the previously failed owner");

    const retried = await harness.createService().retryPending({ activeCampaignToken: campaignToken, manual: true });
    assert(retried.some(row => row.status === "COMPLETE"));
    assert.equal(harness.memories.size, 1, "a committed legacy owner is not saved twice");
    assert.equal(harness.provider.projections.length, 1, "successful summary projection is not repeated");
    assert.equal(harness.provider.durableOwners.join(), "1,2,2,2", "only the failed owner is retried across restarts");
    assert.equal(harness.episodes.size, 1);
  } finally { harness.close(); }
}

async function testRealMemory4CoordinatorAcceptsLetterSnapshots() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "votc-letter-memory-real-coordinator-"));
  const summariesDir = path.join(root, "summaries");
  const memoryEngine = new MemoryEngine({ baseDir: path.join(root, "memory"), summaryFoldersDir: summariesDir,
    trace: { record() {} } });
  memoryEngine.memory4.configureDerived({ isCampaignCurrent: token => token === campaignToken });
  const derived = memoryEngine.memory4.derived;
  const rebuild = derived.rebuild.bind(derived);
  let failFirstDerivedBuild = true;
  let derivedCalls = 0;
  derived.schedule = () => {};
  derived.rebuild = async (snapshot, request) => {
    derivedCalls++;
    if (snapshot.ownerId === 1 && failFirstDerivedBuild) {
      failFirstDerivedBuild = false;
      return { status: "FAILED", reason: "fixture_derived_failure" };
    }
    return rebuild(snapshot, request);
  };
  const GameData = createGameData({ fs, path, memorySystem, memoryEngine, summariesDir,
    getHistoricalReferenceByYear: () => null });
  const durableOwners = [];
  const service = new LetterMemoryFinalization({ memoryEngine,
    requestSummary: async () => ({ content: "双方互通信件，确认玉印留存于内库。" }),
    persistSummary: async (summary, summaryContext) => GameData.saveRecoveredSummary(summary, summaryContext),
    isCampaignCurrent: token => token === campaignToken,
    requestDurable: async (prompt, options) => {
      durableOwners.push(options.ownerId);
      const request = JSON.parse(prompt[1].content);
      const fragment = request.fragments[0];
      return { content: JSON.stringify({ status: "STORE", entries: [{
        memoryType: "DURABLE_KNOWLEDGE", text: "往来信件确认玉印留存于内库。",
        fragmentIds: [fragment.fragmentId], entityIds: fragment.entityIds, participantIds: [], topics: ["玉印"],
        eventTime: { status: "unknown", precision: "unknown" }
      }] }) };
    }
  });
  try {
    const accepted = { ...context(), text: "我今年30岁。赵祯把玉印交托给李师师。", reply: "李师师已收到玉印，回信赵祯。",
      participantProfiles: context().participantProfiles.map(person => ({ ...person, age: person.id === 1 ? 30 : 20 })) };
    const job = service.captureAccepted(accepted);
    const first = await service.finalize(job);
    assert.equal(first.status, "PARTIAL_FAILURE", JSON.stringify(first));
    assert.equal(first.ownerStatuses.find(owner => owner.ownerId === 1).derivedStatus, "FAILED", JSON.stringify(first));
    assert.deepEqual(durableOwners.sort(), [1, 2]);
    const retried = await service.retryPending({ activeCampaignToken: campaignToken, manual: true });
    assert(retried.some(row => row.status === "COMPLETE"));
    assert.equal(derivedCalls, 3, "derived rebuild retries without re-running durable extraction");
    assert.deepEqual(durableOwners.sort(), [1, 2], "a committed Canonical owner is not extracted again while Year/Life is repaired");
    const [sender, recipient] = accepted.participantProfiles;
    const projectedFiles = new Map();
    for (const [owner, other] of [[sender, recipient], [recipient, sender]]) {
      const folder = path.join(summariesDir, memorySystem.getCharacterStorageDirectoryName(owner, owner.shortName));
      const summaryFile = path.join(folder, `与${memorySystem.getCharacterPersonalName(other, other.shortName)}的对话.json`);
      const rows = JSON.parse(fs.readFileSync(summaryFile, "utf8"));
      const projected = rows.find(row => row.finalizationId === `letter_${job.jobId}`);
      assert(projected, "GameData's recovered-summary freezer writes the accepted exchange to each directed summary folder");
      assert.equal(projected.date, accepted.acceptedDate);
      assert.equal(projected.totalDays, accepted.acceptedTotalDays);
      assert.equal(projected.campaignToken, campaignToken);
      assert.deepEqual(projected.participants.map(person => person.id).sort(), [1, 2]);
      projectedFiles.set(owner.id, { summaryFile, projected });
    }
    for (const ownerId of [1, 2]) {
      const scope = { campaignToken, ownerId };
      const index = memoryEngine.memory4.store.loadIndex(scope);
      const committed = index.finalizations[hash(`letter_${job.jobId}`)];
      assert.equal(committed.status, "STORE");
      assert.equal(committed.legacyRetained, true);
      const entry = memoryEngine.memory4.store.readEntry(scope, committed.entryIds[0], index);
      assert.equal(entry.conversationDate, accepted.acceptedDate);
      assert.equal(entry.acquiredDate, accepted.acceptedDate);
      assert.deepEqual(entry.evidence.visibilityEvidence, ["validated_letter"]);
      assert.deepEqual(entry.evidence.knownBy, [1, 2]);
      assert.equal(entry.eventTime.status, "unknown");
      assert.deepEqual(entry.counterpartIds, [], "the letter itself creates no co-presence counterpart");
      const counterpart = ownerId === 1 ? 2 : 1;
      const known = memoryEngine.memory4.store.readKnownEntities(scope).entities[String(counterpart)];
      assert.equal(known?.directConversationCount || 0, 0);
      assert.equal(known?.sharedSceneCount || 0, 0);

      for (let attempt = 0; attempt < 200; attempt++) {
        if (derived.read(scope, "life")) break;
        await new Promise(resolve => setTimeout(resolve, 5));
      }
      const views = derived.list(scope);
      assert.deepEqual(views.years.map(view => view.eventYear), [1038],
        "undated letter memories archive by acquisition year without inventing an event date");
      assert.equal(views.years[0].items[0].timeAxis, "acquired");
      assert(views.years[0].items[0].text.includes(`本年获知，事件日期未知；获知日期：${accepted.acceptedDate}`));
      assert.equal(views.life?.segments.length, 1);
      assert(views.life.segments[0].text.includes("本年获知，事件日期未知"));
      assert.equal(entry.eventTime.from, null);
      assert.equal(entry.eventTime.to, null);
    }
    const { summaryFile, projected } = projectedFiles.get(2);
    const characters = new Map(accepted.participantProfiles.map(person => [person.id, person]));
    memoryEngine.memory4.recordLetterDisclosures({ campaignToken, date: accepted.acceptedDate, ownerId: 2,
      senderId: 1, recipientId: 2, letterId: accepted.letterId, text: accepted.text, characters });
    const gameData = { campaignToken, date: accepted.acceptedDate, characters };
    assert(memoryEngine.memory4.getCurrentDisclosures({ campaignToken, ownerId: 2 }, 1, gameData)
      .some(fact => fact.factType === "AGE" && fact.effectiveKnown));
    memoryEngine.store.withSummaryMutation(summaryFile, () => {
      const forgotten = memoryEngine.forgetSummaryProjection(projected, { ownerId: 2, counterpartId: 1 });
      assert.equal(forgotten.memory4EntriesForgotten, 1);
      memoryEngine.store.writeJson(summaryFile, []);
    });
    const restarted = new MemoryEngine({ baseDir: path.join(root, "memory"), summaryFoldersDir: summariesDir,
      trace: { record() {} } });
    assert.equal(restarted.memory4.store.query({ campaignToken, ownerId: 2 }).length, 0);
    assert.equal(restarted.memory4.store.query({ campaignToken, ownerId: 1 }).length, 1);
    assert.equal(restarted.memory4.getCurrentDisclosures({ campaignToken, ownerId: 2 }, 1, gameData)
      .some(fact => fact.factType === "AGE" && fact.effectiveKnown), false, "deleted letter revokes its recipient-only disclosure proof");
    const letterMemory = restarted.store.listAllMemories().find(memory => memory.type === "letter");
    assert.deepEqual(letterMemory.knownBy, [1], "deleted recipient summary also revokes the exact shared legacy letter memory");
    const lateJob = service.readJob(job.jobId);
    lateJob.owners[2].status = "PENDING";
    lateJob.narrative.projectionStatus = "PENDING";
    lateJob.narrative.legacyStatus = "PENDING";
    service.writeJob(lateJob);
    const RestartedGameData = createGameData({ fs, path, memorySystem, memoryEngine: restarted, summariesDir,
      getHistoricalReferenceByYear: () => null });
    const restartedService = new LetterMemoryFinalization({ memoryEngine: restarted,
      requestSummary: service.requestSummary, requestDurable: service.requestDurable,
      persistSummary: async (summary, summaryContext) => RestartedGameData.saveRecoveredSummary(summary, summaryContext),
      isCampaignCurrent: token => token === campaignToken });
    const resumed = await restartedService.finalize(job, { manual: true });
    assert.equal(resumed.ownerStatuses.find(owner => owner.ownerId === 2).status, "FORGOTTEN");
    assert.deepEqual(durableOwners.sort(), [1, 2], "forgotten letter projection is not re-extracted by a pending owner retry");
    assert.deepEqual(JSON.parse(fs.readFileSync(summaryFile, "utf8")), [],
      "a restarted pending projection write must not recreate the deleted recipient's visible summary");
    assert.equal(JSON.parse(fs.readFileSync(projectedFiles.get(1).summaryFile, "utf8")).length, 1,
      "the sender's retained visible summary is neither removed nor duplicated");
    assert.deepEqual(restarted.store.getMemory(letterMemory.memoryId).knownBy, [1]);
    assert.equal(restarted.memory4.store.query({ campaignToken, ownerId: 2 }).length, 0);
  } finally {
    await new Promise(resolve => setTimeout(resolve, 20));
    fs.rmSync(root, { recursive: true, force: true });
  }
}

async function main() {
  const mainSource = fs.readFileSync(path.join(__dirname, "../resources/app/out/main/main.js"), "utf8");
  const settingsGetter = mainSource.match(/getSummarySettings:\s*(\(\) => settingsRepository\.\w+\([^\n]*\)),/);
  assert(settingsGetter, "production letter finalization must use the settings repository callback");
  const configured = { letterSummaryPrompt: "configured-letter-summary" };
  const getter = new Function("settingsRepository", `return ${settingsGetter[1]};`)({ getSummaryPromptSettings: () => configured });
  assert.equal(getter(), configured, "production wiring must call the existing summary settings API");
  testLetterNameEvidenceRequiresValidatedSource();
  await testValidatedAcceptanceAndOwnerSnapshots();
  await testInvalidAcceptanceIsNotCaptured();
  await testSummaryRetryDoesNotRepeatSuccessfulOwners();
  await testConcurrentFinalizeAndRetryShareOneFlight();
  await testOwnerFailuresRetryIndependentlyAndNoDurableRetainsLegacy();
  await testRealMemory4CoordinatorAcceptsLetterSnapshots();
  console.log("V8.14.2 Letter Memory Finalization: PASS");
}

main().catch(error => { console.error(error); process.exitCode = 1; });
