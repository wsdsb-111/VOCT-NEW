"use strict";

const assert = require("assert");
const childProcess = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const root = path.resolve(__dirname, "..");
const { createUsageAnalytics, projectDurableTrace, buildDurableComparisonKey } = require(path.join(root, "src", "app", "main", "analytics", "usage-analytics"));
const { buildDurableIncidentReport } = require(path.join(root, "scripts", "v9.2.2-durable-incident-report"));

const UUIDS = [
  "00000000-0000-4000-8000-000000000001",
  "00000000-0000-4000-8000-000000000002",
  "00000000-0000-4000-8000-000000000003",
  "00000000-0000-4000-8000-000000000004",
  "00000000-0000-4000-8000-000000000005",
  "00000000-0000-4000-8000-000000000006"
];
const HASHES = {
  ownerScopeHash: "a".repeat(64),
  campaignScopeHash: "b".repeat(64),
  endpointHash: "c".repeat(64),
  effectiveParameterHash: "d".repeat(64),
  policyHash: "e".repeat(64)
};

function makeMemoryFs() {
  const files = new Map();
  return {
    existsSync: (file) => files.has(file),
    readFileSync: (file) => files.get(file),
    mkdirSync: () => {},
    writeFileSync: (file, value) => files.set(file, value)
  };
}

function makeAnalytics() {
  const memoryFs = makeMemoryFs();
  const retention = {
    DEFAULT_MAX_USAGE_ENTRIES: 100,
    DEFAULT_MAX_DIAGNOSTIC_ENTRIES: 100,
    retainUsageAnalyticsEntries: (entries) => entries,
    isUsageEntry: (entry) => entry?.isUsageRecord === true
  };
  const UsageAnalytics = createUsageAnalytics({
    fs: memoryFs,
    dataDir: "memory:/analytics",
    analyticsFile: "memory:/analytics/usage.json",
    retention,
    createPromptFingerprint: (value) => String(value)
  });
  return { analytics: new UsageAnalytics(), memoryFs };
}

function trace(id, overrides = {}) {
  return {
    durableAttemptId: id,
    origin: "finalization",
    ...HASHES,
    inputReported: true,
    hitReported: true,
    missReported: true,
    outputReported: true,
    ...overrides
  };
}

function analyticsMetadata(id, durableTrace, blockFingerprint = "stable-a", extraTrace = {}) {
  return {
    requestType: "memory4_durable",
    providerType: "deepseek",
    model: "glm-4.5",
    durableTrace: { ...durableTrace, durableAttemptId: id, ...extraTrace },
    blocks: [{ id: "summary_dynamic", label: "private-label-canary", type: "summary", tokens: 20, fingerprint: blockFingerprint }]
  };
}

function record(analytics, metadata, usage = {}) {
  analytics.record(metadata, { prompt_tokens: 20, prompt_cache_hit_tokens: 5, prompt_cache_miss_tokens: 15, completion_tokens: 3, ...usage });
}

const scoped = (overrides = {}) => ({ ...HASHES, ...overrides });

assert.notStrictEqual(buildDurableComparisonKey({ requestType: "memory4_durable", providerType: "p", model: "m", durableTrace: scoped() }), null);
for (const field of Object.keys(HASHES)) {
  assert.notStrictEqual(
    buildDurableComparisonKey({ requestType: "memory4_durable", providerType: "p", model: "m", durableTrace: scoped() }),
    buildDurableComparisonKey({ requestType: "memory4_durable", providerType: "p", model: "m", durableTrace: scoped({ [field]: "f".repeat(64) }) }),
    `${field} must isolate the Durable comparison chain`
  );
}
assert.strictEqual(buildDurableComparisonKey({ requestType: "memory4_durable", providerType: "p", model: "m", durableTrace: { ...scoped(), ownerScopeHash: "" } }), null);
assert.strictEqual(buildDurableComparisonKey({ requestType: "memory4_durable", providerType: "p", model: "m", durableTrace: null }), null);

const projected = projectDurableTrace({
  ...trace(UUIDS[0]),
  ownerId: "owner-private-canary",
  campaignToken: "campaign-private-canary",
  durableRunId: "run-private-canary",
  endpoint: "https://private.invalid",
  rawUsage: { prompt_tokens: 20 }
});
assert.strictEqual(projected.durableAttemptId, UUIDS[0]);
assert.strictEqual(projected.inputReported, true);
assert(!JSON.stringify(projected).includes("private-canary"), "analytics projection must discard raw identities and payload fields");
assert.strictEqual(projectDurableTrace({ ...trace("not-a-uuid"), ownerScopeHash: "owner-private-canary" }).durableAttemptId, null);
assert.strictEqual(projectDurableTrace({ ...trace(UUIDS[0]), policyHash: "not-a-hash" }).policyHash, null);

const { analytics, memoryFs } = makeAnalytics();
record(analytics, analyticsMetadata(UUIDS[0], scoped(), "old-content"));
record(analytics, analyticsMetadata(UUIDS[1], scoped({ ownerScopeHash: "f".repeat(64) }), "other-owner"));
record(analytics, analyticsMetadata(UUIDS[2], scoped(), "new-content", {
  ownerId: "must-not-persist",
  campaignToken: "must-not-persist",
  durableRunId: "must-not-persist",
  rawUsage: { prompt_tokens: 999 }
}), { prompt_cache_miss_tokens: undefined });
const stored = JSON.parse(memoryFs.readFileSync("memory:/analytics/usage.json"));
assert.strictEqual(stored.entries.length, 3);
assert(!JSON.stringify(stored).includes("must-not-persist"), "only the nested safe trace projection may be persisted");
assert(!JSON.stringify(stored).includes("rawUsage"), "raw provider usage must never be copied into analytics");
assert.strictEqual(stored.entries[2].cacheMissTokens, 15, "normalization keeps its existing cache-miss value");
assert.strictEqual(stored.entries[2].durableTrace.missReported, false, "raw miss provenance remains distinct from normalization");
const usageReport = analytics.getReport();
const recentById = new Map(usageReport.recent.map((entry) => [entry.durableTrace?.durableAttemptId, entry]));
assert.strictEqual(recentById.get(UUIDS[1]).durableAttribution.exact_app_content_diff.status, "no_same_scope_predecessor");
assert.strictEqual(recentById.get(UUIDS[2]).durableAttribution.exact_app_content_diff.status, "changed");
assert.strictEqual(recentById.get(UUIDS[2]).durableAttribution.exact_app_content_diff.interveningScopeChange, true, "A to B to A remains explicitly marked");
assert.strictEqual(recentById.get(UUIDS[2]).durableAttribution.provider_native.status, "requires_trace_join");
assert.strictEqual(recentById.get(UUIDS[2]).durableAttribution.provider_native.cacheMissTokens, null, "normalized miss must not be mislabeled as native");
assert.strictEqual(usageReport.total.promptTokens, 60);
assert.strictEqual(usageReport.total.cacheHitTokens, 15);
assert.strictEqual(usageReport.total.cacheMissTokens, 45, "existing normalized totals remain unchanged");

const scopeUnknown = makeAnalytics().analytics;
record(scopeUnknown, analyticsMetadata(UUIDS[0], scoped(), "known-owner"));
record(scopeUnknown, analyticsMetadata(UUIDS[1], null, "missing-scope"));
const unknownScopeRecent = scopeUnknown.getReport().recent;
const unknownScopeEntry = unknownScopeRecent.find((entry) => entry.durableTrace?.durableAttemptId === UUIDS[1]);
assert.strictEqual(unknownScopeEntry.durableAttribution.exact_app_content_diff.status, "unattributable_cross_owner");
assert.strictEqual(unknownScopeEntry.durableAttribution.exact_app_content_diff.interveningScopeChange, null, "missing scope must stay unavailable, not proven cross-owner");

const traceData = {
  version: 1,
  enabled: true,
  droppedCount: 0,
  truncatedWindow: false,
  attempts: [
    { durableRunId: "10000000-0000-4000-8000-000000000001", durableAttemptId: UUIDS[0], durableParentAttemptId: null, origin: "finalization", providerSendStartedAt: "2026-10-12T00:00:00.000Z", providerAttemptCount: 1, ...scoped(), inputTokens: 20, inputReported: true, hitTokens: 5, hitReported: true, missTokens: 15, missReported: true, outputTokens: 3, outputReported: true, sourceDigest: "1".repeat(64) },
    { durableRunId: "10000000-0000-4000-8000-000000000001", durableAttemptId: UUIDS[1], durableParentAttemptId: null, origin: "recovery", providerSendStartedAt: "2026-10-12T00:00:01.000Z", providerAttemptCount: 1, ...scoped({ ownerScopeHash: "f".repeat(64) }), inputTokens: 0, inputReported: true, hitTokens: 0, hitReported: true, missTokens: "UNKNOWN", missReported: false, outputTokens: 1, outputReported: true },
    { durableRunId: "10000000-0000-4000-8000-000000000001", durableAttemptId: UUIDS[2], durableParentAttemptId: UUIDS[0], origin: "finalization", providerSendStartedAt: "2026-10-12T00:00:02.000Z", providerAttemptCount: 1, ...scoped(), inputTokens: 20, inputReported: true, hitTokens: 5, hitReported: true, missTokens: "UNKNOWN", missReported: false, outputTokens: 3, outputReported: true }
  ]
};
const incidentReport = buildDurableIncidentReport({
  usageData: stored,
  traceData,
  baselineData: {
    requestCount: 1,
    promptTokens: 20,
    cacheHitTokens: 5,
    cacheMissTokens: 15,
    outputTokens: 3,
    attempts: [{ promptTokens: 20, cacheHitTokens: 5, cacheMissTokens: 15, outputTokens: 3, origin: "UNKNOWN", parentAttemptId: "UNKNOWN", sourceMatches: [{ ownerScopeHash: "do-not-use-for-identity" }] }]
  }
});
const wrappedReport = buildDurableIncidentReport({ usageData: stored, traceData: { durableTrace: traceData } });
assert.strictEqual(wrappedReport.attempts.providerSends, 3, "wrapped performance exports must be accepted");
assert.deepStrictEqual(wrappedReport.attempts.providerSendCountCoverage, { observed: 3, lowerBound: 3, complete: true });
assert.deepStrictEqual(wrappedReport.attempts.providerAttemptCount, {
  knownSubtotal: 3, reportedRows: 3, unknownRows: 0, observed: 3, lowerBound: 3, complete: true
});
assert.strictEqual(wrappedReport.traceRetention.droppedCount, 0);
const truncatedReport = buildDurableIncidentReport({ usageData: stored, traceData: { ...traceData, droppedCount: 1, truncatedWindow: true } });
assert.strictEqual(truncatedReport.attempts.providerSends, 3, "cap coverage must not alter the observed count");
assert.deepStrictEqual(truncatedReport.attempts.providerSendCountCoverage, { observed: 3, lowerBound: 3, complete: false });
assert.strictEqual(truncatedReport.attempts.providerAttemptCount.lowerBound, 3);
assert.strictEqual(truncatedReport.attempts.providerAttemptCount.complete, false);
assert.strictEqual(truncatedReport.tree.status, "truncated");
assert.strictEqual(truncatedReport.tree.complete, false, "truncated trace exports cannot claim a complete tree");
const retentionUnknownReport = buildDurableIncidentReport({ usageData: stored, traceData: { version: 1, enabled: true, attempts: traceData.attempts } });
assert.strictEqual(retentionUnknownReport.traceRetention.droppedCount, "UNKNOWN");
assert.strictEqual(retentionUnknownReport.traceRetention.truncatedWindow, "UNKNOWN");
assert.strictEqual(retentionUnknownReport.attempts.providerSendCountCoverage.complete, false, "unknown retention cannot claim complete send coverage");
assert.strictEqual(retentionUnknownReport.tree.status, "retention_unknown");
assert.strictEqual(retentionUnknownReport.tree.complete, false, "unknown trace retention cannot claim completeness");
const unknownAttemptCountReport = buildDurableIncidentReport({ usageData: stored, traceData: {
  ...traceData,
  attempts: traceData.attempts.map((attempt, index) => index === 0 ? { ...attempt, providerAttemptCount: "UNKNOWN" } : attempt)
} });
assert.deepStrictEqual(unknownAttemptCountReport.attempts.providerAttemptCount, {
  knownSubtotal: 2, reportedRows: 2, unknownRows: 1, observed: 2, lowerBound: 2, complete: false
}, "unknown transport counts remain a known subtotal/lower bound");
assert.strictEqual(incidentReport.attempts.providerSends, 3);
assert.strictEqual(incidentReport.usageJoin.joinedRows, 3);
assert.strictEqual(incidentReport.attributionLayers.exact_app_content_diff.interveningScopeChangeProven, 1);
assert.strictEqual(incidentReport.tree.roots, 2);
assert.strictEqual(incidentReport.tree.childrenWithKnownParent, 1);
assert.strictEqual(incidentReport.tree.complete, true);
assert.strictEqual(incidentReport.tree.byRun.runGroups, 1);
assert.strictEqual(incidentReport.tree.byRun.completeRuns, 1);
assert.strictEqual(incidentReport.attributionLayers.provider_native.tokenMetrics.inputTokens.knownSubtotal, 40);
assert.strictEqual(incidentReport.attributionLayers.provider_native.tokenMetrics.inputTokens.unknownCount, 0, "native zero remains a reported zero");
assert.strictEqual(incidentReport.attributionLayers.provider_native.tokenMetrics.missTokens.knownSubtotal, 15);
assert.strictEqual(incidentReport.attributionLayers.provider_native.tokenMetrics.missTokens.unknownCount, 2);
assert.strictEqual(incidentReport.tokenCostProxy.total.inputTokens.knownSubtotal, 40);
assert.strictEqual(incidentReport.attributionLayers.provider_native.reconciliation.missTokens.normalizedOrDerivedUnknown, 2);
assert.strictEqual(incidentReport.historicalBaseline.origins.UNKNOWN, 1);
assert.strictEqual(incidentReport.historicalBaseline.parentUnknown, 1);
assert.strictEqual(incidentReport.historicalBaseline.sourceMatchCandidatesUsedForIdentity, false);
assert.strictEqual(incidentReport.tokenCostProxy.currency, null);
assert(incidentReport.hashMeaning.includes("does not prove provider cache use"));
assert(!JSON.stringify(incidentReport).includes("private-label-canary"));
assert(!JSON.stringify(incidentReport).includes("do-not-use-for-identity"));
assert(!JSON.stringify(incidentReport).includes(UUIDS[0]), "report must not expose attempt or run IDs");

const traceOnlyReport = buildDurableIncidentReport({ usageData: stored, traceData: {
  ...traceData,
  attempts: [...traceData.attempts,
    { durableRunId: "10000000-0000-4000-8000-000000000001", durableAttemptId: UUIDS[3], durableParentAttemptId: null,
      origin: "recovery", providerSendStartedAt: "2026-10-12T00:00:03.000Z", providerAttemptCount: 1,
      ownerScopeHash: "f".repeat(64), inputTokens: "UNKNOWN", inputReported: false, hitTokens: "UNKNOWN", hitReported: false,
      missTokens: "UNKNOWN", missReported: false, outputTokens: "UNKNOWN", outputReported: false },
    { durableRunId: "10000000-0000-4000-8000-000000000001", durableAttemptId: UUIDS[4], durableParentAttemptId: UUIDS[3],
      origin: "recovery", providerSendStartedAt: "2026-10-12T00:00:04.000Z", providerAttemptCount: 1,
      ownerScopeHash: "f".repeat(64), inputTokens: 7, inputReported: true, hitTokens: 2, hitReported: true,
      missTokens: 5, missReported: true, outputTokens: 1, outputReported: true }
  ]
} });
assert.strictEqual(traceOnlyReport.attributionLayers.provider_native.attempts, 5);
assert.strictEqual(traceOnlyReport.attributionLayers.provider_native.tokenMetrics.inputTokens.knownSubtotal, 47,
  "native usage captured only in trace still contributes to known token totals");
assert.strictEqual(traceOnlyReport.attributionLayers.provider_native.tokenMetrics.inputTokens.unknownCount, 1,
  "a sent retry parent without a Usage row remains an unknown native attempt");
assert.strictEqual(traceOnlyReport.attributionLayers.provider_native.byOrigin.recovery.tokenMetrics.inputTokens.knownSubtotal, 7);
assert.strictEqual(traceOnlyReport.attributionLayers.provider_native.byOrigin.recovery.tokenMetrics.inputTokens.unknownCount, 1);
assert.strictEqual(traceOnlyReport.tokenCostProxy.byOwnerScopeHash.find((entry) => entry.ownerScopeHash === "f".repeat(64)).tokenMetrics.inputTokens.knownSubtotal, 7);
assert.strictEqual(traceOnlyReport.tokenCostProxy.byOwnerScopeHash.find((entry) => entry.ownerScopeHash === "f".repeat(64)).tokenMetrics.inputTokens.unknownCount, 1);
assert.strictEqual(traceOnlyReport.usageJoin.joinedRows, 3, "Usage reconciliation remains limited to exact joins");
assert.strictEqual(traceOnlyReport.usageJoin.sendsWithoutUsageRow, 2);
assert.strictEqual(traceOnlyReport.attributionLayers.provider_native.reconciliation.inputTokens.matches,
  incidentReport.attributionLayers.provider_native.reconciliation.inputTokens.matches,
  "trace-only sends must not enter Usage reconciliation");

const duplicateTraceId = UUIDS[5];
const duplicateIdReport = buildDurableIncidentReport({ usageData: stored, traceData: {
  ...traceData,
  attempts: [...traceData.attempts,
    ...["2026-10-12T00:00:03.000Z", "2026-10-12T00:00:04.000Z"].map((providerSendStartedAt) => ({
      durableRunId: "10000000-0000-4000-8000-000000000001", durableAttemptId: duplicateTraceId, durableParentAttemptId: null,
      origin: "finalization", providerSendStartedAt, providerAttemptCount: 1, ownerScopeHash: "f".repeat(64),
      inputTokens: 900, inputReported: true, hitTokens: 800, hitReported: true,
      missTokens: 100, missReported: true, outputTokens: 90, outputReported: true
    }))
  ]
} });
assert.strictEqual(duplicateIdReport.attributionLayers.provider_native.tokenMetrics.inputTokens.knownSubtotal, 40,
  "duplicate attempt IDs must not produce fabricated native cost");
assert.strictEqual(duplicateIdReport.attributionLayers.provider_native.tokenMetrics.inputTokens.unknownCount, 1,
  "duplicate sent attempt IDs are represented as unknown native usage");
assert.strictEqual(duplicateIdReport.attributionLayers.provider_native.duplicateSentIdGroups, 1);
assert.strictEqual(duplicateIdReport.attempts.providerSendCountCoverage.complete, false,
  "duplicate sent IDs cannot claim complete send-count coverage");
assert.strictEqual(duplicateIdReport.attempts.providerAttemptCount.complete, false);
assert.strictEqual(duplicateIdReport.usageJoin.joinedRows, 3, "duplicate IDs remain excluded from exact Usage joins");

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "votc-durable-report-"));
try {
  const usagePath = path.join(tempDir, "usage.json");
  const tracePath = path.join(tempDir, "trace.json");
  fs.writeFileSync(usagePath, JSON.stringify(stored), "utf8");
  fs.writeFileSync(tracePath, JSON.stringify(traceData), "utf8");
  const cli = childProcess.spawnSync(process.execPath, [path.join(root, "scripts", "v9.2.2-durable-incident-report.js"), "--usage", usagePath, "--trace", tracePath], { encoding: "utf8" });
  assert.strictEqual(cli.status, 0, cli.stderr);
  assert.strictEqual(JSON.parse(cli.stdout).attempts.providerSends, 3);
  assert(!cli.stdout.includes(tempDir), "report output must not expose input paths");
  assert(!cli.stdout.includes("private-label-canary"), "report must not print prompt block labels");
  const noArgs = childProcess.spawnSync(process.execPath, [path.join(root, "scripts", "v9.2.2-durable-incident-report.js")], { encoding: "utf8" });
  assert.notStrictEqual(noArgs.status, 0, "CLI must require explicit source files");
  assert.strictEqual(noArgs.stderr.trim(), "durable_incident_report_usage: --usage FILE --trace FILE [--baseline FILE]");
  const malformedTracePath = path.join(tempDir, "malformed.json");
  fs.writeFileSync(malformedTracePath, "{\"secret-canary\": invalid", "utf8");
  const malformed = childProcess.spawnSync(process.execPath, [path.join(root, "scripts", "v9.2.2-durable-incident-report.js"), "--usage", usagePath, "--trace", malformedTracePath], { encoding: "utf8" });
  assert.strictEqual(malformed.stderr.trim(), "durable_incident_report_invalid_input");
  assert(!malformed.stderr.includes("secret-canary"), "JSON parse errors must not echo file content");
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}

const ambiguous = buildDurableIncidentReport({
  usageData: { entries: stored.entries.slice(0, 1) },
  traceData: { version: 1, enabled: true, attempts: [trace(UUIDS[0]), trace(UUIDS[0])] }
});
assert.strictEqual(ambiguous.usageJoin.duplicateTraceIdGroups, 1);
assert.strictEqual(ambiguous.usageJoin.joinedRows, 0, "duplicate UUIDs must fail closed instead of selecting one row");
assert.strictEqual(ambiguous.tree.complete, false);
assert.throws(() => buildDurableIncidentReport({ usageData: {}, traceData: { version: 1, enabled: false, attempts: [] } }), /entries array/);
assert.throws(() => buildDurableIncidentReport({ usageData: { entries: [] }, traceData: { version: 2, attempts: [] } }), /version 1/);

console.log("VOTC V9.2.2 Durable attribution: PASS (scope isolation, safe UUID joins, provenance and UNKNOWN handling)");
