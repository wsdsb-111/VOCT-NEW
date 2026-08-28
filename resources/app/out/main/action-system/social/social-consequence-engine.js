"use strict";

const { createActionEvent } = require("../action-types");
const { createConsequence } = require("./social-consequence-types");
const socialContextProvider = require("./social-context-provider");
const socialConsequenceGate = require("./social-consequence-gate");
const localConsequenceResolver = require("./local-consequence-resolver");
const socialConsequenceJudge = require("./social-consequence-judge");
const consequenceValidator = require("./consequence-validator");
const consequenceCooldown = require("./consequence-cooldown");
const observerImpactResolver = require("./observer-impact-resolver");

let ActionEngine = null;
let settingsRepository = null;
let llmManager = null;
let usageAnalytics = null;

function configure(dependencies = {}) {
  ActionEngine = dependencies.ActionEngine || ActionEngine;
  settingsRepository = dependencies.settingsRepository || settingsRepository;
  llmManager = dependencies.llmManager || llmManager;
  usageAnalytics = dependencies.usageAnalytics || usageAnalytics;
  if (dependencies.TokenCounter || dependencies.createPromptFingerprint) {
    socialConsequenceJudge.configure({
      TokenCounter: dependencies.TokenCounter,
      createPromptFingerprint: dependencies.createPromptFingerprint
    });
  }
  return module.exports;
}

function emptyResult(mode, reason) {
  return {
    actionResults: { autoApproved: [], needsApproval: [] },
    metrics: { mode, reason, judgeCalls: 0, consequences: 0 },
    reservations: []
  };
}

function recordMetric(mode, metric, metricValue = 1) {
  if (!Number.isFinite(Number(metricValue)) || Number(metricValue) <= 0) return;
  usageAnalytics?.record?.({ requestType: "social_consequence_metric", actionSystemMode: mode, metric, metricValue: Number(metricValue) }, null);
}

function recordEvidenceMetrics(mode, context, buildTimeMs) {
  recordMetric(mode, "dialogueEvidence", context.dialogueEvidence?.length || 0);
  recordMetric(mode, "confirmedWorldEventEvidence", context.confirmedWorldEvents?.length || 0);
  recordMetric(mode, "memoryEvidence", context.memoryEvidence?.length || 0);
  recordMetric(mode, "socialContextBuildTimeMs", Math.max(1, buildTimeMs));
}

function resolveMessageParticipants(context, conversation, message) {
  const all = context.directParticipants || [];
  const actorId = message?.role === "user"
    ? conversation.gameData?.playerID
    : all.find((item) => item.name === message?.name)?.id ?? null;
  let targetId = message?.primaryAddresseeId ?? message?.addresseeCharacterId ?? conversation.primaryAddresseeId ?? null;
  if (targetId == null && all.length === 2 && actorId != null) targetId = all.find((item) => Number(item.id) !== Number(actorId))?.id ?? null;
  const directIds = new Set([actorId, targetId].filter((value) => value != null).map(Number));
  return Object.freeze({
    ...context,
    message: Object.freeze({ ...context.message, actorId, targetId, primaryAddresseeId: targetId }),
    directParticipants: Object.freeze(all.filter((item) => directIds.has(Number(item.id)))),
    observerParticipants: Object.freeze(all.filter((item) => !directIds.has(Number(item.id))))
  });
}

function fromJudgeResult(context, result) {
  return createConsequence({
    consequenceId: `precision:${context.message?.id ?? "message"}`,
    conversationId: context.conversationId,
    turnEpoch: context.turnEpoch,
    sourceEventId: context.dialogueEvidence?.[0]?.sourceMessageId ?? context.message?.id ?? null,
    evidenceText: context.message?.content || "",
    directParticipants: { actorId: context.message?.actorId, targetId: context.message?.targetId },
    opinionChanges: result.opinionChanges,
    relationshipTransition: result.relationshipTransition,
    observerEffects: result.observerEffects,
    inferenceMode: "precision",
    riskLevel: result.relationshipTransition ? "medium" : "low"
  });
}

function itemsFromConsequence(consequence) {
  const opinions = [
    ...(consequence.opinionChanges || []).map((item) => ({ ...item, observerEffect: false })),
    ...(consequence.observerEffects || []).map((item) => ({ ...item, observerEffect: true }))
  ].map((item) => ({
    ...item,
    actionId: "changeOpinionOf",
    consequenceId: consequence.consequenceId,
    consequenceType: "opinion",
    inferenceMode: consequence.inferenceMode
  }));
  const relationship = consequence.relationshipTransition ? [{
    ...consequence.relationshipTransition,
    consequenceId: consequence.consequenceId,
    consequenceType: "relationship",
    inferenceMode: consequence.inferenceMode
  }] : [];
  return [...opinions, ...relationship];
}

function toActionEvents(validatedConsequence, reservations = []) {
  return itemsFromConsequence(validatedConsequence).map((item, index) => {
    const text = String(item.reason || item.reasonCluster || item.actionId);
    const eventId = `social:${item.consequenceId}:${index}`;
    return createActionEvent({
      eventId,
      traceId: `action:${eventId}`,
      category: item.actionId === "changeOpinionOf" ? "opinion_change" : "relationship",
      evidence: { text, start: 0, end: text.length },
      executionStatus: "executed",
      resultStatus: "succeeded",
      sourceClauseIndex: 0,
      reasons: [item.actionId === "changeOpinionOf" ? "opinion_change" : "relationship"],
      allowedActionIds: [item.actionId],
      semanticEvidence: [item.reasonCluster || "social_consequence"],
      resolutionMode: "resolved",
      interpretationSource: item.inferenceMode === "precision" ? "social_precision" : "social_local",
      validatedArgs: Object.freeze(item.actionId === "changeOpinionOf" ? { value: item.delta } : { reason: text }),
      pendingBinding: Object.freeze({ sourceCharacterId: item.sourceCharacterId, targetCharacterId: item.targetCharacterId }),
      socialReservationId: reservations[index] || null,
      origin: "social"
    });
  });
}

function addObserverEffects(context, consequence, mode) {
  if (mode !== "performance" || (consequence.observerEffects || []).length > 0) return consequence;
  const observerEffects = observerImpactResolver.resolve({ context, directConsequence: consequence, mode });
  return createConsequence({ ...consequence, observerEffects });
}

async function process({ conversation, message, confirmedEvents = [], signal }) {
  const mode = settingsRepository?.getActionSystemMode?.() || "balanced";
  if (mode === "balanced") return emptyResult(mode, "balanced_bypass");
  if (!ActionEngine || !conversation || !message) return emptyResult(mode, "missing_dependency");
  try {
    const contextBuildStartedAt = Date.now();
    const rawContext = socialContextProvider.buildContext({ conversation, message, confirmedEvents });
    let context = resolveMessageParticipants(rawContext, conversation, message);
    recordEvidenceMetrics(mode, context, Date.now() - contextBuildStartedAt);
    const gateResult = socialConsequenceGate.evaluate(context);
    if (!gateResult.eligible) return emptyResult(mode, gateResult.reasons[0] || "gate_rejected");
    context = Object.freeze({ ...context, gateReason: gateResult.reasons.join("+") });

    let consequence;
    let judgeCalls = 0;
    if (mode === "precision") {
      const state = consequenceCooldown.ensureState(conversation);
      state.precisionJudgeCalls = Number(state.precisionJudgeCalls || 0);
      if (state.precisionJudgeCalls >= 8) return emptyResult(mode, "judge_budget_exhausted");
      state.precisionJudgeCalls++;
      judgeCalls = 1;
      recordMetric(mode, "precisionSocialJudgeCalls");
      const judged = await socialConsequenceJudge.judge({ context, llmManager, signal, mode });
      if (!judged.socialImpact) return { ...emptyResult(mode, judged.reason || "judge_no_impact"), metrics: { mode, reason: judged.reason || "judge_no_impact", judgeCalls, consequences: 0 } };
      consequence = fromJudgeResult(context, judged);
    } else {
      consequence = localConsequenceResolver.resolve(context, gateResult);
      consequence = addObserverEffects(context, consequence, mode);
      recordMetric(mode, "localConsequences", itemsFromConsequence(consequence).length);
    }

    const validation = consequenceValidator.validate({ consequence, context, mode });
    recordMetric(mode, "validatorRejected", validation.rejected.length);
    recordMetric(mode, "knowledgeGateRejected", validation.rejected.filter((item) => item.reason === "unknown_evidence").length);
    recordMetric(mode, "unconfirmedClaimRejected", validation.rejected.filter((item) => item.reason === "unconfirmed_world_event").length);
    if (!validation.valid) return { ...emptyResult(mode, "validation_rejected"), metrics: { mode, reason: "validation_rejected", judgeCalls, consequences: 0, rejected: validation.rejected.length } };

    let diminishingReturnSuppressed = 0;
    const scaled = createConsequence({
      ...validation.consequence,
      opinionChanges: validation.consequence.opinionChanges.map((item) => consequenceCooldown.scaleDelta(conversation, item)).filter((item) => {
        if (item.delta !== 0) return true;
        diminishingReturnSuppressed++;
        return false;
      }),
      observerEffects: validation.consequence.observerEffects.map((item) => consequenceCooldown.scaleDelta(conversation, item)).filter((item) => {
        if (item.delta !== 0) return true;
        diminishingReturnSuppressed++;
        return false;
      })
    });
    recordMetric(mode, "diminishingReturnSuppressed", diminishingReturnSuppressed);
    const consequenceItems = itemsFromConsequence(scaled);
    const reservationIds = [];
    for (const item of consequenceItems) {
      const reservation = consequenceCooldown.reserve(conversation, item);
      reservationIds.push(reservation?.reservationId || null);
    }
    recordMetric(mode, "cooldownSuppressed", reservationIds.filter((reservationId) => reservationId == null).length);
    const events = toActionEvents(scaled, reservationIds).filter((event) => event.socialReservationId != null);
    const acceptedItems = consequenceItems.filter((_item, index) => reservationIds[index] != null);
    recordMetric(mode, "opinionActions", acceptedItems.filter((item) => item.actionId === "changeOpinionOf").length);
    recordMetric(mode, "relationshipTransitions", acceptedItems.filter((item) => item.actionId !== "changeOpinionOf").length);
    recordMetric(mode, "observerEffects", acceptedItems.filter((item) => item.observerEffect === true).length);
    const actionResults = { autoApproved: [], needsApproval: [] };
    const reservations = [];
    for (const event of events) {
      const sourceId = event.pendingBinding.sourceCharacterId;
      const source = conversation.gameData.characters.get(Number(sourceId));
      if (!source) {
        consequenceCooldown.release(conversation, event.socialReservationId);
        continue;
      }
      const result = await ActionEngine.evaluateForCharacter(conversation, source, signal, message, event);
      actionResults.autoApproved.push(...result.autoApproved);
      actionResults.needsApproval.push(...result.needsApproval.map((item) => ({ ...item, socialReservationId: event.socialReservationId, origin: "social" })));
      const execution = result.autoApproved.find((item) => item.eventId === event.eventId);
      if (execution?.success === true && execution.effectWritten === true) consequenceCooldown.apply(conversation, event.socialReservationId);
      else if (!result.needsApproval.length) consequenceCooldown.release(conversation, event.socialReservationId);
      reservations.push({ reservationId: event.socialReservationId, eventId: event.eventId, pending: result.needsApproval.length > 0 });
    }
    usageAnalytics?.record?.({ requestType: "social_consequence", actionSystemMode: mode, outcome: actionResults.autoApproved.length || actionResults.needsApproval.length ? "produced" : "empty", judgeCalls, consequenceCount: events.length }, null);
    return { actionResults, metrics: { mode, reason: "processed", judgeCalls, consequences: events.length }, reservations };
  } catch (error) {
    usageAnalytics?.record?.({ requestType: "social_consequence", actionSystemMode: mode, outcome: "rejected", reason: error instanceof Error ? error.message : String(error) }, null);
    return emptyResult(mode, "processing_error");
  }
}

module.exports = { configure, process, toActionEvents };
