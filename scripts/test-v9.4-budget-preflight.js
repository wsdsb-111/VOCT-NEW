"use strict";

const assert = require("node:assert/strict");
const { LLMManager } = require("../src/app/main/provider-service");
const { createEffectiveRequestSnapshot, extractEffectivePromptMessages, preflightEffectiveRequestBudget, fingerprintMessages } = require("../src/app/main/providers/effective-request");
const { createRequestControl } = require("../src/app/main/providers/provider-cancellation");
const { resolveMemoryBudget } = require("../src/app/main/memory-system/memory-budget-policy");

const inputMessages = [
  { role: "system", content: "Stable fixture instructions." },
  { role: "user", content: "Dynamic fixture prompt." }
];

function capabilities(contextWindow = 8192) {
  return { contextWindow, maxOutputTokens: 2048 };
}

function countTokens(messages) {
  return messages.reduce((sum, message) => sum + Math.ceil(String(message.content || "").length / 4), 0);
}

function snapshots() {
  return [
    {
      requestType: "chat",
      providerType: "openai-compatible",
      protocol: "openai_chat_completions",
      endpoint: "https://provider.fixture.invalid/v1/chat/completions",
      payload: { model: "fixture", messages: inputMessages, stream: false, max_tokens: 128 }
    },
    {
      requestType: "action",
      providerType: "ollama",
      protocol: "ollama_api_chat",
      endpoint: "https://ollama.fixture.invalid/api/chat",
      payload: { model: "fixture", messages: inputMessages, stream: false, options: { num_predict: 96 } }
    },
    {
      requestType: "rolling_summary",
      providerType: "gemini",
      protocol: "gemini_generate_content",
      endpoint: "https://gemini.fixture.invalid/v1beta/models/fixture:generateContent?key=fixture-secret",
      payload: {
        systemInstruction: { role: "user", parts: [{ text: inputMessages[0].content }] },
        contents: [{ role: "user", parts: [{ text: inputMessages[1].content }] }],
        generationConfig: { maxOutputTokens: 64 }
      }
    }
  ].map(value => createEffectiveRequestSnapshot({ ...value, method: "POST", stream: value.payload.stream ?? false,
    adapterInputMessagesFingerprint: fingerprintMessages(inputMessages) }));
}

async function testProtocolOutputReservations() {
  const requests = snapshots();
  const expected = [128, 96, 64];
  for (let index = 0; index < requests.length; index++) {
    const budget = preflightEffectiveRequestBudget(requests[index], {
      capabilities: capabilities(),
      requestedOutputTokens: 512,
      countTokens
    });
    assert.equal(budget.safe, true, `${requests[index].providerType}_safe_fixture`);
    assert.equal(budget.reservedOutputTokens, expected[index], `${requests[index].providerType}_uses_final_protocol_output_limit`);
    assert.equal(budget.effectiveRequestFingerprint, requests[index].effectiveRequestFingerprint);
  }
}

async function testProviderServiceWiresBudgetAndOpaqueProof() {
  const manager = Object.create(LLMManager.prototype);
  manager.TokenCounter = {
    calculateTotalTokens: countTokens,
    estimateTokens: text => Math.ceil(String(text || "").length / 4)
  };
  const requests = snapshots();
  const requestTypes = ["chat", "action", "rolling_summary", "letter"];
  for (let index = 0; index < requestTypes.length; index++) {
    const proof = index === 3 ? undefined : { plan: { id: `plan-${index}` }, serialized: { messages: inputMessages }, ownerEvidence: true };
    let received = null;
    let transportCalls = 0;
    manager.platform = {
      async generate(_provider, _request, _config, options) {
        transportCalls++;
        const base = requests[index % requests.length];
        const snapshot = createEffectiveRequestSnapshot({
          requestType: options.control.requestType,
          providerType: base.providerType,
          protocol: base.protocol,
          method: base.method,
          endpoint: base.endpoint.display,
          stream: base.stream,
          payload: base.payload,
          adapterInputMessagesFingerprint: fingerprintMessages(inputMessages),
          planStatus: options.control.planStatus,
          ownerEvidence: options.control.ownerEvidence
        });
        return options.control.beforeTransport(snapshot);
      }
    };
    const config = { providerType: requests[index % requests.length].providerType, defaultModel: "fixture" };
    const control = manager.createControl(config, index === 1 ? "ACTION" : index === 2 || index === 3 ? "SUMMARY" : "CHAT", undefined, {
      requestType: requestTypes[index],
      promptPlanProof: proof,
      beforeTransportGuard: (snapshot, receivedProof, budget) => {
        received = { snapshot, receivedProof, budget };
        return { ok: true };
      }
    });
    try {
      const request = { max_tokens: 512 };
      const result = await manager.generate({}, request, config, capabilities(), control, 10);
      assert.equal(transportCalls, 1, `${requestTypes[index]}_generate_reaches_transport_boundary`);
      assert.equal(received.receivedProof, proof, `${requestTypes[index]}_proof_forwarded_opaque`);
      assert.equal(received.snapshot.requestType, requestTypes[index], `${requestTypes[index]}_type_provenance`);
      assert.equal(received.snapshot.planStatus, proof ? "PROMPT_PLAN_V9" : "LEGACY_OBSERVED", `${requestTypes[index]}_plan_provenance`);
      assert.equal(received.snapshot.ownerEvidence, proof ? "PRESENT" : "UNKNOWN", `${requestTypes[index]}_owner_evidence_fail_closed`);
      assert.equal(result.safe, true, `${requestTypes[index]}_computed_budget_returned`);
      assert.equal(received.budget.effectiveRequestFingerprint, received.snapshot.effectiveRequestFingerprint);
    } finally {
      control.dispose();
    }
  }
}

async function testUnsafeFinalPayloadStopsBeforeGuardAndTransport() {
  const manager = Object.create(LLMManager.prototype);
  manager.TokenCounter = {
    calculateTotalTokens: () => 100000,
    estimateTokens: () => 1
  };
  let guardCalls = 0;
  let transportCalls = 0;
  manager.platform = {
    async generate(_provider, _request, _config, options) {
      transportCalls++;
      const base = snapshots()[0];
      const snapshot = createEffectiveRequestSnapshot({
        requestType: options.control.requestType,
        providerType: base.providerType,
        protocol: base.protocol,
        endpoint: base.endpoint.display,
        stream: base.stream,
        payload: base.payload,
        adapterInputMessagesFingerprint: fingerprintMessages(inputMessages),
        planStatus: options.control.planStatus,
        ownerEvidence: options.control.ownerEvidence
      });
      return options.control.beforeTransport(snapshot);
    }
  };
  const config = { providerType: "openai-compatible", defaultModel: "fixture" };
  const control = manager.createControl(config, "CHAT", undefined, {
    requestType: "letter",
    beforeTransportGuard: () => { guardCalls++; return { ok: true }; }
  });
  try {
    await assert.rejects(() => manager.generate({}, { max_tokens: 512 }, config, capabilities(1024), control, 1), error => {
      assert.equal(error.code, "provider_effective_request_budget_exceeded");
      assert.equal(error.votcPreflight, true);
      return true;
    });
    assert.equal(transportCalls, 1, "boundary_called_once_but_no_physical_provider_transport");
    assert.equal(guardCalls, 0, "over_budget_stops_before_plan_guard");
  } finally {
    control.dispose();
  }
}

async function testOpenAiJsonSchemaCountsTowardFinalBudget() {
  const schema = {
    name: "large_schema_fixture",
    strict: true,
    schema: {
      type: "object",
      properties: {
        payload: { type: "string", description: "x".repeat(12000) }
      },
      required: ["payload"]
    }
  };
  const request = createEffectiveRequestSnapshot({
    requestType: "action",
    providerType: "openai-compatible",
    protocol: "openai_chat_completions",
    endpoint: "https://provider.fixture.invalid/v1/chat/completions",
    payload: {
      model: "fixture",
      messages: inputMessages,
      stream: false,
      max_tokens: 64,
      response_format: { type: "json_schema", json_schema: schema }
    },
    adapterInputMessagesFingerprint: fingerprintMessages(inputMessages)
  });
  const effectiveMessages = extractEffectivePromptMessages(request);
  assert.equal(effectiveMessages.length, inputMessages.length + 1, "schema_is_projected_as_additional_effective_prompt_content");
  assert.deepEqual(JSON.parse(effectiveMessages.at(-1).content), schema, "schema_content_is_exactly_counted");
  assert.throws(() => preflightEffectiveRequestBudget(request, {
    capabilities: capabilities(1024),
    requestedOutputTokens: 64,
    countTokens
  }), error => {
    assert.equal(error.code, "provider_effective_request_budget_exceeded");
    assert.equal(error.votcPreflight, true);
    return true;
  }, "large_response_format_schema_cannot_be_omitted_from_final_budget");
}

async function testProviderDiagnosticsObserverCoversEveryRequestType() {
  const manager = Object.create(LLMManager.prototype);
  manager.TokenCounter = { calculateTotalTokens: countTokens, estimateTokens: text => Math.ceil(String(text || "").length / 4) };
  const created = [];
  const attached = [];
  let usageMetadata = null;
  let diagnosticMetadata = null;
  manager.providerDiagnostics = {
    createCacheDiagnosticsObserver(input) {
      const token = Object.freeze({ requestType: input.requestType });
      created.push({ input, token });
      return token;
    },
    attachEffectiveRequest(token, snapshot, budget) { attached.push({ token, snapshot, budget }); },
    recordResponse({ metadata }) { diagnosticMetadata = metadata; }
  };
  manager.usageAnalytics = { record(metadata) { usageMetadata = metadata; } };
  const requestTypes = ["chat", "chat_continuation", "action", "summary", "rolling_summary", "final_summary", "memory_recovery", "letter"];
  for (const requestType of requestTypes) {
    const requestDiff = requestType === "chat" ? { version: "real_request_diff_v1" } : null;
    const token = manager.createCacheDiagnosticsObserver("openai-compatible", "fixture", requestType, requestDiff, {
      cacheDiagnosticContext: { plan: { layoutId: "v9_4", layoutRevision: "fixture" }, messageSpans: [] }
    });
    const snapshot = createEffectiveRequestSnapshot({
      requestType,
      providerType: "openai-compatible",
      protocol: "openai_chat_completions",
      endpoint: "https://provider.fixture.invalid/v1/chat/completions",
      payload: { model: "fixture", messages: inputMessages, stream: false, max_tokens: 64 }
    });
    const budget = { safe: true, estimatedInputTokens: 10, reservedOutputTokens: 64 };
    const control = createRequestControl();
    manager.wireEffectiveRequestObserver(control, token);
    const callbackResult = control.onEffectiveRequestDiagnostic(snapshot, budget);
    assert.equal(callbackResult, undefined, `${requestType}_effective_observer_is_synchronous`);
    assert.equal(attached.at(-1).token, token, `${requestType}_observer_token_attached`);
    assert.equal(attached.at(-1).snapshot, snapshot, `${requestType}_observer_gets_final_snapshot`);
    assert.equal(created.at(-1).input.requestDiff, requestDiff, `${requestType}_keeps_chat_only_v1_diff`);
    control.dispose();
  }

  const cacheDiagnosticsObserverToken = created.at(-1).token;
  await manager.trackUsage(Promise.resolve({ content: "ok", finish_reason: "stop" }), {
    providerType: "openai-compatible", model: "fixture", requestType: "letter", estimatedPromptTokens: 10,
    cacheDiagnosticsObserverToken
  });
  assert.equal(Object.hasOwn(usageMetadata, "cacheDiagnosticsObserverToken"), false, "opaque_observer_token_never_enters_usage_analytics");
  assert.equal(diagnosticMetadata.cacheDiagnosticsObserverToken, cacheDiagnosticsObserverToken, "observer_token_reaches_only_in_memory_provider_diagnostics");
}

async function testInvalidTokenCountersFailClosed() {
  const request = snapshots()[0];
  const invalidCounters = [
    { name: "missing", countTokens: undefined, code: "provider_effective_request_token_count_unavailable" },
    { name: "nan", countTokens: () => Number.NaN, code: "provider_effective_request_token_count_invalid" },
    { name: "infinity", countTokens: () => Infinity, code: "provider_effective_request_token_count_invalid" },
    { name: "negative", countTokens: () => -1, code: "provider_effective_request_token_count_invalid" },
    { name: "undefined", countTokens: () => undefined, code: "provider_effective_request_token_count_invalid" }
  ];
  for (const fixture of invalidCounters) {
    assert.throws(() => preflightEffectiveRequestBudget(request, {
      capabilities: capabilities(),
      requestedOutputTokens: 64,
      countTokens: fixture.countTokens
    }), error => {
      assert.equal(error.code, fixture.code, `${fixture.name}_counter_rejected`);
      assert.equal(error.votcPreflight, true, `${fixture.name}_counter_is_preflight_failure`);
      return true;
    }, `${fixture.name}_counter_cannot_be_coerced_to_zero`);
  }
}

async function testFinalOutputAboveCapabilityFailsClosed() {
  const request = createEffectiveRequestSnapshot({
    requestType: "action",
    providerType: "openai-compatible",
    protocol: "openai_chat_completions",
    endpoint: "https://provider.fixture.invalid/v1/chat/completions",
    payload: { model: "fixture", messages: inputMessages, max_tokens: 4096 }
  });
  assert.throws(() => preflightEffectiveRequestBudget(request, {
    capabilities: { contextWindow: 8192, maxOutputTokens: 2048 },
    requestedOutputTokens: 4096,
    countTokens
  }), error => {
    assert.equal(error.code, "provider_effective_output_limit_exceeded");
    assert.equal(error.votcPreflight, true);
    return true;
  }, "actual_output_request_above_capability_is_rejected_without_clamping");
}

async function testLegacySnapshotDefaults() {
  const snapshot = createEffectiveRequestSnapshot({
    requestType: "letter_summary",
    providerType: "fixture",
    protocol: "openai_chat_completions",
    endpoint: "https://provider.fixture.invalid/v1/chat/completions",
    payload: { model: "fixture", messages: inputMessages, max_tokens: 64 }
  });
  assert.equal(snapshot.planStatus, "LEGACY_OBSERVED");
  assert.equal(snapshot.ownerEvidence, "UNKNOWN");
  assert.equal(snapshot.adapterInputMessagesFingerprint, fingerprintMessages(inputMessages));
}

async function testConfiguredLargeWindowMemoryBudgets() {
  for (const contextWindow of [128000, 192000]) {
    for (const [participantCount, ratio, cap] of [[2, 0.65, 80000], [3, 0.70, 84000], [4, 0.75, 96000]]) {
      const memory = resolveMemoryBudget({ participantCount, contextWindowTokens: contextWindow, providerHeadroomTokens: contextWindow });
      assert.equal(memory.ratio, ratio);
      assert.equal(memory.memoryBudgetTokens, cap, "large configured windows retain the existing participant cap");
      const narrative = "F".repeat(cap * 4);
      const create = currentTurn => createEffectiveRequestSnapshot({
        requestType: "chat", providerType: "openai-compatible", protocol: "openai_chat_completions",
        endpoint: "https://provider.fixture.invalid/v1/chat/completions",
        payload: { model: "fixture", max_tokens: 1024, messages: [
          { role: "system", content: narrative }, { role: "user", content: currentTurn }
        ] }
      });
      const safe = create("Current fictional turn.");
      assert.equal(preflightEffectiveRequestBudget(safe, { capabilities: capabilities(contextWindow), countTokens }).safe, true);
      assert.equal(safe.payload.messages[0].content, narrative, "the complete legal narrative survives final preflight");
      const crowded = create("D".repeat(contextWindow * 4));
      assert.throws(() => preflightEffectiveRequestBudget(crowded, { capabilities: capabilities(contextWindow), countTokens }), error =>
        error.code === "provider_effective_request_budget_exceeded" && error.budget.estimatedInputTokens > error.budget.effectiveInputBudget);
      assert.equal(crowded.payload.messages[0].content, narrative, "over-budget final requests are blocked, never repaired by truncating memory");
    }
  }
}

async function run() {
  await testProtocolOutputReservations();
  await testProviderServiceWiresBudgetAndOpaqueProof();
  await testProviderDiagnosticsObserverCoversEveryRequestType();
  await testUnsafeFinalPayloadStopsBeforeGuardAndTransport();
  await testOpenAiJsonSchemaCountsTowardFinalBudget();
  await testInvalidTokenCountersFailClosed();
  await testFinalOutputAboveCapabilityFailsClosed();
  await testLegacySnapshotDefaults();
  await testConfiguredLargeWindowMemoryBudgets();
  process.stdout.write("V9.4 budget preflight: PASS (OpenAI/Ollama/Gemini final mappings, all request types, proof provenance, fail-closed budget).\n");
}

run().catch(error => {
  process.stderr.write(`V9.4 budget preflight: FAIL\n${error?.stack || error?.message || "unknown"}\n`);
  process.exitCode = 1;
});
