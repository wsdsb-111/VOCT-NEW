"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createRunFileManager } = require("../resources/app/out/main/actions/run-file-manager");
const { createLetterEffectTransport } = require("../resources/app/out/main/letters/letter-effect-transport");

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v710-rc4-runfile-"));
try {
  const ck3Dir = path.join(tempDir, "ck3");
  const dataDir = path.join(tempDir, "data");
  const runDir = path.join(ck3Dir, "run");
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, "votc.txt"), "", "utf8");
  const settingsRepository = { getCK3UserFolderPath: () => ck3Dir };
  const RunFileManager = createRunFileManager({ settingsRepository, path, fs, dataDir, now: () => 100, random: () => 0.5 });
  const runFileManager = new RunFileManager();
  runFileManager.initializeAfterAckReconciliation();
  const actionEffect = "scope:action_target = { add_gold = 10 }";
  const actionCommand = runFileManager.write(actionEffect, { owner: "action", kind: "action_effect" });
  let text = fs.readFileSync(runFileManager.path, "utf8");
  assert(text.includes(actionEffect));
  assert(text.includes(`VOTC:RUN_ACK/ACTION_EFFECT/${actionCommand.commandId}`));
  assert(text.includes("root = {trigger_event = mcc_event_v2.9003}"));

  const { LetterEffectTransport, LetterEffectTransportMode } = createLetterEffectTransport({ settingsRepository, fs, path, runFileManager, dataDir });
  const transport = new LetterEffectTransport();
  const letterMarker = 'debug_log = "VOTC:LETTER_TRANSPORT/B/nonreg"';
  const letterCommand = transport.writeDiagnosticEffect(letterMarker, LetterEffectTransportMode.VOTC);
  assert(letterCommand.success);
  assert.strictEqual(runFileManager.getPendingCommands().length, 2, "Action and Letter must share one serial queue");
  text = fs.readFileSync(runFileManager.path, "utf8");
  assert(text.includes(actionEffect), "active Action command must not be overwritten by queued Letter command");
  assert(!text.includes(letterMarker), "queued Letter command must wait for Action ACK");

  assert.strictEqual(runFileManager.ackCommand("wrong-command"), null, "unrelated ACK must not advance the queue");
  assert(runFileManager.ackCommand(actionCommand.commandId));
  text = fs.readFileSync(runFileManager.path, "utf8");
  assert(text.includes(letterMarker), "matching Action ACK must promote the queued Letter command");
  assert(text.includes(`VOTC:RUN_ACK/LETTER_DIAGNOSTIC/${letterCommand.commandId}`));
  assert(runFileManager.ackCommand(letterCommand.commandId));
  assert.strictEqual(fs.readFileSync(runFileManager.path, "utf8"), "");
  console.log("VOTC v7.10-RC6 Rev2 RunFile Non-regression: PASS (shared serial queue, command ACK, no overwrite)");
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
