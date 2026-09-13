"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createRunFileManager } = require("../resources/app/out/main/actions/run-file-manager");
const { PromptScriptSandbox } = require("../resources/app/out/main/prompts/prompt-script-sandbox");
const { createGameData } = require("../resources/app/out/main/game-data/game-data");
const { Character } = require("../resources/app/out/main/game-data/character");
const { createLogParser } = require("../resources/app/out/main/game-data/log-parser");
const { buildFamilyFactBlock } = require("../resources/app/out/main/worldline/character-family-facts");
const { resolveRelationshipCurrentTruth } = require("../resources/app/out/main/worldline/relationship-current-truth");
const { verifyActionConfirmation, settleActionResult } = require("../resources/app/out/main/actions/action-confirmation");
const { readActionCommandReadback } = require("../resources/app/out/main/actions/action-command-readback");
const { createActionEffectWriter } = require("../resources/app/out/main/actions/action-effect-writer");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v884-incident-"));

async function run() {
  const failures = [];
  async function check(name, test) {
    try { await test(); console.log("PASS " + name); }
    catch (error) { failures.push(name + ": " + error.message); }
  }
  await check("legacy English description consumes Chinese live pronouns", () => {
    const script = path.join(temp, "legacy-description.js");
    fs.writeFileSync(script, 'module.exports = (g) => g.characters.get(1).children.map(c => c.name + ":" + (c.sheHe === "he" ? "son" : "daughter")).join(";");');
    const children = [
      { id: 11, name: "男孩", sheHe: "他", gender: "male" },
      { id: 12, name: "女孩", sheHe: "她", gender: "female" },
      { id: 13, name: "未知", sheHe: "", gender: "unknown" }
    ];
    const result = PromptScriptSandbox.executeDescription(script, { gameData: { characters: new Map([[1, { id: 1, children }]]) }, currentCharacterId: 1 });
    assert.strictEqual(result, "男孩:son;女孩:daughter;未知:child");
    assert.strictEqual(children[0].sheHe, "他", "compatibility must not mutate live data or user scripts");
    fs.writeFileSync(script, 'module.exports = (g) => g.characters.get(1).children.map(c => isMale(c) ? "son" : "daughter").join(";");');
    assert.strictEqual(PromptScriptSandbox.executeDescription(script, { gameData: { characters: new Map([[1, { id: 1, children }]]) } }), "son;daughter;child");
    children[0].evidence = { conflicts: { gender: true } };
    assert.strictEqual(PromptScriptSandbox.executeDescription(script, { gameData: { characters: new Map([[1, { id: 1, children }]]) } }), "child;daughter;child");
  });
  await check("live relatives absent from participants retain verified sex", async () => {
    const GameData = createGameData({ fs: {}, path: {}, memorySystem: {}, memoryEngine: {}, summariesDir: "", getHistoricalReferenceByYear: () => ({}) });
    const log = path.join(temp, "debug.log");
    const char = [1, "母亲", "母亲", "", "她", 30, 100, 0, "", "", 0, 0, "", "", "", "", "", 0, "母亲", "", "", 0, 0, "", 0, "", ""];
    fs.writeFileSync(log, [
      "VOTC:IN/;/init/;/1/;/母亲/;/1/;/母亲/;/1186.6.9/;/scene/;/城/;/母亲/;/433050",
      "VOTC:IN/;/character/;/" + char.join("/;/"),
      "VOTC:IN/;/kids/;/1/;/11/;/男孩/;/他/;/430000/;/1178.1.1/;/",
      "VOTC:IN/;/kid_eob/;/1/;/",
      "VOTC:IN/;/kids/;/1/;/12/;/女孩/;/她/;/430001/;/1178.1.2/;/",
      "VOTC:IN/;/kid_eob/;/1/;/",
      "VOTC:IN/;/opinions/;/1/;/11/;/20/;/",
      "VOTC:IN/;/opinions/;/1/;/11/;/22/;/"
    ].join("\n"));
    const gameData = await createLogParser({ GameData, Character })(log);
    assert.strictEqual(gameData.characters.size, 1, "relatives must not become action participants");
    assert.deepStrictEqual(gameData.characters.get(1).opinions, [{ id: 11, opinon: 22 }], "latest CK3 opinion must replace, not append behind an old value");
    const fact = resolveRelationshipCurrentTruth({ gameData, subjectRuntimeId: 11, anchorRuntimeId: 1 });
    assert.strictEqual(fact.currentState.sex, "male");
    const family = buildFamilyFactBlock(gameData.characters.get(1), gameData, { query: "我们有几个孩子？" });
    assert.match(family, /儿子：男孩/);
    assert.match(family, /女儿：女孩/);
    gameData.characters.set(11, { id: 11, gender: "unknown", parents: [], children: [], siblings: [] });
    assert.strictEqual(resolveRelationshipCurrentTruth({ gameData, subjectRuntimeId: 11, anchorRuntimeId: 1 }).currentState.sex, "unknown", "explicit canonical unknown must not be replaced by side evidence");
  });
  await check("expired date head cannot block or replay old actions", () => {
    const dir = path.join(temp, "queue");
    const ck3 = path.join(dir, "ck3");
    const dataDir = path.join(dir, "data");
    fs.mkdirSync(path.join(ck3, "run"), { recursive: true });
    fs.mkdirSync(dataDir, { recursive: true });
    const carrier = path.join(ck3, "run", "votc.txt");
    fs.writeFileSync(carrier, "");
    const pendingCommands = [
      { commandId: "old-date", kind: "date_producer_rearm", effectText: "trigger_event = mcc_event_v2.9998", queuedAt: 100, writtenAt: 100, writeAttempts: 1, status: "stalled", expiresAt: 0 },
      ...[1, 2, 3].map(i => ({ commandId: "old-action-" + i, kind: "action_effect", effectText: "add_gold = 100", queuedAt: 200, writtenAt: null, writeAttempts: 0, status: "queued", expiresAt: null }))
    ];
    fs.writeFileSync(path.join(dataDir, "run-command-queue.json"), JSON.stringify({ version: 3, pendingCommands, recentCommands: [] }));
    const Manager = createRunFileManager({ settingsRepository: { getCK3UserFolderPath: () => ck3 }, path, fs, dataDir, now: () => 1000000 });
    const manager = new Manager();
    manager.initializeAfterAckReconciliation();
    assert.strictEqual(manager.getPendingCommands().length, 0);
    assert.strictEqual(fs.readFileSync(carrier, "utf8"), "");
    assert(manager.getRecentCommands().some(c => c.commandId === "old-date" && c.status === "quarantined"));
    const fresh = manager.write("add_gold = 1", { kind: "action_effect" });
    assert.strictEqual(fresh.status, "awaiting_ack");
    assert.doesNotMatch(fs.readFileSync(carrier, "utf8"), /add_gold = 100/);
    const backup = JSON.parse(fs.readFileSync(path.join(dataDir, "run-command-queue.json.v8.8.4-backup"), "utf8"));
    assert.strictEqual(backup.pendingCommands.length, 4, "original queue must remain recoverable");
    assert.strictEqual(manager.isCommandExpired({ ...fresh, expiresAt: 1 }), false, "a written action must never auto-expire or replay");
    manager.markActiveCommandStalledIfNeeded({ ackTimeoutMs: 0 });
    assert.strictEqual(manager.getPendingCommands()[0].status, "stalled");
    assert.strictEqual(manager.getPendingCommands()[0].writeAttempts, 1);
    manager.write("add_gold = 2", { kind: "action_effect", scopeId: "old-conversation", epoch: 1 });
    const restarted = new Manager();
    restarted.initializeAfterAckReconciliation();
    assert.strictEqual(restarted.getPendingCommands().length, 1, "even a recent unwritten previous-session action must not replay");
    assert.strictEqual(restarted.getPendingCommands()[0].commandId, fresh.commandId);
  });
  await check("ACK-only actions and queued cancellations are not fabricated state changes", () => {
    const ack = verifyActionConfirmation({ confirmation: { type: "RUN_ACK" } });
    const result = { feedback: { message: "opinion request" } };
    assert.strictEqual(ack.status, "ACKNOWLEDGED");
    assert.strictEqual(settleActionResult(result, ack).lifecycle.confirmed, false);
    assert.strictEqual(settleActionResult(result, ack).success, false, "receipt is not effect success");
    for (const status of ["QUEUE_BLOCKED", "QUEUE_EXPIRED"]) {
      const settled = settleActionResult(result, { status });
      assert.strictEqual(settled.success, false);
      assert.strictEqual(settled.lifecycle.dispatched, false);
    }
    const confirmation = { type: "GOLD_TRANSFER", sourceRuntimeId: 1, targetRuntimeId: 2, amount: 20, before: { sourceGold: 261.08428, targetGold: 0, gameDataRevision: 1 } };
    const gameData = { characters: new Map([[1, { gold: 241.08428 }], [2, { gold: 20 }]]) };
    assert.strictEqual(verifyActionConfirmation({ confirmation, gameData, gameDataRevision: 2 }).status, "CONFIRMED");
    gameData.characters.get(2).gold = 19;
    assert.strictEqual(verifyActionConfirmation({ confirmation, gameData, gameDataRevision: 2 }).status, "STATE_MISMATCH");
  });
  await check("command-bound state ignores later income and reports opinion caps honestly", async () => {
    const log = path.join(temp, "command-readback.log");
    const commandId = "payment-1";
    const records = [
      "VOTC:IN/;/income/;/1/;/100/;/0",
      "VOTC:ACTION_BEGIN/ACTION_EFFECT/" + commandId,
      "VOTC:ACTION_SOURCE/;/1", "VOTC:ACTION_TARGET/;/2",
      "VOTC:IN/;/income/;/1/;/261.08428/;/0",
      "VOTC:IN/;/income/;/2/;/50/;/0",
      "VOTC:IN/;/income/;/2/;/311/;/0",
      "VOTC:IN/;/income/;/1/;/0.08428/;/0",
      "VOTC:RUN_ACK/ACTION_EFFECT/" + commandId,
      "VOTC:IN/;/income/;/1/;/500/;/0"
    ];
    fs.writeFileSync(log, records.join("\n"));
    const commandReadback = await readActionCommandReadback(log, commandId);
    const confirmation = { type: "GOLD_TRANSFER", sourceRuntimeId: 1, targetRuntimeId: 2, amount: 261, before: { sourceGold: 100, targetGold: 0 }, dispatch: { commandId }, requireCommandReadback: true };
    assert.strictEqual(verifyActionConfirmation({ confirmation, commandReadback }).status, "CONFIRMED");
    assert.strictEqual(verifyActionConfirmation({ confirmation, commandReadback: { ...commandReadback, commandId: "other" } }).status, "UNCONFIRMED");
    assert.strictEqual(verifyActionConfirmation({ confirmation, commandReadback: { ...commandReadback, sourceRuntimeId: 3 } }).status, "BINDING_FAILED");
    commandReadback.gold[2].after = 572;
    assert.strictEqual(verifyActionConfirmation({ confirmation, commandReadback }).status, "STATE_MISMATCH", "duplicate transfer must not pass exact verification");
    confirmation.type = "OPINION_CHANGE";
    confirmation.amount = 2;
    fs.writeFileSync(log, [records[1], records[2], records[3], "VOTC:IN/;/opinions/;/1/;/2/;/20/;/", "VOTC:IN/;/opinions/;/1/;/2/;/22/;/", records[8]].join("\n"));
    commandReadback.opinion = (await readActionCommandReadback(log, commandId)).opinion;
    assert.strictEqual(verifyActionConfirmation({ confirmation, commandReadback }).status, "CONFIRMED");
    commandReadback.opinion["1:2"].after = 20;
    assert.strictEqual(verifyActionConfirmation({ confirmation, commandReadback }).status, "NO_EFFECT");
    fs.writeFileSync(log, records.slice(0, -2).join("\n"));
    assert.strictEqual(await readActionCommandReadback(log, commandId), null, "missing ACK must not confirm a partial snapshot");
  });
  await check("all effects share correct NPC binding, empty-scope guards and game-side replay protection", () => {
    const Writer = createActionEffectWriter({ runFileManager: {} });
    const gameData = { playerID: 1, characters: new Map([[1, { id: 1 }], [2, { id: 2 }], [3, { id: 3 }]]) };
    assert.strictEqual(Writer.getCharacterIndex(gameData, 2), 0);
    assert.strictEqual(Writer.getCharacterIndex(gameData, 3), 1);
    const effect = Writer.composeFullEffect(gameData, 1, 2, "add_gold = 261", true, false, 261);
    assert.match(effect, /global_var:votc_action_source = \{ gold >= 261/);
    assert.match(effect, /VOTC:ACTION_INSUFFICIENT_GOLD/);
    assert.match(effect, /root = \{ set_global_variable = \{ name = votc_action_source value = root/);
    assert.match(effect, /exists = global_var:votc_action_source exists = global_var:votc_action_target/);
    assert(effect.indexOf("log_income = yes") < effect.indexOf("add_gold = 261"));
    assert(effect.lastIndexOf("log_income = yes") > effect.indexOf("add_gold = 261"));
    const Manager = createRunFileManager({ settingsRepository: {}, path, fs });
    const carrier = Manager.prototype.composeCommandText({ kind: "action_effect", commandId: "once-1", effectText: effect });
    assert.match(carrier, /NOT = \{ global_var:votc_last_action_command = flag:once-1/);
    assert(carrier.indexOf("value = flag:once-1") < carrier.indexOf("VOTC:ACTION_BEGIN"));
    assert(carrier.indexOf("add_gold = 261") < carrier.indexOf("VOTC:RUN_ACK"));
  });
  if (failures.length) throw new Error(failures.join("\n"));
}
run().then(() => console.log("VOTC v8.8.4 incident regression: PASS")).catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => fs.rmSync(temp, { recursive: true, force: true }));
