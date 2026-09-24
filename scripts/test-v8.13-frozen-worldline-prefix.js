"use strict";

const assert = require("assert");
const crypto = require("crypto");
const path = require("path");

const mainDir = path.resolve(__dirname, "../resources/app/out/main");
const { TokenCounter } = require(path.join(mainDir, "provider-service.js"));
const { createPromptBuilder } = require(path.join(mainDir, "prompts/prompt-builder.js"));
const { Conversation } = require(path.join(mainDir, "conversation/conversation.js"));
const fingerprint = (value) => crypto.createHash("sha256").update(String(value || "")).digest("hex");

const characters = new Map([
  [1, { id: 1, shortName: "甲", fullName: "甲", age: 40, gold: 100, traits: [] }],
  [2, { id: 2, shortName: "乙", fullName: "乙", age: 35, gold: 50, traits: [] }]
]);
const gameData = {
  date: "1162.5.19", year: 1162, scene: "宫廷", location: "临安", playerID: 0,
  characters, mentionedCharactersInContext: new Set(),
  getActiveParticipantRelationshipInfo: () => "当前关系",
  findMentionedCharacterIdsInHistory: () => [],
  getMentionedCharactersInfo: () => ""
};
const settingsRepository = {
  getPromptSettings: () => ({
    mainTemplate: "{{! VOTC_SEGMENT:stable_global }}固定规则\n{{! VOTC_SEGMENT:world_context }}日期={{gameData.date}}\n{{! VOTC_SEGMENT:character_state }}场景={{gameData.scene}}",
    blocks: [
      { id: "main", type: "main", enabled: true, role: "system" },
      { id: "history", type: "history", enabled: true },
      { id: "instruction", type: "instruction", enabled: true, role: "user", template: "请回答" }
    ]
  }),
  getChatPromptV89Settings: () => ({ chatPromptV89Layout: true, chatPromptV89RuntimeProfileSplit: true, chatPromptV810ProviderAdapter: true }),
  getChatPromptV813Layout: () => true
};
const PromptBuilder = createPromptBuilder({
  TemplateEngine: class {
    renderTemplateString(template, context) {
      return String(template).replace(/\{\{!\s*VOTC_SEGMENT:[^}]+\}\}/g, "")
        .replace(/\{\{gameData\.date\}\}/g, context.gameData.date)
        .replace(/\{\{gameData\.scene\}\}/g, context.gameData.scene);
    }
  },
  PromptScriptLoader: class {},
  promptConfigManager: { getDefaultMainTemplateContent: () => "固定规则", resolvePath: (value) => value },
  settingsRepository, path, TokenCounter, createPromptFingerprint: fingerprint, defaultChatInstruction: "请回答"
});
Conversation.configure({ createPromptFingerprint: fingerprint });

const providers = [
  { providerType: "deepseek", defaultModel: "deepseek-v4-flash" },
  { providerType: "zhipu", defaultModel: "glm-5.3-flash" },
  { providerType: "openai-compatible", defaultModel: "other-model" },
  { providerType: "openrouter", defaultModel: "other-model" },
  { providerType: "gemini", defaultModel: "other-model" }
];
for (const provider of providers) {
  const snapshots = { conversation: null, responders: new Map(), prefixByResponder: new Map() };
  const context = {
    cacheV2FrozenSnapshots: snapshots, activeParticipantIds: [1, 2],
    stableText: "旧摘要", directStableText: "直接记忆", officialRecollectionText: "官方追忆",
    worldStableText: "甲的世界线基线", worldTurnRecallText: "甲知道的历史",
    worldCurrentText: "本轮世界状态", presenceText: "甲在场", temporalExtraText: "首轮召回",
    confirmedActionText: null, historicalWorldText: null, mentionedSnapshotText: null
  };
  const build = (responder, history) => PromptBuilder.buildMessagesWithTokenCount(history, responder, gameData, "", context, provider);
  const first = build(characters.get(1), [{ role: "user", content: "初始问题" }]);
  const firstMeta = Conversation.buildPromptBlockMetadata(first);
  assert.strictEqual(first.promptProfile.layoutId, "v813", `${provider.providerType}: layout`);
  assert(first.messages[0].content.startsWith("VOTC_CACHE_ANCHOR_v8.13"));
  const boundary = firstMeta.stablePrefixEndPosition;
  assert(boundary > 1);
  assert(firstMeta.blocks.slice(0, boundary).every((block) => block.stable && block.lifecycle !== "DYNAMIC"));
  assert(firstMeta.blocks.slice(boundary).every((block) => !block.stable && block.lifecycle === "DYNAMIC"));
  for (const id of ["memory-stable", "memory-direct-frozen", "memory-official-recollection", "worldline-stable", "worldline-turn-recall"]) {
    assert(firstMeta.blocks.find((block) => block.id === id)?.position < boundary, `${provider.providerType}: ${id} must be frozen`);
  }
  assert.strictEqual(firstMeta.blocks.reduce((sum, block) => sum + block.messageCount, 0), first.messages.length);
  characters.get(1).gold = 200;
  gameData.scene = "军营";
  context.stableText = "意外改写的摘要";
  context.worldStableText = "意外改写的世界";
  context.worldTurnRecallText = "另一个历史片段";
  context.presenceText = "乙也在场";
  context.temporalExtraText = "本轮时间召回";
  context.confirmedActionText = "CK3 已确认支付 10 金";
  context.historicalWorldText = "五年前的历史事实";
  context.mentionedSnapshotText = "本轮提及丙的摘要";
  const second = build(characters.get(1), [{ role: "user", content: "初始问题" }, { role: "assistant", content: "初始回答" }, { role: "user", content: "新问题" }]);
  const secondMeta = Conversation.buildPromptBlockMetadata(second);
  assert.strictEqual(secondMeta.prefixFingerprint, firstMeta.prefixFingerprint, `${provider.providerType}: frozen prefix changed`);
  assert(second.blocks.some((entry) => entry.block.id === "worldline-turn-recall" && entry.content === "甲知道的历史"));
  assert(second.blocks.slice(secondMeta.stablePrefixEndPosition).some((entry) => entry.content.includes("200")));
  assert(second.blocks.slice(secondMeta.stablePrefixEndPosition).some((entry) => entry.content.includes("军营")));
  assert(second.blocks.slice(secondMeta.stablePrefixEndPosition).some((entry) => entry.block.id === "action-confirmed-context" && entry.content.includes("支付 10 金")));
  assert(second.blocks.slice(secondMeta.stablePrefixEndPosition).some((entry) => entry.block.id === "worldline-historical-recall" && entry.content.includes("五年前")));
  assert(second.blocks.slice(secondMeta.stablePrefixEndPosition).some((entry) => entry.block.id === "memory-mentioned-snapshot" && entry.content.includes("提及丙")));
  context.worldStableText = "乙的世界线基线";
  context.worldTurnRecallText = "乙知道的历史";
  const other = build(characters.get(2), [{ role: "user", content: "乙的问题" }]);
  assert.notStrictEqual(Conversation.buildPromptBlockMetadata(other).prefixFingerprint, firstMeta.prefixFingerprint, "NPC views must be isolated");
  gameData.scene = "宫廷";
  characters.get(1).gold = 100;
}

const actionConversation = Object.create(Conversation.prototype);
actionConversation.presenceInitialized = true;
actionConversation.getPresenceWindows = (id) => id === 1 ? [{ joinedAtMessageId: 2, leftAtMessageId: null }] : [];
actionConversation.messages = [
  { id: 1, type: "action-feedback", feedbacks: [{ lifecycle: { status: "CONFIRMED" }, diagnostic: { confirmedStateChange: { type: "GOLD_TRANSFER", sourceRuntimeId: 1, targetRuntimeId: 2, amount: 5 }, stateAfter: { sourceGold: 95, targetGold: 55 } } }] },
  { id: 3, type: "action-feedback", feedbacks: [{ lifecycle: { status: "UNCONFIRMED" }, diagnostic: { confirmedStateChange: null } }] },
  { id: 4, type: "action-feedback", feedbacks: [{ lifecycle: { status: "CONFIRMED" }, diagnostic: { confirmedStateChange: { type: "GOLD_TRANSFER", sourceRuntimeId: 1, targetRuntimeId: 2, amount: 10 }, stateAfter: { sourceGold: 90, targetGold: 60 } } }] }
];
assert(!actionConversation.getConfirmedActionContextFor(1).includes("支付 5 金"), "do not leak actions before arrival");
assert(actionConversation.getConfirmedActionContextFor(1).includes("支付 10 金"));
assert.strictEqual(actionConversation.getConfirmedActionContextFor(2), null, "waiting NPC cannot observe actions");

const calls = [];
Conversation.configure({
  settingsRepository,
  worldlineService: {
    isSubjectivePromptIntegrationEnabled: () => true,
    prepareCanon: async () => {},
    getSubjectivePromptContextAsync: async (args) => {
      calls.push(args);
      return { worldStableText: `固定世界 ${args.responderId}`, worldTurnRecallText: `个人事实 ${args.responderId}`, worldTurnRecallTokens: 20 };
    }
  }
});
const conversation = Object.create(Conversation.prototype);
conversation.id = "v813-conversation";
conversation.gameData = gameData;
conversation.selectedCharacterIds = new Set([1, 2]);
conversation.presentCharacterIds = new Set([1]);
conversation.frozenWorldlineByResponder = new Map();
(async () => {
  await conversation.prefetchFrozenWorldline();
  assert.deepStrictEqual(calls.map((call) => call.responderId), [1, 2], "waiting selected NPC must be prefetched before entry");
  assert(calls.every((call) => call.directObservationFacts.length === 0), "waiting NPC must not witness opening scene");
  assert.strictEqual(conversation.frozenWorldlineByResponder.get(2).worldTurnRecallText, "个人事实 2");
  console.log("V8.13 Frozen Worldline Prefix: PASS (all providers, selected waiting NPC, immutable prefix, dynamic tail)");
})().catch((error) => { console.error(error); process.exitCode = 1; });
