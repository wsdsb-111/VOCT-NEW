"use strict";

const assert = require("assert");
const Module = require("module");
const path = require("path");
const providerIndexPath = require.resolve("../src/app/main/providers");
const versionExports = {
  VOTC_CORE_VERSION: "9.2",
  VOTC_APP_VERSION: require("../package.json").version,
  MEMORY_ENGINE_VERSION: "3.0",
  ACTION_SYSTEM_VERSION: "official-votc-2.0.3",
  SUPPORTED_PERSPECTIVE_SUMMARY_ENGINE_VERSIONS: new Set(["2.3", "2.4", "2.5", "3.0"])
};
class MockOpenAI {}
MockOpenAI.APIError = class MockAPIError extends Error {};
const originalModuleLoad = Module._load;
Module._load = function loadOpenAIMock(request, parent, isMain) {
  if (request === "openai") return MockOpenAI;
  if (request === "../version" && parent?.filename === providerIndexPath) return versionExports;
  return originalModuleLoad.call(this, request, parent, isMain);
};
let GeminiProvider;
try {
  ({ GeminiProvider } = require("../src/app/main/providers"));
} finally {
  Module._load = originalModuleLoad;
}
const { normalizeProviderUsage, normalizeUsage } = require("../src/app/main/providers/usage-normalization");
const { ProviderPlatformFacade } = require("../src/app/main/providers/provider-platform");
const { LLMManager, TokenCounter } = require("../src/app/main/provider-service");
const { createUsageAnalytics } = require("../src/app/main/analytics/usage-analytics");
const { createProviderDiagnostics } = require("../src/app/main/analytics/provider-diagnostics");

const failures = [];
let testCount = 0;
const adapter = new GeminiProvider();
const config = { providerType: "gemini", defaultModel: "synthetic-gemini" };
const request = { model: config.defaultModel, messages: [{ role: "user", content: "synthetic" }], stream: false };

function test(id, name, run) {
  testCount++;
  try {
    run();
    console.log(`PASS ${id} ${name}`);
  } catch (error) {
    failures.push({ id, name, error });
    console.error(`RED ${id} ${name}: ${error.message}`);
  }
}

async function testAsync(id, name, run) {
  testCount++;
  try {
    await run();
    console.log(`PASS ${id} ${name}`);
  } catch (error) {
    failures.push({ id, name, error });
    console.error(`RED ${id} ${name}: ${error.message}`);
  }
}

function makeResponse(usageMetadata, { candidate = true } = {}) {
  return {
    responseId: "synthetic-response",
    ...(candidate ? { candidates: [{ content: { parts: [{ text: "synthetic answer" }] }, finishReason: "STOP" }] } : {}),
    ...(usageMetadata === undefined ? {} : { usageMetadata })
  };
}

function safeUsage(metadata) {
  return adapter.parseGeminiResponse(makeResponse(metadata)).usage;
}

function usageMetadata(override = {}) {
  return {
    promptTokenCount: 100,
    candidatesTokenCount: 20,
    thoughtsTokenCount: 30,
    cachedContentTokenCount: 40,
    totalTokenCount: 150,
    ...override
  };
}

function geminiSseResponse(events) {
  const bytes = Buffer.from(events.map(event => `data: ${JSON.stringify(event)}\r\n\r\n`).join(""));
  const splitAt = Math.floor(bytes.length / 2);
  const chunks = [bytes.subarray(0, splitAt), bytes.subarray(splitAt)];
  let index = 0;
  const reader = {
    async read() {
      return index < chunks.length ? { done: false, value: chunks[index++] } : { done: true, value: void 0 };
    },
    async cancel() {},
    releaseLock() {}
  };
  return { ok: true, body: { getReader: () => reader } };
}

function normalizeGemini(raw, options = {}) {
  return normalizeUsage(raw, { providerType: "gemini", ...options });
}

function noSecrets(value, ...forbidden) {
  const serialized = JSON.stringify(value);
  for (const text of forbidden) assert.equal(serialized.includes(text), false, `sensitive fixture value leaked: ${text}`);
}

test("G01", "adapter projects all reported Gemini fields and accepts multi-component total", () => {
  const raw = usageMetadata({ toolUsePromptTokenCount: 7, futurePrivateField: "do-not-copy-this" });
  const projected = safeUsage(raw);
  assert.equal(projected.prompt_tokens, 100);
  assert.equal(projected.completion_tokens, 20);
  assert.equal(projected.total_tokens, 150);
  assert.equal(projected.usageMetadata.cachedContentTokenCount, 40);
  assert.equal(projected.usageMetadata.thoughtsTokenCount, 30);
  assert.equal(projected.usageMetadata.toolUsePromptTokenCount, 7);
  assert.equal(Object.prototype.hasOwnProperty.call(projected.usageMetadata, "futurePrivateField"), false);
  noSecrets(projected, "do-not-copy-this");

  const normalized = normalizeGemini(projected);
  assert.deepStrictEqual(normalized.native, {
    inputTokens: 100, outputTokens: 20, cachedInputTokens: 40,
    cacheMissTokens: null, reasoningTokens: 30, totalTokens: 150
  });
  assert.notEqual(normalized.provenance.status, "INCONSISTENT");
  assert.equal(normalized.provenance.accountingStatus, "RECONCILED");
  assert.equal(normalized.provenance.fieldSources.cachedInputTokens, "PROVIDER_REPORTED");
  assert.equal(normalized.provenance.fieldSources.reasoningTokens, "PROVIDER_REPORTED");
  assert.equal(normalized.provenance.fieldSources.toolUsePromptTokens, "PROVIDER_REPORTED");
  assert.equal(normalized.provenance.providerComponents.toolUsePromptTokens, 7);
  const legacy = normalizeProviderUsage(projected);
  assert.equal(legacy.visible_completion_tokens, 20, "visible candidate count must not subtract independent thoughts");
});

test("G02", "explicit Gemini zero counts remain reported zero", () => {
  const normalized = normalizeGemini({ usageMetadata: {
    promptTokenCount: 100, candidatesTokenCount: 20, thoughtsTokenCount: 0,
    cachedContentTokenCount: 0, totalTokenCount: 120
  } });
  assert.equal(normalized.native.reasoningTokens, 0);
  assert.equal(normalized.native.cachedInputTokens, 0);
  assert.equal(normalized.provenance.cacheStatus, "REPORTED_ZERO");
  assert.equal(normalized.provenance.fieldSources.reasoningTokens, "PROVIDER_REPORTED");
  assert.equal(normalized.provenance.fieldSources.cachedInputTokens, "PROVIDER_REPORTED");
  assert.equal(normalized.provenance.accountingStatus, "RECONCILED",
    "reported zero thoughts reconciles without adding separately reported tool use");
});

test("G03", "missing thoughts and cache stay unknown", () => {
  const normalized = normalizeGemini({ usageMetadata: {
    promptTokenCount: 100, candidatesTokenCount: 20, totalTokenCount: 120
  } });
  assert.equal(normalized.native.reasoningTokens, null);
  assert.equal(normalized.native.cachedInputTokens, null);
  assert.equal(normalized.provenance.fieldSources.reasoningTokens, "NOT_REPORTED");
  assert.equal(normalized.provenance.fieldSources.cachedInputTokens, "NOT_REPORTED");
  assert.equal(normalized.provenance.providerComponents.toolUsePromptTokens, null);
  assert.equal(normalized.provenance.fieldSources.toolUsePromptTokens, "NOT_REPORTED");
  assert.equal(normalized.provenance.accountingStatus, "UNRECONCILED",
    "missing thoughts must not be silently treated as a reported zero");
});

test("G04", "unexplained Gemini total is preserved as unreconciled", () => {
  const normalized = normalizeGemini({ usageMetadata: {
    promptTokenCount: 100, candidatesTokenCount: 20, thoughtsTokenCount: 30, totalTokenCount: 170
  } });
  assert.equal(normalized.native.totalTokens, 170);
  assert.equal(normalized.provenance.accountingStatus, "UNRECONCILED");
  assert.notEqual(normalized.provenance.status, "INCONSISTENT");
  assert.equal(normalized.native.reasoningTokens, 30);
  assert.equal(normalized.native.cachedInputTokens, null);
});

test("G05", "tool prompt count remains a separate provider component", () => {
  const normalized = normalizeGemini({ usageMetadata: {
    promptTokenCount: 100, candidatesTokenCount: 20, thoughtsTokenCount: 30,
    toolUsePromptTokenCount: 20, totalTokenCount: 170
  } });
  assert.equal(normalized.native.totalTokens, 170);
  assert.equal(normalized.provenance.providerComponents.toolUsePromptTokens, 20);
  assert.equal(normalized.provenance.fieldSources.toolUsePromptTokens, "PROVIDER_REPORTED");
  assert.equal(normalized.provenance.accountingStatus, "UNRECONCILED",
    "toolUsePromptTokenCount must not be added into total to manufacture reconciliation");
  assert.notEqual(normalized.provenance.status, "INCONSISTENT");
});

test("G06", "Gemini total below known prompt and candidate counts is inconsistent without rewriting total", () => {
  const normalized = normalizeGemini({ usageMetadata: {
    promptTokenCount: 100, candidatesTokenCount: 20, thoughtsTokenCount: 30, totalTokenCount: 50
  } });
  assert.equal(normalized.native.totalTokens, 50);
  assert.equal(normalized.provenance.status, "INCONSISTENT");
  assert.ok(normalized.provenance.inconsistentFields.includes("totalTokens"));
  assert.equal(normalized.provenance.accountingStatus, "INCONSISTENT");
});

test("G07", "invalid Gemini metadata is flagged without storing its raw value", () => {
  const projected = safeUsage(usageMetadata({ cachedContentTokenCount: -1, toolUsePromptTokenCount: "provider-private-invalid" }));
  assert.equal(Object.prototype.hasOwnProperty.call(projected.usageMetadata, "cachedContentTokenCount"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(projected.usageMetadata, "toolUsePromptTokenCount"), false);
  assert.deepStrictEqual(projected.usageMetadataInvalidFields, ["cachedContentTokenCount", "toolUsePromptTokenCount"]);
  noSecrets(projected, "provider-private-invalid");

  const normalized = normalizeGemini(projected);
  assert.equal(normalized.native.inputTokens, 100, "one invalid component must not discard valid counters");
  assert.equal(normalized.native.cachedInputTokens, null);
  assert.equal(normalized.provenance.fieldSources.cachedInputTokens, "INVALID");
  assert.equal(normalized.provenance.fieldSources.toolUsePromptTokens, "INVALID");
  assert.equal(normalized.provenance.providerComponents.toolUsePromptTokens, null);
  assert.equal(normalized.provenance.cacheStatus, "INCONSISTENT");
  noSecrets(normalized, "provider-private-invalid");
});

test("G08", "null, undefined, and absent optional values do not become zero", () => {
  for (const thoughts of [null, undefined, "absent"]) {
    const raw = { promptTokenCount: 100, candidatesTokenCount: 20, totalTokenCount: 120 };
    if (thoughts !== "absent") raw.thoughtsTokenCount = thoughts;
    const projected = safeUsage(raw);
    assert.equal(Object.prototype.hasOwnProperty.call(projected.usageMetadata, "thoughtsTokenCount"), false);
    const normalized = normalizeGemini(projected);
    assert.equal(normalized.native.reasoningTokens, null);
    assert.equal(normalized.provenance.fieldSources.reasoningTokens, "NOT_REPORTED");
  }
  const explicitZero = safeUsage(usageMetadata({ thoughtsTokenCount: 0 }));
  assert.equal(explicitZero.usageMetadata.thoughtsTokenCount, 0);
});

test("G09", "a missing usage block does not block a valid completed response", () => {
  const parsed = adapter.parseGeminiResponse(makeResponse(undefined));
  assert.equal(parsed.content, "synthetic answer");
  assert.equal(parsed.finish_reason, "stop");
  assert.equal(parsed.usage, undefined);
  const normalized = require("../src/app/main/providers/provider-result").normalizeProviderResult(parsed, {
    providerType: "gemini", estimatedInputTokens: 4
  });
  assert.equal(normalized.status, "COMPLETE");
  assert.equal(normalized.usage.native.inputTokens, null);
  assert.equal(normalized.usage.estimated.inputTokens, 4);
  assert.equal(normalized.usage.provenance.status, "NOT_REPORTED");
});

function makeManager(usageAnalytics, providerDiagnostics = null) {
  return new LLMManager({
    settingsRepository: {}, providerRegistry: {}, usageAnalytics, providerDiagnostics,
    TokenCounter, PromptBuilder: {}
  });
}

function unknownCapabilities() {
  const unknown = () => ({ state: "UNKNOWN", source: "synthetic_fixture" });
  return { features: { nonStreaming: unknown(), streaming: unknown() }, structuredDelivery: { mode: "UNKNOWN" } };
}

async function collect(stream) {
  const chunks = [];
  const iterator = stream[Symbol.asyncIterator]();
  while (true) {
    const step = await iterator.next();
    if (step.done) return { chunks, final: step.value };
    chunks.push(step.value);
  }
}

async function runStream(chunks) {
  const source = (async function*() {
    for (const chunk of chunks) {
      if (chunk instanceof Error) throw chunk;
      yield chunk;
    }
  })();
  const provider = { chatCompletion: () => source };
  const facade = new ProviderPlatformFacade();
  const generated = await facade.generate(provider, { ...request, stream: true }, config, { capabilities: unknownCapabilities() });
  const records = [];
  const manager = makeManager({ record: (metadata, usage) => records.push({ metadata, usage }) });
  const tracked = await manager.trackUsage(generated, {
    requestType: "chat", estimatedPromptTokens: 4, providerType: "gemini", model: config.defaultModel
  });
  return { tracked, records };
}

async function main() {
  await testAsync("G15", "real Gemini SSE usage-only partial and empty tails retain earlier reported fields", async () => {
    const events = [
      {
        responseId: "synthetic-sse",
        candidates: [{ content: { parts: [{ text: "synthetic answer" }] }, finishReason: "STOP" }],
        usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20, totalTokenCount: 127 }
      },
      { responseId: "synthetic-sse", usageMetadata: {
        candidatesTokenCount: 20, thoughtsTokenCount: 7, cachedContentTokenCount: 30,
        toolUsePromptTokenCount: "sse-private-sentinel", futurePrivateField: "unknown-private-sentinel"
      } },
      { responseId: "synthetic-sse", usageMetadata: {} }
    ];
    const previousFetch = global.fetch;
    global.fetch = async () => geminiSseResponse(events);
    try {
      const { chunks, final } = await collect(adapter.chatCompletion({ ...request, stream: true }, {
        ...config, apiKey: "synthetic-only", baseUrl: "https://gemini.fixture.invalid/v1beta"
      }));
      assert.equal(chunks.length, 3);
      assert.equal(chunks[0].finish_reason, "stop");
      assert.equal(chunks[1].usage.prompt_tokens, 100, "partial usage tail must retain the known prompt counter");
      assert.equal(chunks[1].usage.completion_tokens, 20, "partial usage tail must retain the known candidate counter");
      assert.equal(chunks[1].usage.total_tokens, 127, "partial usage tail must retain the known total");
      assert.deepStrictEqual(chunks[1].usage.usageMetadataInvalidFields, ["toolUsePromptTokenCount"]);
      assert.equal(chunks[2].usage, undefined, "an empty usage metadata event remains empty on the wire-facing chunk");
      assert.deepStrictEqual(final.usage.usageMetadata, {
        promptTokenCount: 100, candidatesTokenCount: 20, totalTokenCount: 127,
        cachedContentTokenCount: 30, thoughtsTokenCount: 7
      });
      assert.deepStrictEqual(normalizeGemini(final.usage).native, {
        inputTokens: 100, outputTokens: 20, cachedInputTokens: 30,
        cacheMissTokens: null, reasoningTokens: 7, totalTokens: 127
      });
      assert.deepStrictEqual(final.usage.usageMetadataInvalidFields, ["toolUsePromptTokenCount"]);
      noSecrets(final.usage, "sse-private-sentinel", "unknown-private-sentinel");
      assert.equal(final.finish_reason, "stop", "usage-only tails must not alter finish semantics");
      assert.equal(final.content, "synthetic answer", "usage-only tails must not alter SSE content");
    } finally {
      global.fetch = previousFetch;
    }
  });

  await testAsync("G10", "partial stream keeps observed usage and never records completion", async () => {
    const partial = adapter.parseGeminiStreamChunk({
      candidates: [{ content: { parts: [{ text: "partial answer" }] } }],
      usageMetadata: usageMetadata()
    });
    const { tracked, records } = await runStream([partial, new Error("synthetic disconnect")]);
    let thrown = false;
    try { await collect(tracked); } catch (_error) { thrown = true; }
    assert.equal(thrown, true);
    assert.equal(records.length, 1);
    assert.equal(records[0].metadata.generationStatus, "PARTIAL");
    assert.equal(records[0].usage.native.inputTokens, 100);
    assert.equal(records[0].usage.native.reasoningTokens, 30);
    assert.notEqual(records[0].metadata.generationStatus, "COMPLETE");
  });

  await testAsync("G11", "usage-only tail after STOP is retained and written once", async () => {
    const stopped = adapter.parseGeminiStreamChunk({
      candidates: [{ content: { parts: [{ text: "complete answer" }] }, finishReason: "STOP" }]
    });
    const tail = adapter.parseGeminiStreamChunk({ usageMetadata: usageMetadata() });
    const { tracked, records } = await runStream([stopped, tail]);
    const { final } = await collect(tracked);
    assert.equal(final.votc_result.status, "COMPLETE");
    assert.equal(records.length, 1);
    assert.equal(records[0].usage.native.cachedInputTokens, 40);
    assert.equal(records[0].usage.native.reasoningTokens, 30);
    assert.equal(records[0].usage.provenance.accountingStatus, "RECONCILED");
  });

  await testAsync("G12", "duplicate usage tails do not sum and conflicting finish stays UNKNOWN", async () => {
    const first = adapter.parseGeminiStreamChunk({
      candidates: [{ content: { parts: [{ text: "answer" }] }, finishReason: "STOP" }],
      usageMetadata: usageMetadata()
    });
    const repeated = adapter.parseGeminiStreamChunk({ usageMetadata: usageMetadata() });
    const conflict = adapter.parseGeminiStreamChunk({
      candidates: [{ content: { parts: [] }, finishReason: "MAX_TOKENS" }]
    });
    const { tracked, records } = await runStream([first, repeated, conflict]);
    const { final } = await collect(tracked);
    assert.equal(final.votc_result.status, "UNKNOWN");
    assert.equal(records.length, 1);
    assert.equal(records[0].usage.native.inputTokens, 100);
    assert.equal(records[0].usage.native.outputTokens, 20);
  });

  await testAsync("E2E", "Adapter through Facade, LLMManager, writers, and diagnostics preserves safe Gemini provenance", async () => {
    const files = new Map();
    const memoryFs = {
      existsSync: file => files.has(file),
      readFileSync: file => files.get(file),
      mkdirSync: () => {},
      writeFileSync: (file, content) => files.set(file, String(content))
    };
    const retention = {
      DEFAULT_MAX_USAGE_ENTRIES: 100,
      DEFAULT_MAX_DIAGNOSTIC_ENTRIES: 100,
      retainUsageAnalyticsEntries: entries => entries
    };
    const UsageAnalytics = createUsageAnalytics({
      fs: memoryFs, dataDir: "synthetic-v931", analyticsFile: "synthetic-v931/usage.json",
      retention, createPromptFingerprint: () => "synthetic"
    });
    const usageAnalytics = new UsageAnalytics();
    const ProviderDiagnostics = createProviderDiagnostics({
      fs: memoryFs, path, dataDir: "synthetic-v931", diagnosticsFile: "synthetic-v931/diagnostics.jsonl",
      settingsRepository: {}, providerRegistry: {}, TokenCounter
    });
    const diagnostics = new ProviderDiagnostics();
    const raw = usageMetadata({ toolUsePromptTokenCount: 7, futurePrivateField: "diagnostic-private-sentinel" });
    const provider = { chatCompletion: () => adapter.parseGeminiResponse(makeResponse(raw)) };
    const facade = new ProviderPlatformFacade();
    const generated = await facade.generate(provider, request, config, {
      capabilities: unknownCapabilities(), estimatedPromptTokens: 4
    });
    const manager = makeManager(usageAnalytics, diagnostics);
    await manager.trackUsage(Promise.resolve(generated), {
      requestType: "summary", estimatedPromptTokens: 4,
      providerType: "gemini", model: config.defaultModel
    });

    const usageEntry = usageAnalytics.read().entries[0];
    assert.equal(usageEntry.providerUsage.native.reasoningTokens, 30);
    assert.equal(usageEntry.providerUsage.native.cachedInputTokens, 40);
    assert.equal(usageEntry.providerUsage.provenance.fieldSources.reasoningTokens, "PROVIDER_REPORTED");
    assert.equal(usageEntry.providerUsage.provenance.fieldSources.cachedInputTokens, "PROVIDER_REPORTED");
    assert.equal(usageEntry.providerUsage.provenance.fieldSources.toolUsePromptTokens, "PROVIDER_REPORTED");
    assert.equal(usageEntry.providerUsage.provenance.providerComponents.toolUsePromptTokens, 7);
    assert.equal(usageEntry.providerUsage.provenance.accountingStatus, "RECONCILED");
    assert.equal(usageEntry.visibleCompletionTokens, 20);

    const diagnostic = diagnostics.getRecent(1)[0];
    assert.ok(diagnostic, "synthetic summary diagnostics should be persisted");
    assert.deepStrictEqual(diagnostic.canonicalUsage.native, usageEntry.providerUsage.native);
    assert.deepStrictEqual(diagnostic.canonicalUsage.provenance, usageEntry.providerUsage.provenance);
    noSecrets(diagnostic, "diagnostic-private-sentinel");
  });

  test("G16", "valid Gemini candidates take priority over a legacy visible projection", () => {
    const projected = normalizeProviderUsage({ usageMetadata: usageMetadata(), visible_completion_tokens: 5 });
    assert.equal(projected.visible_completion_tokens, 20);
  });

  test("G17", "Gemini invalid marker cannot be hidden by a legacy numeric alias", () => {
    const normalized = normalizeGemini({ usageMetadata: { candidatesTokenCount: 2, totalTokenCount: 200 },
      prompt_tokens: 99, usageMetadataInvalidFields: ["promptTokenCount"] });
    assert.equal(normalized.native.inputTokens, null);
    assert.equal(normalized.provenance.fieldSources.inputTokens, "INVALID");
    assert.equal(normalized.provenance.status, "INCONSISTENT");
  });

  test("G18", "an explicit non-Gemini provider keeps strict total checks with metadata present", () => {
    for (const providerType of ["zhipu", "deepseek", "openrouter", "openai-compatible", "player2", "ollama"]) {
      const normalized = normalizeUsage({ usageMetadata: usageMetadata() }, { providerType });
      assert.equal(normalized.provenance.status, "INCONSISTENT", providerType);
    }
  });

  test("G19", "partial Gemini totals cannot be below any confirmed base component", () => {
    for (const metadata of [
      { promptTokenCount: 100, totalTokenCount: 50 },
      { candidatesTokenCount: 20, totalTokenCount: 10 },
      { thoughtsTokenCount: 30, totalTokenCount: 20 }
    ]) {
      const normalized = normalizeGemini({ usageMetadata: metadata });
      assert.equal(normalized.native.totalTokens, metadata.totalTokenCount);
      assert.equal(normalized.provenance.status, "INCONSISTENT");
      assert.equal(normalized.provenance.accountingStatus, "INCONSISTENT");
      assert.ok(normalized.provenance.inconsistentFields.includes("totalTokens"));
    }
    const validPartial = normalizeGemini({ usageMetadata: { promptTokenCount: 100, totalTokenCount: 150 } });
    assert.equal(validPartial.provenance.status, "PARTIAL");
    assert.equal(validPartial.provenance.accountingStatus, "UNKNOWN");
    assert.equal(validPartial.native.outputTokens, null);
    assert.equal(validPartial.native.reasoningTokens, null);
  });

  test("G13", "non-Gemini strict total equality validation remains enabled", () => {
    const normalized = normalizeUsage({ prompt_tokens: 10, completion_tokens: 5, total_tokens: 99 }, { providerType: "openai-compatible" });
    assert.equal(normalized.native.totalTokens, 99);
    assert.equal(normalized.provenance.status, "INCONSISTENT");
    assert.ok(normalized.provenance.inconsistentFields.includes("totalTokens"));
  });

  test("G14", "Zhipu zero and OpenRouter undefined cache-miss compatibility is unchanged", () => {
    const zhipu = normalizeUsage({ prompt_tokens: 10, completion_tokens: 2, total_tokens: 12,
      prompt_tokens_details: { cached_tokens: 0 } }, { providerType: "zhipu" });
    assert.equal(zhipu.native.cachedInputTokens, 0);
    assert.equal(zhipu.provenance.cacheStatus, "REPORTED_ZERO");
    assert.equal(zhipu.provenance.fieldSources.cachedInputTokens, "PROVIDER_REPORTED");

    const openrouter = normalizeUsage({ prompt_tokens: 10, completion_tokens: 2, total_tokens: 12,
      prompt_cache_hit_tokens: 0, prompt_cache_miss_tokens: undefined }, { providerType: "openrouter" });
    assert.equal(openrouter.native.cacheMissTokens, null);
    assert.equal(openrouter.provenance.derived.cacheMissTokens, 10);
    assert.equal(openrouter.provenance.fieldSources.cacheMissTokens, "DERIVED");
  });

  console.log(`V9.3.1 Gemini Usage: ${testCount - failures.length}/${testCount} cases passed`);
  if (failures.length) {
    for (const failure of failures) {
      console.error(`FAIL ${failure.id} ${failure.name}`);
      if (failure.error?.stack) console.error(failure.error.stack);
    }
    process.exitCode = 1;
  }
}

main().catch(error => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
