"use strict";

const { assertActive, abortableDelay } = require("./provider-cancellation");
const { classifyProviderError, SOURCE_GUARD_CODE } = require("./provider-errors");

async function retryOperation(operation, { signal, maxAttempts = 2, initialDelay = 1000, shouldRetry = () => true, check } = {}) {
  const limit = Number.isSafeInteger(maxAttempts) && maxAttempts > 0 ? Math.min(maxAttempts, 2) : 2;
  for (let attempt = 1; attempt <= limit; attempt++) {
    assertActive(signal); check?.();
    try { return await operation(); }
    catch (error) {
      if (error?.message === SOURCE_GUARD_CODE) throw error;
      assertActive(signal);
      const details = classifyProviderError(error, { attemptCount: attempt });
      error.votcAttemptCount = attempt; error.votcRetryable = details.safeToReplay;
      if (attempt >= limit || !details.safeToReplay || !shouldRetry(error)) throw error;
      const delay = Math.max(Math.max(0, initialDelay) * Math.pow(2, attempt - 1), details.retryAfterMs || 0);
      // A server asking for a longer wait is returned to the caller; it is never retried sooner.
      if (!Number.isFinite(delay) || delay > 30000) throw error;
      check?.(); await abortableDelay(delay, signal);
    }
  }
}

module.exports = { retryOperation };
