"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createRunFileManager } = require("../resources/app/out/main/actions/run-file-manager");
const { createLetterEffectTransport } = require("../resources/app/out/main/letters/letter-effect-transport");
const { createLetterManager } = require("../resources/app/out/main/letters/letter-manager");

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v710-rc6-artifact-"));
try {
  const ck3Dir = path.join(tempDir, "ck3");
  const dataDir = path.join(tempDir, "data");
  const runDir = path.join(ck3Dir, "run");
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, "votc.txt"), "", "utf8");
  let active = true;
  const settingsRepository = { getCK3UserFolderPath: () => active ? ck3Dir : null, getCK3DebugLogPath: () => null, getSummaryPromptSettings: () => ({ letterSummaryPrompt: "summary" }) };
  const RunFileManager = createRunFileManager({ settingsRepository, fs, path, dataDir });
  const runFileManager = new RunFileManager();
  runFileManager.initializeAfterAckReconciliation();
  const { LetterEffectTransport } = createLetterEffectTransport({ settingsRepository, fs, path, runFileManager, dataDir });
  const transport = new LetterEffectTransport();
  active = false;
  const { LetterManager } = createLetterManager({
    settingsRepository, fs, path, TailFile: class {}, readline: {}, parseLog: async () => null,
    letterPromptBuilder: {}, llmManager: {}, PromptBuilder: {}, TokenCounter: {}, memoryEngine: {}, dataDir,
    letterEffectTransport: transport, runFileManager, diagnosticExecutionTimeoutMs: 10,
    setIntervalFn: () => ({ unref() {} }), clearIntervalFn: () => {}
  });
  const manager = new LetterManager();
  active = true;
  manager.effectDiagnosticStages.A2 = { result: "PASS" };
  const originalNow = Date.now;
  let now = 1000;
  Date.now = () => now;
  try {
    let a3 = manager.runEffectDiagnostic("A3");
    let text = fs.readFileSync(path.join(runDir, "votc.txt"), "utf8");
    assert(text.startsWith(`root = {\n\tdebug_log = "${a3.marker}"`), "A3 must use explicit root character scope");
    for (const field of ["type = journal", "visuals = scroll", "creator = root", "modifier = artifact_monthly_minor_prestige_1_modifier", "wealth = scope:wealth", "save_scope_as = votc_test_letter"]) assert(text.includes(field), `A3 missing official parity field: ${field}`);
    assert(text.includes(a3.postMarker) && text.includes(a3.scopeMarker));
    now += 11;
    manager.getAllLetterStatuses();
    assert.strictEqual(manager.effectDiagnosticStages.A3.result, "RUN_FILE_NOT_EXECUTED");

    a3 = manager.runEffectDiagnostic("A3");
    manager.processLogLine(a3.marker);
    now += 11;
    manager.getAllLetterStatuses();
    assert.strictEqual(manager.effectDiagnosticStages.A3.result, "ARTIFACT_EFFECT_ABORTED");

    a3 = manager.runEffectDiagnostic("A3");
    manager.processLogLine(a3.marker);
    manager.processLogLine(a3.postMarker);
    now += 11;
    manager.getAllLetterStatuses();
    assert.strictEqual(manager.effectDiagnosticStages.A3.result, "ARTIFACT_SCOPE_NOT_CREATED");

    a3 = manager.runEffectDiagnostic("A3");
    manager.processLogLine(a3.marker);
    manager.processLogLine(a3.scopeMarker);
    manager.processLogLine(a3.postMarker);
    assert.strictEqual(manager.effectDiagnosticStages.A3.result, "A3_VISUAL_CHECK_REQUIRED");
    assert.strictEqual(manager.confirmEffectDiagnostic("A3", false).result, "ARTIFACT_NOT_VISIBLE");

    a3 = manager.runEffectDiagnostic("A3");
    manager.processLogLine(a3.marker);
    manager.processLogLine(a3.scopeMarker);
    manager.processLogLine(a3.postMarker);
    assert.strictEqual(manager.confirmEffectDiagnostic("A3", true).result, "PASS");

    const formal = manager.buildOfficialLetterEffectBody("Reply", { letterId: "letter_1" });
    assert(formal.includes("creator = global_var:message_second_scope_letter_1"));
    assert(formal.includes("save_scope_as = votc_latest_letter"));
    assert(formal.includes("trigger_event = message_event.362"));
    assert(!formal.startsWith("root = {"), "formal Letter Effect semantics must remain unchanged");
  } finally {
    Date.now = originalNow;
  }
  console.log("VOTC v7.10-RC6 Artifact Parity: PASS (root scope, official recipe, PRE/POST/Scope and classified failures)");
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
