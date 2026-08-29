"use strict";

const pendingStore = require("../pending/explicit-pending-store");

function state(conversation) {
  const root = pendingStore.ensureState(conversation);
  if (!root.social) root.social = { appliedCauses: new Set(), reservedCauses: new Set(), topicCounts: new Map(), directTurnTotals: new Map(), allTurnTotals: new Map(), reservations: new Map() };
  return root.social;
}

function causeKey(effect) {
  return [effect.sourceCharacterId, effect.targetCharacterId, effect.effectType, effect.causeType, effect.causeId].join(":");
}

function topicKey(effect) {
  return [effect.sourceCharacterId, effect.targetCharacterId, effect.effectType, effect.topicKey].join(":");
}

function reserve(conversation, effect) {
  const current = state(conversation);
  const cause = causeKey(effect);
  if (current.appliedCauses.has(cause) || current.reservedCauses.has(cause)) return { accepted: false, reason: "same_cause_deduped" };
  const topic = topicKey(effect);
  const count = current.topicCounts.get(topic) || 0;
  const scale = count === 0 ? 1 : count === 1 ? 0.4 : 0;
  if (scale === 0) return { accepted: false, reason: "topic_cooldown_suppressed" };
  const scaledDelta = Math.sign(effect.delta) * Math.round(Math.abs(effect.delta) * scale);
  if (scaledDelta === 0) return { accepted: false, reason: "topic_cooldown_suppressed" };
  const directTotal = current.directTurnTotals.get(effect.turnId) || 0;
  const allTotal = current.allTurnTotals.get(effect.turnId) || 0;
  if (effect.direct && directTotal + Math.abs(scaledDelta) > 5) return { accepted: false, reason: "direct_turn_cap" };
  if (allTotal + Math.abs(scaledDelta) > 10) return { accepted: false, reason: "overall_turn_cap" };
  const reservationId = `ae4-opinion:${effect.turnId}:${current.reservations.size + 1}`;
  const reservation = Object.freeze({ reservationId, cause, topic, scale, effect: Object.freeze({ ...effect, delta: scaledDelta }) });
  current.reservedCauses.add(cause);
  current.reservations.set(reservationId, reservation);
  return { accepted: true, reservation };
}

function commit(conversation, reservationId) {
  const current = state(conversation);
  const reservation = current.reservations.get(reservationId);
  if (!reservation) return false;
  current.reservations.delete(reservationId);
  current.reservedCauses.delete(reservation.cause);
  current.appliedCauses.add(reservation.cause);
  current.topicCounts.set(reservation.topic, (current.topicCounts.get(reservation.topic) || 0) + 1);
  const amount = Math.abs(reservation.effect.delta);
  current.allTurnTotals.set(reservation.effect.turnId, (current.allTurnTotals.get(reservation.effect.turnId) || 0) + amount);
  if (reservation.effect.direct) current.directTurnTotals.set(reservation.effect.turnId, (current.directTurnTotals.get(reservation.effect.turnId) || 0) + amount);
  return true;
}

function release(conversation, reservationId) {
  const current = state(conversation);
  const reservation = current.reservations.get(reservationId);
  if (!reservation) return false;
  current.reservations.delete(reservationId);
  current.reservedCauses.delete(reservation.cause);
  return true;
}

module.exports = { state, causeKey, topicKey, reserve, commit, release };
