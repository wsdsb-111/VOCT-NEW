"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const diagnosticsPath = path.join(root, "resources", "app", "out", "main", "analytics", "real-request-diff.js");
const rendererPath = path.join(root, "resources", "app", "out", "renderer", "assets", "index-Dn3qWlAB.js");
const preloadPath = path.join(root, "resources", "app", "out", "preload", "preload.js");
const ipcPath = path.join(root, "resources", "app", "out", "main", "ipc", "register-ipc.js");
const { TokenCounter } = require(path.join(root, "resources", "app", "out", "main", "provider-service.js"));
const { buildRealRequestSnapshot, buildRealRequestDiff, attachProviderObservation } = require(diagnosticsPath);

const endpoint = { providerType: "zhipu", model: "glm-5.3-flash", baseUrl: "https://open.bigmodel.cn/api/paas/v4" };
const blocks = [{ id: "stable", messageStartPosition: 0, messageCount: 1 }, { id: "history", messageStartPosition: 1, messageCount: 1 }];
const build = (content, timestamp) => buildRealRequestSnapshot({
  ...endpoint,
  request: { model: endpoint.model, messages: [{ role: "system", content: "SECRET_STABLE_CONTENT" }, { role: "user", content }], stream: true, temperature: 0.7, max_tokens: 4096, thinking: { type: "enabled", clear_thinking: true }, reasoning_effort: "low" },
  conversationId: "conv_fixture",
  responderId: "1001",
  blocks,
  TokenCounter,
  timestamp
});
const first = build("SECRET_USER_A", "2026-09-14T10:00:00.000Z");
const second = build("SECRET_USER_B", "2026-09-14T10:00:12.000Z");
const comparison = buildRealRequestDiff({ previousRoute: first, previousConversation: first, current: second, TokenCounter });
assert.strictEqual(comparison.firstDifferentMessagePosition, 1);
assert.strictEqual(comparison.firstDifferentBlockId, "history");
assert.strictEqual(comparison.sameEffectiveParameters, true);
assert(comparison.estimatedCommonPrefixTokens > 0);
assert.doesNotMatch(JSON.stringify(comparison), /SECRET_STABLE_CONTENT|SECRET_USER_[AB]/);
const observed = attachProviderObservation({ ...comparison, estimatedCommonPrefixTokens: 9000, sameEffectiveParameters: true, intervalMs: 12000 }, { prompt_tokens: 10000, prompt_cache_hit_tokens: 0, prompt_cache_miss_tokens: 10000, cache_reporting_status: "reported" });
assert.strictEqual(observed.alignmentStatus, "provider_zero_despite_large_prefix");

const renderer = fs.readFileSync(rendererPath, "utf8");
const preload = fs.readFileSync(preloadPath, "utf8");
const ipc = fs.readFileSync(ipcPath, "utf8");
assert.match(renderer, /Real Request Diff/);
assert.match(renderer, /Prefix Length Buckets/);
assert.match(renderer, /Route Scope Prefix/);
assert.match(renderer, /Provider Cached/);
assert.doesNotMatch(renderer, /GLM 缓存路径诊断结果|TTL 探针|缓存时效/);
assert.match(preload, /exportRealRequestDiff/);
assert.match(ipc, /provider-diagnostics:export-real-request-diff/);
console.log("VOTC V8.9 outbound diagnostics: PASS (real request diff, same-scope prefix comparison and provider alignment)");
