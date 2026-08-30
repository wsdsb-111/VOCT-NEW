"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createLetterManager } = require("../resources/app/out/main/letters/letter-manager");

function createFixture(options = {}) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v710-letter-"));
  const ck3Dir = path.join(tempDir, "ck3");
  const dataDir = path.join(tempDir, "data");
  const debugLogPath = path.join(ck3Dir, "logs", "debug.log");
  fs.mkdirSync(path.join(ck3Dir, "run"), { recursive: true });
  fs.mkdirSync(path.dirname(debugLogPath), { recursive: true });
  fs.writeFileSync(debugLogPath, "", "utf8");
  let active = false;
  let parsedContext = options.parsedContext || null;
  const summaryCalls = [];
  const memoryRecords = [];
  const dependencies = {
    settingsRepository: {
      getCK3UserFolderPath: () => active ? ck3Dir : null,
      getCK3DebugLogPath: () => active ? debugLogPath : null,
      getSummaryPromptSettings: () => ({ letterSummaryPrompt: "概括来信和回信。" })
    },
    fs,
    path,
    TailFile: class {},
    readline: {},
    parseLog: async () => parsedContext,
    letterPromptBuilder: {
      buildMessages: () => [{ role: "user", content: "请回信" }],
      buildPreview: () => ({ messages: [] })
    },
    llmManager: {
      sendChatRequest: async () => ({ content: options.reply || "一切安好。" }),
      sendSummaryRequest: async (...args) => {
        summaryCalls.push(args);
        if (options.summaryFailure) throw new Error("summary unavailable");
        return { content: "来信与回信摘要。" };
      }
    },
    PromptBuilder: {},
    TokenCounter: { estimateMessageTokens: () => 1 },
    memoryEngine: { recordLetterMemory: (entry) => memoryRecords.push(entry) },
    dataDir,
    sleep: async () => {},
    letterPayloadRetryDelays: []
  };
  const api = createLetterManager(dependencies);
  const createManager = () => new api.LetterManager();
  return {
    ...api,
    ck3Dir,
    dataDir,
    debugLogPath,
    summaryCalls,
    memoryRecords,
    createManager,
    activate: () => { active = true; },
    deactivate: () => { active = false; },
    setParsedContext: (context) => { parsedContext = context; },
    effectPath: path.join(ck3Dir, "run", "letters.txt"),
    pendingPath: path.join(dataDir, "pending-letters.json"),
    cleanup: () => fs.rmSync(tempDir, { recursive: true, force: true })
  };
}

function makeLetter(id, totalDays, delay, content = "测试来信") {
  return { letterId: id, totalDays, delay, content };
}

function storeLetter(manager, letter, reply, characterName = "李师师") {
  manager.createLetterStatus(letter, characterName);
  manager.storedLetters.set(letter.letterId, {
    letter,
    reply,
    expectedDeliveryDay: letter.totalDays + letter.delay,
    characterName
  });
  manager.savePendingLetters();
}

function assertOfficialEffect(effect, letterId, escapedReply) {
  assert(effect.includes(`remove_global_variable ?= votc_${letterId}`));
  assert(effect.includes("create_artifact = {"));
  assert(effect.includes(`description = "${escapedReply}"`));
  assert(effect.includes("save_scope_as = votc_latest_letter"));
  assert(effect.includes("set_variable = { name = votc_letter_artifact value = yes}"));
  assert(effect.includes("name = votc_latest_letter"));
  assert(effect.includes("value = scope:votc_latest_letter"));
  assert(effect.includes("trigger_event = message_event.362"));
}

async function testDelay(delay) {
  const fixture = createFixture();
  try {
    const manager = fixture.createManager();
    fixture.activate();
    const letter = makeLetter(`letter_delay_${delay}`, 100, delay);
    storeLetter(manager, letter, `延迟${delay}日回信`);
    await manager.updateCurrentDate(100 + Math.max(0, delay - 1));
    if (delay > 0) {
      assert.strictEqual(manager.awaitingAcceptanceLetterId, null, `delay=${delay} must remain pending before its delivery day`);
    }
    await manager.updateCurrentDate(100 + delay);
    assert.strictEqual(manager.awaitingAcceptanceLetterId, letter.letterId);
    assert.strictEqual(manager.storedLetters.size, 1, "effect write is not equivalent to CK3 acceptance");
    assertOfficialEffect(fs.readFileSync(fixture.effectPath, "utf8"), letter.letterId, `延迟${delay}日回信`);
    assert.strictEqual(manager.getLetterStatus(letter.letterId).responseStatus, fixture.LetterResponseStatus.EFFECT_FILE_WRITTEN);
    await manager.clearLettersFile();
    assert.strictEqual(manager.getLetterStatus(letter.letterId).responseStatus, fixture.LetterResponseStatus.SENT);
    assert.strictEqual(manager.storedLetters.size, 0);
  } finally {
    fixture.cleanup();
  }
}

async function testDateAndEscaping() {
  const longText = `她说："请珍重"。${"山河无恙，静候佳音。".repeat(80)}`;
  const fixture = createFixture();
  try {
    const manager = fixture.createManager();
    fixture.activate();
    const letter = makeLetter("letter_quotes", 200, 1);
    storeLetter(manager, letter, longText);
    const beforeDeliveryDiagnostics = manager.getAllLetterStatuses();
    assert.strictEqual(beforeDeliveryDiagnostics.awaitingAcceptanceLetterId, null);
    assert.strictEqual(beforeDeliveryDiagnostics.effectFileExists, false);
    assert.strictEqual(beforeDeliveryDiagnostics.effectFileAge, null);
    assert.strictEqual(beforeDeliveryDiagnostics.storedLettersCount, 1);
    await manager.processLogLine("[debug] VOTC:DATE/;/201");
    assert.strictEqual(manager.getCurrentTotalDays(), 201);
    assert(Number.isFinite(manager.lastDateLogReceivedAt));
    const effect = fs.readFileSync(fixture.effectPath, "utf8");
    assertOfficialEffect(effect, letter.letterId, longText.replace(/"/g, '\\"'));
    assert(effect.includes("山河无恙，静候佳音。".repeat(80)), "long reply must not be truncated");
    const deliveryDiagnostics = manager.getAllLetterStatuses();
    assert.strictEqual(deliveryDiagnostics.awaitingAcceptanceLetterId, letter.letterId);
    assert.strictEqual(deliveryDiagnostics.effectFileExists, true);
    assert(Number.isFinite(deliveryDiagnostics.effectFileAge) && deliveryDiagnostics.effectFileAge >= 0);
    assert.strictEqual(deliveryDiagnostics.lastDateLogReceivedAt, manager.lastDateLogReceivedAt);
    assert.strictEqual(deliveryDiagnostics.storedLettersCount, 1);
  } finally {
    fixture.cleanup();
  }
}

async function testRestartAndNoDuplicate() {
  const fixture = createFixture();
  try {
    const first = fixture.createManager();
    fixture.activate();
    const letter = makeLetter("letter_restart", 300, 0);
    storeLetter(first, letter, "重启恢复回信");
    await first.updateCurrentDate(300);
    const firstEffect = fs.readFileSync(fixture.effectPath, "utf8");
    fixture.deactivate();
    const restarted = fixture.createManager();
    assert.strictEqual(restarted.awaitingAcceptanceLetterId, letter.letterId);
    assert.strictEqual(restarted.storedLetters.size, 1);
    fixture.activate();
    await restarted.updateCurrentDate(301);
    assert.strictEqual(fs.readFileSync(fixture.effectPath, "utf8"), firstEffect, "restart must not write a duplicate effect while awaiting CK3 acceptance");
    await restarted.clearLettersFile();
    const state = JSON.parse(fs.readFileSync(fixture.pendingPath, "utf8"));
    assert.strictEqual(state.version, 2);
    assert.strictEqual(state.awaitingAcceptanceLetterId, null);
    assert.strictEqual(state.letters.length, 0);
  } finally {
    fixture.cleanup();
  }
}

async function testTwoLettersAreSerialized() {
  const fixture = createFixture();
  try {
    const manager = fixture.createManager();
    fixture.activate();
    const first = makeLetter("letter_first", 400, 0);
    const second = makeLetter("letter_second", 400, 0);
    storeLetter(manager, first, "第一封回信");
    storeLetter(manager, second, "第二封回信");
    await manager.updateCurrentDate(400);
    assert.strictEqual(manager.awaitingAcceptanceLetterId, first.letterId);
    assert(fs.readFileSync(fixture.effectPath, "utf8").includes("第一封回信"));
    assert.strictEqual(manager.storedLetters.size, 2);
    await manager.clearLettersFile();
    assert.strictEqual(manager.awaitingAcceptanceLetterId, second.letterId);
    assert(fs.readFileSync(fixture.effectPath, "utf8").includes("第二封回信"));
    assert.strictEqual(manager.storedLetters.size, 1);
    await manager.clearLettersFile();
    assert.strictEqual(manager.awaitingAcceptanceLetterId, null);
    assert.strictEqual(manager.storedLetters.size, 0);
  } finally {
    fixture.cleanup();
  }
}

async function testSummaryFailureDoesNotBlockImmediateDelivery() {
  const letter = makeLetter("letter_summary_failure", 500, 0, "请报平安");
  const ai = { id: 2, shortName: "李师师", fullName: "东京名伎李师师" };
  const gameData = {
    playerID: 1,
    playerName: "玩家",
    date: "976年5月3日",
    totalDays: 500,
    letterData: letter,
    loadCharactersSummaries() {},
    getAi: () => ai,
    saveCharacterSummary() {}
  };
  const fixture = createFixture({ parsedContext: gameData, summaryFailure: true, reply: "即刻回信。" });
  try {
    const manager = fixture.createManager();
    fixture.activate();
    assert.strictEqual(await manager.processLatestLetter(), "即刻回信。");
    assert.strictEqual(manager.awaitingAcceptanceLetterId, letter.letterId, "immediate delivery must occur even when summary generation fails");
    assertOfficialEffect(fs.readFileSync(fixture.effectPath, "utf8"), letter.letterId, "即刻回信。");
    const status = manager.getLetterStatus(letter.letterId);
    assert.strictEqual(status.responseStatus, fixture.LetterResponseStatus.EFFECT_FILE_WRITTEN);
    assert.strictEqual(status.summaryStatus, fixture.LetterSummaryStatus.GENERATION_FAILED);
  } finally {
    fixture.cleanup();
  }
}

(async () => {
  await testDelay(0);
  await testDelay(1);
  await testDelay(3);
  await testDateAndEscaping();
  await testRestartAndNoDuplicate();
  await testTwoLettersAreSerialized();
  await testSummaryFailureDoesNotBlockImmediateDelivery();
  console.log("VOTC v7.10 Letter Delivery Recovery 2.0: PASS (delay 0/1/3, DATE, diagnostics, escaping, long text, restart, serialization, acceptance and summary independence)");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
