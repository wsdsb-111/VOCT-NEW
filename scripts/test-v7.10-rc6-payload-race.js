"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createLetterManager } = require("../resources/app/out/main/letters/letter-manager");

function gameData(letterData) {
  return {
    letterData,
    playerID: 1,
    playerName: "Player",
    date: "1066.1.1",
    totalDays: 100,
    getAi: () => ({ id: 2, fullName: "NPC", shortName: "NPC" }),
    loadCharactersSummaries() {},
    saveCharacterSummary() {}
  };
}

function createManager(parseLog, retryDelays = [100, 200, 350, 600, 1e3]) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v710-rc6-payload-"));
  const ck3Dir = path.join(tempDir, "ck3");
  const debugLogPath = path.join(ck3Dir, "logs", "debug.log");
  fs.mkdirSync(path.dirname(debugLogPath), { recursive: true });
  fs.mkdirSync(path.join(ck3Dir, "run"), { recursive: true });
  fs.writeFileSync(debugLogPath, "", "utf8");
  let active = false;
  const settingsRepository = {
    getCK3UserFolderPath: () => active ? ck3Dir : null,
    getCK3DebugLogPath: () => active ? debugLogPath : null,
    getSummaryPromptSettings: () => ({ letterSummaryPrompt: "summary" })
  };
  const { LetterManager } = createLetterManager({
    settingsRepository, fs, path, TailFile: class {}, readline: {}, parseLog,
    letterPromptBuilder: { buildMessages: () => [{ role: "user", content: "reply" }] },
    llmManager: { sendChatRequest: async () => ({ content: "Reply" }), sendSummaryRequest: async () => ({ content: "Summary" }) },
    PromptBuilder: {}, TokenCounter: { estimateMessageTokens: () => 1 }, memoryEngine: { recordLetterMemory() {} }, dataDir: path.join(tempDir, "data"),
    letterPayloadRetryDelays: retryDelays, sleep: async () => {},
    setIntervalFn: () => ({ unref() {} }), clearIntervalFn: () => {}
  });
  const manager = new LetterManager();
  active = true;
  manager.runDateTrackerHeartbeat = async () => manager.getDateTrackerStatus();
  return { manager, cleanup: () => fs.rmSync(tempDir, { recursive: true, force: true }) };
}

(async () => {
  let index = 0;
  const sequence = [
    gameData(null),
    gameData({ letterId: "letter_6" }),
    gameData({ content: "partial" }),
    gameData({ letterId: "letter_6", content: "x".repeat(80), totalDays: 100, delay: 3 })
  ];
  let harness = createManager(async () => sequence[Math.min(index++, sequence.length - 1)], [100, 200, 350]);
  try {
    const context = await harness.manager.loadLatestGameDataWithLetter();
    assert.strictEqual(context.letter.letterId, "letter_6", "attempt4 full payload must pass");
    assert.strictEqual(harness.manager.lastPayloadDiagnostics.attempts.length, 4);
    assert.deepStrictEqual(harness.manager.lastPayloadDiagnostics.attempts.map((item) => item.attempt), [1, 2, 3, 4]);
    assert.strictEqual(harness.manager.lastPayloadDiagnostics.attempts[3].contentLength, 80);
    assert.strictEqual(Array.from(harness.manager.lastPayloadDiagnostics.attempts[3].contentPreview).length, 40, "diagnostics preview must be capped at 40 chars");
  } finally {
    harness.cleanup();
  }

  harness = createManager(async () => gameData({ letterId: "", content: "", totalDays: 100, delay: 3 }), [100, 200]);
  try {
    assert.strictEqual(await harness.manager.loadLatestGameDataWithLetter(), null);
    assert.strictEqual(harness.manager.lastInvalidLetterPayload.errorCode, "PAYLOAD_INCOMPLETE_TIMEOUT");
  } finally {
    harness.cleanup();
  }

  harness = createManager(async () => gameData({ letterId: "letter_numeric", content: "x", totalDays: "NaN", delay: 3 }), [100]);
  try {
    assert.strictEqual(await harness.manager.loadLatestGameDataWithLetter(), null);
    assert.strictEqual(harness.manager.lastInvalidLetterPayload.errorCode, "INVALID_LETTER_PAYLOAD_NUMERIC");
  } finally {
    harness.cleanup();
  }

  let payloadReady = false;
  harness = createManager(async () => gameData(payloadReady ? { letterId: "letter_reread", content: "complete", totalDays: 100, delay: 3 } : null), [100]);
  try {
    assert.strictEqual(await harness.manager.processLatestLetter(), null);
    const timeoutStatus = Array.from(harness.manager.letterStatuses.values()).find((status) => status.payloadErrorCode === "PAYLOAD_INCOMPLETE_TIMEOUT");
    assert(timeoutStatus && timeoutStatus.letterId.startsWith("invalid_payload_"), "incomplete payload must remain an error record, not a formal Letter ID");
    const originalTriggerId = harness.manager.payloadRetryContexts.get(timeoutStatus.letterId).triggerId;
    payloadReady = true;
    const reread = await harness.manager.retryIncompletePayload(timeoutStatus.letterId);
    assert.strictEqual(reread.success, true);
    assert.strictEqual(reread.letterId, "letter_reread");
    assert.strictEqual(harness.manager.latestPipelineStatus.triggerId, originalTriggerId, "manual reread must reuse the same trigger context");
    assert(harness.manager.storedLetters.has("letter_reread"));
    assert(!harness.manager.storedLetters.has(timeoutStatus.letterId), "invalid_payload ID must never enter the delivery pipeline");
  } finally {
    harness.cleanup();
  }

  console.log("VOTC v7.10-RC6 Payload Race: PASS (attempt diagnostics, timeout/numeric classification and same-trigger reread)");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
