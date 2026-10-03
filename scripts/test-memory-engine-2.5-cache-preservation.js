"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const root = path.resolve(__dirname, "..");
const mainDir = path.join(root, "resources", "app", "out", "main");
const { MemoryEngine } = require(path.join(mainDir, "memory-system"));
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "votc-memory-25-cache-"));
const campaignToken = "memory-engine-2.5-cache-test";

try {
  const summaryFoldersDir = path.join(tempDir, "summaries");
  const ownerFolder = path.join(summaryFoldersDir, "2_乙");
  fs.mkdirSync(ownerFolder, { recursive: true });
  fs.writeFileSync(path.join(ownerFolder, "与甲的对话.json"), JSON.stringify([
    { playerId: 2, characterId: 1, totalDays: 30, date: "1000年1月30日", finalizationId: "garden", campaignToken, content: "二人曾在花园约定再会。" },
    { playerId: 2, characterId: 1, totalDays: 20, date: "1000年1月20日", finalizationId: "letter", campaignToken, content: "二人曾互通书信。" },
    { playerId: 2, characterId: 1, totalDays: 1, date: "1000年1月1日", finalizationId: "promise", campaignToken, content: "乙答应甲永远守住城门。", pinned: true, open: true }
  ]), "utf8");
  const engine = new MemoryEngine({ baseDir: path.join(tempDir, "memory"), summaryFoldersDir, recoveryDir: path.join(tempDir, "recovery"), trace: { record() {} } });
  const ownerFolderMemories = engine.store.loadFolderSummariesForCharacter(2);
  const sessionCache = new Map();
  const base = { characterId: 2, directCounterpartIds: [1], mentionedEntityIds: [1], mentionedEntityNames: { 1: ["甲"] }, ownerFolderMemories, currentTotalDays: 120, campaignToken, tokenBudget: 800, estimateTokens: (text) => Math.ceil(String(text).length / 2), sessionRecallCache: sessionCache };
  const first = engine.retrieveForResponder({ ...base, query: "还记得花园之约吗" });
  const second = engine.retrieveForResponder({ ...base, query: "说说那封信" });
  assert.deepStrictEqual(second.direct, first.direct, "frozen direct recall must not re-rank per turn");
  assert.deepStrictEqual(second.stable, first.stable, "stable memory must remain frozen");
  const topicCache = new Map();
  const firstTopic = engine.retrieveForResponder({ ...base, directCounterpartIds: [], query: "甲的花园细节", sessionRecallCache: topicCache, turnEpoch: 1 });
  engine.commitDynamicSummaryRecall(2, topicCache, 1, {
    providerSucceeded: true,
    injectedBlockIds: ["memory-temporal-extra"],
    injectedMemoryIds: firstTopic.extra.map(entry => entry.memory.memoryId),
    injectedTokens: firstTopic.extra.reduce((total, entry) => total + entry.tokens, 0)
  });
  const secondTopic = engine.retrieveForResponder({ ...base, directCounterpartIds: [], query: "甲的书信细节", sessionRecallCache: topicCache, turnEpoch: 2 });
  assert(firstTopic.extra.length > 0);
  assert(secondTopic.extra.every(entry => !firstTopic.extra.some(previous => previous.memory.memoryId === entry.memory.memoryId)), "successful Extra stays in contextual history and must not be freshly injected again");
  assert.match(firstTopic.temporalExtraText || "", /本轮召回摘要/);

  const promptSource = fs.readFileSync(path.join(mainDir, "prompts", "prompt-builder.js"), "utf8");
  assert(promptSource.indexOf('id: "memory-temporal-extra"') < promptSource.indexOf('id: "memory-turn-recall"'), "dynamic Extra must precede Turn Recall");
  assert(promptSource.indexOf('id: `${block.id || "history"}-current-user`') < promptSource.indexOf('id: "memory-turn-recall"'), "Turn Recall must be inserted after Current User Message");
  console.log("Memory Engine cache preservation: PASS (frozen lanes, dynamic Extra, turn-tail order)");
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
