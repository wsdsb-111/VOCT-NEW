"use strict";

const crypto = require("crypto");
const { performance } = require("node:perf_hooks");

const TRACE_VERSION = 1;
const DEFAULT_MAX_EVENTS = 2048;
const DEFAULT_MAX_SAMPLES_PER_STEP = 256;
const DEFAULT_MAX_CONVERSATION_CONTEXTS = 128;
const MAX_RENDERER_METRICS_PER_CALL = 32;
const MAX_WALL_MS = 24 * 60 * 60 * 1000;

const STEPS = new Set([
  "app.launch",
  "settings.load",
  "prompt.seed",
  "runqueue.recovery",
  "worldline.start",
  "letterReader.start",
  "pendingReceipt.recovery",
  "renderer.firstReady",
  "ck3.gameLoad",
  "bridge.date",
  "runfile.consumer",
  "conversation.open",
  "gameData.logParse",
  "summary.load",
  "knowledge.disclosureSnapshot",
  "knowledge.directObservation",
  "officialRecollection.sync",
  "worldline.frozenPrefetch",
  "memoryRecovery.pending",
  "conversation.turn",
  "memory.recall",
  "worldline.turnQuery",
  "prompt.build",
  "tokenEstimate",
  "serialization",
  "provider.requestStart",
  "provider.firstByte",
  "provider.firstVisibleToken",
  "provider.streamEnd",
  "renderer.longTask",
  "renderer.frameGap",
  "renderer.inputToFrame",
  "postTurn.work",
  "background.clipboard.poll",
  "background.letter.logReader",
  "background.dateScanCold",
  "background.dateScanIncremental",
  "background.runCommand.ackWatchdog"
]);

const RENDERER_STEPS = new Set([
  "renderer.longTask",
  "renderer.frameGap",
  "renderer.inputToFrame",
  "renderer.firstReady"
]);
const RESULTS = new Set(["OK", "ERROR", "CANCELLED", "STALE", "SKIPPED"]);
const ATTRIBUTIONS = new Set(["MAIN", "RENDERER", "CK3_LOG", "PROVIDER", "UNKNOWN"]);
const SESSION_PHASES = new Set(["APP_START", "CK3_LOAD", "CONVERSATION_OPEN", "TURN", "IDLE"]);
const DATE_SCAN_MODES = new Set(["COLD_RECOVERY", "INCREMENTAL", "INVALIDATED"]);
const ERROR_CODES = new Set([
  "unknown_error",
  "cancelled",
  "stale",
  "scan_invalidated",
  "log_file_missing",
  "stat_failed",
  "open_failed",
  "read_failed",
  "provider_error",
  "request_error",
  "timeout",
  "initialization_error"
]);

function isDiagnosticsRequested() {
  try {
    return process.env.VOTC_DIAGNOSTICS === "1" || process.argv.includes("--diagnostics");
  } catch (_error) {
    return false;
  }
}

function boundedInteger(value, fallback, minimum, maximum) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= minimum && number <= maximum ? number : fallback;
}

function safeNow(now) {
  try {
    const value = Number(now());
    return Number.isFinite(value) && value >= 0 ? value : null;
  } catch (_error) {
    return null;
  }
}

function safeUnixNow() {
  try {
    const value = Date.now();
    return Number.isSafeInteger(value) && value >= 0 ? value : null;
  } catch (_error) {
    return null;
  }
}

function normalizeResult(value) {
  return RESULTS.has(value) ? value : "OK";
}

function normalizeAttribution(value) {
  return ATTRIBUTIONS.has(value) ? value : "UNKNOWN";
}

function normalizeContext(value) {
  try {
    if (!value || typeof value !== "object") return {};
    const normalized = {};
    if (typeof value.conversationIdHash === "string" && /^[a-f0-9]{24}$/.test(value.conversationIdHash)) {
      normalized.conversationIdHash = value.conversationIdHash;
    }
    if (Number.isSafeInteger(value.turnOrdinal) && value.turnOrdinal > 0) normalized.turnOrdinal = value.turnOrdinal;
    return normalized;
  } catch (_error) {
    return {};
  }
}

function phaseForStep(step, requestedPhase) {
  if (SESSION_PHASES.has(requestedPhase)) return requestedPhase;
  if (step === "app.launch" || step === "settings.load" || step === "prompt.seed" || step === "runqueue.recovery" || step === "worldline.start" || step === "letterReader.start" || step === "pendingReceipt.recovery" || step === "renderer.firstReady") return "APP_START";
  if (step === "ck3.gameLoad" || step === "bridge.date" || step === "runfile.consumer" || step.startsWith("background.")) return "CK3_LOAD";
  if (step === "conversation.open" || step === "gameData.logParse" || step === "summary.load" || step === "knowledge.disclosureSnapshot" || step === "knowledge.directObservation" || step === "officialRecollection.sync" || step === "worldline.frozenPrefetch" || step === "memoryRecovery.pending") return "CONVERSATION_OPEN";
  if (step === "conversation.turn" || step === "memory.recall" || step === "worldline.turnQuery" || step === "prompt.build" || step === "tokenEstimate" || step === "serialization" || step.startsWith("provider.") || step.startsWith("renderer.") || step === "postTurn.work") return "TURN";
  return "IDLE";
}

function percentile(samples, quantile) {
  if (!samples.length) return null;
  const sorted = [...samples].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil(quantile * sorted.length) - 1);
  return sorted[index];
}

function createDisabledTrace() {
  const inactiveFinish = () => {};
  inactiveFinish.mark = () => {};
  return {
    enabled: false,
    startupId: null,
    startSpan: () => inactiveFinish,
    record: () => false,
    forConversation: () => ({ nextTurn: () => null }),
    recordRendererMetrics: () => 0,
    snapshot: () => ({ traceVersion: TRACE_VERSION, enabled: false, startupId: null, generatedAtMs: null, sampledWindow: true, droppedCount: 0, events: [], aggregates: [] }),
    exportReport: () => ({ traceVersion: TRACE_VERSION, enabled: false, startupId: null, generatedAtMs: null, sampledWindow: true, droppedCount: 0, events: [], aggregates: [] })
  };
}

function createStartupPerformanceTrace(options = {}) {
  const enabled = typeof options.enabled === "boolean" ? options.enabled : isDiagnosticsRequested();
  if (!enabled) return createDisabledTrace();

  const maxEvents = boundedInteger(options.maxEvents, DEFAULT_MAX_EVENTS, 1, 10000);
  const maxSamplesPerStep = boundedInteger(options.maxSamplesPerStep, DEFAULT_MAX_SAMPLES_PER_STEP, 1, 1024);
  const maxConversationContexts = boundedInteger(options.maxConversationContexts, DEFAULT_MAX_CONVERSATION_CONTEXTS, 1, 1024);
  const now = typeof options.now === "function" ? options.now : () => performance.now();
  let startupId;
  let hmacKey;
  try {
    startupId = crypto.randomBytes(12).toString("hex");
    hmacKey = crypto.randomBytes(32);
  } catch (_error) {
    return createDisabledTrace();
  }

  const eventRing = new Array(maxEvents);
  const aggregates = new Map();
  const conversationContexts = new Map();
  let ringStart = 0;
  let ringCount = 0;
  let droppedCount = 0;

  const appendEvent = (step, fields = {}) => {
    try {
      if (!STEPS.has(step)) return false;
      const wallMs = Number(fields.wallMs);
      if (!Number.isFinite(wallMs) || wallMs < 0 || wallMs > MAX_WALL_MS) return false;
      const result = normalizeResult(fields.result);
      const attribution = normalizeAttribution(fields.attribution);
      const event = {
        traceVersion: TRACE_VERSION,
        startupId,
        atUnixMs: safeUnixNow(),
        sessionPhase: phaseForStep(step, fields.sessionPhase),
        step,
        wallMs,
        result,
        attribution
      };
      const context = normalizeContext(fields.context);
      if (context.conversationIdHash) event.conversationIdHash = context.conversationIdHash;
      if (context.turnOrdinal) event.turnOrdinal = context.turnOrdinal;
      if (Number.isSafeInteger(fields.count) && fields.count >= 0) event.count = fields.count;
      if (Number.isSafeInteger(fields.bytesRead) && fields.bytesRead >= 0) event.bytesRead = fields.bytesRead;
      if (Number.isFinite(fields.cpuMs) && fields.cpuMs >= 0 && fields.cpuMs <= MAX_WALL_MS) event.cpuMs = fields.cpuMs;
      if (Number.isFinite(fields.eventLoopDelayMaxMs) && fields.eventLoopDelayMaxMs >= 0 && fields.eventLoopDelayMaxMs <= MAX_WALL_MS) event.eventLoopDelayMaxMs = fields.eventLoopDelayMaxMs;
      if (Number.isFinite(fields.maxBlockMs) && fields.maxBlockMs >= 0 && fields.maxBlockMs <= MAX_WALL_MS) event.maxBlockMs = fields.maxBlockMs;
      if (DATE_SCAN_MODES.has(fields.mode)) event.mode = fields.mode;
      if (result === "ERROR") event.errorCode = ERROR_CODES.has(fields.errorCode) ? fields.errorCode : "unknown_error";

      const aggregateKey = `${step}\u0000${attribution}`;
      let aggregate = aggregates.get(aggregateKey);
      if (!aggregate) {
        aggregate = { step, attribution, countTotal: 0, errorCount: 0, droppedCount: 0, samples: [], bytesRead: 0 };
        aggregates.set(aggregateKey, aggregate);
      }
      aggregate.countTotal += 1;
      if (result === "ERROR") aggregate.errorCount += 1;
      if (event.bytesRead) aggregate.bytesRead += event.bytesRead;
      if (aggregate.samples.length >= maxSamplesPerStep) {
        aggregate.samples.shift();
        aggregate.droppedCount += 1;
      }
      aggregate.samples.push(wallMs);

      if (ringCount < maxEvents) {
        eventRing[(ringStart + ringCount) % maxEvents] = event;
        ringCount += 1;
      } else {
        eventRing[ringStart] = event;
        ringStart = (ringStart + 1) % maxEvents;
        droppedCount += 1;
      }
      return true;
    } catch (_error) {
      return false;
    }
  };

  const record = (step, fields = {}) => appendEvent(step, fields);

  const startSpan = (step, fields = {}) => {
    let startedAt = null;
    let closed = false;
    const baseFields = { ...fields };
    try {
      if (STEPS.has(step)) startedAt = safeNow(now);
    } catch (_error) {}
    const finish = (finishFields = {}) => {
      if (closed) return false;
      closed = true;
      const endedAt = safeNow(now);
      if (startedAt === null || endedAt === null || endedAt < startedAt) return false;
      const finishStep = STEPS.has(finishFields.step) ? finishFields.step : step;
      const { step: _ignoredStep, ...safeFinishFields } = finishFields;
      return appendEvent(finishStep, { ...baseFields, ...safeFinishFields, wallMs: endedAt - startedAt });
    };
    finish.mark = (markStep, markFields = {}) => {
      if (closed || !STEPS.has(markStep) || startedAt === null) return false;
      const markedAt = safeNow(now);
      if (markedAt === null || markedAt < startedAt) return false;
      return appendEvent(markStep, { ...baseFields, ...markFields, wallMs: markedAt - startedAt });
    };
    return finish;
  };

  const forConversation = (conversationId) => {
    let normalizedId;
    try {
      if (!(typeof conversationId === "string" || Number.isSafeInteger(conversationId))) return { nextTurn: () => null };
      normalizedId = String(conversationId);
      if (!normalizedId || normalizedId.length > 256) return { nextTurn: () => null };
    } catch (_error) {
      return { nextTurn: () => null };
    }
    let conversationIdHash;
    try {
      conversationIdHash = crypto.createHmac("sha256", hmacKey).update(normalizedId).digest("hex").slice(0, 24);
    } catch (_error) {
      return { nextTurn: () => null };
    }
    let context = conversationContexts.get(conversationIdHash);
    if (context) {
      conversationContexts.delete(conversationIdHash);
      conversationContexts.set(conversationIdHash, context);
    } else {
      if (conversationContexts.size >= maxConversationContexts) {
        const oldestKey = conversationContexts.keys().next().value;
        if (oldestKey) conversationContexts.delete(oldestKey);
      }
      context = { turnOrdinal: 0 };
      conversationContexts.set(conversationIdHash, context);
    }
    return {
      nextTurn() {
        try {
          context.turnOrdinal += 1;
          return { conversationIdHash, turnOrdinal: context.turnOrdinal };
        } catch (_error) {
          return null;
        }
      }
    };
  };

  const recordRendererMetrics = (input) => {
    if (!Array.isArray(input)) input = [input];
    let accepted = 0;
    for (const metric of input.slice(0, MAX_RENDERER_METRICS_PER_CALL)) {
      try {
        if (!metric || !RENDERER_STEPS.has(metric.step)) continue;
        const wallMs = Number(metric.wallMs);
        const count = metric.count === undefined ? 1 : metric.count;
        if (!Number.isFinite(wallMs) || wallMs < 0 || wallMs > 60000) continue;
        if (!Number.isSafeInteger(count) || count < 0 || count > 1000000) continue;
        const result = metric.result === undefined ? "OK" : metric.result;
        if (!RESULTS.has(result)) continue;
        if (appendEvent(metric.step, { wallMs, count, result, attribution: "RENDERER" })) accepted += 1;
      } catch (_error) {}
    }
    return accepted;
  };

  const buildReport = () => {
    const events = [];
    for (let index = 0; index < ringCount; index += 1) {
      const event = eventRing[(ringStart + index) % maxEvents];
      if (event) events.push({ ...event });
    }
    const aggregateRows = [...aggregates.values()].map((aggregate) => ({
      step: aggregate.step,
      attribution: aggregate.attribution,
      countTotal: aggregate.countTotal,
      errorCount: aggregate.errorCount,
      sampleCount: aggregate.samples.length,
      droppedCount: aggregate.droppedCount,
      sampledWindow: true,
      p50Ms: percentile(aggregate.samples, 0.5),
      p95Ms: percentile(aggregate.samples, 0.95),
      bytesRead: aggregate.bytesRead
    }));
    return {
      traceVersion: TRACE_VERSION,
      enabled: true,
      startupId,
      generatedAtMs: safeUnixNow(),
      sampledWindow: true,
      droppedCount,
      events,
      aggregates: aggregateRows
    };
  };

  return {
    enabled: true,
    startupId,
    startSpan,
    record,
    forConversation,
    recordRendererMetrics,
    snapshot: buildReport,
    exportReport: buildReport
  };
}

module.exports = { createStartupPerformanceTrace, isDiagnosticsRequested };
