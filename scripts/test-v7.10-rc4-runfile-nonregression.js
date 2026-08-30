"use strict";

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const runFileSourcePath = path.join(__dirname, "..", "resources", "app", "out", "main", "actions", "run-file-manager.js");
const { createRunFileManager } = require(runFileSourcePath);
const { createLetterEffectTransport } = require("../resources/app/out/main/letters/letter-effect-transport");

const expectedRc3Hash = "664a1248e7f1122ba326d5b90788d0fbf896bd60ee8aca6f87e8daaa2d3b7a65";
assert.strictEqual(crypto.createHash("sha256").update(fs.readFileSync(runFileSourcePath)).digest("hex"), expectedRc3Hash, "RC4 must not modify the RC3 Action RunFileManager implementation");

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v710-rc4-runfile-"));
try {
  const ck3Dir = path.join(tempDir, "ck3");
  const runDir = path.join(ck3Dir, "run");
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, "votc.txt"), "", "utf8");
  const settingsRepository = { getCK3UserFolderPath: () => ck3Dir };
  const RunFileManager = createRunFileManager({ settingsRepository, path, fs });
  const runFileManager = new RunFileManager();
  const actionEffect = "scope:action_target = { add_gold = 10 }";
  runFileManager.write(actionEffect);
  let text = fs.readFileSync(runFileManager.path, "utf8");
  assert(text.includes(actionEffect));
  assert(text.includes("root = {trigger_event = mcc_event_v2.9003}"));

  const { LetterEffectTransport, LetterEffectTransportMode } = createLetterEffectTransport({ settingsRepository, fs, path, runFileManager, dataDir: path.join(tempDir, "data") });
  const transport = new LetterEffectTransport();
  const letterMarker = 'debug_log = "VOTC:LETTER_TRANSPORT/B/nonreg"';
  assert(transport.writeDiagnosticEffect(letterMarker, LetterEffectTransportMode.VOTC).success);
  text = fs.readFileSync(runFileManager.path, "utf8");
  assert(text.includes(letterMarker));
  assert(text.includes(actionEffect), "Letter transport must preserve existing Action commands in votc.txt");
  assert(text.includes("root = {trigger_event = mcc_event_v2.9003}"), "Letter transport must preserve Action root trigger contract");
  console.log("VOTC v7.10-RC4 RunFile Non-regression: PASS (RC3 source hash, Action command preservation, root contract)");
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
