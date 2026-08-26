"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const root = path.resolve(__dirname, "..");
const mainDir = path.join(root, "resources", "app", "out", "main");
const defaultPromptsDir = path.join(root, "resources", "app", "default_userdata", "prompts");
const Handlebars = require(path.join(root, "resources", "app", "node_modules", "handlebars"));
const { createPaths } = require(path.join(mainDir, "config", "paths"));
const { createTemplateEngine } = require(path.join(mainDir, "prompts", "template-engine"));
const { PromptScriptSandbox } = require(path.join(mainDir, "prompts", "prompt-script-sandbox"));
const { Character } = require(path.join(mainDir, "game-data", "character"));

const configuredPaths = createPaths({
  getPath: () => path.join(os.tmpdir(), "votc-v782-userdata"),
  getAppPath: () => path.join(root, "resources", "app")
});
assert.strictEqual(configuredPaths.DEFAULT_PROMPTS_DIR, defaultPromptsDir, "config/paths.js 必须把 DEFAULT_PROMPTS_DIR 定义为 default_userdata/prompts");
assert.strictEqual(path.join(configuredPaths.DEFAULT_PROMPTS_DIR, "helpers"), path.join(defaultPromptsDir, "helpers"));
assert(fs.existsSync(path.join(defaultPromptsDir, "helpers", "default.js")));
assert(fs.existsSync(path.join(defaultPromptsDir, "helpers", "mainAi.js")));

Handlebars.unregisterHelper("mainAi");
Handlebars.unregisterHelper("mainAiProperty");
const helperLogs = [];
const originalLog = console.log;
try {
  console.log = (...args) => helperLogs.push(args.join(" "));
  const TemplateEngine = createTemplateEngine({
    Handlebars,
    fs,
    path,
    promptsHelpersDir: path.join(os.tmpdir(), "votc-v782-no-user-helpers"),
    defaultPromptsDir,
    PromptScriptSandbox
  });
  const ai = { id: 2, fullName: "东京名伎李师师" };
  const rendered = new TemplateEngine().renderTemplateString('{{mainAiProperty "fullName"}}', {
    character: ai,
    gameData: { aiID: 2, characters: new Map([[2, ai]]) }
  });
  assert.strictEqual(rendered, ai.fullName);
} finally {
  console.log = originalLog;
}
assert(helperLogs.includes("Default helpers loaded"), "default.js 必须从真实 defaultPromptsDir/helpers 执行");
assert.strictEqual(typeof Handlebars.helpers.mainAi, "function", "mainAi helper 必须注册成功");
assert.strictEqual(typeof Handlebars.helpers.mainAiProperty, "function", "mainAiProperty helper 必须注册成功");

const rawCharacter = Array(27).fill("");
rawCharacter[0] = "2";
rawCharacter[1] = "测试人物";
rawCharacter[2] = "测试人物";
rawCharacter[4] = "她";
rawCharacter[5] = "20";
rawCharacter[6] = "10";
rawCharacter[8] = "未知";
const character = new Character(rawCharacter);
for (const name of ["Brave", "brave", "BRAVE"]) {
  character.traits = [{ name: "Brave" }, { name: "Greedy" }];
  character.removeTrait(name);
  assert.deepStrictEqual(character.traits, [{ name: "Greedy" }], `removeTrait 必须不区分大小写删除 ${name}`);
}
character.traits = [{ name: "Greedy" }];
character.removeTrait("Brave");
assert.deepStrictEqual(character.traits, [{ name: "Greedy" }], "删除不存在 Trait 时不得改变数组");

console.log("VOTC v7.8.2 final V7 hotfix: PASS (helper path contract, bundled helpers and Character.removeTrait)");
