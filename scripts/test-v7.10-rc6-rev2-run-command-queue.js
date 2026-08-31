"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createRunFileManager } = require("../resources/app/out/main/actions/run-file-manager");

const root = path.join(__dirname, "..");
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "votc-rc6-rev2-queue-"));
try {
  const ck3Dir = path.join(tempDir, "ck3");
  const dataDir = path.join(tempDir, "data");
  fs.mkdirSync(path.join(ck3Dir, "run"), { recursive: true });
  fs.writeFileSync(path.join(ck3Dir, "run", "votc.txt"), "", "utf8");
  const settingsRepository = { getCK3UserFolderPath: () => ck3Dir };
  let tick = 1000;
  const RunFileManager = createRunFileManager({ settingsRepository, path, fs, dataDir, now: () => tick++, random: () => 0.25 });
  const manager = new RunFileManager();
  manager.initializeAfterAckReconciliation();
  const action = manager.enqueueCommand({ owner: "action", kind: "action_effect", effectText: "add_gold = 1" });
  const close = manager.enqueueCommand({ owner: "conversation", kind: "conversation_close", effectText: "trigger_event = mcc_event_v2.9002" });
  const letter = manager.enqueueCommand({ owner: "letter", kind: "letter_effect", effectText: 'debug_log = "LETTER"' });

  assert.deepStrictEqual(manager.getPendingCommands().map((command) => command.owner), ["action", "conversation", "letter"], "D5 owners must share one FIFO queue");
  let text = fs.readFileSync(manager.path, "utf8");
  assert(text.includes("add_gold = 1") && !text.includes("mcc_event_v2.9002") && !text.includes("LETTER"), "only the active command may be written");
  assert(text.includes(`VOTC:RUN_ACK/ACTION_EFFECT/${action.commandId}`), "ACK must be emitted by the CK3 effect text");
  assert.strictEqual(manager.clear(), false, "normal clear must be refused while any command awaits ACK");
  assert.strictEqual(manager.ackCommand(close.commandId), null, "out-of-order ACK must not remove a queued command");

  assert(manager.ackCommand(action.commandId));
  text = fs.readFileSync(manager.path, "utf8");
  assert(text.includes("mcc_event_v2.9002") && text.includes(`VOTC:RUN_ACK/CONVERSATION_CLOSE/${close.commandId}`));
  assert(manager.ackCommand(close.commandId));
  text = fs.readFileSync(manager.path, "utf8");
  assert(text.includes('debug_log = "LETTER"') && text.includes(`VOTC:RUN_ACK/LETTER_EFFECT/${letter.commandId}`));

  const RestartedRunFileManager = createRunFileManager({ settingsRepository, path, fs, dataDir, now: () => tick++, random: () => 0.5 });
  const restarted = new RestartedRunFileManager();
  assert.strictEqual(restarted.getPendingCommands().length, 1, "D4 restart must recover the unacknowledged command");
  assert.strictEqual(restarted.getPendingCommands()[0].commandId, letter.commandId);
  restarted.initializeAfterAckReconciliation();
  assert(fs.readFileSync(restarted.path, "utf8").includes(letter.ackMarker));
  assert(restarted.ackCommand(letter.commandId));
  assert.strictEqual(fs.readFileSync(restarted.path, "utf8"), "");

  const conversationSource = fs.readFileSync(path.join(root, "resources", "app", "out", "main", "conversation", "conversation.js"), "utf8");
  const mainSource = fs.readFileSync(path.join(root, "resources", "app", "out", "main", "main.js"), "utf8");
  assert(!conversationSource.includes("Run file cleared after conversation end event"), "fixed-delay conversation cleanup must be removed");
  assert(!/setTimeout\(\(\) => \{\s*runFileManager\.clear/.test(conversationSource), "conversation close must not guess CK3 execution time");
  assert(!mainSource.includes('console.log("VOTC:EFFECT_ACCEPTED detected - clearing run file")'), "generic clipboard acceptance must not clear the shared queue");
  console.log("VOTC v7.10-RC6 Final Rev2 Run Command Queue: PASS (D4/D5 persistence, FIFO, CK3 ACK, no shared clear)");
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
