"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Handlebars = require("../resources/app/node_modules/handlebars");
const { createGameData } = require("../resources/app/out/main/game-data/game-data");
const { Character } = require("../resources/app/out/main/game-data/character");
const { createLogParser } = require("../resources/app/out/main/game-data/log-parser");
const { ConversationDisclosureStore } = require("../resources/app/out/main/conversation/character-disclosure-store");
const { buildCharacterDisclosureContext } = require("../resources/app/out/main/conversation/character-disclosure-context");
const { activateSocialRecognition, getPublicRealmIdentities, getSocialRecognitionSource, preserveSocialRecognition } =
  require("../resources/app/out/main/prompts/social-recognition-policy");
const { createPromptBuilder } = require("../resources/app/out/main/prompts/prompt-builder");
const { fingerprint } = require("../resources/app/out/main/prompts/prompt-plan-contract");

const temporaryRoot = fs.mkdtempSync(path.resolve(__dirname, "../.build/realm-roleplay-"));
const GameData = createGameData({ memoryEngine: { findMentionedCharactersInHistory: () => [] }, getHistoricalReferenceByYear: () => ({
  period: "未限定史料范围", context: "虚构的旧朝参考", notableFigures: ["张居正"], notableEvents: []
}) });
const parse = createLogParser({ GameData, Character });
const logPath = path.join(temporaryRoot, "debug.log");
const row = (...fields) => ["VOTC:IN", ...fields].join("/;/");
const character = (id, name, title) => {
  const fields = Array(28).fill("");
  Object.assign(fields, { 0: id, 1: name, 2: name, 3: title, 4: "he", 5: "30", 14: "汉", 18: name });
  return row("character", ...fields);
};
const header = (date = "1079.5.3", day = 393860) => [
  row("init", 1, "玩家", 2, "甲公爵", date, "talk_scene_hall", "开封", "", day),
  "VOTC:CAMPAIGN/votc8c-123456789012",
  character(1, "玩家", "朝廷"), character(2, "甲公爵", "甲公国"),
  character(3, "辽廷臣", ""), character(10, "宋新君", "新宋")
];
const identities = [
  row("realm_identity", 2, 10, 1, 393860, "SOVEREIGN", "宋新君", "新宋", "皇帝"),
  row("realm_identity", 2, 21, 1, 393860, "LIEGE", "宋上级", "宋内阁", "内阁官员"),
  row("realm_identity", 2, 23, 1, 393860, "DIRECT_VASSAL", "甲伯爵", "甲伯爵领", "伯爵"),
  row("reign_era", 2, 10, 1, 393860, "景和", "元"),
  row("realm_identity", 3, 31, 1, 393860, "COURT_LORD", "辽廷主", "辽边镇", "公爵"),
  row("realm_identity", 3, 32, 1, 393860, "SOVEREIGN", "辽帝", "辽", "皇帝"),
  row("reign_era", 3, 32, 1, 393860, "大康", "五"),
  row("realm_identity", 2, 24, 9, 393860, "DIRECT_VASSAL", "伪造伯爵", "伪证"),
  row("realm_identity", 2, 25, 1, 393859, "DIRECT_VASSAL", "昨日伯爵", "旧地"),
  row("social_recognition", 2, 3, 1, "REALM_PEERS")
];
const writeAndParse = async lines => {
  fs.writeFileSync(logPath, lines.join("\n"));
  const log = console.log;
  try {
    console.log = () => {};
    return await parse(logPath);
  } finally { console.log = log; }
};

let useV813 = true;
let mainTemplate = "{{! VOTC_SEGMENT:world_context }}日期={{gameData.date}}；{{gameData.historicalReferenceInfo.context}}";
const estimateTokens = value => Math.ceil(String(value).length / 4);
const PromptBuilder = createPromptBuilder({
  TemplateEngine: class {
    renderTemplateString(template, context) {
      return Handlebars.compile(template)(context);
    }
  },
  PromptScriptLoader: class {},
  promptConfigManager: { getDefaultMainTemplateContent: () => mainTemplate },
  settingsRepository: {
    getChatPromptV813Layout: () => useV813,
    getPromptSettings: () => ({ blocks: [{ id: "main", type: "main", role: "system", enabled: true },
      { id: "history", type: "history", enabled: true }, { id: "instruction", type: "instruction", enabled: true, template: "请回答" }] })
  },
  path,
  TokenCounter: { estimateTokens, calculateTotalTokens: messages => messages.reduce((total, message) => total + estimateTokens(message.content), 0) },
  createPromptFingerprint: value => fingerprint(value),
  defaultChatInstruction: "请回答"
});

async function run() {
  const gameData = await writeAndParse([...header(), ...identities]);
  assert.equal(gameData.year, 1079);
  assert.deepEqual(getPublicRealmIdentities(gameData, 2), [], "export alone does not grant knowledge");
  activateSocialRecognition(gameData, [1, 2]);
  assert.deepEqual(getPublicRealmIdentities(gameData, 3), [], "waiting candidate receives no authority");
  activateSocialRecognition(gameData, [3, 10]);
  assert.deepEqual(getPublicRealmIdentities(gameData, 2).map(item => item.targetId), [10, 21, 23]);
  assert.equal(getSocialRecognitionSource(gameData, 2, 3), null, "legacy same-realm peers no longer give automatic knowledge");
  const scene = { id: "test-scene", isActive: true, gameData, selectedCharacterIds: new Set([2, 3, 10]), messages: [] };
  const store = new ConversationDisclosureStore({ dataDir: temporaryRoot, getCurrentConversation: () => scene });
  const cacheV2FrozenSnapshots = { conversation: null, responders: new Map(), prefixByResponder: new Map() };
  const build = (id, extra = {}) => {
    const visibility = buildCharacterDisclosureContext({ service: store, gameData: scene.gameData, responderId: id, targetIds: [1, 10] });
    return PromptBuilder.buildMessagesWithTokenCount([{ role: "user", content: "如今是谁在位？" }],
      scene.gameData.characters.get(id), scene.gameData, "", {
        ...visibility, openingGameDate: { date: "1079.5.3", year: 1079 }, cacheV2FrozenSnapshots,
        publicRealmProfile: store.getPublicRealmProfile({ gameData: scene.gameData, ownerRuntimeId: id }), ...extra
      }, { providerType: "deepseek" }).messages.map(message => message.content).join("\n");
  };
  const song = build(2);
  assert.match(song, /1079\.5\.3/);
  assert.match(song, /年代常识按真实年份/);
  assert.match(song, /宋新君.*新宋.*景和元年/);
  assert.match(song, /宋上级.*宋内阁/);
  assert.match(song, /甲伯爵.*甲伯爵领/);
  assert.doesNotMatch(song, /辽帝|大康|昨日伯爵|伪造伯爵|张居正|虚构的旧朝参考/);
  assert.match(build(3), /辽帝.*大康五年/);
  assert.doesNotMatch(build(3), /景和|甲伯爵/);
  assert.equal(fs.existsSync(store.filePath), false, "read-only public recognition never writes to disclosure store");

  const target = store.getTargetView({ ownerRuntimeId: 2, targetRuntimeId: 10 });
  const hidden = target.facts.find(fact => fact.factType === "NAME");
  assert(hidden?.effectiveKnown, "verified public identity is recognized by the disclosure store");
  store._write({ schemaVersion: 1, sourceRevisions: {}, records: [{
    ...target.scope, factType: hidden.factType, factKey: hidden.factKey, value: hidden.value, revision: 1, evidence: [],
    manual: { status: "MANUAL_HIDDEN", factSourceSnapshotId: hidden.factSourceSnapshotId, acquiredDate: gameData.date }
  }] });
  scene.selectedCharacterIds.delete(10);
  assert.doesNotMatch(build(2), /宋新君|景和元年/, "manual hiding remains effective after the sovereign leaves the scene");
  const malformedManual = store._read();
  malformedManual.records[0].manual.acquiredDate = "INVALID";
  store._write(malformedManual);
  assert.doesNotMatch(build(2), /宋新君|景和元年/, "a malformed hiding date cannot expose a public row");

  const observedChange = await writeAndParse([...header(),
    row("realm_identity", 2, 18, 1, 393860, "SOVEREIGN", "继位者", "新朝", "皇帝")]);
  preserveSocialRecognition(gameData, observedChange);
  assert.deepEqual(getPublicRealmIdentities(observedChange, 2), [], "action readback drops contradictory opening identities without granting new knowledge");
  const next = await writeAndParse([...header(), row("realm_identity", 2, 18, 1, 393860, "SOVEREIGN", "继位者", "新朝", "皇帝"),
    row("reign_era", 2, 18, 1, 393860, "更元", "元")]);
  activateSocialRecognition(next, [2]);
  scene.gameData = next;
  assert.match(build(2), /继位者.*更元元年/);
  assert.doesNotMatch(build(2), /宋新君|景和|甲伯爵/, "same-day new opening does not inherit old occupants");
  const changedDay = await writeAndParse([...header("1079.5.4", 393861)]);
  preserveSocialRecognition(next, changedDay);
  assert.deepEqual(getPublicRealmIdentities(changedDay, 2), [], "a different date does not authorize the opening political scope");
  scene.gameData = changedDay;
  assert.match(build(2), /本场开场 CK3 日期 ===\n日期：1079\.5\.3/, "opening block retains its date after a game-data refresh");
  assert.match(build(2), /日期=1079\.5\.4/, "custom templates can still request the latest CK3 date");
  const bundledMain = fs.readFileSync(path.resolve(__dirname, "../resources/app/default_userdata/prompts/system/default.hbs"), "utf8");
  mainTemplate = bundledMain.slice(bundledMain.indexOf("{{! VOTC_SEGMENT:world_context }}"), bundledMain.indexOf("{{! VOTC_SEGMENT:character_base }}"));
  const openingOnly = build(2);
  assert.equal((openingOnly.match(/1079\.5\.3/g) || []).length, 1, "bundled world context reuses the opening date without duplicating it");
  assert.doesNotMatch(openingOnly, /1079\.5\.4/, "bundled world context omits the competing live date");
  useV813 = false;
  assert.match(build(2), /=== 本场开场 CK3 日期 ===/);
  assert.doesNotMatch(build(2, { cacheV2FrozenSnapshots: null, worldBackground: { text: "此战役使用架空历法" } }),
    /年代常识按真实年份/);
  assert.equal((await writeAndParse(header("未知"))).year, null, "unknown dates do not silently become 976");
}

run().then(() => console.log("PASS V9.8 realm roleplay: CK3 date, scoped hierarchy, custom era, prompt projection and manual privacy"))
  .catch(error => { console.error(error); process.exitCode = 1; })
  .finally(() => fs.rmSync(temporaryRoot, { recursive: true, force: true }));
