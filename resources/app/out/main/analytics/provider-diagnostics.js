"use strict";

const { resolveProviderPromptProfile, resolvePromptLayoutId } = require("../prompts/provider-prompt-adapter");
const { normalizeProviderUsage } = require("../providers/usage-normalization");
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

function createProviderDiagnostics({ fs, path, dataDir, settingsRepository, providerRegistry, TokenCounter, diagnosticsFile }) {
  const filePath = diagnosticsFile || path.join(dataDir, "provider-diagnostics.jsonl");
  const previousRealRequestByRoute = new Map();
  const previousRealRequestByConversation = new Map();

  class ProviderDiagnostics {
    prepareOutboundRequest({ provider, model, requestType, request, messages, blocks, conversationId, responderId, baseUrl, promptProfile, staticTokens, dynamicTokens }) {
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
        TokenCounter
      });
      const previousRoute = previousRealRequestByRoute.get(current.routeScopeKey) || null;
      const canCompareConversation = current.conversationId != null && current.responderId != null;
      const previousConversation = canCompareConversation ? previousRealRequestByConversation.get(current.conversationScopeKey) || null : null;
      const diff = buildRealRequestDiff({ previousRoute, previousConversation, current, TokenCounter });
      previousRealRequestByRoute.set(current.routeScopeKey, current);
      if (canCompareConversation) previousRealRequestByConversation.set(current.conversationScopeKey, current);
      return diff;
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
        const v89LayoutEnabled = v89Settings.chatPromptV89Layout !== false && (!Array.isArray(promptBlocks) || promptBlocks.some((block) => block.enabled && block.type === "history"));
        const activePromptProfile = !v89LayoutEnabled
          ? resolveProviderPromptProfile(null, false)
          : resolveProviderPromptProfile(config, v89Settings.chatPromptV810ProviderAdapter !== false);
        const runtimeProfileSplit = v89LayoutEnabled && v89Settings.chatPromptV89RuntimeProfileSplit === true;
        const activeLayoutId = resolvePromptLayoutId(activePromptProfile, { v89LayoutEnabled, runtimeProfileSplit });
        const latestEntry = this.getRecentRealRequestDiff(300).find((entry) => entry.provider === config?.providerType && entry.model === config?.defaultModel && entry.realRequestDiff?.promptProfile?.id === activePromptProfile.id && entry.realRequestDiff?.promptProfile?.layoutId === activeLayoutId) || null;
        return {
          success: true,
          provider: config?.providerType || null,
          configured: Boolean(config?.apiKey),
          model: config?.defaultModel || null,
          baseUrl,
          captureEnabled: v89Settings.chatPromptV89OutboundDiagnostics !== false,
          promptProfile: activePromptProfile.label,
          staticTokens: latestEntry?.realRequestDiff?.staticTokens ?? null,
          dynamicTokens: latestEntry?.realRequestDiff?.dynamicTokens ?? null,
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
      if (!hasRealDiff && provider !== "zhipu") return null;
      const usageDebug = response?.usage_debug;
      const normalizedUsage = sanitizeUsage(normalizeProviderUsage(usageDebug?.normalized_usage || usage), true);
      const rawUsage = sanitizeUsage(usageDebug?.raw_usage || response?.usage, false);
      const messages = Array.isArray(metadata.messages) ? metadata.messages : [];
      const blocks = Array.isArray(metadata.blocks) ? metadata.blocks : [];
      const realRequestDiff = hasRealDiff ? attachProviderObservation(metadata.realRequestDiff, normalizedUsage) : null;
      const providerUsage = buildProviderUsage(normalizedUsage);
      const entry = {
        timestamp: new Date().toISOString(),
        provider: provider || null,
        model: model || DEFAULT_MODEL,
        requestType: requestType || "unknown",
        rawUsage,
        normalizedUsage,
        providerUsage,
        alignmentStatus: realRequestDiff?.alignmentStatus || null,
        realRequestDiff,
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
      return {
        success: true,
        version: "real_request_diff_v1",
        captureEnabled: this.getStatus().captureEnabled,
        retainedEntries: entries.length,
        summary: summarizeRealRequestEntries(entries),
        entries
      };
    }

    exportRealRequestDiff(limit = 300) {
      const date = new Date().toISOString().slice(0, 10);
      const exportPath = path.join(dataDir, `voct-real-request-diff-${date}.json`);
      const entries = this.getRecentRealRequestDiff(limit);
      fs.mkdirSync(dataDir, { recursive: true });
      fs.writeFileSync(exportPath, JSON.stringify({ version: "real_request_diff_v1", generatedAt: new Date().toISOString(), summary: summarizeRealRequestEntries(entries), entries }, null, 2), "utf8");
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
