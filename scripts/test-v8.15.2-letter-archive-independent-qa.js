"use strict";

const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const Module = require("node:module");
const os = require("node:os");
const path = require("node:path");
const { createRunFileManager } = require("../resources/app/out/main/actions/run-file-manager");
const { Character } = require("../resources/app/out/main/game-data/character");
const { createGameData } = require("../resources/app/out/main/game-data/game-data");
const { createLetterEffectTransport } = require("../resources/app/out/main/letters/letter-effect-transport");
const { createLetterManager } = require("../resources/app/out/main/letters/letter-manager");
const { LetterMemoryFinalization } = require("../resources/app/out/main/memory-system/letter-memory-finalization");
const { MemoryEngine } = require("../resources/app/out/main/memory-system/memory-engine");
const memorySystem = require("../resources/app/out/main/memory-system");
const { hash } = require("../resources/app/out/main/memory-system/memory4-contract");

const CAMPAIGN = "votc8c-202610080001";
const OTHER_CAMPAIGN = "votc8c-202610080002";
const LETTER_ID = "letter_archive_1";
const LETTER_TEXT = "1038年4月1日，赵祯写信给李师师，请她代为保管玉印。";
const REPLY_TEXT = "李师师回信赵祯，确认已经妥善收存。";
const SUMMARY_TEXT = "双方通过信件确认玉印已妥善收存。";

function safeAssert(condition, message) {
  if (!condition) throw new Error(message);
}

function makeCharacter(id, shortName, fullName, { relationsToCharacters = [], relationsToPlayer = [] } = {}) {
  const fields = Array(28).fill("");
  fields[0] = String(id);
  fields[1] = shortName;
  fields[2] = fullName;
  fields[3] = id === 1 ? "宋朝皇帝" : "东京名伎";
  fields[4] = id === 2 ? "她" : "他";
  fields[5] = "30";
  fields[6] = "10";
  fields[7] = "0";
  fields[8] = "未知";
  fields[9] = "沉稳";
  fields[14] = "汉";
  fields[15] = "儒教";
  fields[18] = shortName;
  const character = new Character(fields);
  character.name = shortName;
  character.relationsToCharacters = relationsToCharacters;
  character.relationsToPlayer = relationsToPlayer;
  return character;
}

function createGameDataFactory({ GameData }) {
  return ({ campaignToken = CAMPAIGN, playerID = 1, aiID = 2, totalDays = 100,
    date = "1038年4月1日", letterData = null, npcName = "李师师", playerName = "赵祯" } = {}) => {
    const data = [String(playerID), playerName, String(aiID), npcName, date,
      "scene_type_court", "开封", playerName, String(totalDays)];
    const gameData = new GameData(data);
    gameData.campaignToken = campaignToken;
    gameData.characters = new Map([
      [playerID, makeCharacter(playerID, playerName, `宋仁宗${playerName}`, {
        relationsToCharacters: aiID === 2 ? [{ id: aiID, relations: ["spouse"] }] : []
      })],
      [aiID, makeCharacter(aiID, npcName, `东京名伎${npcName}`, {
        relationsToPlayer: playerID === 1 ? ["spouse"] : []
      })]
    ]);
    gameData.letterData = letterData;
    return gameData;
  };
}

function createFixture({ failFirstSummary = false, letterManagerFactory = createLetterManager } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "votc-letter-archive-qa-"));
  const ck3Dir = path.join(root, "ck3");
  const dataDir = path.join(root, "data");
  const runDir = path.join(ck3Dir, "run");
  const debugLogPath = path.join(ck3Dir, "logs", "debug.log");
  const summariesDir = path.join(root, "conversation_summaries");
  const memoryDir = path.join(root, "memory");
  fs.mkdirSync(runDir, { recursive: true });
  fs.mkdirSync(summariesDir, { recursive: true });
  fs.mkdirSync(path.dirname(debugLogPath), { recursive: true });
  fs.writeFileSync(debugLogPath, "fixture log\n", "utf8");

  const memoryEngine = new MemoryEngine({ baseDir: memoryDir, summaryFoldersDir: summariesDir,
    trace: { record() {} } });
  memoryEngine.memory4.configureDerived({ isCampaignCurrent: token => token === CAMPAIGN });
  memoryEngine.memory4.derived.schedule = () => {};

  const GameData = createGameData({ fs, path, memorySystem, memoryEngine, summariesDir,
    getHistoricalReferenceByYear: () => null });
  const makeGameData = createGameDataFactory({ GameData });
  const originalLetter = { letterId: LETTER_ID, content: LETTER_TEXT, totalDays: 100, delay: 3 };
  const sourceGameData = makeGameData({ letterData: originalLetter });
  let parsedGameData = sourceGameData;
  let parseCalls = 0;
  const parseLog = async () => { parseCalls++; return parsedGameData; };

  const settingsRepository = {
    getCK3UserFolderPath: () => ck3Dir,
    getCK3DebugLogPath: () => debugLogPath,
    getSummaryPromptSettings: () => ({ letterSummaryPrompt: "只概括已接受的信件往来。" })
  };
  const runManagerFactory = createRunFileManager({ settingsRepository, fs, path, dataDir });
  const runFileManager = new runManagerFactory();
  runFileManager.initializeAfterAckReconciliation();
  const { LetterEffectTransport } = createLetterEffectTransport({ settingsRepository, fs, path,
    runFileManager, dataDir });
  const letterEffectTransport = new LetterEffectTransport();
  let effectWrites = 0;
  const writeOutbound = letterEffectTransport.writeOutboundLetterEffect.bind(letterEffectTransport);
  letterEffectTransport.writeOutboundLetterEffect = (...args) => {
    effectWrites++;
    return writeOutbound(...args);
  };

  const summaryCalls = [];
  const durableOwners = [];
  const durableSnapshots = [];
  let shouldFailSummary = failFirstSummary;
  const archive = new LetterMemoryFinalization({
    memoryEngine,
    requestSummary: async messages => {
      summaryCalls.push(structuredClone(messages));
      if (shouldFailSummary) {
        shouldFailSummary = false;
        throw new Error("fixture_summary_failure");
      }
      return { content: SUMMARY_TEXT };
    },
    requestDurable: async (messages, options) => {
      durableOwners.push(options.ownerId);
      const request = JSON.parse(messages[1].content);
      const fragment = request.fragments[0];
      durableSnapshots.push({ ownerId: options.ownerId, fragment });
      return { content: JSON.stringify({ status: "STORE", entries: [{
        memoryType: "DURABLE_KNOWLEDGE",
        text: "信件确认玉印已妥善保管。",
        fragmentIds: [fragment.fragmentId],
        entityIds: fragment.allowedEntityIds,
        participantIds: [],
        topics: ["玉印", "信件"],
        eventTime: { from: fragment.eventDate, to: fragment.eventDate, precision: "day", status: "reported" }
      }] }) };
    },
    persistSummary: async (summary, context) => GameData.saveRecoveredSummary(summary, context),
    getSummarySettings: () => settingsRepository.getSummaryPromptSettings(),
    isCampaignCurrent: token => token === CAMPAIGN
  });
  memoryEngine.letterMemoryFinalization = archive;

  const inertInterval = () => ({ unref() {} });
  const managerDependencies = {
    settingsRepository, fs, path, TailFile: class {}, readline: {}, parseLog,
    letterPromptBuilder: { buildMessages: () => [{ role: "user", content: "offline letter fixture" }] },
    llmManager: { sendChatRequest: async () => ({ content: REPLY_TEXT }) },
    PromptBuilder: {}, TokenCounter: { estimateMessageTokens: message => message.content.length },
    memoryEngine, dataDir, letterEffectTransport, runFileManager, autoStartLogTailing: false,
    letterPayloadRetryDelays: [], setIntervalFn: inertInterval, clearIntervalFn() {},
    setRunCommandIntervalFn: inertInterval, clearRunCommandIntervalFn() {}
  };
  const managers = [];
  const createManager = () => {
    const { LetterManager } = letterManagerFactory(managerDependencies);
    const manager = new LetterManager();
    managers.push(manager);
    return manager;
  };
  const pendingPath = path.join(dataDir, "pending-letters.json");
  const manager = createManager();
  manager.currentTotalDays = 100;

  return {
    root, ck3Dir, runDir, debugLogPath, dataDir, summariesDir, memoryDir, pendingPath,
    manager, managers, createManager, managerDependencies, sourceGameData, originalLetter,
    makeGameData, setParsedGameData(value) { parsedGameData = value; },
    get parseCalls() { return parseCalls; }, get effectWrites() { return effectWrites; },
    summaryCalls, durableOwners, durableSnapshots, archive, memoryEngine, runFileManager,
    async close() {
      for (const item of managers) await item.stopLogTailing();
      fs.rmSync(root, { recursive: true, force: true });
    }
  };
}

function makeReceiptLine({ letterId = LETTER_ID, token, campaignToken = CAMPAIGN,
  playerId = 1, aiId = 2, totalDays = 103, date = "1038.4.4", prefix = "" } = {}) {
  return `${prefix}VOTC:LETTER_RECEIPT/;/${letterId}/;/${token}/;/${campaignToken}/;/${playerId}/;/${aiId}/;/${totalDays}/;/${date}`;
}

function loadHeadLetterManagerFactory() {
  const repositoryRoot = path.resolve(__dirname, "..");
  const filename = path.join(repositoryRoot, "resources", "app", "out", "main", "letters", "letter-manager.js");
  const source = execFileSync("git", ["show", "fda1b8e:resources/app/out/main/letters/letter-manager.js"], {
    cwd: repositoryRoot, encoding: "utf8", windowsHide: true, maxBuffer: 4 * 1024 * 1024
  });
  const headModule = new Module(filename, module);
  headModule.filename = filename;
  headModule.paths = Module._nodeModulePaths(path.dirname(filename));
  headModule._compile(source, filename);
  safeAssert(typeof headModule.exports.createLetterManager === "function", "HEAD exports the letter manager factory");
  return headModule.exports.createLetterManager;
}

function pendingLetter(fixture, manager, letter, reply, expectedDeliveryDay) {
  const disclosureBinding = manager.buildLetterDisclosureBinding(fixture.sourceGameData, letter);
  safeAssert(!!disclosureBinding, "fixture letter source binding must validate");
  manager.createLetterStatus(letter, "李师师");
  manager.updateLetterStatus(letter.letterId, { responseStatus: "pending_delivery" });
  manager.storedLetters.set(letter.letterId, {
    letter, reply, expectedDeliveryDay, characterName: "李师师", disclosureBinding,
    sourceMemoryContext: manager.buildLetterSourceMemoryContext(fixture.sourceGameData, disclosureBinding)
  });
  manager.savePendingLetters();
}

async function testReceiptArchiveRetryAndIsolation() {
  const fixture = createFixture({ failFirstSummary: true });
  try {
    const { manager: firstManager, originalLetter } = fixture;
    const reply = await firstManager.processLatestLetter({ skipPayloadRequest: true });
    assert.equal(reply, REPLY_TEXT);
    assert.equal(fixture.summaryCalls.length, 0, "generating a reply does not archive an unreceived letter");
    assert.equal(fs.existsSync(fixture.pendingPath), true);

    firstManager.currentTotalDays = 103;
    await firstManager.checkAndDeliverLetters();
    assert.equal(fixture.effectWrites, 1, "one outbound effect is written for the due letter");
    let pending = JSON.parse(fs.readFileSync(fixture.pendingPath, "utf8"));
    let stored = pending.letters.find(row => row.letter?.letterId === LETTER_ID);
    assert.match(stored.receiptToken, /^[a-f0-9]{32}$/, "the receipt token is persisted before delivery");
    const receiptToken = stored.receiptToken;
    assert.equal(stored.sourceMemoryContext.participantProfiles[0].shortName, "赵祯");
    assert.equal(stored.sourceMemoryContext.participantProfiles[1].shortName, "李师师");
    assert(stored.sourceMemoryContext.relationshipEvidence.some(row => row.ownerId === 1 && row.entityId === 2
      && row.types.includes("spouse")), "the source relationship evidence is persisted with the pending letter");

    const effect = fs.readFileSync(fixture.runFileManager.path, "utf8");
    const artifactIndex = effect.indexOf("create_artifact = {");
    const openEventIndex = effect.indexOf("trigger_event = message_event.362");
    const receiptIndex = effect.indexOf(`VOTC:LETTER_RECEIPT/;/${LETTER_ID}/;/${receiptToken}/;`);
    safeAssert(artifactIndex >= 0 && openEventIndex > artifactIndex && receiptIndex > openEventIndex,
      "the receipt marker is emitted after artifact creation and the letter event");
    safeAssert(effect.includes("exists = scope:votc_latest_letter"), "receipt emission is guarded by the created artifact scope");

    const command = fixture.runFileManager.getPendingCommands().find(row => row.kind === "letter_effect");
    safeAssert(command?.commandId, "the written letter effect has a RunFile command identity");
    await firstManager.processLogLine(`VOTC:RUN_ACK/LETTER_EFFECT/${command.commandId}`);
    assert.equal(firstManager.getLetterStatus(LETTER_ID).responseStatus, "effect_file_written");
    assert.equal(fixture.summaryCalls.length, 0, "RUN_ACK alone cannot start letter archival");
    assert.equal(firstManager.awaitingAcceptanceLetterId, LETTER_ID);

    const secondLetter = { letterId: "letter_archive_2", content: "请代为保存玉佩。", totalDays: 100, delay: 3 };
    pendingLetter(fixture, firstManager, secondLetter, "玉佩已保存。", 103);
    const restoredManager = fixture.createManager();
    restoredManager.currentTotalDays = 103;
    assert.equal(restoredManager.awaitingAcceptanceLetterId, LETTER_ID, "the active acceptance lock survives restart");
    assert.equal(restoredManager.storedLetters.get(LETTER_ID).receiptToken, receiptToken,
      "the receipt token survives restart without generating a new delivery");
    assert.equal(hash(restoredManager.storedLetters.get(LETTER_ID).sourceMemoryContext),
      hash(stored.sourceMemoryContext), "the original participant and relationship snapshot survives restart");
    await restoredManager.checkAndDeliverLetters();
    assert.equal(fixture.effectWrites, 1, "restoring a written effect does not redeliver it");

    const otherLetter = { letterId: "letter_current_other", content: "当前日志中的另一封信。", totalDays: 103, delay: 0 };
    fixture.setParsedGameData(fixture.makeGameData({ totalDays: 103, date: "1038年4月4日",
      aiID: 3, npcName: "新人物", letterData: otherLetter }));
    const parseCallsBeforeReceipt = fixture.parseCalls;
    const baseReceipt = { token: receiptToken };
    const invalidReceipts = [
      { ...baseReceipt, letterId: "letter_archive_old" },
      { ...baseReceipt, token: "0".repeat(32) },
      { ...baseReceipt, campaignToken: OTHER_CAMPAIGN },
      { ...baseReceipt, playerId: 99 },
      { ...baseReceipt, aiId: 3 },
      { ...baseReceipt, totalDays: 102 },
      { ...baseReceipt, date: "1038.3.31" }
    ];
    for (const receipt of invalidReceipts) {
      const result = await restoredManager.processLogLine(makeReceiptLine(receipt));
      assert.equal(result?.success, false, "invalid or stale receipt is rejected");
      assert.equal(restoredManager.awaitingAcceptanceLetterId, LETTER_ID);
      assert.equal(restoredManager.getLetterStatus(LETTER_ID).responseStatus, "effect_file_written");
      assert.equal(fixture.summaryCalls.length, 0);
      assert.equal(fixture.effectWrites, 1);
    }
    assert.equal(fixture.parseCalls, parseCallsBeforeReceipt,
      "invalid receipts are rejected before consulting the current log parser");
    const bareClipboard = await restoredManager.clearLettersFile();
    assert.equal(bareClipboard?.success, false, "new tokenized letters reject a legacy bare acceptance callback");
    assert.equal(restoredManager.awaitingAcceptanceLetterId, LETTER_ID);

    const accepted = await restoredManager.processLogLine(makeReceiptLine({ ...baseReceipt,
      date: "1038年4月4日", prefix: "[debug_log: 2026-10-08 12:00:00] " }));
    assert.deepEqual(accepted, { success: true, letterId: LETTER_ID }, "the accepted receipt is processed through LetterManager");
    assert.equal(fixture.effectWrites, 2, "accepting the first letter may dispatch the next due letter exactly once");
    assert.equal(restoredManager.awaitingAcceptanceLetterId, secondLetter.letterId);
    assert.equal(restoredManager.getLetterStatus(LETTER_ID).responseStatus, "sent");

    assert.equal(fixture.runFileManager.getPendingCommands().filter(row => row.kind === "date_producer_rearm").length, 0,
      "native date bridge waiting does not enqueue a legacy RunFile rearm command");
    const secondCommand = fixture.runFileManager.getPendingCommands().find(row => row.kind === "letter_effect");
    safeAssert(secondCommand?.commandId, "the second letter is independently queued");
    await restoredManager.processLogLine(`VOTC:RUN_ACK/LETTER_EFFECT/${secondCommand.commandId}`);
    const duplicateOldReceipt = await restoredManager.processLogLine(makeReceiptLine(baseReceipt));
    assert.equal(duplicateOldReceipt?.success, false, "a duplicate receipt cannot accept the next letter");
    assert.equal(restoredManager.awaitingAcceptanceLetterId, secondLetter.letterId);
    assert.equal(restoredManager.getLetterStatus(secondLetter.letterId).responseStatus, "effect_file_written");
    assert.equal(fixture.effectWrites, 2, "duplicate receipt does not replay either effect");
    assert.equal(fixture.summaryCalls.length, 1, "the first accepted archive starts once and the duplicate starts nothing");

    await waitFor(() => restoredManager.getLetterStatus(LETTER_ID).summaryStatus === "generation_failed",
      "the controlled first summary request should fail");
    assert.equal(restoredManager.getLetterStatus(LETTER_ID).responseStatus, "sent",
      "summary failure does not undo game receipt");
    const retry = await fixture.archive.retryPending({ activeCampaignToken: CAMPAIGN, manual: true });
    safeAssert(retry.some(row => row.status === "COMPLETE"),
      `accepted memory finalization recovers from its durable job: ${JSON.stringify(retry.map(row => ({
        status: row.status, errorCode: row.errorCode, ownerStatuses: row.ownerStatuses
      })))}`);
    assert.equal(fixture.effectWrites, 2, "retrying the accepted archive does not write another Effect");
    assert.equal(fixture.summaryCalls.length, 2, "only the failed summary request is retried");
    assert.deepEqual(fixture.durableOwners.slice().sort((a, b) => a - b), [1, 2],
      "both letter owners receive durable Memory4 extraction");

    const recoveryFiles = fs.readdirSync(fixture.memoryEngine.store.paths.memory4Recovery)
      .filter(name => /^letter_[a-f0-9]{64}\.json$/.test(name));
    assert.equal(recoveryFiles.length, 1, "one accepted letter creates one durable archive job");
    const jobId = recoveryFiles[0].slice("letter_".length, -".json".length);
    const job = fixture.archive.readJob(jobId);
    assert.equal(hash(job.context.text), hash(originalLetter.content), "the archive uses the original letter text");
    assert.equal(hash(job.context.reply), hash(REPLY_TEXT), "the archive uses the generated reply");
    assert.equal(job.context.acceptedDate, "1038.4.4");
    assert.equal(job.context.acceptedTotalDays, 103);
    assert.equal(job.context.participantProfiles.find(row => row.id === 2).shortName, "李师师",
      "current-log character changes do not replace source participant profiles");
    assert(job.context.relationshipEvidence.some(row => row.ownerId === 1 && row.entityId === 2
      && row.types.includes("spouse") && row.asOf === "1038.4.1"),
    "the archived relationship evidence keeps its source date and owner scope");
    assert.equal(fixture.summaryCalls.length, 2);
    safeAssert(JSON.stringify(fixture.summaryCalls[1]).includes(originalLetter.content)
      && JSON.stringify(fixture.summaryCalls[1]).includes(REPLY_TEXT),
    "the accepted summary prompt contains the original exchange");
    safeAssert(!JSON.stringify(job.context.participantProfiles).includes("新人物"),
      "unrelated current-log profiles are excluded from the accepted snapshot");

    const profiles = job.context.participantProfiles;
    const byId = new Map(profiles.map(profile => [profile.id, profile]));
    const directedFiles = [
      path.join(fixture.summariesDir,
        memorySystem.getCharacterStorageDirectoryName(byId.get(1), byId.get(1).shortName),
        `与${memorySystem.getCharacterPersonalName(byId.get(2), byId.get(2).shortName)}的对话.json`),
      path.join(fixture.summariesDir,
        memorySystem.getCharacterStorageDirectoryName(byId.get(2), byId.get(2).shortName),
        `与${memorySystem.getCharacterPersonalName(byId.get(1), byId.get(1).shortName)}的对话.json`)
    ];
    for (let index = 0; index < directedFiles.length; index++) {
      const rows = JSON.parse(fs.readFileSync(directedFiles[index], "utf8"));
      assert.equal(rows.length, 1, "each character has exactly one directed letter summary");
      assert.equal(rows[0].campaignToken, CAMPAIGN);
      assert.equal(rows[0].finalizationId, job.finalizationId);
      assert.equal(rows[0].sourceLetterId, LETTER_ID);
      assert.deepEqual(rows[0].participants.map(person => person.id).sort((a, b) => a - b), [1, 2]);
      assert.equal(rows[0].playerId, index === 0 ? 1 : 2, "each summary file preserves its owner perspective");
    }

    const ownerStatuses = new Map(fixture.archive.result(job).ownerStatuses.map(row => [row.ownerId, row]));
    for (const ownerId of [1, 2]) {
      const scope = { campaignToken: CAMPAIGN, ownerId };
      const index = fixture.memoryEngine.memory4.store.loadIndex(scope);
      const committed = index.finalizations[hash(job.finalizationId)];
      safeAssert(!!committed && committed.entryIds.length === 1, "each owner has one committed canonical letter memory");
      const entry = fixture.memoryEngine.memory4.store.readEntry(scope, committed.entryIds[0], index);
      assert.deepEqual(entry.evidence.visibilityEvidence, ["validated_letter"]);
      assert.deepEqual(entry.evidence.knownBy, [1, 2]);
      assert.equal(ownerStatuses.get(ownerId).status, "STORE");
      assert.equal(ownerStatuses.get(ownerId).derivedStatus, "COMPLETE");
      const year = fixture.memoryEngine.memory4.derived.read(scope, "year", 1038);
      const life = fixture.memoryEngine.memory4.derived.read(scope, "life");
      safeAssert(year?.items.length > 0 && life?.segments.length > 0,
        "both owners receive year and life derived views from accepted letter evidence");
      assert.equal(fixture.memoryEngine.memory4.derived.list(scope).dirty, false);
    }
  } finally {
    await fixture.close();
  }
}

async function testLegacyClipboardAcceptanceRemainsSupported() {
  const fixture = createFixture();
  try {
    const { manager } = fixture;
    const legacyLetter = { letterId: "legacy_letter_1", content: "旧版信件内容。", totalDays: 100, delay: 3 };
    const binding = manager.buildLetterDisclosureBinding(fixture.sourceGameData, legacyLetter);
    safeAssert(!!binding, "legacy fixture binding validates");
    manager.createLetterStatus(legacyLetter, "李师师");
    manager.updateLetterStatus(legacyLetter.letterId, {
      responseStatus: "effect_file_written", effectFileWrittenAt: Date.now(), effectTransportMode: "votc_run_file"
    });
    manager.storedLetters.set(legacyLetter.letterId, {
      letter: legacyLetter, reply: "旧版回信。", expectedDeliveryDay: 103, disclosureBinding: binding
    });
    manager.awaitingAcceptanceLetterId = legacyLetter.letterId;
    fixture.memoryEngine.letterMemoryFinalization = null;

    const result = await manager.clearLettersFile();
    assert.deepEqual(result, { success: true, letterId: legacyLetter.letterId }, "legacy acceptance remains handled by the prior callback contract");
    assert.equal(manager.getLetterStatus(legacyLetter.letterId).responseStatus, "sent");
    assert.equal(manager.awaitingAcceptanceLetterId, null);
    assert.equal(manager.storedLetters.has(legacyLetter.letterId), false);
  } finally {
    await fixture.close();
  }
}

async function testHeadBaselineDoesNotAcceptNewReceiptProtocol() {
  const fixture = createFixture({ letterManagerFactory: loadHeadLetterManagerFactory() });
  try {
    const { manager, originalLetter } = fixture;
    const disclosureBinding = manager.buildLetterDisclosureBinding(fixture.sourceGameData, originalLetter);
    safeAssert(!!disclosureBinding, "HEAD fixture source binding validates");
    manager.createLetterStatus(originalLetter, "李师师");
    manager.updateLetterStatus(LETTER_ID, {
      responseStatus: "effect_file_written", effectFileWrittenAt: Date.now(), effectTransportMode: "votc_run_file"
    });
    manager.storedLetters.set(LETTER_ID, {
      letter: originalLetter, reply: REPLY_TEXT, expectedDeliveryDay: 103, characterName: "李师师",
      disclosureBinding, receiptToken: "a".repeat(32),
      sourceMemoryContext: { participantProfiles: [], relationshipEvidence: [] }
    });
    manager.awaitingAcceptanceLetterId = LETTER_ID;
    manager.savePendingLetters();

    await manager.processLogLine(makeReceiptLine({ token: "a".repeat(32), date: "1038年4月4日",
      prefix: "[debug_log: baseline] " }));
    assert.equal(manager.awaitingAcceptanceLetterId, LETTER_ID,
      "pre-patch HEAD ignores the receipt marker and leaves acceptance pending");
    assert.equal(manager.getLetterStatus(LETTER_ID).responseStatus, "effect_file_written");
    assert.equal(fixture.summaryCalls.length, 0, "pre-patch HEAD cannot archive from the new receipt protocol");
    assert.equal(fixture.effectWrites, 0, "the baseline receipt cannot trigger a second Effect");
  } finally {
    await fixture.close();
  }
}

async function waitFor(predicate, message, timeoutMs = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error(message);
}

async function main() {
  await testReceiptArchiveRetryAndIsolation();
  await testHeadBaselineDoesNotAcceptNewReceiptProtocol();
  await testLegacyClipboardAcceptanceRemainsSupported();
  console.log("V8.15.2 letter archive independent QA: PASS (receipt binding, in-memory HEAD baseline, restart, stale/duplicate isolation, real directed summaries, both Memory4 owners and derived views, retry without redelivery, legacy callback)");
}

module.exports = { createFixture, pendingLetter, makeReceiptLine, waitFor };
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
