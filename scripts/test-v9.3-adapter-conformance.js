"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const { captureAll, SCENARIOS } = require("./fixtures/v93-provider-golden");

const root = path.resolve(__dirname, "..");
const baseline = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/v93-provider-golden-baseline.json"), "utf8"));
const providerIndexPath = path.join(root, "src/app/main/providers/index.js");
const versionExports = {
  VOTC_CORE_VERSION: "9.3.6",
  VOTC_APP_VERSION: require(path.join(root, "package.json")).version,
  MEMORY_ENGINE_VERSION: "3.0",
  ACTION_SYSTEM_VERSION: "official-votc-2.0.3",
  SUPPORTED_PERSPECTIVE_SUMMARY_ENGINE_VERSIONS: new Set(["2.3", "2.4", "2.5", "3.0"])
};
const SDK_TYPES = ["openrouter", "openai-compatible", "zhipu", "player2", "deepseek"];
const TYPES = [...SDK_TYPES, "ollama", "gemini"];
const PROVIDER_CLASSES = {
  openrouter: "OpenRouterProvider",
  "openai-compatible": "OpenAICompatibleProvider",
  zhipu: "ZhipuProvider",
  ollama: "OllamaProvider",
  player2: "Player2Provider",
  deepseek: "DeepseekProvider",
  gemini: "GeminiProvider"
};
let activeFixture = null;
let activeSuite = "startup";

class MockOpenAI {
  constructor(options = {}) {
    if (!activeFixture) throw new Error("mock_sdk_without_active_fixture");
    activeFixture.clients.push(options);
    this.chat = { completions: { create: (request, requestOptions) => {
      const call = { request, requestOptions, clientOptions: options };
      activeFixture.sdkCalls.push(call);
      return activeFixture.create(request, requestOptions, options);
    } } };
    this.models = { list: (...args) => {
      activeFixture.modelCalls.push(args);
      return activeFixture.listModels?.(...args);
    } };
  }
}
MockOpenAI.APIError = class MockAPIError extends Error {
  constructor(message, status) { super(message); this.name = "APIError"; this.status = status; }
};

const originalModuleLoad = Module._load;
Module._load = function loadProviderMocks(request, parent, isMain) {
  if (request === "openai") return MockOpenAI;
  if (request === "../version" && parent?.filename === providerIndexPath) return versionExports;
  return originalModuleLoad.call(this, request, parent, isMain);
};
const providers = require(providerIndexPath);
Module._load = originalModuleLoad;
const { validateGenerationOutcome } = require(path.join(root, "src/app/main/providers/generation-outcome.js"));

function configFor(type) {
  return {
    providerType: type,
    instanceId: `fixture-${type}`,
    apiKey: "synthetic-only",
    defaultModel: "synthetic-model",
    defaultParameters: {},
    baseUrl: type === "ollama" ? "https://ollama.fixture.invalid" : type === "gemini" ? "https://gemini.fixture.invalid/v1beta" : "https://compatible.fixture.invalid/v1",
    glmReasoningEffort: "low",
    glmClearThinking: true
  };
}

function requestFor(type, signal, overrides = {}) {
  return {
    model: configFor(type).defaultModel,
    messages: [{ role: "user", content: "Synthetic adapter conformance fixture." }],
    stream: true,
    max_tokens: 64,
    temperature: 0,
    signal,
    ...overrides
  };
}

function makeReader(chunks, errorAfter = null) {
  let index = 0;
  let errorSent = false;
  const state = { cancelCalls: 0, released: false };
  state.reader = {
    async read() {
      if (index < chunks.length) return { done: false, value: Buffer.from(chunks[index++]) };
      if (errorAfter && !errorSent) { errorSent = true; throw errorAfter; }
      return { done: true, value: void 0 };
    },
    async cancel() { state.cancelCalls++; },
    releaseLock() { state.released = true; }
  };
  return state;
}

function fetchResponse(chunks = [], { status = 200, errorAfter = null, json = null } = {}) {
  const state = chunks.length || errorAfter ? makeReader(chunks, errorAfter) : null;
  return {
    state,
    response: {
      ok: status >= 200 && status < 300,
      status,
      statusText: status === 200 ? "OK" : "Synthetic failure",
      headers: { get: () => null },
      body: state ? { getReader: () => state.reader } : null,
      async json() { return json; },
      async text() { return "[synthetic server text]"; }
    }
  };
}

function openAIContent(content, finishReason = null, extra = {}) {
  return { id: "synthetic-stream", choices: [{ index: 0, delta: content ? { content } : {}, finish_reason: finishReason }], ...extra };
}

function openAIUsageTail() {
  return { id: "synthetic-stream", choices: [], usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110, prompt_cache_hit_tokens: 0 } };
}

function openAIFrames(mode = "complete") {
  return async function* stream() {
    yield openAIContent(mode === "complete" ? "synthetic complete" : "partial synthetic");
    if (mode === "partial") throw new Error("synthetic_disconnect_after_delta");
    if (mode === "tail-then-disconnect") { yield openAIUsageTail(); throw new Error("synthetic_disconnect_after_usage"); }
    if (mode === "unterminated") return;
    yield openAIContent("", "stop");
    yield openAIUsageTail();
  };
}

function ollamaResponse(mode = "complete", options = {}) {
  const content = `${JSON.stringify({ created_at: "synthetic-ollama", message: { role: "assistant", content: mode === "complete" ? "synthetic complete" : "partial synthetic" }, done: false })}\r\n`;
  if (mode === "partial") return fetchResponse([content], { errorAfter: new Error("synthetic_disconnect_after_delta") });
  if (mode === "tail-then-disconnect") return fetchResponse([content, `${JSON.stringify({ prompt_eval_count: 100, eval_count: 10 })}\r\n`], { errorAfter: new Error("synthetic_disconnect_after_usage") });
  if (mode === "unterminated") return fetchResponse([content]);
  const final = JSON.stringify({ created_at: "synthetic-ollama", done: true, done_reason: "stop", prompt_eval_count: 100, eval_count: 10 });
  return fetchResponse(options.noUsage ? [content, `${JSON.stringify({ done: true, done_reason: "stop" })}`] : [content, final]);
}

function geminiEvent(value, lineEnding = "\r\n") {
  return `data: ${JSON.stringify(value)}${lineEnding}${lineEnding}`;
}

function geminiResponse(mode = "complete", options = {}) {
  const content = { responseId: "synthetic-gemini", candidates: [{ content: { parts: [{ text: mode === "complete" ? "synthetic complete" : "partial synthetic" }] } }] };
  if (mode === "partial") return fetchResponse([geminiEvent(content)], { errorAfter: new Error("synthetic_disconnect_after_delta") });
  if (mode === "tail-then-disconnect") return fetchResponse([geminiEvent(content), geminiEvent({ responseId: "synthetic-gemini", usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 10, totalTokenCount: 110 } })], { errorAfter: new Error("synthetic_disconnect_after_usage") });
  if (mode === "unterminated") return fetchResponse([geminiEvent(content)]);
  const terminal = { responseId: "synthetic-gemini", candidates: [{ finishReason: "STOP" }], usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 10, totalTokenCount: 110 } };
  const usage = { responseId: "synthetic-gemini", usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 10, totalTokenCount: 110 } };
  return fetchResponse([geminiEvent(content), geminiEvent(terminal), geminiEvent(usage)]);
}

async function withFixture(type, fixture, operation) {
  assert.equal(activeFixture, null, "fixtures_must_not_overlap");
  const previousFetch = global.fetch;
  activeFixture = {
    clients: [],
    sdkCalls: [],
    modelCalls: [],
    fetchCalls: [],
    create: fixture.create || (() => openAIFrames("complete")()),
    listModels: fixture.listModels || (async () => ({ data: [{ id: "synthetic-model" }] })),
    fetch: fixture.fetch || (async () => { throw new Error("unexpected_mocked_fetch"); })
  };
  global.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    if (!url.hostname.endsWith(".fixture.invalid") && url.hostname !== "openrouter.ai" && url.hostname !== "generativelanguage.googleapis.com" && url.hostname !== "127.0.0.1") {
      throw new Error("unexpected_mocked_endpoint");
    }
    activeFixture.fetchCalls.push({ url, init });
    return activeFixture.fetch(url, init);
  };
  try {
    const Provider = providers[PROVIDER_CLASSES[type]];
    const provider = new Provider();
    await operation({ provider, config: configFor(type), fixture: activeFixture });
  } finally {
    activeFixture = null;
    global.fetch = previousFetch;
  }
}

function controlFor(signal = new AbortController().signal, check = null) {
  let beforeSendCalls = 0;
  return {
    control: { signal, check: check || (() => {}), beforeSend() { beforeSendCalls++; } },
    get beforeSendCalls() { return beforeSendCalls; }
  };
}

async function collect(stream) {
  const iterator = stream[Symbol.asyncIterator]();
  const chunks = [];
  while (true) {
    const step = await iterator.next();
    if (step.done) return { chunks, final: step.value };
    chunks.push(step.value);
  }
}

function scenarioProjection(capture) {
  return {
    id: capture.id,
    providerType: capture.providerType,
    route: capture.route,
    stream: capture.stream,
    messageVariant: capture.messageVariant,
    control: capture.control,
    actionSchemaDeliveryMode: capture.actionSchemaDeliveryMode,
    requests: capture.requests
  };
}

function expectedVersionHeaderUpdate(captures) {
  const counts = { "user-agent": 0, "x-title": 0 };
  const updated = captures.map(capture => ({
    ...capture,
    requests: capture.requests.map(request => {
      const headers = { ...request.headers };
      if (headers["user-agent"] === "VOTC/9.2.0") {
        headers["user-agent"] = "VOTC/9.3.6";
        counts["user-agent"]++;
      }
      if (headers["x-title"] === "Voices of the Court V9.2") {
        headers["x-title"] = "Voices of the Court V9.3.6";
        counts["x-title"]++;
      }
      return { ...request, headers };
    })
  }));
  assert.equal(counts["user-agent"], 12, "only the 12 VOTC User-Agent values in the old baseline receive the App version update");
  assert.equal(counts["x-title"], 12, "only the 12 VOTC X-Title values in the old baseline receive the core version update");
  return updated;
}

function assertCurrentVersionHeaders(captures) {
  let userAgentCount = 0;
  let titleCount = 0;
  for (const capture of captures) {
    for (const request of capture.requests) {
      const userAgent = request.headers["user-agent"];
      const title = request.headers["x-title"];
      if (userAgent?.startsWith("VOTC/")) {
        assert.equal(userAgent, "VOTC/9.3.6", `${capture.id}_VOTC_user_agent_version`);
        userAgentCount++;
      }
      if (title?.startsWith("Voices of the Court V")) {
        assert.equal(title, "Voices of the Court V9.3.6", `${capture.id}_VOTC_x_title_version`);
        titleCount++;
      }
    }
  }
  assert.equal(userAgentCount, 12, "all 12 VOTC User-Agent headers must carry App 9.3.6");
  assert.equal(titleCount, 12, "all 12 VOTC X-Title headers must carry core V9.3.6");
}

async function testFrozenWireGolden() {
  assert.equal(SCENARIOS.length, 39);
  assert.equal(baseline.baseline.gitSha, "e1c3c37c89d8001f995593bc1c287a9c0d63a31f");
  assert.equal(baseline.baseline.openaiSdkVersion, "4.104.0");
  const current = captureAll();
  assertCurrentVersionHeaders(current.captures);
  const expectedCaptures = expectedVersionHeaderUpdate(baseline.captures);
  assert.deepStrictEqual(current.captures.map(scenarioProjection), expectedCaptures.map(scenarioProjection), "provider wire changed beyond the explicit V9.3.6 version headers");
  for (const capture of current.captures.filter(item => item.control === "durable-before-send")) {
    assert.equal(capture.beforeSendGuardCalls, capture.attemptCount, `${capture.id}_before_send_count`);
  }
}

async function testCompleteAndUnterminatedStreams() {
  for (const type of TYPES) {
    await withFixture(type, {
      create: openAIFrames("complete"),
      fetch: async () => (type === "gemini" ? geminiResponse("complete") : ollamaResponse("complete")).response
    }, async ({ provider, config, fixture }) => {
      const signal = new AbortController().signal;
      const guard = controlFor(signal);
      const result = await collect(provider.chatCompletion(requestFor(type, signal), config, guard.control));
      assert.equal(result.final.content, "synthetic complete", `${type}_complete_content`);
      assert.equal(result.final.finish_reason, "stop", `${type}_complete_finish`);
      assert.equal(result.final.usage?.prompt_tokens, 100, `${type}_usage_only_tail_kept`);
      assert.equal(guard.beforeSendCalls, 1, `${type}_before_send_once`);
      if (SDK_TYPES.includes(type)) {
        assert.equal(fixture.clients[0].maxRetries, 0, `${type}_sdk_hidden_retries_disabled`);
        assert.equal(fixture.sdkCalls[0].requestOptions?.signal, signal, `${type}_sdk_signal`);
      } else {
        assert.equal(fixture.fetchCalls[0].init.signal, signal, `${type}_fetch_signal`);
      }
      assert.equal(validateGenerationOutcome(result.final).complete, true, `${type}_complete_generation`);
    });

    await withFixture(type, {
      create: openAIFrames("unterminated"),
      fetch: async () => (type === "gemini" ? geminiResponse("unterminated") : ollamaResponse("unterminated")).response
    }, async ({ provider, config, fixture }) => {
      const result = await collect(provider.chatCompletion(requestFor(type), config));
      assert.equal(validateGenerationOutcome(result.final).complete, false, `${type}_missing_terminal_incomplete`);
      assert.equal(result.final.usage, void 0, `${type}_missing_usage_remains_unknown`);
      if (SDK_TYPES.includes(type)) assert.equal(fixture.clients[0].maxRetries, 0, `${type}_sdk_hidden_retries_disabled_without_control`);
    });
  }
}

async function testPartialStreamDoesNotRetryAndErrorIsTyped() {
  for (const type of TYPES) {
    await withFixture(type, {
      create: openAIFrames("partial"),
      fetch: async () => (type === "gemini" ? geminiResponse("partial") : ollamaResponse("partial")).response
    }, async ({ provider, config, fixture }) => {
      const stream = provider.chatCompletion(requestFor(type), config);
      const iterator = stream[Symbol.asyncIterator]();
      assert.equal((await iterator.next()).value.delta.content, "partial synthetic");
      await assert.rejects(() => iterator.next(), error => {
        assert.equal(error.providerError?.responseStarted, true, `${type}_partial_error_response_started`);
        assert.equal(error.message.includes("synthetic_disconnect_after_delta"), false, `${type}_raw_disconnect_hidden`);
        return true;
      }, `${type}_partial_disconnect_rejects`);
      assert.equal(SDK_TYPES.includes(type) ? fixture.sdkCalls.length : fixture.fetchCalls.length, 1, `${type}_partial_not_replayed`);
    });
  }
}

async function testUsageTailSurvivesDisconnect() {
  for (const type of TYPES) {
    await withFixture(type, {
      create: openAIFrames("tail-then-disconnect"),
      fetch: async () => (type === "gemini" ? geminiResponse("tail-then-disconnect") : ollamaResponse("tail-then-disconnect")).response
    }, async ({ provider, config, fixture }) => {
      const iterator = provider.chatCompletion(requestFor(type), config)[Symbol.asyncIterator]();
      assert.equal((await iterator.next()).value.delta.content, "partial synthetic");
      const usageOnly = (await iterator.next()).value;
      assert.equal(usageOnly.finish_reason, null, `${type}_usage_tail_is_not_terminal`);
      assert.equal(usageOnly.usage?.prompt_tokens, 100, `${type}_native_usage_is_visible_before_disconnect`);
      await assert.rejects(() => iterator.next(), error => error.providerError?.responseStarted === true, `${type}_usage_tail_disconnect_rejects`);
      assert.equal(SDK_TYPES.includes(type) ? fixture.sdkCalls.length : fixture.fetchCalls.length, 1, `${type}_usage_disconnect_not_replayed`);
    });
  }
}

async function testRetryPolicyAndGuardIdentity() {
  const realSetTimeout = global.setTimeout;
  global.setTimeout = (callback, _delay, ...args) => realSetTimeout(callback, 0, ...args);
  try {
    for (const type of TYPES) {
      await withFixture(type, {
        create: (() => { let attempt = 0; return async () => { attempt++; if (attempt === 1) throw Object.assign(new Error("synthetic server body"), { status: 503 }); return openAIFrames("complete")(); }; })(),
        fetch: (() => { let attempt = 0; return async () => { attempt++; if (attempt === 1) return fetchResponse([], { status: 503 }).response; return (type === "gemini" ? geminiResponse("complete") : ollamaResponse("complete")).response; }; })()
      }, async ({ provider, config, fixture }) => {
        const guard = controlFor();
        const result = await collect(provider.chatCompletion(requestFor(type), config, guard.control));
        assert.equal(result.final.finish_reason, "stop", `${type}_503_retry_success`);
        assert.equal(SDK_TYPES.includes(type) ? fixture.sdkCalls.length : fixture.fetchCalls.length, 2, `${type}_only_two_total_attempts`);
        assert.equal(guard.beforeSendCalls, 2, `${type}_one_guard_per_attempt`);
      });

      for (const failure of [Object.assign(new Error("synthetic server body"), { status: 500 }), Object.assign(new Error("synthetic network detail"), { code: "ECONNRESET" })]) {
        await withFixture(type, {
          create: () => { throw failure; },
          fetch: async () => fetchResponse([], { status: failure.status || 200, errorAfter: failure }).response
        }, async ({ provider, config, fixture }) => {
          const guard = controlFor();
          await assert.rejects(() => collect(provider.chatCompletion(requestFor(type), config, guard.control)), error => {
            assert.notEqual(error.message, failure.message, `${type}_raw_error_not_exposed`);
            return true;
          }, `${type}_unsafe_failure_rejects_${failure.status || failure.code}`);
          assert.equal(SDK_TYPES.includes(type) ? fixture.sdkCalls.length : fixture.fetchCalls.length, 1, `${type}_unsafe_error_not_retried`);
          assert.equal(guard.beforeSendCalls, 1, `${type}_failed_attempt_guard_once`);
        });
      }
    }
  } finally {
    global.setTimeout = realSetTimeout;
  }

  for (const type of TYPES) {
    const sentinel = new Error("memory4_request_source_changed_before_send");
    await withFixture(type, { create: openAIFrames("complete"), fetch: async () => { throw new Error("transport_must_not_run"); } }, async ({ provider, config, fixture }) => {
      const guard = controlFor(void 0, () => { throw sentinel; });
      const iterator = provider.chatCompletion(requestFor(type), config, guard.control)[Symbol.asyncIterator]();
      await assert.rejects(() => iterator.next(), error => error === sentinel, `${type}_source_guard_identity`);
      assert.equal(guard.beforeSendCalls, 0, `${type}_guard_stops_before_send`);
      assert.equal(SDK_TYPES.includes(type) ? fixture.sdkCalls.length : fixture.fetchCalls.length, 0, `${type}_guard_stops_transport`);
    });
  }
}

async function testToolReasoningAndReaderBoundaries() {
  for (const type of SDK_TYPES) {
    await withFixture(type, {
      create: async function*() {
        yield { id: "synthetic-tool", choices: [{ index: 0, delta: { reasoning_content: "private reasoning" }, finish_reason: null }] };
        yield { id: "synthetic-tool", choices: [{ index: 0, delta: { tool_calls: [{ index: 0, type: "function", function: { name: "execute", arguments: "{" } }] }, finish_reason: null }] };
        yield { id: "synthetic-tool", choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "call-synthetic", type: "function", function: { arguments: "}" } }] }, finish_reason: null }] };
        yield { id: "synthetic-tool", choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] };
      }
    }, async ({ provider, config }) => {
      const result = await collect(provider.chatCompletion(requestFor(type), config));
      assert.equal(result.chunks[0].delta.reasoning, true, `${type}_reasoning_only_presence_marker`);
      assert.equal(typeof result.chunks[0].delta.reasoning, "boolean", `${type}_reasoning_text_not_forwarded`);
      assert.equal(result.final.tool_calls.length, 1, `${type}_tool_index_has_one_aggregate`);
      assert.equal(result.final.tool_calls[0].id, "call-synthetic", `${type}_tool_id_updated_in_place`);
      assert.equal(result.final.tool_calls[0].function.name, "execute", `${type}_tool_name_aggregated`);
      assert.equal(result.final.tool_calls[0].function.arguments, "{}", `${type}_tool_arguments_aggregated`);
    });
  }

  const multilineJson = JSON.stringify({ responseId: "synthetic-gemini", candidates: [{ content: { parts: [{ text: "multiline synthetic" }] } }] });
  const splitAt = multilineJson.indexOf(",") + 1;
  const multilineEvent = `data: ${multilineJson.slice(0, splitAt)}\r\ndata: ${multilineJson.slice(splitAt)}\r\n\r\n:heartbeat\r\n\r\n`;
  const terminalAtEof = `data: ${JSON.stringify({ responseId: "synthetic-gemini", candidates: [{ finishReason: "OTHER" }] })}`;
  const bytes = Buffer.from(multilineEvent + terminalAtEof);
  const split = bytes.indexOf(Buffer.from("\r\n")) + 1;
  const chunks = [bytes.subarray(0, split), bytes.subarray(split, split + 2), bytes.subarray(split + 2).toString("utf8")];
  await withFixture("gemini", { fetch: async () => fetchResponse(chunks).response }, async ({ provider, config, fixture }) => {
    const result = await collect(provider.chatCompletion(requestFor("gemini"), config));
    assert.equal(result.final.content, "multiline synthetic", "gemini_multiline_crlf_and_split_chunks");
    assert.equal(result.final.finish_reason, "OTHER", "gemini_other_is_not_stop");
    assert.equal(fixture.fetchCalls.length, 1);
  });

  const noFinish = { candidates: [{ content: { parts: [{ text: "safety fixture" }] }, finishReason: "SAFETY" }] };
  assert.equal(new providers.GeminiProvider().parseGeminiResponse(noFinish).finish_reason, "content_filter");
  assert.equal(new providers.GeminiProvider().parseGeminiResponse({ candidates: [{ content: { parts: [{ text: "unknown fixture" }] }, finishReason: "OTHER" }] }).finish_reason, "OTHER");
  assert.equal(new providers.GeminiProvider().parseGeminiResponse({ candidates: [{ content: { parts: [{ text: "missing fixture" }] } }] }).finish_reason, null);

  for (const [type, source] of [["gemini", "data: {malformed}\r\n\r\n"], ["ollama", "{malformed}\r\n"]]) {
    await withFixture(type, { fetch: async () => fetchResponse([source]).response }, async ({ provider, config }) => {
      const iterator = provider.chatCompletion(requestFor(type), config)[Symbol.asyncIterator]();
      await assert.rejects(() => iterator.next(), error => error.code === "provider_invalid_response", `${type}_malformed_frame_typed_error`);
    });
  }

  for (const type of ["gemini", "ollama"]) {
    const oneFrame = type === "gemini" ? geminiEvent({ responseId: "synthetic", candidates: [{ content: { parts: [{ text: "one" }] } }] }) : `${JSON.stringify({ message: { content: "one" }, done: false })}\n`;
    let state;
    await withFixture(type, { fetch: async () => { const result = fetchResponse([oneFrame]); state = result.state; return result.response; } }, async ({ provider, config }) => {
      const iterator = provider.chatCompletion(requestFor(type), config)[Symbol.asyncIterator]();
      await iterator.next();
      await iterator.return();
      assert.equal(state.cancelCalls, 1, `${type}_early_return_cancels_reader`);
      assert.equal(state.released, true, `${type}_early_return_releases_reader`);
    });
  }

  await withFixture("ollama", { fetch: async () => ollamaResponse("complete", { noUsage: true }).response }, async ({ provider, config }) => {
    const result = await collect(provider.chatCompletion(requestFor("ollama"), config));
    assert.equal(result.final.finish_reason, "stop", "ollama_crlf_and_eof_terminal_frame");
    assert.equal(result.final.usage, void 0, "ollama_missing_native_usage_is_unknown");
  });
}

async function testMetadataAbortDoesNotFallback() {
  for (const type of TYPES) {
    await withFixture(type, {
      listModels: async () => { throw Object.assign(new Error("synthetic abort"), { name: "AbortError" }); },
      fetch: async () => { throw new Error("fallback_must_not_run"); }
    }, async ({ provider, config, fixture }) => {
      const controller = new AbortController();
      controller.abort();
      let beforeSendCalls = 0;
      await assert.rejects(() => provider.listModels(config, { signal: controller.signal, beforeSend() { beforeSendCalls++; } }), undefined, `${type}_preaborted_metadata_rejects`);
      assert.equal(beforeSendCalls, 0, `${type}_aborted_metadata_before_send_count`);
      assert.equal(SDK_TYPES.includes(type) ? fixture.modelCalls.length : fixture.fetchCalls.length, 0, `${type}_aborted_metadata_no_transport_or_fallback`);
    });
  }

  for (const type of ["openai-compatible", "gemini"]) {
    const controller = new AbortController();
    let fallbackCalls = 0;
    await withFixture(type, {
      listModels: async () => {
        controller.abort();
        return { data: [{ id: "synthetic-model" }] };
      },
      fetch: async () => {
        if (type === "gemini") controller.abort();
        else fallbackCalls++;
        return fetchResponse([], { status: 503 }).response;
      }
    }, async ({ provider, config, fixture }) => {
      await assert.rejects(() => provider.listModels(config, { signal: controller.signal }), undefined, `${type}_abort_after_metadata_response_rejects`);
      assert.equal(fallbackCalls, 0, `${type}_abort_after_metadata_response_no_fallback`);
      if (type === "openai-compatible") assert.equal(fixture.fetchCalls.length, 0, "compatible_abort_after_sdk_response_no_fetch_fallback");
      if (type === "gemini") assert.equal(fixture.fetchCalls.length, 1, "gemini_abort_after_response_does_not_return_default_models");
    });
  }
}

async function testConnectionControlsAndTerminalStatus() {
  for (const type of TYPES) {
    const completeResponse = {
      id: "synthetic-test-response",
      choices: [{ message: { role: "assistant", content: "OK" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 }
    };
    const incompleteResponse = { ...completeResponse, choices: [{ message: { role: "assistant", content: "partial" }, finish_reason: null }] };
    const nativeResponse = type === "gemini"
      ? { responseId: "synthetic-gemini", candidates: [{ content: { parts: [{ text: "OK" }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 2, candidatesTokenCount: 1, totalTokenCount: 3 } }
      : type === "ollama"
        ? { models: [{ name: "synthetic-model" }] }
        : null;
    await withFixture(type, {
      create: async () => completeResponse,
      fetch: async (_url, init) => fetchResponse([], { json: nativeResponse, status: 200 }).response
    }, async ({ provider, config, fixture }) => {
      const signal = new AbortController().signal;
      const guard = controlFor(signal);
      const result = await provider.testConnection(config, guard.control);
      assert.equal(result.success, true, `${type}_test_connection_reachable`);
      assert.equal(guard.beforeSendCalls, 1, `${type}_test_connection_before_send_once`);
      if (type === "ollama") {
        assert.match(result.message, /generation was not tested/i);
        assert.equal(fixture.fetchCalls[0].init.signal, signal, "ollama_model_listing_signal");
      } else if (type === "gemini") {
        assert.equal(fixture.fetchCalls[0].init.signal, signal, "gemini_test_signal");
      } else {
        assert.equal(fixture.sdkCalls[0].requestOptions.signal, signal, `${type}_test_signal`);
      }
    });

    if (type === "ollama") continue;
    await withFixture(type, {
      create: async () => incompleteResponse,
      fetch: async () => fetchResponse([], { json: type === "gemini" ? { candidates: [{ content: { parts: [{ text: "partial" }] } }] } : {} }).response
    }, async ({ provider, config }) => {
      const result = await provider.testConnection(config, controlFor().control);
      assert.equal(result.success, false, `${type}_test_connection_requires_terminal_complete`);
      assert.match(result.error, /incomplete|valid response/i, `${type}_test_connection_reports_incomplete`);
    });
  }

  await withFixture("player2", {
    fetch: async () => fetchResponse([], { status: 200, json: {} }).response
  }, async ({ provider, fixture }) => {
    const signal = new AbortController().signal;
    const guard = controlFor(signal);
    const health = await provider.checkHealth(guard.control);
    assert.equal(health.success, true, "player2_health_200_reachable_exception");
    assert.match(health.message, /generation was not tested/i);
    assert.equal(guard.beforeSendCalls, 1);
    assert.equal(fixture.fetchCalls[0].init.signal, signal);
  });
}

async function run() {
  const savedConsole = { log: console.log, info: console.info, warn: console.warn, error: console.error };
  console.log = console.info = console.warn = console.error = () => {};
  try {
    activeSuite = "frozen-wire-golden";
    await testFrozenWireGolden();
    activeSuite = "complete-and-unterminated-streams";
    await testCompleteAndUnterminatedStreams();
    activeSuite = "partial-stream-no-replay-and-safe-error";
    await testPartialStreamDoesNotRetryAndErrorIsTyped();
    activeSuite = "usage-tail-survives-disconnect";
    await testUsageTailSurvivesDisconnect();
    activeSuite = "retry-policy-and-guard-identity";
    await testRetryPolicyAndGuardIdentity();
    activeSuite = "tool-reasoning-and-reader-boundaries";
    await testToolReasoningAndReaderBoundaries();
    activeSuite = "metadata-abort-no-fallback";
    await testMetadataAbortDoesNotFallback();
    activeSuite = "test-connection-controls-and-terminal-status";
    await testConnectionControlsAndTerminalStatus();
    process.stdout.write(`V9.3 adapter conformance: PASS (${SCENARIOS.length} frozen wire scenarios; 7 offline adapters).\n`);
  } finally {
    Object.assign(console, savedConsole);
  }
}

run().catch(error => {
  process.stderr.write(`V9.3 adapter conformance: FAIL suite=${activeSuite}\n${error?.stack || error?.message || "unknown"}\n`);
  process.exitCode = 1;
});
