"use strict";

const pendingStore = require("./explicit-pending-store");

function resolve({ conversation, decision, speaker, messageId, mode, origin }) {
  const pending = pendingStore.get(conversation, decision.pendingId);
  if (!pending || pending.schemaVersion !== pendingStore.PENDING_SCHEMA_VERSION) return { handled: true, rejected: true, reason: "rejected_pending_not_found" };
  const state = pendingStore.ensureState(conversation);
  if (pending.expiresTurn < state.dialogueTurn) {
    pendingStore.settle(conversation, pending.pendingId, "expired");
    return { handled: true, rejected: true, reason: "rejected_pending_expired" };
  }
  if (Number(speaker?.id) !== Number(pending.targetId)) return { handled: true, rejected: true, reason: "rejected_pending_actor_mismatch" };
  if (decision.response === "reject") {
    pendingStore.settle(conversation, pending.pendingId, "rejected");
    return { handled: true, rejected: false, cancelled: true, pending };
  }
  if (decision.response === "defer") return { handled: true, rejected: false, deferred: true, pending };
  return {
    handled: true,
    accepted: true,
    pending,
    proposal: Object.freeze({
      proposalId: `proposal:${messageId}:pending:${pending.pendingId}`,
      messageId,
      engineVersion: "4.0",
      mode,
      origin,
      actionId: pending.actionId,
      sourceCharacterId: pending.sourceId,
      targetCharacterId: pending.targetId,
      arguments: pending.arguments,
      evidenceMessageIds: Object.freeze([...(decision.evidenceMessageIds || [])]),
      confidence: decision.confidence
    })
  };
}

module.exports = { resolve };
