"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createRunFileManager } = require("../resources/app/out/main/actions/run-file-manager");

const IDLE_EFFECT = 'if = { limit = { always = no } debug_log = "VOTC:IDLE_NOOP" }';
const IDLE_CARRIER = "\uFEFF" + IDLE_EFFECT;
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "votc-runtime-followup-qa-"));
let clock = 1_900_000_000_000;

function createHarness(name, carrierText = "") {
  const baseDir = path.join(tempRoot, name);
  const ck3Dir = path.join(baseDir, "ck3");
  const dataDir = path.join(baseDir, "data");
  const runDir = path.join(ck3Dir, "run");
  const runFile = path.join(runDir, "votc.txt");
  fs.mkdirSync(runDir, { recursive: true });
  if (carrierText !== null) fs.writeFileSync(runFile, carrierText, "utf8");
  const settingsRepository = { getCK3UserFolderPath: () => ck3Dir };
  const makeManager = () => {
    const RunFileManager = createRunFileManager({ settingsRepository, path, fs, dataDir,
      now: () => clock, random: () => 0.25 });
    return new RunFileManager();
  };
  return { baseDir, ck3Dir, dataDir, runDir, runFile, settingsRepository, makeManager, manager: makeManager() };
}

function readCarrier(harness) { return fs.readFileSync(harness.runFile, "utf8"); }
function readQueue(harness) { return JSON.parse(fs.readFileSync(path.join(harness.dataDir, "run-command-queue.json"), "utf8")); }

function assertNoAtomicTemps(directory) {
  const leftovers = fs.readdirSync(directory).filter(name => name.endsWith(".tmp"));
  assert.deepStrictEqual(leftovers, [], "atomic replacement must clean up its temporary file");
}

function command(manager, commandId, effectText, kind = "action_effect") {
  return manager.enqueueCommand({ commandId, owner: "qa", kind, effectText });
}

function assertBomCommand(harness, commandId, payload) {
  const carrier = readCarrier(harness);
  assert.equal(carrier.charCodeAt(0), 0xfeff, "the real carrier must retain its UTF-8 BOM");
  assert(carrier.includes("/" + commandId), "the carrier should identify the dispatched command");
  assert(carrier.includes(payload), "the carrier should contain the expected command payload");
  assertNoAtomicTemps(harness.runDir);
}

function run() {
  {
    const harness = createHarness("live-multiple-acks");
    harness.manager.initializeAfterAckReconciliation();
    assert.equal(readCarrier(harness), IDLE_CARRIER, "empty startup should install the exact idle Effect");
    assertNoAtomicTemps(harness.runDir);

    const first = command(harness.manager, "qa-live-first", "add_gold = 1");
    const second = command(harness.manager, "qa-live-second", "add_gold = 2");
    assert.equal(first.status, "awaiting_ack");
    assert.equal(second.status, "queued");
    assertBomCommand(harness, first.commandId, "add_gold = 1");
    assert(!readCarrier(harness).includes(second.commandId), "a queued command must not replace the active carrier");
    const firstCarrier = readCarrier(harness);
    assert.equal(harness.manager.ackCommand("qa-live-stale-ack", first.kind), null,
      "a non-current live ACK must be ignored");
    assert.equal(readCarrier(harness), firstCarrier, "a non-current live ACK must not clear or replace the carrier");
    assert.equal(harness.manager.getPendingCommands()[0].commandId, first.commandId);

    const foreignCarrier = 'debug_log = "VOTC:FOREIGN_DURING_LIVE_QUEUE"';
    fs.writeFileSync(harness.runFile, foreignCarrier, "utf8");
    assert.equal(harness.manager.ackCommand(first.commandId, first.kind).status, "acknowledged");
    assertBomCommand(harness, second.commandId, "add_gold = 2");
    assert(!readCarrier(harness).includes("VOTC:FOREIGN_DURING_LIVE_QUEUE"),
      "a valid current ACK must advance and dispatch the next queued command even if the carrier was externally replaced");
    assert(!readCarrier(harness).includes(first.commandId), "the second dispatch must atomically replace the first carrier");
    assert.equal(readQueue(harness).version, 3);
    assert.equal(readQueue(harness).pendingCommands[0].writeAttempts, 1);
    assert.equal(harness.manager.ackCommand(second.commandId, second.kind).status, "acknowledged");
    assert.equal(readCarrier(harness), IDLE_CARRIER, "the final live ACK should leave the valid idle Effect");
    assertNoAtomicTemps(harness.runDir);
    assert.equal(harness.manager.getPendingCommands().length, 0);
  }

  {
    const harness = createHarness("startup-multiple-acks");
    harness.manager.initializeAfterAckReconciliation();
    const first = command(harness.manager, "qa-startup-first", "set_global_variable = { name = qa_first value = yes }", "command");
    const second = command(harness.manager, "qa-startup-second", "set_global_variable = { name = qa_second value = yes }", "command");
    assert.equal(first.status, "awaiting_ack");
    assert.equal(second.status, "queued");

    const afterFirstRestart = harness.makeManager();
    const firstCarrier = readCarrier(harness);
    const firstAck = afterFirstRestart.reconcileAcknowledgedCommands([{ kind: "COMMAND", commandId: first.commandId }]);
    assert.deepStrictEqual(firstAck.map(item => item.commandId), [first.commandId]);
    assert.equal(readCarrier(harness), firstCarrier, "reconciliation of the FIFO head should not clear its carrier while another command waits");
    assert.equal(afterFirstRestart.initializeAfterAckReconciliation()[0].commandId, second.commandId);
    assertBomCommand(harness, second.commandId, "name = qa_second");
    assert.equal(readQueue(harness).pendingCommands[0].writeAttempts, 1);

    const afterSecondRestart = harness.makeManager();
    const secondAck = afterSecondRestart.reconcileAcknowledgedCommands([{ kind: "COMMAND", commandId: second.commandId }]);
    assert.deepStrictEqual(secondAck.map(item => item.commandId), [second.commandId]);
    assert.equal(readCarrier(harness), IDLE_CARRIER, "startup reconciliation of the last live ACK should neutralize the carrier");
    afterSecondRestart.initializeAfterAckReconciliation();
    assert.equal(afterSecondRestart.getPendingCommands().length, 0);
    assert.equal(readCarrier(harness), IDLE_CARRIER);
    assertNoAtomicTemps(harness.runDir);
  }

  {
    const foreignCarrier = 'debug_log = "VOTC:FOREIGN_CARRIER"';
    const harness = createHarness("foreign-carrier-preserved", foreignCarrier);
    assert.equal(harness.manager.writeEmptyRunFileIfSafe(), false);
    assert.deepStrictEqual(harness.manager.reconcileAcknowledgedCommands([
      { kind: "action_effect", commandId: "not-in-queue" }
    ]), [], "an ACK for no current command must not reconcile anything");
    assert.equal(harness.manager.initializeAfterAckReconciliation().length, 0);
    assert.equal(harness.manager.neutralizeExecutableFile({ expectedCommandId: "not-the-owner", reason: "qa_foreign" }), false);
    assert.equal(harness.manager.clear(), false, "clear must refuse to overwrite an unknown non-empty carrier");
    assert.equal(readCarrier(harness), foreignCarrier, "all empty-queue cleanup paths must preserve foreign content");
    assertNoAtomicTemps(harness.runDir);
  }

  {
    const foreignCarrier = "add_gold = 19";
    const harness = createHarness("corrupt-queue-failclosed", foreignCarrier);
    fs.mkdirSync(harness.dataDir, { recursive: true });
    fs.writeFileSync(path.join(harness.dataDir, "run-command-queue.json"), "{broken-json", "utf8");
    const corrupt = harness.makeManager();
    assert.throws(() => corrupt.initializeAfterAckReconciliation(), /run_command_state_load_failed/);
    assert.throws(() => command(corrupt, "qa-corrupt-queue-command", "add_gold = 20"), /run_command_state_load_failed/);
    assert.equal(corrupt.clear(), false);
    assert.equal(corrupt.writeEmptyRunFileIfSafe(), false);
    assert.equal(readCarrier(harness), foreignCarrier, "damaged durable state must never authorize carrier changes");
    assertNoAtomicTemps(harness.runDir);
  }

  {
    const harness = createHarness("written-effect-not-replayed");
    harness.manager.initializeAfterAckReconciliation();
    const written = command(harness.manager, "qa-written-unknown", "add_gold = 17");
    assert.equal(written.status, "awaiting_ack");
    const originalWrite = { writeAttempts: written.writeAttempts, writtenAt: written.writtenAt, lastWrittenAt: written.lastWrittenAt };
    assert.equal(originalWrite.writeAttempts, 1);
    assertBomCommand(harness, written.commandId, "add_gold = 17");

    const restarted = harness.makeManager();
    const recovered = restarted.initializeAfterAckReconciliation()[0];
    assert.equal(recovered.commandId, written.commandId);
    assert.equal(recovered.status, "stalled", "a prior physical write without ACK must remain stalled");
    assert.deepStrictEqual({ writeAttempts: recovered.writeAttempts, writtenAt: recovered.writtenAt,
      lastWrittenAt: recovered.lastWrittenAt }, originalWrite);
    assert.equal(readCarrier(harness), IDLE_CARRIER, "the known old command should be neutralized rather than replayed");
    restarted.writeActiveCommand();
    assert.equal(readCarrier(harness), IDLE_CARRIER);
    assert.equal(restarted.getPendingCommands()[0].writeAttempts, 1, "recovery must never issue a second physical write");
    assertNoAtomicTemps(harness.runDir);
  }

  console.log("V8.15.2 runtime follow-up independent QA: PASS");
}

try {
  run();
} finally {
  const resolvedRoot = path.resolve(tempRoot);
  assert(resolvedRoot.startsWith(path.resolve(os.tmpdir()) + path.sep), "only the task's temporary fixture root may be removed");
  fs.rmSync(resolvedRoot, { recursive: true, force: true });
}
