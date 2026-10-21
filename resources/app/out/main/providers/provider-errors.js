"use strict";

const SOURCE_GUARD_CODE = "memory4_request_source_changed_before_send";
const CATEGORIES = new Set(["RATE_LIMIT", "SERVER_ERROR", "NETWORK", "TIMEOUT", "CANCELLED", "UNSUPPORTED", "INVALID_RESPONSE", "BUDGET", "AUTH", "UNKNOWN"]);
const PROVIDER_CODES = new Set(["ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "ECONNREFUSED", "ABORT_ERR", "rate_limit_exceeded", "invalid_api_key", "authentication_error", "invalid_request_error", "context_length_exceeded", "model_not_found", "insufficient_quota", "unsupported_feature", "content_filter"]);

function retryAfterMilliseconds(error) {
  const value = error?.headers?.get?.("retry-after") ?? error?.headers?.["retry-after"];
  if (value == null) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null;
}

function classifyProviderError(error, { responseStarted = false, attemptCount = 1 } = {}) {
  const previous = error?.providerError;
  const status = Number(error?.status ?? previous?.statusCode);
  const statusCode = Number.isInteger(status) && status >= 100 && status <= 599 ? status : null;
  let category = CATEGORIES.has(previous?.category) ? previous.category : "UNKNOWN";
  if (error?.name === "AbortError") category = "CANCELLED";
  else if (/Timeout/i.test(error?.name || "") || error?.code === "ETIMEDOUT") category = "TIMEOUT";
  else if (statusCode === 429) category = "RATE_LIMIT";
  else if (statusCode === 401 || statusCode === 403) category = "AUTH";
  else if (statusCode >= 500) category = "SERVER_ERROR";
  else if (error?.code === "ECONNRESET" || error?.code === "ENOTFOUND" || /Connection/i.test(error?.name || "")) category = "NETWORK";
  else if (/^(provider_.*budget_exceeded|.*request_budget_exceeded)$/.test(error?.message || "")) category = "BUDGET";
  else if (error?.name === "ProviderCapabilityUnsupportedError" || error?.code === "provider_unsupported") category = "UNSUPPORTED";
  else if (error?.code === "provider_invalid_response" || statusCode && statusCode >= 400) category = "INVALID_RESPONSE";
  const started = responseStarted || previous?.responseStarted === true;
  const code = error?.code ?? previous?.providerCode;
  const providerCode = PROVIDER_CODES.has(code) || Number.isSafeInteger(code) ? code : null;
  const safeToReplay = !started && (statusCode === 429 || [502, 503, 504].includes(statusCode));
  return { category, statusCode, providerCode, retryable: safeToReplay, safeToReplay, responseStarted: started,
    attemptCount: Number.isSafeInteger(error?.votcAttemptCount) ? error.votcAttemptCount : attemptCount,
    retryAfterMs: previous?.retryAfterMs ?? retryAfterMilliseconds(error),
    messageCode: `provider_${category.toLowerCase()}` };
}

function toProviderError(error, context = {}) {
  if (error?.message === SOURCE_GUARD_CODE || error?.votcPreflight === true) return error;
  const details = classifyProviderError(error, context);
  const safe = new Error(details.messageCode);
  safe.name = details.category === "CANCELLED" ? "AbortError" : details.category === "TIMEOUT" ? "TimeoutError" : "ProviderError";
  safe.code = details.messageCode; safe.status = details.statusCode; safe.votcAttemptCount = details.attemptCount;
  safe.providerError = details;
  return safe;
}

const safeProviderConsole = Object.fromEntries(["log", "info", "warn", "error"].map(level => [level, (...args) => {
  const error = args.find(value => value instanceof Error || value?.providerError);
  const event = error ? classifyProviderError(error) : { messageCode: "provider_event" };
  console[level]("[Provider]", event);
}]));

module.exports = { SOURCE_GUARD_CODE, classifyProviderError, retryAfterMilliseconds, toProviderError, safeProviderConsole };
