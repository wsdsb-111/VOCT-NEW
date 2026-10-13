"use strict";

function usageNumber(value) {
  if (value == null || typeof value === "string" && !value.trim()) return null;
  if (typeof value !== "number" && typeof value !== "string") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function hasOwn(object, key) {
  return !!object && Object.prototype.hasOwnProperty.call(object, key);
}

const GEMINI_METADATA_FIELDS = new Set([
  "promptTokenCount", "candidatesTokenCount", "totalTokenCount",
  "cachedContentTokenCount", "thoughtsTokenCount", "toolUsePromptTokenCount"
]);

function geminiAccountingStatus(input, output, reasoning, total) {
  if (total.value == null || total.source === "INVALID") return "UNKNOWN";
  const knownMinimum = [input, output, reasoning].reduce((sum, field) => field.value == null ? sum : sum + field.value, 0);
  if (total.value < knownMinimum) return "INCONSISTENT";
  if (input.value == null || output.value == null || input.source === "INVALID" || output.source === "INVALID") return "UNKNOWN";
  if (reasoning.source === "INVALID") return "UNKNOWN";
  if (reasoning.value == null) return "UNRECONCILED";
  return total.value === knownMinimum ? "RECONCILED" : "UNRECONCILED";
}

function readNumber(sources) {
  let present = false;
  for (const [object, key] of sources) {
    if (!hasOwn(object, key) || object[key] == null) continue;
    present = true;
    const value = usageNumber(object[key]);
    if (value != null) return { value, present: true, source: "PROVIDER_REPORTED" };
  }
  return { value: null, present, source: present ? "INVALID" : "NOT_REPORTED" };
}

function nested(sources, field) {
  const candidates = field === "cached_tokens"
    ? [["prompt_tokens_details", "cached_tokens"], ["promptTokenDetails", "cachedTokens"]]
    : [["completion_tokens_details", "reasoning_tokens"], ["completionTokenDetails", "reasoningTokens"]];
  for (const source of sources) {
    for (const [containerKey, valueKey] of candidates) {
      const object = source?.[containerKey];
      if (hasOwn(object, valueKey)) return [object, valueKey];
    }
  }
  return [null, field];
}

function usageShape(usage, providerType, source) {
  const provider = String(providerType || "").toLowerCase();
  if (provider === "gemini" || !provider && (hasOwn(usage, "usageMetadata") || hasOwn(usage, "usage_metadata") || hasOwn(usage, "usageMetadataInvalidFields"))) return "gemini_metadata";
  if (provider === "ollama" || ["prompt_eval_count", "eval_count", "promptEvalCount", "evalCount"].some(key => hasOwn(source, key))) return "ollama_native";
  if (provider === "zhipu" && (hasOwn(source, "prompt_tokens_details") || hasOwn(source, "completion_tokens_details"))) return "zhipu_nested";
  if (provider === "zhipu") return "zhipu_native";
  if (provider === "deepseek") return "deepseek";
  if (["openai", "openai-compatible", "openai_compatible", "openrouter", "player2"].includes(provider)) return "openai_compatible";
  return "provider_native";
}

function normalizeUsage(usage, options = {}) {
  const source = usage && typeof usage === "object" ? usage : null;
  const votcEstimated = source?.votc_estimated === true;
  const metadata = source?.usageMetadata || source?.usage_metadata || source;
  const sources = metadata === source ? [source] : [metadata, source];
  const provider = String(options.providerType || "").toLowerCase();
  const gemini = provider === "gemini" || !provider && (hasOwn(source, "usageMetadata") || hasOwn(source, "usage_metadata") || hasOwn(source, "usageMetadataInvalidFields"));
  const invalidGeminiFields = new Set(Array.isArray(source?.usageMetadataInvalidFields)
    ? source.usageMetadataInvalidFields.filter(key => GEMINI_METADATA_FIELDS.has(key))
    : []);
  const field = (keys, extras = [], geminiField = null) => {
    if (gemini && geminiField && invalidGeminiFields.has(geminiField)) return { value: null, present: true, source: "INVALID" };
    return readNumber([
      ...sources.flatMap(object => keys.map(key => [object, key])),
      ...extras
    ]);
  };

  const input = field(["prompt_tokens", "input_tokens", "promptTokenCount", "inputTokenCount", "prompt_eval_count", "promptEvalCount"], [], "promptTokenCount");
  const output = field(["completion_tokens", "output_tokens", "candidatesTokenCount", "candidates_token_count", "eval_count", "evalCount"], [], "candidatesTokenCount");
  const total = field(["total_tokens", "totalTokenCount", "total_token_count"], [], "totalTokenCount");
  const cached = field(["prompt_cache_hit_tokens", "cached_tokens", "cachedContentTokenCount", "cache_read_input_tokens"], [nested(sources, "cached_tokens")], "cachedContentTokenCount");
  const miss = field(["prompt_cache_miss_tokens", "cache_miss_tokens", "cache_creation_input_tokens"]);
  const reasoning = field(["reasoning_tokens", "thoughtsTokenCount", "reasoningTokenCount"], [nested(sources, "reasoning_tokens")], "thoughtsTokenCount");
  const toolUse = field(["toolUsePromptTokenCount"], [], "toolUsePromptTokenCount");
  const accountingStatus = gemini && !votcEstimated ? geminiAccountingStatus(input, output, reasoning, total) : "UNKNOWN";
  const inconsistentFields = [];

  if (!votcEstimated) {
    if (input.source === "INVALID") inconsistentFields.push("inputTokens");
    if (output.source === "INVALID") inconsistentFields.push("outputTokens");
    if (total.source === "INVALID") inconsistentFields.push("totalTokens");
    if (cached.source === "INVALID") inconsistentFields.push("cachedInputTokens");
    if (miss.source === "INVALID") inconsistentFields.push("cacheMissTokens");
    if (reasoning.source === "INVALID") inconsistentFields.push("reasoningTokens");
    if (gemini && toolUse.source === "INVALID") inconsistentFields.push("toolUsePromptTokens");
    if (input.value != null && cached.value != null && cached.value > input.value) inconsistentFields.push("cachedInputTokens");
    if (gemini ? accountingStatus === "INCONSISTENT"
      : input.value != null && output.value != null && total.value != null && total.value !== input.value + output.value) inconsistentFields.push("totalTokens");
  }

  const derivedCacheMiss = !votcEstimated && miss.source === "NOT_REPORTED" && input.value != null && cached.value != null && cached.value <= input.value
    ? input.value - cached.value
    : null;
  const cacheStatus = votcEstimated ? "NOT_REPORTED" : inconsistentFields.includes("cachedInputTokens")
    ? "INCONSISTENT"
    : cached.value == null ? "NOT_REPORTED" : cached.value === 0 ? "REPORTED_ZERO" : "REPORTED_POSITIVE";
  const usageFields = [input, output, total, cached, miss, reasoning];
  const hasReportedUsage = !votcEstimated && (usageFields.some(item => item.value != null) || gemini && toolUse.value != null);
  const terminalStatus = String(options.terminalStatus || "").toUpperCase();
  const noUsageStatus = ["ABORTED", "CANCELLED", "CANCELED", "FAILED", "ERROR", "PARTIAL", "UNKNOWN"].includes(terminalStatus) ? "UNKNOWN" : "NOT_REPORTED";
  const status = votcEstimated ? noUsageStatus : inconsistentFields.length
    ? "INCONSISTENT"
    : !hasReportedUsage ? noUsageStatus
      : usageFields.every(item => item.value != null) ? "REPORTED" : "PARTIAL";
  const fieldSources = {
    inputTokens: votcEstimated ? "NOT_REPORTED" : input.source,
    outputTokens: votcEstimated ? "NOT_REPORTED" : output.source,
    cachedInputTokens: votcEstimated ? "NOT_REPORTED" : cached.source,
    cacheMissTokens: votcEstimated ? "NOT_REPORTED" : miss.value != null ? miss.source : derivedCacheMiss != null ? "DERIVED" : miss.source,
    reasoningTokens: votcEstimated ? "NOT_REPORTED" : reasoning.source,
    totalTokens: votcEstimated ? "NOT_REPORTED" : total.source
  };
  if (gemini) fieldSources.toolUsePromptTokens = votcEstimated ? "NOT_REPORTED" : toolUse.source;
  const estimatedInputTokens = votcEstimated ? input.value : usageNumber(options.estimatedInputTokens);
  const explicitEstimatedOutput = votcEstimated ? output.value : usageNumber(options.estimatedOutputTokens);
  const estimatedOutputTokens = explicitEstimatedOutput != null
    ? explicitEstimatedOutput
    : !votcEstimated && typeof options.estimateTokens === "function" && typeof options.content === "string"
      ? usageNumber(options.estimateTokens(options.content))
      : null;
  const usedLocalEstimator = !votcEstimated && explicitEstimatedOutput == null && estimatedOutputTokens != null;
  const hasEstimated = estimatedInputTokens != null || estimatedOutputTokens != null;

  return {
    native: {
      inputTokens: votcEstimated ? null : input.value,
      outputTokens: votcEstimated ? null : output.value,
      cachedInputTokens: votcEstimated ? null : cached.value,
      cacheMissTokens: votcEstimated ? null : miss.value,
      reasoningTokens: votcEstimated ? null : reasoning.value,
      totalTokens: votcEstimated ? null : total.value
    },
    estimated: {
      inputTokens: estimatedInputTokens,
      outputTokens: estimatedOutputTokens,
      method: hasEstimated ? votcEstimated ? "votc_estimated" : usedLocalEstimator ? "local_estimator" : "caller" : null
    },
    provenance: {
      status,
      providerUsageShape: usageShape(source, options.providerType, metadata),
      cacheStatus,
      fieldSources,
      derived: { cacheMissTokens: derivedCacheMiss },
      inconsistentFields,
      ...(gemini ? {
        providerComponents: { toolUsePromptTokens: votcEstimated ? null : toolUse.value },
        accountingStatus
      } : {}),
      ...(votcEstimated ? { estimatedSource: "votc_estimated" } : {})
    }
  };
}

function normalizeProviderUsage(usage) {
  if (!usage || typeof usage !== "object") return usage;
  const normalized = normalizeUsage(usage.votc_estimated === true ? { ...usage, votc_estimated: false } : usage);
  const metadata = usage.usageMetadata || usage.usage_metadata;
  const inputPresent = ["prompt_tokens", "input_tokens", "promptTokenCount", "inputTokenCount", "prompt_eval_count", "promptEvalCount"]
    .some(key => hasOwn(usage, key)) || hasOwn(metadata, "promptTokenCount");
  const outputPresent = ["completion_tokens", "output_tokens", "candidatesTokenCount", "candidates_token_count", "eval_count", "evalCount"]
    .some(key => hasOwn(usage, key)) || hasOwn(metadata, "candidatesTokenCount");
  const totalPresent = ["total_tokens", "totalTokenCount", "total_token_count"].some(key => hasOwn(usage, key))
    || hasOwn(metadata, "totalTokenCount");
  const reportedMiss = normalized.native.cacheMissTokens;
  const flatMiss = reportedMiss ?? normalized.provenance.derived.cacheMissTokens;
  const completionReasoning = normalized.native.reasoningTokens;
  const explicitVisible = usageNumber(usage.visible_completion_tokens);
  const isGemini = normalized.provenance.providerUsageShape === "gemini_metadata";
  const visibleCompletion = isGemini && normalized.native.outputTokens != null ? normalized.native.outputTokens
    : explicitVisible ?? (normalized.native.outputTokens != null
      ? Math.max(0, normalized.native.outputTokens - (completionReasoning || 0)) : null);
  const result = {};
  if (inputPresent) result.prompt_tokens = normalized.native.inputTokens;
  if (outputPresent) result.completion_tokens = normalized.native.outputTokens;
  if (totalPresent) result.total_tokens = normalized.native.totalTokens;
  if (hasOwn(usage, "prompt_tokens_details")) {
    const cachedTokens = usageNumber(usage.prompt_tokens_details?.cached_tokens);
    result.prompt_tokens_details = usage.prompt_tokens_details && typeof usage.prompt_tokens_details === "object"
      ? { cached_tokens: cachedTokens }
      : usage.prompt_tokens_details;
  }
  if (hasOwn(usage, "completion_tokens_details")) {
    const reasoningTokens = usageNumber(usage.completion_tokens_details?.reasoning_tokens);
    result.completion_tokens_details = usage.completion_tokens_details && typeof usage.completion_tokens_details === "object"
      ? { reasoning_tokens: reasoningTokens }
      : usage.completion_tokens_details;
  }
  result.prompt_cache_hit_tokens = normalized.native.cachedInputTokens;
  result.prompt_cache_miss_tokens = flatMiss;
  result.cache_reporting_status = normalized.native.cachedInputTokens == null ? "not_reported" : "reported";
  if (normalized.native.reasoningTokens != null) result.reasoning_tokens = normalized.native.reasoningTokens;
  if (visibleCompletion != null) result.visible_completion_tokens = visibleCompletion;
  if (hasOwn(usage, "votc_estimated")) result.votc_estimated = usage.votc_estimated === true;
  return result;
}

module.exports = { normalizeProviderUsage, normalizeUsage, usageNumber };
