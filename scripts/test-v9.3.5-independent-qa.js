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
const { MemoryExtractor } = require("../src/app/main/memory-system/memory-extractor");
const { MemoryRanker } = require("../src/app/main/memory-system/memory-ranker");
const { createMemoryRecord } = require("../src/app/main/memory-system/memory-types");
const { retrievePairMemorySources } = require("../src/app/main/memory-system/pair-memory-source-retrieval");
const { resolveActiveMemoryPairs } = require("../src/app/main/memory-system/pair-memory-routing");
const { repairVisibilityBoundaries, rebuildSourceNarrative } = require("../src/app/main/memory-system/finalization-visibility");
const { normalizeGameDate } = require("../src/app/main/worldline/character-temporal-facts");
const pairMatters = require("../src/app/shared/pair-important-matters");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v935-independent-qa-"));
let passed = 0;
let failed = 0;

async function check(name, run) {
  try {
    await run();
    passed++;
    console.log(`PASS ${name}`);
  } catch (error) {
    failed++;
    console.error(`FAIL ${name}: ${error.stack || error.message || error}`);
  }
}

const names = new Map([[1, "甲"], [2, "乙"], [3, "丙"], [4, "丁"], [5, "戊"], [6, "己"], [7, "庚"], [8, "辛"]]);
const campaignToken = "qa-v935-independent-campaign";
const currentGameDate = "1200.1.1";

function makeFixture(name = "late-join") {
  const baseDir = path.join(root, name, "memory");
  const summaryFoldersDir = path.join(root, name, "summaries");
  for (const [id, characterName] of names) {
    fs.mkdirSync(path.join(summaryFoldersDir, `${id}_${characterName}`), { recursive: true });
  }
  return new MemoryEngine({ baseDir, summaryFoldersDir, trace: { record() {} } });
}

function legacySummary(ownerId, counterpartId, { finalizationId, date = "1190.1.1", totalDays,
  matters = ["保罗与赵子绅谈及边境文书。"], narrative = "完整叙事包括现场经过与人物反应。", extra = {} } = {}) {
  const ownerName = names.get(ownerId), counterpartName = names.get(counterpartId);
  const dateSerial = normalizeGameDate(date)?.serial;
  return {
    date, totalDays: totalDays ?? dateSerial,
    content: `${narrative}\n\n【需要长期记住的事项】\n${matters.map(item => `- ${item}`).join("\n")}\n【其他事项】\n此段仅用于完整来源回查。`,
    playerId: ownerId, playerName: ownerName, characterId: counterpartId, characterName: counterpartName,
    perspectiveOwnerId: ownerId, campaignToken,
    campaignBinding: { status: "bound", source: "qa_fixture", version: 1 },
    finalizationId, conversationId: `conversation-${finalizationId}`,
    conversationType: "pair", participants: [{ id: ownerId, name: ownerName }, { id: counterpartId, name: counterpartName }],
    ...extra
  };
}

function writePairSummaries(engine, ownerId, counterpartId, summaries) {
  const folder = `${ownerId}_${names.get(ownerId)}`;
  const file = path.join(engine.store.summaryFoldersDir, folder, `与${names.get(counterpartId)}的对话.json`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(summaries, null, 2), "utf8");
  return file;
}

function tokenCount(value) { return Math.ceil(String(value || "").length / 2); }

function injectedTextTokens(result) {
  return tokenCount([result.stableText, result.directStableText, result.temporalExtraText].filter(Boolean).join("\n\n"));
}

function percentile(values, fraction) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return Number(sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)].toFixed(2));
}

const participants = [{ id: 1, name: "甲" }, { id: 2, name: "乙" }, { id: 3, name: "丙" }];
const messages = [
  { id: 1, role: "user", speakerCharacterId: 1, content: "甲只对乙低声说QA_EARLY_WHISPER_SECRET，答应替乙保管密信。" },
  { id: 2, role: "assistant", speakerCharacterId: 2, content: "乙公开向众人回应QA_EARLY_PUBLIC_SECRET，答应记下甲的请求。" },
  { id: 3, role: "user", speakerCharacterId: 1, content: "甲公开向众人承诺稍后呈交港口清册QA_LATE_JOIN_PROMISE。" },
  { id: 4, role: "assistant", speakerCharacterId: 2, content: "乙公开向众人同意港口清册安排QA_BEFORE_ABSENCE。" },
  { id: 5, role: "system", kind: "presence_temporary_leave", content: "丙暂时离开厅堂。" },
  { id: 6, role: "user", speakerCharacterId: 1, content: "甲公开向众人说明明日再核查港口清册QA_DURING_ABSENCE。" },
  { id: 7, role: "system", kind: "presence_temporary_return", content: "丙已经返回厅堂。" },
  { id: 8, role: "assistant", speakerCharacterId: 2, content: "乙公开向众人确认会在明日核查港口清册QA_AFTER_RETURN。" },
  { id: 9, role: "user", speakerCharacterId: 1, content: "甲公开向众人报告港口清册已备妥QA_MIXED_PUBLIC。\n甲暗自心想仍要隐瞒密信QA_MIXED_PRIVATE_SECRET。" }
];
const participantPresence = [
  { characterId: 1, joinedAtMessageId: 1, leftAtMessageId: null },
  { characterId: 2, joinedAtMessageId: 1, leftAtMessageId: null },
  { characterId: 3, joinedAtMessageId: 3, leftAtMessageId: 5 },
  { characterId: 3, joinedAtMessageId: 7, leftAtMessageId: null }
];

function matter({ id, content, messageIds, speakerIds, participants: matterParticipants, subjects,
  visibility = "public", type = "event" }) {
  return { type, subtype: "qa_fixture", participants: matterParticipants, subjects, content,
    canonicalText: content, importance: 0.95, confidence: 0.95, epistemicStatus: "asserted",
    visibility, source: "spoken", status: type === "promise" ? "open" : null, unresolved: false,
    messageIds, speakerIds, tags: [id] };
}

function syntheticOutput() {
  const allIds = messages.map(message => message.id);
  const merged = messages.map(message => message.content).join("\n");
  return JSON.stringify({ summarySegments: [{ content: merged, participants: [1, 2, 3], visibility: "public",
    source: "spoken", messageIds: allIds, speakerIds: [1, 2] }], memories: [
    matter({ id: "early-whisper", type: "secret", content: "甲只对乙低声说要替乙保管密信。",
      messageIds: [1], speakerIds: [1], participants: [1, 2], subjects: [2], visibility: "known_group" }),
    matter({ id: "early-public", type: "promise", content: "乙答应记下甲的请求。",
      messageIds: [2], speakerIds: [2], participants: [1, 2], subjects: [1] }),
    matter({ id: "late-join", type: "promise", content: "甲承诺稍后呈交港口清册。",
      messageIds: [3], speakerIds: [1], participants: [1, 2, 3], subjects: [1] }),
    matter({ id: "cross-join", type: "promise", content: "乙与丙共同商定港口清册安排QA_CROSS_JOIN_BOUNDARY。",
      messageIds: [2, 3], speakerIds: [2, 1], participants: [1, 2, 3], subjects: [2] }),
    matter({ id: "cross-absence", type: "promise", content: "乙先同意港口清册安排，再在丙返回后确认同一事项QA_CROSS_TEMPORARY_ABSENCE。",
      messageIds: [4, 8], speakerIds: [2], participants: [1, 2, 3], subjects: [2] }),
    matter({ id: "mixed-public-private", type: "promise", content: "甲公开报告港口清册已备妥，并暗自决定隐瞒密信。",
      messageIds: [9], speakerIds: [1], participants: [1, 2, 3], subjects: [1] }),
    matter({ id: "private-thought", type: "plan", content: "甲暗自心想仍要隐瞒密信。",
      messageIds: [9], speakerIds: [1], participants: [1], subjects: [1], visibility: "private" })
  ] });
}

async function testFinalizationAndLateJoinBoundaries() {
  const engine = makeFixture();
  const date = "1174.1.1";
  const context = engine.prepareFinalizationContext({ campaignToken: "qa-v935-synthetic-campaign",
    conversationId: "qa-v935-late-join-absence", finalizationId: "qa-v935-late-join-absence-final",
    date, totalDays: normalizeGameDate(date).serial, participants, participantPresence, messages,
    finalizationVisibilityV1: true });
  const rebuilt = rebuildSourceNarrative(context, engine.extractor.parseOutput(syntheticOutput(), context));
  assert(rebuilt, "source-paragraph rebuild succeeds for the synthetic conversation");
  assert(rebuilt.memories.some(memory => memory.content.includes("甲承诺稍后呈交港口清册")),
    "source rebuild retains a public matter whose exact source remains authorized");
  assert(!rebuilt.memories.some(memory => memory.content.includes("QA_CROSS_TEMPORARY_ABSENCE")),
    "source rebuild drops a matter crossing a temporary absence boundary");
  const repaired = engine.extractor.parseOutput(syntheticOutput(), context);
  repairVisibilityBoundaries(context, repaired);
  assert(repaired.memories.some(memory => memory.content.includes("甲承诺稍后呈交港口清册")),
    "visibility repair preserves an individually validated public matter from its repaired source");
  assert(!repaired.memories.some(memory => memory.content.includes("QA_CROSS_JOIN_BOUNDARY")),
    "visibility repair drops a matter crossing a late-join boundary");
  assert(!repaired.memories.some(memory => memory.content.includes("QA_CROSS_TEMPORARY_ABSENCE")),
    "visibility repair drops a matter crossing a temporary-absence boundary");
  const result = await engine.finalizeWithAvailableOutput(context, { providerOutput: syntheticOutput() });
  assert.equal(result.success, true, `synthetic finalization should commit: ${result.error?.message || ""}`);

  const memories = result.extraction.memories;
  const has = token => memories.some(memory => memory.content.includes(token));
  assert(has("甲承诺稍后呈交港口清册"), "the public matter sourced after C joins survives repair");
  assert(has("甲只对乙低声说"), "an authorized whisper remains with its named recipient");
  assert(!has("QA_CROSS_TEMPORARY_ABSENCE"), "one matter cannot span C's temporary absence and return boundary");
  assert(!has("QA_CROSS_JOIN_BOUNDARY"), "an item sourced before and after C joins is rejected");
  assert(!has("并暗自决定隐瞒密信"), "a public memory cannot combine shared and private source text");
  assert(has("甲暗自心想仍要隐瞒密信"), "the source speaker's independently private plan remains valid");

  const lateOwnerToA = result.directedSummaries.get("3->1")?.content || "";
  assert(lateOwnerToA.includes("【需要长期记住的事项】"), "late-owner projection has a stable matters heading");
  assert(lateOwnerToA.includes("甲承诺稍后呈交港口清册"), "late-owner projection includes the authorized post-join matter");
  for (const hidden of ["QA_EARLY_WHISPER_SECRET", "QA_EARLY_PUBLIC_SECRET", "QA_MIXED_PRIVATE_SECRET", "QA_CROSS_TEMPORARY_ABSENCE"]) {
    assert(!lateOwnerToA.includes(hidden), `late owner cannot receive ${hidden}`);
  }
  const lateOwnerToB = result.directedSummaries.get("3->2")?.content || "";
  assert(lateOwnerToB.includes("【需要长期记住的事项】\n无"), "a narrative projection with no pair-relevant matter explicitly says none");
}

function testPromptRequiresPerPresencePeriodMatters() {
  const prompt = new MemoryExtractor().buildPrompt({ messages, participants, participantPresence,
    date: "1174.1.1", totalDays: normalizeGameDate("1174.1.1").serial, finalizationVisibilityV1: true });
  const system = prompt.filter(entry => entry.role === "system").map(entry => entry.content).join("\n");
  assert(system.includes("every substantive presence period"), "one summary request asks for matters from every presence period");
  assert(system.includes("including periods after a participant joins or returns"), "the prompt explicitly covers late joins and returns");
  assert(system.includes("exact source messageIds"), "each matter is required to retain exact source IDs");
  assert(system.includes("If a period has no supported important matter, do not invent one"), "the extractor is told not to fill empty periods with invented facts");
}

async function testPairIndexTwoLevelRecallAndScale() {
  const engine = makeFixture("pair-index-scale");
  const goldenTerms = new Map([
    [12, "鹤纹铜印"], [24, "紫檀古琴"], [39, "银丝礼冠"], [51, "青玉长笛"],
    [66, "琉璃宝镜"], [91, "白玉诏册"], [117, "金丝屏风"], [138, "鎏金酒盏"]
  ]);
  const summaries = Array.from({ length: 150 }, (_, index) => {
    const year = 1050 + index;
    const matters = index === 73
      ? ["赵子绅将东方长命锁赠给保罗。", "保罗答应替赵子绅保管长命锁。",
        "东方长命锁的来历由赵子绅亲口说明。", "赵子绅同意把长命锁礼盒留在保罗处。",
        "保罗答应日后将长命锁归还赵子绅。"]
      : [`保罗于${year}年登记第${index}份礼单。`, `礼单第${index}项由赵子绅核对。`,
        `第${index}项安排仍以原文记载为准。`, `第${index}份文书留在王宫档案室。`,
        `${goldenTerms.get(index) || `边境文书${index}`}由保罗收存。`];
    return legacySummary(2, 1, { finalizationId: `scale-${index}`, date: `${year}.1.1`, matters,
      narrative: `QA_SCALE_SOURCE_${index}：${year}年的完整对话叙事，包含人物反应与事件经过。` });
  });
  writePairSummaries(engine, 2, 1, summaries);
  const scope = { campaignToken, ownerId: 2, counterpartId: 1 };
  const memories = engine.store.loadFolderSummariesForCharacter(2);
  const lookupStarted = performance.now();
  const index = engine.store.pairLedger.read(scope, { currentGameDate, currentTotalDays: normalizeGameDate(currentGameDate).serial,
    memories, readOnly: true });
  const indexBuildMs = performance.now() - lookupStarted;
  assert.equal(index.items.length, 750, "150 source summaries produce 750 searchable matter rows");
  assert.equal(index.diagnostics.scannedSummaryCount, 150, "first index build reads exactly the scoped source set");

  const golden = [["长命锁", 73], ...[...goldenTerms].map(([sourceIndex, term]) => [term, sourceIndex])];
  const indexSearchLatencies = [];
  const legacyRankerLatencies = [];
  let totalCandidates = 0;
  let maxCandidates = 0;
  let indexRecallAt1 = 0, indexRecallAt3 = 0;
  let legacyRecallAt1 = 0, legacyRecallAt3 = 0;
  const ranker = new MemoryRanker();
  const currentTotalDays = normalizeGameDate(currentGameDate).serial;
  engine.store.pairLedger.get(scope, { currentGameDate, currentTotalDays, search: golden[0][0], pageSize: 50 });
  ranker.rank(memories, { query: golden[0][0], participantIds: [1], currentTotalDays });
  for (const [query, sourceIndex] of golden) {
    const indexedStarted = performance.now();
    const found = engine.store.pairLedger.get(scope, { currentGameDate, currentTotalDays,
      search: query, pageSize: 50 });
    indexSearchLatencies.push(performance.now() - indexedStarted);
    totalCandidates += found.totalCount;
    maxCandidates = Math.max(maxCandidates, found.totalCount);
    const expectedFinalizationId = `scale-${sourceIndex}`;
    const indexIds = found.items.map(item => item.source.finalizationId);
    assert(indexIds.slice(0, 10).includes(expectedFinalizationId), `Chinese n-gram index retrieves the golden source in its top 10 for ${query}`);
    if (indexIds.slice(0, 1).includes(expectedFinalizationId)) indexRecallAt1++;
    if (indexIds.slice(0, 3).includes(expectedFinalizationId)) indexRecallAt3++;

    const legacyStarted = performance.now();
    const legacyRanked = ranker.rank(memories, { query, participantIds: [1], currentTotalDays });
    legacyRankerLatencies.push(performance.now() - legacyStarted);
    const legacyIds = legacyRanked.map(entry => entry.memory.provenance.finalizationId);
    if (legacyIds.slice(0, 1).includes(expectedFinalizationId)) legacyRecallAt1++;
    if (legacyIds.slice(0, 3).includes(expectedFinalizationId)) legacyRecallAt3++;
  }

  const lockMatches = engine.store.pairLedger.get(scope, { currentGameDate, search: "长命锁", pageSize: 50 });
  assert.equal(lockMatches.totalCount, 5, "five same-source matter hits remain separately searchable");
  const details = retrievePairMemorySources({ store: engine.store, ownerId: 2, counterpartIds: [1],
    query: "你还记得当年长命锁如何送给我吗？", campaignToken, currentGameDate,
    currentTotalDays: normalizeGameDate(currentGameDate).serial, memories, tokenBudget: 50000, estimateTokens: tokenCount });
  assert.equal(details.metrics.indexHitCount, 5, "the first tier returns the five matching ledger items");
  assert.equal(details.metrics.candidateSummaryCount, 1, "five ledger items from one source deduplicate to one source candidate");
  assert.equal(details.metrics.openedSummaryCount, 1, "the second tier opens the shared source exactly once");
  assert.equal(details.sources.length, 1);
  assert(details.sources[0].memory.content.includes("QA_SCALE_SOURCE_73"), "source recall returns the matching full Legacy narrative");
  assert(details.text.includes("长命锁归还赵子绅"), "the opened source retains its original important-matters section");
  assert(details.metrics.finalInjectedTokens <= 50000, "the two-level package honors its explicit source-recall budget");

  const performanceEvidence = {
    schemaVersion: 1,
    synthetic: true,
    measurementMethod: "warm-cache per-query timings; P95 uses nearest-rank; no latency threshold",
    workload: { legacySourceCount: summaries.length, importantMatterItemCount: index.items.length, goldenQueryCount: golden.length },
    pairIndex: {
      indexBuildMs: Number(indexBuildMs.toFixed(2)),
      searchP50Ms: percentile(indexSearchLatencies, 0.5),
      searchP95Ms: percentile(indexSearchLatencies, 0.95),
      recallAt1: { hits: indexRecallAt1, total: golden.length },
      recallAt3: { hits: indexRecallAt3, total: golden.length },
      averageCandidateCount: Number((totalCandidates / golden.length).toFixed(2)),
      maxCandidateCount: maxCandidates,
      sameSourceFiveMatterOpenCount: details.metrics.openedSummaryCount,
      sourceRecallInjectedTokens: details.metrics.finalInjectedTokens
    },
    legacyRanker: {
      rankedSourceCount: memories.length,
      queryP50Ms: percentile(legacyRankerLatencies, 0.5),
      queryP95Ms: percentile(legacyRankerLatencies, 0.95),
      recallAt1: { hits: legacyRecallAt1, total: golden.length },
      recallAt3: { hits: legacyRecallAt3, total: golden.length }
    }
  };
  const evidencePath = path.resolve(__dirname, "..", ".build", "v935-performance-evidence.json");
  fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
  fs.writeFileSync(evidencePath, `${JSON.stringify(performanceEvidence, null, 2)}\n`, "utf8");
  console.log(`PAIR_GOLDEN: sources=${summaries.length}; items=${index.items.length}; index Recall@1=${indexRecallAt1}/${golden.length}, @3=${indexRecallAt3}/${golden.length}, P95=${performanceEvidence.pairIndex.searchP95Ms}ms; LegacyRanker Recall@1=${legacyRecallAt1}/${golden.length}, @3=${legacyRecallAt3}/${golden.length}, P95=${performanceEvidence.legacyRanker.queryP95Ms}ms; avgCandidates=${performanceEvidence.pairIndex.averageCandidateCount}; maxCandidates=${maxCandidates}; evidence=${path.relative(path.resolve(__dirname, ".."), evidencePath)}`);
}

async function testPairSourceIdentityScopeAndStaleFailClosed() {
  const engine = makeFixture("pair-source-identity");
  const sameDay = [
    legacySummary(2, 1, { finalizationId: "same-day-a", date: "1090.2.1", matters: ["赵子绅将长命锁放进蓝丝绒盒。"],
      narrative: "QA_SAME_DAY_A：宴席上赵子绅展示蓝丝绒盒中的长命锁。" }),
    legacySummary(2, 1, { finalizationId: "same-day-b", date: "1090.2.1", matters: ["保罗把另一枚长命锁交给赵子绅。"],
      narrative: "QA_SAME_DAY_B：另一场会谈中保罗交还的是不同长命锁。" })
  ];
  writePairSummaries(engine, 2, 1, sameDay);
  const identicalMatter = "保罗与赵子绅共同确认一份旧约定。";
  const reverseOwner = legacySummary(1, 2, { finalizationId: "same-text-finalization", date: "1091.1.1",
    matters: [identicalMatter], narrative: "同一段文字，但属于赵子绅自己的视角。" });
  const ownerView = legacySummary(2, 1, { finalizationId: "same-text-finalization", date: "1091.1.1",
    matters: [identicalMatter], narrative: "同一段文字，但属于保罗自己的视角。" });
  writePairSummaries(engine, 2, 1, [...sameDay, ownerView]);
  writePairSummaries(engine, 1, 2, [reverseOwner]);

  const dayScope = { campaignToken, ownerId: 2, counterpartId: 1 };
  const sameDayItems = engine.store.pairLedger.get(dayScope, { currentGameDate }).items
    .filter(item => ["same-day-a", "same-day-b"].includes(item.source.finalizationId));
  assert.equal(sameDayItems.length, 2, "same-date conversations remain separate index records");
  const [first, second] = sameDayItems.map(item => item.source);
  assert.notEqual(first.sourceSummaryKey, second.sourceSummaryKey, "same-day sessions have distinct stable source keys");
  assert.notEqual(first.sourceRevision, second.sourceRevision);
  for (const pointer of [first, second]) {
    const resolved = engine.store.pairLedger.resolveSource(dayScope, pointer, { currentGameDate });
    assert.equal(resolved.summary.finalizationId, pointer.finalizationId, "the exact pointer resolves its own same-day source");
  }
  assert.throws(() => engine.store.pairLedger.resolveSource(dayScope,
    { ...first, sourceRevision: second.sourceRevision }, { currentGameDate }), /SOURCE_UNAVAILABLE_OR_STALE/,
  "a valid-looking key paired with another source revision fails closed");

  const owner2 = engine.store.pairLedger.get(dayScope, { currentGameDate, search: identicalMatter }).items
    .find(item => item.source.finalizationId === "same-text-finalization");
  const owner1 = engine.store.pairLedger.get({ campaignToken, ownerId: 1, counterpartId: 2 }, {
    currentGameDate, search: identicalMatter
  }).items.find(item => item.source.finalizationId === "same-text-finalization");
  assert(owner2 && owner1, "both owner-directed sources exist independently");
  assert.notEqual(owner2.source.sourceSummaryKey, owner1.source.sourceSummaryKey, "owner direction is included in source identity");
  assert.equal(engine.store.pairLedger.resolveSource(dayScope, owner2.source, { currentGameDate }).summary.perspectiveOwnerId, 2);
  assert.equal(engine.store.pairLedger.resolveSource({ campaignToken, ownerId: 1, counterpartId: 2 }, owner1.source,
    { currentGameDate }).summary.perspectiveOwnerId, 1);
  assert.throws(() => engine.store.pairLedger.resolveSource(dayScope, owner1.source, { currentGameDate }),
    /SOURCE_UNAVAILABLE_OR_STALE/, "the reverse-direction pointer cannot resolve through the first owner's scope");

  const staleQuery = retrievePairMemorySources({ store: engine.store, ownerId: 2, counterpartIds: [1],
    query: "你还记得当年蓝丝绒盒吗？", campaignToken, currentGameDate,
    currentTotalDays: normalizeGameDate(currentGameDate).serial, memories: engine.store.loadFolderSummariesForCharacter(2),
    tokenBudget: 10000, estimateTokens: tokenCount });
  assert.equal(staleQuery.metrics.openedSummaryCount, 1, "the unique same-day match opens only its specific source");
  assert(staleQuery.sources.some(source => source.memory.content.includes("QA_SAME_DAY_A")));
  assert(!staleQuery.sources.some(source => source.memory.content.includes("QA_SAME_DAY_B")),
    "a source with only the generic object term cannot displace the uniquely matched same-day source");

  const forgetTarget = sameDay[0];
  engine.store.recordForgottenSummaryProjection(forgetTarget, { ownerId: 2, counterpartId: 1 });
  assert.equal(engine.store.pairLedger.get(dayScope, { currentGameDate }).items.some(item => item.source.finalizationId === "same-day-a"), false,
    "Forget removes cached index items on the next read");
}

async function testPairIndexMissKeepsLegacyFallbackAndRejectsStaleCache() {
  const engine = makeFixture("pair-legacy-fallback");
  const legacy = legacySummary(2, 1, { finalizationId: "no-matters-heading", date: "1198.1.1",
    narrative: "QA_NON_MATTER_DETAIL_A：晚宴房间里放着一面紫檀屏风，窗边有三把椅子。", matters: [] });
  legacy.content = "QA_NON_MATTER_DETAIL_A：晚宴房间里放着一面紫檀屏风，窗边有三把椅子。\n\n【其他事项】\n旧摘要没有标准长期事项段落。";
  writePairSummaries(engine, 2, 1, [legacy]);
  const memories = engine.store.loadFolderSummariesForCharacter(2);
  const legacyRelativePath = "2_乙/与甲的对话.json";
  const getLegacyFileSignature = engine.store.getSummarySourceFileSignature.bind(engine.store);
  const unchangedLegacySignature = getLegacyFileSignature(legacyRelativePath);
  engine.store.getSummarySourceFileSignature = relative => relative === legacyRelativePath
    ? unchangedLegacySignature : getLegacyFileSignature(relative);
  const args = { store: engine.store, ownerId: 2, counterpartIds: [1], query: "房间里有什么紫檀屏风？", campaignToken,
    currentGameDate, currentTotalDays: normalizeGameDate(currentGameDate).serial, memories, tokenBudget: 4000, estimateTokens: tokenCount };
  const miss = retrievePairMemorySources(args);
  assert.equal(miss.metrics.fallbackReason, "INDEX_MISS");
  assert.equal(miss.metrics.legacyFallbackUsed, true);
  const legacySessionRecallCache = new Map();
  const legacyRecall = engine.retrieveForResponder({ characterId: 2, directCounterpartIds: [1], activeParticipantIds: [1, 2],
    query: args.query, campaignToken, currentGameDate, currentTotalDays: args.currentTotalDays,
    conversationId: "qa-legacy-index-miss", sceneRevision: "scene-a", turnEpoch: 1, tokenBudget: 4000,
    estimateTokens: tokenCount, sessionRecallCache: legacySessionRecallCache });
  assert(legacyRecall.directStableText.includes("QA_NON_MATTER_DETAIL_A"),
    "an index miss still leaves the original recent Legacy narrative available");
  const legacyRows = JSON.parse(fs.readFileSync(path.join(engine.store.summaryFoldersDir, legacyRelativePath), "utf8"));
  legacyRows[0].content = legacyRows[0].content.replace("QA_NON_MATTER_DETAIL_A", "QA_NON_MATTER_DETAIL_B");
  fs.writeFileSync(path.join(engine.store.summaryFoldersDir, legacyRelativePath), JSON.stringify(legacyRows, null, 2), "utf8");
  assert.deepEqual(engine.store.getSummarySourceFileSignature(legacyRelativePath), unchangedLegacySignature,
    "the legacy-cache fixture holds the complete stat signature constant while source bytes change");
  const refreshedLegacyRecall = engine.retrieveForResponder({ characterId: 2, directCounterpartIds: [1], activeParticipantIds: [1, 2],
    query: args.query, campaignToken, currentGameDate, currentTotalDays: args.currentTotalDays,
    conversationId: "qa-legacy-index-miss", sceneRevision: "scene-a", turnEpoch: 1, tokenBudget: 4000,
    estimateTokens: tokenCount, sessionRecallCache: legacySessionRecallCache });
  assert(refreshedLegacyRecall.directStableText.includes("QA_NON_MATTER_DETAIL_B"),
    "Legacy fallback reloads changed source bytes even with an unchanged full stat signature");
  assert(!refreshedLegacyRecall.directStableText.includes("QA_NON_MATTER_DETAIL_A"),
    "the stale Legacy fallback narrative is not reused after a same-stat edit");

  const hasMatter = legacySummary(2, 1, { finalizationId: "stale-source", date: "1197.1.1",
    matters: ["QA_STALE_INDEX_MATTER：赵子绅将一枚长命锁交给保罗。"], narrative: "QA_STALE_SOURCE_DETAIL" });
  const staleEngine = makeFixture("pair-stale-index");
  writePairSummaries(staleEngine, 2, 1, [hasMatter]);
  const staleMemories = staleEngine.store.loadFolderSummariesForCharacter(2);
  const resolveSource = staleEngine.store.pairLedger.resolveSource.bind(staleEngine.store.pairLedger);
  staleEngine.store.pairLedger.resolveSource = () => { throw new Error("SOURCE_UNAVAILABLE_OR_STALE"); };
  const stale = retrievePairMemorySources({ ...args, store: staleEngine.store, memories: staleMemories,
    query: "你还记得当年长命锁的经过吗？" });
  staleEngine.store.pairLedger.resolveSource = resolveSource;
  assert.equal(stale.metrics.fallbackReason, "SOURCE_STALE");
  assert.equal(stale.metrics.openedSummaryCount, 0);
  assert.equal(stale.items.length, 0, "a failed key/revision validation cannot inject its cached matter text");
  assert(!stale.text.includes("QA_STALE_INDEX_MATTER"));

  const raceEngine = makeFixture("pair-revision-race");
  const raceSummary = legacySummary(2, 1, { finalizationId: "race-source", date: "1196.1.1",
    matters: ["QA_RACE_MATTER：赵子绅把长命锁留给保罗。"], narrative: "QA_RACE_SOURCE_A" });
  const raceFile = writePairSummaries(raceEngine, 2, 1, [raceSummary]);
  const raceMemories = raceEngine.store.loadFolderSummariesForCharacter(2);
  const raceRelativePath = "2_乙/与甲的对话.json";
  const getRaceFileSignature = raceEngine.store.getSummarySourceFileSignature.bind(raceEngine.store);
  const unchangedRaceSignature = getRaceFileSignature(raceRelativePath);
  raceEngine.store.getSummarySourceFileSignature = relative => relative === raceRelativePath
    ? unchangedRaceSignature : getRaceFileSignature(relative);
  const exactResolve = raceEngine.store.pairLedger.resolveSource.bind(raceEngine.store.pairLedger);
  let editedAfterResolve = false;
  raceEngine.store.pairLedger.resolveSource = (...resolveArgs) => {
    const resolved = exactResolve(...resolveArgs);
    if (!editedAfterResolve) {
      const rows = JSON.parse(fs.readFileSync(raceFile, "utf8"));
      rows[0].content = rows[0].content.replace("QA_RACE_SOURCE_A", "QA_RACE_SOURCE_B");
      fs.writeFileSync(raceFile, JSON.stringify(rows, null, 2), "utf8");
      assert.deepEqual(raceEngine.store.getSummarySourceFileSignature(raceRelativePath), unchangedRaceSignature,
        "the resolver-race fixture holds the complete stat signature constant while source bytes change");
      editedAfterResolve = true;
    }
    return resolved;
  };
  const race = retrievePairMemorySources({ store: raceEngine.store, ownerId: 2, counterpartIds: [1],
    query: "你还记得当年长命锁经过吗？", campaignToken, currentGameDate,
    currentTotalDays: normalizeGameDate(currentGameDate).serial, memories: raceMemories, tokenBudget: 10000, estimateTokens: tokenCount });
  assert.equal(editedAfterResolve, true, "the source changes after pointer resolution but before final snapshot verification");
  assert.equal(race.metrics.fallbackReason, "SOURCE_STALE");
  assert.equal(race.sources.length, 0, "the final revision check discards the resolved source before returning it");
  assert.equal(race.items.length, 0, "a revision race discards both the resolved text and its cached index matter");
  assert.equal(race.text, "");
}

function testActivePairDirectionRouting() {
  const aSpeaksToB = resolveActiveMemoryPairs({ ownerId: 2, activeParticipantIds: [1, 2, 3], playerId: 1,
    currentPlayerMessageId: "player-turn-1", turnEpoch: 1,
    history: [{ id: "player-turn-1", role: "user", speakerCharacterId: 1, addresseeId: 2, content: "QA_A_TO_B: 你记得长命锁吗？" }] });
  assert.deepEqual(aSpeaksToB.counterpartIds, [1], "the fixed counterpart is the trusted player anchor");
  assert.equal(aSpeaksToB.querySpeakerId, 1);
  assert.equal(aSpeaksToB.trustedPlayerTurn.messageId, "player-turn-1");
  const afterNpcReply = resolveActiveMemoryPairs({ ownerId: 2, activeParticipantIds: [1, 2, 3], playerId: 1,
    currentPlayerMessageId: "player-turn-2", turnEpoch: 2,
    history: [
      { id: "player-turn-2", role: "user", speakerCharacterId: 1, addresseeId: 2, content: "QA_PLAYER_QUERY: 你还记得丙吗？" },
      { id: "npc-b-reply", role: "assistant", speakerCharacterId: 2, content: "QA_B_REPLY: 我记得。" },
      { id: "npc-c-reply", role: "assistant", speakerCharacterId: 3, content: "QA_C_REPLY: 我也在这里。" }
    ] });
  assert.deepEqual(afterNpcReply.counterpartIds, [1], "later NPC replies in the same player turn do not move the fixed anchor");
  assert.equal(afterNpcReply.querySpeakerId, 3, "query speaker remains the latest real speaker");
  assert.equal(afterNpcReply.query, "QA_C_REPLY: 我也在这里。");
  assert.equal(afterNpcReply.trustedPlayerTurn.content, "QA_PLAYER_QUERY: 你还记得丙吗？",
    "NPC text does not replace or upgrade the trusted player request");
  const stalePlayerTurn = resolveActiveMemoryPairs({ ownerId: 2, activeParticipantIds: [1, 2, 3], playerId: 1,
    currentPlayerMessageId: "old-player-turn", turnEpoch: 3,
    history: [
      { id: "old-player-turn", role: "user", speakerCharacterId: 1, content: "旧轮玩家消息。" },
      { id: "new-player-turn", role: "user", speakerCharacterId: 1, content: "当前玩家消息。" },
      { id: "npc-c-reply", role: "assistant", speakerCharacterId: 3, content: "NPC 最近发言。" }
    ] });
  assert.deepEqual(stalePlayerTurn.counterpartIds, [1], "the trusted player remains the fixed anchor");
  assert.equal(stalePlayerTurn.querySpeakerId, 3);
  assert.equal(stalePlayerTurn.trustedPlayerTurn, null, "a stale message ID cannot continue prior player authorization");
}
async function testRecentOnePairSwitchStablePrefixAndVisibleBudget() {
  const engine = makeFixture("pair-recent-one");
  const aRows = [
    legacySummary(2, 1, { finalizationId: "ab-oldest", date: "1196.1.1", matters: [], narrative: "QA_AB_OLDER_1" }),
    legacySummary(2, 1, { finalizationId: "ab-middle", date: "1197.1.1", matters: [], narrative: "QA_AB_OLDER_2" }),
    legacySummary(2, 1, { finalizationId: "ab-recent", date: "1198.1.1", matters: [], narrative: "QA_AB_RECENT_1" })
  ];
  const cRows = [legacySummary(2, 3, { finalizationId: "bc-recent", date: "1199.1.1", matters: [], narrative: "QA_BC_RECENT" })];
  writePairSummaries(engine, 2, 1, aRows);
  writePairSummaries(engine, 2, 3, cRows);
  const stable = createMemoryRecord({ memoryId: "qa-v935-stable-prefix", type: "belief", content: "QA_STABLE_PREFIX_UNCHANGED",
    canonicalText: "QA_STABLE_PREFIX_UNCHANGED", importance: 1, confidence: 1, source: "spoken", visibility: "private",
    participants: [2], knownBy: [2], provenance: { campaignToken, campaignBinding: { status: "bound", source: "qa", version: 1 } } });
  engine.store.saveMemory(stable);
  engine.store.markKnownBy(2, stable.memoryId, { awareness: "witnessed" });
  const cache = new Map();
  const request = { characterId: 2, query: "今日的天气如何？", activeParticipantIds: [1, 2], campaignToken,
    currentGameDate, currentTotalDays: normalizeGameDate(currentGameDate).serial, conversationId: "qa-pair-switch",
    sceneRevision: "scene-a", turnEpoch: 1, memoryEngine3Enabled: true, tokenBudget: 1000,
    estimateTokens: tokenCount, sessionRecallCache: cache };
  const first = engine.retrieveForResponder({ ...request, directCounterpartIds: [1] });
  assert.equal(first.direct.length, 1, "the frozen direct baseline contains Recent1 only");
  assert(first.directStableText.includes("QA_AB_RECENT_1"));
  assert(!first.directStableText.includes("QA_AB_OLDER_"), "older A→B summaries do not fill a Recent2 baseline");
  assert(first.stableText.includes("QA_STABLE_PREFIX_UNCHANGED"));
  const recentC = engine.store.loadFolderSummariesForCharacter(2).find(memory => memory.provenance.finalizationId === "bc-recent");
  assert(recentC, "the alternate pair is present in the same owner's folder snapshot");
  cache.get(2).seenDynamicSummaries.add(engine.getRouteMemoryKey(recentC));
  const second = engine.retrieveForResponder({ ...request, directCounterpartIds: [3], activeParticipantIds: [2, 3], turnEpoch: 2 });
  assert.equal(second.direct.length, 1, "pair switching retains the session's frozen direct prefix");
  assert(second.directStableText.includes("QA_AB_RECENT_1"));
  assert(second.stableText.includes("QA_STABLE_PREFIX_UNCHANGED"), "switching counterpart does not clear the stable prefix");
  assert(second.temporalExtraText.includes("QA_BC_RECENT"), "the newly active counterpart's Recent1 package remains available despite the seen set");
  assert(second.pairMemoryMetrics.finalInjectedTokens <= second.tokenBudget);

  const visibleTokens = injectedTextTokens(second);
  console.log(`PAIR_BUDGET: selectedTokens=${second.selectedTokens}; visibleBlockTokens=${visibleTokens}; tokenBudget=${second.tokenBudget}`);
  assert(visibleTokens <= second.tokenBudget,
    `formatted stable/direct/temporal prompt blocks must fit the shared budget (${visibleTokens} > ${second.tokenBudget})`);
}

async function testTemporalEntityIndependentCapsAndSharedVisibleBudget() {
  const engine = makeFixture("pair-channel-budget");
  const eventRef = index => ({ kind: "event_time", precision: "year", fromGameDate: "1170.1.1", toGameDate: "1170.12.31",
    targetGameYear: 1170, expression: "1170年", messageIds: [index + 1], segmentIds: [`segment-${index}`],
    source: "deterministic_message_parse", timeRole: "event" });
  const directRows = Array.from({ length: 4 }, (_, index) => legacySummary(2, 1, {
    finalizationId: `temporal-${index}`, date: `${1166 + index}.1.1`, matters: [],
    narrative: `QA_TEMPORAL_${index}：保罗与甲讨论1170年发生的战争。`,
    extra: { temporalRefs: [eventRef(index)] }
  }));
  const entityRows = Array.from({ length: 4 }, (_, index) => legacySummary(2, 3, {
    finalizationId: `entity-${index}`, date: `${1167 + index}.6.1`, matters: [],
    narrative: `QA_ENTITY_${index}：丙在边境事件${index}中留下记录。`
  }));
  writePairSummaries(engine, 2, 1, directRows);
  writePairSummaries(engine, 2, 3, entityRows);
  const result = engine.retrieveForResponder({ characterId: 2, query: "1170年发生了哪场战争？", directCounterpartIds: [1],
    activeParticipantIds: [1, 2], explicitTargetEntityIds: [3], querySpeakerId: 1,
    entityProfiles: [{ id: 2, shortName: "乙" }, { id: 1, shortName: "甲" }, { id: 3, shortName: "丙", fullName: "丙" }],
    campaignToken, currentGameDate: "1175.1.1", currentTotalDays: normalizeGameDate("1175.1.1").serial,
    conversationId: "qa-channel-caps", sceneRevision: "scene-a", turnEpoch: 1, memoryEngine3Enabled: true,
    temporalSummaryRecallEnabled: true, tokenBudget: 1600, estimateTokens: tokenCount, sessionRecallCache: new Map() });
  const temporalCount = result.extra.filter(entry => entry.reason?.source === "temporal").length;
  const entityCount = result.extra.filter(entry => entry.routeKind === "entity_target").length;
  assert.equal(temporalCount, 3, "the temporal channel independently selects its three-summary cap");
  assert.equal(entityCount, 3, "the entity channel independently selects its three-summary cap");
  assert(result.extra.length <= 6, "the combined temporal and entity channels never exceed six summaries");
  assert(result.extra.every(entry => entry.tokens <= 1600));
  const visibleTokens = injectedTextTokens(result);
  console.log(`CHANNEL_BUDGET: temporal=${temporalCount}; entity=${entityCount}; total=${result.extra.length}; selectedTokens=${result.selectedTokens}; visibleBlockTokens=${visibleTokens}; tokenBudget=${result.tokenBudget}`);
  assert(visibleTokens <= result.tokenBudget,
    `formatted shared prompt blocks must fit after both channels select candidates (${visibleTokens} > ${result.tokenBudget})`);

  const tightEngine = makeFixture("pair-tight-visible-budget");
  const tightDirectRows = Array.from({ length: 4 }, (_, index) => legacySummary(2, 1, {
    finalizationId: `tight-temporal-${index}`, date: `${1166 + index}.1.1`, matters: [],
    narrative: `QA_TIGHT_TEMPORAL_${index}：${"乙丙丁戊己庚辛".repeat(index === 3 ? 180 : 22)}`,
    extra: { temporalRefs: [eventRef(index)] }
  }));
  const tightEntityRows = Array.from({ length: 4 }, (_, index) => legacySummary(2, 3, {
    finalizationId: `tight-entity-${index}`, date: `${1167 + index}.6.1`, matters: [],
    narrative: `QA_TIGHT_ENTITY_${index}：${"丙丁戊己庚辛乙".repeat(22)}`
  }));
  writePairSummaries(tightEngine, 2, 1, tightDirectRows);
  writePairSummaries(tightEngine, 2, 3, tightEntityRows);
  const tight = tightEngine.retrieveForResponder({ characterId: 2, query: "1170年发生了哪场战争？", directCounterpartIds: [1],
    activeParticipantIds: [1, 2], explicitTargetEntityIds: [3], querySpeakerId: 1,
    entityProfiles: [{ id: 2, shortName: "乙" }, { id: 1, shortName: "甲" }, { id: 3, shortName: "丙", fullName: "丙" }],
    campaignToken, currentGameDate: "1175.1.1", currentTotalDays: normalizeGameDate("1175.1.1").serial,
    conversationId: "qa-channel-tight", sceneRevision: "scene-a", turnEpoch: 1, memoryEngine3Enabled: true,
    temporalSummaryRecallEnabled: true, tokenBudget: 1100, estimateTokens: tokenCount, sessionRecallCache: new Map() });
  const tightVisibleTokens = injectedTextTokens(tight);
  console.log(`CHANNEL_BUDGET_TIGHT: temporal=${tight.extra.filter(entry => entry.reason?.source === "temporal").length}; entity=${tight.extra.filter(entry => entry.routeKind === "entity_target").length}; selectedTokens=${tight.selectedTokens}; visibleBlockTokens=${tightVisibleTokens}; tokenBudget=${tight.tokenBudget}`);
  assert(tightVisibleTokens <= tight.tokenBudget,
    `dense Recent1 plus both recall channels must fit after formatting (${tightVisibleTokens} > ${tight.tokenBudget})`);
}

async function main() {
  await check("MemoryEngine late-join, whisper, mixed-visibility, and absence boundaries", testFinalizationAndLateJoinBoundaries);
  await check("single-pass extractor prompt covers each presence period", testPromptRequiresPerPresencePeriodMatters);
  await check("Pair Index → exact Legacy Source Recall and 150-summary/750-item Chinese n-gram golden set", testPairIndexTwoLevelRecallAndScale);
  await check("same-day source identity, owner direction, revision, Forget, and stale fail-closed", testPairSourceIdentityScopeAndStaleFailClosed);
  await check("index miss retains Legacy narrative fallback and stale index text is rejected", testPairIndexMissKeepsLegacyFallbackAndRejectsStaleCache);
  await check("fixed player anchor is independent of the latest authorized speaker", testActivePairDirectionRouting);
  await check("Recent1, stable prefix, active-pair switch, and visible token budget", testRecentOnePairSwitchStablePrefixAndVisibleBudget);
  await check("temporal and entity channels each select three within shared visible budget", testTemporalEntityIndependentCapsAndSharedVisibleBudget);
  console.log(`V9.3.5 independent QA: ${passed} PASS, ${failed} FAIL`);
  if (failed) process.exitCode = 1;
}

main().catch(error => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
}).finally(() => {
  assert(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep));
  fs.rmSync(root, { recursive: true, force: true });
});
