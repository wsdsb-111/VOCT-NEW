"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { MemoryEngine, MemoryRanker } = require("../resources/app/out/main/memory-system");
const { TokenCounter } = require("../resources/app/out/main/provider-service");

const estimateTokens = text => TokenCounter.estimateTokens(text);
const root = fs.mkdtempSync(path.join(os.tmpdir(), "votc-recall-promises-"));
try {
  const summaries = path.join(root, "summaries");
  const folder = path.join(summaries, "2_甲");
  fs.mkdirSync(folder, { recursive: true });
  const promise = "下月初一带乙入宫见皇后，若获同意再议婚事。";
  const longContent = `【本场经过】\n${"二人在城中游览谈天。".repeat(500)}\n\n【需要长期记住的事项】\n- ${promise}\n- 这是约定，尚未履行。`;
  const row = (id, day, counterpart, content, pinned = false) => ({ finalizationId: id, totalDays: day, date: `1169年${day}月1日`, playerId: 2, characterId: counterpart, content, pinned });
  // A short bystander projection sorts before the complete private pair file.
  fs.writeFileSync(path.join(folder, "与A旁人的对话.json"), JSON.stringify([row("old-promise", 1, 3, "旁人只听见寒暄。"), row("same-copy", 0, 3, "共同见闻。", true)]));
  fs.writeFileSync(path.join(folder, "与乙的对话.json"), JSON.stringify([
    row("newest", 3, 1, "本月再次相见。"), row("second", 2, 1, "近日交换书信。"),
    row("old-promise", 1, 1, longContent, true), row("same-copy", 0, 1, "共同见闻。", true)
  ]));
  const engine = new MemoryEngine({ baseDir: path.join(root, "memory"), summaryFoldersDir: summaries, trace: { record() {} } });
  const loaded = engine.loadOwnerFolderMemories(2);
  const direct = engine.store.loadDirectPairSummaries(2, 1, loaded);
  assert(direct.find(m => m.provenance.finalizationId === "old-promise").content.includes(promise), "pair projection must not be replaced by the first bystander file");
  assert.equal(loaded.filter(m => m.provenance.finalizationId === "same-copy").length, 1, "identical session copies still deduplicate");
  assert.equal(loaded.filter(m => m.provenance.finalizationId === "old-promise").length, 2, "different directed projections retain their own content");
  const sessionRecallCache = new Map();
  const options = { characterId: 2, directCounterpartIds: [1], tokenBudget: 800, estimateTokens, sessionRecallCache };
  const recall = engine.retrieveForResponder(options);
  for (const id of ["newest", "second", "old-promise"]) assert(recall.direct.some(e => e.memory.provenance.finalizationId === id), "latest THREE distinct conversations must be selected");
  assert(recall.directStableText.includes(promise), "long-term tail promise must reach the frozen prompt block");
  assert(recall.direct.some(e => e.memory.provenance.finalizationId === "same-copy"), "an older pinned record remains eligible after three recent ones");
  assert(recall.selectedTokens <= 800);
  assert(!recall.directStableText.includes("旁人只听见"));
  assert.equal(engine.retrieveForResponder({ ...options, query: "谈谈天气" }).directStableText, recall.directStableText, "ordinary turns keep recall frozen");
  assert(engine.loadOwnerFolderMemories(2).find(m => m.content === longContent), "retrieval must never rewrite stored summary bodies");
  assert.equal(engine.retrieveForResponder({ characterId: 3, directCounterpartIds: [1], tokenBudget: 800 }).direct.length, 0, "no fallback into another owner's folder");
  const group = engine.retrieveForResponder({ ...options, sessionRecallCache: new Map(), directCounterpartIds: [1, 3] });
  assert(group.direct.some(e => e.memory.content.includes(promise)), "multiplayer de-dup cannot erase the private pair projection");
  assert(group.direct.some(e => e.memory.content.includes("旁人只听见")));
  assert(group.selectedTokens <= 800);
  const ranker = new MemoryRanker();
  const entry = { memory: { type: "folder_summary", importance: 0.65, content: longContent }, score: 1 };
  const fitted = ranker.selectWithinBudget([entry], { tokenBudget: 200, estimateTokens, allowTruncate: true });
  assert(fitted[0].memory.content.includes(promise));
  assert(fitted[0].tokens <= 200);
  assert.equal(entry.memory.content, longContent);
  assert.equal(ranker.selectWithinBudget([entry], { tokenBudget: 0, estimateTokens, allowTruncate: true }).length, 0);
  const short = { ...entry, memory: { ...entry.memory, content: "未分段的旧版摘要。" } };
  assert.equal(ranker.selectWithinBudget([short], { tokenBudget: 200, estimateTokens })[0].memory.content, short.memory.content);
  console.log("Summary recall promises: PASS (direct projections, latest three, pinned tail, budget, freeze and owner isolation)");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
