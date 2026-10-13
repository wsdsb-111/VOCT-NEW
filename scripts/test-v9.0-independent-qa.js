"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const ipcPath = path.join(root, "resources", "app", "out", "main", "ipc", "register-ipc.js");
const preloadPath = path.join(root, "resources", "app", "out", "preload", "preload.js");
const observerPath = path.join(root, "resources", "app", "out", "renderer", "startup-performance-observer.js");
const mainPath = path.join(root, "resources", "app", "out", "main", "main.js");
const { registerIpcHandlers } = require(ipcPath);

function registerHandlers(performanceTrace, dialog = { showSaveDialog: async () => ({ canceled: true }) }) {
  const handlers = new Map();
  const runtime = {
    electron: {
      ipcMain: {
        handle(channel, handler) {
          assert.equal(handlers.has(channel), false, `duplicate IPC handler: ${channel}`);
          handlers.set(channel, handler);
        }
      },
      dialog
    },
    settingsRepository: { getAppSettings: () => ({}) },
    conversationManager: { onConversationUpdate() {} },
    performanceTrace
  };
  registerIpcHandlers(runtime);
  return handlers;
}

async function ipcHandlersBindOneTraceAndRejectRendererPayloadInjection() {
  const snapshots = [];
  const rendererCalls = [];
  let dialogCalls = 0;
  const trace = {
    enabled: true,
    snapshot() {
      const snapshot = { traceVersion: 1, events: [], aggregates: [] };
      snapshots.push(snapshot);
      return snapshot;
    },
    recordRendererMetrics(metrics) {
      rendererCalls.push(metrics);
      return metrics.length;
    },
    exportReport() {
      return { traceVersion: 1, events: [], aggregates: [] };
    }
  };
  const handlers = registerHandlers(trace, {
    async showSaveDialog(options, ...args) {
      dialogCalls += 1;
      assert.equal(args.length, 0, "renderer arguments must not be forwarded to the save dialog");
      assert.equal(JSON.stringify(options).includes("ATTACKER_PATH"), false);
      return { canceled: true };
    }
  });
  for (const channel of [
    "performance:get-state",
    "performance:snapshot",
    "performance:record-renderer",
    "performance:export-report"
  ]) {
    assert.equal(handlers.has(channel), true, `production IPC handler missing: ${channel}`);
  }

  assert.deepEqual(handlers.get("performance:get-state")(), { traceVersion: 1, enabled: true });
  assert.strictEqual(handlers.get("performance:snapshot")(), snapshots[0], "snapshot must use the runtime-bound trace instance");

  const validMetric = { step: "renderer.longTask", wallMs: 21, count: 1, result: "OK" };
  const attacks = [
    [{ ...validMetric, prompt: "PRIVATE_PROMPT_CANARY" }],
    [{ ...validMetric, filePath: "ATTACKER_PATH" }],
    [{ ...validMetric, apiKey: "PRIVATE_API_KEY_CANARY" }],
    [{ ...validMetric, context: { secret: "PRIVATE_SECRET_CANARY" } }],
    [{ ...validMetric, step: "provider.requestStart" }],
    [{ ...validMetric, result: "PRIVATE_PROVIDER_ERROR" }],
    [{ ...validMetric, wallMs: Number.POSITIVE_INFINITY }],
    [{ ...validMetric, wallMs: 60001 }],
    [{ ...validMetric, count: -1 }],
    [{ ...validMetric, count: 1000001 }],
    Array.from({ length: 33 }, () => validMetric)
  ];
  for (const attack of attacks) {
    assert.equal(handlers.get("performance:record-renderer")({}, attack), false, "invalid renderer metrics must be rejected as a whole");
  }
  assert.equal(rendererCalls.length, 0, "rejected payloads must never reach the trace collector");
  assert.equal(handlers.get("performance:record-renderer")({}, [validMetric]), 1);
  assert.deepEqual(rendererCalls, [[validMetric]]);

  const disabledTrace = { enabled: false, snapshot: () => ({ traceVersion: 1, events: [], aggregates: [] }) };
  let disabledDialogCalls = 0;
  const disabledHandlers = registerHandlers(disabledTrace, {
    async showSaveDialog() {
      disabledDialogCalls += 1;
      return { canceled: true };
    }
  });
  const exportResult = await disabledHandlers.get("performance:export-report")({}, { path: "ATTACKER_PATH" });
  assert.deepEqual(exportResult, { exported: false, reason: "DIAGNOSTICS_DISABLED" });
  assert.equal(disabledDialogCalls, 0, "disabled export must not open a dialog or perform file I/O");
  assert.equal(disabledHandlers.get("performance:record-renderer")({}, [validMetric]), false);

  const canceledExport = await handlers.get("performance:export-report")({}, { path: "ATTACKER_PATH" });
  assert.deepEqual(canceledExport, { exported: false, reason: "CANCELLED" });
  assert.equal(dialogCalls, 1, "export path must come from an explicit native dialog");
}

async function preloadExposesOnlyFixedPerformanceOperations() {
  const source = fs.readFileSync(preloadPath, "utf8");
  const exposed = Object.create(null);
  const calls = [];
  const electron = {
    contextBridge: {
      exposeInMainWorld(name, api) {
        exposed[name] = api;
      }
    },
    ipcRenderer: {
      invoke(channel, ...args) {
        calls.push([channel, ...args]);
        return Promise.resolve({ ok: true });
      },
      on() {},
      removeListener() {},
      send() {}
    }
  };
  vm.runInNewContext(source, {
    require(name) {
      assert.equal(name, "electron");
      return electron;
    }
  }, { filename: preloadPath });

  const api = exposed.performanceDiagnosticsAPI;
  assert.ok(api, "preload must expose the narrow performance diagnostics bridge");
  assert.deepEqual(Object.keys(api).sort(), ["exportReport", "getState", "recordRendererMetrics", "snapshot"]);
  assert.equal(api.exportReport.length, 0, "renderer must not supply an export destination");
  await api.getState();
  await api.snapshot();
  await api.recordRendererMetrics([{ step: "renderer.firstReady", wallMs: 1, count: 1, result: "OK" }]);
  await api.exportReport("ATTACKER_PATH");
  assert.deepEqual(calls.map(([channel]) => channel), [
    "performance:get-state",
    "performance:snapshot",
    "performance:record-renderer",
    "performance:export-report"
  ]);
  assert.equal(calls[3].length, 1, "export destination must not cross the preload bridge");
  assert.ok(exposed.electronAPI, "adding diagnostics must preserve the established Electron bridge");
}

async function rendererObserverIsDormantUntilOptedIn() {
  const source = fs.readFileSync(observerPath, "utf8");
  for (const getState of [
    () => Promise.resolve({ enabled: false }),
    () => Promise.reject(new Error("IPC unavailable"))
  ]) {
    const counters = { intervals: 0, rafs: 0, observers: 0, documentListeners: 0, windowListeners: 0, clockReads: 0 };
    const api = {
      getState,
      recordRendererMetrics: () => Promise.resolve(true)
    };
    const context = {
      window: { performanceDiagnosticsAPI: api, addEventListener() { counters.windowListeners += 1; } },
      document: { hidden: false, addEventListener() { counters.documentListeners += 1; } },
      performance: { now() { counters.clockReads += 1; return 1; } },
      PerformanceObserver: class {
        constructor() { counters.observers += 1; }
      },
      requestAnimationFrame() { counters.rafs += 1; return counters.rafs; },
      setInterval() { counters.intervals += 1; return counters.intervals; }
    };
    vm.runInNewContext(source, context, { filename: observerPath });
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(counters, { intervals: 0, rafs: 0, observers: 0, documentListeners: 0, windowListeners: 0, clockReads: 0 });
  }
}

async function diagnosticsDisabledPreservesConversationRecoveryFixture() {
  const { Conversation } = require(path.join(root, "resources", "app", "out", "main", "conversation", "conversation.js"));
  const calls = [];
  Conversation.configure({
    settingsRepository: { getCK3DebugLogPath: () => "independent-qa-fixture.log" },
    runFileManager: { isAvailable: () => true },
    parseLog: async () => ({
      characters: new Map(),
      loadCharactersSummaries() { calls.push("summary"); },
      syncOfficialRecollectionSummaries() {}
    }),
    performanceTrace: {
      enabled: false,
      startSpan() { calls.push("unexpected-span"); throw new Error("disabled diagnostics must not start spans"); }
    }
  });
  const conversation = Object.create(Conversation.prototype);
  Object.assign(conversation, {
    captureSummaryParticipantProfiles() {},
    initializePresence() {},
    captureDisclosureProfiles() { calls.push("disclosure"); },
    observeVisibleTraits() { calls.push("observation"); },
    prefetchFrozenWorldline: async () => {},
    recoverPendingMemories: async () => {},
    emitUpdate() { calls.push("ready"); },
    isActive: false
  });

  await conversation.initializeGameData();
  await Promise.all([conversation.worldlinePrefetchPromise, conversation.memoryRecoveryPromise]);
  assert.equal(conversation.isActive, true, "diagnostics must not add required participant-set state to legacy recovery fixtures");
  assert.deepEqual(calls, ["summary", "disclosure", "observation", "ready"]);

  calls.length = 0;
  let spanAttempts = 0;
  Conversation.configure({
    performanceTrace: {
      enabled: true,
      startSpan() { spanAttempts += 1; throw new Error("fixture trace failure"); }
    }
  });
  const traceFailureConversation = Object.create(Conversation.prototype);
  Object.assign(traceFailureConversation, {
    captureSummaryParticipantProfiles() {},
    initializePresence() {},
    captureDisclosureProfiles() { calls.push("disclosure"); },
    observeVisibleTraits() { calls.push("observation"); },
    prefetchFrozenWorldline: async () => {},
    recoverPendingMemories: async () => {},
    emitUpdate() { calls.push("ready"); },
    isActive: false
  });
  await traceFailureConversation.initializeGameData();
  await Promise.all([traceFailureConversation.worldlinePrefetchPromise, traceFailureConversation.memoryRecoveryPromise]);
  assert.ok(spanAttempts > 0, "the fixture must exercise failures from enabled trace instrumentation");
  assert.equal(traceFailureConversation.isActive, true, "trace exceptions must not prevent successful conversation initialization");
  assert.deepEqual(calls, ["summary", "disclosure", "observation", "ready"]);
}

async function rendererObserverUsesBoundedWhitelistedBatchesAndCleansUp() {
  const source = fs.readFileSync(observerPath, "utf8");
  const metricsBatches = [];
  const documentListeners = new Map();
  const windowListeners = new Map();
  const intervals = new Map();
  const buttons = [];
  const counters = { nextRaf: 0, nextInterval: 0, canceledRaf: [], clearedIntervals: [], disconnected: 0 };
  let observerCallback = null;
  let exportCalls = 0;
  const api = {
    getState: () => Promise.resolve({ enabled: true }),
    recordRendererMetrics(metrics) {
      metricsBatches.push(metrics);
      return Promise.resolve(true);
    },
    exportReport(...args) {
      exportCalls += 1;
      assert.equal(args.length, 0, "Renderer export must ask the main process to choose its destination");
      return Promise.resolve({ exported: false, reason: "CANCELLED" });
    }
  };
  const context = {
    window: {
      performanceDiagnosticsAPI: api,
      addEventListener(name, callback) { windowListeners.set(name, callback); }
    },
    document: {
      hidden: false,
      body: { appendChild(button) { buttons.push(button); } },
      createElement(tag) {
        assert.equal(tag, "button");
        const listeners = new Map();
        const button = {
          style: {},
          addEventListener(name, callback) { listeners.set(name, callback); },
          remove() { button.removed = true; },
          listeners
        };
        return button;
      },
      addEventListener(name, callback) { documentListeners.set(name, callback); },
      removeEventListener(name, callback) {
        if (documentListeners.get(name) === callback) documentListeners.delete(name);
      }
    },
    performance: { now: () => 10 },
    PerformanceObserver: class {
      constructor(callback) { observerCallback = callback; }
      observe(options) { assert.equal(JSON.stringify(options), JSON.stringify({ type: "longtask", buffered: false })); }
      disconnect() { counters.disconnected += 1; }
    },
    requestAnimationFrame(callback) {
      const id = ++counters.nextRaf;
      return id;
    },
    cancelAnimationFrame(id) { counters.canceledRaf.push(id); },
    setInterval(callback, ms) {
      assert.equal(ms, 1000);
      const id = ++counters.nextInterval;
      intervals.set(id, callback);
      return id;
    },
    clearInterval(id) { counters.clearedIntervals.push(id); }
  };
  vm.runInNewContext(source, context, { filename: observerPath });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(typeof observerCallback, "function");
  let entriesRead = 0;
  const entries = {
    [Symbol.iterator]() {
      return {
        next() {
          entriesRead += 1;
          return entriesRead <= 80 ? { value: { duration: 8 }, done: false } : { done: true };
        }
      };
    }
  };
  observerCallback({ getEntries: () => entries });
  assert.ok(entriesRead <= 32, "long-task processing must stop when its bounded queue is full");
  assert.equal(documentListeners.has("pointerdown"), true);
  assert.equal(documentListeners.has("keydown"), true);
  assert.equal(buttons.length, 1, "explicit opt-in must show the export control");
  assert.equal(buttons[0].textContent, "导出性能诊断");
  await buttons[0].listeners.get("click")();
  assert.equal(exportCalls, 1);
  assert.equal(buttons[0].textContent, "导出性能诊断", "canceling export must keep the control usable");
  const flush = intervals.get(1);
  assert.equal(typeof flush, "function");
  flush();
  assert.equal(metricsBatches.length, 1);
  assert.equal(metricsBatches[0].length, 32, "renderer queue must cap each exported batch at 32 metrics");
  assert.equal(JSON.stringify(metricsBatches[0][0]), JSON.stringify({ step: "renderer.firstReady", wallMs: 10, count: 1, result: "OK" }));
  assert.ok(metricsBatches[0].every((metric) => Object.keys(metric).sort().join(",") === "count,result,step,wallMs"));
  assert.ok(metricsBatches[0].every((metric) => metric.step === "renderer.firstReady" || metric.step === "renderer.longTask"));

  const pagehide = windowListeners.get("pagehide");
  assert.equal(typeof pagehide, "function");
  pagehide();
  assert.deepEqual(counters.clearedIntervals, [1]);
  assert.deepEqual(counters.canceledRaf, [1]);
  assert.equal(counters.disconnected, 1);
  assert.equal(documentListeners.size, 0);
  assert.equal(buttons[0].removed, true, "the export control must be removed when the Renderer closes");
}

async function productionMainWiresTheSameTraceIntoIpc() {
  const source = fs.readFileSync(mainPath, "utf8");
  assert.ok(source.includes("startup-performance-trace"), "main process must load the V9 trace module");
  assert.ok(source.includes("createStartupPerformanceTrace("), "main process must construct the trace instance");
  assert.equal((source.match(/createStartupPerformanceTrace\(/g) || []).length, 1, "Main must construct one process-local trace instance");
  for (const [call, label] of [
    ["new LLMManager({", "Provider service"],
    ["Conversation.configure({", "Conversation instrumentation"],
    ["registerIpcHandlers({", "diagnostics IPC"]
  ]) {
    const callStart = source.indexOf(call);
    assert.notEqual(callStart, -1, `${label} must be initialized in Main`);
    const tail = source.slice(callStart);
    const callEnd = /\r?\n\s*\}\);/.exec(tail);
    assert.ok(callEnd, `${label} initialization must close normally`);
    assert.ok(tail.slice(0, callEnd.index).includes("performanceTrace"), `${label} must receive the same trace instance`);
  }
  const registrationStart = source.indexOf("registerIpcHandlers(");
  assert.notEqual(registrationStart, -1, "main process must register production IPC handlers");
  const registrationWindow = source.slice(registrationStart, registrationStart + 10000);
  assert.ok(registrationWindow.includes("performanceTrace"), "the production trace instance must be passed to the IPC runtime");
}

function compatibilitySeparationRemainsIndependentAndLetterBridgeIsRetained() {
  const manifest = require(path.join(root, "scripts", "test-manifest.js"));
  const retiredGroups = new Set([
    "three-mod-character-name-compatibility",
    "v8.15.2-celestial-office-release",
    "v8.15.2-celestial-office-independent-qa"
  ]);
  const retiredScripts = new Set([
    "test-three-mod-character-name-compatibility.js",
    "test-v8.15.2-celestial-office-release.js",
    "test-v8.15.2-celestial-office-independent-qa.js"
  ]);
  for (const item of [...manifest.actionChecks, ...manifest.followupChecks, ...manifest.archivedChecks, ...manifest.releaseChecks]) {
    const group = typeof item === "string" ? "" : item.group;
    const script = typeof item === "string" ? item : item.script;
    assert.equal(retiredGroups.has(group), false, `retired compatibility release group remains: ${group}`);
    assert.equal(retiredScripts.has(script), false, `retired compatibility test remains in the VOTC manifest: ${script}`);
  }

  const frozenAssets = JSON.parse(fs.readFileSync(path.join(root, "docs", "current", "v9", "v8-frozen-assets.json"), "utf8"));
  const retiredAssets = frozenAssets.trackedAssets.filter(({ path: assetPath }) =>
    assetPath.startsWith("compatibility-mods/VOTC_Three_Mod_Character_Name_Compatibility/")
      || assetPath === "compatibility-mods/VOTC_Three_Mod_Character_Name_Compatibility.mod"
      || assetPath.startsWith("compatibility-patches/tianjia-benji-repair/")
      || retiredScripts.has(path.posix.basename(assetPath))
  );
  assert.equal(retiredAssets.length, 19, "the frozen V8 asset ledger must retain evidence for the 13 Mod, 3 patch and 3 test files");
  for (const asset of retiredAssets) {
    assert.equal(fs.existsSync(path.join(root, asset.path)), false, `retired compatibility source remains in the VOTC checkout: ${asset.path}`);
  }
  function visit(directory) {
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const absolute = path.join(directory, entry.name);
      return entry.isDirectory() ? visit(absolute) : [absolute];
    });
  }
  for (const relativePath of [
    "compatibility-mods/VOTC_Three_Mod_Character_Name_Compatibility",
    "compatibility-patches/tianjia-benji-repair"
  ]) {
    const directory = path.join(root, relativePath);
    if (fs.existsSync(directory)) assert.equal(visit(directory).length, 0, `retired compatibility directory must contain no source files: ${relativePath}`);
  }
  for (const directory of [path.join(root, "resources", "app", "out", "main"), path.join(root, ".github")]) {
    for (const file of visit(directory).filter((candidate) => /\.(?:js|ya?ml)$/i.test(candidate))) {
      const source = fs.readFileSync(file, "utf8");
      assert.doesNotMatch(source, /compatibility-mods|tianjia-benji-repair/i, `${path.relative(root, file)} must not require the retired compatibility sources`);
    }
  }

  const bridgeFiles = [
    "compatibility-patches/v8.15.2-letter-runner/README.md",
    "compatibility-patches/v8.15.2-letter-runner/common/on_action/votc_load_boundary.txt",
    "compatibility-patches/v8.15.2-letter-runner/gui/custom_gui/letters_runner.gui",
    "compatibility-patches/v8.15.2-letter-runner/gui/scripted_widgets/votc_runtime_bridge.txt",
    "compatibility-patches/v8.15.2-letter-runner/gui/custom_gui/votc_runtime_bridge.gui",
    "compatibility-patches/v8.15.2-letter-runner/common/scripted_guis/votc_runtime_clock.txt",
    "compatibility-patches/v8.15.2-letter-runner/gui/event_window_widgets/event_window_widget_message_clear.gui",
    "compatibility-patches/v8.15.2-letter-runner/gui/event_windows/votc_invisible_event.gui"
  ];
  for (const relativePath of bridgeFiles) {
    assert.equal(fs.statSync(path.join(root, relativePath)).isFile(), true, `VOTC's native letter runner bridge file must remain: ${relativePath}`);
  }
}

function processLocalDurationsNeverCrossSubtract() {
  const { createStartupPerformanceTrace } = require(path.join(root, "resources", "app", "out", "main", "runtime", "startup-performance-trace.js"));
  const clocks = [100, 90];
  const regressingClock = createStartupPerformanceTrace({ enabled: true, now: () => clocks.shift() });
  const finish = regressingClock.startSpan("conversation.open", { attribution: "MAIN" });
  assert.equal(finish({ result: "OK" }), false, "a regressing process-local monotonic clock must not emit a negative duration");
  assert.deepEqual(regressingClock.snapshot().events, []);

  const mainTrace = createStartupPerformanceTrace({ enabled: true, now: () => 1000000 });
  assert.equal(mainTrace.recordRendererMetrics({ step: "renderer.longTask", wallMs: 17, count: 1, result: "OK" }), 1);
  assert.equal(mainTrace.snapshot().events[0].wallMs, 17, "Renderer duration must be retained as a local duration, not subtracted from Main's clock origin");
}

async function traceContextNeverEntersProviderOrCacheMetadata() {
  const { LLMManager, ProviderRegistry, TokenCounter } = require(path.join(root, "resources", "app", "out", "main", "provider-service.js"));
  const { createStartupPerformanceTrace } = require(path.join(root, "resources", "app", "out", "main", "runtime", "startup-performance-trace.js"));
  const trace = createStartupPerformanceTrace({ enabled: true });
  const rawConversationId = "provider-private-conversation-id";
  const context = trace.forConversation(rawConversationId).nextTurn();
  let providerRequest;
  let providerUsageMetadata;
  let cacheMetadata;
  const provider = {
    async chatCompletion(request) {
      providerRequest = request;
      return { content: "fixture response", usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 } };
    }
  };
  const config = {
    providerType: "fixture",
    customName: "Fixture",
    defaultModel: "fixture-model",
    defaultParameters: { temperature: 0.2 },
    apiKey: "PROVIDER_API_KEY_CANARY"
  };
  const settingsRepository = {
    getActiveProviderConfig: () => config,
    getGlobalStreamSetting: () => false,
    getChatPromptV89Settings: () => ({ chatPromptV89OutboundDiagnostics: true })
  };
  const providerRegistry = new ProviderRegistry();
  providerRegistry.register("fixture", class { chatCompletion(...args) { return provider.chatCompletion(...args); } });
  const manager = new LLMManager({
    settingsRepository,
    providerRegistry,
    usageAnalytics: { record(metadata) { providerUsageMetadata = metadata; } },
    providerDiagnostics: {
      prepareOutboundRequest(metadata) {
        cacheMetadata = metadata;
        return { comparisonStatus: "cold_local_baseline" };
      },
      recordResponse() {}
    },
    performanceTrace: trace,
    TokenCounter,
    PromptBuilder: {}
  });
  manager.getProviderCapabilities = async () => ({ maxOutputTokens: 512, contextWindow: 32768 });

  await manager.sendChatRequest(
    [{ role: "user", content: "provider fixture" }],
    undefined,
    true,
    { requestType: "chat", conversationId: rawConversationId, performanceTraceContext: context }
  );

  assert.ok(providerRequest);
  assert.equal(Object.hasOwn(providerRequest, "performanceTraceContext"), false);
  assert.equal(JSON.stringify(providerRequest).includes(rawConversationId), false);
  assert.equal(JSON.stringify(providerRequest).includes("PROVIDER_API_KEY_CANARY"), false);
  assert.equal(Object.hasOwn(providerUsageMetadata, "performanceTraceContext"), false);
  assert.equal(Object.hasOwn(cacheMetadata, "performanceTraceContext"), false);
  const exported = JSON.stringify(trace.exportReport());
  assert.equal(exported.includes(rawConversationId), false);
  assert.equal(exported.includes("PROVIDER_API_KEY_CANARY"), false);
  assert.ok(trace.snapshot().events.some((event) => event.step === "provider.firstVisibleToken"));
}

async function providerStreamCancellationAndErrorsStayBusinessVisibleButTraceSafe() {
  const { LLMManager, ProviderRegistry, TokenCounter } = require(path.join(root, "resources", "app", "out", "main", "provider-service.js"));
  const { createStartupPerformanceTrace } = require(path.join(root, "resources", "app", "out", "main", "runtime", "startup-performance-trace.js"));
  const trace = createStartupPerformanceTrace({ enabled: true });
  const manager = new LLMManager({
    settingsRepository: {},
    providerRegistry: new ProviderRegistry(),
    usageAnalytics: { record() {} },
    performanceTrace: trace,
    TokenCounter,
    PromptBuilder: {}
  });
  const metadata = { providerType: "fixture", model: "fixture-model", requestType: "chat" };

  const canceledSpan = trace.startSpan("provider.requestStart", { attribution: "PROVIDER" });
  const canceledStream = await manager.trackUsage((async function* () {
    yield { delta: { content: "PRIVATE_DIALOGUE_CANARY" } };
  })(), metadata, canceledSpan);
  const canceledIterator = canceledStream[Symbol.asyncIterator]();
  await canceledIterator.next();
  await canceledIterator.return();

  const privateProviderError = "PRIVATE_PROVIDER_ERROR_CANARY";
  const failedSpan = trace.startSpan("provider.requestStart", { attribution: "PROVIDER" });
  const failedStream = await manager.trackUsage((async function* () {
    throw new Error(privateProviderError);
  })(), metadata, failedSpan);
  await assert.rejects(failedStream[Symbol.asyncIterator]().next(), error => {
    assert.equal(error.providerError.category, "UNKNOWN");
    assert.equal(error.message.includes(privateProviderError), false);
    return true;
  });

  const report = trace.exportReport();
  const endings = report.events.filter((event) => event.step === "provider.streamEnd");
  assert.deepEqual(endings.map((event) => event.result), ["CANCELLED", "ERROR"]);
  assert.equal(endings[1].errorCode, "provider_error", "provider errors must be mapped to a fixed diagnostic code");
  const serialized = JSON.stringify(report);
  assert.equal(serialized.includes("PRIVATE_DIALOGUE_CANARY"), false);
  assert.equal(serialized.includes(privateProviderError), false);
}

(async () => {
  await ipcHandlersBindOneTraceAndRejectRendererPayloadInjection();
  await preloadExposesOnlyFixedPerformanceOperations();
  await rendererObserverIsDormantUntilOptedIn();
  await diagnosticsDisabledPreservesConversationRecoveryFixture();
  await rendererObserverUsesBoundedWhitelistedBatchesAndCleansUp();
  processLocalDurationsNeverCrossSubtract();
  await traceContextNeverEntersProviderOrCacheMetadata();
  await providerStreamCancellationAndErrorsStayBusinessVisibleButTraceSafe();
  await productionMainWiresTheSameTraceIntoIpc();
  compatibilitySeparationRemainsIndependentAndLetterBridgeIsRetained();
  console.log("V9.0 independent diagnostics QA passed (IPC boundary, preload bridge, Renderer observer, production binding)");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
