import { createReadBoundary } from "./read-boundary.js";

const RESOURCE_KEY = "official-recollection-diagnostics";
const RESPONDER_ID_PATTERN = /^\d+$/;

function contextVersion(context) {
  if (!context || typeof context !== "object"
    || typeof context.campaignTag !== "string" || context.campaignTag.length === 0
    || typeof context.ownerTag !== "string" || context.ownerTag.length === 0
    || typeof context.conversationTag !== "string" || context.conversationTag.length === 0
    || !Number.isSafeInteger(context.conversationEpoch) || context.conversationEpoch < 0
    || context.isActive !== true) return null;
  return JSON.stringify({ campaignTag: context.campaignTag, ownerTag: context.ownerTag,
    conversationTag: context.conversationTag, conversationEpoch: context.conversationEpoch,
    isActive: context.isActive });
}

function isResponderId(value) {
  return typeof value === "string" && RESPONDER_ID_PATTERN.test(value);
}

export function createOfficialRecollectionReader({ runtime, worldlineApi, timeoutMs = 15000 } = {}) {
  if (!runtime || typeof runtime.getContext !== "function" || typeof runtime.subscribeContext !== "function"
    || !worldlineApi || typeof worldlineApi.getOfficialRecollection !== "function"
    || !Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError("invalid_official_recollection_reader");
  }

  let disposed = false;
  let requestSequence = 0;
  let snapshotSequence = 0;
  let currentContextVersion = contextVersion(runtime.getContext());
  let selectedResponderId = null;
  let activeReadTimeout = null;
  let state = Object.freeze({ status: "idle", value: null, errorCode: null, responderId: null,
    contextVersion: currentContextVersion, snapshotVersion: snapshotSequence, timedOut: false });
  const listeners = new Set();
  const boundary = createReadBoundary(runtime, "official-recollection-diagnostics");

  function publish(status, value, errorCode, responderId = selectedResponderId, timedOut = false) {
    if (disposed) return;
    state = Object.freeze({ status, value, errorCode, responderId,
      contextVersion: contextVersion(runtime.getContext()), snapshotVersion: snapshotSequence, timedOut });
    for (const listener of Array.from(listeners)) {
      try { listener(state); } catch (_ignored) { }
    }
  }

  function clearActiveReadTimeout() {
    const active = activeReadTimeout;
    if (!active) return;
    activeReadTimeout = null;
    clearTimeout(active.timerId);
    active.resolve();
  }

  function invalidate(errorCode = "STALE_CONTEXT") {
    clearActiveReadTimeout();
    requestSequence += 1;
    boundary.cancel(RESOURCE_KEY);
    publish("stale", null, errorCode);
  }

  const unsubscribeContext = runtime.subscribeContext(context => {
    const nextVersion = contextVersion(context);
    if (nextVersion === currentContextVersion) return;
    currentContextVersion = nextVersion;
    invalidate("STALE_CONTEXT");
  });

  let unsubscribeWorldline = () => {};
  let snapshotEventsReady = false;
  if (typeof worldlineApi.onUpdated === "function") {
    try {
      const stop = worldlineApi.onUpdated(() => {
        snapshotSequence += 1;
        invalidate("STALE_CONTEXT");
      });
      if (typeof stop === "function") {
        unsubscribeWorldline = stop;
        snapshotEventsReady = true;
      }
    } catch (_ignored) { }
  }

  function getState() {
    return state;
  }

  // Use during render: an old responder/context value is hidden before effects run.
  function getStateFor(responderId, expectedContextVersion) {
    const actualContextVersion = contextVersion(runtime.getContext());
    const expectedVersion = expectedContextVersion === undefined ? actualContextVersion : expectedContextVersion;
    if (isResponderId(responderId) && responderId === state.responderId
      && actualContextVersion !== null && expectedVersion === actualContextVersion
      && state.contextVersion === actualContextVersion && state.snapshotVersion === snapshotSequence) return state;
    return Object.freeze({ status: "stale", value: null, errorCode: null,
      responderId: isResponderId(responderId) ? responderId : null,
      contextVersion: actualContextVersion, snapshotVersion: snapshotSequence, timedOut: false });
  }

  function subscribe(listener) {
    if (typeof listener !== "function") throw new TypeError("invalid_official_recollection_listener");
    if (disposed) return () => {};
    listeners.add(listener);
    try { listener(state); } catch (_ignored) { }
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      listeners.delete(listener);
    };
  }

  function setResponder(responderId) {
    if (disposed) return state;
    const nextResponderId = isResponderId(responderId) ? responderId : null;
    if (nextResponderId === selectedResponderId) return state;
    selectedResponderId = nextResponderId;
    clearActiveReadTimeout();
    requestSequence += 1;
    boundary.cancel(RESOURCE_KEY);
    publish(nextResponderId ? "idle" : "unavailable", null,
      nextResponderId ? null : "VALIDATION_ERROR", nextResponderId);
    return state;
  }

  async function refresh(responderId) {
    if (disposed) return getState();
    if (!isResponderId(responderId)) {
      setResponder(null);
      publish("unavailable", null, "VALIDATION_ERROR", null);
      return getState();
    }
    setResponder(responderId);
    clearActiveReadTimeout();
    const sequence = ++requestSequence;
    boundary.cancel(RESOURCE_KEY);
    const expectedSnapshot = snapshotSequence;
    if (!snapshotEventsReady || typeof runtime.syncContext !== "function") {
      publish("unavailable", null, "IPC_UNAVAILABLE", responderId);
      return getState();
    }
    publish("loading", null, null, responderId);

    async function performRead() {
      try {
        const before = await runtime.syncContext();
        if (disposed || sequence !== requestSequence) return;
        const beforeVersion = contextVersion(before);
        if (!beforeVersion || beforeVersion !== contextVersion(runtime.getContext())
          || beforeVersion !== currentContextVersion) {
          publish("stale", null, "STALE_CONTEXT", responderId);
          return;
        }

        const result = await boundary.run(RESOURCE_KEY, () => worldlineApi.getOfficialRecollection(responderId));
        if (disposed || sequence !== requestSequence) return;

        const after = await runtime.syncContext();
        if (disposed || sequence !== requestSequence) return;
        const afterVersion = contextVersion(after);
        if (expectedSnapshot !== snapshotSequence || beforeVersion !== afterVersion
          || afterVersion !== contextVersion(runtime.getContext()) || afterVersion !== currentContextVersion
          || !result.committed || !result.isCurrent()) {
          publish("stale", null, result.errorCode || "STALE_CONTEXT", responderId);
        } else if (result.errorCode) {
          publish("error", null, result.errorCode, responderId);
        } else {
          publish("ready", result.value, null, responderId);
        }
      } catch (_ignored) {
        if (!disposed && sequence === requestSequence) publish("error", null, "IPC_UNAVAILABLE", responderId);
      }
    }

    const timeout = new Promise(resolve => {
      const timerId = setTimeout(() => {
        if (activeReadTimeout?.sequence === sequence) activeReadTimeout = null;
        if (!disposed && sequence === requestSequence) {
          requestSequence += 1;
          boundary.cancel(RESOURCE_KEY);
          publish("error", null, "IPC_UNAVAILABLE", responderId, true);
        }
        resolve();
      }, timeoutMs);
      activeReadTimeout = { sequence, timerId, resolve };
    });
    await Promise.race([performRead(), timeout]);
    if (activeReadTimeout?.sequence === sequence) clearActiveReadTimeout();
    return getState();
  }

  function cancel() {
    if (disposed) return;
    invalidate("REQUEST_CANCELLED");
  }

  function dispose() {
    if (disposed) return;
    clearActiveReadTimeout();
    disposed = true;
    requestSequence += 1;
    boundary.dispose();
    unsubscribeContext();
    unsubscribeWorldline();
    listeners.clear();
  }

  return Object.freeze({ getState, getStateFor, subscribe, setResponder, refresh, cancel, dispose });
}
