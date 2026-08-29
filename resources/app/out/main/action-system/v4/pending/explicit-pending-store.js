"use strict";

const PENDING_SCHEMA_VERSION = "ae4-pending-v1";
const DEFAULT_PENDING_TTL = 10;

function ensureState(conversation) {
  if (!conversation.actionEngineV4State) {
    conversation.actionEngineV4State = {
      dialogueTurn: 0,
      seenMessageIds: new Set(),
      pending: new Map(),
      dedupeLedger: new Set(),
      executionHistory: [],
      worldEventEvidence: [],
      social: { appliedCauses: new Set(), reservedCauses: new Set(), topicCounts: new Map(), directTurnTotals: new Map(), allTurnTotals: new Map(), reservations: new Map() }
    };
  }
  return conversation.actionEngineV4State;
}

function observeMessage(conversation, message) {
  const state = ensureState(conversation);
  const id = message?.id ?? null;
  const key = id == null ? null : String(id);
  if (key != null && !state.seenMessageIds.has(key)) {
    state.seenMessageIds.add(key);
    state.dialogueTurn++;
  }
  return state.dialogueTurn;
}

function create(conversation, proposal, metadata = {}) {
  const state = ensureState(conversation);
  const existing = listActive(conversation).find((item) => item.actionId === proposal.actionId && Number(item.sourceId) === Number(proposal.sourceCharacterId) && Number(item.targetId) === Number(proposal.targetCharacterId) && JSON.stringify(item.arguments) === JSON.stringify(proposal.arguments || {}));
  if (existing) return existing;
  const ttl = Number.isInteger(metadata.pendingTtl) ? metadata.pendingTtl : DEFAULT_PENDING_TTL;
  const createdTurn = state.dialogueTurn;
  const pendingId = `pending:${proposal.messageId}:${state.pending.size + 1}`;
  const pending = Object.freeze({
    pendingId,
    actionId: proposal.actionId,
    sourceId: proposal.sourceCharacterId,
    targetId: proposal.targetCharacterId,
    arguments: Object.freeze({ ...(proposal.arguments || {}) }),
    createdTurn,
    expiresTurn: createdTurn + ttl,
    status: "pending",
    proposalMessageId: proposal.messageId ?? null,
    schemaVersion: PENDING_SCHEMA_VERSION
  });
  state.pending.set(pendingId, pending);
  return pending;
}

function get(conversation, pendingId) {
  return ensureState(conversation).pending.get(pendingId) || null;
}

function listActive(conversation) {
  const state = ensureState(conversation);
  return [...state.pending.values()].filter((item) => item.status === "pending" && item.expiresTurn >= state.dialogueTurn);
}

function settle(conversation, pendingId, status) {
  const state = ensureState(conversation);
  const current = state.pending.get(pendingId);
  if (!current) return null;
  const settled = Object.freeze({ ...current, status });
  state.pending.set(pendingId, settled);
  return settled;
}

module.exports = {
  PENDING_SCHEMA_VERSION,
  DEFAULT_PENDING_TTL,
  ensureState,
  observeMessage,
  create,
  get,
  listActive,
  settle
};
