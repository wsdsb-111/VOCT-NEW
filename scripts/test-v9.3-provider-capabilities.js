"use strict";

const assert = require("assert");
const path = require("path");

const root = path.resolve(__dirname, "..");
const {
  CAPABILITY_STATES,
  ProviderCapabilityUnsupportedError,
  assertCapabilityNotUnsupported,
  buildProviderCapabilities,
  capabilityCacheKey
} = require(path.join(root, "src", "app", "main", "providers", "provider-capabilities.js"));

const featureNames = [
  "nonStreaming",
  "streaming",
  "structuredJsonObject",
  "structuredJsonSchema",
  "reasoningControl",
  "reasoningTelemetry",
  "nativeCachedUsage",
  "cancellation"
];
const providerTypes = ["player2", "openrouter", "openai-compatible", "ollama", "deepseek", "gemini", "zhipu"];

for (const providerType of providerTypes) {
  const config = { instanceId: `fixture-${providerType}`, providerType, defaultModel: "fixture-model", apiKey: "secret-fixture-key" };
  const capabilities = buildProviderCapabilities(config, { contextWindow: 8192, maxOutputTokens: 2048 }, null, "CHAT");
  assert.deepStrictEqual(Object.keys(capabilities.features).sort(), featureNames.slice().sort(), `${providerType} must have the full capability matrix`);
  for (const feature of featureNames) {
    assert.strictEqual(capabilities.features[feature].state, CAPABILITY_STATES.UNKNOWN, `${providerType}.${feature} must remain unverified`);
    assert.ok(capabilities.features[feature].source, `${providerType}.${feature} must retain evidence provenance`);
  }
  assert.ok(capabilities.adapterPath.operations.length > 0, `${providerType} must expose its source-verified adapter path separately`);
  assert.strictEqual(capabilities.providerType, providerType);
  assert.strictEqual(capabilities.model, "fixture-model");
}

const budgetCaps = {
  providerId: "instance-1",
  providerType: "openai-compatible",
  modelId: "model-a",
  route: "SUMMARY",
  contextWindow: 32768,
  maxOutputTokens: 4096,
  tokenizerProfile: "openai-compatible",
  source: "configured",
  outputSource: "provider_metadata",
  capabilityRevision: "32768:4096:configured:provider_metadata"
};
const capabilities = buildProviderCapabilities({ instanceId: "instance-1", providerType: "openai-compatible", defaultModel: "model-a" }, budgetCaps, null, "SUMMARY");
for (const key of Object.keys(budgetCaps)) {
  assert.deepStrictEqual(capabilities[key], budgetCaps[key], `legacy budget field ${key} must be preserved`);
}
assert.strictEqual(capabilities.endpointFingerprint.includes("https://"), false, "endpoint fingerprints must not expose the endpoint");

const metadataCapabilities = buildProviderCapabilities({
  instanceId: "instance-2",
  providerType: "deepseek",
  defaultModel: "model-a",
  actionSchemaDeliveryMode: "official_full_injected"
}, {}, {
  id: "model-a",
  features: {
    streaming: { state: "SUPPORTED", source: "official_docs" },
    structuredJsonSchema: { state: "UNSUPPORTED", source: "conformance_fixture", reason: "endpoint rejected the schema request" },
    reasoningControl: { state: "UNKNOWN", source: "fixture", reason: "model variant not verified" }
  }
}, "ACTION");
assert.deepStrictEqual(metadataCapabilities.features.streaming, { state: "SUPPORTED", source: "official_docs" });
assert.deepStrictEqual(metadataCapabilities.features.structuredJsonSchema, {
  state: "UNSUPPORTED",
  source: "conformance_fixture",
  reason: "endpoint rejected the schema request"
});
assert.strictEqual(metadataCapabilities.structuredDelivery.mode, "UNKNOWN", "source-level serialization must not become verified endpoint delivery");
assert.strictEqual(metadataCapabilities.structuredDelivery.adapterMode, "EMULATED_SCHEMA", "full-injected action compatibility must be identified as emulated");
const nativeSchemaRequest = buildProviderCapabilities({
  providerType: "openai-compatible",
  defaultModel: "model-a",
  actionSchemaDeliveryMode: "official_full_injected"
}, {}, null, "ACTION");
assert.strictEqual(nativeSchemaRequest.structuredDelivery.mode, "UNKNOWN");
assert.strictEqual(nativeSchemaRequest.structuredDelivery.adapterMode, "NATIVE_SCHEMA_REQUEST", "a schema request path must not be described as verified native support");

const mismatchedMetadata = buildProviderCapabilities({ providerType: "gemini", defaultModel: "configured-model" }, {}, {
  id: "different-model",
  features: { streaming: { state: "SUPPORTED", source: "official_docs" } }
}, "CHAT");
assert.strictEqual(mismatchedMetadata.features.streaming.state, "UNKNOWN", "metadata for another model must not be reused");

const baseConfig = {
  instanceId: "instance-1",
  providerType: "deepseek",
  defaultModel: "model-a",
  actionSchemaDeliveryMode: "optimized_local_validation",
  customContextLength: 65536,
  customMaxOutputTokens: 4096,
  glmReasoningEffort: "low",
  glmClearThinking: true,
  apiKey: "cache-key-secret",
  defaultParameters: {
    max_tokens: 4096,
    response_format: { type: "json_object" },
    thinking: { type: "disabled" },
    signal: { internal: "must-not-be-keyed" },
    apiKey: "must-not-be-keyed"
  }
};
const baseKey = capabilityCacheKey(baseConfig, "ACTION");
assert.strictEqual(baseKey, capabilityCacheKey({
  ...baseConfig,
  defaultParameters: {
    apiKey: "different-secret",
    signal: { internal: "different-signal" },
    thinking: { type: "disabled" },
    response_format: { type: "json_object" },
    max_tokens: 4096
  }
}, "ACTION"), "object order and excluded secrets/signals must not change the key");
assert.strictEqual(baseKey, capabilityCacheKey({ ...baseConfig, apiKey: "rotated-api-key" }, "ACTION"), "API key changes must not leak into the capability key");
assert.ok(!baseKey.includes("cache-key-secret") && !baseKey.includes("must-not-be-keyed"), "the cache key must not expose credentials or excluded data");
assert.notStrictEqual(baseKey, capabilityCacheKey({ ...baseConfig, instanceId: "instance-2" }, "ACTION"));
assert.notStrictEqual(baseKey, capabilityCacheKey({ ...baseConfig, defaultModel: "model-b" }, "ACTION"));
assert.notStrictEqual(baseKey, capabilityCacheKey({ ...baseConfig, baseUrl: "https://custom.example/v1" }, "ACTION"));
assert.notStrictEqual(baseKey, capabilityCacheKey({ ...baseConfig, actionSchemaDeliveryMode: "official_full_injected" }, "ACTION"));
assert.notStrictEqual(baseKey, capabilityCacheKey({ ...baseConfig, glmReasoningEffort: "high" }, "ACTION"));
assert.notStrictEqual(baseKey, capabilityCacheKey({ ...baseConfig, glmClearThinking: false }, "ACTION"));
assert.notStrictEqual(baseKey, capabilityCacheKey({ ...baseConfig, customContextLength: 131072 }, "ACTION"));
assert.notStrictEqual(baseKey, capabilityCacheKey({ ...baseConfig, capabilityRevision: "fixture-revision-2" }, "ACTION"));
assert.notStrictEqual(baseKey, capabilityCacheKey(baseConfig, "SUMMARY"), "route must be part of the capability cache key");

const defaultDeepseek = { providerType: "deepseek", defaultModel: "model-a" };
assert.strictEqual(
  capabilityCacheKey(defaultDeepseek, "CHAT"),
  capabilityCacheKey({ ...defaultDeepseek, baseUrl: "https://api.deepseek.com/" }, "CHAT"),
  "an explicit URL matching the provider default must share its normalized endpoint identity"
);

assert.doesNotThrow(() => assertCapabilityNotUnsupported(capabilities, "streaming"), "UNKNOWN must allow a controlled existing protocol attempt");
assert.throws(() => assertCapabilityNotUnsupported(metadataCapabilities, "structuredJsonSchema"), (error) => {
  assert.ok(error instanceof ProviderCapabilityUnsupportedError);
  assert.strictEqual(error.code, "provider_capability_unsupported");
  assert.strictEqual(error.feature, "structuredJsonSchema");
  assert.strictEqual(error.route, "ACTION");
  return true;
});

console.log("V9.3 provider capabilities RED/GREEN contract checks passed");
