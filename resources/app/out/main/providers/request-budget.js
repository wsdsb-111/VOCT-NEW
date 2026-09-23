"use strict";

const DEFAULT_CONTEXT_WINDOW = 8192;
const DEFAULT_MAX_OUTPUT_TOKENS = 2048;

function positiveInteger(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : null;
}

function resolveProviderCapabilities(config, model = null, route = "CHAT") {
  const configuredContext = positiveInteger(config?.customContextLength);
  const modelContext = positiveInteger(model?.contextLength ?? model?.context_window);
  const configuredOutput = positiveInteger(config?.customMaxOutputTokens ?? config?.maxOutputTokens ?? config?.defaultParameters?.max_tokens);
  const modelOutput = positiveInteger(model?.maxOutputTokens ?? model?.maxCompletionTokens ?? model?.outputTokenLimit);
  const contextWindow = configuredContext || modelContext || DEFAULT_CONTEXT_WINDOW;
  const inferredOutput = configuredContext || modelContext ? Math.min(8192, Math.max(DEFAULT_MAX_OUTPUT_TOKENS, Math.floor(contextWindow / 4))) : DEFAULT_MAX_OUTPUT_TOKENS;
  const maxOutputTokens = positiveInteger(config?.customMaxOutputTokens ?? config?.maxOutputTokens) || modelOutput || configuredOutput || inferredOutput;
  const source = configuredContext || configuredOutput ? "configured" : modelContext || modelOutput ? "provider_metadata" : "fallback";
  const outputSource = positiveInteger(config?.customMaxOutputTokens ?? config?.maxOutputTokens) || configuredOutput ? "configured" : modelOutput ? "provider_metadata" : "heuristic";
  return {
    providerId: config?.instanceId || config?.providerType || null,
    providerType: config?.providerType || null,
    modelId: config?.defaultModel || null,
    route,
    contextWindow,
    maxOutputTokens: Math.min(maxOutputTokens, contextWindow),
    tokenizerProfile: config?.providerType || "fallback",
    source,
    outputSource,
    capabilityRevision: `${contextWindow}:${maxOutputTokens}:${source}:${outputSource}`
  };
}

function planRequestBudget({ messages = [], capabilities, requestedOutputTokens, countTokens, safetyRatio = 0.12 } = {}) {
  const estimatedInputTokens = Math.ceil(Math.max(0, Number(countTokens?.(messages)) || 0) * 1.1);
  const protocolOverheadTokens = 32 + messages.length * 8;
  const outputLimit = positiveInteger(capabilities?.maxOutputTokens) || DEFAULT_MAX_OUTPUT_TOKENS;
  const reservedOutputTokens = Math.min(positiveInteger(requestedOutputTokens) || outputLimit, outputLimit);
  const contextWindow = positiveInteger(capabilities?.contextWindow) || DEFAULT_CONTEXT_WINDOW;
  const safetyMarginTokens = Math.max(256, Math.ceil(contextWindow * safetyRatio));
  const effectiveInputBudget = Math.max(0, contextWindow - reservedOutputTokens - protocolOverheadTokens - safetyMarginTokens);
  return {
    estimatedInputTokens,
    reservedOutputTokens,
    protocolOverheadTokens,
    safetyMarginTokens,
    effectiveInputBudget,
    pressureRatio: effectiveInputBudget ? estimatedInputTokens / effectiveInputBudget : Infinity,
    safe: estimatedInputTokens <= effectiveInputBudget
  };
}

module.exports = { resolveProviderCapabilities, planRequestBudget };
