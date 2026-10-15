"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const sourceVersionPath = require.resolve("../src/app/main/version");
require.cache[sourceVersionPath] = { id: sourceVersionPath, filename: sourceVersionPath, loaded: true,
  exports: require("../resources/app/out/main/version") };
const { MemoryEngine } = require("../src/app/main/memory-system/memory-engine");
const { retrievePairMemorySources } = require("../src/app/main/memory-system/pair-memory-source-retrieval");
const { normalizeGameDate } = require("../src/app/main/worldline/character-temporal-facts");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v936-third-person-"));
const campaignToken = "qa-v936-third-person-campaign";
const currentGameDate = "1200.1.1";
const names = new Map([[1, "玩家甲"], [2, "回应者乙"], [3, "玛蒂尔达"], [4, "阿尔伯特"], [5, "另一位玛蒂尔达"]]);
let passed = 0;

function check(name, fn) {
  fn();
  passed++;
  console.log("PASS " + name);
}

function makeFixture(name) {
  const baseDir = path.join(root, name, "memory");
  const summaryFoldersDir = path.join(root, name, "summaries");
  for (const [id, characterName] of names) fs.mkdirSync(path.join(summaryFoldersDir, `${id}_${characterName}`), { recursive: true });
  return new MemoryEngine({ baseDir, summaryFoldersDir, trace: { record() {} } });
}

function legacySummary(ownerId, counterpartId, { finalizationId, date = "1190.1.1", matters,
  narrative = "QA_SOURCE_NARRATIVE：一场有完整叙事的会谈。" } = {}) {
  const dateSerial = normalizeGameDate(date)?.serial;
  return {
    date,
    totalDays: dateSerial,
    content: `${narrative}\n\n【需要长期记住的事项】\n${matters.map(item => `- ${item}`).join("\n")}\n【其他事项】\n合成来源。`,
    playerId: ownerId,
    playerName: names.get(ownerId),
    characterId: counterpartId,
    characterName: names.get(counterpartId),
    perspectiveOwnerId: ownerId,
    campaignToken,
    campaignBinding: { status: "bound", source: "qa_fixture", version: 1 },
    finalizationId,
    conversationId: `conversation-${finalizationId}`,
    conversationType: "pair",
    participants: [{ id: ownerId, name: names.get(ownerId) }, { id: counterpartId, name: names.get(counterpartId) }]
  };
}

function writePairSummaries(engine, ownerId, counterpartId, summaries) {
  const folder = `${ownerId}_${names.get(ownerId)}`;
  const file = path.join(engine.store.summaryFoldersDir, folder, `与${names.get(counterpartId)}的对话.json`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(summaries, null, 2), "utf8");
  return file;
}

function confirmAmbiguousPairItem(engine, marker) {
  const summary = legacySummary(2, 3, { finalizationId: marker, matters: [] });
  summary.content = `合成叙事。\n\n【需要长期记住的事项】\n事项边界需要人工确认。\n- ${marker}：玛蒂尔达和回应者乙讨论了税收安排。\n【其他事项】\n合成来源。`;
  writePairSummaries(engine, 2, 3, [summary]);
  const scope = { campaignToken, ownerId: 2, counterpartId: 3 };
  const options = { currentGameDate, currentTotalDays: normalizeGameDate(currentGameDate).serial,
    memories: engine.store.loadFolderSummariesForCharacter(2) };
  const preview = engine.store.pairLedger.preview(scope, options);
  assert.equal(preview.pairs[0].items.length, 1);
  assert.equal(preview.pairs[0].items[0].ambiguous, true);
  assert.equal(preview.pairs[0].items[0].confirmed, false);
    engine.store.pairLedger.apply(scope, { ...options, previewRevision: preview.previewRevision });
  engine.store.pairLedger.invalidate([2]);
  const confirmed = engine.store.pairLedger.read(scope, { ...options, readOnly: true });
  assert.equal(confirmed.items.length, 1);
  assert.equal(confirmed.items[0].ambiguous, true);
  assert.equal(confirmed.items[0].confirmed, true);
  return confirmed.items[0];
}

function tokenCount(value) {
  return Math.ceil(String(value || "").length / 2);
}

function profileRows({ ambiguous = false } = {}) {
  const profiles = [
    { characterId: 1, name: "玩家甲", aliases: ["甲"] },
    { characterId: 2, name: "回应者乙", aliases: ["乙"] },
    { characterId: 3, name: "玛蒂尔达", aliases: ["玛蒂尔达", "马蒂尔达"] },
    { characterId: 4, name: "阿尔伯特", aliases: ["阿尔伯特"] },
    { characterId: 5, name: "另一位玛蒂尔达", aliases: ambiguous ? ["玛蒂尔达"] : ["另一位玛蒂尔达"] }
  ];
  return profiles;
}

function decision(level = "L1", { targetIds = [3], targetEvidence = "UNIQUE_ALIAS" } = {}) {
  return {
    level,
    responderId: 2,
    playerAnchorId: 1,
    targetCharacterIds: targetIds,
    targetEvidence,
    historyIntent: level === "L2" ? "DETAIL" : level === "L1" ? "RELATIONSHIP" : "NONE",
    explicitSourceDetailRequested: level === "L2",
    denialDetected: false,
    reasonCode: level === "L0" ? "NO_HISTORICAL_INTENT" : "EXPLICIT_HISTORY_REQUEST",
    queryFingerprint: "qa-query-fingerprint"
  };
}

function retrieve(engine, level = "L1", overrides = {}) {
  const memories = engine.store.loadFolderSummariesForCharacter(2);
  return retrievePairMemorySources({
    mode: level === "L2" ? "THIRD_PERSON_SOURCE_DETAIL" : "THIRD_PERSON_LEDGER",
    store: engine.store,
    ownerId: 2,
    decision: decision(level),
    entitiesProfile: profileRows(),
    campaignToken,
    currentGameDate,
    currentTotalDays: normalizeGameDate(currentGameDate).serial,
    memories,
    query: "你还记得玛蒂尔达吗？",
    tokenBudget: 100000,
    estimateTokens: tokenCount,
    ...overrides
  });
}

check("L0 is not misreported as ambiguous and returns without reading a PairLedger scope or resolving a source", () => {
  const engine = makeFixture("l0-no-read");
  let readCount = 0, resolveCount = 0;
  engine.store.pairLedger.read = () => { readCount++; throw new Error("L0 must not read"); };
  engine.store.pairLedger.resolveSource = () => { resolveCount++; throw new Error("L0 must not resolve"); };
  const result = retrieve(engine, "L0", { decision: decision("L0") });
  assert.equal(result.fallbackStatus, "NOT_REQUESTED");
  assert.equal(result.legacyFallbackEligible, false);
  assert.equal(readCount, 0);
  assert.equal(resolveCount, 0);
  assert.equal(result.text, "");

  const unresolvedNoIntent = retrieve(engine, "L0", { decision: decision("L0", { targetEvidence: "UNRESOLVED" }) });
  assert.equal(unresolvedNoIntent.fallbackStatus, "NOT_REQUESTED");
  const unresolvedHistory = decision("L0", { targetEvidence: "UNRESOLVED" });
  unresolvedHistory.reasonCode = "HISTORY_TARGET_UNRESOLVED";
  const unresolvedRequest = retrieve(engine, "L0", { decision: unresolvedHistory });
  assert.equal(unresolvedRequest.fallbackStatus, "IDENTITY_AMBIGUOUS");
  assert.equal(readCount, 0);
});

check("L1 returns no more than 16 direct matters and never opens Legacy sources", () => {
  const engine = makeFixture("l1-sixteen");
  const matters = Array.from({ length: 20 }, (_, index) => `QA_DIRECT_C_${String(index + 1).padStart(2, "0")}_独特经历。`);
  writePairSummaries(engine, 2, 3, [legacySummary(2, 3, { finalizationId: "direct-twenty", matters })]);
  let resolveCount = 0;
  const originalResolve = engine.store.pairLedger.resolveSource.bind(engine.store.pairLedger);
  engine.store.pairLedger.resolveSource = (...args) => { resolveCount++; return originalResolve(...args); };
  const result = retrieve(engine, "L1", { query: "你以前和玛蒂尔达关系怎么样？" });
  assert.equal(result.fallbackStatus, "INDEX_HIT_ITEMS");
  assert.equal(result.legacyFallbackEligible, false);
  assert.equal(result.items.length, 16);
  assert.equal(result.metrics.injectedItems, 16);
  assert.equal(result.metrics.omittedByTargetLimit, 4);
  assert.equal(resolveCount, 0);
  assert(result.items.every(item => item.routeKind === "third_direct_pair" && item.targetCharacterId === 3));
});

check("third-person L1 retains an ambiguous matter after the real PairLedger confirmation flow", () => {
  const engine = makeFixture("confirmed-ambiguous-item");
  const confirmedItem = confirmAmbiguousPairItem(engine, "QA_CONFIRMED_AMBIGUOUS_THIRD");
  const result = retrieve(engine, "L1");
  assert.equal(result.fallbackStatus, "INDEX_HIT_ITEMS");
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].itemId, confirmedItem.itemId);
  assert.equal(result.items[0].ambiguous, true);
  assert.equal(result.items[0].confirmed, true);
  assert(result.text.includes("QA_CONFIRMED_AMBIGUOUS_THIRD"));
});

check("cross-pair items require a unique target alias and remain owner-directed", () => {
  const engine = makeFixture("cross-pair-alias");
  writePairSummaries(engine, 2, 4, [legacySummary(2, 4, { finalizationId: "b-to-d", matters: [
    "QA_CROSS_OWNER_B_ONLY：阿尔伯特告知玛蒂尔达已提出税收改革。",
    "QA_CROSS_NO_TARGET：阿尔伯特单独讨论了税收账目。"
  ] })]);
  writePairSummaries(engine, 3, 2, [legacySummary(3, 2, { finalizationId: "reverse-owner", matters: [
    "QA_REVERSE_OWNER_SECRET：玛蒂尔达告诉回应者乙的一段私人往事。"
  ] })]);
  const result = retrieve(engine, "L1", { query: "税收", decision: decision("L1", { targetEvidence: "EXPLICIT_ID" }) });
  assert.equal(result.fallbackStatus, "INDEX_HIT_ITEMS");
  assert(result.text.includes("QA_CROSS_OWNER_B_ONLY"));
  assert(!result.text.includes("QA_CROSS_NO_TARGET"));
  assert(!result.text.includes("QA_REVERSE_OWNER_SECRET"));
  assert(result.metrics.scopeRevisions.every(scope => scope.ownerId === 2));

  const ambiguousProfiles = profileRows({ ambiguous: true });
  const ambiguous = retrieve(engine, "L1", { query: "税收",
    decision: decision("L1", { targetEvidence: "EXPLICIT_ID" }), entitiesProfile: ambiguousProfiles });
  assert.equal(ambiguous.fallbackStatus, "INDEX_MISS");
  assert(!ambiguous.text.includes("QA_CROSS_OWNER_B_ONLY"), "colliding aliases cannot authorize cross-pair identity");
});

check("L2 opens at most two real PairLedger source pointers and verifies the source revision", () => {
  const engine = makeFixture("l2-verified-source");
  const summaries = Array.from({ length: 3 }, (_, index) => legacySummary(2, 3, {
    finalizationId: `detail-${index + 1}`,
    date: `119${index}.1.1`,
    matters: [`QA_DETAIL_PROMISE_${index + 1}：玛蒂尔达与回应者乙讨论税收约定。`],
    narrative: `QA_DETAIL_SOURCE_${index + 1}：这篇Legacy来源包含约定原委和现场叙事。`
  }));
  writePairSummaries(engine, 2, 3, summaries);
  let resolveCount = 0;
  const originalResolve = engine.store.pairLedger.resolveSource.bind(engine.store.pairLedger);
  engine.store.pairLedger.resolveSource = (...args) => { resolveCount++; return originalResolve(...args); };
  const result = retrieve(engine, "L2", { query: "你和玛蒂尔达当年具体讨论税收约定经过" });
  assert.equal(result.fallbackStatus, "INDEX_HIT_SOURCE");
  assert.equal(result.legacyFallbackEligible, false);
  assert.equal(resolveCount, 2);
  assert.equal(result.sources.length, 2);
  assert.equal(result.verifiedCandidatePointers.length, 2);
  assert.equal(result.metrics.duplicateIncludedCount, 2, "only full exact matter entries from verified source revisions may be deduplicated");
  assert.equal(result.items.length, 1, "the third matter from the un-opened source remains in the ledger output");
  assert(result.sources.every(source => source.memory.content.includes("QA_DETAIL_SOURCE_")));
  assert(result.text.includes("QA_DETAIL_SOURCE_"));
  assert(result.metrics.finalInjectedTokens <= 100000);
  assert(result.candidateSourcePointers.length >= 2);
  assert(result.sources.every(source => source.memory.provenance.folderOwnerId === 2));
});

check("L2 keeps a budget-fitting short matter when its verified full source does not fit", () => {
  const engine = makeFixture("l2-source-budget-omitted");
  writePairSummaries(engine, 2, 3, [legacySummary(2, 3, {
    finalizationId: "detail-too-long",
    matters: ["QA_SHORT_DETAIL_ITEM：玛蒂尔达约定税收。"],
    narrative: `QA_LONG_DETAIL_SOURCE：${"这是一段很长但合法的原始谈话叙事。".repeat(180)}`
  })]);
  const result = retrieve(engine, "L2", { query: "你和玛蒂尔达当年具体税收约定经过", tokenBudget: 128 });
  assert.equal(result.sources.length, 0);
  assert.equal(result.metrics.openedSummaryCount, 1, "source verification is observable even when the source body is budget-omitted");
  assert.equal(result.metrics.duplicateIncludedCount, 0, "an opened but omitted source cannot suppress its indexed matter");
  assert.equal(result.items.length, 1);
  assert(result.text.includes("QA_SHORT_DETAIL_ITEM"));
  assert(!result.text.includes("QA_LONG_DETAIL_SOURCE"));
  assert.equal(result.fallbackStatus, "BUDGET_OMITTED");
  assert.equal(result.legacyFallbackEligible, false);
});

check("L2 stale source pointers fail closed and expose bounded fallback eligibility", () => {
  const engine = makeFixture("l2-stale-source");
  writePairSummaries(engine, 2, 3, [legacySummary(2, 3, {
    finalizationId: "stale-detail", matters: ["QA_STALE_DETAIL_ITEM：玛蒂尔达谈到税收约定。"]
  })]);
  engine.store.pairLedger.resolveSource = () => { throw new Error("SOURCE_UNAVAILABLE_OR_STALE"); };
  const result = retrieve(engine, "L2", { query: "你和玛蒂尔达当年具体税收约定经过" });
  assert.equal(result.fallbackStatus, "SOURCE_STALE");
  assert.equal(result.legacyFallbackEligible, true);
  assert.equal(result.sources.length, 0);
  assert(!result.text.includes("QA_STALE_DETAIL_ITEM"));
});

check("L2 may fall back for an unavailable derived index but never across identity or Forget conflicts", () => {
  const unavailableEngine = makeFixture("l2-index-unavailable");
  unavailableEngine.store.pairLedger.read = () => {
    const error = new Error("PAIR_INDEX_CORRUPT");
    error.code = "PAIR_INDEX_CORRUPT";
    throw error;
  };
  const unavailable = retrieve(unavailableEngine, "L2", { query: "你和玛蒂尔达当年具体税收约定经过" });
  assert.equal(unavailable.fallbackStatus, "INDEX_UNAVAILABLE");
  assert.equal(unavailable.legacyFallbackEligible, true);
  const unavailableL1 = retrieve(unavailableEngine, "L1");
  assert.equal(unavailableL1.fallbackStatus, "INDEX_UNAVAILABLE");
  assert.equal(unavailableL1.legacyFallbackEligible, false);

  for (const [fixtureName, code, expectedStatus] of [
    ["identity", "SOURCE_IDENTITY_AMBIGUOUS", "IDENTITY_AMBIGUOUS"],
    ["forget", "PAIR_INDEX_FORGET_CHECK_FAILED", "SOURCE_STALE"]
  ]) {
    const engine = makeFixture(`l2-${fixtureName}-conflict`);
    writePairSummaries(engine, 2, 3, [legacySummary(2, 3, {
      finalizationId: `conflict-${fixtureName}`, matters: [`QA_${fixtureName}_CONFLICT_ITEM：玛蒂尔达谈到税收约定。`]
    })]);
    engine.store.pairLedger.resolveSource = () => {
      const error = new Error(code);
      error.code = code;
      throw error;
    };
    const result = retrieve(engine, "L2", { query: "你和玛蒂尔达当年具体税收约定经过" });
    assert.equal(result.fallbackStatus, expectedStatus);
    assert.equal(result.legacyFallbackEligible, false);
    assert.equal(result.text, "");
    assert.equal(result.items.length, 0);
  }
});

check("Forget failure during final scope revalidation suppresses fallback", () => {
  const engine = makeFixture("l2-final-forget-check");
  writePairSummaries(engine, 2, 3, [legacySummary(2, 3, {
    finalizationId: "final-forget-check", matters: ["QA_FINAL_FORGET_ITEM：玛蒂尔达谈到税收约定。"]
  })]);
  const originalRead = engine.store.pairLedger.read.bind(engine.store.pairLedger);
  let readCount = 0;
  engine.store.pairLedger.read = (...args) => {
    readCount++;
    if (readCount === 3) {
      const error = new Error("PAIR_INDEX_FORGET_CHECK_FAILED");
      error.code = "PAIR_INDEX_FORGET_CHECK_FAILED";
      throw error;
    }
    return originalRead(...args);
  };
  const result = retrieve(engine, "L2", { query: "你和玛蒂尔达当年具体税收约定经过" });
  assert.equal(result.fallbackStatus, "SOURCE_STALE");
  assert.equal(result.legacyFallbackEligible, false);
  assert.equal(result.text, "");
  assert.equal(result.items.length, 0);
});

check("L1 index miss never enables source fallback while L2 index miss does", () => {
  const engine = makeFixture("index-miss-levels");
  const l1 = retrieve(engine, "L1");
  const l2 = retrieve(engine, "L2");
  assert.equal(l1.fallbackStatus, "INDEX_MISS");
  assert.equal(l1.legacyFallbackEligible, false);
  assert.equal(l2.fallbackStatus, "INDEX_MISS");
  assert.equal(l2.legacyFallbackEligible, true);
});

console.log("V9.3.6 third-person retrieval: PASS (" + passed + " checks)");

assert(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep));
fs.rmSync(root, { recursive: true, force: true });
