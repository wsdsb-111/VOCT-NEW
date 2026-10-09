"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createRunFileManager } = require("../resources/app/out/main/actions/run-file-manager");
const { createLetterManager } = require("../resources/app/out/main/letters/letter-manager");

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "votc-rc6-rev2-date-"));
const ck3Dir = path.join(tempDir, "ck3");
const dataDir = path.join(tempDir, "data");
const debugLogPath = path.join(ck3Dir, "logs", "debug.log");
const dateFilePath = path.join(ck3Dir, "run", "letters.txt");
fs.mkdirSync(path.dirname(debugLogPath), { recursive: true });
fs.mkdirSync(path.join(ck3Dir, "run"), { recursive: true });
fs.writeFileSync(debugLogPath, "VOTC:DATE/;/419336\n", "utf8");
fs.writeFileSync(path.join(ck3Dir, "run", "votc.txt"), "", "utf8");

class TestTailFile {
  on() {
    return this;
  }
  async start() {}
  async quit() {}
}

const settingsRepository = {
  getCK3UserFolderPath: () => ck3Dir,
  getCK3DebugLogPath: () => debugLogPath,
  getSummaryPromptSettings: () => ({ letterSummaryPrompt: "summary" })
};
const RunFileManager = createRunFileManager({ settingsRepository, path, fs, dataDir });
const runFileManager = new RunFileManager();
runFileManager.initializeAfterAckReconciliation();
const { LetterManager } = createLetterManager({
  settingsRepository, fs, path, TailFile: TestTailFile,
  readline: { createInterface: () => ({ on() {}, close() {} }) },
  parseLog: async () => null, letterPromptBuilder: {}, llmManager: {}, PromptBuilder: {}, TokenCounter: {}, memoryEngine: {},
  dataDir, runFileManager, dateStaleMs: 20,
  setIntervalFn: () => ({ unref() {} }), clearIntervalFn: () => {}
});

(async () => {
  try {
    const manager = new LetterManager();
    await new Promise((resolve) => setImmediate(resolve));
    manager.tailState = "ACTIVE";
    await manager.processLogLine("VOTC:DATE/;/419336");
    const firstProgressAt = manager.lastProgressAt;
    assert.strictEqual(manager.getDateTrackerStatus().dateProducerState, "LIVE");
    assert.strictEqual(manager.getDateTrackerStatus().dateSourceState, "HEALTHY");

    await manager.processLogLine("VOTC:DATE/;/419336");
    assert.strictEqual(manager.getDateTrackerStatus().dateProducerState, "LIVE_NO_PROGRESS", "same-day fresh marker must remain live without claiming date progress");
    assert.strictEqual(manager.lastProgressAt, firstProgressAt, "same value must not update Last Progress");
    fs.appendFileSync(debugLogPath, "VOTC:DATE/;/419337\n", "utf8");
    await manager.processLogLine("VOTC:DATE/;/419337");
    assert.strictEqual(manager.lastProgressDateValue, 419337);
    assert.strictEqual(manager.getDateTrackerStatus().dateProducerState, "LIVE");

    manager.lastObservedDateMarkerAt = Date.now() - 1000;
    const oldObservedAt = manager.lastObservedDateMarkerAt;
    const reconciled = await manager.reconcileLatestDateMarker("manual");
    assert.strictEqual(reconciled.dateSourceState, "DATE_SOURCE_STALLED", "old scanned marker must not be promoted to HEALTHY");
    assert.strictEqual(reconciled.dateProducerState, "STALLED");
    assert.strictEqual(manager.lastObservedDateMarkerAt, oldObservedAt, "historical scan must not forge a fresh marker timestamp");

    const lettersCarrier = 'debug_log = "VOTC:LETTER_TRANSPORT/A/abandoned-test"';
    const outboundCarrier = "root = { add_gold = 10 }";
    const outboundFilePath = path.join(ck3Dir, "run", "votc.txt");
    fs.writeFileSync(dateFilePath, lettersCarrier, "utf8");
    fs.writeFileSync(outboundFilePath, outboundCarrier, "utf8");
    const pendingBeforeRecovery = runFileManager.getPendingCommands();
    manager.ensureDateProducerRunning("test_stalled");
    assert.strictEqual(manager.dateProducerRecovery.status, "NATIVE_BRIDGE_WAITING");
    assert.strictEqual(fs.readFileSync(dateFilePath, "utf8"), lettersCarrier, "stalled-date handling must not rewrite the retired letters.txt carrier");
    assert.strictEqual(fs.readFileSync(outboundFilePath, "utf8"), outboundCarrier, "stalled-date handling must not touch the active outbound carrier");
    assert.deepStrictEqual(runFileManager.getPendingCommands(), pendingBeforeRecovery, "stalled-date handling must not enqueue a recovery command");
    fs.appendFileSync(debugLogPath, "VOTC:DATE/;/419338\n", "utf8");
    await manager.processLogLine("VOTC:DATE/;/419338");
    assert.strictEqual(manager.dateProducerRecovery.status, "RECOVERED", "a fresh native DATE marker clears the waiting state");
    const originalNow = Date.now;
    const freshNow = manager.lastObservedDateMarkerAt + 1;
    Date.now = () => freshNow;
    try {
      for (let heartbeat = 0; heartbeat < 5; heartbeat += 1) await manager.runDateTrackerHeartbeat();
      assert.strictEqual(runFileManager.getPendingCommands().length, 0, "fresh date polling must not schedule repeated bootstrap events");
    } finally {
      Date.now = originalNow;
    }

    const unknownEffect = 'root = { add_gold = 10 }';
    fs.writeFileSync(dateFilePath, unknownEffect, "utf8");
    manager.ensureDateProducerRunning("test_unknown_carrier");
    assert.strictEqual(manager.dateProducerRecovery.status, "NATIVE_BRIDGE_WAITING");
    assert.strictEqual(fs.readFileSync(dateFilePath, "utf8"), unknownEffect);
    assert.deepStrictEqual(runFileManager.getPendingCommands(), pendingBeforeRecovery);

    fs.writeFileSync(dateFilePath, 'debug_log = "VOTC:LETTER_TRANSPORT/A/active-test"', "utf8");
    manager.activeEffectDiagnostic = { stage: "A1", transportMode: "legacy_letters_file", executionStatus: "WAITING_FOR_CK3_EXECUTION" };
    manager.ensureDateProducerRunning("test_active_diagnostic");
    assert.strictEqual(manager.dateProducerRecovery.status, "NATIVE_BRIDGE_WAITING");
    assert(fs.readFileSync(dateFilePath, "utf8").includes("active-test"), "native date handling must not overwrite the retired A1 carrier");
    assert.deepStrictEqual(runFileManager.getPendingCommands(), pendingBeforeRecovery);
    manager.activeEffectDiagnostic = null;

    const close = runFileManager.enqueueCommand({ owner: "conversation", kind: "conversation_close", effectText: "trigger_event = mcc_event_v2.9002" });
    await manager.processLogLine(`VOTC:RUN_ACK/CONVERSATION_CLOSE/${close.commandId}`);
    assert.strictEqual(manager.dateProducerRecovery.status, "NATIVE_BRIDGE_WAITING", "conversation-close ACK waits for the independent native clock");
    assert.strictEqual(fs.readFileSync(dateFilePath, "utf8"), 'debug_log = "VOTC:LETTER_TRANSPORT/A/active-test"', "conversation-close ACK must not recreate a letters.txt date producer");
    assert.strictEqual(runFileManager.getPendingCommands().length, 0, "conversation-close ACK must not enqueue a date recovery command");
    manager.ensureDateProducerRunning("test_already_requested");
    assert.strictEqual(manager.dateProducerRecovery.status, "NATIVE_BRIDGE_WAITING");
    assert.strictEqual(fs.readFileSync(dateFilePath, "utf8"), 'debug_log = "VOTC:LETTER_TRANSPORT/A/active-test"');
    assert.strictEqual(runFileManager.getPendingCommands().length, 0, "repeated heartbeat recovery checks must remain side-effect free");
    const status = manager.getDateTrackerStatus();
    for (const field of ["lastObservedDateValue", "lastObservedDateMarkerAt", "lastProgressDateValue", "lastProgressAt", "markerAgeMs", "dateProducerRecovery", "runCommands"]) {
      assert(Object.prototype.hasOwnProperty.call(status, field), `date status field missing: ${field}`);
    }
    await manager.stopLogTailing();
    console.log("VOTC v7.10-RC6 Final Rev2 Date Producer: PASS (fresh marker, LIVE_NO_PROGRESS, stalled scan, native bridge waiting without carrier writes)");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
