"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createRunFileManager } = require("../resources/app/out/main/actions/run-file-manager");
const { createLetterEffectTransport } = require("../resources/app/out/main/letters/letter-effect-transport");
const { createLetterManager } = require("../resources/app/out/main/letters/letter-manager");

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v710-rc4-diag23-"));
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
  const RunFileManager = createRunFileManager({ settingsRepository, path, fs });
  const runFileManager = new RunFileManager();
  const { LetterEffectTransport } = createLetterEffectTransport({ settingsRepository, fs, path, runFileManager, dataDir });
  const transport = new LetterEffectTransport();
  active = false;
  const { LetterManager } = createLetterManager({
    settingsRepository, fs, path, TailFile: class {}, readline: {}, parseLog: async () => null,
    letterPromptBuilder: {}, llmManager: {}, PromptBuilder: {}, TokenCounter: {}, memoryEngine: {}, dataDir,
    letterEffectTransport: transport, diagnosticExecutionTimeoutMs: 10,
    setIntervalFn: () => ({ unref() {} }), clearIntervalFn: () => {}
  });
  const manager = new LetterManager();
  active = true;
  const originalNow = Date.now;
  let now = 1000;
  Date.now = () => now;
  try {
    const a1 = manager.runEffectDiagnostic("A1");
    assert(a1.success);
    const lettersText = fs.readFileSync(path.join(runDir, "letters.txt"), "utf8");
    assert.strictEqual(lettersText, `debug_log = "${a1.marker}"`, "A1 must contain only its transport marker");
    assert.strictEqual(manager.runEffectDiagnostic("A2").success, false, "A2 must remain locked before A1 is decided");
    now += 11;
    manager.getAllLetterStatuses();
    assert.strictEqual(manager.effectDiagnosticStages.A1.result, "RUN_FILE_NOT_EXECUTED");

    const a2 = manager.runEffectDiagnostic("A2");
    assert(a2.success);
    assert(fs.readFileSync(path.join(runDir, "votc.txt"), "utf8").includes(`debug_log = "${a2.marker}"`));
    assert.strictEqual(manager.runEffectDiagnostic("A3").success, false, "A3 must remain locked before A2 PASS");
    manager.processLogLine(`[debug] ${a2.marker}`);
    assert.strictEqual(manager.effectDiagnosticStages.A2.result, "PASS");
    assert.strictEqual(transport.getState().contractDriftConfirmed, true);
    assert(!fs.readFileSync(path.join(runDir, "votc.txt"), "utf8").includes(a2.marker), "completed transport diagnostics must be removed without clearing the root contract");

    const confirmArtifact = (result) => {
      manager.processLogLine(`[debug] ${result.marker}`);
      if (result.stage === "A3") {
        manager.processLogLine(`[debug] ${result.scopeMarker}`);
        manager.processLogLine(`[debug] ${result.postMarker}`);
        assert.strictEqual(manager.effectDiagnosticStages[result.stage].result, "A3_VISUAL_CHECK_REQUIRED");
      } else {
        assert.strictEqual(manager.effectDiagnosticStages[result.stage].result, "ARTIFACT_VISUAL_CHECK_REQUIRED");
      }
      assert(!fs.readFileSync(path.join(runDir, "votc.txt"), "utf8").includes(result.marker), "executed artifact diagnostics must not pollute the next stage");
      assert.strictEqual(manager.confirmEffectDiagnostic(result.stage, true).result, "PASS");
    };
    const a3 = manager.runEffectDiagnostic("A3");
    assert(a3.success && a3.creatorScopeName === "root");
    let text = fs.readFileSync(path.join(runDir, "votc.txt"), "utf8");
    assert(text.startsWith(`root = {\n\tdebug_log = "${a3.marker}"\n\tcreate_artifact = {`));
    assert(text.includes("creator = root"));
    assert(text.includes("modifier = artifact_monthly_minor_prestige_1_modifier"));
    assert(text.includes("wealth = scope:wealth"));
    confirmArtifact(a3);

    const letter = { letterId: "letter_23", content: "known", totalDays: 1, delay: 0 };
    manager.createLetterStatus(letter, "Known NPC");
    assert.strictEqual(manager.getAllLetterStatuses().diagnosticDisableReasons.B, null, "Known Letter dropdown selection must be able to unlock B after A3 PASS");
    for (const stage of ["B", "C", "D"]) {
      const result = manager.runEffectDiagnostic(stage, letter.letterId);
      assert(result.success, `${stage} must unlock in order`);
      text = fs.readFileSync(path.join(runDir, "votc.txt"), "utf8");
      assert(text.startsWith(`debug_log = "${result.marker}"`));
      if (stage === "B") assert(text.includes("creator = global_var:message_second_scope_letter_23"));
      if (stage === "C") assert(text.includes("set_global_variable = {"));
      if (stage === "D") assert(text.includes("trigger_event = message_event.362"));
      confirmArtifact(result);
    }
    manager.awaitingAcceptanceLetterId = letter.letterId;
    assert.strictEqual(manager.runEffectDiagnostic("A1").success, false, "formal delivery busy state must block diagnostics");
  } finally {
    Date.now = originalNow;
  }

  const renderer = fs.readFileSync(path.join(__dirname, "..", "resources", "app", "out", "renderer", "assets", "index-Dn3qWlAB.js"), "utf8");
  assert(renderer.includes("A1 → A2 → A3 → B → C → D"));
  assert(renderer.includes("选择 Known Letter ID（B/C/D 必填）"));
  assert(renderer.includes('snapshot?.letterTransport?.outboundMode'));
  console.log("VOTC v7.10-RC4 Letter Diagnostic 2.3: PASS (A1/A2/A3/B/C/D strict sequence and busy lock)");
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
