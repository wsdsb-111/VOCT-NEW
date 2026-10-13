"use strict";

const { createHash } = require("crypto");

const CAPABILITY_REVISION = "provider-capabilities-v1";
const CAPABILITY_STATES = Object.freeze({
  SUPPORTED: "SUPPORTED",
  UNSUPPORTED: "UNSUPPORTED",
  UNKNOWN: "UNKNOWN"
});
const STRUCTURED_DELIVERY_MODES = Object.freeze([
  "NATIVE_SCHEMA",
  "JSON_OBJECT",
  "EMULATED_SCHEMA",
  "UNSUPPORTED",
  "UNKNOWN"
]);
const FEATURE_NAMES = Object.freeze([
  "nonStreaming",
  "streaming",
  "structuredJsonObject",
  "structuredJsonSchema",
  "reasoningControl",
  "reasoningTelemetry",
  "nativeCachedUsage",
  "cancellation"
]);
const DEFAULT_ENDPOINTS = Object.freeze({
  openrouter: "https://openrouter.ai/api/v1",
  zhipu: "https://open.bigmodel.cn/api/paas/v4",
  player2: "http://127.0.0.1:4315/v1",
  deepseek: "https://api.deepseek.com",
  gemini: "https://generativelanguage.googleapis.com/v1beta"
});
const ADAPTER_PATHS = Object.freeze({
  player2: ["nonStreaming", "streaming", "response_format_passthrough"],
  openrouter: ["nonStreaming", "streaming", "response_format_passthrough", "reasoning_exclude"],
  "openai-compatible": ["nonStreaming", "streaming", "response_format_passthrough", "stream_usage_tail"],
  ollama: ["nonStreaming", "streaming", "native_chat", "ndjson"],
  deepseek: ["nonStreaming", "streaming", "json_object", "schema_injection_or_local_validation", "thinking_control"],
  gemini: ["nonStreaming", "streaming", "response_mime_type", "schema_subset", "usage_metadata"],
  zhipu: ["nonStreaming", "streaming", "response_format_passthrough", "reasoning_effort", "clear_thinking", "stream_usage_tail"]
});
const DEFAULT_UNKNOWN_REASON = "No verified endpoint/model/route capability evidence was supplied.";
const PROTOCOL_PARAMETER_KEYS = Object.freeze([
  "response_format",
  "responseFormat",
  "stream",
  "stream_options",
  "streamOptions",
  "thinking",
  "reasoning",
  "reasoning_effort",
  "reasoningEffort",
  "clear_thinking",
  "clearThinking",
  "format",
  "json_schema",
  "structuredOutputMode"
]);
const SENSITIVE_PARAMETER_KEY = /^(api[_-]?key|authorization|access[_-]?token|token|secret|signal)$/i;

function normalizeRoute(route) {
  const value = String(route || "CHAT").trim().toUpperCase();
  return value || "CHAT";
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") {
    return typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value === null ? value : null;
  }
  const result = {};
  for (const key of Object.keys(value).sort()) {
    if (SENSITIVE_PARAMETER_KEY.test(key)) continue;
    const item = value[key];
    if (typeof item === "function" || typeof item === "undefined") continue;
    result[key] = stableValue(item);
  }
  return result;
}

function stableSerialize(value) {
  return JSON.stringify(stableValue(value));
}

function fingerprint(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function normalizeEndpoint(endpoint) {
  const value = String(endpoint || "").trim();
  if (!value) return "";
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    url.hash = "";
    url.pathname = url.pathname.replace(/\/+$/, "") || "/";
    const query = Array.from(url.searchParams.entries())
      .filter(([key]) => !/^(api[_-]?key|key|authorization|access[_-]?token|token)$/i.test(key))
      .sort(([leftKey, leftValue], [rightKey, rightValue]) => leftKey.localeCompare(rightKey) || leftValue.localeCompare(rightValue));
    url.search = "";
    for (const [key, item] of query) url.searchParams.append(key, item);
    return url.toString().replace(/\/$/, url.pathname === "/" ? "/" : "");
  } catch (_) {
    return value.replace(/\/+$/, "");
  }
}

function getEndpoint(config = {}) {
  const providerType = config.providerType || "unknown";
  const configuredEndpoint = config.baseUrl || config.baseURL || config.endpoint || config.apiBaseUrl || "";
  return normalizeEndpoint(configuredEndpoint || DEFAULT_ENDPOINTS[providerType] || `${providerType}:default`);
}

function endpointFingerprint(config = {}) {
  return `sha256:${fingerprint(getEndpoint(config))}`;
}

function pickProtocolParameters(parameters = {}) {
  const selected = {};
  for (const key of PROTOCOL_PARAMETER_KEYS) {
    if (Object.prototype.hasOwnProperty.call(parameters, key)) selected[key] = parameters[key];
  }
  return stableValue(selected);
}

function capabilityCacheKey(config = {}, route = "CHAT") {
  const providerType = config.providerType || null;
  const keyMaterial = {
    revision: config.capabilityRevision || CAPABILITY_REVISION,
    providerInstanceId: config.instanceId || null,
    providerType,
    endpointFingerprint: endpointFingerprint(config),
    modelId: config.defaultModel || null,
    route: normalizeRoute(route || config.route),
    limits: {
      customContextLength: config.customContextLength ?? null,
      customMaxOutputTokens: config.customMaxOutputTokens ?? null,
      maxOutputTokens: config.maxOutputTokens ?? null,
      defaultMaxTokens: config.defaultParameters?.max_tokens ?? null
    },
    protocol: {
      actionSchemaDeliveryMode: config.actionSchemaDeliveryMode || null,
      glmReasoningEffort: config.glmReasoningEffort || null,
      glmClearThinking: config.glmClearThinking ?? null,
      defaultParameters: pickProtocolParameters(config.defaultParameters)
    }
  };
  return `provider-capability:${fingerprint(stableSerialize(keyMaterial))}`;
}

function unknownFeature(reason = DEFAULT_UNKNOWN_REASON) {
  return { state: CAPABILITY_STATES.UNKNOWN, source: "unverified", reason };
}

function metadataMatchesModel(modelMetadata, modelId) {
  const metadataModelId = modelMetadata?.modelId || modelMetadata?.id;
  return !metadataModelId || !modelId || String(metadataModelId) === String(modelId);
}

function readMetadataFeature(modelMetadata, feature, route) {
  const item = modelMetadata?.features?.[feature];
  if (!item || typeof item !== "object" || Array.isArray(item)) return unknownFeature();
  if (item.route && normalizeRoute(item.route) !== route) return unknownFeature("Capability evidence applies to a different route.");
  if (Array.isArray(item.routes) && !item.routes.map(normalizeRoute).includes(route)) return unknownFeature("Capability evidence applies to a different route.");
  const state = String(item.state || "").toUpperCase();
  if (!Object.prototype.hasOwnProperty.call(CAPABILITY_STATES, state)) return unknownFeature("Model metadata did not provide a recognized capability state.");
  const result = {
    state,
    source: typeof item.source === "string" && item.source.trim() ? item.source.trim() : "model_metadata"
  };
  if (typeof item.reason === "string" && item.reason.trim()) result.reason = item.reason.trim();
  return result;
}

function resolveAdapterMode(config, providerType, route) {
  const mode = config.actionSchemaDeliveryMode || "optimized_local_validation";
  if (route === "ACTION" && ["deepseek", "openai-compatible"].includes(providerType)) {
    if (mode === "optimized_local_validation") return "JSON_OBJECT";
    if (mode === "official_full_injected") return providerType === "deepseek" ? "EMULATED_SCHEMA" : "NATIVE_SCHEMA_REQUEST";
  }
  if (providerType === "deepseek" && route === "SUMMARY") return "JSON_OBJECT";
  return null;
}

function resolveStructuredDelivery(modelMetadata, route, adapterMode) {
  const metadata = modelMetadata?.structuredDelivery;
  const mode = typeof metadata?.mode === "string" ? metadata.mode.toUpperCase() : "";
  if (STRUCTURED_DELIVERY_MODES.includes(mode)) {
    const result = {
      mode,
      source: typeof metadata.source === "string" && metadata.source.trim() ? metadata.source.trim() : "model_metadata",
      adapterMode
    };
    if (typeof metadata.reason === "string" && metadata.reason.trim()) result.reason = metadata.reason.trim();
    return result;
  }
  return { mode: "UNKNOWN", source: "unverified", adapterMode, route };
}

function buildProviderCapabilities(config = {}, legacyBudgetCaps = {}, modelMetadata = null, route = "CHAT") {
  const providerType = config.providerType || legacyBudgetCaps.providerType || null;
  const modelId = config.defaultModel || legacyBudgetCaps.modelId || modelMetadata?.modelId || modelMetadata?.id || null;
  const resolvedRoute = normalizeRoute(route || legacyBudgetCaps.route || config.route);
  const metadataMatches = metadataMatchesModel(modelMetadata, modelId);
  const matchingMetadata = metadataMatches ? modelMetadata : null;
  const features = {};
  for (const feature of FEATURE_NAMES) {
    features[feature] = matchingMetadata
      ? readMetadataFeature(matchingMetadata, feature, resolvedRoute)
      : unknownFeature(modelMetadata ? "Model metadata does not match the configured model." : DEFAULT_UNKNOWN_REASON);
  }
  const adapterMode = resolveAdapterMode(config, providerType, resolvedRoute);
  const structuredDelivery = resolveStructuredDelivery(matchingMetadata, resolvedRoute, adapterMode);
  const knownAdapterPath = ADAPTER_PATHS[providerType] || [];

  return {
    ...legacyBudgetCaps,
    providerId: legacyBudgetCaps.providerId || config.instanceId || providerType,
    providerInstanceId: config.instanceId || legacyBudgetCaps.providerId || null,
    providerType,
    model: modelId,
    modelId,
    route: resolvedRoute,
    endpointFingerprint: endpointFingerprint(config),
    revision: matchingMetadata?.capabilityRevision || config.capabilityRevision || CAPABILITY_REVISION,
    features,
    structuredDelivery,
    adapterPath: {
      source: "repository_source",
      operations: knownAdapterPath.slice()
    }
  };
}

class ProviderCapabilityUnsupportedError extends Error {
  constructor(feature, capabilities = {}) {
    super(`provider_capability_unsupported:${feature}`);
    this.name = "ProviderCapabilityUnsupportedError";
    this.code = "provider_capability_unsupported";
    this.feature = feature;
    this.providerType = capabilities.providerType || null;
    this.modelId = capabilities.modelId || null;
    this.route = capabilities.route || null;
  }
}

function assertCapabilityNotUnsupported(capabilities, feature) {
  const capability = feature === "structuredDelivery"
    ? { state: capabilities?.structuredDelivery?.mode || CAPABILITY_STATES.UNKNOWN }
    : capabilities?.features?.[feature] || { state: CAPABILITY_STATES.UNKNOWN };
  if (capability.state === CAPABILITY_STATES.UNSUPPORTED) {
    throw new ProviderCapabilityUnsupportedError(feature, capabilities);
  }
  return capability;
}

module.exports = {
  CAPABILITY_REVISION,
  CAPABILITY_STATES,
  FEATURE_NAMES,
  ProviderCapabilityUnsupportedError,
  assertCapabilityNotUnsupported,
  buildProviderCapabilities,
  capabilityCacheKey
};
