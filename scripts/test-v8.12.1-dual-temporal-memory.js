"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const memorySystem = require("../resources/app/out/main/memory-system");
const { MemoryEngine } = memorySystem;
const { MemoryTrace } = require("../resources/app/out/main/memory-system/memory-trace");
const { createMemoryRecord } = require("../resources/app/out/main/memory-system/memory-types");
const { buildDualTemporalIndex, selectDualTemporalExtras } = require("../resources/app/out/main/memory-system/summary-date-index");
const { resolveTemporalFocus } = require("../resources/app/out/main/memory-system/fuzzy-temporal-resolver");
const { buildPerspectiveSummaryMap, validatePerspectiveSummaryMap } = require("../resources/app/out/main/memory-system/perspective-projector");
const { createGameData } = require("../resources/app/out/main/game-data/game-data");

async function main() {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "votc-dual-time-"));
  try {
    const summariesDir = path.join(sandbox, "summaries");
    const trace = new MemoryTrace({ logger: { log() {} } });
    const engine = new MemoryEngine({ baseDir: path.join(sandbox, "memory"), summaryFoldersDir: summariesDir, trace });
    const GameData = createGameData({ fs, path, memorySystem, memoryEngine: engine, summariesDir, getHistoricalReferenceByYear: () => null });
    const participants = [1, 2, 3].map(id => ({ id, name: `P${id}`, shortName: `P${id}` }));
    const context = engine.prepareFinalizationContext({ conversationId: "original-1150", date: "1150.6.12", totalDays: 6000,
      campaignToken: "campaign-a", participants,
      participantPresence: [1, 2, 3].map(id => ({ characterId: id, joinedAtMessageId: id === 3 ? 3 : 1 })),
      messages: [
        { id: 1, name: "P1", role: "user", content: "你还记得五年前那场战争吗？敌军围城，粮仓被焚。" },
        { id: 2, name: "P2", role: "assistant", content: "记得，1147年我们议和，送回俘虏。" },
        { id: 3, name: "P3", role: "assistant", content: "今天我送来一篮桃子。" }
      ],
      persistCharacterFolders: (summary, ctx) => GameData.saveRecoveredSummary(summary, ctx)
    });
    const providerOutput = JSON.stringify({ summarySegments: context.messages.map(message => ({
      content: message.content, messageIds: [message.id], speakerIds: [Number(message.name.slice(1))], participants: [1, 2], visibility: "participants",
      temporalRefs: [{ targetGameYear: 1000, source: "model_inferred" }]
    })), memories: [] });
    const finalized = await engine.finalizeWithAvailableOutput(context, { providerOutput });
    assert.equal(finalized.success, true, finalized.error?.stack);
    const b = finalized.directedSummaries.get("2->1"), c = finalized.directedSummaries.get("3->1");
    assert.deepEqual(b.temporalRefs.map(ref => ref.targetGameYear), [1145, 1147]);
    assert.deepEqual(c.temporalRefs, [], "absent NPC must not gain a time reference to the private earlier dialogue");
    assert(b.temporalRefs.every(ref => ref.segmentIds.every(id => b.summarySegmentIds.includes(id))));
    assert.equal(context.date, "1150.6.12", "event references must never rewrite the conversation date");
    const badProjections = buildPerspectiveSummaryMap(context, finalized.extraction);
    badProjections.get("3->1").temporalRefs = b.temporalRefs;
    assert.equal(validatePerspectiveSummaryMap(context, finalized.extraction, badProjections).success, false);

    const file = path.join(summariesDir, "2_P2", "与P1的对话.json");
    const original = JSON.parse(fs.readFileSync(file, "utf8"))[0];
    assert.equal(original.campaignToken, "campaign-a");
    assert.deepEqual(original.temporalRefs, b.temporalRefs);
    assert.equal(original.date, "1150.6.12");
    // A fresh process must find metadata from disk, not an in-memory episode shortcut.
    const restarted = new MemoryEngine({ baseDir: path.join(sandbox, "memory"), summaryFoldersDir: summariesDir, trace });
    const loaded = restarted.loadOwnerFolderMemories(2);
    assert(loaded.some(memory => memory.provenance.temporalRefs.some(ref => ref.targetGameYear === 1145)));
    assert.deepEqual(createMemoryRecord(loaded[0]).provenance.temporalRefs, loaded[0].provenance.temporalRefs);
    const recent = ["1152.1.1", "1151.12.30"].map((date, i) => ({ ...original, date, totalDays: 6600 - i,
      finalizationId: `recent-${i}`, content: `近日归还书籍${i}`, temporalRefs: [] }));
    fs.writeFileSync(file, JSON.stringify([...recent, original]));
    restarted.invalidateSummaryFolderCache([2]);
    let ownerMemories = restarted.loadOwnerFolderMemories(2);
    const session = new Map();
    const input = { characterId: 2, directCounterpartIds: [1], ownerFolderMemories: ownerMemories,
      campaignToken: "campaign-a", conversationId: "conversation-a", sceneRevision: "scene-a", currentGameDate: "1152.5.19", currentTotalDays: 6700,
      tokenBudget: 3600, estimateTokens: text => text.length, sessionRecallCache: session, turnEpoch: 1 };
    const first = restarted.retrieveForResponder({ ...input, query: "七年前那场战争是谁先动手的？" });
    assert.equal(first.temporal.targetGameYear, 1145);
    assert.equal(first.extra.length, 1);
    assert.equal(first.extra[0].reason.axis, "event");
    assert.equal(first.extra[0].memory.eventDate, "1150.6.12");
    assert.match(first.temporalExtraText, /事件时间引用/);
    assert(first.selectedTokens <= first.tokenBudget);
    assert.equal(session.get(2).temporalFocus, undefined, "failed requests must not commit focus");
    restarted.commitDynamicSummaryRecall(2, session, 1, { providerSucceeded: true, injectedBlockIds: ["memory-temporal-extra"],
      injectedMemoryIds: first.extra.map(entry => entry.memory.memoryId), injectedTokens: first.extra.reduce((total, entry) => total + entry.tokens, 0) });
    const followup = restarted.retrieveForResponder({ ...input, currentGameDate: "1152.5.20", currentTotalDays: 6701, turnEpoch: 2, query: "后来呢？" });
    assert.equal(followup.temporal.focusReused, true);
    assert.equal(followup.extra.length, 0, "successful Extra remains in private history instead of being injected anew");
    assert.equal(followup.directStableText, first.directStableText);
    restarted.commitTemporalFocus(2, session, 2);
    const next = { ...original, finalizationId: "another-1145", content: "1145年战争中守军另救回一名俘虏。" };
    fs.writeFileSync(file, JSON.stringify([...recent, original, next]));
    restarted.invalidateSummaryFolderCache([2]);
    ownerMemories = restarted.loadOwnerFolderMemories(2);
    const newExtra = restarted.retrieveForResponder({ ...input, ownerFolderMemories: ownerMemories, turnEpoch: 3, query: "七年前那场战争中，谁被俘了？" });
    assert(newExtra.extra.some(entry => entry.memory.provenance.finalizationId === "another-1145"),
      "used top hits must not prevent a different same-year summary from being selected");
    assert(newExtra.extra.every(entry => !first.extra.some(previous => previous.memory.memoryId === entry.memory.memoryId)),
      "a confirmed injection must not be selected again");
    assert.equal(newExtra.directStableText, first.directStableText);
    session.get(2).seenDynamicSummaries.clear(); // Existing history compression lifecycle releases removed recall keys.
    const replay = restarted.retrieveForResponder({ ...input, turnEpoch: 4, query: "七年前那场战争" });
    assert(replay.extra.some(entry => first.extra.some(previous => previous.memory.memoryId === entry.memory.memoryId)),
      "history compression may release a previously injected summary for recall again");

    const other = restarted.retrieveForResponder({ ...input, characterId: 3, ownerFolderMemories: restarted.loadOwnerFolderMemories(3), sessionRecallCache: new Map(), query: "七年前那场战争" });
    assert.equal(other.extra.length, 0);
    const campaignChange = restarted.retrieveForResponder({ ...input, campaignToken: "campaign-b", turnEpoch: 5, query: "七年前那场战争" });
    assert.equal(campaignChange.extra.length, 0);
    assert.equal(campaignChange.direct.length, 0, "known campaign mismatch cannot reuse frozen summaries");

    const timeFolder = path.join(summariesDir, "4_P3");
    fs.mkdirSync(timeFolder, { recursive: true });
    const makeTimeSummary = (date, totalDays, finalizationId, content) => ({
      playerId: 3, characterId: 4, perspectiveOwnerId: 4, playerName: "P3", characterName: "P4",
      content, date, totalDays, finalizationId, campaignToken: "campaign-a",
      campaignBinding: { status: "bound", source: "test_fixture", version: 1 }, temporalRefs: [],
      participants: [{ id: 3, name: "P3" }, { id: 4, name: "P4" }]
    });
    const meetingContent = "我们第一次见到彼此时谈起了边境旧事。";
    const timeSummaries = [
      makeTimeSummary("1199.1.1", 799000, "recent-1199", "今夜谈了边境粮秣。"),
      makeTimeSummary("1198.1.1", 798000, "recent-1198", "近日商议巡夜安排。"),
      makeTimeSummary("1190.1.1", 790000, "later-meeting-reference", "后来我们又谈起第一次见面时的旧事。"),
      makeTimeSummary("1180.1.1", 780000, "meeting-1180", meetingContent),
      makeTimeSummary("1170.1.1", 770000, "older-unrelated", "旧年只谈过城门修缮。"),
      makeTimeSummary("1160.1.1", 760000, "not-first-meeting", "这并不是我们第一次见面。"),
      makeTimeSummary("1150.1.1", 750000, "future-meeting-plan", "将来我们第一次见面时再详谈。")
    ];
    fs.writeFileSync(path.join(timeFolder, "与P3的对话.json"), JSON.stringify(timeSummaries));
    restarted.invalidateSummaryFolderCache([4]);
    const timeInput = {
      characterId: 4, directCounterpartIds: [3], querySpeakerId: 3, campaignToken: "campaign-a",
      conversationId: "twenty-years-recall", sceneRevision: "scene-a", currentGameDate: "1200.1.1",
      currentTotalDays: 800000, tokenBudget: 3600, estimateTokens: text => text.length
    };
    const noReminder = restarted.retrieveForResponder({ ...timeInput, sessionRecallCache: new Map(),
      query: "20年前第一次见到你", turnEpoch: 1 });
    assert.deepEqual(noReminder.direct.map(entry => entry.memory.provenance.finalizationId), ["recent-1199", "recent-1198"],
      "a time query without explicit recall intent keeps the query-independent Recent2 block");
    assert(noReminder.extra.some(entry => entry.memory.content.includes(meetingContent)),
      "20 years ago retrieves the dated matching conversation summary into dynamic Extra");
    const firstMeetingTemporal = resolveTemporalFocus("第一次见到你", null, timeInput);
    assert.equal(firstMeetingTemporal.triggered, true);
    assert.equal(firstMeetingTemporal.mode, "EARLIEST_AVAILABLE");
    assert.equal(firstMeetingTemporal.axisIntent, "CONVERSATION");
    const timeMemories = restarted.loadOwnerFolderMemories(4);
    const timeIndex = restarted.store.getSummaryDateIndexForPair(4, 3, {
      currentGameDate: "1200.1.1", currentTotalDays: 800000, ownerFolderMemories: timeMemories,
      campaignToken: "campaign-a", dualTemporal: true
    });
    const nonAssertedOnly = timeMemories.filter(memory => ["older-unrelated", "not-first-meeting", "future-meeting-plan"].includes(memory.provenance.finalizationId));
    assert.deepEqual(selectDualTemporalExtras(timeIndex, nonAssertedOnly, firstMeetingTemporal, {
      query: "第一次见到你", directCounterpartIds: [3], querySpeakerId: 3
    }), [], "older, negated, and future-planned summaries are not presented as first-meeting records");
    const firstMeetingSession = new Map();
    const firstMeetingRecall = restarted.retrieveForResponder({ ...timeInput, sessionRecallCache: firstMeetingSession,
      query: "第一次见到你", turnEpoch: 1 });
    assert.deepEqual(firstMeetingRecall.extra.map(entry => entry.memory.provenance.finalizationId), ["meeting-1180"],
      "first-meeting recall selects the earliest available explicitly matching summary for the queried counterpart");
    assert.match(firstMeetingRecall.temporalExtraText, /不得据此断言双方人生中首次相识/);
    const selectedFirstMeeting = firstMeetingRecall.extra[0];
    restarted.commitDynamicSummaryRecall(4, firstMeetingSession, 1, {
      providerSucceeded: true, injectedBlockIds: ["memory-temporal-extra"],
      injectedMemoryIds: [selectedFirstMeeting.memory.memoryId], injectedTokens: selectedFirstMeeting.tokens
    });
    const repeatedFirstMeeting = restarted.retrieveForResponder({ ...timeInput, sessionRecallCache: firstMeetingSession,
      query: "第一次见到你", turnEpoch: 2 });
    assert.equal(repeatedFirstMeeting.temporalDiagnostics.seenSuppressedCount, 1);
    assert.equal(repeatedFirstMeeting.extra.length, 0,
      "a repeated first-meeting query does not drift to a later summary after the earliest match was injected");
    assert.match(repeatedFirstMeeting.temporalExtraText, /本轮未新增/);
    assert.match(repeatedFirstMeeting.temporalExtraText, /此前已注入对应证据/);

    const timeSession = new Map();
    const primed = restarted.retrieveForResponder({ ...timeInput, sessionRecallCache: timeSession,
      query: "今夜安好", turnEpoch: 1 });
    assert.deepEqual(primed.direct.map(entry => entry.memory.provenance.finalizationId), ["recent-1199", "recent-1198"]);
    const withReminder = restarted.retrieveForResponder({ ...timeInput, sessionRecallCache: timeSession,
      query: "你还记得20年前第一次见到你吗？", turnEpoch: 2 });
    assert.deepEqual(withReminder.direct.map(entry => entry.memory.provenance.finalizationId), ["recent-1199", "recent-1198"],
      "an explicit recall cue must not replace frozen Recent2 with a query-ranked old summary");
    assert(withReminder.extra.some(entry => entry.memory.content.includes(meetingContent)),
      "the old summary remains available as temporal Extra after Recent2 is frozen");
    assert.equal(withReminder.temporalDiagnostics.selectedCount, 1,
      "temporal diagnostics count the summary actually selected for injection");
    const selectedMeeting = withReminder.extra.find(entry => entry.memory.content.includes(meetingContent));
    restarted.commitDynamicSummaryRecall(4, timeSession, 2, {
      providerSucceeded: true, injectedBlockIds: ["memory-temporal-extra"],
      injectedMemoryIds: [selectedMeeting.memory.memoryId], injectedTokens: selectedMeeting.tokens
    });
    const repeatedTimeQuery = restarted.retrieveForResponder({ ...timeInput, sessionRecallCache: timeSession,
      query: "你还记得20年前第一次见到你吗？", turnEpoch: 3 });
    assert.equal(repeatedTimeQuery.temporalDiagnostics.seenSuppressedCount, 1,
      "a prior successful temporal injection is tracked in same-conversation history");
    assert.equal(repeatedTimeQuery.extra.length, 0,
      "a repeated time query does not inject the same summary after it is already in conversation history");
    assert.match(repeatedTimeQuery.temporalExtraText, /此前已注入的对应证据仍可使用/);

    const eventMemory = ownerMemories.find(memory => memory.provenance.finalizationId === original.finalizationId);
    const conversationMemory = { ...eventMemory, memoryId: "conversation-1145", eventDate: "1145.5.1", content: "我们讨论城防", canonicalText: "我们讨论城防",
      provenance: { ...eventMemory.provenance, finalizationId: "conversation-1145", temporalRefs: [] } };
    const weddingMemory = { ...eventMemory, memoryId: "wedding-1145", content: "婚礼宾客入席", canonicalText: "婚礼宾客入席",
      provenance: { ...eventMemory.provenance, finalizationId: "wedding-1145" } };
    const pool = [weddingMemory, eventMemory, conversationMemory];
    const options = { ownerId: 2, counterpartId: 1, campaignToken: "campaign-a", currentGameDate: input.currentGameDate, currentTotalDays: input.currentTotalDays };
    const index = buildDualTemporalIndex(pool, options);
    const conv = resolveTemporalFocus("七年前我们聊了什么？", null, input);
    assert.equal(selectDualTemporalExtras(index, pool, conv, { query: "七年前我们聊了什么？" })[0].memory.memoryId, conversationMemory.memoryId);
    assert.equal(selectDualTemporalExtras(index, pool, first.temporal, { query: "七年前那场战争", limit: 1 })[0].memory.memoryId, eventMemory.memoryId);
    assert.equal(buildDualTemporalIndex(pool, { ...options, campaignToken: "campaign-b" }).length, 0);
    const legacy = { ...conversationMemory, provenance: { ...conversationMemory.provenance, campaignToken: null } };
    assert.equal(buildDualTemporalIndex([legacy], options).length, 0, "unknown-campaign records must not enter an identified campaign");
    const noDate = restarted.retrieveForResponder({ ...input, currentGameDate: null, sessionRecallCache: new Map(), query: "七年前的战争" });
    assert.equal(noDate.extra.length, 0);

    // Source-less or malformed date evidence cannot prevent a valid body from committing.
    const missingDateContext = engine.prepareFinalizationContext({ ...context, conversationId: "no-calendar", finalizationId: null, date: null });
    const noCalendar = await engine.finalizeWithAvailableOutput(missingDateContext, { providerOutput });
    assert.equal(noCalendar.success, true, noCalendar.error?.stack);
    assert(noCalendar.extraction.summarySegments.every(segment => segment.temporalRefs.length === 0));
    const recovery = engine.prepareFinalizationContext({ ...context, conversationId: "recovery-campaign", finalizationId: null });
    const recoveryFile = engine.writeRecoverySnapshot(recovery);
    assert.equal(JSON.parse(fs.readFileSync(recoveryFile, "utf8")).campaignToken, "campaign-a");
    const metric = trace.list().find(entry => entry.temporalEventHitCount === 1);
    assert(metric && metric.temporalAxis === "EVENT" && metric.targetGameYear === 1145);

    // Same-day folder mutation, edits and deletion must not leave a stale Event Time index.
    const edited = restarted.updateSummaryProjection(original, "玩家修订后的战争经过", { ownerId: 2, counterpartId: 1,
      summaryPath: file, persistSummary: summary => fs.writeFileSync(file, JSON.stringify([summary])) });
    const afterEdit = JSON.parse(fs.readFileSync(file, "utf8"))[0];
    assert.deepEqual(afterEdit.temporalRefs.map(ref => ref.messageIds), original.temporalRefs.map(ref => ref.messageIds));
    assert(afterEdit.temporalRefs.every(ref => ref.segmentIds.length === 1 && afterEdit.perspectiveSummarySegmentIds.includes(ref.segmentIds[0])));
    assert(afterEdit.temporalRefs.every(ref => !original.perspectiveSummarySegmentIds.includes(ref.segmentIds[0])));
    const afterEditEngine = new MemoryEngine({ baseDir: path.join(sandbox, "memory"), summaryFoldersDir: summariesDir, trace });
    const afterEditMemories = afterEditEngine.loadOwnerFolderMemories(2);
    const afterEditIndex = afterEditEngine.store.getSummaryDateIndexForPair(2, 1, { ...options, ownerFolderMemories: afterEditMemories, dualTemporal: true });
    assert(afterEditIndex.some(entry => entry.axis === "event" && entry.ref.segmentIds[0] === afterEdit.perspectiveSummarySegmentIds[0]));
    fs.writeFileSync(file, "[]");
    restarted.invalidateSummaryFolderCache([2]);
    // Other pair projections may exist, but deleted 2->1 must not remain in this pair's index.
    assert.equal(restarted.store.getSummaryDateIndexForPair(2, 1, { ...options,
      ownerFolderMemories: restarted.loadOwnerFolderMemories(2), dualTemporal: true }).length, 0);
    void edited;
    console.log("V8.12.1 dual temporal memory: PASS (source -> projection -> disk -> dual index -> private recall)");
  } finally {
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
