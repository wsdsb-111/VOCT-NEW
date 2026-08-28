"use strict";

function ensureState(conversation) {
  if (!conversation.socialConsequenceState) {
    conversation.socialConsequenceState = { counts: new Map(), reservations: new Map(), history: [] };
  }
  return conversation.socialConsequenceState;
}

function normalizedTopic(item) {
  return String(item.sourceEventId || item.normalizedTopic || item.reason || "topic").trim().toLocaleLowerCase().replace(/\s+/g, " ");
}

function keyFor(item) {
  return [item.sourceCharacterId, item.targetCharacterId, item.reasonCluster || item.consequenceType || "opinion", normalizedTopic(item)].join(":");
}

function scaleDelta(conversation, item) {
  const count = ensureState(conversation).counts.get(keyFor(item)) || 0;
  const scale = count === 0 ? 1 : count === 1 ? 0.4 : 0;
  const delta = Math.round(Number(item.delta || 0) * scale) || 0;
  return { ...item, delta, cooldownScale: scale };
}

function reserve(conversation, item) {
  const state = ensureState(conversation);
  const key = keyFor(item);
  if ([...state.reservations.values()].some((entry) => entry.key === key && entry.status === "reserved")) return null;
  const reservationId = `social-reservation:${state.reservations.size + 1}:${key}`;
  const reservation = { reservationId, key, item: { ...item }, status: "reserved" };
  state.reservations.set(reservationId, reservation);
  return { ...reservation };
}

function apply(conversation, reservationId) {
  const state = ensureState(conversation);
  const reservation = state.reservations.get(reservationId);
  if (!reservation || reservation.status !== "reserved") return false;
  reservation.status = "applied";
  state.counts.set(reservation.key, (state.counts.get(reservation.key) || 0) + 1);
  state.history.push(Object.freeze({ ...reservation.item, reservationId, status: "applied" }));
  return true;
}

function release(conversation, reservationId) {
  const state = ensureState(conversation);
  const reservation = state.reservations.get(reservationId);
  if (!reservation || reservation.status !== "reserved") return false;
  reservation.status = "released";
  return true;
}

module.exports = { ensureState, keyFor, scaleDelta, reserve, apply, release };
