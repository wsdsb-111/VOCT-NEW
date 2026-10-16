"use strict";

const DEFAULT_CONTEXT_WINDOW = 8192;
const DEFAULT_MAX_OUTPUT_TOKENS = 2048;
const MIN_CONTEXT_LENGTH = 256;
const MAX_CONTEXT_LENGTH = 2e6;

function isValidContextLength(value) {
  return typeof value === "number" && Number.isSafeInteger(value)
    && value >= MIN_CONTEXT_LENGTH && value <= MAX_CONTEXT_LENGTH;
}

function resolveContextMode(config = {}) {
  if (!config || typeof config !== "object" || Array.isArray(config)) return "invalid";
  if (config.contextMode !== undefined) {
    return config.contextMode === "auto" || config.contextMode === "custom" ? config.contextMode : "invalid";
  }
  return config.customContextLength !== undefined && config.customContextLength !== null ? "custom" : "auto";
}

function validateContextConfiguration(config) {
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    throw new Error("provider_context_config_must_be_an_object");
  }
  if (config.contextMode !== undefined && !["auto", "custom"].includes(config.contextMode)) {
    throw new Error("context_mode_must_be_auto_or_custom");
  }
  if (config.customContextLength !== undefined && config.customContextLength !== null
    && !isValidContextLength(config.customContextLength)) {
    throw new Error(`custom_context_length_must_be_an_integer_between_${MIN_CONTEXT_LENGTH}_and_${MAX_CONTEXT_LENGTH}`);
  }
  const contextMode = resolveContextMode(config);
  if (contextMode === "custom" && !isValidContextLength(config.customContextLength)) {
    throw new Error(`custom_context_length_must_be_an_integer_between_${MIN_CONTEXT_LENGTH}_and_${MAX_CONTEXT_LENGTH}`);
  }
  return config;
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : null;
}

function resolveProviderCapabilities(config, model = null, route = "CHAT") {
  const contextMode = resolveContextMode(config);
  const invalidCustomValue = config?.customContextLength !== undefined && config?.customContextLength !== null
    && !isValidContextLength(config.customContextLength);
  const invalidCustomMode = contextMode === "custom" && !isValidContextLength(config?.customContextLength);
  const invalidConfiguration = contextMode === "invalid" || invalidCustomValue || invalidCustomMode;
  const configuredContext = !invalidConfiguration && contextMode === "custom" && isValidContextLength(config?.customContextLength)
    ? config.customContextLength : null;
  const metadataModelId = model?.modelId ?? model?.id;
  const modelMatchesConfig = !metadataModelId || !config?.defaultModel || String(metadataModelId) === String(config.defaultModel);
  const metadataContext = modelMatchesConfig ? model?.contextLength ?? model?.context_window : null;
  const modelContext = isValidContextLength(metadataContext)
    && (model?.contextLengthSource === undefined || model.contextLengthSource === "provider_native")
    ? metadataContext : null;
  const contextWindow = invalidConfiguration
    ? Math.min(modelContext || DEFAULT_CONTEXT_WINDOW, DEFAULT_CONTEXT_WINDOW)
    : configuredContext
      ? modelContext ? Math.min(configuredContext, modelContext) : configuredContext
      : modelContext || DEFAULT_CONTEXT_WINDOW;
  const contextWindowSource = invalidConfiguration
    ? "invalid_configuration_fallback"
    : configuredContext
      ? modelContext && modelContext < configuredContext ? "provider_native_cap" : modelContext ? "user_provided" : "user_provided_unverified"
      : modelContext ? model?.contextLengthSource === "provider_native" ? "provider_native" : "provider_metadata" : "safe_fallback";
  const configuredOutput = positiveInteger(config?.customMaxOutputTokens ?? config?.maxOutputTokens ?? config?.defaultParameters?.max_tokens);
  const modelOutput = modelMatchesConfig ? positiveInteger(model?.maxOutputTokens ?? model?.maxCompletionTokens ?? model?.outputTokenLimit) : null;
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
    contextMode,
    contextWindowSource,
    modelNativeContext: modelContext,
    configuredContextLength: configuredContext,
    maxOutputTokens: Math.min(maxOutputTokens, contextWindow),
    tokenizerProfile: config?.providerType || "fallback",
    source,
    outputSource,
    capabilityRevision: `${contextMode}:${contextWindow}:${maxOutputTokens}:${source}:${contextWindowSource}:${outputSource}`
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

module.exports = {
  DEFAULT_CONTEXT_WINDOW,
  MIN_CONTEXT_LENGTH,
  MAX_CONTEXT_LENGTH,
  isValidContextLength,
  resolveContextMode,
  validateContextConfiguration,
  resolveProviderCapabilities,
  planRequestBudget
};
