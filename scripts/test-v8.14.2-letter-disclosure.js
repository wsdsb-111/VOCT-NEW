"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { Character } = require("../resources/app/out/main/game-data/character");
const { createLogParser } = require("../resources/app/out/main/game-data/log-parser");
const { MemoryEngine } = require("../resources/app/out/main/memory-system/memory-engine");
const { createLetterManager } = require("../resources/app/out/main/letters/letter-manager");

const CAMPAIGN = "votc8c-202609010001";
const OTHER_CAMPAIGN = "votc8c-202609020002";
const PLAYER_TITLE = "大宋亲王";
const AI_TITLE = "东京名伎";
const AI_PRIVATE_TRAIT = "仁慈";
const INCOMING_TEXT = `玩家是${PLAYER_TITLE}。`;
const OUTGOING_TEXT = `李师师是${AI_TITLE}。李师师心里暗自${AI_PRIVATE_TRAIT}。`;

class FixtureGameData {
  constructor(data) {
    this.playerID = Number(data[0]);
    this.playerName = data[1];
    this.aiID = Number(data[2]);
    this.aiName = data[3];
    this.date = data[4];
    this.totalDays = Number(data[8]);
    this.characters = new Map();
    this.letterData = null;
  }
  getPlayer() { return this.characters.get(this.playerID); }
  getAi() { return this.characters.get(this.aiID); }
  loadCharactersSummaries() {}
  saveCharacterSummary() {}
}

function characterLine(id, shortName, fullName, title) {
  const fields = Array(28).fill("");
  fields[0] = String(id);
  fields[1] = shortName;
  fields[2] = fullName;
  fields[3] = title;
  fields[4] = id === 2 ? "她" : "他";
  fields[5] = "30";
  fields[6] = "10";
  fields[8] = "未知";
  fields[9] = "沉稳";
  fields[14] = "汉";
  fields[15] = "儒教";
  return ["VOTC:IN", "character", ...fields].join("/;/");
}

function createFixture({ campaignToken = CAMPAIGN, delay = 3, commandStatus = "awaiting_ack", writeFailure = false, summaryOwnerIds = [1, 2] } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "votc-letter-disclosure-"));
  const ck3Dir = path.join(root, "ck3");
  const runDir = path.join(ck3Dir, "run");
  const dataDir = path.join(root, "app-data");
  const summaryDir = path.join(root, "summaries");
  const debugLogPath = path.join(ck3Dir, "logs", "debug.log");
  fs.mkdirSync(runDir, { recursive: true });
  fs.mkdirSync(path.dirname(debugLogPath), { recursive: true });
  fs.mkdirSync(summaryDir, { recursive: true });
  if (summaryOwnerIds.includes(1)) fs.mkdirSync(path.join(summaryDir, "1_玩家"), { recursive: true });
  if (summaryOwnerIds.includes(2)) fs.mkdirSync(path.join(summaryDir, "2_李师师"), { recursive: true });

  const state = { campaignToken, date: "1038年4月1日", totalDays: 100, letterId: "letter_42",
    letterContent: INCOMING_TEXT, letterDay: 100, delay, playerId: 1, aiId: 2 };
  const writeLog = () => {
    const init = ["VOTC:IN", "init", String(state.playerId), "玩家", String(state.aiId), "李师师",
      state.date, "scene_type_court", "开封", "玩家", String(state.totalDays)].join("/;/");
    const lines = [init];
    if (state.campaignToken) lines.push(`VOTC:CAMPAIGN/${state.campaignToken}`);
    lines.push(characterLine(1, "玩家", "赵祯", PLAYER_TITLE));
    lines.push(characterLine(2, "李师师", "东京名伎李师师", AI_TITLE));
    lines.push(characterLine(3, "赵某", "赵某", "无"));
    lines.push(["VOTC:LETTER", state.letterContent, state.letterId, String(state.letterDay), String(state.delay)].join("/;/"));
    fs.writeFileSync(debugLogPath, `${lines.join("\n")}\n`, "utf8");
  };
  writeLog();
  const baseParseLog = createLogParser({ GameData: FixtureGameData, Character });
  const parseLog = async file => {
    const originalLog = console.log;
    let gameData;
    try {
      console.log = () => {};
      gameData = await baseParseLog(file);
    } finally {
      console.log = originalLog;
    }
    gameData?.characters.get(2)?.traits.push({ name: AI_PRIVATE_TRAIT, traitId: "compassion" });
    return gameData;
  };
  const memoryEngine = new MemoryEngine({ baseDir: path.join(root, "memory"), summaryFoldersDir: summaryDir, trace: { record() {} } });
  memoryEngine.recordLetterMemory = () => {};
  const behavior = { writeFailure };
  const settingsRepository = {
    getCK3UserFolderPath: () => ck3Dir,
    getCK3DebugLogPath: () => debugLogPath,
    getSummaryPromptSettings: () => ({ letterSummaryPrompt: "Summarize the exchange." })
  };
  const providerCalls = [];
  const llmManager = {
    async sendChatRequest() {
      providerCalls.push("letter");
      if (behavior.writeFailure === "generation") throw new Error("fixture generation failure");
      return { content: OUTGOING_TEXT };
    },
    async sendSummaryRequest() {
      providerCalls.push("summary");
      return { content: "信件往来。" };
    }
  };
  const transportCalls = { writes: 0, clears: 0 };
  const letterEffectTransport = {
    getOutboundMode: () => "votc_run_file",
    writeOutboundLetterEffect() {
      transportCalls.writes++;
      if (behavior.writeFailure === "effect") return { success: false, error: "fixture write failure" };
      return { success: true, commandId: "letter-command-42", commandStatus };
    },
    clearOutboundEffect() { transportCalls.clears++; return { success: true }; },
    cancelOutboundEffect() { return { success: true }; }
  };
  const inertInterval = () => ({ unref() {} });
  const dependencies = {
    settingsRepository, fs, path, TailFile: class {}, readline: {}, parseLog,
    letterPromptBuilder: { buildMessages: () => [{ role: "user", content: "offline letter fixture" }] },
    llmManager, PromptBuilder: {}, TokenCounter: { estimateMessageTokens: message => message.content.length },
    memoryEngine, dataDir, letterEffectTransport, autoStartLogTailing: false, letterPayloadRetryDelays: [],
    setIntervalFn: inertInterval, clearIntervalFn() {}, setRunCommandIntervalFn: inertInterval, clearRunCommandIntervalFn() {}
  };
  const managers = [];
  const createManager = () => {
    const { LetterManager } = createLetterManager(dependencies);
    const manager = new LetterManager();
    manager.currentTotalDays = state.totalDays;
    managers.push(manager);
    return manager;
  };
  const manager = createManager();

  const getFacts = (ownerId, entityId, token = CAMPAIGN) => memoryEngine.memory4.store.getDisclosedFacts({ campaignToken: token, ownerId }, entityId);
  const close = async () => {
    for (const item of managers) await item.stopLogTailing();
    fs.rmSync(root, { recursive: true, force: true });
  };
  return { state, writeLog, manager, createManager, behavior, dataDir, summaryDir, memoryEngine, providerCalls, transportCalls, getFacts, close };
}

async function testDeliveryLifecycle() {
  const fixture = createFixture();
  try {
    assert.strictEqual(await fixture.manager.processLatestLetter(), OUTGOING_TEXT);
    assert.strictEqual(fixture.transportCalls.writes, 0, "reply is not written before its delivery day");
    const incoming = fixture.getFacts(2, 1);
    assert.deepStrictEqual(incoming.map(fact => fact.value), [PLAYER_TITLE], "the received letter informs only its NPC recipient");
    assert.strictEqual(fixture.getFacts(1, 2).length, 0, "the player has not received the generated reply yet");
    const npcRevision = fixture.memoryEngine.memory4.store.loadIndex({ campaignToken: CAMPAIGN, ownerId: 2 }).revision;

    assert.strictEqual(await fixture.manager.processLatestLetter(), OUTGOING_TEXT, "same inbound letter is accepted as an idempotent replay");
    assert.strictEqual(fixture.memoryEngine.memory4.store.loadIndex({ campaignToken: CAMPAIGN, ownerId: 2 }).revision, npcRevision);
    fixture.manager.currentTotalDays = 102;
    await fixture.manager.checkAndDeliverLetters();
    assert.strictEqual(fixture.transportCalls.writes, 0, "not-yet-due reply is not delivered");
    await fixture.manager.clearLettersFile();
    assert.strictEqual(fixture.getFacts(1, 2).length, 0, "a callback without a written effect grants no reply knowledge");

    fixture.manager.currentTotalDays = 103;
    await fixture.manager.checkAndDeliverLetters();
    assert.strictEqual(fixture.transportCalls.writes, 1);
    fixture.state.totalDays = 103;
    fixture.state.date = "1038年4月4日";
    fixture.writeLog();
    await fixture.manager.clearLettersFile();
    const replyFacts = fixture.getFacts(1, 2);
    assert.deepStrictEqual(replyFacts.map(fact => fact.value), [AI_TITLE], "accepted reply grants its explicit current title");
    assert.strictEqual(replyFacts[0].knownBy.join(), "1");
    const replyProof = Object.values(replyFacts[0].evidenceBySource)[0];
    assert.strictEqual(replyProof.sourceKind, "LETTER");
    assert.strictEqual(replyProof.sourceLetterId, "letter_42");
    assert.strictEqual(replyProof.senderId, 2);
    assert.strictEqual(replyProof.recipientId, 1);
    assert.strictEqual(replyFacts.some(fact => fact.value === AI_PRIVATE_TRAIT), false, "private thought is not disclosed");
    const playerRevision = fixture.memoryEngine.memory4.store.loadIndex({ campaignToken: CAMPAIGN, ownerId: 1 }).revision;
    await fixture.manager.clearLettersFile();
    assert.strictEqual(fixture.memoryEngine.memory4.store.loadIndex({ campaignToken: CAMPAIGN, ownerId: 1 }).revision, playerRevision,
      "replayed acceptance callback is idempotent");
  } finally {
    await fixture.close();
  }
}

async function testGenerationFailureStillRecordsReceivedLetter() {
  const fixture = createFixture({ writeFailure: "generation" });
  try {
    assert.strictEqual(await fixture.manager.processLatestLetter(), null);
    assert.deepStrictEqual(fixture.getFacts(2, 1).map(fact => fact.value), [PLAYER_TITLE]);
    assert.strictEqual(fixture.getFacts(1, 2).length, 0);
  } finally {
    await fixture.close();
  }
}

async function testFirstInboundLetterCreatesScopedOwnerSidecar() {
  const fixture = createFixture({ summaryOwnerIds: [1] });
  try {
    await fixture.manager.processLatestLetter();
    assert.deepStrictEqual(fixture.getFacts(2, 1).map(fact => fact.value), [PLAYER_TITLE]);
    const scope = { campaignToken: CAMPAIGN, ownerId: 2 };
    const sidecar = fixture.memoryEngine.memory4.store.directory(scope);
    assert.strictEqual(fs.existsSync(sidecar), true, "valid first disclosure creates its exact owner/campaign sidecar");
    assert.strictEqual(fs.existsSync(path.join(fixture.summaryDir, "2_李师师")), false, "no summary owner folder is synthesized");
  } finally {
    await fixture.close();
  }
}

async function testRetryBindingSurvivesRestart() {
  const fixture = createFixture({ writeFailure: "generation" });
  try {
    assert.strictEqual(await fixture.manager.processLatestLetter(), null);
    const pending = JSON.parse(fs.readFileSync(path.join(fixture.dataDir, "pending-letters.json"), "utf8"));
    const persistedBinding = pending.failedLetters[0]?.disclosureBinding;
    assert.deepStrictEqual(Object.keys(persistedBinding).sort(), ["aiId", "campaignToken", "playerId", "sourceDate", "sourceTotalDays"]);
    assert.strictEqual(persistedBinding.campaignToken, CAMPAIGN);

    fixture.behavior.writeFailure = false;
    const restarted = fixture.createManager();
    assert.deepStrictEqual(restarted.failedLetterContexts.get("letter_42").disclosureBinding, persistedBinding);
    const retry = await restarted.retryFailedLetter("letter_42");
    assert.strictEqual(retry.success, true);
    assert.strictEqual(fixture.getFacts(1, 2).length, 0, "a retried but undelivered reply grants no knowledge");
    restarted.currentTotalDays = 103;
    await restarted.checkAndDeliverLetters();
    fixture.state.totalDays = 103;
    fixture.state.date = "1038年4月4日";
    fixture.writeLog();
    await restarted.clearLettersFile();
    assert.deepStrictEqual(fixture.getFacts(1, 2).map(fact => fact.value), [AI_TITLE]);
  } finally {
    await fixture.close();
  }
}

async function testBlockedWriteCannotDiscloseReply() {
  const fixture = createFixture({ delay: 0, commandStatus: "blocked" });
  try {
    await fixture.manager.processLatestLetter();
    assert.strictEqual(fixture.transportCalls.writes, 1);
    assert.strictEqual(fixture.manager.getLetterStatus("letter_42").responseStatus, "pending_delivery");
    await fixture.manager.clearLettersFile();
    assert.strictEqual(fixture.getFacts(1, 2).length, 0, "blocked transport status cannot pass the receipt gate");
  } finally {
    await fixture.close();
  }
}

async function testAcceptedReplyScopeAndDateMustMatch() {
  for (const invalidation of ["campaign", "future-date", "letter-id"]) {
    const fixture = createFixture({ delay: 0 });
    try {
      await fixture.manager.processLatestLetter();
      if (invalidation === "campaign") fixture.state.campaignToken = OTHER_CAMPAIGN;
      if (invalidation === "future-date") {
        fixture.state.totalDays = 99;
        fixture.state.date = "1038年3月31日";
        fixture.manager.currentTotalDays = 99;
      }
      if (invalidation === "letter-id") fixture.state.letterId = "letter_43";
      fixture.writeLog();
      await fixture.manager.clearLettersFile();
      assert.strictEqual(fixture.getFacts(1, 2).length, 0, `${invalidation} mismatch must fail closed`);
    } finally {
      await fixture.close();
    }
  }
}

async function testUnresolvedCampaignAndFailedEffectDoNotDisclose() {
  const noCampaign = createFixture({ campaignToken: null, delay: 0 });
  try {
    await noCampaign.manager.processLatestLetter();
    assert.strictEqual(noCampaign.getFacts(2, 1).length, 0, "unresolved campaign cannot record an incoming letter");
    assert.strictEqual(noCampaign.getFacts(1, 2).length, 0);
  } finally {
    await noCampaign.close();
  }

  const failedEffect = createFixture({ delay: 0, writeFailure: "effect" });
  try {
    await failedEffect.manager.processLatestLetter();
    assert.strictEqual(failedEffect.transportCalls.writes, 1);
    await failedEffect.manager.clearLettersFile();
    assert.strictEqual(failedEffect.getFacts(1, 2).length, 0, "failed effect write cannot disclose the generated reply");
  } finally {
    await failedEffect.close();
  }
}

async function main() {
  await testDeliveryLifecycle();
  await testGenerationFailureStillRecordsReceivedLetter();
  await testFirstInboundLetterCreatesScopedOwnerSidecar();
  await testRetryBindingSurvivesRestart();
  await testBlockedWriteCannotDiscloseReply();
  await testAcceptedReplyScopeAndDateMustMatch();
  await testUnresolvedCampaignAndFailedEffectDoNotDisclose();
  console.log("V8.14.2 letter disclosure integration: 7 groups passed; offline providers, temporary files only.");
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
