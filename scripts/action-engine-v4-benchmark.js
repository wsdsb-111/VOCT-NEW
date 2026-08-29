"use strict";

const fs = require("fs");
const path = require("path");

const DEFAULT_CORPUS = path.join(__dirname, "fixtures", "action-engine-v4-benchmark.json");
const THRESHOLDS = Object.freeze({
  precision: Object.freeze({ coreRecall: 0.95, overallRecall: 0.9, triggerAccuracy: 0.92 }),
  performance: Object.freeze({ coreRecall: 0.85, overallRecall: 0.8, triggerAccuracy: 0.94, fallbackFalseNegative: 5 })
});

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

function calculate(corpus, results) {
  const byId = new Map(results.map((entry) => [entry.id, entry]));
  const report = {};
  const blockers = [];
  for (const mode of ["precision", "performance"]) {
    const cases = corpus.cases.filter((entry) => entry.mode === mode);
    let positives = 0;
    let detectedPositives = 0;
    let correctDetection = 0;
    let fallbackFalseNegative = 0;
    let executed = 0;
    let providerCalls = 0;
    const perAction = {};
    for (const expected of cases) {
      const actual = byId.get(expected.id) || {};
      const detected = actual.detected === true || (actual.actions || []).length > 0 || actual.pending === true;
      if (expected.expectedDetection) {
        positives++;
        if (detected) detectedPositives++;
        else if (mode === "performance" && actual.hintPossibleAction === false) fallbackFalseNegative++;
      }
      if (detected === expected.expectedDetection) correctDetection++;
      if (actual.executed === true) executed++;
      providerCalls += Number(actual.providerCalls || 0);
      const actionId = expected.expectedActions[0];
      if (!perAction[actionId]) perAction[actionId] = { expected: 0, detected: 0 };
      if (expected.expectedDetection) {
        perAction[actionId].expected++;
        if (detected && (actual.actions || []).includes(actionId)) perAction[actionId].detected++;
      }
      if (actual.executed === true && expected.expectedExecution !== true) blockers.push({ id: expected.id, reason: "critical_false_positive" });
      if (actual.executed === true && expected.expectedTargetCharacterId != null && Number(actual.targetCharacterId) !== Number(expected.expectedTargetCharacterId)) blockers.push({ id: expected.id, reason: "wrong_target" });
      if (Number(actual.executedActionCount || (actual.executed ? 1 : 0)) > 3) blockers.push({ id: expected.id, reason: "more_than_three_actions" });
      if (actual.usedLegacyFallback === true) blockers.push({ id: expected.id, reason: "ae4_message_fell_back_to_ae3" });
      if (actual.nonIdempotentDuplicate === true) blockers.push({ id: expected.id, reason: "non_idempotent_duplicate" });
    }
    const thresholds = THRESHOLDS[mode];
    const metrics = {
      coreRecall: percent(detectedPositives, positives),
      overallRecall: percent(detectedPositives, positives),
      triggerAccuracy: percent(correctDetection, cases.length),
      fallbackFalseNegative,
      executionYield: percent(executed, detectedPositives),
      providerCallsPer100Dialogues: percent(providerCalls * 100, cases.length),
      perActionRecall: Object.fromEntries(Object.entries(perAction).map(([actionId, value]) => [actionId, percent(value.detected, value.expected)]))
    };
    const passed = metrics.coreRecall >= thresholds.coreRecall && metrics.overallRecall >= thresholds.overallRecall && metrics.triggerAccuracy >= thresholds.triggerAccuracy && (mode !== "performance" || metrics.fallbackFalseNegative <= thresholds.fallbackFalseNegative);
    report[mode] = { metrics, thresholds, passed };
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

module.exports = { DEFAULT_CORPUS, THRESHOLDS, loadJson, validateCorpus, calculate };
