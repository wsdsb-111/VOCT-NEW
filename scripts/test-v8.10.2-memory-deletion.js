"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const root = path.resolve(__dirname, "..");
const { MemoryEngine } = require(path.join(root, "resources", "app", "out", "main", "memory-system"));
const { Character } = require(path.join(root, "resources", "app", "out", "main", "game-data", "character"));
const { createSummariesManager } = require(path.join(root, "resources", "app", "out", "main", "summaries", "summaries-manager"));

function filesIn(directory) {
  return fs.existsSync(directory) ? fs.readdirSync(directory) : [];
}

function createConversation() {
  const character = {
    id: 1,
    conversationSummaries: [{ content: "旧摘要" }],
    conversationCache: new Map([["旧人物", [{ content: "旧记忆" }]]]),
    dynamicMemoryCache: { memories: [{ content: "旧记忆" }] }
  };
  return {
    id: "active-conversation",
    memoryState: {
      rollingState: {},
      participantPresence: [],
      mentionState: { processedThroughIndex: 5 },
      mentionProfileCache: { participantKey: "1", profiles: new Map([[1, character]]) },
      mentionedRecallCache: new Map([["old", "old"]]),
      responderRecallCache: new Map([["old", "old"]]),
      turnRecallCache: new Map([["old", "old"]])
    },
    gameData: {
      characters: new Map([[1, character]]),
      mentionedCharactersInContext: new Set([1])
    }
  };
}

(async () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v8102-memory-delete-"));
  try {
    const memoryRoot = path.join(temporaryRoot, "memory");
    const summaryRoot = path.join(temporaryRoot, "conversation_summaries");
    const traces = [];
    const engine = new MemoryEngine({
      baseDir: memoryRoot,
      summaryFoldersDir: summaryRoot,
      trace: { record(type, details) { traces.push({ type, details }); } }
    });
    const memory = engine.store.saveMemory({
      memoryId: "shared-memory",
      type: "event",
      content: "甲乙共同记得旧日密谈。",
      participants: [1, 2],
      subjects: [1, 2],
      visibility: "known_group",
      knownBy: [1, 2]
    });
    engine.store.markKnownBy(1, memory.memoryId);
    engine.store.markKnownBy(2, memory.memoryId);
    engine.store.saveEpisode({
      episodeId: "episode-shared",
      conversationId: "old-conversation",
      finalizationId: "fin-shared",
      memoryIds: [memory.memoryId],
      summarySegments: [{ segmentId: "segment-shared", content: "旧日密谈。", knownBy: [1, 2] }]
    });
    engine.store.saveCharacterConsolidation(1, { derivedFrom: [memory.memoryId] });
    const ownerFolder = path.join(summaryRoot, "1_甲");
    fs.mkdirSync(ownerFolder, { recursive: true });
    fs.writeFileSync(path.join(ownerFolder, "与乙的对话.json"), JSON.stringify([{
      finalizationId: "fin-shared",
      perspectiveOwnerId: 1,
      perspectiveMemoryIds: [memory.memoryId],
      perspectiveSummarySegmentIds: ["segment-shared"],
      content: "旧日密谈。"
    }]), "utf8");
    const oldContext = engine.prepareFinalizationContext({ conversationId: "old-recovery", participants: [], messages: [] });
    engine.writeRecoverySnapshot(oldContext, { finalizationStatus: "pending" });
    engine.store.loadFolderSummariesForCharacter(1);
    assert(engine.store.getFolderSummaryCacheMetrics().entries > 0, "fixture must populate folder summary cache");

    const projectionResult = engine.forgetSummaryProjection({
      finalizationId: "fin-shared",
      perspectiveOwnerId: 1,
      perspectiveMemoryIds: [memory.memoryId],
      perspectiveSummarySegmentIds: ["segment-shared"]
    });
    assert.strictEqual(projectionResult.revokedMemoryCount, 1, "single projection deletion must revoke its owner knowledge");
    assert.strictEqual(engine.store.queryMemories({ characterId: 1 }).length, 0, "owner A must no longer recall shared memory");
    assert.strictEqual(engine.store.queryMemories({ characterId: 2 }).length, 1, "owner B must retain shared memory");
    assert.deepStrictEqual(engine.store.getMemory(memory.memoryId).knownBy, [2], "shared memory knownBy must retain only the other owner");
    assert.deepStrictEqual(engine.store.listAllEpisodes()[0].summarySegments[0].knownBy, [2], "episode segment knowledge must follow owner deletion");
    assert.strictEqual(engine.store.getPairMemories(1, 2, { characterId: 1 }).length, 0, "pair recall eligibility must deny forgotten owner");
    assert.strictEqual(engine.store.getPairMemories(1, 2, { characterId: 2 }).length, 1, "pair recall eligibility must retain other owner");

    const conversation = createConversation();
    const clearResult = engine.clearAllLongTermMemory({ conversations: [conversation] });
    assert.strictEqual(clearResult.success, true);
    assert.strictEqual(engine.store.listAllMemories().length, 0, "clear all must remove structured memories");
    assert.strictEqual(engine.store.listAllEpisodes().length, 0, "clear all must remove episodes");
    assert.strictEqual(engine.store.listKnowledgeCharacterIds().length, 0, "clear all must remove knowledge files");
    assert.strictEqual(filesIn(engine.store.paths.characters).length, 0, "clear all must remove consolidations");
    assert.strictEqual(filesIn(engine.store.paths.pairs).length, 0, "clear all must remove pair indexes");
    assert.strictEqual(filesIn(engine.store.paths.recovery).length, 0, "clear all must remove recovery snapshots");
    assert.strictEqual(filesIn(summaryRoot).length, 0, "clear all must remove visible summary folders");
    assert.deepStrictEqual(engine.store.index.memories, {});
    assert.deepStrictEqual(engine.store.index.episodes, {});
    assert.strictEqual(engine.store.getFolderSummaryCacheMetrics().entries, 0, "clear all must invalidate folder cache");
    assert.strictEqual(conversation.memoryState.mentionProfileCache, null);
    assert.strictEqual(conversation.memoryState.mentionedRecallCache.size, 0);
    assert.strictEqual(conversation.memoryState.responderRecallCache.size, 0);
    assert.strictEqual(conversation.memoryState.turnRecallCache.size, 0);
    assert.strictEqual(conversation.gameData.mentionedCharactersInContext.size, 0);
    const cachedCharacter = conversation.gameData.characters.get(1);
    assert.deepStrictEqual(cachedCharacter.conversationSummaries, []);
    assert.strictEqual(cachedCharacter.conversationCache.size, 0);
    assert.strictEqual(cachedCharacter.dynamicMemoryCache, null);
    assert(traces.some((entry) => entry.type === "memory_clear_all"), "clear all must emit diagnostic event");
    assert.strictEqual(engine.writeRecoverySnapshot(oldContext, { finalizationStatus: "pending" }), null, "stale finalization must not recreate recovery after clear");

    let releaseSummary;
    const waitingFinalization = engine.finalizeConversation({
      conversationId: "in-flight-before-second-clear",
      participants: [{ id: 1, name: "甲" }, { id: 2, name: "乙" }],
      participantPresence: [{ characterId: 1, joinedAtMessageId: 0 }, { characterId: 2, joinedAtMessageId: 0 }],
      messages: [{ id: 1, name: "甲", content: "记住这件事。" }, { id: 2, name: "乙", content: "我会记住。" }],
      buildPrompt: () => [],
      requestSummary: () => new Promise((resolve) => { releaseSummary = resolve; }),
      persistCharacterFolders: async () => ({ success: true })
    });
    await new Promise((resolve) => setImmediate(resolve));
    engine.clearAllLongTermMemory();
    releaseSummary({
      content: JSON.stringify({
        summarySegments: [{ content: "甲要求乙记住此事，乙明确答应。", participants: [1, 2], visibility: "participants", messageIds: [1, 2], speakerIds: [1, 2] }],
        memories: [{ type: "promise", content: "乙答应甲会记住此事。", participants: [1, 2], subjects: [1], messageIds: [2], speakerIds: [2] }]
      }),
      finish_reason: "stop"
    });
    const cancelled = await waitingFinalization;
    assert.strictEqual(cancelled.cancelled, true, "in-flight finalization started before clear must be cancelled");
    assert.strictEqual(engine.store.listAllMemories().length, 0, "cancelled finalization must not revive memories");
    assert.strictEqual(engine.store.listAllEpisodes().length, 0, "cancelled finalization must not revive episodes");
    assert.strictEqual(filesIn(engine.store.paths.recovery).length, 0, "cancelled finalization must not revive recovery snapshots");

    const uiMemory = engine.store.saveMemory({
      memoryId: "ui-shared-memory",
      type: "event",
      content: "UI 删除路径共享记忆。",
      participants: [1, 2],
      subjects: [1, 2],
      visibility: "known_group",
      knownBy: [1, 2]
    });
    engine.store.markKnownBy(1, uiMemory.memoryId);
    engine.store.markKnownBy(2, uiMemory.memoryId);
    const uiFolder = path.join(summaryRoot, "1_甲");
    const uiFile = path.join(uiFolder, "与乙的对话.json");
    fs.mkdirSync(uiFolder, { recursive: true });
    fs.writeFileSync(uiFile, JSON.stringify([{
      playerId: 1,
      playerName: "甲",
      characterId: 2,
      characterName: "乙",
      finalizationId: "fin-ui",
      perspectiveOwnerId: 1,
      perspectiveMemoryIds: [uiMemory.memoryId],
      perspectiveSummarySegmentIds: [],
      content: "UI 删除路径共享记忆。"
    }]), "utf8");
    const SummariesManager = createSummariesManager({
      fs,
      path,
      summariesDir: summaryRoot,
      memoryEngine: engine,
      memorySystem: {},
      getCurrentConversation: () => conversation
    });
    assert.strictEqual((await SummariesManager.deleteSummary(1, 2, 0)).success, true, "UI single-summary deletion must use Memory Engine projection deletion");
    assert.strictEqual(fs.existsSync(uiFile), false);
    assert.strictEqual(engine.store.queryMemories({ characterId: 1 }).length, 0);
    assert.strictEqual(engine.store.queryMemories({ characterId: 2 }).length, 1);

    const character = new Character(["1", "甲", "甲", "", "他", "30", "0", "0", "", "", "0", "0", "", "", "", "", "", "0", "甲"]);
    character.conversationSummaries = [{ content: "stale" }];
    character.loadSummaries(path.join(temporaryRoot, "missing-summary.json"));
    assert.deepStrictEqual(character.conversationSummaries, [], "missing summary file must clear stale Character state");

    const ipcSource = fs.readFileSync(path.join(root, "resources", "app", "out", "main", "ipc", "register-ipc.js"), "utf8");
    const clearHandler = ipcSource.slice(ipcSource.indexOf('electron.ipcMain.handle("conversation:clearSummaries"'), ipcSource.indexOf('electron.ipcMain.handle("conversation:listAllSummaries"'));
    assert(clearHandler.includes("memoryEngine.clearAllLongTermMemory"), "clear-all IPC must delegate to the unified Memory Engine deletion API");
    assert(!clearHandler.includes("unlinkSync"), "clear-all IPC must not bypass Memory Engine by deleting files directly");
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
  console.log("VOTC v8.10.2 memory deletion: PASS (full clear, owner projection, RAM cache, recovery generation, stale Character state)");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
