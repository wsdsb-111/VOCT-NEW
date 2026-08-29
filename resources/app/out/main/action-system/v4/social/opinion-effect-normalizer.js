"use strict";

const socialEffectDedupe = require("./social-effect-dedupe");

const DIRECT_ORIGINS = new Set(["precision_selector", "performance_local", "performance_compact"]);
const DIRECT_VALUES = new Set([-3, -2, -1, 1, 2, 3]);

function normalizedTopic(message, delta) {
  const text = String(message?.content || "").trim().toLocaleLowerCase().replace(/\s+/g, " ").slice(0, 64);
  return `${delta > 0 ? "positive" : "negative"}:${text || message?.id || "dialogue"}`;
}

function prepare(conversation, proposal, message) {
  if (proposal.actionId !== "changeOpinionOf") return { accepted: true, proposal, reservationId: null };
  const delta = Number(proposal.arguments?.value);
  const direct = DIRECT_ORIGINS.has(proposal.origin);
  if (!Number.isInteger(delta) || delta === 0) return { accepted: false, reason: "invalid_opinion_delta" };
  if (direct && !DIRECT_VALUES.has(delta)) return { accepted: false, reason: "rejected_direct_opinion_delta" };
  if (!direct && (delta < -10 || delta > 10)) return { accepted: false, reason: "invalid_opinion_delta" };
  const state = conversation.actionEngineV4State;
  const effect = {
    sourceCharacterId: proposal.sourceCharacterId,
    targetCharacterId: proposal.targetCharacterId,
    effectType: "opinion",
    causeType: direct ? "direct_dialogue" : "derived_world_event",
    causeId: (proposal.evidenceMessageIds || []).map(String).join("+") || String(proposal.messageId),
    topicKey: normalizedTopic(message, delta),
    turnId: state?.dialogueTurn ?? conversation.turnEpoch ?? 0,
    origin: direct ? "explicit_dialogue" : "derived_world_event",
    direct,
    delta
  };
  const reservation = socialEffectDedupe.reserve(conversation, effect);
  if (!reservation.accepted) return reservation;
  return {
    accepted: true,
    proposal: Object.freeze({ ...proposal, arguments: Object.freeze({ ...proposal.arguments, value: reservation.reservation.effect.delta }) }),
    reservationId: reservation.reservation.reservationId,
    cooldownScale: reservation.reservation.scale
  };
}

module.exports = { DIRECT_ORIGINS, DIRECT_VALUES, normalizedTopic, prepare, commit: socialEffectDedupe.commit, release: socialEffectDedupe.release };
