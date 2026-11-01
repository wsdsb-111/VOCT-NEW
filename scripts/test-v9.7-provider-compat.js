"use strict";

const assert = require("node:assert/strict");
const baseline = require("./fixtures/v9.7/finish-v961");
const { normalizeFinishReason, normalizeProviderResult } = require("../src/app/main/providers/provider-result");
const providers = ["openrouter", "openai-compatible", "zhipu", "ollama", "player2", "deepseek", "gemini"];
const reasons = ["stop", "end_turn", "end_of_turn", "stop_sequence", "completed", "complete", "length", "max_tokens",
  "max_output_tokens", "max_output", "max_tokens_reached", "content_filter", "safety", "recitation", "blocked", "filtered",
  "tool_calls", "tool_call", "function_call", "tool_use", "refusal", "refused", "cancelled", "canceled", "abort", "aborted",
  "abort_error", "aborterror", "AbortError: cancelled", "error", "failed", "failure", "unknown_future_value", "", " ",
  "中文未知", "x".repeat(120), null, undefined, 0, 123, {}, [], true];
function observe(fn, makeOptions) {
  const calls = [];
  try { return { result: fn("max_tokens", makeOptions(calls)), calls }; }
  catch (error) { return { error: { name: error.name, message: error.message }, calls }; }
}
for (const makeOptions of [() => null, () => undefined, () => ({ providerType: Symbol("synthetic") }),
  calls => ({ get providerType() { calls.push("get"); return "gemini"; } }),
  calls => ({ get providerType() { calls.push("get"); throw new Error("synthetic-getter-error"); } }),
  calls => ({ providerType: { toString() { calls.push("toString"); return "gemini"; } } }),
  calls => ({ providerType: { toString() { calls.push("toString"); throw new Error("synthetic-coercion-error"); } } })]) {
  assert.deepEqual(observe(normalizeFinishReason, makeOptions), observe(baseline.normalizeFinishReason, makeOptions),
    "legacy option evaluation order, count and errors remain observable at the compatibility boundary");
}
let compared = 0;
for (const providerType of providers) {
  for (const raw of reasons.flatMap(value => typeof value === "string" ? [value, ` ${value.toUpperCase().replaceAll("_", "-")} `] : [value])) {
    assert.deepEqual(normalizeFinishReason(raw, { providerType }), baseline.normalizeFinishReason(raw, { providerType }));
    compared++;
  }
  const missing = normalizeProviderResult({ content: "synthetic", finish_reason: "stop" }, { providerType });
  assert.equal(missing.status, "COMPLETE");
  assert.equal(missing.usage.native.cachedInputTokens, null, "missing native cache usage remains unknown");
  for (const reason of ["max_tokens", "MAX-TOKENS", " max tokens "]) {
    assert.equal(normalizeProviderResult({ content: "partial", finish_reason: reason }, { providerType }).status, "TRUNCATED");
  }
  assert.equal(normalizeProviderResult({ content: "partial", finish_reason: "unknown_future_value" }, { providerType }).status, "UNKNOWN");
  assert.equal(normalizeProviderResult({ error: { name: "AbortError" } }, { providerType }).status, "CANCELLED");
}
console.log(`PASS V9.7 Provider finish boundary: ${compared} comparisons against frozen V9.6.1; seven Providers, truncation/cancellation/UNKNOWN preserved`);
