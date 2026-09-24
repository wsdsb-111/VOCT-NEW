"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const memorySystem = require("../resources/app/out/main/memory-system");
const { FinalizationCoordinator, MemoryEngine } = memorySystem;
const { createGameData } = require("../resources/app/out/main/game-data/game-data");
const { createSummariesManager } = require("../resources/app/out/main/summaries/summaries-manager");

function buildContext(conversationId, participants, messageCount) {
  const names = new Map(participants.map((participant) => [participant.id, participant.name]));
  const messages = Array.from({ length: messageCount }, (_, index) => {
    const speakerId = participants[index % participants.length].id;
    return {
      id: index + 1,
      role: index % 2 === 0 ? "user" : "assistant",
      name: names.get(speakerId),
      speakerCharacterId: speakerId,
      content: `第 ${index + 1} 条可核对的对话内容。`
    };
  });
  return {
    conversationId,
    date: "1121.1.1",
    totalDays: 100,
    participants,
    participantPresence: participants.map((participant) => ({
      characterId: participant.id,
      joinedAtMessageId: 1,
      leftAtMessageId: null
    })),
    messages,
    rollingState: {},
    buildPrompt: () => [],
    requestSummary: async () => {
      throw new Error("Deepseek API error: 402 Error - 402 Insufficient Balance");
    }
  };
}

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "votc-p0-summary-fallback-"));
  try {
    const trace = { entries: [], record(stage, details) { this.entries.push({ stage, ...details }); } };
    const engine = new MemoryEngine({ baseDir: path.join(root, "memory"), trace });
    const coordinator = new FinalizationCoordinator({ logger: { error() {} } });
    const participants3 = [
      { id: 1, name: "玩家" },
      { id: 2, name: "甲" },
      { id: 3, name: "乙" }
    ];
    const participants2 = [participants3[0], participants3[1]];
    let folderWrites = 0;
    const persistCharacterFolders = async () => {
      folderWrites += 1;
      return { success: true };
    };
    const first = coordinator.enqueue("three-person", () => engine.finalizeConversation({
      ...buildContext("three-person", participants3, 17),
      persistCharacterFolders
    }));
    const second = coordinator.enqueue("two-person", () => engine.finalizeConversation({
      ...buildContext("two-person", participants2, 10),
      persistCharacterFolders
    }));
    const results = await Promise.all([first, second]);
    assert(results.every((result) => !result.success && result.recoveryPath), "provider failure must preserve retryable source snapshots, not report success");
    assert.strictEqual(folderWrites, 0, "raw dialogue must never be written as a final summary");
    assert.strictEqual(engine.store.listAllEpisodes().length, 0, "failed model requests cannot commit an episode");
    const fallbackEntries = trace.entries.filter((entry) => entry.stage === "summary_source_grounded_fallback");
    assert.strictEqual(fallbackEntries.length, 0, "provider errors must not trigger transcript fallback");
    assert.deepStrictEqual(results.map(result => engine.store.readJson(result.recoveryPath).rawMessages.length), [17, 10]);
    assert.strictEqual(trace.entries.filter(entry => entry.stage === "summary_provider").length, 2, "402 balance failures must preserve recovery without retrying a non-transient request");

    // Restart, exhausted automatic retries, and recovery without an active CK3
    // conversation must all use the real owner-folder persistence path.
    const summariesDir = path.join(root, "summaries");
    const restarted = new MemoryEngine({ baseDir: path.join(root, "memory"), summaryFoldersDir: summariesDir, trace });
    const GameData = createGameData({ fs, path, memorySystem, memoryEngine: restarted, summariesDir, getHistoricalReferenceByYear: () => "" });
    for (const result of results) {
      const snapshot = restarted.store.readJson(result.recoveryPath);
      restarted.store.writeJson(result.recoveryPath, { ...snapshot, retryCount: 3, finalizationStatus: "pending" });
    }
    await restarted.recoverPendingFinalizations({ requestSummary: async () => { throw new Error("exhausted retries should be skipped"); } });
    assert.deepStrictEqual(results.map(result => restarted.store.readJson(result.recoveryPath).rawMessages.length), [17, 10], "marking failed_manual must not erase rawMessages");
    let modelCalls = 0;
    let activeConversation = { id: "two-person" };
    let available = true;
    const manager = createSummariesManager({
      fs, path, summariesDir, memoryEngine: restarted, memorySystem,
      getCurrentConversation: () => activeConversation,
      buildSummaryPrompt: context => context,
      requestSummary: async context => {
        modelCalls++;
        if (!available) throw new Error("402 Insufficient Balance");
        const ids = context.participants.map(p => p.id);
        return { content: JSON.stringify({
          summarySegments: [{ content: "众人核对安排并确认后续约定。", participants: ids, messageIds: context.messages.map(m => m.id) }],
          memories: [{ type: "promise", content: "众人约定按计划继续商议。", subjects: ids, participants: ids, importance: 0.9, status: "open", messageIds: [1, 2], speakerIds: [1, 2] }]
        }), finish_reason: "stop" };
      },
      persistRecoveredSummary: (summary, context) => GameData.saveRecoveredSummary(summary, context)
    });
    assert.strictEqual(manager.getRecoveryStatus().pending, 1, "active conversation must not be offered for recovery");
    // Stub refresh only: the active conversation fixture has no renderer/recall.
    manager.refreshCurrentConversation = () => {};
    const firstRecovery = await manager.retryFailedSummaries();
    assert.strictEqual(firstRecovery.recovered, 1);
    assert.strictEqual(modelCalls, 1);
    assert(fs.existsSync(results[1].recoveryPath), "active conversation source remains untouched");
    activeConversation = null;
    available = false;
    const failedAgain = await manager.retryFailedSummaries();
    assert.strictEqual(failedAgain.success, false);
    assert.strictEqual(failedAgain.failed, 1);
    assert.strictEqual(failedAgain.recoveryStatus.balanceBlocked, 1);
    assert.strictEqual(restarted.store.readJson(results[1].recoveryPath).rawMessages.length, 10);
    available = true;
    const beforeConcurrent = modelCalls;
    await Promise.all([manager.retryFailedSummaries(), manager.retryFailedSummaries()]);
    assert.strictEqual(modelCalls, beforeConcurrent + 1, "concurrent clicks must share the single model recovery run");
    assert.strictEqual(manager.getRecoveryStatus().pending, 0);
    assert.strictEqual(restarted.store.listAllEpisodes().length, 2);
    assert.strictEqual(restarted.store.listAllMemories().length, 2, "real model extraction persists key memories, not empty transcript fallback");
    const files = fs.readdirSync(summariesDir, { recursive: true }).filter(file => file.endsWith(".json"));
    assert.strictEqual(files.length, 6, "three participants yield six directed pair files");
    let recordCount = 0;
    for (const file of files) {
      const records = JSON.parse(fs.readFileSync(path.join(summariesDir, file), "utf8"));
      recordCount += records.length;
      assert.strictEqual(new Set(records.map(record => record.finalizationId)).size, records.length, "no duplicated summaries");
      assert(records.every(record => record.content.includes("众人核对安排") && !record.content.includes("第 1 条可核对")));
      assert(records.every(record => record.perspectiveMemoryIds.length > 0));
    }
    assert.strictEqual(recordCount, 8, "six group projections plus two pair projections");
    assert.strictEqual((await manager.retryFailedSummaries()).recovered, 0, "committed records are not regenerated or overwritten");

    let attempts = 0;
    const transient = buildContext("transient", participants2, 2);
    const compressed = JSON.stringify({ summarySegments: [{ content: "双方确认安排。", participants: [1, 2], messageIds: [1, 2] }], memories: [] });
    const output = await restarted.requestFinalSummary({ ...transient, requestSummary: async () => {
      if (++attempts === 1) throw new Error("temporary network failure");
      return { content: compressed };
    } });
    assert.strictEqual(attempts, 2);
    assert.strictEqual(output, compressed, "a transient failure must return the retried model output");

    const cancelledRoot = path.join(root, "cancelled-memory");
    const cancelledEngine = new MemoryEngine({ baseDir: cancelledRoot, trace });
    for (const id of ["cancel-first", "cancel-second"]) {
      cancelledEngine.writeRecoverySnapshot(cancelledEngine.prepareFinalizationContext(buildContext(id, participants2, 2)));
    }
    let started;
    const entered = new Promise(resolve => { started = resolve; });
    let cancellationCalls = 0;
    let activeCancellationCalls = 0;
    let maxCancellationConcurrency = 0;
    const pendingResponses = [];
    const recovery = cancelledEngine.recoverPendingFinalizations({
      manual: true, buildPrompt: () => [],
      requestSummary: async () => {
        cancellationCalls++;
        activeCancellationCalls++;
        maxCancellationConcurrency = Math.max(maxCancellationConcurrency, activeCancellationCalls);
        if (cancellationCalls === 2) started();
        return new Promise(resolve => pendingResponses.push(output => {
          activeCancellationCalls--;
          resolve(output);
        }));
      },
      persistCharacterFolders: async () => { throw new Error("cancelled recovery must never persist"); }
    });
    await entered;
    assert.strictEqual(maxCancellationConcurrency, 2, "manual recovery processes a bounded pair concurrently");
    cancelledEngine.clearAllLongTermMemory();
    pendingResponses.forEach(release => release({ content: compressed }));
    const cancelledResults = await recovery;
    assert.strictEqual(cancelledResults.length, 2);
    assert(cancelledResults.every(result => result.cancelled), "clearing memory cancels every in-flight recovery");
    assert.strictEqual(cancellationCalls, 2, "manual recovery starts no more than its bounded in-flight pair");
    assert.strictEqual(cancelledEngine.listRecoverySnapshots().length, 0, "cancelled recovery must not recreate a deleted snapshot");
    assert.strictEqual(cancelledEngine.store.listAllEpisodes().length, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
  console.log("P0 summary provider recovery: PASS (failures preserve source without committing transcripts)");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
