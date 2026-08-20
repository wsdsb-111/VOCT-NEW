"use strict";

function createParticipantBinding(input) {
  const binding = {
    bindingId: `${input.messageId ?? "message"}:${input.eventId ?? "event"}:${input.actionId ?? "action"}`,
    mode: input.mode || "resolved",
    messageId: input.messageId ?? null,
    eventId: input.eventId ?? null,
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

module.exports = { createParticipantBinding, createUnresolvedBinding };
