"use strict";

const fs = require("fs");
const path = require("path");

const DEFAULT_CORPUS = path.join(__dirname, "fixtures", "action-engine-v4-benchmark.json");
const THRESHOLDS = Object.freeze({
  precision: Object.freeze({ coreRecall: 0.95, overallRecall: 0.9, triggerAccuracy: 0.92, perActionRecall: 0.9, criticalPerActionRecall: 0.95 }),
  performance: Object.freeze({ coreRecall: 0.85, overallRecall: 0.8, triggerAccuracy: 0.94, fallbackFalseNegative: 5, perActionRecall: 0.75, criticalPerActionRecall: 0.8 })
});
const CORE_VARIANTS = new Set(["direct", "natural", "indirect", "multi_person", "multi_turn"]);
const CRITICAL_ACTIONS = new Set(["playerPaysGoldTo", "paysGoldTo", "isImprisonedBy", "isInjured", "characterIsKilled", "isAssignedToCourtPositionBy", "isAssignedToCouncilBy", "isFiredFromCouncilOf", "agreedToTruceWith"]);

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function validateCorpus(corpus) {
  if (corpus?.schemaVersion !== "ae4-benchmark-v1" || !Array.isArray(corpus.cases)) throw new Error("invalid_benchmark_schema");
  if (corpus.cases.length < 150 || corpus.cases.length > 200) throw new Error("benchmark_case_count_out_of_range");
  const counts = new Map();
  const ids = new Set();
  for (const entry of corpus.cases) {
    if (ids.has(entry.id)) throw new Error(`duplicate_benchmark_id:${entry.id}`);
    ids.add(entry.id);
    if (!Array.isArray(entry.participants) || !Array.isArray(entry.history) || !entry.message || !Array.isArray(entry.expectedActions) || !["performance", "precision"].includes(entry.mode)) throw new Error(`invalid_benchmark_case:${entry.id}`);
    counts.set(entry.expectedActions[0], (counts.get(entry.expectedActions[0]) || 0) + 1);
  }
  for (const actionId of corpus.p0Actions || []) if ((counts.get(actionId) || 0) < 10) throw new Error(`insufficient_p0_cases:${actionId}`);
  return { valid: true, caseCount: corpus.cases.length, actionCounts: Object.fromEntries(counts) };
}

function percent(numerator, denominator) {
  return denominator > 0 ? numerator / denominator : 1;
}

function actionRecords(actual) {
  if (Array.isArray(actual.actionResults)) return actual.actionResults;
  return (actual.actions || []).map((action, index) => typeof action === "string" ? {
    actionId: action,
    sourceCharacterId: index === 0 ? actual.sourceCharacterId : undefined,
    targetCharacterId: index === 0 ? actual.targetCharacterId : undefined,
    arguments: index === 0 ? actual.arguments : undefined
  } : action);
}

function containsArguments(actual, expected) {
  if (!expected || Object.keys(expected).length === 0) return true;
  return Object.entries(expected).every(([key, value]) => Object.prototype.hasOwnProperty.call(actual || {}, key) && JSON.stringify(actual[key]) === JSON.stringify(value));
}

function matchCase(expected, actual) {
  const records = actionRecords(actual);
  const actionIds = records.map((record) => record.actionId);
  const actualPending = actual.pending === true || Number(actual.pendingCount || 0) > 0;
  const actualDetection = actual.detected === true || actionIds.length > 0 || actualPending;
  const expectedPending = expected.expectedPending === true || expected.expectedRejectReason === "consent_required";
  const actionMatch = expected.expectedDetection === true
    ? expected.expectedActions.every((actionId) => actionIds.includes(actionId)) && actionIds.every((actionId) => expected.expectedActions.includes(actionId))
    : actionIds.length === 0;
  const expectedRecord = records.find((record) => expected.expectedActions.includes(record.actionId));
  const sourceMatch = expected.expectedDetection !== true || expected.expectedSourceCharacterId == null || Number(expectedRecord?.sourceCharacterId) === Number(expected.expectedSourceCharacterId);
  const targetMatch = expected.expectedDetection !== true || !Object.prototype.hasOwnProperty.call(expected, "expectedTargetCharacterId") || (expected.expectedTargetCharacterId == null ? expectedRecord?.targetCharacterId == null : Number(expectedRecord?.targetCharacterId) === Number(expected.expectedTargetCharacterId));
  const argumentMatch = expected.expectedDetection !== true || containsArguments(expectedRecord?.arguments, expected.expectedArguments);
  return {
    detectionMatch: actualDetection === expected.expectedDetection,
    actionMatch,
    sourceMatch,
    targetMatch,
    argumentMatch,
    pendingMatch: actualPending === expectedPending,
    executionMatch: (actual.executed === true) === (expected.expectedExecution === true),
    actualDetection,
    actualPending,
    records
  };
}

function isCoreCase(entry) {
  return CORE_VARIANTS.has(entry.variant) || String(entry.variant || "").startsWith("multi_person");
}

function calculate(corpus, results) {
  const byId = new Map(results.map((entry) => [entry.id, entry]));
  const report = {};
  const blockers = [];
  for (const mode of ["precision", "performance"]) {
    const cases = corpus.cases.filter((entry) => entry.mode === mode);
    let positives = 0;
    let actionMatchedPositives = 0;
    let corePositives = 0;
    let coreActionMatches = 0;
    let correctDetection = 0;
    let fallbackFalseNegative = 0;
    let executed = 0;
    let providerCalls = 0;
    const perAction = {};
    const matches = [];
    for (const expected of cases) {
      const actual = byId.get(expected.id) || {};
      const match = matchCase(expected, actual);
      matches.push({ id: expected.id, ...match, records: undefined });
      if (expected.expectedDetection) {
        positives++;
        if (match.actionMatch) actionMatchedPositives++;
        if (isCoreCase(expected)) {
          corePositives++;
          if (match.actionMatch) coreActionMatches++;
        }
        if (!match.actionMatch && mode === "performance" && actual.hintPossibleAction === false) fallbackFalseNegative++;
      }
      if (match.detectionMatch && match.actionMatch) correctDetection++;
      if (actual.executed === true) executed++;
      providerCalls += Number(actual.providerCalls || 0);
      const actionId = expected.expectedActions[0];
      if (!perAction[actionId]) perAction[actionId] = { expected: 0, matched: 0 };
      if (expected.expectedDetection) {
        perAction[actionId].expected++;
        if (match.actionMatch) perAction[actionId].matched++;
      }
      if (expected.expectedDetection && match.actualDetection && !match.actionMatch) blockers.push({ id: expected.id, reason: "wrong_action" });
      if (expected.expectedDetection && match.actionMatch && !match.sourceMatch) blockers.push({ id: expected.id, reason: "wrong_source" });
      if (expected.expectedDetection && match.actionMatch && !match.targetMatch) blockers.push({ id: expected.id, reason: "wrong_target" });
      if (expected.expectedDetection && match.actionMatch && !match.argumentMatch) blockers.push({ id: expected.id, reason: "wrong_required_argument" });
      if (!match.pendingMatch) blockers.push({ id: expected.id, reason: match.actualPending ? "unexpected_pending" : "missing_pending" });
      if (!match.executionMatch) blockers.push({ id: expected.id, reason: actual.executed === true ? "unexpected_execution" : "missing_execution" });
      if (!expected.expectedDetection && match.actualDetection) blockers.push({ id: expected.id, reason: "critical_false_positive" });
      if (Math.max(Number(actual.executedActionCount || 0), Number(actual.selectedActionCount || 0), match.records.length) > 3) blockers.push({ id: expected.id, reason: "more_than_three_actions" });
      if (actual.usedLegacyFallback === true) blockers.push({ id: expected.id, reason: "legacy_fallback" });
      if (actual.nonIdempotentDuplicate === true) blockers.push({ id: expected.id, reason: "non_idempotent_duplicate" });
    }
    const thresholds = THRESHOLDS[mode];
    const perActionRecall = Object.fromEntries(Object.entries(perAction).map(([actionId, value]) => [actionId, percent(value.matched, value.expected)]));
    const perActionGate = Object.fromEntries(Object.entries(perActionRecall).map(([actionId, recall]) => [actionId, {
      recall,
      threshold: CRITICAL_ACTIONS.has(actionId) ? thresholds.criticalPerActionRecall : thresholds.perActionRecall,
      passed: recall >= (CRITICAL_ACTIONS.has(actionId) ? thresholds.criticalPerActionRecall : thresholds.perActionRecall)
    }]));
    const metrics = {
      coreRecall: percent(coreActionMatches, corePositives),
      overallRecall: percent(actionMatchedPositives, positives),
      triggerAccuracy: percent(correctDetection, cases.length),
      fallbackFalseNegative,
      executionYield: percent(executed, actionMatchedPositives),
      providerCallsPer100Dialogues: percent(providerCalls * 100, cases.length),
      perActionRecall,
      wrongActionCount: blockers.filter((entry) => entry.reason === "wrong_action" && cases.some((item) => item.id === entry.id)).length,
      wrongTargetCount: blockers.filter((entry) => entry.reason === "wrong_target" && cases.some((item) => item.id === entry.id)).length
    };
    const passed = metrics.coreRecall >= thresholds.coreRecall && metrics.overallRecall >= thresholds.overallRecall && metrics.triggerAccuracy >= thresholds.triggerAccuracy && Object.values(perActionGate).every((entry) => entry.passed) && (mode !== "performance" || metrics.fallbackFalseNegative <= thresholds.fallbackFalseNegative);
    report[mode] = { metrics, thresholds, perActionGate, matches, passed };
  }
  return { report, blockers, passed: report.precision.passed && report.performance.passed && blockers.length === 0 };
}

if (require.main === module) {
  const corpus = loadJson(process.argv[2] || DEFAULT_CORPUS);
  const validation = validateCorpus(corpus);
  if (!process.argv[3]) {
    console.log(JSON.stringify({ corpus: validation, status: "awaiting_real_selector_and_ck3_results" }, null, 2));
  } else {
    const result = calculate(corpus, loadJson(process.argv[3]));
    console.log(JSON.stringify(result, null, 2));
    if (!result.passed) process.exitCode = 1;
  }
}

module.exports = { DEFAULT_CORPUS, THRESHOLDS, CORE_VARIANTS, CRITICAL_ACTIONS, loadJson, validateCorpus, actionRecords, matchCase, isCoreCase, calculate };
