"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { createLetterManager } = require("../resources/app/out/main/letters/letter-manager");

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "votc-letter-delivery-"));
const ck3Dir = path.join(tempDir, "ck3");
const dataDir = path.join(tempDir, "data");
fs.mkdirSync(path.join(ck3Dir, "run"), { recursive: true });

let activeCk3Path = null;
const letter = {
  letterId: "letter_7",
  content: "测试来信",
  totalDays: 100,
  delay: 2
};
const gameData = {
  letterData: letter,
  playerName: "玩家",
  playerID: 1,
  date: "976年5月3日",
  totalDays: 100,
  loadCharactersSummaries() {},
  getAi() {
    return { id: 2, fullName: "李师师", shortName: "李师师" };
  },
  saveCharacterSummary() {}
};
const dependencies = {
  settingsRepository: {
    getCK3UserFolderPath: () => activeCk3Path,
    getCK3DebugLogPath: () => activeCk3Path ? path.join(activeCk3Path, "logs", "debug.log") : null,
    getSummaryPromptSettings: () => ({ letterSummaryPrompt: "测试摘要提示词" })
  },
  fs,
  path,
  TailFile: class {},
  readline: {},
  parseLog: async () => gameData,
  letterPromptBuilder: { buildMessages: () => [{ role: "user", content: "测试" }] },
  llmManager: {
    sendChatRequest: async () => ({ content: "这是测试回信。" }),
    sendSummaryRequest: async () => ({ content: "测试信件摘要。" })
  },
  PromptBuilder: {},
  TokenCounter: { estimateMessageTokens: () => 1 },
  memoryEngine: { recordLetterMemory() {} },
  dataDir
};

(async () => {
  try {
    const { LetterManager } = createLetterManager(dependencies);
    const firstManager = new LetterManager();
    activeCk3Path = ck3Dir;
    await firstManager.processLatestLetter();

    const pendingPath = path.join(dataDir, "pending-letters.json");
    assert(fs.existsSync(pendingPath), "generated reply must be persisted while awaiting its delivery day");
    assert.strictEqual(JSON.parse(fs.readFileSync(pendingPath, "utf8")).letters.length, 1);

    activeCk3Path = null;
    const restartedManager = new LetterManager();
    assert.strictEqual(restartedManager.storedLetters.size, 1, "pending reply must survive an app restart");
    await restartedManager.processLogLine("VOTC:DATE/;/101");
    assert.strictEqual(restartedManager.storedLetters.size, 1, "reply must remain pending before its delivery day");

    await restartedManager.updateCurrentDate(102);
    assert.strictEqual(restartedManager.storedLetters.size, 1, "failed CK3 delivery must not discard the reply");

    activeCk3Path = ck3Dir;
    await restartedManager.updateCurrentDate(103);
    const effect = fs.readFileSync(path.join(ck3Dir, "run", "letters.txt"), "utf8");
    assert(effect.includes("create_artifact = {"), "delivery must create the reply artifact");
    assert(effect.includes('description = "这是测试回信。"'), "artifact must contain the generated reply");
    assert(effect.includes("trigger_event = message_event.362"), "delivery must open the CK3 reply popup");
    assert.strictEqual(restartedManager.storedLetters.size, 0, "successfully queued reply must leave the pending queue");
    assert.strictEqual(JSON.parse(fs.readFileSync(pendingPath, "utf8")).letters.length, 0);

    console.log("VOTC v7.8.2 letter delivery: PASS (date tracking, restart recovery, retry, artifact and popup)");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
