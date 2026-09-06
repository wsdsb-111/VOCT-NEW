"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { MemoryEngine } = require("../resources/app/out/main/memory-system");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v861-memory-regression-"));
const memory = (memoryId, content, participants, subjects, totalDays, importance = 0.8) => ({
  memoryId, type: "folder_summary", epistemicStatus: "known", content, canonicalText: content,
  participants, subjects, importance, confidence: 1, totalDays, eventDate: "1170年1月1日",
  provenance: { folderOwnerId: 2, finalizationId: memoryId, counterpartId: participants.find((id) => id !== 2) || null, counterpartIds: participants.filter((id) => id !== 2) }
});

try {
  const engine = new MemoryEngine({ baseDir: path.join(root, "memory"), summaryFoldersDir: path.join(root, "summaries"), recoveryDir: path.join(root, "recovery"), trace: { record() {} } });
  engine.store.saveMemory({ memoryId: "stable-oath", type: "promise", participants: [2], knownBy: [2], content: "始终守护旧日誓言。", importance: 1, status: "open", totalDays: 900 });
  engine.store.markKnownBy(2, "stable-oath");
  const memories = [
    memory("direct-player", "甲与玩家曾约定下月相见。", [1, 2], [1, 2], 995),
    memory("mentioned-third", "甲曾与乙在花园谈论婚约。", [2, 3], [2, 3], 994),
    memory("topic-jade", "甲曾在城门寻回玉佩。", [2, 4], [2, 4], 993)
  ];
  const options = {
    characterId: 2, query: "花园里的乙后来如何？", directCounterpartIds: [1], mentionedEntityIds: [3], mentionedEntityNames: { 3: ["乙"] },
    ownerFolderMemories: memories, currentTotalDays: 1000, tokenBudget: 2400,
    estimateTokens: (value) => Math.ceil(String(value || "").length / 2), sessionRecallCache: new Map(), mentionedRecallCache: new Map()
  };
  const first = engine.retrieveForResponder(options);
  assert.deepEqual(first.direct.map((entry) => entry.memory.memoryId), ["direct-player"], "Direct Pair selected ID must match the V8.6 fixture");
  assert.deepEqual(first.mentioned.map((entry) => entry.memory.memoryId), ["mentioned-third"], "Mentioned out-of-scene selected ID must remain isolated");
  assert.deepEqual(first.stable.map((entry) => entry.memory.memoryId), ["stable-oath"], "long stable Memory selected ID must remain unchanged");
  const second = engine.retrieveForResponder({ ...options, query: "城门玉佩", mentionedEntityIds: [], directCounterpartIds: [] });
  assert.deepEqual(second.direct, first.direct, "frozen Direct Pair recall must not be re-ranked during the session");
  assert.deepEqual(second.stable, first.stable, "stable Memory must remain frozen during the session");
  const topic = engine.retrieveForResponder({ ...options, sessionRecallCache: new Map(), mentionedRecallCache: new Map(), query: "城门玉佩", mentionedEntityIds: [], directCounterpartIds: [] });
  assert.deepEqual(topic.topicPatch.map((entry) => entry.memory.memoryId), ["topic-jade"], "Session Topic Anchor must select the same relevant ID");
  const turn = engine.retrieveTurnRecall({ characterId: 2, query: "你还记得我们下月相见的约定吗？", entityIds: [1], entityNames: ["玩家"], participantIds: [1], ownerFolderMemories: memories, currentTotalDays: 1000, tokenBudget: 256, estimateTokens: options.estimateTokens, cache: new Map(), turnEpoch: 1 });
  assert.deepEqual(turn.selected.map((entry) => entry.memory.memoryId), ["direct-player"], "Turn Recall Top1 ID must remain unchanged");
  assert(turn.tokens <= 256, "Memory Turn Recall keeps its existing 256 token cap");
  console.log("V8.6.1 Memory Regression: PASS (stable/direct/mentioned/topic/turn selected IDs and budget)");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
