"use strict";

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
  const hit = finiteNumber(usage?.prompt_cache_hit_tokens);
  const miss = finiteNumber(usage?.prompt_cache_miss_tokens);
  const total = hit != null && miss != null ? hit + miss : 0;
  return {
    hit,
    miss,
    hitRate: total > 0 ? hit / total : null,
    reportingStatus: usage?.cache_reporting_status === "reported" || hit != null ? "reported" : "not_reported"
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

  class ProviderDiagnostics {
    getProviderConfig() {
      const config = settingsRepository.getProviderConfigById("zhipu") || settingsRepository.getActiveProviderConfig?.();
      if (!config || config.providerType !== "zhipu") throw new Error("zhipu_provider_not_configured");
      return {
        ...config,
        defaultModel: config.defaultModel || DEFAULT_MODEL,
        baseUrl: config.baseUrl || "https://open.bigmodel.cn/api/paas/v4"
      };
    }

    getStatus() {
      try {
        const config = this.getProviderConfig();
        let baseUrl = "configured endpoint";
        try {
          const parsed = new URL(config.baseUrl);
          baseUrl = `${parsed.origin}${parsed.pathname}`.replace(/\/$/, "");
        } catch (_error) {
          baseUrl = "configured endpoint";
        }
        return {
          success: true,
          provider: "zhipu",
          configured: Boolean(config.apiKey),
          model: config.defaultModel,
          baseUrl,
          reasoningEffort: ["low", "high", "max"].includes(config.glmReasoningEffort) ? config.glmReasoningEffort : "low",
          clearThinking: config.glmClearThinking !== false,
          diagnosticsFile: filePath
        };
      } catch (error) {
        return { success: false, provider: "zhipu", configured: false, error: error.message || "zhipu_provider_not_configured" };
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

    recordResponse({ provider, model, requestType, response, usage, metadata = {}, startedAt, completedAt }) {
      if (provider !== "zhipu") return null;
      const usageDebug = response?.usage_debug;
      const normalizedUsage = sanitizeUsage(usageDebug?.normalized_usage || usage, true);
      const rawUsage = sanitizeUsage(usageDebug?.raw_usage, false);
      const messages = Array.isArray(metadata.messages) ? metadata.messages : [];
      const blocks = Array.isArray(metadata.blocks) ? metadata.blocks : [];
      const entry = {
        timestamp: new Date().toISOString(),
        provider,
        model: model || DEFAULT_MODEL,
        requestType: requestType || "unknown",
        rawUsage,
        normalizedUsage,
        localPrefixDiagnostics: buildLocalPrefixDiagnostics({ normalizedUsage, blocks, TokenCounter, messages }),
        requestStartedAt: startedAt || null,
        requestCompletedAt: completedAt || null,
        totalLatencyMs: startedAt && completedAt ? Math.max(0, new Date(completedAt).getTime() - new Date(startedAt).getTime()) : null
      };
      return this.append(entry);
    }

    async request(config, { namespace, suffix, clearThinking, requestType }) {
      const provider = providerRegistry.createProvider(config);
      const stablePrefix = Array.from({ length: 640 }, (_, index) => `${namespace}_STABLE_PREFIX_SEGMENT_${String(index).padStart(4, "0")}: fixed diagnostic text for provider cache observation.`).join("\n");
      const messages = [
        { role: "system", content: stablePrefix },
        { role: "user", content: suffix }
      ];
      const startedAt = new Date().toISOString();
      const startedMs = Date.now();
      const response = await provider.chatCompletion({
        model: config.defaultModel,
        messages,
        stream: false,
        max_tokens: 32,
        temperature: 0,
        reasoning_effort: "low",
        thinking: { type: "enabled", clear_thinking: clearThinking }
      }, { ...config, glmReasoningEffort: "low", glmClearThinking: clearThinking });
      const completedAt = new Date().toISOString();
      const normalizedUsage = response?.usage_debug?.normalized_usage || response?.usage;
      const prefixTokens = typeof TokenCounter?.calculateTotalTokens === "function" ? TokenCounter.calculateTotalTokens([{ role: "system", content: stablePrefix }]) : 0;
      const entry = this.recordResponse({
        provider: "zhipu",
        model: config.defaultModel,
        requestType,
        response,
        usage: normalizedUsage,
        metadata: {
          messages,
          blocks: [{ id: `${namespace.toLowerCase()}_stable_prefix`, label: "Synthetic Stable Prefix", tokens: prefixTokens, stable: true }]
        },
        startedAt,
        completedAt
      });
      return {
        ...entry,
        totalLatencyMs: Math.max(0, Date.now() - startedMs),
        cache: cacheMetrics(entry?.normalizedUsage)
      };
    }

    async testConnection() {
      const config = this.getProviderConfig();
      if (!config.apiKey) return { success: false, error: "zhipu_api_key_missing" };
      const provider = providerRegistry.createProvider(config);
      const response = await provider.testConnection(config);
      return { ...response, provider: "zhipu", model: config.defaultModel };
    }

    async runCacheProbe() {
      const config = this.getProviderConfig();
      if (!config.apiKey) return { success: false, error: "zhipu_api_key_missing" };
      try {
        const first = await this.request(config, {
          namespace: "CACHE_PROBE_A",
          suffix: "CACHE_PROBE_A",
          clearThinking: true,
          requestType: "cache_probe"
        });
        const second = await this.request(config, {
          namespace: "CACHE_PROBE_A",
          suffix: "CACHE_PROBE_B",
          clearThinking: true,
          requestType: "cache_probe"
        });
        const secondCache = second.cache;
        const conclusion = secondCache.reportingStatus !== "reported" ? "⚠ Provider 未报告 cached_tokens" : secondCache.hit > 0 ? "✓ 智谱缓存正常" : "⚠ Provider 未观察到缓存命中";
        return { success: true, provider: "zhipu", model: config.defaultModel, first, second, conclusion };
      } catch (error) {
        return { success: false, error: error.message || "zhipu_cache_probe_failed" };
      }
    }

    async runClearThinkingAB() {
      const config = this.getProviderConfig();
      if (!config.apiKey) return { success: false, error: "zhipu_api_key_missing" };
      try {
        const runGroup = async (clearThinking, namespace) => {
          const cold = await this.request(config, { namespace, suffix: `${namespace}_T1_COLD`, clearThinking, requestType: "clear_thinking_ab" });
          const warm = await this.request(config, { namespace, suffix: `${namespace}_T2_WARM`, clearThinking, requestType: "clear_thinking_ab" });
          return { clearThinking, cold, warm, warmHitRate: warm.cache.hitRate };
        };
        const trueGroup = await runGroup(true, "TRUE_GROUP");
        const falseGroup = await runGroup(false, "FALSE_GROUP");
        const trueRate = trueGroup.warmHitRate;
        const falseRate = falseGroup.warmHitRate;
        const difference = trueRate != null && falseRate != null ? trueRate - falseRate : null;
        const conclusion = trueRate == null || falseRate == null ? "⚠ Provider 未报告 cached_tokens，无法完成 A/B 判定" : trueRate === 0 && falseRate > 0 || falseRate === 0 && trueRate > 0 ? "⚠ clear_thinking 可能影响缓存，需优先复核" : "✓ 未观察到 clear_thinking 的高优先级缓存影响";
        return { success: true, provider: "zhipu", model: config.defaultModel, trueGroup, falseGroup, difference, conclusion };
      } catch (error) {
        return { success: false, error: error.message || "zhipu_clear_thinking_ab_failed" };
      }
    }

    getRecent(limit = 50) {
      const count = Math.min(200, Math.max(1, Math.floor(Number(limit) || 50)));
      return this.readEntries().slice(-count).reverse();
    }

    exportRecent(limit = 50) {
      const date = new Date().toISOString().slice(0, 10);
      const exportPath = path.join(dataDir, `voct-provider-diagnostics-${date}.json`);
      const entries = this.getRecent(limit);
      fs.mkdirSync(dataDir, { recursive: true });
      fs.writeFileSync(exportPath, JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), entries }, null, 2), "utf8");
      return { success: true, path: exportPath, count: entries.length };
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
