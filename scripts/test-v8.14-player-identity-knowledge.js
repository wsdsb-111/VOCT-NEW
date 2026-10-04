"use strict";

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const Handlebars = require("../resources/app/node_modules/handlebars").create();
const { createPromptBuilder } = require("../resources/app/out/main/prompts/prompt-builder");
const { createTemplateEngine } = require("../resources/app/out/main/prompts/template-engine");
const { PromptScriptSandbox } = require("../resources/app/out/main/prompts/prompt-script-sandbox");
const { createGameData } = require("../resources/app/out/main/game-data/game-data");
const { TokenCounter } = require("../resources/app/out/main/provider-service");

const root = path.resolve(__dirname, "..");
const defaultPromptsDir = path.join(root, "resources/app/default_userdata/prompts");
const defaultTemplate = fs.readFileSync(path.join(defaultPromptsDir, "system/default.hbs"), "utf8");
const fingerprint = value => crypto.createHash("sha256").update(String(value || "")).digest("hex");
const person = (id, name) => ({ id, firstName: name, shortName: name, fullName: name, gender: "male", sheHe: "他",
  age: 30, gold: 100, prowess: 5, traits: [], parents: [], children: [], siblings: [], relationsToCharacters: [],
  relationsToPlayer: [], opinions: [], opinionBreakdowns: [], titleRankConcept: "concept_none" });
const GameData = createGameData({ fs, path, summariesDir: "", memorySystem: null, memoryEngine: null,
  getHistoricalReferenceByYear: () => null });
function fixture() {
  const player = { ...person(1, "张三"), fullName: "河间公张三", primaryTitle: "河间公", house: "张氏",
    heldCourtAndCouncilPositions: "宰相", isRuler: true, titleRankConcept: "concept_duchy", nickname: "铁面" };
  const npc = person(2, "李四");
  const data = Object.assign(Object.create(GameData.prototype), { playerID: 1, playerName: player.shortName,
    aiID: 2, date: "1164.1.1", year: 1164, totalDays: 425000, scene: "garden", location: "城堡花园",
    locationController: player.fullName, campaignToken: "identity-fixture", mentionedCharactersInContext: new Set(),
    characters: new Map([[1, player], [2, npc]]), findMentionedCharacterIdsInHistory: () => [] });
  return { player, npc, data };
}

const TemplateEngine = createTemplateEngine({ Handlebars, fs, path, defaultPromptsDir,
  promptsHelpersDir: path.join(defaultPromptsDir, "helpers"), PromptScriptSandbox });
class PromptScriptLoader {
  executeDescription(scriptPath, gameData, currentCharacterId) {
    if (scriptPath === "CUSTOM_PLAYER") {
      const player = gameData.characters.get(gameData.playerID);
      return `Custom player dossier: ${player.fullName}; ${player.primaryTitle}; ${player.house}; ${player.heldCourtAndCouncilPositions}`;
    }
    return PromptScriptSandbox.executeDescription(scriptPath, { gameData, currentCharacterId });
  }
}
let layout = "v813";
let script = "pListMccTest2JE_ZH.js";
let customTemplate = false;
let historyEnabled = true;
const settingsRepository = {
  getChatPromptV89Settings: () => ({ chatPromptV89Layout: layout !== "v5", chatPromptV89RuntimeProfileSplit: layout === "v7",
    chatPromptV810ProviderAdapter: true }),
  getChatPromptV813Layout: () => layout === "v813",
  getPromptSettings: () => ({
    mainTemplate: customTemplate ? "CUSTOM_PLAYER={{gameData.playerName}}\n{{#each (otherCharacters gameData.characters id)}}{{fullName}}; {{primaryTitle}}{{/each}}" : defaultTemplate,
    blocks: [ { id: "main", type: "main", enabled: true, role: "system" },
      { id: "description", type: "description", enabled: true, scriptPath: script === "CUSTOM_PLAYER" ? script
        : path.join(defaultPromptsDir, "character_description/standard", script) },
      { id: "history", type: "history", enabled: historyEnabled },
      { id: "instruction", type: "instruction", enabled: true, role: "user", template: "请回答" } ] })
};
const PromptBuilder = createPromptBuilder({ TemplateEngine, PromptScriptLoader, settingsRepository,
  promptConfigManager: { resolvePath: value => value, getDefaultMainTemplateContent: () => defaultTemplate },
  path, TokenCounter, createPromptFingerprint: fingerprint, defaultChatInstruction: "请回答" });
const context = () => ({ activeParticipantIds: [1, 2], stableDescriptionCache: new Map(), stableProfileCache: new Map(),
  cacheV2FrozenSnapshots: { conversation: null, responders: new Map(), prefixByResponder: new Map() } });
const build = (sample, history = [{ role: "user", name: sample.player.fullName, content: "阁下好。" }], memory = context()) =>
  PromptBuilder.buildMessagesWithTokenCount(history, sample.npc, sample.data, "", memory,
    layout === "glm_cache_v2" ? { providerType: "zhipu", defaultModel: "glm-5.3-flash" } : { providerType: "deepseek", defaultModel: "deepseek-v4-flash" });
function guard(result) {
  const entry = result.blocks.find(item => item.block.id === "responder-game-facts");
  assert(entry?.content.includes("玩家身份知情边界"), "the actual final provider input must contain the identity guard");
  assert.strictEqual(entry.block.stable, false, "recognition authorization belongs after the frozen cache boundary");
  assert(result.blocks.indexOf(entry) > result.blocks.findIndex(item => item.block.type === "cache_anchor"));
  assert(result.messages.some(message => message.role === "system" && message.content === entry.content));
  if (["v813", "glm_cache_v2"].includes(layout)) assert.strictEqual(entry.block.lifecycle, "DYNAMIC");
  assert.match(entry.content, /后台标签，不构成本角色已经知道玩家身份的证据/);
  assert.match(entry.content, /当前回合开始交谈、同场、好感数值/);
  assert.match(entry.content, /只授予来源明确给出的那项姓名或身份/);
  assert.match(entry.content, /称号（Nickname）默认可见.*不授予真名、精确头衔或官职/);
  assert.match(entry.content, /不得据此解锁整包玩家资料/);
  return entry.content;
}
let checks = 0;
function check(name, fn) { fn(); checks += 1; console.log(`PASS ${name}`); }

for (const id of ["v5", "v6", "v7", "glm_cache_v2", "v813"]) {
  check(`${id}: shipped EN/ZH and custom player dossiers do not authorize unknown identity`, () => {
    layout = id;
    for (const description of ["pListMccTest2.js", "pListMccTest2JE.js", "pListMccTest2_ZH.js", "pListMccTest2JE_ZH.js", "CUSTOM_PLAYER"]) {
      script = description;
      customTemplate = description === "CUSTOM_PLAYER";
      const sample = fixture();
      const result = build(sample);
      assert.strictEqual(result.promptProfile.layoutId, id);
      const all = result.messages.map(message => message.content).join("\n");
      assert(all.includes(sample.player.fullName) && all.includes(sample.player.primaryTitle), "reproduce the raw runtime dossier that previously leaked identity");
      assert.match(guard(result), /身份识别关系证据：未提供/);
      assert.match(guard(result), /尚未识别的对方/);
      assert.doesNotMatch(guard(result), /从未见过玩家|这是第一次相识|此前不认识玩家/);
    }
  });
}
layout = "v813";
script = "pListMccTest2JE_ZH.js";
customTemplate = false;
check("current encounter recognition and high opinion alone do not grant identity", () => {
  const sample = fixture();
  sample.npc.opinionOfPlayer = 90;
  const memory = { ...context(), playerProfile: { recognition: { level: "DIRECT_OBSERVATION", directConversationCount: 1, sharedSceneCount: 1 } } };
  assert.match(guard(build(sample, undefined, memory)), /身份识别关系证据：未提供/);
});
check("current formal relationships and reverse relationships remain usable", () => {
  for (const type of ["friend", "rival", "lover", "好友", "宿敌", "恋人", "父亲", "叔父", "配偶"]) {
    const sample = fixture();
    sample.npc.relationsToPlayer = [type];
    assert(guard(build(sample)).includes(`身份识别关系证据：${type}`));
    sample.npc.relationsToPlayer = [];
    sample.player.relationsToCharacters = [{ id: 2, relations: [type] }];
    assert(guard(build(sample)).includes(`身份识别关系证据：${type}`));
  }
});
check("negative, opinion-only and unclassified relationship descriptions do not grant recognition", () => {
  for (const type of ["陌生人", "无明确关系", "好感：90", "No relationship", "不是朋友", "not a friend", "friendly toward", "unknown relation"]) {
    const sample = fixture();
    sample.npc.relationsToPlayer = [type];
    assert.match(guard(build(sample)), /身份识别关系证据：未提供/);
    sample.npc.relationsToPlayer = [];
    sample.player.relationsToCharacters = [{ id: 2, relations: [type] }];
    assert.match(guard(build(sample)), /身份识别关系证据：未提供/);
  }
});
check("runtime blood kinship remains legitimate without memory entries", () => {
  const sample = fixture();
  sample.npc.parents = [{ id: 1, name: sample.player.fullName, gender: "male" }];
  sample.player.children = [{ id: 2, name: sample.npc.fullName, gender: "male" }];
  const result = build(sample);
  assert.match(guard(result), /身份识别关系证据：父亲/);
  assert(result.messages.some(message => message.content.includes("父亲：张三")));
  assert(!result.messages.some(message => message.content.includes("父亲：河间公张三")), "kinship must not automatically disclose an exact title");
});
check("authorized prior memory and public identity remain available without blanket stranger claims", () => {
  const sample = fixture();
  const memory = { ...context(), directStableText: "李四知道张三是旧日故交。",
    worldTurnRecallText: "本角色获准的公开事实：河间公张三持有河间公头衔。" };
  const result = build(sample, undefined, memory);
  assert(result.messages.some(message => message.content === memory.directStableText));
  assert(result.messages.some(message => message.content === memory.worldTurnRecallText));
  assert.match(guard(result), /本角色获准的记忆、获准的公开事实/);
  assert.match(guard(result), /缺少记录不等于从未相识/);
});
check("spoken name or title introductions preserve only their explicit scope", () => {
  const sample = fixture();
  const introduction = "在下化名王五，行商至此。";
  const history = [{ role: "user", name: sample.player.fullName, content: introduction }];
  const result = build(sample, history);
  assert(result.messages.some(message => message.role === "user" && message.content.endsWith(introduction)));
  assert.match(guard(result), /当前对话正文中明确说出的自我介绍或他人介绍/);
  assert.match(guard(result), /不得据此解锁整包玩家资料/);
});
check("dynamic recognition changes and new introductions preserve V8.13 frozen prefix", () => {
  const sample = fixture();
  const memory = context();
  const first = build(sample, undefined, memory);
  sample.npc.relationsToPlayer = ["friend"];
  const second = build(sample, [{ role: "user", content: "我叫张三。" }], memory);
  const frozen = result => result.blocks.filter(entry => entry.block.lifecycle && entry.block.lifecycle !== "DYNAMIC").map(entry => entry.content);
  assert.deepStrictEqual(frozen(second), frozen(first));
  assert.match(guard(first), /身份识别关系证据：未提供/);
  assert.match(guard(second), /身份识别关系证据：friend/);
});
check("old cached dossiers and custom layouts retain a fresh knowledge guard", () => {
  layout = "v5";
  const sample = fixture();
  const memory = context();
  memory.stableDescriptionCache.set("2", "Old cached player identity: 河间公张三; 河间公");
  const result = build(sample, undefined, memory);
  assert(!result.messages.some(message => message.content === memory.stableDescriptionCache.get("2")), "pre-Trait-routing cached dossiers must not bypass the scoped view");
  assert([...memory.stableDescriptionCache.keys()].some(key => key.startsWith("v8.14.2:")), "fresh descriptions use the scoped disclosure cache namespace");
  assert.match(guard(result), /身份识别关系证据：未提供/);
  layout = "v813";
  historyEnabled = false;
  guard(build(sample));
  historyEnabled = true;
});
console.log(`V8.14 player identity knowledge: ${checks} PASS (provider input contract; live model behavior requires CK3/Provider verification)`);
