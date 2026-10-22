import { createContractError, normalizeErrorCode } from "../contracts/errors.v1.js";

const pendingWrites = new Map();
const completedWrites = new Map();
const MAX_COMPLETED_WRITES = 128;
const COMPLETED_STATES = new Set(["success", "succeeded", "completed", "complete", "confirmed"]);
const RECEIPT_FIELDS = new Set([
  "status", "state", "effectState", "receiptId", "runId", "commandId", "ackId",
  "sequence", "accepted", "success", "readbackRequired", "errorCode"
]);
const RECEIPT_STRING = /^[A-Za-z0-9_.:-]{1,160}$/;

function safeReceipt(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const receipt = {};
  for (const field of RECEIPT_FIELDS) {
    let current;
    try {
      current = value[field];
    } catch (_ignored) {
      continue;
    }
    if (field === "errorCode" && current !== undefined) {
      receipt.errorCode = normalizeErrorCode(value);
    } else if (typeof current === "boolean" || Number.isFinite(current)) {
      receipt[field] = current;
    } else if (typeof current === "string" && RECEIPT_STRING.test(current)) {
      receipt[field] = current;
    }
  }
  return Object.freeze(receipt);
}

function isReadbackRequired(value) {
  if (!value || typeof value !== "object") return false;
  if (value.readbackRequired === true || String(value.status || "").toLowerCase() === "unknown"
    || String(value.state || "").toLowerCase() === "unknown"
    || String(value.effectState || "").toUpperCase() === "UNKNOWN") return true;
  return normalizeErrorCode(value) === "EFFECT_UNKNOWN";
}

function isConfirmedSuccess(value) {
  if (value === true) return true;
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  if (value.success === true || value.ok === true) return true;
  for (const field of ["status", "state", "effectState"]) {
    const current = value[field];
    if (typeof current === "string" && COMPLETED_STATES.has(current.toLowerCase())) return true;
  }
  return false;
}

function rememberCompleted(operationKey, record) {
  completedWrites.delete(operationKey);
  completedWrites.set(operationKey, record);
  while (completedWrites.size > MAX_COMPLETED_WRITES) {
    const oldestKey = completedWrites.keys().next().value;
    completedWrites.delete(oldestKey);
  }
}

function resolveTimeout(value, fallback) {
  const timeoutMs = value === undefined ? fallback : value;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000) {
    throw createContractError("VALIDATION_ERROR");
  }
  return timeoutMs;
}

function awaitResponse(promise, { signal, timeoutMs, timeoutCode }) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(createContractError("REQUEST_CANCELLED"));
      return;
    }
    let settled = false;
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    };
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback(value);
    };
    const onAbort = () => finish(reject, createContractError("REQUEST_CANCELLED"));
    const timer = setTimeout(() => finish(reject, createContractError(timeoutCode)), timeoutMs);
    signal?.addEventListener("abort", onAbort, { once: true });
    promise.then(value => finish(resolve, value), error => finish(reject, createContractError(normalizeErrorCode(error))));
  });
}

export function createRendererIpcClient({ ipcMap, defaultTimeoutMs = 30000 } = {}) {
  if (!ipcMap || typeof ipcMap !== "object" || Array.isArray(ipcMap)) throw createContractError("VALIDATION_ERROR");
  resolveTimeout(defaultTimeoutMs, 30000);
  const methods = new Map(Object.entries(ipcMap).filter(([, handler]) => typeof handler === "function"));

  function handlerFor(method) {
    const handler = methods.get(method);
    if (typeof method !== "string" || !handler) throw createContractError("VALIDATION_ERROR");
    return handler;
  }

  function invoke(handler, args) {
    try {
      return Promise.resolve(handler(args));
    } catch (error) {
      return Promise.reject(createContractError(normalizeErrorCode(error)));
    }
  }

  async function read(method, args, { signal, timeoutMs } = {}) {
    const handler = handlerFor(method);
    const timeout = resolveTimeout(timeoutMs, defaultTimeoutMs);
    if (signal?.aborted) throw createContractError("REQUEST_CANCELLED");
    const pending = invoke(handler, args);
    return awaitResponse(pending, { signal, timeoutMs: timeout, timeoutCode: "IPC_UNAVAILABLE" });
  }

  async function write(method, args, { operationKey, signal, timeoutMs } = {}) {
    const handler = handlerFor(method);
    const timeout = resolveTimeout(timeoutMs, defaultTimeoutMs);
    if (typeof operationKey !== "string" || operationKey.length < 1 || operationKey.length > 160) {
      throw createContractError("VALIDATION_ERROR");
    }
    if (signal?.aborted) throw createContractError("REQUEST_CANCELLED");
    const pendingRecord = pendingWrites.get(operationKey);
    if (pendingRecord) throw createContractError("EFFECT_UNKNOWN");
    if (completedWrites.has(operationKey)) throw createContractError("VALIDATION_ERROR");

    const record = { state: "pending", errorCode: null, receipt: null };
    pendingWrites.set(operationKey, record);
    const pending = invoke(handler, args);
    pending.then(
      value => { if (record.state === "unknown") record.receipt = safeReceipt(value); },
      error => { if (record.state === "unknown") record.receipt = Object.freeze({ errorCode: normalizeErrorCode(error) }); }
    );

    try {
      const result = await awaitResponse(pending, { signal, timeoutMs: timeout, timeoutCode: "IPC_UNAVAILABLE" });
      if (isReadbackRequired(result)) {
        record.state = "unknown";
        record.errorCode = "EFFECT_UNKNOWN";
        record.receipt = safeReceipt(result);
        return { status: "unknown", errorCode: "EFFECT_UNKNOWN", readbackRequired: true, receipt: record.receipt };
      }
      record.receipt = safeReceipt(result);
      if (!isConfirmedSuccess(result)) {
        record.state = "unknown";
        record.errorCode = "EFFECT_UNKNOWN";
        return { status: "unknown", errorCode: "EFFECT_UNKNOWN", readbackRequired: true, receipt: record.receipt };
      }
      record.state = "completed";
      pendingWrites.delete(operationKey);
      rememberCompleted(operationKey, record);
      return Object.freeze({ ...(record.receipt || {}), status: record.receipt?.status || "completed" });
    } catch (error) {
      record.state = "unknown";
      record.errorCode = "EFFECT_UNKNOWN";
      record.receipt = Object.freeze({ errorCode: normalizeErrorCode(error) });
      return { status: "unknown", errorCode: "EFFECT_UNKNOWN", readbackRequired: true, receipt: record.receipt };
    }
  }

  function getWriteStatus(operationKey) {
    const record = pendingWrites.get(operationKey) || completedWrites.get(operationKey);
    if (!record) return Object.freeze({ state: "not_started", errorCode: null, readbackRequired: false, receipt: null });
    return Object.freeze({
      state: record.state,
      errorCode: record.errorCode,
      readbackRequired: record.state === "unknown",
      receipt: record.receipt
    });
  }

  return Object.freeze({ read, write, getWriteStatus });
}
