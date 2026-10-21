"use strict";

const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const expectedBaselinePrefix = "e1c3c37";
const args = process.argv.slice(2);
if (args.some(arg => arg !== "--baseline") || args.length > 1) {
  throw new Error("Usage: node scripts/test-v9.3-independent-qa.js [--baseline]");
}
const baselineMode = args.includes("--baseline");
const baselineSha = baselineMode
  ? execFileSync("git", ["rev-parse", `${expectedBaselinePrefix}^{commit}`], { cwd: root, encoding: "utf8" }).trim()
  : null;
const headSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
const reportPath = path.join(root, ".build", baselineMode ? "v93-independent-baseline-rerun.log" : "v93-independent-integration.log");
const progressPath = path.join(root, ".build", baselineMode ? "v93-independent-baseline-progress.log" : "v93-independent-progress.log");
const outcomes = [];
const loadedModules = [];
let activeScenarioFailures = null;
let timedOutScenario = null;
const nativeSetTimeout = global.setTimeout;
const nativeClearTimeout = global.clearTimeout;
const scenarioWatchdogMs = 3000;

function writeProgress(stage, name) {
  const line = `${new Date().toISOString()} ${stage} ${name}`;
  fs.mkdirSync(path.dirname(progressPath), { recursive: true });
  fs.appendFileSync(progressPath, `${line}\n`, "utf8");
  process.stdout.write(`${line}\n`);
}

if (baselineMode && !baselineSha.startsWith(expectedBaselinePrefix)) throw new Error(`unexpected_source_baseline:${baselineSha}`);

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function failIfDifferent(name, expected, actual) {
  try {
    assert.deepStrictEqual(actual, expected, `${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  } catch (error) {
    if (!activeScenarioFailures) throw error;
    activeScenarioFailures.push(String(error?.message || error).split("\n")[0]);
  }
}

async function scenario(name, operation) {
  if (timedOutScenario) {
    outcomes.push(`SKIP ${name} :: prior watchdog ${timedOutScenario}`);
    writeProgress("SKIP", name);
    return;
  }
  const previousFailures = activeScenarioFailures;
  const failures = [];
  activeScenarioFailures = failures;
  let watchdog;
  writeProgress("START", name);
  try {
    const operationPromise = Promise.resolve().then(operation);
    const watchdogPromise = new Promise((_, reject) => {
      watchdog = nativeSetTimeout(() => reject(Object.assign(new Error(`scenario_watchdog_timeout:${name}`), { code: "QA_WATCHDOG" })), scenarioWatchdogMs);
    });
    await Promise.race([operationPromise, watchdogPromise]);
    if (failures.length) outcomes.push(...failures.map(failure => `RED ${failure}`));
    else outcomes.push(`PASS ${name}`);
    writeProgress(failures.length ? "RED" : "PASS", name);
  } catch (error) {
    outcomes.push(...failures.map(failure => `RED ${failure}`));
    const code = error?.code || "no_code";
    const category = error?.providerError?.category || "untyped";
    outcomes.push(`RED ${name} :: ${String(error?.message || error).split("\n")[0]} [code=${code}; category=${category}]`);
    if (code === "QA_WATCHDOG") timedOutScenario = name;
    writeProgress(code === "QA_WATCHDOG" ? "WATCHDOG" : "RED", name);
  } finally {
    if (watchdog) nativeClearTimeout(watchdog);
    activeScenarioFailures = previousFailures;
  }
}

let activeSdkFixture = null;
let activeFetchFixture = null;
const originalLoad = Module._load;
const originalJsExtension = Module._extensions[".js"];
const originalFetch = global.fetch;
const originalConsole = { log: console.log, warn: console.warn, error: console.error };
const appSourceRoot = path.join(root, "src", "app");

class MockOpenAI {
  constructor(options = {}) {
    if (!activeSdkFixture) throw new Error("sdk_mock_without_fixture");
    activeSdkFixture.clients.push({ ...options });
    this.chat = {
      completions: {
        create: (request, requestOptions) => {
          activeSdkFixture.calls.push({ request, requestOptions, clientOptions: options });
          return activeSdkFixture.create(request, requestOptions, options);
        }
      }
    };
    this.models = { list: (...args) => activeSdkFixture.listModels?.(...args) };
  }
}
MockOpenAI.APIError = class MockAPIError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "APIError";
    this.status = status;
  }
};

Module._load = function(request, parent, isMain) {
  if (request === "openai") return MockOpenAI;
  return originalLoad.call(this, request, parent, isMain);
};
Module._extensions[".js"] = function(module, filename) {
  const relativePath = path.relative(appSourceRoot, filename);
  if (relativePath !== ".." && !relativePath.startsWith(`..${path.sep}`) && !path.isAbsolute(relativePath)) {
    const sourcePath = `src/app/${relativePath.split(path.sep).join("/")}`;
    loadedModules.push(sourcePath);
    if (baselineMode) {
      const source = execFileSync("git", ["show", `${baselineSha}:${sourcePath}`], { cwd: root, encoding: "utf8" });
      module._compile(source, filename);
      return;
    }
  }
  return originalJsExtension(module, filename);
};
global.fetch = async (input, init = {}) => {
  if (typeof activeFetchFixture !== "function") throw new Error("network_blocked_without_fixture");
  const url = new URL(typeof input === "string" ? input : input.url);
  if (!url.hostname.endsWith(".fixture.invalid")) throw new Error("external_network_blocked");
  return activeFetchFixture(url, init);
};
console.log = () => {};
console.warn = () => {};
console.error = () => {};

const versionPath = require.resolve("../src/app/main/version");
require.cache[versionPath] = { exports: {
  VOTC_CORE_VERSION: "9.2",
  VOTC_APP_VERSION: require("../package.json").version,
  MEMORY_ENGINE_VERSION: "3.0",
  ACTION_SYSTEM_VERSION: "official-votc-2.0.3",
  SUPPORTED_PERSPECTIVE_SUMMARY_ENGINE_VERSIONS: new Set(["2.3", "2.4", "2.5", "3.0"])
} };

const { LLMManager, TokenCounter } = require("../src/app/main/provider-service");
const { validateGenerationOutcome } = require("../src/app/main/providers/generation-outcome");
const { normalizeProviderUsage, normalizeUsage } = require("../src/app/main/providers/usage-normalization");
const {
  BaseProvider,
  OpenRouterProvider,
  OpenAICompatibleProvider,
  ZhipuProvider,
  OllamaProvider,
  Player2Provider,
  DeepseekProvider,
  GeminiProvider
} = require("../src/app/main/providers" );
const { createActionEngine } = require("../src/app/main/actions/action-engine");
const { healJsonResponseWithLogging } = require("../src/app/main/actions/response-healing");

const providerTypes = ["openrouter", "openai-compatible", "zhipu", "ollama", "player2", "deepseek", "gemini"];
const providerClasses = {
  openrouter: OpenRouterProvider,
  "openai-compatible": OpenAICompatibleProvider,
  zhipu: ZhipuProvider,
  ollama: OllamaProvider,
  player2: Player2Provider,
  deepseek: DeepseekProvider,
  gemini: GeminiProvider
};

function beginSdkFixture(create) {
  assert.equal(activeSdkFixture, null, "sdk_fixture_must_not_overlap");
  activeSdkFixture = { clients: [], calls: [], create };
  return activeSdkFixture;
}

function endSdkFixture() {
  const fixture = activeSdkFixture;
  activeSdkFixture = null;
  return fixture;
}

function beginFetchFixture(handler) {
  assert.equal(activeFetchFixture, null, "fetch_fixture_must_not_overlap");
  activeFetchFixture = handler;
}

function endFetchFixture() {
  activeFetchFixture = null;
}

function fixtureConfig(type) {
  const config = {
    providerType: type,
    instanceId: `synthetic-${type}`,
    apiKey: "synthetic-fixture-only",
    defaultModel: `synthetic-${type}-model`,
    defaultParameters: {},
    baseUrl: `https://${type.replace(/[^a-z0-9-]/g, "-")}.fixture.invalid/v1`
  };
  if (type === "ollama") config.baseUrl = "https://ollama.fixture.invalid";
  if (type === "gemini") config.baseUrl = "https://gemini.fixture.invalid/v1beta";
  if (type === "zhipu") {
    config.glmReasoningEffort = "low";
    config.glmClearThinking = true;
  }
  return config;
}

function fixtureRequest(type, signal = undefined) {
  return {
    model: fixtureConfig(type).defaultModel,
    messages: [{ role: "user", content: "Synthetic provider conformance fixture." }],
    stream: true,
    max_tokens: 64,
    temperature: 0,
    signal
  };
}

function makeManager({ config, provider, usageRecords = [], settingsRepository = null } = {}) {
  const routeSettings = settingsRepository || {
    getSummaryProviderConfig: () => config,
    getActiveProviderConfig: () => config,
    getActionsProviderConfig: () => config
  };
  const manager = new LLMManager({
    settingsRepository: routeSettings,
    providerRegistry: { createProvider: () => provider },
    usageAnalytics: { record: (metadata, usage) => usageRecords.push({ metadata, usage }) },
    TokenCounter,
    PromptBuilder: {
      prepareSummaryMessages: messages => messages,
      getSummaryPromptBlocks: () => [{ id: "synthetic", type: "summary", tokens: 1 }]
    }
  });
  return manager;
}

function candidatePlatformModules() {
  if (baselineMode) throw new Error("candidate_platform_modules_unavailable_in_baseline_snapshot");
  return {
    ProviderPlatformFacade: require("../src/app/main/providers/provider-platform").ProviderPlatformFacade,
    createRequestControl: require("../src/app/main/providers/provider-cancellation").createRequestControl,
    createActionEffectWriter: require("../src/app/main/actions/action-effect-writer").createActionEffectWriter
  };
}

function unknownCapabilities() {
  const unknown = () => ({ state: "UNKNOWN", source: "synthetic_unverified" });
  return {
    features: {
      nonStreaming: unknown(), streaming: unknown(), structuredJsonObject: unknown(), structuredJsonSchema: unknown()
    },
    structuredDelivery: { mode: "UNKNOWN", source: "synthetic_unverified" }
  };
}

function assertSafeProviderError(label, error, category, rawText) {
  failIfDifferent(`${label}_typed_category`, category, error?.providerError?.category);
  failIfDifferent(`${label}_typed_code`, `provider_${category.toLowerCase()}`, error?.code);
  const surfaced = [error?.message, error?.code, error?.stack, error?.cause?.message,
    JSON.stringify(error?.providerError || {})].filter(Boolean).join(" ");
  failIfDifferent(`${label}_raw_provider_text_not_exposed`, false, surfaced.includes(rawText));
}

async function rejectAndReturn(operation) {
  try {
    await operation();
  } catch (error) {
    return error;
  }
  return null;
}

async function settleWithin(promise, timeoutMs = 250) {
  let timer;
  const timeout = new Promise(resolve => { timer = nativeSetTimeout(() => resolve(null), timeoutMs); });
  const result = await Promise.race([promise, timeout]);
  nativeClearTimeout(timer);
  return result;
}

async function waitForFetchState(getFetchState, label) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const state = getFetchState();
    if (state) return state;
    await new Promise(resolve => nativeSetTimeout(resolve, 0));
  }
  throw new Error(`${label}_fetch_state_not_created`);
}

async function trackCandidateAdapter({ provider, config, request, usageRecords, estimatedPromptTokens = 12 }) {
  const { createRequestControl } = candidatePlatformModules();
  const manager = makeManager({ config, provider, usageRecords });
  const control = createRequestControl({ signal: request.signal });
  const generated = manager.generate(provider, request, config, unknownCapabilities(), control, estimatedPromptTokens);
  const tracked = await manager.trackUsage(generated, {
    requestType: "chat", requestControl: control, estimatedPromptTokens,
    providerType: config.providerType, model: config.defaultModel
  });
  return { manager, control, tracked };
}

async function collectFinal(stream) {
  const iterator = stream[Symbol.asyncIterator]();
  const chunks = [];
  while (true) {
    const step = await iterator.next();
    if (step.done) return { chunks, final: step.value };
    chunks.push(step.value);
  }
}

function makeReader(chunks, errorAfter = null) {
  let index = 0;
  let released = false;
  let cancelCalls = 0;
  return {
    reader: {
      async read() {
        if (index < chunks.length) return { done: false, value: Buffer.from(chunks[index++], "utf8") };
        if (errorAfter) throw errorAfter;
        return { done: true, value: undefined };
      },
      async cancel() { cancelCalls++; },
      releaseLock() { released = true; }
    },
    get released() { return released; },
    get cancelCalls() { return cancelCalls; }
  };
}

function makeFetchResponse(chunks, errorAfter = null) {
  const state = makeReader(chunks, errorAfter);
  return {
    response: { ok: true, status: 200, statusText: "OK", body: { getReader: () => state.reader } },
    state
  };
}

function makePendingFetchResponse(signal) {
  const readStarted = deferred();
  const readerFinalized = deferred();
  let released = false;
  let cancelCalls = 0;
  const reader = {
    read() {
      readStarted.resolve();
      return new Promise((_resolve, reject) => {
        const abort = () => reject(Object.assign(new Error("synthetic_pending_reader_abort"), { name: "AbortError" }));
        if (signal?.aborted) abort(); else signal?.addEventListener("abort", abort, { once: true });
      });
    },
    async cancel() { cancelCalls++; },
    releaseLock() { released = true; readerFinalized.resolve(); }
  };
  return {
    response: { ok: true, status: 200, statusText: "OK", body: { getReader: () => reader } },
    state: {
      readStarted: readStarted.promise,
      readerFinalized: readerFinalized.promise,
      get released() { return released; },
      get cancelCalls() { return cancelCalls; }
    }
  };
}

function openAiChunk(content, finishReason = null) {
  return { id: "synthetic-response", choices: [{ delta: content ? { content } : {}, finish_reason: finishReason }] };
}

function openAiTail() {
  return {
    id: "synthetic-response",
    choices: [],
    usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110, prompt_cache_hit_tokens: 0 }
  };
}

function adapterOptionalUsageData(type, mode) {
  const missing = mode.endsWith("-undefined") ? undefined : null;
  if (type === "ollama") {
    return {
      created_at: "synthetic-ollama",
      message: { content: "Synthetic optional usage response." },
      done: true,
      done_reason: "stop",
      prompt_eval_count: 75,
      eval_count: 127,
      prompt_cache_hit_tokens: 0,
      prompt_cache_miss_tokens: missing,
      reasoning_tokens: missing
    };
  }
  if (type === "gemini") {
    return {
      responseId: "synthetic-gemini",
      candidates: [{ content: { parts: [{ text: "Synthetic optional usage response." }] }, finishReason: "STOP" }],
      usageMetadata: {
        promptTokenCount: 75,
        candidatesTokenCount: 127,
        totalTokenCount: 202,
        cachedContentTokenCount: 0,
        prompt_cache_miss_tokens: missing,
        reasoning_tokens: missing
      }
    };
  }
  return {
    id: `synthetic-${type}-optional-usage`,
    choices: [{ message: { content: "Synthetic optional usage response." }, finish_reason: "stop" }],
    usage: {
      prompt_tokens: 75,
      completion_tokens: 127,
      total_tokens: 202,
      prompt_cache_hit_tokens: 0,
      prompt_tokens_details: { cached_tokens: 0 },
      prompt_cache_miss_tokens: missing,
      reasoning_tokens: missing
    }
  };
}

function adapterOptionalUsageFetchResponse(type, mode) {
  const data = adapterOptionalUsageData(type, mode);
  return { ok: true, status: 200, statusText: "OK", json: async () => data };
}

function adapterStreamResponse(type, mode) {
  if (type !== "ollama" && type !== "gemini") {
    if (mode === "partial") {
      return (async function*() {
        yield openAiChunk("partial body");
        throw Object.assign(new Error("synthetic_disconnect_after_delta"), { code: "ECONNRESET" });
      })();
    }
    if (mode === "unterminated") {
      return (async function*() { yield openAiChunk("partial body"); })();
    }
    return (async function*() {
      yield openAiChunk("Synthetic complete body.");
      yield openAiChunk("", "stop");
      yield openAiTail();
    })();
  }

  if (type === "gemini") {
    const contentFrame = `data: ${JSON.stringify({ responseId: "synthetic-gemini", candidates: [{ content: { parts: [{ text: mode === "complete" ? "Synthetic complete body." : "partial body" }] } }] })}\n\n`;
    if (mode === "partial") return makeFetchResponse([contentFrame], Object.assign(new Error("synthetic_disconnect_after_delta"), { code: "ECONNRESET" }));
    if (mode === "unterminated") return makeFetchResponse([contentFrame]);
    const finishFrame = `data: ${JSON.stringify({ responseId: "synthetic-gemini", candidates: [{ finishReason: "STOP" }], usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 10, totalTokenCount: 110 } })}\n\n`;
    const usageTail = `data: ${JSON.stringify({ responseId: "synthetic-gemini", usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 10, totalTokenCount: 110 } })}\n\n`;
    return makeFetchResponse([contentFrame, finishFrame, usageTail]);
  }

  const contentLine = JSON.stringify({ created_at: "synthetic-ollama", message: { content: mode === "complete" ? "Synthetic complete body." : "partial body" }, done: false }) + "\n";
  if (mode === "partial") return makeFetchResponse([contentLine], Object.assign(new Error("synthetic_disconnect_after_delta"), { code: "ECONNRESET" }));
  if (mode === "unterminated") return makeFetchResponse([contentLine]);
  const finalLine = JSON.stringify({ created_at: "synthetic-ollama", done: true, done_reason: "stop", prompt_eval_count: 100, eval_count: 10 }) + "\n";
  return makeFetchResponse([contentLine, finalLine]);
}

async function withAdapter(type, mode, operation) {
  const Provider = providerClasses[type];
  const provider = new Provider();
  const config = fixtureConfig(type);
  const controller = new AbortController();
  const request = fixtureRequest(type, controller.signal);
  let sdkFixture = null;
  let fetchState = null;
  let fetchCalls = 0;
  if (type === "gemini" || type === "ollama") {
    beginFetchFixture(async (url, init) => {
      fetchCalls++;
      const expectedHost = type === "gemini" ? "gemini.fixture.invalid" : "ollama.fixture.invalid";
      assert.equal(url.hostname, expectedHost, "adapter_must_use_isolated_fixture_endpoint");
      if (mode.startsWith("nonstream-optional-")) return adapterOptionalUsageFetchResponse(type, mode);
      const result = mode === "pending-read" ? makePendingFetchResponse(init.signal) : adapterStreamResponse(type, mode);
      fetchState = result.state;
      return result.response || result;
    });
  } else {
    sdkFixture = beginSdkFixture(() => mode.startsWith("nonstream-optional-")
      ? adapterOptionalUsageData(type, mode) : adapterStreamResponse(type, mode));
  }
  try {
    await operation({ type, provider, config, request, controller, sdkFixture,
      getFetchState: () => fetchState, getFetchCalls: () => fetchCalls });
  } finally {
    if (sdkFixture) endSdkFixture();
    if (type === "gemini" || type === "ollama") endFetchFixture();
  }
}

async function testActionRejectsUnknownAndPartialTerminals() {
  const action = {
    id: "synthetic_action",
    filePath: "synthetic-action.js",
    validation: { valid: true },
    definition: {
      check: async () => ({ canExecute: true, validTargetCharacterIds: [] }),
      args: () => [],
      description: "Synthetic action",
      title: "Synthetic action"
    }
  };
  const effects = [];
  let currentResponse = null;
  let approvalMode = "all";
  const actionRegistry = {
    getAllActions: () => [action],
    getById: id => id === action.id ? action : null,
    getEffectiveDestructive: () => false,
    registerValidation() {}
  };
  const Engine = createActionEngine({
    actionRegistry,
    settingsRepository: {
      getLanguage: () => "en",
      getActionsProviderConfig: () => ({ providerType: "deepseek", defaultModel: "synthetic" }),
      getActionApprovalSettings: () => ({ approvalMode })
    },
    usageAnalytics: { record() {} },
    llmManager: { sendActionsRequest: async () => currentResponse },
    ActionPromptBuilder: { buildActionMessages: () => [{ role: "system", content: "synthetic" }] },
    ActionSandbox: { executeAction: async (_file, context) => { context.runGameEffect({ synthetic: true }); return { message: "queued" }; } },
    ActionEffectWriter: { writeEffect: () => { effects.push("awaiting_ack"); return { commandId: "synthetic-command", status: "awaiting_ack" }; } },
    CriticalActionRecallObserver: class { observeMissingActions() {} build() { return null; } },
    buildStructuredResponseJsonSchema: () => ({}),
    buildStructuredResponseSchema: () => ({ parse: value => value }),
    healJsonResponseWithLogging,
    resolveI18nString: value => value,
    logVerboseLLM() {}
  });
  const conv = { id: "synthetic-conversation", conversationEpoch: 1, gameData: { characters: new Map(), playerID: 1 }, getHistory: () => [] };
  const npc = { id: 2, shortName: "Synthetic NPC" };
  const validJson = JSON.stringify({ actions: [{ actionId: action.id, args: {} }] });

  approvalMode = "none";
  currentResponse = { content: validJson, finish_reason: "stop" };
  const gated = await Engine.evaluateForCharacter(conv, npc);
  failIfDifferent("approval_required_effect_count", 0, effects.length);
  failIfDifferent("approval_required_queued_for_approval", 1, gated.needsApproval.length);

  approvalMode = "all";
  currentResponse = { content: validJson, finish_reason: "stop" };
  await Engine.evaluateForCharacter(conv, npc);
  failIfDifferent("complete_stop_action_fixture", 1, effects.length);

  effects.length = 0;
  currentResponse = { content: validJson, finish_reason: "future_provider_state" };
  await Engine.evaluateForCharacter(conv, npc);
  failIfDifferent("unknown_finish_action_effects", 0, effects.length);

  effects.length = 0;
  currentResponse = { content: validJson, finish_reason: "length" };
  await Engine.evaluateForCharacter(conv, npc);
  failIfDifferent("length_finish_action_effects", 0, effects.length);

  effects.length = 0;
  currentResponse = { content: `{"actions":[{"actionId":"${action.id}","args":{}}]`, finish_reason: "stop" };
  await Engine.evaluateForCharacter(conv, npc);
  failIfDifferent("malformed_action_json_effects", 0, effects.length);
}

async function testStrictUnknownFinish() {
  for (const [label, finish_reason] of [["missing", null], ["new_enum", "future_provider_state"]]) {
    const outcome = validateGenerationOutcome({ content: "synthetic content", finish_reason });
    failIfDifferent(`unknown_finish_${label}_complete`, false, outcome.complete);
  }
  const gemini = new GeminiProvider();
  const parsed = gemini.parseGeminiResponse({ candidates: [{ content: { parts: [{ text: "synthetic content" }] }, finishReason: "FUTURE_PROVIDER_STATE" }] });
  failIfDifferent("gemini_unknown_finish_complete", false, validateGenerationOutcome(parsed).complete);
}

async function testTrackUsageEarlyReturnAndException() {
  for (const endMode of ["return", "throw"]) {
    const records = [];
    const provider = {};
    const manager = makeManager({ config: fixtureConfig("deepseek"), provider, usageRecords: records });
    let sourceClosed = false;
    const source = (async function*() {
      try {
        yield { delta: { content: "partial synthetic text" }, finish_reason: null };
        if (endMode === "throw") throw Object.assign(new Error("synthetic_stream_failure"), { code: "ECONNRESET" });
        yield { delta: { content: "unconsumed synthetic text" }, finish_reason: "stop" };
        return { content: "complete synthetic text", finish_reason: "stop", usage: { prompt_tokens: 2, completion_tokens: 3 } };
      } finally {
        sourceClosed = true;
      }
    })();
    const tracked = await manager.trackUsage(source, { requestType: "chat", estimatedPromptTokens: 8, providerType: "deepseek", model: "synthetic" });
    const iterator = tracked[Symbol.asyncIterator]();
    await iterator.next();
    if (endMode === "return") await iterator.return();
    else {
      const streamError = await rejectAndReturn(() => iterator.next());
      if (baselineMode) assert.match(streamError?.message || "", /synthetic_stream_failure/);
      else assertSafeProviderError("track_usage_stream_failure", streamError, "NETWORK", "synthetic_stream_failure");
    }
    failIfDifferent(`${endMode}_closes_provider_iterator`, true, sourceClosed);
    failIfDifferent(`${endMode}_records_one_terminal_usage_event`, 1, records.length);
    const usage = records[0]?.usage;
    failIfDifferent(`${endMode}_usage_unknown_after_partial`, "UNKNOWN", usage?.provenance?.status);
    assert.notEqual(usage?.status, "COMPLETE", `${endMode}_partial_stream_must_not_be_complete`);
    if (!baselineMode) {
      const terminalStatus = endMode === "return" ? "CANCELLED" : "PARTIAL";
      failIfDifferent(`${endMode}_canonical_generation_terminal`, terminalStatus, records[0]?.metadata?.generationStatus);
      failIfDifferent(`${endMode}_native_usage_not_fabricated`, null, usage?.native?.inputTokens);
      failIfDifferent(`${endMode}_estimated_input_retained_separately`, 8, usage?.estimated?.inputTokens);
      failIfDifferent(`${endMode}_canonical_provenance_present`, true, !!usage?.provenance);
    }
  }
}

async function testUsageOnlyTailsAndCacheZeroUnknown() {
  const zero = normalizeProviderUsage({ prompt_tokens: 100, prompt_tokens_details: { cached_tokens: 0 } });
  const unknown = normalizeProviderUsage({ prompt_tokens: 100 });
  failIfDifferent("native_zero_cache_count", 0, zero.prompt_cache_hit_tokens);
  failIfDifferent("native_zero_cache_status", "reported", zero.cache_reporting_status);
  failIfDifferent("missing_cache_count_is_unknown", null, unknown.prompt_cache_hit_tokens);
  failIfDifferent("missing_cache_status_is_unknown", "not_reported", unknown.cache_reporting_status);

  for (const type of providerTypes) {
    try {
      await withAdapter(type, "complete", async ({ provider, config, request }) => {
      const records = [];
      let result;
      let trackedUsage;
      if (baselineMode) {
        const manager = makeManager({ config, provider, usageRecords: records });
        const tracked = await manager.trackUsage(provider.chatCompletion(request, config), {
          requestType: "chat", estimatedPromptTokens: 12, providerType: type, model: config.defaultModel
        });
        result = await collectFinal(tracked);
      } else {
        const tracked = await trackCandidateAdapter({ provider, config, request, usageRecords: records });
        result = await collectFinal(tracked.tracked);
      }
      trackedUsage = records[0]?.usage;
      failIfDifferent(`${type}_complete_stream_content`, "Synthetic complete body.", result.final?.content);
      failIfDifferent(`${type}_complete_stream_finish`, "stop", result.final?.finish_reason);
      failIfDifferent(`${type}_usage_only_tail_prompt_count`, 100, result.final?.usage?.prompt_tokens);
      failIfDifferent(`${type}_tail_accounted_once`, 1, records.length);
      if (["openrouter", "openai-compatible", "zhipu", "player2", "deepseek"].includes(type)) {
        failIfDifferent(`${type}_tail_explicit_zero_survives`, 0, trackedUsage?.prompt_cache_hit_tokens);
      }
      if (!baselineMode) {
        failIfDifferent(`${type}_canonical_native_tail_input`, 100, trackedUsage?.native?.inputTokens);
        failIfDifferent(`${type}_canonical_estimate_is_separate`, 12, trackedUsage?.estimated?.inputTokens);
        failIfDifferent(`${type}_canonical_provenance_present`, true, !!trackedUsage?.provenance);
        if (type === "zhipu") {
          failIfDifferent("zhipu_stream_legacy_flat_reasoning_projection", 0, trackedUsage?.reasoning_tokens);
          failIfDifferent("zhipu_stream_raw_reasoning_remains_unknown", null, trackedUsage?.native?.reasoningTokens);
        }
      }
      });
    } catch (error) {
      const summary = `${error?.code || error?.name || "no_code"}/${error?.providerError?.category || "untyped"}`;
      failIfDifferent(`${type}_complete_stream_without_provider_error`, null, summary);
    }
  }
}

async function testOptionalUsageFieldsAcrossSevenAdapters() {
  const openAiAdapters = new Set(["openrouter", "openai-compatible", "zhipu", "player2", "deepseek"]);
  for (const type of providerTypes) {
    for (const missingMode of ["undefined", "null"]) {
      try {
        await withAdapter(type, `nonstream-optional-${missingMode}`, async ({ provider, config, request }) => {
          request.stream = false;
          const records = [];
          const tracked = await trackCandidateAdapter({ provider, config, request, usageRecords: records });
          const usage = records[0]?.usage;
          const reportedCacheHit = openAiAdapters.has(type) || type === "gemini";
          failIfDifferent(`${type}_${missingMode}_adapter_response_content`, "Synthetic optional usage response.", tracked.tracked?.content);
          failIfDifferent(`${type}_${missingMode}_adapter_native_input`, 75, usage?.native?.inputTokens);
          failIfDifferent(`${type}_${missingMode}_adapter_native_output`, 127, usage?.native?.outputTokens);
          failIfDifferent(`${type}_${missingMode}_adapter_native_total`, 202, usage?.native?.totalTokens);
          failIfDifferent(`${type}_${missingMode}_optional_native_cache_miss_not_zero`, null, usage?.native?.cacheMissTokens);
          failIfDifferent(`${type}_${missingMode}_optional_native_reasoning_not_zero`, null, usage?.native?.reasoningTokens);
          failIfDifferent(`${type}_${missingMode}_one_usage_record`, 1, records.length);
          failIfDifferent(`${type}_${missingMode}_estimated_input_separate`, 12, usage?.estimated?.inputTokens);
          failIfDifferent(`${type}_${missingMode}_usage_remains_partial`, "PARTIAL", usage?.provenance?.status);
          failIfDifferent(`${type}_${missingMode}_reasoning_source_unknown`, "NOT_REPORTED", usage?.provenance?.fieldSources?.reasoningTokens);
          if (reportedCacheHit) {
            failIfDifferent(`${type}_${missingMode}_explicit_zero_cache_hit_preserved`, 0, usage?.native?.cachedInputTokens);
            failIfDifferent(`${type}_${missingMode}_missing_cache_miss_derived_source`, "DERIVED", usage?.provenance?.fieldSources?.cacheMissTokens);
            failIfDifferent(`${type}_${missingMode}_derived_cache_miss`, 75, usage?.provenance?.derived?.cacheMissTokens);
          } else {
            failIfDifferent(`${type}_${missingMode}_missing_cache_hit_not_zero`, null, usage?.native?.cachedInputTokens);
            failIfDifferent(`${type}_${missingMode}_missing_cache_hit_source_unknown`, "NOT_REPORTED", usage?.provenance?.fieldSources?.cachedInputTokens);
            failIfDifferent(`${type}_${missingMode}_missing_cache_miss_source_unknown`, "NOT_REPORTED", usage?.provenance?.fieldSources?.cacheMissTokens);
            failIfDifferent(`${type}_${missingMode}_no_cache_miss_derivation`, null, usage?.provenance?.derived?.cacheMissTokens);
          }
        });
      } catch (error) {
        const summary = `${error?.code || error?.name || "no_code"}/${error?.providerError?.category || "untyped"}`;
        failIfDifferent(`${type}_${missingMode}_optional_usage_fixture_without_provider_error`, null, summary);
      }
    }
  }

  for (const type of providerTypes) {
    for (const [label, malformedValue] of [["malformed", "synthetic-not-a-number"], ["negative", -1]]) {
      const normalized = normalizeUsage({
        prompt_tokens: 75,
        completion_tokens: 127,
        total_tokens: 202,
        prompt_tokens_details: { cached_tokens: 0 },
        prompt_cache_miss_tokens: malformedValue
      }, { providerType: type });
      failIfDifferent(`${type}_${label}_native_cache_miss_not_fabricated`, null, normalized.native.cacheMissTokens);
      failIfDifferent(`${type}_${label}_usage_remains_inconsistent`, "INCONSISTENT", normalized.provenance.status);
      failIfDifferent(`${type}_${label}_inconsistent_field_preserved`, true, normalized.provenance.inconsistentFields.includes("cacheMissTokens"));
      failIfDifferent(`${type}_${label}_invalid_source_not_relabelled_derived`, "INVALID", normalized.provenance.fieldSources.cacheMissTokens);
      failIfDifferent(`${type}_${label}_invalid_value_not_derived`, null, normalized.provenance.derived.cacheMissTokens);
    }
  }

  const explicit = normalizeUsage({
    prompt_tokens: 75,
    completion_tokens: 127,
    total_tokens: 202,
    prompt_tokens_details: { cached_tokens: 0 },
    prompt_cache_miss_tokens: 9
  }, { providerType: "openrouter" });
  failIfDifferent("explicit_numeric_cache_miss_stays_native_reported", 9, explicit.native.cacheMissTokens);
  failIfDifferent("explicit_numeric_cache_miss_source_reported", "PROVIDER_REPORTED", explicit.provenance.fieldSources.cacheMissTokens);
  failIfDifferent("explicit_numeric_cache_miss_not_derived", null, explicit.provenance.derived.cacheMissTokens);
}

async function testZhipuTailDisconnectAndEarlyReturnCloseInnerStream() {
  await withAdapter("zhipu", "complete", async ({ provider, config, request, sdkFixture }) => {
    const rawTail = { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110,
      prompt_tokens_details: { cached_tokens: 0 } };
    sdkFixture.create = () => (async function*() {
      yield openAiChunk("GLM partial body");
      yield { id: "synthetic-zhipu", choices: [], usage: rawTail };
      throw Object.assign(new Error("synthetic_disconnect_after_usage_tail"), { code: "ECONNRESET" });
    })();
    const records = [];
    const tracked = await trackCandidateAdapter({ provider, config, request, usageRecords: records });
    const iterator = tracked.tracked[Symbol.asyncIterator]();
    failIfDifferent("zhipu_tail_disconnect_first_content", "GLM partial body", (await iterator.next()).value?.delta?.content);
    const tail = (await iterator.next()).value;
    failIfDifferent("zhipu_tail_flat_reasoning_projection", 0, tail?.usage?.reasoning_tokens);
    const streamError = await rejectAndReturn(() => iterator.next());
    assertSafeProviderError("zhipu_tail_disconnect", streamError, "NETWORK", "synthetic_disconnect_after_usage_tail");
    failIfDifferent("zhipu_tail_disconnect_records_once", 1, records.length);
    failIfDifferent("zhipu_tail_disconnect_is_partial", "PARTIAL", records[0]?.metadata?.generationStatus);
    failIfDifferent("zhipu_tail_native_input_retained", 100, records[0]?.usage?.native?.inputTokens);
    failIfDifferent("zhipu_tail_flat_reasoning_zero_preserved", 0, records[0]?.usage?.reasoning_tokens);
    failIfDifferent("zhipu_tail_native_reasoning_not_fabricated", null, records[0]?.usage?.native?.reasoningTokens);
    failIfDifferent("zhipu_tail_estimate_is_separate", 12, records[0]?.usage?.estimated?.inputTokens);
    failIfDifferent("zhipu_tail_usage_provenance_retained", true, !!records[0]?.usage?.provenance);
  });

  await withAdapter("zhipu", "complete", async ({ provider, config, request, sdkFixture }) => {
    let sourceFinallyCalls = 0;
    sdkFixture.create = () => (async function*() {
      try {
        yield openAiChunk("first synthetic GLM chunk");
        yield openAiChunk("unconsumed synthetic GLM chunk", "stop");
      } finally {
        sourceFinallyCalls++;
      }
    })();
    const iterator = provider.chatCompletion(request, config)[Symbol.asyncIterator]();
    await iterator.next();
    await iterator.return();
    failIfDifferent("zhipu_consumer_return_closes_sdk_source", 1, sourceFinallyCalls);
  });
}

async function testConflictingFinishAndDuplicateUsageTailAccounting() {
  const { ProviderPlatformFacade, createRequestControl } = candidatePlatformModules();
  const config = fixtureConfig("deepseek");
  const request = fixtureRequest(config.providerType);
  const rawUsage = { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110,
    prompt_tokens_details: { cached_tokens: 0 } };
  const events = [];
  const source = (async function*() {
    yield { delta: { content: "conflicting synthetic response" }, finish_reason: "stop" };
    yield { usage: rawUsage };
    yield { usage: rawUsage };
    yield { finish_reason: "length" };
    return { content: "conflicting synthetic response", finish_reason: "length", usage: rawUsage };
  })();
  const provider = { chatCompletion: (_request, _config, control) => { control.beforeSend(); return source; } };
  const control = createRequestControl({ onEvent: event => events.push(event) });
  const facade = new ProviderPlatformFacade();
  const generation = await facade.generate(provider, request, config, { capabilities: unknownCapabilities(), control });
  const records = [];
  const manager = makeManager({ config, provider, usageRecords: records });
  const tracked = await manager.trackUsage(generation, { requestType: "chat", requestControl: control,
    estimatedPromptTokens: 12, providerType: config.providerType, model: config.defaultModel });
  const final = await collectFinal(tracked);
  failIfDifferent("conflicting_finish_status_unknown", "UNKNOWN", final.final?.votc_result?.status);
  failIfDifferent("conflicting_finish_not_complete", false, validateGenerationOutcome(final.final).complete);
  failIfDifferent("duplicate_usage_tails_single_record", 1, records.length);
  failIfDifferent("duplicate_usage_tails_not_summed", 100, records[0]?.usage?.native?.inputTokens);
  failIfDifferent("duplicate_usage_tail_cache_zero", 0, records[0]?.usage?.native?.cachedInputTokens);
  failIfDifferent("conflicting_finish_terminal_usage_status", "UNKNOWN", records[0]?.metadata?.generationStatus);
}

async function testZhipuMissingReasoningKeepsFlatCompatibilityAndNativeUnknown() {
  const provider = new ZhipuProvider();
  const normalized = provider.normalizeUsage({ prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 });
  failIfDifferent("zhipu_legacy_flat_reasoning_projection", 0, normalized.reasoning_tokens);
  const raw = provider.buildUsageDebug({ prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 }, normalized).raw_usage;
  failIfDifferent("zhipu_native_reasoning_unknown_from_raw", null, raw.completion_tokens_details?.reasoning_tokens ?? null);
  const record = LLMManager.prototype.buildUsageRecord.call({ TokenCounter }, { usage: normalized, usage_debug: { raw_usage: raw } });
  failIfDifferent("canonical_native_reasoning_unknown", null, record.native?.reasoningTokens ?? null);
  failIfDifferent("legacy_reasoning_projection_preserved", 0, record.reasoning_tokens);
}

async function testCapabilityCancellationAndEndpointCacheIsolation() {
  const config = { providerType: "deepseek", instanceId: "same-instance", defaultModel: "synthetic-model", defaultParameters: {}, baseUrl: "https://first.fixture.invalid" };
  const lookupStarted = deferred();
  const lookupRelease = deferred();
  let transportCalls = 0;
  const provider = {
    listModels: () => { lookupStarted.resolve(); return lookupRelease.promise; },
    chatCompletion: async () => { transportCalls++; return { content: "synthetic", finish_reason: "stop" }; }
  };
  const manager = makeManager({ config, provider });
  const controller = new AbortController();
  const request = manager.sendSummaryRequest([{ role: "user", content: "synthetic" }], controller.signal, {
    requestType: "memory_recovery",
    beforeSendGuard() {}
  });
  await lookupStarted.promise;
  let requestSettled = false;
  request.then(() => { requestSettled = true; }, () => { requestSettled = true; });
  controller.abort();
  await new Promise(resolve => setImmediate(resolve));
  failIfDifferent("abort_settles_during_pending_capability_lookup", true, requestSettled);
  lookupRelease.resolve([{ id: config.defaultModel, contextLength: 32768 }]);
  await request.catch(() => {});
  failIfDifferent("aborted_capability_wait_never_sends", 0, transportCalls);

  const changedConfig = { ...config, instanceId: "endpoint-cache-instance", baseUrl: "https://first.fixture.invalid" };
  const observedEndpoints = [];
  const cacheProvider = {
    listModels: async current => {
      observedEndpoints.push(current.baseUrl);
      return [{ id: current.defaultModel, contextLength: current.baseUrl.includes("second") ? 65536 : 8192 }];
    }
  };
  const cacheManager = makeManager({ config: changedConfig, provider: cacheProvider });
  const first = await cacheManager.getProviderCapabilities("SUMMARY");
  changedConfig.baseUrl = "https://second.fixture.invalid";
  const second = await cacheManager.getProviderCapabilities("SUMMARY");
  failIfDifferent("endpoint_change_must_refresh_model_capabilities", false, first.contextWindow === second.contextWindow);
  failIfDifferent("endpoint_change_requeries_model_metadata", 2, observedEndpoints.length);
}

async function testMetadataLookupIsFreeAndPaidRetriesAreCounted() {
  const realSetTimeout = global.setTimeout;
  const realClearTimeout = global.clearTimeout;
  const retryDelayScheduled = deferred();
  let fireRetryDelay = null;
  global.setTimeout = callback => {
    fireRetryDelay = callback;
    retryDelayScheduled.resolve();
    return { syntheticTimer: true };
  };
  global.clearTimeout = () => {};
  try {
    await withAdapter("openai-compatible", "complete", async ({ provider, config, sdkFixture }) => {
      let metadataCalls = 0;
      let networkAttempts = 0;
      let lookupControl = null;
      const reservationsAtMetadataLookup = [];
      const paidReservations = [];
      const startedEvents = [];
      const records = [];
      sdkFixture.listModels = () => {
        metadataCalls++;
        reservationsAtMetadataLookup.push([...paidReservations]);
        return { data: [{ id: config.defaultModel }] };
      };
      sdkFixture.create = () => {
        networkAttempts++;
        if (networkAttempts === 1) throw new MockOpenAI.APIError("synthetic_503_before_response", 503);
        return { id: "synthetic-paid-response", choices: [{ message: { content: "Synthetic paid response." }, finish_reason: "stop" }],
          usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 } };
      };
      const originalListModels = provider.listModels.bind(provider);
      provider.listModels = (currentConfig, control) => {
        lookupControl = { maxAttempts: control?.maxAttempts, hasBeforeSend: typeof control?.beforeSend === "function", hasCheck: typeof control?.check === "function" };
        return originalListModels(currentConfig, control);
      };
      const manager = makeManager({ config, provider, usageRecords: records });
      const resultPromise = manager.sendSummaryRequest([{ role: "user", content: "Synthetic cost accounting fixture." }], undefined, {
        requestType: "summary",
        reserveAttempt: ({ attempt }) => { paidReservations.push(attempt); return true; },
        onProviderEvent: event => { if (event.type === "STARTED") startedEvents.push(event); }
      });
      await retryDelayScheduled.promise;
      failIfDifferent("one_free_metadata_lookup_before_generation", 1, metadataCalls);
      failIfDifferent("metadata_lookup_not_a_paid_reservation", [], reservationsAtMetadataLookup[0]);
      failIfDifferent("first_paid_generation_attempt", 1, networkAttempts);
      failIfDifferent("first_paid_attempt_started_event", 1, startedEvents.length);
      failIfDifferent("metadata_lookup_control_is_one_try_and_cancellable", { maxAttempts: 1, hasBeforeSend: false, hasCheck: true }, lookupControl);
      fireRetryDelay?.();
      const result = await resultPromise;
      failIfDifferent("one_metadata_plus_two_paid_generation_attempts", 2, networkAttempts);
      failIfDifferent("paid_reservations_cover_only_generation_attempts", [1, 2], paidReservations);
      failIfDifferent("paid_generation_started_events", 2, startedEvents.length);
      failIfDifferent("usage_metadata_paid_attempt_count", 2, records[0]?.metadata?.providerAttemptCount);
      failIfDifferent("retried_generation_returns_complete", "stop", result?.finish_reason);
      failIfDifferent("retried_generation_accounted_once", 1, records.length);
    });
  } finally {
    global.setTimeout = realSetTimeout;
    global.clearTimeout = realClearTimeout;
  }
}

async function testForgetGuardStillRunsAfterCapabilityWait() {
  const config = { providerType: "deepseek", instanceId: "forget-guard-fixture", defaultModel: "synthetic-model", defaultParameters: {} };
  const lookupStarted = deferred();
  const lookupRelease = deferred();
  let forgotten = false;
  let guardCalls = 0;
  let transportCalls = 0;
  const provider = {
    listModels: () => { lookupStarted.resolve(); return lookupRelease.promise; },
    chatCompletion: async (_request, _config, control) => {
      control?.beforeSend?.();
      transportCalls++;
      return { content: "synthetic", finish_reason: "stop", usage: { prompt_tokens: 1, completion_tokens: 1 } };
    }
  };
  const manager = makeManager({ config, provider });
  const request = manager.sendSummaryRequest([{ role: "user", content: "synthetic forgotten source" }], undefined, {
    requestType: "memory_recovery",
    beforeSendGuard() { guardCalls++; if (forgotten) throw new Error("memory4_request_source_changed_before_send"); }
  });
  await lookupStarted.promise;
  forgotten = true;
  lookupRelease.resolve([{ id: config.defaultModel, contextLength: 32768 }]);
  await assert.rejects(() => request, /memory4_request_source_changed_before_send/);
  failIfDifferent("forget_guard_runs_after_capability_wait", 1, guardCalls);
  failIfDifferent("forgotten_source_not_sent", 0, transportCalls);
}

async function testDeadlineAndPinnedConfigurationGuards() {
  const { ProviderPlatformFacade, createRequestControl } = candidatePlatformModules();
  const config = fixtureConfig("deepseek");
  const facade = new ProviderPlatformFacade();
  const events = [];
  const realSetTimeout = global.setTimeout;
  const realClearTimeout = global.clearTimeout;
  let fireDeadline = null;
  global.setTimeout = callback => { fireDeadline = callback; return { syntheticTimer: true }; };
  global.clearTimeout = () => {};
  try {
    const deadlineControl = createRequestControl({ deadline: Date.now() + 60000, onEvent: event => events.push(event) });
    const started = deferred();
    let deadlineTransportCalls = 0;
    const pendingProvider = {
      chatCompletion: (_request, _config, control) => {
        control.beforeSend();
        deadlineTransportCalls++;
        started.resolve();
        return new Promise(() => {});
      }
    };
    const pending = facade.generate(pendingProvider, fixtureRequest(config.providerType), config, {
      capabilities: unknownCapabilities(), control: deadlineControl
    });
    await started.promise;
    fireDeadline?.();
    const timeoutError = await rejectAndReturn(() => pending);
    assertSafeProviderError("request_deadline", timeoutError, "TIMEOUT", "synthetic_deadline_secret");
    failIfDifferent("deadline_transport_attempts", 1, deadlineTransportCalls);
    failIfDifferent("deadline_event_emitted", true, events.some(event => event.type === "ABORTED"));
  } finally {
    global.setTimeout = realSetTimeout;
    global.clearTimeout = realClearTimeout;
  }

  let activeConfig = { ...fixtureConfig("deepseek"), instanceId: "pinned-config-fixture", apiKey: "synthetic-old-key" };
  const lookupStarted = deferred();
  const lookupRelease = deferred();
  let lookupCalls = 0;
  let generationCalls = 0;
  const provider = {
    listModels: (_config, control) => {
      lookupCalls++;
      // Model metadata is a free capability read: cancellation/deadline apply, but it does not reserve a paid generation attempt.
      control.check();
      lookupStarted.resolve();
      return lookupRelease.promise;
    },
    chatCompletion: (_request, _config, control) => {
      control.beforeSend();
      generationCalls++;
      return { content: "synthetic", finish_reason: "stop" };
    }
  };
  const settingsRepository = {
    getSummaryProviderConfig: () => activeConfig,
    getActiveProviderConfig: () => activeConfig,
    getActionsProviderConfig: () => activeConfig
  };
  const manager = makeManager({ config: activeConfig, provider, settingsRepository });
  const request = manager.sendSummaryRequest([{ role: "user", content: "synthetic pinned configuration" }], undefined, { requestType: "summary" });
  await lookupStarted.promise;
  activeConfig = { ...activeConfig, apiKey: "synthetic-new-key" };
  lookupRelease.resolve([{ id: activeConfig.defaultModel, contextLength: 32768 }]);
  const staleConfigError = await rejectAndReturn(() => request);
  assertSafeProviderError("pinned_configuration_change", staleConfigError, "UNKNOWN", "provider_configuration_changed_before_send");
  failIfDifferent("pinned_config_capability_lookup_count", 1, lookupCalls);
  failIfDifferent("stale_generation_transport_blocked", 0, generationCalls);
}

async function testUnsupportedUnknownAndCostReservations() {
  const { ProviderPlatformFacade } = candidatePlatformModules();
  const facade = new ProviderPlatformFacade();
  const config = fixtureConfig("deepseek");
  const request = { ...fixtureRequest(config.providerType), stream: false };
  let transportCalls = 0;
  const provider = {
    chatCompletion: (_request, _config, control) => {
      control.beforeSend();
      transportCalls++;
      return { content: "synthetic complete response", finish_reason: "stop" };
    }
  };
  const unknownResult = await facade.generate(provider, request, config, { capabilities: unknownCapabilities() });
  failIfDifferent("unknown_capabilities_remain_callable", "COMPLETE", unknownResult.votc_result?.status);
  failIfDifferent("unknown_capability_transport_count", 1, transportCalls);

  const unsupported = unknownCapabilities();
  unsupported.features.nonStreaming = { state: "UNSUPPORTED", source: "synthetic_fixture" };
  const unsupportedError = await rejectAndReturn(() => facade.generate(provider, request, config, { capabilities: unsupported }));
  assertSafeProviderError("unsupported_feature", unsupportedError, "UNSUPPORTED", "synthetic_unsupported_payload");
  failIfDifferent("unsupported_feature_no_transport", 1, transportCalls);

  const structuredUnsupported = unknownCapabilities();
  structuredUnsupported.features.structuredJsonSchema = { state: "UNSUPPORTED", source: "synthetic_fixture" };
  const structuredRequest = { ...request, response_format: { type: "json_schema", json_schema: { name: "synthetic", schema: {} } } };
  const structuredError = await rejectAndReturn(() => facade.generate(provider, structuredRequest, config, { capabilities: structuredUnsupported }));
  assertSafeProviderError("unsupported_structured_schema", structuredError, "UNSUPPORTED", "synthetic_schema_payload");
  failIfDifferent("structured_unsupported_no_transport", 1, transportCalls);

  const events = [];
  const budgetError = await rejectAndReturn(() => facade.generate(provider, request, config, {
    capabilities: unknownCapabilities(), reserveAttempt: () => false, onEvent: event => events.push(event)
  }));
  assertSafeProviderError("unknown_cost_reservation", budgetError, "BUDGET", "provider_cost_budget_exceeded");
  failIfDifferent("unknown_cost_no_transport", 1, transportCalls);
  failIfDifferent("unknown_cost_no_provider_attempt", 0, budgetError?.providerError?.attemptCount);
  failIfDifferent("unknown_cost_failure_event", true, events.some(event => event.type === "FAILED"));
}

async function testReaderCleanupAndCancelBeforeFirstNext() {
  for (const type of ["ollama", "gemini"]) {
    await withAdapter(type, "complete", async ({ provider, config, request, getFetchState }) => {
      const iterator = provider.chatCompletion(request, config)[Symbol.asyncIterator]();
      const first = await iterator.next();
      failIfDifferent(`${type}_consumer_cancel_first_delta`, "Synthetic complete body.", first.value?.delta?.content);
      await iterator.return();
      failIfDifferent(`${type}_consumer_cancel_calls_reader_cancel`, 1, getFetchState()?.cancelCalls);
      failIfDifferent(`${type}_consumer_cancel_releases_reader`, true, getFetchState()?.released);
    });

    await withAdapter(type, "pending-read", async ({ provider, config, request, getFetchState }) => {
      const records = [];
      const tracked = await trackCandidateAdapter({ provider, config, request, usageRecords: records });
      const iterator = tracked.tracked[Symbol.asyncIterator]();
      let nextError = null;
      const nextSettled = iterator.next().then(() => "resolved", error => { nextError = error; return "rejected"; });
      const pendingFetchState = await waitForFetchState(getFetchState, `${type}_pending_reader`);
      await pendingFetchState.readStarted;
      const returnSettled = iterator.return().then(() => "resolved", () => "rejected");
      const settled = await settleWithin(Promise.all([nextSettled, returnSettled]));
      failIfDifferent(`${type}_pending_reader_next_and_return_settle`, true, Array.isArray(settled));
      assertSafeProviderError(`${type}_pending_reader_abort_error`, nextError, "CANCELLED", "synthetic_pending_reader_abort");
      const finalized = await settleWithin(pendingFetchState.readerFinalized);
      failIfDifferent(`${type}_pending_reader_finally_runs`, true, finalized !== null);
      failIfDifferent(`${type}_pending_reader_cancel_once`, 1, pendingFetchState.cancelCalls);
      failIfDifferent(`${type}_pending_reader_releases_lock`, true, pendingFetchState.released);
      failIfDifferent(`${type}_pending_reader_single_terminal_usage`, 1, records.length);
      failIfDifferent(`${type}_pending_reader_usage_cancelled`, "CANCELLED", records[0]?.metadata?.generationStatus);
      failIfDifferent(`${type}_pending_reader_native_usage_unknown`, "UNKNOWN", records[0]?.usage?.provenance?.status);
    });
  }

  const { ProviderPlatformFacade } = candidatePlatformModules();
  const lifecycle = { cancelCalls: 0, disposeCalls: 0, emitted: [], upstreamReturns: 0, upstreamNextCalls: 0 };
  const abortController = new AbortController();
  const control = {
    signal: abortController.signal,
    attemptCount: 1,
    check() {},
    beforeSend() {},
    emit(event) { lifecycle.emitted.push(event); },
    cancel() { lifecycle.cancelCalls++; abortController.abort(); },
    dispose() { lifecycle.disposeCalls++; }
  };
  const source = {
    [Symbol.asyncIterator]() {
      return {
        async next() { lifecycle.upstreamNextCalls++; return { done: false, value: { delta: { content: "never-consumed" } } }; },
        async return() { lifecycle.upstreamReturns++; return { done: true }; }
      };
    }
  };
  const config = fixtureConfig("deepseek");
  const request = fixtureRequest(config.providerType);
  const provider = { chatCompletion: () => source };
  const facade = new ProviderPlatformFacade();
  const generation = await facade.generate(provider, request, config, { control, capabilities: unknownCapabilities() });
  const records = [];
  const manager = makeManager({ config, provider, usageRecords: records });
  const tracked = await manager.trackUsage(generation, {
    requestType: "chat", requestControl: control, estimatedPromptTokens: 9,
    providerType: config.providerType, model: config.defaultModel
  });
  const iterator = tracked[Symbol.asyncIterator]();
  await iterator.return();
  failIfDifferent("cancel_before_first_next_no_upstream_read", 0, lifecycle.upstreamNextCalls);
  failIfDifferent("cancel_before_first_next_closes_upstream_iterator", 1, lifecycle.upstreamReturns);
  failIfDifferent("cancel_before_first_next_records_terminal_usage", 1, records.length);
  failIfDifferent("cancel_before_first_next_cancels_control", true, lifecycle.cancelCalls > 0);
  failIfDifferent("cancel_before_first_next_disposes_control", true, lifecycle.disposeCalls > 0);

  const { createRequestControl } = candidatePlatformModules();
  const configWithPendingSource = fixtureConfig("deepseek");
  const requestWithPendingSource = fixtureRequest(configWithPendingSource.providerType);
  const pending = deferred();
  const sourceStarted = deferred();
  let sourceReturnCalls = 0;
  const pendingSource = {
    [Symbol.asyncIterator]() {
      return {
        next() { sourceStarted.resolve(); return pending.promise; },
        return() { sourceReturnCalls++; return new Promise(() => {}); }
      };
    }
  };
  const pendingProvider = { chatCompletion: (_request, _config, requestControl) => { requestControl.beforeSend(); return pendingSource; } };
  const pendingControl = createRequestControl({ signal: requestWithPendingSource.signal });
  const pendingFacade = new ProviderPlatformFacade();
  const pendingGeneration = await pendingFacade.generate(pendingProvider, requestWithPendingSource, configWithPendingSource, {
    control: pendingControl, capabilities: unknownCapabilities()
  });
  const pendingRecords = [];
  const pendingManager = makeManager({ config: configWithPendingSource, provider: pendingProvider, usageRecords: pendingRecords });
  const trackedPending = await pendingManager.trackUsage(pendingGeneration, { requestType: "chat", requestControl: pendingControl,
    estimatedPromptTokens: 9, providerType: configWithPendingSource.providerType, model: configWithPendingSource.defaultModel });
  const pendingIterator = trackedPending[Symbol.asyncIterator]();
  let pendingError = null;
  const nextSettled = pendingIterator.next().then(() => "resolved", error => { pendingError = error; return "rejected"; });
  await sourceStarted.promise;
  const returnSettled = pendingIterator.return().then(() => "resolved", () => "rejected");
  const outcomes = await settleWithin(Promise.all([nextSettled, returnSettled]));
  failIfDifferent("consumer_return_during_uncooperative_next_settles", true, Array.isArray(outcomes));
  failIfDifferent("consumer_return_during_next_resolves_cleanly", "resolved", outcomes?.[1]);
  assertSafeProviderError("consumer_return_during_next_cancellation", pendingError, "CANCELLED", "synthetic_provider_cancelled");
  failIfDifferent("consumer_return_during_next_closes_upstream", true, sourceReturnCalls > 0);
  failIfDifferent("consumer_return_during_next_accounts_once", 1, pendingRecords.length);
  failIfDifferent("consumer_return_during_next_terminal_status", "CANCELLED", pendingRecords[0]?.metadata?.generationStatus);
}

async function testActionEffectBusinessGates() {
  const { createActionEffectWriter } = candidatePlatformModules();
  const writes = [];
  let queueBlocked = false;
  let nextStatus = "awaiting_ack";
  const runFileManager = {
    releaseStalledActionForNewAction() {},
    getQueueHealth: () => ({ queueBlocked }),
    write(effectText, metadata) {
      writes.push({ effectText, metadata });
      return { commandId: `synthetic-command-${writes.length}`, status: nextStatus, writtenAt: "synthetic-time" };
    }
  };
  const ActionEffectWriter = createActionEffectWriter({ runFileManager });
  const action = { id: "playerPaysGoldTo", filePath: "synthetic-action.js", validation: { valid: true }, definition: { title: "Pay gold" } };
  const Engine = createActionEngine({
    actionRegistry: { getById: id => id === action.id ? action : null },
    settingsRepository: { getLanguage: () => "en" },
    ActionSandbox: { executeAction: async (_file, context) => {
      context.runGameEffect("change_gold = -50");
      return { message: "Gold transfer requested", expectedStateChange: { type: "GOLD_TRANSFER", sourceRuntimeId: 1, targetRuntimeId: 2, amount: context.args.amount } };
    } },
    ActionEffectWriter,
    resolveI18nString: value => value
  });
  const conv = {
    id: "synthetic-action-scope", conversationEpoch: 4, gameDataRevision: 12,
    gameData: { playerID: 1, revision: 12, characters: new Map([[1, { id: 1, gold: 100 }], [2, { id: 2, gold: 0 }]]) },
    getHistory: () => []
  };
  const npc = { id: 2, shortName: "Synthetic NPC" };
  const invocation = { actionId: action.id, targetCharacterId: 2, args: { amount: 50 } };
  const awaiting = await Engine.runInvocation(conv, npc, invocation);
  failIfDifferent("effect_writer_writes_one_command", 1, writes.length);
  failIfDifferent("awaiting_ack_not_success", false, awaiting.success);
  failIfDifferent("awaiting_ack_not_confirmed", false, awaiting.lifecycle.confirmed);
  failIfDifferent("awaiting_ack_pending_lifecycle", "DISPATCHED", awaiting.lifecycle.status);
  failIfDifferent("awaiting_ack_requires_readback", true, awaiting.confirmation?.requireCommandReadback);
  failIfDifferent("player_source_uses_root_binding", true, /name = votc_action_source value = root/.test(writes[0]?.effectText || ""));
  failIfDifferent("npc_target_binding_is_position_zero", true, /position = 0/.test(writes[0]?.effectText || ""));
  failIfDifferent("gold_amount_guard_retained", true, /gold >= 50/.test(writes[0]?.effectText || ""));
  failIfDifferent("gold_readback_retained", true, awaiting.confirmation?.requireCommandReadback);

  nextStatus = "queued";
  const queued = await Engine.runInvocation(conv, npc, invocation);
  failIfDifferent("queued_action_not_success", false, queued.success);
  failIfDifferent("queued_action_not_dispatched", false, queued.lifecycle.dispatched);
  failIfDifferent("queued_action_lifecycle", "QUEUED", queued.lifecycle.status);
  failIfDifferent("queued_action_not_confirmed", false, queued.lifecycle.confirmed);

  queueBlocked = true;
  const writesBeforeBlock = writes.length;
  const blocked = await Engine.runInvocation(conv, npc, invocation);
  failIfDifferent("blocked_queue_no_effect_write", writesBeforeBlock, writes.length);
  failIfDifferent("blocked_queue_not_success", false, blocked.success);
  failIfDifferent("blocked_queue_failure_lifecycle", "DISPATCH_FAILED", blocked.lifecycle.status);

  queueBlocked = false;
  const writesBeforeInvalidGold = writes.length;
  const invalidGold = await Engine.runInvocation(conv, npc, { ...invocation, args: { amount: 0 } });
  failIfDifferent("invalid_gold_no_effect_write", writesBeforeInvalidGold, writes.length);
  failIfDifferent("invalid_gold_not_success", false, invalidGold.success);
}

async function testUnterminatedStreamRejectedAcrossSevenAdapters() {
  for (const type of providerTypes) {
    await withAdapter(type, "unterminated", async ({ provider, config, request }) => {
      const { final } = await collectFinal(provider.chatCompletion(request, config));
      const outcome = validateGenerationOutcome(final);
      failIfDifferent(`${type}_unterminated_stream_not_complete`, false, outcome.complete);
    });
  }
}

async function testPartialStreamsNeverReplayAcrossSevenAdapters() {
  for (const type of providerTypes) {
    try {
      await withAdapter(type, "partial", async ({ provider, config, request, sdkFixture, getFetchState, getFetchCalls }) => {
        let iterator;
        let records = null;
        if (baselineMode) iterator = provider.chatCompletion(request, config)[Symbol.asyncIterator]();
        else {
          records = [];
          const tracked = await trackCandidateAdapter({ provider, config, request, usageRecords: records });
          iterator = tracked.tracked[Symbol.asyncIterator]();
        }
        const first = await iterator.next();
        assert.equal(first.value?.delta?.content, "partial body", `${type}_synthetic_partial_chunk`);
        if (baselineMode) {
          await assert.rejects(() => iterator.next(), /synthetic_disconnect_after_delta/);
        } else {
          const streamError = await rejectAndReturn(() => iterator.next());
          assertSafeProviderError(`${type}_partial_stream`, streamError, "NETWORK", "synthetic_disconnect_after_delta");
          failIfDifferent(`${type}_partial_terminal_usage_recorded_once`, 1, records.length);
          failIfDifferent(`${type}_partial_not_marked_complete`, "PARTIAL", records[0]?.metadata?.generationStatus);
          failIfDifferent(`${type}_partial_usage_native_is_unknown`, "UNKNOWN", records[0]?.usage?.provenance?.status);
          failIfDifferent(`${type}_partial_native_input_not_fabricated`, null, records[0]?.usage?.native?.inputTokens);
          failIfDifferent(`${type}_partial_prompt_estimate_separate`, 12, records[0]?.usage?.estimated?.inputTokens);
        }
        const attempts = sdkFixture ? sdkFixture.calls.length : getFetchCalls();
        failIfDifferent(`${type}_partial_stream_transport_attempts`, 1, attempts);
        if (["ollama", "gemini"].includes(type)) {
          assert(getFetchState()?.released, `${type}_reader_released_after_disconnect`);
          if (!baselineMode) failIfDifferent(`${type}_reader_cancelled_after_disconnect`, 1, getFetchState()?.cancelCalls);
        }
      });
    } catch (error) {
      const summary = `${error?.code || error?.name || "no_code"}/${error?.providerError?.category || "untyped"}`;
      failIfDifferent(`${type}_partial_stream_error_boundary`, null, summary);
    }
  }
}

async function testAbortDuringBackoffAndSdkRetryOwnership() {
  for (const type of ["openrouter", "openai-compatible", "zhipu", "player2", "deepseek"]) {
    await withAdapter(type, "complete", async ({ provider, config, request, sdkFixture }) => {
      const retryRequest = { ...request, stream: true };
      const stream = provider.chatCompletion(retryRequest, config);
      await collectFinal(stream);
      const options = sdkFixture.clients[0];
      failIfDifferent(`${type}_sdk_retries_explicitly_disabled`, 0, options.maxRetries ?? null);
    });
  }

  for (const type of ["openrouter", "openai-compatible", "zhipu", "player2", "deepseek"]) {
    const controller = new AbortController();
    let scheduled = null;
    const scheduledDelay = deferred();
    const realSetTimeout = global.setTimeout;
    global.setTimeout = (callback, delay, ...args) => {
      scheduled = () => callback(...args);
      scheduledDelay.resolve(delay);
      return { unref() {} };
    };
    try {
      await withAdapter(type, "complete", async ({ provider, config, request, sdkFixture }) => {
        const retriedRequest = { ...request, signal: controller.signal };
        sdkFixture.create = (_wireRequest, requestOptions) => {
          if (requestOptions?.signal?.aborted) throw Object.assign(new Error("synthetic_abort_before_transport"), { name: "AbortError" });
          sdkFixture.networkAttempts = (sdkFixture.networkAttempts || 0) + 1;
          if (sdkFixture.networkAttempts === 1) throw new MockOpenAI.APIError("synthetic 503", 503);
          return (async function*() {})();
        };
        const iterator = provider.chatCompletion(retriedRequest, config)[Symbol.asyncIterator]();
        const next = iterator.next();
        await scheduledDelay.promise;
        controller.abort();
        scheduled();
        await next.catch(() => {});
        failIfDifferent(`${type}_new_network_attempt_after_abort`, 1, sdkFixture.networkAttempts);
      });
    } finally {
      global.setTimeout = realSetTimeout;
    }
  }
}

async function run() {
  fs.mkdirSync(path.dirname(progressPath), { recursive: true });
  fs.writeFileSync(progressPath, "", "utf8");
  try {
    await scenario("Action rejects unknown and partial terminal before mock Effect", testActionRejectsUnknownAndPartialTerminals);
    await scenario("strict finish keeps null/new enum incomplete including Gemini mapping", testStrictUnknownFinish);
    await scenario("trackUsage closes and records UNKNOWN on early return and stream failure", testTrackUsageEarlyReturnAndException);
    await scenario("usage-only tails are retained once and cache 0 differs from UNKNOWN", testUsageOnlyTailsAndCacheZeroUnknown);
    if (!baselineMode) {
      await scenario("optional undefined/null usage stays unknown or derived across seven mocked adapters; malformed/negative stays inconsistent", testOptionalUsageFieldsAcrossSevenAdapters);
    }
    await scenario("Zhipu flat reasoning 0 remains while canonical native reasoning is UNKNOWN", testZhipuMissingReasoningKeepsFlatCompatibilityAndNativeUnknown);
    if (!baselineMode) {
      await scenario("Zhipu usage tail survives disconnect and consumer return closes SDK stream", testZhipuTailDisconnectAndEarlyReturnCloseInnerStream);
      await scenario("conflicting finish and duplicate usage tails remain UNKNOWN and account once", testConflictingFinishAndDuplicateUsageTailAccounting);
    }
    await scenario("capability cancellation settles promptly and endpoint changes invalidate cache", testCapabilityCancellationAndEndpointCacheIsolation);
    await scenario("Generic pre-send source guard still runs after capability lookup", testForgetGuardStillRunsAfterCapabilityWait);
    await scenario("unterminated streams are not complete across seven mocked adapters", testUnterminatedStreamRejectedAcrossSevenAdapters);
    await scenario("partial stream disconnect never replays across seven mocked adapters", testPartialStreamsNeverReplayAcrossSevenAdapters);
    await scenario("SDK retries are explicit and abort during backoff starts no new request", testAbortDuringBackoffAndSdkRetryOwnership);
    if (!baselineMode) {
      await scenario("capability metadata lookup is free and paid retries consume two attempts", testMetadataLookupIsFreeAndPaidRetriesAreCounted);
      await scenario("deadline and pinned provider configuration guard transport", testDeadlineAndPinnedConfigurationGuards);
      await scenario("UNSUPPORTED blocks, UNKNOWN remains callable, and unknown cost fails closed", testUnsupportedUnknownAndCostReservations);
      await scenario("reader cleanup and cancel-before-first-next lifecycle", testReaderCleanupAndCancelBeforeFirstNext);
      await scenario("ActionEffectWriter preserves ACK, queue, player-binding, and gold gates", testActionEffectBusinessGates);
    }
  } finally {
    Module._load = originalLoad;
    Module._extensions[".js"] = originalJsExtension;
    global.fetch = originalFetch;
    console.log = originalConsole.log;
    console.warn = originalConsole.warn;
    console.error = originalConsole.error;
  }

  const redCount = outcomes.filter(line => line.startsWith("RED ")).length;
  const passCount = outcomes.filter(line => line.startsWith("PASS ")).length;
  const skipCount = outcomes.filter(line => line.startsWith("SKIP ")).length;
  const lines = [
    `V9.3 independent QA source_mode=${baselineMode ? "baseline-snapshot" : "candidate-src"}`,
    ...(baselineMode ? [`requested_baseline=${expectedBaselinePrefix}`, `baseline=${baselineSha}`] : []),
    `head=${headSha}`,
    `source_loader=${baselineMode ? "git-show-baseline" : "filesystem-src"}; app_modules=${loadedModules.length}`,
    `source_modules=${[...new Set(loadedModules)].sort().join(",")}`,
    "network=blocked; SDK/fetch=synthetic mocks; credentials=synthetic only; CK3 effects=mock writer",
    ...(baselineMode ? ["baseline_red_record=.build/v93-independent-red.log (preserved; not overwritten)"] : []),
    ...outcomes,
    `RESULT red=${redCount} pass=${passCount} skip=${skipCount}`
  ];
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${lines.join("\n")}\n`, "utf8");
  process.stdout.write(`${lines.join("\n")}\n`);
  if (redCount) process.exitCode = 1;
}

run().catch(error => {
  Module._load = originalLoad;
  Module._extensions[".js"] = originalJsExtension;
  global.fetch = originalFetch;
  console.log = originalConsole.log;
  console.warn = originalConsole.warn;
  console.error = originalConsole.error;
  const line = `FATAL ${String(error?.stack || error)}`;
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${line}\n`, "utf8");
  process.stderr.write(`${line}\n`);
  process.exitCode = 1;
});
