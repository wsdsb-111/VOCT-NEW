"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { performance } = require("node:perf_hooks");

const repoRoot = path.resolve(__dirname, "..");
const baselineCommit = "fbe8cc3fc1abc45c6e41bb6ba16bc00e0dc46c54";
const retrievalPath = path.join(repoRoot, "src", "app", "main", "memory-system", "pair-memory-source-retrieval.js");
const outputPath = path.join(repoRoot, ".build", "v9362-pair-performance-ab-raw.json");
const estimateOutputPath = path.join(repoRoot, ".build", "v9362-pair-performance-baseline-estimate.json");
const candidateEstimateOutputPath = path.join(repoRoot, ".build", "v9362-pair-performance-candidate-estimate.json");
const indexBuildAuditOutputPath = path.join(repoRoot, ".build", "v9362-index-build-audit.json");
const benchmarkRequested = process.argv.includes("--benchmark");
const baselineEstimateRequested = process.argv.includes("--baseline-estimate");
const candidateEstimateRequested = process.argv.includes("--candidate-estimate");
const indexBuildAuditRequested = process.argv.includes("--build-count-audit");
const OWNER_ID = 200;
const PLAYER_ID = 100;
const TARGET_ID = 300;
const CAMPAIGN = "v9362-synthetic-campaign";
const CURRENT_DATE = "1200.1.1";
const TARGET_NAME = "玛蒂尔达";
const SIZE_SET = [5, 30, 100, 300];
const NORMAL_CASES = ["directhit", "sparsehearsay", "miss"];
const ALL_CASES = [...NORMAL_CASES, "allmention-worst"];
const LEVELS = ["L0", "L1", "L2"];
const PERFORMANCE_TARGETS = {
  5: { warmP95Ms: 100 },
  30: { warmP95Ms: 250 },
  100: { warmP95Ms: 500 },
  300: { warmP50Ms: 1000, warmP95Ms: 2000, coldP95Ms: 5000 }
};
let checks = 0;

const sourceVersionPath = require.resolve("../src/app/main/version");
require.cache[sourceVersionPath] = {
  id: sourceVersionPath,
  filename: sourceVersionPath,
  loaded: true,
  exports: require("../resources/app/out/main/version")
};

const currentMemoryEngine = require("../src/app/main/memory-system/memory-engine").MemoryEngine;
const { normalizeGameDate } = require("../src/app/main/worldline/character-temporal-facts");
const currentRetrieval = require(retrievalPath).retrievePairMemorySources;
const CURRENT_TOTAL_DAYS = normalizeGameDate(CURRENT_DATE).serial;

function loadFrozenModule(relativePath, requireOverrides = {}) {
  const source = execFileSync("git", ["show", baselineCommit + ":" + relativePath],
    { cwd: repoRoot, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
  const filename = path.join(repoRoot, ...relativePath.split("/"));
  const frozenModule = new Module(filename, module);
  frozenModule.filename = filename;
  frozenModule.paths = Module._nodeModulePaths(path.dirname(filename));
  const originalRequire = frozenModule.require.bind(frozenModule);
  frozenModule.require = request => Object.prototype.hasOwnProperty.call(requireOverrides, request)
    ? requireOverrides[request] : originalRequire(request);
  frozenModule._compile(source, filename);
  return {
    exports: frozenModule.exports,
    sourcePath: relativePath,
    sourceSha256: crypto.createHash("sha256").update(source).digest("hex")
  };
}

const baselinePairLedgerModule = loadFrozenModule("src/app/main/memory-system/pair-long-term-ledger.js");
const baselineMemoryStoreModule = loadFrozenModule("src/app/main/memory-system/memory-store.js", {
  "./pair-long-term-ledger": baselinePairLedgerModule.exports
});
const baselineMemoryEngineModule = loadFrozenModule("src/app/main/memory-system/memory-engine.js", {
  "./memory-store": baselineMemoryStoreModule.exports
});
const baselineRetrievalModule = loadFrozenModule("src/app/main/memory-system/pair-memory-source-retrieval.js");
const baselineMemoryEngine = baselineMemoryEngineModule.exports.MemoryEngine;
const baselineRetrieval = baselineRetrievalModule.exports.retrievePairMemorySources;
const baselineModules = {
  memoryEngine: baselineMemoryEngineModule,
  memoryStore: baselineMemoryStoreModule,
  pairLongTermLedger: baselinePairLedgerModule,
  pairMemorySourceRetrieval: baselineRetrievalModule
};
const candidateModules = {
  memoryEngine: { sourcePath: "src/app/main/memory-system/memory-engine.js" },
  memoryStore: { sourcePath: "src/app/main/memory-system/memory-store.js" },
  pairLongTermLedger: { sourcePath: "src/app/main/memory-system/pair-long-term-ledger.js" },
  pairMemorySourceRetrieval: { sourcePath: "src/app/main/memory-system/pair-memory-source-retrieval.js" },
  ownerTargetCandidateDirectory: { sourcePath: "src/app/main/memory-system/owner-target-candidate-directory.js" }
};
const candidateModuleSources = sourceEvidence(candidateModules, true);

function sourceSha256(relativePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(path.join(repoRoot, relativePath))).digest("hex");
}

function sourceEvidence(modules, includeCandidateHashes = false) {
  return Object.fromEntries(Object.entries(modules).map(([name, entry]) => [name, {
    sourcePath: entry.sourcePath,
    sourceSha256: includeCandidateHashes ? sourceSha256(entry.sourcePath) : entry.sourceSha256
  }]));
}

function check(name, fn) {
  fn();
  checks++;
  console.log("PASS " + name);
}

function tokenCount(value) {
  return Math.ceil(String(value || "").length / 2);
}

function makeSummary(counterpartId, counterpartName, finalizationId, matter, ownerId = OWNER_ID, ownerName = "回应者乙") {
  return {
    date: "1190.1.1",
    totalDays: normalizeGameDate("1190.1.1").serial,
    content: "合成叙事。\n\n【需要长期记住的事项】\n- " + matter + "\n【其他事项】\n合成来源。",
    playerId: ownerId,
    playerName: ownerName,
    characterId: counterpartId,
    characterName: counterpartName,
    perspectiveOwnerId: ownerId,
    campaignToken: CAMPAIGN,
    campaignBinding: { status: "bound", source: "synthetic_fixture", version: 1 },
    finalizationId,
    conversationId: "conversation-" + finalizationId,
    conversationType: "pair",
    participants: [{ id: ownerId, name: ownerName }, { id: counterpartId, name: counterpartName }]
  };
}

function matterFor(caseName, index, counterpartName) {
  const marker = "QA_V9362_" + caseName.replace(/[^a-z0-9]+/giu, "_").toUpperCase() + "_" + index;
  const mentionsTarget = caseName === "allmention-worst"
    || caseName === "directhit" && index === 0
    || caseName === "sparsehearsay" && index === 1;
  const hasSearchTerm = caseName === "allmention-worst"
    || caseName === "directhit" && index === 0
    || caseName === "sparsehearsay" && index === 1;
  const targetClause = mentionsTarget ? TARGET_NAME : "一位旅人";
  const body = hasSearchTerm ? "盐税安排" : "城门维护";
  const relation = index === 0 ? "与回应者乙商议" : counterpartName + "转述";
  return { marker, text: marker + "：" + relation + targetClause + "谈及" + body + "。", mentionsTarget, hasSearchTerm };
}

function makeFixture(tempRoot, label, pairCount, caseName) {
  const root = path.join(tempRoot, label);
  const summaryFoldersDir = path.join(root, "summaries");
  const ownerFolder = path.join(summaryFoldersDir, OWNER_ID + "_回应者乙");
  fs.mkdirSync(ownerFolder, { recursive: true });
  fs.mkdirSync(path.join(summaryFoldersDir, TARGET_ID + "_" + TARGET_NAME), { recursive: true });
  const pairs = [];
  const serializedSummaries = [];
  for (let index = 0; index < pairCount; index++) {
    const counterpartId = index === 0 ? TARGET_ID : 1000 + index;
    const counterpartName = index === 0 ? TARGET_NAME : "合成人物" + counterpartId;
    const matter = matterFor(caseName, index, counterpartName);
    const finalizationId = "v9362-" + label + "-" + counterpartId;
    const summary = makeSummary(counterpartId, counterpartName, finalizationId, matter.text);
    const filePath = path.join(ownerFolder, "与" + counterpartName + "的对话.json");
    fs.writeFileSync(filePath, JSON.stringify([summary], null, 2), "utf8");
    pairs.push({ counterpartId, counterpartName, marker: matter.marker, matter: matter.text, summary, filePath });
    serializedSummaries.push(summary);
  }
  const reversePrivate = makeSummary(OWNER_ID, "回应者乙", "reverse-private-" + label,
    "QA_V9362_REVERSE_PRIVATE：" + TARGET_NAME + "对回应者乙的私人叙述。", TARGET_ID, TARGET_NAME);
  fs.writeFileSync(path.join(summaryFoldersDir, TARGET_ID + "_" + TARGET_NAME, "与回应者乙的对话.json"),
    JSON.stringify([reversePrivate], null, 2), "utf8");
  serializedSummaries.push(reversePrivate);
  return {
    label,
    pairCount,
    caseName,
    summaryFoldersDir,
    ownerFolder,
    pairs,
    datasetSha256: crypto.createHash("sha256").update(JSON.stringify(serializedSummaries)).digest("hex")
  };
}

function createContext(fixture, armLabel, retriever) {
  const baseDir = path.join(path.dirname(fixture.summaryFoldersDir), "memory-" + armLabel);
  const MemoryEngineClass = retriever === baselineRetrieval ? baselineMemoryEngine : currentMemoryEngine;
  const engine = new MemoryEngineClass({ baseDir, summaryFoldersDir: fixture.summaryFoldersDir, trace: { record() {} } });
  const memories = engine.store.loadFolderSummariesForCharacter(OWNER_ID);
  return { engine, memories, baseDir };
}

function makeDecision(level) {
  return {
    level,
    responderId: OWNER_ID,
    playerAnchorId: PLAYER_ID,
    targetCharacterIds: level === "L0" ? [] : [TARGET_ID],
    targetEvidence: "UNIQUE_ALIAS",
    historyIntent: level === "L2" ? "DETAIL" : level === "L1" ? "RELATIONSHIP" : "NONE",
    explicitSourceDetailRequested: level === "L2",
    denialDetected: false,
    reasonCode: level === "L0" ? "NO_HISTORICAL_INTENT" : "EXPLICIT_HISTORY_REQUEST",
    queryFingerprint: "v9362-synthetic-" + level
  };
}

function makeRetrievalOptions(context, fixture, level, retrievalMode) {
  const mode = level === "L2" ? "THIRD_PERSON_SOURCE_DETAIL" : "THIRD_PERSON_LEDGER";
  return {
    mode,
    retrievalMode,
    store: context.engine.store,
    ownerId: OWNER_ID,
    decision: makeDecision(level),
    entitiesProfile: [{ characterId: TARGET_ID, name: TARGET_NAME, aliases: [TARGET_NAME] }],
    campaignToken: CAMPAIGN,
    currentGameDate: CURRENT_DATE,
    currentTotalDays: CURRENT_TOTAL_DAYS,
    memories: context.memories,
    query: fixture.caseName === "miss" ? "盐税从未提过" : "盐税安排",
    tokenBudget: 100000,
    estimateTokens: tokenCount
  };
}

function instrumentPairLedger(ledger) {
  const originalRead = ledger.read.bind(ledger);
  const originalBuildIndex = ledger.buildIndex;
  const hadOwnBuildIndex = Object.prototype.hasOwnProperty.call(ledger, "buildIndex");
  const originalResolve = ledger.resolveSource.bind(ledger);
  const counts = { readCount: 0, readCacheHits: 0, readCacheMisses: 0, builds: 0,
    buildScopes: [], resolveAttempts: 0, scopes: [] };
  ledger.read = (...args) => {
    counts.readCount++;
    const scope = args[0] || {};
    counts.scopes.push(Number(scope.counterpartId));
    const result = originalRead(...args);
    if (result && result.cacheHit === true) counts.readCacheHits++;
    else counts.readCacheMisses++;
    return result;
  };
  ledger.buildIndex = (...args) => {
    counts.builds++;
    counts.buildScopes.push(Number(args[0]?.counterpartId));
    return originalBuildIndex.apply(ledger, args);
  };
  ledger.resolveSource = (...args) => {
    counts.resolveAttempts++;
    return originalResolve(...args);
  };
  return {
    counts,
    restore() {
      ledger.read = originalRead;
      if (hadOwnBuildIndex) ledger.buildIndex = originalBuildIndex;
      else delete ledger.buildIndex;
      ledger.resolveSource = originalResolve;
    }
  };
}

function invoke(retriever, context, fixture, level, retrievalMode) {
  return retriever(makeRetrievalOptions(context, fixture, level, retrievalMode));
}

function markerIds(result) {
  return (Array.isArray(result.items) ? result.items : []).map(item => {
    const match = String(item.text || "").match(/QA_V9362_[A-Z0-9_]+/u);
    return match ? match[0] : String(item.itemId || "");
  });
}

function sourceIds(result) {
  return (Array.isArray(result.sources) ? result.sources : []).map(source => ({
    sourceSummaryKey: source.sourceSummaryKey || source.memory?.memoryId || null,
    sourceRevision: source.sourceRevision || null,
    targetCharacterId: source.targetCharacterId || null
  }));
}

function resultIdentity(result) {
  const text = String(result.text || "");
  return {
    textSha256: crypto.createHash("sha256").update(text).digest("hex"),
    markerIds: markerIds(result),
    sourceIds: sourceIds(result),
    fallbackStatus: result.fallbackStatus || null
  };
}

function finiteMetric(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function metricSnapshot(result, counts, fixturePairCount) {
  const metrics = result.metrics || {};
  const reportedIndexReadCount = finiteMetric(metrics.actualIndexReadCount);
  const observedReadCount = counts.readCount;
  const actualIndexReadCount = reportedIndexReadCount === null
    ? observedReadCount : Math.max(observedReadCount, reportedIndexReadCount);
  const candidatePairCount = finiteMetric(metrics.candidatePairCount)
    ?? (Array.isArray(metrics.scopeRevisions) ? metrics.scopeRevisions.length : null);
  const ownerPairCount = finiteMetric(metrics.ownerPairCount) ?? fixturePairCount;
  const candidateReductionRatio = finiteMetric(metrics.candidateReductionRatio)
    ?? (ownerPairCount > 0 && candidatePairCount !== null
      ? (ownerPairCount - candidatePairCount) / ownerPairCount : null);
  const directoryBuildCount = finiteMetric(metrics.candidateDirectoryBuildCount)
    ?? finiteMetric(metrics.candidateDirectoryRebuildCount)
    ?? (metrics.candidateDirectoryCacheHit === false && metrics.candidateDirectoryStatus === "COMPLETE"
      ? 1 : null);
  const reportedPairIndexRebuildCount = finiteMetric(metrics.pairIndexRebuildCount)
    ?? finiteMetric(metrics.indexRebuildCount);
  const pairIndexRebuildCount = finiteMetric(counts.builds) ?? reportedPairIndexRebuildCount;
  return {
    candidateDirectoryStatus: metrics.candidateDirectoryStatus || null,
    candidateDirectoryCacheHit: typeof metrics.candidateDirectoryCacheHit === "boolean" ? metrics.candidateDirectoryCacheHit : null,
    candidateDirectoryBuildMs: finiteMetric(metrics.candidateDirectoryBuildMs),
    candidateDirectoryBuildCount: directoryBuildCount,
    pairIndexRebuildCount,
    interceptedPairIndexBuildCount: counts.builds,
    reportedPairIndexRebuildCount,
    pairIndexBuildScopes: counts.buildScopes,
    pairIndexCacheMissCount: counts.readCacheMisses,
    candidatePairCount,
    ownerPairCount,
    candidateReductionRatio,
    actualIndexReadCount,
    interceptedPairLedgerReadCount: observedReadCount,
    reportedIndexReadCount,
    readCountAccountingDelta: reportedIndexReadCount === null ? null : observedReadCount - reportedIndexReadCount,
    uniqueReadScopeCount: new Set(counts.scopes).size,
    indexCacheHits: Math.max(counts.readCacheHits, finiteMetric(metrics.indexCacheHits) || 0),
    indexCacheMisses: Math.max(counts.readCacheMisses, finiteMetric(metrics.indexCacheMisses) || 0),
    scopeRevisionChecks: finiteMetric(metrics.scopeRevisionChecks)
      ?? (Array.isArray(metrics.scopeRevisions) ? metrics.scopeRevisions.length : null),
    legacyScanFallbackCount: finiteMetric(metrics.legacyScanFallbackCount)
      ?? (metrics.legacyScanFallbackUsed === true ? 1 : 0),
    legacyScanFallbackReason: metrics.legacyScanFallbackReason || metrics.fallbackReason || null,
    indexLookupMs: finiteMetric(metrics.indexLookupMs),
    sourceResolveAttemptCount: counts.resolveAttempts,
    memoryLevel: metrics.memoryLevel || null
  };
}

function measureOnce(retriever, context, fixture, level, retrievalMode) {
  const instrumentation = instrumentPairLedger(context.engine.store.pairLedger);
  const memoryBefore = process.memoryUsage();
  const cpuStart = process.cpuUsage();
  const started = performance.now();
  let result;
  try {
    result = invoke(retriever, context, fixture, level, retrievalMode);
  } finally {
    instrumentation.restore();
  }
  const wallMs = performance.now() - started;
  const cpu = process.cpuUsage(cpuStart);
  const memoryAfter = process.memoryUsage();
  const resourceUsage = process.resourceUsage();
  const sample = {
    wallMs,
    cpuMs: (cpu.user + cpu.system) / 1000,
    rssBeforeBytes: memoryBefore.rss,
    rssAfterBytes: memoryAfter.rss,
    rssDeltaBytes: memoryAfter.rss - memoryBefore.rss,
    heapUsedBeforeBytes: memoryBefore.heapUsed,
    heapUsedAfterBytes: memoryAfter.heapUsed,
    heapUsedDeltaBytes: memoryAfter.heapUsed - memoryBefore.heapUsed,
    processPeakRssNative: resourceUsage.maxRSS,
    metrics: metricSnapshot(result, instrumentation.counts, fixture.pairCount),
    fallbackStatus: result.fallbackStatus || null,
    selectedItemCount: Array.isArray(result.items) ? result.items.length : 0,
    selectedMarkers: markerIds(result),
    sourceCount: Array.isArray(result.sources) ? result.sources.length : 0,
    identity: resultIdentity(result)
  };
  if (sample.metrics.sourceResolveAttemptCount > 2 && level === "L2") {
    assert.fail("L2 source resolve attempts exceeded the two-attempt contract");
  }
  if (level === "L0") {
    assert.equal(sample.metrics.actualIndexReadCount, 0, "L0 must perform zero third-person index reads");
    assert.equal(sample.metrics.sourceResolveAttemptCount, 0, "L0 must perform zero source resolves");
  }
  if (level === "L1") {
    assert.equal(sample.metrics.sourceResolveAttemptCount, 0, "L1 must perform zero source resolves");
  }
  return { sample, result };
}

function percentile(values, fraction) {
  const sorted = values.map(Number).sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] || 0;
}

function summarizeSamples(samples) {
  const fields = ["wallMs", "cpuMs", "rssDeltaBytes", "heapUsedDeltaBytes"];
  const summary = { sampleCount: samples.length };
  for (const field of fields) {
    const values = samples.map(sample => sample[field]);
    summary[field] = { p50: percentile(values, 0.50), p95: percentile(values, 0.95), max: Math.max(0, ...values) };
  }
  summary.processPeakRssNativeHighWater = samples.length
    ? Math.max(...samples.map(sample => Number(sample.processPeakRssNative) || 0)) : 0;
  const metricFields = ["candidateDirectoryBuildMs", "candidateDirectoryBuildCount", "pairIndexRebuildCount",
    "interceptedPairIndexBuildCount", "reportedPairIndexRebuildCount", "pairIndexCacheMissCount",
    "candidatePairCount", "ownerPairCount",
    "candidateReductionRatio", "actualIndexReadCount", "indexCacheHits", "indexCacheMisses",
    "interceptedPairLedgerReadCount", "reportedIndexReadCount", "readCountAccountingDelta",
    "uniqueReadScopeCount", "scopeRevisionChecks",
    "legacyScanFallbackCount", "indexLookupMs", "sourceResolveAttemptCount"];
  summary.metrics = {};
  for (const field of metricFields) {
    const values = samples.map(sample => sample.metrics[field]).filter(value => finiteMetric(value) !== null).map(Number);
    summary.metrics[field] = values.length
      ? { p50: percentile(values, 0.50), p95: percentile(values, 0.95), max: Math.max(...values) }
      : null;
  }
  summary.fallbackStatuses = [...new Set(samples.map(sample => sample.fallbackStatus))].sort();
  summary.candidateDirectoryStatuses = [...new Set(samples.map(sample => sample.metrics.candidateDirectoryStatus))].sort();
  summary.candidateDirectoryCache = {
    hits: samples.filter(sample => sample.metrics.candidateDirectoryCacheHit === true).length,
    misses: samples.filter(sample => sample.metrics.candidateDirectoryCacheHit === false).length,
    unknown: samples.filter(sample => sample.metrics.candidateDirectoryCacheHit === null).length
  };
  return summary;
}

function runWarmSamples(retriever, fixture, armLabel, level, retrievalMode, count) {
  const context = createContext(fixture, armLabel + "-warm", retriever);
  invoke(retriever, context, fixture, level, retrievalMode);
  const samples = [];
  for (let index = 0; index < count; index++) {
    const measured = measureOnce(retriever, context, fixture, level, retrievalMode);
    samples.push(measured.sample);
    if (index === 0 || (index + 1) % 5 === 0) {
      console.log("MEASURE " + armLabel + " " + fixture.pairCount + " " + fixture.caseName + " "
        + level + " warm " + (index + 1) + "/" + count + " " + measured.sample.wallMs.toFixed(2) + " ms");
    }
  }
  return samples;
}

function runColdSamples(retriever, fixture, armLabel, level, retrievalMode, count) {
  const samples = [];
  for (let index = 0; index < count; index++) {
    const context = createContext(fixture, armLabel + "-cold-" + index, retriever);
    const measured = measureOnce(retriever, context, fixture, level, retrievalMode);
    samples.push(measured.sample);
    if (index === 0 || (index + 1) % 5 === 0) {
      console.log("MEASURE " + armLabel + " " + fixture.pairCount + " " + fixture.caseName + " "
        + level + " cold " + (index + 1) + "/" + count + " " + measured.sample.wallMs.toFixed(2) + " ms");
    }
  }
  return samples;
}

function runCorrectnessChecks(tempRoot) {
  const cases = ["directhit", "sparsehearsay", "miss", "allmention-worst"];
  const baselineChainFixture = makeFixture(tempRoot, "correctness-frozen-chain", 5, "directhit");
  const baselineChainContext = createContext(baselineChainFixture, "reference-frozen-chain", baselineRetrieval);
  check("reference Engine, Store, and PairLedger all come from the frozen baseline", () => {
    assert.equal(baselineChainContext.engine.constructor, baselineMemoryEngine);
    assert.equal(baselineChainContext.engine.store.constructor, baselineMemoryStoreModule.exports.MemoryStore);
    assert.equal(baselineChainContext.engine.store.pairLedger.constructor, baselinePairLedgerModule.exports);
  });
  for (const caseName of cases) {
    const fixture = makeFixture(tempRoot, "correctness-" + caseName, 5, caseName);
    for (const level of LEVELS) {
      const baselineContext = createContext(fixture, "reference-" + caseName + "-" + level, baselineRetrieval);
      const candidateContext = createContext(fixture, "candidate-" + caseName + "-" + level, currentRetrieval);
      const baseline = measureOnce(baselineRetrieval, baselineContext, fixture, level, "exhaustive-reference");
      const candidate = measureOnce(currentRetrieval, candidateContext, fixture, level, "safe-candidate-directory");
      check(caseName + " " + level + " output matches frozen V9.3.6.1 oracle", () => {
        assert.deepEqual(candidate.sample.identity, baseline.sample.identity);
      });
      if (level !== "L0") {
        const expectedCandidatePairCount = caseName === "allmention-worst" ? fixture.pairCount
          : caseName === "sparsehearsay" ? 2 : 1;
        check(caseName + " " + level + " uses every required scope and excludes unrelated scopes", () => {
          assert.equal(candidate.sample.metrics.candidatePairCount, expectedCandidatePairCount);
        });
      }
      if (caseName === "allmention-worst" && level !== "L0") {
        check(caseName + " " + level + " retains all legal Pair mentions without Top-N scope truncation", () => {
          assert.equal(candidate.sample.metrics.candidatePairCount, fixture.pairCount);
          assert(candidate.sample.metrics.actualIndexReadCount >= fixture.pairCount,
            "all mentioning Pair scopes must remain readable");
        });
      }
    }
  }
}

function runBaselineEstimate(tempRoot) {
  const rows = [];
  for (const pairCount of [5, 30]) {
    for (const caseName of ALL_CASES) {
      const fixture = makeFixture(tempRoot, "estimate-" + pairCount + "-" + caseName, pairCount, caseName);
      for (const level of LEVELS) {
        const coldSamples = runColdSamples(baselineRetrieval, fixture, "exhaustive-reference-" + level, level,
          "exhaustive-reference", 1);
        const warmSamples = runWarmSamples(baselineRetrieval, fixture, "exhaustive-reference-" + level, level,
          "exhaustive-reference", 2);
        rows.push({ pairCount, caseName, level, datasetSha256: fixture.datasetSha256,
          cold: { summary: summarizeSamples(coldSamples), samples: coldSamples },
          warm: { summary: summarizeSamples(warmSamples), samples: warmSamples } });
      }
    }
  }
  return {
    schemaVersion: 1,
    task: "V9.3.6.2 frozen legacy Pair retrieval baseline calibration",
    status: "CALIBRATION_ONLY_NOT_P95",
    createdAt: new Date().toISOString(),
    baseline: { sourceCommit: baselineCommit,
      sourcePath: "src/app/main/memory-system/pair-memory-source-retrieval.js",
      sourceSha256: baselineRetrievalModule.sourceSha256,
      frozenModules: sourceEvidence(baselineModules),
      retrievalMode: "fbe8cc3 frozen Engine/Store/Ledger/retrieval; full-scope reference" },
    candidate: { currentModuleSources: candidateModuleSources, retrievalMode: "safe-candidate-directory" },
    environment: environmentInfo(),
    samplePlan: { sizes: [5, 30], coldPerCaseAndLevel: 1, warmPerCaseAndLevel: 2,
      note: "Small calibration only; sample counts are too small for a credible P95." },
    fixturePlan: { ownerPairCounts: [5, 30], cases: ALL_CASES, levels: LEVELS,
      generatedInputsOnly: true, realAppDataSaveProviderNetwork: false },
    rows
  };
}

function runCandidateEstimate(tempRoot) {
  const rows = [];
  for (const pairCount of [100, 300]) {
    for (const caseName of NORMAL_CASES) {
      const fixture = makeFixture(tempRoot, "candidate-estimate-" + pairCount + "-" + caseName, pairCount, caseName);
      for (const level of ["L1", "L2"]) {
        const coldSamples = runColdSamples(currentRetrieval, fixture,
          "candidate-estimate-" + fixture.caseName + "-" + level, level,
          "safe-candidate-directory", 1);
        const warmSamples = runWarmSamples(currentRetrieval, fixture,
          "candidate-estimate-" + fixture.caseName + "-" + level, level,
          "safe-candidate-directory", 2);
        const expectedCandidatePairCount = caseName === "sparsehearsay" ? 2 : 1;
        for (const sample of [...coldSamples, ...warmSamples]) {
          assert.equal(sample.metrics.candidatePairCount, expectedCandidatePairCount,
            "candidate estimate must retain all target-bearing scopes and exclude unrelated scopes");
        }
        rows.push({
          pairCount,
          caseName,
          level,
          datasetSha256: fixture.datasetSha256,
          target: PERFORMANCE_TARGETS[pairCount],
          candidate: {
            samplePlan: { cold: 1, warm: 2, status: "DIAGNOSTIC_ONLY_NOT_P95" },
            cold: { summary: summarizeSamples(coldSamples), samples: coldSamples },
            warm: { summary: summarizeSamples(warmSamples), samples: warmSamples }
          }
        });
      }
    }
  }
  return {
    schemaVersion: 1,
    task: "V9.3.6.2 candidate-only Pair retrieval performance estimate",
    status: "DIAGNOSTIC_ONLY_NOT_P95_OR_RELEASE_GATE",
    createdAt: new Date().toISOString(),
    baselineInvoked: false,
    candidate: {
      currentModuleSources: candidateModuleSources,
      retrievalMode: "safe-candidate-directory"
    },
    environment: environmentInfo(),
    samplePlan: {
      sizes: [100, 300],
      cases: NORMAL_CASES,
      levels: ["L1", "L2"],
      coldPerCaseAndLevel: 1,
      warmPerCaseAndLevel: 2,
      note: "Rapid candidate-only diagnostic; insufficient for P95 or release-gate claims."
    },
    fixturePlan: {
      ownerPairCounts: [100, 300],
      cases: NORMAL_CASES,
      levels: ["L1", "L2"],
      generatedInputsOnly: true,
      realAppDataSaveProviderNetwork: false
    },
    rows
  };
}

function observeAuditRetrieval(context, fixture, level) {
  const instrumentation = instrumentPairLedger(context.engine.store.pairLedger);
  let result;
  try {
    result = invoke(currentRetrieval, context, fixture, level, "safe-candidate-directory");
  } finally {
    instrumentation.restore();
  }
  const metrics = metricSnapshot(result, instrumentation.counts, fixture.pairCount);
  if (level === "L1") assert.equal(metrics.sourceResolveAttemptCount, 0, "L1 must not resolve sources");
  if (level === "L2") assert(metrics.sourceResolveAttemptCount <= 2, "L2 source resolve attempts must stay within limit");
  return { metrics, identity: resultIdentity(result) };
}

function runIndexBuildAudit(tempRoot) {
  const rows = [];
  for (const pairCount of SIZE_SET) {
    const fixtures = ALL_CASES.map(caseName =>
      makeFixture(tempRoot, "index-build-audit-" + pairCount + "-" + caseName, pairCount, caseName));
    for (const fixture of fixtures) {
      for (const level of ["L1", "L2"]) {
        const context = createContext(fixture,
          "index-build-audit-" + pairCount + "-" + fixture.caseName + "-" + level, currentRetrieval);
        const cold = observeAuditRetrieval(context, fixture, level);
        const warm = observeAuditRetrieval(context, fixture, level);
        const expectedCandidatePairCount = fixture.caseName === "allmention-worst" ? pairCount
          : fixture.caseName === "sparsehearsay" ? 2 : 1;
        assert.equal(cold.metrics.candidatePairCount, expectedCandidatePairCount,
          "candidate count must include every required scope");
        assert.equal(warm.metrics.candidatePairCount, expectedCandidatePairCount,
          "warm candidate count must remain unchanged");
        assert.equal(cold.metrics.pairIndexRebuildCount, expectedCandidatePairCount,
          "cold actual buildIndex calls must equal the candidate scope count");
        assert.equal(warm.metrics.pairIndexRebuildCount, 0,
          "warm retrieval must reuse every built Pair index");
        assert.deepEqual(warm.identity, cold.identity,
          "warm retrieval must produce the same result as the cold retrieval");
        rows.push({
          pairCount,
          caseName: fixture.caseName,
          level,
          datasetSha256: fixture.datasetSha256,
          candidatePairCount: expectedCandidatePairCount,
          cold: { pairIndexRebuildCount: cold.metrics.pairIndexRebuildCount,
            pairIndexBuildScopes: cold.metrics.pairIndexBuildScopes, identity: cold.identity },
          warm: { pairIndexRebuildCount: warm.metrics.pairIndexRebuildCount,
            pairIndexBuildScopes: warm.metrics.pairIndexBuildScopes, identity: warm.identity },
          resultUnchanged: true
        });
      }
    }
  }
  return {
    schemaVersion: 1,
    task: "V9.3.6.2 candidate Pair index build-count audit",
    status: "CANDIDATE_INDEX_BUILD_AUDIT_ONLY",
    createdAt: new Date().toISOString(),
    candidate: { currentModuleSources: candidateModuleSources, retrievalMode: "safe-candidate-directory" },
    formalWallAbIncluded: false,
    timingMeasured: false,
    samplePlan: {
      sizes: SIZE_SET,
      cases: ALL_CASES,
      levels: ["L1", "L2"],
      coldPerCell: 1,
      warmPerCell: 1,
      warmUsesSameContext: true
    },
    fixturePlan: {
      generatedInputsOnly: true,
      realAppDataSaveProviderNetwork: false,
      allMentionWorstCaseHasNoTopNTruncation: true
    },
    assertions: {
      coldBuildCountEqualsCandidateScopeCount: true,
      warmBuildCountIsZero: true,
      coldAndWarmResultsMatch: true
    },
    rows
  };
}

function baselineSamplePlan(pairCount) {
  return { cold: 1, warm: 2, status: "INSUFFICIENT_FOR_CREDIBLE_P95_COST_LIMIT" };
}

function runMixedColdSamples(retriever, fixtures, armLabel, retrievalMode, count) {
  const samples = [];
  for (let index = 0; index < count; index++) {
    const fixture = fixtures[index % fixtures.length];
    const context = createContext(fixture, armLabel + "-mixed-cold-" + index, retriever);
    const measured = measureOnce(retriever, context, fixture, "L0", retrievalMode);
    measured.sample.caseName = fixture.caseName;
    measured.sample.datasetSha256 = fixture.datasetSha256;
    samples.push(measured.sample);
  }
  return samples;
}

function runMixedWarmSamples(retriever, fixtures, armLabel, retrievalMode, count) {
  const contexts = new Map();
  for (const fixture of fixtures) {
    const context = createContext(fixture, armLabel + "-mixed-warm-" + fixture.caseName, retriever);
    invoke(retriever, context, fixture, "L0", retrievalMode);
    contexts.set(fixture.caseName, context);
  }
  const samples = [];
  for (let index = 0; index < count; index++) {
    const fixture = fixtures[index % fixtures.length];
    const measured = measureOnce(retriever, contexts.get(fixture.caseName), fixture, "L0", retrievalMode);
    measured.sample.caseName = fixture.caseName;
    measured.sample.datasetSha256 = fixture.datasetSha256;
    samples.push(measured.sample);
  }
  return samples;
}

function runFullBenchmark(tempRoot, recordRow = () => {}) {
  const results = [];
  for (const pairCount of SIZE_SET) {
    const fixtures = ALL_CASES.map(caseName =>
      makeFixture(tempRoot, "benchmark-" + pairCount + "-" + caseName, pairCount, caseName));
    const l0ReferenceCold = runMixedColdSamples(baselineRetrieval, fixtures, "exhaustive-reference",
      "exhaustive-reference", 10);
    const l0ReferenceWarm = runMixedWarmSamples(baselineRetrieval, fixtures, "exhaustive-reference",
      "exhaustive-reference", 20);
    const l0CandidateCold = runMixedColdSamples(currentRetrieval, fixtures, "safe-candidate-directory",
      "safe-candidate-directory", 10);
    const l0CandidateWarm = runMixedWarmSamples(currentRetrieval, fixtures, "safe-candidate-directory",
      "safe-candidate-directory", 20);
    const l0ReferenceSamples = [...l0ReferenceCold, ...l0ReferenceWarm];
    const l0Row = {
      pairCount,
      caseName: "scale-mixed-l0",
      level: "L0",
      datasetSha256ByCase: Object.fromEntries(fixtures.map(fixture => [fixture.caseName, fixture.datasetSha256])),
      reference: {
        samplePlan: { cold: 10, warm: 20, status: "LIGHTWEIGHT_MIXED_L0" },
        cold: { summary: summarizeSamples(l0ReferenceCold), samples: l0ReferenceCold },
        warm: { summary: summarizeSamples(l0ReferenceWarm), samples: l0ReferenceWarm }
      },
      candidate: {
        samplePlan: { cold: 10, warm: 20, status: "LIGHTWEIGHT_MIXED_L0" },
        cold: { summary: summarizeSamples(l0CandidateCold), samples: l0CandidateCold },
        warm: { summary: summarizeSamples(l0CandidateWarm), samples: l0CandidateWarm }
      }
    };
    results.push(l0Row);
    recordRow(l0Row);
    for (const sample of [...l0ReferenceSamples, ...l0CandidateCold, ...l0CandidateWarm]) {
      const matchingReference = l0ReferenceSamples.find(row => row.caseName === sample.caseName)?.identity;
      assert.deepEqual(sample.identity, matchingReference, "L0 mixed input must match the frozen oracle");
    }
    for (const fixture of fixtures) {
      for (const level of ["L1", "L2"]) {
        const candidatePlan = { cold: 10, warm: 20, status: "MINIMUM_REQUIRED_CANDIDATE_SAMPLES" };
        const referencePlan = baselineSamplePlan(pairCount);
        const referenceCold = runColdSamples(baselineRetrieval, fixture,
          "exhaustive-reference-" + fixture.caseName + "-" + level, level,
          "exhaustive-reference", referencePlan.cold);
        const referenceWarm = runWarmSamples(baselineRetrieval, fixture,
          "exhaustive-reference-" + fixture.caseName + "-" + level, level,
          "exhaustive-reference", referencePlan.warm);
        const candidateCold = runColdSamples(currentRetrieval, fixture,
          "safe-candidate-directory-" + fixture.caseName + "-" + level, level,
          "safe-candidate-directory", candidatePlan.cold);
        const candidateWarm = runWarmSamples(currentRetrieval, fixture,
          "safe-candidate-directory-" + fixture.caseName + "-" + level, level,
          "safe-candidate-directory", candidatePlan.warm);
        const referenceIdentity = referenceWarm[0]?.identity;
        const row = {
          pairCount,
          caseName: fixture.caseName,
          level,
          datasetSha256: fixture.datasetSha256,
          reference: {
            samplePlan: referencePlan,
            cold: { summary: summarizeSamples(referenceCold), samples: referenceCold },
            warm: { summary: summarizeSamples(referenceWarm), samples: referenceWarm }
          },
          candidate: {
            samplePlan: candidatePlan,
            cold: { summary: summarizeSamples(candidateCold), samples: candidateCold },
            warm: { summary: summarizeSamples(candidateWarm), samples: candidateWarm }
          }
        };
        results.push(row);
        recordRow(row);
        for (const sample of [...referenceCold, ...referenceWarm, ...candidateCold, ...candidateWarm]) {
          assert.deepEqual(sample.identity, referenceIdentity,
            "reference and safe candidate must return identical visible results for the same input");
        }
        const expectedCandidatePairCount = fixture.caseName === "allmention-worst" ? pairCount
          : fixture.caseName === "sparsehearsay" ? 2 : 1;
        for (const sample of [...candidateCold, ...candidateWarm]) {
          assert.equal(sample.metrics.candidatePairCount, expectedCandidatePairCount,
            "safe candidate must keep all target-bearing scopes and exclude unrelated scopes");
          if (fixture.caseName === "allmention-worst") {
            assert(sample.metrics.actualIndexReadCount >= pairCount,
              "all mentioning Pair scopes must remain readable without Top-N truncation");
          }
        }
      }
    }
  }
  return results;
}

function assessPerformanceTargets(results) {
  return results.filter(row => row.level !== "L0" && NORMAL_CASES.includes(row.caseName)).map(row => {
    const target = PERFORMANCE_TARGETS[row.pairCount];
    const warm = row.candidate.warm.summary.wallMs;
    const cold = row.candidate.cold.summary.wallMs;
    const assessment = {
      pairCount: row.pairCount,
      caseName: row.caseName,
      level: row.level,
      sampleCounts: {
        cold: row.candidate.cold.summary.sampleCount,
        warm: row.candidate.warm.summary.sampleCount
      },
      targets: target,
      warmP95Pass: warm.p95 <= target.warmP95Ms,
      warmP50Pass: target.warmP50Ms === undefined || warm.p50 <= target.warmP50Ms,
      coldP95Pass: target.coldP95Ms === undefined || cold.p95 <= target.coldP95Ms
    };
    assessment.allTargetsPass = assessment.warmP95Pass && assessment.warmP50Pass && assessment.coldP95Pass;
    return assessment;
  });
}

function environmentInfo() {
  return {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    executable: process.execPath,
    processPeakRssField: "process.resourceUsage().maxRSS (Node native unit)",
    syntheticEngineStorePairLedger: true,
    baselineUsesFrozenEngineStorePairLedgerAndRetrieval: true,
    realAppDataOrSaveProviderOrNetwork: false,
    diskReads: true,
    fixtureGenerationIncludedInRetrievalWallTime: false,
    coldDefinition: "Fresh MemoryEngine/baseDir and PairLedger caches per measured call; pre-generated identical summary JSON and Owner snapshot are reused; candidate directory construction occurs inside retrieval.",
    warmDefinition: "Same MemoryEngine, Owner snapshot and PairLedger/candidate-directory cache reused after one unmeasured priming retrieval.",
    timingScope: "retrievePairMemorySources() invocation only; fixture generation, MemoryEngine construction and Owner snapshot loading are excluded.",
    peakMemoryDefinition: "Per-call before/after RSS and heap deltas plus process.resourceUsage().maxRSS high-water value."
  };
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf8");
}

function run() {
  const tempRoot = fs.mkdtempSync(path.join(repoRoot, ".build", "v9362-pair-ab-fixture-"));
  try {
    if (indexBuildAuditRequested) {
      const audit = runIndexBuildAudit(tempRoot);
      writeJson(indexBuildAuditOutputPath, audit);
      console.log("INDEX_BUILD_AUDIT " + indexBuildAuditOutputPath);
      console.log("Candidate Pair index build-count audit passed; formal wall A/B remains separate.");
      return;
    }
    if (candidateEstimateRequested) {
      const estimate = runCandidateEstimate(tempRoot);
      writeJson(candidateEstimateOutputPath, estimate);
      console.log("CANDIDATE_ESTIMATE " + candidateEstimateOutputPath);
      console.log("Candidate-only diagnostic complete; this sample is not a P95 or release gate.");
      return;
    }
    runCorrectnessChecks(tempRoot);
    if (baselineEstimateRequested) {
      const estimate = runBaselineEstimate(tempRoot);
      writeJson(estimateOutputPath, estimate);
      console.log("BASELINE_ESTIMATE " + estimateOutputPath);
      console.log("V9.3.6.2 Pair performance baseline calibration: PASS (" + checks + " checks)");
      return;
    }
    if (benchmarkRequested) {
      const runId = new Date().toISOString().replace(/[^0-9]/gu, "").slice(0, 17);
      const rawSamplesPath = path.join(repoRoot, ".build", "v9362-pair-performance-ab-" + runId + ".jsonl");
      const rawHeader = {
        recordType: "header",
        schemaVersion: 1,
        task: "V9.3.6.2 synthetic Pair retrieval performance A/B",
        baseline: { sourceCommit: baselineCommit,
          sourcePath: "src/app/main/memory-system/pair-memory-source-retrieval.js",
          sourceSha256: baselineRetrievalModule.sourceSha256,
          frozenModules: sourceEvidence(baselineModules),
          retrievalMode: "fbe8cc3 frozen Engine/Store/Ledger/retrieval; exhaustive reference" },
        candidate: { sourcePath: "src/app/main/memory-system/pair-memory-source-retrieval.js",
          currentModuleSources: candidateModuleSources, retrievalMode: "safe-candidate-directory" },
        environment: environmentInfo(),
        samplePlan: {
          sizes: SIZE_SET,
          candidate: { cold: 10, warm: 20, appliesPerSizeAndActiveCaseAndLevel: true },
          reference: { cold: 1, warm: 2, appliesPerActiveSizeAndCaseAndLevel: true,
            status: "INSUFFICIENT_FOR_CREDIBLE_P95_COST_LIMIT" },
          l0: { cold: 10, warm: 20, appliesPerSizeWithMixedCases: true },
          levels: LEVELS,
          cases: ALL_CASES
        }
      };
      fs.mkdirSync(path.dirname(rawSamplesPath), { recursive: true });
      fs.writeFileSync(rawSamplesPath, JSON.stringify(rawHeader) + "\n", "utf8");
      console.log("AB_RAW_PROGRESS " + rawSamplesPath);
      const results = runFullBenchmark(tempRoot, row =>
        fs.appendFileSync(rawSamplesPath, JSON.stringify({ recordType: "result", row }) + "\n", "utf8"));
      const performanceAssessment = assessPerformanceTargets(results);
      const output = {
        schemaVersion: 1,
        task: "V9.3.6.2 synthetic Pair retrieval performance A/B",
        status: "COMPLETE_SYNTHETIC_AB",
        performanceTargetsMet: performanceAssessment.every(row => row.allTargetsPass),
        createdAt: new Date().toISOString(),
        baseline: {
          sourceCommit: baselineCommit,
          sourcePath: "src/app/main/memory-system/pair-memory-source-retrieval.js",
          sourceSha256: baselineRetrievalModule.sourceSha256,
          frozenModules: sourceEvidence(baselineModules),
          retrievalMode: "fbe8cc3 frozen Engine/Store/Ledger/retrieval; exhaustive reference"
        },
        candidate: {
          sourcePath: "src/app/main/memory-system/pair-memory-source-retrieval.js",
          currentModuleSources: candidateModuleSources,
          retrievalMode: "safe-candidate-directory"
        },
        environment: environmentInfo(),
        samplePlan: {
          sizes: SIZE_SET,
          candidate: { cold: 10, warm: 20, appliesPerSizeAndActiveCaseAndLevel: true },
          reference: { cold: 1, warm: 2, appliesPerActiveSizeAndCaseAndLevel: true,
            status: "INSUFFICIENT_FOR_CREDIBLE_P95_COST_LIMIT" },
          l0: { cold: 10, warm: 20, appliesPerSizeWithMixedCases: true },
          levels: LEVELS,
          cases: ALL_CASES
        },
        performanceTargets: PERFORMANCE_TARGETS,
        fixturePlan: {
          ownerPairCounts: SIZE_SET,
          cases: ALL_CASES,
          levels: LEVELS,
          generatedInputsOnly: true,
          directPairAlwaysPresent: true,
          reverseOwnerPrivateFixtureStoredUnderItsOwnOwnerFolder: true,
          allMentionWorstCaseIsSeparate: true,
          candidateScopeMustNotBeTopNTruncated: true
        },
        correctnessChecks: { passed: checks, frozenReferenceOutputEquality: true, l0ReadsAndResolves: 0,
          l2SourceResolveAttemptLimit: 2, allMentionWorstCaseScopesRetained: true },
        performanceAssessment,
        results
      };
      writeJson(outputPath, output);
      console.log("AB_RAW " + outputPath);
      console.log("AB_RAW_SAMPLES " + rawSamplesPath);
      console.log("V9.3.6.2 Pair performance AB complete; target pass=" + output.performanceTargetsMet
        + " (" + checks + " correctness checks)");
      assert(output.performanceTargetsMet, "PERF-01 release targets failed; raw evidence was preserved");
      return;
    }
    console.log("V9.3.6.2 Pair performance AB lightweight checks: PASS (" + checks + " checks)");
    console.log("Use --baseline-estimate for 5/30 Pair legacy cost calibration or --benchmark for full synthetic AB.");
  } finally {
    const allowedPrefix = path.join(repoRoot, ".build") + path.sep;
    const resolvedTempRoot = path.resolve(tempRoot);
    assert(resolvedTempRoot.startsWith(allowedPrefix), "fixture cleanup must remain under .build");
    fs.rmSync(resolvedTempRoot, { recursive: true, force: true });
  }
}

try {
  run();
} catch (error) {
  console.error(error && error.stack || error);
  process.exitCode = 1;
}
