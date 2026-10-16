"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { performance } = require("node:perf_hooks");

const sourceVersionPath = require.resolve("../src/app/main/version");
require.cache[sourceVersionPath] = { id: sourceVersionPath, filename: sourceVersionPath, loaded: true,
  exports: require("../resources/app/out/main/version") };
const { MemoryEngine } = require("../src/app/main/memory-system/memory-engine");
const { retrievePairMemorySources } = require("../src/app/main/memory-system/pair-memory-source-retrieval");
const { normalizeGameDate } = require("../src/app/main/worldline/character-temporal-facts");

const repoRoot = path.resolve(__dirname, "..");
const outputPath = path.join(repoRoot, ".build", "v9361-pair-scale-baseline.json");
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
const tempRoot = fs.mkdtempSync(path.join(path.dirname(outputPath), "v9361-pair-scale-test-"));
const benchmarkRequested = process.argv.includes("--benchmark");
const OWNER_ID = 200;
const PLAYER_ID = 100;
const TARGET_ID = 300;
const CAMPAIGN = "v9361-synthetic-campaign";
const CURRENT_DATE = "1200.1.1";
const CURRENT_TOTAL_DAYS = normalizeGameDate(CURRENT_DATE).serial;
const TARGET_NAME = "玛蒂尔达";
let checks = 0;

function check(name, fn) {
  fn();
  checks++;
  console.log(`PASS ${name}`);
}

function tokenCount(value) {
  return Math.ceil(String(value || "").length / 2);
}

function makeFixture(name, pairCount) {
  const root = path.join(tempRoot, name);
  const baseDir = path.join(root, "memory");
  const summaryFoldersDir = path.join(root, "summaries");
  const ownerName = "回应者乙";
  const ownerFolder = path.join(summaryFoldersDir, `${OWNER_ID}_${ownerName}`);
  fs.mkdirSync(ownerFolder, { recursive: true });
  fs.mkdirSync(path.join(summaryFoldersDir, `${TARGET_ID}_${TARGET_NAME}`), { recursive: true });
  const engine = new MemoryEngine({ baseDir, summaryFoldersDir, trace: { record() {} } });
  const pairs = [];

  for (let index = 0; index < pairCount; index++) {
    const counterpartId = index === 0 ? TARGET_ID : 1000 + index;
    const counterpartName = index === 0 ? TARGET_NAME : `合成人物${counterpartId}`;
    const marker = index === 0 ? `QA_SCALE_DIRECT_${index}` : `QA_SCALE_HEARSAY_${index}`;
    const matter = index === 0
      ? `${marker}：玛蒂尔达与回应者乙谈过盐税安排。`
      : `${marker}：合成人物${counterpartId}转述玛蒂尔达提过盐税安排。`;
    const summary = makeSummary(OWNER_ID, ownerName, counterpartId, counterpartName,
      `scale-${name}-${counterpartId}`, matter);
    const filePath = path.join(ownerFolder, `与${counterpartName}的对话.json`);
    fs.writeFileSync(filePath, JSON.stringify([summary], null, 2), "utf8");
    pairs.push({ counterpartId, counterpartName, marker, matter, summary, filePath });
  }

  const reversePrivate = makeSummary(TARGET_ID, TARGET_NAME, OWNER_ID, ownerName,
    `reverse-private-${name}`, `QA_REVERSE_PRIVATE_${name}：玛蒂尔达对回应者乙的私人叙述。`);
  fs.writeFileSync(path.join(summaryFoldersDir, `${TARGET_ID}_${TARGET_NAME}`, `与${ownerName}的对话.json`),
    JSON.stringify([reversePrivate], null, 2), "utf8");

  return { engine, pairs, memories: engine.store.loadFolderSummariesForCharacter(OWNER_ID), ownerFolder, summaryFoldersDir };
}

function makeSummary(ownerId, ownerName, counterpartId, counterpartName, finalizationId, matter) {
  return {
    date: "1190.1.1",
    totalDays: normalizeGameDate("1190.1.1").serial,
    content: `合成叙事。\n\n【需要长期记住的事项】\n- ${matter}\n【其他事项】\n合成来源。`,
    playerId: ownerId,
    playerName: ownerName,
    characterId: counterpartId,
    characterName: counterpartName,
    perspectiveOwnerId: ownerId,
    campaignToken: CAMPAIGN,
    campaignBinding: { status: "bound", source: "synthetic_fixture", version: 1 },
    finalizationId,
    conversationId: `conversation-${finalizationId}`,
    conversationType: "pair",
    participants: [{ id: ownerId, name: ownerName }, { id: counterpartId, name: counterpartName }]
  };
}

function decision(level = "L1") {
  return {
    level,
    responderId: OWNER_ID,
    playerAnchorId: PLAYER_ID,
    targetCharacterIds: [TARGET_ID],
    targetEvidence: "UNIQUE_ALIAS",
    historyIntent: level === "L2" ? "DETAIL" : level === "L1" ? "RELATIONSHIP" : "NONE",
    explicitSourceDetailRequested: level === "L2",
    denialDetected: false,
    reasonCode: level === "L0" ? "NO_HISTORICAL_INTENT" : "EXPLICIT_HISTORY_REQUEST",
    queryFingerprint: "v9361-synthetic-query"
  };
}

function profileRows() {
  return [{ characterId: TARGET_ID, name: TARGET_NAME, aliases: [TARGET_NAME] }];
}

function retrieve(engine, memories, { level = "L1", campaignToken = CAMPAIGN, query = "盐税", mode } = {}) {
  return retrievePairMemorySources({
    mode: mode || (level === "L2" ? "THIRD_PERSON_SOURCE_DETAIL" : "THIRD_PERSON_LEDGER"),
    store: engine.store,
    ownerId: OWNER_ID,
    decision: decision(level),
    entitiesProfile: profileRows(),
    campaignToken,
    currentGameDate: CURRENT_DATE,
    currentTotalDays: CURRENT_TOTAL_DAYS,
    memories,
    query,
    tokenBudget: 100000,
    estimateTokens: tokenCount
  });
}

function instrumentPairLedger(ledger) {
  const originalRead = ledger.read.bind(ledger);
  const originalResolve = ledger.resolveSource.bind(ledger);
  const counts = { logicalIndexReads: 0, indexCacheHits: 0, indexCacheMisses: 0, resolveAttempts: 0, readScopes: [] };
  ledger.read = (...args) => {
    counts.logicalIndexReads++;
    const scope = args[0] || {};
    counts.readScopes.push({ ownerId: Number(scope.ownerId), counterpartId: Number(scope.counterpartId) });
    const result = originalRead(...args);
    if (result?.cacheHit === true) counts.indexCacheHits++;
    else counts.indexCacheMisses++;
    return result;
  };
  ledger.resolveSource = (...args) => {
    counts.resolveAttempts++;
    return originalResolve(...args);
  };
  return { counts, restore() { ledger.read = originalRead; ledger.resolveSource = originalResolve; } };
}

function runCorrectnessChecks() {
  const fixture = makeFixture("correctness", 5);
  const { engine } = fixture;
  let instrumented = instrumentPairLedger(engine.store.pairLedger);

  check("L0 performs zero third-person PairLedger reads and source resolves", () => {
    const result = retrieve(engine, fixture.memories, { level: "L0" });
    assert.equal(result.fallbackStatus, "NOT_REQUESTED");
    assert.equal(instrumented.counts.logicalIndexReads, 0);
    assert.equal(instrumented.counts.resolveAttempts, 0);
  });

  check("L1 retains direct and B-to-D hearsay, excludes reverse-owner private data, and resolves no sources", () => {
    const result = retrieve(engine, fixture.memories, { level: "L1" });
    assert(result.text.includes(fixture.pairs[0].marker), "B-to-C direct matter must be retained");
    assert(result.text.includes(fixture.pairs[1].marker), "B-to-D hearsay about C must be retained");
    assert(!result.text.includes(`QA_REVERSE_PRIVATE_correctness`), "C-to-B private view must remain outside B's owner scope");
    assert.equal(instrumented.counts.resolveAttempts, 0);
    assert.equal(result.metrics.scopeRevisions.length, 5);
    assert(result.metrics.scopeRevisions.every(scope => scope.ownerId === OWNER_ID));
    assert.equal(result.metrics.candidatePairCount, 5);
    assert.equal(result.metrics.actualIndexReadCount, 10, "five candidate reads plus five revision verification reads");
    assert.equal(result.metrics.actualIndexReadCount, instrumented.counts.logicalIndexReads);
    assert.equal(result.metrics.indexCacheHits, 5);
    assert.equal(result.metrics.indexCacheMisses, 5);
    assert.equal(result.metrics.indexCacheHit, false, "cacheHit means every explicit index read hit");
    const warm = retrieve(engine, fixture.memories, { level: "L1" });
    assert.equal(warm.metrics.actualIndexReadCount, 10);
    assert.equal(warm.metrics.indexCacheHits, 10);
    assert.equal(warm.metrics.indexCacheMisses, 0);
    assert.equal(warm.metrics.indexCacheHit, true);
  });

  check("L2 caps total source attempts at two even when both attempts fail", () => {
    instrumented.restore();
    let attempts = 0;
    engine.store.pairLedger.resolveSource = () => {
      attempts++;
      throw new Error("SOURCE_UNAVAILABLE_OR_STALE");
    };
    const result = retrieve(engine, fixture.memories, { level: "L2" });
    assert.equal(attempts, 2);
    assert.equal(result.metrics.sourceResolveAttemptCount, 2);
    assert.equal(result.sources.length, 0);
  });

  check("Campaign changes do not reuse cached candidates from another Campaign", () => {
    const result = retrieve(engine, fixture.memories, { campaignToken: "different-synthetic-campaign" });
    assert.equal(result.fallbackStatus, "INDEX_MISS");
    assert(!result.text.includes(fixture.pairs[0].marker));
    assert(!result.text.includes(fixture.pairs[1].marker));
  });

  check("Forget invalidates a previously warmed PairLedger entry", () => {
    const pair = fixture.pairs[1];
    const before = retrieve(engine, fixture.memories);
    assert(before.text.includes(pair.marker));
    // Keep the synthetic Forget ledger in memory; this test measures retrieval invalidation,
    // not MemoryStore's unrelated atomic index-file replacement behavior.
    engine.store.saveIndex = () => {};
    engine.store.recordForgottenSummaryProjection(pair.summary, { ownerId: OWNER_ID, counterpartId: pair.counterpartId });
    const after = retrieve(engine, engine.store.loadFolderSummariesForCharacter(OWNER_ID));
    assert(!after.text.includes(pair.marker));
  });

  check("Source revision edits replace the prior indexed matter after a warm read", () => {
    const pair = fixture.pairs[2];
    const before = retrieve(engine, fixture.memories);
    assert(before.text.includes(pair.marker));
    const beforeRevision = before.metrics.scopeRevisions.find(scope => scope.counterpartId === pair.counterpartId)?.revision;
    const editedMarker = "QA_SCALE_EDITED_REVISION";
    const edited = { ...pair.summary, content: pair.summary.content.replace(pair.marker, editedMarker) };
    fs.writeFileSync(pair.filePath, JSON.stringify([edited], null, 2), "utf8");
    const time = new Date(Date.now() + 5000);
    fs.utimesSync(pair.filePath, time, time);
    const after = retrieve(engine, engine.store.loadFolderSummariesForCharacter(OWNER_ID));
    const afterRevision = after.metrics.scopeRevisions.find(scope => scope.counterpartId === pair.counterpartId)?.revision;
    assert(!after.text.includes(pair.marker));
    assert(after.text.includes(editedMarker));
    assert.notEqual(afterRevision, beforeRevision);
  });

  check("Deleting a source removes its candidate after a warm read", () => {
    const pair = fixture.pairs[3];
    const before = retrieve(engine, engine.store.loadFolderSummariesForCharacter(OWNER_ID));
    assert(before.text.includes(pair.marker));
    fs.unlinkSync(pair.filePath);
    const after = retrieve(engine, engine.store.loadFolderSummariesForCharacter(OWNER_ID));
    assert(!after.text.includes(pair.marker));
  });

  instrumented.restore();
  return { fixture, checkCount: checks };
}

function percentile(values, fraction) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] || 0;
}

function summarizeSamples(samples) {
  const keys = ["wallMs", "cpuMs", "indexLookupMs", "logicalIndexReads", "indexCacheHits", "indexCacheMisses",
    "resolveAttempts", "candidatePairScopes", "candidateSummaryCount"];
  const summary = {};
  for (const key of keys) {
    const values = samples.map(sample => Number(sample[key]) || 0);
    summary[key] = { p50: percentile(values, 0.50), p95: percentile(values, 0.95) };
  }
  return summary;
}

function measureOnce(fixture) {
  const ledger = fixture.engine.store.pairLedger;
  const instrumentation = instrumentPairLedger(ledger);
  const cpuStart = process.cpuUsage();
  const started = performance.now();
  const result = retrieve(fixture.engine, fixture.memories);
  const wallMs = performance.now() - started;
  const cpu = process.cpuUsage(cpuStart);
  const sample = {
    wallMs,
    cpuMs: (cpu.user + cpu.system) / 1000,
    indexLookupMs: Number(result.metrics.indexLookupMs) || 0,
    logicalIndexReads: instrumentation.counts.logicalIndexReads,
    indexCacheHits: instrumentation.counts.indexCacheHits,
    indexCacheMisses: instrumentation.counts.indexCacheMisses,
    resolveAttempts: instrumentation.counts.resolveAttempts,
    candidatePairScopes: result.metrics.scopeRevisions?.length || 0,
    candidateSummaryCount: result.metrics.candidateSummaryCount || 0,
    fallbackStatus: result.fallbackStatus,
    selectedItemCount: result.items.length
  };
  instrumentation.restore();
  assert.equal(sample.logicalIndexReads, result.metrics.actualIndexReadCount);
  assert.equal(sample.candidatePairScopes, result.metrics.candidatePairCount);
  assert.equal(sample.indexCacheHits, result.metrics.indexCacheHits);
  assert.equal(sample.indexCacheMisses, result.metrics.indexCacheMisses);
  assert.equal(sample.resolveAttempts, 0, "L1 scale measurements must not resolve source text");
  return sample;
}

function writeBenchmarkOutput(scales, status) {
  const output = {
    schemaVersion: 1,
    task: "V9.3.6.1 FIX03 synthetic Pair retrieval baseline",
    status,
    createdAt: new Date().toISOString(),
    environment: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      syntheticEngineStorePairLedger: true,
      realAppDataOrSaveOrNetwork: false,
      diskReads: true,
      coldDefinition: "PairLedger in-memory scope cache cleared before each measured lookup; temporary synthetic JSON summaries remain on disk.",
      warmDefinition: "Same engine, snapshot and PairLedger scope cache reused after one priming lookup.",
      timingScope: "Retrieval call only; fixture creation, file seeding and snapshot loading are excluded."
    },
    correctnessChecks: { passed: checks, forgotten: true, campaignIsolation: true, sourceRevisionEdit: true, delete: true,
      l0Reads: 0, l1SourceResolveAttempts: 0, l2MaximumTotalSourceAttempts: 2, crossPairHearsayRetained: true,
      reverseOwnerPrivateViewExcluded: true, readMetricsVerified: true },
    interpretation: {
      candidateFilterChanged: false,
      topNTruncationAdded: false,
      optimizationImplemented: false,
      decision: "Measurement only. Per-scope PairLedger reads perform source and Forget revalidation; a separate Owner-scope cache was deferred because it cannot safely bypass those checks and its benefit was not isolated by this baseline."
    },
    scales
  };
  fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
}

function runBenchmarks() {
  const sizes = [5, 30, 100, 300];
  const results = [];
  for (const pairCount of sizes) {
    const fixture = makeFixture(`scale-${pairCount}`, pairCount);
    const coldSamples = [];
    const warmSamples = [];
    const samplePlan = pairCount < 100 ? { cold: 4, warm: 8 }
      : pairCount === 100 ? { cold: 2, warm: 3 } : { cold: 1, warm: 3 };
    for (let repetition = 0; repetition < samplePlan.cold; repetition++) {
      console.log(`MEASURE_START ${pairCount} pairs cold ${repetition + 1}/${samplePlan.cold}`);
      fixture.engine.store.pairLedger.invalidate();
      coldSamples.push(measureOnce(fixture));
    }
    fixture.engine.store.pairLedger.invalidate();
    measureOnce(fixture);
    for (let repetition = 0; repetition < samplePlan.warm; repetition++) {
      console.log(`MEASURE_START ${pairCount} pairs warm ${repetition + 1}/${samplePlan.warm}`);
      warmSamples.push(measureOnce(fixture));
    }
    results.push({ pairCount, syntheticSummaryCount: fixture.memories.length,
      cold: { sampleCount: coldSamples.length, percentiles: summarizeSamples(coldSamples), samples: coldSamples },
      warm: { sampleCount: warmSamples.length, percentiles: summarizeSamples(warmSamples), samples: warmSamples } });
    writeBenchmarkOutput(results, "RUNNING");
    console.log(`MEASURE ${pairCount} pairs cold P50/P95=${results.at(-1).cold.percentiles.wallMs.p50.toFixed(2)}/${results.at(-1).cold.percentiles.wallMs.p95.toFixed(2)} ms; warm=${results.at(-1).warm.percentiles.wallMs.p50.toFixed(2)}/${results.at(-1).warm.percentiles.wallMs.p95.toFixed(2)} ms`);
  }
  return results;
}

function main() {
  runCorrectnessChecks();
  if (benchmarkRequested) {
    const scales = runBenchmarks();
    writeBenchmarkOutput(scales, "COMPLETE");
    console.log(`RESULT ${outputPath}`);
  } else {
    const fixture = makeFixture("lightweight-smoke", 5);
    const sample = measureOnce(fixture);
    console.log(`SMOKE 5 pairs: ${sample.wallMs.toFixed(2)} ms, ${sample.logicalIndexReads} logical reads`);
  }
  assert(path.resolve(tempRoot).startsWith(path.resolve(path.dirname(outputPath)) + path.sep));
  fs.rmSync(tempRoot, { recursive: true, force: true });
  console.log(`V9.3.6.1 Pair retrieval scale: PASS (${checks} checks)`);
}

try {
  main();
} catch (error) {
  console.error(error && error.stack || error);
  process.exitCode = 1;
  if (fs.existsSync(tempRoot)) fs.rmSync(tempRoot, { recursive: true, force: true });
}
