"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { MemoryEngine } = require("../resources/app/out/main/memory-system");
const { createSummariesManager } = require("../resources/app/out/main/summaries/summaries-manager");

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v8111-summary-"));
  try {
    const options = { baseDir: path.join(root, "memory"), summaryFoldersDir: path.join(root, "summaries") };
    const engine = new MemoryEngine(options);
    const traces = [];
    engine.trace = { record: (type, details) => traces.push({ type, details }) };
    const store = engine.store;
    const memory = store.saveMemory({ memoryId: "original", content: "赵构答应给黄金", participants: [1, 2], subjects: [2], knownBy: [1, 2], visibility: "known_group", provenance: { finalizationId: "final" } });
    for (const id of [1, 2]) store.markKnownBy(id, memory.memoryId);
    store.saveEpisode({ episodeId: "episode", finalizationId: "final", memoryIds: [memory.memoryId], summarySegments: [{ segmentId: "segment", content: memory.content, knownBy: [1, 2] }] });
    const folder = path.join(options.summaryFoldersDir, "1_甲");
    const file = path.join(folder, "与乙的对话.json");
    fs.mkdirSync(folder, { recursive: true });
    const record = { playerId: 1, characterId: 2, playerName: "甲", characterName: "乙", finalizationId: "final", perspectiveOwnerId: 1, content: memory.content };
    store.writeJson(file, [record]);
    const conversation = { id: "active", gameData: { characters: new Map(), mentionedCharactersInContext: new Set() } };
    engine.ensureConversationState(conversation).turnRecallCache.set("stale", "赵构答应给黄金");
    const manager = createSummariesManager({ fs, path, summariesDir: options.summaryFoldersDir, memoryEngine: engine, memorySystem: {}, getCurrentConversation: () => conversation });
    assert((await manager.updateSummary(1, 2, 0, "赵构拒绝给黄金")).success);
    assert.deepEqual(store.queryMemories({ characterId: 1 }).map(item => item.content), ["赵构拒绝给黄金"]);
    assert.deepEqual(store.queryMemories({ characterId: 2 }).map(item => item.content), ["赵构答应给黄金"]);
    assert.equal(conversation.memoryState.turnRecallCache.size, 0);
    let edited = JSON.parse(fs.readFileSync(file, "utf8"))[0];
    assert.equal(edited.perspectiveMemoryIds.length, 1);
    assert.equal(edited.perspectiveSummarySegmentIds.length, 1);
    engine.activeFinalizationIds.add("final");
    assert.throws(() => engine.updateSummaryProjection(edited, "busy", { ownerId: 1, counterpartId: 2 }), /SUMMARY_FINALIZATION_IN_PROGRESS/);
    engine.activeFinalizationIds.delete("final");
    const recoveryFile = path.join(store.paths.recovery, "pending.json");
    store.writeJson(recoveryFile, { finalizationId: "final", conversationId: "unfinished" });
    assert.throws(() => engine.updateSummaryProjection(edited, "pending", { ownerId: 1, counterpartId: 2 }), /SUMMARY_FINALIZATION_RECOVERY_PENDING/);
    fs.unlinkSync(recoveryFile);
    const restarted = new MemoryEngine(options);
    assert(!restarted.store.queryMemories({ characterId: 1, includeFolderSummaries: true }).some(item => item.content.includes("答应")), "restart/new conversation cannot recall old fact for edited owner");
    assert(store.listAllEpisodes()[0].summarySegments.some(segment => segment.content.includes("拒绝") && segment.knownBy.includes(1)));
    const diskBefore = fs.readFileSync(file, "utf8");
    const idsBefore = Object.keys(store.index.memories).sort();
    assert.throws(() => engine.updateSummaryProjection(edited, "失败修改", { ownerId: 1, counterpartId: 2, summaryPath: file, persistSummary: value => { store.writeJson(file, [value]); throw new Error("fixture_disk_failure"); } }), /fixture_disk_failure/);
    assert.equal(fs.readFileSync(file, "utf8"), diskBefore);
    assert.deepEqual(Object.keys(store.index.memories).sort(), idsBefore);
    assert.deepEqual(store.queryMemories({ characterId: 1 }).map(item => item.content), ["赵构拒绝给黄金"]);
    assert(!fs.existsSync(store.summaryMutationPath));
    assert.throws(() => engine.updateSummaryProjection(edited, " ", { ownerId: 1, counterpartId: 2 }), /summary_content_required/);
    assert((await manager.updateSummary(1, 2, 0, "赵构尚未决定给黄金")).success);
    assert.equal(store.queryMemories({ characterId: 1 }).length, 1, "re-edit replaces the previous edited projection");
    assert((await manager.deleteSummary(1, 2, 0)).success);
    assert.equal(store.queryMemories({ characterId: 1 }).length, 0);
    assert.equal(store.queryMemories({ characterId: 2 }).length, 1);

    // Legacy summary has a finalization ID, but no perspective memory IDs.
    store.markKnownBy(1, "original");
    store.updateMemory("original", { knownBy: [1, 2], provenance: {} });
    assert.equal(engine.forgetSummaryProjection(record).revokedMemoryCount, 1);
    assert.equal(store.queryMemories({ characterId: 1 }).length, 0);
    assert.equal(store.queryMemories({ characterId: 2 }).length, 1);
    assert.throws(() => engine.forgetSummaryProjection({ playerId: 2, content: "unmapped legacy" }), /LEGACY_SUMMARY_MEMORY_MAPPING_INCOMPLETE/);
    assert(traces.some(item => item.type === "LEGACY_SUMMARY_MEMORY_MAPPING_INCOMPLETE"));
    assert.equal(store.queryMemories({ characterId: 2 }).length, 1, "unmapped deletion cannot wipe unrelated owner memory");

    // Simulate a process death after a journaled write, before commit.
    store.summaryMutation = { version: 1, files: {} };
    store.updateMemory("original", { content: "uncommitted" });
    store.summaryMutation = null;
    assert.throws(() => store.withSummaryMutation(null, () => {}), /summary_mutation_in_progress/, "never overwrite an unfinished recovery journal");
    const recovered = new MemoryEngine(options);
    assert.equal(recovered.store.getMemory("original").content, "赵构答应给黄金");
    assert(!fs.existsSync(recovered.store.summaryMutationPath));
    recovered.store.markSummaryOwnerDeceased(2, { reason: "dead" });
    recovered.store.markSummaryOwnerDeceased(3, { source: "memory" });
    recovered.clearAllLongTermMemory();
    assert(recovered.store.isSummaryOwnerDeceased(2), "CK3-derived death marker is not a remembered conversation");
    assert(!recovered.store.isSummaryOwnerDeceased(3), "memory-derived owner status must be cleared");
    assert.equal(recovered.store.listAllMemories().length, 0);
    console.log("V8.11.1 Summary Consistency: PASS (edit/re-edit/delete, owner isolation, legacy fallback, rollback/restart, RAM invalidation, owner-status source boundary)");
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
