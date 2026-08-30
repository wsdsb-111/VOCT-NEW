"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createLetterManager } = require(path.join(__dirname, "..", "resources", "app", "out", "main", "letters", "letter-manager"));
const rendererSource = fs.readFileSync(path.join(__dirname, "..", "resources", "app", "out", "renderer", "assets", "index-Dn3qWlAB.js"), "utf8");

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v710-rc3-letter-retry-"));
const ck3Dir = path.join(tempDir, "ck3");
const debugLogPath = path.join(ck3Dir, "logs", "debug.log");
fs.mkdirSync(path.dirname(debugLogPath), { recursive: true });
fs.writeFileSync(debugLogPath, "debug", "utf8");

const letter = { letterId: "letter_5", content: "请回信", totalDays: 100, delay: 10 };
const gameData = {
  letterData: letter,
  playerID: 1,
  playerName: "Player",
  date: "1000.1.1",
  totalDays: 100,
  getAi: () => ({ id: 2, shortName: "NPC", fullName: "NPC Full" }),
  loadCharactersSummaries() {},
  saveCharacterSummary() {}
};
let chatAttempts = 0;
const api = createLetterManager({
  settingsRepository: {
    getCK3UserFolderPath: () => ck3Dir,
    getCK3DebugLogPath: () => debugLogPath,
    getSummaryPromptSettings: () => ({ letterSummaryPrompt: "summary" })
  },
  fs,
  path,
  TailFile: class {
    on() { return this; }
    async start() {}
    async quit() {}
  },
  readline: { createInterface: () => ({ on() {}, close() {} }) },
  parseLog: async () => gameData,
  letterPromptBuilder: { buildMessages: () => [{ role: "user", content: "reply" }] },
  llmManager: {
    async sendChatRequest() {
      chatAttempts++;
      if (chatAttempts === 1) {
        const error = new Error("Connection error");
        error.name = "APIConnectionError";
        error.provider = "deepseek";
        error.model = "deepseek-v4-flash";
        error.causeCode = "ECONNRESET";
        error.attemptCount = 4;
        error.retryable = true;
        throw error;
      }
      return { content: "retry reply" };
    },
    async sendSummaryRequest() { return { content: "summary result" }; }
  },
  PromptBuilder: {},
  TokenCounter: { estimateMessageTokens: () => 1 },
  memoryEngine: { recordLetterMemory() {} },
  dataDir: path.join(tempDir, "data"),
  letterPayloadRetryDelays: [],
  setIntervalFn: () => ({ unref() {} }),
  clearIntervalFn: () => {}
});

(async () => {
  try {
    const manager = new api.LetterManager();
    await new Promise((resolve) => setImmediate(resolve));
    const first = await manager.processLatestLetter();
    assert.strictEqual(first, null);
    const failed = manager.getLetterStatus(letter.letterId);
    assert.strictEqual(failed.responseStatus, "generation_failed");
    assert.strictEqual(failed.responseErrorDetails.provider, "deepseek");
    assert.strictEqual(failed.responseErrorDetails.model, "deepseek-v4-flash");
    assert.strictEqual(failed.responseErrorDetails.errorClass, "APIConnectionError");
    assert.strictEqual(failed.responseErrorDetails.causeCode, "ECONNRESET");
    assert.strictEqual(failed.responseErrorDetails.attemptCount, 4);
    assert.strictEqual(failed.responseErrorDetails.retryable, true);
    assert(failed.responseError.includes("Attempts: 4"));

    const retry = await manager.retryFailedLetter(letter.letterId);
    assert.strictEqual(retry.success, true);
    assert.strictEqual(manager.storedLetters.size, 1, "retry must insert exactly one pending letter");
    assert.strictEqual(manager.getLetterStatus(letter.letterId).responseStatus, "pending_delivery");
    assert.strictEqual(manager.getLetterStatus(letter.letterId).retryAttemptCount, 1);
    assert.strictEqual(manager.getLetterStatus(letter.letterId).summaryStatus, "saved");
    assert(manager.latestPipelineStatus.history.some((entry) => entry.state === "REPLY_RECEIVED") && manager.latestPipelineStatus.retryAttemptCount === 1, "retry must pass through the generated/REPLY_RECEIVED state before pending delivery");

    const duplicate = await manager.retryFailedLetter(letter.letterId);
    assert.strictEqual(duplicate.success, false, "pending delivery must block duplicate reply generation");
    assert.strictEqual(manager.storedLetters.size, 1);

    const timeout = new Error("timeout");
    timeout.provider = "deepseek";
    timeout.model = "deepseek-v4-flash";
    timeout.code = "ETIMEDOUT";
    timeout.attemptCount = 4;
    timeout.retryable = true;
    assert.strictEqual(manager.classifyProviderError(timeout).errorCode, "ETIMEDOUT");
    const serverError = new Error("server error");
    serverError.status = 503;
    serverError.attemptCount = 4;
    serverError.retryable = true;
    assert.strictEqual(manager.classifyProviderError(serverError).httpStatus, 503);
    assert(rendererSource.includes("手动重试回复生成"), "failed-letter UI must expose manual reply retry");
    assert(rendererSource.includes("window.lettersAPI.retryFailed(letterId)"), "manual retry must use the dedicated IPC API");

    await manager.stopLogTailing();
    console.log("VOTC v7.10-RC3 Letter Provider Retry: PASS (structured transport error, manual retry and letterId idempotency)");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
