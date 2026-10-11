"use strict";

const assert = require("node:assert/strict");
const { createStartupPerformanceTrace } = require("../resources/app/out/main/runtime/startup-performance-trace");

function disabledTraceDoesNoWork() {
  let clockCalls = 0;
  let timerCalls = 0;
  const originalSetTimeout = global.setTimeout;
  const originalSetInterval = global.setInterval;
  global.setTimeout = (...args) => { timerCalls += 1; return originalSetTimeout(...args); };
  global.setInterval = (...args) => { timerCalls += 1; return originalSetInterval(...args); };
  try {
    const trace = createStartupPerformanceTrace({ enabled: false, now: () => { clockCalls += 1; return clockCalls; } });
    const conversation = trace.forConversation("private-conversation-id");
    const span = trace.startSpan("conversation.turn", { context: conversation.nextTurn() });
    span.mark("provider.firstVisibleToken");
    span({ result: "OK" });
    trace.record("background.clipboard.poll", { wallMs: 9, result: "OK" });
    trace.recordRendererMetrics([{ step: "renderer.firstReady", wallMs: 5, result: "OK" }]);

    assert.equal(trace.enabled, false);
    assert.equal(clockCalls, 0, "disabled diagnostics must not read the clock");
    assert.equal(timerCalls, 0, "disabled diagnostics must not add timer work");
    assert.deepEqual(trace.snapshot().events, []);
    assert.deepEqual(trace.snapshot().aggregates, []);
  } finally {
    global.setTimeout = originalSetTimeout;
    global.setInterval = originalSetInterval;
  }
}

function spansCorrelateNpcTurnsAndSurviveConcurrency() {
  let now = 0;
  const trace = createStartupPerformanceTrace({ enabled: true, now: () => now, maxEvents: 20, maxSamplesPerStep: 10 });
  const conversation = trace.forConversation("conversation-raw-id");
  const firstTurn = conversation.nextTurn();
  const secondTurn = conversation.nextTurn();

  assert.notEqual(firstTurn.conversationIdHash, "conversation-raw-id");
  assert.match(firstTurn.conversationIdHash, /^[a-f0-9]{24}$/);
  assert.equal(firstTurn.turnOrdinal, 1);
  assert.equal(secondTurn.turnOrdinal, 2);

  const firstNpcSpan = trace.startSpan("memory.recall", { attribution: "MAIN", context: firstTurn });
  now = 3;
  const secondNpcSpan = trace.startSpan("prompt.build", { attribution: "MAIN", context: secondTurn });
  now = 8;
  firstNpcSpan({ result: "OK", count: 4 });
  now = 13;
  secondNpcSpan({ result: "OK", count: 9 });

  const events = trace.snapshot().events;
  assert.equal(events.length, 2);
  assert.deepEqual(events.map((event) => event.turnOrdinal), [1, 2]);
  assert.deepEqual(events.map((event) => event.wallMs), [8, 10]);
  assert.ok(events.every((event) => event.conversationIdHash === firstTurn.conversationIdHash));
  assert.equal(JSON.stringify(trace.snapshot()).includes("conversation-raw-id"), false);
}

function tracesAreBoundedAndSampled() {
  const trace = createStartupPerformanceTrace({ enabled: true, maxEvents: 2, maxSamplesPerStep: 2 });
  for (const wallMs of [10, 20, 30]) {
    trace.record("provider.firstVisibleToken", { attribution: "PROVIDER", wallMs, result: "OK" });
  }
  trace.record("background.dateScanCold", { attribution: "CK3_LOG", wallMs: 40, result: "OK", bytesRead: 1000, mode: "COLD_RECOVERY" });

  const report = trace.exportReport();
  assert.equal(report.events.length, 2);
  assert.equal(report.droppedCount, 2, "the event ring reports discarded records");
  const providerStats = report.aggregates.find((item) => item.step === "provider.firstVisibleToken");
  assert.ok(providerStats);
  assert.equal(providerStats.countTotal, 3);
  assert.equal(providerStats.sampleCount, 2);
  assert.equal(providerStats.droppedCount, 1, "the stage histogram reports samples outside its bounded window");
  assert.equal(providerStats.sampledWindow, true);
  assert.equal(providerStats.p50Ms, 20);
  assert.equal(providerStats.p95Ms, 30);
  assert.equal(report.aggregates.find((item) => item.attribution === "CK3_LOG").bytesRead, 1000);
}

function unknownFieldsAndStagesAreNeverExported() {
  const trace = createStartupPerformanceTrace({ enabled: true });
  const context = trace.forConversation("another-private-id").nextTurn();
  trace.record("prompt.build", {
    attribution: "MAIN",
    context,
    wallMs: 4,
    result: "ERROR",
    errorCode: "raw provider response with secret",
    prompt: "private prompt text",
    filePath: "C:\\private\\debug.log",
    apiKey: "private-api-key"
  });
  trace.record("unregistered.secret.stage", { wallMs: 1, result: "OK", secret: "private" });

  const serialized = JSON.stringify(trace.exportReport());
  for (const forbidden of ["another-private-id", "raw provider response", "private prompt text", "C:\\private\\debug.log", "private-api-key", "unregistered.secret.stage"]) {
    assert.equal(serialized.includes(forbidden), false, `diagnostic output must omit ${forbidden}`);
  }
  const event = trace.snapshot().events[0];
  assert.equal(event.errorCode, "unknown_error");
  assert.equal(event.prompt, undefined);
  assert.equal(event.filePath, undefined);
  assert.equal(event.apiKey, undefined);
}

function rendererInputIsStrictlyWhitelisted() {
  const trace = createStartupPerformanceTrace({ enabled: true });
  const accepted = trace.recordRendererMetrics([
    { step: "renderer.longTask", wallMs: 250, count: 1, result: "OK", text: "ignored" },
    { step: "renderer.firstReady", wallMs: 25, count: 1, result: "OK" },
    { step: "renderer.inputToFrame", wallMs: 60001, count: 1, result: "OK" },
    { step: "provider.firstVisibleToken", wallMs: 20, count: 1, result: "OK" }
  ]);
  assert.equal(accepted, 2);
  const events = trace.snapshot().events;
  assert.deepEqual(events.map((event) => event.step), ["renderer.longTask", "renderer.firstReady"]);
  assert.ok(events.every((event) => event.attribution === "RENDERER"));
  assert.equal(JSON.stringify(events).includes("ignored"), false);
}

function traceFailuresDoNotEscapeIntoBusinessCode() {
  const trace = createStartupPerformanceTrace({ enabled: true, now: () => { throw new Error("diagnostics failed"); } });
  assert.doesNotThrow(() => {
    const span = trace.startSpan("conversation.turn", { attribution: "MAIN" });
    span.mark("provider.firstVisibleToken");
    span({ result: "ERROR", errorCode: "provider_error" });
    trace.record("background.runCommand.ackWatchdog", { wallMs: 1, result: "OK" });
  });
}

function diagnosticSwitchDefaultsOffAndAcceptsExplicitOptIn() {
  const originalDiagnostics = process.env.VOTC_DIAGNOSTICS;
  const originalArgs = [...process.argv];
  try {
    delete process.env.VOTC_DIAGNOSTICS;
    process.argv = originalArgs.filter((argument) => argument !== "--diagnostics");
    assert.equal(createStartupPerformanceTrace().enabled, false);
    process.env.VOTC_DIAGNOSTICS = "1";
    assert.equal(createStartupPerformanceTrace().enabled, true);
    delete process.env.VOTC_DIAGNOSTICS;
    process.argv.push("--diagnostics");
    assert.equal(createStartupPerformanceTrace().enabled, true);
  } finally {
    if (originalDiagnostics === undefined) delete process.env.VOTC_DIAGNOSTICS;
    else process.env.VOTC_DIAGNOSTICS = originalDiagnostics;
    process.argv = originalArgs;
  }
}

for (const test of [
  disabledTraceDoesNoWork,
  spansCorrelateNpcTurnsAndSurviveConcurrency,
  tracesAreBoundedAndSampled,
  unknownFieldsAndStagesAreNeverExported,
  rendererInputIsStrictlyWhitelisted,
  traceFailuresDoNotEscapeIntoBusinessCode,
  diagnosticSwitchDefaultsOffAndAcceptsExplicitOptIn
]) {
  test();
}

console.log("V9.0 performance trace tests passed.");
