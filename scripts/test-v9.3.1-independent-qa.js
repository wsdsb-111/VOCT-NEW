"use strict";

const fs = require("node:fs");
const Module = require("node:module");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const expectedBaseline = "6e232091edb109ccc1e34d26c4b9a120b8a199ba";
const args = process.argv.slice(2);
if (args.some(arg => !["--capture-red", "--capture-green"].includes(arg)) || args.length > 1) {
  throw new Error("Usage: node scripts/test-v9.3.1-independent-qa.js [--capture-red|--capture-green]");
}

const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
const results = [];
const failures = [];
const secretMarker = "QA_PRIVATE_GEMINI_COMPONENT_STRING_7f1a9c";
const originalLoad = Module._load;
const originalFetch = global.fetch;
const originalConsole = { log: console.log, warn: console.warn, error: console.error };
let activeFetchFixture = null;

class MockOpenAI {
  constructor() {
    this.chat = { completions: { create() { throw new Error("sdk_not_used_by_gemini_qa"); } } };
    this.models = { list() { throw new Error("sdk_not_used_by_gemini_qa"); } };
  }
}
MockOpenAI.APIError = class MockAPIError extends Error {};
Module._load = function(request, parent, isMain) {
  return request === "openai" ? MockOpenAI : originalLoad.call(this, request, parent, isMain);
};
global.fetch = async (input, init = {}) => {
  if (typeof activeFetchFixture !== "function") throw new Error("network_blocked_without_synthetic_fixture");
  const url = new URL(typeof input === "string" ? input : input.url);
  if (!url.hostname.endsWith(".fixture.invalid")) throw new Error("external_network_blocked");
  return activeFetchFixture(url, init);
};
console.log = console.warn = console.error = () => {};

const versionPath = require.resolve("../src/app/main/version");
require.cache[versionPath] = { exports: {
  VOTC_CORE_VERSION: "9.2",
  VOTC_APP_VERSION: require("../package.json").version,
  MEMORY_ENGINE_VERSION: "3.0",
  ACTION_SYSTEM_VERSION: "official-votc-2.0.3",
  SUPPORTED_PERSPECTIVE_SUMMARY_ENGINE_VERSIONS: new Set(["2.3", "2.4", "2.5", "3.0"])
} };

const { GeminiProvider } = require("../src/app/main/providers");
const { LLMManager, TokenCounter } = require("../src/app/main/provider-service");
const { normalizeUsage } = require("../src/app/main/providers/usage-normalization");
const { validateGenerationOutcome } = require("../src/app/main/providers/generation-outcome");
const { createRequestControl } = require("../src/app/main/providers/provider-cancellation");
const { createUsageAnalytics } = require("../src/app/main/analytics/usage-analytics");
const { createProviderDiagnostics } = require("../src/app/main/analytics/provider-diagnostics");
const usageRetention = require("../src/app/main/usage-analytics-retention");
const { createActionEffectWriter } = require("../src/app/main/actions/action-effect-writer");
const { createActionEngine } = require("../src/app/main/actions/action-engine");

function expect(condition, name) {
  if (!condition) throw new Error(`assertion_failed:${name}`);
}

function expectEqual(actual, expected, name) {
  if (actual !== expected) throw new Error(`assertion_failed:${name}`);
}

function expectOneOf(actual, accepted, name) {
  if (!accepted.includes(actual)) throw new Error(`assertion_failed:${name}`);
}

function sourceOf(usage, field) {
  return usage?.provenance?.fieldSources?.[field] ?? null;
}

function toolUseTokens(usage) {
  return usage?.providerComponents?.toolUsePromptTokens
    ?? usage?.provenance?.providerComponents?.toolUsePromptTokens
    ?? null;
}

function toolUseSource(usage) {
  return usage?.provenance?.fieldSources?.toolUsePromptTokens ?? null;
}

function accountingStatus(usage) {
  return usage?.provenance?.accountingStatus ?? usage?.providerComponents?.accountingStatus ?? null;
}

function safeError(error) {
  return String(error?.message || error || "unknown_failure").split(secretMarker).join("[redacted]").split("\n")[0];
}

async function scenario(name, operation) {
  try {
    await operation();
    results.push(`PASS ${name}`);
  } catch (error) {
    const message = safeError(error);
    failures.push(`${name}: ${message}`);
    results.push(`RED ${name}: ${message}`);
  }
}

function fixtureConfig() {
  return {
    providerType: "gemini",
    instanceId: "synthetic-gemini-v931",
    apiKey: "synthetic-fixture-key",
    defaultModel: "synthetic-gemini-model",
    defaultParameters: {},
    baseUrl: "https://gemini.fixture.invalid/v1beta"
  };
}

function jsonResponse(value) {
  return { ok: true, status: 200, json: async () => value };
}

function abortError() {
  const error = new Error("synthetic_abort");
  error.name = "AbortError";
  return error;
}

function streamResponse(frames, signal, { waitAfterFrames = false, splitSize = 7 } = {}) {
  const text = frames.map(frame => `data: ${JSON.stringify(frame)}\r\n\r\n`).join("");
  const bytes = Buffer.from(text, "utf8");
  const chunks = [];
  for (let offset = 0; offset < bytes.length; offset += splitSize) chunks.push(bytes.subarray(offset, offset + splitSize));
  let index = 0;
  return {
    ok: true,
    status: 200,
    body: {
      getReader() {
        return {
          async read() {
            if (signal?.aborted) throw abortError();
            if (index < chunks.length) return { done: false, value: chunks[index++] };
            if (!waitAfterFrames) return { done: true, value: void 0 };
            return new Promise((resolve, reject) => {
              const onAbort = () => {
                signal.removeEventListener("abort", onAbort);
                reject(abortError());
              };
              signal?.addEventListener("abort", onAbort, { once: true });
              if (signal?.aborted) onAbort();
            });
          },
          async cancel() {},
          releaseLock() {}
        };
      }
    }
  };
}

function makeHarness(name) {
  const dataDir = path.join(qaDataRoot, name);
  const analyticsFile = path.join(dataDir, "usage-analytics.json");
  const diagnosticsFile = path.join(dataDir, "provider-diagnostics.jsonl");
  fs.mkdirSync(dataDir, { recursive: true });
  const UsageAnalytics = createUsageAnalytics({
    fs,
    dataDir,
    analyticsFile,
    retention: usageRetention,
    createPromptFingerprint: () => "synthetic-fingerprint"
  });
  const usageAnalytics = new UsageAnalytics();
  const config = fixtureConfig();
  const ProviderDiagnostics = createProviderDiagnostics({
    fs,
    path,
    dataDir,
    diagnosticsFile,
    settingsRepository: { getActiveProviderConfig: () => config },
    providerRegistry: {},
    TokenCounter
  });
  const providerDiagnostics = new ProviderDiagnostics();
  const manager = new LLMManager({
    settingsRepository: {
      getActiveProviderConfig: () => config,
      getSummaryProviderConfig: () => config,
      getActionsProviderConfig: () => config
    },
    providerRegistry: { createProvider: () => new GeminiProvider() },
    usageAnalytics,
    providerDiagnostics,
    TokenCounter,
    PromptBuilder: { prepareSummaryMessages: messages => messages, getSummaryPromptBlocks: () => [] }
  });
  return { dataDir, analyticsFile, diagnosticsFile, config, usageAnalytics, providerDiagnostics, manager };
}

const qaDataRoot = path.join(root, ".build", `v931-independent-qa-${process.pid}-${Date.now()}`);

function requestFor(config, stream, signal) {
  return {
    model: config.defaultModel,
    messages: [{ role: "user", content: "Synthetic V9.3.1 provider QA request." }],
    stream,
    max_tokens: 64,
    temperature: 0,
    signal
  };
}

function requestDiff(harness, request) {
  return harness.providerDiagnostics.prepareOutboundRequest({
    provider: "gemini",
    model: harness.config.defaultModel,
    requestType: "chat",
    request,
    messages: request.messages,
    conversationId: "synthetic-v931-conversation",
    responderId: "synthetic-v931-responder",
    baseUrl: harness.config.baseUrl,
    blocks: []
  });
}

function trackingMetadata(harness, request, control) {
  return {
    requestType: "chat",
    providerType: "gemini",
    model: harness.config.defaultModel,
    requestControl: control,
    estimatedPromptTokens: 12,
    realRequestDiff: requestDiff(harness, request),
    messages: request.messages,
    blocks: []
  };
}

async function withFetchFixture(handler, operation) {
  activeFetchFixture = handler;
  try {
    return await operation();
  } finally {
    activeFetchFixture = null;
  }
}

async function runNonStream(name, usageMetadata) {
  const harness = makeHarness(name);
  const request = requestFor(harness.config, false);
  const provider = new GeminiProvider();
  const control = createRequestControl();
  const response = {
    responseId: `synthetic-${name}`,
    candidates: [{ content: { parts: [{ text: "Synthetic provider response." }] }, finishReason: "STOP" }],
    usageMetadata
  };
  const tracked = await withFetchFixture(async (_url, init) => {
    expectEqual(init.method, "POST", `${name}_synthetic_post`);
    return jsonResponse(response);
  }, () => harness.manager.trackUsage(
    harness.manager.generate(provider, request, harness.config, null, control, 12),
    trackingMetadata(harness, request, control)
  ));
  const analyticsEntries = harness.usageAnalytics.read().entries;
  const diagnosticEntries = harness.providerDiagnostics.readEntries();
  return { harness, tracked, typed: tracked?.votc_result?.usage, analyticsEntries, diagnosticEntries };
}

async function runStream(name, frames, { abortAfterFrames = false } = {}) {
  const harness = makeHarness(name);
  const requestController = new AbortController();
  const request = requestFor(harness.config, true, requestController.signal);
  const provider = new GeminiProvider();
  const control = createRequestControl({ signal: requestController.signal });
  return withFetchFixture(async (_url, init) => {
    expectEqual(init.method, "POST", `${name}_synthetic_post`);
    return streamResponse(frames, init.signal, { waitAfterFrames: abortAfterFrames });
  }, async () => {
    const tracked = await harness.manager.trackUsage(
      harness.manager.generate(provider, request, harness.config, null, control, 12),
      trackingMetadata(harness, request, control)
    );
    if (abortAfterFrames) {
      const iterator = tracked[Symbol.asyncIterator]();
      let observedUsage = false;
      while (!observedUsage) {
        const step = await iterator.next();
        expect(!step.done, `${name}_usage_frame_observed_before_abort`);
        observedUsage = !!step.value?.usage;
      }
      requestController.abort();
      let error = null;
      try { await iterator.next(); } catch (caught) { error = caught; }
      expect(!!error, `${name}_abort_rejects`);
      const analyticsEntries = harness.usageAnalytics.read().entries;
      const diagnosticEntries = harness.providerDiagnostics.readEntries();
      return { harness, tracked, error, typed: null, analyticsEntries, diagnosticEntries };
    }
    const chunks = [];
    const iterator = tracked[Symbol.asyncIterator]();
    let final;
    while (true) {
      const step = await iterator.next();
      if (step.done) { final = step.value; break; }
      chunks.push(step.value);
    }
    return {
      harness,
      tracked,
      chunks,
      final,
      typed: final?.votc_result?.usage,
      analyticsEntries: harness.usageAnalytics.read().entries,
      diagnosticEntries: harness.providerDiagnostics.readEntries()
    };
  });
}

function last(array) {
  return Array.isArray(array) && array.length ? array[array.length - 1] : null;
}

function readCanonicalFromAnalytics(output) {
  return last(output.analyticsEntries)?.providerUsage || null;
}

function assertLoggedOnce(output, name) {
  expectEqual(output.analyticsEntries.length, 1, `${name}_usage_writer_single_entry`);
  expectEqual(output.diagnosticEntries.length, 1, `${name}_diagnostic_writer_single_entry`);
}

async function testGeminiMulticomponentCanonicalAndWriters() {
  const output = await runNonStream("gemini-multi-component", {
    promptTokenCount: 100,
    candidatesTokenCount: 20,
    thoughtsTokenCount: 30,
    cachedContentTokenCount: 40,
    totalTokenCount: 150
  });
  const usage = output.typed;
  expectEqual(usage?.native?.inputTokens, 100, "gemini_input_native");
  expectEqual(usage?.native?.outputTokens, 20, "gemini_candidate_native");
  expectEqual(usage?.native?.reasoningTokens, 30, "gemini_thoughts_native");
  expectEqual(usage?.native?.cachedInputTokens, 40, "gemini_cached_native");
  expectEqual(usage?.native?.totalTokens, 150, "gemini_total_native");
  expect(usage?.provenance?.status !== "INCONSISTENT", "gemini_multicomponent_total_not_pairwise_inconsistent");
  expectEqual(usage?.visible_completion_tokens, 20, "gemini_visible_output_is_candidates");
  expectEqual(sourceOf(usage, "reasoningTokens"), "PROVIDER_REPORTED", "gemini_reasoning_source");
  expectEqual(sourceOf(usage, "cachedInputTokens"), "PROVIDER_REPORTED", "gemini_cache_source");
  const persisted = readCanonicalFromAnalytics(output);
  expectEqual(persisted?.native?.reasoningTokens, 30, "analytics_writer_persists_thoughts");
  expectEqual(persisted?.native?.cachedInputTokens, 40, "analytics_writer_persists_cache");
  expectEqual(sourceOf(persisted, "reasoningTokens"), "PROVIDER_REPORTED", "analytics_writer_persists_field_source");
  const diagnostic = last(output.diagnosticEntries);
  expectEqual(diagnostic?.canonicalUsage?.native?.reasoningTokens, 30, "diagnostic_writer_canonical_thoughts");
  expectEqual(diagnostic?.canonicalUsage?.native?.cachedInputTokens, 40, "diagnostic_writer_canonical_cache");
  assertLoggedOnce(output, "gemini_multi_component");
}

async function testGeminiInvalidStringIsClassifiedWithoutPersistence() {
  const output = await runNonStream("gemini-invalid-component", {
    promptTokenCount: 100,
    candidatesTokenCount: 20,
    thoughtsTokenCount: 0,
    cachedContentTokenCount: secretMarker,
    totalTokenCount: 120,
    toolUsePromptTokenCount: 7,
    unrecognizedFixtureField: { raw: secretMarker }
  });
  const usage = output.typed;
  expectEqual(usage?.native?.reasoningTokens, 0, "gemini_explicit_reasoning_zero");
  expectEqual(sourceOf(usage, "reasoningTokens"), "PROVIDER_REPORTED", "gemini_explicit_zero_source");
  expectEqual(usage?.native?.cachedInputTokens, null, "gemini_bad_cache_not_zero");
  expectEqual(sourceOf(usage, "cachedInputTokens"), "INVALID", "gemini_bad_cache_invalid_source");
  expectEqual(toolUseTokens(usage), 7, "gemini_tool_component_retained");
  expectEqual(toolUseSource(usage), "PROVIDER_REPORTED", "gemini_tool_component_source");
  expectOneOf(accountingStatus(usage), ["PARTIAL", "UNRECONCILED"], "gemini_tool_component_accounting_unreconciled");
  const persistedText = [
    JSON.stringify(output.tracked),
    fs.readFileSync(output.harness.analyticsFile, "utf8"),
    fs.readFileSync(output.harness.diagnosticsFile, "utf8")
  ].join("\n");
  expect(!persistedText.includes(secretMarker), "gemini_malicious_string_not_returned_or_persisted");
  assertLoggedOnce(output, "gemini_invalid_component");
}

async function testGeminiMissingNullUndefinedAndNoInference() {
  const cases = [
    ["gemini-zero-components", { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15, thoughtsTokenCount: 0, cachedContentTokenCount: 0 }, 0, 0],
    ["gemini-null-components", { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15, thoughtsTokenCount: null, cachedContentTokenCount: null }, null, null],
    ["gemini-undefined-components", { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15, thoughtsTokenCount: void 0, cachedContentTokenCount: void 0 }, null, null],
    ["gemini-absent-components", { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 }, null, null]
  ];
  for (const [name, usageMetadata, reasoning, cached] of cases) {
    const output = await runNonStream(name, usageMetadata);
    const usage = output.typed;
    expectEqual(usage?.native?.reasoningTokens, reasoning, `${name}_reasoning_value`);
    expectEqual(usage?.native?.cachedInputTokens, cached, `${name}_cache_value`);
    expectEqual(sourceOf(usage, "reasoningTokens"), reasoning === 0 ? "PROVIDER_REPORTED" : "NOT_REPORTED", `${name}_reasoning_source`);
    expectEqual(sourceOf(usage, "cachedInputTokens"), cached === 0 ? "PROVIDER_REPORTED" : "NOT_REPORTED", `${name}_cache_source`);
    assertLoggedOnce(output, name);
  }

  const noBreakdown = await runNonStream("gemini-unreported-components", {
    promptTokenCount: 100,
    candidatesTokenCount: 20,
    totalTokenCount: 170
  });
  const usage = noBreakdown.typed;
  expectEqual(usage?.native?.reasoningTokens, null, "gemini_total_difference_not_reasoning");
  expectEqual(sourceOf(usage, "reasoningTokens"), "NOT_REPORTED", "gemini_unreported_reasoning_source");
  expectEqual(toolUseTokens(usage), null, "gemini_total_difference_not_tool_component");
  expectEqual(toolUseSource(usage), "NOT_REPORTED", "gemini_unreported_tool_source");
  expectOneOf(accountingStatus(usage), ["PARTIAL", "UNRECONCILED"], "gemini_unreported_components_accounting_incomplete");
  expectEqual(usage?.native?.totalTokens, 170, "gemini_unreconciled_total_preserved");
  expect(usage?.provenance?.status !== "INCONSISTENT", "gemini_unreported_breakdown_not_guessed_as_inconsistent");
}

async function testGeminiUsageOnlyTailDeduplicatesAndPersistsOnce() {
  const metadata = { promptTokenCount: 40, candidatesTokenCount: 8, thoughtsTokenCount: 12, cachedContentTokenCount: 10, totalTokenCount: 60 };
  const output = await runStream("gemini-stop-usage-tail", [
    { responseId: "synthetic-tail", candidates: [{ content: { parts: [{ text: "Synthetic streamed text." }] } }] },
    { responseId: "synthetic-tail", candidates: [{ finishReason: "STOP" }], usageMetadata: metadata },
    { responseId: "synthetic-tail", usageMetadata: { ...metadata } }
  ]);
  expectEqual(output.final?.votc_result?.status, "COMPLETE", "gemini_tail_does_not_break_complete_finish");
  expectEqual(output.typed?.native?.reasoningTokens, 12, "gemini_tail_thoughts_preserved");
  expectEqual(output.typed?.native?.cachedInputTokens, 10, "gemini_tail_cache_preserved");
  expectEqual(output.typed?.native?.totalTokens, 60, "gemini_duplicate_tail_not_summed");
  expectEqual(output.chunks.filter(chunk => chunk?.usage).length, 2, "gemini_each_usage_only_frame_observable");
  assertLoggedOnce(output, "gemini_stop_usage_tail");
}

async function testGeminiUsageOnlyBeforeFinishAndConflictingFinish() {
  const metadata = { promptTokenCount: 30, candidatesTokenCount: 9, thoughtsTokenCount: 6, cachedContentTokenCount: 4, totalTokenCount: 45 };
  const output = await runStream("gemini-usage-before-finish", [
    { responseId: "synthetic-before", candidates: [{ content: { parts: [{ text: "Synthetic partial." }] } }] },
    { responseId: "synthetic-before", usageMetadata: metadata },
    { responseId: "synthetic-before", candidates: [{ finishReason: "STOP" }] }
  ]);
  expectEqual(output.typed?.native?.reasoningTokens, 6, "gemini_preterminal_usage_survives_finish");
  expectEqual(output.typed?.native?.cachedInputTokens, 4, "gemini_preterminal_cache_survives_finish");
  expectEqual(output.typed?.native?.totalTokens, 45, "gemini_preterminal_total_not_summed_again");
  assertLoggedOnce(output, "gemini_usage_before_finish");

  const conflict = await runStream("gemini-conflicting-finish", [
    { responseId: "synthetic-conflict", candidates: [{ content: { parts: [{ text: "Synthetic conflicting finish." }] }, finishReason: "STOP" }], usageMetadata: metadata },
    { responseId: "synthetic-conflict", candidates: [{ finishReason: "MAX_TOKENS" }], usageMetadata: metadata }
  ]);
  expectEqual(conflict.final?.votc_result?.status, "UNKNOWN", "gemini_conflicting_terminal_is_unknown");
  expectEqual(validateGenerationOutcome(conflict.final, { providerType: "gemini" }).complete, false, "gemini_conflicting_terminal_not_complete");
  expectEqual(conflict.typed?.native?.reasoningTokens, 6, "gemini_conflict_keeps_observed_usage");
  assertLoggedOnce(conflict, "gemini_conflicting_finish");
}

async function testGeminiEofAndAbortRetainPartialUsageWithoutComplete() {
  const metadata = { promptTokenCount: 21, candidatesTokenCount: 5, thoughtsTokenCount: 3, cachedContentTokenCount: 8, totalTokenCount: 29 };
  const eof = await runStream("gemini-eof-after-usage", [
    { responseId: "synthetic-eof", candidates: [{ content: { parts: [{ text: "Synthetic EOF." }] } }] },
    { responseId: "synthetic-eof", usageMetadata: metadata }
  ]);
  expectEqual(validateGenerationOutcome(eof.final, { providerType: "gemini" }).complete, false, "gemini_eof_without_finish_not_complete");
  expectEqual(eof.typed?.native?.reasoningTokens, 3, "gemini_eof_keeps_observed_thoughts");
  expectEqual(eof.typed?.native?.cachedInputTokens, 8, "gemini_eof_keeps_observed_cache");
  expectEqual(last(eof.analyticsEntries)?.generationStatus, "UNKNOWN", "gemini_eof_accounted_unknown");
  assertLoggedOnce(eof, "gemini_eof_after_usage");

  const aborted = await runStream("gemini-abort-after-usage", [
    { responseId: "synthetic-abort", candidates: [{ content: { parts: [{ text: "Synthetic abort." }] } }] },
    { responseId: "synthetic-abort", usageMetadata: metadata }
  ], { abortAfterFrames: true });
  expectEqual(aborted.typed, null, "gemini_abort_has_no_completed_result");
  expect(last(aborted.analyticsEntries)?.generationStatus !== "COMPLETE", "gemini_abort_never_recorded_complete");
  expectEqual(last(aborted.analyticsEntries)?.providerUsage?.native?.reasoningTokens, 3, "gemini_abort_partial_thoughts_preserved");
  expectEqual(last(aborted.analyticsEntries)?.providerUsage?.native?.cachedInputTokens, 8, "gemini_abort_partial_cache_preserved");
  assertLoggedOnce(aborted, "gemini_abort_after_usage");
}

async function testOtherSixProviderTotalsRemainStrict() {
  for (const providerType of ["openrouter", "openai-compatible", "zhipu", "ollama", "player2", "deepseek"]) {
    const usage = normalizeUsage({ prompt_tokens: 10, completion_tokens: 5, total_tokens: 99 }, { providerType });
    expectEqual(usage?.provenance?.status, "INCONSISTENT", `${providerType}_bad_total_stays_inconsistent`);
    expect(usage?.provenance?.inconsistentFields?.includes("totalTokens"), `${providerType}_total_field_stays_flagged`);
    expectEqual(usage?.native?.totalTokens, 99, `${providerType}_provider_total_not_rewritten`);
  }
}

function makeActionHarness(writeBehavior) {
  let writeAttempts = 0;
  const runFileManager = {
    releaseStalledActionForNewAction() {},
    getQueueHealth() { return { queueBlocked: false }; },
    write() {
      writeAttempts++;
      return writeBehavior(writeAttempts);
    }
  };
  const ActionEffectWriter = createActionEffectWriter({ runFileManager });
  const ActionSandbox = {
    async executeAction(_filePath, context) {
      await context.runGameEffect("synthetic_action_effect");
      return { message: "Synthetic action submitted." };
    }
  };
  const actionRegistry = {
    getById: () => ({ id: "syntheticAction", filePath: "synthetic-action.js", validation: { valid: true } })
  };
  const Engine = createActionEngine({
    actionRegistry,
    settingsRepository: { getLanguage: () => "en" },
    ActionSandbox,
    ActionEffectWriter,
    resolveI18nString: value => value
  });
  const conv = {
    id: "synthetic-conversation",
    conversationEpoch: 3,
    gameDataRevision: 8,
    gameData: { characters: new Map([[101, { id: 101 }], [202, { id: 202 }]]), playerID: 202, revision: 8 },
    getHistory: () => []
  };
  return {
    Engine,
    conv,
    npc: { id: 101, shortName: "Synthetic NPC" },
    invocation: { actionId: "syntheticAction", args: {} },
    get writeAttempts() { return writeAttempts; }
  };
}

async function runAction(writeBehavior) {
  const harness = makeActionHarness(writeBehavior);
  const result = await harness.Engine.runInvocation(harness.conv, harness.npc, harness.invocation);
  return { ...harness, result };
}

async function testActionFailureAndPartialUnknownAreNotAcceptedOrReplayed() {
  const partial = await runAction(() => { throw new Error("synthetic_partial_carrier_write_failure"); });
  expectEqual(partial.writeAttempts, 1, "action_partial_unknown_writer_not_replayed");
  expectEqual(partial.result?.success, false, "action_partial_unknown_success_false");
  expectEqual(partial.result?.lifecycle?.dispatched, false, "action_partial_unknown_not_projected_as_accepted");
  expectEqual(partial.result?.lifecycle?.confirmed, false, "action_partial_unknown_not_confirmed");
  expectEqual(partial.result?.lifecycle?.status, "DISPATCH_FAILED", "action_partial_unknown_dispatch_failed");
  expectEqual(partial.result?.diagnostic?.dispatchAttempted, true, "action_partial_attempted_diagnostic");
  expectEqual(partial.result?.diagnostic?.dispatchAccepted, false, "action_partial_not_accepted_diagnostic");
  expectEqual(partial.result?.diagnostic?.commandId, null, "action_partial_no_fabricated_command_id");
  expectEqual(partial.result?.diagnostic?.dispatchStatus, "FAILED", "action_partial_failed_compat_status");
  expectEqual(partial.result?.diagnostic?.confirmationStatus, "NOT_CONFIRMED", "action_partial_no_ack");

  const failedEnvelope = await runAction(() => ({ status: "FAILED" }));
  expectEqual(failedEnvelope.writeAttempts, 1, "action_failed_envelope_not_replayed");
  expectEqual(failedEnvelope.result?.success, false, "action_failed_envelope_success_false");
  expectEqual(failedEnvelope.result?.lifecycle?.dispatched, false, "action_failed_envelope_not_accepted");
  expectEqual(failedEnvelope.result?.diagnostic?.dispatchAttempted, true, "action_failed_envelope_attempted");
  expectEqual(failedEnvelope.result?.diagnostic?.dispatchAccepted, false, "action_failed_envelope_not_accepted_diagnostic");
  expectEqual(failedEnvelope.result?.diagnostic?.commandId, null, "action_failed_envelope_no_command_id");
}

async function testAcceptedCommandWaitsForCk3Confirmation() {
  for (const status of ["queued", "awaiting_ack"]) {
    const output = await runAction(attempt => ({ commandId: `synthetic-command-${attempt}`, status }));
    const result = output.result;
    expectEqual(output.writeAttempts, 1, `action_${status}_single_write`);
    expectEqual(result?.success, false, `action_${status}_not_reported_as_completed_success`);
    expectEqual(result?.lifecycle?.confirmed, false, `action_${status}_not_ck3_confirmed`);
    expectEqual(result?.lifecycle?.status, status === "queued" ? "QUEUED" : "DISPATCHED", `action_${status}_lifecycle_status`);
    expectEqual(result?.diagnostic?.dispatchAttempted, true, `action_${status}_attempted`);
    expectEqual(result?.diagnostic?.dispatchAccepted, true, `action_${status}_accepted`);
    expectEqual(result?.diagnostic?.commandId, `synthetic-command-1`, `action_${status}_real_command_id_retained`);
    expectEqual(result?.diagnostic?.confirmationStatus, "PENDING_CONFIRMATION", `action_${status}_still_waiting_for_ck3`);
    expectEqual(result?.confirmation?.type === "ACK_CONFIRMED", false, `action_${status}_no_fake_ck3_ack`);
  }
}

async function run() {
  const baselineState = head === expectedBaseline ? "BASELINE" : "HEAD_ADVANCED";
  await scenario("Gemini multicomponent native usage reaches analytics and diagnostic writers", testGeminiMulticomponentCanonicalAndWriters);
  await scenario("Gemini invalid string is classified and absent from returned or persisted output", testGeminiInvalidStringIsClassifiedWithoutPersistence);
  await scenario("Gemini zero, null, undefined, absent and unreported components stay distinct", testGeminiMissingNullUndefinedAndNoInference);
  await scenario("Gemini usage-only tails deduplicate and persist one usage record", testGeminiUsageOnlyTailDeduplicatesAndPersistsOnce);
  await scenario("Gemini usage-only ordering and conflicting finishes preserve fail-closed status", testGeminiUsageOnlyBeforeFinishAndConflictingFinish);
  await scenario("Gemini EOF and Abort preserve observed partial usage without COMPLETE", testGeminiEofAndAbortRetainPartialUsageWithoutComplete);
  await scenario("six non-Gemini providers retain strict total consistency checks", testOtherSixProviderTotalsRemainStrict);
  await scenario("Action writer failures and partial unknown delivery do not become accepted or replay", testActionFailureAndPartialUnknownAreNotAcceptedOrReplayed);
  await scenario("accepted Action commands remain unconfirmed until CK3 readback", testAcceptedCommandWaitsForCk3Confirmation);

  const report = [
    `V9.3.1 independent QA ${baselineState}`,
    `HEAD ${head}`,
    `cases ${results.length - failures.length}/${results.length} passed`,
    ...results,
    `SUMMARY ${failures.length ? `${failures.length} RED` : "GREEN"}`
  ].join("\n") + "\n";
  process.stdout.write(report);
  const evidence = args.includes("--capture-red") ? "RED" : args.includes("--capture-green") ? "GREEN" : null;
  if (evidence) {
    const evidencePath = path.join(root, ".build", `v931-independent-${evidence}.log`);
    fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
    fs.writeFileSync(evidencePath, report, "utf8");
    process.stdout.write(`EVIDENCE ${path.relative(root, evidencePath)}\n`);
  }
  if (head !== expectedBaseline) {
    process.stderr.write(`BASELINE_NOTE expected=${expectedBaseline} actual=${head}; source was tested as checked out.\n`);
  }
  process.exitCode = failures.length ? 1 : 0;
}

run().catch(error => {
  const report = `V9.3.1 independent QA HARNESS_FAILURE\nHEAD ${head}\n${safeError(error)}\n`;
  process.stderr.write(report);
  if (args.includes("--capture-red")) {
    fs.mkdirSync(path.join(root, ".build"), { recursive: true });
    fs.writeFileSync(path.join(root, ".build", "v931-independent-RED.log"), report, "utf8");
  }
  process.exitCode = 1;
}).finally(() => {
  try {
    if (path.dirname(qaDataRoot) === path.join(root, ".build") && path.basename(qaDataRoot).startsWith(`v931-independent-qa-${process.pid}-`)) {
      fs.rmSync(qaDataRoot, { recursive: true, force: true });
    }
  } catch {}
  Module._load = originalLoad;
  global.fetch = originalFetch;
  Object.assign(console, originalConsole);
});
