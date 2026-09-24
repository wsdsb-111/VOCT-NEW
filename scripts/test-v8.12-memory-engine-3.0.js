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

const fiveYearStart = normalizeGameDate("1147.1.1").serial;
const memories = [record("r1", today - 1), record("r2", today - 2), record("t1", fiveYearStart), record("t2", fiveYearStart + 10), record("t3", fiveYearStart + 5), record("t4", fiveYearStart + 20)];
const window = resolveTemporalWindow("你还记得五年前的事吗？", { currentGameDate, currentTotalDays: today });
assert.equal(window.mode, "TARGET_DATE");
assert.equal(window.targetGameYear, 1147);
assert.deepEqual(window.primaryWindow, { fromTotalDays: fiveYearStart, toTotalDays: normalizeGameDate("1147.12.31").serial },
  "five years ago must mean the exact CK3 calendar year, not a floating 365-day offset");
assert.deepEqual(resolveTemporalWindow("五年前", { currentGameDate }).primaryWindow, window.primaryWindow,
  "the game date alone must be sufficient when totalDays is unavailable");
const pausedDay = normalizeGameDate("1162.5.19");
const pausedWindow = resolveTemporalWindow("五年前", { currentGameDate: pausedDay.canonical, currentTotalDays: 5000 });
assert.deepEqual(pausedWindow.primaryWindow, {
  fromTotalDays: 5000 + normalizeGameDate("1157.1.1").serial - pausedDay.serial,
  toTotalDays: 5000 + normalizeGameDate("1157.12.31").serial - pausedDay.serial
});
assert.equal(resolveTemporalWindow("五年前", { currentGameDate: "1160.2.29" }).targetGameYear, 1155,
  "a leap-day game date must still resolve the target CK3 calendar year");
assert.equal(resolveTemporalWindow("最近怎样", { currentGameDate, currentTotalDays: today }).mode, "FUZZY_RECENCY");
assert.equal(resolveTemporalWindow("去年如何", { currentGameDate, currentTotalDays: today }).mode, "TARGET_DATE");
assert.equal(resolveTemporalWindow("1147年1月发生了什么", { currentGameDate, currentTotalDays: today }).mode, "TARGET_DATE");
assert.equal(resolveTemporalWindow("今天天气如何", { currentGameDate, currentTotalDays: today }).triggered, false);
const index = buildSummaryDateIndex(memories, { ownerId: 2, counterpartId: 1, currentGameDate, currentTotalDays: today });
assert.deepEqual(selectTemporalExtras(index, memories, window, ["r1", "r2"]).map((item) => item.memoryId), ["t1", "t3", "t2"]);
const yearBoundary = [record("before", normalizeGameDate("1146.12.31").serial), record("after", normalizeGameDate("1148.1.1").serial)];
assert.deepEqual(selectTemporalExtras(buildSummaryDateIndex(yearBoundary, { ownerId: 2, counterpartId: 1, currentGameDate, currentTotalDays: today }), yearBoundary, window).map(item => item.memoryId), [],
  "the immediately adjacent CK3 years are not five years ago");
assert.equal(buildSummaryDateIndex([{ ...record("date-only", null), eventDate: "1147.1.1" }], { ownerId: 2, counterpartId: 1, currentGameDate })[0].totalDays, fiveYearStart,
  "a CK3-stamped summary must be searchable using the game date alone");
assert.equal(buildSummaryDateIndex([{ ...record("stale-days", today - 2 * 365), eventDate: "1147.1.1" }], { ownerId: 2, counterpartId: 1, currentGameDate, currentTotalDays: today })[0].totalDays, fiveYearStart,
  "the CK3 summary date must outrank inconsistent saved totalDays metadata");
assert.equal(buildSummaryDateIndex([record("unknown-date", today - 5 * 365)], { ownerId: 2, counterpartId: 1, currentGameDate })[0].totalDays, null,
  "a totalDays-only summary cannot be compared against calendar serials without today's game totalDays");

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "votc-memory-30-"));
try {
  const engine = new MemoryEngine({ baseDir: path.join(temp, "memory"), trace: { record() {} } });
  const session = new Map();
  const input = { characterId: 2, directCounterpartIds: [1], ownerFolderMemories: memories,
    currentGameDate, currentTotalDays: today, tokenBudget: 800, estimateTokens: (value) => String(value).length, sessionRecallCache: session };
  const first = engine.retrieveForResponder({ ...input, query: "五年前" });
  assert.deepEqual(first.direct.map((entry) => entry.memory.memoryId), ["r1", "r2"]);
  assert.deepEqual(first.extra.map((entry) => entry.memory.memoryId), ["t1", "t3", "t2"]);
  assert.match(first.temporalExtraText, /当前1152年1月1日；五年前对应1147年/);
  const dateStamped = [
    { ...record("recent-a", null), eventDate: "1152.1.1" },
    { ...record("recent-b", null), eventDate: "1151.12.31" },
    { ...record("five-year-game-date", null), eventDate: "1147.8.9" }
  ];
  const dateOnlyRecall = engine.retrieveForResponder({ ...input, ownerFolderMemories: dateStamped, currentTotalDays: null,
    sessionRecallCache: new Map(), query: "五年前" });
  assert.deepEqual(dateOnlyRecall.extra.map(entry => entry.memory.memoryId), ["five-year-game-date"],
    "the paused CK3 calendar date and each summary's saved CK3 date must suffice without model text or totalDays");
  assert.equal(resolveTemporalWindow("五年前", { currentGameDate: null, currentTotalDays: today }).triggered, false,
    "totalDays alone cannot invent the current CK3 calendar year");
  const nearButImportant = { ...record("wrong-era", today - 2 * 365, "五年前的事情曾被提起"), importance: 0.99 };
  const exactTime = engine.retrieveForResponder({ ...input, ownerFolderMemories: [memories[0], memories[1], memories[2], nearButImportant],
    sessionRecallCache: new Map(), query: "你还记得五年前的事情吗？" });
  assert.deepEqual(exactTime.extra.map((entry) => entry.memory.memoryId), ["t1"], "an explicit year must not fill spare Extra slots with a two-year-old summary");
  assert.match(exactTime.temporalExtraText, /五年前/);
  const noMatch = engine.retrieveForResponder({ ...input, ownerFolderMemories: [memories[0], memories[1], nearButImportant],
    sessionRecallCache: new Map(), query: "你还记得五年前的事情吗？" });
  assert.deepEqual(noMatch.extra, [], "an empty five-year window must not silently substitute a recent summary");
  assert.match(noMatch.temporalExtraText, /未检索到/);
  const fourYearsAgo = record("four-years-ago", today - 4 * 365 + 1);
  const closeYear = engine.retrieveForResponder({ ...input, ownerFolderMemories: [memories[0], memories[1], fourYearsAgo],
    sessionRecallCache: new Map(), query: "五年前" });
  assert.deepEqual(closeYear.extra, [], "a four-year-old summary is not a substitute for an explicit five-year request");
  const changedFolder = engine.retrieveForResponder({ ...input, ownerFolderMemories: [memories[0], memories[1], record("new-five-year-summary", today - 5 * 365)],
    sessionRecallCache: new Map(), query: "五年前" });
  assert.deepEqual(changedFolder.extra.map(entry => entry.memory.memoryId), ["new-five-year-summary"],
    "a refreshed folder at the same game date must not reuse an older date index");
  const mentionedFiveYearsAgo = { ...record("mentioned-five-years-ago", today - 5 * 365, "韩世忠当时告知的事"),
    participants: [2, 3], subjects: [3], provenance: { folderOwnerId: 2, counterpartId: 3, counterpartIds: [3] } };
  const mentionedTime = engine.retrieveForResponder({ ...input, ownerFolderMemories: [memories[0], memories[1], mentionedFiveYearsAgo],
    mentionedEntityIds: [3], mentionedEntityNames: { 3: ["韩世忠"] }, sessionRecallCache: new Map(), query: "五年前韩世忠的事" });
  assert.deepEqual(mentionedTime.extra.map(entry => entry.memory.memoryId), ["mentioned-five-years-ago"],
    "an exact-time question about a mentioned out-of-scene person must keep that person's owner-scoped summaries eligible");
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

const gameState = `date=1152.1.1 living={ 1={ first_name="岳飞" alive_data={ memories={ 8 9 } } } 2={ first_name="赵构" alive_data={ memories={ 9 } } } } character_memory_manager={ database={ 8={ type=imprisoned participants={ imprisoner=2 } creation_date=1141.8.5 end_date=1271.8.5 variables={ data={ { flag=childhood_memory data={ type=boolean identity=1 } } { flag=war_title data={ type=lt identity=14285 } } } } } 9={ type=hanfan_zhiguan_xunguan_memory_1 creation_date=1140.11.25 end_date=1340.11.25 } 10={ type=became_friends creation_date=1140.1.1 end_date=1200.1.1 } } }`;
const snapshot = parseGameState(gameState);
assert.deepEqual(snapshot.officialMemoryDatabase["9"].holderCharacterIds, ["1", "2"]);
assert.deepEqual(snapshot.officialMemoryDatabase["8"].variables, [
  { flag: "childhood_memory", type: "boolean", identity: "1", value: null },
  { flag: "war_title", type: "lt", identity: "14285", value: null }
]);
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

async function testNativeSummaryLifecycle() {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "votc-native-summary-"));
  const memorySystem = require(path.join(root, "resources/app/out/main/memory-system"));
  const { createGameData } = require(path.join(root, "resources/app/out/main/game-data/game-data"));
  const { createLogParser } = require(path.join(root, "resources/app/out/main/game-data/log-parser"));
  const { createSummariesManager } = require(path.join(root, "resources/app/out/main/summaries/summaries-manager"));
  const { estimateTokens } = require(path.join(root, "resources/app/out/main/token-estimator"));
  try {
    const summariesDir = path.join(sandbox, "summaries");
    const engine = new MemoryEngine({ baseDir: path.join(sandbox, "memory"), summaryFoldersDir: summariesDir, trace: { record() {} } });
    const GameData = createGameData({ fs, path, memorySystem, memoryEngine: engine, summariesDir, getHistoricalReferenceByYear: () => null });
    class Character {
      constructor(data) { this.id = Number(data[0]); this.shortName = data[1]; this.firstName = data[1]; this.memories = []; }
    }
    const log = path.join(sandbox, "debug.log");
    fs.writeFileSync(log, [
      "VOTC:IN/;/init/;/1/;/玩家/;/2/;/岳飞/;/1152年1月1日/;/talk_scene_court/;/开封/;/玩家/;/5000",
      "VOTC:CAMPAIGN/votc8c-123456789012", "VOTC:IN/;/character/;/1/;/玩家", "VOTC:IN/;/character/;/2/;/岳飞",
      "VOTC:IN/;/memory/;/2/;/任官/;/1151年1月1日/;/第一行诏书\n第二行诏书/;/20/;/4900",
      "VOTC:IN/;/memory/;/2/;/囚禁/;/1150年1月1日/;/\u0015ONCLICK:CHARACTER,2 \u0015TOOLTIP:CHARACTER,2 \u0015L; 岳飞\u0015!\u0015!\u0015!被\u0015ONCLICK:CHARACTER,4 \u0015TOOLTIP:CHARACTER,4 \u0015L 赵构\u0015!\u0015!\u0015!囚禁/;/5/;/4800",
      "VOTC:IN/;/memory/;/2/;/未来/;/1153年1月1日/;/不能提前知道/;/5/;/5100",
      "VOTC:IN/;/character/;/3/;/韩世忠", "VOTC:IN/;/memory/;/3/;/朋友/;/1151年1月1日/;/韩世忠的私人往事/;/5/;/4900"
    ].join("\n"));
    const data = await createLogParser({ GameData, Character })(log);
    data.syncOfficialRecollectionSummaries("session-a");
    const officialPath = path.join(data.getCharacterFolderPath(2, "岳飞"), "官方追忆摘要.json");
    const official = data.getOfficialRecollectionSummary(2, "session-a");
    assert.equal(official.memoryCount, 2);
    assert.match(official.content, /第一行诏书\n第二行诏书/);
    assert.match(official.content, /岳飞被赵构囚禁/, "linked CK3 names and the event's action must both survive log parsing");
    assert(!official.content.includes("ONCLICK:") && !official.content.includes("\u0015"));
    assert(!official.content.includes("不能提前知道"));
    assert(!official.content.includes("韩世忠的私人往事"));
    assert.equal(official.date, undefined);
    assert.equal(official.timestamp, undefined);
    assert.equal(data.getOfficialRecollectionSummary(2, "different-session"), null);
    assert.deepEqual(engine.loadOwnerFolderMemories(2), [], "official summaries must not enter cross-person or date routes");
    const session = new Map();
    const scopedMemories = memories.map(memory => ({ ...memory, provenance: { ...memory.provenance, campaignToken: data.campaignToken } }));
    const input = { characterId: 2, directCounterpartIds: [1], ownerFolderMemories: scopedMemories, officialSummary: official,
      currentGameDate, currentTotalDays: today, campaignToken: data.campaignToken, tokenBudget: 3600, estimateTokens, sessionRecallCache: session, turnEpoch: 1 };
    const first = engine.retrieveForResponder({ ...input, query: "五年前" });
    assert.equal(first.direct.length, 3);
    assert.equal(first.direct.filter(e => e.memory.subtype === "official_recollection").length, 1);
    assert(first.selectedTokens <= first.tokenBudget);
    assert.equal(first.mentionedSnapshotText, null);
    const rebuild = engine.retrieveForResponder({ ...input, query: "五年前" });
    assert.deepEqual(rebuild.extra, first.extra, "same-turn prompt rebuild must retain recall");
    const retry = engine.retrieveForResponder({ ...input, query: "五年前", turnEpoch: 2 });
    assert.deepEqual(retry.extra.map(e => e.memory.memoryId), first.extra.map(e => e.memory.memoryId), "uncommitted failed response must remain recallable");
    engine.commitDynamicSummaryRecall(2, session, 2);
    const later = engine.retrieveForResponder({ ...input, query: "五年前", turnEpoch: 3 });
    assert(later.extra.every(e => !first.extra.some(old => old.memory.memoryId === e.memory.memoryId)));
    assert.equal(later.directStableText, first.directStableText);
    const { Conversation } = require(path.join(root, "resources/app/out/main/conversation/conversation"));
    Conversation.configure({ memoryEngine: engine });
    for (const [count, ratio, ceiling] of [[2, 0.10, 3600], [3, 0.125, 4500], [4, 0.15, 5400], [8, 0.15, 5400]]) {
      const chat = Object.create(Conversation.prototype);
      const ids = Array.from({ length: count }, (_, i) => i + 1);
      assert.equal(chat.getMemoryTokenBudget(16000, ids), Math.floor(16000 * ratio));
      assert.equal(chat.getMemoryTokenBudget(16000, [1, 2, 3, 4, 5]), Math.floor(16000 * ratio), "mid-session presence must not change the frozen budget");
      assert.equal(Conversation.prototype.getMemoryTokenBudget.call({}, 200000, ids), ceiling);
    }
    assert.equal(Conversation.prototype.getMemoryTokenBudget.call({}, 4096, [1, 2]), 409, "small contexts must respect the percentage ceiling");
    const chat = Object.create(Conversation.prototype);
    chat.id = "recall-history";
    chat.memoryState = engine.createConversationState(chat.id);
    chat.messages = [{ id: 0, role: "user", content: "五年前呢" }, { id: 1, role: "assistant", content: "记得此事" }];
    chat.getPresenceWindows = () => [];
    chat.memoryState.responderRecallCache = new Map();
    const recallInput = { ...input, sessionRecallCache: chat.memoryState.responderRecallCache };
    const retained = engine.retrieveForResponder({ ...recallInput, query: "五年前" });
    chat.retainDynamicSummaryRecall(2, 1, { blocks: [{ block: { id: "memory-temporal-extra" }, content: retained.temporalExtraText }] }, 1);
    assert.equal(chat.getPromptHistoryForCharacter(2)[1].content, retained.temporalExtraText, "successful recall survives in the responder's prompt history");
    assert.equal(chat.getPromptHistoryForCharacter(3).length, 2, "other NPCs must not see the private recall annotation");
    assert.equal(chat.getHistory().length, 2, "recall annotations must not become actual dialogue or finalization evidence");
    chat.memoryState.rollingState.committedThroughHistoryIndex = 2;
    assert.equal(chat.getPromptHistoryForCharacter(2).length, 0);
    const recalledAgain = engine.retrieveForResponder({ ...recallInput, query: "五年前", turnEpoch: 2 });
    assert(recalledAgain.extra.some(e => retained.extra.some(old => old.memory.memoryId === e.memory.memoryId)), "after compression removes the annotation, explicit recall is eligible again");
    engine.invalidateConversationRecallState(chat);
    assert.equal(chat.dynamicRecallHistory.size, 0, "editing/deleting summaries clears historical recall copies");
    const otherOwner = engine.retrieveForResponder({ ...input, characterId: 3, sessionRecallCache: new Map() });
    assert(!otherOwner.direct.some(e => e.memory.subtype === "official_recollection"));
    const thirdPersonMemory = record("third-person", today - 8, "韩世忠亲口告诉我的往事");
    thirdPersonMemory.provenance.campaignToken = data.campaignToken;
    thirdPersonMemory.provenance.counterpartIds = [3];
    thirdPersonMemory.provenance.counterpartId = 3;
    const mentionSession = new Map();
    const mentionedInput = { ...input, ownerFolderMemories: [thirdPersonMemory], mentionedEntityIds: [3], sessionRecallCache: mentionSession, officialSummary: null };
    const mentioned = engine.retrieveForResponder(mentionedInput);
    assert.equal(mentioned.extra.length, 1);
    assert.equal(mentioned.extra[0].reason.source, "mentioned");
    assert.equal(mentioned.mentionedSnapshotText, null);
    engine.commitDynamicSummaryRecall(2, mentionSession, 1);
    assert.equal(engine.retrieveForResponder({ ...mentionedInput, turnEpoch: 2 }).extra.length, 0);
    const fitted = engine.ranker.selectWithinBudget([{ memory: { ...first.direct.at(-1).memory,
      content: "说明\n\n1152年1月1日：" + "长".repeat(300) + "\n\n1151年1月1日：完整的短事件" }, score: 1 }], { tokenBudget: 30, estimateTokens, allowTruncate: true });
    assert.equal(fitted[0].memory.content, "说明\n\n1151年1月1日：完整的短事件");
    const manager = createSummariesManager({ fs, path, summariesDir, memoryEngine: engine, memorySystem });
    assert((await manager.listAllSummaries()).some(entry => entry.characterName === "官方追忆摘要"));
    assert.equal((await manager.updateSummary(2, 2, 0, "手工修订追忆")).success, true);
    assert.equal(data.getOfficialRecollectionSummary(2, "session-a").content, "手工修订追忆");
    data.characters.get(2).memories = [{ creationDate: "1152年1月1日", creationDateTotalDays: 5000, desc: "最新追忆" }];
    data.syncOfficialRecollectionSummaries("session-b");
    assert.equal(JSON.parse(fs.readFileSync(officialPath, "utf8")).length, 1);
    assert.match(data.getOfficialRecollectionSummary(2, "session-b").content, /最新追忆/);
    assert.equal(data.getOfficialRecollectionSummary(2, "session-a"), null);
    assert.equal((await manager.deleteSummary(2, 2, 0)).success, true);
    assert.equal(data.getOfficialRecollectionSummary(2, "session-b"), null);
    console.log("Native official summary: PASS (multiline export, overwrite, 2+1, owner/session isolation, shared budget, frozen prefix, one-turn recall, edit/delete)");
  } finally { fs.rmSync(sandbox, { recursive: true, force: true }); }
}
testNativeSummaryLifecycle().catch(error => { console.error(error); process.exitCode = 1; });
