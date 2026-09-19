"use strict";

const crypto = require("crypto");

const REAL_REQUEST_DIFF_VERSION = "real_request_diff_v1";
const CHUNK_TARGET_TOKENS = 512;
const DEFAULT_ANOMALY_PREFIX_TOKENS = 8000;
const DEFAULT_MAX_INTERVAL_MS = 300000;
const EFFECTIVE_REQUEST_FIELDS = [
  "model",
  "messages",
  "stream",
  "temperature",
  "max_tokens",
  "top_p",
  "presence_penalty",
  "frequency_penalty",
  "reasoning_effort",
  "thinking",
  "response_format"
];
const EFFECTIVE_PARAMETER_FIELDS = EFFECTIVE_REQUEST_FIELDS.filter((field) => field !== "messages");
const PREFIX_BUCKETS = [
  { id: "0-2k", label: "0–2K", min: 0, max: 2000 },
  { id: "2-4k", label: "2–4K", min: 2000, max: 4000 },
  { id: "4-6k", label: "4–6K", min: 4000, max: 6000 },
  { id: "6-8k", label: "6–8K", min: 6000, max: 8000 },
  { id: "8-10k", label: "8–10K", min: 8000, max: 10000 },
  { id: "10-12k", label: "10–12K", min: 10000, max: 12000 },
  { id: "12-16k", label: "12–16K", min: 12000, max: 16000 },
  { id: "16k-plus", label: "16K+", min: 16000, max: Infinity }
];
const INTERVAL_BUCKETS = [
  { id: "under-5s", label: "<5s", min: 0, max: 5000 },
  { id: "5-15s", label: "5–15s", min: 5000, max: 15000 },
  { id: "15-30s", label: "15–30s", min: 15000, max: 30000 },
  { id: "30-60s", label: "30–60s", min: 30000, max: 60000 },
  { id: "60-120s", label: "60–120s", min: 60000, max: 120000 },
  { id: "120-300s", label: "120–300s", min: 120000, max: 300000 },
  { id: "300s-plus", label: ">300s", min: 300000, max: Infinity }
];

function finiteNumber(value) {
  if (value === null || value === void 0 || typeof value === "string" && value.trim() === "") return null;
  if (typeof value !== "number" && typeof value !== "string") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function safeId(value) {
  if (value === null || value === void 0 || value === "") return null;
  return String(value).slice(0, 128);
}

function canonicalize(value) {
  if (value === void 0) return void 0;
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((item) => canonicalize(item));
  return Object.keys(value).sort().reduce((result, key) => {
    const next = canonicalize(value[key]);
    if (next !== void 0) result[key] = next;
    return result;
  }, {});
}

function serializeCanonical(value) {
  return JSON.stringify(canonicalize(value));
}

function hashValue(value) {
  return crypto.createHash("sha256").update(String(value), "utf8").digest("hex");
}

function hashCanonical(value) {
  return hashValue(serializeCanonical(value));
}

function serializeMessageContent(content) {
  if (typeof content === "string") return content;
  if (content === null || content === void 0) return "";
  return serializeCanonical(content);
}

function estimateTextTokens(text, TokenCounter) {
  if (typeof TokenCounter?.estimateTokens !== "function") return 0;
  return Math.max(0, Math.floor(Number(TokenCounter.estimateTokens(text || "")) || 0));
}

function estimateMessageTokens(message, TokenCounter) {
  if (typeof TokenCounter?.estimateMessageTokens === "function") {
    return Math.max(0, Math.floor(Number(TokenCounter.estimateMessageTokens(message)) || 0));
  }
  return estimateTextTokens(message?.content, TokenCounter);
}

function buildMessageBlockMap(blocks = [], messageCount = 0) {
  const result = Array(messageCount).fill(null);
  for (const block of Array.isArray(blocks) ? blocks : []) {
    const start = Number(block?.messageStartPosition);
    const count = Number(block?.messageCount);
    if (!Number.isInteger(start) || !Number.isInteger(count) || start < 0 || count < 1) continue;
    for (let index = start; index < Math.min(messageCount, start + count); index += 1) {
      if (!result[index]) result[index] = typeof block.id === "string" ? block.id : null;
    }
  }
  return result;
}

function buildMessageChunks(content, TokenCounter, targetTokens = CHUNK_TARGET_TOKENS) {
  const text = String(content || "");
  if (!text) return [];
  const chunks = [];
  let offset = 0;
  let index = 0;
  while (offset < text.length) {
    let end = offset;
    let estimatedTokens = 0;
    while (end < text.length && estimatedTokens < targetTokens) {
      end = Math.min(text.length, end + 256);
      estimatedTokens = estimateTextTokens(text.slice(offset, end), TokenCounter);
    }
    if (end <= offset) end = Math.min(text.length, offset + 1);
    chunks.push({
      index,
      estimatedTokens: estimateTextTokens(text.slice(offset, end), TokenCounter),
      hash: hashValue(text.slice(offset, end))
    });
    offset = end;
    index += 1;
  }
  return chunks;
}

function buildEffectiveRequestCanonicalObject(request = {}) {
  return EFFECTIVE_REQUEST_FIELDS.reduce((result, field) => {
    if (request[field] !== void 0) result[field] = canonicalize(request[field]);
    return result;
  }, {});
}

function buildEffectiveParametersCanonicalObject(request = {}) {
  return EFFECTIVE_PARAMETER_FIELDS.reduce((result, field) => {
    if (request[field] !== void 0) result[field] = canonicalize(request[field]);
    return result;
  }, {});
}

function buildEffectiveRequestFingerprint(request) {
  return hashCanonical(buildEffectiveRequestCanonicalObject(request));
}

function buildEffectiveParametersFingerprint(request) {
  return hashCanonical(buildEffectiveParametersCanonicalObject(request));
}

function buildMessageFingerprint(messages = []) {
  return hashCanonical(Array.isArray(messages) ? messages : []);
}

function buildEndpointFingerprint({ providerType, baseUrl, model } = {}) {
  return hashCanonical({ providerType: providerType || "unknown", baseUrl: baseUrl || "", model: model || "" });
}

function buildRouteScopeKey(meta = {}) {
  return [meta.providerType || "unknown", meta.model || "unknown", meta.requestType || "unknown"].join(":");
}

function buildConversationScopeKey(meta = {}) {
  return [
    meta.providerType || "unknown",
    meta.model || "unknown",
    meta.requestType || "unknown",
    safeId(meta.conversationId) || "no-conversation",
    safeId(meta.responderId) || "no-responder"
  ].join(":");
}

function buildMessageSummary(message, position, blockId, TokenCounter) {
  const role = typeof message?.role === "string" ? message.role : "unknown";
  const content = serializeMessageContent(message?.content);
  const estimatedTokens = estimateMessageTokens({ ...message, role, content }, TokenCounter);
  return {
    position,
    role,
    blockId: typeof message?.blockId === "string" ? message.blockId : blockId || null,
    estimatedTokens,
    contentHash: hashValue(content),
    messageHash: hashCanonical(message),
    chunks: buildMessageChunks(content, TokenCounter)
  };
}

function buildRealRequestSnapshot({ providerType, model, requestType = "chat", request = {}, conversationId = null, responderId = null, baseUrl = "", blocks = [], promptProfile = null, staticTokens = null, dynamicTokens = null, prefixFingerprint = null, globalStaticTokens = null, conversationFrozenTokens = null, responderFrozenTokens = null, stableKinshipTokens = null, actualStablePrefixTokens = null, declaredStaticTokens = null, dynamicTailTokens = null, TokenCounter, timestamp = new Date().toISOString() } = {}) {
  const messages = Array.isArray(request.messages) ? request.messages : [];
  const blockMap = buildMessageBlockMap(blocks, messages.length);
  const summaries = messages.map((message, position) => buildMessageSummary(message, position, blockMap[position], TokenCounter));
  const memoryMessages = messages.map((message, position) => ({
    role: summaries[position].role,
    content: serializeMessageContent(message?.content),
    message: canonicalize(message),
    summary: summaries[position]
  }));
  const effectiveRequestCanonicalObject = buildEffectiveRequestCanonicalObject(request);
  const effectiveParametersCanonicalObject = buildEffectiveParametersCanonicalObject(request);
  const endpointFingerprint = buildEndpointFingerprint({ providerType, baseUrl, model });
  return {
    timestamp,
    providerType: providerType || "unknown",
    model: model || "unknown",
    requestType,
    conversationId: safeId(conversationId),
    responderId: safeId(responderId),
    routeScopeKey: buildRouteScopeKey({ providerType, model, requestType }),
    conversationScopeKey: buildConversationScopeKey({ providerType, model, requestType, conversationId, responderId }),
    messages: memoryMessages,
    effectiveRequestCanonicalObject,
    effectiveParametersCanonicalObject,
    effectiveRequestFingerprint: hashCanonical(effectiveRequestCanonicalObject),
    effectiveParametersFingerprint: hashCanonical(effectiveParametersCanonicalObject),
    messageFingerprint: buildMessageFingerprint(messages),
    endpointFingerprint,
    promptProfile: promptProfile && typeof promptProfile === "object" ? {
      id: safeId(promptProfile.id),
      label: safeId(promptProfile.label),
      historyWindow: finiteNumber(promptProfile.historyWindow),
      layoutId: safeId(promptProfile.layoutId)
    } : null,
    staticTokens: finiteNumber(staticTokens),
    dynamicTokens: finiteNumber(dynamicTokens),
    prefixFingerprint: safeId(prefixFingerprint),
    globalStaticTokens: finiteNumber(globalStaticTokens),
    conversationFrozenTokens: finiteNumber(conversationFrozenTokens),
    responderFrozenTokens: finiteNumber(responderFrozenTokens),
    stableKinshipTokens: finiteNumber(stableKinshipTokens),
    actualStablePrefixTokens: finiteNumber(actualStablePrefixTokens),
    declaredStaticTokens: finiteNumber(declaredStaticTokens),
    dynamicTailTokens: finiteNumber(dynamicTailTokens),
    estimatedPromptTokens: summaries.reduce((sum, message) => sum + message.estimatedTokens, 0),
    safeMessages: summaries
  };
}

function commonPrefixLength(left, right) {
  const limit = Math.min(left.length, right.length);
  let index = 0;
  while (index < limit && left[index] === right[index]) index += 1;
  return index;
}

function collectChangedPaths(previous, current, prefix = "", output = []) {
  const leftObject = previous && typeof previous === "object" && !Array.isArray(previous);
  const rightObject = current && typeof current === "object" && !Array.isArray(current);
  if (leftObject && rightObject) {
    for (const key of [...new Set([...Object.keys(previous), ...Object.keys(current)])].sort()) {
      collectChangedPaths(previous[key], current[key], prefix ? `${prefix}.${key}` : key, output);
    }
    return output;
  }
  if (serializeCanonical(previous) !== serializeCanonical(current) && prefix) output.push(prefix);
  return output;
}

function compareMessageLists(previous, current, TokenCounter) {
  const previousMessages = Array.isArray(previous?.messages) ? previous.messages : [];
  const currentMessages = Array.isArray(current?.messages) ? current.messages : [];
  const limit = Math.min(previousMessages.length, currentMessages.length);
  let sameMessageCount = 0;
  let identicalEstimatedTokens = 0;
  while (sameMessageCount < limit && previousMessages[sameMessageCount]?.summary?.messageHash === currentMessages[sameMessageCount]?.summary?.messageHash) {
    identicalEstimatedTokens += currentMessages[sameMessageCount]?.summary?.estimatedTokens || 0;
    sameMessageCount += 1;
  }
  const hasDifference = sameMessageCount < Math.max(previousMessages.length, currentMessages.length);
  const previousMessage = previousMessages[sameMessageCount] || null;
  const currentMessage = currentMessages[sameMessageCount] || null;
  let commonContentChars = 0;
  let commonContentBytes = 0;
  let commonContentEstimatedTokens = 0;
  let commonChunkCount = 0;
  if (previousMessage && currentMessage && previousMessage.role === currentMessage.role) {
    commonContentChars = commonPrefixLength(previousMessage.content, currentMessage.content);
    const commonContent = currentMessage.content.slice(0, commonContentChars);
    commonContentBytes = Buffer.byteLength(commonContent, "utf8");
    commonContentEstimatedTokens = estimateTextTokens(commonContent, TokenCounter);
    const previousChunks = previousMessage.summary?.chunks || [];
    const currentChunks = currentMessage.summary?.chunks || [];
    while (commonChunkCount < Math.min(previousChunks.length, currentChunks.length) && previousChunks[commonChunkCount].hash === currentChunks[commonChunkCount].hash) commonChunkCount += 1;
  }
  const estimatedCommonPrefixTokens = hasDifference ? identicalEstimatedTokens + commonContentEstimatedTokens : currentMessages.reduce((sum, message) => sum + (message.summary?.estimatedTokens || 0), 0);
  const firstDifferentSummary = currentMessage?.summary || previousMessage?.summary || null;
  return {
    sameMessageCountBeforeBreak: sameMessageCount,
    sameMessageCount,
    firstDifferentMessagePosition: hasDifference ? sameMessageCount : null,
    firstDifferentBlockId: hasDifference ? firstDifferentSummary?.blockId || null : null,
    previousMessageCount: previousMessages.length,
    currentMessageCount: currentMessages.length,
    estimatedCommonPrefixTokens,
    firstDifferentMessage: hasDifference ? {
      role: currentMessage?.role || previousMessage?.role || null,
      blockId: firstDifferentSummary?.blockId || null,
      previousEstimatedTokens: previousMessage?.summary?.estimatedTokens ?? null,
      currentEstimatedTokens: currentMessage?.summary?.estimatedTokens ?? null,
      commonContentChars,
      commonContentBytes,
      commonPrefixEstimatedTokens: commonContentEstimatedTokens,
      commonChunkCount,
      previousChunks: previousMessage?.summary?.chunks || [],
      currentChunks: currentMessage?.summary?.chunks || []
    } : null
  };
}

function buildScopedRequestDiff(previous, current, scopeType, TokenCounter) {
  if (!previous) {
    return {
      scopeType,
      comparisonStatus: "cold_local_baseline",
      previousRequestAt: null,
      currentRequestAt: current.timestamp,
      intervalMs: null,
      sameEndpoint: null,
      sameEffectiveParameters: null,
      changedFields: [],
      sameMessageCountBeforeBreak: null,
      firstDifferentMessagePosition: null,
      firstDifferentBlockId: null,
      firstDifferentMessage: null,
      estimatedCommonPrefixTokens: null
    };
  }
  const messageDiff = compareMessageLists(previous, current, TokenCounter);
  const previousTime = Date.parse(previous.timestamp);
  const currentTime = Date.parse(current.timestamp);
  return {
    scopeType,
    comparisonStatus: "compared",
    previousRequestAt: previous.timestamp,
    currentRequestAt: current.timestamp,
    intervalMs: Number.isFinite(previousTime) && Number.isFinite(currentTime) ? Math.max(0, currentTime - previousTime) : null,
    sameEndpoint: previous.endpointFingerprint === current.endpointFingerprint,
    sameEffectiveParameters: previous.effectiveParametersFingerprint === current.effectiveParametersFingerprint,
    changedFields: collectChangedPaths(previous.effectiveParametersCanonicalObject, current.effectiveParametersCanonicalObject),
    sameMessageCountBeforeBreak: messageDiff.sameMessageCountBeforeBreak,
    sameMessageCount: messageDiff.sameMessageCount,
    previousEstimatedPromptTokens: previous.estimatedPromptTokens,
    currentEstimatedPromptTokens: current.estimatedPromptTokens,
    firstDifferentMessagePosition: messageDiff.firstDifferentMessagePosition,
    firstDifferentBlockId: messageDiff.firstDifferentBlockId,
    firstDifferentMessage: messageDiff.firstDifferentMessage,
    previousMessageCount: messageDiff.previousMessageCount,
    currentMessageCount: messageDiff.currentMessageCount,
    estimatedCommonPrefixTokens: messageDiff.estimatedCommonPrefixTokens
  };
}

function buildRealRequestDiff({ previousRoute = null, previousConversation = null, current, TokenCounter } = {}) {
  const route = buildScopedRequestDiff(previousRoute, current, "route", TokenCounter);
  const conversation = buildScopedRequestDiff(previousConversation, current, "conversation_responder", TokenCounter);
  const sameResponder = previousRoute && current.responderId != null && previousRoute.responderId != null ? previousRoute.responderId === current.responderId : null;
  const sameConversation = previousRoute && current.conversationId != null && previousRoute.conversationId != null ? previousRoute.conversationId === current.conversationId : null;
  return {
    version: REAL_REQUEST_DIFF_VERSION,
    scopeType: "conversation_responder",
    conversationId: current.conversationId,
    responderId: current.responderId,
    routeScopeKey: current.routeScopeKey,
    conversationScopeKey: current.conversationScopeKey,
    providerType: current.providerType,
    model: current.model,
    requestType: current.requestType,
    messageFingerprint: current.messageFingerprint,
    effectiveRequestFingerprint: current.effectiveRequestFingerprint,
    effectiveParametersFingerprint: current.effectiveParametersFingerprint,
    endpointFingerprint: current.endpointFingerprint,
    promptProfile: current.promptProfile,
    staticTokens: current.staticTokens,
    dynamicTokens: current.dynamicTokens,
    globalStaticTokens: current.globalStaticTokens,
    conversationFrozenTokens: current.conversationFrozenTokens,
    responderFrozenTokens: current.responderFrozenTokens,
    stableKinshipTokens: current.stableKinshipTokens,
    actualStablePrefixTokens: current.actualStablePrefixTokens,
    declaredStaticTokens: current.declaredStaticTokens,
    dynamicTailTokens: current.dynamicTailTokens,
    currentPrefixFingerprint: current.prefixFingerprint,
    previousPrefixFingerprint: previousConversation?.prefixFingerprint || null,
    prefixChanged: previousConversation?.prefixFingerprint && current.prefixFingerprint ? previousConversation.prefixFingerprint !== current.prefixFingerprint : null,
    estimatedPromptTokens: current.estimatedPromptTokens,
    messageCount: current.safeMessages.length,
    messages: current.safeMessages,
    comparisonStatus: conversation.comparisonStatus,
    sameConversation,
    sameResponder,
    sameEndpoint: conversation.sameEndpoint,
    sameEffectiveParameters: conversation.sameEffectiveParameters,
    changedFields: conversation.changedFields,
    previousRequestAt: conversation.previousRequestAt,
    currentRequestAt: conversation.currentRequestAt,
    intervalMs: conversation.intervalMs,
    sameMessageCountBeforeBreak: conversation.sameMessageCountBeforeBreak,
    firstDifferentMessagePosition: conversation.firstDifferentMessagePosition,
    firstDifferentBlockId: conversation.firstDifferentBlockId,
    firstDifferentMessage: conversation.firstDifferentMessage,
    previousEstimatedPromptTokens: conversation.previousEstimatedPromptTokens,
    currentEstimatedPromptTokens: conversation.currentEstimatedPromptTokens,
    estimatedCommonPrefixTokens: conversation.estimatedCommonPrefixTokens,
    routeScopeEstimatedCommonPrefixTokens: route.estimatedCommonPrefixTokens,
    routeScope: route,
    conversationScope: conversation
  };
}

function buildProviderUsage(normalizedUsage) {
  const promptTokens = finiteNumber(normalizedUsage?.prompt_tokens);
  const cachedTokens = finiteNumber(normalizedUsage?.prompt_cache_hit_tokens);
  const cacheMissTokens = finiteNumber(normalizedUsage?.prompt_cache_miss_tokens);
  const total = cachedTokens != null && cacheMissTokens != null ? cachedTokens + cacheMissTokens : null;
  return {
    promptTokens,
    cachedTokens,
    cacheMissTokens,
    hitRate: total != null && total > 0 ? cachedTokens / total : null,
    reportingStatus: normalizedUsage?.cache_reporting_status === "reported" || cachedTokens != null ? "reported" : "not_reported"
  };
}

function classifyAlignment({ cachedTokens, estimatedCommonPrefixTokens, sameEffectiveParameters, intervalMs, anomalyPrefixTokens = DEFAULT_ANOMALY_PREFIX_TOKENS, maxIntervalMs = DEFAULT_MAX_INTERVAL_MS } = {}) {
  if (cachedTokens == null || estimatedCommonPrefixTokens == null || estimatedCommonPrefixTokens <= 0) return "insufficient";
  if (cachedTokens === 0 && estimatedCommonPrefixTokens >= anomalyPrefixTokens && sameEffectiveParameters === true && (intervalMs == null || intervalMs <= maxIntervalMs)) return "provider_zero_despite_large_prefix";
  if (cachedTokens === 0) return "insufficient";
  const ratio = cachedTokens / estimatedCommonPrefixTokens;
  if (ratio >= 0.75 && ratio <= 1.25) return "aligned";
  if (ratio < 0.75) return "provider_under_hit";
  return "provider_over_estimate";
}

function attachProviderObservation(realRequestDiff, normalizedUsage, options = {}) {
  const providerUsage = buildProviderUsage(normalizedUsage);
  const alignmentStatus = classifyAlignment({
    cachedTokens: providerUsage.cachedTokens,
    estimatedCommonPrefixTokens: realRequestDiff?.estimatedCommonPrefixTokens,
    sameEffectiveParameters: realRequestDiff?.sameEffectiveParameters,
    intervalMs: realRequestDiff?.intervalMs,
    anomalyPrefixTokens: options.anomalyPrefixTokens,
    maxIntervalMs: options.maxIntervalMs
  });
  const estimated = realRequestDiff?.estimatedCommonPrefixTokens;
  return {
    ...realRequestDiff,
    providerUsage,
    cacheToEstimatedPrefixRatio: providerUsage.cachedTokens != null && estimated > 0 ? providerUsage.cachedTokens / estimated : null,
    alignmentStatus,
    highValueAnomaly: alignmentStatus === "provider_zero_despite_large_prefix"
  };
}

function findBucket(value, buckets) {
  const number = finiteNumber(value);
  if (number == null || number < 0) return null;
  return buckets.find((bucket) => number >= bucket.min && number < bucket.max) || buckets[buckets.length - 1];
}

function emptyAggregate() {
  return { requests: 0, comparableRequests: 0, cachedRequests: 0, zeroHitRequests: 0, promptTokens: 0, cachedTokens: 0, cacheMissTokens: 0, estimatedPrefixTokens: 0, weightedHitRate: null, averageEstimatedPrefixTokens: null, highValueAnomalies: 0 };
}

function addAggregate(aggregate, entry, comparable = true) {
  aggregate.requests += 1;
  const diff = entry.realRequestDiff || {};
  const usage = entry.providerUsage || {};
  const prefix = finiteNumber(diff.estimatedCommonPrefixTokens);
  if (comparable && prefix != null) {
    aggregate.comparableRequests += 1;
    aggregate.estimatedPrefixTokens += prefix;
  }
  if (usage.promptTokens != null) aggregate.promptTokens += usage.promptTokens;
  if (usage.cachedTokens != null) {
    aggregate.cachedRequests += 1;
    aggregate.cachedTokens += usage.cachedTokens;
    if (usage.cachedTokens === 0) aggregate.zeroHitRequests += 1;
  }
  if (usage.cacheMissTokens != null) aggregate.cacheMissTokens += usage.cacheMissTokens;
  if (diff.highValueAnomaly === true || entry.alignmentStatus === "provider_zero_despite_large_prefix") aggregate.highValueAnomalies += 1;
}

function finalizeAggregate(aggregate) {
  return {
    ...aggregate,
    weightedHitRate: aggregate.cachedTokens + aggregate.cacheMissTokens > 0 ? aggregate.cachedTokens / (aggregate.cachedTokens + aggregate.cacheMissTokens) : null,
    averageEstimatedPrefixTokens: aggregate.comparableRequests > 0 ? aggregate.estimatedPrefixTokens / aggregate.comparableRequests : null
  };
}

function buildBucketStats(entries, buckets, valueSelector) {
  const result = buckets.map((bucket) => ({ id: bucket.id, label: bucket.label, ...emptyAggregate() }));
  const byId = new Map(result.map((bucket) => [bucket.id, bucket]));
  for (const entry of entries) {
    const bucket = findBucket(valueSelector(entry), buckets);
    if (!bucket) continue;
    addAggregate(byId.get(bucket.id), entry, true);
  }
  return result.map(finalizeAggregate);
}

function deriveRealRequestConclusion(summary) {
  if (!summary || summary.comparableRequests < 1) return "insufficient_data";
  if (summary.effectiveParameterMismatches > Math.max(1, Math.floor(summary.comparableRequests * 0.25))) return "provider_parameters_unstable";
  if (summary.highValueAnomalies >= 2) return "large_prefix_provider_miss";
  if (summary.switchedNpcRequests >= 3 && summary.sameNpc.weightedHitRate != null && summary.switchedNpc.weightedHitRate != null && summary.sameNpc.weightedHitRate >= 0.7 && summary.switchedNpc.weightedHitRate < 0.1) return "responder_switch_dominant";
  const lowerBuckets = summary.prefixBuckets.filter((bucket) => ["0-2k", "2-4k", "4-6k", "6-8k"].includes(bucket.id));
  const admissionLow = lowerBuckets.reduce((sum, bucket) => sum + bucket.requests, 0);
  const admissionHigh = summary.prefixBuckets.filter((bucket) => ["10-12k", "12-16k", "16k-plus"].includes(bucket.id));
  const highRequests = admissionHigh.reduce((sum, bucket) => sum + bucket.requests, 0);
  const highHit = admissionHigh.reduce((sum, bucket) => sum + bucket.cachedTokens, 0);
  const highMiss = admissionHigh.reduce((sum, bucket) => sum + bucket.cacheMissTokens, 0);
  if (admissionLow >= 3 && highRequests >= 3 && highHit + highMiss > 0 && highHit / (highHit + highMiss) >= 0.7) return "admission_threshold_suspected";
  if (summary.averageEstimatedPrefixTokens != null && summary.averageEstimatedPrefixTokens < 4000 && summary.weightedHitRate != null && summary.weightedHitRate < 0.2) return "prefix_too_short";
  return "no_anomaly_observed";
}

function summarizeRealRequestEntries(entries = []) {
  const realEntries = (Array.isArray(entries) ? entries : []).filter((entry) => entry?.requestType === "chat" && entry?.realRequestDiff);
  const summary = {
    version: REAL_REQUEST_DIFF_VERSION,
    generatedAt: new Date().toISOString(),
    requests: realEntries.length,
    comparableRequests: 0,
    sameNpcRequests: 0,
    switchedNpcRequests: 0,
    highValueAnomalies: 0,
    effectiveParameterMismatches: 0,
    endpointMismatches: 0,
    weightedHitRate: null,
    averageEstimatedPrefixTokens: null,
    mainFirstDifferentBlocks: [],
    byProvider: {},
    prefixBuckets: buildBucketStats(realEntries, PREFIX_BUCKETS, (entry) => entry.realRequestDiff.estimatedCommonPrefixTokens),
    intervalBuckets: buildBucketStats(realEntries, INTERVAL_BUCKETS, (entry) => entry.realRequestDiff.intervalMs),
    sameNpc: finalizeAggregate(emptyAggregate()),
    switchedNpc: finalizeAggregate(emptyAggregate())
  };
  const allAggregate = emptyAggregate();
  const blocks = new Map();
  for (const entry of realEntries) {
    const diff = entry.realRequestDiff;
    const comparable = diff.comparisonStatus === "compared";
    addAggregate(allAggregate, entry, comparable);
    if (comparable) summary.comparableRequests += 1;
    if (diff.highValueAnomaly === true || entry.alignmentStatus === "provider_zero_despite_large_prefix") summary.highValueAnomalies += 1;
    if (diff.sameEffectiveParameters === false) summary.effectiveParameterMismatches += 1;
    if (diff.sameEndpoint === false) summary.endpointMismatches += 1;
    if (diff.sameResponder === true) {
      summary.sameNpcRequests += 1;
      addAggregate(summary.sameNpc, entry, comparable);
    } else if (diff.sameResponder === false) {
      summary.switchedNpcRequests += 1;
      addAggregate(summary.switchedNpc, entry, false);
    }
    if (diff.firstDifferentBlockId) blocks.set(diff.firstDifferentBlockId, (blocks.get(diff.firstDifferentBlockId) || 0) + 1);
    const providerKey = `${entry.provider || diff.providerType || "unknown"} | ${entry.model || diff.model || "unknown"}`;
    if (!summary.byProvider[providerKey]) summary.byProvider[providerKey] = { provider: entry.provider || diff.providerType || "unknown", model: entry.model || diff.model || "unknown", ...finalizeAggregate(emptyAggregate()) };
    addAggregate(summary.byProvider[providerKey], entry, comparable);
  }
  summary.sameNpc = finalizeAggregate(summary.sameNpc);
  summary.switchedNpc = finalizeAggregate(summary.switchedNpc);
  const finalized = finalizeAggregate(allAggregate);
  summary.weightedHitRate = finalized.weightedHitRate;
  summary.averageEstimatedPrefixTokens = finalized.averageEstimatedPrefixTokens;
  summary.mainFirstDifferentBlocks = [...blocks.entries()].sort((left, right) => right[1] - left[1]).slice(0, 8).map(([blockId, count]) => ({ blockId, count }));
  for (const provider of Object.values(summary.byProvider)) Object.assign(provider, finalizeAggregate(provider));
  summary.conclusion = deriveRealRequestConclusion(summary);
  return summary;
}

module.exports = {
  REAL_REQUEST_DIFF_VERSION,
  CHUNK_TARGET_TOKENS,
  DEFAULT_ANOMALY_PREFIX_TOKENS,
  DEFAULT_MAX_INTERVAL_MS,
  PREFIX_BUCKETS,
  INTERVAL_BUCKETS,
  EFFECTIVE_REQUEST_FIELDS,
  canonicalize,
  serializeMessageContent,
  buildEffectiveRequestCanonicalObject,
  buildEffectiveParametersCanonicalObject,
  buildEffectiveRequestFingerprint,
  buildEffectiveParametersFingerprint,
  buildMessageFingerprint,
  buildEndpointFingerprint,
  buildRouteScopeKey,
  buildConversationScopeKey,
  buildMessageChunks,
  buildRealRequestSnapshot,
  compareMessageLists,
  buildScopedRequestDiff,
  buildRealRequestDiff,
  buildProviderUsage,
  classifyAlignment,
  attachProviderObservation,
  summarizeRealRequestEntries,
  deriveRealRequestConclusion
};
