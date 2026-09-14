"use strict";

const assert = require("assert");
const { normalizeProviderUsage } = require("../resources/app/out/main/providers/usage-normalization");
const { reconcileCacheUsage } = require("../resources/app/out/main/analytics/cache-usage-reconciliation");
const { LLMManager } = require("../resources/app/out/main/provider-service");
const { OpenAICompatibleProvider, ZhipuProvider } = require("../resources/app/out/main/providers");

const raw = { prompt_tokens: 17448, completion_tokens: 456, total_tokens: 17904, prompt_tokens_details: { cached_tokens: 14336 }, completion_tokens_details: { reasoning_tokens: 234 } };
const normalized = normalizeProviderUsage(raw);
assert.strictEqual(normalized.prompt_cache_hit_tokens, 14336);
assert.strictEqual(normalized.prompt_cache_miss_tokens, 3112);
assert.strictEqual(normalized.visible_completion_tokens, 222);
for (const value of [undefined, null, "", "  ", false, -1, "invalid"]) {
  const usage = { prompt_tokens: 100, prompt_tokens_details: { cached_tokens: value } };
  assert.strictEqual(normalizeProviderUsage(usage).prompt_cache_hit_tokens, null);
  assert.strictEqual(new ZhipuProvider().normalizeUsage(usage).prompt_cache_hit_tokens, null);
}
assert.strictEqual(normalizeProviderUsage({ prompt_tokens: 100, prompt_tokens_details: { cached_tokens: 0 } }).prompt_cache_miss_tokens, 100);
assert.strictEqual(normalizeProviderUsage({ prompt_cache_hit_tokens: 10, prompt_cache_miss_tokens: 90, prompt_tokens_details: { cached_tokens: 50 } }).prompt_cache_hit_tokens, 10, "native counters take priority");
const entry = { timestamp: "2026-01-01T00:00:00.000Z", requestType: "chat", providerType: "openai-compatible", model: "fixture", promptTokens: 17448, completionTokens: 456, cacheHitTokens: null, cacheMissTokens: null };
const evidence = { timestamp: "2026-01-01T00:00:00.017Z", requestType: "chat", provider: entry.providerType, model: entry.model, rawUsage: raw };
assert.strictEqual(reconcileCacheUsage([entry], [evidence])[0].cacheHitTokens, 14336);
assert.strictEqual(entry.cacheHitTokens, null, "historical source must remain untouched");
assert.strictEqual(reconcileCacheUsage([entry], [evidence, { ...evidence }])[0].cacheHitTokens, null, "ambiguous evidence must not be assigned");
assert.strictEqual(reconcileCacheUsage([entry, { ...entry }], [evidence])[0].cacheHitTokens, null, "one provider record cannot fill two requests");
assert.strictEqual(reconcileCacheUsage([entry, { ...entry, cacheHitTokens: 14336 }], [evidence])[0].cacheHitTokens, null, "already-accounted evidence cannot be reused");
assert.strictEqual(reconcileCacheUsage([entry], [{ ...evidence, model: "other" }])[0].cacheHitTokens, null);
assert.strictEqual(reconcileCacheUsage([entry], [{ ...evidence, timestamp: "2026-01-01T00:01:00Z" }])[0].cacheHitTokens, null);

(async () => {
  const provider = new OpenAICompatibleProvider();
  const client = { chat: { completions: { create: async () => (async function* () {
    yield { id: "fixture", choices: [{ delta: { content: "OK" }, finish_reason: "stop" }] };
    yield { choices: [], usage: raw };
  })() } } };
  const iterator = provider._streamChatCompletion({ model: "fixture" }, client);
  let result;
  do { result = await iterator.next(); } while (!result.done);
  const usage = LLMManager.prototype.buildUsageRecord(result.value);
  assert.strictEqual(usage.prompt_cache_hit_tokens, 14336, "real compatible streaming adapter must retain usage-only tail and normalize nested cache");
  client.chat.completions.create = async () => ({ choices: [{ message: { content: "OK" } }], usage: raw });
  const response = await provider._nonStreamChatCompletion({ model: "fixture" }, client);
  assert.strictEqual(LLMManager.prototype.buildUsageRecord(response).prompt_cache_miss_tokens, 3112);
  console.log("V8.9.1 cache usage PASS: nested/native tri-state, streaming/non-stream, unique historical reconciliation");
})().catch(error => { console.error(error); process.exitCode = 1; });
