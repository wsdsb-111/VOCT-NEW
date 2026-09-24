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
      campaignToken: "campaign-a", sceneId: "scene-a", currentGameDate: "1152.5.19", currentTotalDays: 6700,
      tokenBudget: 3600, estimateTokens: text => text.length, sessionRecallCache: session, turnEpoch: 1 };
    const first = restarted.retrieveForResponder({ ...input, query: "七年前那场战争是谁先动手的？" });
    assert.equal(first.temporal.targetGameYear, 1145);
    assert.equal(first.extra.length, 1);
    assert.equal(first.extra[0].reason.axis, "event");
    assert.equal(first.extra[0].memory.eventDate, "1150.6.12");
    assert.match(first.temporalExtraText, /事件时间引用/);
    assert(first.selectedTokens <= first.tokenBudget);
    assert.equal(session.get(2).temporalFocus, undefined, "failed requests must not commit focus");
    restarted.commitDynamicSummaryRecall(2, session, 1);
    const followup = restarted.retrieveForResponder({ ...input, turnEpoch: 2, query: "后来呢？" });
    assert.equal(followup.temporal.focusReused, true);
    assert.equal(followup.extra.length, 0, "successful Extra remains in private history instead of being injected anew");
    assert.equal(followup.directStableText, first.directStableText);
    restarted.commitTemporalFocus(2, session, 2);
    const next = { ...original, finalizationId: "another-1145", content: "1145年战争中守军另救回一名俘虏。" };
    fs.writeFileSync(file, JSON.stringify([...recent, original, next]));
    restarted.invalidateSummaryFolderCache([2]);
    ownerMemories = restarted.loadOwnerFolderMemories(2);
    const newExtra = restarted.retrieveForResponder({ ...input, ownerFolderMemories: ownerMemories, turnEpoch: 3, query: "那一年谁被俘了？" });
    assert.equal(newExtra.extra.length, 1, "used top hits must not prevent a different same-year summary from being selected");
    assert.equal(newExtra.extra[0].memory.provenance.finalizationId, "another-1145");
    assert.equal(newExtra.directStableText, first.directStableText);
    session.get(2).seenDynamicSummaries.clear(); // Existing history compression lifecycle releases removed recall keys.
    const replay = restarted.retrieveForResponder({ ...input, turnEpoch: 4, query: "七年前那场战争" });
    assert.equal(replay.extra.length, 1);

    const other = restarted.retrieveForResponder({ ...input, characterId: 3, ownerFolderMemories: restarted.loadOwnerFolderMemories(3), sessionRecallCache: new Map(), query: "七年前那场战争" });
    assert.equal(other.extra.length, 0);
    const campaignChange = restarted.retrieveForResponder({ ...input, campaignToken: "campaign-b", turnEpoch: 5, query: "七年前那场战争" });
    assert.equal(campaignChange.extra.length, 0);
    assert.equal(campaignChange.direct.length, 0, "known campaign mismatch cannot reuse frozen summaries");

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
    assert.equal(buildDualTemporalIndex([legacy], options).length, 1, "legacy records still have Conversation Time without inferred Event Time");
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
    assert.deepEqual(afterEdit.temporalRefs, original.temporalRefs);
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
