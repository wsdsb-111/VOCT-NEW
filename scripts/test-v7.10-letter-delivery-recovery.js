"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createRunFileManager } = require("../resources/app/out/main/actions/run-file-manager");
const { createLetterEffectTransport } = require("../resources/app/out/main/letters/letter-effect-transport");
const { createLetterManager } = require("../resources/app/out/main/letters/letter-manager");

function createFixture(options = {}) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v710-letter-"));
  const ck3Dir = path.join(tempDir, "ck3");
  const dataDir = path.join(tempDir, "data");
  const debugLogPath = path.join(ck3Dir, "logs", "debug.log");
  fs.mkdirSync(path.join(ck3Dir, "run"), { recursive: true });
  fs.writeFileSync(path.join(ck3Dir, "run", "votc.txt"), "", "utf8");
  fs.mkdirSync(path.dirname(debugLogPath), { recursive: true });
  fs.writeFileSync(debugLogPath, "", "utf8");
  let active = false;
  let parsedContext = options.parsedContext || null;
  const summaryCalls = [];
  const replyCalls = [];
  const memoryRecords = [];
  const settingsRepository = {
      getCK3UserFolderPath: () => active ? ck3Dir : null,
      getCK3DebugLogPath: () => active ? debugLogPath : null,
      getSummaryPromptSettings: () => ({ letterSummaryPrompt: "概括来信和回信。" })
  };
  const RunFileManager = createRunFileManager({ settingsRepository, fs, path, dataDir });
  const runFileManager = new RunFileManager();
  runFileManager.initializeAfterAckReconciliation();
  const { LetterEffectTransport } = createLetterEffectTransport({ settingsRepository, fs, path, runFileManager, dataDir });
  const letterEffectTransport = new LetterEffectTransport();
  const dependencies = {
    settingsRepository,
    fs,
    path,
    TailFile: class {
      on() { return this; }
      async start() {}
      async quit() {}
    },
    readline: { createInterface: () => ({ on() {}, close() {} }) },
    parseLog: async () => parsedContext,
    letterPromptBuilder: {
      buildMessages: () => [{ role: "user", content: "请回信" }],
      buildPreview: () => ({ messages: [] })
    },
    llmManager: {
      sendChatRequest: async (...args) => { replyCalls.push(args); return { content: options.reply || "一切安好。" }; },
      sendSummaryRequest: async (...args) => {
        summaryCalls.push(args);
        if (options.summaryFailure) throw new Error("summary unavailable");
        return { content: "来信与回信摘要。" };
      }
    },
    PromptBuilder: {},
    TokenCounter: { estimateMessageTokens: () => 1 },
    memoryEngine: { recordLetterMemory: (entry) => memoryRecords.push(entry) },
    dataDir,
    letterEffectTransport,
    runFileManager,
    sleep: async () => {},
    letterPayloadRetryDelays: []
  };
  const api = createLetterManager(dependencies);
  const createManager = () => new api.LetterManager();
  return {
    ...api,
    ck3Dir,
    dataDir,
    debugLogPath,
    summaryCalls,
    replyCalls,
    memoryRecords,
    runFileManager,
    createManager,
    activate: () => { active = true; },
    deactivate: () => { active = false; },
    setParsedContext: (context) => { parsedContext = context; },
    effectPath: path.join(ck3Dir, "run", "votc.txt"),
    pendingPath: path.join(dataDir, "pending-letters.json"),
    cleanup: () => fs.rmSync(tempDir, { recursive: true, force: true })
  };
}

async function acknowledgeWrittenEffect(manager, letterId) {
  const commandId = manager.getLetterStatus(letterId)?.runCommandId;
  assert(commandId, `missing Run Command ID for ${letterId}`);
  await manager.processLogLine(`VOTC:RUN_ACK/LETTER_EFFECT/${commandId}`);
}

async function acknowledgeDateRecoveryCommands(manager, runFileManager) {
  while (runFileManager.getPendingCommands()[0]?.kind === "date_producer_rearm") {
    const command = runFileManager.getPendingCommands()[0];
    await manager.processLogLine(`VOTC:DATE_PRODUCER/REARMED/${command.commandId}`);
    await manager.processLogLine(`VOTC:RUN_ACK/DATE_PRODUCER_REARM/${command.commandId}`);
  }
}

function makeLetter(id, totalDays, delay, content = "测试来信") {
  return { letterId: id, totalDays, delay, content };
}

function storeLetter(manager, letter, reply, characterName = "李师师") {
  manager.createLetterStatus(letter, characterName);
  manager.storedLetters.set(letter.letterId, {
    letter,
    reply,
    expectedDeliveryDay: letter.totalDays + letter.delay,
    characterName
  });
  manager.savePendingLetters();
}

function assertOfficialEffect(effect, letterId, escapedReply) {
  assert(effect.includes(`remove_global_variable ?= votc_${letterId}`));
  assert(effect.includes("create_artifact = {"));
  assert(effect.includes(`description = "${escapedReply}"`));
  assert(effect.includes("save_scope_as = votc_latest_letter"));
  assert(effect.includes("set_variable = { name = votc_letter_artifact value = yes}"));
  assert(effect.includes("name = votc_latest_letter"));
  assert(effect.includes("value = scope:votc_latest_letter"));
  assert(effect.includes("trigger_event = message_event.362"));
}

async function testDelay(delay) {
  const fixture = createFixture();
  try {
    const manager = fixture.createManager();
    fixture.activate();
    const letter = makeLetter(`letter_delay_${delay}`, 100, delay);
    storeLetter(manager, letter, `延迟${delay}日回信`);
    await manager.updateCurrentDate(100 + Math.max(0, delay - 1));
    if (delay > 0) {
      assert.strictEqual(manager.awaitingAcceptanceLetterId, null, `delay=${delay} must remain pending before its delivery day`);
    }
    await manager.updateCurrentDate(100 + delay);
    assert.strictEqual(manager.awaitingAcceptanceLetterId, letter.letterId);
    assert.strictEqual(manager.storedLetters.size, 1, "effect write is not equivalent to CK3 acceptance");
    assertOfficialEffect(fs.readFileSync(fixture.effectPath, "utf8"), letter.letterId, `延迟${delay}日回信`);
    assert.strictEqual(manager.getLetterStatus(letter.letterId).responseStatus, fixture.LetterResponseStatus.EFFECT_FILE_WRITTEN);
    await acknowledgeWrittenEffect(manager, letter.letterId);
    await manager.clearLettersFile();
    assert.strictEqual(manager.getLetterStatus(letter.letterId).responseStatus, fixture.LetterResponseStatus.SENT);
    assert.strictEqual(manager.storedLetters.size, 0);
  } finally {
    fixture.cleanup();
  }
}

async function testDateAndEscaping() {
  const longText = `她说："请珍重"。${"山河无恙，静候佳音。".repeat(80)}`;
  const fixture = createFixture();
  try {
    const manager = fixture.createManager();
    fixture.activate();
    const letter = makeLetter("letter_quotes", 200, 1);
    storeLetter(manager, letter, longText);
    const beforeDeliveryDiagnostics = manager.getAllLetterStatuses();
    assert.strictEqual(beforeDeliveryDiagnostics.awaitingAcceptanceLetterId, null);
    assert.strictEqual(beforeDeliveryDiagnostics.effectFileExists, true, "diagnostics inspect the existing formal RunFile carrier");
    assert(Number.isFinite(beforeDeliveryDiagnostics.effectFileAge));
    assert.strictEqual(beforeDeliveryDiagnostics.inspectedEffectFilePath, fixture.effectPath);
    assert.strictEqual(beforeDeliveryDiagnostics.effectPayloadPresent, false, "an idle formal carrier is not a Letter Effect");
    assert.strictEqual(beforeDeliveryDiagnostics.storedLettersCount, 1);
    fs.appendFileSync(fixture.debugLogPath, "[debug] VOTC:DATE/;/201\n", "utf8");
    await manager.processLogLine("[debug] VOTC:DATE/;/201");
    assert.strictEqual(manager.getCurrentTotalDays(), 201);
    assert(Number.isFinite(manager.lastDateLogReceivedAt));
    const effect = fs.readFileSync(fixture.effectPath, "utf8");
    assertOfficialEffect(effect, letter.letterId, longText.replace(/"/g, '\\"'));
    assert(effect.includes("山河无恙，静候佳音。".repeat(80)), "long reply must not be truncated");
    const deliveryDiagnostics = manager.getAllLetterStatuses();
    assert.strictEqual(deliveryDiagnostics.awaitingAcceptanceLetterId, letter.letterId);
    assert.strictEqual(deliveryDiagnostics.effectFileExists, true);
    assert(Number.isFinite(deliveryDiagnostics.effectFileAge) && deliveryDiagnostics.effectFileAge >= 0);
    assert.strictEqual(deliveryDiagnostics.lastDateLogReceivedAt, manager.lastDateLogReceivedAt);
    assert.strictEqual(deliveryDiagnostics.storedLettersCount, 1);
  } finally {
    fixture.cleanup();
  }
}

async function testRestartAndNoDuplicate() {
  const fixture = createFixture();
  try {
    const first = fixture.createManager();
    fixture.activate();
    const letter = makeLetter("letter_restart", 300, 0);
    storeLetter(first, letter, "重启恢复回信");
    await first.updateCurrentDate(300);
    const firstEffect = fs.readFileSync(fixture.effectPath, "utf8");
    fixture.deactivate();
    const restarted = fixture.createManager();
    assert.strictEqual(restarted.awaitingAcceptanceLetterId, letter.letterId);
    assert.strictEqual(restarted.storedLetters.size, 1);
    fixture.activate();
    await restarted.updateCurrentDate(301);
    assert.strictEqual(fs.readFileSync(fixture.effectPath, "utf8"), firstEffect, "restart must not write a duplicate effect while awaiting CK3 acceptance");
    await acknowledgeWrittenEffect(restarted, letter.letterId);
    await restarted.clearLettersFile();
    const state = JSON.parse(fs.readFileSync(fixture.pendingPath, "utf8"));
    assert.strictEqual(state.version, 4);
    assert.strictEqual(state.awaitingAcceptanceLetterId, null);
    assert.strictEqual(state.letters.length, 0);
    assert.deepStrictEqual(state.failedLetters, []);
  } finally {
    fixture.cleanup();
  }
}

async function testTwoLettersAreSerialized() {
  const fixture = createFixture();
  try {
    const manager = fixture.createManager();
    fixture.activate();
    const first = makeLetter("letter_first", 400, 0);
    const second = makeLetter("letter_second", 400, 0);
    storeLetter(manager, first, "第一封回信");
    storeLetter(manager, second, "第二封回信");
    await manager.updateCurrentDate(400);
    assert.strictEqual(manager.awaitingAcceptanceLetterId, first.letterId);
    assert(fs.readFileSync(fixture.effectPath, "utf8").includes("第一封回信"));
    assert.strictEqual(manager.storedLetters.size, 2);
    await acknowledgeWrittenEffect(manager, first.letterId);
    await manager.clearLettersFile();
    assert.strictEqual(manager.awaitingAcceptanceLetterId, second.letterId);
    assert(fs.readFileSync(fixture.effectPath, "utf8").includes("第二封回信"));
    assert.strictEqual(manager.storedLetters.size, 1);
    await acknowledgeWrittenEffect(manager, second.letterId);
    await manager.clearLettersFile();
    assert.strictEqual(manager.awaitingAcceptanceLetterId, null);
    assert.strictEqual(manager.storedLetters.size, 0);
  } finally {
    fixture.cleanup();
  }
}

async function testQueuedEffectIsNotReportedAsWritten() {
  const fixture = createFixture();
  try {
    const manager = fixture.createManager();
    fixture.activate();
    const blocker = fixture.runFileManager.enqueueCommand({
      owner: "test",
      kind: "action_effect",
      commandId: "letter_queue_blocker",
      effectText: "add_gold = 1"
    });
    const letter = makeLetter("letter_queued_effect", 450, 0);
    storeLetter(manager, letter, "队列中的回信");
    await manager.updateCurrentDate(450);

    let status = manager.getLetterStatus(letter.letterId);
    assert.strictEqual(status.responseStatus, fixture.LetterResponseStatus.PENDING_DELIVERY, "enqueuing behind another command is not a file write");
    assert.strictEqual(status.runCommandStatus, "queued");
    assert.strictEqual(manager.awaitingAcceptanceLetterId, letter.letterId);
    assert(!fs.readFileSync(fixture.effectPath, "utf8").includes("队列中的回信"), "queued letter must not be reported in the active carrier");

    await manager.processLogLine(`VOTC:RUN_ACK/ACTION_EFFECT/${blocker.commandId}`);
    assert(fs.readFileSync(fixture.effectPath, "utf8").includes("队列中的回信"), "ACK must advance the FIFO and dispatch the letter");
    status = manager.getLetterStatus(letter.letterId);
    assert.strictEqual(status.responseStatus, fixture.LetterResponseStatus.EFFECT_FILE_WRITTEN, "dispatching from the FIFO must update the letter status");
    await acknowledgeWrittenEffect(manager, letter.letterId);
    status = manager.getLetterStatus(letter.letterId);
    assert.strictEqual(status.responseStatus, fixture.LetterResponseStatus.EFFECT_FILE_WRITTEN);
    await manager.clearLettersFile();
  } finally {
    fixture.cleanup();
  }
}

function testPolledRunCommandsAreIdempotent() {
  const fixture = createFixture();
  try {
    const dateRearm = fixture.runFileManager.enqueueCommand({
      owner: "letter",
      kind: "date_producer_rearm",
      commandId: "date_rearm_idempotent",
      effectText: 'debug_log = "VOTC:DATE_PRODUCER/REARMED/date_rearm_idempotent"'
    });
    const commandText = fixture.runFileManager.composeCommandText(dateRearm);
    assert(commandText.includes("votc_last_run_command"), "non-action commands need a repeat-poll guard");
    assert(commandText.includes("global_var:votc_last_run_command = flag:date_rearm_idempotent"));
    assert(commandText.includes("VOTC:RUN_ACK/DATE_PRODUCER_REARM/date_rearm_idempotent"));
  } finally {
    fixture.cleanup();
  }
}

async function testCampaignBindingIsSavedForLetterSummary() {
  const fixture = createFixture();
  const savedSummaries = [];
  try {
    const manager = fixture.createManager();
    const gameData = {
      campaignToken: "votc8c-123456789012",
      playerID: 1,
      playerName: "玩家",
      date: "976年5月3日",
      totalDays: 500,
      getAi: () => ({ id: 2, shortName: "李师师", fullName: "东京名伎李师师" }),
      saveCharacterSummary: (characterId, summary) => savedSummaries.push({ characterId, summary })
    };

    assert.strictEqual(await manager.generateSummary(gameData, makeLetter("letter_campaign", 500, 0), "一切安好。"), true);
    assert.strictEqual(savedSummaries[0].summary.campaignToken, gameData.campaignToken);
    assert.deepStrictEqual(savedSummaries[0].summary.campaignBinding, { status: "bound", source: "native", version: 1 });
    assert.strictEqual(fixture.memoryRecords[0].campaignToken, gameData.campaignToken);
    assert.deepStrictEqual(fixture.memoryRecords[0].campaignBinding, { status: "bound", source: "native", version: 1 });
  } finally {
    fixture.cleanup();
  }
}

async function testSummaryFailureDoesNotBlockImmediateDelivery() {
  const letter = makeLetter("letter_summary_failure", 500, 0, "请报平安");
  const ai = { id: 2, shortName: "李师师", fullName: "东京名伎李师师" };
  const gameData = {
    playerID: 1,
    playerName: "玩家",
    date: "976年5月3日",
    totalDays: 500,
    letterData: letter,
    loadCharactersSummaries() {},
    getAi: () => ai,
    saveCharacterSummary() {}
  };
  const fixture = createFixture({ parsedContext: gameData, summaryFailure: true, reply: "即刻回信。" });
  try {
    const manager = fixture.createManager();
    fixture.activate();
    assert.strictEqual(await manager.processLatestLetter(), "即刻回信。");
    assert.strictEqual(manager.awaitingAcceptanceLetterId, letter.letterId, "immediate delivery must occur even when summary generation fails");
    await acknowledgeDateRecoveryCommands(manager, fixture.runFileManager);
    assertOfficialEffect(fs.readFileSync(fixture.effectPath, "utf8"), letter.letterId, "即刻回信。");
    const status = manager.getLetterStatus(letter.letterId);
    assert.strictEqual(status.responseStatus, fixture.LetterResponseStatus.EFFECT_FILE_WRITTEN);
    assert.strictEqual(status.summaryStatus, fixture.LetterSummaryStatus.GENERATION_FAILED);
  } finally {
    fixture.cleanup();
  }
}

async function testOrphanAcceptanceLockRecovery() {
  for (const evidence of ["none", "carrier", "queue", "acknowledged", "written", "history", "missing_history"]) {
    const fixture = createFixture();
    try {
      let manager = fixture.createManager();
      fixture.activate();
      const letter = makeLetter("letter_orphan", 600, 30);
      storeLetter(manager, letter, "待恢复的回信");
      manager.updateLetterStatus(letter.letterId, { responseStatus: fixture.LetterResponseStatus.PENDING_DELIVERY });
      manager.transitionLetter(letter.letterId, fixture.LetterPipelineState.PENDING_DELIVERY);
      manager.awaitingAcceptanceLetterId = letter.letterId;
      if (evidence === "none") {
        manager.savePendingLetters();
        fixture.deactivate();
        manager = fixture.createManager();
        fixture.activate();
      }
      if (evidence === "carrier") fs.writeFileSync(fixture.effectPath, manager.buildOfficialLetterEffectBody("待恢复的回信", letter));
      if (evidence === "queue") {
        fixture.runFileManager.enqueueCommand({ kind: "letter_effect", effectText: manager.buildOfficialLetterEffectBody("待恢复的回信", letter) });
      }
      if (evidence === "acknowledged") {
        const command = fixture.runFileManager.enqueueCommand({ kind: "letter_effect", effectText: manager.buildOfficialLetterEffectBody("待恢复的回信", letter) });
        fixture.runFileManager.ackCommand(command.commandId, "LETTER_EFFECT");
      }
      if (evidence === "written") manager.updateLetterStatus(letter.letterId, { effectFileWrittenAt: 1 });
      if (evidence === "history") manager.transitionLetter(letter.letterId, fixture.LetterPipelineState.EFFECT_FILE_WRITTEN);
      if (evidence === "missing_history") manager.updateLetterStatus(letter.letterId, { pipelineHistory: [] });
      await manager.updateCurrentDate(1000);
      assert.strictEqual(fixture.runFileManager.getPendingCommands().filter(command => command.kind === "letter_effect").length, evidence === "none" || evidence === "queue" ? 1 : 0,
        `orphan recovery must preserve any dispatch evidence (${evidence})`);
      assert.strictEqual(manager.getLetterStatus(letter.letterId).responseStatus,
        evidence === "none" ? fixture.LetterResponseStatus.EFFECT_FILE_WRITTEN : fixture.LetterResponseStatus.PENDING_DELIVERY);
    } finally { fixture.cleanup(); }
  }
}

async function testDuplicatePayloadPreservesDelivery() {
  const letter = makeLetter("letter_duplicate", 700, 0);
  const gameData = { playerID: 1, playerName: "玩家", date: "740.1.1", totalDays: 700, letterData: letter,
    getAi: () => ({ id: 2, fullName: "李师师" }), saveCharacterSummary() {} };
  const fixture = createFixture({ parsedContext: gameData });
  try {
    const manager = fixture.createManager();
    fixture.activate();
    storeLetter(manager, letter, "原有回信");
    await manager.updateCurrentDate(700);
    const originalStatus = manager.getLetterStatus(letter.letterId);
    const originalCarrier = fs.readFileSync(fixture.effectPath, "utf8");
    assert.strictEqual(await manager.processLatestLetter({ skipPayloadRequest: true }), "原有回信");
    assert.strictEqual(fixture.replyCalls.length, 0, "duplicate payload must not regenerate the reply");
    assert.deepStrictEqual(manager.getLetterStatus(letter.letterId), originalStatus, "duplicate payload must preserve dispatch evidence");
    assert.strictEqual(fs.readFileSync(fixture.effectPath, "utf8"), originalCarrier);
    gameData.letterData = { ...letter, totalDays: 701 };
    assert.strictEqual(await manager.processLatestLetter({ skipPayloadRequest: true }), null, "a reused ID with different payload must not overwrite an in-flight letter");
    assert.deepStrictEqual(manager.getLetterStatus(letter.letterId), originalStatus);
  } finally { fixture.cleanup(); }
}

(async () => {
  await testOrphanAcceptanceLockRecovery();
  await testDuplicatePayloadPreservesDelivery();
  await testDelay(0);
  await testDelay(1);
  await testDelay(3);
  await testDateAndEscaping();
  await testRestartAndNoDuplicate();
  await testTwoLettersAreSerialized();
  await testQueuedEffectIsNotReportedAsWritten();
  testPolledRunCommandsAreIdempotent();
  await testCampaignBindingIsSavedForLetterSummary();
  await testSummaryFailureDoesNotBlockImmediateDelivery();
  console.log("VOTC v7.10 Letter Delivery Recovery 2.0: PASS (delay 0/1/3, DATE, diagnostics, escaping, long text, restart, serialization, acceptance and summary independence)");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
