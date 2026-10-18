"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const path = require("node:path");

const versionModulePath = require.resolve("../src/app/main/version");
require.cache[versionModulePath] = {
  id: versionModulePath,
  filename: versionModulePath,
  loaded: true,
  exports: { MEMORY_ENGINE_VERSION: "3.0" }
};

const { createPromptBuilder } = require("../src/app/main/prompts/prompt-builder");
const { Conversation } = require("../src/app/main/conversation/conversation");

const TokenCounter = {
  estimateTokens(value) {
    return Math.ceil(String(value || "").length / 4);
  },
  estimateMessageTokens(message) {
    return this.estimateTokens(`${message?.role || ""}\n${message?.name || ""}\n${message?.content || ""}`);
  },
  calculateTotalTokens(messages) {
    return (messages || []).reduce((total, message) => total + this.estimateMessageTokens(message), 0);
  }
};

const fixtureState = {
  events: [],
  excludedBuild: null,
  finalBuild: null,
  retrievedInput: null,
  capabilities: { providerType: "openai-compatible", providerId: "fixture", modelId: "fixture-model",
    contextWindow: 16384, maxOutputTokens: 8192, capabilityRevision: "fixture:16384:8192" },
  provider: { providerType: "openai-compatible", defaultParameters: { max_tokens: 8192 } }
};

const settingsRepository = {
  getPromptSettings: () => ({
    mainTemplate: "V936_CONVERSATION_BUDGET_RULES",
    blocks: [
      { id: "main", type: "main", enabled: true, role: "system" },
      { id: "legacy-past-summaries", type: "past_summaries", enabled: true, role: "system" },
      { id: "history", type: "history", enabled: true },
      { id: "instruction", type: "instruction", enabled: true, role: "user", template: "V936_FINAL_INSTRUCTION" }
    ],
    suffix: { enabled: false, template: "" }
  }),
  getChatPromptV89Settings: () => ({ chatPromptV89Layout: true, chatPromptV89RuntimeProfileSplit: false, chatPromptV810ProviderAdapter: true }),
  getChatPromptV813Layout: () => false,
  getActiveProviderConfig: () => fixtureState.provider
};

const PromptBuilder = createPromptBuilder({
  TemplateEngine: class {
    renderTemplateString(template) { return String(template); }
  },
  PromptScriptLoader: class {},
  promptConfigManager: {
    getDefaultMainTemplateContent: () => "V936_CONVERSATION_BUDGET_RULES",
    resolvePath: value => value
  },
  settingsRepository,
  path,
  TokenCounter,
  createPromptFingerprint: value => crypto.createHash("sha256").update(String(value || "")).digest("hex"),
  defaultChatInstruction: "V936_FINAL_INSTRUCTION"
});

const originalBuildMessagesWithTokenCount = PromptBuilder.buildMessagesWithTokenCount;
PromptBuilder.buildMessagesWithTokenCount = function (...args) {
  const memoryMode = args[6]?.memoryMode || "final";
  fixtureState.events.push(memoryMode === "exclude" ? "dry-run" : "prompt-build");
  const result = originalBuildMessagesWithTokenCount.apply(this, args);
  if (memoryMode === "exclude") fixtureState.excludedBuild = result;
  else fixtureState.finalBuild = result;
  return result;
};

const memoryEngine = {
  syncRollingStateFromConversationFields() {},
  syncConversationRollingFields() {},
  retrieveForResponder(input) {
    fixtureState.events.push("memory-retrieval");
    fixtureState.retrievedInput = input;
    return {
      playerCenteredRecallEnabled: true,
      sourceFolderRevision: 19,
      sourceCampaignToken: null,
      tokenBudget: input.tokenBudget,
      officialRecollectionText: "",
      directStableText: "",
      playerLedgerFrozenText: "",
      stableText: "",
      mentionedSnapshotText: "",
      temporalExtraText: "",
      topicPatchText: "",
      turnRecallText: null,
      thirdPartyEvidenceText: null
    };
  }
};

const worldlineService = {
  isSubjectivePromptIntegrationEnabled: () => true,
  async prepareCanon() { fixtureState.events.push("worldline-prepare"); },
  async getSubjectivePromptContextAsync() {
    fixtureState.events.push("worldline-recall");
    return {
      worldStableText: "V936_WORLD_STABLE_NONMEMORY",
      worldTurnRecallText: "V936_WORLD_TURN_NONMEMORY",
      worldTurnRecallTokens: 20,
      worldTurnRecallTrimmed: [],
      metrics: null
    };
  }
};

Conversation.configure({
  PromptBuilder,
  TokenCounter,
  settingsRepository,
  memoryEngine,
  worldlineService,
  llmManager: {
    async getProviderCapabilities() { return fixtureState.capabilities; }
  },
  usageAnalytics: { record() {} }
});

function makeBudgetConversation() {
  const conversation = Object.create(Conversation.prototype);
  conversation.frozenMemoryBudget = null;
  return conversation;
}

function assertContextWindowBudgetTiers() {
  const participantIds = [1, 2, 3, 4];
  for (const [contextWindow, expected] of [
    [8 * 1024, 6144],
    [16 * 1024, 12288],
    [32 * 1024, 24576],
    [128 * 1024, 96000]
  ]) {
    const conversation = makeBudgetConversation();
    const actual = conversation.getMemoryTokenBudget(contextWindow, participantIds, contextWindow);
    assert.equal(actual, expected, `${contextWindow / 1024}K must use the current four-participant policy budget`);
    assert.equal(conversation.frozenMemoryBudget.participantCount, 4);
  }
}

function assertParticipantCountIsFrozen() {
  const conversation = makeBudgetConversation();
  const firstBudget = conversation.getMemoryTokenBudget(32 * 1024, [1, 2], 32 * 1024);
  const expandedBudget = conversation.getMemoryTokenBudget(32 * 1024, [1, 2, 3, 4, 5], 32 * 1024);
  assert.equal(firstBudget, Math.floor(32768 * 0.65), "a two-participant conversation freezes its window-limited allocation");
  assert.equal(expandedBudget, firstBudget, "later participants must not expand the frozen memory allocation");
  assert.equal(conversation.frozenMemoryBudget.participantCount, 2,
    "the participant count recorded at the first budget calculation must remain frozen");
}

function makeGameData() {
  const player = { id: 1, shortName: "玩家-A", fullName: "玩家-A", age: 40, gender: "female", traits: [], parents: [], children: [] };
  const responder = {
    id: 2, shortName: "NPC-B", fullName: "NPC-B", age: 35, gender: "male", traits: [], parents: [], children: [],
    memories: [], conversationSummaries: [{ date: "1100.1.1", content: "V936_LEGACY_PAST_SUMMARY_MUST_NOT_BYPASS" }],
    primaryTitle: "无", heldCourtAndCouncilPositions: "无", titleRankConcept: "concept_none"
  };
  const characters = new Map([[1, player], [2, responder]]);
  return {
    date: "1200.1.1",
    year: 1200,
    dynasty: "V936",
    currentEraName: "V936 era",
    scene: "V936 scene",
    playerID: 1,
    playerName: "玩家-A",
    characters,
    mentionedCharactersInContext: new Set(),
    getActiveParticipantRelationshipInfo: () => "V936_ACTIVE_RELATIONSHIPS_NONMEMORY",
    getMentionExclusionIds: () => new Set(),
    findMentionedCharacterIdsInHistory: () => new Set(),
    getMentionedCharactersInfo: () => "",
    getMentionableCharacterProfiles: () => characters
  };
}

function makeConversation() {
  const conversation = Object.create(Conversation.prototype);
  conversation.id = "v936-conversation-budget-fixture";
  conversation.turnEpoch = 7;
  conversation.gameData = makeGameData();
  conversation.messages = [{ id: 1, role: "user", content: "V936_CURRENT_PLAYER_QUERY".padEnd(11500, "x") }];
  conversation.presentCharacterIds = new Set([2]);
  conversation.CONTEXT_LIMIT_PERCENTAGE = 0.75;
  conversation.memoryState = { sourceFolderRevisions: new Map() };
  conversation.cacheV2FrozenSnapshots = { prefixByResponder: new Map() };
  conversation.pendingPlayerRecallRequests = new Map([[2, {
    characterId: 2,
    query: "V936_CURRENT_PLAYER_QUERY",
    activeParticipantIds: [1, 2],
    campaignToken: null,
    conversationId: conversation.id,
    turnEpoch: conversation.turnEpoch,
    tokenBudget: 0
  }]]);
  conversation.getMemoryContextFor = async () => {
    fixtureState.events.push("deferred-memory-context");
    return {
      playerCenteredRecallEnabled: true,
      campaignToken: null,
      sourceCampaignToken: null,
      sourceFolderRevision: 19,
      activeParticipantIds: [1, 2],
      worldlineRequest: { query: "V936_CURRENT_PLAYER_QUERY", assistContext: "", mentionedEntityIds: [] },
      presenceText: "V936_PRESENCE_NONMEMORY",
      subjectiveWorldPolicyActive: true,
      historicalReferenceInfo: { period: "V936 period", context: "V936 historical boundary", notableEvents: [], notableFigures: [] },
      stableProfileCache: new Map(),
      stableDescriptionCache: new Map(),
      cacheV2FrozenSnapshots: { conversation: null, responders: new Map(), prefixByResponder: new Map() }
    };
  };
  conversation.getPromptHistoryForCharacter = () => conversation.messages;
  conversation.getPromptSummaryForCharacter = () => "V936_ROLLING_SUMMARY";
  conversation.getActiveConversationCharacters = () => [conversation.gameData.characters.get(1), conversation.gameData.characters.get(2)];
  conversation.isV813PrefixEnabled = () => false;
  conversation.estimateTokenCount = messages => TokenCounter.calculateTotalTokens(messages);
  conversation.createRollingSummary = async () => ({ committed: false, reason: "fixture_not_needed" });
  const getMemoryTokenBudget = Conversation.prototype.getMemoryTokenBudget;
  conversation.getMemoryTokenBudget = function (...args) {
    fixtureState.events.push("memory-budget");
    return getMemoryTokenBudget.apply(this, args);
  };
  return conversation;
}

async function assertDryRunOrderingWorldlineAndNoCampaignFallback() {
  fixtureState.events = [];
  fixtureState.excludedBuild = null;
  fixtureState.finalBuild = null;
  fixtureState.retrievedInput = null;
  fixtureState.capabilities = {
    providerType: "openai-compatible", providerId: "fixture", modelId: "fixture-model",
    contextWindow: 16 * 1024, maxOutputTokens: 8 * 1024, capabilityRevision: "fixture:16384:8192"
  };
  fixtureState.provider = { providerType: "openai-compatible", defaultParameters: { max_tokens: 8 * 1024 } };

  const conversation = makeConversation();
  const result = await Conversation.prototype.checkAndSummarizeIfNeeded.call(conversation,
    conversation.gameData.characters.get(2));

  const worldlineIndex = fixtureState.events.indexOf("worldline-recall");
  const dryRunIndex = fixtureState.events.indexOf("dry-run");
  const memoryBudgetIndex = fixtureState.events.indexOf("memory-budget");
  const retrievalIndex = fixtureState.events.indexOf("memory-retrieval");
  assert(worldlineIndex >= 0, "the real Conversation loop must request Worldline context before memory budgeting");
  assert(dryRunIndex > worldlineIndex, "the memory-excluded dry-run must include the already retrieved Worldline context");
  assert(memoryBudgetIndex > dryRunIndex, "non-memory prompt dry-run must complete before memory budget allocation");
  assert(retrievalIndex > memoryBudgetIndex, "memory retrieval must happen only after the memory budget is computed");

  const dryRunText = fixtureState.excludedBuild.messages.map(message => message.content || "").join("\n");
  assert(dryRunText.includes("V936_WORLD_STABLE_NONMEMORY"), "memory-excluded dry-run must preserve stable Worldline text");
  assert(dryRunText.includes("V936_WORLD_TURN_NONMEMORY"), "memory-excluded dry-run must preserve Worldline turn recall");
  assert(dryRunText.includes("V936_PRESENCE_NONMEMORY"), "memory-excluded dry-run must preserve presence context");
  assert(!dryRunText.includes("V936_LEGACY_PAST_SUMMARY_MUST_NOT_BYPASS"),
    "memory-excluded dry-run must not include the legacy past_summaries block without a Campaign");

  assert.equal(fixtureState.retrievedInput.campaignToken, null, "the retrieval request must preserve the missing Campaign state");
  assert.equal(result.campaignToken, null, "the final memory context must remain unbound to a Campaign");
  const finalText = fixtureState.finalBuild.messages.map(message => message.content || "").join("\n");
  assert(!finalText.includes("V936_LEGACY_PAST_SUMMARY_MUST_NOT_BYPASS"),
    "the final prompt must not bypass player-centered retrieval through legacy past_summaries when Campaign is absent");

  const budgetPlan = result.memoryBudgetPlan;
  assert.equal(budgetPlan.reservedOutputTokens, 8 * 1024, "the provider's high output reservation must remain in the request budget");
  assert.equal(budgetPlan.memoryBudgetTokens, budgetPlan.providerHeadroomTokens,
    "when provider headroom is below the policy allocation, memory tokens must be capped exactly at that headroom");
  assert(budgetPlan.memoryBudgetTokens < 16 * 1024 * 0.16,
    "high output reservation plus current prompt content must reduce the two-participant policy allocation");
}

async function main() {
  assertContextWindowBudgetTiers();
  assertParticipantCountIsFrozen();
  await assertDryRunOrderingWorldlineAndNoCampaignFallback();
  console.log("V9.3.6 Conversation memory budget and dry-run: PASS");
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
