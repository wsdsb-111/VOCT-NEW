"use strict";
// Frozen from 3721b925; historical parity fixture, never a Runtime dependency.
function normalizeFinishReason(raw, options = {}) {
  const value = typeof raw === "string" ? raw.trim().toLowerCase().replace(/[\s-]+/g, "_") : "";
  const providerType = String(options.providerType || "").toLowerCase();
  let normalized = "UNKNOWN";
  if (["stop", "end_turn", "end_of_turn", "stop_sequence", "completed", "complete"].includes(value)) normalized = "STOP";
  else if (["length", "max_tokens", "max_output_tokens", "max_output", "max_tokens_reached"].includes(value)) normalized = "LENGTH";
  else if (["content_filter", "safety", "recitation", "blocked", "filtered"].includes(value)) normalized = "FILTERED";
  else if (["tool_calls", "tool_call", "function_call", "tool_use"].includes(value)) normalized = "TOOL_CALLS";
  else if (["refusal", "refused"].includes(value)) normalized = "REFUSAL";
  else if (["cancelled", "canceled", "abort", "aborted", "abort_error", "aborterror"].includes(value) || /^aborterror(?:_|:|$)/.test(value)) normalized = "CANCELLED";
  else if (["error", "failed", "failure"].includes(value)) normalized = "ERROR";
  else if (providerType === "gemini" && value === "max_tokens") normalized = "LENGTH";
  const safeRaw = typeof raw === "string" ? raw.slice(0, 100) : typeof raw === "number" ? raw : null;
  return { raw: safeRaw, normalized };
}

module.exports = { normalizeFinishReason };
