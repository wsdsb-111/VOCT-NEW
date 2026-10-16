"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { performance } = require("node:perf_hooks");

const repoRoot = path.resolve(__dirname, "..");
const buildRoot = path.join(repoRoot, ".build");
const outputPath = path.join(buildRoot, "v9363-mixed-archive-ab-raw.json");
const OWNER_ID = 200;
const PLAYER_ID = 100;
const TARGET_ID = 300;
const TARGET_ALIAS = "合成目标甲";
const OWNER_NAME = "synthetic_owner";
const CAMPAIGN = "v9363-synthetic-archive-campaign";
const CURRENT_DATE = "1200.1.1";
const CURRENT_TOTAL_DAYS = 438000;
const TOKEN_BUDGET = 2400;
const PAIR_COUNTS = [5, 30, 100, 300];
const OLD_RATIOS = [0, 1, 5, 10, 50, 100];
const QUERY_CASES = ["directhit", "sparsehearsay", "miss", "allmention-worst"];
const LEVELS = ["L0", "L1", "L2"];
const modeFlags = process.argv.slice(2).filter(arg => ["--estimate", "--benchmark"].includes(arg));
const unknownFlags = process.argv.slice(2).filter(arg => !["--estimate", "--benchmark"].includes(arg));

if (unknownFlags.length || modeFlags.length > 1) {
  console.error("Usage: node scripts/test-v9.3.6.3-mixed-archive-ab.js [--estimate|--benchmark]");
  process.exit(2);
}

const runMode = modeFlags[0] === "--benchmark" ? "benchmark"
  : modeFlags[0] === "--estimate" ? "estimate" : "correctness";
const nodeMajor = Number(process.versions.node.split(".")[0]);
if (nodeMajor !== 22) {
  console.error("NODE_22_REQUIRED: run with .build/v9331-node22/node.exe");
  process.exit(2);
}

const versionPath = require.resolve("../src/app/main/version");
require.cache[versionPath] = {
  id: versionPath,
  filename: versionPath,
  loaded: true,
  exports: require("../resources/app/out/main/version")
};

const { MemoryEngine } = require("../src/app/main/memory-system/memory-engine");
const { retrievePairMemorySources } = require("../src/app/main/memory-system/pair-memory-source-retrieval");
const { normalizeGameDate } = require("../src/app/main/worldline/character-temporal-facts");
const normalizedCurrentDate = normalizeGameDate(CURRENT_DATE);
if (!normalizedCurrentDate) throw new Error("FIXTURE_CURRENT_DATE_INVALID");

const totalCalls = {
  correctness: { cells: 72, calls: 144 },
  benchmark: { mainCells: 288, mainCalls: 8928, scopedEdgeCells: 6, scopedEdgeCalls: 186,
    unscopedCalls: 2, totalCalls: 9116 },
  estimate: { candidateOnlySamples: 9, calls: 9 }
};

const runState = {
  schemaVersion: 1,
  evidence: "synthetic-fixture-only; no real summaries, save files, provider calls or source text are recorded",
  runMode,
  createdAt: new Date().toISOString(),
  runtime: machineInfo(),
  measurementBoundary: {
    timedRegion: "retrievePairMemorySources only",
    fixtureAndMemoryStoreSnapshotLoad: "excluded; completed before each timed retrieval",
    coldDefinition: "fresh MemoryEngine with empty PairLedger and candidate-directory caches; includes Owner-read validation inside retrieval",
    warmDefinition: "20 immediate calls on the last measured cold candidate context; no extra warmup call",
    physicalDiskColdMeasured: false
  },
  plan: {
    correctness: { pairCounts: [5], oldRatios: OLD_RATIOS, queryCases: QUERY_CASES, levels: LEVELS,
      oneReferenceAndOneCandidateCallPerCell: true },
    benchmark: { pairCounts: PAIR_COUNTS, oldRatios: OLD_RATIOS, queryCases: QUERY_CASES, levels: LEVELS,
      candidate: { cold: 10, warm: 20 }, reference: { cold: 1, credibleP95: false }, noExtraWarmup: true,
      timingBoundary: "retrieval-only; owner snapshot loading is outside the timed interval; cold means fresh in-memory indexes/directories, not physical disk cold",
      scopedEdges: { pairCount: 300, uncertainScopes: [1, 5, 10], queryCases: ["sparsehearsay"], levels: ["L1", "L2"],
        candidate: { cold: 10, warm: 20 }, reference: { cold: 1, credibleP95: false } },
      unscopedUnknown: { pairCount: 300, oneReferenceAndOneCandidateCall: true, noPerformanceThreshold: true } },
    estimate: { oneShotCandidateOnly: true, credibleP95: false },
    retrievalCallForecast: totalCalls[runMode]
  },
  correctnessCells: [],
  benchmarkCells: [],
  estimateSamples: [],
  failures: [],
  gateFailures: [],
  completed: false
};

fs.mkdirSync(buildRoot, { recursive: true });
const tempRoot = fs.mkdtempSync(path.join(buildRoot, "v9363-mixed-archive-"));
const resolvedBuildRoot = path.resolve(buildRoot);
const resolvedTempRoot = path.resolve(tempRoot);
if (!resolvedTempRoot.toLowerCase().startsWith((resolvedBuildRoot + path.sep).toLowerCase())) {
  throw new Error("FIXTURE_ROOT_OUTSIDE_BUILD");
}

function machineInfo() {
  const cpus = os.cpus();
  return {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    cpuModel: cpus[0]?.model || null,
    logicalCpuCount: cpus.length,
    totalMemoryBytes: os.totalmem()
  };
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function stableJson(value) {
  return JSON.stringify(value);
}

function flushRaw() {
  const temporaryPath = `${outputPath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, JSON.stringify(runState, null, 2), "utf8");
  fs.renameSync(temporaryPath, outputPath);
}

function pairIdAt(index) {
  return index === 0 ? TARGET_ID : 1000 + index;
}

function pairNameAt(index) {
  return index === 0 ? "synthetic_target" : `synthetic_pair_${pairIdAt(index)}`;
}

function summaryContent(marker, matter) {
  return `${marker}：合成叙事。\n\n【需要长期记住的事项】\n- ${matter}\n【其他事项】\n合成来源。`;
}

function makeSummary({ counterpartId, counterpartName, finalizationId, content, unscoped = false }) {
  const participants = unscoped
    ? [{ id: OWNER_ID, name: OWNER_NAME }]
    : [{ id: OWNER_ID, name: OWNER_NAME }, { id: counterpartId, name: counterpartName }];
  return {
    date: "1190.1.1",
    totalDays: normalizeGameDate("1190.1.1").serial,
    content,
    playerId: OWNER_ID,
    playerName: OWNER_NAME,
    characterId: unscoped ? null : counterpartId,
    characterName: unscoped ? null : counterpartName,
    perspectiveOwnerId: OWNER_ID,
    campaignToken: CAMPAIGN,
    campaignBinding: { status: "bound", source: "synthetic_fixture", version: 1 },
    finalizationId,
    conversationId: `conversation-${finalizationId}`,
    conversationType: unscoped ? "group" : "pair",
    participants
  };
}

function writeSummary(filePath, summary) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify([summary], null, 2), "utf8");
}

function matterFor(queryCase, pairIndex) {
  const mentionsTarget = queryCase === "allmention-worst"
    || queryCase === "directhit" && pairIndex === 0
    || queryCase === "sparsehearsay" && pairIndex === 1;
  const targetText = mentionsTarget ? `${TARGET_ALIAS}提及盐税账册，需要复核。` : "讨论城门修缮与粮仓盘点。";
  return targetText;
}

function uncertainPairIndexes(pairCount, uncertainCount) {
  if (!uncertainCount) return [];
  if (uncertainCount >= pairCount) return Array.from({ length: pairCount }, (_, index) => index);
  return Array.from({ length: uncertainCount }, (_, index) => index + 1);
}

function makeFixture(label, pairCount, uncertainCount, queryCase, { unscopedUnknown = false } = {}) {
  const root = path.join(tempRoot, label);
  const summaryFoldersDir = path.join(root, "summaries");
  const ownerFolder = path.join(summaryFoldersDir, `${OWNER_ID}_${OWNER_NAME}`);
  fs.mkdirSync(ownerFolder, { recursive: true });
  const ids = Array.from({ length: pairCount }, (_, index) => pairIdAt(index));
  const uncertainIndexes = uncertainPairIndexes(pairCount, uncertainCount);
  const uncertainFinalizationIds = [];
  const sourceFiles = [];

  for (let index = 0; index < pairCount; index++) {
    const counterpartId = ids[index];
    const counterpartName = pairNameAt(index);
    const finalizationId = `v9363-${label}-pair-${index}`;
    const marker = `SYNTHETIC_${label}_${index}`;
    const summary = makeSummary({ counterpartId, counterpartName, finalizationId,
      content: summaryContent(marker, matterFor(queryCase, index)) });
    const pairPath = path.join(ownerFolder, `与${counterpartName}的对话.json`);
    writeSummary(pairPath, summary);
    sourceFiles.push(pairPath);
  }

  for (const pairIndex of uncertainIndexes) {
    const counterpartId = ids[pairIndex];
    const counterpartName = pairNameAt(pairIndex);
    const finalizationId = `v9363-${label}-old-${pairIndex}`;
    const marker = `SYNTHETIC_${label}_OLD_${pairIndex}`;
    const summary = makeSummary({ counterpartId, counterpartName, finalizationId,
      content: summaryContent(marker, `${TARGET_ALIAS}提及盐税账册，来源元数据旧式缺失。`) });
    // The trusted MemoryStore snapshot still sees this Owner row and its Pair IDs;
    // the non-Pair filename intentionally yields pairLedgerSources: [].
    const legacyPath = path.join(ownerFolder, `legacy-row-${counterpartId}.json`);
    writeSummary(legacyPath, summary);
    sourceFiles.push(legacyPath);
    uncertainFinalizationIds.push(finalizationId);
  }

  let unscopedFinalizationId = null;
  if (unscopedUnknown) {
    unscopedFinalizationId = `v9363-${label}-unscoped-unknown`;
    const summary = makeSummary({ finalizationId: unscopedFinalizationId,
      content: summaryContent(`SYNTHETIC_${label}_UNSCOPED`, `${TARGET_ALIAS}提及盐税账册，无法映射到Pair。`),
      unscoped: true });
    const unscopedPath = path.join(ownerFolder, "legacy-unscoped-unknown.json");
    writeSummary(unscopedPath, summary);
    sourceFiles.push(unscopedPath);
  }

  for (const filePath of sourceFiles) {
    const stat = fs.statSync(filePath);
    const stableMtime = Math.floor(stat.mtimeMs);
    fs.utimesSync(filePath, stat.atime, stableMtime / 1000);
    assert.equal(fs.statSync(filePath).mtimeMs, stableMtime);
  }

  return {
    label,
    pairCount,
    pairIds: ids,
    uncertainCount,
    uncertainFinalizationIds,
    queryCase,
    unscopedUnknown,
    unscopedFinalizationId,
    summaryFoldersDir
  };
}

function createContext(fixture, retrievalMode, contextId) {
  const engine = new MemoryEngine({ baseDir: path.join(tempRoot, fixture.label, "stores", contextId),
    summaryFoldersDir: fixture.summaryFoldersDir, trace: { record() {} } });
  const memories = engine.store.loadFolderSummariesForCharacter(OWNER_ID);
  const revision = engine.store.getFolderSummarySnapshotRevision(memories);
  const sourceState = engine.store.getFolderSummarySnapshotSources(memories);
  assert(Number.isSafeInteger(revision), "fixture must come from MemoryStore's trusted WeakMap snapshot");
  assert.equal(sourceState?.ownerId, OWNER_ID, "fixture snapshot must have Store-bound Owner provenance");
  assert.equal(engine.store.hasOwnerSummaryContentChanges(memories), false,
    "synthetic fixture sources must be stable before retrieval");
  const uncertainRows = memories.filter(memory => fixture.uncertainFinalizationIds.includes(memory.provenance?.finalizationId));
  assert.equal(uncertainRows.length, fixture.uncertainCount,
    "bounded source-less archive rows must be loaded by the real MemoryStore");
  for (const memory of uncertainRows) {
    assert.equal(Number(memory.provenance?.folderOwnerId), OWNER_ID);
    assert(memory.knownBy?.map(Number).includes(OWNER_ID));
    assert.equal(String(memory.provenance?.campaignToken || "").trim(), CAMPAIGN);
    assert(memory.provenance?.counterpartIds?.length === 1,
      "each bounded anomaly must retain a trusted, explicit Pair scope");
    assert.deepEqual(memory.provenance.pairLedgerSources, [],
      "the real Store must expose the non-Pair legacy row as an empty source list");
  }
  const unscopedRows = fixture.unscopedFinalizationId
    ? memories.filter(memory => memory.provenance?.finalizationId === fixture.unscopedFinalizationId) : [];
  assert.equal(unscopedRows.length, fixture.unscopedUnknown ? 1 : 0);
  if (fixture.unscopedUnknown) assert.deepEqual(unscopedRows[0].provenance.counterpartIds, []);
  return { engine, store: engine.store, memories, revision, retrievalMode, fixture,
    uncertainRows, snapshotWeakMapTrusted: true };
}

function assertTrustedSnapshot(context, memories, revision) {
  assert.strictEqual(memories, context.memories,
    "candidate metadata projection must operate on the actual Store snapshot object");
  assert.equal(context.store.getFolderSummarySnapshotRevision(memories), revision,
    "the exact Owner snapshot must retain its Store WeakMap revision");
  assert.equal(context.store.getFolderSummarySnapshotSources(memories)?.ownerId, OWNER_ID,
    "the exact Owner snapshot must retain its Store WeakMap source binding");
  assert.equal(context.store.hasOwnerSummaryContentChanges(memories), false,
    "the Store must still validate the authoritative source bytes");
}

function withTrustedSnapshotAudit(context, invoke) {
  if (context.retrievalMode !== "safe-candidate-directory") return invoke();
  const directory = context.store.pairLedger.candidateDirectory;
  const originalMethod = directory.getCandidateScopes;
  const uncertainIds = new Set(context.fixture.uncertainFinalizationIds);
  let auditedRows = 0;
  let auditedCalls = 0;
  directory.getCandidateScopes = function(args = {}) {
    const snapshot = args.ownerSnapshot;
    assertTrustedSnapshot(context, snapshot, args.snapshotRevision);
    auditedCalls++;
    const rows = snapshot.filter(memory => uncertainIds.has(memory.provenance?.finalizationId));
    assert.equal(rows.length, context.fixture.uncertainCount);
    for (const row of rows) {
      assert.equal(Number(row.provenance?.folderOwnerId), OWNER_ID);
      assert(row.knownBy?.map(Number).includes(OWNER_ID));
      assert.equal(String(row.provenance?.campaignToken || "").trim(), CAMPAIGN);
      assert.equal(row.provenance?.counterpartIds?.length, 1,
        "each uncertain archive row must retain a trusted explicit Pair scope");
      assert.deepEqual(row.provenance?.pairLedgerSources, [],
        "the real Store snapshot must preserve the source-less archive row metadata");
    }
    auditedRows += rows.length;
    return originalMethod.call(this, args);
  };
  try {
    const value = invoke();
    return { ...value, trustedSnapshotAudit: { calls: auditedCalls, uncertainRows: auditedRows,
      exactStoreWeakMapSnapshot: true, sourceBytesStable: true } };
  } finally {
    directory.getCandidateScopes = originalMethod;
  }
}

function queryFor(queryCase) {
  const asks = {
    directhit: `你还记得${TARGET_ALIAS}的盐税旧账吗？`,
    sparsehearsay: `你听${TARGET_ALIAS}转述过盐税账册吗？`,
    miss: `你还记得${TARGET_ALIAS}的海潮账目吗？`,
    "allmention-worst": `你还记得${TARGET_ALIAS}提到的盐税账册吗？`
  };
  return asks[queryCase];
}

function decisionFor(level, queryCase) {
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
    queryFingerprint: `v9363-mixed-${queryCase}-${level}`
  };
}

function pairProfile() {
  return [{ characterId: TARGET_ID, name: TARGET_ALIAS, aliases: [TARGET_ALIAS, "target-alpha"] }];
}

function makeRetrievalArgs(context, retrievalMode, level) {
  const queryCase = context.fixture.queryCase;
  return {
    mode: level === "L2" ? "THIRD_PERSON_SOURCE_DETAIL" : "THIRD_PERSON_LEDGER",
    retrievalMode,
    store: context.store,
    ownerId: OWNER_ID,
    decision: decisionFor(level, queryCase),
    entitiesProfile: pairProfile(),
    campaignToken: CAMPAIGN,
    currentGameDate: CURRENT_DATE,
    currentTotalDays: normalizedCurrentDate.serial ?? CURRENT_TOTAL_DAYS,
    memories: context.memories,
    query: queryFor(queryCase),
    tokenBudget: TOKEN_BUDGET,
    estimateTokens: value => Math.ceil(String(value || "").length / 2)
  };
}

function installLedgerCounters(context, counts) {
  const ledger = context.store.pairLedger;
  const originals = new Map();
  let resolving = 0;
  const wrap = (name, replacement) => {
    originals.set(name, Object.getOwnPropertyDescriptor(ledger, name));
    ledger[name] = replacement;
  };
  const originalRead = ledger.read.bind(ledger);
  const originalResolve = ledger.resolveSource.bind(ledger);
  const originalBuildIndex = ledger.buildIndex.bind(ledger);
  const originalBeginOwnerRead = ledger.beginOwnerRead.bind(ledger);
  const originalValidateOwnerRead = ledger.validateOwnerRead.bind(ledger);

  wrap("read", function(...args) {
    counts.readCallsIncludingResolveInternals++;
    if (resolving) counts.readCallsFromResolveInternals++;
    const scope = args[0] || {};
    counts.readScopes.push({ ownerId: Number(scope.ownerId), counterpartId: Number(scope.counterpartId) });
    return originalRead(...args);
  });
  wrap("resolveSource", function(...args) {
    counts.resolveSourceCalls++;
    resolving++;
    try { return originalResolve(...args); }
    finally { resolving--; }
  });
  wrap("buildIndex", function(...args) {
    counts.actualBuildIndexCalls++;
    const scope = args[0] || {};
    counts.buildIndexScopes.push({ ownerId: Number(scope.ownerId), counterpartId: Number(scope.counterpartId) });
    return originalBuildIndex(...args);
  });
  wrap("beginOwnerRead", function(...args) {
    const started = performance.now();
    counts.ownerReadBeginCalls++;
    try {
      const value = originalBeginOwnerRead(...args);
      counts.ownerReadBeginSuccessCount++;
      return value;
    } finally { counts.ownerReadValidationMs += performance.now() - started; }
  });
  wrap("validateOwnerRead", function(...args) {
    const started = performance.now();
    counts.ownerReadValidationCalls++;
    try {
      const valid = originalValidateOwnerRead(...args);
      if (valid) counts.ownerReadValidationSuccessCount++;
      return valid;
    } finally { counts.ownerReadValidationMs += performance.now() - started; }
  });

  return () => {
    for (const [name, descriptor] of originals) {
      if (descriptor) Object.defineProperty(ledger, name, descriptor);
      else delete ledger[name];
    }
  };
}

function blankCounters() {
  return { readCallsIncludingResolveInternals: 0, readCallsFromResolveInternals: 0, readScopes: [],
    resolveSourceCalls: 0, actualBuildIndexCalls: 0, buildIndexScopes: [], ownerReadBeginCalls: 0,
    ownerReadBeginSuccessCount: 0, ownerReadValidationCalls: 0, ownerReadValidationSuccessCount: 0,
    ownerReadValidationMs: 0 };
}

function runRetrieval(context, level, { timingRole }) {
  const counts = blankCounters();
  const ledger = context.store.pairLedger;
  const store = context.store;
  const beforeStoreCache = { ...store.folderSummaryCacheMetrics };
  const beforePairCacheSize = ledger.cache.size;
  const beforeDirectoryCacheSize = ledger.candidateDirectory.cache.size;
  const before = process.memoryUsage();
  const cpuBefore = process.cpuUsage();
  const restoreCounters = installLedgerCounters(context, counts);
  const start = performance.now();
  let result;
  let snapshotAudit = { calls: 0, uncertainRows: 0, exactStoreWeakMapSnapshot: true, sourceBytesStable: true };
  try {
    const audited = withTrustedSnapshotAudit(context, () => ({
      result: retrievePairMemorySources(makeRetrievalArgs(context, context.retrievalMode, level))
    }));
    result = audited.result;
    if (audited.trustedSnapshotAudit) snapshotAudit = audited.trustedSnapshotAudit;
  } finally { restoreCounters(); }
  const wallMs = performance.now() - start;
  const cpuDelta = process.cpuUsage(cpuBefore);
  const after = process.memoryUsage();
  const metrics = result?.metrics || {};
  const semantic = semanticEvidence(result, level, counts);
  const sample = {
    level,
    timingRole,
    wallMs,
    cpuUserMicroseconds: cpuDelta.user,
    cpuSystemMicroseconds: cpuDelta.system,
    rssBeforeBytes: before.rss,
    rssAfterBytes: after.rss,
    rssDeltaBytes: after.rss - before.rss,
    heapUsedBeforeBytes: before.heapUsed,
    heapUsedAfterBytes: after.heapUsed,
    actualBuildIndexCalls: counts.actualBuildIndexCalls,
    buildIndexScopeCount: counts.buildIndexScopes.length,
    readCallsIncludingResolveInternals: counts.readCallsIncludingResolveInternals,
    readCallsFromResolveInternals: counts.readCallsFromResolveInternals,
    retrievalAndRevisionReadCalls: counts.readCallsIncludingResolveInternals - counts.readCallsFromResolveInternals,
    readScopeCount: counts.readScopes.length,
    allReadScopesBelongToOwner: counts.readScopes.every(scope => scope.ownerId === OWNER_ID),
    resolveSourceCalls: counts.resolveSourceCalls,
    ownerValidation: {
      reportedMs: metrics.ownerValidationMs ?? null,
      beginCalls: counts.ownerReadBeginCalls,
      beginSuccessCount: counts.ownerReadBeginSuccessCount,
      validateCalls: counts.ownerReadValidationCalls,
      validateSuccessCount: counts.ownerReadValidationSuccessCount,
      measuredMs: counts.ownerReadValidationMs
    },
    directory: {
      status: metrics.candidateDirectoryStatus ?? null,
      cacheHit: metrics.candidateDirectoryCacheHit === true,
      buildMs: metrics.candidateDirectoryBuildMs ?? null,
      ownerPairCount: metrics.ownerPairCount ?? null,
      trustedCoveredScopeCount: metrics.trustedCoveredScopeCount ?? null,
      uncertainScopedScopeCount: metrics.uncertainScopedScopeCount ?? null,
      uncertainSourceCount: metrics.uncertainSourceCount ?? null,
      unscopedUnknownCount: metrics.unscopedUnknownCount ?? null,
      candidatePairCount: metrics.candidatePairCount ?? null,
      candidateReductionRatio: metrics.candidateReductionRatio ?? null,
      legacyScanFallbackCount: metrics.legacyScanFallbackCount ?? null,
      legacyScanFallbackReason: metrics.legacyScanFallbackReason ?? null,
      cacheEntriesBefore: beforeDirectoryCacheSize,
      cacheEntriesAfter: ledger.candidateDirectory.cache.size
    },
    pairIndex: {
      actualIndexReadCount: metrics.actualIndexReadCount ?? null,
      indexCacheHits: metrics.indexCacheHits ?? null,
      indexCacheMisses: metrics.indexCacheMisses ?? null,
      scopeRevisionChecks: metrics.scopeRevisionChecks ?? null,
      entriesBefore: beforePairCacheSize,
      entriesAfter: ledger.cache.size
    },
    storeCache: {
      hitsDelta: store.folderSummaryCacheMetrics.hits - beforeStoreCache.hits,
      missesDelta: store.folderSummaryCacheMetrics.misses - beforeStoreCache.misses,
      invalidationsDelta: store.folderSummaryCacheMetrics.invalidations - beforeStoreCache.invalidations
    },
    fallback: {
      status: result?.fallbackStatus ?? null,
      reason: metrics.fallbackReason ?? null,
      legacyFallbackUsed: metrics.legacyFallbackUsed === true,
      legacyFallbackEligible: result?.legacyFallbackEligible === true,
      tokenBudget: TOKEN_BUDGET,
      finalInjectedTokens: metrics.finalInjectedTokens ?? null,
      pairLedgerTokens: metrics.pairLedgerTokens ?? null,
      sourceRecallTokens: metrics.sourceRecallTokens ?? null,
      sourceResolveAttemptCount: metrics.sourceResolveAttemptCount ?? null
    },
    trustedSnapshotAudit: snapshotAudit,
    semantic
  };
  return { result, counts, sample };
}

function semanticEvidence(result, level, counts) {
  const items = Array.isArray(result?.items) ? result.items : [];
  const itemRows = items.map(item => {
    const source = item.source || {};
    const scope = item.scope || {};
    return [item.targetCharacterId ?? null, item.itemId ?? null, sha256(item.text || ""),
      item.conversationDate ?? null, item.conversationTotalDays ?? null, item.routeKind ?? null,
      scope.campaignToken ?? null, Number(scope.ownerId) || null, Number(scope.counterpartId) || null,
      source.sourceSummaryKey ?? null, source.sourceRevision ?? null, source.sourceItemOrdinal ?? null];
  });
  const resolvedSources = (Array.isArray(result?.sources) ? result.sources : []).map(source => {
    const memory = source.memory || {};
    return [source.sourceSummaryKey ?? null, source.sourceRevision ?? null,
      memory.memoryId ?? null, sha256(memory.content || ""), source.routeKind ?? null,
      Array.isArray(source.routeCharacterIds) ? source.routeCharacterIds.map(Number) : []];
  });
  const metrics = result?.metrics || {};
  const targetIds = [TARGET_ID];
  return {
    status: result?.status ?? null,
    textSha256: sha256(result?.text || ""),
    itemCount: items.length,
    itemIdentityAndOrderSha256: sha256(stableJson(itemRows)),
    sourceOutputCount: resolvedSources.length,
    sourceOutputSha256: sha256(stableJson(resolvedSources)),
    targetIdsSha256: sha256(stableJson(targetIds)),
    itemTargetIdsSha256: sha256(stableJson(items.map(item => Number(item.targetCharacterId)).sort((a, b) => a - b))),
    sourceResolveAttempts: counts.resolveSourceCalls,
    reportedSourceResolveAttempts: metrics.sourceResolveAttemptCount ?? 0,
    requestedTokenBudget: TOKEN_BUDGET,
    finalInjectedTokens: metrics.finalInjectedTokens ?? null,
    legacyFallbackUsed: metrics.legacyFallbackUsed === true,
    legacyFallbackEligible: result?.legacyFallbackEligible === true,
    fallbackStatus: result?.fallbackStatus ?? null,
    level
  };
}

function comparableSemantic(sample) {
  const { semantic } = sample;
  return {
    status: semantic.status,
    textSha256: semantic.textSha256,
    itemCount: semantic.itemCount,
    itemIdentityAndOrderSha256: semantic.itemIdentityAndOrderSha256,
    sourceOutputCount: semantic.sourceOutputCount,
    sourceOutputSha256: semantic.sourceOutputSha256,
    targetIdsSha256: semantic.targetIdsSha256,
    itemTargetIdsSha256: semantic.itemTargetIdsSha256,
    sourceResolveAttempts: semantic.sourceResolveAttempts,
    requestedTokenBudget: semantic.requestedTokenBudget,
    finalInjectedTokens: semantic.finalInjectedTokens,
    legacyFallbackUsed: semantic.legacyFallbackUsed,
    legacyFallbackEligible: semantic.legacyFallbackEligible,
    fallbackStatus: semantic.fallbackStatus
  };
}

function assertEquivalent(reference, candidate, label) {
  assert.deepEqual(comparableSemantic(candidate.sample), comparableSemantic(reference.sample),
    `${label}: candidate and exhaustive outputs must match item identity/order/text/source/revision/targets/attempts/budget/fallback`);
  assert.equal(reference.sample.semantic.reportedSourceResolveAttempts, reference.counts.resolveSourceCalls,
    `${label}: reference reported resolve attempts must equal actual calls`);
  assert.equal(candidate.sample.semantic.reportedSourceResolveAttempts, candidate.counts.resolveSourceCalls,
    `${label}: candidate reported resolve attempts must equal actual calls`);
  assert(candidate.sample.allReadScopesBelongToOwner && reference.sample.allReadScopesBelongToOwner,
    `${label}: every actual PairLedger read must stay within the trusted Owner`);
  for (const run of [reference, candidate]) {
    if (run.sample.fallback.finalInjectedTokens != null) {
      assert(run.sample.fallback.finalInjectedTokens <= TOKEN_BUDGET,
        `${label}: injected tokens must remain within the request budget`);
    }
  }
  if (candidate.sample.level === "L0" || candidate.sample.level === "L1") {
    assert.equal(candidate.counts.resolveSourceCalls, 0, `${label}: L0/L1 must not resolve raw sources`);
    assert.equal(reference.counts.resolveSourceCalls, 0, `${label}: L0/L1 reference must not resolve raw sources`);
  }
  if (candidate.sample.level === "L2") {
    assert(candidate.counts.resolveSourceCalls <= 2, `${label}: L2 must resolve no more than two sources`);
    assert(reference.counts.resolveSourceCalls <= 2, `${label}: reference L2 must resolve no more than two sources`);
  }
}

function expectedAliasPairs(fixture) {
  if (fixture.queryCase === "directhit") return [fixture.pairIds[0]];
  if (fixture.queryCase === "sparsehearsay") return fixture.pairCount > 1 ? [fixture.pairIds[1]] : [];
  if (fixture.queryCase === "allmention-worst") return [...fixture.pairIds];
  return [];
}

function assertScopedCandidate(candidate, fixture, level, label) {
  if (level === "L0") {
    assert.equal(candidate.counts.readCallsIncludingResolveInternals, 0, `${label}: L0 Pair reads must be zero`);
    assert.equal(candidate.counts.resolveSourceCalls, 0, `${label}: L0 source resolves must be zero`);
    return;
  }
  const directory = candidate.sample.directory;
  const metrics = candidate.result?.metrics || {};
  assert.equal(directory.legacyScanFallbackCount, 0,
    `${label}: COMPLETE or SCOPED_DEGRADED known-scope coverage must not count as a full fallback`);
  if (fixture.uncertainCount) {
    assert.equal(directory.status, "SCOPED_DEGRADED", `${label}: bounded old rows must use scoped degraded coverage`);
    assert.equal(directory.uncertainScopedScopeCount, fixture.uncertainCount,
      `${label}: each known old archive Pair must be counted as uncertain exactly once`);
    assert.equal(directory.unscopedUnknownCount, 0, `${label}: mapped old rows must not become unscoped unknown`);
    assert.equal(candidate.sample.trustedSnapshotAudit.uncertainRows, fixture.uncertainCount,
      `${label}: all bounded source-less rows must be observed through the real Store snapshot`);
  } else {
    assert.equal(directory.status, "COMPLETE", `${label}: all-standard fixture must have complete coverage`);
    assert.equal(directory.uncertainScopedScopeCount, 0);
  }
  const expected = new Set([...expectedAliasPairs(fixture)]);
  expected.add(TARGET_ID);
  for (const index of uncertainPairIndexes(fixture.pairCount, fixture.uncertainCount)) expected.add(fixture.pairIds[index]);
  assert.equal(directory.ownerPairCount, fixture.pairCount, `${label}: Owner universe count must match the real Store snapshot`);
  assert.equal(directory.candidatePairCount, expected.size,
    `${label}: candidate scope count must be direct ∪ alias matches ∪ scoped uncertainty`);
  if (metrics.sourceResolveAttemptCount != null) {
    assert.equal(metrics.sourceResolveAttemptCount, candidate.counts.resolveSourceCalls);
  }
}

function ratioUncertainCount(pairCount, percent) {
  if (percent === 0) return 0;
  return Math.min(pairCount, Math.max(1, Math.round(pairCount * percent / 100)));
}

function cellKey({ pairCount, oldPercent = null, uncertainCount = null, queryCase, level }) {
  const oldPart = oldPercent == null ? `u${uncertainCount}` : `p${oldPercent}`;
  return `n${pairCount}-${oldPart}-${queryCase}-${level}`;
}

function sampleRow(run, arm) {
  return {
    arm,
    wallMs: run.sample.wallMs,
    cpuUserMicroseconds: run.sample.cpuUserMicroseconds,
    cpuSystemMicroseconds: run.sample.cpuSystemMicroseconds,
    rssBeforeBytes: run.sample.rssBeforeBytes,
    rssAfterBytes: run.sample.rssAfterBytes,
    rssDeltaBytes: run.sample.rssDeltaBytes,
    actualBuildIndexCalls: run.sample.actualBuildIndexCalls,
    readCallsIncludingResolveInternals: run.sample.readCallsIncludingResolveInternals,
    readCallsFromResolveInternals: run.sample.readCallsFromResolveInternals,
    retrievalAndRevisionReadCalls: run.sample.retrievalAndRevisionReadCalls,
    resolveSourceCalls: run.sample.resolveSourceCalls,
    ownerValidation: run.sample.ownerValidation,
    directory: run.sample.directory,
    pairIndex: run.sample.pairIndex,
    storeCache: run.sample.storeCache,
    fallback: run.sample.fallback,
    trustedSnapshotAudit: run.sample.trustedSnapshotAudit,
    semantic: run.sample.semantic,
    readScopeCount: run.sample.readScopeCount,
    allReadScopesBelongToOwner: run.sample.allReadScopesBelongToOwner
  };
}

function makeCellFixture(label, pairCount, uncertainCount, queryCase, options) {
  return makeFixture(label, pairCount, uncertainCount, queryCase, options);
}

function runCorrectnessMatrix() {
  for (const oldPercent of OLD_RATIOS) {
    const pairCount = 5;
    const uncertainCount = ratioUncertainCount(pairCount, oldPercent);
    for (const queryCase of QUERY_CASES) {
      const fixture = makeCellFixture(`c5-r${oldPercent}-${queryCase}`, pairCount, uncertainCount, queryCase);
      for (const level of LEVELS) {
        const key = cellKey({ pairCount, oldPercent, queryCase, level });
        const cell = { key, pairCount, oldPercent, actualUncertainScopeCount: uncertainCount,
          actualUncertainRatioPercent: pairCount ? uncertainCount / pairCount * 100 : 0, queryCase, level,
          reference: null, candidate: null, equivalent: false };
        runState.correctnessCells.push(cell);
        const referenceContext = createContext(fixture, "exhaustive-reference", `${key}-reference`);
        const candidateContext = createContext(fixture, "safe-candidate-directory", `${key}-candidate`);
        const reference = runRetrieval(referenceContext, level, { timingRole: "SINGLE_CORRECTNESS_DIAGNOSTIC_NOT_P95" });
        const candidate = runRetrieval(candidateContext, level, { timingRole: "SINGLE_CORRECTNESS_DIAGNOSTIC_NOT_P95" });
        cell.reference = sampleRow(reference, "A_EXHAUSTIVE_REFERENCE");
        cell.candidate = sampleRow(candidate, "B_SAFE_CANDIDATE_DIRECTORY");
        assertEquivalent(reference, candidate, key);
        assertScopedCandidate(candidate, fixture, level, key);
        if (level !== "L0") {
          assert.equal(reference.sample.directory.candidatePairCount, pairCount,
            `${key}: exhaustive-reference must read every Owner Pair`);
          assert.equal(reference.sample.readScopeCount >= pairCount, true,
            `${key}: reference should expose actual full scope reads`);
        }
        cell.equivalent = true;
        runState.totalRetrievalCalls = (runState.totalRetrievalCalls || 0) + 2;
        flushRaw();
      }
    }
  }
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function percentile(values, fraction) {
  const sorted = [...values].sort((left, right) => left - right);
  if (!sorted.length) return null;
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
}

function summarizeWall(samples, { credibleP95 = true } = {}) {
  const values = samples.map(sample => sample.wallMs);
  return { sampleCount: values.length, p50Ms: median(values),
    p95Ms: credibleP95 ? percentile(values, 0.95) : null, credibleP95,
    minMs: values.length ? Math.min(...values) : null, maxMs: values.length ? Math.max(...values) : null };
}

function addGateFailure(cell, metric, limit, observed) {
  if (observed <= limit) return;
  const failure = { cellKey: cell.key, metric, limitMs: limit, observedMs: observed };
  runState.gateFailures.push(failure);
  cell.performanceGateFailures ||= [];
  cell.performanceGateFailures.push(failure);
}

function applyMatrixPerformanceGate(cell) {
  if (cell.pairCount !== 300 || cell.queryCase === "allmention-worst") return;
  const warm = cell.candidate?.warmSummary;
  if (!warm || cell.actualUncertainScopeCount > 5) return;
  addGateFailure(cell, "candidateWarmP95", 2000, warm.p95Ms);
  if (cell.actualUncertainScopeCount === 0) addGateFailure(cell, "candidateWarmP50", 1000, warm.p50Ms);
}

function runBenchmarkCell(fixture, spec) {
  const { pairCount, oldPercent = null, uncertainCount, queryCase, level, edge = false } = spec;
  const key = cellKey({ pairCount, oldPercent, uncertainCount: oldPercent == null ? uncertainCount : null,
    queryCase, level }) + (edge ? "-edge" : "");
  const cell = { key, pairCount, oldPercent, actualUncertainScopeCount: uncertainCount,
    actualUncertainRatioPercent: pairCount ? uncertainCount / pairCount * 100 : 0,
    queryCase, level, samplePlan: { referenceCold: 1, candidateCold: 10, candidateWarm: 20 },
    reference: null, candidate: { cold: [], warm: [] }, equivalent: false, warmSummary: null };
  runState.benchmarkCells.push(cell);
  const referenceContext = createContext(fixture, "exhaustive-reference", `${key}-reference`);
  const reference = runRetrieval(referenceContext, level, { timingRole: "A_REFERENCE_SINGLE_COLD_NOT_P95" });
  cell.reference = sampleRow(reference, "A_EXHAUSTIVE_REFERENCE_SINGLE_COLD");
  let warmContext = null;
  for (let index = 0; index < 10; index++) {
    const context = createContext(fixture, "safe-candidate-directory", `${key}-candidate-cold-${index}`);
    const candidate = runRetrieval(context, level, { timingRole: "B_DIRECTORY_INDEX_CACHE_COLD_AFTER_SNAPSHOT_LOAD" });
    cell.candidate.cold.push(sampleRow(candidate, "B_SAFE_CANDIDATE_COLD"));
    assertEquivalent(reference, candidate, `${key}-cold-${index}`);
    assertScopedCandidate(candidate, fixture, level, `${key}-cold-${index}`);
    if (index === 9) warmContext = context;
  }
  assert(warmContext, `${key}: last measured cold context must be reusable for warm samples`);
  for (let index = 0; index < 20; index++) {
    const candidate = runRetrieval(warmContext, level, { timingRole: "B_WARM_AFTER_LAST_MEASURED_COLD_NO_EXTRA_PRIME" });
    cell.candidate.warm.push(sampleRow(candidate, "B_SAFE_CANDIDATE_WARM"));
    assertEquivalent(reference, candidate, `${key}-warm-${index}`);
    assertScopedCandidate(candidate, fixture, level, `${key}-warm-${index}`);
  }
  cell.candidate.coldSummary = summarizeWall(cell.candidate.cold, { credibleP95: false });
  cell.candidate.warmSummary = summarizeWall(cell.candidate.warm);
  cell.reference.wallSummary = summarizeWall([cell.reference], { credibleP95: false });
  cell.equivalent = true;
  cell.referenceCallCount = 1;
  cell.candidateCallCount = 30;
  if (!edge) applyMatrixPerformanceGate(cell);
  else if (pairCount === 300 && uncertainCount <= 10 && queryCase === "sparsehearsay" && ["L1", "L2"].includes(level)) {
    const limit = uncertainCount <= 5 ? 2000 : 2500;
    addGateFailure(cell, "candidateWarmP95", limit, cell.candidate.warmSummary.p95Ms);
  }
  runState.totalRetrievalCalls = (runState.totalRetrievalCalls || 0) + 31;
  flushRaw();
}

function runUnscopedCorrectness() {
  const pairCount = 300;
  const fixture = makeFixture("benchmark-unscoped-unknown-300", pairCount, 0, "sparsehearsay", { unscopedUnknown: true });
  const cell = { key: "n300-u0-unscopedunknown-sparsehearsay-L1", pairCount, queryCase: "sparsehearsay", level: "L1",
    unscopedUnknownCount: 1, timingRole: "SINGLE_DIAGNOSTIC_NO_GATE", reference: null, candidate: null, disposition: null };
  runState.benchmarkCells.push(cell);
  const referenceContext = createContext(fixture, "exhaustive-reference", `${cell.key}-reference`);
  const candidateContext = createContext(fixture, "safe-candidate-directory", `${cell.key}-candidate`);
  const reference = runRetrieval(referenceContext, "L1", { timingRole: "UNSCOPED_SINGLE_REFERENCE_DIAGNOSTIC" });
  const candidate = runRetrieval(candidateContext, "L1", { timingRole: "UNSCOPED_SINGLE_CANDIDATE_DIAGNOSTIC" });
  cell.reference = sampleRow(reference, "A_EXHAUSTIVE_REFERENCE_SINGLE_DIAGNOSTIC");
  cell.candidate = sampleRow(candidate, "B_SAFE_CANDIDATE_SINGLE_DIAGNOSTIC");
  const same = stableJson(comparableSemantic(candidate.sample)) === stableJson(comparableSemantic(reference.sample));
  const candidateStatus = candidate.sample.directory.status;
  if (same) {
    assert.equal(candidate.sample.directory.candidatePairCount, pairCount,
      "unscoped unknown must force exhaustive Owner scope enumeration");
    assert.equal(candidate.sample.directory.legacyScanFallbackCount, 1,
      "unscoped unknown full scan must be counted as a full fallback");
    cell.disposition = "SAFE_EXHAUSTIVE_FALLBACK";
  } else {
    assert.equal(candidate.sample.semantic.itemCount, 0,
      "a safe refusal on unscoped unknown must not inject unverified items");
    assert.equal(candidate.sample.semantic.textSha256, sha256(""),
      "a safe refusal on unscoped unknown must return no Legacy text");
    assert.notEqual(candidate.sample.semantic.status, "INDEX_MISS",
      "an unscoped unknown refusal must not masquerade as a proven search miss");
    assert(!["COMPLETE", "SCOPED_DEGRADED"].includes(candidateStatus),
      "an unscoped unknown may never be represented as conservative complete coverage");
    cell.disposition = "SAFE_FAIL_CLOSED";
  }
  if (candidateStatus === "SCOPED_DEGRADED") {
    assert.equal(candidate.sample.directory.unscopedUnknownCount, 1,
      "an unscoped unknown must remain visible in diagnostics");
  }
  cell.equivalent = same;
  runState.totalRetrievalCalls = (runState.totalRetrievalCalls || 0) + 2;
  flushRaw();
}

function runBenchmark() {
  for (const pairCount of PAIR_COUNTS) {
    for (const oldPercent of OLD_RATIOS) {
      const uncertainCount = ratioUncertainCount(pairCount, oldPercent);
      for (const queryCase of QUERY_CASES) {
        const fixture = makeFixture(`b${pairCount}-r${oldPercent}-${queryCase}`, pairCount, uncertainCount, queryCase);
        for (const level of LEVELS) runBenchmarkCell(fixture,
          { pairCount, oldPercent, uncertainCount, queryCase, level });
      }
    }
  }

  for (const uncertainCount of [1, 5, 10]) {
    const fixture = makeFixture(`b300-u${uncertainCount}-sparse`, 300, uncertainCount, "sparsehearsay");
    for (const level of ["L1", "L2"]) runBenchmarkCell(fixture,
      { pairCount: 300, uncertainCount, queryCase: "sparsehearsay", level, edge: true });
  }
  runUnscopedCorrectness();
}

function runEstimate() {
  const specs = [
    { pairCount: 100, uncertainCount: 0, queryCase: "sparsehearsay", level: "L1" },
    { pairCount: 100, uncertainCount: 5, queryCase: "sparsehearsay", level: "L2" },
    { pairCount: 300, uncertainCount: 0, queryCase: "sparsehearsay", level: "L1" },
    ...[1, 5, 10].flatMap(uncertainCount => ["L1", "L2"].map(level =>
      ({ pairCount: 300, uncertainCount, queryCase: "sparsehearsay", level })))
  ];
  for (const [index, spec] of specs.entries()) {
    const fixture = makeFixture(`estimate-${index}-n${spec.pairCount}-u${spec.uncertainCount}`,
      spec.pairCount, spec.uncertainCount, spec.queryCase);
    const key = cellKey(spec);
    const context = createContext(fixture, "safe-candidate-directory", `estimate-${index}-candidate`);
    const candidate = runRetrieval(context, spec.level, { timingRole: "CANDIDATE_ONLY_SINGLE_SHOT_NOT_P95" });
    assertScopedCandidate(candidate, fixture, spec.level, key);
    runState.estimateSamples.push({ key, pairCount: spec.pairCount, uncertainScopeCount: spec.uncertainCount,
      queryCase: spec.queryCase, level: spec.level, sampleCount: 1, timingRole: "NOT_P95",
      candidate: sampleRow(candidate, "B_SAFE_CANDIDATE_ONLY") });
    runState.totalRetrievalCalls = (runState.totalRetrievalCalls || 0) + 1;
    flushRaw();
  }
  const grouped = new Map();
  for (const sample of runState.estimateSamples) {
    const groupKey = `${sample.pairCount}-pair-${sample.level}`;
    if (!grouped.has(groupKey)) grouped.set(groupKey, []);
    grouped.get(groupKey).push(sample.candidate.wallMs);
  }
  runState.estimateSummary = {
    credibleP95: false,
    candidateOnly: true,
    groups: [...grouped].map(([key, values]) => ({ key, singleSampleCount: values.length,
      observedMinMs: Math.min(...values), observedMaxMs: Math.max(...values), medianSingleShotMs: median(values) })),
    formalBenchmarkForecast: totalCalls.benchmark,
    note: "Single-shot candidate samples are a cost calibration only; do not use as P50/P95 or as an exhaustive-reference estimate."
  };
}

function printSafeFailureStack(error) {
  const name = error?.name || "Error";
  const code = error?.code || "HARNESS_ASSERTION_FAILED";
  const allowedFrame = /test-v9\.3\.6\.3-mixed-archive-ab\.js|src[\\/]app[\\/]main[\\/]memory-system[\\/](?:pair-memory-source-retrieval|owner-target-candidate-directory|pair-long-term-ledger|memory-store)\.js/u;
  const frames = String(error?.stack || "").split(/\r?\n/u).slice(1).filter(frame => allowedFrame.test(frame));
  console.error(`HARNESS_FAILURE ${name} [${code}]`);
  if (frames.length) console.error(`HARNESS_STACK\n${frames.slice(0, 12).join("\n")}`);
  else console.error("HARNESS_STACK no approved fixture/runtime source locations");
}

try {
  if (runMode === "correctness") runCorrectnessMatrix();
  else if (runMode === "estimate") runEstimate();
  else runBenchmark();
  if (runMode === "benchmark" && runState.gateFailures.length) {
    runState.failures.push({ name: "PerformanceGateError", code: "V9363_PERFORMANCE_GATE_FAILED",
      failureCount: runState.gateFailures.length });
  }
  runState.completed = runState.failures.length === 0;
} catch (error) {
  printSafeFailureStack(error);
  runState.failures.push({ name: error?.name || "Error", code: error?.code || "HARNESS_ASSERTION_FAILED",
    message: String(error?.code || error?.name || "HARNESS_ASSERTION_FAILED").slice(0, 120) });
} finally {
  try { flushRaw(); }
  finally {
    if (fs.existsSync(tempRoot)) fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

const completedCount = runMode === "correctness" ? runState.correctnessCells.length
  : runMode === "benchmark" ? runState.benchmarkCells.length : runState.estimateSamples.length;
console.log(`${runState.completed ? "PASS" : "FAIL"} V9.3.6.3 mixed archive ${runMode}: ${completedCount} records, `
  + `${runState.totalRetrievalCalls || 0} retrieval calls, raw=${path.relative(repoRoot, outputPath)}`);
if (runState.gateFailures.length) console.error(`PERFORMANCE GATES FAILED: ${runState.gateFailures.length}`);
if (!runState.completed) process.exitCode = 1;
