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
const tempRoot = fs.mkdtempSync(path.join(buildRoot, "v9362-candidate-qa-"));
const OWNER_ID = 200;
const PLAYER_ID = 100;
const TARGET_ID = 300;
const CAMPAIGN = "v9362-candidate-qa-campaign";
const OTHER_CAMPAIGN = "v9362-candidate-qa-other-campaign";
const CURRENT_DATE = "1200.1.1";
const CURRENT_TOTAL_DAYS = normalizeGameDate(CURRENT_DATE).serial;
const TARGET_NAME = "玛蒂尔达";
const NAME_BY_ID = new Map([[OWNER_ID, "回应者乙"], [PLAYER_ID, "玩家甲"], [TARGET_ID, TARGET_NAME]]);
let checks = 0;

function check(name, fn) {
  fn();
  checks++;
  console.log(`PASS ${name}`);
}

function makeFixture(name) {
  const root = path.join(tempRoot, name);
  const engine = new MemoryEngine({ baseDir: path.join(root, "memory"),
    summaryFoldersDir: path.join(root, "summaries"), trace: { record() {} } });
  fs.mkdirSync(engine.store.summaryFoldersDir, { recursive: true });
  const fixture = { engine, root, files: new Map(), summaries: new Map() };
  return fixture;
}

function makeSummary(ownerId, counterpartId, marker, matter, options = {}) {
  const date = options.date || "1190.1.1";
  const ownerName = NAME_BY_ID.get(ownerId) || `人物${ownerId}`;
  const counterpartName = NAME_BY_ID.get(counterpartId) || `人物${counterpartId}`;
  const summary = {
    date,
    totalDays: normalizeGameDate(date).serial,
    content: `QA_SOURCE_${marker}：合成叙事。\n\n【需要长期记住的事项】\n- ${marker}：${matter}\n【其他事项】\n合成来源。`,
    playerId: ownerId,
    playerName: ownerName,
    characterId: counterpartId,
    characterName: counterpartName,
    perspectiveOwnerId: ownerId,
    campaignToken: options.campaignToken || CAMPAIGN,
    campaignBinding: { status: "bound", source: "synthetic_fixture", version: 1 },
    finalizationId: options.finalizationId === undefined ? `qa-${marker}` : options.finalizationId,
    conversationId: options.conversationId === undefined ? `conversation-${marker}` : options.conversationId,
    conversationType: "pair",
    participants: [{ id: ownerId, name: ownerName }, { id: counterpartId, name: counterpartName }]
  };
  if (options.projectionId) summary.projectionId = options.projectionId;
  if (options.customContent !== undefined) summary.content = options.customContent;
  return summary;
}

function pairFile(fixture, ownerId, counterpartId) {
  const ownerName = NAME_BY_ID.get(ownerId) || `人物${ownerId}`;
  const counterpartName = NAME_BY_ID.get(counterpartId) || `人物${counterpartId}`;
  const folder = path.join(fixture.engine.store.summaryFoldersDir, `${ownerId}_${ownerName}`);
  fs.mkdirSync(folder, { recursive: true });
  return path.join(folder, `与${counterpartName}的对话.json`);
}

function appendSummary(fixture, ownerId, counterpartId, summary) {
  const filePath = pairFile(fixture, ownerId, counterpartId);
  const rows = fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, "utf8")) : [];
  rows.push(summary);
  fs.writeFileSync(filePath, JSON.stringify(rows, null, 2), "utf8");
  fixture.files.set(summary.finalizationId || summary.conversationId || summary.content, filePath);
  fixture.summaries.set(summary.finalizationId || summary.conversationId || summary.content, summary);
  return filePath;
}

function normalizeFixtureFileTimes(fixture) {
  for (const filePath of new Set(fixture.files.values())) {
    const stat = fs.statSync(filePath);
    const stableMtimeMs = Math.floor(stat.mtimeMs);
    fs.utimesSync(filePath, stat.atime, stableMtimeMs / 1000);
    assert.equal(fs.statSync(filePath).mtimeMs, stableMtimeMs,
      "synthetic source timestamps must use exact millisecond values before snapshots are loaded");
  }
}

function seedMainFixture(fixture, distractorCount = 60) {
  const direct = makeSummary(OWNER_ID, TARGET_ID, "QA_CD_DIRECT", "乙直接和丙讨论盐税账册。" );
  appendSummary(fixture, OWNER_ID, TARGET_ID, direct);

  const cross = makeSummary(OWNER_ID, 400, "QA_CROSS_TITLE_ALIAS", "王后·玛蒂尔达转告乙，盐税账册要复核。" );
  appendSummary(fixture, OWNER_ID, 400, cross);

  const mergedContent = "QA_SOURCE_MERGED_SESSION：合成叙事。\n\n【需要长期记住的事项】\n- QA_MERGED_PROJECTION：Ｃｏｒａ告诉乙，盐税账册需要第二名见证人复核。\n【其他事项】\n合成来源。";
  appendSummary(fixture, OWNER_ID, 410,
    makeSummary(OWNER_ID, 410, "QA_MERGED_PROJECTION_A", "unused",
      { finalizationId: "qa-merged-session", conversationId: "conversation-merged-session", customContent: mergedContent }));
  appendSummary(fixture, OWNER_ID, 411,
    makeSummary(OWNER_ID, 411, "QA_MERGED_PROJECTION_B", "unused",
      { finalizationId: "qa-merged-session", conversationId: "conversation-merged-session", customContent: mergedContent }));

  appendSummary(fixture, OWNER_ID, 412, makeSummary(OWNER_ID, 412, "QA_DIFFERENT_CAMPAIGN",
    "王后·玛蒂尔达提过盐税账册。", { campaignToken: OTHER_CAMPAIGN }));
  appendSummary(fixture, TARGET_ID, OWNER_ID,
    makeSummary(TARGET_ID, OWNER_ID, "QA_REVERSE_PRIVATE", "丙对乙的私人盐税叙述。"));
  appendSummary(fixture, 500, TARGET_ID,
    makeSummary(500, TARGET_ID, "QA_OTHER_OWNER_PRIVATE", "外部Owner的盐税叙述。"));

  for (let index = 0; index < distractorCount; index++) {
    const counterpartId = 1000 + index;
    const matter = index === 0 || index === 1
      ? `合成人物${counterpartId}提到Oona，盐税内容与目标人物无关。`
      : `合成人物${counterpartId}讨论了没有相关人物的账册安排。`;
    appendSummary(fixture, OWNER_ID, counterpartId,
      makeSummary(OWNER_ID, counterpartId, `QA_DECOY_${index}`, matter));
  }
  normalizeFixtureFileTimes(fixture);
  fixture.engine.store.invalidateFolderSummaryCache([OWNER_ID]);
  fixture.memories = fixture.engine.store.loadFolderSummariesForCharacter(OWNER_ID);
  return fixture;
}

function profileRows() {
  return [
    { characterId: TARGET_ID, name: TARGET_NAME, aliases: [TARGET_NAME, "王后·玛蒂尔达", "Cora", "Matilda", "Lady Regent"] },
    { characterId: 301, name: TARGET_NAME, aliases: ["Matilda"] }
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
    queryFingerprint: `v9362-qa-${level}`
  };
}

function makeTrustedTurn(query, { conversationId, sceneRevision, turnEpoch }) {
  const messageId = `v9362-qa-turn-${turnEpoch}`;
  return resolveTrustedPlayerTurn({
    history: [{ id: messageId, role: "user", speakerCharacterId: PLAYER_ID, content: query }],
    playerAnchorId: PLAYER_ID,
    currentPlayerMessageId: messageId,
    turnEpoch,
    conversationId,
    sceneRevision
  });
}

function retrieve(fixture, options = {}) {
  const level = options.level || "L1";
  const currentGameDate = options.currentGameDate || CURRENT_DATE;
  return retrievePairMemorySources({
    mode: level === "L2" ? "THIRD_PERSON_SOURCE_DETAIL" : "THIRD_PERSON_LEDGER",
    retrievalMode: options.retrievalMode,
    store: fixture.engine.store,
    ownerId: OWNER_ID,
    decision: decision(level),
    entitiesProfile: options.profiles || profileRows(),
    campaignToken: options.campaignToken || CAMPAIGN,
    currentGameDate,
    currentTotalDays: normalizeGameDate(currentGameDate).serial,
    memories: options.memories || fixture.memories,
    query: options.query === undefined ? "你还记得玛蒂尔达吗？" : options.query,
    tokenBudget: options.tokenBudget === undefined ? 100000 : options.tokenBudget,
    estimateTokens: value => Math.ceil(String(value || "").length / 2)
  });
}

function itemFingerprint(item) {
  const source = item.source || {};
  const scope = item.scope || {};
  return [item.targetCharacterId, item.itemId, item.text, item.conversationDate, item.conversationTotalDays,
    item.routeKind, scope.campaignToken, Number(scope.ownerId), Number(scope.counterpartId),
    source.sourceSummaryKey, source.sourceRevision, source.sourceItemOrdinal];
}

function sourceFingerprintRows(result) {
  return result.items.map(item => [Number(item.scope?.ownerId), Number(item.scope?.counterpartId),
    item.source?.sourceSummaryKey, item.source?.sourceRevision, item.source?.sourceItemOrdinal]);
}

function instrument(ledger, fn) {
  const originalRead = ledger.read.bind(ledger);
  const originalResolve = ledger.resolveSource.bind(ledger);
  const counts = { reads: 0, readScopes: [], resolves: 0 };
  ledger.read = (...args) => {
    counts.reads++;
    const scope = args[0] || {};
    counts.readScopes.push({ ownerId: Number(scope.ownerId), counterpartId: Number(scope.counterpartId) });
    return originalRead(...args);
  };
  ledger.resolveSource = (...args) => {
    counts.resolves++;
    return originalResolve(...args);
  };
  try { return { value: fn(), counts }; }
  finally { ledger.read = originalRead; ledger.resolveSource = originalResolve; }
}

function compareSafeWithReference(fixture, options = {}) {
  const reference = retrieve(fixture, { ...options, retrievalMode: "exhaustive-reference" });
  const safeMeasured = instrument(fixture.engine.store.pairLedger,
    () => retrieve(fixture, { ...options, retrievalMode: "safe-candidate-directory" }));
  const safe = safeMeasured.value;
  assert.deepEqual(safe.items.map(itemFingerprint), reference.items.map(itemFingerprint),
    "safe candidates must preserve every reference item, order, source key/revision, date and scope");
  assert.deepEqual(sourceFingerprintRows(safe), sourceFingerprintRows(reference),
    "safe and exhaustive source identity/revision sets must be equivalent");
  assert.equal(safe.text, reference.text, "safe retrieval must preserve the final formatted result");
  return { safe, reference, safeReadCounts: safeMeasured.counts };
}

function assertOnlyOwnerScopes(readScopes) {
  assert(readScopes.every(scope => scope.ownerId === OWNER_ID),
    "retrieval must never read a reverse-owner or unrelated-owner Pair scope");
}

function refreshOwnerMemories(fixture) {
  fixture.engine.store.invalidateFolderSummaryCache([OWNER_ID]);
  fixture.memories = fixture.engine.store.loadFolderSummariesForCharacter(OWNER_ID);
  return fixture.memories;
}

function runRetrievalParityChecks() {
  const fixture = seedMainFixture(makeFixture("parity"));
  const measured = compareSafeWithReference(fixture);
  const markers = measured.safe.items.map(item => item.text);
  assert(markers.some(text => text.includes("QA_CD_DIRECT")), "the direct B→C Pair is always a candidate");
  assert(markers.some(text => text.includes("QA_CROSS_TITLE_ALIAS")),
    "a B→D matter mentioning a unique title alias must be retained");
  assert(markers.some(text => text.includes("QA_MERGED_PROJECTION")),
  "merged owner snapshots must preserve Pair projection source rows");
  const mergedCounterparts = measured.safe.items.filter(item => item.text.includes("QA_MERGED_PROJECTION"))
    .map(item => Number(item.scope?.counterpartId)).sort((left, right) => left - right);
  assert.deepEqual(mergedCounterparts, [410, 411], "each merged projection must retain its own source Pair scope");
  assert(!measured.safe.text.includes("QA_DIFFERENT_CAMPAIGN"), "another Campaign must not leak into recall");
  assert(!measured.safe.text.includes("QA_REVERSE_PRIVATE"), "C→B private history must remain unreadable to B");
  assert(!measured.safe.text.includes("QA_OTHER_OWNER_PRIVATE"), "another Owner's history must remain unreadable");
  assertOnlyOwnerScopes(measured.safeReadCounts.readScopes);
  assert(measured.safe.metrics.candidatePairCount < measured.reference.metrics.candidatePairCount,
    "the safe path must read fewer scopes than the full-scan reference on a sparse 64-Pair fixture");
  assert.equal(measured.safe.metrics.actualIndexReadCount, measured.safeReadCounts.reads,
    "reported index reads must match the real PairLedger.read calls");
  assert.equal(measured.safe.metrics.sourceResolveAttemptCount, 0, "L1 must never resolve source text");
  assert(measured.safe.items.length <= 16, "L1 must retain the per-target 16 item cap");
  const defaultResult = retrieve(fixture);
  assert.deepEqual(defaultResult.items.map(itemFingerprint), measured.safe.items.map(itemFingerprint),
    "the default retrieval mode must select the safe candidate path");
  console.log(`DETAIL parity safe=${measured.safe.metrics.candidatePairCount}/${measured.reference.metrics.candidatePairCount} scopes; ${measured.safe.items.length} items`);
}

function runPermissionChecks() {
  const fixture = seedMainFixture(makeFixture("permissions"), 20);
  const ledger = fixture.engine.store.pairLedger;
  const originalBegin = ledger.beginOwnerRead.bind(ledger);
  let ownerReadStarts = 0;
  ledger.beginOwnerRead = (...args) => { ownerReadStarts++; return originalBegin(...args); };
  const l0 = instrument(ledger, () => retrieve(fixture, { level: "L0" }));
  ledger.beginOwnerRead = originalBegin;
  assert.equal(l0.value.fallbackStatus, "NOT_REQUESTED");
  assert.equal(l0.counts.reads, 0, "L0 must perform zero third-person index reads");
  assert.equal(l0.counts.resolves, 0, "L0 must perform zero source resolves");
  assert.equal(ownerReadStarts, 0, "L0 must not create an Owner read session or build the candidate directory");

  const l1 = instrument(ledger, () => retrieve(fixture, { level: "L1" }));
  assert.equal(l1.counts.resolves, 0, "L1 must perform zero source resolves");
  assert(l1.value.items.length <= 16, "L1 may return at most 16 items per target");

  const l2 = instrument(ledger, () => retrieve(fixture, { level: "L2" }));
  assert(l2.value.metrics.sourceResolveAttemptCount <= 2, "L2 counts every Source Resolve attempt, including failures");
  assert.equal(l2.value.metrics.sourceResolveAttemptCount, l2.counts.resolves,
    "reported L2 attempt count must equal actual PairLongTermLedger.resolveSource calls");
  return { fixture, l0: l0.value, l1: l1.value, l2: l2.value };
}

function runL2FallbackBudgetCheck() {
  const fixture = seedMainFixture(makeFixture("l2-fallback-budget"), 8);
  const conversationId = "v9362-l2-fallback-budget";
  const sceneRevision = "synthetic-scene-l2";
  const turnEpoch = 1;
  const query = "1190年你和玛蒂尔达为了盐税具体争执过什么？";
  const ledger = fixture.engine.store.pairLedger;
  const originalResolve = ledger.resolveSource.bind(ledger);
  let attempts = 0;
  ledger.resolveSource = () => { attempts++; throw new Error("SOURCE_UNAVAILABLE_OR_STALE"); };
  let result;
  try {
    result = fixture.engine.retrieveForResponder({
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
      entityProfiles: [{ id: OWNER_ID, name: "回应者乙" }, { id: PLAYER_ID, name: "玩家甲" },
        { id: TARGET_ID, name: TARGET_NAME, aliases: [TARGET_NAME, "王后·玛蒂尔达", "Cora"] }],
      trustedPlayerTurn: makeTrustedTurn(query, { conversationId, sceneRevision, turnEpoch }),
      query,
      tokenBudget: 100000,
      estimateTokens: value => Math.ceil(String(value || "").length / 2),
      sessionRecallCache: new Map()
    });
  } finally { ledger.resolveSource = originalResolve; }
  assert.equal(result.thirdPersonDecision.level, "L2", `fixture must exercise explicit source detail: ${JSON.stringify(result.thirdPersonDecision)}`);
  assert.equal(attempts, 2, "two stale L2 resolve attempts consume the full chain budget");
  assert.equal(result.pairMemoryMetrics.totalSourceResolveAttemptCount, 2,
    "legacy fallback must share the L2 PairLedger attempt budget instead of reopening sources");
}

function runMutationChecks() {
  const fixture = seedMainFixture(makeFixture("mutation"), 20);
  const base = compareSafeWithReference(fixture);
  assert(base.safe.items.some(item => item.text.includes("QA_CROSS_TITLE_ALIAS")));

  const late = makeSummary(OWNER_ID, 9000, "QA_ADDED_AFTER_WARMUP", "Cora告诉乙，盐税账册需要复核。");
  appendSummary(fixture, OWNER_ID, 9000, late);
  refreshOwnerMemories(fixture);
  const afterAdd = compareSafeWithReference(fixture);
  assert(afterAdd.safe.text.includes("QA_ADDED_AFTER_WARMUP"), "a newly added Pair must invalidate the owner directory");

  const editedSummary = fixture.summaries.get("qa-QA_DECOY_0");
  const editedPath = fixture.files.get("qa-QA_DECOY_0");
  const beforeStat = fs.statSync(editedPath);
  const editedText = fs.readFileSync(editedPath, "utf8").replace("Oona", "Cora");
  assert.equal(Buffer.byteLength(editedText), beforeStat.size, "same-stat edit fixture must retain its byte size");
  fs.writeFileSync(editedPath, editedText, "utf8");
  fs.utimesSync(editedPath, beforeStat.atime, beforeStat.mtime);
  const afterStat = fs.statSync(editedPath);
  assert.equal(afterStat.size, beforeStat.size);
  assert.equal(afterStat.mtimeMs, beforeStat.mtimeMs, "same-stat edit fixture preserves size and mtime");
  fixture.summaries.set("qa-QA_DECOY_0", { ...editedSummary, content: editedSummary.content.replace("Oona", "Cora") });
  refreshOwnerMemories(fixture);
  const afterEdit = compareSafeWithReference(fixture);
  assert(afterEdit.safe.text.includes("QA_DECOY_0"), "same-size/same-mtime source edits must refresh candidate coverage");

  const deletePath = fixture.files.get("qa-QA_CROSS_TITLE_ALIAS");
  fs.unlinkSync(deletePath);
  refreshOwnerMemories(fixture);
  const afterDelete = compareSafeWithReference(fixture);
  assert(!afterDelete.safe.text.includes("QA_CROSS_TITLE_ALIAS"), "deleted Pair sources must not remain in the directory");

  const forgottenSummary = fixture.summaries.get("qa-QA_ADDED_AFTER_WARMUP");
  fixture.engine.store.saveIndex = () => {};
  fixture.engine.store.recordForgottenSummaryProjection(forgottenSummary,
    { ownerId: OWNER_ID, counterpartId: 9000 });
  refreshOwnerMemories(fixture);
  const afterForget = compareSafeWithReference(fixture);
  assert(!afterForget.safe.text.includes("QA_ADDED_AFTER_WARMUP"), "Forget must remove the indexed matter from candidates");
}

function runProfileAndDateChecks() {
  const fixture = seedMainFixture(makeFixture("profile-date"), 8);
  const titleSummary = makeSummary(OWNER_ID, 7000, "QA_ALIAS_BECOMES_UNIQUE", "Lady Regent告诉乙，盐税账册已复核。");
  appendSummary(fixture, OWNER_ID, 7000, titleSummary);
  refreshOwnerMemories(fixture);

  const ambiguousProfiles = [...profileRows(), { characterId: 302, name: "另一位摄政夫人", aliases: ["Lady Regent"] }];
  const before = compareSafeWithReference(fixture, { profiles: ambiguousProfiles });
  assert(!before.safe.text.includes("QA_ALIAS_BECOMES_UNIQUE"), "a non-unique alias cannot bind another character's matter");
  const uniqueProfiles = profileRows();
  const after = compareSafeWithReference(fixture, { profiles: uniqueProfiles });
  assert(after.safe.text.includes("QA_ALIAS_BECOMES_UNIQUE"),
    "an alias-profile change must invalidate the directory and re-evaluate uniqueness");

  const future = makeSummary(OWNER_ID, 7001, "QA_FUTURE_SCENE_DATE", "Cora后来提到盐税账册。", { date: "1201.1.1" });
  appendSummary(fixture, OWNER_ID, 7001, future);
  refreshOwnerMemories(fixture);
  const earlier = compareSafeWithReference(fixture, { currentGameDate: "1200.1.1" });
  assert(!earlier.safe.text.includes("QA_FUTURE_SCENE_DATE"), "the scene date must hide future source matters");
  const later = compareSafeWithReference(fixture, { currentGameDate: "1202.1.1" });
  assert(later.safe.text.includes("QA_FUTURE_SCENE_DATE"), "a later scene date must make the valid source visible");
}

function runAmbiguousAndIncompleteChecks() {
  const fixture = seedMainFixture(makeFixture("ambiguous-incomplete"), 8);
  appendSummary(fixture, OWNER_ID, 7999,
    makeSummary(OWNER_ID, 7999, "QA_SAME_ALIAS_DIFFERENT_ID", "玛蒂尔达提到盐税账册，但相同姓名不能唯一绑定目标ID。"));
  const legacyContent = "旧式记忆段落。\n\n【需要长期记住的事项】\n王后·玛蒂尔达说盐税账册需复核。\n\n此处没有项目符号，边界无法确定。\n【其他事项】\n旧式尾段。";
  const legacy = makeSummary(OWNER_ID, 8000, "QA_CONFIRMED_LEGACY_AMBIGUOUS", "unused",
    { customContent: legacyContent, finalizationId: null, conversationId: null });
  appendSummary(fixture, OWNER_ID, 8000, legacy);
  refreshOwnerMemories(fixture);
  const scope = { ownerId: OWNER_ID, counterpartId: 8000, campaignToken: CAMPAIGN };
  const preview = fixture.engine.store.pairLedger.preview(scope, { currentGameDate: CURRENT_DATE,
    currentTotalDays: CURRENT_TOTAL_DAYS, memories: fixture.memories });
  assert.equal(preview.pairs[0].items.length, 1, "the legacy fixture must reach the actual ambiguous Pair index");
  const confirmed = fixture.engine.store.pairLedger.apply(scope, { previewRevision: preview.previewRevision,
    currentGameDate: CURRENT_DATE, currentTotalDays: CURRENT_TOTAL_DAYS, memories: fixture.memories });
  assert.equal(confirmed.success, true);
  const targetMemory = fixture.memories.find(memory => memory.provenance?.counterpartIds?.map(Number).includes(8000));
  assert(targetMemory, "fixture owner snapshot must expose the legacy Pair source");
  const legacySource = targetMemory.provenance.pairLedgerSources.find(row => Number(row.counterpartId) === 8000);
  const afterConfirm = compareSafeWithReference(fixture);
  assert(afterConfirm.safe.items.some(item => Number(item.scope?.counterpartId) === 8000),
    "the directory must not discard a previously confirmed ambiguous Legacy matter");
  assert(!afterConfirm.safe.text.includes("QA_SAME_ALIAS_DIFFERENT_ID"),
    "a shared alias on another character ID must not become target evidence");

  const priorRawSummary = legacySource.rawSummary;
  legacySource.rawSummary = null;
  const reference = retrieve(fixture, { retrievalMode: "exhaustive-reference" });
  const incompleteSafe = instrument(fixture.engine.store.pairLedger,
    () => retrieve(fixture, { retrievalMode: "safe-candidate-directory" }));
  legacySource.rawSummary = priorRawSummary;
  assert.deepEqual(incompleteSafe.value.items.map(itemFingerprint), reference.items.map(itemFingerprint),
    "a missing raw Summary body on a known Pair must preserve the exhaustive result");
  assert.equal(incompleteSafe.value.metrics.candidateDirectoryStatus, "SCOPED_DEGRADED",
    "a missing raw Summary body with a trusted counterpart ID must degrade only that Pair");
  assert.equal(incompleteSafe.value.metrics.legacyScanFallbackCount, 0,
    "a known uncertain Pair must not trigger the full Owner scan");
  assert(incompleteSafe.counts.readScopes.some(row => row.counterpartId === 8000),
    "the uncertain source's known Pair must be revalidated by the authoritative PairLedger");
  assert(incompleteSafe.value.metrics.candidatePairCount < reference.metrics.candidatePairCount,
    "a scoped legacy source must leave unrelated Pair scopes unread");
}

function runOwnerReadRaceChecks() {
  const fixture = seedMainFixture(makeFixture("owner-read-races"), 12);
  const initial = retrieve(fixture, { retrievalMode: "safe-candidate-directory" });
  assert(initial.metrics.candidatePairCount < 13, "race fixture must have non-candidate Owner scopes");
  const ledger = fixture.engine.store.pairLedger;
  const targetPath = fixture.files.get("qa-QA_DECOY_1");
  const original = fs.readFileSync(targetPath, "utf8");
  const oldStat = fs.statSync(targetPath);
  const newText = original.replace("Oona", "Cora");
  assert.equal(Buffer.byteLength(newText), oldStat.size);

  function mutateWithSameVisibleStat() {
    fs.writeFileSync(targetPath, newText, "utf8");
    fs.utimesSync(targetPath, oldStat.atime, oldStat.mtime);
    const stat = fs.statSync(targetPath);
    assert.equal(stat.size, oldStat.size);
    assert.equal(stat.mtimeMs, oldStat.mtimeMs);
  }
  function restoreFile() {
    fs.writeFileSync(targetPath, original, "utf8");
    fs.utimesSync(targetPath, oldStat.atime, oldStat.mtime);
  }
  function expectStaleAt(hookName, install) {
    const restoreHook = install(mutateWithSameVisibleStat);
    let result;
    try { result = retrieve(fixture, { retrievalMode: "safe-candidate-directory" }); }
    finally { restoreHook(); restoreFile(); }
    assert.equal(result.fallbackStatus, "SOURCE_STALE", `${hookName}: owner-level races must reject the whole retrieval`);
    assert.equal(result.text, "", `${hookName}: stale partial results must be discarded`);
    assert.equal(result.legacyFallbackEligible, false, `${hookName}: global owner races may not enter Legacy fallback`);
    refreshOwnerMemories(fixture);
  }

  if (typeof ledger.beginOwnerRead !== "function" || typeof ledger.validateOwnerRead !== "function") {
    throw new Error("safe candidate directory owner-read session API is required for race injection QA");
  }

  expectStaleAt("after candidate directory construction", mutate => {
    const originalGet = ledger.candidateDirectory.getCandidateScopes.bind(ledger.candidateDirectory);
    ledger.candidateDirectory.getCandidateScopes = (...args) => { const result = originalGet(...args); mutate(); return result; };
    return () => { ledger.candidateDirectory.getCandidateScopes = originalGet; };
  });

  expectStaleAt("after a candidate Pair.read", mutate => {
    const originalRead = ledger.read.bind(ledger);
    let changed = false;
    ledger.read = (...args) => { const result = originalRead(...args); if (!changed) { changed = true; mutate(); } return result; };
    return () => { ledger.read = originalRead; };
  });

  expectStaleAt("after final scope verification", mutate => {
    const originalValidate = ledger.validateOwnerRead.bind(ledger);
    let changed = false;
    ledger.validateOwnerRead = (...args) => { if (!changed) { changed = true; mutate(); } return originalValidate(...args); };
    return () => { ledger.validateOwnerRead = originalValidate; };
  });
}

function runBeforeSendCheck() {
  const fixture = seedMainFixture(makeFixture("before-send"), 8);
  const conversationId = "v9362-before-send";
  const sceneRevision = "synthetic-scene-1";
  const turnEpoch = 1;
  const query = "你以前和玛蒂尔达关系怎么样？";
  const context = fixture.engine.retrieveForResponder({
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
    entityProfiles: [{ id: OWNER_ID, name: "回应者乙" }, { id: TARGET_ID, name: TARGET_NAME, aliases: [TARGET_NAME, "王后·玛蒂尔达", "Cora"] }],
    trustedPlayerTurn: makeTrustedTurn(query, { conversationId, sceneRevision, turnEpoch }),
    query,
    tokenBudget: 100000,
    estimateTokens: value => Math.ceil(String(value || "").length / 2),
    sessionRecallCache: new Map()
  });
  assert.equal(context.thirdPersonDecision.level, "L1", "before-send test must exercise authorized L1 recall");
  assert(!context.sourcePairIds.includes(1000), "pre-send fixture must change a Pair excluded from the safe candidate read set");

  const hiddenPath = fixture.files.get("qa-QA_DECOY_0");
  const beforeStat = fs.statSync(hiddenPath);
  const oldText = fs.readFileSync(hiddenPath, "utf8");
  const changedText = oldText.replace("Oona", "Cora");
  assert.equal(Buffer.byteLength(changedText), beforeStat.size);
  fs.writeFileSync(hiddenPath, changedText, "utf8");
  fs.utimesSync(hiddenPath, beforeStat.atime, beforeStat.mtime);

  const gameData = { campaignToken: CAMPAIGN, playerID: PLAYER_ID, date: CURRENT_DATE,
    getOfficialRecollectionSummary: () => null };
  let transportCalls = 0;
  const beforeSend = () => {
    const validation = fixture.engine.validatePlayerMemoryContext(context, gameData, conversationId);
    if (!validation.valid) throw new Error(`memory_source_changed_before_send:${validation.reason}`);
    transportCalls++;
  };
  assert.throws(beforeSend, /memory_source_changed_before_send/,
    "a source change after retrieval must be rejected by the real player-memory pre-send validator");
  assert.equal(transportCalls, 0, "the synthetic Provider transport must not run after a pre-send rejection");
}

function resolvedSourceFingerprintRows(result) {
  return result.sources.map(source => [source.sourceScopeCharacterId, source.targetCharacterId,
    source.sourceSummaryKey, source.sourceRevision]);
}

function invalidateSnapshotForModeChange(fixture, nextMode) {
  const store = fixture.engine.store;
  const ledger = store.pairLedger;
  const priorSnapshot = fixture.memories;
  const priorRevision = store.getFolderSummarySnapshotRevision(priorSnapshot);
  assert(store.folderSummaryCache.has(OWNER_ID), "mode-switch fixture starts with the Owner snapshot cached");
  ledger.setRetrievalMode(nextMode);
  assert.equal(ledger.retrievalMode, nextMode);
  assert.equal(store.folderSummaryCache.has(OWNER_ID), false,
    "changing the PairLedger retrieval mode must invalidate the cached Store snapshot");
  assert.notEqual(store.getFolderSummaryRevision(OWNER_ID), priorRevision,
    "changing the PairLedger retrieval mode must advance the Store snapshot revision");
  fixture.memories = store.loadFolderSummariesForCharacter(OWNER_ID);
}

function runRetrievalModeRollbackCheck() {
  const fixture = seedMainFixture(makeFixture("mode-rollback"), 12);
  const store = fixture.engine.store;
  const ledger = store.pairLedger;
  assert.equal(ledger.retrievalMode, "safe-candidate-directory", "safe candidate mode is the default");
  const safeBefore = retrieve(fixture, { level: "L2" });
  assert.equal(safeBefore.metrics.candidateDirectoryStatus, "COMPLETE");
  assert(safeBefore.metrics.candidatePairCount < safeBefore.metrics.ownerPairCount);

  invalidateSnapshotForModeChange(fixture, "exhaustive-reference");
  const exhaustive = retrieve(fixture, { level: "L2" });
  assert.equal(exhaustive.metrics.legacyScanFallbackReason, "REFERENCE_MODE");
  assert.equal(exhaustive.metrics.candidatePairCount, exhaustive.metrics.ownerPairCount,
    "exhaustive-reference mode must read every legacy scope");
  assert.deepEqual(exhaustive.items.map(itemFingerprint), safeBefore.items.map(itemFingerprint),
    "exhaustive-reference mode must preserve item order, scope, source key and source revision");
  assert.deepEqual(sourceFingerprintRows(exhaustive), sourceFingerprintRows(safeBefore));
  assert.deepEqual(resolvedSourceFingerprintRows(exhaustive), resolvedSourceFingerprintRows(safeBefore),
    "L2 source resolution must preserve scope, key and revision in exhaustive-reference mode");
  assert.equal(exhaustive.text, safeBefore.text);

  invalidateSnapshotForModeChange(fixture, "safe-candidate-directory");
  const safeAfter = retrieve(fixture, { level: "L2" });
  assert.equal(safeAfter.metrics.candidateDirectoryStatus, "COMPLETE",
    "returning to safe mode must rebuild a complete candidate directory");
  assert.equal(safeAfter.metrics.candidateDirectoryCacheHit, false,
    "mode changes must discard the old candidate directory before rebuilding");
  assert.equal(safeAfter.metrics.legacyScanFallbackCount, 0);
  assert.deepEqual(safeAfter.items.map(itemFingerprint), exhaustive.items.map(itemFingerprint));
  assert.deepEqual(sourceFingerprintRows(safeAfter), sourceFingerprintRows(exhaustive));
  assert.deepEqual(resolvedSourceFingerprintRows(safeAfter), resolvedSourceFingerprintRows(exhaustive));
  assert.equal(safeAfter.text, exhaustive.text);

  const snapshotRevision = store.getFolderSummarySnapshotRevision(fixture.memories);
  assert.throws(() => ledger.setRetrievalMode("not-a-retrieval-mode"), /PAIR_RETRIEVAL_MODE_INVALID/);
  assert.equal(ledger.retrievalMode, "safe-candidate-directory");
  assert.equal(store.getFolderSummaryRevision(OWNER_ID), snapshotRevision,
    "rejecting an invalid mode must not invalidate the Store snapshot");
  assert(store.folderSummaryCache.has(OWNER_ID));
}

function runSourceLinkGuardCheck() {
  const fixture = makeFixture("source-link-guards");
  const store = fixture.engine.store;
  const ownerFolderName = `${OWNER_ID}_QA_LinkOwner`;
  const ownerFolder = path.join(store.summaryFoldersDir, ownerFolderName);
  const targetFolder = path.join(fixture.root, "outside-synthetic-target");
  const fileName = "与人物9901的对话.json";
  const relative = `${ownerFolderName}/${fileName}`;
  const rows = [{ playerId: OWNER_ID, characterId: 9901, campaignToken: CAMPAIGN, content: "synthetic link target" }];
  const targetContents = JSON.stringify(rows, null, 2);
  const expectedDigest = crypto.createHash("sha256").update(JSON.stringify(rows)).digest("hex");
  const expected = new Map([[relative, expectedDigest]]);
  const targetFile = path.join(targetFolder, fileName);
  fs.mkdirSync(targetFolder, { recursive: true });
  fs.writeFileSync(targetFile, targetContents, "utf8");
  const unsupportedLinkErrors = new Set(["EPERM", "EACCES", "ENOTSUP", "EOPNOTSUPP", "EINVAL"]);
  const tryLink = (linkPath, targetPath, type) => {
    try { fs.symlinkSync(targetPath, linkPath, type); return null; }
    catch (error) { return error; }
  };
  const sourceText = () => fs.readFileSync(path.join(repoRoot, "src/app/main/memory-system/memory-store.js"), "utf8");

  const ownerFolderLink = path.join(store.summaryFoldersDir, ownerFolderName);
  const folderLinkError = tryLink(ownerFolderLink, targetFolder, "junction");
  if (!folderLinkError) {
    try {
      assert.equal(store.hasSummarySourceContentChanges(expected), true,
        "a shared Owner-folder junction must be rejected before reading its source files");
    } finally { fs.rmdirSync(ownerFolderLink); }
  } else {
    assert(unsupportedLinkErrors.has(folderLinkError.code), `synthetic folder junction failed: ${folderLinkError.message}`);
    assert.match(sourceText(), /assertNoLinks\(folder\)/,
      "when Windows cannot create the synthetic junction, retain the shared-folder ancestor guard");
    console.log("INFO junction creation unavailable; verified the shared-folder assertNoLinks guard statically");
  }

  fs.mkdirSync(ownerFolder, { recursive: true });
  const sourceFileLink = path.join(ownerFolder, fileName);
  const fileLinkError = tryLink(sourceFileLink, targetFile, "file");
  if (!fileLinkError) {
    try {
      assert.equal(store.hasSummarySourceContentChanges(expected), true,
        "a source-file symlink must be rejected even when its target digest matches the snapshot");
    } finally { fs.unlinkSync(sourceFileLink); }
  } else {
    assert(unsupportedLinkErrors.has(fileLinkError.code), `synthetic file symlink failed: ${fileLinkError.message}`);
    assert.match(sourceText(), /signature\?\.isSymbolicLink\s*\|\|\s*signature\s*&&\s*!signature\.isFile/,
      "when Windows cannot create the synthetic file link, retain the lstat symbolic-link rejection");
    console.log("INFO file-symlink creation unavailable; verified the source-file lstat guard statically");
  }

  const batchFolderName = `${OWNER_ID}_QA_BatchLink`;
  const batchFolder = path.join(store.summaryFoldersDir, batchFolderName);
  const movedFolder = path.join(fixture.root, "parked-synthetic-owner-folder");
  const batchTarget = path.join(fixture.root, "outside-synthetic-batch-target");
  const batchRows = [
    ["与人物9902的对话.json", [{ marker: "first synthetic source" }]],
    ["与人物9903的对话.json", [{ marker: "second synthetic source" }]]
  ];
  fs.mkdirSync(batchFolder, { recursive: true });
  fs.mkdirSync(batchTarget, { recursive: true });
  const batchExpected = new Map();
  for (const [name, fileRows] of batchRows) {
    const contents = JSON.stringify(fileRows, null, 2);
    fs.writeFileSync(path.join(batchFolder, name), contents, "utf8");
    fs.writeFileSync(path.join(batchTarget, name), contents, "utf8");
    batchExpected.set(`${batchFolderName}/${name}`,
      crypto.createHash("sha256").update(JSON.stringify(fileRows)).digest("hex"));
  }
  let switched = false;
  let junctionError = null;
  const originalReadFileSync = fs.readFileSync;
  const firstBatchFile = path.join(batchFolder, batchRows[0][0]);
  fs.readFileSync = function (filePath, ...args) {
    const result = originalReadFileSync.call(fs, filePath, ...args);
    if (!switched && path.resolve(String(filePath)) === firstBatchFile) {
      try {
        fs.renameSync(batchFolder, movedFolder);
        fs.symlinkSync(batchTarget, batchFolder, "junction");
        switched = true;
      } catch (error) {
        junctionError = error;
        if (fs.existsSync(movedFolder) && !fs.existsSync(batchFolder)) fs.renameSync(movedFolder, batchFolder);
      }
    }
    return result;
  };
  let batchChanged;
  try { batchChanged = store.hasSummarySourceContentChanges(batchExpected); }
  finally {
    fs.readFileSync = originalReadFileSync;
    if (fs.existsSync(batchFolder) && fs.lstatSync(batchFolder).isSymbolicLink()) fs.rmdirSync(batchFolder);
    if (fs.existsSync(movedFolder)) fs.renameSync(movedFolder, batchFolder);
  }
  if (switched) {
    assert.equal(batchChanged, true,
      "the shared-folder ancestor must be rechecked after the whole source batch");
  } else {
    assert(unsupportedLinkErrors.has(junctionError?.code),
      `batch ancestor junction injection failed: ${junctionError?.message || "not attempted"}`);
    assert.match(sourceText(), /for \(const folder of checkedFolders\) assertNoLinks\(folder\)/,
      "when Windows cannot create the batch-race junction, retain the post-batch ancestor check");
    console.log("INFO batch junction race unavailable; verified the post-batch assertNoLinks guard statically");
  }
}

function main() {
  try {
    check("safe candidate/reference parity, source scope isolation and sparse read reduction", runRetrievalParityChecks);
    check("L0/L1/L2 permissions use actual Engine/Store/PairLedger calls", runPermissionChecks);
    check("L2 race failures and legacy fallback share one two-attempt source budget", runL2FallbackBudgetCheck);
    check("add/edit/delete/Forget invalidate candidate coverage", runMutationChecks);
    check("alias uniqueness and scene date changes preserve reference behavior", runProfileAndDateChecks);
    check("confirmed legacy ambiguity and incomplete snapshots fail closed", runAmbiguousAndIncompleteChecks);
    check("owner snapshot, candidate read and final validation races reject whole retrievals", runOwnerReadRaceChecks);
    check("a post-retrieval source change blocks Provider transport at beforeSend", runBeforeSendCheck);
    check("safe/exhaustive/safe mode rollback invalidates and rebuilds Store snapshots", runRetrievalModeRollbackCheck);
    check("batch source signature checks reject file and shared-folder links", runSourceLinkGuardCheck);
    assert(path.resolve(tempRoot).startsWith(path.resolve(buildRoot) + path.sep), "cleanup target must remain in the synthetic build folder");
    fs.rmSync(tempRoot, { recursive: true, force: true });
    console.log(`V9.3.6.2 candidate directory independent QA: PASS (${checks} checks)`);
  } catch (error) {
    console.error(error && error.stack || error);
    process.exitCode = 1;
    if (fs.existsSync(tempRoot) && path.resolve(tempRoot).startsWith(path.resolve(buildRoot) + path.sep)) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  }
}

main();
