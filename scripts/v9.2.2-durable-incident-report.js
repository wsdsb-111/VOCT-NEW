"use strict";

const fs = require("fs");
const { createUsageAnalytics, buildDurableComparisonKey } = require("../src/app/main/analytics/usage-analytics");

const UUID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const HASH_PATTERN = /^[a-f0-9]{64}$/i;
const ORIGINS = new Set(["finalization", "recovery", "legacy_recompression", "letter_finalization", "other"]);
const TOKEN_METRICS = [
  ["inputTokens", "inputReported"],
  ["hitTokens", "hitReported"],
  ["missTokens", "missReported"],
  ["outputTokens", "outputReported"]
];
const HASH_FIELDS = ["sourceDigest", "systemHash", "anchorHash", "userHash", "requestHash",
  "ownerScopeHash", "campaignScopeHash", "finalizationHash", "endpointHash", "effectiveParameterHash", "policyHash"];

function isCount(value) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function validId(value) {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function validHash(value) {
  return typeof value === "string" && HASH_PATTERN.test(value);
}

function addMetric(target, attempt, valueField, reportedField) {
  if (attempt?.[reportedField] === true && isCount(attempt[valueField])) {
    target.knownSubtotal += attempt[valueField];
    target.reportedCount++;
  } else {
    target.unknownCount++;
  }
}

function newMetricTotals() {
  return Object.fromEntries(TOKEN_METRICS.map(([field]) => [field, { knownSubtotal: 0, reportedCount: 0, unknownCount: 0 }]));
}

function addAttemptMetrics(target, attempt) {
  for (const [field, reported] of TOKEN_METRICS) addMetric(target[field], attempt, field, reported);
}

function addUnknownAttemptMetrics(target, count = 1) {
  for (const [field] of TOKEN_METRICS) target[field].unknownCount += count;
}

function countBy(values, project) {
  const counts = {};
  for (const value of values) {
    const key = project(value) || "UNKNOWN";
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function compareAnalyticsField(target, storedValue, attempt, tokenField, reportedField) {
  if (attempt?.[reportedField] !== true || !isCount(attempt?.[tokenField])) {
    if (storedValue != null && isCount(storedValue)) target.normalizedOrDerivedUnknown++;
    else target.unknown++;
    return;
  }
  if (!isCount(storedValue)) {
    target.missingStoredValue++;
  } else if (storedValue === attempt[tokenField]) {
    target.matches++;
  } else {
    target.mismatches++;
  }
}

function analyzeTree(attempts, retention = {}) {
  const idCounts = new Map();
  for (const attempt of attempts) {
    if (validId(attempt?.durableAttemptId)) idCounts.set(attempt.durableAttemptId.toLowerCase(), (idCounts.get(attempt.durableAttemptId.toLowerCase()) || 0) + 1);
  }
  const duplicateAttemptIds = [...idCounts.values()].filter((count) => count > 1).length;
  const uniqueRows = new Map();
  let invalidAttemptIds = 0;
  let roots = 0;
  let childrenWithKnownParent = 0;
  let unknownParent = 0;
  let danglingParent = 0;
  for (const attempt of attempts) {
    const id = attempt?.durableAttemptId;
    if (!validId(id)) {
      invalidAttemptIds++;
      continue;
    }
    const normalizedId = id.toLowerCase();
    if (idCounts.get(normalizedId) !== 1) continue;
    uniqueRows.set(normalizedId, attempt);
    if (!Object.prototype.hasOwnProperty.call(attempt, "durableParentAttemptId")) unknownParent++;
    else if (attempt.durableParentAttemptId == null) roots++;
    else if (!validId(attempt.durableParentAttemptId)) unknownParent++;
    else if (uniqueRows.has(attempt.durableParentAttemptId.toLowerCase()) || idCounts.get(attempt.durableParentAttemptId.toLowerCase()) === 1) childrenWithKnownParent++;
    else danglingParent++;
  }
  const colors = new Map();
  let cycles = 0;
  function visit(id) {
    const color = colors.get(id) || 0;
    if (color === 1) { cycles++; return; }
    if (color === 2) return;
    colors.set(id, 1);
    const parent = uniqueRows.get(id)?.durableParentAttemptId;
    const parentId = validId(parent) ? parent.toLowerCase() : null;
    if (parentId && uniqueRows.has(parentId)) visit(parentId);
    colors.set(id, 2);
  }
  for (const id of uniqueRows.keys()) visit(id);
  const structurallyComplete = duplicateAttemptIds === 0 && invalidAttemptIds === 0 && unknownParent === 0 && danglingParent === 0 && cycles === 0;
  const retentionKnownComplete = retention.truncatedWindow === false && retention.droppedCount === 0;
  const knownTruncated = retention.truncatedWindow === true || isCount(retention.droppedCount) && retention.droppedCount > 0;
  return {
    attempts: attempts.length,
    validUniqueAttemptIds: uniqueRows.size,
    duplicateIdGroups: duplicateAttemptIds,
    invalidAttemptIds,
    roots,
    childrenWithKnownParent,
    unknownParent,
    danglingParent,
    cycles,
    status: knownTruncated ? "truncated" : retentionKnownComplete ? structurallyComplete ? "complete" : "incomplete" : "retention_unknown",
    complete: attempts.length > 0 && structurallyComplete && retentionKnownComplete
  };
}

function analyzeRunTrees(attempts, retention) {
  const runs = new Map();
  let rowsWithUnknownRunId = 0;
  for (const attempt of attempts) {
    if (!validId(attempt?.durableRunId)) {
      rowsWithUnknownRunId++;
      continue;
    }
    const runId = attempt.durableRunId.toLowerCase();
    if (!runs.has(runId)) runs.set(runId, []);
    runs.get(runId).push(attempt);
  }
  const summaries = [...runs.values()].map((rows) => analyzeTree(rows, retention));
  return {
    runGroups: summaries.length,
    rowsWithUnknownRunId,
    completeRuns: summaries.filter((summary) => summary.complete).length,
    incompleteRuns: summaries.filter((summary) => !summary.complete).length,
    maxAttemptsPerRun: summaries.reduce((maximum, summary) => Math.max(maximum, summary.attempts), 0)
  };
}

function summarizeHistoricalBaseline(baseline) {
  if (!baseline || typeof baseline !== "object" || !Array.isArray(baseline.attempts)) return null;
  const rows = baseline.attempts;
  const sum = (field) => rows.every((row) => isCount(row?.[field])) ? rows.reduce((total, row) => total + row[field], 0) : null;
  const parentUnknown = rows.filter((row) => row?.parentAttemptId === "UNKNOWN" || row?.parentAttemptId == null).length;
  return {
    requestCount: isCount(baseline.requestCount) ? baseline.requestCount : rows.length,
    recordedTotals: {
      promptTokens: isCount(baseline.promptTokens) ? baseline.promptTokens : null,
      cacheHitTokens: isCount(baseline.cacheHitTokens) ? baseline.cacheHitTokens : null,
      cacheMissTokens: isCount(baseline.cacheMissTokens) ? baseline.cacheMissTokens : null,
      outputTokens: isCount(baseline.outputTokens) ? baseline.outputTokens : null
    },
    rowTotals: {
      promptTokens: sum("promptTokens"),
      cacheHitTokens: sum("cacheHitTokens"),
      cacheMissTokens: sum("cacheMissTokens"),
      outputTokens: sum("outputTokens")
    },
    origins: countBy(rows, (row) => ORIGINS.has(row?.origin) ? row.origin : "UNKNOWN"),
    parentUnknown,
    attribution: "historical_usage_without_attempt_lineage",
    sourceMatchCandidatesUsedForIdentity: false
  };
}

function buildDurableIncidentReport({ usageData, traceData, baselineData = null }) {
  if (!usageData || !Array.isArray(usageData.entries)) throw new Error("Usage input must contain an entries array");
  const traceEnvelope = traceData && Object.prototype.hasOwnProperty.call(traceData, "durableTrace") ? traceData.durableTrace : traceData;
  if (traceEnvelope?.version !== 1 || !Array.isArray(traceEnvelope.attempts)) throw new Error("Trace input must be version 1 with an attempts array");
  if (baselineData != null && !Array.isArray(baselineData.attempts)) throw new Error("Baseline input must contain an attempts array");
  const usageEntries = usageData.entries.filter((entry) => entry?.requestType === "memory4_durable" && entry?.isUsageRecord !== false);
  const attempts = traceEnvelope.attempts;
  const retention = {
    droppedCount: isCount(traceEnvelope.droppedCount) ? traceEnvelope.droppedCount : "UNKNOWN",
    truncatedWindow: typeof traceEnvelope.truncatedWindow === "boolean" ? traceEnvelope.truncatedWindow : "UNKNOWN"
  };
  const attemptIdCounts = new Map();
  const usageIdCounts = new Map();
  for (const attempt of attempts) {
    const id = attempt?.durableAttemptId;
    if (validId(id)) attemptIdCounts.set(id.toLowerCase(), (attemptIdCounts.get(id.toLowerCase()) || 0) + 1);
  }
  for (const entry of usageEntries) {
    const id = entry?.durableTrace?.durableAttemptId;
    if (validId(id)) usageIdCounts.set(id.toLowerCase(), (usageIdCounts.get(id.toLowerCase()) || 0) + 1);
  }
  const attemptsById = new Map(attempts.filter((attempt) => validId(attempt?.durableAttemptId) && attemptIdCounts.get(attempt.durableAttemptId.toLowerCase()) === 1)
    .map((attempt) => [attempt.durableAttemptId.toLowerCase(), attempt]));
  const usageById = new Map(usageEntries.filter((entry) => validId(entry?.durableTrace?.durableAttemptId)
    && usageIdCounts.get(entry.durableTrace.durableAttemptId.toLowerCase()) === 1)
    .map((entry) => [entry.durableTrace.durableAttemptId.toLowerCase(), entry]));
  const joined = [];
  for (const [id, attempt] of attemptsById) {
    const entry = usageById.get(id);
    if (entry) joined.push({ attempt, entry });
  }
  const startedAttempts = attempts.filter((attempt) => typeof attempt?.providerSendStartedAt === "string" && Number.isFinite(Date.parse(attempt.providerSendStartedAt)));
  const uniqueStartedAttempts = startedAttempts.filter((attempt) => validId(attempt?.durableAttemptId)
    && attemptIdCounts.get(attempt.durableAttemptId.toLowerCase()) === 1);
  const duplicateSentIdGroups = new Set(startedAttempts.filter((attempt) => validId(attempt?.durableAttemptId)
    && attemptIdCounts.get(attempt.durableAttemptId.toLowerCase()) > 1).map((attempt) => attempt.durableAttemptId.toLowerCase())).size;
  const invalidSentAttemptIdRows = startedAttempts.filter((attempt) => !validId(attempt?.durableAttemptId)).length;
  const ambiguousSentAttemptCount = duplicateSentIdGroups + invalidSentAttemptIdRows;
  const joinedIds = new Set(joined.map(({ attempt }) => attempt.durableAttemptId.toLowerCase()));
  const unjoinableUsageRows = usageEntries.filter((entry) => !validId(entry?.durableTrace?.durableAttemptId)).length;
  const usageRowsWithoutTrace = usageEntries.filter((entry) => validId(entry?.durableTrace?.durableAttemptId)
    && !attemptsById.has(entry.durableTrace.durableAttemptId.toLowerCase())).length;
  const duplicateTraceIdGroups = [...attemptIdCounts.values()].filter((count) => count > 1).length;
  const duplicateUsageIdGroups = [...usageIdCounts.values()].filter((count) => count > 1).length;
  const startsWithoutUsage = startedAttempts.filter((attempt) => !joinedIds.has(attempt.durableAttemptId?.toLowerCase())).length;

  const nativeTotals = newMetricTotals();
  const byOrigin = new Map();
  const byOwner = new Map();
  const reconciliation = Object.fromEntries(TOKEN_METRICS.map(([field]) => [field, { matches: 0, mismatches: 0, missingStoredValue: 0, normalizedOrDerivedUnknown: 0, unknown: 0 }]));
  for (const attempt of uniqueStartedAttempts) {
    addAttemptMetrics(nativeTotals, attempt);
    const origin = ORIGINS.has(attempt.origin) ? attempt.origin : "UNKNOWN";
    if (!byOrigin.has(origin)) byOrigin.set(origin, { attempts: 0, tokenMetrics: newMetricTotals() });
    const originGroup = byOrigin.get(origin);
    originGroup.attempts++;
    addAttemptMetrics(originGroup.tokenMetrics, attempt);
    const ownerHash = validHash(attempt.ownerScopeHash) ? attempt.ownerScopeHash.toLowerCase() : null;
    const ownerKey = ownerHash || "UNKNOWN";
    if (!byOwner.has(ownerKey)) byOwner.set(ownerKey, { ownerScopeHash: ownerHash, attempts: 0, tokenMetrics: newMetricTotals() });
    const ownerGroup = byOwner.get(ownerKey);
    ownerGroup.attempts++;
    addAttemptMetrics(ownerGroup.tokenMetrics, attempt);
  }
  addUnknownAttemptMetrics(nativeTotals, ambiguousSentAttemptCount);
  for (const { attempt, entry } of joined) {
    if (!attempt.providerSendStartedAt) continue;
    compareAnalyticsField(reconciliation.inputTokens, entry.promptTokens, attempt, "inputTokens", "inputReported");
    compareAnalyticsField(reconciliation.hitTokens, entry.cacheHitTokens, attempt, "hitTokens", "hitReported");
    compareAnalyticsField(reconciliation.missTokens, entry.cacheMissTokens, attempt, "missTokens", "missReported");
    compareAnalyticsField(reconciliation.outputTokens, entry.completionTokens, attempt, "outputTokens", "outputReported");
  }

  const hashCoverage = Object.fromEntries(HASH_FIELDS.map((field) => {
    const values = attempts.map((attempt) => attempt?.[field]).filter(validHash).map((value) => value.toLowerCase());
    const distinct = new Set(values).size;
    return [field, { present: values.length, missing: attempts.length - values.length, distinct, repeated: values.length - distinct }];
  }));
  const exactDiff = { compared: 0, unchanged: 0, changed: 0, unknownFingerprints: 0, noSameScopePredecessor: 0, unattributableScopeAssociation: 0,
    interveningScopeChangeProven: 0, interveningScopeChangeNotObserved: 0, interveningScopeChangeUnknown: 0 };
  const sortedUsage = [...usageEntries].sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp));
  const previousByScope = new Map();
  const lastScopeByRequest = new Map();
  const promptAnalyzerClass = createUsageAnalytics({
    fs: {}, dataDir: "", analyticsFile: "", retention: {}, createPromptFingerprint: () => null
  });
  const promptAnalyzer = Object.create(promptAnalyzerClass.prototype);
  const localEstimation = { method: "ordered_prefix_estimate_v1", requests: 0, withBlocks: 0, estimatedBlockTokens: 0, allocatedMissTokens: 0, downstreamMissTokens: 0, missProvenanceUnknown: 0 };
  for (const entry of sortedUsage) {
    const key = buildDurableComparisonKey(entry);
    const baseKey = JSON.stringify([entry.requestType, entry.providerType, entry.model]);
    const lastScopeKey = lastScopeByRequest.get(baseKey);
    const previous = key ? previousByScope.get(key) : null;
    if (!key) exactDiff.unattributableScopeAssociation++;
    else if (!previous) exactDiff.noSameScopePredecessor++;
    else {
      exactDiff.compared++;
      if (lastScopeKey == null) exactDiff.interveningScopeChangeUnknown++;
      else if (lastScopeKey !== key) exactDiff.interveningScopeChangeProven++;
      else exactDiff.interveningScopeChangeNotObserved++;
      const currentBlocks = Array.isArray(entry.blocks) ? entry.blocks : [];
      const previousBlocks = Array.isArray(previous.blocks) ? previous.blocks : [];
      if (!currentBlocks.length || !previousBlocks.length
        || [...currentBlocks, ...previousBlocks].some((block) => !block?.fingerprint)) exactDiff.unknownFingerprints++;
      else if (currentBlocks.length === previousBlocks.length
        && currentBlocks.every((block, index) => block.id === previousBlocks[index].id && block.fingerprint === previousBlocks[index].fingerprint)) exactDiff.unchanged++;
      else exactDiff.changed++;
    }
    if (key) previousByScope.set(key, entry);
    lastScopeByRequest.set(baseKey, key);
    const estimate = promptAnalyzer.attributeCacheMiss(entry, previous);
    if (estimate) {
      localEstimation.requests++;
      if (estimate.blocks?.length) localEstimation.withBlocks++;
      localEstimation.estimatedBlockTokens += Number(estimate.estimatedBlockTokens) || 0;
      localEstimation.allocatedMissTokens += Number(estimate.cacheMissTokens) || 0;
      localEstimation.downstreamMissTokens += Number(estimate.downstreamMissTokens) || 0;
      if (entry.cacheMissTokens != null && entry.durableTrace?.missReported !== true) localEstimation.missProvenanceUnknown++;
    }
  }

  const originCounts = countBy(startedAttempts, (attempt) => ORIGINS.has(attempt?.origin) ? attempt.origin : "UNKNOWN");
  const providerAttemptCount = { knownSubtotal: 0, reportedRows: 0, unknownRows: 0 };
  for (const attempt of uniqueStartedAttempts) {
    if (isCount(attempt.providerAttemptCount)) {
      providerAttemptCount.knownSubtotal += attempt.providerAttemptCount;
      providerAttemptCount.reportedRows++;
    } else {
      providerAttemptCount.unknownRows++;
    }
  }
  providerAttemptCount.unknownRows += ambiguousSentAttemptCount;
  const traceWindowComplete = traceEnvelope.enabled === true
    && retention.truncatedWindow === false && retention.droppedCount === 0;
  providerAttemptCount.observed = providerAttemptCount.knownSubtotal;
  providerAttemptCount.lowerBound = providerAttemptCount.knownSubtotal;
  providerAttemptCount.complete = traceWindowComplete && providerAttemptCount.unknownRows === 0;
  const providerSendCountLowerBound = uniqueStartedAttempts.length + duplicateSentIdGroups;
  const nativeByOrigin = Object.fromEntries([...byOrigin].map(([origin, metrics]) => [origin, metrics]));
  const historicalBaseline = summarizeHistoricalBaseline(baselineData);
  return {
    schemaVersion: 1,
    traceEnabled: traceEnvelope.enabled === true,
    traceRetention: retention,
    attributionLayers: {
      provider_native: {
        source: "unique sent trace rows plus raw-usage presence flags; Usage reconciliation uses exact durableAttemptId joins",
        attempts: uniqueStartedAttempts.length,
        duplicateSentIdGroups,
        invalidSentAttemptIdRows,
        tokenMetrics: nativeTotals,
        byOrigin: nativeByOrigin,
        reconciliation
      },
      exact_app_content_diff: exactDiff,
      local_estimation: localEstimation
    },
    attempts: {
      traceRows: attempts.length,
      providerSends: startedAttempts.length,
      providerSendCountCoverage: {
        observed: startedAttempts.length,
        lowerBound: providerSendCountLowerBound,
        complete: traceWindowComplete && ambiguousSentAttemptCount === 0
      },
      providerAttemptCount,
      sendTimestampUnknown: attempts.length - startedAttempts.length,
      origin: originCounts
    },
    usageJoin: {
      usageRows: usageEntries.length,
      joinedRows: joined.length,
      sendsWithoutUsageRow: startsWithoutUsage,
      usageRowsWithoutTrace: usageRowsWithoutTrace,
      usageRowsMissingValidAttemptId: unjoinableUsageRows,
      duplicateTraceIdGroups,
      duplicateUsageIdGroups
    },
    tree: { ...analyzeTree(attempts, retention), byRun: analyzeRunTrees(attempts, retention) },
    hashCoverage,
    scopeAssociationMeaning: "unattributable_cross_owner means scope association is unavailable; it does not prove a cross-owner transition.",
    hashMeaning: "HMAC equality identifies the same hashed input only; it does not prove provider cache use.",
    tokenCostProxy: {
      basis: "provider_native_token_components_only",
      currency: null,
      total: nativeTotals,
      byOwnerScopeHash: [...byOwner.values()].sort((left, right) => (left.ownerScopeHash || "").localeCompare(right.ownerScopeHash || ""))
    },
    historicalBaseline
  };
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function main(argv) {
  const options = {};
  for (let index = 2; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!value || !["--usage", "--trace", "--baseline"].includes(key)) throw Object.assign(new Error(), { code: "DURABLE_REPORT_USAGE" });
    options[key] = value;
  }
  if (!options["--usage"] || !options["--trace"]) throw Object.assign(new Error(), { code: "DURABLE_REPORT_USAGE" });
  const report = buildDurableIncidentReport({
    usageData: readJson(options["--usage"]),
    traceData: readJson(options["--trace"]),
    baselineData: options["--baseline"] ? readJson(options["--baseline"]) : null
  });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

if (require.main === module) {
  try { main(process.argv); }
  catch (error) {
    process.stderr.write(`${error.code === "DURABLE_REPORT_USAGE" ? "durable_incident_report_usage: --usage FILE --trace FILE [--baseline FILE]" : "durable_incident_report_invalid_input"}\n`);
    process.exitCode = 1;
  }
}

module.exports = { buildDurableIncidentReport, analyzeTree, summarizeHistoricalBaseline };
