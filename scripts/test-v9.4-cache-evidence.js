"use strict";

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const root = path.resolve(__dirname, "..");
const { normalizeUsage } = require(path.join(root, "src", "app", "main", "providers", "usage-normalization.js"));
const {
  fingerprintEffectiveParameters,
  projectCacheDiagnosticsV2,
  summarizeCacheDiagnosticsV2
} = require(path.join(root, "src", "app", "main", "analytics", "cache-usage-reconciliation.js"));
const { createProviderDiagnostics } = require(path.join(root, "src", "app", "main", "analytics", "provider-diagnostics.js"));

function hash16(value) {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex").slice(0, 16);
}

function makeDiff(overrides = {}) {
  return {
    version: "real_request_diff_v1",
    providerType: "openai-compatible",
    model: "fixture-model",
    requestType: "chat",
    endpointFingerprint: "a".repeat(64),
    effectiveParametersFingerprint: "b".repeat(64),
    comparisonStatus: "compared",
    sameEndpoint: true,
    sameEffectiveParameters: true,
    firstDifferentMessagePosition: 2,
    firstDifferentBlockId: "private-custom-block-id",
    estimatedCommonPrefixTokens: 800,
    actualStablePrefixTokens: 900,
    ...overrides
  };
}

function makeDiagnostic({ usage, provider = "openai-compatible", model = "fixture-model", stream = true, params = "b".repeat(64), route = "a".repeat(64), outcome = "COMPLETE", requestDiff = makeDiff(), times = {} } = {}) {
  const normalizedUsage = normalizeUsage(usage, { providerType: provider, terminalStatus: outcome, estimatedInputTokens: usage?.votc_estimated ? usage.prompt_tokens : undefined });
  return projectCacheDiagnosticsV2({
    requestKey: crypto.randomBytes(16).toString("hex"),
    providerType: provider,
    model,
    requestType: "chat",
    requestDiff: { ...requestDiff, endpointFingerprint: route, effectiveParametersFingerprint: params },
    normalizedUsage,
    requestMeta: {
      stream,
      plan: { layoutId: "v813", layoutRevision: "v9_4_compat_1", stablePrefixCandidateTokens: 900 },
      messageSpans: [{ start: 0, end: 20, blockId: "private-custom-block-id", contributions: [{ messagePosition: 2, partIndex: 0, startOffset: 0, endOffset: 8 }] }],
      blocks: [{ id: "private-custom-block-id", semanticClass: "DYNAMIC_WORLDLINE", lifecycle: "DYNAMIC", tokens: { estimated: 30 }, fingerprint: "sensitive-content-fingerprint" }]
    },
    startedAt: times.startedAt || "2026-10-21T10:00:00.000Z",
    firstReasoningAt: times.firstReasoningAt || null,
    firstVisibleAt: times.firstVisibleAt || null,
    completedAt: times.completedAt || "2026-10-21T10:00:01.000Z",
    outcome
  });
}

async function main() {
  const reportedZero = makeDiagnostic({ usage: { prompt_tokens: 120, prompt_cache_hit_tokens: 0, prompt_cache_miss_tokens: 120 } });
  assert.deepStrictEqual(reportedZero.provider.cacheHit, { value: 0, source: "PROVIDER_REPORTED_ZERO" }, "native zero must remain distinct from a missing field");
  assert.deepStrictEqual(reportedZero.provider.cacheMiss, { value: 120, source: "PROVIDER_REPORTED" });
  assert.deepStrictEqual(reportedZero.provider.nativeCacheBreakPosition, { value: null, source: "UNKNOWN" }, "native hit totals do not reveal the server breakpoint");
  assert.strictEqual(reportedZero.local.firstChangedBlockId, hash16("private-custom-block-id"), "the first changed block is a local hashed identifier");
  assert.strictEqual(reportedZero.local.firstChangedBlockKind, "DYNAMIC_WORLDLINE");
  assert.strictEqual(reportedZero.local.firstChangedMessagePosition, 2);
  assert.deepStrictEqual(reportedZero.local.firstChangedBlockFingerprintHashes, [hash16("sensitive-content-fingerprint")]);

  const reportedZeroMiss = makeDiagnostic({ usage: { prompt_tokens: 120, prompt_cache_hit_tokens: 120, prompt_cache_miss_tokens: 0 } });
  assert.deepStrictEqual(reportedZeroMiss.provider.cacheMiss, { value: 0, source: "PROVIDER_REPORTED_ZERO" }, "native miss zero must remain distinct from DERIVED zero");

  const missing = makeDiagnostic({ usage: { prompt_tokens: 120 } });
  assert.deepStrictEqual(missing.provider.cacheHit, { value: null, source: "NOT_REPORTED" });
  assert.deepStrictEqual(missing.provider.cacheMiss, { value: null, source: "NOT_REPORTED" });

  const invalid = makeDiagnostic({ usage: { prompt_tokens: 120, prompt_cache_hit_tokens: "not-a-number", prompt_cache_miss_tokens: -1 } });
  assert.deepStrictEqual(invalid.provider.cacheHit, { value: null, source: "INVALID" });
  assert.deepStrictEqual(invalid.provider.cacheMiss, { value: null, source: "INVALID" });

  const inconsistent = makeDiagnostic({ usage: { prompt_tokens: 100, prompt_cache_hit_tokens: 120, prompt_cache_miss_tokens: 0 } });
  assert.deepStrictEqual(inconsistent.provider.cacheHit, { value: null, source: "INCONSISTENT" }, "cached greater than native input remains inconsistent, not a valid cache hit");

  const derivedMiss = makeDiagnostic({ usage: { prompt_tokens: 200, prompt_cache_hit_tokens: 50 } });
  assert.deepStrictEqual(derivedMiss.provider.cacheMiss, { value: 150, source: "DERIVED" });
  assert.deepStrictEqual(derivedMiss.provider.derivedCacheMissTokens, { value: 150, source: "DERIVED" });

  const estimated = makeDiagnostic({ usage: { prompt_tokens: 120, completion_tokens: 8, votc_estimated: true } });
  assert.deepStrictEqual(estimated.provider.inputTokens, { value: null, source: "NOT_REPORTED" }, "local estimated input must not be relabeled as provider usage");
  assert.strictEqual(estimated.local.estimatedInputTokens, 120);
  assert.strictEqual(estimated.provider.cacheHit.source, "NOT_REPORTED");

  const unknownBaseline = makeDiagnostic({ requestDiff: makeDiff({ comparisonStatus: "cold_local_baseline", firstDifferentMessagePosition: null, firstDifferentBlockId: null, estimatedCommonPrefixTokens: null }) });
  assert.deepStrictEqual(unknownBaseline.local.changeReasons, ["NO_COMPARABLE_PREVIOUS_REQUEST"]);
  assert.strictEqual(unknownBaseline.local.firstChangedBlockId, null);

  const insertionOrderA = makeDiagnostic({ usage: { prompt_tokens: 100, prompt_cache_hit_tokens: 40, prompt_cache_miss_tokens: 60 } });
  const insertionOrderB = makeDiagnostic({ usage: { prompt_cache_miss_tokens: 60, prompt_cache_hit_tokens: 40, prompt_tokens: 100 } });
  assert.deepStrictEqual(insertionOrderA.provider, insertionOrderB.provider, "usage field insertion order cannot change classification");

  const sameGroupZero = makeDiagnostic({ usage: { prompt_tokens: 100, prompt_cache_hit_tokens: 0, prompt_cache_miss_tokens: 100 }, times: {
    startedAt: "2026-10-21T10:00:00.000Z", firstReasoningAt: "2026-10-21T10:00:00.100Z", firstVisibleAt: "2026-10-21T10:00:00.200Z"
  } });
  const sameGroupPositive = makeDiagnostic({ usage: { prompt_tokens: 100, prompt_cache_hit_tokens: 50 }, times: {
    startedAt: "2026-10-21T10:01:00.000Z", firstReasoningAt: "2026-10-21T10:01:00.300Z", firstVisibleAt: "2026-10-21T10:01:00.500Z"
  } });
  const sameGroupMissing = makeDiagnostic({ usage: { prompt_tokens: 100, completion_tokens: 10 } });
  const sameGroupInvalid = makeDiagnostic({ usage: { prompt_tokens: 100, prompt_cache_hit_tokens: "bad" } });
  const failed = makeDiagnostic({ usage: { prompt_tokens: 100, prompt_cache_hit_tokens: 90, prompt_cache_miss_tokens: 10 }, outcome: "FAILED" });
  const cancelled = makeDiagnostic({ usage: { prompt_tokens: 100, prompt_cache_hit_tokens: 90, prompt_cache_miss_tokens: 10 }, outcome: "CANCELLED" });
  const alternateStream = makeDiagnostic({ usage: { prompt_tokens: 100, prompt_cache_hit_tokens: 20 }, stream: false });
  const alternateParameters = makeDiagnostic({ usage: { prompt_tokens: 100, prompt_cache_hit_tokens: 20 }, params: "c".repeat(64) });
  const alternateEndpoint = makeDiagnostic({ usage: { prompt_tokens: 100, prompt_cache_hit_tokens: 20 }, route: "d".repeat(64) });
  const alternateProvider = makeDiagnostic({ usage: { prompt_tokens: 100, prompt_cache_hit_tokens: 20 }, provider: "deepseek", requestDiff: makeDiff({ providerType: "deepseek" }) });
  const alternateModel = makeDiagnostic({ usage: { prompt_tokens: 100, prompt_cache_hit_tokens: 20 }, model: "other-model" });
  const summary = summarizeCacheDiagnosticsV2([
    sameGroupZero, sameGroupPositive, sameGroupMissing, sameGroupInvalid, failed, cancelled,
    alternateStream, alternateParameters, alternateEndpoint, alternateProvider, alternateModel
  ]);
  assert.strictEqual(summary.sampleCount, 11);
  const mainGroup = summary.groups.find((group) => group.groupKey === sameGroupZero.grouping.groupKey);
  assert(mainGroup, "same provider/model/route/stream/effective parameters share a group");
  assert.strictEqual(mainGroup.weightedHitRate, 0.25, "weighted rate is sum(native cached) / sum(native input)");
  assert.strictEqual(mainGroup.hitRateIncludedRequests, 2);
  assert.strictEqual(mainGroup.unknownRequests, 2, "missing and invalid native hits are excluded and counted as unknown");
  assert.strictEqual(mainGroup.providerReportedZeroRequests, 1);
  assert.strictEqual(mainGroup.missingUsageRequests, 1);
  assert.strictEqual(mainGroup.invalidUsageRequests, 1);
  assert.strictEqual(mainGroup.inconsistentUsageRequests, 0);
  assert.strictEqual(mainGroup.failedRequests, 1);
  assert.strictEqual(mainGroup.cancelledRequests, 1);
  assert.strictEqual(mainGroup.excludedRequests, 4);
  assert.strictEqual(mainGroup.derivedMissRequests, 1, "derived miss is separately counted without replacing native input denominator");
  assert.strictEqual(mainGroup.averageReasoningTTFTMs, 200);
  assert.strictEqual(mainGroup.averageVisibleTTFTMs, 350);
  assert.notStrictEqual(sameGroupZero.grouping.groupKey, alternateStream.grouping.groupKey, "streaming and non-streaming routes are separate");
  assert.notStrictEqual(sameGroupZero.grouping.groupKey, alternateParameters.grouping.groupKey, "effective parameter variants are separate");
  assert.notStrictEqual(sameGroupZero.grouping.groupKey, alternateEndpoint.grouping.groupKey, "endpoint route variants are separate without exposing the URL");
  assert.notStrictEqual(sameGroupZero.grouping.groupKey, alternateProvider.grouping.groupKey, "provider variants are never mixed");
  assert.notStrictEqual(sameGroupZero.grouping.groupKey, alternateModel.grouping.groupKey, "model variants are never mixed");

  const multipleContributors = projectCacheDiagnosticsV2({
    providerType: "openai-compatible",
    model: "fixture-model",
    requestType: "chat",
    requestDiff: makeDiff(),
    normalizedUsage: normalizeUsage({ prompt_tokens: 10, prompt_cache_hit_tokens: 0 }, { providerType: "openai-compatible" }),
    requestMeta: { messageSpans: [
      { blockId: "static-part", contributions: [{ messagePosition: 2, partIndex: 0 }] },
      { blockId: "dynamic-part", contributions: [{ messagePosition: 2, partIndex: 1 }] }
    ], blocks: [
      { id: "static-part", semanticClass: "GLOBAL_STATIC", lifecycle: "STATIC" },
      { id: "dynamic-part", semanticClass: "DYNAMIC_WORLDLINE", lifecycle: "DYNAMIC" }
    ] },
    outcome: "COMPLETE"
  });
  assert.strictEqual(multipleContributors.local.firstChangedBlockId, null, "a multi-block physical message must not be misattributed to one block");
  assert.strictEqual(multipleContributors.local.firstChangedBlockKind, "MULTIPLE");
  assert.strictEqual(multipleContributors.local.firstChangedBlockIdHashes.length, 2);

  const ineligiblePrefix = projectCacheDiagnosticsV2({
    providerType: "openai-compatible",
    model: "fixture-model",
    requestType: "chat",
    requestDiff: makeDiff(),
    normalizedUsage: normalizeUsage({ prompt_tokens: 10, prompt_cache_hit_tokens: 0 }, { providerType: "openai-compatible" }),
    requestMeta: {
      messageSpans: [{ blockId: "stable-but-ineligible", start: 0, end: 1, contributions: [{ messagePosition: 0 }] }],
      blocks: [{ id: "stable-but-ineligible", lifecycle: "STATIC", tokens: { estimated: 100 }, cache: { prefixEligible: false } }]
    },
    outcome: "COMPLETE"
  });
  assert.strictEqual(ineligiblePrefix.local.stablePrefixCandidateTokens, null, "semantic stability cannot override an explicit prefix-ineligible declaration");

  const projected = JSON.stringify(projectCacheDiagnosticsV2({
    providerType: "openai-compatible",
    model: "fixture-model",
    requestType: "chat",
    requestDiff: { ...makeDiff(), messages: [{ content: "private prompt body" }], responderId: "private-responder" },
    normalizedUsage: normalizeUsage({ prompt_tokens: 5, prompt_cache_hit_tokens: 0 }, { providerType: "openai-compatible" }),
    requestMeta: { stream: true, plan: { layoutId: "v813", layoutRevision: "fixture-secret-revision" }, messageSpans: [{ blockId: "private-custom-block-id", contributions: [{ messagePosition: 2 }] }], blocks: [{ id: "private-custom-block-id", semanticClass: "CUSTOM_LEGACY", fingerprint: "fixture-sensitive-fingerprint" }] },
    startedAt: "2026-10-21T10:00:00.000Z",
    outcome: "COMPLETE"
  }));
  for (const secret of ["private prompt body", "private-responder", "fixture-secret-revision", "api_key", "fixture-key", "?token="]) {
    assert(!projected.includes(secret), `anonymous V2 projection must omit ${secret}`);
  }
  assert(projected.includes(`"layoutRevisionKey":"${hash16("fixture-secret-revision")}"`), "layout revision is retained only as a hash");
  assert(!projected.includes("fixture-sensitive-fingerprint"), "block fingerprints are hashed before leaving local request metadata");
  const fallbackProjection = projectCacheDiagnosticsV2({
    providerType: "openai-compatible",
    model: "fixture-model",
    requestType: "chat",
    requestDiff: makeDiff(),
    normalizedUsage: normalizeUsage({ prompt_tokens: 5, prompt_cache_hit_tokens: 0 }, { providerType: "openai-compatible" }),
    requestMeta: { plan: { evidenceStatus: "LEGACY_OBSERVED", ownerEvidence: "UNKNOWN", fallbackReason: "CUSTOM_LEGACY_MESSAGE_UNREPRESENTABLE" } },
    outcome: "COMPLETE"
  });
  assert.strictEqual(fallbackProjection.plan.fallbackReason, "CUSTOM_LEGACY_MESSAGE_UNREPRESENTABLE");
  assert.strictEqual(fallbackProjection.plan.evidenceStatus, "LEGACY_OBSERVED", "fallback diagnostics cannot promote Plan authority");
  const unknownFallbackProjection = projectCacheDiagnosticsV2({
    providerType: "openai-compatible", model: "fixture-model", requestType: "chat", requestDiff: makeDiff(),
    normalizedUsage: normalizeUsage({ prompt_tokens: 5 }),
    requestMeta: { plan: { fallbackReason: "untrusted-private-value" } }, outcome: "COMPLETE"
  });
  assert.strictEqual(unknownFallbackProjection.plan.fallbackReason, null, "fallback reason is a fixed whitelist field");

  const tempRoot = path.resolve(os.tmpdir());
  const tempDir = fs.mkdtempSync(path.join(tempRoot, "votc-cache-v2-"));
  try {
    const { createProviderDiagnostics } = require(path.join(root, "src", "app", "main", "analytics", "provider-diagnostics.js"));
    const ProviderDiagnostics = createProviderDiagnostics({
      fs,
      path,
      dataDir: tempDir,
      diagnosticsFile: path.join(tempDir, "provider-diagnostics.jsonl"),
      settingsRepository: {
        getActiveProviderConfig: () => ({ providerType: "openai-compatible", defaultModel: "fixture-model", apiKey: "fixture-key", baseUrl: "https://example.invalid/v1?access_token=query-secret" }),
        getChatPromptV89Settings: () => ({ chatPromptV89OutboundDiagnostics: true }),
        getPromptSettings: () => ({ blocks: [] })
      },
      providerRegistry: {},
      TokenCounter: { estimateTokens: () => 1, estimateMessageTokens: () => 1, calculateTotalTokens: () => 1 }
    });
    const service = new ProviderDiagnostics();
    const blocks = [
      { id: "static-rule-block", messageStartPosition: 0, messageCount: 1, stable: true, semanticClass: "GLOBAL_STATIC", lifecycle: "STATIC", tokens: { estimated: 100 } },
      { id: "private-live-block", messageStartPosition: 1, messageCount: 1, stable: false, semanticClass: "DYNAMIC_WORLDLINE", lifecycle: "DYNAMIC", tokens: { estimated: 30 }, fingerprint: "live-content-fingerprint" }
    ];
    const buildRequest = (userText) => ({ model: "fixture-model", stream: true, temperature: 0.4, messages: [
      { role: "system", content: "private prompt body" }, { role: "user", content: userText }
    ] });
    const base = { provider: "openai-compatible", model: "fixture-model", requestType: "chat", blocks, conversationId: "private-conversation", responderId: "private-responder", baseUrl: "https://example.invalid/v1?access_token=query-secret" };
    service.prepareOutboundRequest({ ...base, request: buildRequest("first private turn") });
    const currentDiff = service.prepareOutboundRequest({
      ...base,
      request: buildRequest("second private turn"),
      cacheDiagnosticContext: {
        plan: { layoutId: "v813", layoutRevision: "v9_4_compat_1" },
        messageSpans: [
          { blockId: "static-rule-block", start: 0, end: 1, contributions: [{ messagePosition: 0, partIndex: 0, startOffset: 0, endOffset: 20 }] },
          { blockId: "private-live-block", start: 1, end: 2, contributions: [{ messagePosition: 1, partIndex: 0, startOffset: 0, endOffset: 12 }] }
        ]
      }
    });
    const originalV1Diff = JSON.stringify(currentDiff);
    const finalPayload = {
      model: "adapter-final-model",
      messages: [{ role: "system", content: "private adapter prompt" }],
      stream: false,
      temperature: 0.25,
      max_tokens: 500
    };
    const finalSnapshot = {
      schemaVersion: 1,
      requestType: "chat",
      providerType: "openai-compatible",
      protocol: "openai_chat_completions",
      planStatus: "PROMPT_PLAN_V9",
      ownerEvidence: "PRESENT",
      stream: false,
      endpoint: { display: "https://example.invalid/v1/chat?api_key=adapter-secret", fingerprint: "d".repeat(64) },
      effectiveRequestFingerprint: "e".repeat(64),
      payload: finalPayload
    };
    const observerToken = service.createCacheDiagnosticsObserver({
      provider: "openai-compatible", model: "fixture-model", requestType: "chat", requestDiff: currentDiff
    });
    const finalBudget = {
      effectiveRequestFingerprint: "e".repeat(64), estimatedInputTokens: 200, reservedOutputTokens: 500,
      protocolOverheadTokens: 48, safetyMarginTokens: 256, effectiveInputBudget: 7000,
      contextWindow: 8192, maxOutputTokens: 1024, pressureRatio: 0.2, safe: true, budgetStatus: "INPUT_AVAILABLE"
    };
    assert.strictEqual(service.attachEffectiveRequest(observerToken, finalSnapshot, finalBudget), true);
    assert.strictEqual(JSON.stringify(currentDiff), originalV1Diff, "adapter-final metadata must not mutate the V1 diff object");
    service.recordResponse({
      provider: "openai-compatible",
      model: "fixture-model",
      requestType: "chat",
      response: { usage: { prompt_tokens: 100, prompt_cache_hit_tokens: 20 } },
      usage: { prompt_tokens: 100, prompt_cache_hit_tokens: 20, prompt_cache_miss_tokens: 80 },
      metadata: { realRequestDiff: currentDiff, cacheDiagnosticsObserverToken: observerToken, generationStatus: "COMPLETE" },
      startedAt: "2026-10-21T10:00:00.000Z",
      firstReasoningAt: "2026-10-21T10:00:00.050Z",
      firstVisibleContentAt: "2026-10-21T10:00:00.100Z",
      completedAt: "2026-10-21T10:00:01.000Z"
    });
    const stored = service.getRecent(1)[0];
    assert.strictEqual(stored.cacheDiagnosticsV2.schemaVersion, "cache_diagnostics_v2");
    assert.strictEqual(stored.cacheDiagnosticsV2.provider.cacheMiss.source, "DERIVED", "V2 reads raw usage instead of the flattened derived miss");
    assert.strictEqual(stored.cacheDiagnosticsV2.provider.nativeCacheBreakPosition.source, "UNKNOWN");
    assert.strictEqual(stored.cacheDiagnosticsV2.local.firstChangedBlockKind, "DYNAMIC_WORLDLINE");
    assert.strictEqual(stored.cacheDiagnosticsV2.local.firstChangedBlockId, hash16("private-live-block"));
    assert.strictEqual(stored.cacheDiagnosticsV2.local.stablePrefixCandidateTokens, 100, "candidate counts contiguous stable metadata and stops before dynamic block");
    assert.deepStrictEqual(stored.cacheDiagnosticsV2.local.firstChangedBlockFingerprintHashes, [hash16("live-content-fingerprint")]);
    assert.strictEqual(stored.cacheDiagnosticsV2.route.routeKey, "d".repeat(64), "final adapter endpoint fingerprint replaces only V2 route grouping");
    assert.strictEqual(stored.cacheDiagnosticsV2.route.protocol, "openai_chat_completions");
    assert.strictEqual(stored.cacheDiagnosticsV2.route.modelId, "adapter-final-model");
    assert.strictEqual(stored.cacheDiagnosticsV2.grouping.stream, false, "adapter-final stream mode replaces the early V2 hint");
    assert.strictEqual(stored.cacheDiagnosticsV2.grouping.effectiveParametersKey, fingerprintEffectiveParameters("openai_chat_completions", finalPayload));
    assert.strictEqual(stored.cacheDiagnosticsV2.plan.evidenceStatus, "PLAN_OBSERVED", "only a final guarded snapshot can attest the plan status");
    assert.strictEqual(stored.cacheDiagnosticsV2.plan.ownerEvidence, "VERIFIED", "only final snapshot evidence can mark the prompt-plan owner verified");
    assert.deepStrictEqual(stored.cacheDiagnosticsV2.effectiveRequest, {
      source: "ADAPTER_FINAL",
      fingerprint: "e".repeat(64),
      endpointFingerprint: "d".repeat(64),
      protocol: "openai_chat_completions",
      stream: false,
      payloadParametersFingerprint: fingerprintEffectiveParameters("openai_chat_completions", finalPayload),
      budget: {
        estimatedInputTokens: 200, reservedOutputTokens: 500, protocolOverheadTokens: 48,
        safetyMarginTokens: 256, effectiveInputBudget: 7000, contextWindow: 8192,
        maxOutputTokens: 1024, pressureRatio: 0.2, safe: true, budgetStatus: "INPUT_AVAILABLE"
      }
    });
    assert.strictEqual(stored.realRequestDiff.endpointFingerprint, currentDiff.endpointFingerprint, "V1 endpoint fingerprint and semantics remain untouched");
    assert.strictEqual(stored.realRequestDiff.effectiveParametersFingerprint, currentDiff.effectiveParametersFingerprint, "V1 parameter fingerprint and semantics remain untouched");

    const summaryToken = service.createCacheDiagnosticsObserver({
      provider: "openai-compatible", model: "fixture-model", requestType: "summary", cacheDiagnosticContext: {}
    });
    assert.strictEqual(service.attachEffectiveRequest(summaryToken, {
      schemaVersion: 1,
      requestType: "summary",
      providerType: "openai-compatible",
      protocol: "openai_chat_completions",
      stream: false,
      endpoint: { display: "https://example.invalid/v1/chat?api_key=summary-secret", fingerprint: "f".repeat(64) },
      effectiveRequestFingerprint: "1".repeat(64),
      payload: { model: "fixture-model", messages: [{ role: "system", content: "private summary prompt" }], temperature: 0.1, max_tokens: 256 }
    }, {
      estimatedInputTokens: 100, reservedOutputTokens: 256, protocolOverheadTokens: 40,
      safetyMarginTokens: 256, effectiveInputBudget: 7000, pressureRatio: 0.1, safe: true
    }), true, "an observer token supports non-chat request types without a V1 diff");
    service.recordResponse({
      provider: "openai-compatible", model: "fixture-model", requestType: "summary",
      response: { usage: { prompt_tokens: 90, prompt_cache_hit_tokens: 20, prompt_cache_miss_tokens: 70 } },
      metadata: { cacheDiagnosticsObserverToken: summaryToken, generationStatus: "COMPLETE" },
      startedAt: "2026-10-21T10:02:00.000Z", completedAt: "2026-10-21T10:02:01.000Z"
    });
    const summaryEntry = service.getRecent(1)[0];
    assert.strictEqual(summaryEntry.realRequestDiff, null, "non-chat V2 observations do not invent a V1 chat diff");
    assert.strictEqual(summaryEntry.cacheDiagnosticsV2.route.requestType, "summary");
    assert.strictEqual(summaryEntry.cacheDiagnosticsV2.plan.evidenceStatus, "LEGACY_OBSERVED");
    assert.strictEqual(summaryEntry.cacheDiagnosticsV2.plan.ownerEvidence, "UNKNOWN");
    assert.strictEqual(summaryEntry.cacheDiagnosticsV2.local.comparisonStatus, "legacy_observed");
    assert.strictEqual(summaryEntry.cacheDiagnosticsV2.local.stablePrefixCandidateTokens, null, "legacy/no-span context must not claim a stable prefix candidate");
    assert.strictEqual(summaryEntry.cacheDiagnosticsV2.effectiveRequest.budget.estimatedInputTokens, 100);
    assert.strictEqual(summaryEntry.cacheDiagnosticsV2.outcome, "COMPLETE");

    const fallbackToken = service.createCacheDiagnosticsObserver({
      provider: "openai-compatible", model: "fixture-model", requestType: "letter",
      cacheDiagnosticContext: {
        fallbackReason: "CUSTOM_LEGACY_MESSAGE_UNREPRESENTABLE",
        plan: { layoutId: "v813", layoutRevision: "fallback-revision", evidenceStatus: "LEGACY_OBSERVED" }
      }
    });
    assert.strictEqual(service.attachEffectiveRequest(fallbackToken, {
      schemaVersion: 1, requestType: "letter", providerType: "openai-compatible", protocol: "openai_chat_completions",
      planStatus: "LEGACY_OBSERVED", ownerEvidence: "UNKNOWN", stream: false,
      endpoint: { display: "https://example.invalid/v1/chat", fingerprint: "2".repeat(64) },
      effectiveRequestFingerprint: "3".repeat(64),
      payload: { model: "fixture-model", messages: [{ role: "user", content: "private letter prompt" }], max_tokens: 128 }
    }, { estimatedInputTokens: 20, reservedOutputTokens: 128, safe: true }), true);
    service.recordResponse({
      provider: "openai-compatible", model: "fixture-model", requestType: "letter",
      response: { usage: { prompt_tokens: 20, completion_tokens: 4 } },
      metadata: { cacheDiagnosticsObserverToken: fallbackToken, generationStatus: "COMPLETE" },
      startedAt: "2026-10-21T10:02:30.000Z", completedAt: "2026-10-21T10:02:31.000Z"
    });
    const fallbackEntry = service.getRecent(1)[0];
    assert.strictEqual(fallbackEntry.cacheDiagnosticsV2.plan.fallbackReason, "CUSTOM_LEGACY_MESSAGE_UNREPRESENTABLE");
    assert.strictEqual(fallbackEntry.cacheDiagnosticsV2.plan.evidenceStatus, "LEGACY_OBSERVED");
    assert.strictEqual(fallbackEntry.cacheDiagnosticsV2.plan.ownerEvidence, "UNKNOWN");
    assert.strictEqual(fallbackEntry.realRequestDiff, null, "legacy fallback does not create a V1 Chat diff");

    const zhipuToken = service.createCacheDiagnosticsObserver({
      provider: "zhipu", model: "glm-fixture", requestType: "action"
    });
    assert.strictEqual(service.attachEffectiveRequest(zhipuToken, {
      schemaVersion: 1, requestType: "action", providerType: "zhipu", protocol: "openai_chat_completions",
      planStatus: "LEGACY_OBSERVED", ownerEvidence: "UNKNOWN", stream: false,
      endpoint: { display: "https://example.invalid/v4/chat/completions", fingerprint: "4".repeat(64) },
      effectiveRequestFingerprint: "5".repeat(64),
      payload: { model: "glm-fixture", messages: [{ role: "user", content: "private action prompt" }], max_tokens: 128 }
    }, { estimatedInputTokens: 20, reservedOutputTokens: 128, safe: true }), true);
    service.recordResponse({
      provider: "zhipu", model: "glm-fixture", requestType: "action",
      response: {
        usage: { prompt_tokens: 0, completion_tokens: 0 },
        usage_debug: {
          raw_usage: { prompt_tokens: 0, completion_tokens: 0, prompt_tokens_details: { cached_tokens: 0 } },
          native_usage_evidence: {
            prompt_tokens: { present: true, value: "zhipu-raw-invalid-value-secret" },
            completion_tokens: { present: true, value: 0 },
            prompt_tokens_details: { cached_tokens: { present: true, value: null } }
          }
        }
      },
      usage: { prompt_tokens: 0, completion_tokens: 0 },
      metadata: { cacheDiagnosticsObserverToken: zhipuToken, generationStatus: "COMPLETE" },
      startedAt: "2026-10-21T10:02:40.000Z", completedAt: "2026-10-21T10:02:41.000Z"
    });
    const zhipuEntry = service.getRecent(1)[0];
    assert.deepStrictEqual(zhipuEntry.cacheDiagnosticsV2.provider.inputTokens, { value: null, source: "INVALID" }, "V2 must prefer the native evidence envelope over Zhipu's legacy zero-filled raw_usage");
    assert.deepStrictEqual(zhipuEntry.cacheDiagnosticsV2.provider.cacheHit, { value: null, source: "INVALID" }, "explicit native null must not become a reported zero");
    assert.deepStrictEqual(zhipuEntry.cacheDiagnosticsV2.provider.outputTokens, { value: 0, source: "PROVIDER_REPORTED_ZERO" }, "an explicitly reported Zhipu zero remains zero");

    const status = service.getRealRequestDiffStatus(10);
    assert.strictEqual(status.entries.length, 1, "the legacy V1 request list remains Chat-only");
    assert.strictEqual(status.summary.requests, 1, "the existing V1 summary remains Chat-only");
    const statusV2Types = status.cacheDiagnosticsV2.entries.map((entry) => entry.route.requestType);
    assert.deepStrictEqual(new Set(statusV2Types), new Set(["chat", "summary", "letter", "action"]), "the V2 status dataset includes observer-only request types");
    assert.strictEqual(status.cacheDiagnosticsV2.summary.sampleCount, 4);
    const rendererSource = fs.readFileSync(path.join(root, "src", "app", "renderer", "assets", "index-Dn3qWlAB.js"), "utf8");
    for (const uiEvidence of ["cacheV2Entries.slice(0, 30).map(renderCacheV2Entry)", "entry.provider?.inputTokens", "entry.provider?.outputTokens", "entry.provider?.derivedCacheMissTokens", "entry.plan?.fallbackReason", "entry.plan?.ownerEvidence", "entry.effectiveRequest?.source"]) {
      assert(rendererSource.includes(uiEvidence), `Cache V2 UI must render ${uiEvidence}`);
    }

    const rejectedToken = service.createCacheDiagnosticsObserver({
      provider: "openai-compatible", model: "fixture-model", requestType: "action",
      cacheDiagnosticContext: {
        plan: { layoutId: "v813", layoutRevision: "untrusted-revision", evidenceStatus: "PLAN_OBSERVED", ownerEvidence: "VERIFIED" },
        messageSpans: [{ blockId: "untrusted-block", contributions: [{ messagePosition: 0 }] }],
        blockMetadata: [{ id: "untrusted-block", lifecycle: "STATIC", tokens: { estimated: 100 } }]
      }
    });
    service.recordResponse({
      provider: "openai-compatible", model: "fixture-model", requestType: "action",
      response: null,
      metadata: { cacheDiagnosticsObserverToken: rejectedToken, generationStatus: "FAILED" },
      startedAt: "2026-10-21T10:03:00.000Z", completedAt: "2026-10-21T10:03:00.010Z"
    });
    const rejectedEntry = service.getRecent(1)[0];
    assert.strictEqual(rejectedEntry.cacheDiagnosticsV2, null, "a pre-transport guard failure has no final request and cannot create a V2 outbound record");
    assert.strictEqual(rejectedEntry.realRequestDiff, null, "non-chat guard failure must not be labeled as a V1 chat diff");

    const persisted = fs.readFileSync(path.join(tempDir, "provider-diagnostics.jsonl"), "utf8");
    for (const secret of ["private prompt body", "private adapter prompt", "private summary prompt", "first private turn", "second private turn", "fixture-key", "query-secret", "adapter-secret", "summary-secret"]) {
      assert(!persisted.includes(secret), `persisted diagnostics must omit ${secret}`);
    }
    assert(!JSON.stringify(stored.cacheDiagnosticsV2).includes("private-responder"), "V2 whitelist projection must omit responder IDs");
    const exportResult = service.exportCacheDiagnosticsV2(10);
    assert.strictEqual(exportResult.success, true);
    const exported = JSON.parse(fs.readFileSync(exportResult.path, "utf8"));
    assert.strictEqual(exported.schemaVersion, "cache_diagnostics_v2");
    assert.strictEqual(exported.entries.length, 4);
    assert.strictEqual(exported.entries.find((entry) => entry.route.requestType === "chat").provider.cacheMiss.source, "DERIVED");
    assert(exported.entries.some((entry) => entry.route.requestType === "summary"), "V2 export includes observer-only non-chat requests");
    const exportJson = JSON.stringify(exported);
    for (const secret of ["fixture-key", "query-secret", "adapter-secret", "summary-secret", "fallback-revision", "private prompt body", "private adapter prompt", "private summary prompt", "private letter prompt", "private action prompt", "first private turn", "second private turn", "private-responder", "zhipu-raw-invalid-value-secret"]) {
      assert(!exportJson.includes(secret), `anonymous export must not contain ${secret}`);
    }
  } finally {
    const resolvedTempDir = path.resolve(tempDir);
    if (resolvedTempDir.startsWith(`${tempRoot}${path.sep}`)) fs.rmSync(resolvedTempDir, { recursive: true, force: true });
  }

  console.log("V9.4 cache diagnostics V2 evidence: PASS (native/derived/unknown separation, grouping, privacy, failure exclusion, TTFT)");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
