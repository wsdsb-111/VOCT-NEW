"use strict";

const { normalizeProviderUsage } = require("../providers/usage-normalization");

// Read-only projection: recover only uniquely matched provider evidence, never
// estimate hits or alter stored request totals/diagnostic history.
function reconcileCacheUsage(entries, diagnostics) {
  const candidates = new Map();
  const keyFor = (provider, model, type, prompt, completion) => JSON.stringify([provider, model, type, prompt, completion]);
  for (const record of diagnostics) {
    const usage = normalizeProviderUsage(record.rawUsage);
    if (usage?.prompt_cache_hit_tokens == null) continue;
    const key = keyFor(record.provider, record.model, record.requestType, usage.prompt_tokens, usage.completion_tokens);
    if (!candidates.has(key)) candidates.set(key, []);
    candidates.get(key).push({ record, usage });
  }
  const matches = entries.map(entry => {
    const key = keyFor(entry.providerType, entry.model, entry.requestType, entry.promptTokens, entry.completionTokens);
    return (candidates.get(key) || []).filter(({ record }) => Math.abs(Date.parse(record.timestamp) - Date.parse(entry.timestamp)) <= 1000);
  });
  const counts = new Map();
  for (const options of matches) for (const { record } of options) counts.set(record, (counts.get(record) || 0) + 1);
  return entries.map((entry, index) => {
    const options = matches[index];
    if (entry.cacheHitTokens != null || options.length !== 1 || counts.get(options[0].record) !== 1) return entry;
    const { usage } = options[0];
    return { ...entry, cacheHitTokens: usage.prompt_cache_hit_tokens, cacheMissTokens: usage.prompt_cache_miss_tokens, cacheEvidenceSource: "matched_raw_provider_usage" };
  });

}

module.exports = { reconcileCacheUsage };
