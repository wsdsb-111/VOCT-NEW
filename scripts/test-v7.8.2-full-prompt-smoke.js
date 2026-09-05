"use strict";

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const root = path.resolve(__dirname, "..");
const mainDir = path.join(root, "resources", "app", "out", "main");
const defaultPromptsDir = path.join(root, "resources", "app", "default_userdata", "prompts");
const Handlebars = require(path.join(root, "resources", "app", "node_modules", "handlebars"));
const memorySystem = require(path.join(mainDir, "memory-system"));
const { MemoryEngine } = memorySystem;
const { Character } = require(path.join(mainDir, "game-data", "character"));
const { TokenCounter } = require(path.join(mainDir, "provider-service"));
const { PromptScriptSandbox } = require(path.join(mainDir, "prompts", "prompt-script-sandbox"));
const { createTemplateEngine } = require(path.join(mainDir, "prompts", "template-engine"));
const { PromptScriptLoader } = require(path.join(mainDir, "prompts", "prompt-script-loader"));
const { createPromptConfigManager } = require(path.join(mainDir, "prompts", "prompt-config-manager"));
const { createPromptBuilder } = require(path.join(mainDir, "prompts", "prompt-builder"));
const { createLetterPromptBuilder } = require(path.join(mainDir, "prompts", "letter-prompt-builder"));

function makeCharacter(id, shortName, fullName, pronoun) {
  const raw = Array(27).fill("");
  raw[0] = String(id);
  raw[1] = shortName;
  raw[2] = fullName;
  raw[3] = "无";
  raw[4] = pronoun;
  raw[5] = "24";
  raw[6] = "100";
  raw[8] = "未知";
  raw[9] = "沉着";
  const character = new Character(raw);
  character.troops = { totalOwnedTroops: 0, maaRegiments: [] };
  return character;
}

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v782-full-prompt-"));
try {
  const PromptConfigManager = createPromptConfigManager({
    fs,
    path,
    hashPromptAsset: (value) => crypto.createHash("sha256").update(value).digest("hex"),
    promptsDir: defaultPromptsDir,
    promptsSystemDir: path.join(defaultPromptsDir, "system"),
    promptsCharacterDir: path.join(defaultPromptsDir, "character_description"),
    promptsExamplesDir: path.join(defaultPromptsDir, "example_messages"),
    promptsHelpersDir: path.join(defaultPromptsDir, "helpers"),
    defaultPromptsDir,
    defaultMainTemplatePath: "system/default.hbs",
    defaultLetterTemplatePath: "system/letter.hbs",
    manifestName: ".prompt-smoke-manifest.json",
    manifestPath: path.join(tempDir, "prompt-smoke-manifest.json"),
    manifestVersion: 1,
    legacyChatInstruction: "",
    defaultChatInstruction: "请以当前人物身份自然回应。",
    legacyBundledPromptHashes: {}
  });
  const promptConfigManager = new PromptConfigManager();
  const chatSettings = {
    mainTemplate: promptConfigManager.getDefaultMainTemplateContent(),
    defaultMainTemplatePath: "system/default.hbs",
    blocks: promptConfigManager.getDefaultBlocks(),
    suffix: { enabled: false, template: "" }
  };
  const letterSettings = {
    mainTemplate: promptConfigManager.getDefaultLetterMainTemplateContent(),
    defaultMainTemplatePath: "system/letter.hbs",
    blocks: promptConfigManager.getDefaultLetterBlocks(),
    suffix: { enabled: false, template: "" }
  };
  const settingsRepository = {
    getPromptSettings: () => chatSettings,
    getLetterPromptSettings: () => letterSettings,
    getSummaryPromptSettings: () => ({ rollingPrompt: "", finalPrompt: "", letterSummaryPrompt: "", finalSummaryMaxTokens: 4096 })
  };
  const TemplateEngine = createTemplateEngine({
    Handlebars,
    fs,
    path,
    promptsHelpersDir: path.join(tempDir, "user-helpers"),
    defaultPromptsDir,
    PromptScriptSandbox
  });
  const PromptBuilder = createPromptBuilder({
    TemplateEngine,
    PromptScriptLoader,
    promptConfigManager,
    settingsRepository,
    path,
    TokenCounter,
    createPromptFingerprint: (value) => crypto.createHash("sha256").update(String(value || "")).digest("hex"),
    defaultChatInstruction: "请以当前人物身份自然回应。"
  });

  const player = makeCharacter(1, "玩家", "大周皇帝", "他");
  const ai = makeCharacter(2, "李师师", "东京名伎李师师", "她");
  const characters = new Map([[1, player], [2, ai]]);
  const gameData = {
    playerID: 1,
    playerName: player.shortName,
    aiID: 2,
    aiName: ai.shortName,
    date: "1010年3月2日",
    year: 1010,
    dynasty: "北宋",
    scene: "garden",
    location: "开封",
    locationController: player.fullName,
    totalDays: 100,
    currentEmperor: player.shortName,
    currentEmperorTitle: player.fullName,
    currentEraName: "建元",
    historicalReferenceInfo: { period: "北宋前期", context: "架空局势", notableEvents: [], notableFigures: [] },
    characters,
    mentionedCharactersInContext: new Set(),
    getPlayer: () => player,
    getAi: () => ai,
    getActiveParticipantRelationshipInfo: () => "",
    findMentionedCharacterIdsInHistory: () => [],
    getMentionedCharactersInfo: () => "",
    getMentionableCharacterProfiles: () => new Map([[1, player], [2, ai]]),
    getMentionExclusionIds: () => [1, 2]
  };

  Handlebars.unregisterHelper("mainAi");
  Handlebars.unregisterHelper("mainAiProperty");
  const promptBuild = PromptBuilder.buildMessagesWithTokenCount(
    [{ id: 0, role: "user", name: player.fullName, content: "今日园中风景如何？" }],
    ai,
    gameData,
    "",
    { engineVersion: "2.5", activeParticipantIds: [1, 2], presenceText: "当前在场：玩家、李师师", topicPatchText: "会话话题记忆锚点（本场冻结）：花园旧约", turnRecallText: "=== Turn Recall：当前回应角色真实可知的过去事实 ===\n- 花园之约" }
  );
  assert(promptBuild.messages.length > 5, "真实 Chat Prompt 必须生成完整消息序列");
  assert.strictEqual(promptBuild.blocks[0].block.id, "cache-anchor", "Stable Cache Anchor 必须保持首位");
  const blockIds = promptBuild.blocks.map((entry) => entry.block.id);
  assert(blockIds.indexOf("main-system-stable_global") > 0);
  assert(blockIds.indexOf("main-system-stable_history_rp") > blockIds.indexOf("main-system-stable_global"));
  assert(blockIds.includes("character-description-stable"), "真实 Description Script 必须生成稳定人物资料块");
  assert(blockIds.includes("character-description-dynamic"), "splitDescriptionForCache 必须分离动态日期场景块");
  const currentUserIndex = promptBuild.blocks.findIndex((entry) => entry.block.type === "current_user");
  assert(blockIds.indexOf("memory-session-topic-anchor") < currentUserIndex, "Session Topic Anchor 必须位于冻结前缀");
  assert(blockIds.indexOf("memory-turn-recall") > currentUserIndex, "Turn Recall 必须位于当前用户消息之后");
  const secondPromptBuild = PromptBuilder.buildMessagesWithTokenCount(
    [{ id: 1, role: "user", name: player.fullName, content: "你还记得开封那封信吗？" }],
    ai,
    gameData,
    "",
    { engineVersion: "2.5", activeParticipantIds: [1, 2], presenceText: "当前在场：玩家、李师师", topicPatchText: "会话话题记忆锚点（本场冻结）：花园旧约", turnRecallText: "=== Turn Recall：当前回应角色真实可知的过去事实 ===\n- 开封旧信" }
  );
  const frozenPrefix = (build) => {
    const boundary = build.blocks.findIndex((entry) => entry.block.type === "current_user");
    return build.blocks.slice(0, boundary).map((entry) => ({ id: entry.block.id, fingerprint: crypto.createHash("sha256").update(String(entry.content || "")).digest("hex") }));
  };
  assert.deepStrictEqual(frozenPrefix(secondPromptBuild), frozenPrefix(promptBuild), "Turn Recall changes must not alter any block before Current User Message");
  const chatText = promptBuild.messages.map((message) => message.content).join("\n");
  assert(chatText.includes("Voices of the Court 宫廷对话系统"), "default.hbs 必须实际渲染");
  assert(chatText.includes("1010年3月2日"));
  assert(chatText.includes("李师师's character info"), "真实 pListMccTest2.js 必须实际执行");
  assert.strictEqual(typeof Handlebars.helpers.mainAi, "function");
  assert.strictEqual(typeof Handlebars.helpers.mainAiProperty, "function");
  assert.strictEqual(new TemplateEngine().renderTemplateString('{{mainAiProperty "fullName"}}', { character: ai, gameData }), ai.fullName);

  const memoryEngine = new MemoryEngine({
    baseDir: path.join(tempDir, "memory"),
    summaryFoldersDir: path.join(tempDir, "summaries"),
    recoveryDir: path.join(tempDir, "recovery"),
    trace: { record() {} }
  });
  const promise = "约定下月初一一同入宫见皇后，尚未履行。";
  const summaryFolder = path.join(tempDir, "summaries", "2_李师师");
  fs.mkdirSync(summaryFolder, { recursive: true });
  fs.writeFileSync(path.join(summaryFolder, "与玩家的对话.json"), JSON.stringify([3, 2, 1].map(day => ({
    playerId: 2, characterId: 1, totalDays: day, date: `1010年${day}月1日`, finalizationId: `recall-${day}`,
    content: day === 1 ? `【本场经过】\n${"游览园中景色。".repeat(1000)}\n\n【需要长期记住的事项】\n- ${promise}` : `第${day}次会面。`
  }))));
  const recalled = memoryEngine.retrieveForResponder({ characterId: 2, directCounterpartIds: [1], tokenBudget: 800, estimateTokens: text => TokenCounter.estimateTokens(text) });
  const recallBuild = PromptBuilder.buildMessagesWithTokenCount(
    [{ id: 0, role: "user", content: "今天有什么安排？" }], ai, gameData, "",
    { ...recalled, activeParticipantIds: [1, 2] }
  );
  assert.equal(recalled.direct.length, 3);
  assert(recallBuild.messages.some(message => message.role === "system" && message.content.includes(promise)), "stored third summary's tail promise must reach actual Chat messages even without a recall question");
  assert(recallBuild.blocks.some(entry => entry.block.id === "memory-direct-frozen" && entry.content.includes(promise)), "promise belongs to the frozen direct lane, not only optional Turn Recall");
  let verboseLogCalls = 0;
  const LetterPromptBuilder = createLetterPromptBuilder({
    TemplateEngine,
    PromptScriptLoader,
    settingsRepository,
    memoryEngine,
    memorySystem,
    PromptBuilder,
    TokenCounter,
    promptConfigManager,
    logVerboseLLM: () => { verboseLogCalls += 1; }
  });
  const letterMessages = new LetterPromptBuilder().buildMessages(gameData, {
    id: "letter-smoke",
    content: "请于明日来园中相见。"
  });
  assert(letterMessages.length >= 3, "真实 Letter Prompt Blocks 必须生成消息");
  const letterText = letterMessages.map((message) => message.content).join("\n");
  assert(letterText.includes("仅以"));
  assert(letterText.includes("请于明日来园中相见"));
  assert(letterText.includes("Current location: 开封"), "真实 pListLetter.js 必须实际执行");
  assert.strictEqual(verboseLogCalls, 0, "官方 VOTC 2.0.3 LetterPromptBuilder 不得被 verbose logger 包装改变");

  console.log("VOTC v7.8.2 full prompt smoke: PASS (real templates, helpers, scripts, cache blocks, chat and letter assembly)");
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
