"use strict";

const assert = require("node:assert/strict");
const Module = require("node:module");
const path = require("node:path");
const { createRequestControl } = require("../src/app/main/providers/provider-cancellation");
const { fingerprintMessages, preflightEffectiveRequestBudget } = require("../src/app/main/providers/effective-request");

const root = path.resolve(__dirname, "..");
const providerIndexPath = path.join(root, "src/app/main/providers/index.js");
const providerClasses = {
  openrouter: "OpenRouterProvider",
  "openai-compatible": "OpenAICompatibleProvider",
  zhipu: "ZhipuProvider",
  ollama: "OllamaProvider",
  player2: "Player2Provider",
  deepseek: "DeepseekProvider",
  gemini: "GeminiProvider"
};
const providerTypes = Object.keys(providerClasses);
let activeFixture = null;

class MockOpenAI {
  constructor(options = {}) {
    if (!activeFixture) throw new Error("mock_sdk_without_fixture");
    this.chat = { completions: { create: (request, requestOptions) => {
      activeFixture.timeline?.push("transport");
      activeFixture.transports.push({ kind: "sdk", request: jsonClone(request), requestOptions, clientOptions: options });
      return activeFixture.respond(request, requestOptions, options);
    } } };
  }
}
MockOpenAI.APIError = class MockAPIError extends Error {
  constructor(message, status) { super(message); this.name = "APIError"; this.status = status; }
};

const originalModuleLoad = Module._load;
Module._load = function loadProviderMocks(request, parent, isMain) {
  if (request === "openai") return MockOpenAI;
  if (request === "../version" && parent?.filename === providerIndexPath) {
    return { VOTC_CORE_VERSION: "9.4.0-fixture", VOTC_APP_VERSION: "9.4.0-fixture" };
  }
  return originalModuleLoad.call(this, request, parent, isMain);
};
const providers = require(providerIndexPath);
Module._load = originalModuleLoad;

function jsonClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function configFor(type) {
  return {
    providerType: type,
    apiKey: "synthetic-secret-must-not-enter-snapshot",
    defaultModel: "fixture-model",
    defaultParameters: {},
    baseUrl: type === "ollama" ? "https://ollama.fixture.invalid"
      : type === "gemini" ? "https://gemini.fixture.invalid/v1beta"
        : type === "zhipu" ? "https://zhipu.fixture.invalid/api/paas/v4"
          : type === "deepseek" ? "https://deepseek.fixture.invalid"
            : "https://compatible.fixture.invalid/v1",
    glmReasoningEffort: "high",
    glmClearThinking: true,
    actionSchemaDeliveryMode: "official_full_injected"
  };
}

function requestFor(type, stream) {
  return {
    model: "fixture-model",
    messages: [
      { role: "system", content: "Stable synthetic instruction." },
      { role: "user", content: `Dynamic ${type} prompt.` }
    ],
    stream,
    temperature: 0,
    max_tokens: 64,
    response_format: {
      type: "json_schema",
      json_schema: { name: "fixture_schema", strict: true, schema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"] } }
    }
  };
}

function sdkResponse(stream) {
  if (!stream) return Promise.resolve({ id: "fixture-response", choices: [{ message: { content: "{\"ok\":true}" }, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 } });
  return (async function*() {
    yield { id: "fixture-response", choices: [{ index: 0, delta: { content: "{\"ok\":true}" }, finish_reason: null }] };
    yield { id: "fixture-response", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] };
  })();
}

function readerFor(text) {
  let read = false;
  return {
    getReader() {
      return {
        async read() {
          if (read) return { done: true, value: undefined };
          read = true;
          return { done: false, value: Buffer.from(text) };
        },
        async cancel() {},
        releaseLock() {}
      };
    }
  };
}

function fetchResponse(type, stream) {
  if (type === "ollama") {
    const body = stream
      ? `${JSON.stringify({ message: { role: "assistant", content: "fixture" }, done: false })}\n${JSON.stringify({ done: true, done_reason: "stop", prompt_eval_count: 10, eval_count: 2 })}\n`
      : null;
    return {
      ok: true, status: 200, headers: { get: () => null },
      body: body == null ? null : readerFor(body),
      async json() { return { created_at: "fixture", message: { content: "fixture" }, done: true, done_reason: "stop", prompt_eval_count: 10, eval_count: 2 }; }
    };
  }
  const event = value => `data: ${JSON.stringify(value)}\r\n\r\n`;
  const streamBody = event({ responseId: "fixture", candidates: [{ content: { parts: [{ text: "fixture" }] } }] })
    + event({ responseId: "fixture", candidates: [{ finishReason: "STOP" }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 2, totalTokenCount: 12 } });
  return {
    ok: true, status: 200, headers: { get: () => null },
    body: stream ? readerFor(streamBody) : null,
    async json() { return { responseId: "fixture", candidates: [{ content: { parts: [{ text: "fixture" }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 2, totalTokenCount: 12 } }; }
  };
}

async function collect(value) {
  if (!value || typeof value[Symbol.asyncIterator] !== "function") return value;
  const iterator = value[Symbol.asyncIterator]();
  while (true) {
    const step = await iterator.next();
    if (step.done) return step.value;
  }
}

async function withFixture(type, { failFirst = false } = {}, operation) {
  assert.equal(activeFixture, null, "fixtures_are_serial");
  const previousFetch = global.fetch;
  activeFixture = { type, transports: [], fetchAttempts: 0, sdkAttempts: 0, failFirst };
  activeFixture.respond = (request) => {
    activeFixture.sdkAttempts++;
    if (failFirst && activeFixture.sdkAttempts === 1) return Promise.reject(Object.assign(new Error("synthetic 503"), { status: 503 }));
    return sdkResponse(request.stream === true);
  };
  global.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    const body = init.body ? JSON.parse(init.body) : null;
    activeFixture.timeline?.push("transport");
    activeFixture.transports.push({ kind: "fetch", url: url.href, body, init });
    activeFixture.fetchAttempts++;
    if (failFirst && activeFixture.fetchAttempts === 1) {
      return { ok: false, status: 503, headers: { get: () => null }, body: null };
    }
    return fetchResponse(type, type === "gemini" ? url.pathname.includes(":streamGenerateContent") : body.stream === true);
  };
  try {
    await operation({ provider: new providers[providerClasses[type]](), config: configFor(type), fixture: activeFixture });
  } finally {
    activeFixture = null;
    global.fetch = previousFetch;
  }
}

function makeControl({ snapshots, timeline, block = false, cancelDuringGuard = false, proof, onEffectiveRequest, duringGuard }) {
  let control;
  control = createRequestControl({
    requestType: "action",
    planStatus: "PROMPT_PLAN_V9",
    ownerEvidence: proof.ownerEvidence === true ? "PRESENT" : "UNKNOWN",
    promptPlanProof: proof,
    onEffectiveRequest,
    beforeTransport: async (snapshot, receivedProof, budget) => {
      timeline.push("guard");
      snapshots.push({ snapshot, receivedProof, budget });
      assert.equal(receivedProof, proof, "opaque_plan_proof_passes_by_identity");
      if (cancelDuringGuard) {
        control.cancel();
        return new Promise(() => {});
      }
      if (block) return { ok: false, reasonCode: "fixture_guard_blocked" };
      await duringGuard?.();
      return { ok: true };
    },
    beforeSend: () => { timeline.push("beforeSend"); }
  });
  return control;
}

function assertSnapshotMatchesTransport(type, request, capture, actual, timeline, expectedOwnerEvidence = "UNKNOWN") {
  const { snapshot } = capture;
  assert.deepEqual(timeline.slice(0, 2), ["guard", "beforeSend"], `${type}_guard_precedes_existing_send_guard`);
  assert.equal(snapshot.requestType, "action", `${type}_request_type`);
  assert.equal(snapshot.providerType, type, `${type}_provider_type`);
  assert.equal(snapshot.protocol, type === "ollama" ? "ollama_api_chat" : type === "gemini" ? "gemini_generate_content" : "openai_chat_completions");
  assert.equal(snapshot.stream, request.stream, `${type}_stream_mode`);
  assert.equal(snapshot.method, "POST");
  assert.equal(snapshot.adapterInputMessagesFingerprint, fingerprintMessages(request.messages), `${type}_adapter_entry_fingerprint`);
  assert.equal(snapshot.planStatus, expectedOwnerEvidence === "PRESENT" ? "PROMPT_PLAN_V9" : "LEGACY_OBSERVED");
  assert.equal(snapshot.ownerEvidence, expectedOwnerEvidence);
  assert.match(snapshot.payloadFingerprint, /^[a-f0-9]{64}$/);
  assert.match(snapshot.effectiveRequestFingerprint, /^[a-f0-9]{64}$/);
  assert.ok(Object.isFrozen(snapshot) && Object.isFrozen(snapshot.payload), `${type}_snapshot_is_read_only`);
  assert.deepEqual(snapshot.payload, actual, `${type}_observed_final_payload_matches_transport`);
  assert.equal(JSON.stringify(snapshot).includes("synthetic-secret-must-not-enter-snapshot"), false, `${type}_credential_absent`);
  assert.equal(JSON.stringify(snapshot).includes("Authorization"), false, `${type}_headers_absent`);
  if (type === "gemini") {
    assert.equal(snapshot.endpoint.display.includes("synthetic-secret"), false, "gemini_query_secret_redacted_from_endpoint");
    assert.match(snapshot.endpoint.display, /\?(?:key|alt&key)$/);
  }
}

async function testEveryAdapterObservesItsFinalPayload() {
  for (const type of providerTypes) {
    for (const stream of [false, true]) {
      await withFixture(type, {}, async ({ provider, config, fixture }) => {
        const request = requestFor(type, stream);
        const snapshots = [];
        const timeline = [];
        const effectiveObservations = [];
        fixture.timeline = timeline;
        const proof = { plan: { id: "fixture-plan" }, serialized: { messages: request.messages }, ownerEvidence: true };
        const control = makeControl({ snapshots, timeline, proof, onEffectiveRequest: (snapshot, budget) => {
          timeline.push("effective");
          queueMicrotask(() => timeline.push("after_effective_microtask"));
          effectiveObservations.push({ snapshot, budget });
        } });
        control.onEffectiveRequestDiagnostic = () => timeline.push("diagnostic_attach");
        try {
          const response = await collect(provider.chatCompletion({ ...request, signal: control.signal }, config, control));
          assert.equal(response.finish_reason, "stop", `${type}_${stream ? "stream" : "nonstream"}_complete`);
          assert.equal(snapshots.length, 1, `${type}_${stream ? "stream" : "nonstream"}_guard_once`);
          assert.equal(effectiveObservations.length, 1, `${type}_${stream ? "stream" : "nonstream"}_final_snapshot_observed_once`);
          assert.deepEqual(timeline, ["guard", "beforeSend", "effective", "diagnostic_attach", "transport", "after_effective_microtask"], `${type}_diagnostics_attach_after_external_review_and_before_transport`);
          assert.notEqual(snapshots[0].snapshot.ownerEvidence, "PRESENT", `${type}_guard_does_not_claim_authority_before_source_review`);
          assert.equal(snapshots[0].snapshot.planStatus, "LEGACY_OBSERVED", `${type}_guard_does_not_claim_verified_plan_before_source_review`);
          assert.equal(effectiveObservations[0].snapshot.ownerEvidence, "PRESENT", `${type}_observer_receives_post_guard_authority`);
          assert.equal(effectiveObservations[0].snapshot.payloadFingerprint, snapshots[0].snapshot.payloadFingerprint, `${type}_post_guard_snapshot_keeps_final_payload_identity`);
          assert.equal(fixture.transports.length, 1, `${type}_${stream ? "stream" : "nonstream"}_one_transport`);
          const sent = fixture.transports[0];
          assert.equal(sent.kind, type === "ollama" || type === "gemini" ? "fetch" : "sdk");
          const actualPayload = sent.kind === "sdk" ? sent.request : sent.body;
          assertSnapshotMatchesTransport(type, request, effectiveObservations[0], actualPayload, timeline, "PRESENT");
        } finally {
          control.dispose();
        }
      });
    }
  }
}

async function testGuardRunsOncePerRetryAndCanStopEveryAdapter() {
  const originalSetTimeout = global.setTimeout;
  global.setTimeout = (callback, _delay, ...args) => originalSetTimeout(callback, 0, ...args);
  try {
    for (const type of providerTypes) {
      await withFixture(type, { failFirst: true }, async ({ provider, config, fixture }) => {
        const request = requestFor(type, false);
        const snapshots = [];
        const timeline = [];
        const effectiveObservations = [];
        const proof = { plan: { id: "retry-plan" }, serialized: { messages: request.messages }, ownerEvidence: true };
        const control = makeControl({ snapshots, timeline, proof, onEffectiveRequest: (snapshot, budget) => {
          timeline.push("effective");
          effectiveObservations.push({ snapshot, budget });
        } });
        try {
          const response = await collect(provider.chatCompletion({ ...request, signal: control.signal }, config, control));
          assert.equal(response.finish_reason, "stop", `${type}_retry_complete`);
          assert.equal(fixture.transports.length, 2, `${type}_two_real_attempts`);
          assert.equal(snapshots.length, 2, `${type}_guard_repeated_for_retry`);
          assert.equal(effectiveObservations.length, 2, `${type}_effective_observer_repeats_for_retry`);
          assert.deepEqual(timeline, ["guard", "beforeSend", "effective", "guard", "beforeSend", "effective"], `${type}_retry_guard_order`);
          for (let index = 0; index < snapshots.length; index++) {
            const transport = fixture.transports[index];
            assertSnapshotMatchesTransport(type, request, { snapshot: effectiveObservations[index].snapshot }, transport.kind === "sdk" ? transport.request : transport.body, timeline.slice(index * 3, index * 3 + 2), "PRESENT");
          }
        } finally {
          control.dispose();
        }
      });

      await withFixture(type, {}, async ({ provider, config, fixture }) => {
        const request = requestFor(type, false);
        const snapshots = [];
        const timeline = [];
        const proof = { plan: { id: "blocked-plan" }, serialized: { messages: request.messages }, ownerEvidence: true };
        const control = makeControl({ snapshots, timeline, block: true, proof });
        try {
          await assert.rejects(() => collect(provider.chatCompletion({ ...request, signal: control.signal }, config, control)), error => {
            assert.equal(error.code, "fixture_guard_blocked", `${type}_guard_error_preserved`);
            assert.equal(error.votcPreflight, true, `${type}_guard_error_classified_preflight`);
            return true;
          });
          assert.equal(snapshots.length, 1, `${type}_blocked_guard_once`);
          assert.equal(timeline.includes("beforeSend"), false, `${type}_blocked_before_send_skipped`);
          assert.equal(fixture.transports.length, 0, `${type}_blocked_transport_skipped`);
        } finally {
          control.dispose();
        }
      });

      await withFixture(type, {}, async ({ provider, config, fixture }) => {
        const request = requestFor(type, false);
        const snapshots = [];
        const timeline = [];
        const proof = { plan: { id: "cancelled-plan" }, serialized: { messages: request.messages }, ownerEvidence: true };
        const control = makeControl({ snapshots, timeline, cancelDuringGuard: true, proof });
        try {
          await assert.rejects(() => collect(provider.chatCompletion({ ...request, signal: control.signal }, config, control)), error => {
            assert.equal(error.name, "AbortError", `${type}_guard_cancellation_preserved`);
            return true;
          });
          assert.equal(snapshots.length, 1, `${type}_cancelled_guard_once`);
          assert.equal(timeline.includes("beforeSend"), false, `${type}_cancelled_before_send_skipped`);
          assert.equal(fixture.transports.length, 0, `${type}_cancelled_transport_skipped`);
        } finally {
          control.dispose();
        }
      });
    }
  } finally {
    global.setTimeout = originalSetTimeout;
  }
}

async function testFinalSchemaBudgetBlocksRealAdapterTransport() {
  await withFixture("openai-compatible", {}, async ({ provider, config, fixture }) => {
    const request = requestFor("openai-compatible", false);
    request.response_format.json_schema = {
      name: "oversized_schema_fixture",
      strict: true,
      schema: { type: "object", properties: { payload: { type: "string", description: "x".repeat(12000) } }, required: ["payload"] }
    };
    const snapshots = [];
    const timeline = [];
    const proof = { plan: { id: "oversized-schema-plan" }, serialized: { messages: request.messages }, ownerEvidence: true };
    const control = makeControl({ snapshots, timeline, proof });
    control.setEffectiveRequestBudget(snapshot => preflightEffectiveRequestBudget(snapshot, {
      capabilities: { contextWindow: 1024, maxOutputTokens: 64 },
      requestedOutputTokens: request.max_tokens,
      countTokens: messages => messages.reduce((sum, message) => sum + Math.ceil(String(message.content || "").length / 4), 0)
    }));
    try {
      await assert.rejects(() => collect(provider.chatCompletion({ ...request, signal: control.signal }, config, control)), error => {
        assert.equal(error.code, "provider_effective_request_budget_exceeded", "schema_budget_error_is_preserved");
        assert.equal(error.votcPreflight, true, "schema_budget_error_is_preflight");
        return true;
      });
      assert.equal(snapshots.length, 0, "budget_rejection_precedes_plan_guard");
      assert.equal(timeline.length, 0, "budget_rejection_precedes_send_guard");
      assert.equal(fixture.transports.length, 0, "oversized_final_schema_stops_before_physical_transport");
    } finally {
      control.dispose();
    }
  });
}

async function testInvalidBudgetCounterBlocksRealAdapterTransport() {
  await withFixture("openai-compatible", {}, async ({ provider, config, fixture }) => {
    const request = requestFor("openai-compatible", false);
    const snapshots = [];
    const timeline = [];
    const proof = { plan: { id: "invalid-counter-plan" }, serialized: { messages: request.messages }, ownerEvidence: true };
    const control = makeControl({ snapshots, timeline, proof });
    control.setEffectiveRequestBudget(snapshot => preflightEffectiveRequestBudget(snapshot, {
      capabilities: { contextWindow: 8192, maxOutputTokens: 2048 },
      requestedOutputTokens: request.max_tokens,
      countTokens: () => Number.NaN
    }));
    try {
      await assert.rejects(() => collect(provider.chatCompletion({ ...request, signal: control.signal }, config, control)), error => {
        assert.equal(error.code, "provider_effective_request_token_count_invalid", "invalid_counter_error_is_preserved");
        assert.equal(error.votcPreflight, true, "invalid_counter_is_preflight");
        return true;
      });
      assert.equal(snapshots.length, 0, "invalid_counter_rejection_precedes_plan_guard");
      assert.equal(timeline.length, 0, "invalid_counter_rejection_precedes_send_guard");
      assert.equal(fixture.transports.length, 0, "invalid_counter_cannot_be_treated_as_zero_before_transport");
    } finally {
      control.dispose();
    }
  });
}

async function testFinalOutputAboveCapabilityBlocksRealAdapterTransport() {
  await withFixture("openai-compatible", {}, async ({ provider, config, fixture }) => {
    const request = requestFor("openai-compatible", false);
    request.max_tokens = 4096;
    const snapshots = [];
    const timeline = [];
    const proof = { plan: { id: "output-limit-plan" }, serialized: { messages: request.messages }, ownerEvidence: true };
    const control = makeControl({ snapshots, timeline, proof });
    control.setEffectiveRequestBudget(snapshot => preflightEffectiveRequestBudget(snapshot, {
      capabilities: { contextWindow: 8192, maxOutputTokens: 2048 },
      requestedOutputTokens: request.max_tokens,
      countTokens: messages => messages.reduce((sum, message) => sum + Math.ceil(String(message.content || "").length / 4), 0)
    }));
    try {
      await assert.rejects(() => collect(provider.chatCompletion({ ...request, signal: control.signal }, config, control)), error => {
        assert.equal(error.code, "provider_effective_output_limit_exceeded", "output_limit_error_is_preserved");
        assert.equal(error.votcPreflight, true, "output_limit_error_is_preflight");
        return true;
      });
      assert.equal(snapshots.length, 0, "output_limit_rejection_precedes_plan_guard");
      assert.equal(timeline.length, 0, "output_limit_rejection_precedes_send_guard");
      assert.equal(fixture.transports.length, 0, "over_cap_payload_is_not_silently_clamped_or_transmitted");
    } finally {
      control.dispose();
    }
  });
}

async function testGuardMutationCannotChangeTheRequestAfterReview() {
  for (const type of providerTypes) {
    await withFixture(type, {}, async ({ provider, config, fixture }) => {
      const request = requestFor(type, false);
      const snapshots = [];
      const timeline = [];
      const proof = { plan: { id: "mutation-plan" }, serialized: { messages: request.messages }, ownerEvidence: true };
      const control = makeControl({ snapshots, timeline, proof, duringGuard: async () => {
        await Promise.resolve();
        request.messages[1].content = "Changed while the async source guard was running.";
      } });
      try {
        await assert.rejects(() => collect(provider.chatCompletion({ ...request, signal: control.signal }, config, control)), error => {
          assert.equal(error.code, "provider_effective_request_changed_before_transport", `${type}_changed_messages_are_rejected`);
          assert.equal(error.votcPreflight, true, `${type}_changed_messages_are_preflight`);
          return true;
        });
        assert.equal(snapshots.length, 1, `${type}_mutation_guard_observed_once`);
        assert.equal(timeline.includes("beforeSend"), false, `${type}_mutation_skips_attempt_reservation`);
        assert.equal(fixture.transports.length, 0, `${type}_mutated_messages_never_reach_transport`);
      } finally {
        control.dispose();
      }
    });
  }

  for (const type of providerTypes) {
    await withFixture(type, {}, async ({ provider, config, fixture }) => {
      const request = requestFor(type, false);
      const snapshots = [];
      const timeline = [];
      const proof = { plan: { id: "message-name-mutation-plan" }, serialized: { messages: request.messages }, ownerEvidence: true };
      const control = makeControl({ snapshots, timeline, proof, duringGuard: async () => {
        await Promise.resolve();
        request.messages[1].name = "changed-during-review";
      } });
      try {
        await assert.rejects(() => collect(provider.chatCompletion({ ...request, signal: control.signal }, config, control)), error => {
          assert.equal(error.code, "provider_effective_request_changed_before_transport", `${type}_changed_message_name_is_rejected`);
          assert.equal(error.votcPreflight, true, `${type}_changed_message_name_is_preflight`);
          return true;
        });
        assert.equal(snapshots.length, 1, `${type}_message_name_mutation_guard_observed_once`);
        assert.equal(timeline.includes("beforeSend"), false, `${type}_message_name_mutation_skips_attempt_reservation`);
        assert.equal(fixture.transports.length, 0, `${type}_mutated_message_name_never_reaches_transport`);
      } finally {
        control.dispose();
      }
    });
  }

  await withFixture("openai-compatible", {}, async ({ provider, config, fixture }) => {
    const request = requestFor("openai-compatible", false);
    const snapshots = [];
    const timeline = [];
    const proof = { plan: { id: "parameter-mutation-plan" }, serialized: { messages: request.messages }, ownerEvidence: true };
    const control = makeControl({ snapshots, timeline, proof, duringGuard: async () => {
      await Promise.resolve();
      request.response_format.json_schema.schema.properties.ok.description = "Changed while reviewing the final request.";
    } });
    try {
      await assert.rejects(() => collect(provider.chatCompletion({ ...request, signal: control.signal }, config, control)), error => {
        assert.equal(error.code, "provider_effective_request_changed_before_transport", "changed_parameter_is_rejected");
        assert.equal(error.votcPreflight, true, "changed_parameter_is_preflight");
        return true;
      });
      assert.equal(snapshots.length, 1, "parameter_mutation_guard_observed_once");
      assert.equal(timeline.includes("beforeSend"), false, "parameter_mutation_skips_attempt_reservation");
      assert.equal(fixture.transports.length, 0, "mutated_final_parameters_never_reach_transport");
    } finally {
      control.dispose();
    }
  });
}

async function testExternalEffectiveCallbackMutationDoesNotAttachFinalRequest() {
  await withFixture("openai-compatible", {}, async ({ provider, config, fixture }) => {
    const request = requestFor("openai-compatible", false);
    const snapshots = [];
    const timeline = [];
    const proof = { plan: { id: "external-callback-mutation-plan" }, serialized: { messages: request.messages }, ownerEvidence: true };
    const control = makeControl({ snapshots, timeline, proof, onEffectiveRequest: () => {
      timeline.push("external_effective");
      request.messages[0].name = "changed-by-external-observer";
    } });
    control.onEffectiveRequestDiagnostic = () => timeline.push("diagnostic_attach");
    try {
      await assert.rejects(() => collect(provider.chatCompletion({ ...request, signal: control.signal }, config, control)), error => {
        assert.equal(error.code, "provider_effective_request_changed_before_transport", "external_callback_mutation_is_rejected");
        assert.equal(error.votcPreflight, true, "external_callback_mutation_is_preflight");
        return true;
      });
      assert.deepEqual(timeline, ["guard", "beforeSend", "external_effective"], "diagnostic_attachment_waits_until_external_callback_verifies");
      assert.equal(fixture.transports.length, 0, "external_callback_mutation_never_reaches_transport");
    } finally {
      control.dispose();
    }
  });
}

async function testZhipuNativeUsageEvidenceComesFromRealAdapterResponse() {
  const fixtures = [
    {
      name: "null",
      usage: { prompt_tokens: null, completion_tokens: null, total_tokens: null },
      expectedEvidence: {
        prompt_tokens: { present: true, value: null },
        completion_tokens: { present: true, value: null },
        total_tokens: { present: true, value: null }
      },
      expectedLegacy: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
    },
    {
      name: "invalid_string_and_object",
      usage: {
        prompt_tokens: "invalid-count",
        completion_tokens: "not-a-number",
        total_tokens: { private: "must-not-leak" },
        prompt_tokens_details: { cached_tokens: "invalid-cache-count", private: "must-not-leak" },
        completion_tokens_details: { reasoning_tokens: { private: "must-not-leak" } }
      },
      expectedEvidence: {
        prompt_tokens: { present: true, value: "invalid-count" },
        completion_tokens: { present: true, value: "not-a-number" },
        total_tokens: { present: true, valueType: "object" },
        prompt_tokens_details: { cached_tokens: { present: true, value: "invalid-cache-count" } },
        completion_tokens_details: { reasoning_tokens: { present: true, valueType: "object" } }
      },
      expectedLegacy: {
        prompt_tokens: 0, completion_tokens: 0, total_tokens: 0,
        prompt_tokens_details: { cached_tokens: null },
        completion_tokens_details: { reasoning_tokens: 0 }
      }
    },
    {
      name: "reported_zero",
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      expectedEvidence: {
        prompt_tokens: { present: true, value: 0 },
        completion_tokens: { present: true, value: 0 },
        total_tokens: { present: true, value: 0 }
      },
      expectedLegacy: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
    },
    { name: "missing_fields", usage: {}, expectedEvidence: {}, expectedLegacy: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 } },
    { name: "missing_usage", omitUsage: true }
  ];

  for (const fixtureCase of fixtures) {
    await withFixture("zhipu", {}, async ({ provider, config, fixture }) => {
      fixture.respond = () => {
        const response = {
          id: `zhipu-${fixtureCase.name}`,
          choices: [{ message: { content: "{\"ok\":true}" }, finish_reason: "stop" }]
        };
        if (!fixtureCase.omitUsage) response.usage = fixtureCase.usage;
        return Promise.resolve(response);
      };
      const response = await provider.chatCompletion(requestFor("zhipu", false), config);
      if (fixtureCase.omitUsage) {
        assert.equal(response.usage_debug, null, "missing_provider_usage_does_not_synthesize_native_evidence");
        return;
      }
      assert.deepEqual(response.usage_debug?.raw_usage, fixtureCase.expectedLegacy, `${fixtureCase.name}_v1_raw_usage_compatibility`);
      assert.deepEqual(response.usage_debug?.native_usage_evidence, fixtureCase.expectedEvidence, `${fixtureCase.name}_native_provider_evidence`);
      assert.equal(JSON.stringify(response.usage_debug.native_usage_evidence).includes("must-not-leak"), false, `${fixtureCase.name}_arbitrary_raw_object_is_not_exposed`);
    });
  }

  await withFixture("zhipu", {}, async ({ provider, config, fixture }) => {
    fixture.respond = () => (async function*() {
      yield { id: "zhipu-stream", choices: [{ index: 0, delta: { content: "{\"ok\":true}" }, finish_reason: null }] };
      yield { id: "zhipu-stream", choices: [], usage: { prompt_tokens: "invalid-tail-count", completion_tokens: 0, total_tokens: null } };
      yield { id: "zhipu-stream", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] };
    })();
    const iterator = provider.chatCompletion(requestFor("zhipu", true), config)[Symbol.asyncIterator]();
    let finalResponse;
    let usageTail;
    while (true) {
      const step = await iterator.next();
      if (step.done) {
        finalResponse = step.value;
        break;
      }
      if (step.value?.usage_debug) usageTail = step.value.usage_debug;
    }
    const expected = {
      prompt_tokens: { present: true, value: "invalid-tail-count" },
      completion_tokens: { present: true, value: 0 },
      total_tokens: { present: true, value: null }
    };
    assert.deepEqual(usageTail?.native_usage_evidence, expected, "stream_usage_only_tail_carries_native_evidence");
    assert.deepEqual(finalResponse.usage_debug?.native_usage_evidence, expected, "stream_final_response_carries_native_evidence");
    assert.ok(Object.isFrozen(finalResponse.usage_debug.native_usage_evidence), "native_usage_evidence_is_read_only");
  });
}

async function run() {
  const savedConsole = { log: console.log, info: console.info, warn: console.warn, error: console.error };
  console.log = console.info = console.warn = console.error = () => {};
  try {
    await testEveryAdapterObservesItsFinalPayload();
    await testGuardRunsOncePerRetryAndCanStopEveryAdapter();
    await testFinalSchemaBudgetBlocksRealAdapterTransport();
    await testInvalidBudgetCounterBlocksRealAdapterTransport();
    await testFinalOutputAboveCapabilityBlocksRealAdapterTransport();
    await testGuardMutationCannotChangeTheRequestAfterReview();
    await testExternalEffectiveCallbackMutationDoesNotAttachFinalRequest();
    await testZhipuNativeUsageEvidenceComesFromRealAdapterResponse();
    process.stdout.write("V9.4 provider effective request: PASS (7 offline adapters, final payload, race guards, retries, cancellation, native Zhipu usage evidence).\n");
  } finally {
    Object.assign(console, savedConsole);
  }
}

run().catch(error => {
  process.stderr.write(`V9.4 provider effective request: FAIL\n${error?.stack || error?.message || "unknown"}\n`);
  process.exitCode = 1;
});
