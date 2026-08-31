"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createLetterManager } = require(path.join(__dirname, "..", "resources", "app", "out", "main", "letters", "letter-manager"));
const rendererSource = fs.readFileSync(path.join(__dirname, "..", "resources", "app", "out", "renderer", "assets", "index-Dn3qWlAB.js"), "utf8");

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v710-rc3-date-"));
const ck3Dir = path.join(tempDir, "ck3");
const debugLogPath = path.join(ck3Dir, "logs", "debug.log");
fs.mkdirSync(path.dirname(debugLogPath), { recursive: true });
fs.writeFileSync(debugLogPath, "VOTC:DATE/;/100\n", "utf8");

class TestTailFile {
  constructor() {
    this.handlers = {};
    TestTailFile.latest = this;
  }
  on(name, handler) {
    this.handlers[name] = handler;
    return this;
  }
  async start() {}
  async quit() {}
}

const api = createLetterManager({
  settingsRepository: {
    getCK3UserFolderPath: () => ck3Dir,
    getCK3DebugLogPath: () => debugLogPath,
    getSummaryPromptSettings: () => ({ letterSummaryPrompt: "summary" })
  },
  fs,
  path,
  TailFile: TestTailFile,
  readline: { createInterface: () => ({ on() {}, close() {} }) },
  parseLog: async () => null,
  letterPromptBuilder: {},
  llmManager: {},
  PromptBuilder: {},
  TokenCounter: {},
  memoryEngine: {},
  dataDir: path.join(tempDir, "data"),
  setIntervalFn: () => ({ unref() {} }),
  clearIntervalFn: () => {},
  dateStaleMs: 1
});

(async () => {
  try {
    const manager = new api.LetterManager();
    await new Promise((resolve) => setImmediate(resolve));

    manager.currentTotalDays = 100;
    await manager.updateCurrentDate(101);
    assert.strictEqual(manager.currentTotalDays, 101, "D01 +1 day must advance");
    await manager.updateCurrentDate(131);
    assert.strictEqual(manager.currentTotalDays, 131, "D02 +30 days must advance");

    const catchupLetter = { letterId: "letter_90", totalDays: 120, delay: 3, content: "catch-up" };
    manager.createLetterStatus(catchupLetter, "NPC");
    manager.storedLetters.set(catchupLetter.letterId, { letter: catchupLetter, reply: "reply", expectedDeliveryDay: 123, characterName: "NPC" });
    manager.deliverLetter = async () => true;
    await manager.updateCurrentDate(221);
    assert(manager.storedLetters.has(catchupLetter.letterId), "D03 +90 day recovery must preserve pending letters");
    assert.strictEqual(manager.getLetterStatus(catchupLetter.letterId).pipelineState, "DELIVERY_DUE", "D03 due letter must enter DELIVERY_DUE");
    manager.storedLetters.delete(catchupLetter.letterId);

    fs.appendFileSync(debugLogPath, "x".repeat(256), "utf8");
    manager.captureDebugLogMetadata(debugLogPath);
    fs.writeFileSync(debugLogPath, "VOTC:DATE/;/222\n", "utf8");
    let restartCount = 0;
    manager.restartLogTailing = async () => {
      restartCount++;
      manager.tailState = "ACTIVE";
    };
    await manager.runDateTrackerHeartbeat({ forceReconcile: true });
    assert(restartCount >= 1, "D04 truncate must restart tailing");
    assert.strictEqual(manager.currentTotalDays, 222, "D04 truncate reconciliation must recover latest date");

    manager.captureDebugLogMetadata(debugLogPath);
    fs.rmSync(debugLogPath);
    fs.writeFileSync(debugLogPath, "VOTC:DATE/;/223\n", "utf8");
    await manager.runDateTrackerHeartbeat({ forceReconcile: true });
    assert(restartCount >= 2, "D05 recreated log must restart tailing");
    assert.strictEqual(manager.currentTotalDays, 223);

    manager.tailState = "ACTIVE";
    TestTailFile.latest.handlers.tail_error?.(new Error("test tail failure"));
    assert.strictEqual(manager.dateSourceState, "TAIL_RESTARTING", "D06 tail_error must schedule restart");
    if (manager.tailRestartTimer) clearTimeout(manager.tailRestartTimer);
    manager.tailRestartTimer = null;

    fs.writeFileSync(debugLogPath, "no date marker\n", "utf8");
    const missing = await manager.reconcileLatestDateMarker("test");
    assert.strictEqual(missing.dateSourceState, "DATE_MARKER_MISSING", "D07 missing marker must be explicit");

    const futureLetter = { letterId: "letter_future", totalDays: 230, delay: 5, content: "future" };
    manager.createLetterStatus(futureLetter, "NPC");
    manager.storedLetters.set(futureLetter.letterId, { letter: futureLetter, reply: "reply", expectedDeliveryDay: 235, characterName: "NPC" });
    await manager.updateCurrentDate(200);
    assert(!manager.storedLetters.has(futureLetter.letterId), "D08 backward time travel must remove letters created after rollback date");

    const first = { letterId: "letter_first", totalDays: 190, delay: 0, content: "first" };
    const second = { letterId: "letter_second", totalDays: 190, delay: 0, content: "second" };
    manager.createLetterStatus(first, "NPC1");
    manager.createLetterStatus(second, "NPC2");
    manager.storedLetters.set(first.letterId, { letter: first, reply: "one", expectedDeliveryDay: 190, characterName: "NPC1" });
    manager.storedLetters.set(second.letterId, { letter: second, reply: "two", expectedDeliveryDay: 190, characterName: "NPC2" });
    const delivered = [];
    manager.deliverLetter = async (stored) => {
      delivered.push(stored.letter.letterId);
      manager.awaitingAcceptanceLetterId = stored.letter.letterId;
      return true;
    };
    await manager.checkAndDeliverLetters();
    await manager.checkAndDeliverLetters();
    assert.deepStrictEqual(delivered, ["letter_first"], "D09 second pending letter must wait for first acceptance");
    assert(rendererSource.includes("重新同步日期"), "letter UI must expose manual date resync and producer recovery");
    assert(rendererSource.includes('snapshot.dateTracker?.lastObservedDateValue'), "letter UI must show the latest observed game day");
    assert(rendererSource.includes('snapshot.dateTracker?.dateSourceState'), "letter UI must show the date source state");

    await manager.stopLogTailing();
    console.log("VOTC v7.10-RC3 Letter Date Tracker: PASS (D01-D09 forward catch-up, truncate/recreate, stale scan and serialization)");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
