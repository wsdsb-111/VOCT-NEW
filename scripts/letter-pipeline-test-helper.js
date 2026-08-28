"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { Character } = require("../resources/app/out/main/game-data/character");
const { createLogParser } = require("../resources/app/out/main/game-data/log-parser");
const { createLetterPromptBuilder } = require("../resources/app/out/main/prompts/letter-prompt-builder");
const { createLetterManager } = require("../resources/app/out/main/letters/letter-manager");

function render(template, context) {
  return String(template || "").replace(/{{\s*([\w.]+)\s*}}/g, (_match, key) => key.split(".").reduce((value, part) => value?.[part], context) ?? "");
}

class TestTemplateEngine {
  renderTemplateString(template, context) {
    return render(template, context);
  }
}

class TestPromptScriptLoader {}

function characterLine(id, shortName, fullName, pronoun) {
  const raw = Array(27).fill("");
  raw[0] = String(id);
  raw[1] = shortName;
  raw[2] = fullName;
  raw[3] = "无";
  raw[4] = pronoun;
  raw[5] = "30";
  raw[6] = "10";
  raw[8] = "未知";
  raw[9] = "沉稳";
  raw[14] = "汉";
  raw[15] = "儒教";
  return ["VOTC:IN", "character", ...raw].join("/;/");
}

function createHarness(options = {}) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "votc-letter-pipeline-"));
  const ck3Dir = path.join(tempDir, "ck3");
  const dataDir = path.join(tempDir, "data");
  const debugLogPath = path.join(ck3Dir, "logs", "debug.log");
  fs.mkdirSync(path.dirname(debugLogPath), { recursive: true });
  fs.mkdirSync(path.join(ck3Dir, "run"), { recursive: true });

  const initLine = ["VOTC:IN", "init", "1", "玩家", "2", "李师师", "976年5月3日", "scene_type_court", "开封", "玩家", "100"].join("/;/");
  const baseLog = [initLine, characterLine(1, "玩家", "大宋亲王", "他"), characterLine(2, "李师师", "东京名伎李师师", "她")].join("\n") + "\n";
  const letterLine = ["VOTC:LETTER", options.letterContent || "近来可好？", options.letterId || "letter_42", "100", "5"].join("/;/") + "\n";
  fs.writeFileSync(debugLogPath, baseLog + (options.includeLetter === false ? "" : letterLine), "utf8");

  const savedSummaries = [];
  class TestGameData {
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
    loadCharactersSummaries() {
      if (options.summaryLoadFailure) throw new Error("summary load unavailable");
    }
    getMentionableCharacterProfiles() { return new Map(this.characters); }
    getMentionExclusionIds() { return new Set([this.playerID, this.aiID]); }
    saveCharacterSummary(characterId, summary) { savedSummaries.push({ characterId, summary }); }
  }

  const parseLog = createLogParser({ GameData: TestGameData, Character });
  let active = false;
  const settingsRepository = {
    getCK3UserFolderPath: () => active ? ck3Dir : null,
    getCK3DebugLogPath: () => active ? debugLogPath : null,
    getLetterPromptSettings: () => ({
      mainTemplate: "Stable official-compatible letter roleplay for {{character.fullName}}.",
      blocks: [
        { id: "letter-main", type: "main", enabled: true, role: "system" },
        { id: "letter-instruction", type: "instruction", enabled: true, role: "user", template: "{{player.fullName}}来信：{{letter.content}}。请以{{character.fullName}}身份回信。" }
      ],
      suffix: { enabled: false, template: "" }
    }),
    getSummaryPromptSettings: () => ({ letterSummaryPrompt: "概括来信和回信。" })
  };
  const memoryRecords = [];
  const memoryEngine = {
    loadOwnerFolderMemories() {
      if (options.memoryFailure) throw new Error("memory retrieval failed");
      return [];
    },
    getMentionableProfilesFromFolderMemories: () => new Map(),
    findMentionedCharactersInHistory: () => [],
    retrieveForResponder: () => ({ engineVersion: "2.5", stableText: "Memory Engine 2.5 stable context", relevantText: "" }),
    recordLetterMemory: (entry) => memoryRecords.push(entry)
  };
  const tokenCounter = {
    estimateTokens: (value) => Math.ceil(String(value || "").length / 4),
    estimateMessageTokens: (message) => Math.ceil(String(message?.content || "").length / 4),
    calculateTotalTokens: (messages) => messages.reduce((sum, message) => sum + Math.ceil(String(message?.content || "").length / 4), 0)
  };
  const LetterPromptBuilder = createLetterPromptBuilder({
    TemplateEngine: TestTemplateEngine,
    PromptScriptLoader: TestPromptScriptLoader,
    settingsRepository,
    memoryEngine,
    memorySystem: { getCharacterMentionAliases: (character) => [character.fullName, character.shortName].filter(Boolean) },
    PromptBuilder: {},
    TokenCounter: tokenCounter,
    promptConfigManager: {
      getDefaultLetterMainTemplateContent: () => "Stable official-compatible letter roleplay.",
      resolvePath: (value) => value
    },
    logVerboseLLM: () => {}
  });
  const letterPromptBuilder = new LetterPromptBuilder();
  const providerCalls = [];
  const llmManager = {
    async sendChatRequest(messages, _unused, _stream, metadata) {
      providerCalls.push({ type: "letter", messages, metadata });
      return { content: "一切安好，盼君珍重。" };
    },
    async sendSummaryRequest(messages, _unused, metadata) {
      providerCalls.push({ type: "letter_summary", messages, metadata });
      return { content: "玩家问候李师师，李师师回信报平安。" };
    }
  };
  const sleepCalls = [];
  const dependencies = {
    settingsRepository,
    fs,
    path,
    TailFile: class {},
    readline: {},
    parseLog,
    letterPromptBuilder,
    llmManager,
    PromptBuilder: {},
    TokenCounter: tokenCounter,
    memoryEngine,
    dataDir,
    letterPayloadRetryDelays: options.retryDelays || [100, 200, 350, 600, 1e3],
    sleep: async (milliseconds) => {
      sleepCalls.push(milliseconds);
      await options.onSleep?.({ milliseconds, sleepCalls, debugLogPath, letterLine });
    }
  };
  const { LetterManager, LetterPipelineState } = createLetterManager(dependencies);
  const manager = new LetterManager();
  active = true;
  return {
    manager,
    LetterPipelineState,
    ck3Dir,
    dataDir,
    debugLogPath,
    letterLine,
    providerCalls,
    savedSummaries,
    memoryRecords,
    sleepCalls,
    cleanup: () => fs.rmSync(tempDir, { recursive: true, force: true })
  };
}

module.exports = { createHarness };
