"use strict";

const { normalizeProviderResult } = require("./provider-result");

function validateComplete(response, options = {}) {
  if (options.strict === false) {
    const finishReason = response?.finish_reason ?? response?.finishReason ?? response?.finish?.raw ?? response?.votc_result?.finish?.raw ?? null;
    const truncated = ["length", "max_tokens", "max_output_tokens"].includes(finishReason);
    const failed = ["error", "content_filter", "cancelled"].includes(finishReason);
    return !truncated && !failed;
  }

  const result = normalizeProviderResult(response, options);
  if (result.status !== "COMPLETE" || result.finish.normalized !== "STOP") return false;
  if (options.requireJson) {
    try {
      JSON.parse(result.content);
    } catch (_error) {
      return false;
    }
  }
  return true;
}

function validateGenerationOutcome(response, options = {}) {
  const result = normalizeProviderResult(response, options);
  const finishReason = response?.finish_reason ?? response?.finishReason ?? result.finish.raw;
  const truncated = result.status === "TRUNCATED" || result.finish.normalized === "LENGTH";
  return {
    content: result.content,
    finishReason,
    complete: validateComplete(result, options),
    truncated,
    provider: result.provider,
    model: result.model,
    inputTokens: result.usage.native.inputTokens,
    outputTokens: result.usage.native.outputTokens,
    cachedTokens: result.usage.native.cachedInputTokens,
    status: result.status,
    finish: result.finish,
    toolCalls: result.toolCalls,
    usage: result.usage,
    reasoning: result.reasoning,
    error: result.error
  };
}

module.exports = { validateComplete, validateGenerationOutcome };
