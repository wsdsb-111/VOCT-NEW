"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const { createUsageAnalytics } = require(path.join(root, "src", "app", "main", "analytics", "usage-analytics.js"));
const retention = require(path.join(root, "src", "app", "main", "usage-analytics-retention.js"));
const { projectContextDiagnostics } = require(path.join(root, "src", "app", "main", "memory-system", "player-memory-diagnostics.js"));
const {
  isValidContextLength,
  planRequestBudget,
  resolveProviderCapabilities,
  validateContextConfiguration
} = require(path.join(root, "src", "app", "main", "providers", "request-budget.js"));
const { resolveMemoryBudget } = require(path.join(root, "src", "app", "main", "memory-system", "memory-budget-policy.js"));
const { LLMManager } = require(path.join(root, "src", "app", "main", "provider-service.js"));
const { registerIpcHandlers } = require(path.join(root, "src", "app", "main", "ipc", "register-ipc.js"));

const preloadSource = fs.readFileSync(path.join(root, "src", "app", "preload", "preload.js"), "utf8");
const ipcSource = fs.readFileSync(path.join(root, "src", "app", "main", "ipc", "register-ipc.js"), "utf8");

assert.equal(isValidContextLength(256), true, "256 is a legal Custom context length");
assert.doesNotThrow(() => validateContextConfiguration({ contextMode: "custom", customContextLength: 256 }));

const tinyCapabilities = resolveProviderCapabilities({
  providerType: "zhipu",
  defaultModel: "fixture-model",
  contextMode: "custom",
  customContextLength: 256
}, null);
const emptyTinyBudget = planRequestBudget({
  messages: [],
  capabilities: tinyCapabilities,
  requestedOutputTokens: 256,
  countTokens: () => 0
});
assert.equal(emptyTinyBudget.estimatedInputTokens, 0);
assert.equal(emptyTinyBudget.reservedOutputTokens, 256);
assert.equal(emptyTinyBudget.outputReserveTokens, 256);
assert.equal(emptyTinyBudget.usableInputBudget, 0);
assert.equal(emptyTinyBudget.budgetStatus, "NO_USABLE_INPUT");
assert.equal(emptyTinyBudget.safe, false, "zero usable input is unsafe even when the counted prompt is empty");

const normalCapabilities = resolveProviderCapabilities({
  providerType: "zhipu",
  defaultModel: "fixture-model",
  contextMode: "custom",
  customContextLength: 90000,
  customMaxOutputTokens: 4096
}, null);
const outputBudget = planRequestBudget({
  messages: [],
  capabilities: normalCapabilities,
  requestedOutputTokens: 4096,
  countTokens: () => 0
});
assert.equal(outputBudget.outputReserveTokens, 4096, "the request planner reports its selected output reserve");
assert.equal(outputBudget.reservedOutputTokens, 4096);
assert(outputBudget.usableInputBudget > 0, "a usable window retains positive input room after reserves");

async function verifyProviderDiagnostics() {
  const manager = {
    async getProviderCapabilities() { return normalCapabilities; }
  };
  const diagnostics = await LLMManager.prototype.getContextDiagnostics.call(manager);
  assert.equal(diagnostics.contextMode, "custom");
  assert.equal(diagnostics.contextWindowSource, "user_provided_unverified");
  assert.equal(diagnostics.effectiveContextWindow, 90000);
  assert.equal(diagnostics.outputReserveTokens, outputBudget.outputReserveTokens);
  assert.equal(diagnostics.usableInputBudget, outputBudget.usableInputBudget);
  assert.equal(diagnostics.budgetStatus, "INPUT_AVAILABLE");

  const tinyManager = {
    async getProviderCapabilities() { return tinyCapabilities; }
  };
  const tinyDiagnostics = await LLMManager.prototype.getContextDiagnostics.call(tinyManager);
  assert.equal(tinyDiagnostics.usableInputBudget, 0);
  assert.equal(tinyDiagnostics.budgetStatus, "NO_USABLE_INPUT");
  return diagnostics;
}

const largeContextMemory = resolveMemoryBudget({
  participantCount: 4,
  contextWindowTokens: 1000000,
  providerHeadroomTokens: 1000000
});
assert.equal(largeContextMemory.policyBudgetTokens, 96000, "a 1M provider window does not raise the memory policy cap");
assert.equal(largeContextMemory.memoryBudgetTokens, 96000);

function verifyUsageAnalyticsWhitelist() {
  const bodySentinel = "CONTEXT_BUDGET_PRIVATE_BODY_SENTINEL";
  const nameSentinel = "CONTEXT_BUDGET_PRIVATE_NAME_SENTINEL";
  const pathSentinel = "C:\\private\\context-budget-fixture.json";
  const keySentinel = "sk-context-budget-fixture-secret";
  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "v9362-provider-budget-"));
  try {
    const dataDirectory = path.join(tempDirectory, "data");
    const analyticsFile = path.join(dataDirectory, "usage-analytics.json");
    const UsageAnalytics = createUsageAnalytics({
      fs,
      dataDir: dataDirectory,
      analyticsFile,
      retention,
      createPromptFingerprint: value => crypto.createHash("sha256").update(String(value || "")).digest("hex")
    });
    const analytics = new UsageAnalytics();
    analytics.record({
      requestType: "chat",
      proposalId: "valid-context-and-candidate-fields",
      providerType: "zhipu",
      model: "fixture-model",
      contextMode: "custom",
      contextWindowSource: "user_provided_unverified",
      effectiveContextWindow: 90000,
      configuredContextLength: 90000,
      modelNativeContext: 1000000,
      outputReserveTokens: 4096,
      usableInputBudget: 70000,
      prompt: bodySentinel,
      systemPrompt: bodySentinel,
      messages: [{ role: "user", content: bodySentinel }],
      sourcePath: pathSentinel,
      apiKey: keySentinel,
      pairMemoryMetrics: {
        candidateDirectoryStatus: "COMPLETE",
        candidateDirectoryCacheHit: true,
        candidateDirectoryBuildMs: 12.5,
        candidatePairCount: 5,
        ownerPairCount: 300,
        candidateReductionRatio: 0.9833,
        actualIndexReadCount: 5,
        scopeRevisionChecks: 10,
        legacyScanFallbackCount: 0,
        legacyScanFallbackReason: "NONE",
        indexLookupMs: 1.25,
        sourceResolveAttemptCount: 2,
        thirdPersonIntentLevel: "L2",
        content: bodySentinel,
        counterpartName: nameSentinel,
        sourcePath: pathSentinel,
        apiKey: keySentinel
      }
    }, { prompt_tokens: 100, completion_tokens: 20 });
    analytics.record({
      requestType: "chat",
      proposalId: "invalid-candidate-fields",
      providerType: "zhipu",
      model: "fixture-model",
      pairMemoryMetrics: {
        candidateDirectoryStatus: "PRIVATE_STATUS",
        candidateDirectoryCacheHit: "true",
        candidateDirectoryBuildMs: -1,
        candidatePairCount: -1,
        ownerPairCount: 2.5,
        candidateReductionRatio: 1.1,
        actualIndexReadCount: -1,
        scopeRevisionChecks: Infinity,
        legacyScanFallbackCount: -1,
        legacyScanFallbackReason: pathSentinel,
        indexLookupMs: -1,
        sourceResolveAttemptCount: -1,
        thirdPersonIntentLevel: "PRIVATE_LEVEL",
        content: bodySentinel,
        counterpartName: nameSentinel,
        sourcePath: pathSentinel,
        apiKey: keySentinel
      }
    }, {});

    analytics.record({
      requestType: "chat", proposalId: "scoped-legacy-coverage", providerType: "zhipu", model: "fixture-model",
      pairMemoryMetrics: { candidateDirectoryStatus: "SCOPED_DEGRADED", legacyScanFallbackReason: "SCOPED_LEGACY_SOURCE",
        legacyScanFallbackCount: 0, trustedCoveredScopeCount: 295, uncertainScopedScopeCount: 5,
        uncertainSourceCount: 6, unscopedUnknownCount: 0, ownerValidationMs: 3.25, sourceResolveMs: 1.5,
        uncertainCounterpartIds: [bodySentinel], rawSummary: bodySentinel }
    }, {});
    analytics.record({
      requestType: "chat", proposalId: "invalid-legacy-coverage", providerType: "zhipu", model: "fixture-model",
      pairMemoryMetrics: { trustedCoveredScopeCount: -1, uncertainScopedScopeCount: 1.5,
        uncertainSourceCount: "1", unscopedUnknownCount: Infinity, ownerValidationMs: -1 }
    }, {});
    const persistedText = fs.readFileSync(analyticsFile, "utf8");
    const entries = JSON.parse(persistedText).entries;
    const entry = entries.find(candidate => candidate.proposalId === "valid-context-and-candidate-fields");
    const invalidEntry = entries.find(candidate => candidate.proposalId === "invalid-candidate-fields");
    assert(entry, "the valid UsageAnalytics fixture is persisted");
    assert(invalidEntry, "the invalid UsageAnalytics fixture is persisted for fail-closed projection checks");
    const scoped = entries.find(row => row.proposalId === "scoped-legacy-coverage").pairMemoryMetrics;
    for (const [field, value] of Object.entries({ candidateDirectoryStatus: "SCOPED_DEGRADED",
      legacyScanFallbackReason: "SCOPED_LEGACY_SOURCE", legacyScanFallbackCount: 0,
      trustedCoveredScopeCount: 295, uncertainScopedScopeCount: 5, uncertainSourceCount: 6,
      unscopedUnknownCount: 0, ownerValidationMs: 3.25, sourceResolveMs: 1.5 })) assert.equal(scoped[field], value);
    assert.equal(Object.hasOwn(scoped, "uncertainCounterpartIds"), false);
    assert.equal(Object.hasOwn(scoped, "rawSummary"), false);
    const invalidCoverage = entries.find(row => row.proposalId === "invalid-legacy-coverage").pairMemoryMetrics;
    for (const field of ["trustedCoveredScopeCount", "uncertainScopedScopeCount", "uncertainSourceCount",
      "unscopedUnknownCount", "ownerValidationMs"]) assert.equal(invalidCoverage[field], null);
    assert.equal(entry.contextMode, "custom");
    assert.equal(entry.contextWindowSource, "user_provided_unverified");
    assert.equal(entry.effectiveContextWindow, 90000);
    assert.deepEqual({
      candidateDirectoryStatus: entry.pairMemoryMetrics.candidateDirectoryStatus,
      candidateDirectoryCacheHit: entry.pairMemoryMetrics.candidateDirectoryCacheHit,
      candidateDirectoryBuildMs: entry.pairMemoryMetrics.candidateDirectoryBuildMs,
      candidatePairCount: entry.pairMemoryMetrics.candidatePairCount,
      ownerPairCount: entry.pairMemoryMetrics.ownerPairCount,
      candidateReductionRatio: entry.pairMemoryMetrics.candidateReductionRatio,
      actualIndexReadCount: entry.pairMemoryMetrics.actualIndexReadCount,
      scopeRevisionChecks: entry.pairMemoryMetrics.scopeRevisionChecks,
      legacyScanFallbackCount: entry.pairMemoryMetrics.legacyScanFallbackCount,
      legacyScanFallbackReason: entry.pairMemoryMetrics.legacyScanFallbackReason,
      indexLookupMs: entry.pairMemoryMetrics.indexLookupMs,
      sourceResolveAttemptCount: entry.pairMemoryMetrics.sourceResolveAttemptCount,
      memoryLevel: entry.pairMemoryMetrics.memoryLevel
    }, {
      candidateDirectoryStatus: "COMPLETE",
      candidateDirectoryCacheHit: true,
      candidateDirectoryBuildMs: 12.5,
      candidatePairCount: 5,
      ownerPairCount: 300,
      candidateReductionRatio: 0.9833,
      actualIndexReadCount: 5,
      scopeRevisionChecks: 10,
      legacyScanFallbackCount: 0,
      legacyScanFallbackReason: "NONE",
      indexLookupMs: 1.25,
      sourceResolveAttemptCount: 2,
      memoryLevel: "L2"
    }, "candidate diagnostics persist through the existing typed allowlist");
    const invalidMetrics = invalidEntry.pairMemoryMetrics;
    for (const field of ["candidateDirectoryStatus", "candidateDirectoryCacheHit", "candidateDirectoryBuildMs",
      "candidatePairCount", "ownerPairCount", "candidateReductionRatio", "actualIndexReadCount",
      "scopeRevisionChecks", "legacyScanFallbackCount", "legacyScanFallbackReason", "indexLookupMs",
      "sourceResolveAttemptCount", "memoryLevel", "thirdPersonIntentLevel"]) {
      assert.equal(invalidMetrics[field], null, `invalid candidate diagnostic ${field} must project to null`);
    }
    for (const field of ["configuredContextLength", "modelNativeContext", "outputReserveTokens", "usableInputBudget",
      "prompt", "systemPrompt", "messages", "sourcePath", "apiKey"]) {
      assert.equal(Object.hasOwn(entry, field), false, `${field} is outside the persisted diagnostics allowlist`);
    }
    for (const field of ["content", "counterpartName", "sourcePath", "apiKey"]) {
      assert.equal(Object.hasOwn(entry.pairMemoryMetrics, field), false, `${field} is outside the candidate diagnostics allowlist`);
    }
    for (const sentinel of [bodySentinel, nameSentinel, pathSentinel, keySentinel]) {
      assert.equal(persistedText.includes(sentinel), false, "persisted usage diagnostics contain no prompt, path, or credential data");
    }

    const invalidProjection = projectContextDiagnostics({
      contextMode: bodySentinel,
      contextWindowSource: pathSentinel,
      effectiveContextWindow: -1,
      apiKey: keySentinel
    });
    assert.deepEqual(invalidProjection, {
      contextMode: null,
      contextWindowSource: null,
      effectiveContextWindow: null
    }, "context diagnostics project only valid enum/count fields");
    assert.equal(JSON.stringify(invalidProjection).includes(keySentinel), false);
  } finally {
    fs.rmSync(tempDirectory, { recursive: true, force: true });
  }
}

async function verifyReadOnlyDiagnosticsIpc(diagnostics) {
  const handlers = new Map();
  let diagnosticReads = 0;
  let mutationCalls = 0;
  const llmManager = {
    getContextDiagnostics() {
      diagnosticReads++;
      return diagnostics;
    },
    setCustomContextLength() { mutationCalls++; },
    clearCustomContextLength() { mutationCalls++; }
  };
  registerIpcHandlers({
    electron: { ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) } },
    settingsRepository: {},
    llmManager,
    conversationManager: { onConversationUpdate() {} }
  });

  const handler = handlers.get("llm:getContextDiagnostics");
  assert.equal(typeof handler, "function", "the read-only diagnostics IPC is registered");
  assert.deepEqual(await handler({}), diagnostics);
  assert.equal(diagnosticReads, 1);
  assert.equal(mutationCalls, 0, "reading diagnostics does not mutate provider configuration");
  assert.match(ipcSource, /ipcMain\.handle\("llm:getContextDiagnostics",\s*\(\)\s*=>\s*llmManager\.getContextDiagnostics\(\)\)/);
  assert.match(preloadSource, /getContextDiagnostics:\s*\(\)\s*=>\s*electron\.ipcRenderer\.invoke\("llm:getContextDiagnostics"\)/,
    "preload exposes the read-only diagnostics IPC to the Renderer");
}

(async () => {
  const diagnostics = await verifyProviderDiagnostics();
  verifyUsageAnalyticsWhitelist();
  await verifyReadOnlyDiagnosticsIpc(diagnostics);
  console.log("V9.3.6.2 provider context budget, diagnostics privacy, memory cap, and read-only IPC regression checks passed");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
