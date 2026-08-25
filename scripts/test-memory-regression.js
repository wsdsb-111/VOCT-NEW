"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const root = path.resolve(__dirname, "..");
const memorySystem = require(path.join(root, "resources", "app", "out", "main", "memory-system"));

async function withTempStore(run) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "votc-memory-test-"));
  const summariesDir = path.join(tempDir, "conversation_summaries");
  const store = new memorySystem.MemoryStore({
    baseDir: path.join(tempDir, "memory"),
    summaryFoldersDir: summariesDir
  });
  try {
    return await run({ tempDir, summariesDir, store });
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function message(id, name, content, role = "user") {
  return { id, name, content, role };
}

async function testRollingCheckpointDurability() {
  const trace = new memorySystem.MemoryTrace({ logger: { log() {} } });
  const manager = new memorySystem.RollingSummaryManager({ trace });
  const state = manager.createState();
  const history = [
    message(0, "A", "第一条"),
    message(1, "B", "第二条", "assistant"),
    message(2, "A", "第三条"),
    message(3, "B", "第四条", "assistant"),
    message(4, "A", "第五条"),
    message(5, "B", "第六条", "assistant")
  ];
  const batches = [];
  for (const updatedSummary of ["摘要一", "摘要二", "摘要三"]) {
    const result = await manager.checkpoint({
      state,
      history,
      tokensToSummarize: 2,
      estimateMessageTokens: () => 1,
      buildPrompt: (batch, previous) => {
        batches.push({ ids: batch.map((entry) => entry.id), previous });
        return batch;
      },
      requestSummary: async () => ({ content: updatedSummary })
    });
    assert.strictEqual(result.committed, true);
  }
  assert.deepStrictEqual(batches.map((batch) => batch.ids), [[0, 1], [2, 3], [4, 5]]);
  assert.deepStrictEqual(batches.map((batch) => batch.previous), ["", "摘要一", "摘要二"]);
  assert.strictEqual(state.currentSummary, "摘要三", "rolling summary must replace, not append");
  assert.strictEqual(state.committedThroughHistoryIndex, 6);
  assert.strictEqual(state.committedThroughMessageId, 5);
  assert.strictEqual(state.summaryVersion, 3);

  const before = { ...state };
  const failure = await manager.checkpoint({
    state,
    history: [...history, message(6, "A", "不可丢失")],
    tokensToSummarize: 2,
    estimateMessageTokens: () => 1,
    buildPrompt: (batch) => batch,
    requestSummary: async () => { throw new Error("provider offline"); }
  });
  assert.strictEqual(failure.committed, false);
  assert.strictEqual(failure.reason, "summary_request_failed");
  assert.deepStrictEqual(state, before, "failed summary must not advance or mutate checkpoint");
  assert.deepStrictEqual(manager.getUncommittedHistory(state, [...history, message(6, "A", "不可丢失")]).map((entry) => entry.id), [6]);
}

async function testKnowledgeBoundaryAndPresence() {
  return withTempStore(({ store }) => {
    const knowledge = new memorySystem.KnowledgeService({ store });
    const episode = {
      episodeId: "episode-secret",
      conversationId: "conversation-secret",
      participantPresence: [
        { characterId: 1, joinedAtMessageId: 0, leftAtMessageId: null },
        { characterId: 2, joinedAtMessageId: 0, leftAtMessageId: null },
        { characterId: 3, joinedAtMessageId: 4, leftAtMessageId: null }
      ],
      conversationStartMessageId: 0,
      conversationEndMessageId: 6
    };
    const secret = memorySystem.createMemoryRecord({
      memoryId: "memory-secret",
      type: "secret",
      subtype: "confession",
      participants: [1, 2],
      subjects: [2],
      content: "二号告诉一号一个秘密",
      visibility: "known_group",
      source: "spoken",
      provenance: { conversationId: episode.conversationId, messageIds: [2], speakerIds: [2], extractionMode: "structured" }
    });
    const knownBy = knowledge.resolveKnownBy(secret, episode);
    assert.deepStrictEqual(knownBy, [1, 2], "late joiner must not know earlier private material");
    const unstructured = memorySystem.createMemoryRecord({
      memoryId: "memory-fallback",
      type: "information",
      participants: [1, 2, 3],
      content: "无法定位到单条消息的整场摘要",
      visibility: "participants",
      provenance: { conversationId: episode.conversationId, messageIds: [], speakerIds: [], extractionMode: "prose_fallback" }
    });
    assert.deepStrictEqual(knowledge.resolveKnownBy(unstructured, episode), [1, 2], "unstructured fallback must require full-session presence");
    store.saveMemory({ ...secret, knownBy });
    knowledge.markKnownBy(secret.memoryId, knownBy, { awareness: "witnessed", acquiredAt: 2 });
    assert.strictEqual(store.queryMemories({ characterId: 1 }).length, 1);
    assert.strictEqual(store.queryMemories({ characterId: 2 }).length, 1);
    assert.strictEqual(store.queryMemories({ characterId: 3 }).length, 0);

    knowledge.transferKnowledge(secret.memoryId, { fromCharacterId: 2, toCharacterId: 3, acquiredAt: 7 });
    assert.strictEqual(store.queryMemories({ characterId: 3 }).length, 1, "explicit later transfer should grant knowledge");
  });
}

function testRankingCriticalRecallAndBudget() {
  const ranker = new memorySystem.MemoryRanker();
  const memories = [
    memorySystem.createMemoryRecord({ memoryId: "old-critical", type: "event", content: "韩信曾在战场上救过刘邦", canonicalText: "韩信 战场 救命 刘邦", importance: 0.95, confidence: 1, totalDays: 10, subjects: [2], participants: [1, 2] }),
    memorySystem.createMemoryRecord({ memoryId: "new-trivial", type: "event", content: "今日闲谈天气", importance: 0.1, confidence: 1, totalDays: 990, subjects: [2], participants: [1, 2] }),
    memorySystem.createMemoryRecord({ memoryId: "promise", type: "promise", content: "刘邦承诺照顾韩信的家人", importance: 0.8, confidence: 1, totalDays: 900, subjects: [2], participants: [1, 2], status: "open" })
  ];
  const ranked = ranker.rank(memories, { query: "韩信还记得刘邦救命和家人承诺吗", characterId: 1, participantIds: [2], currentTotalDays: 1000 });
  assert.strictEqual(ranked[0].memory.memoryId, "old-critical", "critical relevant memory must outrank trivial recency");
  const selected = ranker.selectWithinBudget(ranked, { tokenBudget: 18, estimateTokens: (text) => Math.ceil(text.length / 2) });
  assert(selected.some((entry) => entry.memory.memoryId === "old-critical"), "importance >= 0.9 must be pinned within recall output");
  assert(selected.reduce((sum, entry) => sum + entry.tokens, 0) <= 18, "retrieval output must stay within configured token budget");
}

async function testCanonicalFoldersDoNotLeakPlayerFallback() {
  return withTempStore(({ summariesDir, store }) => {
    const playerFolder = path.join(summariesDir, "1_玩家");
    const npcFolder = path.join(summariesDir, "2_甲");
    fs.mkdirSync(playerFolder, { recursive: true });
    fs.mkdirSync(npcFolder, { recursive: true });
    fs.writeFileSync(path.join(playerFolder, "与乙的对话.json"), JSON.stringify([{ date: "1000年", totalDays: 10, content: "只有玩家知道的秘密", characterId: 3 }]), "utf8");
    fs.writeFileSync(path.join(npcFolder, "与乙的对话.json"), JSON.stringify([{ date: "1001年", totalDays: 20, content: "甲亲自记得的往来", characterId: 3 }]), "utf8");
    const npcMemories = store.queryMemories({ characterId: 2, includeFolderSummaries: true });
    assert(npcMemories.some((entry) => entry.content === "甲亲自记得的往来"));
    assert(!npcMemories.some((entry) => entry.content === "只有玩家知道的秘密"));
    assert(npcMemories.every((entry) => entry.schemaVersion === 1 || entry.schemaVersion === 2));
  });
}

async function testFinalizationRecoveryAndStructuredExtraction() {
  await withTempStore(async ({ store }) => {
    const engine = new memorySystem.MemoryEngine({ store, trace: new memorySystem.MemoryTrace({ logger: { log() {} } }) });
    const context = {
      conversationId: "conversation-final",
      date: "1000年1月1日",
      totalDays: 100,
      messages: [message(0, "一号", "我答应照顾你", "user"), message(1, "二号", "我记住了", "assistant")],
      participants: [{ id: 1, name: "一号" }, { id: 2, name: "二号" }],
      participantPresence: [{ characterId: 1, joinedAtMessageId: 0, leftAtMessageId: null }, { characterId: 2, joinedAtMessageId: 0, leftAtMessageId: null }],
      rollingState: { currentSummary: "", committedThroughHistoryIndex: 0, committedThroughMessageId: null, summaryVersion: 0 }
    };
    const failed = await engine.finalizeConversation({
      ...context,
      requestSummary: async () => { throw new Error("offline"); },
      buildPrompt: () => []
    });
    assert.strictEqual(failed.success, false);
    const recoveryFiles = engine.listRecoverySnapshots();
    assert.strictEqual(recoveryFiles.length, 1);
    const recovery = JSON.parse(fs.readFileSync(recoveryFiles[0], "utf8"));
    assert.strictEqual(recovery.finalizationStatus, "pending");
    assert.strictEqual(recovery.finalizationStage, "request");
    assert.strictEqual(recovery.rawMessages.length, 2);

    const payload = JSON.stringify({
      summarySegments: [{
        content: "一号承诺照顾二号，二号回应自己已经记住这项承诺。",
        participants: [1, 2],
        visibility: "participants",
        messageIds: [0, 1],
        speakerIds: [1, 2]
      }],
      memories: [{
        type: "promise",
        subtype: "care",
        participants: [1, 2],
        subjects: [2],
        content: "一号承诺照顾二号",
        canonicalText: "一号 承诺 照顾 二号",
        importance: 0.9,
        confidence: 1,
        visibility: "participants",
        source: "spoken",
        status: "open",
        messageIds: [0],
        speakerIds: [1]
      }, {
        type: "secret",
        subtype: "boundary",
        participants: [1, 2, 999],
        subjects: [2, 999],
        content: "二号的私密消息",
        importance: 0.8,
        confidence: 1,
        visibility: "world",
        source: "spoken",
        messageIds: [1],
        speakerIds: [999]
      }]
    });
    recovery.retryCount = 1;
    store.writeJson(recoveryFiles[0], recovery);
    const [recovered] = await engine.recoverPendingFinalizations({
      requestSummary: async () => ({ content: payload }),
      buildPrompt: () => []
    });
    assert.strictEqual(recovered.success, true);
    assert.strictEqual(engine.listRecoverySnapshots().length, 0);
    const recoveredMemories = store.queryMemories({ characterId: 2 });
    assert.strictEqual(recoveredMemories.length, 2);
    const recoveredSecret = recoveredMemories.find((memory) => memory.type === "secret");
    assert.strictEqual(recoveredSecret.visibility, "known_group", "model cannot promote a secret to world visibility");
    assert(!recoveredSecret.participants.includes(999) && !recoveredSecret.subjects.includes(999), "model IDs must be constrained to actual participants");
    assert.strictEqual(store.queryMemories({ characterId: 999 }).length, 0);

    let attempts = 0;
    const retried = await engine.finalizeConversation({
      ...context,
      conversationId: "conversation-immediate-retry",
      requestSummary: async () => {
        attempts++;
        return attempts === 1 ? { content: "" } : { content: payload };
      },
      buildPrompt: () => []
    });
    assert.strictEqual(retried.success, true, "a transient empty final-summary response must be retried immediately");
    assert.strictEqual(attempts, 2, "final-summary generation must retry exactly once after an empty response");
  });
}

(async () => {
  await testRollingCheckpointDurability();
  await testKnowledgeBoundaryAndPresence();
  testRankingCriticalRecallAndBudget();
  await testCanonicalFoldersDoNotLeakPlayerFallback();
  await testFinalizationRecoveryAndStructuredExtraction();
  console.log("VOTC v7.1 Memory Regression: PASS (durability, recovery, knowledge, folder retrieval)");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
