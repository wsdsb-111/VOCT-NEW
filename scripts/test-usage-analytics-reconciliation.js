"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const root = path.resolve(__dirname, "..");
const { reconcileUsageAnalytics } = require(path.join(root, "scripts", "reconcile-usage-analytics"));

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "votc-usage-reconcile-"));
const filePath = path.join(tempDir, "usage-analytics.json");
const start = "2026-08-23T14:00:00.000Z";
const end = "2026-08-23T17:00:00.000Z";
try {
  fs.writeFileSync(filePath, JSON.stringify({ version: 3, entries: [
    { timestamp: "2026-08-23T15:00:00.000Z", requestType: "chat", totalTokens: 200, isUsageRecord: true },
    { timestamp: "2026-08-23T15:01:00.000Z", requestType: "action_decision_trace", totalTokens: 0 }
  ] }), "utf8");
  const result = reconcileUsageAnalytics({ filePath, expectedTotalTokens: 1000, expectedRequests: 5, windowStart: start, windowEnd: end });
  assert.strictEqual(result.changed, true);
  assert.strictEqual(result.missingTokens, 800);
  assert.strictEqual(result.missingRequests, 4);
  assert(fs.existsSync(result.backupPath), "reconciliation must preserve the original analytics file");
  const saved = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const aggregate = saved.entries.find((entry) => entry.isReconciledAggregate);
  assert.strictEqual(aggregate.totalTokens, 800);
  assert.strictEqual(aggregate.requestCount, 4);
  assert.strictEqual(reconcileUsageAnalytics({ filePath, expectedTotalTokens: 1000, expectedRequests: 5, windowStart: start, windowEnd: end }).reason, "already_reconciled", "the same provider aggregate must not be imported twice");
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}

console.log("VOTC usage analytics reconciliation: PASS (provider aggregate is backed up, imported once, and labeled)");
