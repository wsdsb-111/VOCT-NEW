"use strict";

const { getCharacterPersonalName } = require("../memory-system/character-identity");

let actionSystem = null;
let ActionEngine = null;
let actionRegistry = null;
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
let cleanLogFile = null;
let resolveI18nString = null;
let PromptBuilder = null;
let TokenCounter = null;
let logVerboseLLM = null;
let events = null;
let uuid = null;
let path = null;
let memoryEngine = null;

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
    actionSystem = dependencies.actionSystem || actionSystem;
    ActionEngine = dependencies.ActionEngine || ActionEngine;
    actionRegistry = dependencies.actionRegistry || actionRegistry;
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
    cleanLogFile = dependencies.cleanLogFile || cleanLogFile;
    resolveI18nString = dependencies.resolveI18nString || resolveI18nString;
    PromptBuilder = dependencies.PromptBuilder || PromptBuilder;
    TokenCounter = dependencies.TokenCounter || TokenCounter;
    logVerboseLLM = dependencies.logVerboseLLM || logVerboseLLM;
    events = dependencies.events || events;
    uuid = dependencies.uuid || uuid;
    path = dependencies.path || path;
    memoryEngine = dependencies.memoryEngine || memoryEngine;
    return this;
  }
  static buildPromptBlockMetadata(promptBuild = {}) {
    const hasExplicitStability = (promptBuild.blocks || []).some(({ block }) => block?.stable !== undefined);
    const blocks = (promptBuild.blocks || []).map(({ block, content, tokens }, index) => ({
      id: block.id,
      label: block.label,
      type: block.type,
      position: index,
      tokens,
      fingerprint: createPromptFingerprint(content),
      stable: hasExplicitStability ? block.stable === true : null
    }));
    const firstHistoryIndex = blocks.findIndex((block) => block.type === "history" || block.type === "presence_roster" || block.type === "current_user");
    const historyStartPosition = firstHistoryIndex >= 0 ? firstHistoryIndex : blocks.length;
    const firstDynamicIndex = hasExplicitStability ? blocks.findIndex((block) => block.stable === false) : -1;
    const stablePrefixEndPosition = firstDynamicIndex >= 0 ? firstDynamicIndex : historyStartPosition;
    const stablePrefixTokens = blocks.slice(0, stablePrefixEndPosition).reduce((total, block) => total + (Number(block.tokens) || 0), 0);
    const dynamicSuffixTokens = blocks.slice(stablePrefixEndPosition).reduce((total, block) => total + (Number(block.tokens) || 0), 0);
    const prefixFingerprint = createPromptFingerprint(JSON.stringify(blocks.slice(0, stablePrefixEndPosition).map((block) => [block.id, block.type, block.fingerprint, block.stable])));
    return { blocks, historyStartPosition, stablePrefixEndPosition, stablePrefixTokens, dynamicSuffixTokens, prefixFingerprint };
  }
  constructor() {
    this.id = uuid.v4();
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
    this.selectedCharacterIds = /* @__PURE__ */ new Set();
    this.presentCharacterIds = /* @__PURE__ */ new Set();
    this.waitingCharacterIds = /* @__PURE__ */ new Set();
    this.temporarilyAbsentCharacterIds = /* @__PURE__ */ new Map();
    this.departedCharacterIds = /* @__PURE__ */ new Set();
    this.joinEvents = [];
    this.leaveEvents = [];
    this.presenceInitialized = false;
    // Action checks are scoped to the current player turn. This prevents one
    // narrated event from being sent to the action model once per NPC reply.
    this.actionGateProcessedTriggers = /* @__PURE__ */ new Set();
    this.processedActionEventIds = /* @__PURE__ */ new Set();
    this.temporarySocialEvidenceStore = /* @__PURE__ */ new Map();
    this.eventEmitter = new events.EventEmitter();
    this.runtime = actionSystem.createConversationRuntime(this, {
      recordSkipped: (responseState, reason) => this.recordGenerationSkippedAnalytics(responseState, reason),
      createApprovalManager: () => this.createApprovalManager()
    });
    this.turnManager = this.runtime.turnManager;
    this.generationManager = this.runtime.generationManager;
    this.referenceContext = this.runtime.referenceContext;
    this.approvalManager = this.runtime.approvalManager;
    this.initializeGameData();
  }
  getActionSystem() {
    return actionSystem;
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
  createApprovalManager() {
    const system = this.getActionSystem();
    return new system.ApprovalManager(this, {
      runInvocation: (conversation, npc, invocation, options) => ActionEngine.runInvocation(conversation, npc, invocation, options),
      createApproval: (input) => createActionApproval(input),
      addFeedback: (associatedMessageId, results) => this.addActionFeedback(associatedMessageId, results),
      getApprovalSettings: () => settingsRepository.getActionApprovalSettings(),
      invalidationFeedback: () => resolveI18nString({
        zh: "该动作已失效：此前解析的人物当前已不可用。",
        en: "This action is no longer valid because a resolved participant is unavailable."
      }, settingsRepository.getLanguage()),
      recordInvalidation: (entry) => usageAnalytics.record({
        ...entry,
        reason: system.actionDecisionTrace.normalizeSkipReason("approval", entry.reason)
      }, null),
      getAction: (actionId) => actionRegistry.getById(actionId),
      isActionDisabled: (actionId) => actionRegistry.isActionDisabled?.(actionId) === true,
      onExecutionSettled: (payload) => this.onActionExecutionSettled(payload)
    });
  }
  getApprovalManager() {
    const manager = this.runtime?.approvalManager || this.approvalManager;
    if (!manager) throw new Error("conversation_approval_manager_not_initialized");
    return manager;
  }
  async initializeGameData() {
    const ck3DebugPath = settingsRepository.getCK3DebugLogPath();
    console.log(`Conversation.initializeGameData: CK3 debug log path: ${ck3DebugPath}`);
    if (runFileManager.isAvailable()) {
      console.log("Conversation.initializeGameData: Clearing run file");
      runFileManager.clear();
    } else {
      console.warn("Conversation.initializeGameData: RunFileManager not available - CK3 path not configured");
    }
    if (!ck3DebugPath) {
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
      this.gameData = await parseLog(ck3DebugPath);
      console.log("GameData initialized with", this.gameData.characters.size, "characters");
      this.captureSummaryParticipantProfiles(this.gameData.characters.values());
      this.initializePresence();
      this.gameData.loadCharactersSummaries();
      await this.recoverPendingMemories();
      this.isActive = true;
      this.emitUpdate();
    } catch (error) {
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
  async checkAndSummarizeIfNeeded(npc) {
    memoryEngine?.syncRollingStateFromConversationFields(this);
    memoryEngine?.syncConversationRollingFields(this);
    let memoryContext = await this.getMemoryContextFor(npc);
    let currentMessages = PromptBuilder.buildMessages(
      this.getPromptHistoryForCharacter(npc.id),
      npc,
      this.gameData,
      this.getPromptSummaryForCharacter(npc.id),
      memoryContext
    );
    let estimatedTokens = this.estimateTokenCount(currentMessages);
    const contextLimit = await llmManager.getCurrentContextLength() || 1e4;
    if (memoryContext?.turnRecallText && contextLimit - estimatedTokens < 192) {
      usageAnalytics.record({
        requestType: "memory_recall",
        characterId: npc.id,
        memoryOutcome: "skipped_context_pressure",
        turnRecallReason: "context_headroom_below_192",
        turnRecallTokens: memoryContext.turnRecallTokens,
        turnRecallIntent: true,
        turnRecallSelected: false,
        turnRecallCacheHit: memoryContext.turnRecallCacheHit,
        sessionTopicAnchorLocked: memoryContext.routing?.topicPatch === "locked",
        queryFingerprint: memoryContext.turnRecallQueryFingerprint,
        candidateCount: memoryContext.turnRecallCandidateCount,
        turnEpoch: this.turnEpoch
      }, null);
      memoryContext = { ...memoryContext, turnRecall: [], turnRecallText: null, turnRecallTokens: 0, turnRecallReason: "context_headroom_below_192" };
      currentMessages = PromptBuilder.buildMessages(
        this.getPromptHistoryForCharacter(npc.id),
        npc,
        this.gameData,
        this.getPromptSummaryForCharacter(npc.id),
        memoryContext
      );
      estimatedTokens = this.estimateTokenCount(currentMessages);
    }
    if (estimatedTokens > contextLimit * this.CONTEXT_LIMIT_PERCENTAGE) {
      console.log(`Context approaching limit (${estimatedTokens}/${contextLimit}), creating rolling summary`);
      if (this.canUseSharedRollingSummary(npc.id)) await this.createRollingSummary(contextLimit);
    }
    return memoryContext;
  }
  /**
   * Create a rolling summary of older messages to compress context
   */
  async createRollingSummary(contextLimit) {
    if (!memoryEngine) throw new Error("memory_engine_not_configured");
    const result = await memoryEngine.maybeCreateRollingCheckpoint({
      conversation: this,
      history: this.getHistory(),
      contextLimit,
      percentage: this.MESSAGES_TO_SUMMARIZE_PERCENTAGE,
      estimateMessageTokens: (message) => this.estimateMessageTokens(message),
      buildPrompt: (messages, previousSummary) => PromptBuilder.buildResummarizePrompt(messages, previousSummary),
      requestSummary: async (summaryPrompt) => {
        console.log("[TOKEN_COUNT] Rolling summary: ", this.estimateTokenCount(summaryPrompt));
        return llmManager.sendSummaryRequest(summaryPrompt, void 0, { requestType: "rolling_summary" });
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
  async getMemoryContextFor(npc, contextLimit = null) {
    if (!memoryEngine || !npc || !this.gameData) return null;
    if (Number(npc.id) === Number(this.gameData.playerID)) return null;
    if (memoryEngine.isSummaryOwnerDeceased(npc.id)) memoryEngine.reviveSummaryOwner(npc.id);
    const limit = contextLimit || await llmManager.getCurrentContextLength() || 1e4;
    const history = this.getHistoryForCharacter(npc.id);
    const activeParticipantIds = this.getActiveConversationCharacters().map((character) => character.id);
    const mentionExcludedIds = this.gameData.getMentionExclusionIds(activeParticipantIds);
    const memoryState = memoryEngine.ensureConversationState(this);
    const participantKey = [...new Set(activeParticipantIds.map(Number))].sort((left, right) => left - right).join(",");
    if (memoryState.mentionProfileCache?.participantKey !== participantKey) {
      const profiles = new Map(this.gameData.getMentionableCharacterProfiles());
      const ownerFolderMemoriesById = new Map();
      for (const ownerId of activeParticipantIds) {
        const folderMemories = memoryEngine.loadOwnerFolderMemories(ownerId);
        ownerFolderMemoriesById.set(Number(ownerId), folderMemories);
        for (const [characterId, profile] of memoryEngine.getMentionableProfilesFromFolderMemories(folderMemories)) {
          if (!profiles.has(characterId)) profiles.set(characterId, profile);
        }
      }
      memoryState.mentionProfileCache = { participantKey, profiles, ownerFolderMemoriesById };
    }
    const mentionableProfiles = memoryState.mentionProfileCache.profiles;
    const mentionedCharacterIds = memoryEngine.findMentionedOutOfSceneCharacters({
      conversation: this,
      history,
      candidates: [...mentionableProfiles.values()],
      excludedIds: mentionExcludedIds
    });
    if (!this.gameData.mentionedCharactersInContext) this.gameData.mentionedCharactersInContext = /* @__PURE__ */ new Set();
    for (const characterId of mentionedCharacterIds) this.gameData.mentionedCharactersInContext.add(characterId);
    const mentionedEntityNames = Object.fromEntries(mentionedCharacterIds.map((characterId) => {
      const character = mentionableProfiles.get(characterId);
      return [characterId, character ? memoryEngine.getCharacterMentionAliases(character) : []];
    }));
    const currentUserIndex = history.findLastIndex((entry) => entry.role === "user");
    const query = currentUserIndex >= 0 ? history[currentUserIndex].content || "" : "";
    const assistContext = (currentUserIndex > 0 ? history.slice(Math.max(0, currentUserIndex - 2), currentUserIndex) : []).map((entry) => entry.content || "").filter(Boolean).join("\n");
    const retrieved = memoryEngine.retrieveForResponder({
      characterId: npc.id,
      query,
      mentionedEntityIds: mentionedCharacterIds,
      mentionedEntityNames,
      mentionedRecallCache: memoryState.mentionedRecallCache,
      sessionRecallCache: memoryState.responderRecallCache,
      directCounterpartIds: activeParticipantIds.filter((characterId) => characterId !== npc.id),
      ownerFolderMemories: memoryState.mentionProfileCache.ownerFolderMemoriesById.get(Number(npc.id)) || [],
      currentTotalDays: this.gameData.totalDays,
      tokenBudget: Math.min(2400, Math.max(800, Math.floor(limit * 0.08))),
      estimateTokens: (text) => TokenCounter.estimateTokens(text)
    });
    const turnEntityIds = [...new Set([...activeParticipantIds, ...mentionedCharacterIds].map(Number))].filter((characterId) => characterId !== Number(npc.id));
    const turnEntityNames = turnEntityIds.flatMap((characterId) => {
      const profile = mentionableProfiles.get(characterId) || this.gameData.characters.get(characterId);
      return profile ? memoryEngine.getCharacterMentionAliases(profile) : [];
    });
    const turnRecall = memoryEngine.retrieveTurnRecall({
      characterId: npc.id,
      query,
      assistContext,
      entityIds: turnEntityIds,
      entityNames: turnEntityNames,
      participantIds: activeParticipantIds.filter((characterId) => characterId !== npc.id),
      ownerFolderMemories: memoryState.mentionProfileCache.ownerFolderMemoriesById.get(Number(npc.id)) || [],
      currentTotalDays: this.gameData.totalDays,
      tokenBudget: 256,
      estimateTokens: (text) => TokenCounter.estimateTokens(text),
      cache: memoryState.turnRecallCache,
      turnEpoch: this.turnEpoch
    });
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
      turnEpoch: this.turnEpoch
    }, null);
    return {
      ...retrieved,
      turnRecall: turnRecall.selected,
      turnRecallText: turnRecall.text,
      turnRecallTokens: turnRecall.tokens,
      turnRecallReason: turnRecall.reason,
      turnRecallQueryFingerprint: turnRecall.queryFingerprint,
      turnRecallCandidateCount: turnRecall.candidateCount,
      turnRecallCacheHit: turnRecall.cacheHit,
      activeParticipantIds,
      stableProfileCache: this.stableProfileCache,
      stableDescriptionCache: this.stableDescriptionCache,
      presenceText: this.buildPresenceContext()
    };
  }
  /**
   * Estimate token count (simple approximation)
   */
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
    const absenceText = temporarilyAbsent.length > 0 ? `\n暂时缺席：${temporarilyAbsent.map((participant) => `${participant.fullName}（${participant.temporaryAbsenceLabel}）`).join("、")}。这些人物不能感知缺席期间的内容。` : "";
    return `=== 当前在场人物（仅本轮有效） ===\n${present.map((participant) => `- ${participant.fullName}`).join("\n")}\n只能把当前在场人物视为听见本轮对话并可直接回应的人；候场、暂时缺席或已离场人物不在当前对话现场。${absenceText}`;
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
    const history = this.getHistoryForCharacter(characterId);
    return this.canUseSharedRollingSummary(characterId) ? history.slice(this.lastSummarizedMessageIndex) : history;
  }
  getPromptSummaryForCharacter(characterId) {
    return this.canUseSharedRollingSummary(characterId) ? this.currentSummary : "";
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
    if (!hasConversation && this.getPresenceWindows(numericId).length === 0) {
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
    const deactivated = actionSystem.participantLifecycle.deactivate(this, characterId, reason);
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
    return this.getApprovalManager().invalidate(approvalId, reason);
  }
  invalidateApprovalsForCharacter(characterId) {
    this.getApprovalManager().invalidateForCharacter(characterId);
  }
  isResponseCurrent(responseState, npc = null) {
    return this.getGenerationManager().isCurrent(responseState, npc);
  }
  recordGenerationSkippedAnalytics(responseState, reason) {
    usageAnalytics.record({
      requestType: "generation_skipped",
      reason: this.getActionSystem().actionDecisionTrace.normalizeSkipReason("generation", reason),
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
  async respondAs(npc, turnEpoch = this.turnEpoch) {
    if (turnEpoch !== this.turnEpoch || !this.isCharacterAvailableForConversation(npc)) {
      console.log(`[Conversation] Skipping unavailable NPC response: ${npc?.shortName || npc?.id || "unknown"}`);
      return;
    }
    // Clear mentioned characters from previous message
    // NOTE: We don't clear the cache here because we want to reuse it
    // within the same conversation if the player hasn't sent new messages
    if (this.gameData.mentionedCharactersInContext) {
      this.gameData.mentionedCharactersInContext.clear();
    }
    
    const msgId = this.nextId++;
    const placeholder = createMessage({
      id: msgId,
      role: "assistant",
      name: npc.fullName,
      content: "",
      isStreaming: true,
      // DeepSeek can stream hidden reasoning before visible dialogue. The UI
      // receives only its state, never the reasoning text.
      streamStatus: "thinking"
    });
    const responseState = this.getGenerationManager().start({ turnEpoch, messageId: msgId, npcId: npc.id });
    const controller = responseState.controller;
    this.messages.push(placeholder);
    this.emitUpdate();
    let wasCancelled = false;
    let streamCompleted = false;
    try {
      const memoryContext = await this.checkAndSummarizeIfNeeded(npc);
      if (settingsRepository.getActionSystemMode?.() !== "balanced") {
        this.getActionSystem().social.socialContextProvider.captureMemoryEvidence({
          conversation: this,
          messageId: msgId,
          characterId: npc.id,
          memoryContext,
          estimateTokens: (text) => TokenCounter.estimateTokens(text)
        });
      }
      if (!this.isResponseCurrent(responseState, npc)) throw new Error("AbortError: Message cancelled");
      const promptBuild = PromptBuilder.buildMessagesWithTokenCount(
        this.getPromptHistoryForCharacter(npc.id),
        npc,
        this.gameData,
        this.getPromptSummaryForCharacter(npc.id),
        memoryContext
      );
      const llmMessages = promptBuild.messages;
      const promptBlockMetadata = Conversation.buildPromptBlockMetadata(promptBuild);
      logVerboseLLM(`[Conversation][verbose] Prompt for ${npc.fullName}:`, llmMessages);
      console.log(`[TOKEN_COUNT] Message from ${npc.fullName}:`, this.estimateTokenCount(llmMessages));
      const activeConfig = settingsRepository.getActiveProviderConfig();
      const isOpenRouter = activeConfig?.providerType === "openrouter";
      const result = await llmManager.sendChatRequest(
        llmMessages,
        isOpenRouter ? void 0 : controller.signal,
        void 0,
        {
          requestType: "chat",
          character: npc.shortName,
          characterId: npc.id,
          blocks: promptBlockMetadata.blocks,
          historyStartPosition: promptBlockMetadata.historyStartPosition,
          stablePrefixEndPosition: promptBlockMetadata.stablePrefixEndPosition,
          stablePrefixTokens: promptBlockMetadata.stablePrefixTokens,
          dynamicSuffixTokens: promptBlockMetadata.dynamicSuffixTokens,
          prefixFingerprint: promptBlockMetadata.prefixFingerprint
        }
      );
      if (settingsRepository.getGlobalStreamSetting() && typeof result === "object" && typeof result[Symbol.asyncIterator] === "function") {
        try {
          const streamIterator = result;
          if (isOpenRouter) {
            const streamPromise = (async () => {
              for await (const chunk of streamIterator) {
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
            for await (const chunk of streamIterator) {
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
              }
            }
            streamCompleted = true;
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
        if (streamCompleted && !wasCancelled) {
          this.getGenerationManager().markPhase(responseState, "evaluating_actions");
          await this.evaluateCompletedActions(npc, msgId, placeholder, responseState);
        }
      } else if (result && typeof result === "object" && "content" in result && typeof result.content === "string") {
        if (!this.isResponseCurrent(responseState, npc)) throw new Error("AbortError: Message cancelled");
        placeholder.content = result.content;
        placeholder.streamStatus = "generating";
        this.emitUpdate();
        placeholder.isStreaming = false;
        delete placeholder.streamStatus;
        streamCompleted = true;
        this.getGenerationManager().markPhase(responseState, "evaluating_actions");
        await this.evaluateCompletedActions(npc, msgId, placeholder, responseState);
      } else {
        throw new Error("Bad LLM response format");
      }
    } catch (error) {
      const staleResponse = responseState.stale || controller.signal.aborted || !this.isResponseCurrent(responseState, npc) || error instanceof Error && error.message === "AbortError: Message cancelled";
      if (staleResponse) {
        wasCancelled = true;
        this.messages = this.messages.filter((msg) => msg.id !== msgId || !msg.isStreaming);
        this.recordGenerationSkipped(responseState, responseState.staleReason || (this.isCharacterAvailableForConversation(npc) ? "stale_generation" : "inactive_participant_generation"));
      } else {
        this.getGenerationManager().fail(responseState);
        console.error("Failed to get response for", npc.shortName, ":", error);
        this.messages = this.messages.filter((msg) => msg.id !== msgId);
        const err = createError({
          id: this.nextId++,
          content: `Failed to get response from ${npc.shortName}`,
          details: error instanceof Error ? error.message : String(error)
        });
        this.messages.push(err);
        if (this.npcQueue.length > 0) this.pauseConversation();
      }
    } finally {
      this.releaseSocialEvidenceIfSettled(msgId);
      this.getGenerationManager().finish(responseState, { wasCancelled });
    }
  }
  async evaluateCompletedActions(npc, npcMessageId, npcMessage, responseState) {
    if (!this.isResponseCurrent(responseState, npc)) {
      this.recordGenerationSkipped(responseState, responseState?.staleReason || "stale_action_evaluation");
      return;
    }
    const evaluations = ActionEngine.buildTurnEvaluationPlan({
      playerMessage: null,
      player: null,
      npcMessage: { ...npcMessage, id: npcMessageId },
      npc
    });
    for (const evaluation of evaluations) {
      if (!this.isResponseCurrent(responseState, npc)) {
        this.recordGenerationSkipped(responseState, responseState?.staleReason || "stale_action_evaluation");
        return;
      }
      const actionResults = await ActionEngine.evaluateForCharacter(this, evaluation.source, responseState.controller.signal, evaluation.message);
      if (!this.isResponseCurrent(responseState, npc)) {
        this.recordGenerationSkipped(responseState, responseState?.staleReason || "stale_action_evaluation");
        return;
      }
      await this.handleActionResults(evaluation.associatedMessageId, evaluation.source, actionResults);
      await this.processSocialConsequences({
        message: evaluation.message,
        confirmedEvents: this.getConfirmedExecutionResults(actionResults),
        signal: responseState.controller.signal
      });
    }
  }
  /**
   * Handle action results from ActionEngine - separate auto-approved from needs-approval
   */
  async handleActionResults(associatedMessageId, npc, actionResults) {
    return this.getApprovalManager().handleActionResults(associatedMessageId, npc, actionResults);
  }
  getConfirmedExecutionResults(actionResults) {
    return (actionResults?.autoApproved || []).filter((result) => result?.success === true && result.effectWritten === true && result.origin !== "social" && !String(result.eventId || "").startsWith("social:"));
  }
  hasPendingApprovalForMessage(messageId) {
    return [...(this.pendingActionApprovals?.values?.() || [])].some((pending) => pending.associatedMessageId === messageId);
  }
  releaseSocialEvidenceIfSettled(messageId) {
    if (messageId == null || this.hasPendingApprovalForMessage(messageId)) return false;
    return this.getActionSystem().social.socialContextProvider.releaseMessageEvidence(this, messageId);
  }
  async processSocialConsequences({ message, confirmedEvents = [], signal = null }) {
    if (!message || !["user", "assistant"].includes(message.role)) return null;
    try {
      const result = await this.getActionSystem().social.socialConsequenceEngine.process({
        conversation: this,
        message,
        confirmedEvents,
        signal
      });
      if (result?.actionResults) {
        const source = message.role === "user"
          ? this.gameData.characters.get(this.gameData.playerID)
          : [...this.gameData.characters.values()].find((character) => character.fullName === message.name || character.shortName === message.name);
        if (source && (result.actionResults.autoApproved.length > 0 || result.actionResults.needsApproval.length > 0)) {
          await this.handleActionResults(message.id, source, result.actionResults);
        }
      }
      return result;
    } catch (error) {
      usageAnalytics.record({
        requestType: "social_consequence",
        actionSystemMode: settingsRepository.getActionSystemMode?.() || "balanced",
        outcome: "rejected",
        reason: error instanceof Error ? error.message : String(error),
        turnEpoch: this.turnEpoch ?? null
      }, null);
      return null;
    } finally {
      this.releaseSocialEvidenceIfSettled(message.id);
    }
  }
  async onActionExecutionSettled({ associatedMessageId, action, result, status }) {
    const system = this.getActionSystem();
    const socialOrigin = action?.origin === "social" || action?.invocation?.origin === "social" || String(action?.invocation?.eventId || "").startsWith("social:");
    if (socialOrigin) {
      const reservationId = action?.socialReservationId;
      if (reservationId) {
        if (status === "executed" && result?.success === true && result.effectWritten === true) system.social.consequenceCooldown.apply(this, reservationId);
        else system.social.consequenceCooldown.release(this, reservationId);
      }
      this.releaseSocialEvidenceIfSettled(associatedMessageId);
      return;
    }
    if (status === "executed" && result?.success === true && result.effectWritten === true) {
      const message = this.messages.find((entry) => entry.id === associatedMessageId && ["user", "assistant"].includes(entry.role));
      if (message) await this.processSocialConsequences({ message, confirmedEvents: [result], signal: null });
    }
    this.releaseSocialEvidenceIfSettled(associatedMessageId);
  }
  addActionFeedback(associatedMessageId, actionResults) {
    console.log("[Conversation] addActionFeedback called with results:", actionResults);
    const feedbackItems = actionResults.filter((r) => r.feedback || r.error).map((r) => ({
      actionId: r.actionId,
      success: r.success,
      message: r.feedback?.message || r.error || "Unknown error",
      sentiment: r.feedback?.sentiment || "negative"
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
    } else {
      console.log("[Conversation] No feedback items to display");
    }
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
      content: userMessage
    });
    const turnState = this.getTurnManager().startUserTurn({
      playerMessageId: userMsg.id,
      activeParticipantIds: this.getActiveConversationCharacters().map((character) => character.id)
    });
    const turnEpoch = turnState.epoch;
    this.messages.push(userMsg);
    memoryEngine?.observeParticipants(this, turnState.activeParticipantIds, userMsg.id);
    this.actionGateProcessedTriggers.clear();
    if (!(this.processedActionEventIds instanceof Set)) this.processedActionEventIds = /* @__PURE__ */ new Set();
    else this.processedActionEventIds.clear();
    if (this.memoryState?.turnRecallCache instanceof Map) this.memoryState.turnRecallCache.clear();
    this.emitUpdate();
    const playerActionResults = await ActionEngine.evaluateForCharacter(this, user, null, userMsg);
    if (turnEpoch !== this.turnEpoch) return;
    await this.handleActionResults(userMsg.id, user, playerActionResults);
    await this.processSocialConsequences({
      message: userMsg,
      confirmedEvents: this.getConfirmedExecutionResults(playerActionResults),
      signal: null
    });
    if (turnEpoch !== this.turnEpoch) return;
    if (this.isPaused) return;
    this.fillNpcQueue();
    this.resumeConversation();
  }
  // Regenerate assistant message and refill queue
  async regenerateMessage(messageId) {
    console.log("Regenerating message with ID:", messageId);
    const targetIndex = this.messages.findIndex((msg) => "id" in msg && msg.id === messageId);
    if (targetIndex === -1) {
      console.error("Message not found for regeneration:", messageId);
      return;
    }
    const targetMessage = this.messages[targetIndex];
    if (targetMessage.role !== "assistant") {
      console.error("Can only regenerate assistant messages:", targetMessage.role);
      return;
    }
    this.getTurnManager().supersede("superseded_by_regeneration");
    for (let i = this.messages.length - 1; i >= targetIndex; i--) {
      this.messages.splice(i, 1);
    }
    const targetCharacter = this.getNpcList().find((c) => c.fullName === targetMessage.name);
    if (!targetCharacter) {
      console.error("Could not find character for message:", targetMessage.name);
      this.emitUpdate();
      return;
    }
    const generateFollowing = settingsRepository.getGenerateFollowingMessagesSetting();
    if (generateFollowing) {
      let latestUserIndex = -1;
      for (let i = targetIndex - 1; i >= 0; i--) {
        const msg = this.messages[i];
        if ("role" in msg && msg.role === "user") {
          latestUserIndex = i;
          break;
        }
      }
      if (latestUserIndex >= 0) {
        const respondedCharacters = /* @__PURE__ */ new Set();
        for (let i = latestUserIndex + 1; i < targetIndex; i++) {
          const msg = this.messages[i];
          if (msg.role === "assistant" && msg.name) {
            respondedCharacters.add(msg.name);
          }
        }
        const allNpcs = this.getNpcList();
        const remainingCharacters = allNpcs.filter(
          (c) => !respondedCharacters.has(c.fullName) && c.fullName !== targetCharacter.fullName
        );
        this.npcQueue = [targetCharacter, ...remainingCharacters];
        console.log("Refilled queue for regeneration:", this.npcQueue.map((c) => c.shortName));
      } else {
        this.npcQueue = [targetCharacter];
      }
    } else {
      this.npcQueue = [targetCharacter];
    }
    this.emitUpdate();
    const pauseOnRegeneration = settingsRepository.getPauseOnRegenerationSetting();
    this.processQueue();
    if (pauseOnRegeneration) {
      this.pauseConversation();
    }
  }
  // Regenerate error message and retry the operation
  async regenerateError(messageId) {
    console.log("Regenerating error with ID:", messageId);
    const targetIndex = this.messages.findIndex((msg) => "id" in msg && msg.id === messageId);
    if (targetIndex === -1) {
      console.error("Error not found for regeneration:", messageId);
      return;
    }
    const targetError = this.messages[targetIndex];
    if (targetError.type !== "error") {
      console.error("Can only regenerate error entries:", targetError.type);
      return;
    }
    this.messages.splice(targetIndex, 1);
    if (targetError.content === "Failed to initialize conversation") {
      await this.initializeGameData();
    } else {
      const userMessages = this.messages.filter((msg) => "role" in msg && msg.role === "user");
      if (userMessages.length > 0) {
        const latestUserMessage = userMessages[userMessages.length - 1];
        for (let i = this.messages.length - 1; i >= 0; i--) {
          const msg = this.messages[i];
          if ("role" in msg && msg.role === "user" && msg.id === latestUserMessage.id || msg.type === "action-feedback" && msg.associatedMessageId === latestUserMessage.id) {
            break;
          }
          if ("role" in msg && msg.role === "assistant" || msg.type === "error") {
            this.messages.splice(i, 1);
          }
        }
        if (this.npcQueue.length === 0) {
          this.fillNpcQueue();
        }
        this.emitUpdate();
        this.resumeConversation();
      }
    }
    this.emitUpdate();
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
      this.emitUpdate();
      await this.sendMessage(newContent);
    } else {
      targetMessage.content = newContent;
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
    return {
      conversationId: this.id,
      date: this.gameData.date,
      totalDays: this.gameData.totalDays,
      messages: this.getHistory(),
      participants,
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
    return memoryEngine.checkpointConversation(this.buildFinalizationBaseContext(), { reason });
  }
  // Create final comprehensive summary and save to characters
  async finalizeConversation() {
    runFileManager.write(`
            trigger_event = mcc_event_v2.9002
            trigger_event = mcc_event_v2.9003
            `);
    setTimeout(() => {
      runFileManager.clear();
      console.log("Run file cleared after conversation end event.");
    }, 500);
    
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
  }
  //  Create final comprehensive summary using ALL messages
  async createFinalSummary() {
    if (!memoryEngine) throw new Error("memory_engine_not_configured");
    const baseContext = this.buildFinalizationBaseContext();
    const participantIds = baseContext.participants.map((entry) => entry.id);
    return memoryEngine.finalizeConversation({
      ...baseContext,
      finalInstructions: PromptBuilder.getFinalSummaryInstructions(),
      buildPrompt: (context) => memoryEngine.buildFinalizationPrompt(context),
      persistCharacterFolders: async (finalSummary, context) => {
        return this.gameData.saveCharactersSummaries(finalSummary, participantIds, {
          finalizationId: context.finalizationId,
          excludedOwnerIds: context.excludedSummaryOwnerIds,
          participantProfiles: context.participants,
          directedSummaries: context.directedSummaries,
          presenceJoins: context.joinEvents || [],
          presenceLeaves: context.leaveEvents || []
        });
      },
      requestSummary: async (summaryPrompt, requestOptions = {}) => {
        console.log(`[TOKEN_COUNT] Final memory prompt tokens: ${this.estimateTokenCount(summaryPrompt)}`);
        const maxTokens = typeof PromptBuilder.getFinalSummaryMaxTokens === "function" ? PromptBuilder.getFinalSummaryMaxTokens() : 4096;
        return llmManager.sendSummaryRequest(summaryPrompt, void 0, {
          requestType: "final_summary",
          summaryAttempt: requestOptions.attempt,
          maxTokens
        });
      }
    });
  }
  async recoverPendingMemories() {
    if (!memoryEngine || !this.gameData) return;
    const results = await memoryEngine.recoverPendingFinalizations({
      buildPrompt: (context) => memoryEngine.buildFinalizationPrompt({ ...context, finalInstructions: PromptBuilder.getFinalSummaryInstructions() }),
      requestSummary: (summaryPrompt) => llmManager.sendSummaryRequest(summaryPrompt, void 0, { requestType: "memory_recovery", maxTokens: typeof PromptBuilder.getFinalSummaryMaxTokens === "function" ? PromptBuilder.getFinalSummaryMaxTokens() : 4096 }),
      resolveParticipantProfiles: (snapshot) => memoryEngine.resolveRecoveryParticipantProfiles(snapshot, [...this.summaryParticipantProfiles.values()]),
      persistCharacterFolders: async (finalSummary, context) => {
        const participantIds = (context.participants || []).map((entry) => entry.id);
        return this.gameData.saveCharactersSummaries(finalSummary, participantIds, {
          finalizationId: context.finalizationId,
          excludedOwnerIds: context.excludedSummaryOwnerIds,
          participantProfiles: context.participants,
          directedSummaries: context.directedSummaries,
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
      (entry) => "role" in entry
    );
  }
  clearHistory() {
    this.messages = [];
  }
  end() {
    this.isActive = false;
    this.temporarySocialEvidenceStore?.clear?.();
    this.socialConsequenceState?.counts?.clear?.();
    this.socialConsequenceState?.reservations?.clear?.();
    this.socialConsequenceState = null;
    this.clearHistory();
    cleanLogFile(settingsRepository.getCK3DebugLogPath());
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
    return this.getApprovalManager().approve(approvalEntryId);
  }
  /**
   * Decline actions for pending approval
   */
  async declineActions(approvalEntryId) {
    return this.getApprovalManager().decline(approvalEntryId);
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

module.exports = { Conversation };
