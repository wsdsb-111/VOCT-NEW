"use strict";

const DEFAULT_MAX_USAGE_ENTRIES = 2000;
const DEFAULT_MAX_DIAGNOSTIC_ENTRIES = 500;

function isUsageEntry(entry) {
  if (entry?.isUsageRecord === true) return true;
  return [entry?.promptTokens, entry?.completionTokens, entry?.totalTokens, entry?.estimatedPromptTokens].some((value) => Number(value) > 0) || entry?.cacheHitTokens != null || entry?.cacheMissTokens != null;
}

function retainUsageAnalyticsEntries(entries, {
  maxUsageEntries = DEFAULT_MAX_USAGE_ENTRIES,
  maxDiagnosticEntries = DEFAULT_MAX_DIAGNOSTIC_ENTRIES
} = {}) {
  const source = Array.isArray(entries) ? entries : [];
  const usageEntries = source.filter(isUsageEntry).slice(-maxUsageEntries);
  const diagnosticEntries = source.filter((entry) => !isUsageEntry(entry)).slice(-maxDiagnosticEntries);
  return [...usageEntries, ...diagnosticEntries].sort((left, right) => String(left?.timestamp || "").localeCompare(String(right?.timestamp || "")));
}

module.exports = {
  DEFAULT_MAX_USAGE_ENTRIES,
  DEFAULT_MAX_DIAGNOSTIC_ENTRIES,
  isUsageEntry,
  retainUsageAnalyticsEntries
};
