"use strict";

const { normalizeUsage, usageNumber } = require("./usage-normalization");

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

function responseMessage(response) {
  return response?.choices?.[0]?.message || response?.message || response?.candidates?.[0]?.content || null;
}

function responseContent(response) {
  if (typeof response?.content === "string") return response.content;
  const message = responseMessage(response);
  if (typeof message?.content === "string") return message.content;
  if (Array.isArray(message?.parts)) return message.parts.map(part => typeof part?.text === "string" ? part.text : "").join("");
  if (Array.isArray(message?.content)) return message.content.map(part => typeof part?.text === "string" ? part.text : "").join("");
  return "";
}

function responseToolCalls(response) {
  const message = responseMessage(response);
  if (Array.isArray(response?.tool_calls)) return response.tool_calls;
  if (Array.isArray(response?.toolCalls)) return response.toolCalls;
  if (Array.isArray(message?.tool_calls)) return message.tool_calls;
  if (message?.function_call && typeof message.function_call === "object") return [message.function_call];
  if (message?.functionCall && typeof message.functionCall === "object") return [message.functionCall];
  if (Array.isArray(message?.parts)) {
    const functionCalls = message.parts.filter(part => part?.functionCall).map(part => part.functionCall);
    if (functionCalls.length) return functionCalls;
  }
  return [];
}

function responseFinish(response) {
  const message = responseMessage(response);
  const candidates = [
    [response, "finish_reason"],
    [response, "finishReason"],
    [response?.choices?.[0], "finish_reason"],
    [response?.candidates?.[0], "finishReason"],
    [response, "done_reason"]
  ];
  let explicitNull = false;
  for (const [source, key] of candidates) {
    if (!source || !Object.prototype.hasOwnProperty.call(source, key)) continue;
    if (source[key] != null) return { raw: source[key], source: "provider" };
    explicitNull = true;
  }
  if (response?.refusal || message?.refusal) return { raw: "refusal", source: "provider_refusal" };
  return { raw: null, source: explicitNull ? "provider" : "missing" };
}

function normalizeTerminalStatus(status) {
  if (status == null) return null;
  const value = String(status).trim().toUpperCase().replace(/[\s-]+/g, "_");
  if (["COMPLETE", "COMPLETED", "FINISHED", "SUCCESS", "SUCCEEDED"].includes(value)) return "COMPLETE";
  if (["TRUNCATED", "LENGTH"].includes(value)) return "TRUNCATED";
  if (["FILTERED", "CONTENT_FILTER"].includes(value)) return "FILTERED";
  if (["REFUSAL", "REFUSED"].includes(value)) return "REFUSED";
  if (["TOOL_CALL", "TOOL_CALLS"].includes(value)) return "TOOL_CALLS";
  if (["CANCELLED", "CANCELED", "ABORTED"].includes(value)) return "CANCELLED";
  if (["FAILED", "FAILURE", "ERROR"].includes(value)) return "ERROR";
  if (["PARTIAL", "UNKNOWN"].includes(value)) return value;
  return "UNKNOWN";
}

function statusForFinish(normalized) {
  return ({
    STOP: "COMPLETE",
    LENGTH: "TRUNCATED",
    FILTERED: "FILTERED",
    TOOL_CALLS: "TOOL_CALLS",
    REFUSAL: "REFUSED",
    CANCELLED: "CANCELLED",
    ERROR: "ERROR"
  })[normalized] || "UNKNOWN";
}

function safeError(response) {
  return response?.error ? "PROVIDER_ERROR" : null;
}

function isAbortError(response) {
  const error = response?.error;
  const name = typeof error === "string" ? error : error?.name || error?.code || "";
  return typeof name === "string" && (/^AbortError(?::|$)/i.test(name) || name.toUpperCase() === "ABORT_ERR");
}

function isTypedResult(value) {
  return !!value && typeof value === "object"
    && typeof value.status === "string"
    && !!value.finish && typeof value.finish.normalized === "string"
    && !!value.usage?.native;
}

function normalizeProviderResult(response, options = {}) {
  if (isTypedResult(response)) return response;
  if (isTypedResult(response?.votc_result)) return response.votc_result;
  const finishSource = responseFinish(response);
  const finish = normalizeFinishReason(finishSource.raw, { providerType: options.providerType });
  const terminalStatus = normalizeTerminalStatus(options.terminalStatus);
  let status = statusForFinish(finish.normalized);
  if (terminalStatus != null) {
    status = terminalStatus === "COMPLETE"
      ? finish.normalized === "STOP" ? "COMPLETE" : finish.normalized === "UNKNOWN" ? "UNKNOWN" : statusForFinish(finish.normalized)
      : terminalStatus;
  }
  if (finishSource.source === "provider_refusal" || response?.refusal || responseMessage(response)?.refusal) status = "REFUSED";
  if (safeError(response)) status = isAbortError(response) ? "CANCELLED" : "ERROR";

  const content = responseContent(response);
  const rawUsage = response?.usage_debug?.raw_usage && typeof response.usage_debug.raw_usage === "object"
    ? response.usage_debug.raw_usage
    : response?.usage;
  const usage = normalizeUsage(rawUsage, {
    providerType: options.providerType,
    estimatedInputTokens: options.estimatedInputTokens,
    estimatedOutputTokens: options.estimatedOutputTokens,
    estimateTokens: options.estimateTokens,
    content,
    terminalStatus: status
  });
  const reportedReasoning = usage.native.reasoningTokens;
  const message = responseMessage(response);
  const hasReasoningField = typeof response?.reasoning === "string" && response.reasoning.length > 0
    || typeof response?.reasoning_content === "string" && response.reasoning_content.length > 0
    || typeof response?.reasoningContent === "string" && response.reasoningContent.length > 0
    || typeof message?.reasoning === "string" && message.reasoning.length > 0
    || typeof message?.reasoning_content === "string" && message.reasoning_content.length > 0
    || typeof message?.thinking === "string" && message.thinking.length > 0;
  const reasoning = {
    present: reportedReasoning != null || hasReasoningField,
    tokenCount: reportedReasoning,
    source: reportedReasoning != null ? "usage" : hasReasoningField ? "response" : "missing"
  };
  return {
    status,
    content,
    toolCalls: responseToolCalls(response),
    finish: { ...finish, source: finishSource.source },
    usage,
    reasoning,
    provider: options.providerType || response?.provider || null,
    model: options.model || response?.model || null,
    error: safeError(response)
  };
}

function toLegacyResult(response, normalized = normalizeProviderResult(response)) {
  if (!response || typeof response !== "object") return { content: typeof response === "string" ? response : "", votc_result: normalized };
  return { ...response, votc_result: normalized };
}

module.exports = { normalizeFinishReason, normalizeProviderResult, toLegacyResult };
