"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");

const versionPath = require.resolve("../src/app/main/version");
require.cache[versionPath] = { exports: {
  VOTC_CORE_VERSION: "9.2",
  VOTC_APP_VERSION: require("../package.json").version,
  MEMORY_ENGINE_VERSION: "3.0",
  ACTION_SYSTEM_VERSION: "official-votc-2.0.3",
  SUPPORTED_PERSPECTIVE_SUMMARY_ENGINE_VERSIONS: new Set(["2.3", "2.4", "2.5", "3.0"])
} };

const { LLMManager, TokenCounter } = require("../src/app/main/provider-service");
const { createPromptBuilder } = require("../src/app/main/prompts/prompt-builder");
const { MemoryStore } = require("../src/app/main/memory-system/memory-store");
const { Memory4Coordinator } = require("../src/app/main/memory-system/memory4-coordinator");
const { hash } = require("../src/app/main/memory-system/memory4-contract");
const { DurableRequestTrace } = require("../src/app/main/analytics/durable-request-trace");

const openAIClientOptions = [];
let openAITransport = null;

function loadProvidersWithoutSdk() {
  const originalLoad = Module._load;
  class OpenAIStub {
    constructor(options) {
      openAIClientOptions.push(options);
      this.chat = { completions: { create: (...args) => {
        assert.equal(typeof openAITransport, "function", "offline OpenAI transport must be installed before the adapter runs");
        return openAITransport(...args);
      } } };
    }
  }
  OpenAIStub.APIError = class APIError extends Error {};
  Module._load = function(request, parent, isMain) {
    if (request === "openai") return OpenAIStub;
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    return { ...require("../src/app/main/providers"), OpenAIStub };
  } finally {
    Module._load = originalLoad;
  }
}

const { DeepseekProvider, OpenRouterProvider, OpenAICompatibleProvider, ZhipuProvider,
  OllamaProvider, Player2Provider, GeminiProvider } = loadProvidersWithoutSdk();

const temporaryRoot = fs.mkdtempSync(path.join(__dirname, ".votc-v922-chunking-"));
const PromptBuilder = createPromptBuilder({ TemplateEngine: class {}, PromptScriptLoader: class {},
  TokenCounter, createPromptFingerprint: value => hash(value), defaultChatInstruction: "" });

function makeFragment(fragmentId, text, messageId) {
  return { fragmentId, messageId, sourceMessageIds: [messageId], text,
    speakerId: 2, speakerIds: [2], sourceTextVerified: true, sourceRole: "assistant",
    presentIds: [1, 2], knownBy: [1, 2], visibility: "participants", sourceType: "spoken",
    recipientIds: [1], entityIds: [1], visibilityEvidence: "application_fragment" };
}

function makeSnapshot(label, fragments, { campaignToken = `campaign-${label}`, finalizationId = `finalization-${label}` } = {}) {
  return { campaignToken, ownerId: 2, conversationId: `conversation-${label}`, finalizationId,
    episodeId: `episode-${label}`, date: "1181.1.1", totalDays: 431000,
    sourceRevision: hash([campaignToken, finalizationId, fragments]), presentMessageCount: fragments.length,
    completeness: "complete", summaryIds: [], counterpartIds: [1], fragments, projectionLineages: [],
    relationshipChangeEntityIds: [], entityNameEvidence: [], relationshipEvidence: [], skipKnownEvidence: true };
}

function makeFixture(label) {
  const directory = path.join(temporaryRoot, label);
  const summaryFoldersDir = path.join(directory, "summaries");
  for (const ownerId of [1, 2, 3]) fs.mkdirSync(path.join(summaryFoldersDir, `${ownerId}_fixture`), { recursive: true });
  const baseStore = new MemoryStore({ baseDir: path.join(directory, "memory"), summaryFoldersDir });
  const coordinator = new Memory4Coordinator(baseStore);
  coordinator.derived.schedule = async () => ({ status: "COMPLETE" });
  return { coordinator, store: coordinator.store };
}

function promptPayload(messages) {
  const user = [...messages].reverse().find(message => message?.role === "user");
  assert(user && typeof user.content === "string", "Provider request must retain the Durable JSON User payload");
  return JSON.parse(user.content);
}

function candidate(fragment, text = `Verified durable fact from ${fragment.text}`, memoryType = "DURABLE_KNOWLEDGE") {
  return { memoryType, text, fragmentIds: [fragment.fragmentId], entityIds: memoryType === "COMMITMENT" ? [1] : [],
    participantIds: [1, 2], topics: [], eventTime: { from: null, to: null, precision: "unknown", status: "unknown" } };
}

function completed(entries = [], commitmentTransitions = []) {
  return { content: JSON.stringify({ status: entries.length ? "STORE" : "NO_DURABLE_CONTENT", entries, commitmentTransitions }),
    finish_reason: "stop" };
}

function makePipeline(coordinator, respond, { reportUsage = true, transportRepeats = 1, providerType = "deepseek", maxOutputTokens = 8192 } = {}) {
  const trace = new DurableRequestTrace({ enabled: true });
  coordinator.durableRequestTrace = trace;
  const sent = [];
  const calls = [];
  let beforeSendChecks = 0;
  let currentAttempt = null;
  const config = { instanceId: "v922-chunk-fixture", providerType,
    defaultModel: providerType === "zhipu" ? "glm-5.3-flash" : "deepseek-v4-flash", defaultParameters: {} };
  const provider = {
    listModels: async () => [{ id: config.defaultModel, context_window: 65536, maxCompletionTokens: maxOutputTokens }],
    chatCompletion: async (request, _providerConfig, control) => {
      const payload = promptPayload(request.messages);
      const inputTokens = TokenCounter.calculateTotalTokens(request.messages);
      let sentRequest = null;
      for (let index = 0; index < transportRepeats; index++) {
        control?.beforeSend?.();
        const attemptId = currentAttempt?.durableAttemptId || null;
        sentRequest = { messages: JSON.parse(JSON.stringify(request.messages)), payload, maxTokens: request.max_tokens,
          attemptId, inputTokens };
        sent.push(sentRequest);
      }
      const response = await respond({ ...sentRequest, sendIndex: sent.length - 1 });
      return { ...response, ...(reportUsage ? { usage: { prompt_tokens: inputTokens, prompt_cache_hit_tokens: 0,
        prompt_cache_miss_tokens: inputTokens, completion_tokens: 3 } } : {}) };
    }
  };
  const manager = new LLMManager({
    settingsRepository: { getSummaryProviderConfig: () => config },
    providerRegistry: { createProvider: () => provider },
    usageAnalytics: { record() {} }, durableRequestTrace: trace,
    TokenCounter, PromptBuilder
  });
  const requestDurable = (prompt, options) => {
    calls.push({ options, prompt });
    currentAttempt = options.durableTrace || null;
    const guard = options.beforeSendGuard;
    return manager.sendSummaryRequest(prompt, options.signal, { requestType: "memory4_durable", maxTokens: options.maxTokens,
      providerSnapshot: options.providerSnapshot, durableTrace: options.durableTrace,
      beforeSendGuard: () => { beforeSendChecks++; return guard?.(); } });
  };
  return { requestDurable, sent, calls, trace, get beforeSendChecks() { return beforeSendChecks; } };
}

async function test129FragmentsRemain128Plus1() {
  const { coordinator, store } = makeFixture("outer-128-plus-1");
  const fragments = Array.from({ length: 129 }, (_, index) => makeFragment(`outer-${index + 1}`,
    `ORDINARY_SOURCE_${index + 1}`, index + 1));
  const snapshot = makeSnapshot("outer-128-plus-1", fragments);
  const pipeline = makePipeline(coordinator, async () => completed(), { maxOutputTokens: 2048 });
  const result = await coordinator.finishOwner(snapshot, pipeline.requestDurable, null, () => true, { origin: "finalization" });

  assert.equal(result.status, "NO_DURABLE_CONTENT");
  assert.equal(pipeline.sent.length, 2);
  assert.deepEqual(pipeline.sent.map(row => row.payload.fragments.length), [128, 1]);
  assert.deepEqual(pipeline.sent.map(row => row.payload.limits), [
    { maxEntries: 8, maxCommitmentTransitions: 8 },
    { maxEntries: 8, maxCommitmentTransitions: 8 }
  ], "each ordinary outer chunk retains both independent owner quotas");
  assert.deepEqual(pipeline.sent.map(row => [row.payload.fragments[0].fragmentId,
    row.payload.fragments.at(-1).fragmentId]), [["outer-1", "outer-128"], ["outer-129", "outer-129"]]);
  assert.equal(pipeline.calls.every(call => call.options.maxTokens === 4096), true,
    "the established Durable output ceiling remains 4096 for every chunk");
  const attempts = pipeline.trace.exportReport().attempts;
  assert.equal(attempts.length, 2);
  assert.deepEqual(attempts.map(row => [row.chunkIndex, row.chunkTotal, row.chunkPath, row.fragmentCount]), [
    [0, 2, [0], 128], [1, 2, [1], 1]
  ]);
  assert.deepEqual(attempts.map(row => row.sourceDigest), [
    pipeline.trace.hashValue("source_digest", JSON.stringify([snapshot.sourceRevision, fragments.slice(0, 128)])),
    pipeline.trace.hashValue("source_digest", JSON.stringify([snapshot.sourceRevision, fragments.slice(128)]))
  ], "source digests must distinguish the two exact chunk source sets without exporting source text");
  assert.equal(JSON.stringify(pipeline.trace.exportReport()).includes("ORDINARY_SOURCE_"), false,
    "the durable attempt report must not serialize source text");
  assert.equal(attempts.every(row => row.providerSendStartedAt && row.inputReported && row.inputTokens > 0), true);
  assert.equal(attempts.every(row => row.hitReported && row.hitTokens === 0 && row.missReported
    && row.missTokens === row.inputTokens && row.outputReported && row.outputTokens === 3), true,
  "native cache hit zero and reported misses must remain exact rather than being replaced with estimates");
  assert.equal(attempts.every(row => row.requestedOutputTokens === 4096 && row.effectiveOutputTokens === 2048
    && row.tokenEstimate > 0), true, "request budget and input estimate fields must be present on each actual attempt");
  const submittedIds = pipeline.sent.flatMap(row => row.payload.fragments.map(fragment => fragment.fragmentId));
  assert.deepEqual(submittedIds, fragments.map(fragment => fragment.fragmentId), "no ordinary source fragment may be dropped or repeated");
  assert.equal(pipeline.sent.reduce((sum, row) => sum + row.payload.fragments.length, 0), 129);
  assert.equal(pipeline.sent.reduce((sum, row) => sum + row.inputTokens, 0),
    attempts.reduce((sum, row) => sum + row.inputTokens, 0), "all actually sent input usage, including every outer chunk, must reconcile");
  assert.deepEqual(store.query(snapshot), []);
}

async function testBinaryTreeCountsParentAndLeafCostsAndKeepsAllSources() {
  const { coordinator, store } = makeFixture("binary-all-costs");
  const fragments = Array.from({ length: 4 }, (_, index) => makeFragment(`tree-${index + 1}`,
    `TREE_SOURCE_${index + 1}`, index + 1));
  const snapshot = makeSnapshot("binary-all-costs", fragments);
  const pipeline = makePipeline(coordinator, async ({ payload }) => {
    if (payload.fragments.length > 1) return { content: "{", finish_reason: "length" };
    const fragment = fragments.find(item => item.fragmentId === payload.fragments[0].fragmentId);
    return completed([candidate(fragment, `Leaf fact ${fragment.fragmentId}`)]);
  });
  const result = await coordinator.finishOwner(snapshot, pipeline.requestDurable, null, () => true, { origin: "finalization" });

  assert.equal(result.status, "STORE");
  assert.equal(result.entryIds.length, 4);
  assert.equal(pipeline.sent.length, 7, "a fully truncated four-source root forms the complete seven-call binary tree");
  assert.deepEqual(pipeline.sent.map(row => row.payload.fragments.map(fragment => fragment.fragmentId)), [
    ["tree-1", "tree-2", "tree-3", "tree-4"], ["tree-1", "tree-2"], ["tree-1"], ["tree-2"],
    ["tree-3", "tree-4"], ["tree-3"], ["tree-4"]
  ]);
  const attempts = pipeline.trace.exportReport().attempts;
  assert.equal(attempts.length, 7, "truncated parents remain in the attempt ledger and cost totals");
  assert.deepEqual(attempts.map(row => row.chunkPath), [[0], [0, 0], [0, 0, 0], [0, 0, 1], [0, 1], [0, 1, 0], [0, 1, 1]]);
  assert.equal(new Set(attempts.map(row => row.sourceDigest)).size, 7,
    "each distinct binary source set receives its own anonymous source digest");
  assert.equal(attempts.every(row => row.chunkIndex === 0 && row.chunkTotal === 1), true);
  assert.equal(attempts.every(row => row.providerSendStartedAt && row.inputReported && row.inputTokens > 0), true);
  assert.equal(attempts.every(row => row.hitReported && row.hitTokens === 0 && row.missReported
    && row.missTokens === row.inputTokens && row.outputReported), true);
  assert.equal(attempts.filter(row => row.truncated === true).length, 3,
    "all incomplete parent transports retain their actual truncation state");
  assert.equal(attempts.filter(row => row.parseStatus === "PARSED_OK").length, 4);
  for (const row of attempts.slice(1)) {
    const parent = attempts.find(candidateRow => candidateRow.durableAttemptId === row.durableParentAttemptId);
    assert(parent, "every binary child must link to the actual parent Provider attempt");
    assert.equal(row.retryReason, "output_truncated");
    assert.equal(row.retryDepth, parent.retryDepth + 1);
  }
  const submittedIds = pipeline.sent.flatMap(row => row.payload.fragments.map(fragment => fragment.fragmentId));
  assert.equal(submittedIds.length, 12, "the repeated evidence cost counts root, intermediate and leaf submissions");
  assert.deepEqual([...new Set(submittedIds)].sort(), fragments.map(fragment => fragment.fragmentId).sort());
  assert.equal(pipeline.sent.reduce((sum, row) => sum + row.inputTokens, 0),
    attempts.reduce((sum, row) => sum + row.inputTokens, 0), "every parent and child Provider input is included in cost reconciliation");
  assert.deepEqual(store.query(snapshot).map(entry => entry.text).sort(), fragments.map(fragment => `Leaf fact ${fragment.fragmentId}`).sort(),
    "only complete leaf outputs are committed, with each source accounted for once");
}

async function testSingleFragmentTruncationFailsWithoutRecursiveRetry() {
  const { coordinator, store } = makeFixture("single-fragment-truncated");
  const fragments = [makeFragment("single-truncated", "SINGLE_SOURCE", 1)];
  const snapshot = makeSnapshot("single-fragment-truncated", fragments);
  const pipeline = makePipeline(coordinator, async () => ({ content: "{", finish_reason: "length" }));
  const result = await coordinator.finishOwner(snapshot, pipeline.requestDurable, null, () => true, { origin: "finalization" });

  assert.equal(result.status, "EXTRACTION_FAILED");
  assert.equal(result.error, "memory4_generation_incomplete");
  assert.equal(pipeline.sent.length, 1, "one source fragment cannot be split into another request");
  assert.equal(pipeline.trace.exportReport().attempts.length, 1);
  assert.equal(pipeline.trace.exportReport().attempts[0].truncated, true);
  assert.deepEqual(store.query(snapshot), [], "an incomplete single-fragment response cannot persist a partial result");
}

async function testMissingNativeUsageStaysUnknown() {
  const { coordinator } = makeFixture("native-usage-missing");
  const fragments = [makeFragment("usage-missing-source", "NO_NATIVE_USAGE_SOURCE", 1)];
  const snapshot = makeSnapshot("native-usage-missing", fragments);
  const pipeline = makePipeline(coordinator, async () => completed(), { reportUsage: false });
  const result = await coordinator.finishOwner(snapshot, pipeline.requestDurable, null, () => true, { origin: "finalization" });
  const [attempt] = pipeline.trace.exportReport().attempts;

  assert.equal(result.status, "NO_DURABLE_CONTENT");
  assert.equal(pipeline.sent.length, 1);
  for (const field of ["inputTokens", "hitTokens", "missTokens", "outputTokens"]) assert.equal(attempt[field], "UNKNOWN");
  for (const field of ["inputReported", "hitReported", "missReported", "outputReported"]) assert.equal(attempt[field], false);
  assert.equal(attempt.tokenEstimate > 0, true, "a local estimate may be recorded separately from native usage");
}

async function testZhipuUsageDebugDoesNotPromoteCoercedZerosToNativeCounts() {
  async function recordUsageAttempt(label, usage, usageDebug) {
    const { coordinator } = makeFixture(label);
    const fragments = [makeFragment(`${label}-source`, `${label.toUpperCase()}_SOURCE`, 1)];
    const snapshot = makeSnapshot(label, fragments);
    const pipeline = makePipeline(coordinator, async () => ({ ...completed(), usage, usage_debug: usageDebug }),
      { reportUsage: false, providerType: "zhipu" });
    const result = await coordinator.finishOwner(snapshot, pipeline.requestDurable, null, () => true, { origin: "finalization" });
    assert.equal(result.status, "NO_DURABLE_CONTENT");
    assert.equal(pipeline.sent.length, 1);
    return pipeline.trace.exportReport().attempts[0];
  }

  const missing = await recordUsageAttempt("zhipu-native-usage-missing", {
    prompt_tokens: undefined, prompt_cache_hit_tokens: null, prompt_cache_miss_tokens: null, completion_tokens: undefined
  }, { provider: "zhipu", raw_usage: { prompt_tokens: 0, completion_tokens: 0 },
    normalized_usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 } });
  for (const field of ["inputTokens", "hitTokens", "missTokens", "outputTokens"]) {
    assert.equal(missing[field], "UNKNOWN", `missing native ${field} must not be inferred from Zhipu debug zeros`);
  }
  for (const field of ["inputReported", "hitReported", "missReported", "outputReported"]) {
    assert.equal(missing[field], false, `missing native ${field} must not be marked as reported`);
  }

  const mixed = await recordUsageAttempt("zhipu-native-usage-mixed", {
    prompt_tokens: 42, prompt_cache_hit_tokens: 0, prompt_cache_miss_tokens: 99, completion_tokens: 3
  }, { provider: "zhipu", raw_usage: { prompt_tokens: 0, prompt_cache_miss_tokens: 11, completion_tokens: 0 },
    normalized_usage: { prompt_tokens: 42, completion_tokens: 3, total_tokens: 45 } });
  assert.deepEqual([mixed.inputTokens, mixed.hitTokens, mixed.missTokens, mixed.outputTokens], [42, 0, 11, 3],
    "positive native input/output, explicit native zero hit, and explicit raw miss must retain their provenance");
  assert.deepEqual([mixed.inputReported, mixed.hitReported, mixed.missReported, mixed.outputReported], [true, true, true, true]);

  const zero = await recordUsageAttempt("zhipu-native-usage-zero", {
    prompt_tokens: 0, prompt_cache_hit_tokens: 0, prompt_cache_miss_tokens: 0, completion_tokens: 0
  }, { provider: "zhipu", raw_usage: { prompt_tokens: 0, prompt_cache_miss_tokens: 0, completion_tokens: 0 },
    normalized_usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 } });
  assert.deepEqual([zero.inputTokens, zero.hitTokens, zero.missTokens, zero.outputTokens], [0, 0, 0, 0],
    "explicit native zero counts must stay reported zeros rather than UNKNOWN");
  assert.deepEqual([zero.inputReported, zero.hitReported, zero.missReported, zero.outputReported], [true, true, true, true]);
}

async function testEveryProviderRetryRechecksAuthorizationAndUnknownParentUsage() {
  const { coordinator } = makeFixture("provider-retry-guard");
  const fragments = [makeFragment("provider-retry-source", "PROVIDER_RETRY_SOURCE", 1)];
  const snapshot = makeSnapshot("provider-retry-guard", fragments);
  const pipeline = makePipeline(coordinator, async () => completed(), { transportRepeats: 2 });
  const result = await coordinator.finishOwner(snapshot, pipeline.requestDurable, null, () => true, { origin: "finalization" });
  const attempts = pipeline.trace.exportReport().attempts;

  assert.equal(result.status, "NO_DURABLE_CONTENT");
  assert.equal(pipeline.beforeSendChecks, 3,
    "LLMManager preflight and both simulated DeepSeek transport attempts must each recheck source authorization");
  assert.equal(pipeline.sent.length, 2);
  assert.equal(attempts.length, 2, "each actual transport attempt must have a separate trace row");
  assert.equal(attempts[0].status, "RETRY_SCHEDULED");
  assert.equal(attempts[1].durableParentAttemptId, attempts[0].durableAttemptId);
  assert.equal(attempts[1].retryReason, "provider_retry");
  assert.equal(attempts[1].retryDepth, attempts[0].retryDepth + 1);
  assert.equal(attempts[0].inputTokens, "UNKNOWN", "native usage absent for the retried request must not be guessed onto its parent");
  assert.equal(attempts[1].inputTokens > 0, true, "reported usage belongs only to the final transport row");
}

async function testActualDeepSeekRetryLoopGuardsBeforeTransport() {
  const provider = new DeepseekProvider();
  const request = offlineProviderRequest("deepseek-offline-model");
  openAIClientOptions.length = 0;
  const { transportArgs, signal } = await assertAdapterRetryGuard("DeepSeek", (control, transport) => {
    openAITransport = transport;
    return provider.chatCompletion(request, { apiKey: "offline-fixture-key", baseUrl: "https://offline.invalid" }, control);
  });
  assert.deepEqual(transportArgs[0][0], request, "DeepSeek must preserve the established request JSON at the SDK boundary");
  assert.deepEqual(transportArgs[0][1], { signal });
  assert.equal(openAIClientOptions[0].maxRetries, 0);
}

function offlineProviderRequest(model = "offline-model") {
  return { model, messages: [{ role: "user", content: "offline fixture" }], stream: false,
    temperature: 0.2, max_tokens: 256, top_p: 0.9, presence_penalty: 0, frequency_penalty: 0 };
}

function openAIResponse() {
  return { id: "offline-response", choices: [{ message: { content: "{}" }, finish_reason: "stop" }] };
}

async function assertAdapterRetryGuard(label, invoke) {
  const sourceChanged = new Error("memory4_request_source_changed_before_send");
  const controller = new AbortController();
  let beforeSendChecks = 0, transportCalls = 0;
  const transportArgs = [];
  const transport = async (...args) => {
    transportCalls++;
    transportArgs.push(args);
    if (transportCalls === 1) throw Object.assign(new Error("mock connection reset"), { code: "ECONNRESET" });
    assert.fail(`${label} must run the authorization guard before retry transport`);
  };
  const requestControl = { signal: controller.signal, beforeSend() {
    beforeSendChecks++;
    if (beforeSendChecks === 2) throw sourceChanged;
  } };

  await assert.rejects(invoke(requestControl, transport), error => error === sourceChanged,
    `${label} must preserve the typed source-change denial`);
  assert.equal(beforeSendChecks, 2, `${label} must recheck authorization inside its retry callback`);
  assert.equal(transportCalls, 1, `${label} must not send the second transport after authorization changes`);
  return { transportArgs, signal: controller.signal };
}

async function testOpenRouterAndPlayer2ConditionalSdkSettingsAndPayloads() {
  const request = offlineProviderRequest();
  const expectedBasePayload = { ...request };

  for (const { label, provider, config, hasReasoning } of [
    { label: "OpenRouter", provider: new OpenRouterProvider(), config: { apiKey: "offline-fixture-key" }, hasReasoning: true },
    { label: "Player2", provider: new Player2Provider(), config: {}, hasReasoning: false }
  ]) {
    const expectedPayload = hasReasoning ? { ...expectedBasePayload, reasoning: { exclude: true } } : expectedBasePayload;
    openAIClientOptions.length = 0;
    const ordinaryRequests = [];
    openAITransport = async (providerRequest, requestOptions) => {
      ordinaryRequests.push({ providerRequest, requestOptions });
      return openAIResponse();
    };
    const ordinaryResponse = await provider.chatCompletion(request, config);

    assert.equal(ordinaryResponse.content, "{}");
    assert.equal(Object.prototype.hasOwnProperty.call(openAIClientOptions[0], "maxRetries"), false,
      `${label} ordinary chat must keep the prior SDK retry default`);
    assert.deepEqual(ordinaryRequests[0].providerRequest, expectedPayload,
      `${label} ordinary chat request JSON must retain its established shape`);
    assert.equal(ordinaryRequests[0].requestOptions, undefined);
    for (const field of ["beforeSendGuard", "durableTrace", "requestControl"]) {
      assert.equal(Object.prototype.hasOwnProperty.call(ordinaryRequests[0].providerRequest, field), false,
        `${label} must not serialize private control metadata as Provider JSON`);
    }

    openAIClientOptions.length = 0;
    let beforeSendChecks = 0, durableTransportCalls = 0;
    const durableRequests = [];
    const sourceChanged = new Error("memory4_request_source_changed_before_send");
    openAITransport = async (providerRequest, requestOptions) => {
      durableTransportCalls++;
      durableRequests.push({ providerRequest, requestOptions });
      throw Object.assign(new Error("mock connection reset"), { code: "ECONNRESET" });
    };
    const controller = new AbortController();
    await assert.rejects(provider.chatCompletion(request, config, { signal: controller.signal, beforeSend() {
      beforeSendChecks++;
      if (beforeSendChecks === 2) throw sourceChanged;
    } }), error => error === sourceChanged,
    `${label} must stop at the pre-transport guard after a retryable network failure`);
    assert.equal(beforeSendChecks, 2);
    assert.equal(durableTransportCalls, 1);
    assert.deepEqual(durableRequests[0].providerRequest, expectedPayload);
    assert.deepEqual(durableRequests[0].requestOptions, { signal: controller.signal });
    assert.equal(openAIClientOptions[0].maxRetries, 0,
      `${label} Durable requests must disable SDK retries that bypass the observable guard`);
    for (const field of ["beforeSendGuard", "durableTrace", "requestControl"]) {
      assert.equal(Object.prototype.hasOwnProperty.call(durableRequests[0].providerRequest, field), false,
        `${label} must not serialize private control metadata as Provider JSON`);
    }
  }
}

async function testOpenAICompatibleAndZhipuRetryGuards() {
  const request = offlineProviderRequest();
  const cases = [
    { label: "OpenAI-compatible", provider: new OpenAICompatibleProvider(),
      config: { apiKey: "offline-fixture-key", baseUrl: "https://offline.invalid/v1" },
      expectedPayload: { ...request } },
    { label: "Zhipu through OpenAI-compatible", provider: new ZhipuProvider(),
      config: { apiKey: "offline-fixture-key", baseUrl: "https://offline.invalid/v1" },
      expectedPayload: { ...request, reasoning_effort: "low", thinking: { type: "enabled", clear_thinking: true } } }
  ];

  for (const { label, provider, config, expectedPayload } of cases) {
    openAIClientOptions.length = 0;
    const ordinaryRequests = [];
    openAITransport = async (providerRequest, requestOptions) => {
      ordinaryRequests.push({ providerRequest, requestOptions });
      return openAIResponse();
    };
    const ordinaryResponse = await provider.chatCompletion(request, config);
    assert.equal(ordinaryResponse.content, "{}");
    assert.equal(openAIClientOptions[0].maxRetries, 0,
      `${label} must preserve its existing SDK retry configuration on ordinary requests`);
    assert.deepEqual(ordinaryRequests[0].providerRequest, expectedPayload,
      `${label} ordinary request JSON must retain its established shape`);

    openAIClientOptions.length = 0;
    const { transportArgs, signal } = await assertAdapterRetryGuard(label, (control, transport) => {
      openAITransport = transport;
      return provider.chatCompletion(request, config, control);
    });
    assert.deepEqual(transportArgs[0][0], expectedPayload,
      `${label} must pass its established request JSON unchanged to SDK transport`);
    assert.deepEqual(transportArgs[0][1], { signal }, `${label} must keep the abort signal in SDK options`);
    assert.equal(openAIClientOptions[0].maxRetries, 0);
  }
}

async function testGeminiRetryGuardAndOrdinaryRequestBody() {
  const provider = new GeminiProvider();
  const request = { model: "gemini-offline-model", messages: [
    { role: "system", content: "offline system instruction" }, { role: "user", content: "offline fixture" }
  ], stream: false, temperature: 0.2, max_tokens: 256, top_p: 0.9 };
  const baseUrl = "https://offline.invalid/v1beta";
  const apiKey = "offline-fixture-key";
  const expectedBody = {
    contents: [{ role: "user", parts: [{ text: "offline fixture" }] }],
    generationConfig: { temperature: 0.2, maxOutputTokens: 256, topP: 0.9 },
    systemInstruction: { role: "user", parts: [{ text: "offline system instruction" }] }
  };
  const originalFetch = global.fetch;
  try {
    let ordinaryCall;
    global.fetch = async (url, options) => {
      ordinaryCall = { url, options };
      return { ok: true, json: async () => ({ responseId: "offline-response", candidates: [
        { content: { parts: [{ text: "{}" }] }, finishReason: "STOP" }
      ] }) };
    };
    const ordinaryResponse = await provider.chatCompletion(request, { baseUrl, apiKey });
    assert.equal(ordinaryResponse.content, "{}");
    assert.equal(ordinaryCall.url, `${baseUrl}/models/${request.model}:generateContent?key=${apiKey}`);
    assert.deepEqual(Object.keys(ordinaryCall.options).sort(), ["body", "headers", "method"]);
    assert.deepEqual(JSON.parse(ordinaryCall.options.body), expectedBody,
      "Gemini ordinary request body must contain only its established generation fields");

    const { transportArgs, signal } = await assertAdapterRetryGuard("Gemini", async (control, transport) => {
      global.fetch = transport;
      return provider.chatCompletion(request, { baseUrl, apiKey }, control);
    });
    assert.equal(transportArgs[0][0], `${baseUrl}/models/${request.model}:generateContent?key=${apiKey}`);
    assert.deepEqual(JSON.parse(transportArgs[0][1].body), expectedBody);
    assert.equal(transportArgs[0][1].signal, signal);
  } finally {
    global.fetch = originalFetch;
  }
}

async function testOllamaGuardAndOrdinaryRequestBody() {
  const provider = new OllamaProvider();
  const request = offlineProviderRequest("ollama-offline-model");
  const config = { providerType: "ollama", baseUrl: "http://127.0.0.1:11434/" };
  const expectedBody = { model: request.model, messages: request.messages, stream: false, options: {
    temperature: request.temperature, num_predict: request.max_tokens, top_p: request.top_p,
    presence_penalty: request.presence_penalty, frequency_penalty: request.frequency_penalty
  } };
  const originalFetch = global.fetch;
  try {
    let fetchCall;
    global.fetch = async (url, options) => {
      fetchCall = { url, options };
      return { ok: true, json: async () => ({ created_at: "offline-response", message: { content: "{}" },
        done: true, prompt_eval_count: 5, eval_count: 2 }) };
    };
    const ordinaryResponse = await provider.chatCompletion(request, config);
    assert.equal(ordinaryResponse.content, "{}");
    assert.equal(fetchCall.url, "http://127.0.0.1:11434/api/chat");
    assert.deepEqual(Object.keys(fetchCall.options).sort(), ["body", "headers", "method"]);
    assert.deepEqual(JSON.parse(fetchCall.options.body), expectedBody,
      "Ollama ordinary request body must not gain Durable-only metadata");

    let beforeSendChecks = 0, deniedFetchCalls = 0;
    const sourceChanged = new Error("memory4_request_source_changed_before_send");
    global.fetch = async () => { deniedFetchCalls++; throw new Error("guard must block fetch"); };
    await assert.rejects(provider.chatCompletion(request, config, { beforeSend() {
      beforeSendChecks++;
      throw sourceChanged;
    } }), error => error === sourceChanged, "Ollama must guard immediately before its native fetch");
    assert.equal(beforeSendChecks, 1);
    assert.equal(deniedFetchCalls, 0);
  } finally {
    global.fetch = originalFetch;
  }
}

async function testEightTransitionQuotaAcrossOuterChunks() {
  const { coordinator, store } = makeFixture("eight-transition-quota");
  const oldPromises = Array.from({ length: 8 }, (_, index) => `I promise to preserve bridge ${index + 1}.`);
  const oldFragments = oldPromises.map((text, index) => makeFragment(`promise-${index + 1}`, text, index + 1));
  const oldSnapshot = makeSnapshot("eight-transition-quota-old", oldFragments,
    { campaignToken: "quota-campaign", finalizationId: "old-commitments" });
  const saved = store.commitOwner(oldSnapshot, { status: "STORE", entries: oldFragments.map((fragment, index) =>
    candidate(fragment, oldPromises[index], "COMMITMENT")) });
  assert.equal(saved.entryIds.length, 8);

  const evidence = oldPromises.map((text, index) => makeFragment(`fulfilled-${index + 1}`,
    `I have already fulfilled my promise to preserve bridge ${index + 1}.`, 100 + index));
  const fillers = Array.from({ length: 121 }, (_, index) => makeFragment(`quota-filler-${index + 1}`,
    `QUOTA_FILLER_${index + 1}`, 200 + index));
  const fragments = [...evidence.slice(0, 7), ...fillers, evidence[7]];
  const snapshot = makeSnapshot("eight-transition-quota-current", fragments,
    { campaignToken: "quota-campaign", finalizationId: "current-quota-run" });
  const pipeline = makePipeline(coordinator, async ({ payload }) => {
    const byText = new Map(evidence.map((fragment, index) => [fragment.text, index]));
    const transitions = payload.fragments.flatMap(fragment => {
      const index = byText.get(fragment.text);
      if (index == null) return [];
      const active = payload.activeCommitments.find(commitment => commitment.text === oldPromises[index]);
      assert(active, `active commitment ${index + 1} must be available to its evidence fragment`);
      return [{ entryId: active.entryId, expectedRevision: active.expectedRevision, status: "fulfilled",
        fragmentIds: [fragment.fragmentId], commitmentQuote: `preserve bridge ${index + 1}`, evidenceQuote: fragment.text }];
    });
    return completed([], transitions);
  });
  const result = await coordinator.finishOwner(snapshot, pipeline.requestDurable, null, () => true, { origin: "finalization" });

  assert.equal(result.status, "NO_DURABLE_CONTENT", `transition-only results keep their existing result status (${result.error || "no error detail"})`);
  assert.equal(result.entryIds.length, 0);
  assert.equal(result.commitmentTransitionCount, 8);
  assert.equal(pipeline.sent.length, 2);
  assert.deepEqual(pipeline.sent.map(row => row.payload.limits), [
    { maxEntries: 8, maxCommitmentTransitions: 8 },
    { maxEntries: 8, maxCommitmentTransitions: 1 }
  ], "the transition hard limit is cumulative across outer chunks and stays independent of entry quota");
  assert.equal(pipeline.sent.reduce((sum, row) => sum + row.payload.fragments.length, 0), 129);
  const currentFragments = new Set(pipeline.sent.flatMap(row => row.payload.fragments.map(fragment => fragment.fragmentId)));
  assert.deepEqual([...currentFragments].sort(), fragments.map(fragment => fragment.fragmentId).sort());
  for (const entryId of saved.entryIds) {
    assert.equal(store.readEntry(snapshot, entryId).state.status, "fulfilled");
  }
}

async function testReplacementIndexSurvivesBinaryAndOuterOffsets() {
  const { coordinator, store } = makeFixture("replacement-offsets");
  const oldText = "I promise to repair the north wall.";
  const oldFragment = makeFragment("old-north-wall-promise", oldText, 1);
  const oldSnapshot = makeSnapshot("replacement-offsets-old", [oldFragment],
    { campaignToken: "replacement-campaign", finalizationId: "old-replacement-promise" });
  const prior = store.commitOwner(oldSnapshot, { status: "STORE", entries: [candidate(oldFragment, oldText, "COMMITMENT")] });
  const ordinary = Array.from({ length: 128 }, (_, index) => makeFragment(`replacement-ordinary-${index + 1}`,
    `REPLACEMENT_ORDINARY_${index + 1}`, 10 + index));
  const leftTail = makeFragment("replacement-left-tail", "SAFE_LEFT_TAIL_FACT", 500);
  const evidenceText = "I have replaced the original promise to repair the north wall with this new promise: I promise to repair the south gate.";
  const replacementEvidence = makeFragment("replacement-evidence", evidenceText, 501);
  const fragments = [...ordinary, leftTail, replacementEvidence];
  const snapshot = makeSnapshot("replacement-offsets-current", fragments,
    { campaignToken: "replacement-campaign", finalizationId: "current-replacement-run" });
  const pipeline = makePipeline(coordinator, async ({ payload }) => {
    const ids = payload.fragments.map(fragment => fragment.fragmentId);
    if (ids.length === 128) {
      const entries = ordinary.slice(0, 6).map(fragment => candidate(fragment));
      return completed(entries);
    }
    if (ids.length === 2) return { content: "{", finish_reason: "length" };
    if (ids[0] === leftTail.fragmentId) return completed([candidate(leftTail)]);
    assert.deepEqual(ids, [replacementEvidence.fragmentId]);
    const replacementText = "I promise to repair the south gate.";
    const active = payload.activeCommitments.find(commitment => commitment.entryId === prior.entryIds[0]);
    assert(active, "replacement must name the active revision-bound commitment from the same campaign and owner");
    return completed([candidate(replacementEvidence, replacementText, "COMMITMENT")], [{
      entryId: active.entryId, expectedRevision: active.expectedRevision, status: "superseded",
      fragmentIds: [replacementEvidence.fragmentId], commitmentQuote: "repair the north wall",
      evidenceQuote: evidenceText, replacementEntryIndex: 0
    }]);
  });
  const result = await coordinator.finishOwner(snapshot, pipeline.requestDurable, null, () => true, { origin: "finalization" });

  assert.equal(result.status, "STORE");
  assert.equal(result.entryIds.length, 8, "the per-owner entry quota remains cumulative across outer chunks and binary children");
  assert.equal(result.commitmentTransitionCount, 1);
  assert.deepEqual(pipeline.sent.map(row => row.payload.fragments.length), [128, 2, 1, 1]);
  assert.deepEqual(pipeline.sent.map(row => row.payload.limits.maxEntries), [8, 2, 2, 1]);
  assert.deepEqual(pipeline.sent.map(row => row.payload.limits.maxCommitmentTransitions), [8, 8, 8, 8]);
  const currentEntries = result.entryIds.map(id => store.readEntry(snapshot, id));
  assert.equal(currentEntries[7].text, "I promise to repair the south gate.",
    "the replacement index must include six earlier outer-chunk entries and the left binary child");
  const superseded = store.readEntry(snapshot, prior.entryIds[0]);
  assert.equal(superseded.state.status, "superseded");
  assert.equal(superseded.state.supersededByEntryId, result.entryIds[7]);
  assert.deepEqual(currentEntries[7].state.supersedesEntryIds, [prior.entryIds[0]]);
}

async function run() {
  try {
    await test129FragmentsRemain128Plus1();
    await testBinaryTreeCountsParentAndLeafCostsAndKeepsAllSources();
    await testSingleFragmentTruncationFailsWithoutRecursiveRetry();
    await testMissingNativeUsageStaysUnknown();
    await testZhipuUsageDebugDoesNotPromoteCoercedZerosToNativeCounts();
    await testEveryProviderRetryRechecksAuthorizationAndUnknownParentUsage();
    await testActualDeepSeekRetryLoopGuardsBeforeTransport();
    await testOpenRouterAndPlayer2ConditionalSdkSettingsAndPayloads();
    await testOpenAICompatibleAndZhipuRetryGuards();
    await testGeminiRetryGuardAndOrdinaryRequestBody();
    await testOllamaGuardAndOrdinaryRequestBody();
    await testEightTransitionQuotaAcrossOuterChunks();
    await testReplacementIndexSurvivesBinaryAndOuterOffsets();
    console.log("V9.2.2 Durable chunking, retries, quotas and costs: PASS");
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
