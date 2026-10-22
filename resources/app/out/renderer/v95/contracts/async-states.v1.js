export const ASYNC_STATES = Object.freeze(["idle", "loading", "refreshing", "ready", "empty", "error", "stale"]);
export const ERROR_CODES = Object.freeze([
  "STALE_CONTEXT", "CAMPAIGN_CHANGED", "CONVERSATION_CHANGED", "REVISION_CONFLICT",
  "SOURCE_REVOKED", "PERMISSION_DENIED", "PROVIDER_UNAVAILABLE", "REQUEST_CANCELLED",
  "EFFECT_UNKNOWN", "IPC_UNAVAILABLE", "VALIDATION_ERROR", "UNKNOWN_ERROR"
]);

export function normalizeAsyncState(state) {
  return ASYNC_STATES.includes(state) ? state : "stale";
}

export function errorTextKey(code) {
  return ERROR_CODES.includes(code) ? `errors.${code}` : "errors.UNKNOWN_ERROR";
}
