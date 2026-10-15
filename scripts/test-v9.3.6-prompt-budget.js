"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const path = require("node:path");

const { createPromptBuilder } = require("../src/app/main/prompts/prompt-builder");
const versionModulePath = require.resolve("../src/app/main/version");
require.cache[versionModulePath] = {
  id: versionModulePath,
  filename: versionModulePath,
  loaded: true,
  exports: { MEMORY_ENGINE_VERSION: "3.0" }
};
const { createGameData } = require("../src/app/main/game-data/game-data");
const {
  PLAYER_CENTERED_RECALL_ENABLED,
  MEMORY_BUDGET_POLICIES,
  DEFAULT_MEMORY_BUDGET_POLICY_REVISION,
  resolveMemoryBudget
} = require("../src/app/main/memory-system/memory-budget-policy");

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

const state = { v89: true, v813: false, adapter: true, includeLegacyMemoryBlocks: false };
const settingsRepository = {
  getPromptSettings: () => ({
    mainTemplate: "V936_GLOBAL_RULES",
    blocks: [
      { id: "main", type: "main", enabled: true, role: "system" },
      { id: "history", type: "history", enabled: true },
      { id: "instruction", type: "instruction", enabled: true, role: "user", template: "V936_FINAL_INSTRUCTION" },
      ...(state.includeLegacyMemoryBlocks ? [
        { id: "legacy-memories", type: "memories", enabled: true },
        { id: "legacy-past-summaries", type: "past_summaries", enabled: true }
      ] : [])
    ],
    suffix: { enabled: false, template: "" }
  }),
  getChatPromptV89Settings: () => ({
    chatPromptV89Layout: state.v89,
    chatPromptV89RuntimeProfileSplit: false,
    chatPromptV810ProviderAdapter: state.adapter
  }),
  getChatPromptV813Layout: () => state.v813
};

const PromptBuilder = createPromptBuilder({
  TemplateEngine: class {
    renderTemplateString(template) { return String(template); }
  },
  PromptScriptLoader: class {},
  promptConfigManager: {
    getDefaultMainTemplateContent: () => "V936_GLOBAL_RULES",
    resolvePath: value => value
  },
  settingsRepository,
  path,
  TokenCounter,
  createPromptFingerprint: value => crypto.createHash("sha256").update(String(value || "")).digest("hex"),
  defaultChatInstruction: "V936_FINAL_INSTRUCTION"
});

const responder = {
  id: 2,
  shortName: "NPC-B",
  fullName: "NPC-B",
  age: 35,
  gender: "male",
  traits: [],
  parents: [],
  children: [],
  memories: [{ creationDate: "1200.1.1", desc: "V936_LEGACY_MEMORY", relevanceWeight: 1 }],
  conversationSummaries: [{ date: "1200.1.1", content: "V936_LEGACY_SUMMARY" }],
  primaryTitle: "无",
  heldCourtAndCouncilPositions: "无",
  titleRankConcept: "concept_none"
};
const player = { id: 1, shortName: "玩家-A", fullName: "玩家-A", age: 40, gender: "female", traits: [], parents: [], children: [] };
const characters = new Map([[1, player], [2, responder]]);
const gameData = {
  date: "1200.1.1",
  year: 1200,
  dynasty: "V936",
  currentEraName: "V936 era",
  scene: "V936 scene",
  playerID: 1,
  characters,
  mentionedCharactersInContext: new Set(),
  getActiveParticipantRelationshipInfo: () => "V936_LIVE_RELATIONSHIPS",
  getMentionExclusionIds: () => new Set(),
  findMentionedCharacterIdsInHistory() { return new Set([3]); },
  getMentionedCharactersInfo() {
    return this.mentionedCharactersInContext.has(3) ? "V936_CURRENT_MENTIONED_TRUTH" : "";
  },
  getMentionableCharacterProfiles: () => characters
};

const history = [
  { role: "user", content: "V936_PRIOR_USER" },
  { role: "assistant", content: "V936_PRIOR_ASSISTANT" },
  { role: "user", content: "V936_CURRENT_USER" }
];
const providerConfigs = {
  normal: { providerType: "openai-compatible", defaultModel: "fixture-normal" },
  glm: { providerType: "zhipu", defaultModel: "glm-5.3-flash" },
  v813: { providerType: "openai-compatible", defaultModel: "fixture-v813" }
};

function makeMemoryContext() {
  return {
    activeParticipantIds: [1, 2],
    playerAnchorId: 1,
    baselineSnapshotId: "v936-baseline-snapshot-a",
    sourceFolderRevision: 7,
    sourceCampaignToken: "v936-fixture-campaign",
    sourcePairIds: [1],
    budgetPolicyRevision: "v9.3.6",
    conversationId: "v936-fixture-conversation",
    officialRecollectionText: "V936_OFFICIAL_FIXED",
    directStableText: "V936_RECENT1_FIXED",
    playerLedgerFrozenText: "V936_PLAYER_LEDGER_FIXED",
    stableText: "V936_STABLE_MEMORY_DYNAMIC",
    mentionedSnapshotText: "V936_MENTIONED_MEMORY_DYNAMIC",
    temporalExtraText: "V936_TEMPORAL_MEMORY_DYNAMIC",
    topicPatchText: "V936_TOPIC_MEMORY_DYNAMIC",
    turnRecallText: "V936_TURN_MEMORY_DYNAMIC",
    thirdPartyEvidenceText: "V936_THIRD_PARTY_MEMORY_DYNAMIC",
    presenceText: "V936_PRESENCE_NONMEMORY",
    worldStableText: "V936_WORLD_STABLE_NONMEMORY",
    worldTopicText: "V936_WORLD_TOPIC_NONMEMORY",
    worldSupplementalText: "V936_WORLD_SUPPLEMENTAL_NONMEMORY",
    worldCurrentText: "V936_WORLD_CURRENT_NONMEMORY",
    worldTurnRecallText: "V936_WORLD_TURN_NONMEMORY",
    confirmedActionText: "V936_CONFIRMED_ACTION_NONMEMORY",
    freezePromptPrefix: true,
    stableProfileCache: new Map(),
    stableDescriptionCache: new Map(),
    cacheV2FrozenSnapshots: {
      conversation: null,
      responders: new Map(),
      prefixByResponder: new Map()
    }
  };
}

function build(layout, memoryContext = makeMemoryContext(), options = undefined, sourceGameData = gameData) {
  state.v89 = true;
  state.v813 = layout === "v813";
  state.adapter = true;
  return PromptBuilder.buildMessagesWithTokenCount(
    history,
    responder,
    sourceGameData,
    "V936_ROLLING_SUMMARY",
    memoryContext,
    providerConfigs[layout],
    options
  );
}

function countMarker(result, marker) {
  return result.messages.reduce((count, message) => count + (String(message.content || "").split(marker).length - 1), 0);
}

function blockIndex(result, id) {
  return result.blocks.findIndex(entry => entry.block.id === id);
}

function assertFixedBaseline(layout) {
  const result = build(layout);
  for (const marker of ["V936_OFFICIAL_FIXED", "V936_RECENT1_FIXED", "V936_PLAYER_LEDGER_FIXED"]) {
    assert.equal(countMarker(result, marker), 1, `${layout} must inject ${marker} exactly once`);
  }
  const officialIndex = blockIndex(result, "memory-official-recollection");
  const recentIndex = blockIndex(result, "memory-direct-frozen");
  const ledgerIndex = blockIndex(result, "memory-player-ledger-frozen");
  const historyIndex = blockIndex(result, "history");
  assert(officialIndex >= 0 && recentIndex >= 0 && ledgerIndex >= 0, `${layout} must expose the three fixed memory blocks`);
  assert(officialIndex < recentIndex && recentIndex < ledgerIndex, `${layout} fixed blocks must use Official, Recent1, Ledger order`);
  assert(ledgerIndex < historyIndex, `${layout} fixed ledger must precede volatile history`);
  for (const id of ["memory-official-recollection", "memory-direct-frozen", "memory-player-ledger-frozen"]) {
    assert.equal(result.blocks.filter(entry => entry.block.id === id).length, 1,
      `${layout} must emit exactly one block for ${id}`);
  }
  assert.equal(result.blocks.find(entry => entry.block.id === "memory-direct-frozen")?.content, "V936_RECENT1_FIXED",
    `${layout} directStableText must contain Recent1 only`);
}

function assertOverlappingFixedSlotsRemainDistinct(layout) {
  const memoryContext = makeMemoryContext();
  memoryContext.officialRecollectionText = "V936_SHARED_OFFICIAL_DETAIL";
  memoryContext.officialRecollection = memoryContext.officialRecollectionText;
  memoryContext.directStableText = "V936_SHARED_OFFICIAL_DETAIL\nV936_RECENT1_UNIQUE";
  const result = build(layout, memoryContext);
  const official = result.blocks.filter(entry => entry.block.id === "memory-official-recollection");
  const recent = result.blocks.filter(entry => entry.block.id === "memory-direct-frozen");
  assert.equal(official.length, 1, `${layout} must inject the Official slot once even if a legacy alias is present`);
  assert.equal(recent.length, 1, `${layout} must inject the Recent1 slot once`);
  assert.equal(official[0].content, memoryContext.officialRecollectionText);
  assert.equal(recent[0].content, memoryContext.directStableText,
    `${layout} must preserve unique Recent1 content even when it shares text with Official recollection`);
  assert.equal(countMarker(result, "V936_RECENT1_UNIQUE"), 1);
}

function assertDryRunExcludesMemoryWithoutMutatingPrefix() {
  const memoryContext = makeMemoryContext();
  state.includeLegacyMemoryBlocks = true;
  memoryContext.cacheV2FrozenSnapshots.prefixByResponder.set("2", {
    officialRecollection: "V936_STALE_CACHED_OFFICIAL",
    directMemory: "V936_STALE_CACHED_RECENT",
    playerLedger: "V936_STALE_CACHED_LEDGER"
  });
  const cacheBefore = [...memoryContext.cacheV2FrozenSnapshots.prefixByResponder.entries()];
  const profileCacheBefore = [...memoryContext.stableProfileCache.entries()];
  const descriptionCacheBefore = [...memoryContext.stableDescriptionCache.entries()];
  const responderCacheBefore = [...memoryContext.cacheV2FrozenSnapshots.responders.entries()];
  const result = build("v813", memoryContext, { memoryMode: "exclude" });
  for (const marker of [
    "V936_OFFICIAL_FIXED", "V936_RECENT1_FIXED", "V936_PLAYER_LEDGER_FIXED",
    "V936_STABLE_MEMORY_DYNAMIC", "V936_MENTIONED_MEMORY_DYNAMIC", "V936_TEMPORAL_MEMORY_DYNAMIC",
    "V936_TOPIC_MEMORY_DYNAMIC", "V936_TURN_MEMORY_DYNAMIC", "V936_THIRD_PARTY_MEMORY_DYNAMIC",
    "V936_STALE_CACHED_OFFICIAL", "V936_STALE_CACHED_RECENT", "V936_STALE_CACHED_LEDGER",
    "V936_LEGACY_MEMORY", "V936_LEGACY_SUMMARY"
  ]) {
    assert.equal(countMarker(result, marker), 0, `dry-run must exclude ${marker}`);
  }
  for (const marker of [
    "V936_GLOBAL_RULES", "V936_PRIOR_USER", "V936_PRIOR_ASSISTANT", "V936_CURRENT_USER",
    "V936_PRESENCE_NONMEMORY", "V936_WORLD_STABLE_NONMEMORY", "V936_WORLD_TOPIC_NONMEMORY",
    "V936_WORLD_SUPPLEMENTAL_NONMEMORY", "V936_WORLD_CURRENT_NONMEMORY", "V936_WORLD_TURN_NONMEMORY",
    "V936_CONFIRMED_ACTION_NONMEMORY", "V936_CURRENT_MENTIONED_TRUTH"
  ]) {
    assert(countMarker(result, marker) > 0, `dry-run must preserve non-memory prompt content ${marker}`);
  }
  assert.deepEqual([...gameData.mentionedCharactersInContext], [],
    "dry-run profile projection must isolate current mentioned-character bookkeeping from the live game data");
  assert.deepEqual([...memoryContext.cacheV2FrozenSnapshots.prefixByResponder.entries()], cacheBefore,
    "dry-run must neither read stale responder prefix text nor mutate the frozen-prefix cache");
  assert.deepEqual([...memoryContext.stableProfileCache.entries()], profileCacheBefore, "dry-run must not mutate the stable profile cache");
  assert.deepEqual([...memoryContext.stableDescriptionCache.entries()], descriptionCacheBefore, "dry-run must not mutate the stable description cache");
  assert.deepEqual([...memoryContext.cacheV2FrozenSnapshots.responders.entries()], responderCacheBefore, "dry-run must not mutate responder snapshots");
  state.includeLegacyMemoryBlocks = false;
}

function assertDryRunPreservesLiveMentionCurrentTruth() {
  const GameData = createGameData({
    fs: require("node:fs"),
    path,
    memorySystem: {},
    memoryEngine: {},
    summariesDir: "",
    getHistoricalReferenceByYear: () => null
  });
  const currentGameData = new GameData([
    1, "玩家-A", 2, "NPC-B", "1200年1月1日", "12345678901scene", "", "", 100000
  ]);
  currentGameData.characters = new Map([
    [1, { id: 1, name: "玩家-A", shortName: "玩家-A", fullName: "玩家-A", gender: "female", age: 40, parents: [], children: [], siblings: [], traits: [] }],
    [2, { id: 2, name: "NPC-B", shortName: "NPC-B", fullName: "NPC-B", gender: "male", age: 35, parents: [], children: [], siblings: [], traits: [] }],
    [3, { id: 3, name: "NPC-C", shortName: "NPC-C", fullName: "NPC-C", gender: "male", age: 29, primaryTitle: "伯爵", parents: [], children: [], siblings: [], traits: [] }]
  ]);
  currentGameData.mentionedCharactersInContext = new Set();
  currentGameData.findMentionedCharacterIdsInHistory = () => new Set([3]);
  const memoryContext = makeMemoryContext();
  memoryContext.campaignToken = "v936-current-truth-campaign";
  currentGameData.campaignToken = memoryContext.campaignToken;
  memoryContext.disclosureProfiles = new Map([[3, [
    { campaignToken: memoryContext.campaignToken, ownerId: 2, entityId: 3, factType: "AGE", current: true, effectiveKnown: true, status: "AUTO_DISCLOSED", firstAcquiredDate: "1200年1月1日" },
    { campaignToken: memoryContext.campaignToken, ownerId: 2, entityId: 3, factType: "TITLE", value: "伯爵", current: true, effectiveKnown: true, status: "AUTO_DISCLOSED", firstAcquiredDate: "1200年1月1日" }
  ]]]);
  const result = build("v813", memoryContext, { memoryMode: "exclude" }, currentGameData);
  assert(countMarker(result, "NPC-C") > 0, "dry-run must preserve CK3 current-truth identity for a mentioned character");
  assert(countMarker(result, "年龄：29岁") > 0, "dry-run must preserve CK3 current-truth age for a mentioned character");
  assert(countMarker(result, "头衔：伯爵") > 0, "dry-run must preserve CK3 current-truth title for a mentioned character");
  assert.deepEqual([...currentGameData.mentionedCharactersInContext], [],
    "the prompt profile view must clone the current mentioned-character set before buildMentionedCharactersContext adds IDs");
}

function assertPlayerCenteredContextCannotFallBackToLegacyBlocks() {
  const memoryBlock = { id: "legacy-memories", type: "memories", enabled: true };
  const summaryBlock = { id: "legacy-past-summaries", type: "past_summaries", enabled: true };
  const enabledContext = makeMemoryContext();
  enabledContext.playerCenteredRecallEnabled = true;
  enabledContext.memoryEngine3Enabled = false;
  delete enabledContext.engineVersion;
  const enabledBaseContext = { character: responder, gameData, summary: null, memoryContext: enabledContext };
  for (const apply of [PromptBuilder.applyBlock, PromptBuilder.applyBlockWithTokenCount]) {
    for (const block of [memoryBlock, summaryBlock]) {
      const messages = [];
      apply.call(PromptBuilder, block, messages, history, enabledBaseContext, {});
      assert.equal(messages.length, 0,
        `${block.type} must fail closed for an enabled player-centered context without a valid Campaign`);
    }
  }

  const rollbackContext = makeMemoryContext();
  rollbackContext.memoryEngine3Enabled = false;
  delete rollbackContext.engineVersion;
  const rollbackBaseContext = { character: responder, gameData, summary: null, memoryContext: rollbackContext };
  for (const apply of [PromptBuilder.applyBlock, PromptBuilder.applyBlockWithTokenCount]) {
    const memoryMessages = [];
    const summaryMessages = [];
    const memoryResult = apply.call(PromptBuilder, memoryBlock, memoryMessages, history, rollbackBaseContext, {});
    const summaryResult = apply.call(PromptBuilder, summaryBlock, summaryMessages, history, rollbackBaseContext, {});
    assert(memoryMessages.length > 0 || memoryResult?.content,
      "legacy memory behavior remains available when the player-centered switch is absent");
    assert(summaryMessages.some(message => message.content.includes("V936_LEGACY_SUMMARY"))
      || summaryResult?.content?.includes("V936_LEGACY_SUMMARY"),
    "legacy summary behavior remains available when the player-centered switch is absent");
  }
}

function assertMemoryBlockCounter(layout) {
  const result = build(layout);
  assert.equal(typeof PromptBuilder.getMemoryBlockTokenCount, "function",
    "PromptBuilder must expose final rendered memory-block token counting");
  const memoryEntries = result.blocks.filter(entry => {
    const id = String(entry.block?.id || "");
    const type = String(entry.block?.type || "");
    const isCurrentMentionedTruth = id === "memory-topic-patch" || type === "memory_topic_patch";
    return !isCurrentMentionedTruth && (id.startsWith("memory-") || type.startsWith("memory_") || id === "third-party-evidence-patch" || type === "third_party_evidence");
  });
  assert(result.blocks.some(entry => entry.block.id === "memory-topic-patch"),
    `${layout} must retain live mentioned-character facts outside the memory budget blocks`);
  const expected = memoryEntries.reduce((sum, entry) => sum + Math.max(
    Number(entry.tokens) || 0,
    TokenCounter.estimateMessageTokens({ role: "system", content: String(entry.content || "") })
  ) + 8, 0);
  assert.equal(PromptBuilder.getMemoryBlockTokenCount(result), expected,
    `${layout} helper must count final formatted fixed and dynamic memory blocks`);
}

function assertFrozenPrefixScopeInvalidation() {
  const memoryContext = makeMemoryContext();
  const cache = memoryContext.cacheV2FrozenSnapshots.prefixByResponder;
  build("v813", memoryContext);
  let cachedPrefix = cache.get("2");
  assert(cachedPrefix?.scopeSignature, "V813 frozen memory prefixes must carry source/player/session scope identity");
  const revisions = [
    ["playerAnchorId", 3],
    ["sourceFolderRevision", 8],
    ["sourceCampaignToken", "v936-other-campaign"],
    ["sourcePairIds", [2]],
    ["budgetPolicyRevision", "v9.3.7-fixture"],
    ["conversationId", "v936-other-conversation"],
    ["baselineSnapshotId", "v936-other-baseline"]
  ];
  for (const [key, value] of revisions) {
    memoryContext[key] = value;
    memoryContext.officialRecollectionText = `V936_REVISED_${key}`;
    const result = build("v813", memoryContext);
    assert.equal(countMarker(result, `V936_REVISED_${key}`), 1, `scope change ${key} must use the current official recollection`);
    const refreshedPrefix = cache.get("2");
    assert(refreshedPrefix?.scopeSignature, `scope change ${key} must retain an identified prefix`);
    assert.notEqual(refreshedPrefix.scopeSignature, cachedPrefix.scopeSignature, `scope change ${key} must invalidate the cached prefix`);
    cachedPrefix = refreshedPrefix;
  }
  delete memoryContext.sourceCampaignToken;
  cache.set("2", { officialRecollection: "V936_UNSCOPED_STALE_PREFIX" });
  const unscopedResult = build("v813", memoryContext);
  assert.equal(countMarker(unscopedResult, "V936_UNSCOPED_STALE_PREFIX"), 0, "missing source identity must never reuse a stale prefix");
  assert.equal(countMarker(unscopedResult, "V936_REVISED_baselineSnapshotId"), 1, "unscoped requests must use current memory text directly");
  assert.equal(cache.has("2"), false, "an unscoped request must invalidate the responder's reusable prefix");
}

for (const layout of ["normal", "glm", "v813"]) {
  assertFixedBaseline(layout);
  assertOverlappingFixedSlotsRemainDistinct(layout);
  assertMemoryBlockCounter(layout);
}
assertDryRunExcludesMemoryWithoutMutatingPrefix();
assertDryRunPreservesLiveMentionCurrentTruth();
assertPlayerCenteredContextCannotFallBackToLegacyBlocks();
assertFrozenPrefixScopeInvalidation();

function assertMemoryBudgetPolicy() {
  assert.equal(PLAYER_CENTERED_RECALL_ENABLED, true, "the single player-centered recall switch defaults on");
  assert.equal(DEFAULT_MEMORY_BUDGET_POLICY_REVISION, "v9.3.6");
  assert.deepEqual(Object.values(MEMORY_BUDGET_POLICIES["v9.3.5"].tiers).map(({ ratio, capTokens }) => [ratio, capTokens]), [
    [0.10, 3600], [0.125, 4500], [0.15, 5400]
  ]);
  assert.deepEqual(Object.values(MEMORY_BUDGET_POLICIES["v9.3.6"].tiers).map(({ ratio, capTokens }) => [ratio, capTokens]), [
    [0.16, 4800], [0.18, 5600], [0.20, 6400]
  ]);
  for (const entry of [
    { participants: 2, window: 50000, ratio: 0.16, cap: 4800 },
    { participants: 3, window: 50000, ratio: 0.18, cap: 5600 },
    { participants: 5, window: 50000, ratio: 0.20, cap: 6400 }
  ]) {
    const result = resolveMemoryBudget({ participantCount: entry.participants, contextWindowTokens: entry.window, providerHeadroomTokens: 10000 });
    assert.equal(result.ratio, entry.ratio);
    assert.equal(result.policyCapTokens, entry.cap);
    assert.equal(result.memoryBudgetTokens, entry.cap);
    assert.equal(result.providerHeadroomTokens, 10000);
    const proportional = resolveMemoryBudget({
      participantCount: entry.participants, contextWindowTokens: 10000, providerHeadroomTokens: 10000
    });
    assert.equal(proportional.memoryBudgetTokens, Math.floor(10000 * entry.ratio));
  }
  const oldRollback = resolveMemoryBudget({
    participantCount: 3, contextWindowTokens: 40000, providerHeadroomTokens: 10000, policyRevision: "v9.3.5"
  });
  assert.equal(oldRollback.policyRevision, "v9.3.5");
  assert.equal(oldRollback.ratio, 0.125);
  assert.equal(oldRollback.memoryBudgetTokens, 4500);
  assert.equal(resolveMemoryBudget({
    participantCount: 3, contextWindowTokens: 8000, providerHeadroomTokens: 10000, policyRevision: "v9.3.5"
  }).memoryBudgetTokens, 1000);
  const providerLimited = resolveMemoryBudget({ participantCount: 2, contextWindowTokens: 50000, providerHeadroomTokens: 777 });
  assert.equal(providerLimited.memoryBudgetTokens, 777, "already-margined provider headroom is not reduced twice");
  assert.equal(providerLimited.providerHeadroomTokens, 777);
  for (const invalid of [
    { participantCount: 1, contextWindowTokens: 50000, providerHeadroomTokens: 5000 },
    { participantCount: 2, contextWindowTokens: 0, providerHeadroomTokens: 5000 },
    { participantCount: 2, contextWindowTokens: 50000 },
    { participantCount: 2, contextWindowTokens: 50000, providerHeadroomTokens: -1 },
    { participantCount: 2, contextWindowTokens: 50000, providerHeadroomTokens: 5000, policyRevision: "missing" }
  ]) assert.equal(resolveMemoryBudget(invalid).memoryBudgetTokens, 0, "invalid/incomplete policy input must fail closed");
}

assertMemoryBudgetPolicy();
console.log("V9.3.6 PromptBuilder and memory budget policy: PASS");
