"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { createRunFileManager } = require("../resources/app/out/main/actions/run-file-manager");

const IDLE_EFFECT = 'if = { limit = { always = no } debug_log = "VOTC:IDLE_NOOP" }';
const IDLE_CARRIER = `\uFEFF${IDLE_EFFECT}`;
const tempRoot = fs.mkdtempSync(path.join(__dirname, ".tmp-v8.15.2-idle-run-carrier-"));

function createHarness(name, carrierText = "") {
  const baseDir = path.join(tempRoot, name);
  const ck3Dir = path.join(baseDir, "ck3");
  const dataDir = path.join(baseDir, "data");
  const runDir = path.join(ck3Dir, "run");
  const runFile = path.join(runDir, "votc.txt");
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(runFile, carrierText, "utf8");
  const settingsRepository = { getCK3UserFolderPath: () => ck3Dir };
  const RunFileManager = createRunFileManager({ settingsRepository, path, fs, dataDir });
  return { dataDir, runFile, manager: new RunFileManager() };
}

try {
  {
    const harness = createHarness("legacy-empty-migration");
    harness.manager.initializeAfterAckReconciliation();
    assert.strictEqual(fs.readFileSync(harness.runFile, "utf8"), IDLE_CARRIER,
      "a legacy zero-byte carrier must migrate to the exact idle Effect");
    assert.strictEqual(harness.manager.writeEmptyRunFileIfSafe(), true);
    assert.strictEqual(fs.readFileSync(harness.runFile, "utf8"), IDLE_CARRIER,
      "repeating empty-queue neutralization must retain the idle carrier");
  }

  {
    const harness = createHarness("missing-carrier");
    fs.unlinkSync(harness.runFile);
    assert.strictEqual(harness.manager.writeEmptyRunFileIfSafe(), true,
      "a missing carrier is safe to initialize");
    assert.strictEqual(fs.readFileSync(harness.runFile, "utf8"), IDLE_CARRIER);
  }

  {
    const harness = createHarness("existing-idle-carrier", IDLE_CARRIER);
    assert.strictEqual(harness.manager.writeEmptyRunFileIfSafe(), true,
      "the exact owned idle Effect is safe to recognize and retain");
    assert.strictEqual(fs.readFileSync(harness.runFile, "utf8"), IDLE_CARRIER);
  }

  {
    const harness = createHarness("ack-clears-to-idle");
    harness.manager.initializeAfterAckReconciliation();
    const command = harness.manager.enqueueCommand({
      owner: "action",
      kind: "action_effect",
      effectText: "add_gold = 1"
    });
    assert.strictEqual(fs.readFileSync(harness.runFile, "utf8").charCodeAt(0), 0xfeff,
      "normal command writes must retain the UTF-8 BOM");
    assert.strictEqual(harness.manager.ackCommand(command.commandId, command.kind).status, "acknowledged");
    assert.strictEqual(fs.readFileSync(harness.runFile, "utf8"), IDLE_CARRIER,
      "a normal ACK that empties the queue must leave a valid idle Effect");
  }

  {
    const harness = createHarness("startup-ack-clears-to-idle");
    harness.manager.initializeAfterAckReconciliation();
    const command = harness.manager.enqueueCommand({
      commandId: "startup-ack-carrier",
      owner: "action",
      kind: "action_effect",
      effectText: "add_gold = 3"
    });
    const restarted = createRunFileManager({
      settingsRepository: { getCK3UserFolderPath: () => path.dirname(path.dirname(harness.runFile)) },
      path,
      fs,
      dataDir: harness.dataDir
    });
    const restartedManager = new restarted();
    assert.strictEqual(restartedManager.reconcileAcknowledgedCommands([
      { kind: command.kind, commandId: command.commandId }
    ]).length, 1);
    restartedManager.initializeAfterAckReconciliation();
    assert.strictEqual(fs.readFileSync(harness.runFile, "utf8"), IDLE_CARRIER,
      "startup ACK reconciliation must neutralize its own carrier to idle");
  }

  {
    const harness = createHarness("repeated-neutralize");
    harness.manager.initializeAfterAckReconciliation();
    const command = harness.manager.enqueueCommand({
      commandId: "neutralize-once",
      owner: "action",
      kind: "action_effect",
      effectText: "add_gold = 2"
    });
    assert.strictEqual(harness.manager.neutralizeExecutableFile({
      expectedCommandId: command.commandId,
      command,
      reason: "idle-carrier-test"
    }), true);
    assert.strictEqual(fs.readFileSync(harness.runFile, "utf8"), IDLE_CARRIER);
    assert.strictEqual(harness.manager.neutralizeExecutableFile({
      expectedCommandId: command.commandId,
      command,
      reason: "repeated-idle-carrier-test"
    }), true, "the exact idle Effect must be recognized as already neutralized");
    assert.strictEqual(fs.readFileSync(harness.runFile, "utf8"), IDLE_CARRIER);
  }

  {
    const foreignNoop = 'if = { limit = { always = no } debug_log = "VOTC:OTHER_NOOP" }';
    const harness = createHarness("unknown-noop-preserved", foreignNoop);
    assert.strictEqual(harness.manager.writeEmptyRunFileIfSafe(), false,
      "a different no-op-looking Effect must not be treated as the owned idle carrier");
    assert.strictEqual(harness.manager.neutralizeExecutableFile({
      expectedCommandId: "not-the-owner",
      reason: "unknown-noop-test"
    }), false, "neutralization must refuse an unowned carrier even when it looks inert");
    assert.strictEqual(fs.readFileSync(harness.runFile, "utf8"), foreignNoop,
      "unknown non-empty carrier content must remain untouched");
  }

  {
    const unknownCarrier = 'debug_log = "VOTC:FOREIGN_CARRIER"';
    const harness = createHarness("unknown-carrier-preserved", unknownCarrier);
    harness.manager.initializeAfterAckReconciliation();
    assert.strictEqual(fs.readFileSync(harness.runFile, "utf8"), unknownCarrier,
      "startup with an empty queue must preserve an unknown non-empty carrier");
  }

  {
    const unknownCarrier = "add_gold = 19";
    const harness = createHarness("corrupt-queue-preserves-carrier", unknownCarrier);
    fs.mkdirSync(harness.dataDir, { recursive: true });
    fs.writeFileSync(path.join(harness.dataDir, "run-command-queue.json"), "{broken-json", "utf8");
    const CorruptRunFileManager = createRunFileManager({
      settingsRepository: { getCK3UserFolderPath: () => path.dirname(path.dirname(harness.runFile)) },
      path,
      fs,
      dataDir: harness.dataDir
    });
    const corruptManager = new CorruptRunFileManager();
    assert.throws(() => corruptManager.initializeAfterAckReconciliation(), /run_command_state_load_failed/);
    assert.strictEqual(fs.readFileSync(harness.runFile, "utf8"), unknownCarrier,
      "corrupt queue state must fail closed without touching the carrier");
  }

  console.log("V8.15.2 idle Run carrier regression: PASS");
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
