"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const { MemoryEngine } = require(path.join(root, "resources/app/out/main/memory-system"));
const { normalizeGameDate } = require(path.join(root, "resources/app/out/main/worldline/character-temporal-facts"));
const { resolveTemporalWindow } = require(path.join(root, "resources/app/out/main/memory-system/fuzzy-temporal-resolver"));
const { buildSummaryDateIndex, selectTemporalExtras } = require(path.join(root, "resources/app/out/main/memory-system/summary-date-index"));
const { parseGameState } = require(path.join(root, "resources/app/out/main/worldline/game-state-adapter"));
const { compileOfficialRecollection } = require(path.join(root, "resources/app/out/main/memory-system/official-recollection-provider"));
const { selectRange, MAX_RANGE_NODES } = require(path.join(root, "resources/app/out/main/worldline/historical-retriever"));

assert.match(fs.readFileSync(path.join(root, "resources/app/out/main/memory-system/memory-engine.js"), "utf8"), /SUMMARY_CHUNK_HARD_LIMIT = 64/);
assert.equal((fs.readFileSync(path.join(root, "resources/app/out/main/prompts/prompt-builder.js"), "utf8").match(/baseContext\.memoryContext\?\.engineVersion\?\.startsWith\(prefix\)/g) || []).length, 2,
  "both prompt paths must suppress legacy past_summaries for Memory Engine 3.0");

const currentGameDate = "1152.1.1";
const today = normalizeGameDate(currentGameDate).serial;
const record = (id, days, content = `摘要${id}`) => ({
  memoryId: id, type: "folder_summary", content, canonicalText: content, eventDate: null, totalDays: days,
  importance: 0.65, confidence: 1, participants: [1, 2], subjects: [1, 2], tags: [], status: null,
  provenance: { folderOwnerId: 2, counterpartId: 1, counterpartIds: [1], finalizationId: id }
});

const memories = [record("r1", today - 1), record("r2", today - 2), record("t1", today - 5 * 365), record("t2", today - 5 * 365 - 10), record("t3", today - 5 * 365 + 5), record("t4", today - 5 * 365 - 20)];
const window = resolveTemporalWindow("你还记得五年前的事吗？", { currentGameDate, currentTotalDays: today });
assert.equal(window.mode, "TARGET_DATE");
assert.equal(resolveTemporalWindow("最近怎样", { currentGameDate, currentTotalDays: today }).mode, "FUZZY_RECENCY");
assert.equal(resolveTemporalWindow("去年如何", { currentGameDate, currentTotalDays: today }).mode, "TARGET_DATE");
assert.equal(resolveTemporalWindow("1147年1月发生了什么", { currentGameDate, currentTotalDays: today }).mode, "TARGET_DATE");
assert.equal(resolveTemporalWindow("今天天气如何", { currentGameDate, currentTotalDays: today }).triggered, false);
const index = buildSummaryDateIndex(memories, { ownerId: 2, counterpartId: 1, currentGameDate, currentTotalDays: today });
assert.deepEqual(selectTemporalExtras(index, memories, window, ["r1", "r2"]).map((item) => item.memoryId), ["t1", "t3", "t2"]);
assert.equal(buildSummaryDateIndex([{ ...record("undated", null), eventDate: "1147.1.1" }], { ownerId: 2, counterpartId: 1, currentGameDate })[0].totalDays, null,
  "date fallback must not use a missing current totalDays as year zero");

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "votc-memory-30-"));
try {
  const engine = new MemoryEngine({ baseDir: path.join(temp, "memory"), trace: { record() {} } });
  const session = new Map();
  const input = { characterId: 2, directCounterpartIds: [1], ownerFolderMemories: memories,
    currentGameDate, currentTotalDays: today, tokenBudget: 800, estimateTokens: (value) => String(value).length, sessionRecallCache: session };
  const first = engine.retrieveForResponder({ ...input, query: "五年前" });
  assert.deepEqual(first.direct.map((entry) => entry.memory.memoryId), ["r1", "r2"]);
  assert.deepEqual(first.extra.map((entry) => entry.memory.memoryId), ["t1", "t3", "t2"]);
  const second = engine.retrieveForResponder({ ...input, query: "最近怎样" });
  assert.deepEqual(second.direct, first.direct);
  assert(second.extra.length <= 3);
  assert.equal(second.extra.some((entry) => ["r1", "r2"].includes(entry.memory.memoryId)), false);
  const rollback = engine.retrieveForResponder({ ...input, memoryEngine3Enabled: false, sessionRecallCache: new Map(), query: "五年前" });
  assert.equal(rollback.direct.length, 3);
  assert.equal(rollback.extra.length, 0);
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}

const gameState = `date=1152.1.1 living={ 1={ first_name="岳飞" alive_data={ memories={ 8 9 } } } 2={ first_name="赵构" alive_data={ memories={ 9 } } } } character_memory_manager={ database={ 8={ type=imprisoned participants={ imprisoner=2 } creation_date=1141.8.5 end_date=1271.8.5 } 9={ type=hanfan_zhiguan_xunguan_memory_1 creation_date=1140.11.25 end_date=1340.11.25 } 10={ type=became_friends creation_date=1140.1.1 end_date=1200.1.1 } } }`;
const snapshot = parseGameState(gameState);
assert.deepEqual(snapshot.officialMemoryDatabase["9"].holderCharacterIds, ["1", "2"]);
assert.equal(snapshot.officialMemoryDatabase["10"], undefined);
const owner1 = compileOfficialRecollection({ snapshot, ownerCharacterId: 1, tokenBudget: 800 });
const owner2 = compileOfficialRecollection({ snapshot, ownerCharacterId: 2, tokenBudget: 800 });
assert.equal(owner1.memoryCount, 2);
assert.match(owner1.renderedSummary, /被赵构囚禁/);
assert.equal(owner1.unresolved.length, 1);
assert.equal(owner2.renderedSummary, null);
assert.equal(compileOfficialRecollection({ snapshot, ownerCharacterId: 1, tokenBudget: 800,
  localize: () => ({ confidence: "CONFIRMED", localizedValue: "[ROOT.Char.GetName] 的旧事" }) }).unresolved.length, 1,
"dynamic CK3 localization must remain unresolved without parameter expansion");
assert.equal(compileOfficialRecollection({ snapshot, ownerCharacterId: 1, tokenBudget: 10 }).trimmedMemoryCount, 1);
const rangeNodes = Array.from({ length: 400 }, (_, index) => ({
  checkpointId: String(index), gameDate: `${index + 1}.1.1`, totalDays: normalizeGameDate(`${index + 1}.1.1`).serial,
  characterCount: index < 250 ? 1 : 2, titleCount: 1, warCount: 0
}));
const sampled = selectRange({ nodes: rangeNodes }, "1.1.1", "400.1.1", "400.1.1");
assert.equal(sampled.entries.length, MAX_RANGE_NODES);
assert.equal(sampled.entries[0].gameDate, "1.1.1");
assert.equal(sampled.entries.at(-1).gameDate, "400.1.1");
assert(sampled.entries.some((node) => node.gameDate === "251.1.1"));
console.log("V8.12 Memory Engine 3.0: PASS (Recent2, Extra3, temporal, owner-scoped official recollection)");
