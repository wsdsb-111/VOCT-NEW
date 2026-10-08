"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Handlebars = require("../resources/app/node_modules/handlebars");
const { Character } = require("../resources/app/out/main/game-data/character");
const { createGameData } = require("../resources/app/out/main/game-data/game-data");
const { MemoryEngine } = require("../resources/app/out/main/memory-system");
const { MemoryStore } = require("../resources/app/out/main/memory-system/memory-store");
const { createMemoryRecord } = require("../resources/app/out/main/memory-system/memory-types");
const { KnowledgeService } = require("../resources/app/out/main/memory-system/knowledge-service");
const { memoryFactsForResponder } = require("../resources/app/out/main/worldline/personal-memory-policy-adapter");
const { createPromptBuilder } = require("../resources/app/out/main/prompts/prompt-builder");
const { createTraitProfileView } = require("../resources/app/out/main/prompts/trait-profile-selector");
const { MEMORY_ENGINE_VERSION } = require("../resources/app/out/main/version");

const PLAYER_ID = 1;
const NPC_A_ID = 2;
const OLD_NPC_B_ID = 3;
const NEW_NPC_D_ID = 4;
const FRESH_NPC_E_ID = 5;
const CAMPAIGN_TOKEN = "fixture-current-campaign";
const OLD_SECRET_ID = "old-abc-secret";
const TRANSFERRED_SECRET_ID = "explicit-transfer-secret";
const OLD_SECRET = "OLD_ABC_PRIVATE_SECRET_47";
const TRANSFERRED_SECRET = "D_EXPLICITLY_TOLD_SECRET_82";
const PLAYER_CAPITAL_SENTINEL = "PLAYER_PRIVATE_CAPITAL_SENTINEL_18";
const D_OWN_CAPITAL = "D_SELF_CAPITAL_29";
const A_OWN_CAPITAL = "A_SELF_CAPITAL_30";

function makeCharacter(id, name) {
  const data = Array(28).fill("");
  data[0] = String(id);
  data[1] = name;
  data[2] = name;
  data[4] = "he";
  data[5] = "30";
  data[6] = "0";
  data[7] = "0";
  data[11] = "0";
  data[17] = "0";
  data[18] = name;
  const character = new Character(data);
  character.fullName = name;
  character.shortName = name;
  character.firstName = name;
  character.primaryTitle = "";
  character.age = 30;
  character.heldCourtAndCouncilPositions = "";
  character.titleRankConcept = "concept_none";
  return character;
}

function makeMemory(memoryId, content, knownBy, participants) {
  return createMemoryRecord({
    memoryId,
    type: "secret",
    visibility: "private",
    content,
    participants,
    subjects: participants,
    knownBy,
    importance: 0.99,
    confidence: 1,
    eventDate: "1170年1月1日",
    provenance: { campaignToken: CAMPAIGN_TOKEN, campaignBinding: { status: "bound" } }
  });
}

function makeMemoryStore() {
  const records = new Map([
    [OLD_SECRET_ID, makeMemory(OLD_SECRET_ID, OLD_SECRET, [NPC_A_ID], [PLAYER_ID, NPC_A_ID, OLD_NPC_B_ID])],
    [TRANSFERRED_SECRET_ID, makeMemory(TRANSFERRED_SECRET_ID, TRANSFERRED_SECRET, [NPC_A_ID], [PLAYER_ID, NPC_A_ID])]
  ]);
  const knowledge = new Map([
    [PLAYER_ID, []],
    [NPC_A_ID, [{ memoryId: OLD_SECRET_ID }, { memoryId: TRANSFERRED_SECRET_ID }]],
    [OLD_NPC_B_ID, []],
    [NEW_NPC_D_ID, [{ memoryId: OLD_SECRET_ID }]],
    [FRESH_NPC_E_ID, []]
  ]);
  const store = Object.create(MemoryStore.prototype);
  store.index = { memories: Object.fromEntries([...records.keys()].map((memoryId) => [memoryId, {}])) };
  store.paths = { pairs: path.join(os.tmpdir(), "votc-stranger-memory-fixture-pairs") };
  store.getMemory = (memoryId) => records.get(memoryId) || null;
  store.getCharacterKnowledge = (characterId) => knowledge.get(Number(characterId)) || [];
  store.markKnownBy = (characterId, memoryId, details = {}) => {
    const id = Number(characterId);
    const entries = knowledge.get(id) || [];
    if (!entries.some((entry) => entry.memoryId === memoryId)) entries.push({ characterId: id, memoryId, ...details });
    knowledge.set(id, entries);
  };
  store.updateMemory = (memoryId, updates) => {
    const current = records.get(memoryId);
    const patch = typeof updates === "function" ? updates(current) : updates;
    const next = { ...current, ...patch };
    records.set(memoryId, next);
    return next;
  };
  store.getFolderSummaryRevision = () => 0;
  store.getFolderSummaryCacheMetrics = () => ({});
  store.loadFolderSummariesForCharacter = () => [];
  return store;
}

function makeGameData(summaryRoot) {
  const memorySystem = {
    getCharacterPersonalName: (character, fallback) => character?.shortName || fallback || "",
    getCharacterStorageDirectoryName: (character, fallback) => `${Number(character?.id)}_${character?.shortName || fallback || ""}`
  };
  const GameData = createGameData({
    fs,
    path,
    memorySystem,
    memoryEngine: null,
    summariesDir: summaryRoot,
    getHistoricalReferenceByYear: () => ({ period: "测试年代", context: "", notableEvents: [], notableFigures: [] })
  });
  const gameData = new GameData([PLAYER_ID, "甲", NEW_NPC_D_ID, "同名", "1170年1月1日", "12345678901场景", "临安", "", 100]);
  const player = makeCharacter(PLAYER_ID, "甲");
  const responder = makeCharacter(NEW_NPC_D_ID, "同名");
  player.capitalLocation = PLAYER_CAPITAL_SENTINEL;
  responder.capitalLocation = D_OWN_CAPITAL;
  gameData.characters = new Map([[PLAYER_ID, player], [NEW_NPC_D_ID, responder]]);
  gameData.campaignToken = CAMPAIGN_TOKEN;
  gameData.getActiveParticipantRelationshipInfo = () => "";
  gameData.findMentionedCharacterIdsInHistory = () => [];
  gameData.getMentionedCharactersInfo = () => "";
  gameData.getMentionableCharacterProfiles = () => [player, responder];
  return { gameData, player, responder };
}

function makePromptBuilder(mainTemplate = "Test conversation prompt.") {
  const promptSettings = {
    mainTemplate,
    blocks: [
      { id: "main", type: "main", enabled: true, role: "system" },
      { id: "past-summaries", type: "past_summaries", enabled: true, role: "system" },
      { id: "history", type: "history", enabled: true },
      { id: "instruction", type: "instruction", enabled: true, role: "user", template: "请回应。" }
    ],
    suffix: { enabled: false, template: "" }
  };
  class TemplateEngine {
    renderTemplateString(template, context) {
      Handlebars.registerHelper("otherCharacters", (characters, currentId) =>
        Array.from(characters.values()).filter((character) => Number(character.id) !== Number(currentId)));
      return Handlebars.compile(template)(context, { allowProtoPropertiesByDefault: true, allowProtoMethodsByDefault: true });
    }
  }
  class PromptScriptLoader {}
  return createPromptBuilder({
    TemplateEngine,
    PromptScriptLoader,
    promptConfigManager: { getDefaultMainTemplateContent: () => promptSettings.mainTemplate },
    settingsRepository: {
      getPromptSettings: () => promptSettings,
      getChatPromptV89Settings: () => ({ chatPromptV89Layout: true }),
      getChatPromptV813Layout: () => false,
      getActiveProviderConfig: () => null
    },
    path,
    TokenCounter: {
      estimateTokens: (text) => String(text || "").length,
      estimateMessageTokens: (message) => String(message?.content || "").length,
      calculateTotalTokens: (messages) => messages.reduce((sum, message) => sum + String(message.content || "").length, 0)
    },
    createPromptFingerprint: (value) => String(value || ""),
    defaultChatInstruction: "请回应。"
  });
}

function providerText(PromptBuilder, history, character, gameData, memoryContext = null) {
  return PromptBuilder.buildMessagesWithTokenCount(history, character, gameData, "", memoryContext)
    .messages.map((message) => message.content).join("\n");
}

function retrieveFor(engine, characterId, conversationId) {
  return engine.retrieveForResponder({
    characterId,
    query: "",
    directCounterpartIds: [],
    activeParticipantIds: [PLAYER_ID, characterId],
    conversationId,
    campaignToken: CAMPAIGN_TOKEN,
    memoryEngine3Enabled: true,
    memory4RecallEnabled: true,
    tokenBudget: 2000,
    estimateTokens: (text) => String(text || "").length,
    sessionRecallCache: new Map(),
    mentionedRecallCache: new Map()
  });
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), "votc-stranger-memory-isolation-"));
try {
  const summariesDir = path.join(root, "summaries");
  const playerFolder = path.join(summariesDir, `${PLAYER_ID}_甲`);
  fs.mkdirSync(playerFolder, { recursive: true });
  const summaryFile = path.join(playerFolder, "与同名的对话.json");
  fs.writeFileSync(summaryFile, JSON.stringify([
    { playerId: PLAYER_ID, characterId: OLD_NPC_B_ID, campaignToken: "fixture-old-campaign", content: "OLD_ABC_SUMMARY_SECRET_15" },
    { playerId: 99, characterId: NEW_NPC_D_ID, campaignToken: CAMPAIGN_TOKEN, content: "WRONG_PLAYER_SUMMARY_27" },
    { playerId: PLAYER_ID, characterId: NEW_NPC_D_ID, campaignToken: "fixture-old-campaign", content: "WRONG_CAMPAIGN_SUMMARY_39" },
    { playerId: PLAYER_ID, characterId: NEW_NPC_D_ID, campaignToken: "", content: "UNBOUND_CAMPAIGN_SUMMARY_51" },
    { playerId: PLAYER_ID, characterId: NEW_NPC_D_ID, campaignToken: CAMPAIGN_TOKEN, content: "CURRENT_D_MATCHING_SUMMARY_63" }
  ]));

  const { gameData, player, responder } = makeGameData(summariesDir);
  gameData.loadCharactersSummaries();
  assert.deepEqual(responder.conversationSummaries.map((summary) => summary.content), ["CURRENT_D_MATCHING_SUMMARY_63"],
    `same-name legacy summary loading must require exact player, character and nonempty active campaign identity; loaded=${JSON.stringify(responder.conversationSummaries.map(summary => summary.content))}`);

  const store = makeMemoryStore();
  const retrievalTrace = [];
  const engine = new MemoryEngine({ store, trace: { record: (type, details) => retrievalTrace.push({ type, ...details }) } });
  const knowledge = new KnowledgeService({ store });
  const PromptBuilder = makePromptBuilder();
  const history = [{ role: "user", content: "我们初次见面，你是谁？" }];

  const aContext = retrieveFor(engine, NPC_A_ID, "old-abc-conversation");
  assert.equal(aContext.engineVersion, MEMORY_ENGINE_VERSION, "the final prompt fixture uses the current source Memory Engine version");
  const aCharacter = makeCharacter(NPC_A_ID, "乙");
  aCharacter.capitalLocation = A_OWN_CAPITAL;
  gameData.characters.set(NPC_A_ID, aCharacter);
  const aPrompt = providerText(PromptBuilder, history, aCharacter, gameData, { ...aContext, activeParticipantIds: [PLAYER_ID, NPC_A_ID] });
  assert(aPrompt.includes(OLD_SECRET), "the originally authorized A responder retains its old conversation secret");

  const capitalPromptBuilder = makePromptBuilder("RESPONDER_CAPITAL={{character.capitalLocation}}\n{{#each (otherCharacters gameData.characters character.id)}}{{id}}={{capitalLocation}}\n{{/each}}");
  const dCapitalPrompt = providerText(capitalPromptBuilder, history, responder, gameData);
  assert(!dCapitalPrompt.includes(PLAYER_CAPITAL_SENTINEL),
    `the final D provider prompt must not include the player's private capital: ${dCapitalPrompt}`);
  assert(dCapitalPrompt.includes(D_OWN_CAPITAL), "D retains D's own capital in the final provider prompt");
  const aCapitalPrompt = providerText(capitalPromptBuilder, history, aCharacter, gameData);
  assert(aCapitalPrompt.includes(A_OWN_CAPITAL), "A retains A's own capital in the final provider prompt");
  assert(!aCapitalPrompt.includes(PLAYER_CAPITAL_SENTINEL), "A's final provider prompt excludes the player's private capital");
  const dCapitalView = createTraitProfileView(gameData, responder);
  const aCapitalView = createTraitProfileView(gameData, aCharacter);
  assert.equal(dCapitalView.gameData.characters.get(PLAYER_ID).capitalLocation, undefined, "non-self capital is removed from D's profile view");
  assert.equal(dCapitalView.character.capitalLocation, D_OWN_CAPITAL, "D's self capital survives profile projection");
  assert.equal(aCapitalView.character.capitalLocation, A_OWN_CAPITAL, "A's self capital survives profile projection");
  assert.equal(gameData.characters.get(PLAYER_ID).capitalLocation, PLAYER_CAPITAL_SENTINEL, "profile views leave raw game data unchanged");

  const dContextBeforeTransfer = retrieveFor(engine, NEW_NPC_D_ID, "new-d-conversation-before-transfer");
  assert.equal(dContextBeforeTransfer.respondingCharacterId, NEW_NPC_D_ID, "the actual first D retrieval is responder-scoped");
  assert(!retrievalTrace.some(event => event.type === "selected" && event.characterId === NEW_NPC_D_ID && event.memoryId === OLD_SECRET_ID),
    "the actual first D retrieval does not select the old ABC secret from its stale knowledge row");
  const newConversationPrompt = providerText(PromptBuilder, history, responder, gameData, {
    ...dContextBeforeTransfer,
    activeParticipantIds: [PLAYER_ID, NEW_NPC_D_ID]
  });
  assert(!newConversationPrompt.includes(OLD_SECRET), "new D conversation must not receive ABC content from a stale knowledge-index row");
  assert(!newConversationPrompt.includes("OLD_ABC_SUMMARY_SECRET_15"), "new D provider prompt must not receive the same-name old summary");
  assert(!newConversationPrompt.includes("WRONG_PLAYER_SUMMARY_27")
    && !newConversationPrompt.includes("WRONG_CAMPAIGN_SUMMARY_39")
    && !newConversationPrompt.includes("UNBOUND_CAMPAIGN_SUMMARY_51"), "summary records from another player/campaign or without a campaign binding stay out of the prompt");
  const compatibilityPrompt = providerText(PromptBuilder, history, responder, gameData);
  assert(!compatibilityPrompt.includes("OLD_ABC_SUMMARY_SECRET_15")
    && !compatibilityPrompt.includes("WRONG_PLAYER_SUMMARY_27")
    && !compatibilityPrompt.includes("WRONG_CAMPAIGN_SUMMARY_39")
    && !compatibilityPrompt.includes("UNBOUND_CAMPAIGN_SUMMARY_51"), "legacy PromptBuilder summary fallback excludes poisoned same-name records");
  assert(compatibilityPrompt.includes("CURRENT_D_MATCHING_SUMMARY_63"), "an exact identity and campaign match remains available in the legacy summary prompt path");
  assert(newConversationPrompt.includes("私下交谈和信件不会自动变成全世界的传闻")
    && newConversationPrompt.includes("对话记忆中的 public 只表示当场公开说出，不是全球公开")
    && newConversationPrompt.includes("不得用“听说”“传闻”“有人告诉我”补造"),
  "the current responder facts carry the private-conversation/publicity boundary in Provider-visible messages");

  assert.deepEqual(memoryFactsForResponder({ store }, NEW_NPC_D_ID), [],
    "Worldline memory facts must reject a stale knowledge-index row absent from canonical knownBy");
  assert.deepEqual(memoryFactsForResponder({ store }, NPC_A_ID).map((fact) => fact.contentRef).sort(), [TRANSFERRED_SECRET_ID, OLD_SECRET_ID].sort(),
    "Worldline still exposes canonically authorized memories to their owner");

  const oldSecretKnownByBeforeRejectedTransfer = [...store.getMemory(OLD_SECRET_ID).knownBy];
  assert.equal(knowledge.transferKnowledge(OLD_SECRET_ID, {
    fromCharacterId: NEW_NPC_D_ID,
    toCharacterId: FRESH_NPC_E_ID,
    acquiredAt: 102,
    awareness: "told"
  }), false, "a stale knowledge-index row cannot authorize D to retell a memory absent from canonical knownBy");
  assert.deepEqual(store.getCharacterKnowledge(FRESH_NPC_E_ID), [], "a rejected stale-source transfer does not add a recipient index row");
  assert.deepEqual(store.getMemory(OLD_SECRET_ID).knownBy, oldSecretKnownByBeforeRejectedTransfer,
    "a rejected stale-source transfer does not broaden the canonical ACL");

  assert.equal(knowledge.transferKnowledge(TRANSFERRED_SECRET_ID, {
    fromCharacterId: NPC_A_ID,
    toCharacterId: NEW_NPC_D_ID,
    acquiredAt: 101,
    awareness: "told"
  }), true, "an explicit A-to-D disclosure is recorded");
  const dContextAfterTransfer = retrieveFor(engine, NEW_NPC_D_ID, "new-d-conversation-after-transfer");
  const transferredPrompt = providerText(PromptBuilder, history, responder, gameData, {
    ...dContextAfterTransfer,
    activeParticipantIds: [PLAYER_ID, NEW_NPC_D_ID]
  });
  assert(!transferredPrompt.includes(OLD_SECRET), "explicitly learning one secret does not grant unrelated old ABC memories");
  assert(transferredPrompt.includes(TRANSFERRED_SECRET), "an explicit transfer makes its one authorized memory available in the new conversation");
  assert.deepEqual(memoryFactsForResponder({ store }, NEW_NPC_D_ID).map((fact) => fact.contentRef), [TRANSFERRED_SECRET_ID],
    "Worldline receives the transferred memory and no stale-index memories");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log("V8.15.2 Stranger Memory Isolation QA: PASS (Provider prompt, stale index, name collision, responder guard, Worldline ACL and explicit transfer)");
