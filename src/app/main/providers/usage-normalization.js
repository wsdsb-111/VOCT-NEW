"use strict";

function usageNumber(value) {
  if (value == null || typeof value === "string" && !value.trim()) return null;
  if (typeof value !== "number" && typeof value !== "string") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function normalizeProviderUsage(usage) {
  if (!usage || typeof usage !== "object") return usage;
  const prompt = usageNumber(usage.prompt_tokens);
  const completion = usageNumber(usage.completion_tokens);
  const hit = usageNumber(usage.prompt_cache_hit_tokens) ?? usageNumber(usage.prompt_tokens_details?.cached_tokens);
  const miss = usageNumber(usage.prompt_cache_miss_tokens) ?? (hit != null && prompt != null ? Math.max(0, prompt - hit) : null);
  const reasoning = usageNumber(usage.reasoning_tokens) ?? usageNumber(usage.completion_tokens_details?.reasoning_tokens);
  return {
    ...usage,
    prompt_cache_hit_tokens: hit,
    prompt_cache_miss_tokens: miss,
    cache_reporting_status: hit == null ? "not_reported" : "reported",
    ...(reasoning != null ? { reasoning_tokens: reasoning } : {}),
    ...(completion != null ? { visible_completion_tokens: usageNumber(usage.visible_completion_tokens) ?? Math.max(0, completion - (reasoning || 0)) } : {})
  };
}

module.exports = { normalizeProviderUsage, usageNumber };
