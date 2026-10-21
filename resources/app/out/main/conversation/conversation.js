"use strict";

const { getCharacterPersonalName } = require("../memory-system/character-identity");
const { buildCharacterDisclosureContext } = require("./character-disclosure-context");
const { memoryMatchesCampaign } = require("../memory-system/memory-types");
const { MentionTracker } = require("../memory-system/mention-tracker");
const { createConversationRuntime } = require("./conversation-runtime");
const participantLifecycle = require("./participant-lifecycle");
const { buildPresenceObservationFacts } = require("../worldline/direct-observation-producer");
const { resolveWorldlineTurnBudget, shouldTrimMemoryTurnRecall } = require("../worldline/worldline-context-budget");
const { parseTimeHint } = require("../worldline/world-query-planner");
const { buildFrozenCoverageManifest, hasFrozenCoverage, buildCoveragePatchKey } = require("../worldline/frozen-coverage-manifest");
const { verifyActionConfirmation, settleActionResult } = require("../actions/action-confirmation");
const { readActionCommandReadback } = require("../actions/action-command-readback");
const { validateGenerationOutcome } = require("../providers/generation-outcome");
const { planRequestBudget } = require("../providers/request-budget");
const { preflightPromptPlan, extendContinuationProof } = require("../prompts/prompt-plan-compat");
const { fingerprint: planFingerprint } = require("../prompts/prompt-plan-contract");
const { PLAYER_CENTERED_RECALL_ENABLED, DEFAULT_MEMORY_BUDGET_POLICY_REVISION,
  resolveMemoryBudget } = require("../memory-system/memory-budget-policy");

let ActionEngine = null;
let settingsRepository = null;
let usageAnalytics = null;
let llmManager = null;
let runFileManager = null;
let parseLog = null;
let createError = null;
let createMessage = null;
let createActionApproval = null;
let createActionFeedback = null;
let createPromptFingerprint = null;
let PromptBuilder = null;
let TokenCounter = null;
let logVerboseLLM = null;
let events = null;
let uuid = null;
let path = null;
let memoryEngine = null;
let worldlineService = null;
let applicationServices = null;
let performanceTrace = null;

function startTraceSpan(trace, step, fields) {
  try {
    return trace?.enabled ? trace.startSpan(step, fields) : null;
  } catch (_error) {
    return null;
  }
}

function finishTraceSpan(finish, fields) {
  try {
    finish?.(fields);
  } catch (_error) {}
}

function traceOperation(trace, step, fields, operation) {
  if (!trace?.enabled) return operation();
  const finish = startTraceSpan(trace, step, fields);
  let result;
  try {
    result = operation();
  } catch (error) {
    finishTraceSpan(finish, { result: "ERROR", errorCode: "initialization_error" });
    throw error;
  }
  if (result && typeof result.then === "function") {
    return result.then((value) => {
      finishTraceSpan(finish, { result: "OK" });
      return value;
    }, (error) => {
      finishTraceSpan(finish, { result: error instanceof Error && error.message === "AbortError: Message cancelled" ? "CANCELLED" : "ERROR", errorCode: "initialization_error" });
      throw error;
    });
  }
  finishTraceSpan(finish, { result: "OK" });
  return result;
}

function tokenCountOrNull(value) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function formatMemoryContextOverflow(details = {}) {
  details = details && typeof details === "object" ? details : {};
  const count = value => tokenCountOrNull(value)?.toLocaleString("zh-CN") || "未知";
  const breakdown = details.breakdown && typeof details.breakdown === "object" ? details.breakdown : {};
  const labels = [
    ["最近记忆", "recent"], ["官方追忆", "official"], ["玩家关系事项簿", "ledger"],
    ["稳定记忆", "stable"], ["时间记忆", "temporal"], ["第三人记忆", "thirdPerson"]
  ];
  return `当前上下文预算无法容纳所选记忆，本次回复未发送给服务商。需要 ${count(details.requiredTokens)} Token，可用 ${count(details.availableTokens)} Token。分项：${labels.map(([label, key]) => `${label} ${count(breakdown[key])}`).join("、")} Token。`;
}

const TEMPORARY_ABSENCE_MODES = Object.freeze({
  unconscious: {
    statusLabel: "昏迷中",
    returnLabel: "唤醒",
    leaveText: (name) => `【${name}突然昏迷，暂时无法感知或参与接下来的对话】`,
    returnText: (name) => `【${name}恢复意识。${name}清楚自己刚才曾经昏迷，但对昏迷期间发生的对话和事件没有记忆，也不得据此作出反应。】`
  },
  asleep: {
    statusLabel: "睡着了",
    returnLabel: "叫醒",
    leaveText: (name) => `【${name}睡着了，暂时无法感知或参与接下来的对话】`,
    returnText: (name) => `【${name}醒来。${name}知道自己刚才睡着了，但没有听见睡着期间的对话，也不知道期间发生的事件。】`
  },
  away: {
    statusLabel: "暂时离开",
    returnLabel: "请回来",
    leaveText: (name) => `【${name}暂时离开现场，无法感知或参与接下来的对话】`,
    returnText: (name) => `【${name}回到现场。${name}知道自己刚才暂时离开过，但不知道离开期间发生的对话和事件。】`
  }
});

class Conversation {
  static configure(dependencies = {}) {
    applicationServices = dependencies.applicationServices || null;
    ActionEngine = dependencies.ActionEngine || ActionEngine;
    settingsRepository = dependencies.settingsRepository || settingsRepository;
    usageAnalytics = dependencies.usageAnalytics || usageAnalytics;
    llmManager = dependencies.llmManager || llmManager;
    runFileManager = dependencies.runFileManager || runFileManager;
    parseLog = dependencies.parseLog || parseLog;
    createError = dependencies.createError || createError;
    createMessage = dependencies.createMessage || createMessage;
    createActionApproval = dependencies.createActionApproval || createActionApproval;
    createActionFeedback = dependencies.createActionFeedback || createActionFeedback;
    createPromptFingerprint = dependencies.createPromptFingerprint || createPromptFingerprint;
    PromptBuilder = dependencies.PromptBuilder || PromptBuilder;
    TokenCounter = dependencies.TokenCounter || TokenCounter;
    logVerboseLLM = dependencies.logVerboseLLM || logVerboseLLM;
    events = dependencies.events || events;
    uuid = dependencies.uuid || uuid;
    path = dependencies.path || path;
    memoryEngine = dependencies.memoryEngine || memoryEngine;
    worldlineService = dependencies.worldlineService || worldlineService;
    performanceTrace = dependencies.performanceTrace || performanceTrace;
    return this;
  }
  static buildPromptBlockMetadata(promptBuild = {}) {
    const hasExplicitStability = (promptBuild.blocks || []).some(({ block }) => block?.stable !== undefined);
    const messages = Array.isArray(promptBuild.messages) ? promptBuild.messages : [];
    let messageCursor = 0;
    const blocks = (promptBuild.blocks || []).map(({ block, content, tokens, messageSpan }, index) => {
      let messageStartPosition = null;
      let messageCount = 0;
      const blockContent = typeof content === "string" ? content : "";
      if (messageSpan) {
        messageStartPosition = messageSpan.start;
        messageCount = messageSpan.end - messageSpan.start;
        messageCursor = messageSpan.end;
      } else for (let end = messageCursor + 1; blockContent && end <= messages.length; end += 1) {
        const candidate = messages.slice(messageCursor, end);
        const directContent = candidate.length === 1 ? candidate[0]?.content : null;
        const roleContent = candidate.map((message) => `${message.role}: ${message.content}`).join("\n\n");
        if (directContent === blockContent || roleContent === blockContent) {
          messageStartPosition = messageCursor;
          messageCount = candidate.length;
          messageCursor = end;
          break;
        }
      }
      return {
        id: block.id,
        label: block.label,
        type: block.type,
        position: index,
        messageStartPosition,
        messageCount,
        tokens,
        fingerprint: createPromptFingerprint(content),
        stable: hasExplicitStability ? block.stable === true : null,
        lifecycle: block.lifecycle || null
      };
    });
    const firstHistoryIndex = blocks.findIndex((block) => block.type === "history" || block.type === "presence_roster" || block.type === "current_user");
    const historyStartPosition = firstHistoryIndex >= 0 ? firstHistoryIndex : blocks.length;
    const firstDynamicIndex = hasExplicitStability ? blocks.findIndex((block) => block.stable === false) : -1;
    const stablePrefixEndPosition = firstDynamicIndex >= 0 ? firstDynamicIndex : historyStartPosition;
    const stablePrefixTokens = blocks.slice(0, stablePrefixEndPosition).reduce((total, block) => total + (Number(block.tokens) || 0), 0);
    const dynamicSuffixTokens = blocks.slice(stablePrefixEndPosition).reduce((total, block) => total + (Number(block.tokens) || 0), 0);
    const prefixFingerprint = createPromptFingerprint(JSON.stringify(blocks.slice(0, stablePrefixEndPosition).map((block) => [block.id, block.type, block.fingerprint, block.stable, block.lifecycle])));
    return { blocks, historyStartPosition, stablePrefixEndPosition, stablePrefixTokens, dynamicSuffixTokens, prefixFingerprint };
  }
  constructor({ conversationEpoch = null } = {}) {
    this.id = uuid.v4();
    this.conversationEpoch = conversationEpoch != null && Number.isInteger(Number(conversationEpoch)) ? Number(conversationEpoch) : null;
    this.messages = [];
    this.isActive = false;
    this.nextId = 0;
    this.currentSummary = "";
    this.lastSummarizedMessageIndex = 0;
    this.memoryState = memoryEngine?.createConversationState(this.id) || null;
    this.CONTEXT_LIMIT_PERCENTAGE = 0.75;
    this.MESSAGES_TO_SUMMARIZE_PERCENTAGE = 0.4;
    this.customQueue = null;
    this.isPaused = false;
    this.persistCustomQueue = false;
    this.inactiveParticipantIds = /* @__PURE__ */ new Map();
    this.summaryParticipantProfiles = /* @__PURE__ */ new Map();
    this.stableProfileCache = /* @__PURE__ */ new Map();
    this.stableDescriptionCache = /* @__PURE__ */ new Map();
    this.cacheV2FrozenSnapshots = { conversation: null, responders: /* @__PURE__ */ new Map() };
    this.cacheV2FrozenSnapshots.prefixByResponder = /* @__PURE__ */ new Map();
    this.frozenWorldlineByResponder = /* @__PURE__ */ new Map();
    this.frozenWorldlineCoverageByResponder = /* @__PURE__ */ new Map();
    this.worldlineCoveragePatchCacheByResponder = /* @__PURE__ */ new Map();
    this.selectedCharacterIds = /* @__PURE__ */ new Set();
    this.presentCharacterIds = /* @__PURE__ */ new Set();
    this.waitingCharacterIds = /* @__PURE__ */ new Set();
    this.temporarilyAbsentCharacterIds = /* @__PURE__ */ new Map();
    this.departedCharacterIds = /* @__PURE__ */ new Set();
    this.joinEvents = [];
    this.leaveEvents = [];
    this.presenceInitialized = false;
    this.pendingActionApprovals = /* @__PURE__ */ new Map();
    this.generationAttemptsByMessageId = /* @__PURE__ */ new Map();
    this.memoryAttemptDiagnosticsByOwner = /* @__PURE__ */ new Map();
    this.contextUsageByResponder = /* @__PURE__ */ new Map();
    this.contextUsageSceneByResponder = /* @__PURE__ */ new Map();
    this.contextUsageSceneCapacityTokens = null;
    this.contextUsageSceneCapacitySource = null;
    this.contextUsageRevision = 0;
    this.contextUsageSceneRevision = null;
    this.contextCompactionTurnKey = null;
    this.gameDataRevision = 0;
    this.eventEmitter = new events.EventEmitter();
    this.runtime = createConversationRuntime(this, {
      recordSkipped: (responseState, reason) => this.recordGenerationSkippedAnalytics(responseState, reason)
    });
    this.performanceTraceContext = performanceTrace?.enabled ? performanceTrace.forConversation(this.id) : null;
    this.turnManager = this.runtime.turnManager;
    this.generationManager = this.runtime.generationManager;
    this.referenceContext = this.runtime.referenceContext;
    this.gameDataReady = this.initializeGameData();
  }
  getContextUsageSnapshot(phase = "snapshot") {
    return {
      conversationId: this.id,
      conversationEpoch: this.conversationEpoch,
      turnEpoch: this.turnEpoch || 0,
      sceneRevision: this.contextUsageSceneRevision,
      sceneCapacityTokens: this.contextUsageSceneCapacityTokens,
      sceneCapacitySource: this.contextUsageSceneCapacitySource,
      revision: this.contextUsageRevision || 0,
      phase,
      responders: [...(this.contextUsageSceneByResponder?.values?.() || this.contextUsageByResponder?.values?.() || [])]
    };
  }
  resetContextUsageScene(turnEpoch = this.turnEpoch || 0) {
    const sceneRevision = JSON.stringify([this.gameData?.scene || null, this.gameData?.location || null,
      this.gameData?.locationController || null]);
    if (this.contextUsageSceneRevision === sceneRevision) return false;
    this.contextUsageSceneRevision = sceneRevision;
    this.contextUsageByResponder?.clear?.();
    this.contextUsageSceneByResponder?.clear?.();
    this.contextUsageSceneCapacityTokens = null;
    this.contextUsageSceneCapacitySource = null;
    this.contextUsageRevision = (this.contextUsageRevision || 0) + 1;
    this.eventEmitter?.emit?.("context-usage-updated", {
      ...this.getContextUsageSnapshot("reset"), turnEpoch
    });
    return true;
  }
  resetContextUsageTurn() {
    const sceneResponders = this.contextUsageSceneByResponder;
    for (const [responderId, row] of this.contextUsageByResponder || []) {
      if (row.phase !== "request_snapshot" && row.phase !== "streaming") continue;
      this.contextUsageRevision = (this.contextUsageRevision || 0) + 1;
      sceneResponders?.set?.(responderId, { ...row, phase: "cancelled", usageRevision: this.contextUsageRevision,
        updatedAt: new Date().toISOString() });
    }
    this.contextUsageByResponder?.clear?.();
    this.contextUsageRevision = (this.contextUsageRevision || 0) + 1;
    this.eventEmitter?.emit?.("context-usage-updated", this.getContextUsageSnapshot("reset"));
    return true;
  }
  publishContextUsage(row, responseState = null) {
    if (!row || !this.eventEmitter || !this.contextUsageByResponder) return false;
    const responderId = Number(row.responderId);
    if (!Number.isSafeInteger(responderId) || responderId <= 0
      || row.conversationId !== this.id
      || Number(row.conversationEpoch) !== Number(this.conversationEpoch)
      || Number(row.turnEpoch) !== Number(this.turnEpoch)
      || row.sceneRevision !== this.contextUsageSceneRevision) return false;
    const previous = this.contextUsageByResponder.get(responderId);
    const terminalForLatestRequest = (row.phase === "cancelled" || row.phase === "failed")
      && previous?.requestId === row.requestId;
    if (responseState && !this.isResponseCurrent(responseState) && !terminalForLatestRequest) return false;
    this.contextUsageSceneByResponder ||= new Map();
    if (this.contextUsageSceneCapacityTokens == null) {
      const configuredCapacity = tokenCountOrNull(row.configuredContextLength);
      const providerCapacity = tokenCountOrNull(row.contextWindowTokens);
      this.contextUsageSceneCapacityTokens = configuredCapacity ?? providerCapacity;
      this.contextUsageSceneCapacitySource = configuredCapacity != null
        ? "configured" : row.contextWindowSource || "provider_window";
    }
    this.contextUsageRevision = (this.contextUsageRevision || 0) + 1;
    const publishedRow = { ...row, responderId, usageRevision: this.contextUsageRevision };
    this.contextUsageByResponder.set(responderId, publishedRow);
    this.contextUsageSceneByResponder.set(responderId, publishedRow);
    this.eventEmitter.emit("context-usage-updated", this.getContextUsageSnapshot("update"));
    return true;
  }
  onContextUsageUpdate(callback) {
    this.eventEmitter?.on?.("context-usage-updated", callback);
  }
  offContextUsageUpdate(callback) {
    this.eventEmitter?.off?.("context-usage-updated", callback);
  }
  getTurnManager() {
    const manager = this.runtime?.turnManager || this.turnManager;
    if (!manager) throw new Error("conversation_turn_manager_not_initialized");
    return manager;
  }
  getGenerationManager() {
    const manager = this.runtime?.generationManager || this.generationManager;
    if (!manager) throw new Error("conversation_generation_manager_not_initialized");
    return manager;
  }
  async parseCK3GameData(ck3DebugPath) {
    return parseLog(ck3DebugPath);
  }
  async initializeGameData() {
    const conversationOpenSpan = startTraceSpan(performanceTrace, "conversation.open", { attribution: "MAIN" });
    const ck3DebugPath = settingsRepository.getCK3DebugLogPath();
    console.log(`Conversation.initializeGameData: CK3 debug log path: ${ck3DebugPath}`);
    if (!runFileManager.isAvailable()) {
      console.warn("Conversation.initializeGameData: RunFileManager not available - CK3 path not configured");
    }
    if (!ck3DebugPath) {
      finishTraceSpan(conversationOpenSpan, { result: "ERROR", errorCode: "initialization_error" });
      console.error("Conversation.initializeGameData: CK3 debug log path is not configured");
      this.isActive = false;
      const initError = createError({
        id: this.nextId++,
        content: "CK3 debug log path is not configured",
        details: "Please configure the CK3 user folder path in settings"
      });
      this.messages.push(initError);
      this.emitUpdate();
      return;
    }
    try {
      this.gameData = await traceOperation(performanceTrace, "gameData.logParse", { attribution: "MAIN" }, () => this.parseCK3GameData(ck3DebugPath));
      this.gameDataRevision += 1;
      this.gameData.gameDataRevision = this.gameDataRevision;
      console.log("GameData initialized with", this.gameData.characters.size, "characters");
      this.captureSummaryParticipantProfiles(this.gameData.characters.values());
      this.initializePresence();
      traceOperation(performanceTrace, "summary.load", { attribution: "MAIN", count: this.gameData.characters.size }, () => this.gameData.loadCharactersSummaries());
      traceOperation(performanceTrace, "officialRecollection.sync", { attribution: "MAIN" }, () => this.gameData.syncOfficialRecollectionSummaries?.(this.id));
      this.worldlinePrefetchPromise = traceOperation(performanceTrace, "worldline.frozenPrefetch", { attribution: "MAIN" }, () => this.prefetchFrozenWorldline()).catch((error) => {
        console.warn("[Worldline] Conversation-opening recall failed:", error.message);
      });
      this.isActive = true;
      this.emitUpdate();
      this.memoryRecoveryPromise = Promise.resolve().then(() => traceOperation(performanceTrace, "memoryRecovery.pending", { attribution: "MAIN" }, () => this.recoverPendingMemories())).catch((error) => {
        console.error("[Summary] Background recovery failed; snapshots retained:", error);
      });
      finishTraceSpan(conversationOpenSpan, { result: "OK", count: this.gameData.characters.size });
    } catch (error) {
      finishTraceSpan(conversationOpenSpan, { result: "ERROR", errorCode: "initialization_error" });
      console.error("Failed to parse log file:", error);
      this.isActive = false;
      const initError = createError({
        id: this.nextId++,
        content: "Failed to initialize conversation",
        details: error instanceof Error ? error.message : String(error)
      });
      this.messages.push(initError);
      this.emitUpdate();
    }
  }
  isV813PrefixEnabled() {
    return settingsRepository?.getChatPromptV813Layout?.() === true;
  }
  async prefetchFrozenWorldline() {
    if (!this.isV813PrefixEnabled?.() || !worldlineService) return;
    const selectedIds = [...this.selectedCharacterIds].filter((id) => this.gameData.characters.has(id));
    const presentIds = [...this.presentCharacterIds].filter((id) => this.gameData.characters.has(id));
    const subjective = worldlineService.isSubjectivePromptIntegrationEnabled?.() === true;
    if (subjective) await worldlineService.prepareCanon?.();
    for (const responderId of selectedIds) {
      try {
        const args = {
          runtimeGameData: this.gameData,
          responderId,
          query: "",
          assistContext: "",
          snapshotMode: "CONVERSATION_BASELINE",
          mentionedEntityIds: [],
          activeParticipantIds: presentIds,
          runtimeContext: { activeParticipantIds: presentIds },
          conversationId: this.id,
          turnEpoch: 0,
          sceneRevision: `${this.gameData.date || ""}\n${this.gameData.scene || ""}`,
          presenceRevision: presentIds.map(String).sort().join(","),
          directObservationFactIds: [],
          directObservationFacts: [],
          historicalReferenceInfo: this.gameData.historicalReferenceInfo,
          tokenBudget: 900
        };
        const context = subjective
          ? await worldlineService.getSubjectivePromptContextAsync(args)
          : worldlineService.getPromptContext?.(args);
        if (context) this.frozenWorldlineByResponder.set(responderId, subjective ? context : {
          worldStableText: context.stableText || null,
          worldTopicText: context.topicText || null,
          worldSupplementalText: context.supplementalText || null,
          worldCurrentText: context.currentText || null,
          queryFingerprint: context.queryFingerprint || null,
          cacheHit: context.cacheHit === true
        });
        if (subjective && context?.baselineFacts) {
          this.frozenWorldlineCoverageByResponder.set(String(responderId), buildFrozenCoverageManifest({
            responderId, checkpointId: context.checkpointId, candidateSetComplete: context.baselineCandidateSetComplete,
            truncated: context.baselineTruncated, laneCoverage: context.baselineLaneCoverage
          }, context.baselineFacts));
          usageAnalytics?.record({ requestType: "worldline_coverage", coveragePhase: "BASELINE", characterId: responderId,
            baselineFactCount: context.baselineFacts.length, baselineTokens: context.worldTurnRecallTokens || 0,
            baselineLanes: context.baselineLanes, baselineLaneCoverage: context.baselineLaneCoverage,
            baselineTruncated: context.baselineTruncated }, null);
        }
      } catch (error) {
        console.warn(`[Worldline] Opening recall failed for NPC ${responderId}:`, error.message);
      }
    }
  }
  getWorldlineCoveragePatchFor(npc, memoryContext) {
    if (!worldlineService?.isSubjectivePromptIntegrationEnabled?.()) return null;
    const request = memoryContext?.worldlineRequest || {};
    const query = request.query || "";
    if (!query.trim()) return null;
    const plan = worldlineService.getPromptContext?.({ query, assistContext: request.assistContext || "", mentionedEntityIds: request.mentionedEntityIds || [],
      runtimeContext: { activeParticipantIds: this.getActiveConversationCharacters().map(character => character.id) }, diagnostic: true, includeScopedSupplemental: true })?.queryPlan;
    if (!plan) return null;
    const responderId = String(npc.id);
    const checkpointId = worldlineService.getCheckpointStatus?.()?.checkpoint?.id || null;
    const frozenManifest = this.frozenWorldlineCoverageByResponder?.get(responderId);
    const manifest = frozenManifest?.checkpointId === checkpointId ? frozenManifest : null;
    const decision = hasFrozenCoverage({ queryPlan: plan, manifest });
    if (!decision.eligible) return null;
    if (decision.hit) {
      usageAnalytics?.record({ requestType: "worldline_coverage", coveragePhase: "DECISION", coverageIntent: plan.intent,
        coverageHit: true, coverageRequestedFields: plan.requestedFields, coverageLaneCoverage: manifest?.laneCoverage || null, characterId: npc.id }, null);
      return null;
    }
    const presentIdsForRevision = [...(this.presentCharacterIds || [])].map(String).sort();
    const revision = JSON.stringify({
      gameDataRevision: this.gameDataRevision,
      confirmedActionRevision: memoryContext?.confirmedActionText ? createPromptFingerprint?.(memoryContext.confirmedActionText) || memoryContext.confirmedActionText : "",
      checkpointId,
      campaignToken: this.gameData.campaignToken || "",
      presentCharacterIds: presentIdsForRevision,
      scene: this.gameData.scene || null,
      location: this.gameData.location || null,
      locationController: this.gameData.locationController || null
    });
    let cache = this.worldlineCoveragePatchCacheByResponder.get(responderId);
    if (!cache || cache.revision !== revision) {
      cache = { revision, entries: new Map() };
      this.worldlineCoveragePatchCacheByResponder.set(responderId, cache);
    }
    const key = buildCoveragePatchKey({ responderId, checkpointId, queryPlan: plan });
    const cacheHit = cache.entries.has(key);
    if (!cacheHit) {
      const presentIds = [...this.presentCharacterIds];
      const directObservationFacts = buildPresenceObservationFacts({ responderId: npc.id, presentCharacterIds: presentIds, characters: this.gameData.characters, asOf: this.gameData.date || null });
      const patch = worldlineService.getSubjectiveCoveragePatch?.({
        runtimeGameData: this.gameData, responderId: npc.id, query, assistContext: request.assistContext || "",
        mentionedEntityIds: request.mentionedEntityIds || [], activeParticipantIds: this.getActiveConversationCharacters().map(character => character.id),
        conversationId: this.id, turnEpoch: this.turnEpoch, sceneRevision: `${this.gameData.date || ""}\n${this.gameData.scene || ""}`,
        presenceRevision: presentIds.map(String).sort().join(","), directObservationFactIds: directObservationFacts.map(fact => fact.factId), directObservationFacts,
        excludeFactIds: manifest?.factIds || [], missingFields: decision.missingFields, tokenBudget: 300, snapshotMode: "CONVERSATION_BASELINE"
      }) || null;
      cache.entries.set(key, patch);
    }
    const patch = cache.entries.get(key);
    usageAnalytics?.record({ requestType: "worldline_coverage", characterId: npc.id, conversationId: this.id,
      coveragePhase: "PATCH", coverageIntent: plan.intent, coverageHit: false, coverageMissingFields: decision.missingFields.length,
      coverageRequestedFields: plan.requestedFields, coverageLaneCoverage: manifest?.laneCoverage || null,
      patchCacheHit: cacheHit, patchFactCount: patch?.patchFacts?.length || 0, patchTokens: patch?.patchTokens || 0,
      patchCandidateCount: patch?.patchCandidateCount || 0, patchSelectedCount: patch?.patchSelectedCount || 0, patchTruncated: patch?.patchTruncated === true,
      patchFilteredCount: patch?.filteredCount || 0, patchSecretBlockedCount: patch?.secretBlockedCount || 0 }, null);
    return patch?.patchText || null;
  }
  async checkAndSummarizeIfNeeded(npc, diagnosticsContext = null) {
    const currentTurn = this.runtime?.turnManager?.currentTurn || this.turnManager?.currentTurn;
    const compactionTurnKey = currentTurn?.logicalTurnEpoch != null ? `logical:${currentTurn.logicalTurnEpoch}`
      : currentTurn?.playerMessageId != null ? `player:${currentTurn.playerMessageId}`
        : `epoch:${Number.isSafeInteger(Number(this.turnEpoch)) ? Number(this.turnEpoch) : 0}`;
    memoryEngine?.syncRollingStateFromConversationFields(this);
    memoryEngine?.syncConversationRollingFields(this);
    const capabilities = typeof llmManager.getProviderCapabilities === "function"
      ? await llmManager.getProviderCapabilities("CHAT")
      : { contextWindow: await llmManager.getCurrentContextLength() || 1e4, maxOutputTokens: 256 };
    const contextLimit = capabilities.contextWindow;
    const memoryRecallStartedAt = Date.now();
    let memoryContext = await traceOperation(performanceTrace, "memory.recall", { attribution: "MAIN", context: diagnosticsContext }, () => this.getMemoryContextFor(npc, contextLimit,
      { deferPlayerMemory: PLAYER_CENTERED_RECALL_ENABLED }));
    const memoryRecallMs = Date.now() - memoryRecallStartedAt;
    const promptHistory = this.getPromptHistoryForCharacter(npc.id);
    const promptSummary = this.getPromptSummaryForCharacter(npc.id);
    let currentMessages = PromptBuilder.buildMessages(
      promptHistory,
      npc,
      this.gameData,
      promptSummary,
      memoryContext
    );
    let estimatedTokens = this.estimateTokenCount(currentMessages);
    const productionWorldlineEnabled = worldlineService?.isSubjectivePromptIntegrationEnabled?.() === true;
    const trimMemoryTurnRecall = (reason) => {
      usageAnalytics.record({
        requestType: "memory_recall",
        characterId: npc.id,
        memoryOutcome: "skipped_context_pressure",
        turnRecallReason: reason,
        turnRecallTokens: memoryContext.turnRecallTokens,
        turnRecallIntent: true,
        turnRecallSelected: false,
        turnRecallCacheHit: memoryContext.turnRecallCacheHit,
        sessionTopicAnchorLocked: memoryContext.routing?.topicPatch === "locked",
        queryFingerprint: memoryContext.turnRecallQueryFingerprint,
        candidateCount: memoryContext.turnRecallCandidateCount,
        turnEpoch: this.turnEpoch
      }, null);
      memoryContext = { ...memoryContext, turnRecall: [], turnRecallText: null, turnRecallTokens: 0, turnRecallReason: reason };
      currentMessages = PromptBuilder.buildMessages(
        promptHistory,
        npc,
        this.gameData,
        promptSummary,
        memoryContext
      );
      estimatedTokens = this.estimateTokenCount(currentMessages);
    };
    if (memoryContext?.turnRecallText && !productionWorldlineEnabled && shouldTrimMemoryTurnRecall({ contextLimit, basePromptTokens: estimatedTokens, worldlineEnabled: false })) {
      trimMemoryTurnRecall("context_headroom_below_192");
    }
    if (this.isV813PrefixEnabled?.()) {
      const settings = worldlineService?.getSettings?.() || {};
      const request = memoryContext?.worldlineRequest || {};
      const hint = parseTimeHint(`${request.query || ""}\n${request.assistContext || ""}`, this.gameData.date);
      if (productionWorldlineEnabled && settings.v812HistoricalRetrievalEnabled && settings.v812HistoricalPromptInjection && ["AS_OF", "RANGE"].includes(hint.mode)) {
        try {
          const presentIds = [...this.presentCharacterIds];
          const directObservationFacts = buildPresenceObservationFacts({
            responderId: npc.id,
            presentCharacterIds: presentIds,
            characters: this.gameData.characters,
            asOf: this.gameData.date || null
          });
          const historical = await traceOperation(performanceTrace, "worldline.turnQuery", { attribution: "MAIN", context: diagnosticsContext }, () => worldlineService.getSubjectivePromptContextAsync({
            runtimeGameData: this.gameData,
            responderId: npc.id,
            query: request.query || "",
            assistContext: request.assistContext || "",
            mentionedEntityIds: request.mentionedEntityIds || [],
            activeParticipantIds: this.getActiveConversationCharacters().map((character) => character.id),
            conversationId: this.id,
            turnEpoch: this.turnEpoch,
            sceneRevision: `${this.gameData.date || ""}\n${this.gameData.scene || ""}`,
            presenceRevision: presentIds.map(String).sort().join(","),
            directObservationFactIds: directObservationFacts.map((fact) => fact.factId),
            directObservationFacts,
            historicalReferenceInfo: this.gameData.historicalReferenceInfo,
            tokenBudget: resolveWorldlineTurnBudget({ contextLimit, basePromptTokens: estimatedTokens }).turnBudget
          }));
          if (historical?.metrics?.historicalTimeMode) memoryContext = {
            ...memoryContext,
            historicalWorldText: historical.worldTurnRecallText || null,
            historicalReferenceInfo: historical.historicalReferenceInfo || memoryContext.historicalReferenceInfo
          };
        } catch (error) {
          console.warn("[Worldline] Historical recall failed; continuing with frozen world view:", error.message);
        }
      } else if (productionWorldlineEnabled && hint.mode === "RECENT") {
        try {
          const recent = await traceOperation(performanceTrace, "worldline.turnQuery", { attribution: "MAIN", context: diagnosticsContext }, () => worldlineService.getSubjectivePromptContextAsync({ runtimeGameData: this.gameData, responderId: npc.id,
            query: request.query || "", assistContext: request.assistContext || "", mentionedEntityIds: request.mentionedEntityIds || [],
            activeParticipantIds: this.getActiveConversationCharacters().map(character => character.id), conversationId: this.id,
            turnEpoch: this.turnEpoch, tokenBudget: 300 }));
          memoryContext = { ...memoryContext, recentWorldText: recent?.worldTurnRecallText || null };
        } catch (error) {
          console.warn("[Worldline] Recent recall failed; continuing with frozen world view:", error.message);
        }
      } else if (productionWorldlineEnabled && ["CURRENT", "UNSPECIFIED"].includes(hint.mode)) {
        try {
          memoryContext = { ...memoryContext, coveragePatchText: traceOperation(performanceTrace, "worldline.turnQuery", { attribution: "MAIN", context: diagnosticsContext }, () => this.getWorldlineCoveragePatchFor?.(npc, memoryContext)) || null };
        } catch (error) {
          console.warn("[Worldline] Coverage patch failed; continuing with frozen world view:", error.message);
        }
      }
      if (memoryContext?.turnRecallText && shouldTrimMemoryTurnRecall({ contextLimit, basePromptTokens: estimatedTokens, worldlineEnabled: true })) {
        trimMemoryTurnRecall("context_limit_exceeded_after_worldline_trim");
      }
    } else if (productionWorldlineEnabled) {
      const request = memoryContext?.worldlineRequest || {};
      const presentIds = [...(this.presentCharacterIds || [])];
      const directObservationFacts = buildPresenceObservationFacts({
        responderId: npc.id,
        presentCharacterIds: presentIds,
        characters: this.gameData?.characters,
        asOf: this.gameData?.date || null
      });
      const initialBudget = resolveWorldlineTurnBudget({ contextLimit, basePromptTokens: estimatedTokens });
      const remainingContext = initialBudget.remainingContext;
      try {
        await traceOperation(performanceTrace, "worldline.turnQuery", { attribution: "MAIN", context: diagnosticsContext }, () => worldlineService.prepareCanon?.());
        let subjectiveWorldContext = await traceOperation(performanceTrace, "worldline.turnQuery", { attribution: "MAIN", context: diagnosticsContext }, () => worldlineService.getSubjectivePromptContextAsync({
          runtimeGameData: this.gameData,
          responderId: npc.id,
          query: request.query || "",
          assistContext: request.assistContext || "",
          mentionedEntityIds: request.mentionedEntityIds || [],
          activeParticipantIds: this.getActiveConversationCharacters?.().map((character) => character.id) || [],
          conversationId: this.id,
          turnEpoch: this.turnEpoch,
          sceneRevision: `${this.gameData.date || ""}\n${this.gameData.scene || ""}`,
          presenceRevision: presentIds.map(String).sort().join(","),
          directObservationFactIds: directObservationFacts.map((fact) => fact.factId),
          directObservationFacts,
          historicalReferenceInfo: this.gameData.historicalReferenceInfo,
          tokenBudget: initialBudget.turnBudget
        })) || null;
        const stableTokens = TokenCounter.estimateTokens(subjectiveWorldContext?.worldStableText || "");
        if (subjectiveWorldContext && stableTokens > remainingContext) {
          subjectiveWorldContext = {
            ...subjectiveWorldContext,
            worldStableText: null,
            worldTurnRecallText: null,
            worldTurnRecallTokens: 0,
            worldTurnRecallTrimmed: [...(subjectiveWorldContext.worldTurnRecallTrimmed || []), { factId: null, sourceTier: null, reason: "WORLD_STABLE_CONTEXT_HEADROOM" }]
          };
        } else if (subjectiveWorldContext && stableTokens + (subjectiveWorldContext.worldTurnRecallTokens || 0) > remainingContext) {
          subjectiveWorldContext = await traceOperation(performanceTrace, "worldline.turnQuery", { attribution: "MAIN", context: diagnosticsContext }, () => worldlineService.getSubjectivePromptContextAsync({
            runtimeGameData: this.gameData,
            responderId: npc.id,
            query: request.query || "",
            assistContext: request.assistContext || "",
            mentionedEntityIds: request.mentionedEntityIds || [],
            activeParticipantIds: this.getActiveConversationCharacters?.().map((character) => character.id) || [],
            conversationId: this.id,
            turnEpoch: this.turnEpoch,
            sceneRevision: `${this.gameData.date || ""}\n${this.gameData.scene || ""}`,
            presenceRevision: presentIds.map(String).sort().join(","),
            directObservationFactIds: directObservationFacts.map((fact) => fact.factId),
            directObservationFacts,
            historicalReferenceInfo: this.gameData.historicalReferenceInfo,
            tokenBudget: resolveWorldlineTurnBudget({ contextLimit, basePromptTokens: estimatedTokens, stableWorldTokens: stableTokens }).turnBudget
          })) || null;
        }
        memoryContext = {
          ...memoryContext,
          worldStableText: subjectiveWorldContext?.worldStableText || null,
          worldTurnRecallText: subjectiveWorldContext?.worldTurnRecallText || null,
          worldTurnRecallTokens: subjectiveWorldContext?.worldTurnRecallTokens || 0,
          worldTurnRecallTrimmed: subjectiveWorldContext?.worldTurnRecallTrimmed || [],
          historicalReferenceInfo: subjectiveWorldContext?.historicalReferenceInfo || null,
          worldRecallQueryFingerprint: subjectiveWorldContext?.queryFingerprint || null,
          worldRecallCacheHit: subjectiveWorldContext?.cacheHit === true,
          worldlineHeadroom: remainingContext,
          worldlineMetrics: subjectiveWorldContext?.metrics ? { ...subjectiveWorldContext.metrics, memoryRecallMs } : null
        };
        if (subjectiveWorldContext?.metrics) {
          usageAnalytics?.record({
            requestType: "worldline_recall",
            characterId: npc.id,
            conversationId: this.id,
            cacheHit: subjectiveWorldContext.cacheHit === true,
            ...subjectiveWorldContext.metrics,
            worldSharedCacheHit: subjectiveWorldContext.metrics.sharedWorldCacheHit === true,
            worldSubjectiveCacheHit: subjectiveWorldContext.metrics.subjectiveCacheHit === true,
            worldTurnRecallTokens: subjectiveWorldContext.worldTurnRecallTokens || 0,
            worldTurnRecallTrimmed: subjectiveWorldContext.worldTurnRecallTrimmed?.length || 0,
            memoryRecallMs
          }, null);
        }
      } catch (error) {
        console.warn("[Worldline] World recall failed; continuing without world recall:", error.message);
      }
      if (memoryContext?.turnRecallText && shouldTrimMemoryTurnRecall({ contextLimit, basePromptTokens: estimatedTokens, worldlineEnabled: true })) {
        memoryContext = { ...memoryContext, worldStableText: null, worldTurnRecallText: null, worldTurnRecallTokens: 0 };
        trimMemoryTurnRecall("context_limit_exceeded_after_worldline_trim");
      }
    }
    if (this.isV813PrefixEnabled?.()) memoryContext.freezePromptPrefix = true;
    const activeProvider = settingsRepository?.getActiveProviderConfig?.();
    const requestedOutputTokens = activeProvider?.providerType === "deepseek" ? 4096
      : Number(activeProvider?.defaultParameters?.max_tokens) || capabilities.maxOutputTokens;
    let budget;
    for (let attempt = 0; attempt < 8; attempt++) {
      const history = this.getPromptHistoryForCharacter(npc.id);
      const summary = this.getPromptSummaryForCharacter(npc.id);
      const pendingRecall = this.pendingPlayerRecallRequests?.get(Number(npc.id));
      if (PLAYER_CENTERED_RECALL_ENABLED && pendingRecall) {
        if (pendingRecall.turnEpoch !== this.turnEpoch || pendingRecall.conversationId !== this.id) throw new Error("memory_player_turn_superseded");
        const excluded = PromptBuilder.buildMessagesWithTokenCount(history, npc, this.gameData, summary, memoryContext,
          activeProvider, { memoryMode: "exclude" });
        const nonMemoryBudget = planRequestBudget({ messages: excluded.messages, capabilities, requestedOutputTokens,
          countTokens: items => this.estimateTokenCount(items) });
        const providerHeadroomTokens = Math.max(0, Math.floor((nonMemoryBudget.effectiveInputBudget - nonMemoryBudget.estimatedInputTokens) / 1.1));
        const memoryBudgetTokens = this.getMemoryTokenBudget(contextLimit, pendingRecall.activeParticipantIds, providerHeadroomTokens);
        const memoryBudgetPlan = { policyRevision: DEFAULT_MEMORY_BUDGET_POLICY_REVISION,
          participantCount: this.frozenMemoryBudget.participantCount, contextWindow: contextLimit,
          nonMemoryInputTokens: nonMemoryBudget.estimatedInputTokens, providerHeadroomTokens, memoryBudgetTokens,
          reservedOutputTokens: nonMemoryBudget.reservedOutputTokens, safetyMarginTokens: nonMemoryBudget.safetyMarginTokens,
          protocolOverheadTokens: nonMemoryBudget.protocolOverheadTokens };
        let retrieved;
        try {
          retrieved = (applicationServices?.memory || memoryEngine).retrieveForResponder({ ...pendingRecall,
            tokenBudget: memoryBudgetTokens, memoryBudgetPlan, configurationRevision: capabilities.capabilityRevision || JSON.stringify([
              capabilities.providerId, capabilities.modelId, capabilities.contextWindow, capabilities.maxOutputTokens]),
            budgetPolicyRevision: DEFAULT_MEMORY_BUDGET_POLICY_REVISION });
        } catch (error) {
          if (error?.code !== "MEMORY_CONTEXT_OVERFLOW") throw error;
          if (this.contextCompactionTurnKey === compactionTurnKey) throw error;
          this.contextCompactionTurnKey = compactionTurnKey;
          const compacted = await this.createRollingSummary(nonMemoryBudget.effectiveInputBudget);
          if (!compacted?.committed || !compacted.selection?.batch?.length) throw error;
          continue;
        }
        if (memoryContext.sourceFolderRevision !== retrieved.sourceFolderRevision) {
          this.cacheV2FrozenSnapshots?.prefixByResponder?.clear();
          this.dynamicRecallHistory?.clear();
          this.memoryState.mentionProfileCache = null;
        }
        this.memoryState.sourceFolderRevisions?.set(npc.id, retrieved.sourceFolderRevision);
        memoryContext = { ...memoryContext, ...retrieved, freezePromptPrefix: this.isV813PrefixEnabled?.() === true,
          memoryBudgetPlan };
        usageAnalytics?.record({ requestType: "memory_recall", characterId: npc.id,
          pairMemoryMetrics: retrieved.pairMemoryMetrics, memoryBudgetPlan: memoryContext.memoryBudgetPlan,
          turnEpoch: this.turnEpoch }, null);
      }
      memoryContext = { ...memoryContext, ...this.getCharacterDisclosureContext(npc,
        [...(memoryContext.disclosureTargetIds || []), ...(memoryContext.thirdPersonDecision?.targetCharacterIds || [])]) };
      const built = typeof PromptBuilder.buildMessagesWithTokenCount === "function"
        ? PromptBuilder.buildMessagesWithTokenCount(history, npc, this.gameData, summary, memoryContext, activeProvider)
        : { messages: PromptBuilder.buildMessages(history, npc, this.gameData, summary, memoryContext) };
      const messages = built.messages;
      if (memoryContext?.playerCenteredRecallEnabled && PromptBuilder.getMemoryBlockTokenCount(built) > memoryContext.tokenBudget) {
        throw new Error("chat_memory_budget_exceeded");
      }
      budget = planRequestBudget({ messages, capabilities, requestedOutputTokens, countTokens: (items) => this.estimateTokenCount(items) });
      const rollingState = this.memoryState?.rollingState;
      this.contextBudgetDiagnostics = {
        ...budget,
        provider: capabilities.providerType,
        providerId: capabilities.providerId,
        model: capabilities.modelId,
        contextWindow: capabilities.contextWindow,
        contextWindowSource: capabilities.contextWindowSource,
        configuredContextLength: capabilities.configuredContextLength,
        modelNativeContext: capabilities.modelNativeContext,
        providerMaxOutputTokens: capabilities.maxOutputTokens,
        softThresholdReached: budget.pressureRatio >= 0.65,
        historyMode: rollingState?.cacheEpoch > 0 ? "COMPACTED" : "APPEND_ONLY",
        activeRawMessageCount: history.length,
        rollingSegmentCount: rollingState?.segments?.length || 0,
        cacheEpoch: rollingState?.cacheEpoch || 0
      };
      if (budget.pressureRatio < (this.CONTEXT_LIMIT_PERCENTAGE ?? 0.75)) break;
      if (this.contextCompactionTurnKey === compactionTurnKey) break;
      this.contextCompactionTurnKey = compactionTurnKey;
      const result = await this.createRollingSummary(budget.effectiveInputBudget);
      if (!result?.committed) break;
    }
    if (!budget.safe) throw new Error("chat_request_budget_exceeded_after_compaction");
    return memoryContext;
  }
  /**
   * Create a rolling summary of older messages to compress context
   */
  async createRollingSummary(contextLimit) {
    if (!memoryEngine) throw new Error("memory_engine_not_configured");
    const summaryCapabilities = typeof llmManager.getProviderCapabilities === "function"
      ? await llmManager.getProviderCapabilities("SUMMARY")
      : { contextWindow: contextLimit, maxOutputTokens: 4096 };
    const sourceTarget = Math.max(256, Math.min(Math.floor(contextLimit * this.MESSAGES_TO_SUMMARIZE_PERCENTAGE),
      Math.floor(summaryCapabilities.contextWindow * 0.25), Math.floor(summaryCapabilities.maxOutputTokens * 1.5)));
    const result = await memoryEngine.maybeCreateRollingCheckpoint({
      conversation: this,
      history: this.getHistory(),
      contextLimit: sourceTarget,
      percentage: 1,
      estimateMessageTokens: (message) => this.estimateMessageTokens(message),
      buildPrompt: (messages, previousSummary) => PromptBuilder.buildResummarizePrompt(messages, previousSummary),
      requestSummary: async (summaryPrompt) => {
        console.log("[TOKEN_COUNT] Rolling summary: ", this.estimateTokenCount(summaryPrompt));
        return llmManager.sendSummaryRequest(summaryPrompt, void 0, { requestType: "rolling_summary", maxTokens: Math.min(2048, summaryCapabilities.maxOutputTokens) });
      }
    });
    if (result.committed) {
      console.log(`Updated rolling summary v${this.memoryState.rollingState.summaryVersion} (${this.currentSummary.length} characters)`);
      logVerboseLLM("[Summary][verbose] Updated rolling summary:", this.currentSummary);
    } else if (result.reason !== "no_messages") {
      console.error(`Failed to create rolling summary: ${result.reason}`);
    }
    return result;
  }
  getMemoryTokenBudget(contextLimit, participantIds, providerHeadroomTokens = contextLimit) {
    if (PLAYER_CENTERED_RECALL_ENABLED) {
      if (!this.frozenMemoryBudget) {
        const conversationIds = this.selectedCharacterIds instanceof Set
          ? [this.gameData?.playerID, ...this.selectedCharacterIds] : participantIds;
        const participantCount = new Set(conversationIds.map(Number).filter(id => Number.isSafeInteger(id) && id > 0)).size;
        const plan = resolveMemoryBudget({ participantCount, contextWindowTokens: contextLimit,
          providerHeadroomTokens: contextLimit });
        this.frozenMemoryBudget = { participantCount, ratio: plan.ratio,
          policyRevision: plan.policyRevision, tokens: plan.policyBudgetTokens };
      }
      const plan = resolveMemoryBudget({ participantCount: this.frozenMemoryBudget.participantCount,
        contextWindowTokens: contextLimit, providerHeadroomTokens });
      return Math.min(this.frozenMemoryBudget.tokens, plan.memoryBudgetTokens);
    }
    if (!this.frozenMemoryBudget) {
      const participantCount = new Set(participantIds.map(Number)).size;
      const tier = Math.min(2, Math.max(0, participantCount - 2));
      const ratio = 0.10 + tier * 0.025;
      this.frozenMemoryBudget = { participantCount, ratio,
        tokens: Math.max(0, Math.min(3600 + tier * 900, Math.floor(contextLimit * ratio))) };
    }
    return this.frozenMemoryBudget.tokens;
  }
  async getMemoryContextFor(npc, contextLimit = null, options = {}) {
    if (!memoryEngine || !npc || !this.gameData) return null;
    if (Number(npc.id) === Number(this.gameData.playerID)) return null;
    if (this.isV813PrefixEnabled?.()) await this.worldlinePrefetchPromise;
    if (memoryEngine.isSummaryOwnerDeceased(npc.id)) memoryEngine.reviveSummaryOwner(npc.id);
    const limit = contextLimit || await llmManager.getCurrentContextLength() || 1e4;
    const history = this.getHistoryForCharacter(npc.id);
    const activeParticipantIds = this.getActiveConversationCharacters().map((character) => character.id);
    const mentionExcludedIds = this.gameData.getMentionExclusionIds(activeParticipantIds);
    const memoryState = memoryEngine.ensureConversationState(this);
    const sourceFolderRevision = memoryEngine.store.getFolderSummaryRevision(npc.id);
    if (!(memoryState.sourceFolderRevisions instanceof Map)) memoryState.sourceFolderRevisions = new Map();
    if (memoryState.sourceFolderRevisions.has(npc.id) && memoryState.sourceFolderRevisions.get(npc.id) !== sourceFolderRevision) {
      if (PLAYER_CENTERED_RECALL_ENABLED) {
        memoryState.mentionProfileCache = null;
        this.cacheV2FrozenSnapshots?.prefixByResponder?.clear();
      } else memoryEngine.invalidateConversationRecallState(this);
    }
    memoryState.sourceFolderRevisions.set(npc.id, sourceFolderRevision);
    this.getPromptHistoryForCharacter(npc.id);
    const participantKey = [...new Set(activeParticipantIds.map(Number))].sort((left, right) => left - right).join(",");
    const campaignKey = this.gameData.campaignToken ?? null;
    if (memoryState.mentionProfileCache && memoryState.mentionProfileCache.campaignKey !== campaignKey) {
      memoryState.mentionState = memoryEngine.mentionTracker.createState();
      memoryState.mentionedRecallCache.clear();
      this.gameData.mentionedCharactersInContext?.clear();
    }
    if (memoryState.mentionProfileCache?.participantKey !== participantKey || memoryState.mentionProfileCache?.campaignKey !== campaignKey) {
      const profiles = new Map(this.gameData.getMentionableCharacterProfiles());
      const ownerFolderMemoriesById = new Map();
      const ownerFolderMemoriesRawById = new Map();
      for (const ownerId of activeParticipantIds) {
        const rawFolderMemories = memoryEngine.loadOwnerFolderMemories(ownerId);
        const folderMemories = rawFolderMemories.filter(memory => memoryMatchesCampaign(memory, campaignKey));
        ownerFolderMemoriesRawById.set(Number(ownerId), rawFolderMemories);
        ownerFolderMemoriesById.set(Number(ownerId), folderMemories);
        for (const [characterId, profile] of memoryEngine.getMentionableProfilesFromFolderMemories(folderMemories)) {
          if (!profiles.has(characterId)) profiles.set(characterId, profile);
        }
      }
      memoryState.mentionProfileCache = { participantKey, campaignKey, profiles, ownerFolderMemoriesById, ownerFolderMemoriesRawById };
    }
    const mentionableProfiles = memoryState.mentionProfileCache.profiles;
    const currentUserIndex = history.findLastIndex((entry) => entry.role === "user");
    const currentTurn = (this.runtime?.turnManager || this.turnManager)?.currentTurn;
    const pairRoute = require("../memory-system/pair-memory-routing").resolveActiveMemoryPairs({
      ownerId: npc.id, history, activeParticipantIds, playerId: this.gameData.playerID,
      campaignToken: this.gameData.campaignToken,
      currentPlayerMessageId: currentTurn?.playerMessageId,
      turnEpoch: this.turnEpoch,
      logicalTurnEpoch: currentTurn?.logicalTurnEpoch ?? null,
      conversationId: this.id,
      sceneRevision: JSON.stringify([this.gameData.scene || null, this.gameData.location || null, this.gameData.locationController || null])
    });
    const query = pairRoute.query || (currentUserIndex >= 0 ? history[currentUserIndex].content || "" : "");
    const assistContext = (currentUserIndex > 0 ? history.slice(Math.max(0, currentUserIndex - 2), currentUserIndex) : []).map((entry) => entry.content || "").filter(Boolean).join("\n");
    const mentionedCharacterIds = memoryEngine.findMentionedOutOfSceneCharacters({
      conversation: this,
      history,
      candidates: [...mentionableProfiles.values()],
      excludedIds: mentionExcludedIds
    });
    const currentTurnMentionedCharacterIds = typeof memoryEngine.getCurrentTurnMentionedOutOfSceneCharacters === "function"
      ? memoryEngine.getCurrentTurnMentionedOutOfSceneCharacters({ conversation: this, excludedIds: mentionExcludedIds })
      : mentionedCharacterIds;
    if (!this.gameData.mentionedCharactersInContext) this.gameData.mentionedCharactersInContext = /* @__PURE__ */ new Set();
    for (const characterId of mentionedCharacterIds) this.gameData.mentionedCharactersInContext.add(characterId);
    const mentionedEntityNames = Object.fromEntries(mentionedCharacterIds.map((characterId) => {
      const character = mentionableProfiles.get(characterId);
      return [characterId, character ? memoryEngine.getCharacterMentionAliases(character) : []];
    }));
    const currentTurnMentionedEntityNames = Object.fromEntries(currentTurnMentionedCharacterIds.map((characterId) => [characterId, mentionedEntityNames[characterId] || []]));
    const memory3Settings = worldlineService?.getSettings?.() || {};
    const explicitTargetEntityIds = memoryEngine.mentionTracker.findMentionedCharacterIds([{ role: "user", content: query }], {
      candidates: [...mentionableProfiles.values()], excludedIds: [npc.id],
      recentCharacterId: memoryState.mentionState.recentThirdPersonCharacterId
    });
    const queryIdentityUnresolved = memoryEngine.mentionTracker.lastScanUnresolved === true;
    const retrievalInput = {
      characterId: npc.id,
      query,
      mentionedEntityIds: memory3Settings.v812MemoryEngine3Enabled !== false ? currentTurnMentionedCharacterIds : mentionedCharacterIds,
      activeParticipantIds,
      mentionedEntityNames,
      mentionedRecallCache: memoryState.mentionedRecallCache,
      sessionRecallCache: memoryState.responderRecallCache,
      directCounterpartIds: pairRoute.counterpartIds,
      querySpeakerId: pairRoute.querySpeakerId,
      trustedPlayerAnchorId: pairRoute.playerAnchorId,
      trustedPlayerTurn: pairRoute.trustedPlayerTurn,
      playerCenteredRecallEnabled: PLAYER_CENTERED_RECALL_ENABLED,
      budgetPolicyRevision: DEFAULT_MEMORY_BUDGET_POLICY_REVISION,
      ownerFolderMemories: memoryState.mentionProfileCache.ownerFolderMemoriesRawById?.get(Number(npc.id))
        || memoryEngine.loadOwnerFolderMemories(npc.id),
      currentGameDate: this.gameData.date,
      currentTotalDays: this.gameData.totalDays,
      campaignToken: this.gameData.campaignToken || null,
      conversationId: this.id,
      sceneRevision: JSON.stringify([this.gameData.scene || null, this.gameData.location || null, this.gameData.locationController || null]),
      logicalTurnEpoch: currentTurn?.logicalTurnEpoch ?? null,
      memoryEngine3Enabled: memory3Settings.v812MemoryEngine3Enabled !== false,
      gameData: this.gameData,
      entityProfiles: [...mentionableProfiles.values()],
      explicitTargetEntityIds,
      identityUnresolved: queryIdentityUnresolved,
      temporalSummaryRecallEnabled: memory3Settings.v812TemporalSummaryRecallEnabled !== false,
      officialSummary: this.gameData.getOfficialRecollectionSummary?.(npc.id, this.id) || null,
      turnEpoch: this.turnEpoch,
      tokenBudget: PLAYER_CENTERED_RECALL_ENABLED || memory3Settings.v812MemoryEngine3Enabled !== false
        ? this.getMemoryTokenBudget(limit, activeParticipantIds)
        : Math.min(2400, Math.max(800, Math.floor(limit * 0.08))),
      participantCount: this.frozenMemoryBudget?.participantCount,
      estimateTokens: (text) => TokenCounter.estimateTokens(text),
      estimateMessageTokens: (message) => this.estimateMessageTokens(message)
    };
    if (!(this.pendingPlayerRecallRequests instanceof Map)) this.pendingPlayerRecallRequests = new Map();
    if (PLAYER_CENTERED_RECALL_ENABLED) this.pendingPlayerRecallRequests.set(Number(npc.id), retrievalInput);
    const retrieved = options.deferPlayerMemory && PLAYER_CENTERED_RECALL_ENABLED
      ? { playerCenteredRecallEnabled: true, sourceFolderRevision, sourceCampaignToken: this.gameData.campaignToken,
        playerAnchorId: pairRoute.playerAnchorId, conversationId: this.id, routing: {} }
      : (applicationServices?.memory || memoryEngine).retrieveForResponder(retrievalInput);
    if (retrieved.sourceFolderRevision !== sourceFolderRevision) {
      this.cacheV2FrozenSnapshots?.prefixByResponder?.clear();
      this.dynamicRecallHistory?.clear();
      memoryState.mentionProfileCache = null;
      memoryState.sourceFolderRevisions.set(npc.id, retrieved.sourceFolderRevision);
    }
    const turnEntityIds = [...new Set([...activeParticipantIds, ...currentTurnMentionedCharacterIds].map(Number))].filter((characterId) => characterId !== Number(npc.id));
    const turnEntityNames = turnEntityIds.flatMap((characterId) => {
      const profile = mentionableProfiles.get(characterId) || this.gameData.characters.get(characterId);
      return profile ? memoryEngine.getCharacterMentionAliases(profile) : [];
    });
    const turnRecall = PLAYER_CENTERED_RECALL_ENABLED || memory3Settings.v812MemoryEngine3Enabled !== false ? { selected: [], text: null, tokens: 0, reason: "UNIFIED_EXTRA3", triggered: false } : memoryEngine.retrieveTurnRecall({
      characterId: npc.id,
      query,
      assistContext,
      entityIds: turnEntityIds,
      entityNames: turnEntityNames,
      participantIds: activeParticipantIds.filter((characterId) => characterId !== npc.id),
      ownerFolderMemories: memoryState.mentionProfileCache.ownerFolderMemoriesById.get(Number(npc.id)) || [],
      currentTotalDays: this.gameData.totalDays,
      campaignToken: this.gameData.campaignToken || null,
      tokenBudget: 256,
      estimateTokens: (text) => TokenCounter.estimateTokens(text),
      cache: memoryState.turnRecallCache,
      turnEpoch: this.turnEpoch
    });
    const thirdPartyEvidence = !PLAYER_CENTERED_RECALL_ENABLED && memory3Settings.v812MemoryEngine3Enabled === false && typeof memoryEngine.retrieveThirdPartyEvidence === "function" ? memoryEngine.retrieveThirdPartyEvidence({
      characterId: npc.id,
      query,
      mentionedEntityIds: currentTurnMentionedCharacterIds,
      mentionedEntityNames: currentTurnMentionedEntityNames,
      ownerFolderMemories: memoryState.mentionProfileCache.ownerFolderMemoriesById.get(Number(npc.id)) || [],
      currentGameDate: this.gameData.date,
      currentTotalDays: this.gameData.totalDays,
      campaignToken: this.gameData.campaignToken || null,
      tokenBudget: 512,
      estimateTokens: (text) => TokenCounter.estimateTokens(text)
    }) : { text: null, tokens: 0, reason: "UNAVAILABLE", conflict: false };
    usageAnalytics.record({
      requestType: "memory_recall",
      character: npc.shortName,
      characterId: npc.id,
      memoryOutcome: turnRecall.triggered ? "inserted" : "skipped",
      turnRecallReason: turnRecall.reason,
      turnRecallTokens: turnRecall.tokens,
      turnRecallIntent: turnRecall.intentTriggered,
      turnRecallSelected: turnRecall.triggered,
      turnRecallCacheHit: turnRecall.cacheHit,
      sessionTopicAnchorLocked: retrieved.routing?.topicPatch === "locked",
      queryFingerprint: turnRecall.queryFingerprint,
      candidateCount: turnRecall.candidateCount,
      temporalDiagnostics: retrieved.temporalDiagnostics || null,
      entityRecallDiagnostics: retrieved.entityRecallDiagnostics || null,
      pairMemoryMetrics: retrieved.pairMemoryMetrics || null,
      turnEpoch: this.turnEpoch
    }, null);
    let worldContext = null;
    try {
      if (this.isV813PrefixEnabled?.()) {
        worldContext = this.frozenWorldlineByResponder?.get(Number(npc.id)) || null;
      } else if (!worldlineService?.isSubjectivePromptIntegrationEnabled?.()) {
        worldContext = worldlineService?.getPromptContext?.({ query, assistContext, mentionedEntityIds: currentTurnMentionedCharacterIds, responderId: npc.id, conversationId: this.id, turnEpoch: this.turnEpoch }) || null;
      }
    } catch (error) {
      console.warn("[Worldline] World recall failed; continuing without world recall:", error.message);
    }
    return {
      ...retrieved,
      ...this.getCharacterDisclosureContext(npc, currentTurnMentionedCharacterIds),
      turnRecall: turnRecall.selected,
      turnRecallText: turnRecall.text,
      turnRecallTokens: turnRecall.tokens,
      turnRecallReason: turnRecall.reason,
      turnRecallQueryFingerprint: turnRecall.queryFingerprint,
      turnRecallCandidateCount: turnRecall.candidateCount,
      turnRecallCacheHit: turnRecall.cacheHit,
      thirdPartyEvidenceText: thirdPartyEvidence.text,
      thirdPartyEvidenceTokens: thirdPartyEvidence.tokens,
      thirdPartyEvidenceReason: thirdPartyEvidence.reason,
      thirdPartyEvidenceConflict: thirdPartyEvidence.conflict,
      activeParticipantIds,
      stableProfileCache: this.stableProfileCache,
      stableDescriptionCache: this.stableDescriptionCache,
      cacheV2FrozenSnapshots: this.cacheV2FrozenSnapshots,
      freezePromptPrefix: false,
      presenceText: this.buildPresenceContext(),
      confirmedActionText: this.isV813PrefixEnabled?.() ? this.getConfirmedActionContextFor(npc.id) : null,
      worldStableText: worldContext?.worldStableText || worldContext?.stableText || null,
      worldTopicText: worldContext?.worldTopicText || worldContext?.topicText || null,
      worldSupplementalText: worldContext?.worldSupplementalText || worldContext?.supplementalText || null,
      worldCurrentText: worldContext?.worldCurrentText || worldContext?.currentText || null,
      worldTurnRecallText: worldContext?.worldTurnRecallText || null,
      worldTurnRecallTokens: worldContext?.worldTurnRecallTokens || 0,
      worldlineRequest: { query, assistContext, mentionedEntityIds: currentTurnMentionedCharacterIds },
      subjectiveWorldPolicyActive: worldlineService?.isSubjectivePromptIntegrationEnabled?.() === true,
      historicalReferenceInfo: worldContext?.historicalReferenceInfo || null,
      worldRecallQueryFingerprint: worldContext?.queryFingerprint || null,
      worldRecallCacheHit: worldContext?.cacheHit === true
    };
  }
  /**
   * Estimate token count (simple approximation)
   */
  getCharacterDisclosureContext(npc, additionalTargets = []) {
    return buildCharacterDisclosureContext({
      service: applicationServices?.characterKnowledge, gameData: this.gameData, responderId: npc.id,
      targetIds: [this.gameData.playerID, ...(this.selectedCharacterIds || []), ...additionalTargets]
    });
  }
  recordCharacterDisclosures() {
    const service = applicationServices?.characterKnowledge;
    if (typeof service?.recordConversation !== "function") return;
    const participants = [this.gameData.playerID, ...(this.selectedCharacterIds || [])].map(id => this.gameData.characters.get(Number(id)))
      .filter(Boolean).map(person => ({ id: Number(person.id), name: person.shortName || person.fullName || person.name }));
    try {
      service.recordConversation({ conversation: this, context: {
        conversationId: this.id, campaignToken: this.gameData.campaignToken, date: this.gameData.date,
        messages: this.getHistory(), participants, participantPresence: this.memoryState?.participantPresence || []
      } });
    } catch (error) {
      console.error("[CharacterDisclosure] Recording failed", /^character_knowledge_[a-z_]+$/.test(error.message) ? error.message : "persistence_failed");
    }
  }
  estimateTokenCount(messages) {
    return TokenCounter.calculateTotalTokens(messages);
  }
  estimateMessageTokens(message) {
    return TokenCounter.estimateMessageTokens(message);
  }
  // Get list of all NPCs (characters except the player)
  getNpcList() {
    return this.getActiveConversationCharacters().filter((c) => c.id !== this.gameData.playerID);
  }
  getActiveConversationCharacters() {
    return [...this.gameData.characters.values()].filter((character) => this.isCharacterAvailableForConversation(character));
  }
  initializePresence(initialPresentIds = null) {
    const selectedIds = [...this.gameData.characters.keys()].map(Number).filter((characterId) => Number.isFinite(characterId) && characterId !== Number(this.gameData.playerID));
    this.selectedCharacterIds = new Set(selectedIds);
    const primaryCharacterId = Number(this.gameData.aiID);
    const defaultPresentIds = this.selectedCharacterIds.has(primaryCharacterId) ? [primaryCharacterId] : selectedIds.slice(0, 1);
    const requested = Array.isArray(initialPresentIds) ? initialPresentIds.map(Number).filter((characterId) => this.selectedCharacterIds.has(characterId)) : defaultPresentIds;
    const initialIds = requested.length > 0 ? requested : defaultPresentIds;
    this.presentCharacterIds = new Set(initialIds);
    this.waitingCharacterIds = new Set(selectedIds.filter((characterId) => !this.presentCharacterIds.has(characterId)));
    this.temporarilyAbsentCharacterIds = new Map();
    this.departedCharacterIds = new Set();
    this.joinEvents = [];
    this.leaveEvents = [];
    this.presenceInitialized = true;
    memoryEngine?.observeParticipants(this, [Number(this.gameData.playerID), ...initialIds], this.nextId);
    return this.getPresenceState();
  }
  canManagePresence() {
    return !this.activeResponse && this.npcQueue.length === 0 && !this.isPaused;
  }
  getPresenceState() {
    if (!this.presenceInitialized && this.gameData?.characters) this.initializePresence();
    const participants = [...(this.selectedCharacterIds || [])].map((characterId) => {
      const character = this.gameData.characters.get(characterId) || this.summaryParticipantProfiles?.get(characterId);
      const temporaryAbsence = this.temporarilyAbsentCharacterIds?.get(characterId) || null;
      const status = this.waitingCharacterIds.has(characterId) ? "waiting" : this.inactiveParticipantIds?.has(characterId) ? this.inactiveParticipantIds.get(characterId) : temporaryAbsence ? "temporarily_absent" : this.departedCharacterIds.has(characterId) ? "departed" : "present";
      return {
        id: characterId,
        name: character?.shortName || character?.name || character?.fullName || `角色${characterId}`,
        fullName: character?.fullName || character?.shortName || character?.name || `角色${characterId}`,
        status,
        temporaryAbsenceMode: temporaryAbsence?.mode || null,
        temporaryAbsenceLabel: temporaryAbsence ? TEMPORARY_ABSENCE_MODES[temporaryAbsence.mode]?.statusLabel || "暂时离场" : null,
        returnLabel: temporaryAbsence ? TEMPORARY_ABSENCE_MODES[temporaryAbsence.mode]?.returnLabel || "请回来" : null
      };
    });
    return {
      participants,
      presentIds: [...this.presentCharacterIds],
      waitingIds: [...this.waitingCharacterIds],
      temporarilyAbsentIds: [...(this.temporarilyAbsentCharacterIds?.keys() || [])],
      departedIds: [...this.departedCharacterIds],
      canManage: this.canManagePresence(),
      canLeave: this.presentCharacterIds.size > 1,
      canTemporarilyLeave: this.presentCharacterIds.size > 0,
      beforeFirstMessage: !this.getHistory().some((message) => message.role === "user" || message.role === "assistant")
    };
  }
  buildPresenceContext() {
    const participants = this.getPresenceState().participants;
    const present = participants.filter((participant) => participant.status === "present");
    const temporarilyAbsent = participants.filter((participant) => participant.status === "temporarily_absent");
    if (present.length === 0) return "";
    const name = participant => getCharacterPersonalName(this.gameData.characters.get(Number(participant.id)) || {}, `角色${participant.id}`);
    const absenceText = temporarilyAbsent.length > 0 ? `\n暂时缺席：${temporarilyAbsent.map((participant) => `${name(participant)}（${participant.temporaryAbsenceLabel}）`).join("、")}。这些人物不能感知缺席期间的内容。` : "";
    return `=== 当前在场人物（仅本轮有效） ===\n${present.map((participant) => `- ${name(participant)}`).join("\n")}\n只能把当前在场人物视为听见本轮对话并可直接回应的人；候场、暂时缺席或已离场人物不在当前对话现场。${absenceText}`;
  }
  getPresenceWindows(characterId) {
    const state = memoryEngine?.ensureConversationState(this);
    return (state?.participantPresence || []).filter((window) => Number(window.characterId) === Number(characterId));
  }
  getHistoryForCharacter(characterId) {
    const history = this.getHistory();
    const windows = this.getPresenceWindows(characterId);
    if (windows.length === 0) return this.presenceInitialized ? [] : history;
    return history.filter((message) => windows.some((window) => {
      const messageId = Number(message.id);
      if (!Number.isFinite(messageId)) return false;
      const joined = Number(window.joinedAtMessageId ?? 0);
      const left = window.leftAtMessageId == null ? Infinity : Number(window.leftAtMessageId);
      return joined <= messageId && messageId < left;
    }));
  }
  canUseSharedRollingSummary(characterId) {
    const history = this.getHistory();
    const firstMessageId = history.map((message) => Number(message.id)).filter(Number.isFinite).sort((left, right) => left - right)[0];
    if (!Number.isFinite(firstMessageId)) return true;
    const windows = this.getPresenceWindows(characterId);
    return windows.length === 1 && windows[0].leftAtMessageId == null && Number(windows[0].joinedAtMessageId ?? 0) <= firstMessageId;
  }
  getPromptHistoryForCharacter(characterId) {
    const state = memoryEngine?.ensureConversationState(this).rollingState;
    const start = Number(state?.committedThroughHistoryIndex ?? this.lastSummarizedMessageIndex) || 0;
    const windows = this.getPresenceWindows(characterId);
    const history = !windows.length ? this.presenceInitialized ? [] : this.getHistory().slice(start)
      : !state?.segments?.length && !this.canUseSharedRollingSummary(characterId) ? this.getHistoryForCharacter(characterId)
      : this.getHistory().slice(start).filter((message) => windows.some((window) => {
      const messageId = Number(message.id);
      return Number(window.joinedAtMessageId ?? 0) <= messageId && (window.leftAtMessageId == null || messageId < Number(window.leftAtMessageId));
    }));
    if (PLAYER_CENTERED_RECALL_ENABLED) return history;
    const recalls = this.dynamicRecallHistory?.get(Number(characterId));
    if (!recalls) return history;
    const retainedIds = new Set(history.map(message => message.id));
    const cache = this.memoryState?.responderRecallCache?.get(Number(characterId));
    for (const [messageId, recall] of recalls) {
      if (retainedIds.has(messageId)) continue;
      for (const key of recall.keys) cache?.seenDynamicSummaries?.delete(key);
      if (cache) delete cache.dynamicTurn;
      recalls.delete(messageId);
    }
    return history.flatMap(message => recalls.has(message.id)
      ? [{ role: "system", content: recalls.get(message.id).text }, message] : [message]);
  }
  retainDynamicSummaryRecall(characterId, messageId, promptBuild, turnEpoch) {
    const block = promptBuild.blocks?.find(entry => entry.block?.id === "memory-dynamic-frozen")
      || promptBuild.blocks?.find(entry => entry.block?.id === "memory-temporal-extra");
    const text = block?.content;
    const cache = this.memoryState?.responderRecallCache?.get(Number(characterId));
    if (!text || cache?.dynamicTurn !== turnEpoch) return;
    const injectedEntries = cache.dynamicExtra || [];
    const committed = memoryEngine.commitDynamicSummaryRecall(characterId, this.memoryState.responderRecallCache, turnEpoch, {
      providerSucceeded: true, injectedBlockIds: [block.block.id],
      injectedMemoryIds: injectedEntries.map(entry => entry.memory.memoryId),
      injectedTokens: Number(block.tokens) || TokenCounter?.estimateTokens?.(text) || Math.ceil(text.length / 2)
    });
    if (!committed.committedCount) return;
    if (PLAYER_CENTERED_RECALL_ENABLED) return;
    if (!this.dynamicRecallHistory) this.dynamicRecallHistory = new Map();
    if (!this.dynamicRecallHistory.has(Number(characterId))) this.dynamicRecallHistory.set(Number(characterId), new Map());
    this.dynamicRecallHistory.get(Number(characterId)).set(messageId, { text,
      keys: injectedEntries.map(entry => memoryEngine.getRouteMemoryKey(entry.memory)) });
  }
  getPromptSummaryForCharacter(characterId) {
    const state = memoryEngine?.ensureConversationState(this).rollingState;
    const segments = Array.isArray(state?.segments) ? state.segments : [];
    if (!segments.length) return this.canUseSharedRollingSummary(characterId) ? this.currentSummary : "";
    const legacy = this.canUseSharedRollingSummary(characterId) ? state.legacySummary || "" : "";
    return [legacy, ...segments.filter((segment) => segment.knownBy?.includes(Number(characterId))).map((segment) => segment.content)].filter(Boolean).join("\n\n");
  }
  getConfirmedActionContextFor(characterId) {
    const windows = this.getPresenceWindows(characterId);
    if (!windows.length && this.presenceInitialized) return null;
    const visible = (message) => !this.presenceInitialized || windows.some((window) =>
      Number(window.joinedAtMessageId ?? 0) <= Number(message.id) && (window.leftAtMessageId == null || Number(message.id) < Number(window.leftAtMessageId)));
    const lines = [];
    for (const message of this.messages) {
      if (!visible(message)) continue;
      const feedbacks = message.type === "action-feedback" ? message.feedbacks || [] : message.type === "action-approval" ? [message] : [];
      for (const feedback of feedbacks) {
        const change = feedback.diagnostic?.confirmedStateChange;
        if (feedback.lifecycle?.status !== "CONFIRMED" || !change) continue;
        const state = feedback.diagnostic?.stateAfter || {};
        if (change.type === "GOLD_TRANSFER") lines.push(`- 已确认转账：角色 ${change.sourceRuntimeId} 向角色 ${change.targetRuntimeId} 支付 ${change.amount} 金；核验后余额 ${state.sourceGold ?? "未知"} / ${state.targetGold ?? "未知"}。`);
        if (change.type === "OPINION_CHANGE") lines.push(`- 已确认好感变化：${change.amount >= 0 ? "+" : ""}${change.amount}；核验后好感 ${state.opinion ?? "未知"}。`);
      }
    }
    return lines.length ? `=== 本场已由 CK3 核验的动作结果 ===\n${lines.slice(-8).join("\n")}` : null;
  }
  async joinWaitingCharacter(characterId) {
    const numericId = Number(characterId);
    if (!this.canManagePresence()) return { success: false, error: "presence_change_busy" };
    if (this.departedCharacterIds.has(numericId)) return { success: false, error: "departed_character_cannot_rejoin" };
    if (!this.waitingCharacterIds.has(numericId)) return { success: false, error: "character_not_waiting" };
    const character = this.gameData.characters.get(numericId);
    if (!character || this.inactiveParticipantIds.has(numericId) || character.isDead === true || character.dead === true || character.alive === false) {
      return { success: false, error: "character_unavailable" };
    }
    this.captureSummaryParticipantProfiles([character]);
    this.waitingCharacterIds.delete(numericId);
    this.presentCharacterIds.add(numericId);
    const message = createMessage({ id: this.nextId++, role: "system", kind: "presence_join", characterId: numericId, content: `【${character.shortName || character.fullName}入内】` });
    this.messages.push(message);
    memoryEngine?.observeParticipants(this, [numericId], message.id);
    this.joinEvents.push({ characterId: numericId, atMessageId: message.id, atHistoryIndex: this.getHistory().length - 1 });
    this.emitUpdate();
    return { success: true, status: "present", messageId: message.id };
  }
  async leavePresentCharacter(characterId) {
    const numericId = Number(characterId);
    if (!this.canManagePresence()) return { success: false, error: "presence_change_busy" };
    if (!this.presentCharacterIds.has(numericId)) return { success: false, error: "character_not_present" };
    if (this.presentCharacterIds.size <= 1) return { success: false, error: "last_present_character_required" };
    const character = this.gameData.characters.get(numericId);
    if (!character || numericId === Number(this.gameData.playerID)) return { success: false, error: "character_unavailable" };
    this.captureSummaryParticipantProfiles([character]);
    const hasConversation = this.getHistory().some((message) => message.role === "user" || message.role === "assistant");
    if (!hasConversation) {
      memoryEngine?.markParticipantLeft(this, numericId, this.nextId);
      this.presentCharacterIds.delete(numericId);
      this.waitingCharacterIds.add(numericId);
      this.emitUpdate();
      return { success: true, status: "waiting", summaryGenerated: false };
    }
    const message = createMessage({ id: this.nextId++, role: "system", kind: "presence_leave", characterId: numericId, content: `【${character.shortName || character.fullName}离场】` });
    this.messages.push(message);
    memoryEngine?.markParticipantLeft(this, numericId, message.id);
    this.presentCharacterIds.delete(numericId);
    this.departedCharacterIds.add(numericId);
    this.npcQueue = this.npcQueue.filter((candidate) => Number(candidate?.id) !== numericId);
    if (this.customQueue) this.customQueue = this.customQueue.filter((candidate) => Number(candidate?.id) !== numericId);
    this.invalidateApprovalsForCharacter(numericId, "left");
    this.leaveEvents.push({ characterId: numericId, atMessageId: message.id, atHistoryIndex: this.getHistory().length - 1 });
    this.emitUpdate();
    const recoveryPath = this.checkpointFinalization("participant_left");
    return { success: true, status: "departed", messageId: message.id, summaryCheckpointed: !!recoveryPath, recoveryPath };
  }
  async temporarilyLeaveCharacter(characterId, mode) {
    const numericId = Number(characterId);
    const absenceMode = TEMPORARY_ABSENCE_MODES[mode];
    if (!this.canManagePresence()) return { success: false, error: "presence_change_busy" };
    if (!absenceMode) return { success: false, error: "invalid_temporary_absence_mode" };
    if (!this.presentCharacterIds.has(numericId)) return { success: false, error: "character_not_present" };
    const character = this.gameData.characters.get(numericId);
    if (!character || numericId === Number(this.gameData.playerID)) return { success: false, error: "character_unavailable" };
    this.captureSummaryParticipantProfiles([character]);
    const name = character.shortName || character.fullName;
    const message = createMessage({
      id: this.nextId++,
      role: "system",
      kind: "presence_temporary_leave",
      characterId: numericId,
      absenceMode: mode,
      content: absenceMode.leaveText(name)
    });
    this.messages.push(message);
    memoryEngine?.markParticipantLeft(this, numericId, message.id);
    this.presentCharacterIds.delete(numericId);
    this.temporarilyAbsentCharacterIds.set(numericId, { mode, leftAtMessageId: message.id });
    this.npcQueue = this.npcQueue.filter((candidate) => Number(candidate?.id) !== numericId);
    if (this.customQueue) this.customQueue = this.customQueue.filter((candidate) => Number(candidate?.id) !== numericId);
    this.invalidateApprovalsForCharacter(numericId, "temporarily_absent");
    this.leaveEvents.push({ characterId: numericId, atMessageId: message.id, atHistoryIndex: this.getHistory().length - 1, temporary: true, mode });
    this.emitUpdate();
    return { success: true, status: "temporarily_absent", mode, messageId: message.id, summaryGenerated: false };
  }
  async returnTemporaryCharacter(characterId) {
    const numericId = Number(characterId);
    if (!this.canManagePresence()) return { success: false, error: "presence_change_busy" };
    const temporaryAbsence = this.temporarilyAbsentCharacterIds?.get(numericId);
    if (!temporaryAbsence) return { success: false, error: "character_not_temporarily_absent" };
    const character = this.gameData.characters.get(numericId);
    if (!character || this.inactiveParticipantIds.has(numericId) || character.isDead === true || character.dead === true || character.alive === false) {
      return { success: false, error: "character_unavailable" };
    }
    const absenceMode = TEMPORARY_ABSENCE_MODES[temporaryAbsence.mode];
    const name = character.shortName || character.fullName;
    this.temporarilyAbsentCharacterIds.delete(numericId);
    this.presentCharacterIds.add(numericId);
    const message = createMessage({
      id: this.nextId++,
      role: "system",
      kind: "presence_temporary_return",
      characterId: numericId,
      absenceMode: temporaryAbsence.mode,
      content: absenceMode.returnText(name)
    });
    this.messages.push(message);
    memoryEngine?.observeParticipants(this, [numericId], message.id);
    this.joinEvents.push({ characterId: numericId, atMessageId: message.id, atHistoryIndex: this.getHistory().length - 1, temporaryReturn: true, mode: temporaryAbsence.mode });
    this.emitUpdate();
    return { success: true, status: "present", mode: temporaryAbsence.mode, messageId: message.id };
  }
  captureSummaryParticipantProfiles(characters = []) {
    if (!this.summaryParticipantProfiles) this.summaryParticipantProfiles = /* @__PURE__ */ new Map();
    for (const character of characters || []) {
      const id = Number(character?.id);
      if (!Number.isFinite(id)) continue;
      const personalName = getCharacterPersonalName(character, character.shortName || character.name || character.fullName);
      this.summaryParticipantProfiles.set(id, {
        id,
        name: personalName,
        firstName: character.firstName,
        shortName: personalName,
        fullName: character.fullName || character.shortName || personalName,
        primaryTitle: character.primaryTitle,
        heldCourtAndCouncilPositions: character.heldCourtAndCouncilPositions,
        titleRankConcept: character.titleRankConcept
      });
    }
    return this.summaryParticipantProfiles;
  }
  getSummaryParticipantProfile(characterId) {
    const numericId = Number(characterId);
    const current = this.gameData.characters.get(numericId);
    if (current) this.captureSummaryParticipantProfiles([current]);
    return this.summaryParticipantProfiles?.get(numericId) || null;
  }
  isCharacterAvailableForConversation(character) {
    if (!character || this.inactiveParticipantIds?.has(character.id)) return false;
    if (this.presenceInitialized && Number(character.id) !== Number(this.gameData?.playerID) && !this.presentCharacterIds.has(Number(character.id))) return false;
    return character.isDead !== true && character.dead !== true && character.alive !== false;
  }
  markParticipantInactive(characterId, reason) {
    memoryEngine?.markParticipantLeft(this, characterId, this.nextId);
    this.presentCharacterIds?.delete(Number(characterId));
    this.waitingCharacterIds?.delete(Number(characterId));
    this.temporarilyAbsentCharacterIds?.delete(Number(characterId));
    this.departedCharacterIds?.add(Number(characterId));
    const deactivated = participantLifecycle.deactivate(this, characterId, reason);
    if (reason === "dead" && Number(characterId) !== Number(this.gameData?.playerID)) {
      try {
        memoryEngine?.markSummaryOwnerDeceased(characterId, { reason });
      } catch (error) {
        console.error(`[Memory] Failed to mark summary owner ${characterId} as deceased:`, error);
      }
    }
    return deactivated;
  }
  invalidatePendingActionApproval(approvalId, reason) {
    const pending = this.pendingActionApprovals.get(approvalId);
    if (!pending) return false;
    this.pendingActionApprovals.delete(approvalId);
    const index = this.messages.findIndex((entry) => entry.type === "action-approval" && entry.id === approvalId);
    if (index !== -1) this.messages.splice(index, 1);
    console.log(`[Conversation] Removed unavailable action approval ${approvalId}: ${reason}`);
    this.emitUpdate();
    return true;
  }
  invalidateApprovalsForCharacter(characterId) {
    const numericId = Number(characterId);
    for (const [approvalId, pending] of [...this.pendingActionApprovals.entries()]) {
      const action = pending.action;
      if (Number(pending.npc?.id) === numericId || Number(action?.sourceCharacterId) === numericId || Number(action?.targetCharacterId) === numericId) {
        this.invalidatePendingActionApproval(approvalId, "character_unavailable");
      }
    }
  }
  isResponseCurrent(responseState, npc = null) {
    return this.getGenerationManager().isCurrent(responseState, npc);
  }
  recordGenerationSkippedAnalytics(responseState, reason) {
    usageAnalytics.record({
      requestType: "generation_skipped",
      reason,
      turnEpoch: responseState.turnEpoch,
      responseId: responseState.responseId,
      characterId: responseState.npcId
    }, null);
  }
  recordGenerationSkipped(responseState, reason) {
    this.getGenerationManager().recordSkipped(responseState, reason);
  }
  cancelActiveResponse(reason = "explicit_abort") {
    return this.getGenerationManager().cancel(reason);
  }
  // Handle response for a single NPC
  async respondAs(npc, turnEpoch = this.turnEpoch, { narrationRewriteOf = null } = {}) {
    if (this.isV813PrefixEnabled?.()) npc = this.gameData.characters.get(Number(npc?.id)) || npc;
    if (turnEpoch !== this.turnEpoch || !this.isCharacterAvailableForConversation(npc)) {
      console.log(`[Conversation] Skipping unavailable NPC response: ${npc?.shortName || npc?.id || "unknown"}`);
      return;
    }
    this.resetContextUsageScene(turnEpoch);
    let diagnosticsContext = null;
    try { diagnosticsContext = this.performanceTraceContext?.nextTurn?.() || null; } catch (_error) {}
    const conversationTurnSpan = startTraceSpan(performanceTrace, "conversation.turn", { attribution: "MAIN", context: diagnosticsContext });
    let conversationTurnResult = "OK";
    // Clear mentioned characters from previous message
    // NOTE: We don't clear the cache here because we want to reuse it
    // within the same conversation if the player hasn't sent new messages
    if (this.gameData.mentionedCharactersInContext) {
      this.gameData.mentionedCharactersInContext.clear();
    }
    const narrationTarget = narrationRewriteOf == null ? null
      : this.messages.find(message => message.id === narrationRewriteOf && message.role === "assistant"
        && Number(message.speakerCharacterId) === Number(npc.id));
    if (narrationRewriteOf != null && !narrationTarget) return { success: false, error: "原回复已不存在，未修改台词。" };
    const originalNarration = narrationTarget?.content;
    let narrationCommitted = false;
    
    const msgId = this.nextId++;
    const placeholder = createMessage({
      id: msgId,
      role: "assistant",
      speakerCharacterId: Number(npc.id),
      name: npc.fullName,
      content: "",
      isStreaming: true,
      // DeepSeek can stream hidden reasoning before visible dialogue. The UI
      // receives only its state, never the reasoning text.
      streamStatus: "thinking"
    });
    const responseState = this.getGenerationManager().start({ turnEpoch, messageId: msgId, npcId: npc.id });
    if (narrationTarget) responseState.narrationRewriteOf = narrationRewriteOf;
    const currentTurn = this.getTurnManager().currentTurn;
    this.generationAttemptsByMessageId.set(msgId, {
      logicalPlayerMessageId: currentTurn?.playerMessageId ?? null,
      turnEpoch,
      responderId: Number(npc.id),
      hasActionOutcome: false,
      ...(narrationTarget ? { narrationRewriteOf } : {})
    });
    const controller = responseState.controller;
    this.messages.push(placeholder);
    this.emitUpdate();
    let wasCancelled = false;
    let streamCompleted = false;
    let settleContextUsageAfterFailure = null;
    try {
      const memoryContext = await this.checkAndSummarizeIfNeeded(npc, diagnosticsContext);
      if (!this.isResponseCurrent(responseState, npc)) throw new Error("AbortError: Message cancelled");
      const promptBuildStartedAt = Date.now();
      const activeConfig = settingsRepository.getActiveProviderConfig();
      const promptGameRevision = () => planFingerprint([this.gameData.campaignToken, this.gameData.date, this.gameData.totalDays,
        this.gameData.scene, this.gameData.location, this.gameData.locationController]);
      const builtGameRevision = promptGameRevision();
      const promptBuild = traceOperation(performanceTrace, "prompt.build", { attribution: "MAIN", context: diagnosticsContext }, () => PromptBuilder.buildMessagesWithTokenCount(
        this.getPromptHistoryForCharacter(npc.id),
        npc,
        this.gameData,
        this.getPromptSummaryForCharacter(npc.id),
        memoryContext,
        activeConfig,
        { promptPlanScope: { campaignToken: this.gameData.campaignToken, conversationId: this.id, ownerId: Number(npc.id),
            responderId: Number(npc.id), playerId: Number(this.gameData.playerID), conversationEpoch: this.conversationEpoch, logicalTurnEpoch: turnEpoch },
          ...(narrationTarget ? { currentTurnInstructions: "请只重新表达你在本轮的最后一条台词，不要续写新一轮，也不要重新回应其后的发言。已经发生的游戏动作及其结果保持不变；不得撤销、重复或新增动作，只输出替换台词。" } : {}) }
      ));
      const promptBuildMs = Date.now() - promptBuildStartedAt;
      const llmMessages = promptBuild.messages;
      const chatPlanProof = promptBuild.promptPlan ? { plan: promptBuild.promptPlan, serialized: promptBuild.serialized, ownerEvidence: true } : null;
      const promptBlockMetadata = Conversation.buildPromptBlockMetadata(promptBuild);
      const promptBlockTokens = (id) => promptBlockMetadata.blocks.filter((block) => block.id === id).reduce((total, block) => total + (Number(block.tokens) || 0), 0);
      const mentionedSnapshotTokens = promptBlockTokens("memory-mentioned-snapshot");
      const thirdPartyEvidenceTokens = promptBlockTokens("third-party-evidence-patch");
      const turnRecallTokens = promptBlockTokens("memory-turn-recall");
      const worldlineTokens = promptBlockTokens("worldline-stable") + promptBlockTokens("worldline-turn-recall");
      const totalMemoryTokens = promptBlockTokens("memory-stable") + promptBlockTokens("memory-direct-frozen")
        + promptBlockTokens("memory-official-recollection") + promptBlockTokens("memory-player-ledger-frozen")
        + mentionedSnapshotTokens + promptBlockTokens("memory-dynamic-frozen") + promptBlockTokens("memory-dynamic-pending") + promptBlockTokens("memory-temporal-extra") + promptBlockTokens("memory-session-topic-anchor") + turnRecallTokens + thirdPartyEvidenceTokens;
      const renderedMemoryTokens = typeof PromptBuilder.getMemoryBlockTokenCount === "function"
        ? PromptBuilder.getMemoryBlockTokenCount(promptBuild) : totalMemoryTokens;
      if (memoryContext?.playerCenteredRecallEnabled && renderedMemoryTokens > memoryContext.tokenBudget) throw new Error("chat_memory_budget_exceeded");
      const memoryAttemptDiagnostics = {};
      let memoryAttemptDiagnosticsCaptured = false;
      logVerboseLLM(`[Conversation][verbose] Prompt for ${npc.fullName}:`, llmMessages);
      const estimatedTokenCount = traceOperation(performanceTrace, "tokenEstimate", { attribution: "MAIN", context: diagnosticsContext, count: llmMessages.length }, () => this.estimateTokenCount(llmMessages));
      console.log(`[TOKEN_COUNT] Message from ${npc.fullName}:`, estimatedTokenCount);
      const isOpenRouter = activeConfig?.providerType === "openrouter";
      const contextDiagnostics = this.contextBudgetDiagnostics || {};
      const contextWindowTokens = tokenCountOrNull(contextDiagnostics.contextWindow);
      const providerMaxOutputTokens = tokenCountOrNull(contextDiagnostics.providerMaxOutputTokens);
      let requestBudget = contextWindowTokens != null && providerMaxOutputTokens != null
        ? planRequestBudget({ messages: llmMessages,
          capabilities: { contextWindow: contextWindowTokens, maxOutputTokens: providerMaxOutputTokens },
          requestedOutputTokens: activeConfig?.providerType === "deepseek" ? 4096
            : Number(activeConfig?.defaultParameters?.max_tokens) || providerMaxOutputTokens,
          countTokens: items => this.estimateTokenCount(items) }) : null;
      let providerUsage = null;
      let requestPhase = "request_snapshot";
      let lastContextUsageUpdateAt = 0;
      let lastContextUsageContentLength = 0;
      const contextSceneRevision = JSON.stringify([this.gameData?.scene || null, this.gameData?.location || null,
        this.gameData?.locationController || null]);
      const publishContextUsage = (phase, force = false) => {
        const terminalForLatestRequest = (phase === "cancelled" || phase === "failed")
          && this.contextUsageByResponder?.get?.(Number(npc.id))?.requestId === msgId;
        if (!requestBudget || contextSceneRevision !== this.contextUsageSceneRevision
          || !this.isResponseCurrent(responseState, npc) && !terminalForLatestRequest) return;
        const now = Date.now();
        if (phase === "streaming" && !force && now - lastContextUsageUpdateAt < 500
          && placeholder.content.length - lastContextUsageContentLength < 256) return;
        const nativeUsage = providerUsage?.native || {};
        const actualInputTokens = tokenCountOrNull(nativeUsage.inputTokens);
        const actualOutputTokens = tokenCountOrNull(nativeUsage.outputTokens);
        const estimatedOutputTokens = tokenCountOrNull(providerUsage?.estimated?.outputTokens)
          ?? tokenCountOrNull(TokenCounter.estimateTokens(placeholder.content));
        const inputTokens = actualInputTokens ?? tokenCountOrNull(requestBudget.estimatedInputTokens);
        const outputTokens = actualOutputTokens ?? estimatedOutputTokens;
        const usedTokens = inputTokens != null && outputTokens != null ? inputTokens + outputTokens : null;
        const source = actualInputTokens != null && actualOutputTokens != null ? "provider_usage"
          : actualInputTokens != null || actualOutputTokens != null ? "provider_usage_partial_estimate" : "estimated";
        lastContextUsageUpdateAt = now;
        lastContextUsageContentLength = placeholder.content.length;
        this.publishContextUsage({
          conversationId: this.id,
          conversationEpoch: this.conversationEpoch,
          turnEpoch,
          sceneRevision: contextSceneRevision,
          requestId: msgId,
          responderId: Number(npc.id),
          responderName: npc.fullName || npc.shortName || "姓名未载入",
          provider: contextDiagnostics.provider || activeConfig?.providerType || null,
          model: contextDiagnostics.model || activeConfig?.defaultModel || null,
          contextWindowTokens,
          contextWindowSource: contextDiagnostics.contextWindowSource || null,
          configuredContextLength: tokenCountOrNull(contextDiagnostics.configuredContextLength),
          phase,
          estimatedInputTokens: requestBudget.estimatedInputTokens,
          inputTokens,
          inputTokensSource: actualInputTokens != null ? "provider_usage" : "estimated",
          outputTokens,
          outputTokensSource: actualOutputTokens != null ? "provider_usage"
            : ["streaming", "failed", "cancelled"].includes(phase) ? "provisional_estimate" : "estimated",
          usedTokens,
          remainingContextTokens: usedTokens == null ? null : contextWindowTokens - usedTokens,
          effectiveInputBudget: requestBudget.effectiveInputBudget,
          inputHeadroomBeforeSendTokens: Math.max(0, Math.floor((requestBudget.effectiveInputBudget - requestBudget.estimatedInputTokens) / 1.1)),
          reservedOutputTokens: requestBudget.reservedOutputTokens,
          protocolOverheadTokens: requestBudget.protocolOverheadTokens,
          safetyMarginTokens: requestBudget.safetyMarginTokens,
          usageStatus: providerUsage?.provenance?.status || "NOT_REPORTED",
          updatedAt: new Date(now).toISOString(),
          usageSource: source
        }, responseState);
      };
      settleContextUsageAfterFailure = phase => {
        requestPhase = phase;
        publishContextUsage(phase, true);
      };
      publishContextUsage("request_snapshot", true);
      const onContinuationRequest = (messages) => {
        if (chatPlanProof) {
          extendContinuationProof(chatPlanProof, messages, items => this.estimateTokenCount(items));
          chatRequestMetadata.cacheDiagnosticContext.messageSpans = chatPlanProof.serialized.messageSpans;
          chatRequestMetadata.cacheDiagnosticContext.blockMetadata = chatPlanProof.serialized.blockMetadata;
        }
        if (!contextWindowTokens || !providerMaxOutputTokens) return;
        requestBudget = planRequestBudget({ messages,
          capabilities: { contextWindow: contextWindowTokens, maxOutputTokens: providerMaxOutputTokens },
          requestedOutputTokens: activeConfig?.providerType === "deepseek" ? 4096
            : Number(activeConfig?.defaultParameters?.max_tokens) || providerMaxOutputTokens,
          countTokens: items => this.estimateTokenCount(items) });
        providerUsage = null;
        requestPhase = "request_snapshot";
        lastContextUsageUpdateAt = 0;
        lastContextUsageContentLength = 0;
        publishContextUsage("request_snapshot", true);
      };
      const onContinuationOutcome = (outcome, content) => {
        placeholder.content = content;
        providerUsage = outcome.usage;
        requestPhase = "completed";
        publishContextUsage("completed", true);
      };
      const chatRequestMetadata = {
          requestType: "chat",
          ...(promptBuild.promptPlanFallbackReason ? { cacheDiagnosticContext: {
            fallbackReason: promptBuild.promptPlanFallbackReason, plan: { evidenceStatus: "LEGACY_OBSERVED" } } } : {}),
          ...(chatPlanProof ? {
            promptPlanProof: chatPlanProof,
            cacheDiagnosticContext: { plan: { layoutId: chatPlanProof.plan.layoutId, layoutRevision: chatPlanProof.plan.layoutRevision,
              stablePrefixCandidateTokens: promptBuild.promptPlanPrefix?.stablePrefixCandidateTokens },
              messageSpans: chatPlanProof.serialized.messageSpans, blockMetadata: chatPlanProof.serialized.blockMetadata },
            beforeTransportGuard: (snapshot, proof, budget) => preflightPromptPlan({ snapshot, proof, budget,
              expectedScope: { campaignToken: this.gameData.campaignToken, conversationId: this.id, ownerId: Number(npc.id),
                responderId: Number(npc.id), playerId: Number(this.gameData.playerID), conversationEpoch: this.conversationEpoch, logicalTurnEpoch: turnEpoch },
              proofVerifier: () => {
                if (builtGameRevision !== promptGameRevision()) {
                  const error = new Error("PLAN_SOURCE_REVOKED"); error.code = "PLAN_SOURCE_REVOKED"; throw error;
                }
                chatRequestMetadata.beforeSendGuard();
                return true;
              } })
          } : {}),
          onProviderEvent: (event) => {
            if (event?.type !== "USAGE_UPDATE" || !this.isResponseCurrent(responseState, npc)) return;
            if (event.usage?.native) providerUsage = event.usage;
            if (requestPhase === "streaming" && event.usage?.native) publishContextUsage("streaming");
          },
          beforeSendGuard: () => {
            if (narrationTarget && (!this.messages.includes(narrationTarget) || narrationTarget.content !== originalNarration)) {
              const error = new Error("Original narration changed before send");
              error.name = "AbortError";
              throw error;
            }
            if (!this.isResponseCurrent(responseState, npc)) {
              const error = new Error("Responder or turn changed before send");
              error.name = "AbortError";
              throw error;
            }
            if (memoryContext?.characterKnowledgeRevision
              && this.getCharacterDisclosureContext(npc, memoryContext.disclosureTargetIds).characterKnowledgeRevision !== memoryContext.characterKnowledgeRevision) {
              this.cacheV2FrozenSnapshots?.prefixByResponder?.clear();
              const error = new Error("Character knowledge source changed before send");
              error.name = "AbortError";
              throw error;
            }
            if (memoryContext?.playerCenteredRecallEnabled) {
              if (memoryContext.sourceSceneRevision != null && memoryContext.sourceSceneRevision !== JSON.stringify([
                  this.gameData.scene || null, this.gameData.location || null, this.gameData.locationController || null])) {
                const error = new Error("Memory responder or turn changed before send");
                error.name = "AbortError";
                throw error;
              }
              const validation = memoryEngine.validatePlayerMemoryContext(memoryContext, this.gameData, this.id);
              if (!validation.valid) {
                this.cacheV2FrozenSnapshots?.prefixByResponder?.clear();
                this.dynamicRecallHistory?.clear();
                const error = new Error(`Memory source changed before send: ${validation.reason}`);
                error.name = "AbortError";
                throw error;
              }
            } else if (memoryContext?.sourceFolderRevision != null && (
              memoryEngine.store.getFolderSummaryRevision(npc.id) !== memoryContext.sourceFolderRevision
              || this.gameData.campaignToken !== memoryContext.sourceCampaignToken
              || (memoryContext.sourcePairIds || []).some(id => memoryEngine.store.hasPairLedgerSourceContentChanges(
                memoryEngine.store.folderSummaryCache.get(Number(npc.id)) || [], id)))) {
              const error = new Error("Legacy memory source changed before send");
              error.name = "AbortError";
              throw error;
            }
            if (!this.isResponseCurrent(responseState, npc)) {
              const error = new Error("Responder or turn changed before send");
              error.name = "AbortError";
              throw error;
            }
            if (!memoryAttemptDiagnosticsCaptured) {
              memoryAttemptDiagnosticsCaptured = true;
              try {
                const { buildMemoryAttemptDiagnostics } = require("../memory-system/player-memory-diagnostics");
                if (typeof buildMemoryAttemptDiagnostics === "function") {
                  const attemptTurn = this.getTurnManager().currentTurn;
                  const logicalPlayerMessageId = attemptTurn?.playerMessageId ?? null;
                  const diagnostics = buildMemoryAttemptDiagnostics({
                    memoryContext,
                    promptBuild,
                    logicalPlayerMessageId,
                    attemptEpoch: responseState.turnEpoch,
                    regenerateOf: narrationRewriteOf ?? attemptTurn?.regenerateOfByResponder?.[Number(npc.id)] ?? null,
                    previous: logicalPlayerMessageId == null
                      ? null : this.memoryAttemptDiagnosticsByOwner.get(Number(npc.id)) || null
                  });
                  if (diagnostics && typeof diagnostics === "object") {
                    Object.assign(memoryAttemptDiagnostics, diagnostics);
                    if (logicalPlayerMessageId != null) {
                      this.memoryAttemptDiagnosticsByOwner.set(Number(npc.id), diagnostics);
                    }
                  }
                }
              } catch (_error) {
                console.warn("[MemoryDiagnostics] Memory attempt diagnostics unavailable");
              }
            }
          },
          memoryAttemptDiagnostics,
          conversationId: this.id,
          responderId: npc.id,
          ...(diagnosticsContext ? { performanceTraceContext: diagnosticsContext } : {}),
          character: npc.shortName,
          characterId: npc.id,
          blocks: promptBlockMetadata.blocks,
          historyStartPosition: promptBlockMetadata.historyStartPosition,
          stablePrefixEndPosition: promptBlockMetadata.stablePrefixEndPosition,
          stablePrefixTokens: promptBlockMetadata.stablePrefixTokens,
          dynamicSuffixTokens: promptBlockMetadata.dynamicSuffixTokens,
          prefixFingerprint: promptBlockMetadata.prefixFingerprint,
          promptProfile: promptBuild.promptProfile,
          staticTokens: promptBuild.staticTokens,
          dynamicTokens: promptBuild.dynamicTokens,
          globalStaticTokens: promptBuild.globalStaticTokens,
          conversationFrozenTokens: promptBuild.conversationFrozenTokens,
          responderFrozenTokens: promptBuild.responderFrozenTokens,
          stableKinshipTokens: promptBuild.stableKinshipTokens,
          actualStablePrefixTokens: promptBuild.actualStablePrefixTokens,
          declaredStaticTokens: promptBuild.declaredStaticTokens,
          dynamicTailTokens: promptBuild.dynamicTailTokens,
          memoryStableTokens: promptBlockTokens("memory-stable"),
          memoryDirectTokens: promptBlockTokens("memory-direct-frozen"),
          memoryTopicTokens: promptBlockTokens("memory-session-topic-anchor"),
          memoryMentionedSnapshotTokens: mentionedSnapshotTokens,
          mentionedSnapshotTokens,
          memoryTurnRecallTokens: turnRecallTokens,
          turnRecallTokens,
          thirdPartyEvidenceTokens,
          totalMemoryTokens,
          ...(memoryContext?.playerCenteredRecallEnabled ? { renderedMemoryTokens,
            pairMemoryMetrics: memoryContext.pairMemoryMetrics,
            memoryBudgetTokens: memoryContext.tokenBudget, memoryBudgetPlan: memoryContext.memoryBudgetPlan,
            memoryPlayerLedgerTokens: promptBlockTokens("memory-player-ledger-frozen"),
            memoryOfficialTokens: promptBlockTokens("memory-official-recollection") } : {}),
          worldStableTokens: promptBlockTokens("worldline-stable"),
          worldTurnRecallTokens: promptBlockTokens("worldline-turn-recall"),
          worldlineTokens,
          worldRetrievalMs: memoryContext?.worldlineMetrics?.worldRetrievalMs || 0,
          worldPolicyMs: memoryContext?.worldlineMetrics?.worldPolicyMs || 0,
          worldFormatMs: memoryContext?.worldlineMetrics?.worldFormatMs || 0,
          memoryRecallMs: memoryContext?.worldlineMetrics?.memoryRecallMs || 0,
          promptBuildMs,
          worldSharedCacheHit: memoryContext?.worldlineMetrics?.sharedWorldCacheHit === true,
          worldSubjectiveCacheHit: memoryContext?.worldlineMetrics?.subjectiveCacheHit === true,
          contextBudget: this.contextBudgetDiagnostics || null,
          activeRawMessageCount: this.getPromptHistoryForCharacter(npc.id).length,
          rollingSegmentCount: this.memoryState?.rollingState?.segments?.length || 0,
          cacheEpoch: this.memoryState?.rollingState?.cacheEpoch || 0
      };
      const result = await llmManager.sendChatRequest(
        llmMessages,
        isOpenRouter ? void 0 : controller.signal,
        void 0,
        chatRequestMetadata
      );
      let chatCachedTokens = null;
      if (settingsRepository.getGlobalStreamSetting() && typeof result === "object" && typeof result[Symbol.asyncIterator] === "function") {
        try {
          const streamIterator = result;
          let finalResponse = null;
          if (isOpenRouter) {
            const streamPromise = (async () => {
              const iterator = streamIterator[Symbol.asyncIterator]();
              while (true) {
                const step = await iterator.next();
                if (step.done) { finalResponse = step.value; break; }
                const chunk = step.value;
                if (wasCancelled || controller.signal.aborted || !this.isResponseCurrent(responseState, npc)) {
                  wasCancelled = true;
                  continue;
                }
                if (chunk.delta?.reasoning) {
                  placeholder.streamStatus = "thinking";
                  this.emitUpdate();
                }
                if (chunk.delta?.content) {
                  placeholder.streamStatus = "generating";
                  placeholder.content += chunk.delta.content;
                  this.emitUpdate();
                  const enteringStream = requestPhase !== "streaming";
                  requestPhase = "streaming";
                  publishContextUsage("streaming", enteringStream);
                }
              }
            })();
            const checkCancellation = async () => {
              while (!streamCompleted && !wasCancelled) {
                if (controller.signal.aborted || !this.isResponseCurrent(responseState, npc)) {
                  wasCancelled = true;
                  console.log("[OpenRouter] Cancellation detected - stream will continue in background");
                  streamPromise.catch((err) => console.error("[OpenRouter] Background stream error:", err));
                  throw new Error("AbortError: Message cancelled");
                }
                await new Promise((resolve) => setTimeout(resolve, 100));
              }
            };
            await Promise.race([streamPromise, checkCancellation()]);
            streamCompleted = true;
          } else {
            const iterator = streamIterator[Symbol.asyncIterator]();
            while (true) {
              const step = await iterator.next();
              if (step.done) { finalResponse = step.value; break; }
              const chunk = step.value;
              if (controller.signal.aborted || !this.isResponseCurrent(responseState, npc)) {
                wasCancelled = true;
                throw new Error("AbortError: Message cancelled");
              }
              if (chunk.delta?.reasoning) {
                placeholder.streamStatus = "thinking";
                this.emitUpdate();
              }
              if (chunk.delta?.content) {
                placeholder.streamStatus = "generating";
                placeholder.content += chunk.delta.content;
                this.emitUpdate();
                const enteringStream = requestPhase !== "streaming";
                requestPhase = "streaming";
                publishContextUsage("streaming", enteringStream);
              }
            }
            streamCompleted = true;
          }
          const outcome = validateGenerationOutcome(finalResponse);
          chatCachedTokens = outcome.cachedTokens;
          if (outcome.truncated) {
            placeholder.content = await this.completeTruncatedResponse(llmMessages, placeholder.content, responseState, npc,
              diagnosticsContext, chatRequestMetadata, onContinuationRequest, onContinuationOutcome);
            this.emitUpdate();
          } else if (!outcome.complete) {
            throw new Error(`chat_generation_incomplete:${outcome.finishReason || "unknown"}`);
          } else {
            providerUsage = outcome.usage;
            requestPhase = "completed";
            publishContextUsage("completed", true);
          }
        } catch (streamError) {
          if (streamError instanceof Error && streamError.message === "AbortError: Message cancelled") {
            wasCancelled = true;
            throw streamError;
          }
          throw streamError;
        }
        if (!this.isResponseCurrent(responseState, npc)) throw new Error("AbortError: Message cancelled");
        placeholder.isStreaming = false;
        delete placeholder.streamStatus;
        if (streamCompleted && !wasCancelled && !narrationTarget) {
          this.getGenerationManager().markPhase(responseState, "evaluating_actions");
          await this.evaluateCompletedActions(npc, msgId, placeholder, responseState);
        }
      } else if (result && typeof result === "object" && "content" in result && typeof result.content === "string") {
        if (!this.isResponseCurrent(responseState, npc)) throw new Error("AbortError: Message cancelled");
        const outcome = validateGenerationOutcome(result);
        chatCachedTokens = outcome.cachedTokens;
        if (!outcome.complete && !outcome.truncated) throw new Error(`chat_generation_incomplete:${outcome.finishReason || "unknown"}`);
        placeholder.content = outcome.truncated
          ? await this.completeTruncatedResponse(llmMessages, result.content, responseState, npc,
            diagnosticsContext, chatRequestMetadata, onContinuationRequest, onContinuationOutcome)
          : result.content;
        if (!outcome.truncated) {
          providerUsage = outcome.usage;
          requestPhase = "completed";
          publishContextUsage("completed", true);
        }
        placeholder.streamStatus = "generating";
        this.emitUpdate();
        placeholder.isStreaming = false;
        delete placeholder.streamStatus;
        streamCompleted = true;
        if (!narrationTarget) {
          this.getGenerationManager().markPhase(responseState, "evaluating_actions");
          await this.evaluateCompletedActions(npc, msgId, placeholder, responseState);
        }
      } else {
        throw new Error("Bad LLM response format");
      }
      if (this.isResponseCurrent(responseState, npc)) this.retainDynamicSummaryRecall(npc.id,
        narrationTarget ? narrationRewriteOf : msgId, promptBuild, turnEpoch);
      if (chatCachedTokens != null) memoryEngine.trace.record("provider_cache_usage", { characterId: npc.id, conversationId: this.id, cachedTokens: chatCachedTokens });
      if (narrationTarget) {
        if (!this.isResponseCurrent(responseState, npc) || !this.messages.includes(narrationTarget)
          || narrationTarget.content !== originalNarration) throw new Error("AbortError: Message cancelled");
        narrationTarget.content = placeholder.content;
        this.messages = this.messages.filter(message => message !== placeholder);
        this.generationAttemptsByMessageId.delete(msgId);
        narrationCommitted = true;
      }
      if (streamCompleted && !wasCancelled && this.isResponseCurrent(responseState, npc)) this.recordCharacterDisclosures();
    } catch (error) {
      require("../memory-system/dynamic-summary-freeze").discardPendingSources(this.memoryState?.responderRecallCache, npc.id, turnEpoch);
      const staleResponse = responseState.stale || controller.signal.aborted || !this.isResponseCurrent(responseState, npc) || error instanceof Error && error.message === "AbortError: Message cancelled";
      settleContextUsageAfterFailure?.(staleResponse ? "cancelled" : "failed");
      if (staleResponse) {
        conversationTurnResult = "CANCELLED";
        wasCancelled = true;
        this.generationAttemptsByMessageId.delete(msgId);
        this.messages = this.messages.filter((msg) => msg.id !== msgId || !msg.isStreaming);
        this.recordGenerationSkipped(responseState, responseState.staleReason || (this.isCharacterAvailableForConversation(npc) ? "stale_generation" : "inactive_participant_generation"));
      } else {
        conversationTurnResult = "ERROR";
        this.getGenerationManager().fail(responseState);
        console.error("Failed to get response for", npc.shortName, ":", error);
        this.messages = this.messages.filter((msg) => msg.id !== msgId);
        const memoryContextOverflow = error?.code === "MEMORY_CONTEXT_OVERFLOW";
        const err = createError({
          id: this.nextId++,
          content: memoryContextOverflow ? formatMemoryContextOverflow(error.memoryBudgetDetails)
            : `Failed to get response from ${npc.shortName}`,
          details: memoryContextOverflow ? null : error instanceof Error ? error.message : String(error),
          memoryBudgetDetails: memoryContextOverflow ? error.memoryBudgetDetails : null,
          responderCharacterId: Number(npc.id)
        });
        const failedAttempt = this.generationAttemptsByMessageId.get(msgId);
        if (failedAttempt) this.generationAttemptsByMessageId.set(err.id, { ...failedAttempt });
        this.generationAttemptsByMessageId.delete(msgId);
        this.messages.push(err);
        if (this.npcQueue.length > 0) this.pauseConversation();
      }
    } finally {
      try {
        this.getGenerationManager().finish(responseState, { wasCancelled });
      } finally {
        finishTraceSpan(conversationTurnSpan, { result: conversationTurnResult, errorCode: conversationTurnResult === "ERROR" ? "provider_error" : undefined });
      }
    }
    if (narrationTarget) return narrationCommitted ? { success: true, mode: "NARRATION_ONLY" }
      : { success: false, error: "台词重新生成未完成，原回复与动作结果已保留。" };
  }
  async evaluateCompletedActions(npc, npcMessageId, npcMessage, responseState) {
    if (!this.isResponseCurrent(responseState, npc)) {
      this.recordGenerationSkipped(responseState, responseState?.staleReason || "stale_action_evaluation");
      return;
    }
    const generationAttempt = this.generationAttemptsByMessageId.get(npcMessageId);
    if (generationAttempt) generationAttempt.actionEvaluationPending = true;
    const actionResults = await ActionEngine.evaluateForCharacter(this, npc, responseState.controller.signal);
    if (!this.isResponseCurrent(responseState, npc)) {
      this.recordGenerationSkipped(responseState, responseState?.staleReason || "stale_action_evaluation");
      return;
    }
    if (generationAttempt) {
      generationAttempt.actionEvaluationPending = false;
      generationAttempt.hasActionOutcome = (actionResults?.autoApproved?.length || 0) > 0
        || (actionResults?.needsApproval?.length || 0) > 0;
    }
    await this.handleActionResults(npcMessageId, npc, actionResults);
  }
  async completeTruncatedResponse(originalMessages, partialContent, responseState, npc, diagnosticsContext = null,
    initialRequestMetadata = {}, onContinuationRequest = null, onContinuationOutcome = null) {
    if (!partialContent?.trim()) throw new Error("chat_generation_truncated_without_content");
    const continuationMessages = [
      ...originalMessages,
      { role: "assistant", content: partialContent },
      { role: "user", content: "请从刚才截断的位置继续完成上一条回复，不要重复已写内容。" }
    ];
    onContinuationRequest?.(continuationMessages);
    const response = await llmManager.sendChatRequest(continuationMessages, responseState.controller.signal, true, {
      ...initialRequestMetadata,
      requestType: "chat_continuation",
      conversationId: this.id,
      responderId: npc.id,
      ...(diagnosticsContext ? { performanceTraceContext: diagnosticsContext } : {}),
      continuationAttempt: 1
    });
    if (!this.isResponseCurrent(responseState, npc)) throw new Error("AbortError: Message cancelled");
    const outcome = validateGenerationOutcome(response);
    if (!outcome.complete || !outcome.content.trim()) throw new Error("chat_continuation_incomplete");
    let overlap = 0;
    const maxOverlap = Math.min(160, partialContent.length, outcome.content.length);
    for (let size = maxOverlap; size > 0; size--) {
      if (partialContent.endsWith(outcome.content.slice(0, size))) { overlap = size; break; }
    }
    const content = partialContent + outcome.content.slice(overlap);
    onContinuationOutcome?.(outcome, content);
    return content;
  }
  /**
   * Handle action results using the official VOTC 2.0.3 approval flow.
   */
  async handleActionResults(associatedMessageId, npc, actionResults) {
    const autoFeedbackResults = [...actionResults.autoApproved];
    for (const action of actionResults.needsApproval) {
      let previewFeedback;
      let previewSentiment;
      try {
        const previewResult = await ActionEngine.runInvocation(this, npc, action.invocation, { dryRun: true });
        if (previewResult.feedback?.message) {
          previewFeedback = previewResult.feedback.message;
          previewSentiment = previewResult.feedback.sentiment || "neutral";
        } else {
          const executed = await ActionEngine.runInvocation(this, npc, action.invocation);
          autoFeedbackResults.push(executed);
          continue;
        }
      } catch (error) {
        console.error("[Conversation] Preview action failed:", error);
      }
      const approvalEntry = createActionApproval({
        id: this.nextId++,
        associatedMessageId,
        action: {
          actionId: action.actionId,
          actionTitle: action.actionTitle,
          sourceCharacterId: action.sourceCharacterId,
          sourceCharacterName: action.sourceCharacterName,
          targetCharacterId: action.targetCharacterId,
          targetCharacterName: action.targetCharacterName,
          args: action.args,
          isDestructive: action.isDestructive
        },
        previewFeedback,
        previewSentiment,
        lifecycle: action.lifecycle || null,
        diagnostic: action.diagnostic || null
      });
      this.messages.push(approvalEntry);
      this.pendingActionApprovals.set(approvalEntry.id, {
        npc,
        action,
        previewFeedback,
        previewSentiment,
        approvalEntryId: approvalEntry.id
      });
    }
    if (autoFeedbackResults.length > 0) {
      this.addActionFeedback(associatedMessageId, autoFeedbackResults);
      for (const result of autoFeedbackResults) this.scheduleActionConfirmation(associatedMessageId, result);
    }
    const approvalSettings = settingsRepository.getActionApprovalSettings();
    if (this.pendingActionApprovals.size > 0 && approvalSettings.pauseOnApproval && this.npcQueue.length > 0) this.pauseConversation();
    if (this.pendingActionApprovals.size > 0) this.emitUpdate();
  }
  addActionFeedback(associatedMessageId, actionResults) {
    console.log("[Conversation] addActionFeedback called with results:", actionResults);
    const feedbackItems = actionResults.filter((r) => r.feedback || r.error || r.lifecycle || r.diagnostic).map((r) => ({
      actionId: r.actionId,
      success: r.success,
      message: r.feedback?.message || r.error || (r.success === false ? "Unknown error" : "Action completed"),
      sentiment: r.feedback?.sentiment || "negative",
      lifecycle: r.lifecycle || null,
      diagnostic: r.diagnostic || null
    }));
    console.log("[Conversation] Filtered feedback items:", feedbackItems);
    if (feedbackItems.length > 0) {
      const feedbackEntry = createActionFeedback({
        id: this.nextId++,
        associatedMessageId,
        feedbacks: feedbackItems
      });
      console.log("[Conversation] Creating feedback entry:", feedbackEntry);
      this.messages.push(feedbackEntry);
      this.emitUpdate();
      console.log("[Conversation] Feedback entry added and update emitted");
      return feedbackEntry;
    } else {
      console.log("[Conversation] No feedback items to display");
      return null;
    }
  }
  getRunCommand(commandId) {
    if (!commandId || !runFileManager) return null;
    return [...runFileManager.getPendingCommands(), ...runFileManager.getRecentCommands()].find((command) => command.commandId === commandId) || null;
  }
  async refreshGameDataForActionConfirmation() {
    const ck3DebugPath = settingsRepository.getCK3DebugLogPath();
    if (!ck3DebugPath) throw new Error("ck3_debug_log_path_not_configured");
    const gameData = await this.parseCK3GameData(ck3DebugPath);
    gameData.loadCharactersSummaries();
    gameData.syncOfficialRecollectionSummaries?.(this.id);
    this.gameData = gameData;
    this.gameDataRevision += 1;
    this.gameData.gameDataRevision = this.gameDataRevision;
    this.stableProfileCache.clear();
    this.stableDescriptionCache.clear();
    this.cacheV2FrozenSnapshots.responders.clear();
    this.cacheV2FrozenSnapshots.prefixByResponder.clear();
    return this.gameData;
  }
  async waitForActionConfirmation(result, { timeoutMs = 12e3, pollMs = 500 } = {}) {
    if (!result?.confirmation) return result;
    let observedWriteAt = null;
    let observedDispatch = result.lifecycle?.dispatched === true;
    const dispatches = Array.isArray(result.confirmation.dispatches) && result.confirmation.dispatches.length > 0
      ? result.confirmation.dispatches
      : [result.confirmation.dispatch].filter(Boolean);
    const hasPhysicalDispatchEvidence = () => {
      if (observedDispatch) return true;
      observedDispatch = dispatches.some((dispatch) => {
        const command = this.getRunCommand(dispatch.commandId);
        if (!command) return true; // A missing command record cannot prove a zero-write cancellation.
        return command.status === "acknowledged" || runFileManager.hasWriteHistory(command);
      });
      return observedDispatch;
    };
    while (true) {
      // Queue TTL belongs to RunFileManager; ACK time starts only after a write.
      runFileManager.expireQueuedActions?.();
      const command = this.getRunCommand(result.confirmation.dispatch?.commandId);
      if (!command) return settleActionResult(result, { status: "UNCONFIRMED", stateAfter: null, dispatched: hasPhysicalDispatchEvidence() });
      if (command?.status === "acknowledged") {
        if (dispatches.length > 1) {
          return settleActionResult(result, { status: "UNCONFIRMED", stateAfter: null, revisionAfter: this.gameDataRevision, confirmedStateChange: null, commandStatus: command.status, dispatched: true });
        }
        try {
          const commandReadback = result.confirmation.requireCommandReadback
            ? await readActionCommandReadback(settingsRepository.getCK3DebugLogPath(), command.commandId) : null;
          if (!result.confirmation.requireCommandReadback && result.confirmation.type !== "RUN_ACK") await this.refreshGameDataForActionConfirmation();
          const verification = verifyActionConfirmation({
            confirmation: result.confirmation,
            gameData: this.gameData,
            gameDataRevision: this.gameDataRevision,
            commandReadback
          });
          if (verification.status !== "PENDING") {
            if (result.confirmation.requireCommandReadback && ["GOLD_TRANSFER", "OPINION_CHANGE"].includes(result.confirmation.type)) {
              try { await this.refreshGameDataForActionConfirmation(); }
              catch (error) { console.warn("[ActionConfirmation] post-verification balance refresh failed:", error.message); }
            }
            runFileManager.recordActionVerification?.(command.commandId, verification);
            return settleActionResult(result, { ...verification, commandStatus: command.status, dispatched: true });
          }
        } catch (error) {
          console.warn("[ActionConfirmation] runtime refresh failed:", error);
        }
      } else if (command && ["failed", "cancelled", "expired", "quarantined"].includes(command.status)) {
        const dispatched = hasPhysicalDispatchEvidence();
        return settleActionResult(result, { status: command.status === "expired" && !dispatched ? "QUEUE_EXPIRED" : "UNCONFIRMED", stateAfter: null, revisionAfter: this.gameDataRevision, confirmedStateChange: null, commandStatus: command.status, dispatched });
      }
      if (runFileManager.hasWriteHistory(command)) {
        observedDispatch = true;
        observedWriteAt ??= Date.now();
        const writtenAt = command.lastWrittenAt ?? command.writtenAt ?? observedWriteAt;
        if (Date.now() - writtenAt >= timeoutMs) break;
      }
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
    return settleActionResult(result, { status: "TIMEOUT", stateAfter: null, revisionAfter: this.gameDataRevision, confirmedStateChange: null, dispatched: hasPhysicalDispatchEvidence() });
  }
  replaceActionFeedback(associatedMessageId, provisional, settled) {
    const commandId = provisional?.diagnostic?.commandId || null;
    for (const message of this.messages) {
      if (message.type !== "action-feedback" || message.associatedMessageId !== associatedMessageId) continue;
      const feedback = message.feedbacks?.find((item) => item.actionId === provisional.actionId && (!commandId || item.diagnostic?.commandId === commandId));
      if (!feedback) continue;
      feedback.success = settled.success;
      feedback.message = settled.feedback?.message || settled.error || feedback.message;
      feedback.sentiment = settled.feedback?.sentiment || (settled.success ? "neutral" : "negative");
      feedback.lifecycle = settled.lifecycle || feedback.lifecycle;
      feedback.diagnostic = settled.diagnostic || feedback.diagnostic;
      this.emitUpdate();
      return;
    }
  }
  scheduleActionConfirmation(associatedMessageId, result, approvalEntry = null) {
    if (!result?.confirmation) return;
    void this.waitForActionConfirmation(result).then((settled) => {
      if (approvalEntry) {
        approvalEntry.lifecycle = settled.lifecycle;
        approvalEntry.diagnostic = settled.diagnostic;
        approvalEntry.resultFeedback = settled.feedback?.message || approvalEntry.resultFeedback;
        approvalEntry.resultSentiment = settled.feedback?.sentiment || (settled.success ? "neutral" : "negative");
        this.emitUpdate();
      } else this.replaceActionFeedback(associatedMessageId, result, settled);
    }).catch((error) => console.error("[ActionConfirmation] unexpected failure:", error));
  }
  cancelCurrentStream() {
    console.log("Cancelling current stream");
    this.getGenerationManager().cancelCurrent("explicit_abort");
  }
  pauseConversation() {
    console.log("Pausing conversation");
    this.isPaused = true;
    this.emitUpdate();
  }
  resumeConversation() {
    console.log("Resuming conversation");
    this.isPaused = false;
    this.emitUpdate();
    if (this.npcQueue.length > 0) {
      this.processQueue();
    }
  }
  // setCustomQueue(queue: []): void {
  //     // TODO: use ids instead. Frontend side of the app should send an array of character ids in order of custom queue.
  //     // Additionally we need to send to UI participating charaters as id's and their names to use for creation of custom queue.
  //     this.emitUpdate();
  // }
  // Fill NPC queue with shuffled characters or custom queue
  fillNpcQueue() {
    const result = this.getTurnManager().fillQueue({
      customQueue: this.customQueue,
      npcs: this.getNpcList(),
      persistCustomQueue: this.persistCustomQueue
    });
    if (result.mode === "custom") {
      console.log("Using custom queue:", this.npcQueue.map((c) => c.shortName));
      if (result.consumeCustomQueue) this.customQueue = null;
    } else {
      console.log("Filled shuffled queue:", this.npcQueue.map((c) => c.shortName));
    }
  }
  async processQueue(turnEpoch = this.turnEpoch) {
    return this.getTurnManager().processQueue(turnEpoch);
  }
  getValidatedRegenerationContext(targetIndex, targetMessage, responderId, { allowActionOutcome = false } = {}) {
    const currentTurn = this.getTurnManager().currentTurn;
    const playerId = Number(this.gameData?.playerID);
    const sceneRevision = JSON.stringify([this.gameData?.scene || null, this.gameData?.location || null,
      this.gameData?.locationController || null]);
    const campaignToken = this.gameData?.campaignToken || null;
    if (!currentTurn || !Number.isSafeInteger(playerId) || playerId <= 0
      || currentTurn.playerMessageId == null || currentTurn.playerCharacterId !== playerId
      || currentTurn.conversationId !== this.id || currentTurn.sceneRevision !== sceneRevision
      || currentTurn.campaignToken !== campaignToken
      || !currentTurn.activeParticipantIds?.some(id => Number(id) === Number(responderId))) return null;

    const playerMessageIndex = this.messages.findIndex(message => message?.role === "user"
      && message.id === currentTurn.playerMessageId);
    let latestUserIndex = -1;
    for (let index = 0; index < this.messages.length; index += 1) {
      if (this.messages[index]?.role === "user") latestUserIndex = index;
    }
    const playerMessage = this.messages[playerMessageIndex];
    if (playerMessageIndex < 0 || latestUserIndex !== playerMessageIndex || playerMessageIndex >= targetIndex
      || playerMessage.speakerCharacterId !== playerId || typeof playerMessage.content !== "string"
      || !playerMessage.content.trim() || playerMessage.isStreaming === true || playerMessage.incomplete === true) return null;

    const attempt = this.generationAttemptsByMessageId?.get(targetMessage.id);
    if (!attempt || attempt.logicalPlayerMessageId !== playerMessage.id
      || attempt.responderId !== Number(responderId) || !Number.isSafeInteger(attempt.turnEpoch)
      || attempt.turnEpoch < 0 || attempt.turnEpoch > currentTurn.epoch
      || attempt.actionEvaluationPending === true || !allowActionOutcome && attempt.hasActionOutcome === true) return null;
    return { currentTurn, playerMessage, playerMessageIndex, sceneRevision, campaignToken, playerId };
  }
  // Send a user message and trigger responses from all NPCs
  async sendMessage(userMessage) {
    console.log(`Conversation.sendMessage called (characters=${typeof userMessage === "string" ? userMessage.length : 0})`);
    logVerboseLLM("[Conversation][verbose] User message:", userMessage);
    console.log("Conversation active:", this.isActive);
    console.log("Characters in conversation:", this.gameData.characters.size);
    const user = this.gameData.characters.get(this.gameData.playerID);
    this.captureSummaryParticipantProfiles?.(this.gameData.characters.values());
    if (!this.isActive) {
      console.warn("Conversation is not active");
      return;
    }
    if (this.gameData.characters.size === 0) {
      console.error("No characters in conversation");
      return;
    }
    const userMsg = createMessage({
      id: this.nextId++,
      name: user.fullName,
      role: "user",
      speakerCharacterId: Number(this.gameData.playerID),
      content: userMessage
    });
    this.generationAttemptsByMessageId.clear();
    this.memoryAttemptDiagnosticsByOwner.clear();
    const turnState = this.getTurnManager().startUserTurn({
      playerMessageId: userMsg.id,
      activeParticipantIds: this.getActiveConversationCharacters().map((character) => character.id),
      playerCharacterId: Number(this.gameData.playerID),
      conversationId: this.id,
      sceneRevision: JSON.stringify([this.gameData.scene || null, this.gameData.location || null, this.gameData.locationController || null]),
      campaignToken: this.gameData.campaignToken || null
    });
    this.messages.push(userMsg);
    memoryEngine?.observeParticipants(this, turnState.activeParticipantIds, userMsg.id);
    this.recordCharacterDisclosures();
    if (this.memoryState?.turnRecallCache instanceof Map) this.memoryState.turnRecallCache.clear();
    this.emitUpdate();
    this.fillNpcQueue();
    this.resumeConversation();
  }
  // Regenerate assistant message and refill queue
  async regenerateMessage(messageId) {
    console.log("Regenerating message with ID:", messageId);
    const targetIndex = this.messages.findIndex((msg) => "id" in msg && msg.id === messageId);
    if (targetIndex === -1) {
      console.error("Message not found for regeneration:", messageId);
      return { success: false, error: "找不到要重新生成的回复。" };
    }
    const targetMessage = this.messages[targetIndex];
    if (targetMessage.role !== "assistant") {
      console.error("Can only regenerate assistant messages:", targetMessage.role);
      return { success: false, error: "只能重新生成 NPC 的回复。" };
    }
    const responderId = Number(targetMessage.speakerCharacterId);
    if (!Number.isSafeInteger(responderId) || responderId <= 0 || responderId === Number(this.gameData?.playerID)) {
      console.error("Cannot regenerate assistant without a valid responder ID");
      return { success: false, error: "无法识别这条回复对应的 NPC，无法安全重新生成。" };
    }
    if (this.generationAttemptsByMessageId.get(messageId)?.actionEvaluationPending === true) {
      return { success: false, error: "仍在处理这条回复的动作，请完成后再重新生成台词。" };
    }
    const regenerationContext = this.getValidatedRegenerationContext(targetIndex, targetMessage, responderId, { allowActionOutcome: true });
    const targetCharacter = regenerationContext && this.getNpcList().find((character) => Number(character.id) === responderId);
    if (!targetCharacter) {
      console.error("Cannot safely regenerate a stale turn or unavailable responder");
      return { success: false, error: "这条回复已不属于当前对话或场景，无法安全重新生成。" };
    }
    const tailMessages = this.messages.slice(targetIndex);
    const hasActionOutcome = tailMessages.some(message => this.generationAttemptsByMessageId.get(message.id)?.hasActionOutcome === true
      || message.type === "action-approval" || message.type === "action-feedback");
    if (hasActionOutcome) {
      if (this.activeResponse || this.pendingActionApprovals?.size
        || tailMessages.some(message => this.generationAttemptsByMessageId.get(message.id)?.actionEvaluationPending === true)) {
        return { success: false, error: "仍在生成回复或处理动作，请完成后再重新生成台词。" };
      }
      if (tailMessages.some(message => message.role !== "assistant"
        && !["error", "action-approval", "action-feedback"].includes(message.type))
        || tailMessages.some(message => ["action-approval", "action-feedback"].includes(message.type)
          && (!this.messages.some(entry => entry.role === "assistant" && entry.id === message.associatedMessageId)
            || this.generationAttemptsByMessageId.get(message.associatedMessageId)?.hasActionOutcome !== true))) {
        return { success: false, error: "回复后续包含无法确认来源的事件，未修改台词或动作。" };
      }
      this.messages = this.messages.filter(message => this.generationAttemptsByMessageId.get(message.id)?.narrationRewriteOf !== messageId);
      for (const [id, attempt] of this.generationAttemptsByMessageId) {
        if (attempt.narrationRewriteOf === messageId) this.generationAttemptsByMessageId.delete(id);
      }
      return this.respondAs(targetCharacter, this.turnEpoch, { narrationRewriteOf: messageId });
    }
    const tailHasUnsafeOutcome = tailMessages.some(message => {
      const attempt = this.generationAttemptsByMessageId.get(message.id);
      return attempt?.hasActionOutcome === true || attempt?.actionEvaluationPending === true
        || (message.type === "action-approval" || message.type === "action-feedback")
        || (message.role !== "assistant" && message.type !== "error");
    });
    if (tailHasUnsafeOutcome) {
      console.error("Cannot regenerate a turn with action outcomes or non-generation events");
      return { success: false, error: "回复后续包含动作或其他事件，无法安全重新生成。" };
    }

    const regenerateOfByResponder = {};
    for (const message of tailMessages) {
      if (message.role !== "assistant") continue;
      const attempt = this.generationAttemptsByMessageId.get(message.id);
      const messageResponderId = Number(message.speakerCharacterId);
      if (attempt?.logicalPlayerMessageId === regenerationContext.playerMessage.id
        && Number.isSafeInteger(messageResponderId) && messageResponderId > 0
        && attempt.responderId === messageResponderId) {
        regenerateOfByResponder[messageResponderId] = message.id;
      }
    }
    regenerateOfByResponder[responderId] = targetMessage.id;
    const turnState = this.getTurnManager().startRegenerationTurn({
      playerMessageId: regenerationContext.playerMessage.id,
      playerCharacterId: regenerationContext.playerId,
      conversationId: this.id,
      sceneRevision: regenerationContext.sceneRevision,
      campaignToken: regenerationContext.campaignToken,
      regenerateOfByResponder
    });
    if (!turnState) {
      console.error("Cannot safely create a regeneration attempt for this turn");
      return { success: false, error: "无法为这条回复创建安全的重试轮次。" };
    }
    const prefixMessages = new Set(this.messages.slice(0, targetIndex));
    for (const message of tailMessages) this.generationAttemptsByMessageId.delete(message.id);
    this.messages = this.messages.filter(message => prefixMessages.has(message));
    this.recordCharacterDisclosures();

    const generateFollowing = settingsRepository.getGenerateFollowingMessagesSetting();
    if (generateFollowing) {
      const respondedCharacterIds = new Set(this.messages.slice(regenerationContext.playerMessageIndex + 1)
        .filter(message => message.role === "assistant"
          && this.generationAttemptsByMessageId.get(message.id)?.logicalPlayerMessageId === regenerationContext.playerMessage.id)
        .map(message => Number(message.speakerCharacterId)).filter(Number.isSafeInteger));
      const activeParticipantIds = new Set(turnState.activeParticipantIds.map(Number));
      const remainingCharacters = this.getNpcList().filter(character => activeParticipantIds.has(Number(character.id))
        && !respondedCharacterIds.has(Number(character.id)) && Number(character.id) !== responderId);
      this.npcQueue = [targetCharacter, ...remainingCharacters];
      console.log("Refilled queue for regeneration:", this.npcQueue.map((character) => character.shortName));
    } else {
      this.npcQueue = [targetCharacter];
    }
    this.isPaused = false;
    this.emitUpdate();
    const pauseOnRegeneration = settingsRepository.getPauseOnRegenerationSetting();
    this.processQueue();
    if (pauseOnRegeneration) {
      this.pauseConversation();
    }
    return { success: true };
  }
  // Regenerate error message and retry the operation
  async regenerateError(messageId) {
    console.log("Regenerating error with ID:", messageId);
    const targetIndex = this.messages.findIndex((msg) => "id" in msg && msg.id === messageId);
    if (targetIndex === -1) {
      console.error("Error not found for regeneration:", messageId);
      return { success: false, error: "找不到要重试的失败请求。" };
    }
    const targetError = this.messages[targetIndex];
    if (targetError.type !== "error") {
      console.error("Can only regenerate error entries:", targetError.type);
      return { success: false, error: "这条消息不是可重试的失败请求。" };
    }
    const failedAttempt = this.generationAttemptsByMessageId.get(targetError.id);
    if (failedAttempt?.narrationRewriteOf != null) return this.regenerateMessage(failedAttempt.narrationRewriteOf);
    if (targetError.content === "Failed to initialize conversation") {
      this.messages.splice(targetIndex, 1);
      await this.initializeGameData();
    } else {
      const attempt = this.generationAttemptsByMessageId.get(targetError.id);
      const responderId = Number(targetError.responderCharacterId ?? attempt?.responderId);
      const regenerationContext = Number.isSafeInteger(responderId) && responderId > 0
        ? this.getValidatedRegenerationContext(targetIndex, targetError, responderId) : null;
      const targetCharacter = regenerationContext && this.getNpcList().find(character => Number(character.id) === responderId);
      if (!targetCharacter) {
        console.error("Cannot safely retry a stale turn or unavailable responder error");
        return { success: false, error: "这条失败请求已不属于当前对话或场景，无法安全重试。" };
      }
      const currentTurn = regenerationContext.currentTurn;
      const remainingQueue = this.npcQueue.filter(character => Number(character.id) !== responderId
        && currentTurn.activeParticipantIds.some(id => Number(id) === Number(character.id)));
      const turnState = this.getTurnManager().startRegenerationTurn({
        playerMessageId: regenerationContext.playerMessage.id,
        playerCharacterId: regenerationContext.playerId,
        conversationId: this.id,
        sceneRevision: regenerationContext.sceneRevision,
        campaignToken: regenerationContext.campaignToken,
        regenerateOfByResponder: { [responderId]: targetError.id }
      });
      if (!turnState) {
        console.error("Cannot safely create a retry attempt for this error");
        return { success: false, error: "无法为这条失败请求创建安全的重试轮次。" };
      }
      this.generationAttemptsByMessageId.delete(targetError.id);
      this.messages = this.messages.filter(message => message !== targetError);
      this.npcQueue = [targetCharacter, ...remainingQueue];
      this.emitUpdate();
      this.resumeConversation();
    }
    this.emitUpdate();
    return { success: true };
  }
  // Edit user message and resend
  async editUserMessage(messageId, newContent) {
    console.log("Editing message with ID:", messageId);
    const targetIndex = this.messages.findIndex((msg) => "id" in msg && msg.id === messageId);
    if (targetIndex === -1) {
      console.error("Message not found for editing:", messageId);
      return;
    }
    const targetMessage = this.messages[targetIndex];
    if (targetMessage.role !== "user" && targetMessage.role !== "assistant") {
      console.error("Can only edit user or assistant messages:", targetMessage.role);
      return;
    }
    if (targetMessage.role === "user") {
      for (let i = this.messages.length - 1; i >= targetIndex; i--) {
        this.messages.splice(i, 1);
      }
      this.recordCharacterDisclosures();
      this.emitUpdate();
      await this.sendMessage(newContent);
    } else {
      targetMessage.content = newContent;
      this.recordCharacterDisclosures();
      this.emitUpdate();
    }
  }
  getSummaryParticipantIds() {
    this.captureSummaryParticipantProfiles(this.gameData.characters.values());
    const participantIds = [this.gameData.playerID];
    const seen = /* @__PURE__ */ new Set(participantIds);
    const addParticipant = (characterId) => {
      const numericId = Number(characterId);
      if (!Number.isFinite(numericId) || seen.has(numericId) || !this.getSummaryParticipantProfile(numericId)) return;
      seen.add(numericId);
      participantIds.push(numericId);
    };
    const participantPresence = memoryEngine?.ensureConversationState(this).participantPresence || [];
    for (const participant of participantPresence) addParticipant(participant.characterId);
    return participantIds;
  }
  buildFinalizationBaseContext() {
    const participantIds = this.getSummaryParticipantIds();
    const participants = participantIds.map((id) => this.getSummaryParticipantProfile(id)).filter(Boolean);
    const excludedSummaryOwnerIds = [...this.inactiveParticipantIds.entries()]
      .filter(([characterId, stateValue]) => stateValue === "dead" && Number(characterId) !== Number(this.gameData.playerID))
      .map(([characterId]) => Number(characterId));
    const state = memoryEngine.ensureConversationState(this);
    const messages = this.getHistory();
    const mentionableProfiles = [...(this.gameData.getMentionableCharacterProfiles?.() || this.gameData.characters).values()]
      .map(character => ({ id: Number(character.id), firstName: character.firstName, name: character.name,
        shortName: character.shortName, fullName: character.fullName, allowDerivedHonorifics: false }));
    const mentionedIds = new MentionTracker().findMentionedCharacterIds(messages, { candidates: mentionableProfiles,
      excludedIds: participantIds, resolveCoreference: false });
    const mentionedEntities = mentionableProfiles.filter(character => mentionedIds.includes(character.id));
    return {
      conversationId: this.id,
      date: this.gameData.date,
      campaignToken: this.gameData.campaignToken || null,
      totalDays: this.gameData.totalDays,
      finalizationVisibilityV1: true,
      messages,
      participants,
      mentionedEntities,
      excludedSummaryOwnerIds,
      participantPresence: state.participantPresence,
      joinEvents: this.joinEvents,
      leaveEvents: this.leaveEvents,
      rollingState: state.rollingState,
      __conversation: this
    };
  }
  checkpointFinalization(reason = "conversation_active") {
    if (!memoryEngine || this.getHistory().length === 0) return null;
    return memoryEngine.checkpointConversation({
      ...this.buildFinalizationBaseContext(),
      finalInstructions: PromptBuilder?.getFinalSummaryInstructions?.() || "",
      summaryOutputLimit: PromptBuilder?.getFinalSummaryMaxTokens?.() || 4096
    }, { reason });
  }
  // Create final comprehensive summary and save to characters
  async finalizeConversation(options = {}) {
    if (options.closeGameScene !== false) {
      try {
        runFileManager.write("trigger_event = mcc_event_v2.9002", {
          owner: "conversation",
          kind: "conversation_close",
          scopeId: options.conversationId || this.id,
          epoch: options.epoch ?? this.conversationEpoch,
          expiresInMs: 15e3,
          destructive: true,
          supersedable: true
        });
      } catch (error) {
        console.error("[Summary] Game scene close failed; continuing memory finalization:", error);
      }
    } else {
      console.log(`[Conversation] game scene close skipped id=${this.id} reason=${options.reason || "conversation_rollover"}`);
    }
    
    // PERFORMANCE: Clear caches when conversation ends
    if (this.gameData) {
      // Clear mentioned characters
      if (this.gameData.mentionedCharactersInContext) {
        this.gameData.mentionedCharactersInContext.clear();
      }
      
      // Clear dynamic memory caches for all characters
      for (const char of this.gameData.characters.values()) {
        if (char.dynamicMemoryCache) {
          char.dynamicMemoryCache = null;
        }
      }
      console.log("[Performance] Cleared all character dynamic memory caches");
    }
    
    if (this.messages.length < 2) {
      console.log("Not enough messages for final summarization");
      this.end();
      return;
    }
    console.log("Creating final conversation memory extraction...");
    const finalResult = await this.createFinalSummary();
    if (finalResult?.success && finalResult.finalSummary) {
      console.log("Final conversation summary committed to structured memory and participant folders");
    } else if (finalResult?.recoveryPath) {
      console.error(`Final summary failed; recovery snapshot preserved at ${finalResult.recoveryPath}`);
    }
    this.end();
    return finalResult;
  }
  //  Create final comprehensive summary using ALL messages
  async createFinalSummary() {
    if (!memoryEngine) throw new Error("memory_engine_not_configured");
    const baseContext = this.buildFinalizationBaseContext();
    const participantIds = baseContext.participants.map((entry) => entry.id);
    return memoryEngine.finalizeConversation({
      ...baseContext,
      finalInstructions: PromptBuilder.getFinalSummaryInstructions(),
      summaryOutputLimit: PromptBuilder.getFinalSummaryMaxTokens?.() || 4096,
      getSummaryCapabilities: (snapshot) => llmManager.getProviderCapabilities("SUMMARY", snapshot),
      buildPrompt: (context) => memoryEngine.buildFinalizationPrompt(context),
      persistCharacterFolders: async (finalSummary, context) => {
        return this.gameData.saveCharactersSummaries(finalSummary, participantIds, {
          finalizationId: context.finalizationId,
          conversationId: context.conversationId,
          date: context.date,
          campaignToken: context.campaignToken || null,
          totalDays: context.totalDays,
          excludedOwnerIds: context.excludedSummaryOwnerIds,
          participantProfiles: context.participants,
          directedSummaries: context.directedSummaries,
          verifiedSummarySegments: context.verifiedSummarySegments,
          presenceJoins: context.joinEvents || [],
          presenceLeaves: context.leaveEvents || []
        });
      },
      requestSummary: async (summaryPrompt, requestOptions = {}) => {
        console.log(`[TOKEN_COUNT] Final memory prompt tokens: ${this.estimateTokenCount(summaryPrompt)}`);
        return llmManager.sendSummaryRequest(summaryPrompt, void 0, {
          requestType: "final_summary",
          summaryAttempt: requestOptions.attempt,
          maxTokens: requestOptions.maxTokens,
          providerSnapshot: requestOptions.providerSnapshot,
          summaryBudget: requestOptions.summaryBudget
        });
      },
    });
  }
  async recoverPendingMemories() {
    if (!memoryEngine || !this.gameData) return;
    const results = await memoryEngine.recoverPendingFinalizations({
      isConversationActive: id => id === this.id && this.isActive,
      buildPrompt: (context) => memoryEngine.buildFinalizationPrompt({ ...context, finalInstructions: context.finalInstructions || PromptBuilder.getFinalSummaryInstructions() }),
      getSummaryCapabilities: (snapshot) => llmManager.getProviderCapabilities("SUMMARY", snapshot),
      requestSummary: (summaryPrompt, options = {}) => llmManager.sendSummaryRequest(summaryPrompt, void 0, { requestType: "memory_recovery", maxTokens: options.maxTokens, providerSnapshot: options.providerSnapshot, summaryBudget: options.summaryBudget }),
      activeCampaignToken: this.gameData.campaignToken || null,
      resolveParticipantProfiles: (snapshot) => memoryEngine.resolveRecoveryParticipantProfiles(snapshot, [...this.summaryParticipantProfiles.values()]),
      persistCharacterFolders: async (finalSummary, context) => {
        const participantIds = (context.participants || []).map((entry) => entry.id);
        return this.gameData.saveCharactersSummaries(finalSummary, participantIds, {
          finalizationId: context.finalizationId,
          conversationId: context.conversationId,
          date: context.date,
          campaignToken: context.campaignToken || null,
          totalDays: context.totalDays,
          excludedOwnerIds: context.excludedSummaryOwnerIds,
          participantProfiles: context.participants,
          directedSummaries: context.directedSummaries,
          verifiedSummarySegments: context.verifiedSummarySegments,
          presenceJoins: context.joinEvents || [],
          presenceLeaves: context.leaveEvents || []
        });
      }
    });
    return results;
  }
  // Get conversation history
  getHistory() {
    return this.messages.filter(
      (entry) => "role" in entry && entry.isStreaming !== true && entry.incomplete !== true
    );
  }
  clearHistory() {
    this.messages = [];
  }
  end() {
    this.isActive = false;
    this.clearHistory();
    this.generationAttemptsByMessageId?.clear();
    this.memoryAttemptDiagnosticsByOwner?.clear();
    this.pendingPlayerRecallRequests?.clear();
    this.frozenMemoryBudget = null;
    if (PLAYER_CENTERED_RECALL_ENABLED) memoryEngine?.invalidateConversationRecallState(this);
  }
  // Emit conversation update event
  emitUpdate() {
    this.eventEmitter.emit("conversation-updated", [...this.messages]);
  }
  // Subscribe to conversation updates
  onConversationUpdate(callback) {
    this.eventEmitter.on("conversation-updated", callback);
  }
  // Unsubscribe from conversation updates
  offConversationUpdate(callback) {
    this.eventEmitter.off("conversation-updated", callback);
  }
  /**
   * Approve actions for pending approval
   */
  async approveActions(approvalEntryId) {
    const pending = this.pendingActionApprovals.get(approvalEntryId);
    if (!pending) throw new Error(`No pending approval found for ID ${approvalEntryId}`);
    const entryIndex = this.messages.findIndex((message) => message.type === "action-approval" && message.id === approvalEntryId);
    if (entryIndex === -1) throw new Error(`Approval entry not found for ID ${approvalEntryId}`);
    const approvalEntry = this.messages[entryIndex];
    if (approvalEntry.type !== "action-approval") throw new Error(`Entry ${approvalEntryId} is not an action-approval entry`);
    approvalEntry.status = "approved";
    approvalEntry.lifecycle = approvalEntry.lifecycle ? { ...approvalEntry.lifecycle, status: "VALIDATED", dispatched: false, confirmed: false } : null;
    approvalEntry.resultFeedback = pending.previewFeedback || pending.action.actionTitle || pending.action.actionId;
    approvalEntry.resultSentiment = pending.previewSentiment || "neutral";
    this.pendingActionApprovals.delete(approvalEntryId);
    this.emitUpdate();
    try {
      const result = await ActionEngine.runInvocation(this, pending.npc, pending.action.invocation);
      approvalEntry.lifecycle = result.lifecycle || approvalEntry.lifecycle || null;
      approvalEntry.diagnostic = result.diagnostic || approvalEntry.diagnostic || null;
      if (result.feedback?.message && result.feedback.message !== approvalEntry.resultFeedback) {
        approvalEntry.resultFeedback = result.feedback.message;
        approvalEntry.resultSentiment = result.feedback.sentiment || "neutral";
        this.emitUpdate();
      }
      this.scheduleActionConfirmation(approvalEntry.associatedMessageId, result, approvalEntry);
    } catch (error) {
      console.error("[Conversation] Background action execution failed:", error);
      approvalEntry.resultFeedback = `Failed: ${error instanceof Error ? error.message : String(error)}`;
      approvalEntry.resultSentiment = "negative";
      this.emitUpdate();
    }
    const approvalSettings = settingsRepository.getActionApprovalSettings();
    if (approvalSettings.pauseOnApproval && this.isPaused && this.npcQueue.length > 0) this.resumeConversation();
  }
  /**
   * Decline actions for pending approval
   */
  async declineActions(approvalEntryId) {
    const pending = this.pendingActionApprovals.get(approvalEntryId);
    if (!pending) throw new Error(`No pending approval found for ID ${approvalEntryId}`);
    const entryIndex = this.messages.findIndex((message) => message.type === "action-approval" && message.id === approvalEntryId);
    if (entryIndex === -1) throw new Error(`Approval entry not found for ID ${approvalEntryId}`);
    const approvalEntry = this.messages[entryIndex];
    if (approvalEntry.type !== "action-approval") throw new Error(`Entry ${approvalEntryId} is not an action-approval entry`);
    this.messages.splice(entryIndex, 1);
    this.pendingActionApprovals.delete(approvalEntryId);
    this.emitUpdate();
    const approvalSettings = settingsRepository.getActionApprovalSettings();
    if (approvalSettings.pauseOnApproval && this.isPaused && this.npcQueue.length > 0) this.resumeConversation();
  }
  /**
   * Create a presence-safe summary for the official leavesConversation action.
   * The caller remains responsible for persistence and participant removal.
   */
  async createCharacterLeavingSummary(characterId, summaryPrompt) {
    const numericId = Number(characterId);
    const character = this.gameData?.characters?.get(numericId);
    if (!character) {
      console.error(`Character ${characterId} not found for leaving summary`);
      return null;
    }
    try {
      const suppliedPrompt = Array.isArray(summaryPrompt) ? summaryPrompt : [];
      const visibleHistory = this.getHistoryForCharacter(numericId);
      const safePrompt = [];
      const perspectiveInstruction = suppliedPrompt.find((message) => message?.role === "system" && !String(message.content || "").startsWith("Previous summary of this conversation:") && !String(message.content || "").startsWith("Full conversation:"));
      if (perspectiveInstruction) safePrompt.push({ ...perspectiveInstruction });
      if (this.canUseSharedRollingSummary(numericId) && this.currentSummary) {
        safePrompt.push({ role: "system", content: `Previous summary of this conversation:\n\n${this.currentSummary}` });
      }
      safePrompt.push({
        role: "system",
        content: `Full conversation:\n${visibleHistory.map((message) => `${message.name || "System"}: ${message.content}`).join("\n")}`
      });
      const finalInstruction = [...suppliedPrompt].reverse().find((message) => message?.role === "user");
      if (finalInstruction) safePrompt.push({ ...finalInstruction });
      console.log(`[TOKEN_COUNT] Character leaving summary for ${character.fullName}: ${this.estimateTokenCount(safePrompt)}`);
      const result = await llmManager.sendSummaryRequest(safePrompt, void 0, { requestType: "character_leaving_summary" });
      if (!validateGenerationOutcome(result).complete) return null;
      const summary = result && typeof result === "object" && typeof result.content === "string" ? result.content.trim() : "";
      if (!summary) {
        console.error("Invalid response format for character leaving summary");
        return null;
      }
      console.log(`Generated leaving summary for ${character.fullName}: ${summary.substring(0, 100)}...`);
      return summary;
    } catch (error) {
      console.error(`Failed to create leaving summary for ${character.fullName}:`, error);
      return null;
    }
  }
  /**
   * Remove a character from the conversation entirely
   */
  removeCharacterFromConversation(characterId) {
    const numericId = Number(characterId);
    const character = this.gameData.characters.get(numericId);
    if (!character) {
      console.warn(`Character ${characterId} not found in conversation`);
      return;
    }
    this.captureSummaryParticipantProfiles?.([character]);
    console.log(`Removing ${character.fullName} from conversation`);
    let closedPresence = false;
    if (this.presentCharacterIds?.has(numericId)) {
      memoryEngine?.markParticipantLeft(this, numericId, this.nextId);
      this.presentCharacterIds.delete(numericId);
      this.departedCharacterIds?.add(numericId);
      this.leaveEvents?.push({ characterId: numericId, atMessageId: this.nextId, atHistoryIndex: this.getHistory().length, source: "action" });
      closedPresence = true;
    }
    this.waitingCharacterIds?.delete(numericId);
    this.frozenWorldlineByResponder?.delete(numericId);
    this.frozenWorldlineCoverageByResponder?.delete(String(numericId));
    this.worldlineCoveragePatchCacheByResponder?.delete(String(numericId));
    this.temporarilyAbsentCharacterIds?.delete(numericId);
    this.invalidateApprovalsForCharacter(numericId, "removed");
    this.gameData.characters.delete(numericId);
    if (closedPresence) this.checkpointFinalization("action_participant_left");
    const initialQueueLength = this.npcQueue.length;
    this.npcQueue = this.npcQueue.filter((char) => Number(char.id) !== numericId);
    if (this.npcQueue.length < initialQueueLength) {
      console.log(`Removed ${character.fullName} from NPC queue`);
    }
    if (this.customQueue) {
      const initialCustomQueueLength = this.customQueue.length;
      this.customQueue = this.customQueue.filter((char) => Number(char.id) !== numericId);
      if (this.customQueue.length < initialCustomQueueLength) {
        console.log(`Removed ${character.fullName} from custom queue`);
      }
    }
    console.log(`Character ${character.fullName} successfully removed from conversation`);
    this.emitUpdate();
  }
}

module.exports = { Conversation, tokenCountOrNull, formatMemoryContextOverflow };
