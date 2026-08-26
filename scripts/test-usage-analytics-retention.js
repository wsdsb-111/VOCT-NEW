"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const retentionPath = path.join(root, "resources", "app", "out", "main", "usage-analytics-retention.js");
const mainPath = path.join(root, "resources", "app", "out", "main", "main.js");
const rendererPath = path.join(root, "resources", "app", "out", "renderer", "assets", "index-Dn3qWlAB.js");
const { isUsageEntry, retainUsageAnalyticsEntries } = require(retentionPath);

assert.strictEqual(isUsageEntry({ isUsageRecord: true, totalTokens: 0 }), true, "a provider request with zero reported tokens must remain a usage record");
assert.strictEqual(isUsageEntry({ totalTokens: 1 }), true, "legacy token-bearing records must remain usage records");
assert.strictEqual(isUsageEntry({ requestType: "action_decision_trace", totalTokens: 0 }), false, "zero-token traces must be diagnostics");

const usageEntries = Array.from({ length: 2050 }, (_, index) => ({
  timestamp: `2026-08-24T00:${String(Math.floor(index / 60)).padStart(2, "0")}:${String(index % 60).padStart(2, "0")}.000Z`,
  requestType: "chat",
  totalTokens: index + 1,
  isUsageRecord: true,
  marker: `usage-${index}`
}));
const diagnosticEntries = Array.from({ length: 4000 }, (_, index) => ({
  timestamp: `2026-08-24T01:${String(Math.floor(index / 60)).padStart(2, "0")}:${String(index % 60).padStart(2, "0")}.000Z`,
  requestType: "action_decision_trace",
  totalTokens: 0,
  marker: `diagnostic-${index}`
}));
const retained = retainUsageAnalyticsEntries([...usageEntries, ...diagnosticEntries]);
const retainedUsage = retained.filter(isUsageEntry);
const retainedDiagnostics = retained.filter((entry) => !isUsageEntry(entry));

assert.strictEqual(retainedUsage.length, 2000, "diagnostics must never evict provider usage entries");
assert.strictEqual(retainedDiagnostics.length, 500, "diagnostics must use their own bounded retention budget");
assert(retainedUsage.some((entry) => entry.marker === "usage-50"), "the newest 2,000 usage records must remain");
assert(!retainedUsage.some((entry) => entry.marker === "usage-49"), "only the oldest usage records may be trimmed");
assert(retainedDiagnostics.some((entry) => entry.marker === "diagnostic-3500"), "the newest diagnostics must remain");
assert(!retainedDiagnostics.some((entry) => entry.marker === "diagnostic-3499"), "only the oldest diagnostics may be trimmed");

const mainSource = fs.readFileSync(mainPath, "utf8");
const analyticsSource = fs.readFileSync(path.join(root, "resources", "app", "out", "main", "analytics", "usage-analytics.js"), "utf8");
const rendererSource = fs.readFileSync(rendererPath, "utf8");
assert(mainSource.includes('require("./usage-analytics-retention")'), "main process must use the dedicated retention policy");
assert(analyticsSource.includes("data.version = 4"), "usage analytics must migrate to the split-retention schema");
assert(analyticsSource.includes("diagnostics = { total: 0, actionSkipped: 0, byType: {} }"), "reports must separate diagnostics from provider usage");
assert(rendererSource.includes("服务商总 Token"), "UI must label provider-reported total tokens explicitly");
assert(rendererSource.includes("API 请求"), "UI must exclude diagnostics from the request total label");
assert(rendererSource.includes("诊断记录"), "UI must display diagnostic volume separately");

console.log("VOTC usage analytics retention: PASS (provider usage is retained independently from diagnostic traces)");
