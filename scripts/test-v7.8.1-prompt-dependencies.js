"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const root = path.resolve(__dirname, "..");
const mainDir = path.join(root, "resources", "app", "out", "main");
const Handlebars = require(path.join(root, "resources", "app", "node_modules", "handlebars"));
const { createTemplateEngine } = require(path.join(mainDir, "prompts", "template-engine"));
const { createPromptBuilder } = require(path.join(mainDir, "prompts", "prompt-builder"));
const { createLetterPromptBuilder } = require(path.join(mainDir, "prompts", "letter-prompt-builder"));

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v781-prompt-"));
try {
  const defaultUserdataDir = path.join(tempDir, "default_userdata");
  const defaultHelpersDir = path.join(defaultUserdataDir, "prompts", "helpers");
  const userHelpersDir = path.join(tempDir, "user_helpers");
  fs.mkdirSync(defaultHelpersDir, { recursive: true });
  fs.mkdirSync(userHelpersDir, { recursive: true });
  fs.writeFileSync(path.join(defaultHelpersDir, "fixture.js"), "module.exports = {};", "utf8");
  let helperExecutions = 0;
  const TemplateEngine = createTemplateEngine({
    Handlebars,
    fs,
    path,
    promptsHelpersDir: userHelpersDir,
    defaultPromptsDir: defaultUserdataDir,
    PromptScriptSandbox: { executeHelper() { helperExecutions += 1; } }
  });
  const engine = new TemplateEngine();
  assert.strictEqual(engine.renderTemplateString("你好，{{character.name}}", { character: { name: "李师师" } }), "你好，李师师");
  assert.strictEqual(helperExecutions, 1, "TemplateEngine 必须从注入的默认目录与沙箱加载 helper，不得引用未定义的 electron 或 PromptScriptSandbox");

  class PromptTemplateEngine {
    renderTemplateString(template) { return template; }
  }
  class DescriptionLoader {
    executeDescription() { return "稳定人物描述\n[date(1000.1.1)]"; }
  }
  const PromptBuilder = createPromptBuilder({
    TemplateEngine: PromptTemplateEngine,
    PromptScriptLoader: DescriptionLoader,
    promptConfigManager: { resolvePath: (value) => value },
    settingsRepository: {},
    path,
    TokenCounter: { estimateTokens: (value) => String(value || "").length },
    createPromptFingerprint: (value) => String(value || ""),
    defaultChatInstruction: "回复"
  });
  const descriptionMessages = [];
  const descriptionBlocks = PromptBuilder.applyBlockWithTokenCount(
    { id: "description", type: "description", label: "人物描述", scriptPath: "fixture.js" },
    descriptionMessages,
    [],
    { character: { id: 2 }, gameData: {}, summary: "" },
    {},
    {}
  );
  assert.strictEqual(descriptionMessages.length, 2);
  assert.strictEqual(descriptionMessages[0].content, "稳定人物描述");
  assert.strictEqual(descriptionMessages[1].content, "[date(1000.1.1)]");
  assert.strictEqual(descriptionBlocks.length, 2, "完整 description block 构建必须能调用 PromptBuilder.splitDescriptionForCache");

  let verboseLogCalls = 0;
  const LetterPromptBuilder = createLetterPromptBuilder({
    TemplateEngine: PromptTemplateEngine,
    PromptScriptLoader: class {},
    settingsRepository: { getLetterPromptSettings: () => ({ blocks: [] }) },
    memoryEngine: {
      loadOwnerFolderMemories: () => [],
      getMentionableProfilesFromFolderMemories: () => new Map(),
      findMentionedCharactersInHistory: () => [],
      retrieveForResponder: () => ({})
    },
    memorySystem: {},
    PromptBuilder,
    TokenCounter: { estimateTokens: () => 0, calculateTotalTokens: () => 0 },
    promptConfigManager: {},
    logVerboseLLM: () => { verboseLogCalls += 1; }
  });
  const letterBuilder = new LetterPromptBuilder();
  const letterMessages = letterBuilder.buildMessages({
    getAi: () => ({ id: 2, shortName: "李师师" }),
    getPlayer: () => ({ id: 1, shortName: "玩家" }),
    getMentionableCharacterProfiles: () => new Map(),
    getMentionExclusionIds: () => [],
    totalDays: 1
  }, { id: "letter-1", content: "问候" });
  assert.deepStrictEqual(letterMessages, []);
  assert.strictEqual(verboseLogCalls, 1, "信件 Prompt 构建必须使用注入的 verbose logger");

  console.log("VOTC v7.8.1 prompt dependencies: PASS (template helpers, description cache split and letter logger)");
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
