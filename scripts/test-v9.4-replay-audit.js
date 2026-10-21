"use strict";

const assert = require("node:assert/strict");
const Module = require("node:module");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const providerIndexPath = path.join(root, "src/app/main/providers/index.js");
let activeFixture = null;

class MockOpenAI {
  constructor(options = {}) {
    this.chat = { completions: { create: (request, requestOptions) => {
      assert.ok(activeFixture, "mock_provider_transport_requires_an_active_fixture");
      activeFixture.transports.push({ request: jsonClone(request), requestOptions, clientOptions: options });
      return Promise.resolve({
        id: `offline-${activeFixture.transports.length}`,
        choices: [{ message: { content: request.response_format?.type === "json_schema" ? "{}" : "fixture response" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 16, completion_tokens: 3, total_tokens: 19 }
      });
    } } };
  }
}
MockOpenAI.APIError = class MockAPIError extends Error {};

const originalModuleLoad = Module._load;
Module._load = function loadOfflineProvider(request, parent, isMain) {
  if (request === "openai" && parent?.filename === providerIndexPath) return MockOpenAI;
  if (request === "../version" && parent?.filename === providerIndexPath) return { VOTC_CORE_VERSION: "9.4-fixture", VOTC_APP_VERSION: "9.4-fixture" };
  return originalModuleLoad.call(this, request, parent, isMain);
};
const { LLMManager, ProviderRegistry, TokenCounter } = require("../src/app/main/provider-service");
const { registerProviderImplementations } = require("../src/app/main/providers");
Module._load = originalModuleLoad;

function jsonClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function makeConfig() {
  return {
    providerType: "openai-compatible",
    customName: "Offline fixture",
    apiKey: "offline-secret-never-persisted",
    baseUrl: "https://provider.fixture.invalid/v1",
    defaultModel: "fixture-model",
    defaultParameters: { temperature: 0, max_tokens: 64 },
    contextMode: "custom",
    customContextLength: 8192,
    customMaxOutputTokens: 1024,
    actionSchemaDeliveryMode: "official_full_injected"
  };
}

async function main() {
  const config = makeConfig();
  const registry = new ProviderRegistry();
  registerProviderImplementations(registry);
  const transports = [];
  const attached = [];
  const observers = [];
  const diagnosticResponses = [];
  const usageRecords = [];
  const diagnostics = {
    prepareOutboundRequest(input) {
      observers.push({ kind: "v1_prepare", requestType: input.requestType });
      return input.requestType === "chat" ? { version: "real_request_diff_v1", requestType: "chat" } : null;
    },
    createCacheDiagnosticsObserver(input) {
      const token = Object.freeze({ id: observers.length + 1 });
      observers.push({ kind: "v2_create", requestType: input.requestType, requestDiff: input.requestDiff, token });
      return token;
    },
    attachEffectiveRequest(token, snapshot, budget) {
      attached.push({ token, snapshot, budget });
      return true;
    },
    recordResponse(input) { diagnosticResponses.push(input); }
  };
  const settingsRepository = {
    getActiveProviderConfig: () => config,
    getActionsProviderConfig: () => config,
    getSummaryProviderConfig: () => config,
    getGlobalStreamSetting: () => false,
    getChatPromptV89Settings: () => ({ chatPromptV89OutboundDiagnostics: true })
  };
  const PromptBuilder = {
    prepareSummaryMessages: messages => [{ role: "system", content: "Offline summary fixture." }, ...messages],
    getSummaryPromptBlocks: messages => messages.map((message, position) => ({ id: `summary_${position}`, label: `Summary ${position}`, tokens: 1 }))
  };
  const manager = new LLMManager({
    settingsRepository,
    providerRegistry: registry,
    usageAnalytics: { record(metadata, usage) { usageRecords.push({ metadata, usage }); } },
    providerDiagnostics: diagnostics,
    TokenCounter,
    PromptBuilder
  });
  manager.getProviderCapabilities = async () => ({ contextWindow: 8192, maxOutputTokens: 1024, contextMode: "custom", contextWindowSource: "fixture" });

  const savedConsole = { log: console.log, info: console.info, warn: console.warn, error: console.error };
  console.log = console.info = console.warn = console.error = () => {};
  try {
    const calls = [
      { requestType: "chat", run: () => manager.sendChatRequest([{ role: "user", content: "offline chat" }], undefined, true) },
      { requestType: "action", run: () => manager.sendActionsRequest([{ role: "user", content: "offline action" }], "votc_actions", { type: "object", properties: { ok: { type: "boolean" } } }) },
      { requestType: "summary", run: () => manager.sendSummaryRequest([{ role: "user", content: "offline summary" }], undefined, { requestType: "summary", maxTokens: 256 }) },
      { requestType: "letter", run: () => manager.sendChatRequest([{ role: "user", content: "offline letter" }], undefined, true, { requestType: "letter" }) }
    ];
    for (const call of calls) {
      activeFixture = { transports };
      await call.run();
      activeFixture = null;
      const sent = transports.at(-1);
      const observer = attached.at(-1);
      const response = diagnosticResponses.at(-1);
      assert.equal(observer.snapshot.requestType, call.requestType, `${call.requestType}_final_request_type`);
      assert.equal(observer.snapshot.planStatus, "LEGACY_OBSERVED", `${call.requestType}_missing_plan_is_legacy_observed`);
      assert.equal(observer.snapshot.ownerEvidence, "UNKNOWN", `${call.requestType}_missing_owner_proof_stays_unknown`);
      assert.equal(observer.budget.safe, true, `${call.requestType}_final_budget_passed`);
      assert.equal(observer.snapshot.payloadFingerprint.length, 64, `${call.requestType}_final_payload_fingerprinted`);
      assert.deepEqual(observer.snapshot.payload, sent.request, `${call.requestType}_final_snapshot_matches_one_mock_transport`);
      assert.equal(response.metadata.cacheDiagnosticsObserverToken, observer.token, `${call.requestType}_observer_token_reaches_diagnostics_response`);
      assert.equal(Object.hasOwn(usageRecords.at(-1).metadata, "cacheDiagnosticsObserverToken"), false, `${call.requestType}_observer_token_not_recorded_in_usage_analytics`);
    }

    assert.equal(transports.length, 4, "chat_action_summary_letter_each_use_one_offline_transport");
    assert.equal(attached.length, 4, "all_four_request_types_attach_a_final_effective_snapshot");
    assert.deepEqual(observers.filter(item => item.kind === "v1_prepare").map(item => item.requestType), ["chat"], "legacy_v1_request_diff_stays_chat_only");
    assert.deepEqual(observers.filter(item => item.kind === "v2_create").map(item => item.requestType), ["chat", "action", "summary", "letter"], "observer_only_v2_covers_all_request_types");
    assert.equal(JSON.stringify(diagnosticResponses).includes("offline-secret-never-persisted"), false, "provider_credentials_do_not_enter_diagnostic_metadata");
    process.stdout.write("V9.4 replay audit: PASS (actual Chat/Action/Summary/Letter service routes, final snapshot per single offline transport, LEGACY_OBSERVED without Plan proof).\n");
  } finally {
    activeFixture = null;
    Object.assign(console, savedConsole);
  }
}

main().catch(error => {
  process.stderr.write(`V9.4 replay audit: FAIL\n${error?.stack || error?.message || "unknown"}\n`);
  process.exitCode = 1;
});
