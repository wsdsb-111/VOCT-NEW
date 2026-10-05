"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createRunFileManager } = require("../resources/app/out/main/actions/run-file-manager");
const { createLetterEffectTransport } = require("../resources/app/out/main/letters/letter-effect-transport");
const { createLetterManager } = require("../resources/app/out/main/letters/letter-manager");
const { LetterMemoryFinalization } = require("../resources/app/out/main/memory-system/letter-memory-finalization");
const { MemoryEngine } = require("../resources/app/out/main/memory-system/memory-engine");
const { hash: hashMemoryValue, validateEntry } = require("../resources/app/out/main/memory-system/memory4-contract");
const memorySystem = require("../resources/app/out/main/memory-system");
const { extractTemporalAnchors, normalizeTemporalRefs } = require("../resources/app/out/main/memory-system/temporal-anchor-extractor");
const { createGameData } = require("../resources/app/out/main/game-data/game-data");
const { createSummariesManager } = require("../resources/app/out/main/summaries/summaries-manager");

const campaignToken = "independent-letter-qa-campaign";

function deferred() {
  let resolve, reject;
  const promise = new Promise((resolvePromise, rejectPromise) => { resolve = resolvePromise; reject = rejectPromise; });
  return { promise, resolve, reject };
}

function createFixture({ failFirstSummary = false, captureFailure = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "votc-letter-retry-independent-"));
  const ck3Dir = path.join(root, "ck3");
  const dataDir = path.join(root, "data");
  const recoveryDir = path.join(dataDir, "memory4-recovery");
  const runDir = path.join(ck3Dir, "run");
  const debugLogPath = path.join(ck3Dir, "logs", "debug.log");
  fs.mkdirSync(runDir, { recursive: true });
  fs.mkdirSync(path.dirname(debugLogPath), { recursive: true });
  fs.writeFileSync(path.join(runDir, "votc.txt"), "", "utf8");
  fs.writeFileSync(debugLogPath, "", "utf8");

  const sourceGameData = makeGameData(100, "1038.4.1");
  let acceptedGameData = makeGameData(103, "1038.4.4");
  const episodes = [];
  const memories = [];
  const durableSnapshots = [];
  const durableOwners = [];
  const summaryCalls = [];
  const summaryStarted = deferred();
  const summaryGate = deferred();
  let manager = null;
  let effectWrites = 0;
  let captureCalls = 0;
  let capturedWhilePending = false;

  const store = {
    paths: { memory4Recovery: recoveryDir },
    readJson(filePath, fallback) {
      return fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, "utf8")) : fallback;
    },
    writeJson(filePath, value) {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, JSON.stringify(value), "utf8");
    },
    saveEpisode(episode) { episodes.push(episode); return episode; },
    listAllEpisodes() { return episodes; },
    listAllMemories() { return memories; },
    findEpisodeByFinalization(conversationId, finalizationId, token) {
      return episodes.find(row => row.conversationId === conversationId && row.finalizationId === finalizationId
        && row.campaignToken === token) || null;
    }
  };
  const memoryEngine = {
    store,
    memory4: {
      async finishOwner(snapshot, requestDurable) {
        durableSnapshots.push(structuredClone(snapshot));
        durableOwners.push(snapshot.ownerId);
        await requestDurable("fixture durable request", { ownerId: snapshot.ownerId, campaignToken: snapshot.campaignToken });
        return { ownerId: snapshot.ownerId, status: "NO_DURABLE_CONTENT", entryIds: [] };
      }
    },
    recordLetterMemory(record) {
      const memory = { ...record, memoryId: `letter-memory-${memories.length + 1}`,
        provenance: { conversationId: record.letterId, campaignToken: record.campaignToken,
          extractionMode: "letter_summary", campaignBinding: record.campaignBinding } };
      memories.push(memory);
      return memory;
    }
  };
  const makeArchive = () => new LetterMemoryFinalization({
      memoryEngine,
      requestSummary: async (messages, options) => {
        summaryCalls.push({ messages: structuredClone(messages), options });
        if (failFirstSummary && summaryCalls.length === 1) {
          summaryStarted.resolve();
          return summaryGate.promise;
        }
        return { content: "双方确认玉印已留在内库。" };
      },
      requestDurable: async () => ({ content: JSON.stringify({ status: "NO_DURABLE_CONTENT", entries: [] }) }),
      persistSummary: async (summary, context) => {
        assert.equal(context.campaignToken, campaignToken);
        assert.equal(context.date, "1038.4.4");
        assert.equal(context.totalDays, 103);
        return { success: true };
      },
      getSummarySettings: () => ({ letterSummaryPrompt: "只概括已接受的信件往来。" }),
      isCampaignCurrent: token => token === campaignToken
    });
  const archive = makeArchive();
  const acceptedLetterService = {
    captureAccepted(context) {
      captureCalls++;
      capturedWhilePending = !!manager?.storedLetters.has(context.letterId);
      if (captureFailure) throw new Error("fixture_capture_failure");
      return archive.captureAccepted(context);
    },
    finalize: job => archive.finalize(job)
  };
  memoryEngine.letterMemoryFinalization = acceptedLetterService;

  const settingsRepository = {
    getCK3UserFolderPath: () => ck3Dir,
    getCK3DebugLogPath: () => debugLogPath,
    getSummaryPromptSettings: () => ({ letterSummaryPrompt: "只概括已接受的信件往来。" })
  };
  const RunFileManager = createRunFileManager({ settingsRepository, fs, path, dataDir });
  const runFileManager = new RunFileManager();
  runFileManager.initializeAfterAckReconciliation();
  const { LetterEffectTransport } = createLetterEffectTransport({ settingsRepository, fs, path, runFileManager, dataDir });
  const letterEffectTransport = new LetterEffectTransport();
  const writeOutbound = letterEffectTransport.writeOutboundLetterEffect.bind(letterEffectTransport);
  letterEffectTransport.writeOutboundLetterEffect = (...args) => {
    effectWrites++;
    return writeOutbound(...args);
  };
  const { LetterManager } = createLetterManager({
    settingsRepository, fs, path, TailFile: class {}, readline: {},
    parseLog: async () => acceptedGameData,
    letterPromptBuilder: {}, llmManager: {}, PromptBuilder: {}, TokenCounter: {}, memoryEngine,
    dataDir, letterEffectTransport, runFileManager, autoStartLogTailing: false,
    setIntervalFn: () => ({ unref() {} }), clearIntervalFn: () => {}
  });
  manager = new LetterManager();

  const letter = { letterId: "letter_independent_retry", content: "请将玉印留在内库。", totalDays: 100, delay: 3 };
  const disclosureBinding = manager.buildLetterDisclosureBinding(sourceGameData, letter);
  assert(disclosureBinding, "fixture letter must have a valid source campaign binding");
  manager.currentTotalDays = 103;
  manager.createLetterStatus(letter, "李师师");
  manager.storedLetters.set(letter.letterId, {
    letter, reply: "玉印已妥善收存。", expectedDeliveryDay: 103, characterName: "李师师", disclosureBinding
  });
  manager.savePendingLetters();

  return {
    root, ck3Dir, dataDir, recoveryDir, runDir, debugLogPath, letter, manager, memoryEngine, archive,
    recreateArchive: makeArchive,
    runFileManager, letterEffectTransport, summaryGate, summaryStarted, summaryCalls, durableSnapshots, durableOwners,
    episodes, memories, get effectWrites() { return effectWrites; }, get captureCalls() { return captureCalls; },
    get capturedWhilePending() { return capturedWhilePending; },
    async setAcceptedGameData(data) { acceptedGameData = data; },
    cleanup() { fs.rmSync(root, { recursive: true, force: true }); }
  };
}

function makeGameData(totalDays, date) {
  const characters = new Map([
    [1, { id: 1, name: "赵祯", shortName: "赵祯", fullName: "宋仁宗赵祯" }],
    [2, { id: 2, name: "李师师", shortName: "李师师", fullName: "东京名伎李师师" }]
  ]);
  return { campaignToken, playerID: 1, aiID: 2, totalDays, date, characters,
    letterData: { letterId: "letter_independent_retry", content: "请将玉印留在内库。", totalDays: 100, delay: 3 } };
}

async function testQueuedLetterCannotCaptureAndAcceptedCapturePrecedesDeletion() {
  const fixture = createFixture({ failFirstSummary: true });
  try {
    const { manager, runFileManager, letter } = fixture;
    const blocker = runFileManager.enqueueCommand({ owner: "qa", kind: "action_effect",
      commandId: "letter_qa_blocker", effectText: "add_gold = 1" });
    assert.equal(await manager.writeLetterEffect("玉印已妥善收存。", letter), true);
    assert.equal(manager.getLetterStatus(letter.letterId).runCommandStatus, "queued");
    assert.equal(fixture.effectWrites, 1, "one dispatch request was made");
    assert(!fs.readFileSync(path.join(fixture.runDir, "votc.txt"), "utf8").includes("玉印已妥善收存。"),
      "a queued command is not a physical delivery write");

    const early = await manager.clearLettersFile();
    assert.equal(early.success, false);
    assert.equal(early.reason, "letter_effect_not_written");
    assert.equal(fixture.captureCalls, 0, "a queued callback cannot create a Memory4 acceptance job");
    assert.equal(manager.storedLetters.has(letter.letterId), true);

    await manager.processLogLine(`VOTC:RUN_ACK/ACTION_EFFECT/${blocker.commandId}`);
    assert.equal(manager.getLetterStatus(letter.letterId).responseStatus, "effect_file_written");
    assert.match(fs.readFileSync(path.join(fixture.runDir, "votc.txt"), "utf8"), /create_artifact = \{/);
    await manager.processLogLine(`VOTC:RUN_ACK/LETTER_EFFECT/${manager.getLetterStatus(letter.letterId).runCommandId}`);

    const accepted = manager.clearLettersFile();
    await fixture.summaryStarted.promise;
    await accepted;
    assert.equal(fixture.captureCalls, 1, "the matching accepted callback captures exactly one durable job");
    assert.equal(fixture.capturedWhilePending, true, "captureAccepted runs before the pending payload is deleted");
    assert.equal(manager.getLetterStatus(letter.letterId).responseStatus, "sent");
    assert.equal(manager.storedLetters.has(letter.letterId), false);
    assert.equal(fixture.effectWrites, 1, "acceptance must not create a second letter Effect");

    fixture.summaryGate.reject(new Error("fixture_summary_provider_failure"));
    await waitFor(() => manager.getLetterStatus(letter.letterId).summaryStatus === "generation_failed");
    assert.equal(manager.getLetterStatus(letter.letterId).responseStatus, "sent");
    const restartedArchive = fixture.recreateArchive();
    assert.deepEqual(await restartedArchive.retryPending({ activeCampaignToken: "another-campaign", manual: true }), [],
      "a durable failed-summary job is ignored outside its original campaign");
    assert.equal(fixture.summaryCalls.length, 1, "campaign mismatch must not call the provider");
    const retried = await restartedArchive.retryPending({ activeCampaignToken: campaignToken, manual: true });
    assert(retried.some(row => row.status === "COMPLETE"), "failed summary work must recover from its durable job");
    assert.equal(fixture.effectWrites, 1, "retrying summary/finalization must never replay the accepted delivery Effect");
    assert.equal(fixture.captureCalls, 1, "summary retry must not recapture or redispatch the letter");
    assert.equal(fixture.summaryCalls.length, 2, "retry asks the provider again after the failed summary attempt");
    assert.equal(fixture.memories.length, 1, "successful retry commits one legacy letter summary");
    assert.equal(fixture.episodes.length, 1, "successful retry commits one accepted-letter episode marker");
    assert.deepEqual(fixture.durableOwners.sort(), [1, 2], "the accepted summary finalizes both counterpart owners");
    for (const snapshot of fixture.durableSnapshots) {
      assert(snapshot.fragments.some(fragment => fragment.text === letter.content
        && fragment.eventDate === "1038.4.1" && fragment.acquiredDate === "1038.4.4"));
      assert(snapshot.fragments.some(fragment => fragment.text === "玉印已妥善收存。"
        && fragment.eventDate === "1038.4.4" && fragment.acquiredDate === "1038.4.4"));
      assert(snapshot.fragments.every(fragment => fragment.knownBy.slice().sort().join() === "1,2"));
    }
  } finally { fixture.cleanup(); }
}

async function testCaptureFailureDoesNotDropAcceptedMemoryPayload() {
  const fixture = createFixture({ captureFailure: true });
  try {
    const { manager, runFileManager, letter } = fixture;
    assert.equal(await manager.writeLetterEffect("玉印已妥善收存。", letter), true);
    await manager.processLogLine(`VOTC:RUN_ACK/LETTER_EFFECT/${manager.getLetterStatus(letter.letterId).runCommandId}`);
    await manager.clearLettersFile().catch(error => assert.match(error.message, /fixture_capture_failure/));
    assert.equal(manager.getLetterStatus(letter.letterId).responseStatus, "sent",
      "CK3 acceptance itself remains accepted even when local memory capture fails");
    assert.equal(manager.storedLetters.has(letter.letterId), true,
      "the accepted payload must remain available for memory-capture recovery, without replaying its Effect");
    const pending = JSON.parse(fs.readFileSync(path.join(fixture.dataDir, "pending-letters.json"), "utf8"));
    assert(pending.letters.some(row => row.letter?.letterId === letter.letterId),
      "the accepted payload remains durable across a manager restart");
    await manager.checkAndDeliverLetters();
    assert.equal(fixture.effectWrites, 1);
    assert.equal(fixture.captureCalls, 2, "the later manager pass retries memory capture, not delivery");
    assert.equal(runFileManager.getPendingCommands().filter(command => command.kind === "letter_effect").length, 0,
      "an accepted effect is never requeued after local capture failure");
  } finally { fixture.cleanup(); }
}

function letterStoreEntries(fragment) {
  const shared = { memoryType: "MAJOR_EXPERIENCE", fragmentIds: [fragment.fragmentId],
    entityIds: fragment.allowedEntityIds, participantIds: [], topics: ["玉印", "信件"] };
  return [
    { ...shared, text: "赵祯于1038年4月1日致信李师师，请其保管玉印。",
      eventTime: { from: "1038.4.1", to: "1038.4.1", precision: "day", status: "reported" } },
    { ...shared, text: "赵祯在原信中提及三日前玉印已留在内库。",
      eventTime: { from: "1038.3.29", to: "1038.3.29", precision: "day", status: "reported" } }
  ];
}

function testUnverifiedLetterCannotAuthorizeRelativeDate() {
  const text = "1038年4月1日，赵祯致信李师师：“三日前已将玉印留在内库，今日请你看管。”";
  const rawLetterRef = extractTemporalAnchors(text, { anchorGameDate: "1038.4.1",
    letterSource: { letterId: "forged-letter", fragmentId: "forged-fragment", sourceTextHash: "a".repeat(64) } })
    .find(ref => ref.expression === "三日前");
  assert(rawLetterRef, "valid letter parser can anchor the relative phrase to the source date");
  assert.equal(rawLetterRef.fromGameDate, "1038.3.29");
  assert.equal(normalizeTemporalRefs([rawLetterRef]).length, 0,
    "provider-shaped temporal refs cannot self-authorize the private letter source");
  assert.equal(extractTemporalAnchors(text, { anchorGameDate: "1038.12.31" }).length, 0,
    "without validated letter proof, a relative date is not re-anchored to the later acquired date");

  const snapshot = {
    campaignToken, ownerId: 1, conversationId: "forged-letter", finalizationId: "forged-finalization",
    summaryIds: [], episodeId: "forged-episode", date: "1038.12.31", totalDays: 364,
    completeness: "complete", counterpartIds: [2],
    fragments: [{ fragmentId: "forged-fragment", text, knownBy: [1, 2], sourceType: "reported",
      visibility: "participants", visibilityEvidence: "validated_letter", sourceTextVerified: false,
      sourceLetterId: "forged-letter", eventDate: "1038.4.1", acquiredDate: "1038.12.31",
      speakerId: 1, recipientIds: [2], presentIds: [1, 2], entityIds: [2], messageId: null }]
  };
  const candidate = { memoryType: "MAJOR_EXPERIENCE", text: "原信提及三日前玉印已留在内库。",
    fragmentIds: ["forged-fragment"], entityIds: [2], participantIds: [2], topics: ["玉印"],
    eventTime: { from: "1038.3.29", to: "1038.3.29", precision: "day", status: "reported" } };
  assert.throws(() => validateEntry(candidate, snapshot),
  /memory4_unsupported_event_date/, "an unverified letter flag cannot authorize a relative event date");
  const verifiedSnapshot = structuredClone(snapshot);
  verifiedSnapshot.fragments[0].sourceTextVerified = true;
  assert.throws(() => validateEntry({ ...candidate,
    eventTime: { from: "1038.1.1", to: "1038.12.31", precision: "year", status: "reported" } }, verifiedSnapshot),
  /memory4_unsupported_event_date/, "an exact day in the letter cannot be widened into an unsupported full-year claim");
}

async function testRealMemory4AndRecoveredSummaryPipeline() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "votc-letter-real-memory4-"));
  const baseDir = path.join(root, "memory");
  const summariesDir = path.join(root, "summaries");
  const context = {
    campaignToken,
    letterId: "letter_real_memory4_1038",
    senderId: 1,
    recipientId: 2,
    sourceDate: "1038.4.1",
    acceptedDate: "1038.12.31",
    sourceTotalDays: 100,
    acceptedTotalDays: 364,
    text: "1038年4月1日，赵祯致信李师师：“三日前已将玉印留在内库，今日请你看管。”",
    reply: "1038年12月31日，李师师回信确认玉印已妥善收存。",
    participantProfiles: [
      { id: 1, name: "赵祯", shortName: "赵祯", fullName: "宋仁宗赵祯" },
      { id: 2, name: "李师师", shortName: "李师师", fullName: "东京名伎李师师" }
    ],
    mentionedEntities: [],
    relationshipEvidence: []
  };
  const summary = "赵祯于1038年4月1日托李师师保管玉印，并在原信中提及三日前玉印已留在内库；李师师于12月31日回信确认妥善收存。";
  const durableRequests = [];
  let narrativeRequests = 0;
  const makeEngine = () => new MemoryEngine({ baseDir, summaryFoldersDir: summariesDir, trace: { record() {} } });
  const makeService = (memoryEngine, shouldFail, failDurableCalls = 0) => {
    let failedDurableCalls = 0;
    const GameData = createGameData({ fs, path, memorySystem, memoryEngine, summariesDir, getHistoricalReferenceByYear: () => null });
    memoryEngine.memory4.configureDerived({
      isCampaignCurrent: token => token === campaignToken,
      estimateTokens: text => Math.ceil(text.length / 4),
      requestCompression: async prompt => {
        const payload = JSON.parse(prompt[1].content);
        return JSON.stringify({ items: payload.items.map(item => ({ text: item.text, sourceEntryIds: item.sourceEntryIds })) });
      },
      requestExtraction: async prompt => {
        const payload = JSON.parse(prompt[1].content);
        const fragment = payload.fragments.find(row => row.eventDate === "1038.4.1") || payload.fragments[0];
        assert(fragment, "actual Memory4 prompt contains a verified letter fragment");
        durableRequests.push({ ownerId: payload.ownerId, fragment });
        return JSON.stringify({ status: "STORE", entries: letterStoreEntries(fragment) });
      }
    });
    return new LetterMemoryFinalization({
      memoryEngine,
      requestSummary: async () => {
        narrativeRequests++;
        if (shouldFail) throw new Error("fixture_letter_summary_provider_failure");
        return { content: summary, finish_reason: "stop" };
      },
      requestDurable: async prompt => {
        const payload = JSON.parse(prompt[1].content);
        const fragment = payload.fragments.find(row => row.eventDate === "1038.4.1") || payload.fragments[0];
        durableRequests.push({ ownerId: payload.ownerId, fragment });
        assert(fragment.eventDate === "1038.4.1" && fragment.acquiredDate === "1038.12.31",
          "the real Memory4 provider request retains source and acquisition dates");
        if (failedDurableCalls < failDurableCalls) {
          failedDurableCalls++;
          throw new Error("fixture_letter_durable_provider_failure");
        }
        return JSON.stringify({ status: "STORE", entries: letterStoreEntries(fragment) });
      },
      persistSummary: (content, summaryContext) => GameData.saveRecoveredSummary(content, summaryContext),
      getSummarySettings: () => ({ letterSummaryPrompt: "只概括信件中明确记载的内容。" }),
      getProviderSnapshot: async () => ({ providerType: "fixture", modelId: "deterministic" }),
      isCampaignCurrent: token => token === campaignToken
    });
  };

  try {
    const firstEngine = makeEngine();
    const firstService = makeService(firstEngine, true);
    const job = firstService.captureAccepted(context);
    const initial = await firstService.finalize(job);
    assert.equal(initial.status, "FAILED_NARRATIVE", "provider failure leaves the accepted letter in durable retry storage");
    assert.equal(firstEngine.store.listAllEpisodes().length, 0, "failed narrative must not create a success marker");
    assert.equal(fs.readdirSync(firstEngine.memory4.recoveryDir).filter(name => /^[a-f0-9]{64}\.json$/.test(name)).length, 0,
      "a failed letter summary must not start owner-level Memory4 extraction");

    const engine = makeEngine();
    const service = makeService(engine, false, 1);
    const partial = await service.retryPending({ activeCampaignToken: campaignToken, manual: true });
    assert(partial.some(row => row.status === "PARTIAL_FAILURE"),
      "durable provider failure after narrative persistence remains a recoverable partial job");
    assert.equal(engine.store.listAllEpisodes().length, 1, "the accepted letter marker remains committed during durable retry");
    const firstAttempt = partial.find(row => row.status === "PARTIAL_FAILURE");
    assert.equal(firstAttempt.ownerStatuses.find(owner => owner.ownerId === 1).status, "PENDING");
    assert.equal(firstAttempt.ownerStatuses.find(owner => owner.ownerId === 2).status, "STORE");
    const recovered = await service.retryPending({ activeCampaignToken: campaignToken, manual: true });
    const durableFailures = fs.readdirSync(engine.memory4.recoveryDir).filter(name => /^[a-f0-9]{64}\.json$/.test(name))
      .map(name => engine.memory4.readRecovery(path.join(engine.memory4.recoveryDir, name))?.lastError);
    assert(recovered.some(row => row.status === "COMPLETE"),
      `a fresh MemoryEngine process recovers the persisted letter job: ${JSON.stringify({ recovered, durableFailures })}`);
    assert.equal(narrativeRequests, 2, "retry resumes durable extraction without re-requesting an already saved letter summary");
    assert.equal(engine.store.listAllEpisodes().length, 1, "real MemoryStore commits one letter episode marker");
    const memories = engine.store.listAllMemories().filter(row => row.provenance?.conversationId === context.letterId);
    assert.equal(memories.length, 1, "real MemoryStore commits one compatibility letter summary");
    assert.equal(memories[0].content, summary);
    assert.equal(memories[0].eventDate, context.acceptedDate);

    const directed = [];
    const walk = directory => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const target = path.join(directory, entry.name);
        if (entry.isDirectory()) walk(target);
        else if (entry.name.endsWith(".json")) directed.push(target);
      }
    };
    walk(summariesDir);
    const summaryFiles = directed.map(file => ({ file, rows: JSON.parse(fs.readFileSync(file, "utf8")) }))
      .filter(item => Array.isArray(item.rows) && item.rows.some(row => row.finalizationId === job.jobId || row.content === summary));
    assert.equal(summaryFiles.length, 2, "GameData.saveRecoveredSummary persists both directed participant summaries");
    for (const { rows } of summaryFiles) {
      const row = rows.find(item => item.content === summary);
      assert.equal(row.campaignToken, campaignToken);
      assert.equal(row.date, context.acceptedDate);
    }

    const ownerScopes = [1, 2].map(ownerId => ({ campaignToken, ownerId }));
    for (const scope of ownerScopes) {
      const index = engine.memory4.store.loadIndex(scope);
      const detail = engine.memory4.store.query(scope);
      assert.equal(detail.length, 2, `Memory4 Detail commits both dated facts for owner ${scope.ownerId}`);
      const sentDate = detail.find(entry => entry.eventTime.from === "1038.4.1");
      const relativeDate = detail.find(entry => entry.eventTime.from === "1038.3.29");
      assert(sentDate && relativeDate, "STORE preserves exact and source-relative event dates");
      assert(detail.every(entry => entry.conversationDate === context.acceptedDate && entry.acquiredDate === context.acceptedDate));
      assert.deepEqual(sentDate.evidence.knownBy.slice().sort(), [1, 2], "each participant's own owner view is limited to the two correspondents");
      const relativeRef = relativeDate.temporalRefs.find(ref => ref.expression === "三日前");
      assert(relativeRef, "real Memory4 Detail carries the source-relative temporal proof");
      assert.equal(relativeRef.source, "deterministic_letter_parse");
      assert.equal(relativeRef.sourceLetterId, context.letterId);
      assert.equal(relativeRef.messageIds.length, 0, "letter proof does not fabricate message ids");
      assert.equal(relativeRef.segmentIds.length, 1);
      assert.equal(relativeRef.sourceTextHash, hashMemoryValue(context.text), "letter proof hashes the actual source text deterministically");
      assert.deepEqual(relativeRef.segmentIds, relativeDate.source.segmentIds);
      const finalization = Object.values(index.finalizations).find(row => row.status === "STORE");
      assert(finalization, "real Memory4 index records the owner-specific canonical commit");
      await waitFor(() => engine.memory4.derived.active.size === 0);
      const derivedResult = await engine.memory4.derived.rebuild(scope, { kind: "all" });
      assert.equal(derivedResult.status, "COMPLETE", JSON.stringify(derivedResult));
      const views = engine.memory4.derived.list(scope);
      assert(views.years.some(view => view.eventYear === 1038 && JSON.stringify(view).includes("三日前玉印已留在内库")),
        "actual Memory4 Year view derives from the letter Detail");
      assert(views.life?.segments.some(segment => segment.text.includes("三日前玉印已留在内库")),
        "actual Memory4 Life view derives from the letter Detail");
    }
    assert.throws(() => engine.memory4.store.query({ campaignToken, ownerId: 3 }), /memory4_owner_folder_not_unique/,
      "an unrelated third party has no owner folder from which to query private letter Detail");
    assert.deepEqual([...new Set(durableRequests.map(row => row.ownerId))].sort(), [1, 2]);
    assert.equal(durableRequests.filter(row => row.ownerId === 1).length, 2, "only the failed owner is extracted again");
    assert.equal(durableRequests.filter(row => row.ownerId === 2).length, 1, "completed owner extraction is not replayed");
    assert(durableRequests.every(row => row.fragment.visibilityEvidence === "validated_letter"
      && JSON.stringify(row.fragment.allowedEntityIds.slice().sort()) === JSON.stringify([1, 2])
      && row.fragment.participantIds.length === 0),
    "the real coordinator exposes only validated evidence and does not invent CK3 presence from a letter");
  } finally {
    const target = path.resolve(root);
    assert(target.startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(target, { recursive: true, force: true });
  }
}

function createRealRegenerationFixture({ requestSummary, requestExtraction, campaign = "summary-rebuild-qa" } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "votc-summary-rebuild-qa-"));
  const summariesDir = path.join(root, "summaries");
  const engine = new MemoryEngine({ baseDir: path.join(root, "memory"), summaryFoldersDir: summariesDir, trace: { record() {} } });
  const GameData = createGameData({ fs, path, memorySystem, memoryEngine: engine, summariesDir, getHistoricalReferenceByYear: () => null });
  const profiles = [{ id: 2, name: "乙", shortName: "乙", fullName: "乙" }, { id: 1, name: "丙", shortName: "丙", fullName: "丙" }];
  const context = { conversationId: "summary-rebuild-seed", finalizationId: "summary-rebuild-seed-finalization",
    episodeId: "summary-rebuild-seed-episode", commitMarker: "summary-rebuild-seed-commit",
    campaignToken: campaign, currentCampaignNative: true, date: "1165.1.1", totalDays: 420000,
    participants: profiles, participantIds: profiles.map(row => row.id), participantProfiles: profiles,
    excludedSummaryOwnerIds: [], joinEvents: [], leaveEvents: [], presenceJoins: [], presenceLeaves: [] };
  const original = "1164年乙答应秋收后向丙送粮。";
  const saved = GameData.saveRecoveredSummary(original, context);
  assert.equal(saved.success, true, "real GameData saves the starting directed summary files");
  const gameData = new GameData(["2", "乙", "1", "丙", "1165年1月1日", "conversationcourt", "临安", "乙", "420000"]);
  gameData.campaignToken = campaign;
  gameData.characters.set(2, { id: 2, name: "乙", shortName: "乙", fullName: "乙" });
  gameData.characters.set(1, { id: 1, name: "丙", shortName: "丙", fullName: "丙" });
  const conversation = { id: "summary-rebuild-active", isActive: true, gameData,
    memoryState: engine.createConversationState("summary-rebuild-active"), dynamicRecallHistory: new Map() };
  engine.memory4.configureDerived({ isCampaignCurrent: token => token === campaign, requestExtraction });
  const manager = createSummariesManager({ fs, path, summariesDir, memoryEngine: engine, memorySystem,
    getCurrentConversation: () => conversation, getMemory4ReadConversation: () => conversation,
    requestSummary, getSummaryOutputLimit: () => 2048 });
  manager.refreshCurrentConversation = () => {};
  return { root, summariesDir, engine, GameData, context, original, conversation, manager, profiles,
    summaryPath: path.join(summariesDir, "2_乙", "与丙的对话.json"),
    cleanup() { fs.rmSync(root, { recursive: true, force: true }); } };
}

function memory4RewriteResponse(prompt, contentOverride = null) {
  const payload = JSON.parse(prompt[1].content);
  const fragment = payload.fragments[0];
  assert(fragment, "summary rebuild extraction receives the current legacy source fragment");
  const content = contentOverride || fragment.text;
  return JSON.stringify({ status: "STORE", entries: [{ memoryType: "DURABLE_KNOWLEDGE", text: content,
    fragmentIds: [fragment.fragmentId], entityIds: fragment.allowedEntityIds, participantIds: [], topics: ["粮食"],
    eventTime: { from: "1164.1.1", to: "1164.12.31", precision: "year", status: "reported" } }] });
}

async function testRealRegenerationRebuildAndStaleCampaignGuard() {
  const updated = "1164年乙改为承诺秋收后分批向丙送粮。";
  const started = deferred();
  const extractionGate = deferred();
  let extractionCalls = 0;
  const fixture = createRealRegenerationFixture({
    requestSummary: async () => ({ content: updated, finish_reason: "stop" }),
    requestExtraction: async prompt => {
      extractionCalls++;
      started.resolve();
      return extractionGate.promise.then(() => memory4RewriteResponse(prompt));
    }
  });
  try {
    const run = fixture.manager.regenerateSummary(2, 1, 0, fixture.original);
    await started.promise;
    fixture.conversation.gameData.campaignToken = "summary-rebuild-next-campaign";
    extractionGate.resolve();
    const result = await run;
    assert.equal(extractionCalls, 1);
    assert.equal(result.success, false, "an async rebuild from a campaign that ceased to be current must not report complete");
    assert.equal(result.memoryRebuild.canonical.status, "CANCELLED");
    assert.equal(fixture.engine.memory4.store.query({ campaignToken: fixture.context.campaignToken, ownerId: 2 }).length, 0,
      "the old campaign's late provider response cannot commit a canonical Detail");
    const summary = JSON.parse(fs.readFileSync(fixture.summaryPath, "utf8"))[0];
    assert.equal(summary.content, updated, "the text edit remains explicit, while stale Memory4 work is rejected");
  } finally { fixture.cleanup(); }
}

async function testSourceEditDuringRewriteIsRejectedBeforeMemoryMutation() {
  const started = deferred();
  const summaryGate = deferred();
  const fixture = createRealRegenerationFixture({
    requestSummary: async () => { started.resolve(); return summaryGate.promise; },
    requestExtraction: async prompt => memory4RewriteResponse(prompt)
  });
  try {
    const run = fixture.manager.regenerateSummary(2, 1, 0, fixture.original);
    await started.promise;
    const external = "1164年另一位编辑已替换此摘要。";
    const rows = JSON.parse(fs.readFileSync(fixture.summaryPath, "utf8"));
    rows[0].content = external;
    fs.writeFileSync(fixture.summaryPath, JSON.stringify(rows), "utf8");
    summaryGate.resolve({ content: "1164年乙改为承诺秋收后分批向丙送粮。", finish_reason: "stop" });
    const result = await run;
    assert.equal(result.success, false);
    assert.equal(result.error, "summary_regeneration_stale");
    assert.equal(JSON.parse(fs.readFileSync(fixture.summaryPath, "utf8"))[0].content, external,
      "an old async rewrite cannot overwrite a newer source-file edit");
    assert.equal(fixture.engine.store.listAllMemories().filter(row => row.provenance?.extractionMode === "user_edited_summary").length, 0,
      "stale rewrite must not create a canonical legacy source");
  } finally { fixture.cleanup(); }
}

async function waitFor(predicate) {
  for (let index = 0; index < 50; index++) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  assert.fail("condition did not become true before timeout");
}

async function main() {
  await testQueuedLetterCannotCaptureAndAcceptedCapturePrecedesDeletion();
  await testCaptureFailureDoesNotDropAcceptedMemoryPayload();
  testUnverifiedLetterCannotAuthorizeRelativeDate();
  await testRealRegenerationRebuildAndStaleCampaignGuard();
  await testSourceEditDuringRewriteIsRejectedBeforeMemoryMutation();
  await testRealMemory4AndRecoveredSummaryPipeline();
  console.log("V8.14.2 Independent Letter Retry QA: PASS");
}

main().catch(error => { console.error(error); process.exitCode = 1; });
