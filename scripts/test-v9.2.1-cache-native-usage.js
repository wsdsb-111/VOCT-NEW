"use strict";

const assert = require("assert");
const crypto = require("crypto");
const path = require("path");

const root = path.resolve(__dirname, "..");
const { ZhipuProvider } = require(path.join(root, "resources", "app", "out", "main", "providers"));
const { buildEffectiveParametersFingerprint, attachProviderObservation } = require(path.join(root, "resources", "app", "out", "main", "analytics", "real-request-diff.js"));
const { buildCacheReport, parseEntries } = require("./v9.2.1-cache-report");
const hash = (value) => crypto.createHash("sha256").update(value, "utf8").digest("hex");
const from = "2026-10-12T00:00:00.000Z";
const to = "2026-10-13T00:00:00.000Z";

function usageEntry(overrides = {}) {
  return {
    timestamp: "2026-10-12T02:00:00.000Z",
    requestType: "chat",
    providerType: "zhipu",
    model: "glm-5.3-flash",
    layoutId: "v813",
    endpointFingerprint: "https://private.invalid/v1?token=ENDPOINT_SECRET",
    cacheCohort: "GLM-A",
    isUsageRecord: true,
    promptTokens: 1000,
    cacheHitTokens: 0,
    cacheMissTokens: 1000,
    cacheSamplePhase: "cold",
    realRequestDiff: {},
    characterId: 987654,
    conversationId: "CONVERSATION_SECRET",
    apiKey: "API_KEY_SECRET",
    error: "RAW_ERROR_SECRET",
    prompt: "PROMPT_SECRET",
    path: "C:/Users/private",
    ...overrides
  };
}

function testReportAggregation() {
  const entries = [
    usageEntry({ cacheHitTokens: 900, cacheMissTokens: 100, cacheSamplePhase: "warm", realRequestDiff: { stablePrefixUnchanged: true } }),
    usageEntry({ alignmentStatus: "provider_zero_despite_large_prefix", realRequestDiff: { sameEndpoint: true, sameEffectiveParameters: true, estimatedCommonPrefixTokens: 9000, stablePrefixUnchanged: false } }),
    usageEntry({ cacheHitTokens: null, cacheMissTokens: null, promptTokens: 100, realRequestDiff: {} }),
    usageEntry({ usageEstimated: true, cacheHitTokens: 999, cacheMissTokens: 1 }),
    usageEntry({ endpointFingerprint: "https://other.invalid/private", alignmentStatus: "provider_zero_despite_large_prefix", realRequestDiff: { sameEndpoint: false, sameEffectiveParameters: false } }),
    usageEntry({ cacheCohort: "GLM-B", cacheHitTokens: 50, cacheMissTokens: 50, promptTokens: 100 }),
    usageEntry({ cacheCohort: "GLM-C", cacheHitTokens: 40, cacheMissTokens: 50, promptTokens: 100 }),
    usageEntry({ requestType: "action_outcome", isUsageRecord: false, cacheHitTokens: null, cacheMissTokens: null })
  ];
  const report = buildCacheReport(entries, { source: "usage", population: "history", from, to });
  const groupA = report.groups.find((group) => group.cohortHash === hash("GLM-A") && group.endpointHash === hash("https://private.invalid/v1?token=ENDPOINT_SECRET"));
  const endpointSwitch = report.groups.find((group) => group.endpointHash === hash("https://other.invalid/private"));
  const groupB = report.groups.find((group) => group.cohortHash === hash("GLM-B"));
  const inconsistentMiss = report.groups.find((group) => group.cohortHash === hash("GLM-C"));

  assert.strictEqual(report.requestCount, 7, "estimated provider requests stay in coverage denominator");
  assert.strictEqual(report.estimatedUsageTokenRecordsExcluded, 1);
  assert.strictEqual(report.actionOutcomeExcluded, 1);
  assert.strictEqual(groupA.all.requestCount, 4);
  assert.deepStrictEqual(groupA.all.nativeHitStatus, { positive: 1, zero: 1, missing: 2 });
  assert.strictEqual(groupA.all.nativeReportingCoverage, 0.5);
  assert.strictEqual(groupA.all.weightedNativeHitRate, 900 / 2000);
  assert.strictEqual(groupA.all.missProvenance.promptMinusNativeHit, 2);
  assert.strictEqual(groupA.warm.weightedNativeHitRate, 0.9);
  assert.strictEqual(groupA.warmSampleStatus, "explicit_warm_samples");
  assert.strictEqual(groupA.all.sameEndpointZeroHitAnomalies, 1);
  assert.strictEqual(endpointSwitch.all.switches.endpoint, 1);
  assert.strictEqual(endpointSwitch.all.switchUnknown.responder, 1);
  assert.strictEqual(endpointSwitch.all.sameEndpointZeroHitAnomalies, null);
  assert.strictEqual(groupB.endpointHash, groupA.endpointHash, "cohorts remain separately bucketed on one endpoint");
  assert.strictEqual(groupB.warmSampleStatus, "unknown");
  assert.strictEqual(inconsistentMiss.all.weightedNativeHitRate, null, "inconsistent stored miss is excluded from weighted cache rates");
  assert.strictEqual(inconsistentMiss.all.missProvenance.storedUnknown, 1);
  assert.strictEqual(groupA.all.stablePrefix.unknown, 2);
  const exported = JSON.stringify(report);
  for (const secret of ["ENDPOINT_SECRET", "API_KEY_SECRET", "CONVERSATION_SECRET", "RAW_ERROR_SECRET", "PROMPT_SECRET", "C:/Users/private"]) {
    assert(!exported.includes(secret), `privacy export must omit ${secret}`);
  }

  const diagnosticLine = JSON.stringify({
    timestamp: "2026-10-12T03:00:00.000Z",
    provider: "zhipu",
    model: "glm-5.3-flash",
    requestType: "chat",
    rawUsage: { prompt_tokens: 100, prompt_tokens_details: { cached_tokens: 0 } },
    normalizedUsage: { prompt_tokens: 100, prompt_cache_hit_tokens: 0, prompt_cache_miss_tokens: 100, cache_reporting_status: "reported" },
    realRequestDiff: { promptProfile: { layoutId: "v813" }, endpointFingerprint: hash("endpoint-A"), stablePrefixUnchanged: null }
  });
  const estimatedDiagnosticLine = JSON.stringify({
    timestamp: "2026-10-12T04:00:00.000Z",
    provider: "zhipu",
    model: "glm-5.3-flash",
    requestType: "chat",
    rawUsage: null,
    normalizedUsage: { prompt_tokens: 100, prompt_cache_hit_tokens: 95, prompt_cache_miss_tokens: 5 },
    providerUsage: { reportingStatus: "not_reported" },
    realRequestDiff: { promptProfile: { layoutId: "v813" }, endpointFingerprint: hash("endpoint-A") }
  });
  const parsed = parseEntries(`${diagnosticLine}\n${estimatedDiagnosticLine}\ninvalid-json\n`, "diagnostics");
  const diagnosticReport = buildCacheReport(parsed.entries, { source: "diagnostics", population: "experiment", from, to });
  assert.strictEqual(parsed.invalidLines, 1);
  assert.strictEqual(diagnosticReport.requestCount, 2);
  assert.strictEqual(diagnosticReport.estimatedUsageTokenRecordsExcluded, 1);
  assert.deepStrictEqual(diagnosticReport.groups[0].all.nativeHitStatus, { positive: 0, zero: 1, missing: 1 });
  assert.strictEqual(diagnosticReport.groups[0].all.missProvenance.promptMinusNativeHit, 1);
}

async function testZhipuUsageAndFingerprint() {
  const provider = new ZhipuProvider();
  const zero = provider.normalizeUsage({ prompt_tokens: 100, prompt_tokens_details: { cached_tokens: 0 } });
  const positive = provider.normalizeUsage({ prompt_tokens: 100, prompt_cache_hit_tokens: 30, prompt_cache_miss_tokens: 70 });
  const missing = provider.normalizeUsage({ prompt_tokens: 100 });
  assert.strictEqual(zero.prompt_cache_hit_tokens, 0);
  assert.strictEqual(zero.cache_reporting_status, "reported");
  assert.strictEqual(positive.prompt_cache_hit_tokens, 30);
  assert.strictEqual(positive.cache_reporting_status, "reported");
  assert.strictEqual(missing.prompt_cache_hit_tokens, null);
  assert.strictEqual(missing.cache_reporting_status, "not_reported");

  const request = { model: "glm-5.3-flash", messages: [{ role: "user", content: "fixture" }], stream: true, max_tokens: 32 };
  const enabled = provider.buildDiagnosticRequest(request, { glmReasoningEffort: "low", glmClearThinking: true });
  const disabled = provider.buildDiagnosticRequest(request, { glmReasoningEffort: "low", glmClearThinking: false });
  assert.strictEqual(enabled.thinking.clear_thinking, true);
  assert.strictEqual(disabled.thinking.clear_thinking, false);
  assert.notStrictEqual(buildEffectiveParametersFingerprint(enabled), buildEffectiveParametersFingerprint(disabled));

  const stream = async function* () {
    yield { id: "fixture-stream", choices: [{ delta: { role: "assistant", content: "ok" }, finish_reason: null }] };
    yield { id: "fixture-stream", choices: [], usage: { prompt_tokens: 100, completion_tokens: 1, total_tokens: 101, prompt_tokens_details: { cached_tokens: 25 } } };
  };
  provider.createOpenAIClient = () => ({ chat: { completions: { create: async (outbound) => {
    assert.strictEqual(outbound.stream_options.include_usage, true);
    return stream();
  } } } });
  const iterator = provider.chatCompletion(request, { defaultModel: "glm-5.3-flash", glmReasoningEffort: "low", glmClearThinking: true })[Symbol.asyncIterator]();
  let completed;
  while (true) {
    const step = await iterator.next();
    if (step.done) { completed = step.value; break; }
  }
  assert.strictEqual(completed.usage.prompt_cache_hit_tokens, 25, "usage-only stream tail is retained and normalized");
  assert.strictEqual(completed.usage_debug.raw_usage.prompt_tokens_details.cached_tokens, 25);

  const observation = attachProviderObservation({
    sameEndpoint: false, sameEffectiveParameters: true, intervalMs: 1000, estimatedCommonPrefixTokens: 9000
  }, { prompt_cache_hit_tokens: 0, prompt_cache_miss_tokens: 10000 });
  assert.notStrictEqual(observation.alignmentStatus, "provider_zero_despite_large_prefix");
  assert.strictEqual(observation.highValueAnomaly, false);
}

async function main() {
  testReportAggregation();
  await testZhipuUsageAndFingerprint();
  console.log("V9.2.1 native cache usage checks passed");
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
