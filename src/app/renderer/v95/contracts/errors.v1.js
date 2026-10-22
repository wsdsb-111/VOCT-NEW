import { ERROR_CODES } from "./async-states.v1.js";

const allowedCodes = new Set(ERROR_CODES);
const legacyCodes = Object.freeze({
  stale: "STALE_CONTEXT",
  stale_context: "STALE_CONTEXT",
  campaign_changed: "CAMPAIGN_CHANGED",
  conversation_changed: "CONVERSATION_CHANGED",
  revision_conflict: "REVISION_CONFLICT",
  source_changed: "SOURCE_REVOKED",
  source_stale: "SOURCE_REVOKED",
  source_unavailable_or_stale: "SOURCE_REVOKED",
  pair_index_preview_stale: "REVISION_CONFLICT",
  pair_ledger_preview_stale: "REVISION_CONFLICT",
  source_revoked: "SOURCE_REVOKED",
  permission_denied: "PERMISSION_DENIED",
  automatic_access: "PERMISSION_DENIED",
  pair_memory_owner_not_in_current_campaign: "PERMISSION_DENIED",
  pair_memory_read_only: "PERMISSION_DENIED",
  provider_unavailable: "PROVIDER_UNAVAILABLE",
  request_cancelled: "REQUEST_CANCELLED",
  cancelled: "REQUEST_CANCELLED",
  effect_unknown: "EFFECT_UNKNOWN",
  ipc_unavailable: "IPC_UNAVAILABLE",
  validation_error: "VALIDATION_ERROR",
  state_invalid: "VALIDATION_ERROR",
  pair_index_request_invalid: "VALIDATION_ERROR",
  pair_memory_campaign_not_loaded: "CAMPAIGN_CHANGED",
  pair_memory_game_data_unavailable: "IPC_UNAVAILABLE"
});

export function normalizeErrorCode(error) {
  const candidates = [];
  if (typeof error === "string") candidates.push(error);
  else if (error && typeof error === "object") {
    for (const field of ["code", "errorCode", "message"]) {
      try {
        if (typeof error[field] === "string") candidates.push(error[field]);
      } catch (_ignored) {
        // Treat unreadable error properties as unknown.
      }
    }
  }

  for (const candidate of candidates) {
    if (allowedCodes.has(candidate)) return candidate;
    const mapped = legacyCodes[candidate.trim().toLowerCase()];
    if (mapped) return mapped;
  }
  return "UNKNOWN_ERROR";
}

export function createContractError(code) {
  const safeCode = allowedCodes.has(code) ? code : "UNKNOWN_ERROR";
  const error = new Error(safeCode);
  error.code = safeCode;
  return error;
}
