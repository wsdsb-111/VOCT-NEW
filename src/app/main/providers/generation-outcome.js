"use strict";

function validateGenerationOutcome(response) {
  const finishReason = response?.finish_reason ?? response?.finishReason ?? null;
  const truncated = ["length", "max_tokens", "max_output_tokens"].includes(finishReason);
  const failed = ["error", "content_filter", "cancelled"].includes(finishReason);
  return {
    content: typeof response?.content === "string" ? response.content : "",
    finishReason,
    complete: !truncated && !failed,
    truncated,
    provider: response?.provider || null,
    model: response?.model || null,
    inputTokens: response?.usage?.prompt_tokens ?? null,
    outputTokens: response?.usage?.completion_tokens ?? null,
    cachedTokens: response?.usage?.prompt_cache_hit_tokens ?? null
  };
}

module.exports = { validateGenerationOutcome };
