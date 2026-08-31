"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createRunFileManager } = require("../resources/app/out/main/actions/run-file-manager");
const { createLetterEffectTransport } = require("../resources/app/out/main/letters/letter-effect-transport");
const { createLetterManager } = require("../resources/app/out/main/letters/letter-manager");

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v710-rc4-transport-"));
try {
  const ck3Dir = path.join(tempDir, "ck3");
  const dataDir = path.join(tempDir, "data");
  const runDir = path.join(ck3Dir, "run");
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, "votc.txt"), "", "utf8");
  let active = true;
  const settingsRepository = {
    getCK3UserFolderPath: () => active ? ck3Dir : null,
    getCK3DebugLogPath: () => null,
    getSummaryPromptSettings: () => ({ letterSummaryPrompt: "summary" })
  };
  const RunFileManager = createRunFileManager({ settingsRepository, path, fs, dataDir });
  const runFileManager = new RunFileManager();
  runFileManager.initializeAfterAckReconciliation();
  const { LetterEffectTransport, LetterEffectTransportMode } = createLetterEffectTransport({ settingsRepository, fs, path, runFileManager, dataDir });
  const transport = new LetterEffectTransport();

  const legacy = transport.writeDiagnosticEffect('debug_log = "VOTC:LETTER_TRANSPORT/A/test-a"', LetterEffectTransportMode.LEGACY);
  assert(legacy.success);
  assert.strictEqual(fs.readFileSync(path.join(runDir, "letters.txt"), "utf8"), 'debug_log = "VOTC:LETTER_TRANSPORT/A/test-a"', "T01 legacy diagnostic must be marker-only in letters.txt");
  transport.recordTransportDiagnostic("A1", "RUN_FILE_NOT_EXECUTED");
  assert.strictEqual(transport.getOutboundMode(), LetterEffectTransportMode.VOTC, "T02 RC6 fixes formal outbound transport to votc.txt independently of legacy diagnostic results");

  const votc = transport.writeDiagnosticEffect('debug_log = "VOTC:LETTER_TRANSPORT/B/test-b"', LetterEffectTransportMode.VOTC);
  assert(votc.success);
  const votcText = fs.readFileSync(path.join(runDir, "votc.txt"), "utf8");
  assert(votcText.includes('debug_log = "VOTC:LETTER_TRANSPORT/B/test-b"'));
  assert(votcText.includes("root = {trigger_event = mcc_event_v2.9003}"), "T03/T04 votc transport must preserve the existing RunFileManager root trigger contract");
  assert(votcText.includes(`VOTC:RUN_ACK/LETTER_DIAGNOSTIC/${votc.commandId}`), "Rev2 must append a command-specific CK3 ACK marker");
  assert(runFileManager.ackCommand(votc.commandId), "diagnostic command must advance only after its matching ACK");
  transport.recordTransportDiagnostic("A2", "PASS");
  assert.strictEqual(transport.getOutboundMode(), LetterEffectTransportMode.VOTC, "T06 migration requires actual A1 FAIL + A2 PASS");
  assert.strictEqual(transport.getState().contractDriftConfirmed, true);

  active = false;
  const { LetterManager } = createLetterManager({
    settingsRepository, fs, path, TailFile: class {}, readline: {}, parseLog: async () => null,
    letterPromptBuilder: {}, llmManager: {}, PromptBuilder: {}, TokenCounter: {}, memoryEngine: {}, dataDir,
    letterEffectTransport: transport, runFileManager, setIntervalFn: () => ({ unref() {} }), clearIntervalFn: () => {}
  });
  const manager = new LetterManager();
  active = true;
  const letter = { letterId: "letter_42", content: "Original", totalDays: 100, delay: 0 };
  const expectedBody = `debug_log = "[Localize('talk_event.9999.desc')]"
remove_global_variable ?= votc_letter_42
create_artifact = {
	name = votc_huixin_title42
	description = "Reply"
	type = journal
  	visuals = scroll
  	creator = global_var:message_second_scope_letter_42
  	modifier = artifact_monthly_minor_prestige_1_modifier
	wealth = scope:wealth
	save_scope_as = votc_latest_letter
}
scope:votc_latest_letter = {
set_variable = { name = votc_letter_artifact value = yes}
}
set_global_variable = {
	name = votc_latest_letter
	value = scope:votc_latest_letter
}
trigger_event = message_event.362`;
  assert.strictEqual(manager.buildOfficialLetterEffectBody("Reply", letter), expectedBody, "T05 official Letter Effect Body must remain byte-for-byte unchanged");
  manager.createLetterStatus(letter, "NPC");
  assert(manager.writeLetterEffect("Reply", letter) instanceof Promise);
  assert.strictEqual(manager.getLetterStatus(letter.letterId).effectTransportMode, LetterEffectTransportMode.VOTC);
  assert(fs.readFileSync(path.join(runDir, "votc.txt"), "utf8").includes(expectedBody));

  manager.storedLetters.set(letter.letterId, { letter, reply: "Reply", expectedDeliveryDay: 100, characterName: "NPC" });
  const cleared = manager.clearPendingLetters();
  assert.strictEqual(cleared.success, true);
  assert.strictEqual(cleared.clearedPendingCount, 1);
  assert.strictEqual(manager.storedLetters.size, 0);
  assert.strictEqual(manager.awaitingAcceptanceLetterId, null);
  assert.strictEqual(manager.getLetterStatus(letter.letterId).responseStatus, "cancelled", "one-click clear must release pending delivery without deleting its status history");
  const afterClear = fs.readFileSync(path.join(runDir, "votc.txt"), "utf8");
  assert(!afterClear.includes(expectedBody), "one-click clear must remove the pending Letter Effect");
  assert.strictEqual(afterClear, "", "one-click clear may cancel its own queued Letter command after the earlier diagnostic was ACKed");
  console.log("VOTC v7.10-RC4 Letter Transport: PASS (T01-T06 + one-click pending clear)");
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
