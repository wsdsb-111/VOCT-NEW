"use strict";

const crypto = require("node:crypto");
const { assertActive } = require("./provider-cancellation");
const { DEFAULT_MAX_OUTPUT_TOKENS, planRequestBudget } = require("./request-budget");

const PAYLOAD_FIELDS = {
  openai_chat_completions: [
    "model", "messages", "stream", "temperature", "max_tokens", "top_p", "presence_penalty", "frequency_penalty",
    "response_format", "reasoning", "reasoning_effort", "thinking", "stream_options"
  ],
  ollama_api_chat: ["model", "messages", "stream", "options"],
  gemini_generate_content: ["contents", "systemInstruction", "generationConfig"]
};

function jsonValue(value) {
  const serialized = JSON.stringify(value);
  return serialized === undefined ? undefined : JSON.parse(serialized);
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableValue(value[key])]));
}

function stableStringify(value) {
  return JSON.stringify(stableValue(value));
}

function fingerprint(value) {
  return crypto.createHash("sha256").update(stableStringify(value)).digest("hex");
}

function fingerprintMessages(messages) {
  return fingerprint(jsonValue(Array.isArray(messages) ? messages : []));
}

const fingerprintAdapterInputMessages = fingerprintMessages;

function fingerprintTransportPayload(payload) {
  return fingerprint(jsonValue(payload));
}

function projectPayload(protocol, payload = {}) {
  const allowedFields = PAYLOAD_FIELDS[protocol];
  if (!allowedFields) throw new Error("provider_effective_request_protocol_unknown");
  const projected = {};
  for (const field of allowedFields) {
    if (!Object.prototype.hasOwnProperty.call(payload, field)) continue;
    const value = jsonValue(payload[field]);
    if (value !== undefined) projected[field] = value;
  }
  return stableValue(projected);
}

function endpointDisplay(endpoint) {
  if (typeof endpoint !== "string" || !endpoint) return null;
  try {
    const parsed = new URL(endpoint);
    const queryKeys = [...new Set([...parsed.searchParams.keys()])].sort();
    const query = queryKeys.length ? `?${queryKeys.map(key => encodeURIComponent(key)).join("&")}` : "";
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}${query}`;
  } catch {
    return endpoint.replace(/([?&][^=&#]+)=([^&#]*)/g, "$1=[redacted]");
  }
}

function endpointIdentity(endpoint) {
  if (typeof endpoint !== "string" || !endpoint) return "";
  try {
    const parsed = new URL(endpoint);
    parsed.username = "";
    parsed.password = "";
    const entries = [...parsed.searchParams.entries()].sort(([leftKey, leftValue], [rightKey, rightValue]) =>
      leftKey.localeCompare(rightKey) || leftValue.localeCompare(rightValue));
    parsed.search = "";
    for (const [key, value] of entries) {
      if (!/(?:key|token|secret|auth|password|credential)/i.test(key)) parsed.searchParams.append(key, value);
      else if (!parsed.searchParams.has(key)) parsed.searchParams.append(key, "[redacted]");
    }
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return endpoint.replace(/([?&][^=&#]*(?:key|token|secret|auth|password|credential)[^=&#]*=)[^&#]*/gi, "$1[redacted]")
      .replace(/([?&][^=&#]+)=([^&#]*)/g, "$1=[redacted]");
  }
}

function createEffectiveRequestSnapshot({
  requestType,
  providerType,
  protocol,
  method = "POST",
  endpoint,
  stream = false,
  payload,
  adapterInputMessagesFingerprint,
  planStatus = "LEGACY_OBSERVED",
  ownerEvidence = "UNKNOWN"
} = {}) {
  const projectedPayload = projectPayload(protocol, payload);
  const safeEndpoint = endpointIdentity(endpoint);
  const endpointFingerprint = fingerprint(safeEndpoint);
  const payloadFingerprint = fingerprint(projectedPayload);
  const identity = {
    schemaVersion: 1,
    requestType: typeof requestType === "string" && requestType.trim() ? requestType.trim() : "unknown",
    providerType: typeof providerType === "string" && providerType ? providerType : "unknown",
    protocol,
    method: String(method).toUpperCase(),
    endpointFingerprint,
    stream: stream === true,
    payloadFingerprint
  };
  const snapshot = {
    schemaVersion: 1,
    ...identity,
    endpoint: { display: endpointDisplay(endpoint), fingerprint: endpointFingerprint },
    planStatus,
    ownerEvidence,
    adapterInputMessagesFingerprint: adapterInputMessagesFingerprint || fingerprintAdapterInputMessages(payload?.messages),
    payload: projectedPayload,
    payloadFingerprint,
    effectiveRequestFingerprint: fingerprint(identity)
  };
  return deepFreeze(snapshot);
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function textParts(parts) {
  return Array.isArray(parts) ? parts.map(part => typeof part?.text === "string" ? part.text : "").join("") : "";
}

function extractEffectivePromptMessages(snapshot) {
  const payload = snapshot?.payload || {};
  const messages = Array.isArray(payload.messages) ? [...payload.messages] : [];
  if (!Array.isArray(payload.messages)) {
    if (payload.systemInstruction) {
      messages.push({ role: "system", content: textParts(payload.systemInstruction.parts) });
    }
    if (Array.isArray(payload.contents)) {
      for (const item of payload.contents) {
        messages.push({ role: item?.role === "model" ? "assistant" : "user", content: textParts(item?.parts) });
      }
    }
  }
  const schema = payload.response_format?.type === "json_schema"
    ? payload.response_format.json_schema
    : payload.generationConfig?.responseJsonSchema;
  if (schema && typeof schema === "object") messages.push({ role: "system", content: JSON.stringify(schema) });
  return messages;
}

function resolveEffectiveOutputTokens(snapshot, fallback) {
  const payload = snapshot?.payload || {};
  const value = payload.max_tokens ?? payload.options?.num_predict ?? payload.generationConfig?.maxOutputTokens;
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function markAdapterInputMessages(requestControl, messages) {
  const messageFingerprint = fingerprintAdapterInputMessages(messages);
  if (typeof requestControl?.setAdapterInputMessagesFingerprint === "function") {
    requestControl.setAdapterInputMessagesFingerprint(messageFingerprint);
  }
  if (requestControl && typeof requestControl === "object") {
    requestControl.adapterInputMessagesFingerprint = messageFingerprint;
    requestControl.adapterInputMessagesSource = messages;
  }
  return messageFingerprint;
}

function preflightEffectiveRequestBudget(snapshot, { capabilities, requestedOutputTokens, countTokens } = {}) {
  const messages = extractEffectivePromptMessages(snapshot);
  const effectiveOutputLimit = Number.isSafeInteger(capabilities?.maxOutputTokens) && capabilities.maxOutputTokens > 0
    ? capabilities.maxOutputTokens : DEFAULT_MAX_OUTPUT_TOKENS;
  const effectiveOutputTokens = resolveEffectiveOutputTokens(snapshot, requestedOutputTokens);
  if (effectiveOutputTokens > effectiveOutputLimit) {
    const error = new Error("provider_effective_output_limit_exceeded");
    error.code = "provider_effective_output_limit_exceeded";
    error.votcPreflight = true;
    throw error;
  }
  if (typeof countTokens !== "function") {
    const error = new Error("provider_effective_request_token_count_unavailable");
    error.code = "provider_effective_request_token_count_unavailable";
    error.votcPreflight = true;
    throw error;
  }
  const estimatedTokens = countTokens(messages);
  if (typeof estimatedTokens !== "number" || !Number.isFinite(estimatedTokens) || estimatedTokens < 0) {
    const error = new Error("provider_effective_request_token_count_invalid");
    error.code = "provider_effective_request_token_count_invalid";
    error.votcPreflight = true;
    throw error;
  }
  const budget = planRequestBudget({
    messages,
    capabilities,
    requestedOutputTokens: effectiveOutputTokens,
    countTokens: () => estimatedTokens
  });
  if (!budget.safe) {
    const error = new Error("provider_effective_request_budget_exceeded");
    error.code = "provider_effective_request_budget_exceeded";
    error.budget = budget;
    error.votcPreflight = true;
    throw error;
  }
  return Object.freeze({ ...budget, effectiveRequestFingerprint: snapshot.effectiveRequestFingerprint });
}

async function observeEffectiveRequest(requestControl, snapshot) {
  requestControl?.check?.();
  assertActive(requestControl?.signal);
  const result = await requestControl?.beforeTransport?.(snapshot);
  requestControl?.check?.();
  assertActive(requestControl?.signal);
  if (result === false || result?.ok === false) {
    const code = typeof result?.reasonCode === "string" ? result.reasonCode : "provider_effective_request_rejected";
    const error = new Error(code);
    error.code = code;
    error.votcPreflight = true;
    throw error;
  }
  return result;
}

module.exports = {
  createEffectiveRequestSnapshot,
  fingerprintMessages,
  fingerprintAdapterInputMessages,
  fingerprintTransportPayload,
  markAdapterInputMessages,
  extractEffectivePromptMessages,
  preflightEffectiveRequestBudget,
  observeEffectiveRequest,
  endpointDisplay,
  stableStringify
};
