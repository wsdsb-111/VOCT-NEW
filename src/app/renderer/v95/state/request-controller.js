import { createContractError, normalizeErrorCode } from "../contracts/errors.v1.js";

function raceAbort(promise, signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(createContractError("REQUEST_CANCELLED"));
      return;
    }
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      callback(value);
    };
    const onAbort = () => finish(reject, createContractError("REQUEST_CANCELLED"));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(value => finish(resolve, value), error => finish(reject, error));
  });
}

export function createRequestController({ contextEpoch, resourceStore }) {
  if (!contextEpoch || typeof contextEpoch.isCurrent !== "function" || !resourceStore
    || typeof resourceStore.beginRead !== "function" || typeof resourceStore.commitRead !== "function"
    || typeof resourceStore.commitError !== "function") throw createContractError("VALIDATION_ERROR");

  const active = new Map();
  let disposed = false;

  async function read(resourceKey, operation, { isEmpty } = {}) {
    if (disposed) throw createContractError("REQUEST_CANCELLED");
    if (typeof operation !== "function") throw createContractError("VALIDATION_ERROR");
    const previous = active.get(resourceKey);
    if (previous) previous.controller.abort();

    const ticket = resourceStore.beginRead(resourceKey);
    const controller = new AbortController();
    const request = { controller, ticket };
    active.set(resourceKey, request);
    try {
      const pending = Promise.resolve().then(() => operation({ signal: controller.signal, ticket }));
      const data = await raceAbort(pending, controller.signal);
      if (!contextEpoch.isCurrent(ticket.contextEpoch) || controller.signal.aborted) {
        return { committed: false, value: undefined, errorCode: "STALE_CONTEXT" };
      }
      const state = typeof isEmpty === "function" && isEmpty(data) ? "empty" : "ready";
      const committed = resourceStore.commitRead(ticket, data, { state });
      return committed
        ? { committed: true, value: data, errorCode: null }
        : { committed: false, value: undefined, errorCode: "STALE_CONTEXT" };
    } catch (error) {
      const code = normalizeErrorCode(error);
      if (controller.signal.aborted) return { committed: false, value: undefined, errorCode: "REQUEST_CANCELLED" };
      if (!contextEpoch.isCurrent(ticket.contextEpoch)) return { committed: false, value: undefined, errorCode: "STALE_CONTEXT" };
      const committed = resourceStore.commitError(ticket, code);
      return committed
        ? { committed: true, value: undefined, errorCode: code }
        : { committed: false, value: undefined, errorCode: "STALE_CONTEXT" };
    } finally {
      if (active.get(resourceKey) === request) active.delete(resourceKey);
    }
  }

  function cancel(resourceKey) {
    const request = active.get(resourceKey);
    if (!request) return false;
    request.controller.abort();
    return true;
  }

  function cancelAll() {
    for (const request of active.values()) request.controller.abort();
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    cancelAll();
  }

  return Object.freeze({ read, cancel, cancelAll, dispose, activeCount: () => active.size });
}
