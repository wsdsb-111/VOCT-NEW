"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { normalizeGameDate } = require("../src/app/main/worldline/character-temporal-facts");
const { resolveTemporalFocus } = require("../src/app/main/memory-system/fuzzy-temporal-resolver");
const harness = require("./test-v9.3.6.3-mixed-archive-ab");

const {
  CURRENT_DATE, OWNER_ID, TARGET_ID, TARGET_ALIAS, TOKEN_BUDGET,
  assertEquivalent, assertScopedCandidate, comparableSemantic, createContext, makeFixture,
  sampleRow, summarizeWall, uncertainPairIndexes, runRetrieval
} = harness;
const repoRoot = path.resolve(__dirname, "..");
const buildRoot = path.join(repoRoot, ".build");
const outputPath = path.join(buildRoot, "v9363i-integrated-ab-raw.json");
const modeFlags = process.argv.slice(2).filter(arg => arg === "--benchmark");
const unknownFlags = process.argv.slice(2).filter(arg => arg !== "--benchmark");
if (require.main === module && (modeFlags.length > 1 || unknownFlags.length)) {
  harness.cleanupFixtureRoot();
  console.error("Usage: node scripts/test-v9.3.6.3-integrated-ab.js [--benchmark]");
  process.exit(2);
}
if (require.main === module && Number(process.versions.node.split(".")[0]) !== 22) {
  harness.cleanupFixtureRoot();
  console.error("NODE_22_REQUIRED: run with .build/v9331-node22/node.exe");
  process.exit(2);
}

const runMode = modeFlags.length ? "benchmark" : "correctness";
const current = normalizeGameDate(CURRENT_DATE);
if (!current) throw new Error("INTEGRATED_FIXTURE_CURRENT_DATE_INVALID");
const currentTotalDays = current.serial;
const DATE_FIXTURE_BY_PAIR = { 0: ["1198.6.1", "1199.6.1", "1200.1.1"] };
const WARM_SAMPLES = 20;
const runState = {
  schemaVersion: 1,
  evidence: "synthetic-fixture-only; no real summaries, saves, provider calls or source text are recorded",
  runMode,
  createdAt: new Date().toISOString(),
  runtime: {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    cpuModel: os.cpus()[0]?.model || null,
    logicalCpuCount: os.cpus().length,
    totalMemoryBytes: os.totalmem()
  },
  measurementBoundary: {
    timedRegion: "retrievePairMemorySources only",
    fixtureAndMemoryStoreSnapshotLoad: "excluded; complete before every timed retrieval",
    coldDefinition: "fresh MemoryEngine/MemoryStore with empty PairLedger and candidate-directory caches; not physical disk cold",
    warmDefinition: "20 immediate safe-candidate calls following the one measured candidate cold call; no extra warmup",
    referenceDefinition: "one exhaustive-reference retrieval per cell; single cold sample, no P95",
    providerAndPromptBuild: "not included"
  },
  plan: {
    fixedCurrentGameDate: CURRENT_DATE,
    fixedCurrentTotalDays: currentTotalDays,
    correctnessCells: [],
    benchmarkCells: [],
    warmSamplesPerBenchmarkCell: WARM_SAMPLES,
    coldSamplesPerArmPerCell: 1,
    unknownAndAllMentionHaveNoLatencyGate: true
  },
  correctnessCells: [],
  benchmarkCells: [],
  failures: [],
  gateFailures: [],
  completed: false,
  totalRetrievalCalls: 0
};

function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function stableJson(value) {
  return JSON.stringify(value);
}

function flushRaw() {
  fs.mkdirSync(buildRoot, { recursive: true });
  const temporaryPath = `${outputPath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, JSON.stringify(runState, null, 2), "utf8");
  fs.renameSync(temporaryPath, outputPath);
}

function temporalFor(query) {
  const resolved = resolveTemporalFocus(query, null, {
    currentGameDate: CURRENT_DATE,
    currentTotalDays,
    turnEpoch: 0,
    conversationId: "v9363i-synthetic-conversation",
    sceneRevision: 1
  });
  if (!resolved.triggered) return null;
  return {
    requested: resolved.requested === true,
    triggered: true,
    expression: resolved.expression,
    normalizedConcept: resolved.normalizedConcept,
    axisIntent: resolved.axisIntent,
    mode: resolved.mode,
    primaryWindow: resolved.primaryWindow,
    expansionWindow: resolved.expansionWindow,
    order: resolved.order,
    targetTotalDays: resolved.targetTotalDays,
    targetGameYear: resolved.targetGameYear
  };
}

function standardQuery(windowKind) {
  if (windowKind === "explicit-1199") return `你还记得${TARGET_ALIAS}1199年提及的盐税账册吗？`;
  if (windowKind === "previous-year") return `你还记得${TARGET_ALIAS}去年提及的盐税账册吗？`;
  return `你还记得${TARGET_ALIAS}提及的盐税账册吗？`;
}

function queryForCase(queryCase, windowKind) {
  if (queryCase === "sparsehearsay") return `你听${TARGET_ALIAS}转述过盐税账册吗？`;
  if (queryCase === "allmention-worst") return `你还记得${TARGET_ALIAS}提到的盐税账册吗？`;
  if (queryCase === "miss") return `你还记得${TARGET_ALIAS}的海潮账目吗？`;
  return standardQuery(windowKind);
}

function makeSpec({ key, pairCount, level, windowKind = "normal", uncertainCount = 0,
  queryCase = "directhit", queryText = null, unscopedUnknown = false }) {
  const actualQuery = queryText || queryForCase(queryCase, windowKind);
  return {
    key,
    pairCount,
    level,
    windowKind,
    uncertainCount,
    queryCase,
    queryText: actualQuery,
    temporal: windowKind === "normal" ? null : temporalFor(actualQuery),
    unscopedUnknown,
    summaryDatesByPair: queryCase === "directhit" ? DATE_FIXTURE_BY_PAIR : null
  };
}

function correctnessSpecs() {
  return [
    makeSpec({ key: "n100-explicit1199-L1", pairCount: 100, level: "L1", windowKind: "explicit-1199" }),
    makeSpec({ key: "n300-ordinary-L1", pairCount: 300, level: "L1" }),
    makeSpec({ key: "n300-previousyear-L2", pairCount: 300, level: "L2", windowKind: "previous-year" }),
    makeSpec({ key: "n300-old-u1-L1", pairCount: 300, level: "L1", uncertainCount: 1, queryCase: "sparsehearsay" }),
    makeSpec({ key: "n300-old-u10-L2", pairCount: 300, level: "L2", uncertainCount: 10, queryCase: "sparsehearsay" }),
    makeSpec({ key: "n300-allmention-L1", pairCount: 300, level: "L1", queryCase: "allmention-worst" }),
    makeSpec({ key: "n300-unscopedunknown-L1", pairCount: 300, level: "L1", queryCase: "sparsehearsay", unscopedUnknown: true })
  ];
}

function benchmarkSpecs() {
  const specs = [];
  for (const pairCount of [100, 300]) {
    for (const windowKind of ["normal", "explicit-1199", "previous-year"]) {
      for (const level of ["L1", "L2"]) {
        specs.push(makeSpec({ key: `n${pairCount}-${windowKind}-${level}`, pairCount, level, windowKind }));
      }
    }
  }
  for (const uncertainCount of [1, 5, 10]) {
    for (const level of ["L1", "L2"]) {
      specs.push(makeSpec({ key: `n300-old-u${uncertainCount}-${level}`, pairCount: 300, level,
        uncertainCount, queryCase: "sparsehearsay" }));
    }
  }
  for (const queryCase of ["allmention-worst", "sparsehearsay"]) {
    for (const level of ["L1", "L2"]) {
      const unscopedUnknown = queryCase === "sparsehearsay";
      specs.push(makeSpec({ key: `n300-${unscopedUnknown ? "unscopedunknown" : "allmention"}-${level}`,
        pairCount: 300, level, queryCase, unscopedUnknown }));
    }
  }
  return specs;
}

function expectedCandidateScopes(fixture) {
  const scopes = new Set(fixture.queryCase === "directhit" ? [fixture.pairIds[0]]
    : fixture.queryCase === "sparsehearsay" && fixture.pairCount > 1 ? [fixture.pairIds[1]]
      : fixture.queryCase === "allmention-worst" ? fixture.pairIds : []);
  scopes.add(TARGET_ID);
  for (const index of uncertainPairIndexes(fixture.pairCount, fixture.uncertainCount)) scopes.add(fixture.pairIds[index]);
  return [...scopes].sort((left, right) => left - right);
}

function distinctReadScopes(run) {
  return [...new Set(run.counts.readScopes.map(scope => Number(scope.counterpartId))
    .filter(id => Number.isSafeInteger(id) && id > 0))].sort((left, right) => left - right);
}

function assertPermissionCounts(run, label) {
  if (run.sample.level === "L1") {
    assert.equal(run.counts.resolveSourceCalls, 0, `${label}: L1 must not resolve raw sources`);
  }
  if (run.sample.level === "L2") {
    assert(run.counts.resolveSourceCalls <= 2, `${label}: L2 may resolve no more than two sources`);
  }
  if (run.sample.fallback.finalInjectedTokens != null) {
    assert(run.sample.fallback.finalInjectedTokens <= TOKEN_BUDGET, `${label}: memory must stay within request budget`);
  }
}

function assertReadScopes(run, fixture, role, label) {
  assert(run.sample.allReadScopesBelongToOwner, `${label}: all PairLedger reads must remain inside Owner ${OWNER_ID}`);
  const actual = distinctReadScopes(run);
  const allowed = role === "reference" || fixture.unscopedUnknown
    ? fixture.pairIds : expectedCandidateScopes(fixture);
  for (const counterpartId of actual) {
    assert(allowed.includes(counterpartId), `${label}: unexpected PairLedger scope ${counterpartId}`);
  }
  if (role === "reference") {
    assert.deepEqual(actual, fixture.pairIds, `${label}: exhaustive reference must read the full Owner Pair set`);
  } else if (!fixture.unscopedUnknown) {
    assert.deepEqual(actual, allowed, `${label}: candidate must read exactly its conservative Pair scope set`);
  }
  return actual;
}

function itemEvidence(result) {
  return (Array.isArray(result?.items) ? result.items : []).map(item => ({
    targetCharacterId: Number(item.targetCharacterId) || null,
    itemId: item.itemId || null,
    textSha256: sha256(item.text || ""),
    conversationDate: item.conversationDate || null,
    conversationTotalDays: item.conversationTotalDays ?? null,
    routeKind: item.routeKind || null,
    scope: {
      campaignToken: item.scope?.campaignToken || null,
      ownerId: Number(item.scope?.ownerId) || null,
      counterpartId: Number(item.scope?.counterpartId) || null
    },
    source: {
      sourceSummaryKey: item.source?.sourceSummaryKey || null,
      sourceRevision: item.source?.sourceRevision || null,
      sourceItemOrdinal: item.source?.sourceItemOrdinal ?? null
    }
  }));
}

function sourceEvidence(result) {
  return (Array.isArray(result?.sources) ? result.sources : []).map(source => ({
    sourceSummaryKey: source.sourceSummaryKey || null,
    sourceRevision: source.sourceRevision || null,
    sourceItemOrdinal: source.sourceItemOrdinal ?? null,
    contentSha256: sha256(source.memory?.content || ""),
    eventDate: source.memory?.eventDate || null,
    totalDays: source.memory?.totalDays ?? null,
    routeKind: source.routeKind || null,
    routeCharacterIds: Array.isArray(source.routeCharacterIds) ? source.routeCharacterIds.map(Number) : []
  }));
}

function assertFullEquivalent(reference, candidate, label) {
  assertEquivalent(reference, candidate, label);
  assert.deepEqual(itemEvidence(candidate.result), itemEvidence(reference.result),
    `${label}: complete item identities, order, date, source key/revision/ordinal and text hashes must match`);
  assert.deepEqual(sourceEvidence(candidate.result), sourceEvidence(reference.result),
    `${label}: complete resolved source pointers and content hashes must match`);
  assert.deepEqual(candidate.sample.requestedTemporal, reference.sample.requestedTemporal,
    `${label}: both arms must use the same temporal window`);
}

function assertUnknownDisposition(reference, candidate, fixture, label) {
  const same = stableJson(comparableSemantic(candidate.sample)) === stableJson(comparableSemantic(reference.sample));
  if (same) {
    assert.equal(candidate.sample.directory.candidatePairCount, fixture.pairCount,
      `${label}: unknown scope may use only a counted exhaustive fallback`);
    assert.equal(candidate.sample.directory.legacyScanFallbackCount, 1,
      `${label}: exhaustive fallback must be visible in diagnostics`);
    assert.deepEqual(distinctReadScopes(candidate), fixture.pairIds,
      `${label}: exhaustive fallback must actually read every Owner Pair`);
    assertFullEquivalent(reference, candidate, label);
    return "SAFE_EXHAUSTIVE_FALLBACK";
  }
  assert.equal(candidate.sample.semantic.itemCount, 0, `${label}: fail-closed unknown scope must inject no Legacy item`);
  assert.equal(candidate.sample.semantic.textSha256, sha256(""), `${label}: fail-closed unknown scope must inject no text`);
  assert.notEqual(candidate.sample.semantic.status, "INDEX_MISS",
    `${label}: an unknown scope refusal must not be reported as a proven search miss`);
  assert(!["COMPLETE", "SCOPED_DEGRADED"].includes(candidate.sample.directory.status),
    `${label}: unscoped unknown data must not be represented as complete coverage`);
  return "SAFE_FAIL_CLOSED";
}

function totalDaysForDate(date) {
  const normalized = normalizeGameDate(date);
  if (!normalized) return null;
  return currentTotalDays + normalized.serial - current.serial;
}

function assertTemporalSelection(run, temporal, label) {
  if (!temporal) return;
  assert(temporal.requested && temporal.triggered, `${label}: explicit temporal query must resolve a window`);
  assert.deepEqual(temporal.primaryWindow, temporal.expansionWindow,
    `${label}: explicit year and previous-year cases must use their declared exact window`);
  const metrics = run.result?.metrics || {};
  assert.equal(normalizeGameDate(metrics.timeWindowStart)?.serial, temporal.primaryWindow.fromTotalDays,
    `${label}: reported retrieval start must match the requested primary interval`);
  assert.equal(normalizeGameDate(metrics.timeWindowEnd)?.serial, temporal.primaryWindow.toTotalDays,
    `${label}: reported retrieval end must match the requested primary interval`);
  const items = Array.isArray(run.result?.items) ? run.result.items : [];
  const sources = Array.isArray(run.result?.sources) ? run.result.sources : [];
  const dates = [...new Set([
    ...items.map(item => item.conversationDate),
    ...sources.map(source => source.memory?.eventDate)
  ].filter(Boolean))].sort();
  assert.deepEqual(dates, ["1199.6.1"], `${label}: only the in-window 1199 synthetic item should be selected`);
  assert.equal(metrics.temporalExpansionUsed, false, `${label}: a primary-window match must not use expansion`);
  assert.equal(metrics.matchedWindowCount, 1, `${label}: exactly one synthetic matter should match the window`);
  for (const item of items) {
    const totalDays = totalDaysForDate(item.conversationDate);
    assert.equal(Number(item.conversationTotalDays), totalDays,
      `${label}: conversationDate must map into the request game-day axis`);
    assert(totalDays >= temporal.primaryWindow.fromTotalDays && totalDays <= temporal.primaryWindow.toTotalDays,
      `${label}: returned item must fall within the primary retrieval interval`);
  }
  for (const source of sources) {
    const totalDays = totalDaysForDate(source.memory?.eventDate);
    assert.equal(Number(source.memory?.totalDays), totalDays,
      `${label}: resolved source date must map into the request game-day axis`);
    assert(totalDays >= temporal.primaryWindow.fromTotalDays && totalDays <= temporal.primaryWindow.toTotalDays,
      `${label}: resolved source must fall within the primary retrieval interval`);
  }
}

function recordedSample(run, role, temporal) {
  return {
    ...sampleRow(run, role),
    requestedTemporal: temporal,
    itemEvidence: itemEvidence(run.result),
    sourceEvidence: sourceEvidence(run.result),
    distinctReadScopes: distinctReadScopes(run)
  };
}

function runCell(spec, benchmark) {
  const fixture = makeFixture(`${runMode}-${spec.key}`, spec.pairCount, spec.uncertainCount,
    spec.queryCase, { unscopedUnknown: spec.unscopedUnknown,
      summaryDatesByPair: spec.summaryDatesByPair, queryText: spec.queryText });
  const referenceContext = createContext(fixture, "exhaustive-reference", `${spec.key}-reference`);
  const candidateContext = createContext(fixture, "safe-candidate-directory", `${spec.key}-candidate`);
  const reference = runRetrieval(referenceContext, spec.level, {
    timingRole: "A_EXHAUSTIVE_REFERENCE_SINGLE_COLD_NOT_P95", temporal: spec.temporal
  });
  const cold = runRetrieval(candidateContext, spec.level, {
    timingRole: "B_SAFE_CANDIDATE_SINGLE_COLD", temporal: spec.temporal
  });
  runState.totalRetrievalCalls += 2;
  assertPermissionCounts(reference, `${spec.key}-reference`);
  assertPermissionCounts(cold, `${spec.key}-cold`);
  assertReadScopes(reference, fixture, "reference", `${spec.key}-reference`);
  assertReadScopes(cold, fixture, "candidate", `${spec.key}-cold`);

  let unknownDisposition = null;
  const compareCandidate = (candidate, suffix) => {
    const label = `${spec.key}-${suffix}`;
    assertPermissionCounts(candidate, label);
    assertReadScopes(candidate, fixture, "candidate", label);
    if (spec.unscopedUnknown) {
      const disposition = assertUnknownDisposition(reference, candidate, fixture, label);
      if (unknownDisposition != null) assert.equal(disposition, unknownDisposition, `${label}: disposition must stay stable`);
      unknownDisposition = disposition;
    } else {
      assertFullEquivalent(reference, candidate, label);
      assertScopedCandidate(candidate, fixture, spec.level, label);
    }
    assertTemporalSelection(candidate, spec.temporal, label);
  };
  compareCandidate(cold, "cold");

  const coldRow = recordedSample(cold, "B_SAFE_CANDIDATE_COLD", spec.temporal);
  const referenceRow = recordedSample(reference, "A_EXHAUSTIVE_REFERENCE_SINGLE_COLD", spec.temporal);
  const cell = {
    key: spec.key,
    pairCount: spec.pairCount,
    uncertainScopeCount: spec.uncertainCount,
    queryCase: spec.queryCase,
    level: spec.level,
    windowKind: spec.windowKind,
    currentGameDate: CURRENT_DATE,
    currentTotalDays,
    temporal: spec.temporal,
    unscopedUnknown: spec.unscopedUnknown,
    reference: { sample: referenceRow, credibleP95: false },
    candidate: { cold: [coldRow], coldSummary: summarizeWall([coldRow], { credibleP95: false }), warm: [] },
    equivalent: !spec.unscopedUnknown || unknownDisposition === "SAFE_EXHAUSTIVE_FALLBACK",
    disposition: unknownDisposition,
    warmSummary: null,
    performanceGateFailures: []
  };

  if (benchmark) {
    for (let index = 0; index < WARM_SAMPLES; index++) {
      const warm = runRetrieval(candidateContext, spec.level, {
        timingRole: "B_SAFE_CANDIDATE_WARM_AFTER_SINGLE_MEASURED_COLD", temporal: spec.temporal
      });
      runState.totalRetrievalCalls++;
      compareCandidate(warm, `warm-${index + 1}`);
      cell.candidate.warm.push(recordedSample(warm, "B_SAFE_CANDIDATE_WARM", spec.temporal));
    }
    cell.warmSummary = summarizeWall(cell.candidate.warm);
    applyPerformanceGates(cell);
  }

  return cell;
}

function addGateFailure(cell, metric, limitMs, observedMs) {
  if (observedMs <= limitMs) return;
  const failure = { cellKey: cell.key, metric, limitMs, observedMs };
  cell.performanceGateFailures.push(failure);
  runState.gateFailures.push(failure);
}

function applyPerformanceGates(cell) {
  if (cell.pairCount === 300 && cell.uncertainScopeCount === 0
      && cell.queryCase === "directhit" && cell.windowKind === "normal") {
    addGateFailure(cell, "candidateWarmP50", 1000, cell.warmSummary.p50Ms);
    addGateFailure(cell, "candidateWarmP95", 2000, cell.warmSummary.p95Ms);
  } else if (cell.pairCount === 300 && cell.uncertainScopeCount > 0 && cell.uncertainScopeCount <= 5) {
    addGateFailure(cell, "candidateWarmP95", 2000, cell.warmSummary.p95Ms);
  } else if (cell.pairCount === 300 && cell.uncertainScopeCount <= 10
      && cell.uncertainScopeCount > 5) {
    addGateFailure(cell, "candidateWarmP95", 2500, cell.warmSummary.p95Ms);
  }
}

function assertTemporalReadParity(cells) {
  const normal = new Map(cells.filter(cell => cell.windowKind === "normal")
    .map(cell => [`${cell.pairCount}-${cell.level}`, cell]));
  for (const cell of cells.filter(item => ["explicit-1199", "previous-year"].includes(item.windowKind))) {
    const baseline = normal.get(`${cell.pairCount}-${cell.level}`);
    assert(baseline, `${cell.key}: matching no-window baseline is required`);
    const baselineScopes = baseline.candidate.warm[0]?.distinctReadScopes || baseline.candidate.cold[0].distinctReadScopes;
    const temporalScopes = cell.candidate.warm[0]?.distinctReadScopes || cell.candidate.cold[0].distinctReadScopes;
    assert(temporalScopes.length <= baselineScopes.length,
      `${cell.key}: temporal filtering must not increase distinct PairLedger read scopes`);
    for (const counterpartId of temporalScopes) {
      assert(baselineScopes.includes(counterpartId),
        `${cell.key}: temporal filtering must not introduce PairLedger scope ${counterpartId}`);
    }
  }
}

function run() {
  const specs = runMode === "benchmark" ? benchmarkSpecs() : correctnessSpecs();
  if (runMode === "benchmark") {
    runState.plan.benchmarkCells = specs.map(({ key, pairCount, level, windowKind, uncertainCount, queryCase, unscopedUnknown }) =>
      ({ key, pairCount, level, windowKind, uncertainCount, queryCase, unscopedUnknown,
        referenceCold: 1, candidateCold: 1, candidateWarm: WARM_SAMPLES }));
  } else {
    runState.plan.correctnessCells = specs.map(({ key, pairCount, level, windowKind, uncertainCount, queryCase, unscopedUnknown }) =>
      ({ key, pairCount, level, windowKind, uncertainCount, queryCase, unscopedUnknown }));
  }
  const cells = [];
  for (const spec of specs) {
    const cell = runCell(spec, runMode === "benchmark");
    cells.push(cell);
    if (runMode === "benchmark") runState.benchmarkCells.push(cell);
    else runState.correctnessCells.push(cell);
    flushRaw();
  }
  if (runMode === "benchmark") {
    assertTemporalReadParity(cells.filter(cell => cell.queryCase === "directhit"));
  }
}

function main() {
  try {
    run();
    runState.completed = runState.gateFailures.length === 0;
  } catch (error) {
    runState.failures.push({ name: error?.name || "Error",
      code: error?.code || "INTEGRATED_AB_ASSERTION_FAILED",
      message: String(error?.message || error?.code || error?.name || "INTEGRATED_AB_ASSERTION_FAILED").slice(0, 160) });
  } finally {
    try { flushRaw(); }
    finally { harness.cleanupFixtureRoot(); }
  }
  const count = runMode === "benchmark" ? runState.benchmarkCells.length : runState.correctnessCells.length;
  console.log(`${runState.completed ? "PASS" : "FAIL"} V9.3.6.3 integrated A/B ${runMode}: ${count} cells, `
    + `${runState.totalRetrievalCalls} retrieval calls, raw=${path.relative(repoRoot, outputPath)}`);
  if (runState.gateFailures.length) console.error(`PERFORMANCE GATES FAILED: ${runState.gateFailures.length}`);
  if (!runState.completed) process.exitCode = 1;
}

if (require.main === module) main();
