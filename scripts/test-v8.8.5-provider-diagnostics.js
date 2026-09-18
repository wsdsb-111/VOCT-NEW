"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const root = path.resolve(__dirname, "..");
const rendererPath = path.join(root, "resources", "app", "out", "renderer", "assets", "index-Dn3qWlAB.js");
const preloadPath = path.join(root, "resources", "app", "out", "preload", "preload.js");
const ipcPath = path.join(root, "resources", "app", "out", "main", "ipc", "register-ipc.js");
const { TokenCounter } = require(path.join(root, "resources", "app", "out", "main", "provider-service.js"));
const { createProviderDiagnostics, sanitizeUsage, cacheMetrics } = require(path.join(root, "resources", "app", "out", "main", "analytics", "provider-diagnostics.js"));

assert.deepStrictEqual(sanitizeUsage({ prompt_tokens: 10, completion_tokens: 2, total_tokens: 12, prompt_tokens_details: { cached_tokens: 0 }, secret: "must not persist" }), {
  prompt_tokens: 10,
  completion_tokens: 2,
  total_tokens: 12,
  prompt_tokens_details: { cached_tokens: 0 }
});
assert.deepStrictEqual(cacheMetrics({ prompt_cache_hit_tokens: 0, prompt_cache_miss_tokens: 10, cache_reporting_status: "reported" }), { hit: 0, miss: 10, hitRate: 0, reportingStatus: "reported" });
assert.strictEqual(cacheMetrics({}).reportingStatus, "not_reported");

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "votc-provider-diagnostics-"));
let adapterEnabled = true;
let historyEnabled = true;
let runtimeProfileSplit = false;
const service = new (createProviderDiagnostics({
  fs,
  path,
  dataDir: tempDir,
  settingsRepository: {
    getActiveProviderConfig: () => ({ providerType: "zhipu", apiKey: "fixture-key", defaultModel: "glm-5.3-flash", baseUrl: "https://open.bigmodel.cn/api/paas/v4", glmReasoningEffort: "low", glmClearThinking: true }),
    getChatPromptV89Settings: () => ({ chatPromptV89Layout: true, chatPromptV89OutboundDiagnostics: true, chatPromptV89RuntimeProfileSplit: runtimeProfileSplit, chatPromptV810ProviderAdapter: adapterEnabled }),
    getPromptSettings: () => ({ blocks: [{ type: "history", enabled: historyEnabled }] })
  },
  providerRegistry: {},
  TokenCounter
}))();
const messagesA = [{ role: "system", content: "SECRET_SYSTEM_TEXT" }, { role: "user", content: "SECRET_USER_TEXT A" }];
const messagesB = [{ role: "system", content: "SECRET_SYSTEM_TEXT" }, { role: "user", content: "SECRET_USER_TEXT B" }];
const blocks = [{ id: "stable", messageStartPosition: 0, messageCount: 1 }, { id: "current_user", messageStartPosition: 1, messageCount: 1 }];
const request = (messages) => ({ model: "glm-5.3-flash", messages, stream: true, temperature: 0.7, max_tokens: 128, thinking: { type: "enabled", clear_thinking: true }, reasoning_effort: "low" });
const promptProfile = { id: "glm_cache_v1", label: "GLM Cache v1", historyWindow: 12, layoutId: "glm_cache_v1_v6" };
const first = service.prepareOutboundRequest({ provider: "zhipu", model: "glm-5.3-flash", requestType: "chat", request: request(messagesA), blocks, conversationId: "conv_fixture", responderId: "123", baseUrl: "https://open.bigmodel.cn/api/paas/v4", promptProfile, staticTokens: 80, dynamicTokens: 20 });
const second = service.prepareOutboundRequest({ provider: "zhipu", model: "glm-5.3-flash", requestType: "chat", request: request(messagesB), blocks, conversationId: "conv_fixture", responderId: "123", baseUrl: "https://open.bigmodel.cn/api/paas/v4", promptProfile, staticTokens: 80, dynamicTokens: 20 });
assert.strictEqual(first.comparisonStatus, "cold_local_baseline");
assert.strictEqual(second.comparisonStatus, "compared");
service.recordResponse({
  provider: "zhipu",
  model: "glm-5.3-flash",
  requestType: "chat",
  response: { usage: { prompt_tokens: 100, completion_tokens: 2, total_tokens: 102 }, usage_debug: { raw_usage: { prompt_tokens: 100, completion_tokens: 2, total_tokens: 102, prompt_tokens_details: { cached_tokens: 50 }, secret: "never stored" }, normalized_usage: { prompt_tokens: 100, completion_tokens: 2, total_tokens: 102, prompt_cache_hit_tokens: 50, prompt_cache_miss_tokens: 50, cache_reporting_status: "reported" } } },
  usage: { prompt_tokens: 100, completion_tokens: 2, total_tokens: 102, prompt_cache_hit_tokens: 50, prompt_cache_miss_tokens: 50, cache_reporting_status: "reported" },
  metadata: { realRequestDiff: second, blocks, messages: messagesB },
  startedAt: "2026-09-14T10:00:00.000Z",
  completedAt: "2026-09-14T10:00:01.000Z"
});
assert.strictEqual(service.getRecentRealRequestDiff(50).length, 1);
assert.strictEqual(service.getStatus().promptProfile, "GLM Cache v1");
assert.strictEqual(service.getStatus().staticTokens, 80);
runtimeProfileSplit = true;
assert.strictEqual(service.getStatus().staticTokens, null, "a different active layout must not reuse the previous layout token split");
runtimeProfileSplit = false;
adapterEnabled = false;
assert.strictEqual(service.getStatus().promptProfile, "V8.9 Default Layout");
assert.strictEqual(service.getStatus().staticTokens, null, "a different active profile must not reuse GLM request tokens");
adapterEnabled = true;
historyEnabled = false;
assert.strictEqual(service.getStatus().promptProfile, "V8.9 Default Layout");
assert.strictEqual(service.getStatus().dynamicTokens, null, "disabled history layout must not claim the last GLM request token split");
const persisted = fs.readFileSync(path.join(tempDir, "provider-diagnostics.jsonl"), "utf8");
assert.doesNotMatch(persisted, /SECRET_SYSTEM_TEXT|SECRET_USER_TEXT|fixture-key|never stored/);
assert.match(persisted, /real_request_diff_v1/);
assert.strictEqual(service.exportRealRequestDiff(50).success, true);
fs.rmSync(tempDir, { recursive: true, force: true });

const renderer = fs.readFileSync(rendererPath, "utf8");
const preload = fs.readFileSync(preloadPath, "utf8");
const ipc = fs.readFileSync(ipcPath, "utf8");
assert.match(renderer, /真实 Request Diff 诊断/);
assert.match(renderer, /真实请求概览/);
assert.match(renderer, /最近同 Profile 静态 Token/);
assert.match(renderer, /时间间隔 Buckets[\s\S]*formatTokens\(row\.averageEstimatedPrefixTokens\)/);
assert.match(renderer, /最近 12 条消息（含当前输入）/);
assert.match(renderer, /长历史会先正常推进滚动摘要/);
assert.match(preload, /getRealRequestDiff/);
assert.match(ipc, /provider-diagnostics:get-real-request-diff/);
assert.doesNotMatch(renderer, /缓存路径诊断|运行全部测试/);
assert.doesNotMatch(preload, /CachePathProbe|cache-path-probe/);
assert.doesNotMatch(ipc, /cache-path-probe|cache-ttl-probe/);
console.log("VOTC Provider Diagnostics: PASS (real request capture, scoped comparison, raw usage, retention and redaction)");
