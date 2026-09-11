"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createActionEngine } = require("../resources/app/out/main/actions/action-engine");
const { createActionEffectWriter } = require("../resources/app/out/main/actions/action-effect-writer");
const { createRunFileManager } = require("../resources/app/out/main/actions/run-file-manager");
const { createLogParser } = require("../resources/app/out/main/game-data/log-parser");
const { Character } = require("../resources/app/out/main/game-data/character");

const root = path.resolve(__dirname, "..");
const playerAction = require(path.join(root, "resources", "app", "default_userdata", "actions", "standard", "z_playerPaysGoldTo.js"));
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v883-sol-action-"));

(async () => {
  try {
    const ck3Dir = path.join(tempDir, "ck3");
    const dataDir = path.join(tempDir, "data");
    fs.mkdirSync(path.join(ck3Dir, "run"), { recursive: true });
    const RunFileManager = createRunFileManager({ settingsRepository: { getCK3UserFolderPath: () => ck3Dir }, path, fs, dataDir, now: () => 100, random: () => 0.5 });
    const runFileManager = new RunFileManager();
    runFileManager.initializeAfterAckReconciliation();
    const EffectWriter = createActionEffectWriter({ runFileManager });
    const player = { id: 1, shortName: "玩家", fullName: "玩家", gold: 1000 };
    const target = { id: 2, shortName: "目标", fullName: "目标", gold: 200 };
    const gameData = { playerID: 1, playerName: "玩家", characters: new Map([[1, player], [2, target]]) };
    let dispatch;
    const actionResult = playerAction.run({
      gameData,
      sourceCharacter: target,
      targetCharacter: target,
      args: { amount: 100 },
      runGameEffect: (body) => { dispatch = EffectWriter.writeEffect(gameData, 1, 2, body); }
    });
    const runFileText = fs.readFileSync(path.join(ck3Dir, "run", "votc.txt"), "utf8");
    const targetMutation = runFileText.indexOf("add_gold = 100");
    const targetReadback = runFileText.indexOf("log_income = yes", targetMutation);
    const sourceMutation = runFileText.indexOf("remove_short_term_gold = 100");
    const sourceReadback = runFileText.indexOf("log_income = yes", sourceMutation);
    const ack = runFileText.indexOf(`VOTC:RUN_ACK/ACTION_EFFECT/${dispatch.commandId}`);
    assert(targetMutation >= 0 && targetMutation < targetReadback);
    assert(targetReadback < sourceMutation && sourceMutation < sourceReadback && sourceReadback < ack, "both post-effect gold readbacks must precede ACK");
    assert.strictEqual(dispatch.sourceIndex, 0);
    assert.strictEqual(dispatch.targetIndex, 1);
    assert.match(actionResult.message.zh, /等待游戏确认/);
    assert.match(actionResult.confirmedMessage.zh, /已向.*支付100金币/);

    class FakeGameData {
      constructor(data) {
        this.playerID = Number(data[0]);
        this.characters = new Map();
      }
    }
    const characterLine = (id, name, gold) => `VOTC:IN/;/character/;/${[id, name, name, "", "他", "20", gold, "0", "", "", "0", "0", "", "", "", "", "", "0", name, "", "", "0", "0", "", "0", "", ""].join("/;/")}`;
    const logPath = path.join(tempDir, "debug.log");
    fs.writeFileSync(logPath, [
      "VOTC:IN/;/init/;/1/;/玩家/;/2/;/目标/;/1170.1.1/;/talk_scene_court/;/京师/;/玩家/;/420000",
      characterLine(1, "玩家", 1000),
      characterLine(2, "目标", 200),
      "VOTC:IN/;/income/;/1/;/900/;/0/;/STARTMULTILINE#readback#ENDMULTILINE",
      "VOTC:IN/;/income/;/2/;/300/;/0/;/STARTMULTILINE#readback#ENDMULTILINE"
    ].join("\n"), "utf8");
    const parsed = await createLogParser({ GameData: FakeGameData, Character })(logPath);
    assert.strictEqual(parsed.characters.get(1).gold, 900, "fresh income readback must update canonical character gold");
    assert.strictEqual(parsed.characters.get(2).gold, 300);

    let executedArgs;
    let executedSourceId;
    const Engine = createActionEngine({
      actionRegistry: { getById: () => ({ filePath: "playerPaysGoldTo.js", validation: { valid: true } }) },
      settingsRepository: { getLanguage: () => "zh-CN" },
      ActionSandbox: { executeAction: async (_file, context) => {
        executedArgs = context.args;
        context.runGameEffect("effect = yes");
        return { message: "pending", expectedStateChange: { type: "GOLD_TRANSFER", sourceRuntimeId: 1, targetRuntimeId: 2, amount: context.args.amount } };
      } },
      ActionEffectWriter: { writeEffect: (_gameData, sourceId) => { executedSourceId = sourceId; return { commandId: "drift-command", status: "awaiting_ack", sourceIndex: 0, targetIndex: 1 }; } },
      resolveI18nString: (value) => value
    });
    const conversation = {
      gameData,
      gameDataRevision: 3,
      getHistory: () => [{ role: "user", content: "我给他100两。" }, { role: "assistant", content: "我只收三十两。" }]
    };
    const driftResult = await Engine.runInvocation(conversation, target, { actionId: "playerPaysGoldTo", targetCharacterId: 2, args: { amount: 30 } });
    assert.deepStrictEqual(executedArgs, { amount: 100 }, "explicit user amount must be the executed amount");
    assert.strictEqual(executedSourceId, 1, "player gold action must bind the RunFile source to the player Runtime ID");
    assert.strictEqual(driftResult.diagnostic.sourceRuntimeId, 1);
    assert.strictEqual(driftResult.diagnostic.requestedByUser, 100);
    assert.deepStrictEqual(driftResult.diagnostic.selectedArgs, { amount: 30 });
    assert.deepStrictEqual(driftResult.diagnostic.effectiveArgs, { amount: 100 });
    assert.strictEqual(driftResult.diagnostic.argumentDrift.code, "ACTION_ARGUMENT_DRIFT");
    assert.strictEqual(driftResult.confirmation.amount, 100);
    assert.strictEqual(driftResult.diagnostic.dispatchEvidence.sourceIndex, 0);
    assert.strictEqual(driftResult.diagnostic.dispatchEvidence.targetIndex, 1);

    const conversationSource = fs.readFileSync(path.join(root, "resources", "app", "out", "main", "conversation", "conversation.js"), "utf8");
    assert(!conversationSource.includes('if (!command || command.status === "acknowledged")'), "missing command history must never be treated as an ACK");
    console.log("VOTC v8.8.3 Sol Action confirmation contract: PASS");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
