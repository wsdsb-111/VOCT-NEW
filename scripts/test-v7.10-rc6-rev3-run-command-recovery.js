"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createRunFileManager } = require("../resources/app/out/main/actions/run-file-manager");
const { scanRecentRunAcks } = require("../resources/app/out/main/actions/run-command-recovery");

const root = path.join(__dirname, "..");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "votc-rc6-rev3-recovery-"));

function createHarness(name, { fsImpl = fs } = {}) {
  const baseDir = path.join(tempRoot, name);
  const ck3Dir = path.join(baseDir, "ck3");
  const dataDir = path.join(baseDir, "data");
  const runFile = path.join(ck3Dir, "run", "votc.txt");
  const debugLog = path.join(ck3Dir, "logs", "debug.log");
  fs.mkdirSync(path.dirname(runFile), { recursive: true });
  fs.mkdirSync(path.dirname(debugLog), { recursive: true });
  fs.writeFileSync(runFile, "", "utf8");
  fs.writeFileSync(debugLog, "", "utf8");
  let clock = 1000;
  const settingsRepository = {
    getCK3UserFolderPath: () => ck3Dir,
    getCK3DebugLogPath: () => debugLog
  };
  const createManager = () => {
    const RunFileManager = createRunFileManager({
      settingsRepository,
      path,
      fs: fsImpl,
      dataDir,
      now: () => clock,
      random: () => 0.25
    });
    return new RunFileManager();
  };
  return {
    ck3Dir,
    dataDir,
    debugLog,
    runFile,
    createManager,
    now: () => clock,
    advance: (milliseconds) => {
      clock += milliseconds;
    }
  };
}

try {
  const conversationSource = fs.readFileSync(path.join(root, "resources", "app", "out", "main", "conversation", "conversation.js"), "utf8");
  assert(!conversationSource.includes("runFileManager.recoverPendingCommands()"), "T1 Conversation initialization must not replay the global queue");

  {
    const harness = createHarness("ack-before-crash");
    const first = harness.createManager();
    first.initializeAfterAckReconciliation();
    const action = first.enqueueCommand({ owner: "action", kind: "action_effect", effectText: "add_gold = 5" });
    fs.appendFileSync(harness.debugLog, `VOTC:RUN_ACK/ACTION_EFFECT/${action.commandId}\n`, "utf8");

    const restarted = harness.createManager();
    assert.strictEqual(restarted.recoveryCompleted, false, "constructor must not replay before reconciliation");
    const reconciled = restarted.reconcileAcknowledgedCommands(scanRecentRunAcks(harness.debugLog, { fs }));
    restarted.initializeAfterAckReconciliation();
    assert.strictEqual(reconciled.length, 1, "T2 historical ACK must be reconciled");
    assert.strictEqual(restarted.getPendingCommands().length, 0, "T2 acknowledged command must not remain pending");
    assert.strictEqual(fs.readFileSync(harness.runFile, "utf8"), "", "T2 acknowledged command must not replay");
    assert.strictEqual(restarted.getRecentCommands().at(-1).ackSource, "startup_debug_log_reconciliation");
  }

  {
    const harness = createHarness("missing-ack");
    const first = harness.createManager();
    first.initializeAfterAckReconciliation();
    const action = first.enqueueCommand({ owner: "action", kind: "action_effect", effectText: "add_gold = 6" });
    const restarted = harness.createManager();
    assert.strictEqual(restarted.reconcileAcknowledgedCommands(scanRecentRunAcks(harness.debugLog, { fs })).length, 0);
    restarted.initializeAfterAckReconciliation();
    const active = restarted.getPendingCommands()[0];
    assert.strictEqual(active.commandId, action.commandId, "T3 unacknowledged head must remain active");
    assert.strictEqual(active.writeAttempts, 2, "T3 only explicit post-reconciliation recovery may replay once");
    assert(fs.readFileSync(harness.runFile, "utf8").includes(action.ackMarker));
  }

  {
    const harness = createHarness("wrong-ack");
    const manager = harness.createManager();
    manager.initializeAfterAckReconciliation();
    const action = manager.enqueueCommand({ owner: "action", kind: "action_effect", effectText: "add_gold = 7" });
    const restarted = harness.createManager();
    assert.strictEqual(restarted.reconcileAcknowledgedCommands([{ kind: "letter_effect", commandId: action.commandId }]).length, 0, "T4 wrong kind must not ACK");
    assert.strictEqual(restarted.reconcileAcknowledgedCommands([{ kind: "action_effect", commandId: "wrong-id" }]).length, 0, "T5 wrong ID must not ACK");
    assert.strictEqual(restarted.getPendingCommands().length, 1);
  }

  {
    const harness = createHarness("fifo-gap");
    const manager = harness.createManager();
    manager.initializeAfterAckReconciliation();
    const a = manager.enqueueCommand({ commandId: "fifo-a", owner: "action", kind: "action_effect", effectText: "add_gold = 1" });
    const b = manager.enqueueCommand({ commandId: "fifo-b", owner: "letter", kind: "letter_effect", effectText: "add_gold = 2" });
    const c = manager.enqueueCommand({ commandId: "fifo-c", owner: "conversation", kind: "conversation_close", effectText: "add_gold = 3" });
    const restarted = harness.createManager();
    const skipped = restarted.reconcileAcknowledgedCommands([
      { kind: b.kind, commandId: b.commandId },
      { kind: c.kind, commandId: c.commandId }
    ]);
    assert.strictEqual(skipped.length, 0, "T6 reconciliation must not cross an unacknowledged FIFO head");
    assert.deepStrictEqual(restarted.getPendingCommands().map((command) => command.commandId), [a.commandId, b.commandId, c.commandId]);

    const continuous = restarted.reconcileAcknowledgedCommands([
      { kind: a.kind, commandId: a.commandId },
      { kind: b.kind, commandId: b.commandId }
    ]);
    assert.deepStrictEqual(continuous.map((command) => command.commandId), [a.commandId, b.commandId], "T7 continuous ACKs must reconcile in FIFO order");
    restarted.initializeAfterAckReconciliation();
    assert.deepStrictEqual(restarted.getPendingCommands().map((command) => command.commandId), [c.commandId]);
    assert(fs.readFileSync(harness.runFile, "utf8").includes(c.ackMarker), "T7 next unconfirmed command must become active");
  }

  {
    let failRename = false;
    const failingFs = Object.create(fs);
    failingFs.renameSync = (source, destination) => {
      if (failRename) throw new Error("disk failure");
      return fs.renameSync(source, destination);
    };
    const harness = createHarness("persist-failure", { fsImpl: failingFs });
    const manager = harness.createManager();
    manager.initializeAfterAckReconciliation();
    failRename = true;
    assert.throws(
      () => manager.enqueueCommand({ owner: "action", kind: "action_effect", effectText: "add_gold = 8" }),
      /run_command_persist_failed/,
      "T8 enqueue must fail closed when durable persistence fails"
    );
    assert.strictEqual(manager.getPendingCommands().length, 0);
    assert.strictEqual(fs.readFileSync(harness.runFile, "utf8"), "", "T8 persistence failure must not dispatch Effect");
  }

  {
    const harness = createHarness("stalled");
    const manager = harness.createManager();
    manager.initializeAfterAckReconciliation();
    const action = manager.enqueueCommand({ owner: "action", kind: "action_effect", effectText: "add_gold = 9" });
    const firstAttempts = manager.getPendingCommands()[0].writeAttempts;
    harness.advance(30001);
    const stalled = manager.markActiveCommandStalledIfNeeded({ ackTimeoutMs: 30000 });
    assert.strictEqual(stalled.status, "stalled", "T9 missing ACK must become STALLED");
    assert.strictEqual(manager.getPendingCommands()[0].writeAttempts, firstAttempts, "T9 STALLED must not auto-replay");
    assert.strictEqual(manager.recoverPendingCommands()[0].status, "stalled", "T9 recovery must not replay STALLED command");
    assert.strictEqual(manager.getPendingCommands()[0].writeAttempts, firstAttempts);

    assert.throws(() => manager.retryStalledCommand("wrong-id"), /run_command_not_active/);
    const retried = manager.retryStalledCommand(action.commandId);
    assert.strictEqual(retried.status, "awaiting_ack", "T10 explicit retry must re-dispatch the active STALLED command");
    assert.strictEqual(retried.writeAttempts, firstAttempts + 1);
    harness.advance(30001);
    manager.markActiveCommandStalledIfNeeded({ ackTimeoutMs: 30000 });
    const cancelled = manager.cancelStalledCommand(action.commandId, "user_cancelled");
    assert.strictEqual(cancelled.status, "cancelled", "T10 explicit cancel must release the STALLED head");
    assert.strictEqual(manager.getPendingCommands().length, 0);
  }

  const mainSource = fs.readFileSync(path.join(root, "resources", "app", "out", "main", "main.js"), "utf8");
  const preloadSource = fs.readFileSync(path.join(root, "resources", "app", "out", "preload", "preload.js"), "utf8");
  const ipcSource = fs.readFileSync(path.join(root, "resources", "app", "out", "main", "ipc", "register-ipc.js"), "utf8");
  const rendererSource = fs.readFileSync(path.join(root, "resources", "app", "out", "renderer", "assets", "index-Dn3qWlAB.js"), "utf8");
  const startupBlock = mainSource.slice(mainSource.indexOf("const initializeRunCommandQueue"), mainSource.indexOf("initLogger();"));
  const firstScan = startupBlock.indexOf("reconcileRecentAcks();");
  const tailStart = startupBlock.indexOf("await letterManager.startLogTailing();");
  const secondScan = startupBlock.indexOf("reconcileRecentAcks();", firstScan + 1);
  const replay = startupBlock.indexOf("runFileManager.initializeAfterAckReconciliation();");
  assert(firstScan >= 0 && firstScan < tailStart && tailStart < secondScan && secondScan < replay, "startup must scan, start Tail, close the scan gap, then replay");
  assert(preloadSource.includes("retryStalledRunCommand") && preloadSource.includes("cancelStalledRunCommand"), "T10 preload must expose manual controls");
  assert(ipcSource.includes('"letters:retryStalledRunCommand"') && ipcSource.includes('"letters:cancelStalledRunCommand"'), "T10 IPC must expose manual controls");
  assert(rendererSource.includes("CK3 是否已经执行该 Effect 无法完全确认。重新执行可能造成重复效果。"), "T10 UI must show the duplicate-effect warning");

  console.log("VOTC v7.10-RC6 Run Command Recovery: PASS (T1-T10 reconciliation, durable dispatch, STALLED manual control)");
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
