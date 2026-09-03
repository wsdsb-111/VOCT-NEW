"use strict";

const assert = require("assert");
const events = require("events");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createRunFileManager } = require("../resources/app/out/main/actions/run-file-manager");
const { createConversationManager } = require("../resources/app/out/main/conversation/conversation-manager");

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v842-run-command-lifecycle-"));

function createHarness(name) {
  const baseDir = path.join(tempRoot, name);
  const ck3Dir = path.join(baseDir, "ck3");
  const dataDir = path.join(baseDir, "data");
  const runFile = path.join(ck3Dir, "run", "votc.txt");
  fs.mkdirSync(path.dirname(runFile), { recursive: true });
  fs.writeFileSync(runFile, "", "utf8");
  let clock = 1000;
  const settingsRepository = { getCK3UserFolderPath: () => ck3Dir };
  return {
    dataDir,
    runFile,
    setClock: (value) => { clock = value; },
    advance: (milliseconds) => { clock += milliseconds; },
    now: () => clock,
    createManager: () => {
      const RunFileManager = createRunFileManager({ settingsRepository, path, fs, dataDir, now: () => clock, random: () => 0.25 });
      return new RunFileManager();
    }
  };
}

function createCommandManager(harness) {
  const manager = harness.createManager();
  manager.initializeAfterAckReconciliation();
  return manager;
}

async function run() {
  try {
    {
      const harness = createHarness("metadata-and-dedupe");
      const manager = createCommandManager(harness);
      const action = manager.enqueueCommand({ commandId: "action-a", owner: "action", kind: "action_effect", effectText: "add_gold = 1" });
      const close = manager.enqueueCommand({ commandId: "close-a", owner: "conversation", kind: "conversation_close", effectText: "trigger_event = mcc_event_v2.9002", scopeId: "conversation-a", epoch: 1 });
      const duplicate = manager.enqueueCommand({ commandId: "close-duplicate", owner: "conversation", kind: "conversation_close", effectText: "trigger_event = mcc_event_v2.9002", scopeId: "conversation-a", epoch: 1 });
      assert.strictEqual(duplicate.commandId, close.commandId, "same conversation scope must deduplicate pending close commands");
      assert.strictEqual(close.expiresAt, close.queuedAt + 15000, "conversation close must receive a 15 second TTL");
      assert.strictEqual(close.destructive, true);
      assert.strictEqual(close.supersedable, true);
      assert.strictEqual(action.status, "awaiting_ack");
      assert.strictEqual(JSON.parse(fs.readFileSync(path.join(harness.dataDir, "run-command-queue.json"), "utf8")).version, 3, "new queue state must use version 3");
    }

    {
      const harness = createHarness("expired-close-releases-queue");
      const manager = createCommandManager(harness);
      const close = manager.enqueueCommand({ commandId: "close-timeout", owner: "conversation", kind: "conversation_close", effectText: "trigger_event = mcc_event_v2.9002", scopeId: "conversation-timeout", epoch: 1 });
      const action = manager.enqueueCommand({ commandId: "action-after-close", owner: "action", kind: "action_effect", effectText: "add_gold = 2" });
      harness.advance(15001);
      const result = manager.markActiveCommandStalledIfNeeded({ ackTimeoutMs: 30000 });
      assert.strictEqual(result.status, "quarantined", "expired conversation close must be quarantined before it can execute");
      assert.strictEqual(manager.getPendingCommands()[0].commandId, action.commandId, "quarantined close must release the FIFO head");
      assert(!fs.readFileSync(harness.runFile, "utf8").includes(close.ackMarker), "expired close must not remain in the executable carrier");
      assert(fs.readFileSync(harness.runFile, "utf8").includes(action.ackMarker), "the next action may be dispatched after close quarantine");
      assert.strictEqual(manager.getRecentCommands().at(-1).status, "quarantined");
    }

    {
      const harness = createHarness("epoch-supersede-and-late-ack");
      const manager = createCommandManager(harness);
      manager.setCurrentConversationEpoch(1);
      const close = manager.enqueueCommand({ commandId: "close-old", owner: "conversation", kind: "conversation_close", effectText: "trigger_event = mcc_event_v2.9002", scopeId: "conversation-old", epoch: 1 });
      const superseded = manager.setCurrentConversationEpoch(2);
      assert.strictEqual(superseded.length, 1);
      assert.strictEqual(superseded[0].status, "quarantined", "a newer conversation epoch must quarantine the old close");
      assert.strictEqual(manager.getPendingCommands().length, 0);
      assert.strictEqual(fs.readFileSync(harness.runFile, "utf8"), "", "superseded close must neutralize its carrier");
      assert.strictEqual(manager.ackCommand(close.commandId, close.kind), null, "ACK after quarantine must not revive the old close");
      assert.strictEqual(manager.getQueueHealth().lateAckCount, 1);
    }

    {
      const harness = createHarness("startup-neutralize");
      const first = createCommandManager(harness);
      const close = first.enqueueCommand({ commandId: "startup-close", owner: "conversation", kind: "conversation_close", effectText: "trigger_event = mcc_event_v2.9002", scopeId: "startup-conversation", epoch: 1 });
      assert(fs.readFileSync(harness.runFile, "utf8").includes(close.ackMarker));
      const restarted = harness.createManager();
      restarted.initializeAfterAckReconciliation();
      assert.strictEqual(restarted.getPendingCommands().length, 0, "startup must not retain an unconfirmed destructive close as a runnable head");
      assert.strictEqual(restarted.getRecentCommands().at(-1).status, "quarantined");
      assert.strictEqual(fs.readFileSync(harness.runFile, "utf8"), "", "startup recovery must neutralize the stale close carrier");
    }

    {
      const harness = createHarness("startup-action-carrier");
      const first = createCommandManager(harness);
      const action = first.enqueueCommand({ commandId: "startup-action", owner: "action", kind: "action_effect", effectText: "add_gold = 3" });
      const restarted = harness.createManager();
      restarted.initializeAfterAckReconciliation();
      assert.strictEqual(restarted.getPendingCommands()[0].status, "stalled", "unconfirmed ordinary action must remain durable STALLED");
      assert.strictEqual(fs.readFileSync(harness.runFile, "utf8"), "", "startup must neutralize an unconfirmed ordinary action carrier");
      const retry = restarted.retryStalledCommand(action.commandId);
      assert.strictEqual(retry.status, "awaiting_ack", "ordinary action retry still requires explicit authorization");
      assert.strictEqual(retry.writeAttempts, 2);
    }

    {
      const harness = createHarness("startup-queued-close");
      fs.mkdirSync(harness.dataDir, { recursive: true });
      fs.writeFileSync(path.join(harness.dataDir, "run-command-queue.json"), JSON.stringify({
        version: 3,
        pendingCommands: [
          {
            commandId: "queued-close",
            owner: "conversation",
            kind: "conversation_close",
            effectText: "trigger_event = mcc_event_v2.9002",
            scopeId: "queued-conversation",
            epoch: 1,
            queuedAt: 1000,
            expiresAt: 16000,
            status: "queued",
            writeAttempts: 0
          },
          {
            commandId: "queued-action-after-close",
            owner: "action",
            kind: "action_effect",
            effectText: "add_gold = 4",
            queuedAt: 1000,
            status: "queued",
            writeAttempts: 0
          }
        ],
        recentCommands: []
      }), "utf8");
      const manager = harness.createManager();
      manager.initializeAfterAckReconciliation();
      assert.strictEqual(manager.getRecentCommands().find((command) => command.commandId === "queued-close").status, "expired", "startup must expire an unexecuted destructive close instead of replaying it");
      assert.strictEqual(manager.getPendingCommands()[0].commandId, "queued-action-after-close");
      assert(fs.readFileSync(harness.runFile, "utf8").includes("queued-action-after-close"), "startup may dispatch the next safe queued command after removing the close");
      assert(!fs.readFileSync(harness.runFile, "utf8").includes("queued-close"), "startup must never write a queued stale close carrier");
    }

    {
      const harness = createHarness("carrier-mismatch");
      const manager = createCommandManager(harness);
      const action = manager.enqueueCommand({ commandId: "carrier-owner", owner: "action", kind: "action_effect", effectText: "add_gold = 5" });
      fs.writeFileSync(harness.runFile, 'debug_log = "VOTC:RUN_ACK/ACTION_EFFECT/another-command"', "utf8");
      assert.strictEqual(manager.neutralizeExecutableFile({ expectedCommandId: action.commandId, command: action, reason: "mismatch-test" }), false, "neutralize must refuse a carrier belonging to another command");
      assert(fs.readFileSync(harness.runFile, "utf8").includes("another-command"), "carrier mismatch must not clear unrelated executable content");
    }

    {
      const harness = createHarness("legacy-v2-migration");
      fs.mkdirSync(harness.dataDir, { recursive: true });
      fs.writeFileSync(path.join(harness.dataDir, "run-command-queue.json"), JSON.stringify({
        version: 2,
        pendingCommands: [{
          commandId: "legacy-close",
          owner: "conversation",
          kind: "conversation_close",
          effectText: "trigger_event = mcc_event_v2.9002",
          scopeId: "legacy-conversation",
          status: "stalled",
          queuedAt: 100,
          writtenAt: 100,
          writeAttempts: 1
        }],
        recentCommands: []
      }), "utf8");
      fs.writeFileSync(harness.runFile, 'debug_log = "VOTC:RUN_ACK/CONVERSATION_CLOSE/legacy-close"', "utf8");
      const manager = harness.createManager();
      manager.initializeAfterAckReconciliation();
      const persisted = JSON.parse(fs.readFileSync(path.join(harness.dataDir, "run-command-queue.json"), "utf8"));
      assert.strictEqual(persisted.version, 3, "legacy v2 queue must migrate to version 3");
      assert.strictEqual(persisted.recentCommands.at(-1).status, "quarantined", "legacy stalled close must be quarantined on startup");
      assert.strictEqual(fs.readFileSync(harness.runFile, "utf8"), "", "legacy stalled close carrier must be neutralized");
    }

    {
      const callbacks = [];
      const epochs = [];
      class FinalizationCoordinator {
        constructor() {
          this.pendingCount = 0;
        }
        enqueue(id, callback) {
          callbacks.push({ id, callback });
          this.pendingCount += 1;
          return Promise.resolve({ id });
        }
        drain() {
          return Promise.resolve({ pendingCount: this.pendingCount });
        }
      }
      let sequence = 0;
      class FakeConversation {
        constructor(options) {
          this.id = `conversation-${++sequence}`;
          this.options = options;
          this.finalizeOptions = null;
        }
        onConversationUpdate() {}
        finalizeConversation(options) {
          this.finalizeOptions = options;
          return Promise.resolve({ success: true });
        }
      }
      const ConversationManager = createConversationManager({
        events,
        memorySystem: { FinalizationCoordinator },
        Conversation: FakeConversation,
        PromptBuilder: {},
        createActionFeedback: () => null,
        logVerboseLLM: () => {},
        runFileManager: { setCurrentConversationEpoch: (epoch) => { epochs.push(epoch); return []; } }
      });
      const manager = new ConversationManager();
      const first = manager.createConversation();
      const second = manager.createConversation();
      assert.deepStrictEqual(epochs, [1, 2], "new conversations must advance the lifecycle epoch");
      assert.strictEqual(first.options.conversationEpoch, 1);
      assert.strictEqual(second.options.conversationEpoch, 2);
      await callbacks[0].callback();
      assert.strictEqual(first.finalizeOptions.closeGameScene, false, "rollover finalization must not close the new CK3 scene");
      assert.strictEqual(first.finalizeOptions.reason, "superseded_by_new_conversation");
      manager.endCurrentConversation();
      await callbacks[1].callback();
      assert.strictEqual(second.finalizeOptions.closeGameScene, true, "normal end must retain the scene close command");
    }

    console.log("VOTC v8.4.2 Run Command Lifecycle: PASS (v3 metadata, TTL, epoch supersede, carrier neutralization, startup quarantine, late ACK and rollover isolation)");
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
