"use strict";

const assert = require("assert");
const benchmark = require("./action-engine-v4-benchmark");

const corpus = benchmark.loadJson(benchmark.DEFAULT_CORPUS);
const validation = benchmark.validateCorpus(corpus);
assert.strictEqual(validation.caseCount, 172);
assert.strictEqual(Object.keys(validation.actionCounts).length, 17);
assert((corpus.p0Actions || []).every((actionId) => validation.actionCounts[actionId] >= 10));
assert.deepStrictEqual([...new Set(corpus.cases.map((entry) => entry.participants.length))].sort((left, right) => left - right), [3, 4, 6], "benchmark must cover 3/4/6-person target binding");

const perfect = corpus.cases.map((entry) => ({
  id: entry.id,
  detected: entry.expectedDetection,
  actions: entry.expectedDetection ? entry.expectedActions : [],
  sourceCharacterId: entry.expectedSourceCharacterId,
  targetCharacterId: entry.expectedTargetCharacterId,
  arguments: entry.expectedArguments || {},
  pending: entry.expectedPending === true || entry.expectedRejectReason === "consent_required",
  executed: entry.expectedExecution,
  executedActionCount: entry.expectedExecution ? 1 : 0,
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

const multiplayerWrongTarget = perfect.map((entry) => ({ ...entry }));
const multiplayerCase = corpus.cases.find((entry) => entry.participants.length >= 4 && entry.expectedTargetCharacterId != null);
const multiplayerActual = multiplayerWrongTarget.find((entry) => entry.id === multiplayerCase.id);
multiplayerActual.targetCharacterId = multiplayerCase.participants.find((participant) => ![multiplayerCase.expectedSourceCharacterId, multiplayerCase.expectedTargetCharacterId].includes(participant.id)).id;
const multiplayerBlocked = benchmark.calculate(corpus, multiplayerWrongTarget);
assert(multiplayerBlocked.blockers.some((entry) => entry.id === multiplayerCase.id && entry.reason === "wrong_target"), "a wrong but otherwise valid multiplayer target must fail the benchmark");

const wrongAction = perfect.map((entry) => ({ ...entry, actions: [...entry.actions] }));
const expectedPayment = corpus.cases.find((entry) => entry.expectedDetection && entry.expectedActions.includes("playerPaysGoldTo"));
const wrongActionActual = wrongAction.find((entry) => entry.id === expectedPayment.id);
wrongActionActual.actions = ["characterIsKilled"];
const wrongActionReport = benchmark.calculate(corpus, wrongAction);
assert.strictEqual(wrongActionReport.passed, false);
assert(wrongActionReport.blockers.some((entry) => entry.id === expectedPayment.id && entry.reason === "wrong_action"), "wrong action must be a blocker");
assert(wrongActionReport.report[expectedPayment.mode].metrics.overallRecall < 1, "wrong action must reduce recall");

const overallOnlyMiss = perfect.map((entry) => ({ ...entry, actions: [...entry.actions] }));
const invalidLegality = corpus.cases.find((entry) => entry.variant === "invalid_legality" && entry.mode === "performance");
const overallOnlyActual = overallOnlyMiss.find((entry) => entry.id === invalidLegality.id);
overallOnlyActual.detected = false;
overallOnlyActual.actions = [];
const splitRecall = benchmark.calculate(corpus, overallOnlyMiss);
assert.strictEqual(splitRecall.report.performance.metrics.coreRecall, 1, "invalid legality cases must not reduce Core Recall");
assert(splitRecall.report.performance.metrics.overallRecall < 1, "invalid legality cases must remain in Overall Recall");

function expectBlocker(mutator, reason) {
  const values = perfect.map((entry) => ({ ...entry, actions: [...entry.actions], arguments: { ...(entry.arguments || {}) } }));
  const id = mutator(values);
  const report = benchmark.calculate(corpus, values);
  assert(report.blockers.some((entry) => entry.id === id && entry.reason === reason), `${reason} must be emitted as a Stop-the-Line blocker`);
}

expectBlocker((values) => {
  const value = values.find((entry) => entry.id === critical.id);
  value.sourceCharacterId = 999;
  return value.id;
}, "wrong_source");
expectBlocker((values) => {
  const expected = corpus.cases.find((entry) => entry.expectedArguments && Object.keys(entry.expectedArguments).length > 0);
  const value = values.find((entry) => entry.id === expected.id);
  value.arguments = {};
  return value.id;
}, "wrong_required_argument");
expectBlocker((values) => {
  const value = values.find((entry) => !entry.pending);
  value.pending = true;
  return value.id;
}, "unexpected_pending");
expectBlocker((values) => {
  const value = values.find((entry) => entry.pending);
  value.pending = false;
  return value.id;
}, "missing_pending");
expectBlocker((values) => {
  const expected = corpus.cases.find((entry) => !entry.expectedExecution);
  const value = values.find((entry) => entry.id === expected.id);
  value.executed = true;
  return value.id;
}, "unexpected_execution");
expectBlocker((values) => {
  const expected = corpus.cases.find((entry) => entry.expectedExecution);
  const value = values.find((entry) => entry.id === expected.id);
  value.executed = false;
  return value.id;
}, "missing_execution");
expectBlocker((values) => {
  const value = values.find((entry) => entry.actions.length > 0);
  value.actions = [value.actions[0], "extra1", "extra2", "extra3"];
  value.selectedActionCount = 4;
  return value.id;
}, "more_than_three_actions");
expectBlocker((values) => {
  values[0].usedLegacyFallback = true;
  return values[0].id;
}, "legacy_fallback");
expectBlocker((values) => {
  values[0].nonIdempotentDuplicate = true;
  return values[0].id;
}, "non_idempotent_duplicate");
expectBlocker((values) => {
  values[0].participantOverrideMismatch = true;
  return values[0].id;
}, "participant_override_mismatch");
expectBlocker((values) => {
  const expected = corpus.cases.find((entry) => entry.variant === "historical_completed_no_replay");
  const value = values.find((entry) => entry.id === expected.id);
  value.detected = true;
  value.actions = [expected.historicalActionId];
  value.executed = true;
  return value.id;
}, "historical_replay");
expectBlocker((values) => {
  const expected = corpus.cases.find((entry) => entry.expectedActions.includes("isInjured"));
  const value = values.find((entry) => entry.id === expected.id);
  value.actualCk3VictimCharacterId = 999;
  return value.id;
}, "injury_victim_mismatch");

console.log("PASS v7.9.3 AE4 Phase 7 benchmark infrastructure");
