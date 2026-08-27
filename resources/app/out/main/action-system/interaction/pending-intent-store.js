"use strict";

class PendingIntentStore {
  constructor() {
    this.items = new Map();
    this.nextId = 1;
  }
  create(input) {
    for (const pending of this.items.values()) {
      if (pending.status === "awaiting_response" && pending.initiatorId === input.initiatorId && pending.targetId === input.targetId && pending.category === input.category) pending.status = "superseded";
    }
    const pendingId = `pending_${this.nextId++}`;
    const intent = {
      pendingId,
      ...input,
      createdTurnEpoch: Number(input.createdTurnEpoch) || 0,
      expiresTurnEpoch: (Number(input.createdTurnEpoch) || 0) + Math.max(1, Number(input.expiresAfterTurns) || 2),
      status: "awaiting_response"
    };
    this.items.set(pendingId, intent);
    return intent;
  }
  expire(currentTurnEpoch) {
    const expired = [];
    for (const intent of this.items.values()) {
      if (intent.status === "awaiting_response" && Number(currentTurnEpoch) > intent.expiresTurnEpoch) {
        intent.status = "expired";
        expired.push(intent);
      }
    }
    return expired;
  }
  awaitingForTarget(targetId, currentTurnEpoch) {
    this.expire(currentTurnEpoch);
    return [...this.items.values()].filter((intent) => intent.status === "awaiting_response" && intent.targetId === Number(targetId));
  }
  confirm(pendingId) {
    const intent = this.items.get(pendingId);
    if (intent?.status === "awaiting_response") intent.status = "confirmed";
    return intent || null;
  }
  reject(pendingId) {
    const intent = this.items.get(pendingId);
    if (intent?.status === "awaiting_response") intent.status = "rejected";
    return intent || null;
  }
  get(pendingId) {
    return this.items.get(pendingId) || null;
  }
  clear(reason = "cancelled") {
    let count = 0;
    for (const intent of this.items.values()) {
      if (intent.status === "awaiting_response") {
        intent.status = reason === "mode_changed" ? "cancelled" : reason;
        count++;
      }
    }
    return count;
  }
}

module.exports = { PendingIntentStore };
