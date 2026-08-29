"use strict";

function createActionEvent(input) {
  const eventId = input.eventId || "event";
  return Object.freeze({
    ...input,
    eventId,
    traceId: input.traceId || `action:${eventId}`,
    evidence: Object.freeze({
      text: input.evidence?.text || "",
      start: input.evidence?.start ?? 0,
      end: input.evidence?.end ?? 0
    })
  });
}

function createReferenceResolution(input) {
  return Object.freeze({
    referenceType: input.referenceType,
    surface: input.surface,
    start: input.start ?? null,
    end: input.end ?? null,
    mode: input.mode,
    characterId: input.characterId ?? null,
    reason: input.reason ?? null,
    confidenceBasis: Object.freeze([...(input.confidenceBasis || [])])
  });
}

function createParticipantBinding(input) {
  const eventId = input.eventId ?? null;
  const binding = {
    bindingId: `${input.messageId ?? "message"}:${input.eventId ?? "event"}:${input.actionId ?? "action"}`,
    mode: input.mode || "resolved",
    messageId: input.messageId ?? null,
    eventId,
    traceId: input.traceId || (eventId ? `action:${eventId}` : null),
    actionId: input.actionId ?? null,
    speakerCharacterId: input.speakerCharacterId ?? null,
    actorCharacterId: input.actorCharacterId ?? null,
    patientCharacterId: input.patientCharacterId ?? null,
    sourceCharacterId: input.sourceCharacterId ?? null,
    targetCharacterId: input.targetCharacterId ?? null,
    references: Object.freeze([...(input.references || [])]),
    evidence: input.evidence ? Object.freeze({ start: input.evidence.start, end: input.evidence.end }) : null,
    resolutionBasis: Object.freeze([...(input.resolutionBasis || [])]),
    unresolvedReason: input.unresolvedReason || null
  };
  return Object.freeze(binding);
}

function createUnresolvedBinding(input) {
  return createParticipantBinding({
    ...input,
    mode: "unresolved",
    unresolvedReason: input.unresolvedReason || "unresolved_participants"
  });
}

function createAvailableAction(input) {
  return Object.freeze({
    ...input,
    args: Object.freeze([...(input.args || [])]),
    validTargetCharacterIds: input.validTargetCharacterIds ? Object.freeze([...input.validTargetCharacterIds]) : input.validTargetCharacterIds,
    participantBinding: input.participantBinding || null
  });
}

function createValidatedInvocation(input) {
  const eventId = input.eventId ?? null;
  return Object.freeze({
    actionId: input.actionId,
    sourceCharacterId: input.sourceCharacterId ?? null,
    targetCharacterId: input.targetCharacterId ?? null,
    bindingId: input.bindingId ?? null,
    eventId,
    traceId: input.traceId || (eventId ? `action:${eventId}` : null),
    origin: input.origin || (String(eventId || "").startsWith("social:") ? "social" : "action"),
    engineVersion: input.engineVersion || null,
    proposalId: input.proposalId || null,
    messageId: input.messageId ?? input.sourceMessageId ?? null,
    mode: input.mode || null,
    opinionReservationId: input.opinionReservationId || null,
    sourceMessageId: input.sourceMessageId ?? null,
    args: Object.freeze({ ...(input.args || {}) })
  });
}

function createExecutionResult(input) {
  const eventId = input.eventId ?? null;
  return Object.freeze({
    actionId: input.actionId,
    success: input.success === true,
    effectWritten: input.effectWritten === true,
    error: input.error ?? null,
    feedback: input.feedback,
    sourceCharacterId: input.sourceCharacterId ?? null,
    targetCharacterId: input.targetCharacterId ?? null,
    bindingId: input.bindingId ?? null,
    eventId,
    traceId: input.traceId || (eventId ? `action:${eventId}` : null),
    origin: input.origin || (String(eventId || "").startsWith("social:") ? "social" : "action"),
    engineVersion: input.engineVersion || null,
    proposalId: input.proposalId || null,
    messageId: input.messageId ?? input.sourceMessageId ?? null,
    mode: input.mode || null,
    executionStatus: input.executionStatus || null,
    opinionReservationId: input.opinionReservationId || null,
    sourceMessageId: input.sourceMessageId ?? null
  });
}

module.exports = {
  createActionEvent,
  createReferenceResolution,
  createParticipantBinding,
  createUnresolvedBinding,
  createAvailableAction,
  createValidatedInvocation,
  createExecutionResult
};
