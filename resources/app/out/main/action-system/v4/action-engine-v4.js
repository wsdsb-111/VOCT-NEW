"use strict";

const actionExecutor = require("../action-executor");
const actionTypes = require("../action-types");
const availableActionCatalog = require("./catalog/available-action-catalog");
const actionMode = require("./constants/action-mode");
const pendingStore = require("./pending/explicit-pending-store");
const proposalPipeline = require("./proposal/action-proposal-pipeline");
const outcomeRecorder = require("./analytics/action-outcome-recorder");
const precisionActionSelector = require("./precision/precision-action-selector");
const executionFormGuard = require("./performance/execution-form-guard");
const fastActionResolver = require("./performance/fast-action-resolver");
const fallbackHintDetector = require("./performance/fallback-hint-detector");
const compactActionSelector = require("./performance/compact-action-selector");
const opinionEffectNormalizer = require("./social/opinion-effect-normalizer");

let actionRegistry = null;
let settingsRepository = null;
let usageAnalytics = null;
let llmManager = null;
let ActionSandbox = null;
let ActionEffectWriter = null;
let resolveI18nString = null;

class ActionEngineV4 {
  static configure(dependencies = {}) {
    actionRegistry = dependencies.actionRegistry || actionRegistry;
    settingsRepository = dependencies.settingsRepository || settingsRepository;
    usageAnalytics = dependencies.usageAnalytics || usageAnalytics;
    llmManager = dependencies.llmManager || llmManager;
    ActionSandbox = dependencies.ActionSandbox || ActionSandbox;
    ActionEffectWriter = dependencies.ActionEffectWriter || ActionEffectWriter;
    resolveI18nString = dependencies.resolveI18nString || resolveI18nString;
    this.dependencies = { ...this.dependencies, ...dependencies };
    return this;
  }

  static getModeState(conversation) {
    return actionMode.syncConversationMode(conversation, settingsRepository?.getActionSystemMode?.());
  }

  static isValidRoleplayMessage(conversation, speaker, message) {
    if (!message || !["user", "assistant"].includes(message.role)) return { valid: false, reason: "technical_non_dialogue" };
    if (typeof message.content !== "string" || message.content.trim().length === 0) return { valid: false, reason: "empty_message" };
    if (speaker && conversation.inactiveParticipantIds?.has?.(speaker.id)) return { valid: false, reason: "inactive_participant" };
    const state = pendingStore.ensureState(conversation);
    if (message.id != null && state.seenMessageIds.has(String(message.id))) return { valid: false, reason: "duplicate_message_id" };
    return { valid: true };
  }

  static async buildCatalog(conversation, speaker) {
    return availableActionCatalog.build({
      conversation,
      speaker,
      registry: actionRegistry,
      language: settingsRepository?.getLanguage?.() || "en",
      resolveI18nString
    });
  }

  static async evaluateProposals(conversation, speaker, message, decisions, options = {}) {
    const mode = actionMode.normalizeActionMode(options.mode ?? settingsRepository?.getActionSystemMode?.());
    const catalog = options.catalog || await this.buildCatalog(conversation, speaker);
    const result = await proposalPipeline.process({
      conversation,
      speaker,
      message,
      decisions,
      catalog,
      registry: actionRegistry,
      analytics: usageAnalytics,
      mode,
      origin: options.origin || "precision_selector",
      runInvocation: (conv, source, invocation, executionOptions) => this.runInvocation(conv, source, invocation, executionOptions),
      resolveI18nString,
      language: settingsRepository?.getLanguage?.() || "en",
      approvalSettings: settingsRepository?.getActionApprovalSettings?.() || { approvalMode: "none", pauseOnApproval: true }
    });
    outcomeRecorder.record(usageAnalytics, {
      messageId: message.id,
      actionSystemMode: mode,
      origin: options.origin || "precision_selector",
      detected: decisions.length,
      executed: result.autoApproved.filter((item) => item.success).length,
      approvalPending: result.needsApproval.length,
      consentPending: result.pendingConsent.length,
      rejected: result.rejected.length
    });
    return result;
  }

  static buildDirectDecision(message, event) {
    const binding = event.pendingBinding || {};
    return {
      type: "action_call",
      actionId: event.allowedActionIds?.[0],
      sourceCharacterId: binding.sourceCharacterId,
      targetCharacterId: binding.targetCharacterId ?? null,
      arguments: { ...(event.validatedArgs || {}) },
      evidenceMessageIds: [message.id],
      confidence: 1
    };
  }

  static async evaluateForCharacter(conversation, speaker, signal, message, actionEvent = null) {
    if (signal?.aborted) return { autoApproved: [], needsApproval: [], pendingConsent: [], rejected: [] };
    const eligibility = this.isValidRoleplayMessage(conversation, speaker, message);
    if (!eligibility.valid && !actionEvent) {
      usageAnalytics?.record?.({ requestType: "action_skipped", engineVersion: "4.0", skipReason: eligibility.reason }, null);
      return { autoApproved: [], needsApproval: [], pendingConsent: [], rejected: [] };
    }
    pendingStore.observeMessage(conversation, message);
    const modeState = this.getModeState(conversation);
    usageAnalytics?.record?.({ requestType: "action_v4_message", engineVersion: "4.0", actionSystemMode: modeState.mode, outcome: "eligible", messageId: message.id }, null);
    if (actionEvent?.allowedActionIds?.length === 1 && actionEvent.pendingBinding) {
      return this.evaluateProposals(conversation, speaker, message, [this.buildDirectDecision(message, actionEvent)], { mode: modeState.mode, origin: actionEvent.proposalOrigin || "derived_social" });
    }
    if (typeof this.evaluateLanguage !== "function") return { autoApproved: [], needsApproval: [], pendingConsent: [], rejected: [] };
    return this.evaluateLanguage(conversation, speaker, signal, message, modeState.mode);
  }

  static async evaluateLanguage(conversation, speaker, signal, message, mode) {
    const catalog = await this.buildCatalog(conversation, speaker);
    if (mode === "precision") {
      const selected = await precisionActionSelector.select({
        conversation,
        speaker,
        message,
        catalog,
        registry: actionRegistry,
        llmManager,
        settingsRepository,
        analytics: usageAnalytics,
        signal,
        mode
      });
      if (!selected.valid) return this.finalizeLanguageResult(message, mode, { autoApproved: [], needsApproval: [], pendingConsent: [], rejected: [{ reason: selected.reason }] }, 0);
      return this.finalizeLanguageResult(message, mode, await this.evaluateProposals(conversation, speaker, message, selected.decisions, { mode, origin: "precision_selector", catalog }), selected.decisions.length);
    }
    const guard = executionFormGuard.evaluate(message.content);
    if (!guard.allowed) {
      usageAnalytics?.record?.({ requestType: "action_v4_performance", engineVersion: "4.0", actionSystemMode: mode, messageId: message.id, stage: "execution_form_guard", outcome: "rejected", reason: guard.reason }, null);
      return this.finalizeLanguageResult(message, mode, { autoApproved: [], needsApproval: [], pendingConsent: [], rejected: [] }, 0);
    }
    const fast = fastActionResolver.resolve({ message, speaker, catalog });
    if (fast.status === "HIT") {
      usageAnalytics?.record?.({ requestType: "action_v4_performance", engineVersion: "4.0", actionSystemMode: mode, messageId: message.id, stage: "fast_resolver", outcome: "hit", actionId: fast.decision.actionId }, null);
      return this.finalizeLanguageResult(message, mode, await this.evaluateProposals(conversation, speaker, message, [fast.decision], { mode, origin: "performance_local", catalog }), 1);
    }
    const hint = fallbackHintDetector.evaluate({ message, activePending: pendingStore.listActive(conversation) });
    usageAnalytics?.record?.({ requestType: "action_v4_performance", engineVersion: "4.0", actionSystemMode: mode, messageId: message.id, stage: "fallback_hint", outcome: hint.possibleAction ? "maybe" : "none", reason: hint.reason }, null);
    if (!hint.possibleAction) return this.finalizeLanguageResult(message, mode, { autoApproved: [], needsApproval: [], pendingConsent: [], rejected: [] }, 0);
    const selected = await compactActionSelector.select({
      conversation,
      speaker,
      message,
      catalog,
      registry: actionRegistry,
      llmManager,
      settingsRepository,
      analytics: usageAnalytics,
      signal,
      mode
    });
    if (!selected.valid) return this.finalizeLanguageResult(message, mode, { autoApproved: [], needsApproval: [], pendingConsent: [], rejected: [{ reason: selected.reason }] }, 0);
    return this.finalizeLanguageResult(message, mode, await this.evaluateProposals(conversation, speaker, message, selected.decisions, { mode, origin: "performance_compact", catalog }), selected.decisions.length);
  }

  static finalizeLanguageResult(message, mode, result, detectedDecisions) {
    usageAnalytics?.record?.({
      requestType: "action_v4_message_result",
      engineVersion: "4.0",
      actionSystemMode: mode,
      messageId: message.id,
      outcome: detectedDecisions > 0 ? "detected" : "no_action",
      detectedDecisions
    }, null);
    return result;
  }

  static async runInvocation(conversation, _speaker, invocation, options = {}) {
    const loaded = actionRegistry.getById(invocation.actionId);
    const source = conversation.gameData.characters.get(invocation.sourceCharacterId);
    const target = invocation.targetCharacterId == null ? null : conversation.gameData.characters.get(invocation.targetCharacterId);
    const base = {
      actionId: invocation.actionId,
      sourceCharacterId: invocation.sourceCharacterId,
      targetCharacterId: invocation.targetCharacterId,
      bindingId: invocation.bindingId,
      eventId: invocation.eventId,
      traceId: invocation.traceId,
      origin: invocation.origin,
      sourceMessageId: invocation.sourceMessageId,
      engineVersion: "4.0",
      proposalId: invocation.proposalId,
      messageId: invocation.messageId,
      mode: invocation.mode,
      opinionReservationId: invocation.opinionReservationId
    };
    if (!loaded || !loaded.validation?.valid) return actionTypes.createExecutionResult({ ...base, success: false, error: "Action not found or invalid", executionStatus: "pre_send_failure" });
    if (!source || (invocation.targetCharacterId != null && !target)) return actionTypes.createExecutionResult({ ...base, success: false, error: "Resolved participant unavailable", executionStatus: "pre_send_failure" });
    try {
      const execution = await actionExecutor.execute({
        actionSandbox: ActionSandbox,
        effectWriter: ActionEffectWriter,
        action: loaded.definition,
        filePath: loaded.filePath,
        gameData: conversation.gameData,
        sourceCharacter: source,
        targetCharacter: target,
        args: invocation.args || {},
        conversation,
        dryRun: options.dryRun,
        lang: settingsRepository?.getLanguage?.() || "en"
      });
      if (execution.effectWritten && invocation.actionId === "characterIsKilled") conversation.markParticipantInactive?.(source.id, "dead");
      let feedback;
      if (typeof execution.result === "string") feedback = { message: execution.result, sentiment: "neutral" };
      else if (execution.result && typeof execution.result === "object") {
        feedback = "message" in execution.result
          ? { message: resolveI18nString(execution.result.message, settingsRepository?.getLanguage?.() || "en"), sentiment: execution.result.sentiment || "neutral" }
          : { message: resolveI18nString(execution.result, settingsRepository?.getLanguage?.() || "en"), sentiment: "neutral" };
      }
      if (!options.dryRun && !execution.effectWritten) {
        if (invocation.opinionReservationId) opinionEffectNormalizer.release(conversation, invocation.opinionReservationId);
        return actionTypes.createExecutionResult({ ...base, success: false, effectWritten: false, error: "Action completed without writing a CK3 effect", feedback, executionStatus: "confirmed_failure" });
      }
      if (!options.dryRun && invocation.opinionReservationId) opinionEffectNormalizer.commit(conversation, invocation.opinionReservationId);
      return actionTypes.createExecutionResult({ ...base, success: true, effectWritten: execution.effectWritten, feedback, executionStatus: "confirmed_success" });
    } catch (error) {
      if (!options.dryRun && invocation.opinionReservationId) opinionEffectNormalizer.release(conversation, invocation.opinionReservationId);
      return actionTypes.createExecutionResult({ ...base, success: false, error: error instanceof Error ? error.message : String(error), executionStatus: error.executionStatus || "pre_send_failure" });
    }
  }
}

module.exports = { ActionEngineV4 };
