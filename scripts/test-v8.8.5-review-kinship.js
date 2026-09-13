"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { Conversation } = require("../resources/app/out/main/conversation/conversation");
const { extractRequestedActionArgs, settleActionResult } = require("../resources/app/out/main/actions/action-confirmation");
const { resolveCharacterAge } = require("../resources/app/out/main/worldline/character-age-service");
const { buildKinshipGraph } = require("../resources/app/out/main/worldline/character-kinship-graph");
const opinion = require("../resources/app/default_userdata/actions/standard/z_changeOpinionOf");
const { createRunFileManager } = require("../resources/app/out/main/actions/run-file-manager");
const { createActionEngine } = require("../resources/app/out/main/actions/action-engine");
const { PromptScriptSandbox } = require("../resources/app/out/main/prompts/prompt-script-sandbox");
const { buildLegacyFamilyLine } = require("../resources/app/out/main/worldline/legacy-family-presentation");
const { resolveAnchoredRelationMention } = require("../resources/app/out/main/worldline/anchored-relation-resolver");
const { compareCharacterSeniority } = require("../resources/app/out/main/worldline/character-age-service");
const { Character } = require("../resources/app/out/main/game-data/character");
const { createGameData } = require("../resources/app/out/main/game-data/game-data");

const failures = [];
async function check(name, fn) {
  try { await fn(); console.log("PASS " + name); }
  catch (error) { failures.push(name + ": " + error.stack); }
}

function familyFixture() {
  const person = (id, gender, age, extra = {}) => ({ id, shortName: "person" + id, fullName: "person" + id, gender, age, alive: true, ...extra });
  return { date: "1186.6.1", characters: new Map([
    [1, person(1, "male", 30, { parents: [{ id: 2 }, { id: 3 }] })],
    [2, person(2, "male", 60, { parents: [{ id: 4 }, { id: 5 }], siblings: [{ id: 6 }, { id: 7 }, { id: 8 }] })],
    [3, person(3, "female", 55, { siblings: [{ id: 9 }, { id: 10 }], parents: [{ id: 11 }, { id: 12 }] })],
    [4, person(4, "male", 85)], [5, person(5, "female", 82)],
    [6, person(6, "male", 65, { children: [{ id: 13 }, { id: 14 }] })],
    [7, person(7, "male", 50)], [8, person(8, "female", 58, { children: [{ id: 15 }] })],
    [9, person(9, "male", 50, { children: [{ id: 16 }] })], [10, person(10, "female", 57)],
    [11, person(11, "male", 80)], [12, person(12, "female", 78)],
    [13, person(13, "male", 35)], [14, person(14, "female", 32)],
    [15, person(15, "male", 20)], [16, person(16, "female", 25)]
  ]) };
}

async function run() {
  await check("queued action survives 20 seconds before its ACK clock starts", async () => {
    const oldNow = Date.now;
    const oldTimer = global.setTimeout;
    let time = 1000;
    let cancelled = false;
    const command = { commandId: "second", status: "queued", writtenAt: null, writeAttempts: 0 };
    const manager = { getPendingCommands: () => [command], getRecentCommands: () => [], getQueueHealth: () => ({}), hasWriteHistory: c => c.writeAttempts > 0, cancelCommand: () => { cancelled = true; } };
    Conversation.configure({ runFileManager: manager });
    Date.now = () => time;
    global.setTimeout = (fn, ms) => {
      time += ms;
      if (time >= 21000 && !command.writeAttempts) Object.assign(command, { status: "awaiting_ack", writtenAt: 21000, writeAttempts: 1 });
      if (time >= 26000) command.status = "acknowledged";
      if (time > 140000) throw new Error("confirmation loop did not settle");
      fn();
    };
    try {
      const conv = Object.create(Conversation.prototype);
      const result = await conv.waitForActionConfirmation({ confirmation: { type: "RUN_ACK", dispatch: { commandId: "second" } } });
      assert.strictEqual(cancelled, false);
      assert.strictEqual(result.lifecycle.status, "ACKNOWLEDGED");
      assert(time >= 26000);
    } finally { Date.now = oldNow; global.setTimeout = oldTimer; }
  });
  await check("only unique unambiguous payment amount may override model", () => {
    const extract = text => extractRequestedActionArgs("playerPaysGoldTo", [{ role: "user", content: text }]);
    assert.deepStrictEqual(extract("我给他100两。"), { amount: 100 });
    for (const text of ["给他100……等等，改成20吧。", "给他100，再给她20。", "不要给他100两。", "give him 100, no, make it 20", "我有300两，给他20两。"]) assert.strictEqual(extract(text), null, text);
  });
  await check("opinion wording never confirms before state verification", () => {
    const feedback = opinion.run({ sourceCharacter: { id: 1, shortName: "A" }, targetCharacter: { id: 2, shortName: "B" }, args: { value: 2 }, runGameEffect: () => {} });
    assert.match(feedback.message.zh, /等待游戏确认/);
    assert.doesNotMatch(feedback.message.zh, /改善了/);
    assert.match(feedback.confirmedMessage.zh, /改善了2/);
    const localized = { feedback: { message: feedback.message.zh, confirmedMessage: feedback.confirmedMessage.zh } };
    assert.match(settleActionResult(localized, { status: "CONFIRMED" }).feedback.message, /改善了2/);
    assert.doesNotMatch(settleActionResult(localized, { status: "NO_EFFECT" }).feedback.message, /改善了2/);
  });
  await check("missing age and day fields are not zero; real newborn is zero", () => {
    for (const age of [null, undefined, "", "  ", false, -1, "invalid"]) assert.strictEqual(resolveCharacterAge({ age }).age, null, String(age));
    assert.strictEqual(resolveCharacterAge({ age: 0 }).age, 0);
    assert.strictEqual(resolveCharacterAge({ age: 35, birthDateTotalDays: null }, { currentTotalDays: 400000 }).age, 35);
    assert.strictEqual(resolveCharacterAge({ birthDate: "1156.6.2", birthDateTotalDays: null }, { currentGameDate: "1186.6.1", currentTotalDays: null }).age, 29);
    assert.strictEqual(resolveCharacterAge({ age: 60, alive: false }).age, null);
    const raw = Array(27).fill("");
    raw[0] = 1;
    assert.strictEqual(resolveCharacterAge(new Character(raw)).age, null, "parser must not turn empty raw age into zero first");
  });
  await check("array parents and live siblings derive exact extended kinship", () => {
    const graph = buildKinshipGraph(familyFixture().characters);
    for (const [id, label] of [[4, "祖父"], [5, "祖母"], [6, "伯父"], [7, "叔父"], [8, "姑母"], [9, "舅父"], [10, "姨母"], [11, "外祖父"], [12, "外祖母"], [13, "堂哥"], [14, "堂姐"], [15, "表弟"], [16, "表妹"]]) assert.strictEqual(graph.relationBetween(id, 1).relation?.label, label, String(id));
    const data = familyFixture();
    data.characters.get(13).age = null;
    assert.strictEqual(buildKinshipGraph(data.characters).relationBetween(13, 1).relation.label, "堂亲");
    data.characters.get(13).age = 30;
    assert.strictEqual(buildKinshipGraph(data.characters).relationBetween(13, 1).relation.label, "堂亲");
  });
  await check("extended queries use the right branch and seniority reference", () => {
    const graph = buildKinshipGraph(familyFixture().characters);
    for (const [query, id] of [["你的堂哥", 13], ["你的堂姐", 14], ["你的表弟", 15], ["你的表妹", 16], ["你的伯父", 6], ["你的叔叔", 7], ["你的姑母", 8], ["你的舅父", 9], ["你的姨母", 10], ["你的祖父", 4], ["你的外祖母", 12]]) {
      const result = resolveAnchoredRelationMention({ query, responderId: 1, graph });
      assert.strictEqual(result.status, "RELATION_RESOLVED", query);
      assert.strictEqual(result.targetRuntimeId, String(id), query);
    }
  });
  await check("birthday wins over raw age; unknown, death age and ties stay neutral", () => {
    assert.strictEqual(compareCharacterSeniority({ age: 20, birthDate: "1150.1.1" }, { age: 50, birthDate: "1160.1.1" }), 1);
    assert.strictEqual(compareCharacterSeniority({ age: 50, alive: false }, { age: 40, alive: true }), null);
    assert.strictEqual(compareCharacterSeniority({ age: null }, { age: 40 }), null);
    assert.strictEqual(compareCharacterSeniority({ age: 10, birthDateTotalDays: 100 }, { age: 20, birthDateTotalDays: 100 }), null);
    const data = familyFixture();
    data.characters.get(6).gender = "unknown";
    assert.strictEqual(buildKinshipGraph(data.characters).relationBetween(13, 1).relation.label, "堂表亲");
    data.characters.get(2).gender = "unknown";
    assert.strictEqual(buildKinshipGraph(data.characters).relationBetween(4, 1).relation.label, "祖辈亲属");
  });
  await check("old English template execution injects relatives without file/data mutation", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v885-template-"));
    try {
      const script = path.join(dir, "pListMccTest2.js");
      const code = 'module.exports = g => familyLine(g.characters.get(1)); function familyLine(char) { return "old family"; }';
      fs.writeFileSync(script, code);
      const data = familyFixture();
      const before = JSON.stringify([...data.characters]);
      const text = PromptScriptSandbox.executeDescription(script, { gameData: data, currentCharacterId: 1 });
      assert.match(text, /older male paternal parallel cousin \(堂哥\); sex: male; age: 35/);
      assert.match(text, /father's older brother \(伯父\)/);
      assert.match(text, /maternal grandmother \(外祖母\)/);
      assert.strictEqual(fs.readFileSync(script, "utf8"), code);
      assert.strictEqual(JSON.stringify([...data.characters]), before);
      assert.match(buildLegacyFamilyLine(data.characters.get(1), data, { limit: 2 }).text, /truncated/);
      assert.strictEqual(buildLegacyFamilyLine(data.characters.get(1), data, { limit: 2 }).count, 2);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
  await check("multiple amounts preserve model-selected 20 all the way into execution", async () => {
    let executed;
    const Engine = createActionEngine({ actionRegistry: { getById: () => ({ filePath: "fixture.js", validation: { valid: true } }) }, settingsRepository: { getLanguage: () => "zh" }, ActionSandbox: { executeAction: async (_path, context) => { executed = context.args.amount; return { message: "fixture" }; } }, resolveI18nString: value => value });
    const npc = { id: 2 };
    const conv = { gameData: { playerID: 1, characters: new Map([[2, npc]]) }, getHistory: () => [{ role: "user", content: "给他100，等等，改成20吧。" }] };
    const result = await Engine.runInvocation(conv, npc, { actionId: "playerPaysGoldTo", targetCharacterId: 2, args: { amount: 20 } });
    assert.strictEqual(executed, 20);
    assert.strictEqual(result.diagnostic.argumentDrift, null);
  });
  await check("complete shipped and legacy English pList both render enhanced families", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v885-plist-"));
    try {
      const data = familyFixture();
      data.playerID = 1; data.aiID = 1; data.playerName = "person1"; data.location = "court"; data.scene = "throne_room"; data.locationController = "person1";
      data.characters = new Map([...data.characters].map(([id, person]) => {
        const raw = Array(27).fill("");
        raw[0] = id; raw[1] = raw[2] = raw[18] = person.fullName; raw[4] = person.gender === "male" ? "他" : "她"; raw[5] = person.age;
        return [id, Object.assign(new Character(raw), person)];
      }));
      const shipped = path.resolve(__dirname, "../resources/app/default_userdata/prompts/character_description/standard/pListMccTest2.js");
      const legacy = path.join(dir, "pListMccTest2.js");
      fs.writeFileSync(legacy, fs.readFileSync(shipped, "utf8").replace(/^.*typeof __votcFamily.*\r?\n/gm, ""));
      for (const file of [shipped, legacy]) {
        const output = PromptScriptSandbox.executeDescription(file, { gameData: data, currentCharacterId: 1 });
        assert.match(output, /father's older brother \(伯父\)/);
        assert.match(output, /older female paternal parallel cousin \(堂姐\)/);
        assert.match(output, /maternal grandmother \(外祖母\)/);
        assert.doesNotMatch(output, /age: null|age: NaN/);
      }
      const GameData = createGameData({ fs: {}, path: {}, memorySystem: {}, memoryEngine: {}, summariesDir: "", getHistoricalReferenceByYear: () => ({}) });
      const runtime = Object.assign(new GameData([1, "person1", 1, "person1", data.date, data.scene, data.location, "person1", 433000]), data);
      const output = PromptScriptSandbox.executeDescription(legacy, { gameData: runtime, currentCharacterId: 1 });
      assert.match(output, /older female paternal parallel cousin \(堂姐\)/);
      assert.match(output, /father's younger brother \(叔父\)/);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
  await check("queue manager owns 120-second TTL and never expires a written effect", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v885-queue-"));
    try {
      let time = 1000;
      const ck3 = path.join(dir, "ck3");
      fs.mkdirSync(path.join(ck3, "run"), { recursive: true });
      const Manager = createRunFileManager({ fs, path, dataDir: path.join(dir, "data"), settingsRepository: { getCK3UserFolderPath: () => ck3 }, now: () => time });
      const manager = new Manager();
      manager.initializeAfterAckReconciliation();
      const first = manager.write("add_gold = 1", { kind: "action_effect" });
      const second = manager.write("add_gold = 2", { kind: "action_effect" });
      time += 20000;
      manager.expireQueuedActions();
      assert.strictEqual(manager.getPendingCommands().find(c => c.commandId === second.commandId).status, "queued");
      time += 100000;
      manager.expireQueuedActions();
      assert.strictEqual(manager.getRecentCommands().find(c => c.commandId === second.commandId).status, "expired");
      assert.strictEqual(manager.getPendingCommands()[0].commandId, first.commandId);
      assert.strictEqual(manager.getPendingCommands()[0].writeAttempts, 1);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
  if (failures.length) throw new Error(failures.join("\n"));
}
run().then(() => console.log("V8.8.5 review and kinship: PASS")).catch(error => { console.error(error.message); process.exitCode = 1; });
