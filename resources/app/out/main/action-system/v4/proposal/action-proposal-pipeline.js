"use strict";

const { createValidatedInvocation } = require("../../action-types");
const proposalValidator = require("./action-proposal-validator");
const batchPlanner = require("./action-batch-planner");
const pendingStore = require("../pending/explicit-pending-store");
const pendingResolver = require("../pending/pending-resolver");
const funnelAnalytics = require("../analytics/action-funnel-analytics");
const opinionEffectNormalizer = require("../social/opinion-effect-normalizer");

function evidenceAllowed(proposal, allowedMessageIds, requiredMessageId = null) {
  return Array.isArray(proposal.evidenceMessageIds)
    && proposal.evidenceMessageIds.length > 0
    && proposal.evidenceMessageIds.every((id) => allowedMessageIds.has(String(id)))
    && (requiredMessageId == null || proposal.evidenceMessageIds.some((id) => String(id) === String(requiredMessageId)));
}

function normalizeActionDecision(decision, context, index) {
  return Object.freeze({
    proposalId: `proposal:${context.message.id}:${index + 1}`,
    messageId: context.message.id,
    engineVersion: "4.0",
    mode: context.mode,
    origin: context.origin,
    actionId: decision.actionId,
    sourceCharacterId: decision.sourceCharacterId,
    targetCharacterId: decision.targetCharacterId ?? null,
    arguments: Object.freeze({ ...(decision.arguments || {}) }),
    evidenceMessageIds: Object.freeze([...(decision.evidenceMessageIds || [])]),
    confidence: decision.confidence
  });
}

function invocationFrom(item) {
  const proposal = item.proposal;
  return createValidatedInvocation({
    actionId: proposal.actionId,
    sourceCharacterId: proposal.sourceCharacterId,
    targetCharacterId: proposal.targetCharacterId,
    args: proposal.arguments,
    bindingId: `ae4:${proposal.proposalId}`,
    eventId: `ae4:${proposal.messageId}:${proposal.proposalId}`,
    traceId: `ae4:${proposal.proposalId}`,
    origin: proposal.origin,
    sourceMessageId: proposal.messageId,
    engineVersion: "4.0",
    proposalId: proposal.proposalId,
    messageId: proposal.messageId,
    mode: proposal.mode,
    opinionReservationId: item.opinionReservationId || null
  });
}

async function process({ conversation, speaker, message, decisions, catalog, registry, analytics, mode, origin, runInvocation, resolveI18nString, language, approvalSettings }) {
  const context = { conversation, speaker, message, catalog, registry, mode, origin };
  const recentIds = new Set((conversation.messages || []).filter((entry) => ["user", "assistant"].includes(entry.role)).slice(-4).map((entry) => String(entry.id)));
  recentIds.add(String(message.id));
  const rejected = [];
  const pendingConsent = [];
  const candidates = [];
  for (let index = 0; index < decisions.length && index < 3; index++) {
    const decision = decisions[index];
    if (decision.type === "pending_response") {
      if (!evidenceAllowed(decision, recentIds, message.id)) {
        rejected.push({ decision, reason: "rejected_invalid_pending_evidence" });
        funnelAnalytics.record(analytics, null, "Pending/Consent", "rejected", { reason: "rejected_invalid_pending_evidence", messageId: message.id, actionSystemMode: mode, origin });
        continue;
      }
      const pendingResult = pendingResolver.resolve({ conversation, decision, speaker, messageId: message.id, mode, origin });
      if (pendingResult.rejected) {
        rejected.push({ decision, reason: pendingResult.reason });
        funnelAnalytics.record(analytics, null, "Pending/Consent", "rejected", { reason: pendingResult.reason, messageId: message.id, actionSystemMode: mode, origin });
      } else if (pendingResult.accepted) {
        funnelAnalytics.record(analytics, pendingResult.proposal, "Pending/Consent", "accepted", { pendingId: pendingResult.pending.pendingId });
        candidates.push({ proposal: pendingResult.proposal, consentGranted: true, pendingId: pendingResult.pending.pendingId });
      } else if (pendingResult.cancelled) {
        funnelAnalytics.record(analytics, null, "Pending/Consent", "cancelled", { pendingId: pendingResult.pending.pendingId, messageId: message.id, actionSystemMode: mode, origin });
      } else if (pendingResult.deferred) {
        funnelAnalytics.record(analytics, null, "Pending/Consent", "deferred", { pendingId: pendingResult.pending.pendingId, messageId: message.id, actionSystemMode: mode, origin });
      }
      continue;
    }
    const proposal = normalizeActionDecision(decision, context, index);
    funnelAnalytics.record(analytics, proposal, "Detected", "pass");
    if (!evidenceAllowed(proposal, recentIds)) {
      rejected.push({ proposal, reason: "rejected_invalid_evidence" });
      funnelAnalytics.record(analytics, proposal, "Detected", "rejected", { reason: "rejected_invalid_evidence" });
      continue;
    }
    candidates.push({ proposal, consentGranted: false });
  }
  const validated = [];
  for (const candidate of candidates) {
    const validation = await proposalValidator.validate({ proposal: candidate.proposal, catalog, conversation, registry, consentGranted: candidate.consentGranted });
    if (validation.pendingRequired) {
      const pending = pendingStore.create(conversation, { ...candidate.proposal, sourceCharacterId: validation.sourceCharacterId, targetCharacterId: validation.targetCharacterId, arguments: validation.arguments }, validation.entry.metadata);
      pendingConsent.push(pending);
      funnelAnalytics.record(analytics, candidate.proposal, "Pending/Consent", "pending", { pendingId: pending.pendingId });
      continue;
    }
    if (!validation.valid) {
      const reason = candidate.pendingId ? "rejected_pending_legality_changed" : validation.reason;
      if (candidate.pendingId) pendingStore.settle(conversation, candidate.pendingId, "rejected_legality_changed");
      rejected.push({ proposal: candidate.proposal, reason });
      funnelAnalytics.record(analytics, candidate.proposal, "Validated", "rejected", { reason });
      continue;
    }
    if (candidate.pendingId) pendingStore.settle(conversation, candidate.pendingId, "accepted");
    funnelAnalytics.record(analytics, validation.proposal, "Bound", "pass");
    funnelAnalytics.record(analytics, validation.proposal, "Validated", "pass");
    validated.push(validation);
  }
  const plan = batchPlanner.plan(validated);
  for (const item of plan.rejected) {
    rejected.push({ proposal: item.item.proposal, reason: item.reason });
    funnelAnalytics.record(analytics, item.item.proposal, "Validated", "rejected", { reason: item.reason });
  }
  const autoApproved = [];
  const needsApproval = [];
  const resultByAction = new Map();
  const state = pendingStore.ensureState(conversation);
  for (const plannedItem of plan.executable) {
    let item = plannedItem;
    let proposal = item.proposal;
    const failedDependency = item.entry.metadata.dependencies.find((dependency) => resultByAction.has(dependency) && resultByAction.get(dependency)?.success !== true);
    if (failedDependency) {
      rejected.push({ proposal, reason: "skipped_dependency_failed" });
      funnelAnalytics.record(analytics, proposal, "Approved", "rejected", { reason: "skipped_dependency_failed", dependency: failedDependency });
      continue;
    }
    const dedupeKey = `${proposal.messageId}:${proposal.actionId}:${proposal.sourceCharacterId}:${proposal.targetCharacterId ?? "none"}:${JSON.stringify(proposal.arguments || {})}`;
    if (state.dedupeLedger.has(dedupeKey)) {
      rejected.push({ proposal, reason: "duplicate_suppressed" });
      funnelAnalytics.record(analytics, proposal, "Approved", "rejected", { reason: "duplicate_suppressed" });
      continue;
    }
    const opinion = opinionEffectNormalizer.prepare(conversation, proposal, message);
    if (!opinion.accepted) {
      rejected.push({ proposal, reason: opinion.reason });
      funnelAnalytics.record(analytics, proposal, "Validated", "rejected", { reason: opinion.reason });
      continue;
    }
    proposal = opinion.proposal;
    item = { ...item, proposal, opinionReservationId: opinion.reservationId };
    state.dedupeLedger.add(dedupeKey);
    const invocation = invocationFrom(item);
    const shouldApprove = registry.shouldRequireApproval(proposal.actionId, approvalSettings?.approvalMode || "none");
    if (shouldApprove) {
      const target = proposal.targetCharacterId == null ? null : conversation.gameData.characters.get(proposal.targetCharacterId);
      const title = item.loaded.definition.title ? resolveI18nString(item.loaded.definition.title, language) : proposal.actionId;
      needsApproval.push({
        actionId: proposal.actionId,
        actionTitle: title,
        sourceCharacterId: proposal.sourceCharacterId,
        sourceCharacterName: item.sourceCharacter.shortName,
        targetCharacterId: proposal.targetCharacterId ?? undefined,
        targetCharacterName: target?.shortName,
        args: proposal.arguments,
        isDestructive: registry.getEffectiveDestructive(proposal.actionId),
        riskLevel: registry.getEffectiveRiskLevel(proposal.actionId),
        invocation
      });
      funnelAnalytics.record(analytics, proposal, "Approved", "pending");
      continue;
    }
    funnelAnalytics.record(analytics, proposal, "Approved", "pass");
    const result = await runInvocation(conversation, item.sourceCharacter, invocation);
    autoApproved.push(result);
    resultByAction.set(proposal.actionId, result);
    funnelAnalytics.record(analytics, proposal, "Executed", result.success ? "pass" : "failed", { reason: result.error || null, executionStatus: result.executionStatus });
    state.executionHistory.push(Object.freeze({ proposalId: proposal.proposalId, actionId: proposal.actionId, success: result.success, executionStatus: result.executionStatus }));
  }
  return { autoApproved, needsApproval, pendingConsent, rejected };
}

module.exports = { evidenceAllowed, normalizeActionDecision, invocationFrom, process };
