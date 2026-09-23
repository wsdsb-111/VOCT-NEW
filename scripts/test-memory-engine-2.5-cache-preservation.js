"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const root = path.resolve(__dirname, "..");
const mainDir = path.join(root, "resources", "app", "out", "main");
const { MemoryEngine } = require(path.join(mainDir, "memory-system"));
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "votc-memory-25-cache-"));
const memory = (id, content) => ({ memoryId: id, type: "folder_summary", epistemicStatus: "known", content, canonicalText: content, tags: [], subjects: [1, 2], participants: [1, 2], importance: 0.8, confidence: 1, totalDays: 100, eventDate: "1000年1月1日", provenance: { folderOwnerId: 2, finalizationId: id } });

try {
  const engine = new MemoryEngine({ baseDir: path.join(tempDir, "memory"), summaryFoldersDir: path.join(tempDir, "summaries"), recoveryDir: path.join(tempDir, "recovery"), trace: { record() {} } });
  const sessionCache = new Map();
  const ownerFolderMemories = [memory("garden", "二人曾在花园约定再会。"), memory("letter", "二人曾互通书信。")];
  const base = { characterId: 2, directCounterpartIds: [1], ownerFolderMemories, currentTotalDays: 120, tokenBudget: 800, estimateTokens: (text) => Math.ceil(String(text).length / 2), sessionRecallCache: sessionCache };
  const first = engine.retrieveForResponder({ ...base, query: "还记得花园之约吗" });
  const second = engine.retrieveForResponder({ ...base, query: "说说那封信" });
  assert.deepStrictEqual(second.direct, first.direct, "frozen direct recall must not re-rank per turn");
  assert.deepStrictEqual(second.stable, first.stable, "stable memory must remain frozen");
  const topicCache = new Map();
  const firstTopic = engine.retrieveForResponder({ ...base, directCounterpartIds: [], query: "二人曾在花园约定再会", sessionRecallCache: topicCache });
  const secondTopic = engine.retrieveForResponder({ ...base, directCounterpartIds: [], query: "说说那封信", sessionRecallCache: topicCache });
  assert.notDeepStrictEqual(secondTopic.extra, firstTopic.extra, "Memory Engine 3.0 Extra is recalculated from the current query");
  assert.match(firstTopic.temporalExtraText || "", /动态时间与话题摘要/);

  const promptSource = fs.readFileSync(path.join(mainDir, "prompts", "prompt-builder.js"), "utf8");
  assert(promptSource.indexOf('id: "memory-temporal-extra"') < promptSource.indexOf('id: "memory-turn-recall"'), "dynamic Extra must precede Turn Recall");
  assert(promptSource.indexOf('id: `${block.id || "history"}-current-user`') < promptSource.indexOf('id: "memory-turn-recall"'), "Turn Recall must be inserted after Current User Message");
  console.log("Memory Engine cache preservation: PASS (frozen lanes, dynamic Extra, turn-tail order)");
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
