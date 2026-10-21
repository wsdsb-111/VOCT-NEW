"use strict";

const crypto = require("crypto");
const path = require("path");

const BASELINE_COMMIT = "2330bbcb6c068a4e42c19b26eba82f4034e6db63";
const MAIN_TEMPLATE = [
  "{{! VOTC_SEGMENT:stable_global }}GLOBAL RULES: fixture-only roleplay rules.",
  "{{! VOTC_SEGMENT:stable_history_rp }}You are {{fullName}}. Keep the shared roleplay rules.",
  "{{! VOTC_SEGMENT:world_context }}WORLD DATE={{gameData.date}}; SCENE={{gameData.scene}}",
  "{{! VOTC_SEGMENT:character_base }}PROFILE={{character.shortName}}; CULTURE={{character.culture}}",
  "{{! VOTC_SEGMENT:character_state }}STATE={{character.gold}}"
].join("\n");

const CASES = Object.freeze([
  { id: "v5", layoutId: "v5", providerConfig: { providerType: "openai-compatible", defaultModel: "fixture-model" } },
  { id: "v6", layoutId: "v6", providerConfig: { providerType: "openai-compatible", defaultModel: "fixture-model" } },
  { id: "v7", layoutId: "v7", providerConfig: { providerType: "openai-compatible", defaultModel: "fixture-model" } },
  { id: "v813-query-dynamic", layoutId: "v813", providerConfig: { providerType: "openai-compatible", defaultModel: "fixture-model" }, freezeState: "query" },
  { id: "v813-success-frozen", layoutId: "v813", providerConfig: { providerType: "openai-compatible", defaultModel: "fixture-model" }, freezeState: "frozen" },
  { id: "glm_cache_v2", layoutId: "glm_cache_v2", providerConfig: { providerType: "zhipu", defaultModel: "glm-5.3-flash" } },
  { id: "deepseek_v89-v6", layoutId: "v6", providerConfig: { providerType: "deepseek", defaultModel: "deepseek-v4-flash-0731" } }
]);

function createFixture(caseId) {
  const definition = CASES.find((entry) => entry.id === caseId);
  if (!definition) throw new Error(`unknown_v9_4_legacy_case:${caseId}`);

  const responder = {
    id: 31001,
    shortName: "虚构回应者 Mira",
    fullName: "Lady Mira of Fixture",
    firstName: "Mira",
    gender: "female",
    age: 31,
    culture: "Synthetic Coast",
    gold: 123,
    primaryTitle: "Countess of Example",
    titleRankConcept: "concept_county",
    heldCourtAndCouncilPositions: "Fixture Chancellor",
    traits: []
  };
  const player = {
    id: 41002,
    shortName: "虚构玩家 Rowan",
    fullName: "Rowan of Fixture",
    firstName: "Rowan",
    gender: "male",
    age: 28,
    traits: []
  };
  const characters = new Map([[responder.id, responder], [player.id, player]]);
  const gameData = {
    date: "1175.6.14",
    year: 1175,
    totalDays: 512345,
    campaignToken: "v94-synthetic-campaign",
    dynasty: "Synthetic House",
    currentEraName: "Fixture Era",
    scene: "Synthetic court chamber",
    location: "Example Keep",
    playerID: player.id,
    playerName: player.shortName,
    characters,
    mentionedCharactersInContext: new Set(),
    getActiveParticipantRelationshipInfo: () => "RELATIONSHIP_FIXTURE: Mira and Rowan have no disclosed kinship.",
    findMentionedCharacterIdsInHistory: () => [],
    getMentionedCharactersInfo: () => "",
    getMentionableCharacterProfiles: () => characters
  };

  const promptSettings = {
    mainTemplate: MAIN_TEMPLATE,
    blocks: [
      { id: "main-system", type: "main", label: "Synthetic Main", enabled: true, role: "system" },
      { id: "profile", type: "description", label: "Synthetic Profile", enabled: true, role: "system", scriptPath: "fixture:description" },
      { id: "examples", type: "examples", label: "Synthetic Examples", enabled: true, role: "system", scriptPath: "fixture:examples" },
      { id: "rolling", type: "rolling_summary", label: "Synthetic Rolling Summary", enabled: true, role: "system", template: "ROLLING SUMMARY\n{{summary}}" },
      { id: "history", type: "history", label: "Synthetic History", enabled: true },
      { id: "instruction", type: "instruction", label: "Synthetic Instruction", enabled: true, role: "user", template: "FINAL INSTRUCTION|{{character.fullName}}|{{gameData.scene}}" }
    ],
    suffix: { enabled: true, label: "Synthetic Suffix", template: "SUFFIX START\n{{gameData.date}}\nSUFFIX END" }
  };

  const prefixByResponder = new Map();
  const memoryContext = {
    activeParticipantIds: [responder.id, player.id],
    playerAnchorId: player.id,
    baselineSnapshotId: "v94-synthetic-baseline",
    sourceFolderRevision: 1,
    sourceCampaignToken: gameData.campaignToken,
    sourcePairIds: [player.id, responder.id],
    budgetPolicyRevision: "v9.3.9-synthetic",
    conversationId: "v94-synthetic-conversation",
    playerCenteredRecallEnabled: true,
    freezePromptPrefix: true,
    cacheV2FrozenSnapshots: { conversation: null, responders: new Map(), prefixByResponder },
    officialRecollectionText: "OFFICIAL RECOLLECTION FIXTURE\nline 2",
    directStableText: "DIRECT PLAYER MEMORY FIXTURE",
    playerLedgerFrozenText: "PLAYER LEDGER FIXTURE: one legal matter",
    stableText: "RECENT2 FIXTURE: first entry\nRECENT2 FIXTURE: second entry",
    worldStableText: "WORLD STABLE FIXTURE",
    topicPatchText: "TURN TOPIC FIXTURE",
    presenceText: "PRESENCE FIXTURE: responder and player",
    worldTopicText: "WORLD TOPIC FIXTURE",
    worldSupplementalText: "WORLD SUPPLEMENTAL FIXTURE",
    worldCurrentText: "WORLD CURRENT FIXTURE",
    worldTurnRecallText: "WORLD TURN RECALL FIXTURE",
    turnRecallText: null,
    thirdPartyEvidenceText: null,
    temporalExtraText: null,
    frozenDynamicText: null
  };

  if (definition.freezeState === "query") {
    memoryContext.turnRecallText = "TIME_RECALL_FIXTURE: synthetic time document, retrieved for this query.";
    memoryContext.thirdPartyEvidenceText = "THIRD_PARTY_RECALL_FIXTURE: synthetic conversation document, retrieved for this query.";
  } else if (definition.freezeState === "frozen") {
    memoryContext.frozenDynamicText = [
      "TIME_RECALL_FIXTURE: synthetic time document, retrieved for this query.",
      "THIRD_PARTY_RECALL_FIXTURE: synthetic conversation document, retrieved for this query."
    ].join("\n\n");
  }

  const history = [
    { role: "user", content: "DUPLICATE BODY|same fixture bytes" },
    { role: "assistant", content: "DUPLICATE BODY|same fixture bytes" },
    { role: "assistant", name: "Synthetic Narrator", content: "Line one\n\nLine two | separator fixture." },
    { role: "user", content: "CURRENT QUESTION|what happened in this fictional scene?" }
  ];

  return {
    definition,
    responder,
    gameData,
    history,
    currentSessionSummary: "ROLLING FIXTURE A\nROLLING FIXTURE B",
    memoryContext,
    promptSettings
  };
}

function createPromptRuntime(mainDir, fixture) {
  const { createPromptBuilder } = require(path.join(mainDir, "prompts", "prompt-builder.js"));
  const { estimateTokens } = require(path.join(mainDir, "token-estimator.js"));
  const { planRequestBudget } = require(path.join(mainDir, "providers", "request-budget.js"));
  const TokenCounter = {
    estimateTokens,
    estimateMessageTokens(message) {
      const text = message?.name ? `${message.name}: ${message.content}` : message?.content;
      return estimateTokens(text);
    },
    calculateTotalTokens(messages) {
      return messages.reduce((total, message) => total + this.estimateMessageTokens(message), 0);
    }
  };

  class TemplateEngine {
    renderTemplateString(template, context = {}) {
      const values = {
        fullName: context.character?.fullName,
        "character.fullName": context.character?.fullName,
        "character.shortName": context.character?.shortName,
        "character.culture": context.character?.culture,
        "character.gold": context.character?.gold,
        "gameData.date": context.gameData?.date,
        "gameData.scene": context.gameData?.scene,
        summary: context.summary
      };
      return String(template).replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (match, key) =>
        Object.prototype.hasOwnProperty.call(values, key) && values[key] != null ? String(values[key]) : match);
    }
  }

  class PromptScriptLoader {
    executeDescription(_scriptPath, gameData, id) {
      const character = gameData.characters.get(id);
      return `DESCRIPTION FIXTURE: ${character.fullName}; culture=${character.culture}\n[date(${gameData.date})]`;
    }
    executeExamples() {
      return [
        { role: "system", content: "EXAMPLE DUPLICATE FIXTURE BODY" },
        { role: "assistant", content: "EXAMPLE DUPLICATE FIXTURE BODY" },
        { role: "user", content: "EXAMPLE DUPLICATE FIXTURE BODY" }
      ];
    }
  }

  const settingsRepository = {
    getPromptSettings: () => fixture.promptSettings,
    getChatPromptV89Settings: () => ({
      chatPromptV89Layout: fixture.definition.layoutId !== "v5",
      chatPromptV89RuntimeProfileSplit: fixture.definition.layoutId === "v7",
      chatPromptV810ProviderAdapter: true
    }),
    getChatPromptV813Layout: () => fixture.definition.layoutId === "v813"
  };
  const promptConfigManager = {
    getDefaultMainTemplateContent: () => fixture.promptSettings.mainTemplate,
    resolvePath: (value) => value
  };
  const PromptBuilder = createPromptBuilder({
    TemplateEngine,
    PromptScriptLoader,
    promptConfigManager,
    settingsRepository,
    path,
    TokenCounter,
    createPromptFingerprint: (value) => crypto.createHash("sha256").update(String(value || ""), "utf8").digest("hex"),
    defaultChatInstruction: "FINAL INSTRUCTION FIXTURE"
  });
  return { PromptBuilder, TokenCounter, planRequestBudget };
}

function capturePromptOutput({ mainDir, caseId, Conversation = null, promptPlanMode = "legacy" }) {
  const fixture = createFixture(caseId);
  const runtime = createPromptRuntime(mainDir, fixture);
  const createPromptFingerprint = (value) => crypto.createHash("sha256").update(String(value || ""), "utf8").digest("hex");
  Conversation?.configure?.({ createPromptFingerprint });
  const result = runtime.PromptBuilder.buildMessagesWithTokenCount(
    fixture.history,
    fixture.responder,
    fixture.gameData,
    fixture.currentSessionSummary,
    fixture.memoryContext,
    fixture.definition.providerConfig,
    { promptPlanMode }
  );
  const anchor = result.messages[0];
  const budget = runtime.planRequestBudget({
    messages: result.messages,
    capabilities: { contextWindow: 8192, maxOutputTokens: 1024 },
    requestedOutputTokens: 777,
    countTokens: (messages) => runtime.TokenCounter.calculateTotalTokens(messages)
  });
  const diagnostic = Conversation?.buildPromptBlockMetadata(result) || null;
  return {
    promptProfile: result.promptProfile,
    messages: result.messages,
    anchor: {
      role: anchor?.role || null,
      utf8Base64: anchor ? Buffer.from(anchor.content, "utf8").toString("base64") : null,
      sha256: anchor ? crypto.createHash("sha256").update(anchor.content, "utf8").digest("hex") : null
    },
    blockOrder: result.blocks.map(({ block }) => ({
      id: block?.id || null,
      type: block?.type || null,
      role: block?.role || null,
      stable: block?.stable ?? null,
      lifecycle: block?.lifecycle || null
    })),
    tokenCounts: {
      totalTokens: result.totalTokens,
      staticTokens: result.staticTokens,
      dynamicTokens: result.dynamicTokens,
      globalStaticTokens: result.globalStaticTokens,
      conversationFrozenTokens: result.conversationFrozenTokens,
      responderFrozenTokens: result.responderFrozenTokens,
      actualStablePrefixTokens: result.actualStablePrefixTokens,
      declaredStaticTokens: result.declaredStaticTokens,
      dynamicTailTokens: result.dynamicTailTokens,
      omittedHistoryTokens: result.omittedHistoryTokens
    },
    requestBudget: budget,
    diagnosticBlocks: diagnostic?.blocks.map(({ id, type, messageStartPosition, messageCount, stable, lifecycle, tokens }) => ({
      id,
      type,
      messageStartPosition,
      messageCount,
      stable,
      lifecycle,
      tokens
    })) || null
  };
}

module.exports = {
  BASELINE_COMMIT,
  CASES,
  createFixture,
  createPromptRuntime,
  capturePromptOutput
};
