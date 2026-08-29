"use strict";

const socialEffectDedupe = require("./social-effect-dedupe");

const DIRECT_ORIGINS = new Set(["precision_selector", "performance_local", "performance_compact"]);
const DIRECT_VALUES = new Set([-3, -2, -1, 1, 2, 3]);
const TOPIC_CLUSTERS = Object.freeze([
  ["praise:intelligence", /(?:聪明|智慧|才智|睿智|机敏|smart|intelligen|wise)/i],
  ["praise:appearance", /(?:美丽|漂亮|英俊|俊美|容貌|beaut|handsome|pretty)/i],
  ["praise:bravery", /(?:勇敢|英勇|勇气|无畏|brave|courage)/i],
  ["gratitude:help", /(?:多谢|感谢|感激|救命|帮助|相助|thank|grateful|help)/i],
  ["insult:competence", /(?:愚蠢|无能|笨蛋|蠢货|stupid|fool|incompeten)/i],
  ["threat:personal", /(?:威胁|杀了你|要你好看|付出代价|后果自负|threat|kill you|pay for this)/i]
]);

function topicCluster(message) {
  const text = String(message?.content || "");
  return TOPIC_CLUSTERS.find(([, pattern]) => pattern.test(text))?.[0] || null;
}

function normalizedTopic(message, delta, targetCharacterId = null) {
  const text = String(message?.content || "").trim().toLocaleLowerCase().replace(/\s+/g, " ").replace(/[，。！？,.!?]/g, "").slice(0, 64);
  const identity = topicCluster(message) || `text:${text || message?.id || "dialogue"}`;
  return `${delta > 0 ? "positive" : "negative"}:target:${targetCharacterId ?? "none"}:${identity}`;
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
    topicKey: normalizedTopic(message, delta, proposal.targetCharacterId),
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

module.exports = { DIRECT_ORIGINS, DIRECT_VALUES, TOPIC_CLUSTERS, topicCluster, normalizedTopic, prepare, commit: socialEffectDedupe.commit, release: socialEffectDedupe.release };
