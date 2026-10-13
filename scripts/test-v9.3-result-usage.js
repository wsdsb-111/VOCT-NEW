"use strict";

const assert = require("assert");
const {
  normalizeFinishReason,
  normalizeProviderResult,
  toLegacyResult
} = require("../src/app/main/providers/provider-result");
const { normalizeProviderUsage, normalizeUsage } = require("../src/app/main/providers/usage-normalization");
for (const absent of [undefined, null]) {
  const projected = normalizeUsage({ prompt_tokens: 75, completion_tokens: 127, total_tokens: 202,
    prompt_cache_hit_tokens: absent, prompt_cache_miss_tokens: absent, reasoning_tokens: absent,
    prompt_tokens_details: { cached_tokens: 0 }, completion_tokens_details: { reasoning_tokens: 79 } }, { providerType: "openrouter" });
  assert.deepStrictEqual(projected.provenance.inconsistentFields, [], "optional missing adapter fields are not invalid provider values");
  assert.equal(projected.provenance.status, "PARTIAL");
  assert.equal(projected.native.cacheMissTokens, null, "unreported miss remains native UNKNOWN");
  assert.equal(projected.provenance.derived.cacheMissTokens, 75);
  assert.equal(projected.provenance.fieldSources.cacheMissTokens, "DERIVED");
  assert.equal(projected.native.cachedInputTokens, 0);
  assert.equal(projected.native.reasoningTokens, 79);
}
for (const invalid of ["bad", -1]) {
  const projected = normalizeUsage({ prompt_tokens: 75, prompt_cache_hit_tokens: 0, prompt_cache_miss_tokens: invalid });
  assert.equal(projected.provenance.status, "INCONSISTENT");
  assert.equal(projected.provenance.fieldSources.cacheMissTokens, "INVALID");
  assert.equal(projected.provenance.derived.cacheMissTokens, null, "an invalid reported field must not be hidden by a derived number");
}
const { validateComplete, validateGenerationOutcome } = require("../src/app/main/providers/generation-outcome");

function testFinishReasonsAndStrictCompletion() {
  assert.deepStrictEqual(normalizeFinishReason("stop"), { raw: "stop", normalized: "STOP" });
  assert.equal(normalizeFinishReason("MAX_TOKENS", { providerType: "gemini" }).normalized, "LENGTH");
  assert.equal(normalizeFinishReason("SAFETY", { providerType: "gemini" }).normalized, "FILTERED");
  assert.equal(normalizeFinishReason("tool_calls").normalized, "TOOL_CALLS");
  assert.equal(normalizeFinishReason("AbortError: cancelled").normalized, "CANCELLED");
  assert.equal(normalizeFinishReason("new_provider_enum").normalized, "UNKNOWN");
  assert.equal(normalizeFinishReason(null).normalized, "UNKNOWN");

  assert.equal(validateComplete({ content: "text without terminal" }), false);
  assert.equal(validateComplete({ content: "text", finish_reason: "new_provider_enum" }), false);
  assert.equal(validateComplete({ content: "text", finish_reason: "stop" }), true);
  assert.equal(validateComplete({ content: "partial", finish_reason: "length" }), false);
  assert.equal(validateComplete({ content: "filtered", finish_reason: "content_filter" }), false);
  assert.equal(validateComplete({ content: "refused", finish_reason: "refusal" }), false);
  assert.equal(validateComplete({ content: "refused", refusal: "safety policy", finish_reason: "stop" }), false);
  assert.equal(validateComplete({ content: "proposal", finish_reason: "tool_calls" }), false);
  assert.equal(validateComplete({ content: "cancelled", finish_reason: "cancelled" }), false);
  assert.equal(normalizeProviderResult({ content: "partial", error: { name: "AbortError" } }).status, "CANCELLED");
  assert.equal(normalizeProviderResult({ content: "", error: { code: "tenant-secret-17" } }).error, "PROVIDER_ERROR",
    "canonical errors must not echo arbitrary provider-supplied strings");
  assert.equal(validateComplete({ content: "error", finish_reason: "error" }), false);
  assert.equal(validateComplete({ content: "{\"ok\":true}", finish_reason: "stop" }, { requireJson: true }), true);
  assert.equal(validateComplete({ content: "{", finish_reason: "stop" }, { requireJson: true }), false);

  assert.equal(validateComplete(normalizeProviderResult({ content: "text", finish_reason: "stop" }, { terminalStatus: "UNKNOWN" })), false,
    "an unknown business terminal cannot pass because content is nonempty");
  assert.equal(validateComplete(normalizeProviderResult({ content: "text", finish_reason: "stop" }, { terminalStatus: "FINISHED" })), true);
  assert.equal(validateComplete(normalizeProviderResult({ content: "text", terminalStatus: "FINISHED" })), false,
    "a successful stream status without a provider finish reason is not strict completion");
  assert.equal(normalizeProviderResult({ content: "text", finish_reason: null, choices: [{ finish_reason: "stop", message: { content: "text" } }] }).finish.normalized, "STOP",
    "a null aggregate finish must not mask a known provider choice finish");
  assert.equal(validateGenerationOutcome({ content: "legacy fixture" }).complete, false,
    "strict completion is the default");
  assert.equal(validateGenerationOutcome({ content: "legacy fixture" }, { strict: false }).complete, true,
    "legacy permissive behavior is available only when explicitly requested");
}

function testTypedResultAndLegacyProjection() {
  const original = {
    content: "answer",
    tool_calls: [{ id: "call-1", function: { name: "lookup", arguments: "{}" } }],
    finish_reason: "stop",
    usage: { prompt_tokens: 12, completion_tokens: 3, total_tokens: 15 },
    provider: "openai-compatible",
    model: "fixture-model",
    reasoning: "private reasoning text"
  };
  const result = normalizeProviderResult(original, { providerType: "openai-compatible" });
  assert.equal(result.status, "COMPLETE");
  assert.equal(result.content, "answer");
  assert.equal(result.toolCalls.length, 1);
  assert.deepStrictEqual(result.finish, { raw: "stop", normalized: "STOP", source: "provider" });
  assert.equal(result.provider, "openai-compatible");
  assert.equal(result.model, "fixture-model");
  assert.deepStrictEqual(result.reasoning, { present: true, tokenCount: null, source: "response" });
  assert.equal(Object.prototype.hasOwnProperty.call(result, "reasoningText"), false);
  assert.equal(JSON.stringify(result).includes("private reasoning text"), false);

  const legacy = toLegacyResult(original, result);
  assert.equal(legacy.content, original.content);
  assert.deepStrictEqual(legacy.tool_calls, original.tool_calls);
  assert.equal(legacy.finish_reason, original.finish_reason);
  assert.deepStrictEqual(legacy.usage, original.usage);
  assert.strictEqual(legacy.votc_result, result);
  assert.equal(validateComplete(legacy), true);
}

function testNativeUsageProvenance() {
  const reportedZero = normalizeUsage({
    prompt_tokens: 100,
    completion_tokens: 10,
    total_tokens: 110,
    prompt_tokens_details: { cached_tokens: 0 },
    completion_tokens_details: { reasoning_tokens: 4 }
  }, { providerType: "zhipu" });
  assert.equal(reportedZero.native.inputTokens, 100);
  assert.equal(reportedZero.native.outputTokens, 10);
  assert.equal(reportedZero.native.cachedInputTokens, 0);
  assert.equal(reportedZero.native.reasoningTokens, 4);
  assert.equal(reportedZero.native.totalTokens, 110);
  assert.equal(reportedZero.provenance.cacheStatus, "REPORTED_ZERO");
  assert.equal(reportedZero.provenance.fieldSources.cachedInputTokens, "PROVIDER_REPORTED");
  assert.equal(reportedZero.provenance.fieldSources.cacheMissTokens, "DERIVED");
  assert.equal(reportedZero.provenance.derived.cacheMissTokens, 100);

  const missing = normalizeUsage({ prompt_tokens: 100, completion_tokens: 10 }, { providerType: "zhipu" });
  assert.equal(missing.native.cachedInputTokens, null);
  assert.equal(missing.native.cacheMissTokens, null);
  assert.equal(missing.native.reasoningTokens, null, "unreported reasoning is unknown, not zero");
  assert.equal(missing.provenance.cacheStatus, "NOT_REPORTED");
  assert.equal(missing.provenance.status, "PARTIAL");
  assert.equal(missing.provenance.fieldSources.reasoningTokens, "NOT_REPORTED");
  assert.equal(normalizeUsage(undefined, { terminalStatus: "UNKNOWN" }).provenance.status, "UNKNOWN");

  const invalidCache = normalizeUsage({ prompt_tokens: 100, completion_tokens: 10, prompt_cache_hit_tokens: "not-a-number" }, { providerType: "deepseek" });
  assert.equal(invalidCache.native.inputTokens, 100, "a bad cache field must not discard valid native input usage");
  assert.equal(invalidCache.native.cachedInputTokens, null, "invalid cache usage must not be replaced with zero");
  assert.equal(invalidCache.provenance.status, "INCONSISTENT");
  assert.equal(invalidCache.provenance.cacheStatus, "INCONSISTENT");
  assert.ok(invalidCache.provenance.inconsistentFields.includes("cachedInputTokens"));
  assert.equal(invalidCache.provenance.fieldSources.cachedInputTokens, "INVALID");

  const invalidTotal = normalizeUsage({ prompt_tokens: 100, completion_tokens: 10, total_tokens: -1 }, { providerType: "openai-compatible" });
  assert.equal(invalidTotal.native.inputTokens, 100);
  assert.equal(invalidTotal.native.outputTokens, 10);
  assert.equal(invalidTotal.native.totalTokens, null, "invalid totals remain unknown rather than becoming zero");
  assert.equal(invalidTotal.provenance.status, "INCONSISTENT");
  assert.ok(invalidTotal.provenance.inconsistentFields.includes("totalTokens"));
  assert.equal(invalidTotal.provenance.fieldSources.totalTokens, "INVALID");

  const markedEstimate = normalizeUsage({
    prompt_tokens: 40,
    completion_tokens: 8,
    total_tokens: 48,
    prompt_cache_hit_tokens: 0,
    reasoning_tokens: 2,
    votc_estimated: true
  }, { providerType: "openai-compatible" });
  assert.deepStrictEqual(markedEstimate.native, {
    inputTokens: null,
    outputTokens: null,
    cachedInputTokens: null,
    cacheMissTokens: null,
    reasoningTokens: null,
    totalTokens: null
  });
  assert.equal(markedEstimate.estimated.inputTokens, 40);
  assert.equal(markedEstimate.estimated.outputTokens, 8);
  assert.equal(markedEstimate.estimated.method, "votc_estimated");
  assert.equal(markedEstimate.provenance.status, "NOT_REPORTED");
  assert.equal(markedEstimate.provenance.estimatedSource, "votc_estimated");
  assert.equal(markedEstimate.provenance.cacheStatus, "NOT_REPORTED");

  const inconsistentHit = normalizeUsage({ prompt_tokens: 10, prompt_cache_hit_tokens: 11 }, { providerType: "deepseek" });
  assert.equal(inconsistentHit.native.cachedInputTokens, 11, "keep the provider's inconsistent count intact");
  assert.equal(inconsistentHit.native.cacheMissTokens, null, "do not derive a normal miss from inconsistent counts");
  assert.equal(inconsistentHit.provenance.status, "INCONSISTENT");
  assert.equal(inconsistentHit.provenance.cacheStatus, "INCONSISTENT");
  assert.ok(inconsistentHit.provenance.inconsistentFields.includes("cachedInputTokens"));

  const mismatchedTotal = normalizeUsage({ prompt_tokens: 10, completion_tokens: 5, total_tokens: 99 }, { providerType: "openai-compatible" });
  assert.equal(mismatchedTotal.native.totalTokens, 99, "do not rewrite a provider-reported total");
  assert.ok(mismatchedTotal.provenance.inconsistentFields.includes("totalTokens"));

  const estimated = normalizeUsage({ completion_tokens: 2 }, {
    estimatedInputTokens: 50,
    estimateTokens: value => value.length,
    content: "answer"
  });
  assert.equal(estimated.native.inputTokens, null);
  assert.equal(estimated.estimated.inputTokens, 50);
  assert.equal(estimated.estimated.outputTokens, 6);
  assert.equal(estimated.estimated.method, "local_estimator");
}

function testProviderUsageShapes() {
  const deepseek = normalizeUsage({
    prompt_tokens: 100,
    completion_tokens: 8,
    total_tokens: 108,
    prompt_cache_hit_tokens: 40,
    prompt_cache_miss_tokens: 60
  }, { providerType: "deepseek" });
  assert.equal(deepseek.native.cachedInputTokens, 40);
  assert.equal(deepseek.native.cacheMissTokens, 60);
  assert.equal(deepseek.provenance.fieldSources.cacheMissTokens, "PROVIDER_REPORTED");
  assert.equal(deepseek.provenance.cacheStatus, "REPORTED_POSITIVE");

  const gemini = normalizeUsage({ usageMetadata: {
    promptTokenCount: 120,
    candidatesTokenCount: 20,
    totalTokenCount: 140,
    cachedContentTokenCount: 30,
    thoughtsTokenCount: 2
  } }, { providerType: "gemini" });
  assert.equal(gemini.native.inputTokens, 120);
  assert.equal(gemini.native.outputTokens, 20);
  assert.equal(gemini.native.cachedInputTokens, 30);
  assert.equal(gemini.native.reasoningTokens, 2);
  assert.equal(gemini.provenance.providerUsageShape, "gemini_metadata");

  const ollama = normalizeUsage({ prompt_eval_count: 7, eval_count: 3 }, { providerType: "ollama" });
  assert.equal(ollama.native.inputTokens, 7);
  assert.equal(ollama.native.outputTokens, 3);
  assert.equal(ollama.provenance.providerUsageShape, "ollama_native");

  const tail = normalizeProviderResult({
    content: "streamed",
    finish_reason: "stop",
    usage: { prompt_tokens: 30, completion_tokens: 5, total_tokens: 35 }
  }, { providerType: "openai-compatible" });
  assert.equal(tail.usage.native.inputTokens, 30, "usage-only final payloads normalize without a choice");
}

function testSanitizedUsageSourceAndLegacyFlatShape() {
  const result = normalizeProviderResult({
    content: "ok",
    finish_reason: "stop",
    usage: { prompt_tokens: 100, completion_tokens: 5, total_tokens: 105 },
    usage_debug: { raw_usage: {
      prompt_tokens: 100,
      completion_tokens: 5,
      total_tokens: 105,
      completion_tokens_details: { reasoning_tokens: 2 },
      prompt: "private prompt",
      body: "private response body",
      secret: "fixture-secret"
    } }
  }, { providerType: "zhipu" });
  assert.equal(result.usage.native.reasoningTokens, 2,
    "canonical usage should prefer sanitized raw provider counters over a legacy zero-filled projection");
  const canonicalUsage = JSON.stringify(result.usage);
  assert.equal(canonicalUsage.includes("private prompt"), false);
  assert.equal(canonicalUsage.includes("private response body"), false);
  assert.equal(canonicalUsage.includes("fixture-secret"), false);

  const legacy = normalizeProviderUsage({
    prompt_tokens: 100,
    completion_tokens: 10,
    total_tokens: 110,
    prompt_tokens_details: { cached_tokens: 0 },
    completion_tokens_details: { reasoning_tokens: 4 }
  });
  assert.equal(legacy.prompt_tokens, 100);
  assert.equal(legacy.completion_tokens, 10);
  assert.equal(legacy.prompt_cache_hit_tokens, 0);
  assert.equal(legacy.prompt_cache_miss_tokens, 100);
  assert.equal(legacy.cache_reporting_status, "reported");
  assert.equal(legacy.visible_completion_tokens, 6, "legacy flat projection remains compatible");
  const legacyEstimated = normalizeProviderUsage({
    prompt_tokens: 40,
    completion_tokens: 8,
    total_tokens: 48,
    prompt_cache_hit_tokens: 0,
    reasoning_tokens: 2,
    votc_estimated: true
  });
  assert.equal(legacyEstimated.prompt_tokens, 40);
  assert.equal(legacyEstimated.completion_tokens, 8);
  assert.equal(legacyEstimated.total_tokens, 48);
  assert.equal(legacyEstimated.prompt_cache_hit_tokens, 0);
  assert.equal(legacyEstimated.visible_completion_tokens, 6);
  assert.equal(legacyEstimated.votc_estimated, true);
  const sanitizedLegacy = normalizeProviderUsage({ prompt_tokens: 3, completion_tokens: 1, prompt: "private prompt", body: "private body", secret: "fixture-secret" });
  assert.equal(JSON.stringify(sanitizedLegacy).includes("private prompt"), false);
  assert.equal(JSON.stringify(sanitizedLegacy).includes("private body"), false);
  assert.equal(JSON.stringify(sanitizedLegacy).includes("fixture-secret"), false);
}

testFinishReasonsAndStrictCompletion();
testTypedResultAndLegacyProjection();
testNativeUsageProvenance();
testProviderUsageShapes();
testSanitizedUsageSourceAndLegacyFlatShape();
console.log("V9.3 result/usage conformance passed");
