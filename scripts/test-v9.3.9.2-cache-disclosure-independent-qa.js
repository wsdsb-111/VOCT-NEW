"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const path = require("node:path");
const { Conversation } = require("../src/app/main/conversation/conversation");
const { buildCharacterDisclosureContext } = require("../src/app/main/conversation/character-disclosure-context");
const { createPromptBuilder } = require("../src/app/main/prompts/prompt-builder");
const { TokenCounter } = require("../src/app/main/provider-service");

const CAMPAIGN = "v9392-cache-disclosure-fixture";
const DATE = "1200.1.1";
const fingerprint = value => crypto.createHash("sha256").update(String(value ?? ""), "utf8").digest("hex");
const layoutState = { v813: true };
const providerConfigs = {
  v813: { providerType: "openai-compatible", defaultModel: "v9392-v813-fixture" },
  glm: { providerType: "zhipu", defaultModel: "glm-5.3-flash" }
};

class TemplateEngine {
  renderTemplateString(template, context = {}) {
    const target = context.gameData?.characters?.get(1);
    const traitNames = (target?.traits || []).map(trait => trait.name || trait.traitId).join("、") || "无获知特质";
    return String(template).replace("{{targetTraits}}", traitNames)
      .replace("{{date}}", context.gameData?.date || "");
  }
}

const mainTemplate = `{{! VOTC_SEGMENT:stable_global }}V9392_GLOBAL_RULES
{{! VOTC_SEGMENT:stable_history_rp }}V9392_HISTORY_RULES
{{! VOTC_SEGMENT:world_context }}V9392_DATE={{date}}
{{! VOTC_SEGMENT:character_base }}V9392_TARGET_TRAITS={{targetTraits}}
{{! VOTC_SEGMENT:character_state }}V9392_SCENE_STATE`;
const promptSettings = {
  mainTemplate,
  blocks: [
    { id: "main", type: "main", enabled: true, role: "system" },
    { id: "history", type: "history", enabled: true },
    { id: "instruction", type: "instruction", enabled: true, role: "user", template: "V9392_FINAL_INSTRUCTION" }
  ],
  suffix: { enabled: false, template: "" }
};
const settingsRepository = {
  getPromptSettings: () => promptSettings,
  getChatPromptV89Settings: () => ({ chatPromptV89Layout: true, chatPromptV89RuntimeProfileSplit: true,
    chatPromptV810ProviderAdapter: true }),
  getChatPromptV813Layout: () => layoutState.v813,
  getActiveProviderConfig: () => layoutState.v813 ? providerConfigs.v813 : providerConfigs.glm,
  getGlobalStreamSetting: () => false
};
const PromptBuilder = createPromptBuilder({
  TemplateEngine,
  PromptScriptLoader: class {},
  promptConfigManager: { getDefaultMainTemplateContent: () => mainTemplate, resolvePath: value => value },
  settingsRepository,
  path,
  TokenCounter,
  createPromptFingerprint: fingerprint,
  defaultChatInstruction: "V9392_FINAL_INSTRUCTION"
});
Conversation.configure({ createPromptFingerprint: fingerprint });

const player = { id: 1, shortName: "玩家", fullName: "玩家真名", traits: [{ traitId: "witch", name: "巫师" }],
  parents: [], children: [], siblings: [], spouses: [], knownSecrets: [] };
const responder = { id: 2, shortName: "回应者", fullName: "回应者", traits: [], parents: [], children: [], siblings: [],
  spouses: [], knownSecrets: [], primaryTitle: "无", titleRankConcept: "concept_none", heldCourtAndCouncilPositions: "无" };
const gameData = {
  date: DATE,
  totalDays: 100,
  year: 1200,
  campaignToken: CAMPAIGN,
  playerID: 1,
  playerName: "玩家",
  scene: "V9392_SCENE",
  location: "V9392_LOCATION",
  characters: new Map([[1, player], [2, responder]]),
  mentionedCharactersInContext: new Set(),
  getActiveParticipantRelationshipInfo: () => "",
  getMentionExclusionIds: () => new Set(),
  findMentionedCharacterIdsInHistory: () => new Set(),
  getMentionedCharactersInfo: () => "",
  getMentionableCharacterProfiles() { return this.characters; }
};
const history = [
  { role: "user", content: "V9392_PRIOR_USER" },
  { role: "assistant", content: "V9392_PRIOR_ASSISTANT" },
  { role: "user", content: "V9392_CURRENT_USER" }
];

let disclosureStatus = "UNKNOWN";
let disclosureRevision = 0;
const disclosureService = {
  getDisclosureProfile({ ownerRuntimeId, targetRuntimeId }) {
    if (Number(ownerRuntimeId) !== 2 || Number(targetRuntimeId) !== 1) return { status: "BLOCKED", facts: [] };
    const facts = disclosureStatus === "UNKNOWN" ? [] : [{ factType: "TRAIT", factKey: "trait_witch", value: "巫师",
      status: disclosureStatus, effectiveKnown: disclosureStatus === "MANUAL_KNOWN" || disclosureStatus === "AUTO_DISCLOSED",
      current: true, currentDirectObservation: false, revision: disclosureRevision, sourceSnapshotId: "checkpoint-one" }];
    return { status: "READY", scope: { campaignToken: CAMPAIGN, ownerRuntimeId: 2, targetRuntimeId: 1,
      sourceSnapshotId: "checkpoint-one" }, checkpointAsOf: DATE, facts };
  }
};

const frozenCache = { conversation: null, responders: new Map(), prefixByResponder: new Map() };
const sharedMemoryFields = {
  activeParticipantIds: [1, 2],
  playerAnchorId: 1,
  baselineSnapshotId: "v9392-baseline",
  sourceFolderRevision: 3,
  sourceCampaignToken: CAMPAIGN,
  sourcePairIds: [1],
  budgetPolicyRevision: "v9.3.9.2-fixture",
  conversationId: "v9392-conversation",
  officialRecollectionText: "V9392_OFFICIAL_RECOLLECTION",
  directStableText: "V9392_RECENT2_COMPLETE",
  playerLedgerFrozenText: "V9392_PLAYER_LEDGER_COMPLETE",
  stableText: "V9392_STABLE_MEMORY",
  frozenDynamicText: "V9392_DYNAMIC_FROZEN_V1",
  mentionedSnapshotText: "V9392_MENTIONED_SNAPSHOT",
  worldStableText: "V9392_WORLD_STABLE",
  freezePromptPrefix: true,
  stableProfileCache: new Map(),
  stableDescriptionCache: new Map(),
  cacheV2FrozenSnapshots: frozenCache
};

function makeMemoryContext({ sourceFolderRevision = 3, frozenDynamicText = "V9392_DYNAMIC_FROZEN_V1" } = {}) {
  const disclosure = buildCharacterDisclosureContext({ service: disclosureService, gameData, responderId: 2, targetIds: [1] });
  return { ...sharedMemoryFields, sourceFolderRevision, frozenDynamicText, ...disclosure };
}

function buildPrompt(memoryContext = makeMemoryContext(), layout = "v813") {
  layoutState.v813 = layout === "v813";
  return PromptBuilder.buildMessagesWithTokenCount(history, responder, gameData, "V9392_ROLLING_SUMMARY", memoryContext,
    providerConfigs[layout]);
}

function outboundPrefix(result) {
  const metadata = Conversation.buildPromptBlockMetadata(result);
  const messages = result.messages.slice(0, metadata.stablePrefixEndPosition);
  return { metadata, messages, sha256: fingerprint(JSON.stringify(messages)) };
}

function assertDisclosureChangesOnlyTheDynamicTail(layout) {
  disclosureStatus = "UNKNOWN";
  disclosureRevision = 0;
  const unknownPrompt = buildPrompt(makeMemoryContext(), layout);
  const unknownPrefix = outboundPrefix(unknownPrompt);
  if (layout === "glm") assert.equal(unknownPrompt.promptProfile.id, "glm_cache_v2",
    "the GLM 5.3 Flash fixture exercises its actual adapted prompt layout");
  assert(!unknownPrompt.messages.some(message => message.content.includes("V9392_TARGET_TRAITS=巫师")),
    "an undisclosed trait must not enter the outbound Prompt");
  const recent2Before = unknownPrompt.blocks.find(entry => entry.block.id === "memory-direct-frozen")?.content;
  assert.equal(recent2Before, "V9392_RECENT2_COMPLETE", "the full Recent2 fixture enters the outbound frozen block");

  disclosureStatus = "MANUAL_KNOWN";
  disclosureRevision++;
  const knownPrompt = buildPrompt(makeMemoryContext(), layout);
  const knownPrefix = outboundPrefix(knownPrompt);
  assert(knownPrompt.messages.some(message => message.content.includes("V9392_TARGET_TRAITS=巫师")),
    "a newly authorized fact must be rendered in the next actual outbound Prompt");
  assert.equal(knownPrompt.blocks.find(entry => entry.block.id === "memory-direct-frozen")?.content, recent2Before,
    "a character-knowledge update cannot alter the unrelated Recent2 source bytes");
  assert.equal(knownPrefix.sha256, unknownPrefix.sha256,
    "the serialized outbound stable prefix, including Recent2, stays byte-identical across a dynamic disclosure update");
  assert.equal(knownPrefix.metadata.prefixFingerprint, unknownPrefix.metadata.prefixFingerprint,
    "the actual stable prefix fingerprint stays unchanged when only the disclosure tail changes");

  disclosureStatus = "MANUAL_HIDDEN";
  disclosureRevision++;
  const hiddenPrompt = buildPrompt(makeMemoryContext(), layout);
  const hiddenPrefix = outboundPrefix(hiddenPrompt);
  assert(!hiddenPrompt.messages.some(message => message.content.includes("V9392_TARGET_TRAITS=巫师")),
    "a manual hide must remove the fact from the next actual outbound Prompt");
  assert.equal(hiddenPrompt.blocks.find(entry => entry.block.id === "memory-direct-frozen")?.content, recent2Before,
    "manual hiding cannot delete or rewrite Recent2");
  assert.equal(hiddenPrefix.sha256, unknownPrefix.sha256,
    "manual hide changes the disclosure tail while preserving the serialized stable prefix");

  const changedDynamicPrompt = buildPrompt(makeMemoryContext({ frozenDynamicText: "V9392_DYNAMIC_FROZEN_V2" }), layout);
  assert(changedDynamicPrompt.messages.some(message => message.content === "V9392_DYNAMIC_FROZEN_V2"),
    "the next admitted dynamic freeze snapshot is present in actual outbound messages");
  assert(!changedDynamicPrompt.messages.some(message => message.content === "V9392_DYNAMIC_FROZEN_V1"),
    "an updated dynamic freeze snapshot cannot reuse stale outbound bytes");
}

function createGuardRun({ mutateKnowledge = false, sourceChanged = false } = {}) {
  layoutState.v813 = true;
  disclosureStatus = "MANUAL_KNOWN";
  disclosureRevision = 10;
  const memoryContext = { ...makeMemoryContext(), sourceFolderRevision: 3 };
  const stats = { providerEntries: 0, transports: 0, errorDetails: [] };
  const responseState = { controller: new AbortController(), stale: false, turnEpoch: 1, responseId: "v9392-response", npcId: 2 };
  const generationManager = {
    start: () => responseState,
    isCurrent: () => true,
    fail() {},
    finish() {},
    markPhase() {},
    recordSkipped() {}
  };
  const memoryEngine = {
    store: {
      getFolderSummaryRevision: () => sourceChanged ? 4 : 3,
      hasPairLedgerSourceContentChanges: () => false,
      folderSummaryCache: new Map([[2, []]])
    },
    trace: { record() {} }
  };
  const llmManager = {
    async sendChatRequest(_messages, _signal, _noStream, metadata) {
      stats.providerEntries++;
      if (mutateKnowledge) {
        disclosureStatus = "MANUAL_HIDDEN";
        disclosureRevision++;
      }
      metadata.beforeSendGuard();
      stats.transports++;
      return { content: "V9392_SHOULD_NOT_BE_SENT", finish_reason: "stop" };
    }
  };
  Conversation.configure({
    settingsRepository,
    llmManager,
    PromptBuilder,
    TokenCounter,
    memoryEngine,
    applicationServices: { characterKnowledge: disclosureService },
    createPromptFingerprint: fingerprint,
    createMessage: message => ({ type: "message", ...message }),
    createError: error => ({ type: "error", ...error }),
    logVerboseLLM() {},
    usageAnalytics: { record() {} }
  });
  const chat = Object.create(Conversation.prototype);
  Object.assign(chat, {
    id: "v9392-conversation",
    turnEpoch: 1,
    nextId: 0,
    messages: [],
    selectedCharacterIds: new Set([1]),
    generationAttemptsByMessageId: new Map(),
    generationManager,
    turnManager: { currentTurn: null },
    checkAndSummarizeIfNeeded: async () => memoryContext,
    getPromptHistoryForCharacter: () => history,
    getPromptSummaryForCharacter: () => "V9392_ROLLING_SUMMARY",
    estimateTokenCount: messages => TokenCounter.calculateTotalTokens(messages),
    isCharacterAvailableForConversation: () => true,
    isResponseCurrent: () => true,
    resetContextUsageScene() {},
    emitUpdate() {},
    evaluateCompletedActions: async () => {},
    retainDynamicSummaryRecall() {},
    recordGenerationSkipped() {},
    memoryState: { rollingState: { segments: [], cacheEpoch: 0 } },
    cacheV2FrozenSnapshots: frozenCache,
    contextUsageByResponder: new Map(),
    memoryAttemptDiagnosticsByOwner: new Map(),
    gameData,
    npcQueue: [],
    inactiveParticipantIds: new Map()
  });
  return { chat, stats, memoryContext };
}

async function assertBeforeSendGuardsRemainActive() {
  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    frozenCache.prefixByResponder.set("2", { scopeSignature: "fixture", directMemory: "V9392_RECENT2_COMPLETE" });
    const knowledgeRun = createGuardRun({ mutateKnowledge: true });
    await knowledgeRun.chat.respondAs(responder);
    assert.equal(knowledgeRun.stats.providerEntries, 1, "the knowledge mutation reaches the provider wrapper for pre-send validation");
    assert.equal(knowledgeRun.stats.transports, 0, "a fact revoked after Prompt assembly is stopped before transport");
    assert.equal(knowledgeRun.chat.messages.at(-1)?.details, "Character knowledge source changed before send",
      "the targeted knowledge revalidation rejects its stale snapshot");
    assert.equal(frozenCache.prefixByResponder.size, 0, "a stale knowledge snapshot clears the responder prefix cache");

    frozenCache.prefixByResponder.set("2", { scopeSignature: "fixture", directMemory: "V9392_RECENT2_COMPLETE" });
    const sourceRun = createGuardRun({ sourceChanged: true });
    await sourceRun.chat.respondAs(responder);
    assert.equal(sourceRun.stats.transports, 0, "a Legacy source or Forget revision change is stopped before transport");
    assert.equal(sourceRun.chat.messages.at(-1)?.details, "Legacy memory source changed before send",
      "the independent source/Forget guard still rejects its stale snapshot");
  } finally {
    console.error = originalConsoleError;
  }
}

async function main() {
  assertDisclosureChangesOnlyTheDynamicTail("v813");
  assertDisclosureChangesOnlyTheDynamicTail("glm");
  await assertBeforeSendGuardsRemainActive();
  console.log("V9.3.9.2 cache disclosure independent QA: PASS (outbound prompt bytes, stable prefix hash, Recent2, dynamic freeze and before-send guards)");
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
