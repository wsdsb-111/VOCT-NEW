"use strict";

const assert = require("assert");
const crypto = require("crypto");
const path = require("path");

const root = path.resolve(__dirname, "..");
const mainDir = path.join(root, "resources", "app", "out", "main");
const { TokenCounter } = require(path.join(mainDir, "provider-service.js"));
const { createPromptBuilder } = require(path.join(mainDir, "prompts", "prompt-builder.js"));
const { Conversation } = require(path.join(mainDir, "conversation", "conversation.js"));

const fingerprint = (value) => crypto.createHash("sha256").update(String(value || "")).digest("hex");

class TemplateEngine {
  renderTemplateString(template, context = {}) {
    return String(template)
      .replace(/\{\{!\s*VOTC_SEGMENT:[^}]+\}\}/g, "")
      .replace(/\{\{gameData\.date\}\}/g, context.gameData?.date || "")
      .replace(/\{\{gameData\.scene\}\}/g, context.gameData?.scene || "")
      .replace(/\{\{gameData\.location\}\}/g, context.gameData?.location || "")
      .replace(/\{\{fullName\}\}/g, context.character?.fullName || "")
      .replace(/\{\{gold\}\}/g, String(context.character?.gold ?? ""))
      .replace(/\{\{summary\}\}/g, context.summary || "");
  }
}

class PromptScriptLoader {
  executeDescription(_scriptPath, gameData, characterId) {
    const character = gameData.characters.get(characterId);
    return `[${character.fullName} live: gold=${character.gold}; opinion=${character.opinionOfPlayer}; scene=${gameData.scene}; location=${gameData.location}]`;
  }
}

const mainTemplate = `{{! VOTC_SEGMENT:stable_global }}GLOBAL RULES
{{! VOTC_SEGMENT:stable_history_rp }}HISTORICAL RULES
{{! VOTC_SEGMENT:world_context }}DATE={{gameData.date}}
{{! VOTC_SEGMENT:character_base }}CHAR={{fullName}} GOLD={{gold}}
{{! VOTC_SEGMENT:character_state }}SCENE={{gameData.scene}} LOCATION={{gameData.location}}`;
const promptSettings = {
  mainTemplate,
  blocks: [
    { id: "main-system", type: "main", label: "Main", enabled: true, role: "system" },
    { id: "profile", type: "description", label: "Profile", enabled: true, role: "system", scriptPath: "fixture.js" },
    { id: "rolling", type: "rolling_summary", label: "Rolling", enabled: true, role: "system" },
    { id: "history", type: "history", label: "History", enabled: true },
    { id: "instruction", type: "instruction", label: "Instruction", enabled: true, role: "user", template: "FINAL RESPONSE INSTRUCTION" }
  ],
  suffix: { enabled: false, template: "" }
};
const settingsRepository = {
  getPromptSettings: () => promptSettings,
  getChatPromptV89Settings: () => ({
    chatPromptV89Layout: true,
    chatPromptV89RuntimeProfileSplit: true,
    chatPromptV810ProviderAdapter: true,
    chatPromptV89OutboundDiagnostics: true
  }),
  getActiveProviderConfig: () => ({ providerType: "zhipu", defaultModel: "glm-5.3-flash" })
};
const PromptBuilder = createPromptBuilder({
  TemplateEngine,
  PromptScriptLoader,
  promptConfigManager: { resolvePath: (value) => value, getDefaultMainTemplateContent: () => mainTemplate },
  settingsRepository,
  path,
  TokenCounter,
  createPromptFingerprint: fingerprint,
  defaultChatInstruction: "FINAL RESPONSE INSTRUCTION"
});
Conversation.configure({ createPromptFingerprint: fingerprint });

const responder = {
  id: 1,
  shortName: "赵甲",
  firstName: "甲",
  fullName: "赵甲",
  gender: "male",
  age: 42,
  house: "赵氏",
  culture: "汉",
  faith: "儒",
  sexuality: "异性恋",
  personality: "谨慎",
  boldness: 10,
  compassion: 20,
  energy: 30,
  greed: 40,
  honor: 50,
  rationality: 60,
  sociability: 70,
  vengefulness: 80,
  zeal: 90,
  gold: 100,
  opinionOfPlayer: 10,
  primaryTitle: "无",
  titleRankConcept: "concept_none",
  heldCourtAndCouncilPositions: "无",
  traits: [
    { name: "勇敢", category: "性格特质" },
    { name: "天才", category: "先天特质" },
    { name: "受伤", category: "健康特质" }
  ],
  children: [{ id: 2, name: "赵乙", fullName: "赵乙", gender: "female", sheHe: "她", deathDate: "1170.1.1", primaryTitle: "郡主" }],
  relationsToPlayer: ["朋友"],
  relationsToCharacters: []
};
const child = { id: 2, shortName: "赵乙", firstName: "乙", fullName: "赵乙", gender: "female", sheHe: "她", parents: [{ id: 1, name: "赵甲" }] };
const characters = new Map([[1, responder], [2, child]]);
const gameData = {
  date: "1175.1.1",
  year: 1175,
  dynasty: "宋",
  currentEraName: "淳熙",
  totalDays: 1,
  scene: "throne_room",
  location: "临安",
  characters,
  mentionedCharactersInContext: new Set(),
  gameDataRevision: 1,
  getActiveParticipantRelationshipInfo: () => `opinion=${responder.opinionOfPlayer}; relations=${responder.relationsToPlayer.join(",")}`,
  findMentionedCharacterIdsInHistory: () => [2],
  getMentionedCharactersInfo: () => "MENTIONED LIVE CHARACTER",
  getMentionableCharacterProfiles: () => characters
};
const memoryContext = {
  cacheV2FrozenSnapshots: { conversation: null, responders: new Map() },
  activeParticipantIds: [1, 2],
  stableText: "LONG TERM MEMORY A",
  directStableText: "DIRECT MEMORY A",
  mentionedSnapshotText: "MENTIONED SNAPSHOT A",
  officialRecollectionText: "OFFICIAL RECOLLECTION A",
  temporalExtraText: "TEMPORAL EXTRA A",
  topicPatchText: "SESSION TOPIC MEMORY A",
  presenceText: "PRESENCE 1,2",
  worldStableText: "WORLD STABLE A",
  worldTopicText: "WORLD TOPIC A",
  worldSupplementalText: "WORLD SUPPLEMENTAL A",
  worldCurrentText: "WORLD CURRENT A",
  turnRecallText: "TURN RECALL A",
  thirdPartyEvidenceText: "THIRD PARTY A",
  worldTurnRecallText: "WORLD TURN A"
};

const baseHistory = [
  { role: "user", content: "旧问题" },
  { role: "assistant", content: "旧回答" },
  { role: "user", content: "当前问题 A" }
];
const build = (history = baseHistory, summary = "ROLLING A", context = memoryContext, character = responder) => {
  const result = PromptBuilder.buildMessagesWithTokenCount(history, character, gameData, summary, context, { providerType: "zhipu", defaultModel: "glm-5.3-flash" });
  return { result, metadata: Conversation.buildPromptBlockMetadata(result) };
};

const before = build();
assert.strictEqual(before.result.promptProfile.id, "glm_cache_v2");
assert.strictEqual(before.result.promptProfile.layoutId, "glm_cache_v2");
assert.strictEqual(before.result.promptProfile.historyWindow, null);
assert(before.result.globalStaticTokens > 0);
assert(before.result.conversationFrozenTokens > 0);
assert(before.result.responderFrozenTokens > 0);
assert(before.result.stableKinshipTokens > 0);
assert.strictEqual(before.result.actualStablePrefixTokens, before.metadata.stablePrefixTokens);
assert(before.result.dynamicTailTokens > 0);
const prefixBlocks = before.metadata.blocks.slice(0, before.metadata.stablePrefixEndPosition);
assert(prefixBlocks.every((block) => ["GLOBAL_STATIC", "CONVERSATION_FROZEN", "RESPONDER_FROZEN"].includes(block.lifecycle)));
const dynamicIds = new Set(["live-character-state", "live-relationships", "current-presence-roster", "memory-session-topic-anchor", "worldline-stable", "worldline-current", "worldline-topic", "worldline-supplemental", "worldline-turn-recall", "history", "history-current-user"]);
for (const block of before.metadata.blocks.filter((entry) => dynamicIds.has(entry.id))) {
  assert(block.position >= before.metadata.stablePrefixEndPosition, `${block.id} must follow GLM cache boundary`);
  assert.strictEqual(block.lifecycle, "DYNAMIC", `${block.id} must be explicitly dynamic`);
}
for (const id of ["memory-official-recollection", "memory-stable", "memory-direct-frozen", "memory-mentioned-snapshot"]) {
  const block = before.metadata.blocks.find((entry) => entry.id === id);
  assert(block && block.position < before.metadata.stablePrefixEndPosition, `${id} belongs in the responder-frozen prefix in Memory Engine 3.0`);
}
assert(before.metadata.blocks.find((entry) => entry.id === "memory-temporal-extra").position > before.metadata.blocks.find((entry) => entry.id === "history-current-user").position);
const kinshipText = before.result.blocks.find((entry) => entry.block.id === "responder-stable-kinship").content;
assert(kinshipText.includes("Runtime ID：2"));
assert(!kinshipText.includes("1170.1.1"));
assert(!kinshipText.includes("郡主"));

responder.gold = 999;
responder.opinionOfPlayer = -80;
responder.health = "poor";
responder.stress = { level: 3, value: 250 };
responder.traits = [
  { name: "勇敢", category: "性格特质" },
  { name: "天才", category: "先天特质" },
  { name: "重伤", category: "健康特质" },
  { name: "暴君", category: "名声特质" },
  { name: "酒鬼", category: "压力特质" }
];
responder.relationsToPlayer = ["宿敌"];
gameData.scene = "market";
gameData.location = "临安街市";
memoryContext.activeParticipantIds = [1];
memoryContext.presenceText = "PRESENCE 1";
memoryContext.topicPatchText = "SESSION TOPIC MEMORY B";
memoryContext.temporalExtraText = "TEMPORAL EXTRA B";
memoryContext.worldStableText = "WORLD STABLE B";
memoryContext.worldTopicText = "WORLD TOPIC B";
memoryContext.worldSupplementalText = "WORLD SUPPLEMENTAL B";
memoryContext.worldCurrentText = "WORLD CURRENT B";
memoryContext.turnRecallText = "TURN RECALL B";
memoryContext.thirdPartyEvidenceText = "THIRD PARTY B";
memoryContext.worldTurnRecallText = "WORLD TURN B";
const after = build([
  { role: "user", content: "新增历史 1" },
  { role: "assistant", content: "新增历史 2" },
  { role: "user", content: "当前问题 B" }
], "ROLLING B");
assert.strictEqual(after.metadata.prefixFingerprint, before.metadata.prefixFingerprint, "all runtime, memory, worldline, history and current-turn mutations must preserve GLM Cache v2 prefix");
const afterTail = after.result.blocks.slice(after.metadata.stablePrefixEndPosition).map((entry) => entry.content).join("\n");
for (const expected of ["999", "-80", "market", "临安街市", "WORLD CURRENT B", "ROLLING B", "当前问题 B", "TEMPORAL EXTRA B", "重伤", "暴君", "酒鬼"]) {
  assert(afterTail.includes(expected), `dynamic tail must refresh ${expected}`);
}

responder.fullName = "宋王，赵甲";
responder.primaryTitle = "宋王";
child.fullName = "郡主，赵乙";
const titleChanged = build();
assert.strictEqual(titleChanged.metadata.prefixFingerprint, before.metadata.prefixFingerprint, "V8.11.1 styled full names of responder and kin must not change frozen prefix");
assert(titleChanged.result.blocks.find(entry => entry.block.id === "live-character-state").content.includes("宋王，赵甲"));
responder.shortName = "赵甲新名";
const identityChanged = build();
assert.notStrictEqual(identityChanged.metadata.prefixFingerprint, before.metadata.prefixFingerprint, "stable identity change may rebuild frozen prefix");

const secondResponder = { ...child, age: 18, house: "赵氏", culture: "汉", faith: "儒", sexuality: "异性恋", traits: [] };
const switched = build(baseHistory, "ROLLING C", memoryContext, secondResponder);
assert.notStrictEqual(switched.metadata.prefixFingerprint, identityChanged.metadata.prefixFingerprint, "switching responder must change responder-frozen prefix");

gameData.date = "1176.1.1";
gameData.year = 1176;
const sameConversation = build();
assert.strictEqual(sameConversation.result.blocks.find((entry) => entry.block.id === "conversation-frozen").content.includes("1175.1.1"), true, "same conversation must retain frozen date snapshot");
const nextConversationContext = { ...memoryContext, cacheV2FrozenSnapshots: { conversation: null, responders: new Map() } };
const nextConversation = build(baseHistory, "ROLLING D", nextConversationContext);
assert.notStrictEqual(nextConversation.metadata.prefixFingerprint, sameConversation.metadata.prefixFingerprint, "new conversation may refresh date/era snapshot");
memoryContext.directStableText = "DIRECT MEMORY B";
assert.notStrictEqual(build().metadata.prefixFingerprint, before.metadata.prefixFingerprint, "a changed frozen summary must change the prefix in a new conversation");

console.log("VOTC v8.10.2 GLM Cache v2: PASS (lifecycle DTOs, dynamic-tail routing, append-only history, prefix invariance)");
