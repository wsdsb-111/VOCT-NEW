"use strict";

const { resolveProviderPromptProfile, resolvePromptLayoutId } = require("../prompts/provider-prompt-adapter");
const { normalizeProviderUsage, normalizeUsage } = require("../providers/usage-normalization");
const { projectProviderUsage } = require("./usage-analytics");
const { CACHE_DIAGNOSTICS_V2_VERSION, fingerprintEffectiveParameters, projectCacheDiagnosticsV2, projectEffectiveBudget, summarizeCacheDiagnosticsV2 } = require("./cache-usage-reconciliation");
const { projectMemoryAttemptDiagnostics, projectPairMemoryMetrics } = require("../memory-system/player-memory-diagnostics");
const {
  buildRealRequestSnapshot,
  buildRealRequestDiff,
  attachProviderObservation,
  buildProviderUsage,
  summarizeRealRequestEntries
} = require("./real-request-diff");

const DEFAULT_MAX_ENTRIES = 500;
const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;
const DEFAULT_MODEL = "glm-5.3-flash";
const RAW_USAGE_SCALARS = ["prompt_tokens", "completion_tokens", "total_tokens"];
const NORMALIZED_USAGE_SCALARS = [
  ...RAW_USAGE_SCALARS,
  "prompt_cache_hit_tokens",
  "prompt_cache_miss_tokens",
  "reasoning_tokens",
  "visible_completion_tokens"
];

function finiteNumber(value) {
  if (value === null || value === void 0 || typeof value === "string" && value.trim() === "") return null;
  if (typeof value !== "number" && typeof value !== "string") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function copyUsageDetails(value, allowedKey) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (!Object.prototype.hasOwnProperty.call(value, allowedKey)) return null;
  const number = finiteNumber(value[allowedKey]);
  return number == null ? null : { [allowedKey]: number };
}

function sanitizeUsage(usage, normalized = false) {
  if (!usage || typeof usage !== "object" || Array.isArray(usage)) return null;
  const result = {};
  const scalarKeys = normalized ? NORMALIZED_USAGE_SCALARS : RAW_USAGE_SCALARS;
  for (const key of scalarKeys) {
    if (!Object.prototype.hasOwnProperty.call(usage, key)) continue;
    const number = finiteNumber(usage[key]);
    if (number != null) result[key] = number;
  }
  if (normalized && Object.prototype.hasOwnProperty.call(usage, "cache_reporting_status")) {
    result.cache_reporting_status = usage.cache_reporting_status === "reported" ? "reported" : "not_reported";
  }
  const promptDetails = copyUsageDetails(usage.prompt_tokens_details, "cached_tokens");
  const completionDetails = copyUsageDetails(usage.completion_tokens_details, "reasoning_tokens");
  if (promptDetails) result.prompt_tokens_details = promptDetails;
  if (completionDetails) result.completion_tokens_details = completionDetails;
  return Object.keys(result).length > 0 ? result : null;
}

function cacheMetrics(usage) {
  const providerUsage = buildProviderUsage(usage);
  return {
    hit: providerUsage.cachedTokens,
    miss: providerUsage.cacheMissTokens,
    hitRate: providerUsage.hitRate,
    reportingStatus: providerUsage.reportingStatus
  };
}

function buildLocalPrefixDiagnostics({ normalizedUsage, blocks = [], TokenCounter, messages = [] }) {
  const safeBlocks = Array.isArray(blocks) ? blocks.map((block, index) => ({
    id: typeof block?.id === "string" ? block.id : `block_${index}`,
    label: typeof block?.label === "string" ? block.label : typeof block?.id === "string" ? block.id : `Block ${index + 1}`,
    tokens: Math.max(0, Math.floor(Number(block?.tokens) || 0)),
    stable: block?.stable === true
  })) : [];
  const metrics = cacheMetrics(normalizedUsage);
  const estimatedTotal = safeBlocks.reduce((sum, block) => sum + block.tokens, 0);
  let reusablePrefixTokens = 0;
  let firstBreakSegment = null;
  let breakSegmentKey = null;
  if (safeBlocks.length > 0 && estimatedTotal > 0 && metrics.hit != null && metrics.miss != null) {
    let estimatedCursor = 0;
    let actualCursor = 0;
    for (const block of safeBlocks) {
      estimatedCursor += block.tokens;
      const actualEnd = Math.round(estimatedCursor / estimatedTotal * (metrics.hit + metrics.miss));
      const actualTokens = Math.max(0, actualEnd - actualCursor);
      const blockHit = Math.max(0, Math.min(actualEnd, metrics.hit) - Math.min(actualCursor, metrics.hit));
      const blockMiss = Math.max(0, actualTokens - blockHit);
      if (blockMiss > 0 && firstBreakSegment == null) {
        firstBreakSegment = block.label;
        breakSegmentKey = block.id;
      }
      if (firstBreakSegment == null) reusablePrefixTokens += block.tokens;
      actualCursor = actualEnd;
    }
  } else if (safeBlocks.length > 0) {
    for (const block of safeBlocks) {
      if (!block.stable) break;
      reusablePrefixTokens += block.tokens;
    }
  } else if (typeof TokenCounter?.calculateTotalTokens === "function" && Array.isArray(messages)) {
    const systemMessage = messages.find((message) => message?.role === "system");
    reusablePrefixTokens = systemMessage ? TokenCounter.calculateTotalTokens([systemMessage]) : 0;
  }
  return {
    method: "ordered_prefix_estimate_v1",
    reusablePrefixTokens,
    firstBreakSegment,
    breakSegmentKey
  };
}

function buildCacheDiagnosticRequestMeta({ request, blocks, blockMetadata, promptPlan, messageSpans, cacheDiagnosticContext } = {}) {
  const v2Context = cacheDiagnosticContext && typeof cacheDiagnosticContext === "object" ? cacheDiagnosticContext : {};
  const plan = v2Context.plan || promptPlan || {};
  return {
    stream: typeof request?.stream === "boolean" ? request.stream : null,
    plan: {
      layoutId: plan?.layoutId,
      layoutRevision: plan?.layoutRevision,
      stablePrefixCandidateTokens: plan?.stablePrefixCandidateTokens ?? v2Context.stablePrefixCandidateTokens,
      evidenceStatus: plan?.evidenceStatus ?? plan?.status,
      ownerEvidence: plan?.ownerEvidence,
      fallbackReason: v2Context.fallbackReason
    },
    messageSpans: Array.isArray(v2Context.messageSpans) ? v2Context.messageSpans : Array.isArray(messageSpans) ? messageSpans : [],
    blocks: Array.isArray(v2Context.blockMetadata) ? v2Context.blockMetadata : Array.isArray(blockMetadata) ? blockMetadata : Array.isArray(blocks) ? blocks : []
  };
}

function usageFromNativeEvidence(evidence) {
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) return null;
  const usage = {};
  const readField = (field) => {
    if (!field || typeof field !== "object" || field.present !== true) return void 0;
    return field.value === null || field.value === void 0 || typeof field.value === "object" || typeof field.value === "boolean"
      ? Number.NaN : field.value;
  };
  for (const key of ["prompt_tokens", "completion_tokens", "total_tokens"]) {
    const value = readField(evidence[key]);
    if (value !== void 0) usage[key] = value;
  }
  for (const [containerKey, valueKey] of [["prompt_tokens_details", "cached_tokens"], ["completion_tokens_details", "reasoning_tokens"]]) {
    const value = readField(evidence[containerKey]?.[valueKey]);
    if (value !== void 0) usage[containerKey] = { [valueKey]: value };
  }
  return usage;
}

function createProviderDiagnostics({ fs, path, dataDir, settingsRepository, providerRegistry, TokenCounter, diagnosticsFile }) {
  const filePath = diagnosticsFile || path.join(dataDir, "provider-diagnostics.jsonl");
  const previousRealRequestByRoute = new Map();
  const previousRealRequestByConversation = new Map();
  const preparedCacheContextByDiff = new WeakMap();
  const cacheDiagnosticsObserversByToken = new WeakMap();

  class ProviderDiagnostics {
    prepareOutboundRequest({ provider, model, requestType, request, messages, blocks, blockMetadata, conversationId, responderId, baseUrl, promptProfile, staticTokens, dynamicTokens, prefixFingerprint, globalStaticTokens, conversationFrozenTokens, responderFrozenTokens, stableKinshipTokens, actualStablePrefixTokens, declaredStaticTokens, dynamicTailTokens, promptPlan, messageSpans, cacheDiagnosticContext }) {
      if (requestType !== "chat") return null;
      const effectiveRequest = request && typeof request === "object" ? request : { messages };
      const current = buildRealRequestSnapshot({
        providerType: provider,
        model,
        requestType,
        request: effectiveRequest,
        conversationId,
        responderId,
        baseUrl,
        blocks,
        promptProfile,
        staticTokens,
        dynamicTokens,
        prefixFingerprint,
        globalStaticTokens,
        conversationFrozenTokens,
        responderFrozenTokens,
        stableKinshipTokens,
        actualStablePrefixTokens,
        declaredStaticTokens,
        dynamicTailTokens,
        TokenCounter
      });
      const previousRoute = previousRealRequestByRoute.get(current.routeScopeKey) || null;
      const canCompareConversation = current.conversationId != null && current.responderId != null;
      const previousConversation = canCompareConversation ? previousRealRequestByConversation.get(current.conversationScopeKey) || null : null;
      const diff = buildRealRequestDiff({ previousRoute, previousConversation, current, TokenCounter });
      previousRealRequestByRoute.set(current.routeScopeKey, current);
      if (canCompareConversation) previousRealRequestByConversation.set(current.conversationScopeKey, current);
      preparedCacheContextByDiff.set(diff, buildCacheDiagnosticRequestMeta({
        request: effectiveRequest,
        blocks,
        blockMetadata,
        promptPlan,
        messageSpans,
        cacheDiagnosticContext
      }));
      return diff;
    }

    createCacheDiagnosticsObserver({ provider, model, requestType, requestDiff, request, blocks, blockMetadata, promptPlan, messageSpans, cacheDiagnosticContext } = {}) {
      const token = Object.freeze({});
      const preparedContext = requestDiff && requestDiff.version === "real_request_diff_v1"
        ? preparedCacheContextByDiff.get(requestDiff) : null;
      const requestMeta = preparedContext || buildCacheDiagnosticRequestMeta({ request, blocks, blockMetadata, promptPlan, messageSpans, cacheDiagnosticContext });
      cacheDiagnosticsObserversByToken.set(token, {
        providerType: provider || null,
        model: model || null,
        requestType: requestType || "unknown",
        requestMeta: {
          ...requestMeta,
          plan: { ...requestMeta.plan, evidenceStatus: "LEGACY_OBSERVED", ownerEvidence: "UNKNOWN" }
        }
      });
      return token;
    }

    attachEffectiveRequest(observerToken, snapshot, budget) {
      const observer = observerToken && cacheDiagnosticsObserversByToken.get(observerToken);
      if (!observer || !snapshot || typeof snapshot !== "object") return false;
      const requestMeta = observer.requestMeta;
      const protocol = typeof snapshot.protocol === "string" ? snapshot.protocol : null;
      const payload = snapshot.payload && typeof snapshot.payload === "object" && !Array.isArray(snapshot.payload) ? snapshot.payload : null;
      requestMeta.plan = {
        ...requestMeta.plan,
        evidenceStatus: snapshot.planStatus === "PROMPT_PLAN_V9" ? "PLAN_OBSERVED" : "LEGACY_OBSERVED",
        ownerEvidence: snapshot.ownerEvidence === "PRESENT" ? "VERIFIED" : "UNKNOWN"
      };
      requestMeta.effectiveRequest = {
        source: "ADAPTER_FINAL",
        fingerprint: snapshot.effectiveRequestFingerprint,
        endpointFingerprint: snapshot.endpoint?.fingerprint,
        protocol,
        stream: typeof snapshot.stream === "boolean" ? snapshot.stream : null,
        payloadParametersFingerprint: fingerprintEffectiveParameters(protocol, payload),
        providerType: snapshot.providerType,
        model: payload?.model,
        budget: projectEffectiveBudget(budget)
      };
      return true;
    }

    getStatus() {
      try {
        const config = settingsRepository.getActiveProviderConfig?.() || null;
        let baseUrl = "configured endpoint";
        try {
          const parsed = new URL(config?.baseUrl || "");
          baseUrl = `${parsed.origin}${parsed.pathname}`.replace(/\/$/, "");
        } catch (_error) {
          baseUrl = config?.baseUrl || "configured endpoint";
        }
        const v89Settings = settingsRepository.getChatPromptV89Settings?.() || {};
        const promptBlocks = settingsRepository.getPromptSettings?.()?.blocks;
        const v813Layout = settingsRepository.getChatPromptV813Layout?.() === true;
        const v89LayoutEnabled = v813Layout || v89Settings.chatPromptV89Layout !== false && (!Array.isArray(promptBlocks) || promptBlocks.some((block) => block.enabled && block.type === "history"));
        const activePromptProfile = !v89LayoutEnabled
          ? resolveProviderPromptProfile(null, false)
          : resolveProviderPromptProfile(config, v89Settings.chatPromptV810ProviderAdapter !== false);
        const runtimeProfileSplit = v813Layout || v89LayoutEnabled && v89Settings.chatPromptV89RuntimeProfileSplit === true;
        const activeLayoutId = resolvePromptLayoutId(activePromptProfile, { v89LayoutEnabled, runtimeProfileSplit, v813Layout });
        const latestEntry = this.getRecentRealRequestDiff(300).find((entry) => entry.provider === config?.providerType && entry.model === config?.defaultModel && entry.realRequestDiff?.promptProfile?.id === activePromptProfile.id && entry.realRequestDiff?.promptProfile?.layoutId === activeLayoutId) || null;
        return {
          success: true,
          provider: config?.providerType || null,
          configured: Boolean(config?.apiKey),
          model: config?.defaultModel || null,
          baseUrl,
          captureEnabled: v89Settings.chatPromptV89OutboundDiagnostics !== false,
          promptProfile: activePromptProfile.label,
          layoutId: activeLayoutId,
          staticTokens: latestEntry?.realRequestDiff?.staticTokens ?? null,
          dynamicTokens: latestEntry?.realRequestDiff?.dynamicTokens ?? null,
          globalStaticTokens: latestEntry?.realRequestDiff?.globalStaticTokens ?? null,
          conversationFrozenTokens: latestEntry?.realRequestDiff?.conversationFrozenTokens ?? null,
          responderFrozenTokens: latestEntry?.realRequestDiff?.responderFrozenTokens ?? null,
          stableKinshipTokens: latestEntry?.realRequestDiff?.stableKinshipTokens ?? null,
          actualStablePrefixTokens: latestEntry?.realRequestDiff?.actualStablePrefixTokens ?? null,
          declaredStaticTokens: latestEntry?.realRequestDiff?.declaredStaticTokens ?? null,
          dynamicTailTokens: latestEntry?.realRequestDiff?.dynamicTailTokens ?? null,
          currentPrefixFingerprint: latestEntry?.realRequestDiff?.currentPrefixFingerprint ?? null,
          previousPrefixFingerprint: latestEntry?.realRequestDiff?.previousPrefixFingerprint ?? null,
          prefixChanged: latestEntry?.realRequestDiff?.prefixChanged ?? null,
          firstChangedBlock: latestEntry?.realRequestDiff?.firstDifferentBlockId ?? null,
          reasoningEffort: config?.providerType === "zhipu" ? ["low", "high", "max"].includes(config.glmReasoningEffort) ? config.glmReasoningEffort : "low" : null,
          clearThinking: config?.providerType === "zhipu" ? config.glmClearThinking !== false : null,
          diagnosticsFile: filePath
        };
      } catch (error) {
        return { success: false, provider: null, configured: false, captureEnabled: false, error: error.message || "provider_diagnostics_unavailable" };
      }
    }

    readEntries() {
      try {
        if (!fs.existsSync(filePath)) return [];
        return fs.readFileSync(filePath, "utf8").split(/\r?\n/).filter(Boolean).map((line) => {
          try { return JSON.parse(line); } catch (_error) { return null; }
        }).filter(Boolean);
      } catch (error) {
        console.warn("[ProviderDiagnostics] Failed to read diagnostics:", error.message || error);
        return [];
      }
    }

    retainEntries(entries) {
      const retained = Array.isArray(entries) ? entries.slice(-DEFAULT_MAX_ENTRIES) : [];
      while (retained.length > 1 && Buffer.byteLength(retained.map((entry) => JSON.stringify(entry)).join("\n") + "\n", "utf8") > DEFAULT_MAX_BYTES) retained.shift();
      return retained;
    }

    writeEntries(entries) {
      fs.mkdirSync(dataDir, { recursive: true });
      const content = this.retainEntries(entries).map((entry) => JSON.stringify(entry)).join("\n");
      fs.writeFileSync(filePath, content ? `${content}\n` : "", "utf8");
    }

    append(entry) {
      try {
        const entries = this.readEntries();
        entries.push(entry);
        this.writeEntries(entries);
      } catch (error) {
        console.warn("[ProviderDiagnostics] Failed to persist diagnostics:", error.message || error);
      }
      return entry;
    }

    recordResponse({ provider, model, requestType, response, usage, metadata = {}, startedAt, completedAt, firstReasoningAt, firstVisibleContentAt }) {
      const hasRealDiff = metadata.realRequestDiff && metadata.realRequestDiff.version === "real_request_diff_v1";
      const observerToken = metadata.cacheDiagnosticsObserverToken;
      const observer = observerToken && cacheDiagnosticsObserversByToken.get(observerToken);
      const hasCacheObserver = Boolean(observer);
      const diagnosticProvider = provider || observer?.providerType || metadata.providerType;
      const diagnosticModel = model || observer?.model || metadata.model;
      const diagnosticRequestType = requestType || observer?.requestType || "unknown";
      const memoryAttemptDiagnostics = projectMemoryAttemptDiagnostics(metadata.memoryAttemptDiagnostics);
      if (!hasRealDiff && !hasCacheObserver && !memoryAttemptDiagnostics?.memoryInjectionDigest && diagnosticProvider !== "zhipu"
        && !["summary", "final_summary", "memory_recovery", "rolling_summary"].includes(diagnosticRequestType)) return null;
      const usageDebug = response?.usage_debug;
      const normalizedUsage = sanitizeUsage(normalizeProviderUsage(usageDebug?.normalized_usage || usage), true);
      const rawUsage = sanitizeUsage(usageDebug?.raw_usage || response?.usage, false);
      const messages = Array.isArray(metadata.messages) ? metadata.messages : [];
      const blocks = Array.isArray(metadata.blocks) ? metadata.blocks : [];
      const realRequestDiff = hasRealDiff ? attachProviderObservation(metadata.realRequestDiff, normalizedUsage) : null;
      const providerUsage = buildProviderUsage(normalizedUsage);
      const nativeUsageEvidence = usageFromNativeEvidence(usageDebug?.native_usage_evidence);
      const usageSource = nativeUsageEvidence || (usageDebug?.raw_usage && typeof usageDebug.raw_usage === "object" && !Array.isArray(usageDebug.raw_usage)
        ? usageDebug.raw_usage
        : response?.usage && typeof response.usage === "object" && !Array.isArray(response.usage)
          ? response.usage
          : usage?.votc_estimated === true ? { votc_estimated: true } : null);
      const cacheUsage = normalizeUsage(usageSource, {
        providerType: diagnosticProvider,
        terminalStatus: metadata.generationStatus,
        estimatedInputTokens: usage?.votc_estimated === true ? usage.prompt_tokens : undefined
      });
      const requestMeta = hasCacheObserver
        ? observer.requestMeta
        : hasRealDiff ? preparedCacheContextByDiff.get(metadata.realRequestDiff) || {} : {};
      if (hasRealDiff) preparedCacheContextByDiff.delete(metadata.realRequestDiff);
      if (hasCacheObserver) cacheDiagnosticsObserversByToken.delete(observerToken);
      const hasFinalRequestObservation = hasCacheObserver && requestMeta.effectiveRequest?.source === "ADAPTER_FINAL";
      const cacheDiagnosticsV2 = hasFinalRequestObservation ? projectCacheDiagnosticsV2({
        providerType: diagnosticProvider,
        model: diagnosticModel,
        requestType: diagnosticRequestType,
        requestDiff: hasRealDiff ? metadata.realRequestDiff : null,
        normalizedUsage: cacheUsage,
        requestMeta,
        startedAt,
        firstReasoningAt,
        firstVisibleAt: firstVisibleContentAt,
        completedAt,
        outcome: metadata.generationStatus
      }) : null;
      const entry = {
        timestamp: new Date().toISOString(),
        provider: diagnosticProvider || null,
        model: diagnosticModel || DEFAULT_MODEL,
        requestType: diagnosticRequestType,
        rawUsage,
        normalizedUsage,
        providerUsage,
        ...(provider === "gemini" ? { canonicalUsage: projectProviderUsage(metadata.providerUsage || normalizeUsage(response?.usage || usage, { providerType: provider })) } : {}),
        requestBudget: metadata.requestBudget ? {
          estimatedInputTokens: metadata.requestBudget.estimatedInputTokens,
          reservedOutputTokens: metadata.requestBudget.reservedOutputTokens,
          safetyMarginTokens: metadata.requestBudget.safetyMarginTokens,
          effectiveInputBudget: metadata.requestBudget.effectiveInputBudget,
          pressureRatio: metadata.requestBudget.pressureRatio
        } : null,
        contextBudget: metadata.contextBudget || null,
        summaryBudget: metadata.summaryBudget || null,
        activeRawMessageCount: metadata.activeRawMessageCount ?? null,
        rollingSegmentCount: metadata.rollingSegmentCount ?? null,
        cacheEpoch: metadata.cacheEpoch ?? null,
        finishReason: response?.finish_reason ?? response?.finishReason ?? null,
        truncated: ["length", "max_tokens", "max_output_tokens"].includes(response?.finish_reason ?? response?.finishReason),
        continuationAttempt: metadata.continuationAttempt ?? 0,
        actionDeferred: requestType === "chat" && ["length", "max_tokens", "max_output_tokens"].includes(response?.finish_reason ?? response?.finishReason),
        alignmentStatus: realRequestDiff?.alignmentStatus || null,
        realRequestDiff,
        cacheDiagnosticsV2,
        memoryAttemptDiagnostics,
        pairMemoryMetrics: projectPairMemoryMetrics(metadata.pairMemoryMetrics),
        localPrefixDiagnostics: buildLocalPrefixDiagnostics({ normalizedUsage, blocks, TokenCounter, messages }),
        requestStartedAt: startedAt || null,
        firstReasoningAt: firstReasoningAt || null,
        firstVisibleContentAt: firstVisibleContentAt || null,
        requestCompletedAt: completedAt || null,
        reasoningTTFTMs: startedAt && firstReasoningAt ? Math.max(0, new Date(firstReasoningAt).getTime() - new Date(startedAt).getTime()) : null,
        visibleTTFTMs: startedAt && firstVisibleContentAt ? Math.max(0, new Date(firstVisibleContentAt).getTime() - new Date(startedAt).getTime()) : null,
        outputTimeMs: firstVisibleContentAt && completedAt ? Math.max(0, new Date(completedAt).getTime() - new Date(firstVisibleContentAt).getTime()) : null,
        totalLatencyMs: startedAt && completedAt ? Math.max(0, new Date(completedAt).getTime() - new Date(startedAt).getTime()) : null,
        conversationId: realRequestDiff?.conversationId || null,
        responderId: realRequestDiff?.responderId || null,
        messageFingerprint: realRequestDiff?.messageFingerprint || null,
        effectiveRequestFingerprint: realRequestDiff?.effectiveRequestFingerprint || null,
        endpointFingerprint: realRequestDiff?.endpointFingerprint || null
      };
      return this.append(entry);
    }

    getRecent(limit = 50) {
      const count = Math.min(200, Math.max(1, Math.floor(Number(limit) || 50)));
      return this.readEntries().slice(-count).reverse();
    }

    getRecentRealRequestDiff(limit = 300) {
      const count = Math.min(300, Math.max(1, Math.floor(Number(limit) || 300)));
      return this.readEntries().filter((entry) => entry.requestType === "chat" && entry.realRequestDiff?.version === "real_request_diff_v1").slice(-count).reverse();
    }

    getRealRequestDiffStatus(limit = 300) {
      const entries = this.getRecentRealRequestDiff(limit);
      const count = Math.min(300, Math.max(1, Math.floor(Number(limit) || 300)));
      const cacheEntries = this.readEntries().map((entry) => entry.cacheDiagnosticsV2)
        .filter((entry) => entry?.schemaVersion === CACHE_DIAGNOSTICS_V2_VERSION).slice(-count).reverse();
      return {
        success: true,
        version: "real_request_diff_v1",
        captureEnabled: this.getStatus().captureEnabled,
        retainedEntries: entries.length,
        summary: summarizeRealRequestEntries(entries),
        cacheDiagnosticsV2: { summary: summarizeCacheDiagnosticsV2(cacheEntries), entries: cacheEntries },
        entries,
        memoryAttemptComparisons: this.getMemoryAttemptComparisons(limit)
      };
    }

    getMemoryAttemptComparisons(limit = 300) {
      const count = Math.min(300, Math.max(1, Math.floor(Number(limit) || 300)));
      return this.readEntries().filter(entry => entry.requestType === "chat" && entry.memoryAttemptDiagnostics?.memoryInjectionDigest)
        .slice(-count).map(entry => ({ timestamp: entry.timestamp, provider: entry.provider, model: entry.model,
          ...projectMemoryAttemptDiagnostics(entry.memoryAttemptDiagnostics),
          pairMemoryMetrics: projectPairMemoryMetrics(entry.pairMemoryMetrics),
          effectiveRequestFingerprint: /^[a-f0-9]{64}$/iu.test(entry.effectiveRequestFingerprint || "") ? entry.effectiveRequestFingerprint : null,
          sendGuardStatus: "PASSED", groundingStatus: "NOT_EVALUATED" }));
    }

    exportRealRequestDiff(limit = 300) {
      const date = new Date().toISOString().slice(0, 10);
      const exportPath = path.join(dataDir, `voct-real-request-diff-${date}.json`);
      const entries = this.getRecentRealRequestDiff(limit);
      fs.mkdirSync(dataDir, { recursive: true });
      const memoryAttemptComparisons = this.getMemoryAttemptComparisons(limit);
      fs.writeFileSync(exportPath, JSON.stringify({ version: "real_request_diff_v1", generatedAt: new Date().toISOString(), summary: summarizeRealRequestEntries(entries), entries, memoryAttemptComparisons }, null, 2), "utf8");
      return { success: true, path: exportPath, count: entries.length };
    }

    exportCacheDiagnosticsV2(limit = 300) {
      const date = new Date().toISOString().slice(0, 10);
      const exportPath = path.join(dataDir, `voct-cache-diagnostics-v2-${date}.json`);
      const count = Math.min(300, Math.max(1, Math.floor(Number(limit) || 300)));
      const entries = this.readEntries().map((entry) => entry.cacheDiagnosticsV2)
        .filter((entry) => entry?.schemaVersion === CACHE_DIAGNOSTICS_V2_VERSION).slice(-count);
      const payload = {
        schemaVersion: CACHE_DIAGNOSTICS_V2_VERSION,
        generatedAt: new Date().toISOString(),
        summary: summarizeCacheDiagnosticsV2(entries),
        entries
      };
      fs.mkdirSync(dataDir, { recursive: true });
      fs.writeFileSync(exportPath, JSON.stringify(payload, null, 2), "utf8");
      return { success: true, path: exportPath, count: entries.length };
    }

    exportRecent(limit = 300) {
      return this.exportRealRequestDiff(limit);
    }
  }

  return ProviderDiagnostics;
}

module.exports = {
  createProviderDiagnostics,
  sanitizeUsage,
  cacheMetrics,
  buildLocalPrefixDiagnostics
};
