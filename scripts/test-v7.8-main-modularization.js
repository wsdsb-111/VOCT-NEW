"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const root = path.resolve(__dirname, "..");
const mainDir = path.join(root, "resources", "app", "out", "main");
const mainSource = fs.readFileSync(path.join(mainDir, "main.js"), "utf8");
const requiredModules = [
  "config/paths.js",
  "config/settings-repository.js",
  "analytics/usage-analytics.js",
  "game-data/character.js",
  "game-data/game-data.js",
  "game-data/log-parser.js",
  "game-data/legacy-historical-reference.js",
  "prompts/prompt-config-manager.js",
  "prompts/prompt-script-sandbox.js",
  "prompts/template-engine.js",
  "prompts/prompt-script-loader.js",
  "prompts/prompt-builder.js",
  "prompts/letter-prompt-builder.js",
  "runtime/run-file-manager.js",
  "conversation/conversation-manager.js",
  "summaries/summaries-manager.js",
  "app/app-updater.js",
  "app/focus-monitor.js",
  "letters/letter-manager.js"
];

for (const relativePath of requiredModules) {
  const modulePath = path.join(mainDir, ...relativePath.split("/"));
  assert(fs.existsSync(modulePath), `missing extracted module: ${relativePath}`);
  const source = fs.readFileSync(modulePath, "utf8");
  assert(!/require\(["'][^"']*main(?:\.js)?["']\)/.test(source), `${relativePath} must not depend on main.js`);
  assert(mainSource.includes(`require("./${relativePath.replace(/\.js$/, "")}")`), `main.js must compose ${relativePath}`);
}

const movedDefinitions = [
  "PromptConfigManager", "SettingsRepository", "UsageAnalytics", "GameData", "Character",
  "PromptScriptSandbox", "TemplateEngine", "PromptScriptLoader", "PromptBuilder", "RunFileManager",
  "ConversationManager", "SummariesManager", "AppUpdater", "FocusMonitor", "LetterPromptBuilder", "LetterManager"
];
for (const name of movedDefinitions) {
  assert(!new RegExp(`^class ${name}\\b`, "m").test(mainSource), `${name} must not be defined in main.js`);
}
assert(!/^async function parseLog\b/m.test(mainSource), "parseLog must not be defined in main.js");
assert(!/^\s{0,2}getHistoricalReferenceByYear\(/m.test(mainSource), "legacy history provider must not be defined in main.js");
assert(mainSource.split(/\r?\n/).length < 1600, "v7.8 composition root must remain below 1600 lines");
const settingsModuleSource = fs.readFileSync(path.join(mainDir, "config", "settings-repository.js"), "utf8");
assert(settingsModuleSource.includes("hashPromptAsset,"), "SettingsRepository must declare the prompt hash dependency");
assert(/createSettingsRepository\(\{[\s\S]{0,500}hashPromptAsset/.test(mainSource), "composition root must inject the prompt hash dependency");
for (const dependency of ["defaultPromptsDir", "defaultMainTemplatePath", "legacyBundledPromptHashes"]) {
  assert(settingsModuleSource.includes(dependency), `SettingsRepository must declare ${dependency}`);
  assert(mainSource.includes(`${dependency}:`), `composition root must inject ${dependency}`);
}

const { VOTC_CORE_VERSION, MEMORY_ENGINE_VERSION } = require(path.join(mainDir, "version"));
assert.strictEqual(VOTC_CORE_VERSION, "7.8.2");
assert.strictEqual(MEMORY_ENGINE_VERSION, "2.4");

const { Character } = require(path.join(mainDir, "game-data", "character"));
const { createGameData } = require(path.join(mainDir, "game-data", "game-data"));
const { getHistoricalReferenceByYear } = require(path.join(mainDir, "game-data", "legacy-historical-reference"));
assert.deepStrictEqual(getHistoricalReferenceByYear(900), {
  period: "唐末黄巢起义至唐朝灭亡",
  context: "黄巢起义动摇唐朝根基，藩镇割据严重，天下大乱",
  notableEvents: ["黄巢起义(875-884)", "长安陷落", "朱温篡唐(907)"],
  notableFigures: ["黄巢", "朱温", "李克用", "李茂贞"]
});
assert.strictEqual(getHistoricalReferenceByYear(976).period, "北宋统一战争");
assert.strictEqual(getHistoricalReferenceByYear(1150).period, "绍兴议和");
assert.strictEqual(getHistoricalReferenceByYear(1280).period, "元朝建立");

const memorySystem = require(path.join(mainDir, "memory-system"));
const GameData = createGameData({
  fs,
  path,
  memorySystem,
  memoryEngine: {},
  summariesDir: path.join(os.tmpdir(), "votc-v78-unused-summaries"),
  getHistoricalReferenceByYear
});
const rawCharacter = Array(27).fill("");
rawCharacter[0] = "2";
rawCharacter[1] = "李师师";
rawCharacter[2] = "东京名伎李师师";
rawCharacter[3] = "无";
rawCharacter[4] = "她";
rawCharacter[5] = "24";
rawCharacter[6] = "10";
rawCharacter[8] = "未知";
const character = new Character(rawCharacter);
assert.strictEqual(character.id, 2);
assert.strictEqual(character.gender, "female");
assert.strictEqual(character.age, 24);

const profileGameData = new GameData(["1", "玩家", "2", "李师师", "976年5月3日", "scene_type_court", "开封", "玩家", "100"]);
const profileCharacter = new Character(rawCharacter);
profileCharacter.children.push({ id: 4, name: "女儿", sheHe: "她", birthDateTotalDays: 50, traits: [] });
profileGameData.characters.set(profileCharacter.id, profileCharacter);
assert.strictEqual(profileGameData.getMentionableCharacterProfiles().get(4).gender, "female", "GameData 必须能为亲属资料解析代词性别");

const { createLogParser } = require(path.join(mainDir, "game-data", "log-parser"));
const parseLog = createLogParser({ GameData, Character });
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v78-parser-"));
try {
  const fixturePath = path.join(tempDir, "debug.log");
  const init = ["VOTC:IN", "init", "1", "玩家", "2", "李师师", "976年5月3日", "scene_type_court", "开封", "玩家", "100"].join("/;/");
  const characterLine = ["VOTC:IN", "character", ...rawCharacter].join("/;/");
  const childLine = ["VOTC:IN", "kids", "2", "4", "女儿", "她", "50", "975年1月1日"].join("/;/");
  const siblingLine = ["VOTC:IN", "siblings", "2", "5", "兄长", "他", "-100", "974年1月1日"].join("/;/");
  fs.writeFileSync(fixturePath, `${init}\n${characterLine}\n${childLine}\n${siblingLine}\n`, "utf8");
  parseLog(fixturePath).then((parsed) => {
    assert.strictEqual(parsed.playerID, 1);
    assert.strictEqual(parsed.aiID, 2);
    assert.strictEqual(parsed.year, 976);
    assert.strictEqual(parsed.characters.get(2).fullName, "东京名伎李师师");
    assert.strictEqual(parsed.characters.get(2).children[0].gender, "female", "日志解析器必须为子女资料解析代词性别");
    assert.strictEqual(parsed.characters.get(2).siblings[0].gender, "male", "日志解析器必须为兄弟姐妹资料解析代词性别");
    console.log("VOTC v7.8 main modularization: PASS (composition root, dependency direction, history parity and CK3 parser fixture)");
  }).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  }).finally(() => fs.rmSync(tempDir, { recursive: true, force: true }));
} catch (error) {
  fs.rmSync(tempDir, { recursive: true, force: true });
  throw error;
}
