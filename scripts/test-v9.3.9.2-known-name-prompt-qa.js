"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { ConversationDisclosureStore } = require("../src/app/main/conversation/character-disclosure-store");
const { buildCharacterDisclosureContext } = require("../src/app/main/conversation/character-disclosure-context");
const { createPromptBuilder } = require("../src/app/main/prompts/prompt-builder");
const { TokenCounter } = require("../src/app/main/provider-service");

const CAMPAIGN = "v9392-known-name-prompt-fixture";
const DATE = "1200.1.1";
const root = fs.mkdtempSync(path.resolve(__dirname, "../.build/v9392-known-name-prompt-"));
const layoutState = { id: "v813" };
const providerConfigs = {
  v813: { providerType: "openai-compatible", defaultModel: "v9392-known-name-v813" },
  glm: { providerType: "zhipu", defaultModel: "glm-5.3-flash" },
  legacy: { providerType: "openai-compatible", defaultModel: "v9392-known-name-legacy" }
};

class TemplateEngine {
  renderTemplateString(template, context = {}) {
    return String(template).replace("{{date}}", context.gameData?.date || "");
  }
}

const mainTemplate = `{{! VOTC_SEGMENT:stable_global }}V9392_KNOWN_NAME_GLOBAL\n{{! VOTC_SEGMENT:stable_history_rp }}V9392_KNOWN_NAME_RULES`;
const promptSettings = {
  mainTemplate,
  blocks: [
    { id: "main", type: "main", enabled: true, role: "system" },
    { id: "history", type: "history", enabled: true },
    { id: "instruction", type: "instruction", enabled: true, role: "user", template: "V9392_KNOWN_NAME_FINAL_INSTRUCTION" }
  ],
  suffix: { enabled: false, template: "" }
};
const settingsRepository = {
  getPromptSettings: () => promptSettings,
  getChatPromptV89Settings: () => ({
    chatPromptV89Layout: layoutState.id !== "legacy",
    chatPromptV89RuntimeProfileSplit: true,
    chatPromptV810ProviderAdapter: true
  }),
  getChatPromptV813Layout: () => layoutState.id === "v813",
  getActiveProviderConfig: () => providerConfigs[layoutState.id],
  getGlobalStreamSetting: () => false
};
const PromptBuilder = createPromptBuilder({
  TemplateEngine,
  PromptScriptLoader: class {},
  promptConfigManager: { getDefaultMainTemplateContent: () => mainTemplate, resolvePath: value => value },
  settingsRepository,
  path,
  TokenCounter,
  createPromptFingerprint: value => String(value),
  defaultChatInstruction: "V9392_KNOWN_NAME_FINAL_INSTRUCTION"
});

const characters = new Map([
  [1, { id: 1, shortName: "玩家", fullName: "玩家本人", traits: [], parents: [], children: [], spouses: [], knownSecrets: [] }],
  [2, { id: 2, shortName: "回应者乙", fullName: "回应者乙", traits: [], parents: [], children: [], siblings: [], spouses: [], knownSecrets: [] }],
  [3, { id: 3, shortName: "公开对象丙", fullName: "公开姓名丙", traits: [], parents: [], children: [], siblings: [], spouses: [], knownSecrets: [] }],
  [4, { id: 4, shortName: "私语对象丁", fullName: "私语姓名丁", traits: [], parents: [], children: [], siblings: [], spouses: [], knownSecrets: [] }],
  [5, { id: 5, shortName: "收信人戊", fullName: "收信人戊", traits: [], parents: [], children: [], siblings: [], spouses: [], knownSecrets: [] }],
  [6, { id: 6, shortName: "迟到对象己", fullName: "迟到姓名己", traits: [], parents: [], children: [], siblings: [], spouses: [], knownSecrets: [] }],
  [7, { id: 7, shortName: "未披露对象庚", fullName: "未披露姓名庚", traits: [], parents: [], children: [], siblings: [], spouses: [], knownSecrets: [] }]
]);
const gameData = {
  date: DATE,
  totalDays: 100,
  year: 1200,
  campaignToken: CAMPAIGN,
  playerID: 1,
  playerName: "玩家",
  scene: "V9392_SCENE",
  location: "V9392_LOCATION",
  characters,
  mentionedCharactersInContext: new Set(),
  getActiveParticipantRelationshipInfo: () => "",
  getMentionExclusionIds: () => new Set(),
  findMentionedCharacterIdsInHistory: () => new Set(),
  getMentionedCharactersInfo: () => "",
  getMentionableCharacterProfiles() { return this.characters; }
};
const conversation = {
  id: "v9392-known-name-scene",
  conversationEpoch: 1,
  isActive: true,
  selectedCharacterIds: new Set([2, 3, 4, 5, 6, 7]),
  presentCharacterIds: new Set([2, 3, 4, 5, 6, 7]),
  temporarilyAbsentCharacterIds: new Map(),
  departedCharacterIds: new Set(),
  inactiveParticipantIds: new Map(),
  gameData,
  messages: [
    { id: 1, role: "assistant", speakerCharacterId: 3, name: "公开对象丙", content: "我叫公开姓名丙。" },
    { id: 2, role: "assistant", speakerCharacterId: 4, name: "私语对象丁", content: "只对收信人戊低声说：“我叫私语姓名丁。”" }
  ]
};

function sourceContext() {
  const participants = [...characters.keys()].map(id => ({ id, name: characters.get(id).shortName }));
  const participantPresence = [...characters.keys()].map(characterId => ({
    characterId,
    joinedAtMessageId: characterId === 6 ? 100 : 0,
    leftAtMessageId: null
  }));
  return {
    conversationId: conversation.id,
    campaignToken: gameData.campaignToken,
    date: gameData.date,
    participants,
    messages: conversation.messages,
    participantPresence
  };
}

function appendTwelveUnrelatedTurns() {
  let messageId = 3;
  for (let turn = 1; turn <= 12; turn++) {
    conversation.messages.push({ id: messageId++, role: "assistant", speakerCharacterId: 2,
      name: "回应者乙", content: `第${turn}轮讨论边境事务。` });
    conversation.messages.push({ id: messageId++, role: "user", speakerCharacterId: 1,
      name: "玩家", content: `第${turn}轮继续商议。` });
  }
}

function makeMemoryContext(service, responderId = 2) {
  const targetIds = [...conversation.selectedCharacterIds, gameData.playerID];
  return {
    activeParticipantIds: [gameData.playerID, ...conversation.selectedCharacterIds],
    ...buildCharacterDisclosureContext({ service, gameData, responderId, targetIds })
  };
}

function buildPrompt(service, memoryContext, layout) {
  layoutState.id = layout;
  const history = conversation.messages.map(message => ({ role: message.role, name: message.name, content: message.content }));
  const responder = characters.get(2);
  return PromptBuilder.buildMessagesWithTokenCount(history, responder, gameData, "", memoryContext, providerConfigs[layout]);
}

function knownNameBlock(prompt) {
  const gameFacts = prompt.blocks.find(entry => entry.block?.id === "responder-game-facts")?.content || "";
  const heading = "=== 本角色已获知的姓名 ===";
  if (!gameFacts.includes(heading)) return "";
  return gameFacts.slice(gameFacts.indexOf(heading));
}

function assertPublicNameBoundAndPrivateSourcesExcluded(prompt, layout) {
  const nameBlock = knownNameBlock(prompt);
  assert(nameBlock.includes("=== 本角色已获知的姓名 ==="), `${layout}: the actual final Prompt has a dedicated known-name block`);
  assert(nameBlock.includes("- Target Runtime ID 3: 公开姓名丙"), `${layout}: the public disclosure remains bound to target ID 3 after twelve turns`);
  for (const runtimeId of [4, 5, 6, 7]) {
    assert(!nameBlock.includes(`Target Runtime ID ${runtimeId}:`), `${layout}: the private, late, or undisclosed target ${runtimeId} is not authorized`);
  }
  for (const name of ["私语姓名丁", "迟到姓名己", "未披露姓名庚"]) {
    assert(!nameBlock.includes(name), `${layout}: ${name} is absent from the known-name block`);
  }
  assert(prompt.messages.some(message => message.role === "system" && message.content === prompt.blocks.find(entry =>
    entry.block?.id === "responder-game-facts")?.content), `${layout}: this block is present in the final outbound messages`);
}

try {
  const service = new ConversationDisclosureStore({ dataDir: root, getCurrentConversation: () => conversation });
  appendTwelveUnrelatedTurns();
  service.recordConversation({ conversation, context: sourceContext() });

  const publicProfile = service.getDisclosureProfile({ campaignToken: CAMPAIGN, ownerRuntimeId: 2, targetRuntimeId: 3 });
  assert(publicProfile.facts.some(fact => fact.factType === "NAME" && fact.value === "公开姓名丙" && fact.effectiveKnown),
    "the real disclosure store records the public speaker's current name for an actual listener");
  const privateProfile = service.getDisclosureProfile({ campaignToken: CAMPAIGN, ownerRuntimeId: 2, targetRuntimeId: 4 });
  assert(!privateProfile.facts.some(fact => fact.factType === "NAME" && fact.effectiveKnown),
    "the real store does not grant a whisper addressed only to character 5 to responder 2");
  const whisperRecipientProfile = service.getDisclosureProfile({ campaignToken: CAMPAIGN, ownerRuntimeId: 5, targetRuntimeId: 4 });
  assert(whisperRecipientProfile.facts.some(fact => fact.factType === "NAME" && fact.value === "私语姓名丁" && fact.effectiveKnown),
    "the same whisper is recorded for its named recipient");

  for (const layout of ["v813", "glm", "legacy"]) {
    const prompt = buildPrompt(service, makeMemoryContext(service), layout);
    assertPublicNameBoundAndPrivateSourcesExcluded(prompt, layout);
    if (layout === "glm") assert.equal(prompt.promptProfile.id, "glm_cache_v2", "the GLM fixture uses the adapted GLM prompt layout");
  }

  // The store's current manual-status API is trait-only. This focused context
  // fixture verifies the Prompt boundary still rejects a MANUAL_HIDDEN NAME.
  const manualHiddenContext = makeMemoryContext(service);
  const targetFacts = manualHiddenContext.disclosureProfiles.get(3) || [];
  manualHiddenContext.disclosureProfiles.set(3, targetFacts.map(fact => fact.factType === "NAME"
    ? { ...fact, status: "MANUAL_HIDDEN", effectiveKnown: false } : fact));
  for (const layout of ["v813", "glm", "legacy"]) {
    const prompt = buildPrompt(service, manualHiddenContext, layout);
    assert.equal(knownNameBlock(prompt), "", `${layout}: a manually hidden name cannot enter the Prompt name block`);
  }

  conversation.messages[0].content = "我们继续讨论边境事务。";
  service.recordConversation({ conversation, context: sourceContext() });
  const revokedContext = makeMemoryContext(service);
  for (const layout of ["v813", "glm", "legacy"]) {
    const prompt = buildPrompt(service, revokedContext, layout);
    assert.equal(knownNameBlock(prompt), "", `${layout}: source revision invalidation removes the stale name block`);
  }

  console.log("V9.3.9.2 known-name final Prompt QA: PASS (real Store, 12 turns, public target binding, whisper/late/unknown ACL, V8.13/GLM/legacy layouts, manual-hidden context and source revocation)");
} finally {
  assert(path.dirname(root) === path.resolve(__dirname, "../.build"));
  fs.rmSync(root, { recursive: true, force: true });
}
