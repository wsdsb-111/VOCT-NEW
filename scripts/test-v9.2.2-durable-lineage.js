"use strict";

const assert = require("node:assert/strict");
const { DurableRequestTrace } = require("../src/app/main/analytics/durable-request-trace");

function testDefaultOff() {
  const trace = new DurableRequestTrace();
  assert.deepStrictEqual(trace.exportReport(), { version: 1, enabled: false, truncatedWindow: false,
    droppedCount: 0, attempts: [] });
  assert.equal(trace.beginRun({ campaignToken: "private-campaign" }), null);
  assert.equal(trace.hashValue("campaign", "private-campaign"), null);
}

function testSafeAttemptAndNativeUnknowns() {
  const trace = new DurableRequestTrace({ enabled: true });
  const run = trace.beginRun({ campaignToken: "campaign-private", finalizationId: "finalization-private" }, { origin: "finalization" });
  const attempt = trace.beginAttempt(run, { ownerId: 42, campaignToken: "campaign-private", finalizationId: "finalization-private",
    chunkIndex: 0, chunkTotal: 1, chunkPath: [0], fragmentCount: 2, sourceDigest: trace.hashValue("source_digest", "source-private") });
  assert.match(attempt.durableAttemptId, /^[0-9a-f-]{36}$/i);
  assert.equal(attempt.origin, "finalization");
  assert.equal(attempt.chunkIndex, 0);
  assert.deepStrictEqual(attempt.chunkPath, [0]);
  assert.equal(attempt.fragmentCount, 2);
  assert.match(attempt.sourceDigest, /^[0-9a-f]{64}$/);
  assert.equal(attempt.inputTokens, "UNKNOWN");
  assert.equal(attempt.requestedOutputTokens, "UNKNOWN");

  trace.record(attempt, { status: "PROVIDER_COMPLETED", inputTokens: null, hitTokens: "", missTokens: 0, outputTokens: 3,
    inputReported: true, hitReported: true, missReported: true, outputReported: true,
    requestedOutputTokens: 4096, effectiveOutputTokens: 2048, tokenEstimate: 500 });
  const [row] = trace.exportReport().attempts;
  assert.equal(row.inputTokens, "UNKNOWN", "null must not be normalized to a reported zero");
  assert.equal(row.hitTokens, "UNKNOWN", "empty strings must stay UNKNOWN");
  assert.equal(row.missTokens, 0, "native zero remains zero");
  assert.equal(row.outputTokens, 3);
  assert.equal(row.inputReported, false, "a reported flag requires a valid native number");
  assert.equal(row.hitReported, false);
  assert.equal(row.missReported, true);
  assert.equal(row.outputReported, true);
  assert.equal(row.requestedOutputTokens, 4096);
  assert.equal(row.effectiveOutputTokens, 2048);
  assert.equal(row.tokenEstimate, 500);
  const exported = JSON.stringify(trace.exportReport());
  for (const privateValue of ["campaign-private", "finalization-private", "source-private"]) {
    assert(!exported.includes(privateValue), `trace export must omit ${privateValue}`);
  }
}

function testHashScopingAndTransportRetry() {
  const trace = new DurableRequestTrace({ enabled: true });
  const otherWindow = new DurableRequestTrace({ enabled: true });
  const sameDomain = trace.hashValue("endpoint", "https://private.invalid");
  assert.match(sameDomain, /^[0-9a-f]{64}$/);
  assert.equal(trace.hashValue("endpoint", "https://private.invalid"), sameDomain);
  assert.notEqual(trace.hashValue("policy", "https://private.invalid"), sameDomain, "hashes must be domain-separated");
  assert.notEqual(otherWindow.hashValue("endpoint", "https://private.invalid"), sameDomain, "salt must be per window");

  const run = trace.beginRun({ campaignToken: "c" });
  const attempt = trace.beginAttempt(run, { ownerId: 2, campaignToken: "c", chunkIndex: 1, chunkTotal: 2,
    chunkPath: [1], fragmentCount: 1 });
  trace.record(attempt, { requestedOutputTokens: 4096, effectiveOutputTokens: 2048, tokenEstimate: 300 });
  const firstId = attempt.durableAttemptId;
  trace.beginTransportRetry(attempt, { providerAttemptCount: 2 });
  const report = trace.exportReport();
  assert.equal(report.attempts.length, 2);
  assert.equal(report.attempts[0].status, "RETRY_SCHEDULED");
  assert.notEqual(report.attempts[1].durableAttemptId, firstId);
  assert.equal(report.attempts[1].durableParentAttemptId, firstId);
  assert.equal(report.attempts[1].retryReason, "provider_retry");
  assert.equal(report.attempts[1].providerAttemptCount, 2);
  assert.equal(report.attempts[1].requestedOutputTokens, 4096);
  assert.equal(report.attempts[1].effectiveOutputTokens, 2048);
  assert.equal(report.attempts[1].tokenEstimate, 300);
}

function testBoundedWindowIsExplicit() {
  const trace = new DurableRequestTrace({ enabled: true, maxRecords: 1 });
  const run = trace.beginRun({ campaignToken: "c" });
  const first = trace.beginAttempt(run, { ownerId: 1, campaignToken: "c", chunkIndex: 0, chunkTotal: 2, chunkPath: [0], fragmentCount: 1 });
  assert(first);
  assert.equal(trace.beginAttempt(run, { ownerId: 1, campaignToken: "c", chunkIndex: 1, chunkTotal: 2, chunkPath: [1], fragmentCount: 1 }), null);
  assert.equal(trace.exportReport().droppedCount, 1);
  assert.equal(trace.exportReport().truncatedWindow, true);
  assert.equal(trace.exportReport().attempts.length, 1);

  const retry = trace.beginTransportRetry(first, { providerAttemptCount: 2 });
  assert.equal(retry, null, "full trace window must not fabricate a transport row");
  assert.equal(trace.exportReport().attempts[0].status, "RETRY_SCHEDULED");
  assert.equal(first.durableAttemptId, null, "uncaptured provider retries must be unjoinable");
  assert.equal(trace.exportReport().droppedCount, 2);
  assert.equal(trace.exportReport().truncatedWindow, true);
  assert.equal(trace.exportReport().attempts.length, 1);
}

testDefaultOff();
testSafeAttemptAndNativeUnknowns();
testHashScopingAndTransportRetry();
testBoundedWindowIsExplicit();
console.log("V9.2.2 Durable lineage recorder tests passed.");
