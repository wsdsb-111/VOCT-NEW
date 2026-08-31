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
    await manager.processLogLine("VOTC:DATE/;/419337");
    assert.strictEqual(manager.lastProgressDateValue, 419337);
    assert.strictEqual(manager.getDateTrackerStatus().dateProducerState, "LIVE");

    manager.lastObservedDateMarkerAt = Date.now() - 1000;
    const oldObservedAt = manager.lastObservedDateMarkerAt;
    fs.writeFileSync(debugLogPath, "VOTC:DATE/;/419337\n", "utf8");
    const reconciled = await manager.reconcileLatestDateMarker("manual");
    assert.strictEqual(reconciled.dateSourceState, "DATE_SOURCE_STALLED", "old scanned marker must not be promoted to HEALTHY");
    assert.strictEqual(reconciled.dateProducerState, "STALLED");
    assert.strictEqual(manager.lastObservedDateMarkerAt, oldObservedAt, "historical scan must not forge a fresh marker timestamp");

    manager.ensureDateProducerRunning("test_stalled");
    const recovery = runFileManager.getPendingCommands()[0];
    assert.strictEqual(recovery.kind, "date_producer_rearm");
    assert(recovery.effectText.includes("has_global_variable = talk_scene"), "re-arm must be blocked while talk_scene exists");
    assert(recovery.effectText.includes("trigger_event = mcc_event_v2.9998"));
    assert(recovery.effectText.includes(`VOTC:DATE_PRODUCER/REARMED/${recovery.commandId}`));
    await manager.processLogLine(`VOTC:DATE_PRODUCER/REARMED/${recovery.commandId}`);
    assert.strictEqual(manager.dateProducerRecovery.status, "WAITING_FOR_FRESH_MARKER");
    await manager.processLogLine(`VOTC:RUN_ACK/DATE_PRODUCER_REARM/${recovery.commandId}`);
    await manager.processLogLine("VOTC:DATE/;/419338");
    assert.strictEqual(manager.dateProducerRecovery.status, "RECOVERED", "recovery succeeds only after a live Date Marker");

    const close = runFileManager.enqueueCommand({ owner: "conversation", kind: "conversation_close", effectText: "trigger_event = mcc_event_v2.9002" });
    await manager.processLogLine(`VOTC:RUN_ACK/CONVERSATION_CLOSE/${close.commandId}`);
    assert(runFileManager.getPendingCommands().some((command) => command.kind === "date_producer_rearm"), "conversation close ACK must re-arm the Date Producer");
    const status = manager.getDateTrackerStatus();
    for (const field of ["lastObservedDateValue", "lastObservedDateMarkerAt", "lastProgressDateValue", "lastProgressAt", "markerAgeMs", "dateProducerRecovery", "runCommands"]) {
      assert(Object.prototype.hasOwnProperty.call(status, field), `date status field missing: ${field}`);
    }
    await manager.stopLogTailing();
    console.log("VOTC v7.10-RC6 Final Rev2 Date Producer: PASS (fresh marker, LIVE_NO_PROGRESS, stalled scan, controlled re-arm)");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
