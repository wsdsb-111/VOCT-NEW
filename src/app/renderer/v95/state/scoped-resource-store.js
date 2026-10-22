import { createContractError, normalizeErrorCode } from "../contracts/errors.v1.js";

export function createScopedResourceStore(contextEpoch) {
  if (!contextEpoch || typeof contextEpoch.capture !== "function" || typeof contextEpoch.isCurrent !== "function") {
    throw createContractError("VALIDATION_ERROR");
  }

  const entries = new Map();
  const latestSequences = new Map();
  let active = false;
  let activeScopeKey;
  let activeEpoch = null;
  let scopeRevision = 0;

  function activateScope(scopeKey) {
    if (!(typeof scopeKey === "string" && scopeKey.length > 0 && scopeKey.length <= 256)) {
      throw createContractError("VALIDATION_ERROR");
    }
    const currentEpoch = contextEpoch.capture();
    const changed = !active || !Object.is(activeScopeKey, scopeKey) || !contextEpoch.isCurrent(activeEpoch);
    if (changed) {
      scopeRevision += 1;
      entries.clear();
      latestSequences.clear();
    }
    active = true;
    activeScopeKey = scopeKey;
    activeEpoch = currentEpoch;
    return Object.freeze({ scopeRevision, ...activeEpoch });
  }

  function beginRead(resourceKey) {
    if (typeof resourceKey !== "string" || resourceKey.length === 0 || resourceKey.length > 160) {
      throw createContractError("VALIDATION_ERROR");
    }
    if (!active || !contextEpoch.isCurrent(activeEpoch)) {
      entries.clear();
      latestSequences.clear();
      active = false;
      activeScopeKey = undefined;
      activeEpoch = null;
      scopeRevision += 1;
      throw createContractError("STALE_CONTEXT");
    }

    const requestSeq = (latestSequences.get(resourceKey) || 0) + 1;
    latestSequences.set(resourceKey, requestSeq);
    const previous = entries.get(resourceKey);
    const hasPreviousData = previous && previous.data !== undefined && previous.state !== "error";
    entries.set(resourceKey, Object.freeze({
      state: hasPreviousData ? "refreshing" : "loading",
      data: hasPreviousData ? previous.data : undefined,
      errorCode: null,
      requestSeq
    }));
    return Object.freeze({
      resourceKey,
      scopeRevision,
      contextEpoch: activeEpoch,
      requestSeq
    });
  }

  function canCommit(ticket) {
    return Boolean(ticket && active && ticket.scopeRevision === scopeRevision
      && ticket.resourceKey && ticket.requestSeq === latestSequences.get(ticket.resourceKey)
      && contextEpoch.isCurrent(ticket.contextEpoch) && contextEpoch.isCurrent(activeEpoch));
  }

  function commitRead(ticket, data, { state = "ready" } = {}) {
    if (state !== "ready" && state !== "empty") throw createContractError("VALIDATION_ERROR");
    if (!canCommit(ticket)) return false;
    entries.set(ticket.resourceKey, Object.freeze({ state, data, errorCode: null, requestSeq: ticket.requestSeq }));
    return true;
  }

  function commitError(ticket, error) {
    if (!canCommit(ticket)) return false;
    entries.set(ticket.resourceKey, Object.freeze({
      state: "error",
      data: undefined,
      errorCode: normalizeErrorCode(error),
      requestSeq: ticket.requestSeq
    }));
    return true;
  }

  function get(resourceKey) {
    if (active && !contextEpoch.isCurrent(activeEpoch)) clear();
    const entry = entries.get(resourceKey);
    return entry ? Object.freeze({ ...entry }) : undefined;
  }

  function clear() {
    entries.clear();
    latestSequences.clear();
    active = false;
    activeScopeKey = undefined;
    activeEpoch = null;
    scopeRevision += 1;
  }

  return Object.freeze({ activateScope, beginRead, commitRead, commitError, get, clear });
}
