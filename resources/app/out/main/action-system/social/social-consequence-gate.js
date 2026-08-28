"use strict";

const socialEvent = require("../social-event");

const CONFIRMED_SIGNAL_BY_ACTION = Object.freeze({
  rescue: "rescue",
  rescuedCharacter: "rescue",
  betrayal: "betrayal",
  isInjured: "severe_injury",
  characterIsKilled: "family_death"
});

function resolveParticipants(context) {
  const participants = context.directParticipants || [];
  const message = context.message || {};
  const actorId = message.actorId ?? participants.find((item) => item.name === message.name)?.id ?? (message.role === "user" ? participants.find((item) => item.isPlayer)?.id : null);
  let targetId = message.targetId ?? message.primaryAddresseeId ?? null;
  if (targetId == null && participants.length === 2 && actorId != null) targetId = participants.find((item) => item.id !== actorId)?.id ?? null;
  if (actorId == null || targetId == null || actorId === targetId) return null;
  if (!participants.some((item) => item.id === actorId) || !participants.some((item) => item.id === targetId)) return null;
  return { actorId, targetId };
}

function isKnown(context, characterId, evidenceId) {
  return context.knowledgeMap?.[characterId]?.[evidenceId]?.known === true;
}

function confirmedSignals(context, participants) {
  const result = [];
  for (const evidence of context.confirmedWorldEvents || []) {
    if (evidence.worldStateConfirmed !== true) continue;
    const actionKey = evidence.reasonCluster || evidence.content;
    const type = CONFIRMED_SIGNAL_BY_ACTION[actionKey] || (['rescue', 'betrayal', 'severe_injury', 'family_death'].includes(actionKey) ? actionKey : null);
    if (!type) continue;
    const affectedId = type === "family_death"
      ? (evidence.affectedCharacterId ?? participants.targetId)
      : (evidence.targetId ?? participants.targetId);
    if (!isKnown(context, affectedId, evidence.evidenceId)) continue;
    result.push({
      eventId: evidence.sourceEventId || evidence.evidenceId,
      type,
      valence: type === "rescue" ? "positive" : "negative",
      intensity: "high",
      reaction: "confirmed",
      evidence,
      confidence: 1,
      actorId: evidence.actorId,
      targetId: evidence.targetId,
      affectedCharacterId: affectedId
    });
  }
  return result;
}

function evaluate(context) {
  const participants = resolveParticipants(context);
  if (!participants) return { eligible: false, reasons: ["participants_unresolved"], signals: [], participants: null };
  const evidence = context.dialogueEvidence?.[0] || null;
  const signals = socialEvent.detectSignals(context.message?.content || "", evidence ? { text: evidence.content, start: 0, end: evidence.content.length } : null);
  signals.push(...confirmedSignals(context, participants));
  return {
    eligible: signals.length > 0,
    reasons: signals.length > 0 ? ["social_signal"] : ["no_social_signal"],
    signals,
    participants
  };
}

module.exports = { evaluate, resolveParticipants };
