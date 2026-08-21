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
  const binding = {
    bindingId: `${input.messageId ?? "message"}:${input.eventId ?? "event"}:${input.actionId ?? "action"}`,
    mode: input.mode || "resolved",
    messageId: input.messageId ?? null,
    eventId: input.eventId ?? null,
    traceId: input.traceId ?? null,
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
  return Object.freeze({
    actionId: input.actionId,
    sourceCharacterId: input.sourceCharacterId ?? null,
    targetCharacterId: input.targetCharacterId ?? null,
    bindingId: input.bindingId ?? null,
    eventId: input.eventId ?? null,
    traceId: input.traceId ?? null,
    args: Object.freeze({ ...(input.args || {}) })
  });
}

function createExecutionResult(input) {
  return Object.freeze({
    actionId: input.actionId,
    success: input.success === true,
    error: input.error ?? null,
    feedback: input.feedback,
    sourceCharacterId: input.sourceCharacterId ?? null,
    targetCharacterId: input.targetCharacterId ?? null,
    bindingId: input.bindingId ?? null
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
