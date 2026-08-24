"use strict";

const fs = require("fs");
const path = require("path");
const { retainUsageAnalyticsEntries, isUsageEntry } = require("../resources/app/out/main/usage-analytics-retention");

function readArguments(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    if (!key?.startsWith("--")) continue;
    values[key.slice(2)] = argv[index + 1];
  }
  return values;
}

function parseRequiredNumber(value, name) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new Error(`${name}_must_be_a_non_negative_number`);
  return Math.floor(number);
}

function isWithinWindow(entry, startMs, endMs) {
  const timestamp = Date.parse(entry?.timestamp || "");
  return Number.isFinite(timestamp) && timestamp >= startMs && timestamp < endMs;
}

function reconcileUsageAnalytics({ filePath, expectedTotalTokens, expectedRequests, windowStart, windowEnd, source = "deepseek_console" }) {
  const startMs = Date.parse(windowStart);
  const endMs = Date.parse(windowEnd);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) throw new Error("invalid_reconciliation_window");
  const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const entries = Array.isArray(data?.entries) ? data.entries : [];
  const reconciliationId = `${source}:${windowStart}:${windowEnd}:${expectedTotalTokens}:${expectedRequests}`;
  if (entries.some((entry) => entry?.reconciliation?.id === reconciliationId)) {
    return { changed: false, reason: "already_reconciled", expectedTotalTokens, expectedRequests };
  }
  const localUsage = entries.filter((entry) => isUsageEntry(entry) && isWithinWindow(entry, startMs, endMs));
  const localTotalTokens = localUsage.reduce((sum, entry) => sum + (Number(entry.totalTokens) || 0), 0);
  const localRequests = localUsage.reduce((sum, entry) => sum + Math.max(1, Math.floor(Number(entry.requestCount) || 1)), 0);
  const missingTokens = expectedTotalTokens - localTotalTokens;
  const missingRequests = expectedRequests - localRequests;
  if (missingTokens < 0 || missingRequests < 0) throw new Error("provider_total_is_lower_than_local_analytics");
  if (missingTokens === 0 && missingRequests === 0) return { changed: false, reason: "already_complete", expectedTotalTokens, expectedRequests };
  const backupPath = `${filePath}.v7.6.1-token-reconciliation-backup`;
  if (!fs.existsSync(backupPath)) fs.copyFileSync(filePath, backupPath);
  entries.push({
    timestamp: new Date(endMs - 1).toISOString(),
    requestType: "provider_reconciliation",
    providerType: "deepseek",
    model: "deepseek-v4-flash",
    requestCount: missingRequests,
    estimatedPromptTokens: 0,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: missingTokens,
    isUsageRecord: true,
    isReconciledAggregate: true,
    cacheHitTokens: null,
    cacheMissTokens: null,
    blocks: [],
    reconciliation: {
      id: reconciliationId,
      source,
      windowStart,
      windowEnd,
      expectedTotalTokens,
      expectedRequests,
      localTotalTokens,
      localRequests
    }
  });
  data.version = 4;
  data.entries = retainUsageAnalyticsEntries(entries);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
  return { changed: true, backupPath, missingTokens, missingRequests, expectedTotalTokens, expectedRequests };
}

if (require.main === module) {
  const args = readArguments(process.argv.slice(2));
  const filePath = args.file || path.join(process.env.APPDATA || "", "VOTC", "votc_data", "usage-analytics.json");
  const result = reconcileUsageAnalytics({
    filePath,
    expectedTotalTokens: parseRequiredNumber(args["expected-total"], "expected_total"),
    expectedRequests: parseRequiredNumber(args["expected-requests"], "expected_requests"),
    windowStart: args["window-start"],
    windowEnd: args["window-end"]
  });
  console.log(JSON.stringify(result));
}

module.exports = { reconcileUsageAnalytics };
