"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createRunFileManager } = require("../resources/app/out/main/actions/run-file-manager");
const { createLetterEffectTransport } = require("../resources/app/out/main/letters/letter-effect-transport");
const { createLetterManager } = require("../resources/app/out/main/letters/letter-manager");
const { LetterSummaryFinalization } = require("../resources/app/out/main/memory-system/letter-summary-finalization");
const { MemoryEngine } = require("../resources/app/out/main/memory-system/memory-engine");
const { createGameData } = require("../resources/app/out/main/game-data/game-data");
const { createSummariesManager } = require("../resources/app/out/main/summaries/summaries-manager");
const memorySystem = require("../resources/app/out/main/memory-system");

const campaignToken = "independent-letter-qa-campaign";
const letter = { letterId: "letter_independent_retry", content: "请将玉印留在内库。", totalDays: 100, delay: 3 };
const reply = "玉印已妥善收存。";
const letterSummary = "赵祯请李师师保管玉印，李师师回信确认已经妥善收存。";

function deferred() {
  let resolve, reject;
  const promise = new Promise((resolvePromise, rejectPromise) => { resolve = resolvePromise; reject = rejectPromise; });
  return { promise, resolve, reject };
}

function makeGameData(GameData, totalDays, date) {
  const gameData = new GameData(["1", "赵祯", "2", "李师师", date,
    "scene_type_court", "开封", "赵祯", String(totalDays)]);
  gameData.campaignToken = campaignToken;
  gameData.characters = new Map([
    [1, { id: 1, name: "赵祯", shortName: "赵祯", fullName: "宋仁宗赵祯" }],
    [2, { id: 2, name: "李师师", shortName: "李师师", fullName: "东京名伎李师师" }]
  ]);
  gameData.letterData = letter;
  return gameData;
}

function createLetterFixture({ failFirstSummary = false, failFirstCapture = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "votc-letter-retry-independent-"));
  const ck3Dir = path.join(root, "ck3");
  const dataDir = path.join(root, "data");
  const runDir = path.join(ck3Dir, "run");
  const debugLogPath = path.join(ck3Dir, "logs", "debug.log");
  const summariesDir = path.join(root, "conversation_summaries");
  fs.mkdirSync(runDir, { recursive: true });
  fs.mkdirSync(path.dirname(debugLogPath), { recursive: true });
  fs.writeFileSync(path.join(runDir, "votc.txt"), "", "utf8");
  fs.writeFileSync(debugLogPath, "VOTC:DATE/;/103\n", "utf8");

  const memoryEngine = new MemoryEngine({ baseDir: path.join(root, "memory"), summaryFoldersDir: summariesDir,
    trace: { record() {} } });
  const GameData = createGameData({ fs, path, memorySystem, memoryEngine, summariesDir,
    getHistoricalReferenceByYear: () => null });
  const sourceGameData = makeGameData(GameData, 100, "1038年4月1日");
  const acceptedGameData = makeGameData(GameData, 103, "1038年4月4日");
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
  let effectWrites = 0;
  const writeOutbound = letterEffectTransport.writeOutboundLetterEffect.bind(letterEffectTransport);
  letterEffectTransport.writeOutboundLetterEffect = (...args) => {
    effectWrites++;
    return writeOutbound(...args);
  };

  const summaryCalls = [];
  const archive = new LetterSummaryFinalization({
    memoryEngine,
    requestSummary: async (messages, options) => {
      summaryCalls.push({ messages: structuredClone(messages), options });
      if (failFirstSummary && summaryCalls.length === 1) throw new Error("fixture_letter_summary_provider_failure");
      return { content: letterSummary, finish_reason: "stop" };
    },
    persistSummary: (content, context) => GameData.saveRecoveredSummary(content, context),
    getSummarySettings: () => settingsRepository.getSummaryPromptSettings(),
    isCampaignCurrent: token => token === campaignToken
  });
  let captureCalls = 0;
  let failCapture = failFirstCapture;
  // Fault-inject the service boundary only; every successful capture uses the real MemoryStore writer.
  const captureAccepted = archive.captureAccepted.bind(archive);
  archive.captureAccepted = context => {
    captureCalls++;
    if (failCapture) {
      failCapture = false;
      throw new Error("fixture_capture_failure");
    }
    return captureAccepted(context);
  };
  memoryEngine.letterSummaryFinalization = archive;

  const inertInterval = () => ({ unref() {} });
  const managerDependencies = {
    settingsRepository, fs, path, TailFile: class {}, readline: {},
    parseLog: async () => acceptedGameData,
    letterPromptBuilder: { buildMessages: () => [{ role: "user", content: "offline letter fixture" }] },
    llmManager: { sendChatRequest: async () => ({ content: reply, finish_reason: "stop" }) },
    PromptBuilder: {}, TokenCounter: { estimateMessageTokens: message => message.content.length },
    memoryEngine, dataDir, letterEffectTransport, runFileManager, autoStartLogTailing: false,
    letterPayloadRetryDelays: [], setIntervalFn: inertInterval, clearIntervalFn() {},
    setRunCommandIntervalFn: inertInterval, clearRunCommandIntervalFn() {}
  };
  const managers = [];
  const createManager = () => {
    const { LetterManager } = createLetterManager(managerDependencies);
    const manager = new LetterManager();
    managers.push(manager);
    return manager;
  };
  const manager = createManager();
  manager.currentTotalDays = 100;
  const disclosureBinding = manager.buildLetterDisclosureBinding(sourceGameData, letter);
  assert(disclosureBinding, "the source letter must bind to the current campaign and pair");
  manager.createLetterStatus(letter, "李师师");
  manager.updateLetterStatus(letter.letterId, { responseStatus: "pending_delivery" });
  manager.storedLetters.set(letter.letterId, {
    letter, reply, expectedDeliveryDay: 103, characterName: "李师师", disclosureBinding,
    sourceMemoryContext: manager.buildLetterSourceMemoryContext(sourceGameData, disclosureBinding)
  });
  manager.savePendingLetters();

  return {
    root, ck3Dir, dataDir, runDir, debugLogPath, manager, managerDependencies, createManager,
    sourceGameData, archive, memoryEngine, runFileManager, summaryCalls,
    get effectWrites() { return effectWrites; }, get captureCalls() { return captureCalls; },
    async close() {
      for (const item of managers) await item.stopLogTailing();
      fs.rmSync(root, { recursive: true, force: true });
    }
  };
}

async function testAcknowledgementAndLegacySummaryRecovery() {
  const fixture = createLetterFixture({ failFirstSummary: true, failFirstCapture: true });
  try {
    const { manager, runFileManager } = fixture;
    const blocker = runFileManager.enqueueCommand({ owner: "qa", kind: "action_effect",
      commandId: "letter_qa_blocker", effectText: "add_gold = 1" });
    assert.equal(await manager.writeLetterEffect(reply, letter), true);
    assert.equal(manager.getLetterStatus(letter.letterId).runCommandStatus, "queued");
    const earlyAcceptance = await manager.clearLettersFile();
    assert.equal(earlyAcceptance.reason, "letter_effect_not_written", "a queued effect cannot be accepted");
    assert.equal(fixture.captureCalls, 0, "a queued callback cannot create a Legacy summary job");
    assert(manager.storedLetters.has(letter.letterId));

    await manager.processLogLine(`VOTC:RUN_ACK/ACTION_EFFECT/${blocker.commandId}`);
    const command = runFileManager.getPendingCommands().find(row => row.kind === "letter_effect");
    assert(command?.commandId, "the waiting letter effect dispatches after the preceding ACK");
    await manager.processLogLine(`VOTC:RUN_ACK/LETTER_EFFECT/${command.commandId}`);
    assert.equal(manager.getLetterStatus(letter.letterId).responseStatus, "effect_file_written");

    const pending = manager.storedLetters.get(letter.letterId);
    const receipt = `VOTC:LETTER_RECEIPT/;/${letter.letterId}/;/${pending.receiptToken}/;/${campaignToken}/;/1/;/2/;/103/;/1038.4.4`;
    await assert.rejects(manager.processLogLine(receipt), /fixture_capture_failure/);
    assert.equal(manager.getLetterStatus(letter.letterId).responseStatus, "sent", "verified CK3 acceptance remains accepted after a local capture error");
    assert.equal(manager.storedLetters.has(letter.letterId), true, "failed capture retains the accepted payload for local recovery");
    assert.equal(fixture.effectWrites, 1, "capture failure does not replay the delivery effect");
    assert.equal(fixture.captureCalls, 1);

    await manager.checkAndDeliverLetters();
    assert.equal(manager.storedLetters.has(letter.letterId), false, "the real Legacy recovery job owns the accepted payload after capture succeeds");
    assert.equal(fixture.captureCalls, 2);
    assert.equal(fixture.effectWrites, 1);
    await waitFor(() => manager.getLetterStatus(letter.letterId).summaryStatus === "generation_failed");
    const retried = await fixture.archive.retryPending({ activeCampaignToken: campaignToken, manual: true });
    assert(retried.some(row => row.status === "COMPLETE"), "Legacy summary recovery completes after a provider failure");
    assert.equal(fixture.effectWrites, 1, "summary recovery cannot replay the accepted Effect");
    assert.equal(fixture.summaryCalls.length, 2, "only the failed Legacy summary request is retried");
    assert.equal(Object.hasOwn(fixture.memoryEngine, "memory4"), false);
    assert.equal(fixture.memoryEngine.store.listAllEpisodes().length, 1);
    const [memory] = fixture.memoryEngine.store.listAllMemories();
    assert.equal(memory.type, "letter");
    assert.equal(memory.content, letterSummary);
    assert.deepEqual(memory.knownBy, [1, 2]);
    assert(fixture.summaryCalls[1].messages.some(message => message.content.includes(letter.content)
      && message.content.includes(reply)), "the Legacy summary request is limited to the accepted exchange");
  } finally { await fixture.close(); }
}

function createLegacyRewriteFixture({ requestSummary } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "votc-legacy-summary-rewrite-"));
  const summariesDir = path.join(root, "summaries");
  const engine = new MemoryEngine({ baseDir: path.join(root, "memory"), summaryFoldersDir: summariesDir,
    trace: { record() {} } });
  const GameData = createGameData({ fs, path, memorySystem, memoryEngine: engine, summariesDir,
    getHistoricalReferenceByYear: () => null });
  const profiles = [
    { id: 2, name: "乙", shortName: "乙", fullName: "乙" },
    { id: 1, name: "丙", shortName: "丙", fullName: "丙" }
  ];
  const context = {
    conversationId: "legacy-rewrite-seed", finalizationId: "legacy-rewrite-seed-finalization",
    episodeId: "legacy-rewrite-seed-episode", commitMarker: "legacy-rewrite-seed-commit",
    campaignToken, currentCampaignNative: true, date: "1165.1.1", totalDays: 420000,
    participants: profiles, participantIds: profiles.map(row => row.id), participantProfiles: profiles,
    excludedSummaryOwnerIds: [], joinEvents: [], leaveEvents: [], presenceJoins: [], presenceLeaves: []
  };
  const original = "1164年乙答应秋收后向丙送粮。";
  const saved = GameData.saveRecoveredSummary(original, context);
  assert.equal(saved.success, true, "the existing Legacy summary persistence path creates both directed projections");
  const gameData = new GameData(["2", "乙", "1", "丙", "1165年1月1日", "scene_type_court", "临安", "乙", "420000"]);
  gameData.campaignToken = campaignToken;
  gameData.characters.set(2, { ...profiles[0] });
  gameData.characters.set(1, { ...profiles[1] });
  const conversation = { id: "legacy-rewrite-active", isActive: true, gameData,
    memoryState: engine.createConversationState("legacy-rewrite-active"), dynamicRecallHistory: new Map() };
  const manager = createSummariesManager({ fs, path, summariesDir, memoryEngine: engine, memorySystem,
    getCurrentConversation: () => conversation, requestSummary, getSummaryOutputLimit: () => 2048 });
  manager.refreshCurrentConversation = () => {};
  return { root, summariesDir, engine, conversation, manager, original, profiles,
    summaryPath: path.join(summariesDir, "2_乙", "与丙的对话.json"),
    counterpartPath: path.join(summariesDir, "1_丙", "与乙的对话.json"),
    cleanup() { fs.rmSync(root, { recursive: true, force: true }); }
  };
}

async function testLegacySummaryRewriteAndStaleEditGuard() {
  const updated = "1164年乙改为承诺秋收后分批向丙送粮。";
  const requests = [];
  const fixture = createLegacyRewriteFixture({ requestSummary: async (prompt, options) => {
    requests.push({ prompt, options });
    return { content: updated, finish_reason: "stop" };
  } });
  try {
    const result = await fixture.manager.regenerateSummary(2, 1, 0, fixture.original);
    assert.equal(result.success, true, "the existing summary_rewrite flow still completes as a Legacy text edit");
    assert.equal(requests.length, 1);
    assert.equal(requests[0].options.requestType, "summary_rewrite");
    assert.equal(JSON.parse(fs.readFileSync(fixture.summaryPath, "utf8"))[0].content, updated);
    assert.equal(JSON.parse(fs.readFileSync(fixture.counterpartPath, "utf8"))[0].content, fixture.original,
      "editing one Legacy perspective leaves the other directed summary intact");
    assert.equal(Object.hasOwn(fixture.engine, "memory4"), false);
    assert.equal(fixture.engine.store.listAllMemories().some(row => row.provenance?.extractionMode === "user_edited_summary"), true,
      "the edit updates the existing owner-scoped Legacy memory projection");
  } finally { fixture.cleanup(); }

  const started = deferred();
  const summaryGate = deferred();
  const staleFixture = createLegacyRewriteFixture({ requestSummary: async () => {
    started.resolve();
    return summaryGate.promise;
  } });
  try {
    const run = staleFixture.manager.regenerateSummary(2, 1, 0, staleFixture.original);
    await started.promise;
    const externalEdit = "1164年另一位编辑已替换此摘要。";
    const rows = JSON.parse(fs.readFileSync(staleFixture.summaryPath, "utf8"));
    rows[0].content = externalEdit;
    fs.writeFileSync(staleFixture.summaryPath, JSON.stringify(rows), "utf8");
    summaryGate.resolve({ content: updated, finish_reason: "stop" });
    const result = await run;
    assert.equal(result.success, false);
    assert.equal(result.error, "summary_regeneration_stale");
    assert.equal(JSON.parse(fs.readFileSync(staleFixture.summaryPath, "utf8"))[0].content, externalEdit,
      "a delayed Legacy rewrite cannot overwrite a newer summary edit");
    assert.equal(staleFixture.engine.store.listAllMemories().some(row => row.provenance?.extractionMode === "user_edited_summary"), false,
      "a stale rewrite creates no Legacy memory projection");
  } finally { staleFixture.cleanup(); }
}

async function waitFor(predicate, message = "condition did not become true before timeout") {
  const started = Date.now();
  while (Date.now() - started < 10000) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.fail(message);
}

async function main() {
  await testAcknowledgementAndLegacySummaryRecovery();
  await testLegacySummaryRewriteAndStaleEditGuard();
  console.log("V8.14.2 Legacy Letter Retry QA: PASS (ACK gate, accepted Legacy capture/recovery, no Effect replay, Legacy summary rewrite/stale edit)");
}

main().catch(error => { console.error(error); process.exitCode = 1; });
