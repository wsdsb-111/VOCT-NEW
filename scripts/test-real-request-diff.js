"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const root = path.resolve(__dirname, "..");
const realDiffPath = path.join(root, "resources", "app", "out", "main", "analytics", "real-request-diff.js");
const diagnosticsPath = path.join(root, "resources", "app", "out", "main", "analytics", "provider-diagnostics.js");
const providerServicePath = path.join(root, "resources", "app", "out", "main", "provider-service.js");
const providerPath = path.join(root, "resources", "app", "out", "main", "providers", "index.js");
const conversationPath = path.join(root, "resources", "app", "out", "main", "conversation", "conversation.js");
const usagePath = path.join(root, "resources", "app", "out", "main", "analytics", "usage-analytics.js");
const rendererPath = path.join(root, "resources", "app", "out", "renderer", "assets", "index-Dn3qWlAB.js");
const preloadPath = path.join(root, "resources", "app", "out", "preload", "preload.js");
const ipcPath = path.join(root, "resources", "app", "out", "main", "ipc", "register-ipc.js");
const { TokenCounter } = require(providerServicePath);
const diff = require(realDiffPath);
const diagnostics = require(diagnosticsPath);

const endpoint = { providerType: "zhipu", model: "glm-5.3-flash", baseUrl: "https://open.bigmodel.cn/api/paas/v4" };
const blocks = [
  { id: "stable_global", messageStartPosition: 0, messageCount: 1 },
  { id: "history", messageStartPosition: 1, messageCount: 1 },
  { id: "current_user", messageStartPosition: 2, messageCount: 1 }
];
const messagesA = [
  { role: "system", content: "SECRET_SYSTEM_TEXT stable" },
  { role: "user", content: "SECRET_MEMORY_TEXT history A" },
  { role: "user", content: "SECRET_USER_TEXT question A" }
];
const messagesB = [
  { role: "system", content: "SECRET_SYSTEM_TEXT stable" },
  { role: "user", content: "SECRET_MEMORY_TEXT history A plus an appended turn" },
  { role: "user", content: "SECRET_USER_TEXT question B" }
];
const request = (messages, extra = {}) => ({
  model: endpoint.model,
  messages,
  stream: true,
  temperature: 0.7,
  max_tokens: 4096,
  top_p: 0.9,
  presence_penalty: 0,
  frequency_penalty: 0,
  reasoning_effort: "low",
  thinking: { type: "enabled", clear_thinking: true },
  ...extra
});
const snapshot = (messages, conversationId = "conv_1", responderId = "12345", timestamp = "2026-09-14T10:00:00.000Z", extra = {}) => diff.buildRealRequestSnapshot({
  ...endpoint,
  request: request(messages, extra),
  conversationId,
  responderId,
  blocks,
  promptProfile: { id: "glm_cache_v2", label: "GLM Cache v2", historyWindow: 12, layoutId: "glm_cache_v2" },
  staticTokens: 8100,
  dynamicTokens: 1200,
  prefixFingerprint: "prefix-v2-fixture",
  globalStaticTokens: 5000,
  conversationFrozenTokens: 200,
  responderFrozenTokens: 2900,
  stableKinshipTokens: 300,
  actualStablePrefixTokens: 8100,
  declaredStaticTokens: 8100,
  dynamicTailTokens: 1200,
  TokenCounter,
  timestamp
});
const first = snapshot(messagesA);
const second = snapshot(messagesB, "conv_1", "12345", "2026-09-14T10:00:14.000Z");
const realDiff = diff.buildRealRequestDiff({ previousRoute: first, previousConversation: first, current: second, TokenCounter });

assert.strictEqual(diff.buildRouteScopeKey({ ...endpoint, requestType: "chat" }), "zhipu:glm-5.3-flash:chat");
assert.strictEqual(diff.buildConversationScopeKey({ ...endpoint, requestType: "chat", conversationId: "conv_1", responderId: "12345" }), "zhipu:glm-5.3-flash:chat:conv_1:12345");
assert.strictEqual(realDiff.comparisonStatus, "compared");
assert.strictEqual(realDiff.sameEndpoint, true);
assert.strictEqual(realDiff.sameEffectiveParameters, true);
assert.strictEqual(realDiff.firstDifferentMessagePosition, 1);
assert.strictEqual(realDiff.firstDifferentBlockId, "history");
assert.deepStrictEqual(realDiff.promptProfile, { id: "glm_cache_v2", label: "GLM Cache v2", historyWindow: 12, layoutId: "glm_cache_v2" });
assert.strictEqual(realDiff.staticTokens, 8100);
assert.strictEqual(realDiff.dynamicTokens, 1200);
assert.strictEqual(realDiff.globalStaticTokens, 5000);
assert.strictEqual(realDiff.conversationFrozenTokens, 200);
assert.strictEqual(realDiff.responderFrozenTokens, 2900);
assert.strictEqual(realDiff.stableKinshipTokens, 300);
assert.strictEqual(realDiff.actualStablePrefixTokens, 8100);
assert.strictEqual(realDiff.declaredStaticTokens, 8100);
assert.strictEqual(realDiff.dynamicTailTokens, 1200);
assert.strictEqual(realDiff.currentPrefixFingerprint, "prefix-v2-fixture");
assert.strictEqual(realDiff.previousPrefixFingerprint, "prefix-v2-fixture");
assert.strictEqual(realDiff.prefixChanged, false);
assert(realDiff.firstDifferentMessage.commonPrefixEstimatedTokens > 0);
assert(realDiff.firstDifferentMessage.previousChunks.length > 0);
assert(realDiff.firstDifferentMessage.currentChunks.length > 0);
assert(realDiff.estimatedCommonPrefixTokens > 0);
assert.doesNotMatch(JSON.stringify(realDiff), /SECRET_SYSTEM_TEXT|SECRET_MEMORY_TEXT|SECRET_USER_TEXT/);

const exact = snapshot(messagesA, "conv_1", "12345", "2026-09-14T10:00:30.000Z");
const exactDiff = diff.buildRealRequestDiff({ previousRoute: first, previousConversation: first, current: exact, TokenCounter });
assert.strictEqual(exactDiff.firstDifferentMessagePosition, null);
assert.strictEqual(exactDiff.estimatedCommonPrefixTokens, exact.estimatedPromptTokens);

const parameterDiff = diff.buildRealRequestDiff({
  previousRoute: first,
  previousConversation: first,
  current: snapshot(messagesA, "conv_1", "12345", "2026-09-14T10:00:45.000Z", { temperature: 0.2, thinking: { type: "enabled", clear_thinking: false } }),
  TokenCounter
});
assert.strictEqual(parameterDiff.sameEffectiveParameters, false);
assert(parameterDiff.changedFields.includes("temperature"));
assert(parameterDiff.changedFields.includes("thinking.clear_thinking"));

const switched = snapshot(messagesA, "conv_2", "99999", "2026-09-14T10:01:00.000Z");
const switchedDiff = diff.buildRealRequestDiff({ previousRoute: second, previousConversation: null, current: switched, TokenCounter });
assert.strictEqual(switchedDiff.sameResponder, false);
assert.strictEqual(switchedDiff.sameConversation, false);
assert.strictEqual(switchedDiff.comparisonStatus, "cold_local_baseline");
assert.strictEqual(switchedDiff.routeScope.comparisonStatus, "compared");

const aligned = diff.attachProviderObservation(exactDiff, { prompt_tokens: exact.estimatedPromptTokens, prompt_cache_hit_tokens: exact.estimatedPromptTokens, prompt_cache_miss_tokens: 0, cache_reporting_status: "reported" });
assert.strictEqual(aligned.alignmentStatus, "aligned");
assert.strictEqual(aligned.cacheToEstimatedPrefixRatio, 1);
const anomaly = diff.attachProviderObservation({ ...realDiff, estimatedCommonPrefixTokens: 9000, sameEffectiveParameters: true, intervalMs: 14000 }, { prompt_tokens: 10000, prompt_cache_hit_tokens: 0, prompt_cache_miss_tokens: 10000, cache_reporting_status: "reported" });
assert.strictEqual(anomaly.alignmentStatus, "provider_zero_despite_large_prefix");
assert.strictEqual(diff.classifyAlignment({ cachedTokens: null, estimatedCommonPrefixTokens: 9000 }), "insufficient");
const summary = diff.summarizeRealRequestEntries([
  { requestType: "chat", provider: "zhipu", model: endpoint.model, realRequestDiff: aligned, providerUsage: aligned.providerUsage, alignmentStatus: aligned.alignmentStatus },
  { requestType: "chat", provider: "zhipu", model: endpoint.model, realRequestDiff: anomaly, providerUsage: anomaly.providerUsage, alignmentStatus: anomaly.alignmentStatus }
]);
assert.strictEqual(summary.requests, 2);
assert.strictEqual(summary.highValueAnomalies, 1);
assert(summary.prefixBuckets.length >= 8);

(async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "votc-real-request-diff-"));
  const ProviderDiagnostics = diagnostics.createProviderDiagnostics({
    fs,
    path,
    dataDir: tempDir,
    settingsRepository: {
      getActiveProviderConfig: () => ({ ...endpoint, apiKey: "fixture-key", glmReasoningEffort: "low", glmClearThinking: true }),
      getChatPromptV89Settings: () => ({ chatPromptV89OutboundDiagnostics: true })
    },
    providerRegistry: {},
    TokenCounter
  });
  const service = new ProviderDiagnostics();
  const promptProfile = { id: "glm_cache_v2", label: "GLM Cache v2", historyWindow: 12, layoutId: "glm_cache_v2" };
  const baseline = service.prepareOutboundRequest({ provider: endpoint.providerType, model: endpoint.model, requestType: "chat", request: request(messagesA), blocks, conversationId: "conv_1", responderId: "12345", baseUrl: endpoint.baseUrl, promptProfile, staticTokens: 8100, dynamicTokens: 1200 });
  const captured = service.prepareOutboundRequest({ provider: endpoint.providerType, model: endpoint.model, requestType: "chat", request: request(messagesB), blocks, conversationId: "conv_1", responderId: "12345", baseUrl: endpoint.baseUrl, promptProfile, staticTokens: 8100, dynamicTokens: 1200 });
  assert.strictEqual(baseline.comparisonStatus, "cold_local_baseline");
  assert.strictEqual(captured.comparisonStatus, "compared");
  const usage = { prompt_tokens: 12000, completion_tokens: 10, total_tokens: 12010, prompt_cache_hit_tokens: 9000, prompt_cache_miss_tokens: 3000, cache_reporting_status: "reported" };
  service.recordResponse({ provider: "zhipu", model: endpoint.model, requestType: "chat", response: { usage, usage_debug: { raw_usage: { ...usage, prompt_tokens_details: { cached_tokens: 9000 }, secret: "never persist" }, normalized_usage: usage } }, usage, metadata: { realRequestDiff: captured, blocks, messages: messagesB }, startedAt: "2026-09-14T10:00:14.000Z", completedAt: "2026-09-14T10:00:15.000Z" });
  const report = service.getRealRequestDiffStatus(300);
  assert.strictEqual(report.entries.length, 1);
  assert.strictEqual(report.entries[0].realRequestDiff.firstDifferentBlockId, "history");
  assert.strictEqual(report.entries[0].realRequestDiff.promptProfile.label, "GLM Cache v2");
  assert.strictEqual(report.entries[0].realRequestDiff.staticTokens, 8100);
  assert.strictEqual(report.entries[0].providerUsage.cachedTokens, 9000);
  const persisted = fs.readFileSync(path.join(tempDir, "provider-diagnostics.jsonl"), "utf8");
  assert.doesNotMatch(persisted, /SECRET_SYSTEM_TEXT|SECRET_MEMORY_TEXT|SECRET_USER_TEXT|fixture-key|never persist/);
  assert.match(persisted, /real_request_diff_v1/);
  const exported = service.exportRealRequestDiff(300);
  assert.strictEqual(exported.success, true);
  assert.doesNotMatch(fs.readFileSync(exported.path, "utf8"), /SECRET_SYSTEM_TEXT|SECRET_MEMORY_TEXT|SECRET_USER_TEXT/);
  fs.rmSync(tempDir, { recursive: true, force: true });
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

const renderer = fs.readFileSync(rendererPath, "utf8");
const preload = fs.readFileSync(preloadPath, "utf8");
const ipc = fs.readFileSync(ipcPath, "utf8");
assert.match(fs.readFileSync(providerServicePath, "utf8"), /realRequestDiff/);
assert.match(fs.readFileSync(providerPath, "utf8"), /buildDiagnosticRequest/);
assert.match(fs.readFileSync(conversationPath, "utf8"), /conversationId: this\.id/);
assert.match(fs.readFileSync(conversationPath, "utf8"), /responderId: npc\.id/);
assert.match(renderer, /真实 Request Diff 诊断/);
assert.match(renderer, /GLM Cache v2/);
assert.match(renderer, /当前 Prompt Profile/);
assert.match(renderer, /V8\.10\.2 Provider Prompt Adapter/);
assert.match(renderer, /Global Static/);
assert.match(renderer, /Conversation Frozen/);
assert.match(renderer, /Responder Frozen/);
assert.match(renderer, /Stable Kinship/);
assert.match(renderer, /当前 Prefix Fingerprint/);
assert.match(renderer, /Prefix Length Buckets/);
assert.doesNotMatch(renderer, /缓存路径诊断|运行全部测试|TTL 探针|cachePathProbe|CachePathProbe/);
assert.match(preload, /getRealRequestDiff/);
assert.match(preload, /exportRealRequestDiff/);
assert.doesNotMatch(preload, /CachePathProbe|cache-path-probe/);
assert.match(ipc, /provider-diagnostics:get-real-request-diff/);
assert.match(ipc, /provider-diagnostics:export-real-request-diff/);
assert.doesNotMatch(ipc, /cache-path-probe|cache-ttl-probe/);
assert.doesNotMatch(fs.readFileSync(usagePath, "utf8"), /cache_path_/);
assert(!fs.existsSync(path.join(root, "resources", "app", "out", "main", "analytics", "cache-path-probe.js")));
assert(!fs.existsSync(path.join(root, "scripts", "test-v8.9.1-test2-cache-path-probe.js")));
console.log("VOTC Real Request Diff: PASS (scoped message diff, effective parameter diff, chunk hashes, Provider alignment, bucket aggregation, redaction and replacement wiring)");
