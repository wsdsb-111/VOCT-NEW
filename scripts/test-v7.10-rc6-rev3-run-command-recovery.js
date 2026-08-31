"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createRunFileManager } = require("../resources/app/out/main/actions/run-file-manager");
const { scanRunAcksForPendingCommands } = require("../resources/app/out/main/actions/run-command-recovery");
const { registerIpcHandlers } = require("../resources/app/out/main/ipc/register-ipc");

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
  let configuredCk3Dir = ck3Dir;
  const settingsRepository = {
    getCK3UserFolderPath: () => configuredCk3Dir,
    getCK3DebugLogPath: () => configuredCk3Dir ? path.join(configuredCk3Dir, "logs", "debug.log") : null
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
    setCk3Path: (nextPath) => {
      configuredCk3Dir = nextPath;
    },
    runFile,
    createManager,
    now: () => clock,
    advance: (milliseconds) => {
      clock += milliseconds;
    }
  };
}

async function run() {
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
    const reconciled = restarted.reconcileAcknowledgedCommands(scanRunAcksForPendingCommands(harness.debugLog, { fs, pendingCommands: restarted.getPendingCommands() }));
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
    const runFileBeforeRestart = fs.readFileSync(harness.runFile, "utf8");
    const restarted = harness.createManager();
    assert.strictEqual(restarted.reconcileAcknowledgedCommands(scanRunAcksForPendingCommands(harness.debugLog, { fs, pendingCommands: restarted.getPendingCommands() })).length, 0);
    restarted.initializeAfterAckReconciliation();
    const active = restarted.getPendingCommands()[0];
    assert.strictEqual(active.commandId, action.commandId, "T3 unacknowledged head must remain active");
    assert.strictEqual(active.status, "stalled", "T3 unacknowledged head must become STALLED after restart");
    assert.strictEqual(active.failureReason, "startup_ack_unconfirmed", "T3 restart must record the ACK uncertainty reason");
    assert.strictEqual(active.writeAttempts, 1, "T3 restart must not increase writeAttempts");
    assert.strictEqual(fs.readFileSync(harness.runFile, "utf8"), runFileBeforeRestart, "T3 restart must not rewrite votc.txt");
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

    {
      const harness = createHarness("blocked-recovery");
      harness.setCk3Path(null);
      const manager = harness.createManager();
      const blocked = manager.enqueueCommand({ commandId: "blocked-a", owner: "action", kind: "action_effect", effectText: "add_gold = 10" });
      manager.initializeAfterAckReconciliation();
      assert.strictEqual(manager.getPendingCommands()[0].status, "blocked", "T11 unavailable path must become BLOCKED");
      assert.strictEqual(manager.getPendingCommands()[0].writeAttempts, 0, "T11 BLOCKED must have no write history");
      assert.strictEqual(manager.getRecentCommands().some((command) => command.status === "failed"), false, "T11 pre-dispatch failure must not become terminal failed");
      harness.setCk3Path(harness.ck3Dir);
      manager.refreshPathFromSettings();
      const retried = manager.retryBlockedCommand(blocked.commandId);
      assert.strictEqual(retried.status, "awaiting_ack", "T11 BLOCKED command must support safe retry");
      assert.strictEqual(retried.writeAttempts, 1);

      const cancelledHarness = createHarness("blocked-cancel");
      cancelledHarness.setCk3Path(null);
      const cancelledManager = cancelledHarness.createManager();
      const cancelled = cancelledManager.enqueueCommand({ commandId: "blocked-b", owner: "action", kind: "action_effect", effectText: "add_gold = 11" });
      cancelledManager.initializeAfterAckReconciliation();
      assert.strictEqual(cancelledManager.cancelCommand(cancelled.commandId, "user_cancelled").status, "cancelled", "T11 BLOCKED command must support safe cancel");
      assert.strictEqual(cancelledManager.getPendingCommands().length, 0);

      const failedManager = createHarness("failed-terminal").createManager();
      const failed = failedManager.enqueueCommand({ commandId: "failed-a", owner: "action", kind: "action_effect", effectText: "add_gold = 12" });
      failedManager.failCommand(failed.commandId, "explicit_failure");
      assert.strictEqual(failedManager.getPendingCommands().some((command) => command.status === "failed"), false, "T11 failed must never remain pending");
      assert.strictEqual(failedManager.getRecentCommands().at(-1).status, "failed", "T11 failed may remain terminal in recent history");
    }

  {
    const harness = createHarness("blocked-path-restored");
    harness.setCk3Path(null);
    const manager = harness.createManager();
    const action = manager.enqueueCommand({ commandId: "path-restored", owner: "action", kind: "action_effect", effectText: "add_gold = 13" });
    manager.initializeAfterAckReconciliation();
    assert.strictEqual(manager.getPendingCommands()[0].status, "blocked", "T12 unavailable path must produce BLOCKED");
    const pathB = path.join(path.dirname(harness.ck3Dir), "ck3-b");
    harness.setCk3Path(pathB);
    assert.strictEqual(manager.refreshPathFromSettings(), path.join(pathB, "run", "votc.txt"), "T12 refresh must adopt the restored path");
    const retried = manager.retryBlockedCommand(action.commandId);
    assert.strictEqual(retried.status, "awaiting_ack", "T12 restored path must allow safe dispatch");
    assert.strictEqual(retried.writeAttempts, 1);
    assert(fs.readFileSync(path.join(pathB, "run", "votc.txt"), "utf8").includes(action.ackMarker), "T12 must write only to the restored path");
    assert.strictEqual(fs.readFileSync(harness.runFile, "utf8"), "", "T12 must not write the old path");
  }

  {
    const harness = createHarness("path-switch");
    const manager = harness.createManager();
    manager.initializeAfterAckReconciliation();
    const pathB = path.join(path.dirname(harness.ck3Dir), "ck3-b");
    harness.setCk3Path(pathB);
    assert.strictEqual(manager.refreshPathFromSettings(), path.join(pathB, "run", "votc.txt"), "T14 empty queue must allow path A to B");
    assert.strictEqual(manager.path, path.join(pathB, "run", "votc.txt"));

    const dispatched = manager.enqueueCommand({ commandId: "path-dispatched", owner: "action", kind: "action_effect", effectText: "add_gold = 14" });
    harness.setCk3Path(harness.ck3Dir);
    assert.throws(() => manager.refreshPathFromSettings(), /run_command_path_change_with_dispatched_command/, "T14 dispatched command must reject path A to B");
    assert.strictEqual(manager.path, path.join(pathB, "run", "votc.txt"));
    assert.strictEqual(dispatched.writeAttempts, 1);
  }

  {
    const operations = [];
    let restartWriteCount = 0;
    let countRestartWrites = false;
    const trackingFs = Object.create(fs);
    const harness = createHarness("dispatch-intent", { fsImpl: trackingFs });
    trackingFs.renameSync = (source, destination) => {
      if (path.resolve(destination) === path.resolve(path.join(harness.dataDir, "run-command-queue.json"))) operations.push("state");
      return fs.renameSync(source, destination);
    };
    trackingFs.writeFileSync = (filePath, ...args) => {
      if (path.resolve(filePath) === path.resolve(harness.runFile)) {
        operations.push("run");
        if (countRestartWrites) restartWriteCount += 1;
      }
      return fs.writeFileSync(filePath, ...args);
    };
    const manager = harness.createManager();
    manager.initializeAfterAckReconciliation();
    operations.length = 0;
    const action = manager.enqueueCommand({ commandId: "dispatch-intent", owner: "action", kind: "action_effect", effectText: "add_gold = 17" });
    const runWriteIndex = operations.indexOf("run");
    const persisted = JSON.parse(fs.readFileSync(path.join(harness.dataDir, "run-command-queue.json"), "utf8")).pendingCommands[0];
    assert(runWriteIndex > 0 && operations.slice(0, runWriteIndex).includes("state"), "T16 dispatch intent must be persisted before votc.txt is written");
    assert.strictEqual(operations.slice(runWriteIndex + 1).includes("state"), false, "T16 successful votc.txt write must not depend on a later persistence step");
    assert.strictEqual(persisted.status, "awaiting_ack", "T16 durable state must already mark the command as unconfirmed before the write");
    assert.strictEqual(persisted.writeAttempts, 1);
    assert.strictEqual(action.status, "awaiting_ack");

    const restarted = harness.createManager();
    countRestartWrites = true;
    restarted.initializeAfterAckReconciliation();
    assert.strictEqual(restartWriteCount, 0, "T16 restart after the physical write must not replay votc.txt");
    assert.strictEqual(restarted.getPendingCommands()[0].status, "stalled");
  }

  {
    let runWrites = 0;
    const trackingFs = Object.create(fs);
    const harness = createHarness("last-written-history", { fsImpl: trackingFs });
    fs.mkdirSync(harness.dataDir, { recursive: true });
    fs.writeFileSync(path.join(harness.dataDir, "run-command-queue.json"), JSON.stringify({
      version: 2,
      pendingCommands: [{
        commandId: "last-written-only",
        owner: "action",
        kind: "action_effect",
        effectText: "add_gold = 18",
        status: "queued",
        writtenAt: null,
        lastWrittenAt: 999,
        writeAttempts: 0,
        queuedAt: 1,
        ackMarker: "VOTC:RUN_ACK/ACTION_EFFECT/last-written-only"
      }],
      recentCommands: []
    }), "utf8");
    trackingFs.writeFileSync = (filePath, ...args) => {
      if (path.resolve(filePath) === path.resolve(harness.runFile)) runWrites += 1;
      return fs.writeFileSync(filePath, ...args);
    };
    const manager = harness.createManager();
    manager.initializeAfterAckReconciliation();
    const active = manager.getPendingCommands()[0];
    assert.strictEqual(runWrites, 0, "T17 lastWrittenAt-only history must never auto-replay");
    assert.strictEqual(active.status, "stalled");
    assert.strictEqual(active.writeAttempts, 1, "T17 legacy lastWrittenAt must normalize to dispatch history");
  }

  {
    const harness = createHarness("corrupt-state");
    fs.mkdirSync(harness.dataDir, { recursive: true });
    fs.writeFileSync(harness.runFile, "add_gold = 19", "utf8");
    fs.writeFileSync(path.join(harness.dataDir, "run-command-queue.json"), "{broken-json", "utf8");
    const manager = harness.createManager();
    assert.throws(() => manager.initializeAfterAckReconciliation(), /run_command_state_load_failed/, "T17 corrupt state must block startup recovery");
    assert.strictEqual(fs.readFileSync(harness.runFile, "utf8"), "add_gold = 19", "T17 corrupt state must not clear votc.txt");
    assert.throws(() => manager.enqueueCommand({ commandId: "after-corruption", owner: "action", kind: "action_effect", effectText: "add_gold = 20" }), /run_command_state_load_failed/, "T17 corrupt state must block dispatch");
  }

  {
    const handlers = {};
    const noop = new Proxy({}, { get: () => () => undefined });
    let configuredPath = "A";
    let runPath = "A";
    let tailPath = "A";
    let failTailOnB = false;
    const electron = { ipcMain: { handle: (name, handler) => { handlers[name] = handler; }, on: () => {} } };
    const settingsRepository = new Proxy({
      getCK3UserFolderPath: () => configuredPath,
      setCK3UserFolderPath: (nextPath) => { configuredPath = nextPath || null; }
    }, { get: (target, property) => property in target ? target[property] : () => undefined });
    const runFileManager = new Proxy({
      refreshPathFromSettings: () => {
        runPath = configuredPath;
        return runPath;
      }
    }, { get: (target, property) => property in target ? target[property] : () => undefined });
    const letterManager = new Proxy({
      restartLogTailing: async () => {
        if (configuredPath === "B" && failTailOnB) {
          tailPath = null;
          throw new Error("tail_restart_failed");
        }
        tailPath = configuredPath;
      },
      stopLogTailing: async () => { tailPath = null; }
    }, { get: (target, property) => property in target ? target[property] : () => undefined });
    const runtime = new Proxy({ electron, settingsRepository, runFileManager, letterManager, conversationManager: noop }, { get: (target, property) => property in target ? target[property] : noop });
    registerIpcHandlers(runtime);
    const setCK3Folder = handlers["llm:setCK3Folder"];

    assert.deepStrictEqual(await setCK3Folder(null, "B"), { success: true }, "T18 path and Tail must switch together on success");
    assert.deepStrictEqual({ configuredPath, runPath, tailPath }, { configuredPath: "B", runPath: "B", tailPath: "B" });
    assert.deepStrictEqual(await setCK3Folder(null, "A"), { success: true });
    failTailOnB = true;
    const failed = await setCK3Folder(null, "B");
    assert.strictEqual(failed.success, false, "T18 Tail failure must reject the path update");
    assert.deepStrictEqual({ configuredPath, runPath, tailPath }, { configuredPath: "A", runPath: "A", tailPath: "A" }, "T18 Tail failure must roll back settings, run file and Tail together");
    assert.deepStrictEqual(await setCK3Folder(null, null), { success: true });
    assert.deepStrictEqual({ configuredPath, runPath, tailPath }, { configuredPath: null, runPath: null, tailPath: null }, "T18 clearing the CK3 path must stop the Tail");
  }

  {
    const harness = createHarness("large-ack");
    const manager = harness.createManager();
    manager.initializeAfterAckReconciliation();
    const action = manager.enqueueCommand({ commandId: "large-ack", owner: "action", kind: "action_effect", effectText: "add_gold = 15" });
    fs.writeFileSync(harness.debugLog, `${action.ackMarker}\n${"x".repeat(5 * 1024 * 1024)}`, "utf8");
    const restarted = harness.createManager();
    const found = scanRunAcksForPendingCommands(harness.debugLog, { fs, pendingCommands: restarted.getPendingCommands() });
    assert.deepStrictEqual(found, [{ kind: action.kind, commandId: action.commandId }], "T15 ACK beyond the old 4 MB window must be found");
    assert.strictEqual(restarted.reconcileAcknowledgedCommands(found).length, 1);

    const missedHarness = createHarness("ack-beyond-max");
    const missed = missedHarness.createManager();
    missed.initializeAfterAckReconciliation();
    const missedAction = missed.enqueueCommand({ commandId: "missed-ack", owner: "action", kind: "action_effect", effectText: "add_gold = 16" });
    fs.writeFileSync(missedHarness.debugLog, `${missedAction.ackMarker}\n${"x".repeat(256)}`, "utf8");
    const missedRestart = missedHarness.createManager();
    const noMatch = scanRunAcksForPendingCommands(missedHarness.debugLog, { fs, pendingCommands: missedRestart.getPendingCommands(), maxBytes: 32 });
    assert.deepStrictEqual(noMatch, [], "T15 ACK outside the configured scan window must not be treated as found");
    missedRestart.initializeAfterAckReconciliation();
    assert.strictEqual(missedRestart.getPendingCommands()[0].status, "stalled", "T15 missed historical ACK must stall, never replay");
    assert.strictEqual(missedRestart.getPendingCommands()[0].writeAttempts, 1);
  }

  const mainSource = fs.readFileSync(path.join(root, "resources", "app", "out", "main", "main.js"), "utf8");
  const preloadSource = fs.readFileSync(path.join(root, "resources", "app", "out", "preload", "preload.js"), "utf8");
  const ipcSource = fs.readFileSync(path.join(root, "resources", "app", "out", "main", "ipc", "register-ipc.js"), "utf8");
  const rendererSource = fs.readFileSync(path.join(root, "resources", "app", "out", "renderer", "assets", "index-Dn3qWlAB.js"), "utf8");
  const startupBlock = mainSource.slice(mainSource.indexOf("const initializeRunCommandQueue"), mainSource.indexOf("initLogger();"));
  const firstScan = startupBlock.indexOf("reconcileRecentAcks();");
  const tailStart = startupBlock.indexOf("await letterManager.startLogTailing();");
  const secondScan = startupBlock.indexOf("reconcileRecentAcks();", firstScan + 1);
  const initialize = startupBlock.indexOf("runFileManager.initializeAfterAckReconciliation();");
  assert(firstScan >= 0 && firstScan < tailStart && tailStart < secondScan && secondScan < initialize, "startup must scan, start Tail, close the scan gap, then initialize without replay");
  assert(preloadSource.includes("retryBlockedRunCommand") && preloadSource.includes("cancelBlockedRunCommand") && preloadSource.includes("retryStalledRunCommand") && preloadSource.includes("cancelStalledRunCommand"), "T10 preload must expose BLOCKED and STALLED controls");
  assert(ipcSource.includes('"letters:retryBlockedRunCommand"') && ipcSource.includes('"letters:cancelBlockedRunCommand"') && ipcSource.includes('"letters:retryStalledRunCommand"') && ipcSource.includes('"letters:cancelStalledRunCommand"'), "T10 IPC must expose BLOCKED and STALLED controls");
  assert(rendererSource.includes("这条命令尚未成功写入 CK3，因此重新尝试不会造成重复 Effect。"), "T11 UI must explain that BLOCKED retry is safe");
  assert(rendererSource.includes("CK3 是否已经执行该 Effect 无法完全确认。重新执行可能造成重复效果。"), "T10 UI must show the duplicate-effect warning");
  assert(rendererSource.includes("result?.success === false"), "T18 Renderer must not accept a failed CK3 path transaction");
  assert(!mainSource.includes("cleanLogFile"), "T13 main process must not retain debug.log cleaning");
  assert(!fs.readFileSync(path.join(root, "resources", "app", "out", "main", "conversation", "conversation.js"), "utf8").includes("cleanLogFile"), "T13 Conversation.end must not clean debug.log");

    console.log("VOTC v7.10-RC6 Run Command Recovery: PASS (T1-T18 reconciliation, crash-safe dispatch, BLOCKED/STALLED control, read-only debug.log, path transaction and chunked ACK scan)");
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
