"use strict";

const assert = require("assert");
const benchmark = require("./action-engine-v4-benchmark");

const corpus = benchmark.loadJson(benchmark.DEFAULT_CORPUS);
const validation = benchmark.validateCorpus(corpus);
assert.strictEqual(validation.caseCount, 160);
assert.strictEqual(Object.keys(validation.actionCounts).length, 16);
assert(Object.values(validation.actionCounts).every((count) => count === 10));

const perfect = corpus.cases.map((entry) => ({
  id: entry.id,
  detected: entry.expectedDetection,
  actions: entry.expectedDetection ? entry.expectedActions : [],
  pending: entry.expectedRejectReason === "consent_required",
  executed: entry.expectedExecution,
  executedActionCount: entry.expectedExecution ? 1 : 0,
  targetCharacterId: entry.expectedTargetCharacterId,
  providerCalls: entry.mode === "precision" ? 1 : 0,
  hintPossibleAction: entry.expectedDetection
}));
const passing = benchmark.calculate(corpus, perfect);
assert.strictEqual(passing.passed, true);
assert.strictEqual(passing.blockers.length, 0);
assert.strictEqual(passing.report.precision.metrics.coreRecall, 1);
assert.strictEqual(passing.report.performance.metrics.triggerAccuracy, 1);

const wrongTarget = perfect.map((entry) => ({ ...entry }));
const critical = corpus.cases.find((entry) => entry.expectedExecution && entry.expectedTargetCharacterId != null);
const actual = wrongTarget.find((entry) => entry.id === critical.id);
actual.targetCharacterId = 999;
const blocked = benchmark.calculate(corpus, wrongTarget);
assert.strictEqual(blocked.passed, false);
assert(blocked.blockers.some((entry) => entry.id === critical.id && entry.reason === "wrong_target"));

console.log("PASS v7.9.3 AE4 Phase 7 benchmark infrastructure");
