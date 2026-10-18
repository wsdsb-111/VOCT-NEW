"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const versionPath = require.resolve("../src/app/main/version");
require.cache[versionPath] = { id: versionPath, filename: versionPath, loaded: true,
  exports: require("../resources/app/out/main/version") };
const { MemoryEngine } = require("../src/app/main/memory-system/memory-engine");
const { retrievePairMemorySources } = require("../src/app/main/memory-system/pair-memory-source-retrieval");
const { resolveTrustedPlayerTurn } = require("../src/app/main/memory-system/pair-memory-routing");
const { normalizeGameDate } = require("../src/app/main/worldline/character-temporal-facts");

const repoRoot = path.resolve(__dirname, "..");
const buildRoot = path.join(repoRoot, ".build");
fs.mkdirSync(buildRoot, { recursive: true });
const tempRoot = fs.mkdtempSync(path.join(buildRoot, "v9363-legacy-scoped-"));
const OWNER_ID = 200;
const PLAYER_ID = 100;
const TARGET_ID = 300;
const CAMPAIGN = "v9363-legacy-scoped-campaign";
const OTHER_CAMPAIGN = "v9363-legacy-scoped-other-campaign";
const CURRENT_DATE = "1200.1.1";
const CURRENT_TOTAL_DAYS = normalizeGameDate(CURRENT_DATE).serial;
const TARGET_ALIAS = "TargetAlias";
const OWNER_NAME = "回应者乙";
const TARGET_NAME = "目标人物丙";
let passed = 0;
let failed = 0;
const failures = [];
const observations = [];
let activeObservation = null;

function digest(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function check(id, label, fn) {
  const observation = { id, label, status: "RUNNING", retrievals: [], abComparisons: [], notes: [] };
  observations.push(observation);
  activeObservation = observation;
  try {
    fn();
    observation.status = "PASS";
    passed++;
    console.log(`PASS ${id} ${label}`);
  } catch (error) {
    observation.status = "FAIL";
    failed++;
    failures.push({ id, label, error });
    console.error(`FAIL ${id} ${label}: ${error && error.stack || error}`);
  } finally {
    activeObservation = null;
  }
}

function captureRetrieval(fixture, options, result) {
  if (!activeObservation) return null;
  const metrics = result.metrics || {};
  const mode = options.retrievalMode || fixture.engine.store.pairLedger.retrievalMode || "safe-candidate-directory";
  const row = {
    mode,
    fallbackStatus: result.fallbackStatus || null,
    fallbackReason: metrics.legacyScanFallbackReason || metrics.fallbackReason || null,
    candidateDirectoryStatus: metrics.candidateDirectoryStatus || null,
    candidatePairCount: Number(metrics.candidatePairCount) || 0,
    ownerPairCount: Number(metrics.ownerPairCount) || 0,
    trustedCoveredScopeCount: Number(metrics.trustedCoveredScopeCount) || 0,
    uncertainScopedScopeCount: Number(metrics.uncertainScopedScopeCount) || 0,
    uncertainSourceCount: Number(metrics.uncertainSourceCount) || 0,
    unscopedUnknownCount: Number(metrics.unscopedUnknownCount) || 0,
    legacyScanFallbackCount: Number(metrics.legacyScanFallbackCount) || 0,
    actualIndexReadCount: Number(metrics.actualIndexReadCount) || 0,
    sourceResolveAttemptCount: Number(metrics.sourceResolveAttemptCount) || 0,
    itemCount: Array.isArray(result.items) ? result.items.length : 0,
    itemIdentityOrderHash: digest((result.items || []).map(itemFingerprint)),
    resolvedSourceOrderHash: digest(resolvedSourceFingerprintRows(result)),
    scopeRevisionHash: digest(metrics.scopeRevisions || []),
    textHash: digest(result.text || "")
  };
  activeObservation.retrievals.push(row);
  return row;
}

function validatePlayerMemoryContextMeasured(engine, context, gameData, conversationId) {
  const ledger = engine.store.pairLedger;
  const originalRead = ledger.read;
  const originalResolve = ledger.resolveSource;
  let pairLedgerReadCount = 0;
  let sourceResolveCount = 0;
  ledger.read = function (...args) {
    pairLedgerReadCount++;
    return originalRead.apply(this, args);
  };
  ledger.resolveSource = function (...args) {
    sourceResolveCount++;
    return originalResolve.apply(this, args);
  };
  try {
    return { validation: engine.validatePlayerMemoryContext(context, gameData, conversationId),
      pairLedgerReadCount, sourceResolveCount };
  } finally {
    ledger.read = originalRead;
    ledger.resolveSource = originalResolve;
  }
}

function attachDirectoryObservation(mode, directory) {
  if (!activeObservation || !directory) return;
  const row = [...activeObservation.retrievals].reverse().find(entry => entry.mode === mode);
  if (!row) return;
  row.directory = {
    status: directory.status || null,
    reason: directory.reason || null,
    coverage: directory.coverage || null,
    candidateCounterpartIds: Array.isArray(directory.candidateCounterpartIds)
      ? [...directory.candidateCounterpartIds] : [],
    uncertainCounterpartIds: Array.isArray(directory.uncertainCounterpartIds)
      ? [...directory.uncertainCounterpartIds] : [],
    trustedCoveredScopeCount: Number(directory.trustedCoveredScopeCount) || 0,
    uncertainScopedScopeCount: Number(directory.uncertainScopedScopeCount) || 0,
    uncertainSourceCount: Number(directory.uncertainSourceCount) || 0,
    unscopedUnknownCount: Number(directory.unscopedUnknownCount) || 0
  };
}

function recordABComparison(label, safe, reference) {
  if (!activeObservation) return;
  const safeFingerprints = (safe.items || []).map(itemFingerprint);
  const referenceFingerprints = (reference.items || []).map(itemFingerprint);
  const safeSources = resolvedSourceFingerprintRows(safe);
  const referenceSources = resolvedSourceFingerprintRows(reference);
  activeObservation.abComparisons.push({
    label,
    itemsAndOrderEqual: JSON.stringify(safeFingerprints) === JSON.stringify(referenceFingerprints),
    sourceKeyRevisionOrderEqual: JSON.stringify(safeSources) === JSON.stringify(referenceSources),
    formattedTextEqual: safe.text === reference.text,
    safeItemIdentityOrderHash: digest(safeFingerprints),
    referenceItemIdentityOrderHash: digest(referenceFingerprints),
    safeResolvedSourceOrderHash: digest(safeSources),
    referenceResolvedSourceOrderHash: digest(referenceSources),
    safeFallbackStatus: safe.fallbackStatus || null,
    referenceFallbackStatus: reference.fallbackStatus || null,
    safeCandidatePairCount: Number(safe.metrics?.candidatePairCount) || 0,
    referenceCandidatePairCount: Number(reference.metrics?.candidatePairCount) || 0,
    safeLegacyFallbackCount: Number(safe.metrics?.legacyScanFallbackCount) || 0,
    referenceReason: reference.metrics?.legacyScanFallbackReason || reference.metrics?.fallbackReason || null
  });
}

function makeFixture(name) {
  const root = path.join(tempRoot, name);
  const engine = new MemoryEngine({ baseDir: path.join(root, "memory"),
    summaryFoldersDir: path.join(root, "summaries"), trace: { record() {} } });
  fs.mkdirSync(engine.store.summaryFoldersDir, { recursive: true });
  return { name, root, engine, files: new Map(), summaries: new Map(), memories: null };
}

function summaryContent(marker, matter, date = "1190.1.1") {
  return `QA_SOURCE_${marker}：合成叙事。\n\n【需要长期记住的事项】\n- ${marker}：${matter}\n【其他事项】\n合成来源。`;
}

function makeSummary(counterpartId, marker, matter, options = {}) {
  const ownerId = Number(options.ownerId || OWNER_ID);
  const date = options.date || "1190.1.1";
  const summary = {
    date,
    totalDays: normalizeGameDate(date).serial,
    content: options.content === undefined ? summaryContent(marker, matter, date) : options.content,
    playerId: ownerId,
    playerName: options.ownerName || OWNER_NAME,
    perspectiveOwnerId: ownerId,
    campaignToken: options.campaignToken || CAMPAIGN,
    campaignBinding: options.campaignBinding || { status: "bound", source: "synthetic_fixture", version: 1 },
    finalizationId: options.finalizationId === undefined ? `qa-${marker}` : options.finalizationId,
    conversationId: options.conversationId === undefined ? `conversation-${marker}` : options.conversationId,
    conversationType: "pair",
    participants: [{ id: ownerId, name: options.ownerName || OWNER_NAME }]
  };
  if (Number.isSafeInteger(counterpartId) && counterpartId > 0) {
    summary.characterId = counterpartId;
    summary.characterName = options.counterpartName || `人物${counterpartId}`;
    summary.participants.push({ id: counterpartId, name: summary.characterName });
  }
  if (options.projectionId) summary.projectionId = options.projectionId;
  return summary;
}

function ownerFolder(fixture, ownerId = OWNER_ID) {
  const name = `${ownerId}_${ownerId === OWNER_ID ? OWNER_NAME : `人物${ownerId}`}`;
  const folder = path.join(fixture.engine.store.summaryFoldersDir, name);
  fs.mkdirSync(folder, { recursive: true });
  return { name, folder };
}

function appendSummary(fixture, counterpartId, summary, options = {}) {
  const ownerId = Number(options.ownerId || OWNER_ID);
  const { folder } = ownerFolder(fixture, ownerId);
  const fileName = options.fileName || `与${summary.characterName || `人物${counterpartId || "未知"}`}的对话.json`;
  const filePath = path.join(folder, fileName);
  const rows = fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, "utf8")) : [];
  rows.push(summary);
  fs.writeFileSync(filePath, JSON.stringify(rows, null, 2), "utf8");
  const key = options.key || `qa-${summary.finalizationId || summary.conversationId || fileName}`;
  fixture.files.set(key, filePath);
  fixture.summaries.set(key, summary);
  return filePath;
}

function refreshOwner(fixture, ownerId = OWNER_ID) {
  fixture.engine.store.invalidateFolderSummaryCache([ownerId]);
  if (ownerId === OWNER_ID) fixture.memories = fixture.engine.store.loadFolderSummariesForCharacter(ownerId);
  else return fixture.engine.store.loadFolderSummariesForCharacter(ownerId);
  return fixture.memories;
}

function seedFixture(fixture, pairCount = 20, options = {}) {
  appendSummary(fixture, TARGET_ID, makeSummary(TARGET_ID, `${fixture.name}_DIRECT`, "乙与丙当面讨论盐税账册。"),
    { key: "direct" });
  const aliasId = options.aliasId || 9000;
  appendSummary(fixture, aliasId, makeSummary(aliasId, `${fixture.name}_ALIAS`, `${TARGET_ALIAS}提到盐税账册需要复核。`),
    { key: "alias" });
  const reserved = new Set([TARGET_ID, aliasId]);
  let created = 2;
  for (let offset = 0; created < pairCount; offset++) {
    const counterpartId = 10000 + offset;
    if (reserved.has(counterpartId)) continue;
    appendSummary(fixture, counterpartId,
      makeSummary(counterpartId, `${fixture.name}_DECOY_${offset}`, `合成人物${counterpartId}讨论无关账册。`),
      { key: `decoy-${offset}` });
    created++;
  }
  refreshOwner(fixture);
  return fixture;
}

function profiles(extra = []) {
  return [
    { characterId: TARGET_ID, name: TARGET_NAME, aliases: [TARGET_NAME, TARGET_ALIAS, "王后·目标人物丙"] },
    ...extra
  ];
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
    queryFingerprint: `v9363-perf02-${level}`
  };
}

function retrieve(fixture, options = {}) {
  const level = options.level || "L1";
  const currentGameDate = options.currentGameDate || CURRENT_DATE;
  const ownerId = Number(options.ownerId || OWNER_ID);
  const result = retrievePairMemorySources({
    mode: level === "L2" ? "THIRD_PERSON_SOURCE_DETAIL" : "THIRD_PERSON_LEDGER",
    retrievalMode: options.retrievalMode,
    store: fixture.engine.store,
    ownerId,
    decision: decision(level),
    entitiesProfile: options.profiles || profiles(),
    campaignToken: options.campaignToken || CAMPAIGN,
    currentGameDate,
    currentTotalDays: normalizeGameDate(currentGameDate).serial,
    memories: options.memories || (ownerId === OWNER_ID ? fixture.memories : fixture.engine.store.loadFolderSummariesForCharacter(ownerId)),
    query: options.query || `你以前和${TARGET_ALIAS}的关系如何？`,
    sceneRevision: options.sceneRevision || "scene-1",
    tokenBudget: options.tokenBudget === undefined ? 100000 : options.tokenBudget,
    estimateTokens: value => Math.ceil(String(value || "").length / 2)
  });
  captureRetrieval(fixture, options, result);
  return result;
}

function itemFingerprint(item) {
  const source = item.source || {};
  const scope = item.scope || {};
  return [Number(item.targetCharacterId), item.targetName, item.itemId, item.text, item.conversationDate,
    item.conversationTotalDays, item.routeKind, scope.campaignToken, Number(scope.ownerId), Number(scope.counterpartId),
    source.sourceSummaryKey, source.sourceRevision, source.sourceItemOrdinal];
}

function resolvedSourceFingerprintRows(result) {
  return (result.sources || []).map(source => [Number(source.sourceScopeCharacterId), Number(source.targetCharacterId),
    source.sourceSummaryKey, source.sourceRevision]);
}

function instrument(ledger, fn) {
  const originalRead = ledger.read.bind(ledger);
  const originalResolve = ledger.resolveSource.bind(ledger);
  const originalDirectory = ledger.candidateDirectory.getCandidateScopes.bind(ledger.candidateDirectory);
  const counts = { reads: 0, readScopes: [], resolves: 0, directory: null };
  ledger.read = (...args) => {
    const scope = args[0] || {};
    counts.reads++;
    counts.readScopes.push({ ownerId: Number(scope.ownerId), counterpartId: Number(scope.counterpartId) });
    return originalRead(...args);
  };
  ledger.resolveSource = (...args) => { counts.resolves++; return originalResolve(...args); };
  ledger.candidateDirectory.getCandidateScopes = (...args) => {
    const result = originalDirectory(...args);
    counts.directory = result;
    return result;
  };
  try { return { value: fn(), counts }; }
  finally {
    ledger.read = originalRead;
    ledger.resolveSource = originalResolve;
    ledger.candidateDirectory.getCandidateScopes = originalDirectory;
  }
}

function compareSafeWithReference(fixture, options = {}) {
  const ledger = fixture.engine.store.pairLedger;
  ledger.invalidate();
  const reference = retrieve(fixture, { ...options, retrievalMode: "exhaustive-reference" });
  ledger.invalidate();
  const measured = instrument(ledger, () => retrieve(fixture, { ...options, retrievalMode: "safe-candidate-directory" }));
  const safe = measured.value;
  assert.deepEqual(safe.items.map(itemFingerprint), reference.items.map(itemFingerprint),
    "safe retrieval must preserve exhaustive item order, source key/revision, target and Pair scope");
  assert.deepEqual(resolvedSourceFingerprintRows(safe), resolvedSourceFingerprintRows(reference),
    "safe and exhaustive retrieval must resolve the same sources with the same source revisions");
  assert.equal(safe.text, reference.text, "safe and exhaustive retrieval must preserve formatted memory");
  assert(safe.items.every(item => Number(item.scope?.ownerId) === OWNER_ID), "retrieved history must remain Owner scoped");
  attachDirectoryObservation("safe-candidate-directory", measured.counts.directory);
  recordABComparison("safe-vs-exhaustive", safe, reference);
  return { safe, reference, measured };
}

function targetMemory(fixture, counterpartId) {
  const row = fixture.memories.find(memory => Number(memory.provenance?.folderOwnerId) === OWNER_ID
    && memory.provenance?.counterpartIds?.map(Number).includes(Number(counterpartId)));
  assert(row, `fixture must load an Owner memory for Pair ${counterpartId}`);
  return row;
}

function uniqueReadScopes(measured) {
  return [...new Set(measured.counts.readScopes.map(row => `${row.ownerId}:${row.counterpartId}`))]
    .map(value => value.split(":").map(Number)).map(([ownerId, counterpartId]) => ({ ownerId, counterpartId }));
}

function assertScopedLocal(result, counterpartIds, { maxCandidatePairs = null } = {}) {
  const { safe, measured } = result;
  const directory = measured.counts.directory;
  assert(directory, "safe retrieval must build the actual OwnerTargetCandidateDirectory");
  assert.equal(directory.status, "SCOPED_DEGRADED", "locatable legacy coverage gaps must remain Pair scoped");
  assert.equal(directory.coverage, "CONSERVATIVE_SUPERSET", "scoped uncertainty must be a conservative candidate superset");
  for (const counterpartId of counterpartIds) {
    assert(directory.candidateCounterpartIds.includes(counterpartId), `uncertain Pair ${counterpartId} must be included`);
  }
  assert.equal(safe.metrics.legacyScanFallbackCount, 0, "scoped uncertainty must not trigger Owner-wide fallback");
  assert(Number(safe.metrics.uncertainScopedScopeCount) >= counterpartIds.length,
    "reported uncertain scope count must include every mapped legacy Pair");
  assert(Number(safe.metrics.uncertainSourceCount) >= 1, "reported uncertain source count must be non-zero");
  const observed = uniqueReadScopes(measured).map(row => row.counterpartId);
  for (const counterpartId of counterpartIds) assert(observed.includes(counterpartId), `PairLedger must revalidate Pair ${counterpartId}`);
  assert(observed.every(id => measured.counts.readScopes.every(row => row.ownerId === OWNER_ID)),
    "scope revalidation must not cross the selected Owner");
  if (maxCandidatePairs != null) assert(safe.metrics.candidatePairCount <= maxCandidatePairs,
    "candidate set must stay within its explicitly scoped bound");
}

function runC01() {
  const fixture = seedFixture(makeFixture("C01-300-complete"), 300);
  const result = compareSafeWithReference(fixture);
  assert.equal(result.safe.metrics.candidateDirectoryStatus, "COMPLETE");
  assert.equal(result.safe.metrics.ownerPairCount, 300, "C01 must use exactly 300 eligible Pair scopes");
  assert(result.safe.metrics.candidatePairCount < 10, "a sparse target query must avoid reading unrelated scopes");
  assert(result.safe.metrics.trustedCoveredScopeCount >= 298, "trusted complete scopes must be counted");
  assert.equal(result.safe.metrics.unscopedUnknownCount, 0);
  assert(Number.isFinite(result.safe.metrics.ownerValidationMs) && result.safe.metrics.ownerValidationMs >= 0,
    "Owner validation elapsed time must be measured from the actual validation path");
}

function runC02() {
  const fixture = seedFixture(makeFixture("C02-one-scoped-old"), 300);
  const id = 9101;
  const file = appendSummary(fixture, id, makeSummary(id, "C02_OLD_EMPTY_SOURCES", `${TARGET_ALIAS}的旧账册曾被复核。`),
    { fileName: "legacy-old-format.json", key: "legacy-one" });
  fixture.memories = refreshOwner(fixture);
  const memory = targetMemory(fixture, id);
  assert.equal(memory.provenance.pairLedgerSources.length, 0, "C02 must use a real unindexed legacy JSON record");
  assert(fs.existsSync(file));
  const result = compareSafeWithReference(fixture);
  assertScopedLocal(result, [id], { maxCandidatePairs: 5 });
  assert.equal(result.safe.metrics.unscopedUnknownCount, 0);
}

function runC03() {
  const fixture = seedFixture(makeFixture("C03-five-scoped-old"), 300);
  const ids = [9201, 9202, 9203, 9204, 9205];
  for (const id of ids) appendSummary(fixture, id, makeSummary(id, `C03_OLD_${id}`, `${TARGET_ALIAS}曾讨论第${id}号账册。`),
    { fileName: `legacy-${id}.json`, key: `legacy-${id}` });
  refreshOwner(fixture);
  const result = compareSafeWithReference(fixture);
  assertScopedLocal(result, ids, { maxCandidatePairs: 10 });
  assert(result.safe.metrics.candidatePairCount < result.safe.metrics.ownerPairCount,
    "five locatable old sources must not expand to all 300 Pair scopes");
}

function runC04() {
  const fixture = seedFixture(makeFixture("C04-null-raw-summary"), 24);
  const id = 9301;
  appendSummary(fixture, id, makeSummary(id, "C04_NULL_RAW", `${TARGET_ALIAS}提到旧盟约。`), { key: "null-raw" });
  refreshOwner(fixture);
  const memory = targetMemory(fixture, id);
  const source = memory.provenance.pairLedgerSources.find(row => Number(row.counterpartId) === id);
  assert(source?.rawSummary, "C04 needs a real source row before fault injection");
  source.rawSummary = null;
  fixture.engine.store.pairLedger.invalidate();
  const result = compareSafeWithReference(fixture);
  assertScopedLocal(result, [id], { maxCandidatePairs: 5 });
}

function runC05() {
  const fixture = seedFixture(makeFixture("C05-missing-source-fingerprint"), 24);
  const id = 9401;
  appendSummary(fixture, id, makeSummary(id, "C05_MISSING_DIGEST", `${TARGET_ALIAS}提到边境税。`), { key: "missing-digest" });
  refreshOwner(fixture);
  const source = targetMemory(fixture, id).provenance.pairLedgerSources[0];
  source.fileDigest = null;
  source.fileSignature = null;
  fixture.engine.store.pairLedger.invalidate();
  const result = compareSafeWithReference(fixture);
  assert.deepEqual(result.safe.items.map(itemFingerprint), result.reference.items.map(itemFingerprint));
  assert(result.safe.metrics.candidatePairCount < result.safe.metrics.ownerPairCount,
    "source fingerprint loss must be revalidated without selecting the whole Owner");
  assert(result.measured.counts.readScopes.some(row => row.counterpartId === id),
    "the Pair whose source fingerprint is missing must reach authoritative PairLedger.read");
  if (["SOURCE_STALE", "INDEX_UNAVAILABLE"].includes(result.safe.fallbackStatus)) {
    assert.equal(result.safe.text, "", "unverifiable source metadata must fail closed without stale recall");
    assert.equal(result.safe.legacyFallbackEligible, false,
      "an Owner/source validation failure must not be converted into Legacy fallback");
  }
}

function runC06() {
  const fixture = seedFixture(makeFixture("C06-counterpart-coverage-gap"), 24);
  const first = 9501, second = 9502;
  const content = summaryContent("C06_MERGED", `${TARGET_ALIAS}记录了两份投影的共同事实。`);
  const finalizationId = "C06_SHARED_FINALIZATION";
  appendSummary(fixture, first, makeSummary(first, "C06_PROJECTION_A", "共同事实。", { content, finalizationId }),
    { key: "projection-a" });
  appendSummary(fixture, second, makeSummary(second, "C06_PROJECTION_B", "共同事实。", { content, finalizationId }),
    { key: "projection-b" });
  refreshOwner(fixture);
  const merged = targetMemory(fixture, first);
  assert(merged.provenance.counterpartIds.map(Number).includes(second), "C06 must merge both trusted Pair identities");
  merged.provenance.pairLedgerSources = merged.provenance.pairLedgerSources.filter(row => Number(row.counterpartId) !== second);
  fixture.engine.store.pairLedger.invalidate();
  const result = compareSafeWithReference(fixture);
  assertScopedLocal(result, [second], { maxCandidatePairs: 5 });
}

function runC07() {
  const fixture = seedFixture(makeFixture("C07-unscoped-unknown"), 18);
  appendSummary(fixture, null, makeSummary(null, "C07_UNKNOWN_PAIR", `${TARGET_ALIAS}被记录在无法归属的旧档中。`),
    { fileName: "legacy-unattributed.json", key: "unknown-owner-memory" });
  refreshOwner(fixture);
  const unscoped = fixture.memories.find(memory => memory.content.includes("C07_UNKNOWN_PAIR"));
  assert(unscoped, "C07 must load a valid Owner record without a counterpart identity");
  assert.deepEqual(unscoped.provenance.counterpartIds, []);
  assert.deepEqual(unscoped.provenance.pairLedgerSources, []);
  const measured = instrument(fixture.engine.store.pairLedger,
    () => retrieve(fixture, { retrievalMode: "safe-candidate-directory" }));
  const allScopes = instrument(fixture.engine.store.pairLedger,
    () => retrieve(fixture, { retrievalMode: "exhaustive-reference" }));
  assert.equal(measured.value.metrics.legacyScanFallbackCount, 1,
    "a truly unscoped source must take the exhaustive safety path");
  assert.equal(measured.value.metrics.candidatePairCount, allScopes.value.metrics.candidatePairCount,
    "unscoped unknown must read every known Owner Pair scope");
  assert(Number(measured.value.metrics.unscopedUnknownCount) >= 1);
  assert.deepEqual(measured.value.items.map(itemFingerprint), allScopes.value.items.map(itemFingerprint));
  attachDirectoryObservation("safe-candidate-directory", measured.counts.directory);
  recordABComparison("unscoped-safe-vs-exhaustive", measured.value, allScopes.value);
  assert(!measured.value.text.includes("C07_UNKNOWN_PAIR"), "an unattributed old record cannot gain recall permission");
}

function runC08() {
  const fixture = seedFixture(makeFixture("C08-damaged-source"), 16);
  const { folder } = ownerFolder(fixture);
  fs.writeFileSync(path.join(folder, "与人物9808的对话.json"), "[{malformed", "utf8");
  refreshOwner(fixture);
  const ledger = fixture.engine.store.pairLedger;
  const safeMeasured = instrument(ledger, () => retrieve(fixture, { retrievalMode: "safe-candidate-directory" }));
  ledger.invalidate();
  const reference = retrieve(fixture, { retrievalMode: "exhaustive-reference" });
  const result = safeMeasured.value;
  assert.equal(result.fallbackStatus, "SOURCE_STALE", "a malformed Owner source must fail closed");
  assert.equal(result.text, "", "a malformed Owner source cannot inject cached memory");
  assert.equal(result.legacyFallbackEligible, false, "a corrupt Owner snapshot must not enter Legacy fallback");
  assert.equal(reference.fallbackStatus, result.fallbackStatus);
  assert.equal(reference.text, result.text);
  attachDirectoryObservation("safe-candidate-directory", safeMeasured.counts.directory);
  recordABComparison("malformed-owner-safe-vs-exhaustive", result, reference);
}

function runC19() {
  const fixture = seedFixture(makeFixture("C19-valid-nonarray-owner-json"), 18);
  const { folder } = ownerFolder(fixture);
  const objectPath = path.join(folder, "life.json");
  const original = JSON.stringify({ archiveMarker: "C19_NON_ARRAY_JSON", state: "sealed" }, null, 2);
  fs.writeFileSync(objectPath, original, "utf8");
  refreshOwner(fixture);
  assert(!fixture.memories.some(memory => String(memory.content || "").includes("C19_NON_ARRAY_JSON")),
    "a valid non-array Owner JSON object is a source guard input, not a Legacy memory");
  const snapshotSources = fixture.engine.store.getFolderSummarySnapshotSources(fixture.memories);
  const objectSource = snapshotSources.files.find(source => source.relativeSummaryPath.endsWith("/life.json"));
  assert.equal(objectSource?.fileDigest, digest(JSON.parse(original)),
    "a successfully parsed non-array JSON object must have its canonical content digest in the Owner snapshot");
  activeObservation.notes.push({ event: "valid-nonarray-json-coexists-with-pair-summary",
    parsedType: "object", canonicalDigestTracked: true, emittedAsMemory: false });

  const healthy = compareSafeWithReference(fixture);
  assert(healthy.safe.items.length > 0, "the valid Pair beside a JSON object must remain retrievable");
  assert.equal(healthy.safe.metrics.legacyScanFallbackCount, 0,
    "a valid non-array Owner JSON object must not force a full-scope fallback");
  assert(healthy.safe.metrics.candidatePairCount < healthy.safe.metrics.ownerPairCount,
    "a valid non-array Owner JSON object must preserve local candidate coverage");
  assert(!healthy.safe.text.includes("C19_NON_ARRAY_JSON"), "non-array object content must never be recalled");

  const objectStat = fs.statSync(objectPath);
  const changed = original.replace("sealed", "edited");
  assert.equal(Buffer.byteLength(changed), objectStat.size, "same-stat object edit must preserve byte length");
  const ledger = fixture.engine.store.pairLedger;
  const originalGet = ledger.candidateDirectory.getCandidateScopes.bind(ledger.candidateDirectory);
  let directory = null;
  ledger.candidateDirectory.getCandidateScopes = (...args) => {
    directory = originalGet(...args);
    fs.writeFileSync(objectPath, changed, "utf8");
    fs.utimesSync(objectPath, objectStat.atime, objectStat.mtime);
    assert.equal(fs.statSync(objectPath).size, objectStat.size);
    assert.equal(fs.statSync(objectPath).mtimeMs, objectStat.mtimeMs);
    return directory;
  };
  let raceResult;
  try {
    ledger.invalidate();
    raceResult = retrieve(fixture, { retrievalMode: "safe-candidate-directory" });
  } finally {
    ledger.candidateDirectory.getCandidateScopes = originalGet;
    fs.writeFileSync(objectPath, original, "utf8");
    fs.utimesSync(objectPath, objectStat.atime, objectStat.mtime);
    refreshOwner(fixture);
  }
  attachDirectoryObservation("safe-candidate-directory", directory);
  assert.equal(raceResult.fallbackStatus, "SOURCE_STALE",
    "same-stat edits to a valid non-array Owner JSON source must invalidate the whole Owner read session");
  assert.equal(raceResult.text, "", "a changed JSON object cannot leave cached Pair results authorized");
  activeObservation.notes.push({ event: "same-stat-valid-json-object-owner-race",
    result: raceResult.fallbackStatus, returnedText: Boolean(raceResult.text) });
}

function runC20() {
  const fixture = makeFixture("C20-nonstandard-player-recent-source");
  const marker = "C20_NONSTANDARD_RECENT";
  appendSummary(fixture, PLAYER_ID, makeSummary(PLAYER_ID, "C20_STANDARD_OLDER", "较早的标准玩家对话摘要。",
    { date: "1189.1.1" }), { key: "c20-standard-older" });
  const summary = makeSummary(PLAYER_ID, marker, "玩家与回应者曾讨论边境税册。");
  const filePath = appendSummary(fixture, PLAYER_ID, summary,
    { fileName: "legacy-player-summary.json", key: "c20-nonstandard-player" });
  const createdStat = fs.statSync(filePath);
  fs.utimesSync(filePath, createdStat.atime, Math.floor(createdStat.mtimeMs) / 1000);
  refreshOwner(fixture);
  const memories = fixture.memories;
  const recent = memories.find(memory => memory.content.includes(marker));
  assert(recent, "the nonstandard Legacy JSON must be loaded as an Owner memory");
  assert.deepEqual(recent.provenance.pairLedgerSources, [],
    "a nonstandard legacy filename must not gain PairLedger source authority");

  const conversationId = "v9363-c20-before-send";
  const sceneRevision = "synthetic-c20-scene";
  const turnEpoch = 1;
  const query = "今天谈谈别的事情。";
  const retrieveContext = ownerFolderMemories => fixture.engine.retrieveForResponder({
      playerCenteredRecallEnabled: true,
      characterId: OWNER_ID,
      trustedPlayerAnchorId: PLAYER_ID,
      campaignToken: CAMPAIGN,
      conversationId,
      currentGameDate: CURRENT_DATE,
      currentTotalDays: CURRENT_TOTAL_DAYS,
      sceneRevision,
      turnEpoch,
      ownerFolderMemories,
      entityProfiles: [{ id: OWNER_ID, name: OWNER_NAME }, { id: PLAYER_ID, name: "玩家甲" }],
      trustedPlayerTurn: resolveTrustedPlayerTurn({
        history: [{ id: "v9363-c20-turn", role: "user", speakerCharacterId: PLAYER_ID, content: query }],
        playerAnchorId: PLAYER_ID, currentPlayerMessageId: "v9363-c20-turn", turnEpoch, conversationId, sceneRevision
      }),
      query,
      tokenBudget: 100000,
      estimateTokens: value => Math.ceil(String(value || "").length / 2),
      sessionRecallCache: new Map()
    });
  const context = retrieveContext(memories);
  assert(context.directStableText?.includes(marker),
    "the actual Player-centered Recent1 path must freeze this nonstandard Legacy source in directStableText");
  assert(!context.directStableText.includes("C20_STANDARD_OLDER"),
    "the newer nonstandard source, rather than its older standard Pair neighbor, must be Recent1");
  assert(context.sourcePairIds.includes(PLAYER_ID), "the frozen baseline must guard its Player Pair scope");
  const gameData = { campaignToken: CAMPAIGN, playerID: PLAYER_ID, date: CURRENT_DATE,
    getOfficialRecollectionSummary: () => null };
  const pairLedgerCalls = [];
  const measureBeforeSend = (phase, targetContext) => {
    const measured = validatePlayerMemoryContextMeasured(fixture.engine, targetContext, gameData, conversationId);
    pairLedgerCalls.push({ phase, readCount: measured.pairLedgerReadCount, resolveCount: measured.sourceResolveCount });
    return measured.validation;
  };
  const initialValidation = measureBeforeSend("initial", context);
  assert.equal(initialValidation.valid, true, "the unmodified synthetic context must pass the actual Engine validator");

  const trials = [];
  const store = fixture.engine.store;
  const edits = [
    { name: "same-stat-content", apply: row => { row.content = row.content.replace("RECENT", "REVISE"); } },
    { name: "same-stat-identity", apply: row => { row.characterId = PLAYER_ID + 1; } },
    { name: "same-stat-campaign", apply: row => { row.campaignToken = row.campaignToken.toUpperCase(); } }
  ];
  for (const edit of edits) {
    refreshOwner(fixture);
    const trialContext = retrieveContext(fixture.memories);
    const trialInitialValidation = measureBeforeSend(`${edit.name}-initial`, trialContext);
    assert.equal(trialInitialValidation.valid, true, `${edit.name} context must start valid`);
    const originalBytes = fs.readFileSync(filePath, "utf8");
    const originalStat = fs.statSync(filePath);
    const restoreOriginalTimes = () => fs.utimesSync(filePath, originalStat.atimeMs / 1000, originalStat.mtimeMs / 1000);
    const cachedSnapshot = store.folderSummaryCache.get(OWNER_ID);
    try {
      const changedRows = JSON.parse(originalBytes);
      edit.apply(changedRows[0]);
      const changedBytes = JSON.stringify(changedRows, null, 2);
      assert.equal(Buffer.byteLength(changedBytes), originalStat.size,
        `${edit.name} must preserve the original byte length`);
      fs.writeFileSync(filePath, changedBytes, "utf8");
      restoreOriginalTimes();
      const changedStat = fs.statSync(filePath);
      assert.equal(changedStat.size, originalStat.size, `${edit.name} must preserve the source size`);
      assert.equal(changedStat.mtimeMs, originalStat.mtimeMs, `${edit.name} must preserve the source mtime`);
      assert.notEqual(changedStat.ctimeMs, originalStat.ctimeMs,
        "the platform changes ctime; the metadata shim below models exact same-stat preservation");
      const nativeLstat = fs.lstatSync;
      fs.lstatSync = function (targetPath, ...args) {
        const stat = nativeLstat.call(this, targetPath, ...args);
        if (typeof targetPath !== "string" || path.resolve(targetPath) !== path.resolve(filePath)) return stat;
        return new Proxy(stat, { get(target, property) {
          if (property === "ctimeMs") return originalStat.ctimeMs;
          const value = Reflect.get(target, property, target);
          return typeof value === "function" ? value.bind(target) : value;
        } });
      };
      let validation;
      let ownerDigestWouldDetect;
      try {
        validation = measureBeforeSend(edit.name, trialContext);
        ownerDigestWouldDetect = store.hasOwnerSummaryContentChanges(cachedSnapshot);
      } finally { fs.lstatSync = nativeLstat; }
      trials.push({ mutation: edit.name, valid: validation.valid === true, reason: validation.reason || null,
        sameSyntheticSizeAndMtime: true, actualCtimeChanged: changedStat.ctimeMs !== originalStat.ctimeMs,
        ownerDigestWouldDetect, initialContextValid: trialInitialValidation.valid === true });
    } finally {
      fs.writeFileSync(filePath, originalBytes, "utf8");
      restoreOriginalTimes();
      refreshOwner(fixture);
    }
  }

  const physicalContext = retrieveContext(fixture.memories);
  const physicalOriginalBytes = fs.readFileSync(filePath, "utf8");
  const physicalOriginalStat = fs.statSync(filePath);
  const physicalChangedBytes = physicalOriginalBytes.replace("RECENT", "REVISE");
  assert.equal(Buffer.byteLength(physicalChangedBytes), physicalOriginalStat.size);
  let physicalMutationStat = null;
  let actualFilesystemValidation;
  try {
    fs.writeFileSync(filePath, physicalChangedBytes, "utf8");
    fs.utimesSync(filePath, physicalOriginalStat.atimeMs / 1000, physicalOriginalStat.mtimeMs / 1000);
    physicalMutationStat = fs.statSync(filePath);
    actualFilesystemValidation = measureBeforeSend("physical-ctime-change", physicalContext);
  } finally {
    fs.writeFileSync(filePath, physicalOriginalBytes, "utf8");
    fs.utimesSync(filePath, physicalOriginalStat.atimeMs / 1000, physicalOriginalStat.mtimeMs / 1000);
    refreshOwner(fixture);
  }
  const refreshedContext = retrieveContext(fixture.memories);
  const refreshedValidation = measureBeforeSend("restored-context", refreshedContext);
  assert.equal(refreshedValidation.valid, true,
    "after source restoration and an explicit fresh snapshot, a new context must pass before-send validation");
  assert.equal(actualFilesystemValidation.valid, false,
    "the real platform metadata change must still reject the old context without a stat shim");

  const raceContext = retrieveContext(fixture.memories);
  const raceOriginalBytes = fs.readFileSync(filePath, "utf8");
  const raceOriginalStat = fs.statSync(filePath);
  const raceChangedBytes = raceOriginalBytes.replace("RECENT", "REVISE");
  assert.equal(Buffer.byteLength(raceChangedBytes), raceOriginalStat.size,
    "the post-revision race must preserve the real source size");
  const originalGetRevision = store.getFolderSummaryRevision.bind(store);
  let raceMutationApplied = false;
  let raceMutationStat = null;
  let raceValidation;
  const raceInitialValidation = measureBeforeSend("post-revision-race-initial", raceContext);
  assert.equal(raceInitialValidation.valid, true,
    "the actual post-revision race context must start valid");
  store.getFolderSummaryRevision = (...args) => {
    const revision = originalGetRevision(...args);
    if (!raceMutationApplied && Number(args[0]) === OWNER_ID) {
      raceMutationApplied = true;
      fs.writeFileSync(filePath, raceChangedBytes, "utf8");
      fs.utimesSync(filePath, raceOriginalStat.atimeMs / 1000, raceOriginalStat.mtimeMs / 1000);
      raceMutationStat = fs.statSync(filePath);
    }
    return revision;
  };
  try {
    raceValidation = measureBeforeSend("post-revision-race", raceContext);
  } finally {
    store.getFolderSummaryRevision = originalGetRevision;
    fs.writeFileSync(filePath, raceOriginalBytes, "utf8");
    fs.utimesSync(filePath, raceOriginalStat.atimeMs / 1000, raceOriginalStat.mtimeMs / 1000);
    refreshOwner(fixture);
  }
  const raceRecoveredContext = retrieveContext(fixture.memories);
  const raceRecoveredValidation = measureBeforeSend("post-revision-race-recovered", raceRecoveredContext);
  assert.equal(raceRecoveredValidation.valid, true,
    "a fresh context after the post-revision race and snapshot refresh must pass validation");
  activeObservation.notes.push({ event: "actual-engine-before-send-nonstandard-player-source-guard",
    baselineIncludedInDirectStableText: true,
    filenameClass: "nonstandard-json",
    sourcePairIdsIncludePlayer: context.sourcePairIds.includes(PLAYER_ID),
    initialValidation: { valid: initialValidation.valid === true, reason: initialValidation.reason || null },
    sameStatTrials: trials,
    physicalFilesystemMutation: { byteLengthPreserved: Buffer.byteLength(physicalChangedBytes) === physicalOriginalStat.size,
      mtimePreserved: physicalMutationStat?.mtimeMs === physicalOriginalStat.mtimeMs,
      ctimeChanged: physicalMutationStat?.ctimeMs !== physicalOriginalStat.ctimeMs },
    beforeSendPairLedgerCalls: pairLedgerCalls,
    actualFilesystemValidation: { valid: actualFilesystemValidation.valid === true,
      reason: actualFilesystemValidation.reason || null },
    refreshedSnapshotValidation: { valid: refreshedValidation.valid === true, reason: refreshedValidation.reason || null },
    postRevisionSameStatRace: { mutationApplied: raceMutationApplied,
      byteLengthPreserved: Buffer.byteLength(raceChangedBytes) === raceOriginalStat.size,
      mtimePreserved: raceMutationStat?.mtimeMs === raceOriginalStat.mtimeMs,
      ctimeChanged: raceMutationStat?.ctimeMs !== raceOriginalStat.ctimeMs,
      valid: raceValidation.valid === true, reason: raceValidation.reason || null,
      recoveredSnapshotValid: raceRecoveredValidation.valid === true,
      recoveredReason: raceRecoveredValidation.reason || null } });
  assert(trials.every(trial => !trial.valid),
    `every same-stat mutation of a frozen nonstandard Player Legacy source must be rejected when stat metadata is preserved; observed ${JSON.stringify(trials)}`);
  assert.equal(raceValidation.valid, false,
    `an edit after the validator's first revision read must invalidate the old context; observed ${JSON.stringify(raceValidation)}`);
  assert(pairLedgerCalls.every(row => row.readCount === 0 && row.resolveCount === 0),
    `before-send validation must not read PairLedger scopes or source text; observed ${JSON.stringify(pairLedgerCalls)}`);
}

function runC21() {
  const fixture = makeFixture("C21-standard-player-before-send-source");
  const marker = "C21_STANDARD_PLAYER_RECENT";
  const filePath = appendSummary(fixture, PLAYER_ID,
    makeSummary(PLAYER_ID, marker, "玩家与回应者讨论边境税册。"), { key: "c21-standard-player" });
  const createdStat = fs.statSync(filePath);
  fs.utimesSync(filePath, createdStat.atime, Math.floor(createdStat.mtimeMs) / 1000);
  refreshOwner(fixture);
  const recent = fixture.memories.find(memory => memory.content.includes(marker));
  assert(recent, "the standard Player Pair summary must load into the Owner snapshot");
  assert(recent.provenance.pairLedgerSources.some(source => Number(source.counterpartId) === PLAYER_ID),
    "the standard Player Pair summary must carry its authorized PairLedger source");

  const conversationId = "v9363-c21-before-send";
  const sceneRevision = "synthetic-c21-scene";
  const turnEpoch = 1;
  const query = "今天谈谈别的事情。";
  const retrieveContext = ownerFolderMemories => fixture.engine.retrieveForResponder({
    playerCenteredRecallEnabled: true,
    characterId: OWNER_ID,
    trustedPlayerAnchorId: PLAYER_ID,
    campaignToken: CAMPAIGN,
    conversationId,
    currentGameDate: CURRENT_DATE,
    currentTotalDays: CURRENT_TOTAL_DAYS,
    sceneRevision,
    turnEpoch,
    ownerFolderMemories,
    entityProfiles: [{ id: OWNER_ID, name: OWNER_NAME }, { id: PLAYER_ID, name: "玩家甲" }],
    trustedPlayerTurn: resolveTrustedPlayerTurn({
      history: [{ id: "v9363-c21-turn", role: "user", speakerCharacterId: PLAYER_ID, content: query }],
      playerAnchorId: PLAYER_ID, currentPlayerMessageId: "v9363-c21-turn", turnEpoch, conversationId, sceneRevision
    }),
    query,
    tokenBudget: 100000,
    estimateTokens: value => Math.ceil(String(value || "").length / 2),
    sessionRecallCache: new Map()
  });
  const context = retrieveContext(fixture.memories);
  assert(context.directStableText?.includes(marker), "the standard Legacy source must enter Recent1 directStableText");
  const gameData = { campaignToken: CAMPAIGN, playerID: PLAYER_ID, date: CURRENT_DATE,
    getOfficialRecollectionSummary: () => null };
  const pairLedgerCalls = [];
  const measureBeforeSend = (phase, targetContext) => {
    const measured = validatePlayerMemoryContextMeasured(fixture.engine, targetContext, gameData, conversationId);
    pairLedgerCalls.push({ phase, readCount: measured.pairLedgerReadCount, resolveCount: measured.sourceResolveCount });
    return measured.validation;
  };
  const initialValidation = measureBeforeSend("initial", context);
  assert.equal(initialValidation.valid, true, "the unmodified standard-source context must initially pass");

  const originalBytes = fs.readFileSync(filePath, "utf8");
  const originalStat = fs.statSync(filePath);
  const changedBytes = originalBytes.replace("RECENT", "REVISE");
  assert.equal(Buffer.byteLength(changedBytes), originalStat.size, "the standard-source race must preserve byte length");
  const store = fixture.engine.store;
  const originalGetRevision = store.getFolderSummaryRevision.bind(store);
  let mutationApplied = false;
  let mutationStat = null;
  let validation;
  store.getFolderSummaryRevision = (...args) => {
    const revision = originalGetRevision(...args);
    if (!mutationApplied && Number(args[0]) === OWNER_ID) {
      mutationApplied = true;
      fs.writeFileSync(filePath, changedBytes, "utf8");
      fs.utimesSync(filePath, originalStat.atimeMs / 1000, originalStat.mtimeMs / 1000);
      mutationStat = fs.statSync(filePath);
    }
    return revision;
  };
  try {
    validation = measureBeforeSend("post-revision-race", context);
  } finally {
    store.getFolderSummaryRevision = originalGetRevision;
    fs.writeFileSync(filePath, originalBytes, "utf8");
    fs.utimesSync(filePath, originalStat.atimeMs / 1000, originalStat.mtimeMs / 1000);
    refreshOwner(fixture);
  }
  const refreshedContext = retrieveContext(fixture.memories);
  const refreshedValidation = measureBeforeSend("refreshed", refreshedContext);
  activeObservation.notes.push({ event: "standard-player-pair-source-before-send-race",
    sourcePairIdsIncludePlayer: context.sourcePairIds.includes(PLAYER_ID),
    pairLedgerSourcePresent: true,
    mutationApplied,
    byteLengthPreserved: Buffer.byteLength(changedBytes) === originalStat.size,
    mtimePreserved: mutationStat?.mtimeMs === originalStat.mtimeMs,
    ctimeChanged: mutationStat?.ctimeMs !== originalStat.ctimeMs,
    initialValidation: { valid: initialValidation.valid === true, reason: initialValidation.reason || null },
    raceValidation: { valid: validation.valid === true, reason: validation.reason || null },
    refreshedValidation: { valid: refreshedValidation.valid === true, reason: refreshedValidation.reason || null },
    beforeSendPairLedgerCalls: pairLedgerCalls });
  assert.equal(mutationApplied, true, "the source edit must occur after the real Owner revision read");
  assert.equal(validation.valid, false, "a standard Pair source edit after revision read must reject before-send");
  assert.equal(refreshedValidation.valid, true, "a new context from the restored standard source must pass");
  assert(pairLedgerCalls.every(row => row.readCount === 0 && row.resolveCount === 0),
    `standard before-send validation must not read PairLedger scopes or source text; observed ${JSON.stringify(pairLedgerCalls)}`);
}

function runC09() {
  const fixture = seedFixture(makeFixture("C09-multi-pair-projection"), 24);
  const first = 9601, second = 9602;
  const content = summaryContent("C09_SHARED", `${TARGET_ALIAS}记录了同一会谈的两份合法投影。`);
  const finalizationId = "C09_SHARED_FINALIZATION";
  appendSummary(fixture, first, makeSummary(first, "C09_PROJECTION_A", "共同事实。", { content, finalizationId }),
    { key: "projection-a" });
  appendSummary(fixture, second, makeSummary(second, "C09_PROJECTION_B", "共同事实。", { content, finalizationId }),
    { key: "projection-b" });
  refreshOwner(fixture);
  const result = compareSafeWithReference(fixture);
  const scopes = result.safe.items.filter(item => item.text.includes("C09_SHARED"))
    .map(item => Number(item.scope.counterpartId)).sort((a, b) => a - b);
  assert.deepEqual(scopes, [first, second], "merged projections must preserve each Pair's independent item and source identity");
  assert.deepEqual(scopes, result.reference.items.filter(item => item.text.includes("C09_SHARED"))
    .map(item => Number(item.scope.counterpartId)).sort((a, b) => a - b));
}

function runC10() {
  const fixture = seedFixture(makeFixture("C10-confirmed-ambiguous"), 18);
  const id = 9701;
  const legacyContent = `旧式记忆段落。\n\n【需要长期记住的事项】\n${TARGET_ALIAS}说盐税账册需复核。\n\n此处没有项目符号，边界无法确定。\n【其他事项】\n旧式尾段。`;
  appendSummary(fixture, id, makeSummary(id, "C10_CONFIRMED_AMBIGUOUS", "unused", {
    content: legacyContent, finalizationId: null, conversationId: null
  }), { key: "ambiguous-legacy" });
  refreshOwner(fixture);
  const scope = { ownerId: OWNER_ID, counterpartId: id, campaignToken: CAMPAIGN };
  const preview = fixture.engine.store.pairLedger.preview(scope, { currentGameDate: CURRENT_DATE,
    currentTotalDays: CURRENT_TOTAL_DAYS, memories: fixture.memories });
  assert.equal(preview.pairs[0].items.length, 1, "C10 must reach the actual PairLedger parser");
  assert.equal(preview.pairs[0].items[0].ambiguous, true, "C10 is an ambiguous old Legacy item");
  const applied = fixture.engine.store.pairLedger.apply(scope, { previewRevision: preview.previewRevision,
    currentGameDate: CURRENT_DATE, currentTotalDays: CURRENT_TOTAL_DAYS, memories: fixture.memories });
  assert.equal(applied.success, true, "C10 confirmation must use the real PairLedger preview/apply path");
  const result = compareSafeWithReference(fixture);
  assert(result.safe.items.some(item => Number(item.scope.counterpartId) === id && item.text.includes("盐税账册")),
    "a confirmed ambiguous Legacy matter must remain recallable in its own Pair");
}

function runC11() {
  const fixture = seedFixture(makeFixture("C11-fullwidth-alias"), 22);
  const id = 9801;
  appendSummary(fixture, id, makeSummary(id, "C11_FULLWIDTH", "ＴａｒｇｅｔＡｌｉａｓ见证盐税账册复核。"), { key: "fullwidth" });
  refreshOwner(fixture);
  const result = compareSafeWithReference(fixture);
  assert(result.safe.items.some(item => Number(item.scope.counterpartId) === id && item.text.includes("C11_FULLWIDTH")),
    "NFKC-normalized aliases must retain the corresponding cross-Pair item");
}

function runC12() {
  const fixture = seedFixture(makeFixture("C12-identity-campaign-date-owner"), 22);
  const sharedId = 9901;
  appendSummary(fixture, sharedId, makeSummary(sharedId, "C12_SHARED_NAME", `${TARGET_ALIAS}所涉账册。`), { key: "shared-name" });
  appendSummary(fixture, 9902, makeSummary(9902, "C12_NEW_ALIAS", "NewAlias所涉账册。"), { key: "new-alias" });
  appendSummary(fixture, 9903, makeSummary(9903, "C12_OTHER_CAMPAIGN", `${TARGET_ALIAS}的异战役账册。`, {
    campaignToken: OTHER_CAMPAIGN
  }), { key: "other-campaign" });
  appendSummary(fixture, 9904, makeSummary(9904, "C12_FUTURE_DATE", `${TARGET_ALIAS}的未来账册。`, {
    date: "1201.1.1"
  }), { key: "future-date" });
  const otherOwner = 501;
  appendSummary(fixture, TARGET_ID, makeSummary(TARGET_ID, "C12_OTHER_OWNER_PRIVATE", `${TARGET_ALIAS}的另一Owner私密史。`, {
    ownerId: otherOwner, ownerName: `人物${otherOwner}`
  }), { ownerId: otherOwner, key: "other-owner" });
  refreshOwner(fixture);

  const duplicateAliasProfiles = [
    { characterId: TARGET_ID, name: TARGET_ALIAS, aliases: [TARGET_ALIAS] },
    { characterId: 301, name: "同名人物", aliases: [TARGET_ALIAS] }
  ];
  const ambiguous = instrument(fixture.engine.store.pairLedger,
    () => retrieve(fixture, { profiles: duplicateAliasProfiles, retrievalMode: "safe-candidate-directory" }));
  assert.equal(ambiguous.value.fallbackStatus, "IDENTITY_AMBIGUOUS",
    "a shared alias across different IDs must not create cross-Pair access");
  assert.equal(ambiguous.counts.reads, 0, "ambiguous identity must stop before PairLedger reads");

  const beforeAlias = compareSafeWithReference(fixture, { profiles: profiles() });
  assert(!beforeAlias.safe.items.some(item => Number(item.scope.counterpartId) === 9902));
  const changedProfiles = profiles();
  changedProfiles[0].aliases.push("NewAlias");
  const afterAlias = compareSafeWithReference(fixture, { profiles: changedProfiles });
  assert(afterAlias.safe.items.some(item => Number(item.scope.counterpartId) === 9902),
    "a changed unique alias set must rebuild candidate coverage");

  const sceneOne = instrument(fixture.engine.store.pairLedger,
    () => retrieve(fixture, { profiles: changedProfiles, sceneRevision: "scene-A", retrievalMode: "safe-candidate-directory" }));
  const sceneTwo = instrument(fixture.engine.store.pairLedger,
    () => retrieve(fixture, { profiles: changedProfiles, sceneRevision: "scene-B", retrievalMode: "safe-candidate-directory" }));
  assert.equal(sceneOne.counts.directory.cacheHit, false);
  assert.equal(sceneTwo.counts.directory.cacheHit, false, "scene changes must not reuse the previous scene's coverage cache");
  assert(!sceneOne.value.text.includes("C12_OTHER_CAMPAIGN"));
  assert(!sceneOne.value.text.includes("C12_FUTURE_DATE"));
  assert(!sceneOne.value.text.includes("C12_OTHER_OWNER_PRIVATE"));
  assert(sceneOne.counts.readScopes.every(row => row.ownerId === OWNER_ID), "Owner reads must stay on the selected Owner");
  const afterDate = compareSafeWithReference(fixture, { profiles: changedProfiles, currentGameDate: "1202.1.1" });
  assert(afterDate.safe.items.some(item => Number(item.scope.counterpartId) === 9904),
    "advancing the scene date must permit the valid historical source");
}

function runC13() {
  const fixture = seedFixture(makeFixture("C13-races"), 20);
  const legacyId = 9911;
  const legacyPath = appendSummary(fixture, legacyId, makeSummary(legacyId, "C13_UNINDEXED", "一段旧格式记忆。"),
    { fileName: "legacy-counterpart.json", key: "nonstandard-legacy" });
  refreshOwner(fixture);
  const standardPath = fixture.files.get("alias");
  const legacyOriginal = fs.readFileSync(legacyPath, "utf8");
  const legacyStat = fs.statSync(legacyPath);
  const standardOriginal = fs.readFileSync(standardPath, "utf8");
  const standardStat = fs.statSync(standardPath);

  function replaceSameStat(filePath, original, from, to, stat) {
    const changed = original.replace(from, to);
    assert.notEqual(changed, original, `race marker ${from} must exist`);
    assert.equal(Buffer.byteLength(changed), stat.size, "race mutation must preserve file size");
    fs.writeFileSync(filePath, changed, "utf8");
    fs.utimesSync(filePath, stat.atime, stat.mtime);
    assert.equal(fs.statSync(filePath).size, stat.size);
    assert.equal(fs.statSync(filePath).mtimeMs, stat.mtimeMs);
  }

  const ledger = fixture.engine.store.pairLedger;
  const originalGet = ledger.candidateDirectory.getCandidateScopes.bind(ledger.candidateDirectory);
  let changed = false;
  let raceDirectory = null;
  ledger.candidateDirectory.getCandidateScopes = (...args) => {
    const result = originalGet(...args);
    raceDirectory = result;
    if (!changed) {
      changed = true;
      replaceSameStat(standardPath, standardOriginal, "C13-races_ALIAS", "C13-races_ALIAX", standardStat);
      const old = JSON.parse(fs.readFileSync(legacyPath, "utf8"));
      const newText = JSON.stringify(old).replace('"characterId":9911', '"characterId":9912');
      assert.equal(Buffer.byteLength(newText), legacyStat.size, "legacy identity race must retain byte length");
      fs.writeFileSync(legacyPath, newText, "utf8");
      fs.utimesSync(legacyPath, legacyStat.atime, legacyStat.mtime);
      assert.equal(fs.statSync(legacyPath).size, legacyStat.size);
      assert.equal(fs.statSync(legacyPath).mtimeMs, legacyStat.mtimeMs);
    }
    return result;
  };
  let raceResult;
  try {
    ledger.invalidate();
    raceResult = retrieve(fixture, { retrievalMode: "safe-candidate-directory" });
  } finally {
    ledger.candidateDirectory.getCandidateScopes = originalGet;
    fs.writeFileSync(legacyPath, legacyOriginal, "utf8");
    fs.utimesSync(legacyPath, legacyStat.atime, legacyStat.mtime);
    fs.writeFileSync(standardPath, standardOriginal, "utf8");
    fs.utimesSync(standardPath, standardStat.atime, standardStat.mtime);
    refreshOwner(fixture);
  }
  assert.equal(raceResult.fallbackStatus, "SOURCE_STALE",
    "same-size/same-mtime source changes during retrieval must discard the whole round");
  assert.equal(raceResult.text, "", "source races cannot return a partial or stale result");
  attachDirectoryObservation("safe-candidate-directory", raceDirectory);
  activeObservation.notes.push({ event: "same-stat-standard-and-legacy-source-race",
    result: raceResult.fallbackStatus, returnedText: Boolean(raceResult.text) });

  const nonstandardOriginal = fs.readFileSync(legacyPath, "utf8");
  const nonstandardStat = fs.statSync(legacyPath);
  const hook = ledger.candidateDirectory.getCandidateScopes.bind(ledger.candidateDirectory);
  let legacyRaceDirectory = null;
  ledger.candidateDirectory.getCandidateScopes = (...args) => {
    const result = hook(...args);
    legacyRaceDirectory = result;
    const legacyRows = JSON.parse(nonstandardOriginal);
    legacyRows[0].characterId = 9912;
    const changedIdentity = JSON.stringify(legacyRows, null, 2);
    assert.equal(Buffer.byteLength(changedIdentity), nonstandardStat.size);
    fs.writeFileSync(legacyPath, changedIdentity, "utf8");
    fs.utimesSync(legacyPath, nonstandardStat.atime, nonstandardStat.mtime);
    return result;
  };
  let oldLegacyRace;
  try { ledger.invalidate(); oldLegacyRace = retrieve(fixture, { retrievalMode: "safe-candidate-directory" }); }
  finally {
    ledger.candidateDirectory.getCandidateScopes = hook;
    fs.writeFileSync(legacyPath, nonstandardOriginal, "utf8");
    fs.utimesSync(legacyPath, nonstandardStat.atime, nonstandardStat.mtime);
    refreshOwner(fixture);
  }
  assert.equal(oldLegacyRace.fallbackStatus, "SOURCE_STALE",
    "a nonstandard old JSON source used for scoped uncertainty must participate in Owner revision validation");
  assert.equal(oldLegacyRace.text, "", "an edited unindexed legacy source cannot retain cached Owner authority");
  activeObservation.notes.push({ event: "same-stat-nonstandard-owner-source-race",
    result: oldLegacyRace.fallbackStatus, returnedText: Boolean(oldLegacyRace.text) });
  compareSafeWithReference(fixture);
}

function runC14() {
  const fixture = seedFixture(makeFixture("C14-mode-rollback"), 32);
  const ledger = fixture.engine.store.pairLedger;
  const safeBeforeMeasured = instrument(ledger,
    () => retrieve(fixture, { level: "L2", retrievalMode: "safe-candidate-directory" }));
  const safeBefore = safeBeforeMeasured.value;
  attachDirectoryObservation("safe-candidate-directory", safeBeforeMeasured.counts.directory);
  assert(safeBefore.metrics.candidatePairCount < safeBefore.metrics.ownerPairCount);
  ledger.setRetrievalMode("exhaustive-reference");
  fixture.memories = fixture.engine.store.loadFolderSummariesForCharacter(OWNER_ID);
  const exhaustiveMeasured = instrument(ledger, () => retrieve(fixture, { level: "L2", retrievalMode: ledger.retrievalMode }));
  const exhaustive = exhaustiveMeasured.value;
  assert.equal(exhaustive.metrics.legacyScanFallbackReason, "REFERENCE_MODE");
  assert.equal(exhaustive.metrics.candidatePairCount, exhaustive.metrics.ownerPairCount);
  assert.deepEqual(exhaustive.items.map(itemFingerprint), safeBefore.items.map(itemFingerprint));
  assert.deepEqual(resolvedSourceFingerprintRows(exhaustive), resolvedSourceFingerprintRows(safeBefore));
  assert.equal(exhaustive.text, safeBefore.text);
  recordABComparison("safe-before-vs-exhaustive", safeBefore, exhaustive);
  ledger.setRetrievalMode("safe-candidate-directory");
  fixture.memories = fixture.engine.store.loadFolderSummariesForCharacter(OWNER_ID);
  const safeAfterMeasured = instrument(ledger, () => retrieve(fixture, { level: "L2", retrievalMode: ledger.retrievalMode }));
  const safeAfter = safeAfterMeasured.value;
  attachDirectoryObservation("safe-candidate-directory", safeAfterMeasured.counts.directory);
  assert.equal(safeAfter.metrics.candidateDirectoryStatus, "COMPLETE");
  assert.deepEqual(safeAfter.items.map(itemFingerprint), exhaustive.items.map(itemFingerprint));
  assert.deepEqual(resolvedSourceFingerprintRows(safeAfter), resolvedSourceFingerprintRows(exhaustive));
  assert.equal(safeAfter.text, exhaustive.text);
  assert.equal(safeAfter.metrics.legacyScanFallbackCount, 0);
  recordABComparison("safe-after-vs-exhaustive", safeAfter, exhaustive);
}

function runC15() {
  const fixture = seedFixture(makeFixture("C15-nontarget-old-gap"), 300);
  const id = 9921;
  appendSummary(fixture, id, makeSummary(id, "C15_OLD_NON_TARGET", "一条与目标无关的旧档事项。"),
    { fileName: "old-nontarget.json", key: "old-nontarget" });
  refreshOwner(fixture);
  const result = compareSafeWithReference(fixture);
  assertScopedLocal(result, [id], { maxCandidatePairs: 5 });
  assert(result.safe.metrics.candidatePairCount < result.safe.metrics.ownerPairCount,
    "an unrelated old source must not cause a 300-Pair fallback");
}

function runC16() {
  const fixture = makeFixture("C16-all-scopes-uncertain");
  const pairCount = 24;
  appendSummary(fixture, TARGET_ID, makeSummary(TARGET_ID, "C16_DIRECT", "乙与丙谈到旧账。"), { key: "direct" });
  appendSummary(fixture, 9000, makeSummary(9000, "C16_ALIAS", `${TARGET_ALIAS}提到旧账。`), { key: "alias" });
  const ids = [TARGET_ID, 9000];
  for (let index = 0; ids.length < pairCount; index++) {
    const id = 11000 + index;
    ids.push(id);
    appendSummary(fixture, id, makeSummary(id, `C16_OLD_${id}`, "无关的旧格式事项。"),
      { fileName: `legacy-${id}.json`, key: `legacy-${id}` });
  }
  refreshOwner(fixture);
  const result = compareSafeWithReference(fixture);
  assert.equal(result.safe.metrics.candidatePairCount, result.safe.metrics.ownerPairCount,
    "when every scope is uncertain, the safe superset may naturally equal the exhaustive set");
  assert.equal(result.safe.metrics.legacyScanFallbackCount, 0,
    "known Pair scopes remain mapped uncertainty even when that set covers the whole Owner");
  assert(result.measured.counts.directory.candidateCounterpartIds.length >= pairCount);
  assert(result.safe.metrics.uncertainScopedScopeCount >= pairCount - 2);
}

function runC17() {
  const fixture = seedFixture(makeFixture("C17-links"), 12);
  const standardPath = fixture.files.get("alias");
  const linkTarget = path.join(fixture.root, "link-target.json");
  const original = fs.readFileSync(standardPath, "utf8");
  fs.writeFileSync(linkTarget, original, "utf8");
  fs.unlinkSync(standardPath);
  let linkError = null;
  try { fs.symlinkSync(linkTarget, standardPath, "file"); }
  catch (error) { linkError = error; fs.writeFileSync(standardPath, original, "utf8"); refreshOwner(fixture); }
  const unsupported = new Set(["EPERM", "EACCES", "ENOTSUP", "EOPNOTSUPP", "EINVAL"]);
  if (linkError) {
    assert(unsupported.has(linkError.code), `unexpected file-link fixture error ${linkError.code}: ${linkError.message}`);
    const storeSource = fs.readFileSync(path.join(repoRoot, "src/app/main/memory-system/memory-store.js"), "utf8");
    const pathGuard = fs.readFileSync(path.join(repoRoot, "src/app/main/memory-system/scoped-path.js"), "utf8");
    assert.match(storeSource, /signature\?\.isSymbolicLink\s*\|\|\s*signature\s*&&\s*!signature\.isFile/u,
      "when Windows cannot create a file link, verify MemoryStore rejects lstat links statically");
    assert.match(pathGuard, /lstatSync\(checked\)\.isSymbolicLink/u,
      "when Windows cannot create a file link, verify shared assertNoLinks checks ancestors statically");
    activeObservation.notes.push({ event: "file-link-creation-unavailable", code: linkError.code,
      verification: "static-lstat-guards-plus-normal-snapshot-ab" });
    console.log(`INFO C17 file-link creation unavailable (${linkError.code}); static lstat/link guards verified`);
    compareSafeWithReference(fixture);
    return;
  }
  try {
    refreshOwner(fixture);
    const safeMeasured = instrument(fixture.engine.store.pairLedger,
      () => retrieve(fixture, { retrievalMode: "safe-candidate-directory" }));
    const result = safeMeasured.value;
    attachDirectoryObservation("safe-candidate-directory", safeMeasured.counts.directory);
    fixture.engine.store.pairLedger.invalidate();
    const reference = retrieve(fixture, { retrievalMode: "exhaustive-reference" });
    assert.equal(result.fallbackStatus, "SOURCE_STALE", "a linked summary file must fail closed before recall");
    assert.equal(result.text, "");
    assert.equal(reference.fallbackStatus, result.fallbackStatus);
    assert.equal(reference.text, result.text);
    recordABComparison("symlink-safe-vs-exhaustive", result, reference);
  } finally {
    if (fs.lstatSync(standardPath).isSymbolicLink()) fs.unlinkSync(standardPath);
    fs.writeFileSync(standardPath, original, "utf8");
    refreshOwner(fixture);
  }
}

function runC18() {
  const fixture = seedFixture(makeFixture("C18-target-is-secondary-pair"), 26);
  const first = 9931, second = 9932;
  const finalizationId = "C18_SECONDARY_TARGET";
  const sharedContent = summaryContent("C18_TARGET_IN_MERGED_PROJECTION", `${TARGET_ALIAS}在两份投影中提及盐税争议。`);
  appendSummary(fixture, first, makeSummary(first, "C18_PRIMARY", "盐税争议。", {
    content: sharedContent, finalizationId
  }), { key: "primary" });
  appendSummary(fixture, second, makeSummary(second, "C18_SECONDARY", "盐税争议。", {
    content: sharedContent, finalizationId
  }), { key: "secondary" });
  refreshOwner(fixture);
  const merged = targetMemory(fixture, first);
  assert.equal(Number(merged.provenance.counterpartId), first, "C18 target Pair must not be the primary Pair");
  assert(merged.provenance.counterpartIds.map(Number).includes(second));
  const result = compareSafeWithReference(fixture);
  assert(result.measured.counts.directory.candidateCounterpartIds.includes(second),
    "candidate coverage must inspect every trusted source Pair, not only primary counterpartId");
  assert(result.safe.items.some(item => Number(item.scope.counterpartId) === second
    && item.text.includes("C18_TARGET_IN_MERGED_PROJECTION")), "the non-primary target Pair must not be missed");
}

function runExtraSafetyChecks() {
  const fixture = seedFixture(makeFixture("extras"), 14);
  const id = 9941;
  appendSummary(fixture, id, makeSummary(id, "EXTRA_FORGET", `${TARGET_ALIAS}的事项应被遗忘。`), { key: "forget" });
  refreshOwner(fixture);
  const beforeForget = compareSafeWithReference(fixture);
  assert(beforeForget.safe.items.some(item => Number(item.scope.counterpartId) === id));
  const saveIndex = fixture.engine.store.saveIndex.bind(fixture.engine.store);
  fixture.engine.store.saveIndex = () => {};
  try {
    fixture.engine.store.recordForgottenSummaryProjection(fixture.summaries.get("forget"), { ownerId: OWNER_ID, counterpartId: id });
  } finally { fixture.engine.store.saveIndex = saveIndex; }
  refreshOwner(fixture);
  const afterForget = compareSafeWithReference(fixture);
  assert(!afterForget.safe.items.some(item => Number(item.scope.counterpartId) === id),
    "Forget must be rechecked by PairLedger and must not be overridden by the candidate directory");

  const l2Fixture = seedFixture(makeFixture("extra-l2-fallback-budget"), 12);
  const conversationId = "v9363-l2-fallback-budget";
  const sceneRevision = "synthetic-l2-scene";
  const turnEpoch = 1;
  const query = "1190年你和玛蒂尔达为了盐税具体争执过什么？";
  const ledger = l2Fixture.engine.store.pairLedger;
  const l2Content = summaryContent("EXTRA_L2_SOURCE", "玛蒂尔达与回应者乙因盐税账册发生争执。", "1190.1.1");
  appendSummary(l2Fixture, TARGET_ID, makeSummary(TARGET_ID, "EXTRA_L2_SOURCE", "盐税账册争执。", {
    content: l2Content
  }), { key: "extra-l2" });
  refreshOwner(l2Fixture);
  const originalResolve = ledger.resolveSource.bind(ledger);
  let attempts = 0;
  ledger.resolveSource = () => { attempts++; throw new Error("SOURCE_UNAVAILABLE_OR_STALE"); };
  let fallback;
  try {
    fallback = l2Fixture.engine.retrieveForResponder({
      playerCenteredRecallEnabled: true,
      characterId: OWNER_ID,
      trustedPlayerAnchorId: PLAYER_ID,
      campaignToken: CAMPAIGN,
      conversationId,
      currentGameDate: CURRENT_DATE,
      currentTotalDays: CURRENT_TOTAL_DAYS,
      sceneRevision,
      turnEpoch,
      ownerFolderMemories: l2Fixture.memories,
      entityProfiles: [{ id: OWNER_ID, name: OWNER_NAME }, { id: PLAYER_ID, name: "玩家甲" },
        { id: TARGET_ID, name: "玛蒂尔达", aliases: ["玛蒂尔达", "王后·玛蒂尔达", "Cora"] }],
      trustedPlayerTurn: resolveTrustedPlayerTurn({
        history: [{ id: `v9363-turn-${turnEpoch}`, role: "user", speakerCharacterId: PLAYER_ID, content: query }],
        playerAnchorId: PLAYER_ID, currentPlayerMessageId: `v9363-turn-${turnEpoch}`, turnEpoch, conversationId, sceneRevision
      }),
      query,
      tokenBudget: 100000,
      estimateTokens: value => Math.ceil(String(value || "").length / 2),
      sessionRecallCache: new Map()
    });
  } finally { ledger.resolveSource = originalResolve; }
  assert.equal(fallback.thirdPersonDecision.level, "L2", "L2 fallback fixture must use the trusted player turn");
  assert.equal(attempts, 2, "failed source reads and Legacy fallback must share a two-attempt limit");
  assert.equal(fallback.pairMemoryMetrics.totalSourceResolveAttemptCount, 2);
}

function runPermissionChecks() {
  const fixture = seedFixture(makeFixture("permission-budgets"), 16);
  const ledger = fixture.engine.store.pairLedger;
  const conversationId = "v9363-permission-checks";
  const sceneRevision = "synthetic-permission-scene";
  const entityProfiles = [{ id: OWNER_ID, name: OWNER_NAME }, { id: PLAYER_ID, name: "玩家甲" },
    { id: TARGET_ID, name: "玛蒂尔达", aliases: ["玛蒂尔达", "王后·玛蒂尔达", "Cora"] }];
  const runResponderRecall = (query, turnEpoch) => fixture.engine.retrieveForResponder({
    playerCenteredRecallEnabled: true,
    characterId: OWNER_ID,
    trustedPlayerAnchorId: PLAYER_ID,
    campaignToken: CAMPAIGN,
    conversationId,
    currentGameDate: CURRENT_DATE,
    currentTotalDays: CURRENT_TOTAL_DAYS,
    sceneRevision,
    turnEpoch,
    ownerFolderMemories: fixture.memories,
    entityProfiles,
    trustedPlayerTurn: resolveTrustedPlayerTurn({
      history: [{ id: `permission-turn-${turnEpoch}`, role: "user", speakerCharacterId: PLAYER_ID, content: query }],
      playerAnchorId: PLAYER_ID, currentPlayerMessageId: `permission-turn-${turnEpoch}`, turnEpoch,
      conversationId, sceneRevision
    }),
    query,
    tokenBudget: 100000,
    estimateTokens: value => Math.ceil(String(value || "").length / 2),
    sessionRecallCache: new Map()
  });

  const l0 = instrument(ledger, () => runResponderRecall("玛蒂尔达今天在场吗？", 1));
  assert.equal(l0.value.pairMemoryMetrics.thirdPersonIntentLevel, "L0");
  assert.equal(l0.counts.readScopes.filter(row => row.counterpartId !== PLAYER_ID).length, 0,
    "L0 may not read third-person Pair scopes");
  assert.equal(l0.counts.resolves, 0, "L0 may not resolve third-person source text");

  const l1 = instrument(ledger, () => runResponderRecall("你以前和玛蒂尔达关系怎么样？", 2));
  assert.equal(l1.value.pairMemoryMetrics.thirdPersonIntentLevel, "L1");
  assert(l1.counts.readScopes.some(row => row.counterpartId === TARGET_ID),
    "L1 should read the authorized third-person Pair ledger");
  assert.equal(l1.counts.resolves, 0, "L1 may not resolve third-person source text");
  assert.equal(l1.value.pairMemoryMetrics.totalSourceResolveAttemptCount, 0);
}

function writeStructuredOutput() {
  const outputPath = path.join(buildRoot, "v9363-legacy-scoped-coverage-raw.json");
  assert(path.resolve(outputPath).startsWith(path.resolve(buildRoot) + path.sep),
    "structured output must remain under the repository .build directory");
  const output = {
    schemaVersion: 1,
    runtime: process.version,
    summary: { passed, failed, total: passed + failed },
    checks: observations,
    failedCheckIds: failures.map(failure => failure.id)
  };
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2), "utf8");
  console.log("STRUCTURED QA: .build/v9363-legacy-scoped-coverage-raw.json");
}

function main() {
  try {
    check("C01", "300 complete Pair scopes remain sparse", runC01);
    check("C02", "one real unindexed legacy source degrades locally", runC02);
    check("C03", "five locatable legacy sources expand only their Pair scopes", runC03);
    check("C04", "rawSummary null with a known Pair is locally revalidated", runC04);
    check("C05", "missing source digest/signature refreshes safely within scope", runC05);
    check("C06", "missing coverage in a multi-Pair projection stays scoped", runC06);
    check("C07", "genuinely unscoped unknown uses exhaustive reference", runC07);
    check("C08", "damaged Owner source snapshot fails closed", runC08);
    check("C19", "valid non-array Owner JSON is hash-guarded but never recalled", runC19);
    check("C20", "same-stat nonstandard Player Recent1 edits invalidate the frozen Engine context", runC20);
    check("C21", "same-stat standard Player Pair sources remain before-send guarded", runC21);
    check("C09", "merged projections preserve Pair-specific source identities", runC09);
    check("C10", "confirmed ambiguous Legacy matter matches exhaustive retrieval", runC10);
    check("C11", "fullwidth unique aliases remain covered", runC11);
    check("C12", "identity, aliases, scene date, campaign and Owner stay isolated", runC12);
    check("C13", "same-stat source races, including nonstandard legacy JSON, reject the round", runC13);
    check("C14", "safe/exhaustive/safe rollback preserves items, revisions and access", runC14);
    check("C15", "non-target old coverage gaps do not force 300 Pair reads", runC15);
    check("C16", "all uncertain Pair scopes remain a complete uncapped superset", runC16);
    check("C17", "source symlinks fail closed or static guards are verified", runC17);
    check("C18", "a target source in a secondary counterpart Pair is retained", runC18);
    check("EXTRA", "Forget and failed L2 resolution share existing safety limits", runExtraSafetyChecks);
    check("PERMISSIONS", "L0 never reads third-person Pair scopes and L1 never resolves source text", runPermissionChecks);
  } finally {
    writeStructuredOutput();
    assert(path.resolve(tempRoot).startsWith(path.resolve(buildRoot) + path.sep),
      "cleanup target must remain below the repository .build directory");
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
  console.log(`V9.3.6.3 legacy scoped coverage QA: ${failed ? "FAIL" : "PASS"} (${passed}/${passed + failed} checks)`);
  if (failures.length) process.exitCode = 1;
}

main();
