"use strict";

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
let createSummaryImport = null;
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
    createSummaryImport = dependencies.createSummaryImport || createSummaryImport;
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
    this.pendingSummaryImports = /* @__PURE__ */ new Map();
    this.hasAcceptedImports = /* @__PURE__ */ new Set();
    this.inactiveParticipantIds = /* @__PURE__ */ new Map();
    // Action checks are scoped to the current player turn. This prevents one
    // narrated event from being sent to the action model once per NPC reply.
    this.actionGateProcessedTriggers = /* @__PURE__ */ new Set();
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
      isActionDisabled: (actionId) => actionRegistry.isActionDisabled?.(actionId) === true
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
      this.gameData.loadCharactersSummaries();
      await this.recoverPendingMemories();
      await this.checkForOtherPlayerSummaries();
      this.isActive = true;
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
    memoryEngine?.syncRollingStateFromLegacyFields(this);
    memoryEngine?.syncLegacyRollingFields(this);
    const memoryContext = await this.getMemoryContextFor(npc);
    const currentMessages = PromptBuilder.buildMessages(
      this.getHistory().slice(this.lastSummarizedMessageIndex),
      npc,
      this.gameData,
      this.currentSummary,
      memoryContext
    );
    const estimatedTokens = this.estimateTokenCount(currentMessages);
    const contextLimit = await llmManager.getCurrentContextLength() || 1e4;
    if (estimatedTokens > contextLimit * this.CONTEXT_LIMIT_PERCENTAGE) {
      console.log(`Context approaching limit (${estimatedTokens}/${contextLimit}), creating rolling summary`);
      await this.createRollingSummary(contextLimit);
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
    const limit = contextLimit || await llmManager.getCurrentContextLength() || 1e4;
    const history = this.getHistory();
    const activeParticipantIds = this.getActiveConversationCharacters().map((character) => character.id);
    const mentionableProfiles = this.gameData.getMentionableCharacterProfiles();
    const mentionedCharacterIds = memoryEngine.findMentionedOutOfSceneCharacters({
      conversation: this,
      history,
      candidates: [...mentionableProfiles.values()],
      excludedIds: activeParticipantIds
    });
    if (!this.gameData.mentionedCharactersInContext) this.gameData.mentionedCharactersInContext = /* @__PURE__ */ new Set();
    for (const characterId of mentionedCharacterIds) this.gameData.mentionedCharactersInContext.add(characterId);
    const mentionedEntityNames = Object.fromEntries(mentionedCharacterIds.map((characterId) => {
      const character = mentionableProfiles.get(characterId);
      return [characterId, character ? [...new Set([character.fullName, character.shortName, character.firstName].filter(Boolean))] : []];
    }));
    const query = history.slice(-4).map((entry) => entry.content || "").filter(Boolean).join("\n");
    return memoryEngine.retrieveForResponder({
      characterId: npc.id,
      query,
      mentionedEntityIds: mentionedCharacterIds,
      mentionedEntityNames,
      directCounterpartIds: activeParticipantIds.filter((characterId) => characterId !== npc.id),
      currentTotalDays: this.gameData.totalDays,
      tokenBudget: Math.min(2400, Math.max(800, Math.floor(limit * 0.08))),
      estimateTokens: (text) => TokenCounter.estimateTokens(text)
    });
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
  isCharacterAvailableForConversation(character) {
    if (!character || this.inactiveParticipantIds?.has(character.id)) return false;
    return character.isDead !== true && character.dead !== true && character.alive !== false;
  }
  markParticipantInactive(characterId, reason) {
    memoryEngine?.markParticipantLeft(this, characterId, this.nextId);
    return actionSystem.participantLifecycle.deactivate(this, characterId, reason);
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
      if (!this.isResponseCurrent(responseState, npc)) throw new Error("AbortError: Message cancelled");
      const promptBuild = PromptBuilder.buildMessagesWithTokenCount(
        this.getHistory().slice(this.lastSummarizedMessageIndex),
        npc,
        this.gameData,
        this.currentSummary,
        memoryContext
      );
      const llmMessages = promptBuild.messages;
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
          blocks: promptBuild.blocks.map(({ block, content, tokens }, index) => ({ id: block.id, label: block.label, type: block.type, position: index, tokens, fingerprint: createPromptFingerprint(content) }))
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
    }
  }
  /**
   * Handle action results from ActionEngine - separate auto-approved from needs-approval
   */
  async handleActionResults(associatedMessageId, npc, actionResults) {
    return this.getApprovalManager().handleActionResults(associatedMessageId, npc, actionResults);
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
    this.emitUpdate();
    const playerActionResults = await ActionEngine.evaluateForCharacter(this, user, null, userMsg);
    if (turnEpoch !== this.turnEpoch) return;
    await this.handleActionResults(userMsg.id, user, playerActionResults);
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
    const participantIds = [this.gameData.playerID];
    const seen = /* @__PURE__ */ new Set(participantIds);
    const addParticipant = (characterId) => {
      const numericId = Number(characterId);
      if (!Number.isFinite(numericId) || seen.has(numericId) || !this.gameData.characters.has(numericId)) return;
      seen.add(numericId);
      participantIds.push(numericId);
    };
    const participantPresence = memoryEngine?.ensureConversationState(this).participantPresence || [];
    for (const participant of participantPresence) addParticipant(participant.characterId);
    for (const message of this.getHistory()) {
      if (message.role !== "assistant" || !message.name) continue;
      const character = [...this.gameData.characters.values()].find((candidate) => candidate.fullName === message.name || candidate.shortName === message.name || candidate.firstName === message.name);
      if (character) addParticipant(character.id);
    }
    return participantIds;
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
    const allMessages = this.getHistory();
    const participantIds = this.getSummaryParticipantIds();
    const participants = participantIds.map((id) => this.gameData.characters.get(id)).filter(Boolean).map((character) => ({ id: character.id, name: character.shortName, fullName: character.fullName }));
    const state = memoryEngine.ensureConversationState(this);
    return memoryEngine.finalizeConversation({
      conversationId: this.id,
      date: this.gameData.date,
      totalDays: this.gameData.totalDays,
      messages: allMessages,
      participants,
      participantPresence: state.participantPresence,
      rollingState: state.rollingState,
      finalInstructions: PromptBuilder.getFinalSummaryInstructions(),
      buildPrompt: (context) => memoryEngine.buildFinalizationPrompt(context),
      persistCharacterFolders: async (finalSummary, context) => {
        return this.gameData.saveCharactersSummaries(finalSummary, participantIds, { finalizationId: context.finalizationId }) || { success: true, skipped: true };
      },
      requestSummary: async (summaryPrompt) => {
        console.log(`[TOKEN_COUNT] Final memory prompt tokens: ${this.estimateTokenCount(summaryPrompt)}`);
        return llmManager.sendSummaryRequest(summaryPrompt, void 0, { requestType: "final_summary" });
      }
    });
  }
  async recoverPendingMemories() {
    if (!memoryEngine || !this.gameData) return;
    const results = await memoryEngine.recoverPendingFinalizations({
      buildPrompt: (context) => memoryEngine.buildFinalizationPrompt({ ...context, finalInstructions: PromptBuilder.getFinalSummaryInstructions() }),
      requestSummary: (summaryPrompt) => llmManager.sendSummaryRequest(summaryPrompt, void 0, { requestType: "memory_recovery" }),
      persistCharacterFolders: async (finalSummary, context) => {
        const participantIds = (context.participants || []).map((entry) => entry.id);
        return this.gameData.saveCharactersSummaries(finalSummary, participantIds, { finalizationId: context.finalizationId }) || { success: true, skipped: true };
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
   * Check for conversation summaries from other player characters
   */
  async checkForOtherPlayerSummaries() {
    try {
      const importResults = await this.gameData.checkForSummariesFromOtherPlayers();
      for (const result of importResults) {
        const importKey = `${result.characterId}_${result.sourcePlayerId}`;
        if (!this.pendingSummaryImports.has(importKey)) {
          this.pendingSummaryImports.set(importKey, result);
          const importEntry = createSummaryImport({
            id: this.nextId++,
            sourcePlayerId: result.sourcePlayerId,
            characterId: result.characterId,
            characterName: result.characterName,
            summaryCount: result.summaryCount,
            sourceFilePath: result.sourceFilePath,
            status: "pending"
          });
          this.messages.push(importEntry);
        }
      }
      if (importResults.length > 0) {
        this.emitUpdate();
      }
    } catch (error) {
      console.error("Error checking for other player summaries:", error);
    }
  }
  /**
   * Accept summary import for a character
   */
  async acceptSummaryImport(characterId, sourcePlayerId) {
    const importKey = `${characterId}_${sourcePlayerId}`;
    const importResult = this.pendingSummaryImports.get(importKey);
    if (!importResult) {
      throw new Error(`No pending import found for character ${characterId} from player ${sourcePlayerId}`);
    }
    try {
      const character = this.gameData.characters.get(characterId);
      const mergeWithExisting = character && character.conversationSummaries.length > 0;
      await this.gameData.importSummariesFromOtherPlayer(
        characterId,
        importResult.sourcePlayerId,
        mergeWithExisting
      );
      this.hasAcceptedImports.add(characterId);
      this.pendingSummaryImports.delete(importKey);
      const entryIndex = this.messages.findIndex(
        (msg) => msg.type === "summary-import" && "characterId" in msg && "sourcePlayerId" in msg && msg.characterId === characterId && msg.sourcePlayerId === importResult.sourcePlayerId
      );
      if (entryIndex !== -1) {
        this.messages.splice(entryIndex, 1);
        this.emitUpdate();
      }
      console.log(`Accepted summary import for character ${characterId} from player ${importResult.sourcePlayerId}`);
    } catch (error) {
      console.error(`Failed to accept summary import for character ${characterId}:`, error);
      throw error;
    }
  }
  /**
   * Decline summary import for a character
   */
  async declineSummaryImport(characterId, sourcePlayerId) {
    const importKey = `${characterId}_${sourcePlayerId}`;
    const importResult = this.pendingSummaryImports.get(importKey);
    if (!importResult) {
      throw new Error(`No pending import found for character ${characterId} from player ${sourcePlayerId}`);
    }
    this.pendingSummaryImports.delete(importKey);
    const entryIndex = this.messages.findIndex(
      (msg) => msg.type === "summary-import" && "characterId" in msg && "sourcePlayerId" in msg && msg.characterId === characterId && msg.sourcePlayerId === importResult.sourcePlayerId
    );
    if (entryIndex !== -1) {
      this.messages.splice(entryIndex, 1);
      this.emitUpdate();
    }
    console.log(`Declined summary import for character ${characterId} from player ${importResult.sourcePlayerId}`);
  }
  /**
   * Open summary file in default editor
   */
  async openSummaryFile(filePath) {
    try {
      await electron.shell.openPath(filePath);
    } catch (error) {
      console.error("Failed to open summary file:", error);
      throw error;
    }
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
   * Create a summary for a character that is leaving the conversation
   * @param characterId - The ID of the character leaving
   * @param summaryPrompt - The prompt messages to use for generating the summary
   * @returns The generated summary or null if failed
   */
  async createCharacterLeavingSummary(characterId, summaryPrompt) {
    const character = this.gameData.characters.get(characterId);
    if (!character) {
      console.error(`Character ${characterId} not found for leaving summary`);
      return null;
    }
    console.log(`Creating leaving summary for ${character.fullName}`);
    try {
      const estimatedTokens = this.estimateTokenCount(summaryPrompt);
      console.log(`[TOKEN_COUNT] Character leaving summary for ${character.fullName}: ${estimatedTokens}`);
      const result = await llmManager.sendSummaryRequest(summaryPrompt, void 0, { requestType: "leaving_summary", character: character.shortName });
      if (result && typeof result === "object" && "content" in result) {
        const summary = result.content;
        const state = memoryEngine?.ensureConversationState(this);
        memoryEngine?.recordLeavingMemory({
          characterId,
          participantIds: state?.participantPresence?.filter((window) => window.joinedAtMessageId <= this.nextId && (window.leftAtMessageId == null || window.leftAtMessageId >= this.nextId)).map((window) => window.characterId) || [this.gameData.playerID, characterId],
          content: summary,
          conversationId: this.id,
          date: this.gameData.date,
          totalDays: this.gameData.totalDays
        });
        console.log(`Generated leaving summary for ${character.fullName} (${summary.length} characters)`);
        logVerboseLLM(`[Summary][verbose] Leaving summary for ${character.fullName}:`, summary);
        return summary;
      }
      console.error("Invalid response format for character leaving summary");
      return null;
    } catch (error) {
      console.error(`Failed to create leaving summary for ${character.fullName}:`, error);
      return null;
    }
  }
  /**
   * Remove a character from the conversation entirely
   */
  removeCharacterFromConversation(characterId) {
    const character = this.gameData.characters.get(characterId);
    if (!character) {
      console.warn(`Character ${characterId} not found in conversation`);
      return;
    }
    console.log(`Removing ${character.fullName} from conversation`);
    this.invalidateApprovalsForCharacter(characterId, "removed");
    this.gameData.characters.delete(characterId);
    const initialQueueLength = this.npcQueue.length;
    this.npcQueue = this.npcQueue.filter((char) => char.id !== characterId);
    if (this.npcQueue.length < initialQueueLength) {
      console.log(`Removed ${character.fullName} from NPC queue`);
    }
    if (this.customQueue) {
      const initialCustomQueueLength = this.customQueue.length;
      this.customQueue = this.customQueue.filter((char) => char.id !== characterId);
      if (this.customQueue.length < initialCustomQueueLength) {
        console.log(`Removed ${character.fullName} from custom queue`);
      }
    }
    console.log(`Character ${character.fullName} successfully removed from conversation`);
    this.emitUpdate();
  }
}

module.exports = { Conversation };
