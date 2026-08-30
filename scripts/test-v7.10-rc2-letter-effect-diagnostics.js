"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createLetterManager } = require(path.join(__dirname, "..", "resources", "app", "out", "main", "letters", "letter-manager"));
const rendererSource = fs.readFileSync(path.join(__dirname, "..", "resources", "app", "out", "renderer", "assets", "index-Dn3qWlAB.js"), "utf8");

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v710-rc2-letter-diagnostics-"));
let active = false;
(async () => {
  try {
  const ck3Dir = path.join(tempDir, "ck3");
  const dataDir = path.join(tempDir, "data");
  const effectPath = path.join(ck3Dir, "run", "letters.txt");
  fs.mkdirSync(path.dirname(effectPath), { recursive: true });
  const api = createLetterManager({
    settingsRepository: {
      getCK3UserFolderPath: () => active ? ck3Dir : null,
      getCK3DebugLogPath: () => null,
      getSummaryPromptSettings: () => ({ letterSummaryPrompt: "summary" })
    },
    fs,
    path,
    TailFile: class {},
    readline: {},
    parseLog: async () => null,
    letterPromptBuilder: {},
    llmManager: {},
    PromptBuilder: {},
    TokenCounter: { estimateMessageTokens: () => 1 },
    memoryEngine: {},
    dataDir,
    sleep: async () => {},
    letterPayloadRetryDelays: []
  });
  const manager = new api.LetterManager();
  active = true;
  const initialPipeline = manager.latestPipelineStatus;
  manager.createLetterStatus({ letterId: "letter_7", totalDays: 1, delay: 3, content: "known" }, "Known NPC");

  const confirmStage = (result) => {
    assert.strictEqual(result.executionStatus, "WAITING_FOR_CK3_EXECUTION");
    manager.processLogLine(`[debug] ${result.marker}`);
    assert.strictEqual(manager.effectDiagnosticStages[result.stage].result, "ARTIFACT_VISUAL_CHECK_REQUIRED");
    const confirmed = manager.confirmEffectDiagnostic(result.stage, true);
    assert.strictEqual(confirmed.result, "PASS");
  };

  const resultA = manager.runEffectDiagnostic("A");
  assert(resultA.success);
  let effect = fs.readFileSync(effectPath, "utf8");
  assert(effect.includes('name = "VOTC_TEST"') && effect.includes('description = "TEST LETTER"'));
  assert(effect.includes("creator = root"));
  assert(effect.includes("save_scope_as = votc_test_letter"));
  assert(!effect.includes("trigger_event"));
  assert(effect.includes(resultA.marker));
  const lockedB = manager.runEffectDiagnostic("B", "letter_7");
  assert.strictEqual(lockedB.success, false, "B must remain locked until A is confirmed");
  confirmStage(resultA);

  const resultB = manager.runEffectDiagnostic("B", "letter_7");
  assert(resultB.success && resultB.creatorScopeName === "global_var:message_second_scope_letter_7");
  effect = fs.readFileSync(effectPath, "utf8");
  assert(effect.includes("creator = global_var:message_second_scope_letter_7"));
  assert(!effect.includes("creator = root"), "B must not fall back to root");
  confirmStage(resultB);

  const resultC = manager.runEffectDiagnostic("C", "letter_7");
  assert(resultC.success);
  effect = fs.readFileSync(effectPath, "utf8");
  assert(effect.includes("save_scope_as = votc_latest_letter"));
  assert(effect.includes("set_global_variable = {\n\tname = votc_latest_letter\n\tvalue = scope:votc_latest_letter\n}"));
  assert(!effect.includes("trigger_event"));
  confirmStage(resultC);

  const resultD = manager.runEffectDiagnostic("D", "letter_7");
  assert(resultD.success);
  effect = fs.readFileSync(effectPath, "utf8");
  assert(effect.includes("trigger_event = message_event.362"));
  confirmStage(resultD);
  assert.strictEqual(manager.awaitingAcceptanceLetterId, null, "diagnostics must not mutate real pending delivery");
  assert.strictEqual(manager.latestPipelineStatus, initialPipeline, "diagnostics must not mutate the reply/summary pipeline");
  let diagnostics = manager.getAllLetterStatuses();
  assert.strictEqual(diagnostics.effectPayloadPresent, true);
  assert.strictEqual(diagnostics.effectContainsCreateArtifact, true);
  assert.strictEqual(diagnostics.effectContainsMessageEvent362, true);
  assert.strictEqual(diagnostics.creatorScopeName, "global_var:message_second_scope_letter_7");
  assert.strictEqual(diagnostics.creatorScopeExpected, "global_var:message_second_scope_letter_7");

  fs.writeFileSync(effectPath, 'debug_log = "VOTC:LETTER_ACCEPTED"', "utf8");
  diagnostics = manager.getAllLetterStatuses();
  assert.strictEqual(diagnostics.effectPayloadPresent, false, "debug logs alone are not a letter payload");
  assert.strictEqual(diagnostics.effectContainsCreateArtifact, false);
  assert.strictEqual(diagnostics.effectContainsMessageEvent362, false);

  const originalNow = Date.now;
  try {
    Date.now = () => 1000;
    const letter = { letterId: "letter_ack", totalDays: 1, delay: 0, content: "ack test" };
    manager.createLetterStatus(letter, "NPC");
    assert.strictEqual(await manager.writeLetterEffect("reply", letter), true);
    Date.now = () => 1300;
    await manager.clearLettersFile();
  } finally {
    Date.now = originalNow;
  }
  const status = manager.getLetterStatus("letter_ack");
  assert.strictEqual(status.effectFileWrittenAt, 1000);
  assert.strictEqual(status.popupTriggeredAt, 1300);
  assert.strictEqual(status.letterAcceptedAt, 1300);
  assert.strictEqual(status.acceptLatencyMs, 300);
  assert.strictEqual(status.suspiciousImmediateLetterAcceptance, true);
  assert.strictEqual(status.suspicious_immediate_letter_acceptance, true);
  diagnostics = manager.getAllLetterStatuses();
  assert.strictEqual(diagnostics.popupTriggeredAt, 1300);
  assert.strictEqual(diagnostics.suspicious_immediate_letter_acceptance, true);
  assert(rendererSource.includes("选择 Known Letter ID（B/C/D 必填）"), "diagnostic UI must use a known-letter dropdown");
  assert(rendererSource.includes("文件写入不代表 CK3 已执行"), "diagnostic UI must distinguish WRITE from EXECUTE");
  assert(rendererSource.includes("🔒 ${getDiagnosticDisableReason(stage)}"), "diagnostic UI must visibly explain disabled stages");
  assert(rendererSource.includes("可见结果通过"), "diagnostic UI must require a manual visible-result confirmation");
  assert(rendererSource.includes('snapshot?.lastEffectDiagnostic?.result !== "WAITING_FOR_CK3_EXECUTION"'), "diagnostic UI must poll while waiting for the CK3 execution marker");
  console.log("VOTC v7.10-RC3 Letter Effect Diagnostics 2.2: PASS (WRITE/EXECUTE/VERIFY, ordered unlock, payload truth and ACK timing)");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
