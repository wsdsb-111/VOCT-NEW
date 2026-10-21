"use strict";

const crypto = require("crypto");
const { normalizeProviderUsage } = require("../providers/usage-normalization");

const CACHE_DIAGNOSTICS_V2_VERSION = "cache_diagnostics_v2";
const CACHE_DIAGNOSTIC_BLOCK_KINDS = new Set([
  "GLOBAL_STATIC",
  "CONVERSATION_FROZEN",
  "RESPONDER_FROZEN",
  "APPEND_ONLY_HISTORY",
  "DYNAMIC_WORLDLINE",
  "QUERY_DYNAMIC_MEMORY",
  "CURRENT_TURN",
  "CUSTOM_LEGACY"
]);
const CACHE_DIAGNOSTIC_LIFECYCLES = new Set(["STATIC", "FROZEN", "APPEND_ONLY", "DYNAMIC"]);
const CACHE_DIAGNOSTIC_LAYOUTS = new Set(["v5", "v6", "v7", "v813", "deepseek_v89", "glm_cache_v2"]);
const CACHE_DIAGNOSTIC_FALLBACK_REASONS = new Set(["CUSTOM_LEGACY_MESSAGE_UNREPRESENTABLE"]);
const CACHE_DIAGNOSTIC_PLAN_EVIDENCE = new Set(["PLAN_OBSERVED", "LEGACY_OBSERVED", "UNKNOWN"]);
const CACHE_DIAGNOSTIC_OWNER_EVIDENCE = new Set(["VERIFIED", "UNKNOWN", "NOT_REQUIRED"]);
const EFFECTIVE_PARAMETER_FIELDS = Object.freeze({
  openai_chat_completions: ["temperature", "max_tokens", "top_p", "presence_penalty", "frequency_penalty", "response_format", "reasoning", "reasoning_effort", "thinking", "stream_options"],
  ollama_api_chat: ["options"],
  gemini_generate_content: ["generationConfig"]
});

function nonNegativeNumber(value) {
  if (value === null || value === void 0 || typeof value !== "number" && typeof value !== "string" || typeof value === "string" && !value.trim()) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function hashDiagnosticId(value) {
  if (value === null || value === void 0 || value === "") return null;
  return crypto.createHash("sha256").update(String(value), "utf8").digest("hex").slice(0, 16);
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

function fingerprintEffectiveParameters(protocol, payload) {
  const fields = EFFECTIVE_PARAMETER_FIELDS[protocol];
  if (!fields || !payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const parameters = {};
  for (const field of fields) {
    if (Object.prototype.hasOwnProperty.call(payload, field)) parameters[field] = payload[field];
  }
  return crypto.createHash("sha256").update(JSON.stringify(stableValue(parameters)), "utf8").digest("hex");
}

function validFingerprint(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/iu.test(value) ? value.toLowerCase() : null;
}

function projectEffectiveBudget(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const result = {};
  for (const key of ["estimatedInputTokens", "reservedOutputTokens", "protocolOverheadTokens", "safetyMarginTokens", "effectiveInputBudget", "contextWindow", "maxOutputTokens"]) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
    result[key] = nonNegativeNumber(value[key]);
  }
  if (typeof value.pressureRatio === "number" && Number.isFinite(value.pressureRatio) && value.pressureRatio >= 0) result.pressureRatio = value.pressureRatio;
  if (typeof value.safe === "boolean") result.safe = value.safe;
  if (["INPUT_AVAILABLE", "NO_USABLE_INPUT"].includes(value.budgetStatus)) result.budgetStatus = value.budgetStatus;
  return Object.keys(result).length ? result : null;
}

function safeTimestamp(value) {
  if (value === null || value === void 0) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function safeRouteLabel(value, pattern, maximumLength = 128) {
  if (typeof value !== "string" || value.length < 1 || value.length > maximumLength || !pattern.test(value)) return null;
  return value;
}

function safeMessageSpans(messageSpans, blockMetadata = []) {
  if (!Array.isArray(messageSpans)) return [];
  const blocksById = new Map((Array.isArray(blockMetadata) ? blockMetadata : [])
    .filter((block) => block && typeof block === "object" && typeof block.id === "string")
    .map((block) => [block.id, block]));
  const projected = [];
  for (const span of messageSpans.slice(0, 1000)) {
    if (!span || typeof span !== "object" || Array.isArray(span)) continue;
    const ids = Array.isArray(span.blockIds) ? span.blockIds : [span.blockId ?? span.id];
    const blockMetadataForSpan = ids.map((id) => typeof id === "string" ? blocksById.get(id) : null).find(Boolean) || null;
    const contributions = Array.isArray(span.contributions) && span.contributions.length
      ? span.contributions
      : Number.isInteger(Number(span.start)) && Number.isInteger(Number(span.end)) && Number(span.start) >= 0 && Number(span.end) > Number(span.start)
        ? Array.from({ length: Math.min(Number(span.end) - Number(span.start), 1000) }, (_, index) => ({ messagePosition: Number(span.start) + index }))
        : span.messagePosition !== null && span.messagePosition !== void 0 && Number.isInteger(Number(span.messagePosition))
        ? [{ messagePosition: span.messagePosition }]
        : span.messageStartPosition !== null && span.messageStartPosition !== void 0 && Number.isInteger(Number(span.messageStartPosition))
          && Number.isInteger(Number(span.messageCount)) && Number(span.messageCount) > 0
          ? Array.from({ length: Math.min(Number(span.messageCount), 1000) }, (_, index) => ({ messagePosition: Number(span.messageStartPosition) + index }))
          : [];
    const kindValue = String(span.semanticClass ?? blockMetadataForSpan?.semanticClass ?? span.kind ?? blockMetadataForSpan?.kind ?? "").toUpperCase();
    const lifecycle = span.lifecycle ?? blockMetadataForSpan?.lifecycle;
    const lifecycleValue = String(typeof lifecycle === "string" ? lifecycle : lifecycle?.state ?? lifecycle?.lifecycle ?? "").toUpperCase();
    const tokenMetadata = span.tokens ?? blockMetadataForSpan?.tokens;
    const estimatedTokens = nonNegativeNumber(span.estimatedTokens ?? (typeof tokenMetadata === "object" ? tokenMetadata?.estimated ?? tokenMetadata?.estimatedTokens : tokenMetadata));
    const prefixEligible = span.prefixEligible ?? span.cache?.prefixEligible ?? blockMetadataForSpan?.prefixEligible ?? blockMetadataForSpan?.cache?.prefixEligible;
    const stableCandidate = span.stableCandidate ?? span.stable ?? blockMetadataForSpan?.stableCandidate ?? blockMetadataForSpan?.stable;
    const blockIdHashes = [...new Set(ids.map(hashDiagnosticId).filter(Boolean))].slice(0, 8);
    const blockFingerprintHashes = [...new Set([span.fingerprint, blockMetadataForSpan?.fingerprint, blockMetadataForSpan?.cache?.contentFingerprint].map(hashDiagnosticId).filter(Boolean))].slice(0, 4);
    const count = nonNegativeNumber(span.messageCount);
    for (const contribution of contributions.slice(0, 1000)) {
      const position = contribution?.messagePosition === null || contribution?.messagePosition === void 0 ? NaN : Number(contribution.messagePosition);
      if (Number.isInteger(position) && position >= 0) {
        projected.push({
          start: position,
          end: position + 1,
          blockIdHashes,
          blockFingerprintHashes,
          kind: CACHE_DIAGNOSTIC_BLOCK_KINDS.has(kindValue) ? kindValue : null,
          lifecycle: CACHE_DIAGNOSTIC_LIFECYCLES.has(lifecycleValue) ? lifecycleValue : null,
          estimatedTokens,
          prefixEligible: typeof prefixEligible === "boolean" ? prefixEligible : null,
          stableCandidate: typeof stableCandidate === "boolean" ? stableCandidate : null
        });
      } else {
        const start = Number(contribution?.messageStartPosition ?? contribution?.start);
        const contributionCount = nonNegativeNumber(contribution?.messageCount ?? count);
        if (!Number.isInteger(start) || start < 0 || !Number.isInteger(contributionCount) || contributionCount < 1) continue;
        for (let offset = 0; offset < Math.min(contributionCount, 1000); offset += 1) {
          projected.push({ start: start + offset, end: start + offset + 1, blockIdHashes, blockFingerprintHashes, kind: CACHE_DIAGNOSTIC_BLOCK_KINDS.has(kindValue) ? kindValue : null, lifecycle: CACHE_DIAGNOSTIC_LIFECYCLES.has(lifecycleValue) ? lifecycleValue : null, estimatedTokens, prefixEligible: typeof prefixEligible === "boolean" ? prefixEligible : null, stableCandidate: typeof stableCandidate === "boolean" ? stableCandidate : null });
        }
      }
      if (projected.length >= 10000) return projected.slice(0, 10000);
    }
  }
  return projected;
}

function firstChangedSpan(spans, position) {
  if (!Number.isInteger(position) || position < 0) return null;
  const matches = spans.filter((span) => position >= span.start && position < span.end);
  if (!matches.length) return null;
  const blockIdHashes = [...new Set(matches.flatMap((span) => span.blockIdHashes))].slice(0, 8);
  const blockFingerprintHashes = [...new Set(matches.flatMap((span) => span.blockFingerprintHashes || []))].slice(0, 4);
  const kinds = [...new Set(matches.map((span) => span.kind).filter(Boolean))];
  const lifecycles = [...new Set(matches.map((span) => span.lifecycle).filter(Boolean))];
  return {
    blockIdHashes,
    blockFingerprintHashes,
    kind: kinds.length === 1 ? kinds[0] : kinds.length > 1 ? "MULTIPLE" : null,
    lifecycle: lifecycles.length === 1 ? lifecycles[0] : lifecycles.length > 1 ? "MULTIPLE" : null
  };
}

function estimateStablePrefixCandidateTokens(spans) {
  const byPosition = new Map();
  for (const span of spans) {
    for (let position = span.start; position < span.end; position += 1) {
      if (!byPosition.has(position)) byPosition.set(position, []);
      byPosition.get(position).push(span);
    }
  }
  let total = 0;
  let position = 0;
  let hasCandidate = false;
  const countedBlocks = new Set();
  while (byPosition.has(position)) {
    const contributions = byPosition.get(position);
    if (contributions.some((span) => !["STATIC", "FROZEN", "APPEND_ONLY"].includes(span.lifecycle) || span.prefixEligible === false || span.stableCandidate === false)) break;
    for (const span of contributions) {
      if (!span.blockIdHashes.length) return null;
      const blockKey = span.blockIdHashes[0];
      if (countedBlocks.has(blockKey)) continue;
      if (span.estimatedTokens === null) return null;
      countedBlocks.add(blockKey);
      total += span.estimatedTokens;
      hasCandidate = true;
    }
    position += 1;
  }
  return hasCandidate ? total : null;
}

function cacheChangeReasons(diff) {
  if (!diff || diff.comparisonStatus !== "compared") return ["NO_COMPARABLE_PREVIOUS_REQUEST"];
  const reasons = [];
  if (diff.sameEndpoint === false) reasons.push("ENDPOINT_CHANGED");
  if (diff.sameEffectiveParameters === false) reasons.push("EFFECTIVE_PARAMETERS_CHANGED");
  if (Number.isInteger(diff.firstDifferentMessagePosition)) reasons.push("MESSAGE_PREFIX_CHANGED");
  if (diff.prefixChanged === true) reasons.push("STABLE_PREFIX_CHANGED");
  return reasons.length ? [...new Set(reasons)] : ["NO_LOCAL_CHANGE"];
}

function projectCacheField(value, source, inconsistent = false) {
  if (source === "INVALID") return { value: null, source: "INVALID" };
  if (inconsistent) return { value: null, source: "INCONSISTENT" };
  if (source === "DERIVED") return { value: nonNegativeNumber(value), source: "DERIVED" };
  if (value === null || value === void 0 || source === "NOT_REPORTED") return { value: null, source: "NOT_REPORTED" };
  const number = nonNegativeNumber(value);
  if (number === null) return { value: null, source: "INVALID" };
  return { value: number, source: number === 0 ? "PROVIDER_REPORTED_ZERO" : "PROVIDER_REPORTED" };
}

function projectCacheDiagnosticsV2({ requestKey, providerType, model, requestType, requestDiff, normalizedUsage, requestMeta = {}, startedAt, firstReasoningAt, firstVisibleAt, completedAt, outcome } = {}) {
  const plan = requestMeta.plan && typeof requestMeta.plan === "object" ? requestMeta.plan : {};
  const diff = requestDiff && typeof requestDiff === "object" ? requestDiff : {};
  const effectiveRequest = requestMeta.effectiveRequest && typeof requestMeta.effectiveRequest === "object" ? requestMeta.effectiveRequest : {};
  const hasFinalEffectiveRequest = effectiveRequest.source === "ADAPTER_FINAL";
  const endpointFingerprint = hasFinalEffectiveRequest
    ? validFingerprint(effectiveRequest.endpointFingerprint)
    : validFingerprint(diff.endpointFingerprint);
  const effectiveParametersFingerprint = hasFinalEffectiveRequest
    ? validFingerprint(effectiveRequest.payloadParametersFingerprint)
    : validFingerprint(diff.effectiveParametersFingerprint);
  const protocol = safeRouteLabel(effectiveRequest.protocol, /^[A-Za-z0-9._-]+$/u, 64);
  const route = {
    providerType: safeRouteLabel(effectiveRequest.providerType || providerType || diff.providerType, /^[A-Za-z0-9._-]+$/u, 64),
    modelId: safeRouteLabel(effectiveRequest.model || model || diff.model, /^[A-Za-z0-9._:/+-]+$/u, 128),
    requestType: safeRouteLabel(requestType || diff.requestType, /^[A-Za-z0-9._-]+$/u, 64) || "unknown",
    routeKey: endpointFingerprint,
    protocol
  };
  const streamValue = hasFinalEffectiveRequest ? effectiveRequest.stream : requestMeta.stream;
  const stream = streamValue === true ? true : streamValue === false ? false : null;
  const effectiveParametersKey = effectiveParametersFingerprint;
  const spans = safeMessageSpans(requestMeta.messageSpans, requestMeta.blocks);
  const firstChangedMessagePosition = Number.isInteger(diff.firstDifferentMessagePosition) && diff.firstDifferentMessagePosition >= 0
    ? diff.firstDifferentMessagePosition : null;
  const span = firstChangedSpan(spans, firstChangedMessagePosition);
  const fallbackBlockHash = hashDiagnosticId(diff.firstDifferentBlockId);
  const fieldSources = normalizedUsage?.provenance?.fieldSources || {};
  const inconsistentFields = new Set(normalizedUsage?.provenance?.inconsistentFields || []);
  const native = normalizedUsage?.native || {};
  const derivedMiss = normalizedUsage?.provenance?.derived?.cacheMissTokens;
  const missSource = fieldSources.cacheMissTokens;
  const cacheMiss = missSource === "DERIVED"
    ? projectCacheField(derivedMiss, "DERIVED")
    : projectCacheField(native.cacheMissTokens, missSource, inconsistentFields.has("cacheMissTokens"));
  const cacheHit = projectCacheField(native.cachedInputTokens, fieldSources.cachedInputTokens, inconsistentFields.has("cachedInputTokens"));
  const inputTokens = projectCacheField(native.inputTokens, fieldSources.inputTokens, inconsistentFields.has("inputTokens"));
  const outputTokens = projectCacheField(native.outputTokens, fieldSources.outputTokens, inconsistentFields.has("outputTokens"));
  const estimatedInputTokens = nonNegativeNumber(normalizedUsage?.estimated?.inputTokens);
  const routeKind = route.requestType;
  const groupingFields = [route.providerType, route.modelId, route.routeKey, routeKind, protocol, stream, effectiveParametersKey];
  const groupKey = crypto.createHash("sha256").update(JSON.stringify(groupingFields), "utf8").digest("hex");
  const status = String(outcome || "UNKNOWN").toUpperCase();
  const normalizedOutcome = ["COMPLETE", "CANCELLED", "FAILED", "PARTIAL", "REFUSED"].includes(status)
    ? status : ["CANCELED", "ABORTED"].includes(status) ? "CANCELLED"
      : ["ERROR", "FAILED"].includes(status) ? "FAILED" : "UNKNOWN";
  const timestamp = safeTimestamp(startedAt);
  const reasoningTimestamp = safeTimestamp(firstReasoningAt);
  const visibleTimestamp = safeTimestamp(firstVisibleAt);
  const completedTimestamp = safeTimestamp(completedAt);
  const diffTokens = nonNegativeNumber(diff.estimatedCommonPrefixTokens);
  const hasPlanAndSpanEvidence = Boolean(plan.layoutId && spans.length > 0);
  const planEvidence = CACHE_DIAGNOSTIC_PLAN_EVIDENCE.has(plan.evidenceStatus)
    ? plan.evidenceStatus
    : hasPlanAndSpanEvidence ? "PLAN_OBSERVED" : "LEGACY_OBSERVED";
  const ownerEvidence = CACHE_DIAGNOSTIC_OWNER_EVIDENCE.has(plan.ownerEvidence) ? plan.ownerEvidence : "UNKNOWN";
  const stablePrefixCandidateTokens = planEvidence === "PLAN_OBSERVED"
    ? nonNegativeNumber(plan.stablePrefixCandidateTokens ?? requestMeta.stablePrefixCandidateTokens ?? estimateStablePrefixCandidateTokens(spans))
    : null;
  const spanBlockHashes = span?.blockIdHashes || [];
  const firstChangedBlockIdHashes = spanBlockHashes.length ? spanBlockHashes : fallbackBlockHash ? [fallbackBlockHash] : [];
  return {
    schemaVersion: CACHE_DIAGNOSTICS_V2_VERSION,
    requestKey: /^[a-f0-9]{32,64}$/iu.test(requestKey || "") ? requestKey.toLowerCase() : crypto.randomBytes(16).toString("hex"),
    route,
    plan: {
      layoutId: CACHE_DIAGNOSTIC_LAYOUTS.has(plan.layoutId) ? plan.layoutId : CACHE_DIAGNOSTIC_LAYOUTS.has(diff.promptProfile?.layoutId) ? diff.promptProfile.layoutId : null,
      layoutRevisionKey: hashDiagnosticId(plan.layoutRevision),
      evidenceStatus: planEvidence,
      ownerEvidence,
      fallbackReason: CACHE_DIAGNOSTIC_FALLBACK_REASONS.has(plan.fallbackReason) ? plan.fallbackReason : null
    },
    grouping: { groupKey, routeKind, protocol, stream, effectiveParametersKey },
    effectiveRequest: {
      source: hasFinalEffectiveRequest ? "ADAPTER_FINAL" : "EARLY_DIAGNOSTIC",
      fingerprint: validFingerprint(effectiveRequest.fingerprint),
      endpointFingerprint,
      protocol,
      stream,
      payloadParametersFingerprint: validFingerprint(effectiveRequest.payloadParametersFingerprint),
      budget: projectEffectiveBudget(effectiveRequest.budget)
    },
    local: {
      source: diff.version === "real_request_diff_v1" ? "APP_LOCAL_COMPARISON" : planEvidence === "LEGACY_OBSERVED" ? "LEGACY_OBSERVED" : "APP_LOCAL_OBSERVATION",
      comparisonStatus: safeRouteLabel(diff.comparisonStatus, /^[a-z_]+$/u, 48) || (planEvidence === "LEGACY_OBSERVED" ? "legacy_observed" : "unknown"),
      stablePrefixCandidateTokens,
      commonPrefixEstimatedTokens: diffTokens,
      firstChangedBlockId: firstChangedBlockIdHashes.length === 1 ? firstChangedBlockIdHashes[0] : null,
      firstChangedBlockIdHashes,
      firstChangedBlockFingerprintHashes: span?.blockFingerprintHashes || [],
      firstChangedBlockKind: span?.kind || null,
      firstChangedBlockLifecycle: span?.lifecycle || null,
      firstChangedMessagePosition,
      estimatedInputTokens,
      changeReasons: cacheChangeReasons(diff)
    },
    provider: {
      cacheHit,
      cacheMiss,
      derivedCacheMissTokens: missSource === "DERIVED" ? projectCacheField(derivedMiss, "DERIVED") : { value: null, source: "NOT_REPORTED" },
      inputTokens,
      outputTokens,
      nativeCacheBreakPosition: { value: null, source: "UNKNOWN" }
    },
    outcome: normalizedOutcome,
    time: {
      requestStart: timestamp,
      firstReasoningAt: reasoningTimestamp,
      firstVisibleAt: visibleTimestamp,
      completedAt: completedTimestamp,
      reasoningTTFTMs: timestamp && reasoningTimestamp ? Math.max(0, Date.parse(reasoningTimestamp) - Date.parse(timestamp)) : null,
      visibleTTFTMs: timestamp && visibleTimestamp ? Math.max(0, Date.parse(visibleTimestamp) - Date.parse(timestamp)) : null
    }
  };
}

function summarizeCacheDiagnosticsV2(entries = []) {
  const groups = new Map();
  const records = Array.isArray(entries) ? entries.filter((entry) => entry?.schemaVersion === CACHE_DIAGNOSTICS_V2_VERSION) : [];
  for (const entry of records) {
    const groupKey = entry.grouping?.groupKey || "unknown";
    if (!groups.has(groupKey)) groups.set(groupKey, {
      groupKey,
      route: entry.route,
      protocol: entry.grouping?.protocol || null,
      stream: entry.grouping?.stream ?? null,
      effectiveParametersKey: entry.grouping?.effectiveParametersKey || null,
      requestCount: 0,
      hitRateIncludedRequests: 0,
      unknownRequests: 0,
      excludedRequests: 0,
      providerReportedZeroRequests: 0,
      missingUsageRequests: 0,
      invalidUsageRequests: 0,
      inconsistentUsageRequests: 0,
      failedRequests: 0,
      cancelledRequests: 0,
      incompleteRequests: 0,
      zeroInputRequests: 0,
      nativeInputTokens: 0,
      nativeCachedTokens: 0,
      derivedMissRequests: 0,
      derivedCacheMissTokens: 0,
      reasoningTTFTCount: 0,
      reasoningTTFTTotalMs: 0,
      visibleTTFTCount: 0,
      visibleTTFTTotalMs: 0
    });
    const group = groups.get(groupKey);
    group.requestCount += 1;
    const hit = entry.provider?.cacheHit;
    const input = entry.provider?.inputTokens;
    const nativeHit = ["PROVIDER_REPORTED", "PROVIDER_REPORTED_ZERO"].includes(hit?.source) && nonNegativeNumber(hit?.value) !== null;
    const nativeInput = ["PROVIDER_REPORTED", "PROVIDER_REPORTED_ZERO"].includes(input?.source) && nonNegativeNumber(input?.value) !== null;
    if (entry.provider?.cacheMiss?.source === "DERIVED") {
      group.derivedMissRequests += 1;
      group.derivedCacheMissTokens += nonNegativeNumber(entry.provider.cacheMiss.value) || 0;
    }
    const usageSources = [hit?.source, input?.source];
    if (hit?.source === "PROVIDER_REPORTED_ZERO") group.providerReportedZeroRequests += 1;
    if (usageSources.includes("NOT_REPORTED")) group.missingUsageRequests += 1;
    if (usageSources.includes("INVALID")) group.invalidUsageRequests += 1;
    if (usageSources.includes("INCONSISTENT")) group.inconsistentUsageRequests += 1;
    const terminal = entry.outcome;
    if (terminal === "FAILED") group.failedRequests += 1;
    if (terminal === "CANCELLED") group.cancelledRequests += 1;
    if (!["COMPLETE"].includes(terminal)) {
      group.excludedRequests += 1;
      if (terminal !== "FAILED" && terminal !== "CANCELLED") group.incompleteRequests += 1;
    } else if (nativeHit && nativeInput && input.value > 0) {
      group.hitRateIncludedRequests += 1;
      group.nativeInputTokens += input.value;
      group.nativeCachedTokens += hit.value;
    } else {
      group.excludedRequests += 1;
      if (nativeHit && nativeInput && input.value === 0) group.zeroInputRequests += 1;
      else group.unknownRequests += 1;
    }
    const reasoningMs = nonNegativeNumber(entry.time?.reasoningTTFTMs);
    const visibleMs = nonNegativeNumber(entry.time?.visibleTTFTMs);
    if (reasoningMs !== null) { group.reasoningTTFTCount += 1; group.reasoningTTFTTotalMs += reasoningMs; }
    if (visibleMs !== null) { group.visibleTTFTCount += 1; group.visibleTTFTTotalMs += visibleMs; }
  }
  const orderedGroups = [...groups.values()].map((group) => ({
    ...group,
    weightedHitRate: group.nativeInputTokens > 0 ? group.nativeCachedTokens / group.nativeInputTokens : null,
    averageReasoningTTFTMs: group.reasoningTTFTCount > 0 ? group.reasoningTTFTTotalMs / group.reasoningTTFTCount : null,
    averageVisibleTTFTMs: group.visibleTTFTCount > 0 ? group.visibleTTFTTotalMs / group.visibleTTFTCount : null
  })).sort((left, right) => left.groupKey.localeCompare(right.groupKey));
  const starts = records.map((entry) => Date.parse(entry.time?.requestStart || "")).filter(Number.isFinite);
  return {
    schemaVersion: CACHE_DIAGNOSTICS_V2_VERSION,
    sampleCount: records.length,
    window: {
      start: starts.length ? new Date(Math.min(...starts)).toISOString() : null,
      end: starts.length ? new Date(Math.max(...starts)).toISOString() : null
    },
    groups: orderedGroups
  };
}

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

module.exports = {
  CACHE_DIAGNOSTICS_V2_VERSION,
  reconcileCacheUsage,
  projectCacheDiagnosticsV2,
  summarizeCacheDiagnosticsV2,
  fingerprintEffectiveParameters,
  projectEffectiveBudget
};
