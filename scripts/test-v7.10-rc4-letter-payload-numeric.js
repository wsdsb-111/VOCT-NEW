"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createLetterManager } = require("../resources/app/out/main/letters/letter-manager");

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v710-rc4-numeric-"));
const ck3Dir = path.join(tempDir, "ck3");
const dataDir = path.join(tempDir, "data");
fs.mkdirSync(path.join(ck3Dir, "run"), { recursive: true });
fs.mkdirSync(dataDir, { recursive: true });

function createManager(parseLog = async () => null, retryDelays = []) {
  let active = false;
  const settingsRepository = {
    getCK3UserFolderPath: () => active ? ck3Dir : null,
    getCK3DebugLogPath: () => active ? path.join(ck3Dir, "logs", "debug.log") : null,
    getSummaryPromptSettings: () => ({ letterSummaryPrompt: "summary" })
  };
  const { LetterManager } = createLetterManager({
    settingsRepository, fs, path, TailFile: class {}, readline: {}, parseLog,
    letterPromptBuilder: {}, llmManager: {}, PromptBuilder: {}, TokenCounter: {}, memoryEngine: {}, dataDir,
    letterPayloadRetryDelays: retryDelays, sleep: async () => {}, setIntervalFn: () => ({ unref() {} }), clearIntervalFn: () => {}
  });
  const manager = new LetterManager();
  active = true;
  return manager;
}

(async () => {
  try {
    const manager = createManager();
    const base = { letterId: "letter_n", content: "hello", totalDays: 10, delay: 3 };
    assert.strictEqual(manager.validateLetterPayload(base).valid, true, "N01 finite integers are valid");
    const numericString = manager.validateLetterPayload({ ...base, totalDays: "10", delay: "3" });
    assert.strictEqual(numericString.valid, true, "N02 numeric strings are valid");
    assert.strictEqual(numericString.letter.totalDays, 10);
    assert.strictEqual(numericString.letter.delay, 3);
    for (const [label, patch] of [
      ["N03 undefined", { totalDays: void 0 }],
      ["N04 null", { delay: null }],
      ["N05 empty", { totalDays: "" }],
      ["N06 NaN", { delay: Number.NaN }],
      ["N07 Infinity", { totalDays: Number.POSITIVE_INFINITY }],
      ["N08 negative", { delay: -1 }],
      ["N09 decimal", { delay: 1.5 }]
    ]) {
      const result = manager.validateLetterPayload({ ...base, ...patch });
      assert.strictEqual(result.valid, false, label);
      assert.strictEqual(result.errorCode, "INVALID_LETTER_PAYLOAD_NUMERIC", label);
    }

    fs.writeFileSync(path.join(dataDir, "pending-letters.json"), JSON.stringify({
      version: 3,
      awaitingAcceptanceLetterId: "letter_bad",
      letters: [
        { letter: { letterId: "letter_good", content: "good", totalDays: "5", delay: "3" }, reply: "ok", expectedDeliveryDay: "8", characterName: "NPC" },
        { letter: { letterId: "letter_bad", content: "bad", totalDays: 5, delay: "NaN" }, reply: "bad", expectedDeliveryDay: null, characterName: "NPC" }
      ],
      failedLetters: []
    }, null, 2), "utf8");
    const reloaded = createManager();
    assert.strictEqual(reloaded.storedLetters.size, 1, "N10 legacy invalid pending must not enter storedLetters");
    assert.strictEqual(reloaded.storedLetters.get("letter_good").expectedDeliveryDay, 8);
    assert.strictEqual(reloaded.getLetterStatus("letter_bad").responseStatus, "legacy_invalid_pending");
    assert.strictEqual(reloaded.getLetterStatus("letter_bad").expectedDeliveryDay, void 0);
    const quarantine = JSON.parse(fs.readFileSync(path.join(dataDir, "invalid-pending-letters.json"), "utf8"));
    assert.strictEqual(quarantine.records.length, 1);
    const persisted = JSON.parse(fs.readFileSync(path.join(dataDir, "pending-letters.json"), "utf8"));
    assert.strictEqual(persisted.letters.length, 1);
    assert.strictEqual(persisted.letters[0].expectedDeliveryDay, 8);

    fs.rmSync(path.join(dataDir, "pending-letters.json"), { force: true });
    fs.rmSync(path.join(dataDir, "invalid-pending-letters.json"), { force: true });
    const invalidGameData = {
      letterData: { letterId: "letter_retry", content: "partial", totalDays: 10, delay: void 0 },
      getAi: () => ({ fullName: "NPC" })
    };
    let parseCount = 0;
    const retryManager = createManager(async () => {
      parseCount++;
      return invalidGameData;
    }, [100, 200, 350, 600, 1e3]);
    assert.strictEqual(await retryManager.processLatestLetter(), null);
    assert.strictEqual(parseCount, 6, "numeric-invalid payload must use the existing bounded reread loop");
    assert.strictEqual(retryManager.getLetterStatus("letter_retry").responseStatus, "payload_invalid");
    assert.strictEqual(retryManager.getLetterStatus("letter_retry").payloadErrorCode, "INVALID_LETTER_PAYLOAD_NUMERIC");
    assert.strictEqual(retryManager.storedLetters.size, 0);
    assert(!fs.existsSync(path.join(dataDir, "pending-letters.json")), "invalid numeric payload must never enter pending persistence");

    const renderer = fs.readFileSync(path.join(__dirname, "..", "resources", "app", "out", "renderer", "assets", "index-Dn3qWlAB.js"), "utf8");
    assert(renderer.includes('if (!Number.isFinite(letter.daysUntilDelivery)) return "日期数据异常"'));
    assert(renderer.includes('Number.isFinite(letter.expectedDeliveryDay) ? letter.expectedDeliveryDay : "日期数据异常"'));
    console.log("VOTC v7.10-RC4 Letter Payload Numeric: PASS (N01-N10, retry, quarantine, persistence, no NaN UI)");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
