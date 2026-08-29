const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const root = path.resolve(__dirname, "..");
const mainPath = path.join(root, "resources", "app", "out", "main", "main.js");
const actionsDir = path.join(root, "resources", "app", "default_userdata", "actions", "standard");
const source = fs.readFileSync(mainPath, "utf8");
const engineSource = fs.readFileSync(path.join(root, "resources", "app", "out", "main", "action-system", "action-engine-v3.js"), "utf8");
const retiredFiles = ["z_performCombatAction.js", "z_performDailyAction.js", "z_performIntimateAction.js"];
const retiredIds = ["performCombatAction", "performDailyAction", "performIntimateAction"];

for (const filename of retiredFiles) {
  assert(!fs.existsSync(path.join(actionsDir, filename)), `${filename} must not ship in standard actions`);
}
assert(!engineSource.includes("sceneActionIds"), "ActionEngine must not keep Scene Action candidate handling");
assert(!engineSource.includes("repeatableSceneCategories"), "Scene Event categories must not expand maxActions");

const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v671-scene-"));
try {
  const VOTC_ACTIONS_DIR = path.join(fixtureRoot, "user-actions");
  const VOTC_DATA_DIR = path.join(fixtureRoot, "user-data");
  const DEFAULT_USERDATA_DIR = path.join(fixtureRoot, "defaults");
  const STANDARD_SUBDIR = "standard";
  const CUSTOM_SUBDIR = "custom";
  const actionSystem = require(path.join(root, "resources", "app", "out", "main", "action-system"));
  const ActionRegistry = actionSystem.ActionRegistry.configure({
    actionsDir: VOTC_ACTIONS_DIR,
    dataDir: VOTC_DATA_DIR,
    defaultUserdataDir: DEFAULT_USERDATA_DIR
  });
  const registry = new ActionRegistry();
  const userStandardDir = path.join(VOTC_ACTIONS_DIR, STANDARD_SUBDIR);
  const userCustomDir = path.join(VOTC_ACTIONS_DIR, CUSTOM_SUBDIR);
  fs.mkdirSync(userStandardDir, { recursive: true });
  fs.mkdirSync(userCustomDir, { recursive: true });
  fs.mkdirSync(path.join(DEFAULT_USERDATA_DIR, STANDARD_SUBDIR), { recursive: true });
  for (const filename of retiredFiles) {
    fs.writeFileSync(path.join(userStandardDir, filename), "stale standard action");
    fs.writeFileSync(path.join(userCustomDir, filename), "custom action must remain");
  }
  fs.writeFileSync(path.join(DEFAULT_USERDATA_DIR, STANDARD_SUBDIR, "z_currentAction.js"), "current default action");

  (async () => {
    globalThis.__V67ActionSystem = require(path.join(root, "resources", "app", "out", "main", "action-system"));
    globalThis.actionRegistry = { getAllActions: () => [] };
    globalThis.settingsRepository = { getLanguage: () => "zh" };
    globalThis.usageAnalytics = { record: () => {} };
    let actionRequestCount = 0;
    globalThis.llmManager = { sendActionsRequest: async () => {
      actionRequestCount += 1;
      throw new Error("Scene Event must not call Action LLM");
    } };
const { getActionEngine } = require("./action-engine-test-helper");
const ActionEngine = getActionEngine();
    const player = { id: 1, shortName: "玩家", fullName: "玩家" };
    const zhangSan = { id: 2, shortName: "张三", fullName: "张三" };
    const gameData = { playerID: player.id, playerName: player.fullName, characters: new Map([[player.id, player], [zhangSan.id, zhangSan]]) };
    for (const content of ["我拿起酒杯。", "我挥剑刺向张三。", "我亲吻张三一下。"]) {
      const result = await ActionEngine.evaluateForCharacter({ gameData, messages: [], actionGateProcessedTriggers: new Set() }, player, null, {
        id: content,
        role: "user",
        name: player.fullName,
        content
      });
      assert.deepStrictEqual(result, { autoApproved: [], needsApproval: [] }, `${content}: Scene Event must not expose an executable action`);
    }
    assert.strictEqual(actionRequestCount, 0, "Scene Events without state actions must not call Action LLM");

    await registry.seedDefaults();
    for (const filename of retiredFiles) {
      assert(!fs.existsSync(path.join(userStandardDir, filename)), `${filename} must be removed only from user standard actions`);
      assert(fs.existsSync(path.join(userCustomDir, filename)), `${filename} must remain in custom actions`);
    }
    assert(fs.existsSync(path.join(userStandardDir, "z_currentAction.js")), "current standard defaults must still seed");
    console.log("VOTC v6.7.1 scene retirement: PASS (retired migration and Scene Event boundary)");
  })().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
} finally {
  process.on("exit", () => fs.rmSync(fixtureRoot, { recursive: true, force: true }));
}
