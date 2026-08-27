"use strict";

const SENSITIVE_DETAIL_KEYS = new Set(["text", "content", "message", "evidence"]);

function normalizeSkipReason(stage, reason) {
  const value = reason || "unknown";
  return value.includes(".") ? value : `${stage}.${value}`;
}

function inferSkipStage(reason) {
  if (["no_action_candidate"].includes(reason)) return "gate";
  if (["no_executed_action_event", "already_processed_action_text", "already_processed_action_event"].includes(reason)) return "event";
  if (["unresolved_action_semantics", "semantic_unresolved_no_module_match", "no_semantic_module_match"].includes(reason)) return "semantic";
  if (["unresolved_action_participants"].includes(reason)) return "binding";
  if (["no_available_action_for_trigger", "inactive_participant"].includes(reason)) return "availability";
  if (["empty_model_response", "output_token_limit_reached", "unparseable_model_response", "schema_validation_failed"].includes(reason)) return "invocation";
  return "execution";
}

function normalizeActionSkipReason(reason) {
  return normalizeSkipReason(inferSkipStage(reason), reason);
}

function record({ analytics, actionId = null, eventId = null, traceId = null, stage, outcome, details = {} }) {
  const safeDetails = Object.fromEntries(Object.entries(details).filter(([key, value]) => value != null && !SENSITIVE_DETAIL_KEYS.has(key)));
  const resolvedTraceId = traceId || `action:${eventId || "event"}:${actionId || "candidate"}`;
  const detailText = Object.entries(safeDetails).map(([key, value]) => `${key}=${value}`).join(" ");
  console.log(`[ActionTrace] trace=${resolvedTraceId} event=${eventId || "none"} stage=${stage} outcome=${outcome}${actionId ? ` action=${actionId}` : ""}${detailText ? ` ${detailText}` : ""}`);
  analytics?.record?.({
    requestType: "action_decision_trace",
    traceId: resolvedTraceId,
    eventId,
    actionId,
    stage,
    outcome,
    ...safeDetails
  }, null);
  return resolvedTraceId;
}

module.exports = { record, normalizeSkipReason, normalizeActionSkipReason, inferSkipStage };
