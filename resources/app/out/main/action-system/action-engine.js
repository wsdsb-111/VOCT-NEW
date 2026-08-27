"use strict";

const candidateGate = require("./candidate-gate");
const eventParser = require("./event-parser");
const socialEvent = require("./social-event");
const semanticResolver = require("./semantic-resolver");
const { ConversationReferenceContext } = require("./reference-context");
const { ReferenceResolver } = require("./reference-resolver");
const { ParticipantResolver } = require("./participant-resolver");
const eventTracker = require("./event-tracker");
const actionDecisionTrace = require("./action-decision-trace");
const actionRuleRegistry = require("./action-rule-registry");
const availabilityService = require("./availability-service");
const deterministicInvocation = require("./deterministic-invocation");
const invocationValidator = require("./invocation-validator");
const actionTypes = require("./action-types");
const actionExecutor = require("./action-executor");
const actionModes = require("./modes");
const interaction = require("./interaction");
const semantic = require("./semantic");

const actionSystem = {
  candidateGate,
  eventParser,
  socialEvent,
  semanticResolver,
  ConversationReferenceContext,
  ReferenceResolver,
  ParticipantResolver,
  eventTracker,
  actionDecisionTrace,
  actionRuleRegistry,
  availabilityService,
  deterministicInvocation,
  invocationValidator,
  ...actionTypes,
  actionExecutor,
  actionModes,
  interaction,
  semantic
};

let actionRegistry = null;
let settingsRepository = null;
let usageAnalytics = null;
let llmManager = null;
let ActionPromptBuilder = null;
let ActionSandbox = null;
let ActionEffectWriter = null;
let buildStructuredResponseJsonSchema = null;
let buildStructuredResponseSchema = null;
let healJsonResponseWithLogging = null;
let resolveI18nString = null;
let logVerboseLLM = null;

class ActionEngine {
  static configure(dependencies = {}) {
    actionRegistry = dependencies.actionRegistry || actionRegistry;
    settingsRepository = dependencies.settingsRepository || settingsRepository;
    usageAnalytics = dependencies.usageAnalytics || usageAnalytics;
    llmManager = dependencies.llmManager || llmManager;
    ActionPromptBuilder = dependencies.ActionPromptBuilder || ActionPromptBuilder;
    ActionSandbox = dependencies.ActionSandbox || ActionSandbox;
    ActionEffectWriter = dependencies.ActionEffectWriter || ActionEffectWriter;
    buildStructuredResponseJsonSchema = dependencies.buildStructuredResponseJsonSchema || buildStructuredResponseJsonSchema;
    buildStructuredResponseSchema = dependencies.buildStructuredResponseSchema || buildStructuredResponseSchema;
    healJsonResponseWithLogging = dependencies.healJsonResponseWithLogging || healJsonResponseWithLogging;
    resolveI18nString = dependencies.resolveI18nString || resolveI18nString;
    logVerboseLLM = dependencies.logVerboseLLM || logVerboseLLM;
    return this;
  }
  /**
   * Action calls are expensive and should only run after the dialogue explicitly
   * describes a game-state-changing action. This is intentionally conservative:
   * ordinary conversation, plans, opinions, poetry, threats, and emotion alone
   * do not trigger an API request.
   */
  static getActionTriggers(text, options = {}) {
    return actionSystem.candidateGate.detect(text, options, { registry: typeof actionRegistry !== "undefined" ? actionRegistry : null });
  }
  /**
   * Convert broad Gate matches into independently actionable events. The Gate
   * remains a cheap candidate recall layer; this parser is the only source of
   * truth for whether a current action actually occurred.
   */
  static parseActionEvents(text) {
    return actionSystem.eventParser.parse(text, { registry: typeof actionRegistry !== "undefined" ? actionRegistry : null });
  }
  static getActionEvents(text) {
    return this.parseActionEvents(text).events;
  }
  /**
   * Stage two of action detection. Stage one above only establishes that a
   * concrete action was narrated. This stage combines the resulting category
   * with descriptive evidence and narrows the script candidates before the
   * model resolves actor, target, and arguments. Keeping this deterministic
   * prevents a vivid sentence from becoming an unrelated CK3 state change.
   */
  static resolveMetadataSemanticCandidates(event) {
    return actionSystem.semanticResolver.resolveMetadataCandidates(event, actionRegistry);
  }
  static resolveSemanticEvent(event) {
    return actionSystem.semanticResolver.resolve(event, {
      registry: actionRegistry
    });
  }
  /**
   * Compatibility aggregate for callers still expecting a message-level
   * profile. Every semantic decision is nevertheless made per ActionEvent
   * against Positive Evidence, never against the full raw message.
   */
  static getSemanticActionProfile(text, initialReasons = []) {
    const parsed = this.parseActionEvents(text);
    const events = parsed.events;
    const resolvedEvents = events.map((event) => {
      const profile = this.resolveSemanticEvent(event);
      return {
        ...event,
        reasons: profile.reasons,
        allowedActionIds: profile.allowedActionIds,
        semanticEvidence: profile.evidence,
        resolutionMode: profile.mode
      };
    });
    const reasons = [];
    const allowedActionIds = [];
    const evidence = [];
    for (const event of resolvedEvents) {
      for (const reason of event.reasons) {
        if (!reasons.includes(reason)) reasons.push(reason);
      }
      for (const actionId of event.allowedActionIds) {
        if (!allowedActionIds.includes(actionId)) allowedActionIds.push(actionId);
      }
      for (const label of event.semanticEvidence) {
        if (!evidence.includes(label)) evidence.push(label);
      }
    }
    const resolutionModes = Array.from(new Set(resolvedEvents.map((event) => event.resolutionMode)));
    return { reasons, allowedActionIds, evidence, events: resolvedEvents, socialEvents: parsed.socialEvents || [], rejectedCandidates: parsed.rejectedCandidates || [], resolutionMode: resolutionModes.length === 1 ? resolutionModes[0] : resolutionModes.length === 0 ? "unresolved" : "mixed" };
  }
  static getActionTrigger(text) {
    return this.getActionTriggers(text)[0] || null;
  }
  static getAllowedPoseOptions(reasons) {
    const options = /* @__PURE__ */ new Set();
    if (reasons.includes("drinking_or_toast")) {
      options.add("drinking");
      options.add("toast");
    }
    if (reasons.includes("visible_pose")) {
      ["idle", "sad", "happy", "love", "admiration", "pain", "worry", "anger", "rage", "fear", "shock", "stunned", "disgust", "disapproval", "crying", "laugh", "thinking", "reading", "writing", "pageflipping", "praying", "eavesdrop", "debating", "storyteller", "dancing", "eyeroll", "holdingstaff", "scepter", "stayback"].forEach((option) => options.add(option));
    }
    return options;
  }
  static getConversationReferenceContext(conv, message, speaker) {
    const system = actionSystem;
    const characters = typeof conv.getActiveConversationCharacters === "function" ? conv.getActiveConversationCharacters() : Array.from(conv.gameData?.characters?.values?.() || []).filter((character) => !conv.inactiveParticipantIds?.has(character.id) && character.isDead !== true && character.dead !== true && character.alive !== false);
    if (!conv.referenceContext) {
      conv.referenceContext = new system.ConversationReferenceContext({
        conversationId: conv.id || null,
        activeParticipantIds: characters.map((character) => character.id)
      });
    }
    const context = conv.referenceContext;
    context.activeParticipantIds = characters.map((character) => character.id);
    const findSpeaker = (entry) => {
      if (entry?.role === "user" || entry?.name === conv.gameData?.playerName) return conv.gameData?.characters?.get(conv.gameData?.playerID) || speaker;
      return characters.find((character) => character.fullName === entry?.name || character.shortName === entry?.name) || null;
    };
    const recentMessages = [...(conv.messages || []).slice(-4), message].filter((entry, index, list) => entry && list.findIndex((candidate) => candidate.id === entry.id) === index);
    for (const entry of recentMessages) {
      context.observeMessage({
        message: entry,
        speaker: entry === message ? speaker : findSpeaker(entry),
        characters,
        primaryAddresseeId: entry.primaryAddresseeId ?? entry.addresseeCharacterId ?? conv.primaryAddresseeId ?? null
      });
    }
    return context;
  }
  static resolveEventParticipants(input) {
    const { event, message, speaker, gameData, actionDefinition, actionId, referenceContext, primaryAddresseeId } = input;
    const system = actionSystem;
    if (event?.pendingBinding) {
      const sourceCharacter = gameData.characters.get(Number(event.pendingBinding.sourceCharacterId)) || null;
      const targetCharacter = gameData.characters.get(Number(event.pendingBinding.targetCharacterId)) || null;
      if (!sourceCharacter || !targetCharacter) return { mode: "unresolved", reason: "pending_participant_unavailable", sourceCharacter, targetCharacter, binding: null };
      const binding = system.createParticipantBinding({
        messageId: message?.id,
        eventId: event.eventId,
        traceId: event.traceId,
        actionId,
        speakerCharacterId: speaker?.id,
        actorCharacterId: sourceCharacter.id,
        patientCharacterId: targetCharacter.id,
        sourceCharacterId: sourceCharacter.id,
        targetCharacterId: targetCharacter.id,
        references: [],
        evidence: event.evidence,
        resolutionBasis: ["pending_intent_binding"]
      });
      return { mode: "resolved", reason: "pending_intent_binding", sourceCharacter, targetCharacter, binding };
    }
    const references = system.ReferenceResolver.resolveEventReferences({
      message,
      event,
      speaker,
      gameData,
      referenceContext,
      primaryAddresseeId,
      actionDefinition
    });
    return system.ParticipantResolver.resolve({
      event,
      message,
      speaker,
      gameData,
      actionDefinition,
      actionId,
      references,
      activeParticipantIds: referenceContext?.activeParticipantIds
    });
  }
  static shouldEvaluateForMessage(conv, message, actionEvent = null) {
    const detectedReasons = actionEvent ? actionEvent.reasons : this.getActionTriggers(message?.content);
    const semanticProfile = actionEvent ? {
      reasons: actionEvent.reasons,
      allowedActionIds: actionEvent.allowedActionIds,
      evidence: actionEvent.semanticEvidence,
      events: [actionEvent],
      resolutionMode: actionEvent.resolutionMode
    } : this.getSemanticActionProfile(message?.content, detectedReasons);
    if (!actionEvent && semanticProfile.events.length === 0) {
      return { shouldEvaluate: false, reason: "no_executed_action_event", semanticProfile };
    }
    const semanticReasons = semanticProfile.reasons;
    const dedupeKey = actionEvent ? actionSystem.eventTracker.getEventKey(message, actionEvent) : `${message.id ?? "unknown"}|${semanticReasons.join("+")}|${message.name || message.role || "unknown"}|${message.content}`;
    if (!conv.actionGateProcessedTriggers) conv.actionGateProcessedTriggers = /* @__PURE__ */ new Set();
    if (!conv.processedActionEventIds) conv.processedActionEventIds = /* @__PURE__ */ new Set();
    const eventDedupeKey = actionEvent ? `${conv.id || "conversation"}|${conv.turnEpoch ?? 0}|${dedupeKey}` : null;
    if (eventDedupeKey && conv.processedActionEventIds.has(eventDedupeKey)) {
      return { shouldEvaluate: false, reason: "already_processed_action_event" };
    }
    if (conv.actionGateProcessedTriggers.has(dedupeKey)) {
      return { shouldEvaluate: false, reason: "already_processed_action_text" };
    }
    // Do not suppress a different character's explicit action merely because
    // another message in this turn used the same category. The exact-message
    // key above still prevents a single player line from being evaluated more
    // than once, while multi-NPC dialogue keeps every distinct action.
    return { shouldEvaluate: true, reason: semanticReasons.join("+"), reasons: semanticReasons, semanticProfile, dedupeKey, eventDedupeKey };
  }
  /**
   * Evaluate actions for the given NPC (as source) based on recent conversation state.
   * - Gathers available actions via check()
   * - Builds a structured-output schema limiting targets and args
   * - Requests LLM to select actions with strict schema
   * - Separates actions into auto-approved and needs-approval based on settings
   * - Runs auto-approved actions immediately
   * - Returns both executed and pending actions
   */
  static buildTurnEvaluationPlan({ playerMessage, player, npcMessage, npc }) {
    const evaluations = [];
    if (playerMessage && player) {
      evaluations.push({ source: player, message: playerMessage, associatedMessageId: playerMessage.id, kind: "player" });
    }
    if (npcMessage && npc) {
      evaluations.push({ source: npc, message: npcMessage, associatedMessageId: npcMessage.id, kind: "npc" });
    }
    return evaluations;
  }
  static traceDecision(actionId, stage, outcome, details = {}) {
    const { eventId = null, traceId = null, ...traceDetails } = details;
    return actionSystem.actionDecisionTrace.record({
      analytics: typeof usageAnalytics !== "undefined" ? usageAnalytics : null,
      actionId,
      eventId,
      traceId,
      stage,
      outcome,
      details: traceDetails
    });
  }
  static getModeState(conv) {
    const configuredMode = settingsRepository?.getActionSystemMode?.() || "balanced";
    const state = actionSystem.actionModes.syncConversationMode(conv, configuredMode);
    if (!conv.actionSystemModeAnalyticsRecorded) {
      usageAnalytics.record({ requestType: "action_mode_state", actionSystemMode: state.mode, turnEpoch: conv.turnEpoch ?? null }, null);
      conv.actionSystemModeAnalyticsRecorded = true;
    }
    if (state.changed) {
      usageAnalytics.record({ requestType: "action_mode_changed", actionSystemMode: state.mode, previousActionSystemMode: state.previous, turnEpoch: conv.turnEpoch ?? null }, null);
    }
    return { ...state, policy: actionSystem.actionModes.getPolicy(state.mode) };
  }
  static recordModeMetric(conv, mode, metric, details = {}) {
    usageAnalytics.record({ requestType: "action_mode_metric", actionSystemMode: mode, metric, turnEpoch: conv.turnEpoch ?? null, ...details }, null);
  }
  static buildPendingActionEvent(intent, message) {
    const actionId = intent.candidateActionIds[0];
    return actionSystem.createActionEvent({
      eventId: `${intent.pendingId}:${message?.id ?? "response"}`,
      traceId: `action:${intent.pendingId}:${message?.id ?? "response"}`,
      category: intent.category,
      evidence: { text: String(message?.content || ""), start: 0, end: String(message?.content || "").length },
      executionStatus: "executed",
      resultStatus: "succeeded",
      sourceClauseIndex: 0,
      reasons: [intent.category],
      allowedActionIds: [actionId],
      semanticEvidence: ["pending_confirmation"],
      resolutionMode: "resolved",
      pendingConfirmed: true,
      pendingId: intent.pendingId,
      pendingArgs: intent.extractedArgs || {},
      pendingBinding: { sourceCharacterId: intent.initiatorId, targetCharacterId: intent.targetId },
      interpretationSource: "pending"
    });
  }
  static interpretPendingInteraction(conv, speaker, message, mode) {
    const interaction = actionSystem.interaction;
    if (!(conv.pendingActionIntentStore instanceof interaction.PendingIntentStore)) conv.pendingActionIntentStore = new interaction.PendingIntentStore();
    const store = conv.pendingActionIntentStore;
    for (const expired of store.expire(conv.turnEpoch ?? 0)) this.recordModeMetric(conv, mode, "pendingExpired", { pendingId: expired.pendingId, actionId: expired.candidateActionIds[0] });
    const pendingForSpeaker = store.awaitingForTarget(speaker.id, conv.turnEpoch ?? 0);
    const response = interaction.acceptanceResolver.resolve(message?.content);
    if (response.decision !== "none" && pendingForSpeaker.length > 0) {
      const recentIds = new Set((conv.messages || []).slice(-4).map((entry) => entry?.id));
      if (pendingForSpeaker.length !== 1 || !recentIds.has(pendingForSpeaker[0].proposalMessageId)) {
        this.recordModeMetric(conv, mode, "pendingAmbiguous", { candidateCount: pendingForSpeaker.length });
        return { handled: true, event: null };
      }
      const intent = pendingForSpeaker[0];
      if (response.decision === "reject") {
        store.reject(intent.pendingId);
        this.recordModeMetric(conv, mode, "pendingRejected", { pendingId: intent.pendingId, actionId: intent.candidateActionIds[0] });
        return { handled: true, event: null };
      }
      if (response.decision === "uncertain") return { handled: true, event: null };
      store.confirm(intent.pendingId);
      this.recordModeMetric(conv, mode, "pendingConfirmed", { pendingId: intent.pendingId, actionId: intent.candidateActionIds[0] });
      if (intent.confirmationPolicy !== "acceptance_completes") return { handled: true, event: null };
      return { handled: true, event: this.buildPendingActionEvent(intent, message) };
    }
    const characters = typeof conv.getActiveConversationCharacters === "function" ? conv.getActiveConversationCharacters() : Array.from(conv.gameData?.characters?.values?.() || []);
    const proposal = interaction.proposalDetector.detect({ text: message?.content, speaker, characters, registry: actionRegistry });
    if (!proposal) return { handled: false, event: null };
    const intent = store.create({ ...proposal, proposalMessageId: message?.id ?? null, proposalText: String(message?.content || ""), createdTurnEpoch: conv.turnEpoch ?? 0 });
    this.recordModeMetric(conv, mode, "pendingCreated", { pendingId: intent.pendingId, actionId: intent.candidateActionIds[0] });
    return { handled: true, event: null };
  }
  static buildPrecisionActionEvent(result, message) {
    const action = actionRegistry.getById(result.actionId);
    const evidenceText = typeof result.evidence === "string" && result.evidence.trim() ? result.evidence.trim() : String(message?.content || "");
    const start = Math.max(0, String(message?.content || "").indexOf(evidenceText));
    return actionSystem.createActionEvent({
      eventId: `precision:${message?.id ?? "message"}:${result.actionId}`,
      traceId: `action:precision:${message?.id ?? "message"}:${result.actionId}`,
      category: action?.definition?.triggerCategories?.[0] || "other",
      evidence: { text: evidenceText, start, end: start + evidenceText.length },
      executionStatus: "executed",
      resultStatus: "succeeded",
      sourceClauseIndex: 0,
      reasons: [...(action?.definition?.triggerCategories || ["other"])],
      allowedActionIds: [result.actionId],
      semanticEvidence: ["precision_stage_a"],
      resolutionMode: "resolved",
      interpretationSource: "precision_stage_a",
      precisionConfidence: result.confidence
    });
  }
  static shouldInvokePrecisionJudge({ gate, semanticProfile, participantAmbiguous, candidateActions, modePolicy }) {
    if (!modePolicy?.usePrecisionJudge || !gate?.shouldEvaluate || !semanticProfile?.events?.length || !Array.isArray(candidateActions) || candidateActions.length === 0) return null;
    const unresolved = semanticProfile.resolutionMode === "unresolved" || semanticProfile.resolutionMode === "ambiguous";
    const conflictingActions = (semanticProfile.allowedActionIds || []).length > 1;
    const highRiskAction = candidateActions.some((action) => (actionRegistry?.getEffectiveRiskLevel?.(action.id) || action.definition?.semantic?.riskLevel) === "high");
    if (modePolicy.precisionJudgeScope === "high_risk_or_conflict") {
      if (conflictingActions) return "conflicting_actions";
      if (unresolved && highRiskAction) return "high_risk_action";
      return null;
    }
    if (unresolved) return highRiskAction ? "high_risk_action" : "semantic_ambiguous";
    if (conflictingActions) return "conflicting_actions";
    if (participantAmbiguous) return "participant_ambiguous";
    return null;
  }
  static async interpretPrecision(conv, speaker, message, signal, mode, { actions, participants, reason }) {
    this.recordModeMetric(conv, mode, "precisionJudgeCalls", { reason, candidateCount: actions.length, participantCount: participants.length });
    const result = await actionSystem.semantic.precisionActionJudge.judge({
      conversation: conv,
      message,
      speaker,
      actions,
      registry: actionRegistry,
      pendingStore: conv.pendingActionIntentStore,
      llmManager,
      signal,
      participants,
      reason,
      mode
    });
    if (result.occurrence === "proposal") {
      const characters = typeof conv.getActiveConversationCharacters === "function" ? conv.getActiveConversationCharacters() : [...conv.gameData.characters.values()];
      const proposal = actionSystem.interaction.proposalDetector.createForAction({ actionId: result.actionId, text: message?.content, speaker, characters, registry: actionRegistry });
      if (!proposal) {
        this.recordModeMetric(conv, mode, "pendingAmbiguous", { actionId: result.actionId, source: "precision_stage_a" });
        return { handled: true, event: null };
      }
      const intent = conv.pendingActionIntentStore.create({ ...proposal, proposalMessageId: message?.id ?? null, proposalText: String(message?.content || ""), createdTurnEpoch: conv.turnEpoch ?? 0 });
      this.recordModeMetric(conv, mode, "stageAProposal", { actionId: result.actionId, confidence: result.confidence, pendingId: intent.pendingId });
      this.recordModeMetric(conv, mode, "pendingCreated", { pendingId: intent.pendingId, actionId: result.actionId, source: "precision_stage_a" });
      return { handled: true, event: null };
    }
    if (result.occurrence === "rejected_pending_commitment" && result.pending) {
      conv.pendingActionIntentStore.reject(result.pending.pendingId);
      this.recordModeMetric(conv, mode, "pendingRejected", { pendingId: result.pending.pendingId, actionId: result.actionId, source: "precision_stage_a" });
      return { handled: true, event: null };
    }
    if (result.occurrence === "accepted_pending_commitment" && result.pending) {
      conv.pendingActionIntentStore.confirm(result.pending.pendingId);
      this.recordModeMetric(conv, mode, "pendingConfirmed", { pendingId: result.pending.pendingId, actionId: result.actionId, source: "precision_stage_a" });
      if (result.pending.confirmationPolicy !== "acceptance_completes") return { handled: true, event: null };
      this.recordModeMetric(conv, mode, "stageAActionDetected", { actionId: result.actionId, confidence: result.confidence, occurrence: result.occurrence });
      return { handled: true, event: this.buildPendingActionEvent(result.pending, message) };
    }
    if (result.occurrence === "completed_action" && result.executable) {
      this.recordModeMetric(conv, mode, "stageAActionDetected", { actionId: result.actionId, confidence: result.confidence, occurrence: result.occurrence });
      this.recordModeMetric(conv, mode, "precisionJudgeAction", { actionId: result.actionId, confidence: result.confidence, occurrence: result.occurrence });
      this.recordModeMetric(conv, mode, "precisionJudgeResolved", { actionId: result.actionId, reason, confidence: result.confidence });
      return { handled: true, event: this.buildPrecisionActionEvent(result, message) };
    }
    this.recordModeMetric(conv, mode, "precisionJudgeNoAction", { occurrence: result.occurrence, reason: result.reason || null });
    return { handled: true, event: null };
  }
  static async evaluateForCharacter(conv, npc, signal, actionMessage, actionEvent = null) {
    try {
      if (signal?.aborted) {
        return { autoApproved: [], needsApproval: [] };
      }
      if (conv.inactiveParticipantIds?.has(npc?.id)) {
        usageAnalytics.record({ requestType: "action_skipped", character: npc?.shortName, skipReason: actionSystem.actionDecisionTrace.normalizeActionSkipReason("inactive_participant") }, null);
        return { autoApproved: [], needsApproval: [] };
      }
      const modeState = this.getModeState(conv);
      const actionSystemMode = modeState.mode;
      if (!actionEvent && ["user", "assistant"].includes(actionMessage?.role)) this.recordModeMetric(conv, actionSystemMode, "eligibleMessages");
      if (!actionEvent && modeState.policy.usePendingIntents) {
        const interaction = this.interpretPendingInteraction(conv, npc, actionMessage, actionSystemMode);
        if (interaction.event) return this.evaluateForCharacter(conv, npc, signal, actionMessage, interaction.event);
        if (interaction.handled) return { autoApproved: [], needsApproval: [] };
      }
      let gate = this.shouldEvaluateForMessage(conv, actionMessage, actionEvent);
      if (!gate.shouldEvaluate) {
        if (!actionEvent && gate.semanticProfile?.socialEvents?.length) {
          for (const socialEvent of gate.semanticProfile.socialEvents) this.recordModeMetric(conv, actionSystemMode, "socialEventRecognized", { category: socialEvent.type, valence: socialEvent.valence, reaction: socialEvent.reaction });
        }
        this.recordModeMetric(conv, actionSystemMode, gate.reason === "already_processed_action_event" || gate.reason === "already_processed_action_text" ? "duplicateSuppressed" : "gateRejected", { reason: gate.reason });
        console.log(`[ActionEngine] Skipped action request for ${npc.shortName}: ${gate.reason}`);
        usageAnalytics.record({ requestType: "action_skipped", character: npc.shortName, skipReason: actionSystem.actionDecisionTrace.normalizeActionSkipReason(gate.reason) }, null);
        return { autoApproved: [], needsApproval: [] };
      }
      this.recordModeMetric(conv, actionSystemMode, "gatePositive", { category: gate.reason });
      if (!actionEvent) {
        const combined = { autoApproved: [], needsApproval: [] };
        for (const event of gate.semanticProfile.events) {
          const eventResult = await this.evaluateForCharacter(conv, npc, signal, actionMessage, event);
          combined.autoApproved.push(...eventResult.autoApproved);
          combined.needsApproval.push(...eventResult.needsApproval);
        }
        return combined;
      }
      this.traceDecision(null, "candidate", "pass", { eventId: actionEvent.eventId, traceId: actionEvent.traceId, category: actionEvent.category });
      if (!actionEvent.pendingConfirmed && actionEvent.interpretationSource !== "precision_stage_a") this.recordModeMetric(conv, actionSystemMode, "localEventCount", { category: actionEvent.category });
      this.recordModeMetric(conv, actionSystemMode, gate.semanticProfile?.resolutionMode === "resolved" ? "localResolved" : "localUnresolved", { category: actionEvent.category });
      this.traceDecision(null, "semantic", gate.semanticProfile.resolutionMode || "resolved", { eventId: actionEvent.eventId, traceId: actionEvent.traceId, category: actionEvent.category });
      console.log(`[ActionEngine] Explicit action keyword detected for ${npc.shortName}: ${gate.reason}`);
      conv.actionGateProcessedTriggers.add(gate.dedupeKey);
      if (gate.eventDedupeKey) conv.processedActionEventIds.add(gate.eventDedupeKey);
      const recordOutcome = (actionOutcome, selectedActionIds = [], skipReason = null, details = {}) => usageAnalytics.record({
        requestType: "action_outcome",
        character: npc.shortName,
        actionTrigger: gate.reason,
        actionOutcome,
        actionCandidateReasons: gate.reasons,
        selectedActionIds,
        executedActionIds: details.executedActionIds || [],
        pendingActionIds: details.pendingActionIds || [],
        failedActionIds: details.failedActionIds || [],
        actionFinishReason: details.actionFinishReason || null,
        invocationOrigin: details.invocationOrigin || null,
        eventId: actionEvent.eventId,
        traceId: actionEvent.traceId,
        turnEpoch: conv.turnEpoch ?? null,
        actionSystemMode,
        skipReason: skipReason ? actionSystem.actionDecisionTrace.normalizeActionSkipReason(skipReason) : null
      }, null);
      let semanticAllowlist = new Set(gate.semanticProfile?.allowedActionIds || []);
      const userLang = settingsRepository.getLanguage();
      const relevantActionIds = typeof actionRegistry.getActionIdsForCategories === "function" ? actionRegistry.getActionIdsForCategories(gate.reasons) : actionSystem.actionRuleRegistry.getActionIdsForCategories(
        actionSystem.actionRuleRegistry.buildCategoryIndex(actionRegistry.getAllActions(false)),
        gate.reasons
      );
      const candidateIsPlayer = actionMessage?.role === "user" || actionMessage?.name === conv.gameData.playerName;
      // Player-narrated actions used to be checked and executed through the
      // first randomly queued NPC. That made a clear player action look like a
      // mismatched source to the selector and often produced an empty result.
      const actionSource = candidateIsPlayer ? conv.gameData.characters.get(conv.gameData.playerID) || npc : npc;
      if (gate.reasons.includes("gold")) {
        relevantActionIds.delete(candidateIsPlayer ? "paysGoldTo" : "playerPaysGoldTo");
      }
      const allLoaded = actionRegistry.getAllActions(
        /* includeDisabled = */
        false
      );
      // Stage two supplies a semantic allowlist whenever the wording identifies
      // a particular script (for example injury rather than death, or a
      // long mutual gaze followed by a kiss rather than generic intimacy).
      // The selector can still resolve participants and arguments, but cannot
      // promote the event into a different game effect.
      const categoryCandidates = allLoaded.filter((action) => relevantActionIds.has(action.id));
      const loaded = gate.semanticProfile?.resolutionMode === "resolved" && semanticAllowlist.size > 0 ? categoryCandidates.filter((action) => semanticAllowlist.has(action.id)) : categoryCandidates;
      const available = [];
      let hadUnresolvedParticipants = false;
      const participantResolutions = [];
      const referenceContext = this.getConversationReferenceContext(conv, actionMessage, actionSource);
      for (const act of loaded) {
        if (signal?.aborted) {
          return { autoApproved: [], needsApproval: [] };
        }
        try {
          const participantResolution = this.resolveEventParticipants({
            event: actionEvent,
            message: actionMessage,
            speaker: actionSource,
            gameData: conv.gameData,
            actionDefinition: act.definition,
            actionId: act.id,
            referenceContext,
            primaryAddresseeId: actionMessage?.primaryAddresseeId ?? actionMessage?.addresseeCharacterId ?? conv.primaryAddresseeId ?? null
          });
          participantResolutions.push(participantResolution);
          for (const reference of participantResolution.binding?.references || []) {
            usageAnalytics.record({
              requestType: "reference_resolution",
              referenceType: reference.referenceType,
              outcome: reference.mode,
              reason: reference.reason || reference.confidenceBasis?.[0] || null
            }, null);
          }
          const references = participantResolution.binding?.references || [];
          this.traceDecision(act.id, "reference", references.some((reference) => reference.mode !== "resolved") ? "unresolved" : "resolved", {
            eventId: actionEvent.eventId,
            traceId: actionEvent.traceId,
            referenceCount: references.length
          });
          if (participantResolution.mode === "unresolved") {
            this.traceDecision(act.id, "binding", "unresolved", { eventId: actionEvent.eventId, traceId: actionEvent.traceId, reason: participantResolution.reason || "unresolved_participants" });
            hadUnresolvedParticipants = true;
            this.recordModeMetric(conv, actionSystemMode, "participantAmbiguous", { actionId: act.id, reason: participantResolution.reason || "unresolved_participants" });
            usageAnalytics.record({
              requestType: "action_participant_resolution",
              actionId: act.id,
              outcome: "unresolved",
              reason: participantResolution.reason || "unresolved_participants"
            }, null);
            continue;
          }
          if (participantResolution.mode === "resolved") {
            this.traceDecision(act.id, "binding", "resolved", {
              eventId: actionEvent.eventId,
              traceId: actionEvent.traceId,
              source: participantResolution.sourceCharacter?.id ?? null,
              target: participantResolution.targetCharacter?.id ?? null
            });
            usageAnalytics.record({
              requestType: "action_participant_resolution",
              actionId: act.id,
              outcome: "resolved",
              reason: participantResolution.reason || "explicit_participants"
            }, null);
            usageAnalytics.record({
              requestType: "participant_binding",
              actionId: act.id,
              outcome: "resolved",
              basis: participantResolution.binding?.resolutionBasis?.join("|") || participantResolution.reason || "explicit_participants"
            }, null);
          }
          const resolvedSource = participantResolution.sourceCharacter || actionSource;
          const resolvedTarget = participantResolution.targetCharacter || null;
          const checkResult = await act.definition.check({
            gameData: conv.gameData,
            sourceCharacter: resolvedSource
          });
          if (!checkResult?.canExecute) continue;
          if (resolvedTarget && Array.isArray(checkResult.validTargetCharacterIds) && !checkResult.validTargetCharacterIds.includes(resolvedTarget.id)) continue;
          let args;
          if (typeof act.definition.args === "function") {
            args = act.definition.args({ gameData: conv.gameData, sourceCharacter: resolvedSource });
          } else {
            args = act.definition.args;
          }
          let resolvedArgs = args.map((arg) => ({
            ...arg,
            description: resolveI18nString(arg.description, userLang)
          }));
          if (act.id === "setEmotion") {
            const allowedPoseOptions = this.getAllowedPoseOptions(gate.reasons);
            resolvedArgs = resolvedArgs.map((arg) => arg.name === "emotion" && arg.type === "enum" ? {
              ...arg,
              options: arg.options.filter((option) => allowedPoseOptions.has(option))
            } : arg);
          }
          let description;
          if (typeof act.definition.description === "function") {
            const descResult = act.definition.description({ gameData: conv.gameData, sourceCharacter: resolvedSource });
            description = resolveI18nString(descResult, userLang);
          } else {
            description = resolveI18nString(act.definition.description, userLang);
          }
          const availableAction = actionSystem.availabilityService.buildAvailableAction({
            action: act,
            args: resolvedArgs,
            checkResult,
            sourceCharacter: resolvedSource,
            targetCharacter: resolvedTarget,
            description,
            binding: participantResolution.binding
          });
          available.push(availableAction);
          this.traceDecision(act.id, "binding", participantResolution.binding?.mode || "speaker", {
            eventId: actionEvent.eventId,
            traceId: actionEvent.traceId,
            sourceLocked: availableAction.sourceLocked,
            targetLocked: availableAction.targetLocked
          });
        } catch (err) {
          actionRegistry.registerValidation(act.id, {
            valid: false,
            message: `check() threw: ${err instanceof Error ? err.message : String(err)}`
          });
        }
      }
      const hasLocalResolution = gate.semanticProfile?.resolutionMode === "resolved" && semanticAllowlist.size > 0;
      const firstResolvedBinding = participantResolutions.find((resolution) => resolution.mode === "resolved") || null;
      if (!hasLocalResolution && modeState.policy.useSemanticRescue && actionEvent.executionStatus === "executed" && actionEvent.resultStatus !== "failed" && loaded.length > 0) {
        this.recordModeMetric(conv, actionSystemMode, "semanticRescueCalls", { category: actionEvent.category, candidateCount: loaded.length });
        const rescue = await actionSystem.semantic.semanticRescue.resolve({
          event: actionEvent,
          actions: loaded,
          registry: actionRegistry,
          llmManager,
          sourceCharacter: firstResolvedBinding?.sourceCharacter || actionSource,
          targetCharacter: firstResolvedBinding?.targetCharacter || null,
          signal,
          mode: actionSystemMode
        });
        if (rescue.matched) {
          semanticAllowlist = new Set([rescue.actionId]);
          gate = {
            ...gate,
            semanticProfile: { ...gate.semanticProfile, resolutionMode: "resolved", allowedActionIds: [rescue.actionId], evidence: ["semantic_rescue"] }
          };
          this.recordModeMetric(conv, actionSystemMode, "semanticRescueMatched", { category: actionEvent.category, actionId: rescue.actionId, confidence: rescue.confidence });
        }
      }
      const precisionReason = actionEvent.pendingConfirmed ? null : this.shouldInvokePrecisionJudge({
        gate,
        semanticProfile: gate.semanticProfile,
        participantAmbiguous: hadUnresolvedParticipants,
        candidateActions: loaded,
        modePolicy: modeState.policy
      });
      if (precisionReason) {
        const precisionParticipants = [actionSource, ...participantResolutions.flatMap((resolution) => [resolution.sourceCharacter, resolution.targetCharacter])].filter((character, index, list) => character && list.findIndex((candidate) => Number(candidate.id) === Number(character.id)) === index);
        if (hadUnresolvedParticipants) {
          for (const character of typeof conv.getActiveConversationCharacters === "function" ? conv.getActiveConversationCharacters() : []) {
            if (!precisionParticipants.some((candidate) => Number(candidate.id) === Number(character.id))) precisionParticipants.push(character);
          }
        }
        const precision = await this.interpretPrecision(conv, actionSource, actionMessage, signal, actionSystemMode, { actions: loaded, participants: precisionParticipants, reason: precisionReason });
        if (precision.event) return this.evaluateForCharacter(conv, npc, signal, actionMessage, precision.event);
        if (precision.handled) return { autoApproved: [], needsApproval: [] };
      }
      if (gate.semanticProfile?.resolutionMode !== "resolved" || semanticAllowlist.size === 0) {
        this.traceDecision(null, "semantic", "rejected", { eventId: actionEvent.eventId, traceId: actionEvent.traceId, category: actionEvent.category, reason: "no_semantic_module_match" });
        recordOutcome("no_semantic_module_match", [], "semantic_unresolved_no_module_match");
        return { autoApproved: [], needsApproval: [] };
      }
      if (semanticAllowlist.size > 0) {
        const allowedAvailable = available.filter((action) => semanticAllowlist.has(action.signature));
        available.splice(0, available.length, ...allowedAvailable);
      }
      if (available.length === 0) {
        recordOutcome("no_available_action", [], hadUnresolvedParticipants ? "unresolved_action_participants" : "no_available_action_for_trigger");
        return { autoApproved: [], needsApproval: [] };
      }
      if (signal?.aborted) {
        console.log("[DEBUG] ActionEngine: Aborted before LLM request");
        return { autoApproved: [], needsApproval: [] };
      }
      const maxActions = Math.max(1, Math.min(4, available.length));
      let parsed;
      let actionFinishReason = null;
      let invocationOrigin = "model";
      const deterministicAvailable = semanticAllowlist.size === 1 ? available.find((action) => semanticAllowlist.has(action.signature)) : null;
      let localCandidate = deterministicAvailable ? actionSystem.deterministicInvocation.resolve({
        availableAction: deterministicAvailable,
        evidenceText: actionEvent?.evidence?.text
      }) : null;
      if (actionEvent?.pendingConfirmed && deterministicAvailable) {
        const binding = deterministicAvailable.participantBinding;
        localCandidate = {
          mode: "local",
          reason: "confirmed_pending_intent",
          invocation: actionSystem.createValidatedInvocation({
            actionId: deterministicAvailable.signature,
            sourceCharacterId: binding.sourceCharacterId,
            targetCharacterId: binding.targetCharacterId,
            bindingId: binding.bindingId,
            eventId: actionEvent.eventId,
            traceId: actionEvent.traceId,
            args: actionEvent.pendingArgs || {}
          }),
          details: { reason: "confirmed_pending_intent" }
        };
      }
      if (localCandidate?.details?.injuryType) {
        this.traceDecision(deterministicAvailable.signature, "invocation", "args_resolved", { eventId: actionEvent.eventId, traceId: actionEvent.traceId, injuryType: localCandidate.details.injuryType, reason: localCandidate.details.reason });
      }
      if (deterministicAvailable?.signature === "setEmotion" && localCandidate?.mode === "unresolved") {
        const reason = localCandidate.reason || "ambiguous_emotion_evidence";
        this.traceDecision(deterministicAvailable.signature, "invocation", "unresolved", { eventId: actionEvent.eventId, traceId: actionEvent.traceId, reason });
        recordOutcome("deterministic_unresolved", [], reason, { invocationOrigin: "local" });
        return { autoApproved: [], needsApproval: [] };
      }
      if (localCandidate?.mode === "local") {
        invocationOrigin = "local";
        parsed = { actions: [localCandidate.invocation] };
        this.traceDecision(deterministicAvailable.signature, "invocation", "local", {
          eventId: actionEvent.eventId,
          traceId: actionEvent.traceId,
          source: localCandidate.invocation.sourceCharacterId,
          target: localCandidate.invocation.targetCharacterId
        });
      } else {
        if (modeState.policy.usePrecisionJudge) this.recordModeMetric(conv, actionSystemMode, "stageBProviderCalls", { actionId: deterministicAvailable?.signature || null });
        usageAnalytics.record({
          requestType: "action_pipeline",
          character: npc.shortName,
          stage: "provider",
          outcome: "called",
          eventId: actionEvent.eventId,
          traceId: actionEvent.traceId,
          invocationOrigin: "model",
          actionSystemMode,
          turnEpoch: conv.turnEpoch ?? null
        }, null);
        const messages = ActionPromptBuilder.buildActionMessages(conv, actionSource, available, {
          message: actionMessage,
          triggers: gate.reasons,
          semanticProfile: gate.semanticProfile,
          actionEvent
        });
        const actionsConfig = settingsRepository.getActionsProviderConfig();
        // The compact schema still goes through the same strict local Zod
        // validation, but avoids repeating a large per-action anyOf tree in
        // every request. It reduces action request input and cache misses; an
        // explicit provider setting remains an escape hatch.
        const useMinimizedSchema = actionsConfig?.useMinimizedActionsSchema ?? true;
        console.log(`[DEBUG] ActionEngine: Using minimized schema: ${useMinimizedSchema}`);
        const jsonSchema = buildStructuredResponseJsonSchema({
          availableActions: available,
          maxActions
        }, useMinimizedSchema);
        const zodSchema = buildStructuredResponseSchema({
          availableActions: available,
          maxActions
        });
        const output = await llmManager.sendActionsRequest(
          messages,
          "votc_actions",
          jsonSchema,
          signal,
          {
            character: npc.shortName,
            actionTrigger: gate.reason,
            actionCandidateReasons: gate.reasons,
            actionSystemMode,
            blocks: ActionPromptBuilder.getActionPromptBlocks(messages, jsonSchema)
          }
        );
        if (signal?.aborted) {
          console.log("[DEBUG] ActionEngine: Aborted after LLM request");
          return { autoApproved: [], needsApproval: [] };
        }
        const result = await output;
        const content = result && typeof result === "object" ? result.content : null;
        actionFinishReason = result && typeof result === "object" ? result.finish_reason || null : null;
        console.log(`[ActionEngine] Received structured response (${typeof content === "string" ? content.length : 0} characters)`);
        logVerboseLLM("[ActionEngine][verbose] Structured response:", content);
        if (!content || typeof content !== "string") {
          recordOutcome("empty_response", [], actionFinishReason === "length" ? "output_token_limit_reached" : "empty_model_response", { actionFinishReason, invocationOrigin });
          return { autoApproved: [], needsApproval: [] };
        }
        if (signal?.aborted) {
          console.log("[DEBUG] ActionEngine: Aborted before parsing response");
          return { autoApproved: [], needsApproval: [] };
        }
        try {
          const maybeJson = healJsonResponseWithLogging(content, "ActionEngine");
          if (!maybeJson) {
            recordOutcome("invalid_json", [], "unparseable_model_response", { actionFinishReason, invocationOrigin });
            return { autoApproved: [], needsApproval: [] };
          }
          parsed = zodSchema.parse(maybeJson);
        } catch (err) {
          recordOutcome("invalid_schema", [], "schema_validation_failed", { actionFinishReason, invocationOrigin });
          return { autoApproved: [], needsApproval: [] };
        }
      }
      if (!parsed || !Array.isArray(parsed.actions) || parsed.actions.length === 0) {
        console.log("[ActionEngine] No actions to process");
        recordOutcome("no_action_selected", [], null, { actionFinishReason, invocationOrigin });
        return { autoApproved: [], needsApproval: [] };
      }
      const seenInvocations = /* @__PURE__ */ new Set();
      parsed.actions = parsed.actions.filter((inv) => {
        const key = `${inv.actionId}|${inv.targetCharacterId ?? ""}|${JSON.stringify(inv.args || {})}`;
        if (seenInvocations.has(key)) return false;
        seenInvocations.add(key);
        return true;
      }).slice(0, maxActions);
      console.log(`[ActionEngine] Processing ${parsed.actions.length} actions from ${invocationOrigin}`);
      if (signal?.aborted) {
        console.log("[DEBUG] ActionEngine: Aborted before processing actions");
        return { autoApproved: [], needsApproval: [] };
      }
      const approvalSettings = settingsRepository.getActionApprovalSettings();
      console.log("[ActionEngine] Approval settings:", approvalSettings);
      const autoApproved = [];
      const needsApproval = [];
      for (const inv of parsed.actions) {
        if (signal?.aborted) {
          console.log("[DEBUG] ActionEngine: Aborted during action processing");
          break;
        }
        const loaded2 = actionRegistry.getById(inv.actionId);
        if (!loaded2 || !loaded2.validation.valid) {
          continue;
        }
        const availableAction = available.find((action) => action.signature === inv.actionId);
        if (!availableAction) continue;
        const bindingValidation = actionSystem.invocationValidator.validateInvocation({
          modelInvocation: inv,
          availableAction,
          binding: availableAction.participantBinding,
          registry: actionRegistry,
          gameData: conv.gameData,
          eventId: actionEvent.eventId,
          traceId: actionEvent.traceId
        });
        if (!bindingValidation.valid) {
          this.recordModeMetric(conv, actionSystemMode, "validationRejected", { actionId: inv.actionId, reason: bindingValidation.reason });
          this.recordModeMetric(conv, actionSystemMode, "rejectedActions", { actionId: inv.actionId, reason: bindingValidation.reason });
          this.traceDecision(inv.actionId, "validation", "rejected", {
            eventId: actionEvent.eventId,
            traceId: actionEvent.traceId,
            reason: bindingValidation.reason,
            expectedTarget: availableAction.participantBinding?.targetCharacterId ?? null,
            modelTarget: inv.targetCharacterId ?? null
          });
          usageAnalytics.record({
            requestType: "action_invocation_validation",
            actionId: inv.actionId,
            outcome: "rejected",
            reason: bindingValidation.reason
          }, null);
          continue;
        }
        this.traceDecision(inv.actionId, "validation", "pass", { eventId: actionEvent.eventId, traceId: actionEvent.traceId });
        const invocation = bindingValidation.invocation;
        const invocationSource = conv.gameData.characters.get(invocation.sourceCharacterId);
        if (!invocationSource) {
          this.traceDecision(inv.actionId, "validation", "rejected", {
            eventId: actionEvent.eventId,
            traceId: actionEvent.traceId,
            reason: "source_not_in_game_data"
          });
          continue;
        }
        const isDestructive = actionRegistry.getEffectiveDestructive(inv.actionId);
        const riskLevel = actionRegistry.getEffectiveRiskLevel(inv.actionId);
        console.log(`[ActionEngine] Action ${inv.actionId} isDestructive: ${isDestructive}, hasOverride: ${actionRegistry.hasDestructiveOverride(inv.actionId)}`);
        const needsUserApproval = actionRegistry.shouldRequireApproval(inv.actionId, approvalSettings.approvalMode);
        console.log(`[ActionEngine] Action ${inv.actionId} isDestructive property: ${loaded2.definition.isDestructive}, computed: ${isDestructive}, needsApproval: ${needsUserApproval}`);
        if (needsUserApproval) {
          this.recordModeMetric(conv, actionSystemMode, "approvalPending", { actionId: inv.actionId });
          const targetId = invocation.targetCharacterId ?? null;
          const target = targetId != null ? conv.gameData.characters.get(targetId) ?? void 0 : void 0;
          const actionTitle = loaded2.definition.title ? resolveI18nString(loaded2.definition.title, userLang) : void 0;
          console.log(`[ActionEngine] Action ${inv.actionId} needs approval (destructive: ${isDestructive})`);
          this.traceDecision(inv.actionId, "approval", "pending", { eventId: actionEvent.eventId, traceId: actionEvent.traceId });
          needsApproval.push({
            actionId: inv.actionId,
            actionTitle,
            sourceCharacterId: invocationSource.id,
            sourceCharacterName: invocationSource.shortName,
            targetCharacterId: targetId ?? void 0,
            targetCharacterName: target?.shortName,
            args: invocation.args ?? {},
            isDestructive,
            riskLevel,
            invocation
          });
        } else {
          console.log(`[ActionEngine] Action ${inv.actionId} auto-approved (destructive: ${isDestructive})`);
          const result2 = await this.runInvocation(conv, invocationSource, invocation);
          autoApproved.push(result2);
        }
      }
      const executedActionIds = autoApproved.filter((result2) => result2?.success).map((result2) => result2.actionId);
      const failedActionIds = autoApproved.filter((result2) => !result2?.success).map((result2) => result2.actionId);
      const pendingActionIds = needsApproval.map((action) => action.actionId);
      let actionOutcome = "actions_executed";
      if (failedActionIds.length > 0 && executedActionIds.length === 0 && pendingActionIds.length === 0) actionOutcome = "execution_failed";
      else if (pendingActionIds.length > 0 && executedActionIds.length === 0) actionOutcome = "awaiting_approval";
      else if (pendingActionIds.length > 0) actionOutcome = "actions_executed_and_pending";
      else if (failedActionIds.length > 0) actionOutcome = "actions_executed_with_failures";
      for (const actionId of executedActionIds) this.recordModeMetric(conv, actionSystemMode, invocationOrigin === "local" ? "localExecuted" : "providerExecuted", { actionId });
      for (const actionId of failedActionIds) this.recordModeMetric(conv, actionSystemMode, "executionFailed", { actionId });
      recordOutcome(actionOutcome, parsed.actions.map((inv) => inv.actionId), null, {
        executedActionIds,
        pendingActionIds,
        failedActionIds,
        actionFinishReason,
        invocationOrigin
      });
      return { autoApproved, needsApproval };
    } catch (err) {
      if (signal?.aborted) {
        console.log("[DEBUG] ActionEngine: Caught abort signal in error handler");
        return { autoApproved: [], needsApproval: [] };
      }
      console.error("ActionEngine error:", err);
      return { autoApproved: [], needsApproval: [] };
    }
  }
  /**
   * Execute an action invocation. When dryRun is true, game effects are not written.
   */
  static async runInvocation(conv, npc, inv, options) {
    const loaded = actionRegistry.getById(inv.actionId);
    if (!loaded || !loaded.validation.valid) {
      return actionSystem.createExecutionResult({
        actionId: inv.actionId,
        success: false,
        error: "Action not found or invalid",
        sourceCharacterId: inv.sourceCharacterId,
        targetCharacterId: inv.targetCharacterId,
        bindingId: inv.bindingId,
        eventId: inv.eventId,
        traceId: inv.traceId
      });
    }
    const sourceId = inv.sourceCharacterId ?? null;
    const source = sourceId != null ? conv.gameData.characters.get(sourceId) ?? null : null;
    if (!source) {
      return actionSystem.createExecutionResult({
        actionId: inv.actionId,
        success: false,
        error: "Resolved source character unavailable",
        sourceCharacterId: sourceId,
        targetCharacterId: inv.targetCharacterId,
        bindingId: inv.bindingId,
        eventId: inv.eventId,
        traceId: inv.traceId
      });
    }
    const targetId = inv.targetCharacterId ?? null;
    const target = targetId != null ? conv.gameData.characters.get(targetId) ?? void 0 : void 0;
    if (targetId != null && !target) {
      return actionSystem.createExecutionResult({
        actionId: inv.actionId,
        success: false,
        error: "Resolved target character unavailable",
        sourceCharacterId: source.id,
        targetCharacterId: targetId,
        bindingId: inv.bindingId,
        eventId: inv.eventId,
        traceId: inv.traceId
      });
    }
    const userLang = settingsRepository.getLanguage();
    const args = inv.args ?? {};
    try {
      const execution = await actionSystem.actionExecutor.execute({
        actionSandbox: ActionSandbox,
        effectWriter: ActionEffectWriter,
        action: loaded.definition,
        filePath: loaded.filePath,
        gameData: conv.gameData,
        sourceCharacter: source,
        targetCharacter: target,
        args,
        conversation: conv,
        dryRun: options?.dryRun,
        lang: userLang
      });
      const result = execution.result;
      if (execution.effectWritten && inv.actionId === "characterIsKilled") {
        conv.markParticipantInactive?.(source.id, "dead");
      }
      let feedback = void 0;
      if (result) {
        if (typeof result === "string") {
          feedback = { message: result, sentiment: "neutral" };
        } else if (typeof result === "object") {
          if ("message" in result) {
            feedback = {
              message: resolveI18nString(result.message, userLang),
              sentiment: result.sentiment || "neutral"
            };
          } else {
            feedback = {
              message: resolveI18nString(result, userLang),
              sentiment: "neutral"
            };
          }
        }
      }
      const executionResult = actionSystem.createExecutionResult({
        actionId: inv.actionId,
        success: true,
        effectWritten: execution.effectWritten,
        feedback,
        sourceCharacterId: source.id,
        targetCharacterId: target?.id,
        bindingId: inv.bindingId ?? null,
        eventId: inv.eventId,
        traceId: inv.traceId
      });
      this.traceDecision(inv.actionId, "execution", "success", { eventId: inv.eventId, traceId: inv.traceId, source: source.id, target: target?.id ?? null });
      if (execution.effectWritten) this.traceDecision(inv.actionId, "execution", "effect_written", { eventId: inv.eventId, traceId: inv.traceId, source: source.id, target: target?.id ?? null });
      return executionResult;
    } catch (err) {
      this.traceDecision(inv.actionId, "execution", "failed", { eventId: inv.eventId, traceId: inv.traceId, reason: err instanceof Error ? err.message : String(err) });
      console.error(`Action ${inv.actionId} failed:`, err);
      return actionSystem.createExecutionResult({
        actionId: inv.actionId,
        success: false,
        error: err instanceof Error ? err.message : String(err),
        sourceCharacterId: source.id,
        targetCharacterId: target?.id,
        bindingId: inv.bindingId,
        eventId: inv.eventId,
        traceId: inv.traceId
      });
    }
  }
}

module.exports = { ActionEngine };
