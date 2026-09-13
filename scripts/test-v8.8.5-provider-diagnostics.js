"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const root = path.resolve(__dirname, "..");
const rendererPath = path.join(root, "resources", "app", "out", "renderer", "assets", "index-Dn3qWlAB.js");
const preloadPath = path.join(root, "resources", "app", "out", "preload", "preload.js");
const ipcPath = path.join(root, "resources", "app", "out", "main", "ipc", "register-ipc.js");
const mainPath = path.join(root, "resources", "app", "out", "main", "main.js");
const { TokenCounter } = require(path.join(root, "resources", "app", "out", "main", "provider-service.js"));
const { createProviderDiagnostics, sanitizeUsage, cacheMetrics } = require(path.join(root, "resources", "app", "out", "main", "analytics", "provider-diagnostics.js"));

assert.deepStrictEqual(sanitizeUsage({ prompt_tokens: 10, completion_tokens: 2, total_tokens: 12, prompt_tokens_details: { cached_tokens: 0 }, secret: "must not persist" }), {
  prompt_tokens: 10,
  completion_tokens: 2,
  total_tokens: 12,
  prompt_tokens_details: { cached_tokens: 0 }
});
assert.deepStrictEqual(cacheMetrics({ prompt_cache_hit_tokens: 0, prompt_cache_miss_tokens: 10, cache_reporting_status: "reported" }), {
  hit: 0,
  miss: 10,
  hitRate: 0,
  reportingStatus: "reported"
});
assert.strictEqual(cacheMetrics({}).reportingStatus, "not_reported");

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "votc-provider-diagnostics-"));
const calls = [];
const raw = (cachedTokens) => ({
  prompt_tokens: 10000,
  completion_tokens: 12,
  total_tokens: 10012,
  prompt_tokens_details: { cached_tokens: cachedTokens },
  completion_tokens_details: { reasoning_tokens: 4 },
  secret: "never stored"
});
const normalized = (cachedTokens) => ({
  prompt_tokens: 10000,
  completion_tokens: 12,
  total_tokens: 10012,
  prompt_cache_hit_tokens: cachedTokens,
  prompt_cache_miss_tokens: 10000 - cachedTokens,
  cache_reporting_status: "reported",
  prompt_tokens_details: { cached_tokens: cachedTokens },
  completion_tokens_details: { reasoning_tokens: 4 },
  reasoning_tokens: 4,
  visible_completion_tokens: 8
});
const provider = {
  async chatCompletion(request, config) {
    const suffix = request.messages[1].content;
    const warm = suffix.endsWith("_B") || suffix.endsWith("_T2_WARM");
    const cachedTokens = warm ? 8000 : 0;
    calls.push({ request, config });
    return {
      id: `fixture-${calls.length}`,
      content: "OK",
      usage: normalized(cachedTokens),
      usage_debug: {
        provider: "zhipu",
        raw_usage: raw(cachedTokens),
        normalized_usage: normalized(cachedTokens)
      }
    };
  },
  async testConnection() {
    return { success: true, message: "fixture connection" };
  }
};
const service = new (createProviderDiagnostics({
  fs,
  path,
  dataDir: tempDir,
  settingsRepository: {
    getProviderConfigById: () => ({ providerType: "zhipu", apiKey: "fixture-key", defaultModel: "glm-5.3-flash", baseUrl: "https://open.bigmodel.cn/api/paas/v4", glmReasoningEffort: "low", glmClearThinking: true })
  },
  providerRegistry: { createProvider: () => provider },
  TokenCounter
}))();

(async () => {
  const probe = await service.runCacheProbe();
  assert.strictEqual(probe.success, true);
  assert.strictEqual(calls.length, 2);
  assert.strictEqual(calls[0].request.stream, false);
  assert.strictEqual(calls[0].request.messages[0].content, calls[1].request.messages[0].content, "cache probe must reuse one stable prefix");
  assert.notStrictEqual(calls[0].request.messages[1].content, calls[1].request.messages[1].content);
  assert.strictEqual(probe.first.normalizedUsage.prompt_cache_hit_tokens, 0, "explicit zero cache hit must remain zero");
  assert.strictEqual(probe.second.normalizedUsage.prompt_cache_hit_tokens, 8000);
  assert.strictEqual(probe.second.cache.hitRate, 8000 / 10000);
  assert.match(probe.conclusion, /智谱缓存正常/);

  const ab = await service.runClearThinkingAB();
  assert.strictEqual(ab.success, true);
  assert.strictEqual(calls.length, 6);
  assert.deepStrictEqual(calls.slice(2).map((call) => call.config.glmClearThinking), [true, true, false, false]);
  assert.notStrictEqual(calls[2].request.messages[0].content, calls[4].request.messages[0].content, "A/B groups must use different namespaces");
  assert.strictEqual(ab.trueGroup.warmHitRate, 8000 / 10000);
  assert.strictEqual(ab.falseGroup.warmHitRate, 8000 / 10000);

  const recent = service.getRecent(50);
  assert.strictEqual(recent.length, 6);
  const persisted = fs.readFileSync(path.join(tempDir, "provider-diagnostics.jsonl"), "utf8");
  assert.doesNotMatch(persisted, /CACHE_PROBE_A|TRUE_GROUP_STABLE_PREFIX_SEGMENT|fixture-key|never stored/);
  assert.match(persisted, /"rawUsage"/);
  const exported = service.exportRecent(50);
  assert.strictEqual(exported.success, true);
  const exportContent = fs.readFileSync(exported.path, "utf8");
  assert.doesNotMatch(exportContent, /fixture-key|never stored|STABLE_PREFIX_SEGMENT/);

  const renderer = fs.readFileSync(rendererPath, "utf8");
  const preload = fs.readFileSync(preloadPath, "utf8");
  const ipc = fs.readFileSync(ipcPath, "utf8");
  const main = fs.readFileSync(mainPath, "utf8");
  assert.match(renderer, /children: "世界书"/);
  assert.match(renderer, /children: "诊断"/);
  assert.match(renderer, /currentTab === "providerDiagnostics"/);
  assert.match(renderer, /runClearThinkingAB/);
  assert.match(preload, /providerDiagnosticsAPI/);
  assert.match(ipc, /providerDiagnostics:runCacheProbe/);
  assert.match(main, /provider-diagnostics/);
  console.log("VOTC V8.8.5 Provider Diagnostics: PASS (independent tab, raw usage, cache probe, clear_thinking A/B, retention and redaction)");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});
