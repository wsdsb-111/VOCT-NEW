"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createRunFileManager } = require("../resources/app/out/main/actions/run-file-manager");
const { createLetterEffectTransport } = require("../resources/app/out/main/letters/letter-effect-transport");
const { createLetterManager } = require("../resources/app/out/main/letters/letter-manager");

(async () => {
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v8142-letter-incident-"));
try {
  const ck3Dir = path.join(tempDir, "ck3");
  const dataDir = path.join(tempDir, "data");
  const runDir = path.join(ck3Dir, "run");
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, "votc.txt"), "", "utf8");
  let active = true;
  const settingsRepository = {
    getCK3UserFolderPath: () => active ? ck3Dir : null,
    getCK3DebugLogPath: () => null,
    getSummaryPromptSettings: () => ({ letterSummaryPrompt: "summary" })
  };
  const RunFileManager = createRunFileManager({ settingsRepository, fs, path, dataDir });
  const runFileManager = new RunFileManager();
  runFileManager.initializeAfterAckReconciliation();
  const { LetterEffectTransport } = createLetterEffectTransport({ settingsRepository, fs, path, runFileManager, dataDir });
  const letterEffectTransport = new LetterEffectTransport();
  const { LetterManager } = createLetterManager({
    settingsRepository,
    fs,
    path,
    TailFile: class {},
    readline: {},
    parseLog: async () => null,
    letterPromptBuilder: {},
    llmManager: {},
    PromptBuilder: {},
    TokenCounter: {},
    memoryEngine: {},
    dataDir,
    letterEffectTransport,
    runFileManager,
    autoStartLogTailing: false,
    setIntervalFn: () => ({ unref() {} }),
    clearIntervalFn: () => {}
  });
  const manager = new LetterManager();
  manager.currentTotalDays = 10;
  const letter = { letterId: "letter_1", content: "请回信", totalDays: 10, delay: 0 };
  const nextLetter = { letterId: "letter_2", content: "再报平安", totalDays: 10, delay: 0 };

  const blocker = runFileManager.enqueueCommand({
    commandId: "prior_action",
    owner: "action",
    kind: "action_effect",
    effectText: "add_gold = 1"
  });
  manager.createLetterStatus(letter, "NPC");
  manager.storedLetters.set(letter.letterId, {
    letter,
    reply: "平安无事。",
    expectedDeliveryDay: 10,
    characterName: "NPC"
  });
  manager.createLetterStatus(nextLetter, "NPC");
  manager.storedLetters.set(nextLetter.letterId, {
    letter: nextLetter,
    reply: "第二封回信。",
    expectedDeliveryDay: 10,
    characterName: "NPC"
  });
  manager.savePendingLetters();
  assert.strictEqual((await manager.writeLetterEffect("平安无事。", letter)), true);

  const queuedStatus = manager.getLetterStatus(letter.letterId);
  assert.strictEqual(queuedStatus.responseStatus, "pending_delivery");
  assert.strictEqual(queuedStatus.runCommandStatus, "queued");
  assert.strictEqual(manager.awaitingAcceptanceLetterId, letter.letterId);
  const queuedText = fs.readFileSync(path.join(runDir, "votc.txt"), "utf8");
  assert(!queuedText.includes("平安无事。"), "queued letter must not be considered written in the active carrier");

  const earlyAcceptance = await manager.clearLettersFile();
  assert.strictEqual(earlyAcceptance.reason, "letter_effect_not_written", "an unrelated popup must not accept a queued Letter Effect");
  assert.strictEqual(manager.getLetterStatus(letter.letterId).responseStatus, "pending_delivery");
  assert.strictEqual(manager.storedLetters.has(letter.letterId), true, "early acceptance must preserve the retryable letter payload");
  assert.strictEqual(manager.storedLetters.has(nextLetter.letterId), true, "early acceptance must not advance a later letter into the shared carrier");
  assert.strictEqual(manager.awaitingAcceptanceLetterId, letter.letterId, "early acceptance must preserve the queued delivery lock");
  assert.strictEqual(runFileManager.getPendingCommands().length, 2, "early acceptance must not consume either queued command");
  assert(!runFileManager.getPendingCommands().some((command) => command.effectText.includes("第二封回信。")));

  await manager.processLogLine(`VOTC:RUN_ACK/ACTION_EFFECT/${blocker.commandId}`);
  const dispatchedStatus = manager.getLetterStatus(letter.letterId);
  assert.strictEqual(dispatchedStatus.responseStatus, "effect_file_written", "ACK of the earlier command must dispatch the queued letter");
  assert(Number(dispatchedStatus.effectFileWrittenAt) > 0);
  assert(fs.readFileSync(path.join(runDir, "votc.txt"), "utf8").includes("平安无事。"));
  await manager.processLogLine(`VOTC:RUN_ACK/LETTER_EFFECT/${dispatchedStatus.runCommandId}`);

  await manager.clearLettersFile();
  assert.strictEqual(manager.getLetterStatus(letter.letterId).responseStatus, "sent");
  assert.strictEqual(manager.storedLetters.has(letter.letterId), false);
  assert.strictEqual(manager.getLetterStatus(nextLetter.letterId).responseStatus, "effect_file_written");
  assert(fs.readFileSync(path.join(runDir, "votc.txt"), "utf8").includes("第二封回信。"), "the next letter must dispatch only after the active letter is accepted");

  const originalNow = Date.now;
  let fakeNow = 1_800_000_000_000;
  Date.now = () => fakeNow;
  try {
    const dateCk3Dir = path.join(tempDir, "date-ck3");
    const dateDataDir = path.join(tempDir, "date-data");
    const dateRunDir = path.join(dateCk3Dir, "run");
    const dateDebugLogPath = path.join(dateCk3Dir, "logs", "debug.log");
    fs.mkdirSync(dateRunDir, { recursive: true });
    fs.mkdirSync(path.dirname(dateDebugLogPath), { recursive: true });
    fs.writeFileSync(path.join(dateRunDir, "votc.txt"), "", "utf8");
    fs.writeFileSync(dateDebugLogPath, "VOTC:DATE/;/100\n", "utf8");
    const dateSettingsRepository = {
      getCK3UserFolderPath: () => dateCk3Dir,
      getCK3DebugLogPath: () => dateDebugLogPath,
      getSummaryPromptSettings: () => ({ letterSummaryPrompt: "summary" })
    };
    const DateRunFileManager = createRunFileManager({ settingsRepository: dateSettingsRepository, path, fs, dataDir: dateDataDir, now: () => fakeNow });
    const dateRunFileManager = new DateRunFileManager();
    dateRunFileManager.initializeAfterAckReconciliation();
    const { LetterManager: DateLetterManager } = createLetterManager({
      settingsRepository: dateSettingsRepository,
      fs,
      path,
      TailFile: class {},
      readline: { createInterface: () => ({ on() {}, close() {} }) },
      parseLog: async () => null,
      letterPromptBuilder: {},
      llmManager: {},
      PromptBuilder: {},
      TokenCounter: {},
      memoryEngine: {},
      dataDir: dateDataDir,
      runFileManager: dateRunFileManager,
      autoStartLogTailing: false,
      dateStaleMs: 20_000,
      setIntervalFn: () => ({ unref() {} }),
      clearIntervalFn: () => {}
    });
    const dateManager = new DateLetterManager();
    dateManager.tailState = "ACTIVE";
    dateManager.currentTotalDays = 100;
    dateManager.lastObservedDateValue = 100;
    dateManager.lastObservedDateMarkerAt = fakeNow - 30_000;
    const pendingLetter = { letterId: "letter_long_pending", content: "请回信", totalDays: 100, delay: 30 };
    dateManager.createLetterStatus(pendingLetter, "NPC");
    dateManager.updateLetterStatus(pendingLetter.letterId, { responseStatus: "pending_delivery" });
    dateManager.storedLetters.set(pendingLetter.letterId, {
      letter: pendingLetter,
      reply: "回信内容",
      expectedDeliveryDay: 130,
      characterName: "NPC"
    });
    dateManager.awaitingAcceptanceLetterId = "already_accepted_letter";
    dateManager.letterStatuses.set("already_accepted_letter", { letterId: "already_accepted_letter", responseStatus: "sent" });
    dateManager.savePendingLetters();

    await dateManager.runDateTrackerHeartbeat();
    const firstRearm = dateRunFileManager.getPendingCommands()[0];
    assert.strictEqual(firstRearm.kind, "date_producer_rearm");
    assert.strictEqual(firstRearm.status, "awaiting_ack");
    assert.strictEqual(firstRearm.writeAttempts, 1);
    await dateManager.processLogLine(`VOTC:DATE_PRODUCER/BLOCKED/${firstRearm.commandId}`);
    await dateManager.processLogLine(`VOTC:RUN_ACK/DATE_PRODUCER_REARM/${firstRearm.commandId}`);
    assert.strictEqual(dateManager.awaitingAcceptanceLetterId, "already_accepted_letter", "an old acceptance lock must not be cleared by unrelated date recovery");

    fakeNow += 20_001;
    await dateManager.runDateTrackerHeartbeat();
    const secondRearm = dateRunFileManager.getPendingCommands()[0];
    assert.notStrictEqual(secondRearm.commandId, firstRearm.commandId, "no fresh DATE after a blocked ACK must schedule a new date rearm");
    assert.strictEqual(secondRearm.kind, "date_producer_rearm");
    assert.strictEqual(secondRearm.writeAttempts, 1, "date recovery must not replay an already-dispatched command");

    fakeNow += 30_001;
    dateManager.runCommandWatchdog();
    assert.strictEqual(dateRunFileManager.getPendingCommands().length, 0, "expired date rearm must be quarantined and removed");
    assert.strictEqual(dateRunFileManager.getRecentCommands().find(command => command.commandId === secondRearm.commandId).status, "quarantined");
    assert.strictEqual(fs.readFileSync(path.join(dateRunDir, "votc.txt"), "utf8"), "", "quarantine must neutralize only the expired matching date command");

    fakeNow += 20_001;
    await dateManager.runDateTrackerHeartbeat();
    const thirdRearm = dateRunFileManager.getPendingCommands()[0];
    assert.notStrictEqual(thirdRearm.commandId, secondRearm.commandId, "a long-future pending letter must keep requesting date recovery after safe quarantine");
    assert.strictEqual(thirdRearm.kind, "date_producer_rearm");
    assert.strictEqual(thirdRearm.writeAttempts, 1);
    assert.strictEqual(dateManager.getLetterStatus(pendingLetter.letterId).responseStatus, "pending_delivery");
    assert.strictEqual(dateManager.awaitingAcceptanceLetterId, "already_accepted_letter", "the old acceptance lock may block delivery but not date re-arming");

    await dateManager.processLogLine(`VOTC:DATE_PRODUCER/REARMED/${thirdRearm.commandId}`);
    await dateManager.processLogLine(`VOTC:RUN_ACK/DATE_PRODUCER_REARM/${thirdRearm.commandId}`);
    await dateManager.processLogLine("VOTC:DATE/;/500");
    assert.strictEqual(dateManager.currentTotalDays, 500, "a fresh DATE marker must catch up a letter beyond its due day");
    assert.strictEqual(dateManager.storedLetters.has(pendingLetter.letterId), true, "a stale acceptance lock may block delivery without blocking date receipt");
    assert.strictEqual(dateManager.getDateTrackerStatus().dateProducerRecovery.status, "RECOVERED");
    const deliveredAfterUnlock = [];
    dateManager.awaitingAcceptanceLetterId = null;
    dateManager.deliverLetter = async storedLetter => {
      deliveredAfterUnlock.push(storedLetter.letter.letterId);
      dateManager.updateLetterStatus(storedLetter.letter.letterId, { responseStatus: "effect_file_written" });
      return true;
    };
    await dateManager.updateCurrentDate(501);
    assert.deepStrictEqual(deliveredAfterUnlock, [pendingLetter.letterId], "the overdue letter must deliver after the lock is cleared and fresh game time arrives");
    assert.strictEqual(dateManager.getLetterStatus(pendingLetter.letterId).responseStatus, "effect_file_written");
  } finally {
    Date.now = originalNow;
  }

  console.log("VOTC v8.14.2 Letter Delivery Incident: PASS (acceptance guard, persistent date re-arm after ACK/TTL, overdue catch-up)");
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
