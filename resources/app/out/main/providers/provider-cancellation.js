"use strict";

function cancellationError(signal) {
  const timedOut = signal?.reason?.name === "TimeoutError";
  const error = new Error(timedOut ? "provider_timeout" : "provider_cancelled");
  error.name = timedOut ? "TimeoutError" : "AbortError";
  return error;
}

function assertActive(signal) {
  if (signal?.aborted) throw cancellationError(signal);
}

function awaitWithSignal(value, signal) {
  if (signal?.aborted) { Promise.resolve(value).catch(() => {}); return Promise.reject(cancellationError(signal)); }
  if (!signal) return Promise.resolve(value);
  return new Promise((resolve, reject) => {
    const abort = () => { cleanup(); reject(cancellationError(signal)); };
    const cleanup = () => signal.removeEventListener("abort", abort);
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve(value).then(result => { cleanup(); resolve(result); }, error => { cleanup(); reject(error); });
    if (signal.aborted) abort();
  });
}

function abortableDelay(milliseconds, signal) {
  assertActive(signal);
  return new Promise((resolve, reject) => {
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener("abort", abort); };
    const abort = () => { cleanup(); reject(cancellationError(signal)); };
    const timer = setTimeout(() => { cleanup(); resolve(); }, milliseconds);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
  });
}

function createRequestControl({ signal, deadline, beforeSend, beforeTransport, onEffectiveRequest, promptPlanProof, requestType, planStatus, ownerEvidence, reserveAttempt, maxAttempts = 2, onEvent } = {}) {
  const deadlineAt = deadline instanceof Date ? deadline.getTime() : deadline;
  if (deadlineAt != null && (!Number.isFinite(deadlineAt) || deadlineAt - Date.now() > 2147483647)) throw new Error("provider_deadline_invalid");
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  if (signal?.aborted) abort(); else signal?.addEventListener("abort", abort, { once: true });
  let timer = null, attempts = 0, disposed = false;
  if (deadlineAt != null) {
    const expire = () => { const error = new Error("provider_timeout"); error.name = "TimeoutError"; controller.abort(error); };
    if (deadlineAt <= Date.now()) expire(); else timer = setTimeout(expire, Math.min(2147483647, deadlineAt - Date.now()));
  }
  const limit = Number.isSafeInteger(maxAttempts) && maxAttempts > 0 ? Math.min(maxAttempts, 2) : 2;
  let effectiveRequestBudget = null;
  const control = {
    signal: controller.signal, deadline: deadlineAt ?? null, maxAttempts: limit,
    requestType: typeof requestType === "string" && requestType.trim() ? requestType.trim() : "unknown",
    planStatus: planStatus === "PROMPT_PLAN_V9" ? planStatus : "LEGACY_OBSERVED",
    ownerEvidence: ownerEvidence === "PRESENT" ? ownerEvidence : "UNKNOWN",
    sourceGuardPassed: false,
    adapterInputMessagesFingerprint: null,
    onEffectiveRequest: typeof onEffectiveRequest === "function" ? onEffectiveRequest : null,
    get attemptCount() { return attempts; },
    check() {
      assertActive(controller.signal);
      if (disposed) throw new Error("provider_request_closed");
      if (deadlineAt != null && Date.now() >= deadlineAt) {
        const error = new Error("provider_timeout"); error.name = "TimeoutError"; controller.abort(error); assertActive(controller.signal);
      }
    },
    beforeSend() {
      control.check();
      if (attempts >= limit) throw new Error("provider_attempt_budget_exceeded");
      const guarded = beforeSend?.();
      if (guarded?.then) throw new Error("provider_async_guard_unsupported");
      control.check();
      const reserved = reserveAttempt?.({ attempt: attempts + 1 });
      if (reserved?.then) throw new Error("provider_async_reservation_unsupported");
      if (reserved === false) throw new Error("provider_cost_budget_exceeded");
      control.check(); attempts++;
      control.emit({ type: "STARTED", attemptCount: attempts });
    },
    setEffectiveRequestBudget(callback) {
      effectiveRequestBudget = typeof callback === "function" ? callback : null;
    },
    setAdapterInputMessagesFingerprint(value) {
      control.adapterInputMessagesFingerprint = typeof value === "string" ? value : null;
    },
    async beforeTransport(snapshot) {
      control.check();
      control.sourceGuardPassed = false;
      const budget = await awaitWithSignal(effectiveRequestBudget?.(snapshot), controller.signal);
      control.check();
      try {
        const result = await awaitWithSignal(beforeTransport?.(snapshot, promptPlanProof, budget), controller.signal);
        control.check();
        if (result === false || result?.ok === false) {
          const code = typeof result?.reasonCode === "string" ? result.reasonCode : "provider_effective_request_rejected";
          const error = new Error(code);
          error.code = code;
          error.votcPreflight = true;
          throw error;
        }
        control.sourceGuardPassed = typeof beforeTransport === "function";
      } catch (error) {
        control.sourceGuardPassed = false;
        if (error && typeof error === "object" && error.message !== "memory4_request_source_changed_before_send") {
          try { error.votcPreflight = true; } catch {}
        }
        throw error;
      }
      return budget;
    },
    emit(event) { try { onEvent?.(event); } catch {} },
    cancel() { if (!controller.signal.aborted) controller.abort(cancellationError()); },
    dispose() {
      if (disposed) return;
      disposed = true; clearTimeout(timer); signal?.removeEventListener("abort", abort);
    }
  };
  return control;
}

function managedIterator(generator, closeBeforeStart, signal, cancel) {
  let started = false, closed = false;
  const detach = () => signal?.removeEventListener("abort", abort);
  const iterator = {
    next(value) { started = true; detach(); return generator.next(value); },
    async return(value) {
      detach();
      cancel?.();
      if (!started && !closed) { closed = true; await closeBeforeStart(); }
      return generator.return(value);
    },
    async throw(error) {
      cancel?.();
      if (!started) await iterator.return();
      return generator.throw(error);
    },
    [Symbol.asyncIterator]() { return this; }
  };
  const abort = () => { if (!started) iterator.return().catch(() => {}); };
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();
  return iterator;
}

module.exports = { assertActive, cancellationError, awaitWithSignal, abortableDelay, createRequestControl, managedIterator };
