"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { MemoryEngine } = require("../resources/app/out/main/memory-system/memory-engine");
const { memoryMatchesCampaign } = require("../resources/app/out/main/memory-system/memory-types");
const { resolveTemporalFocus, detectTemporalAxisIntent } = require("../resources/app/out/main/memory-system/fuzzy-temporal-resolver");
const { extractTemporalAnchors } = require("../resources/app/out/main/memory-system/temporal-anchor-extractor");
const { buildDualTemporalIndex, selectDualTemporalExtras } = require("../resources/app/out/main/memory-system/summary-date-index");

const query = "你还记得五年前的事情吗？";
assert.equal(detectTemporalAxisIntent(query), "MEMORY_RECALL");
for (const genericRecall of ["你还记得二十年前的事情吗？", "你可还记得五年前？", "想起十年前了吗？", "你对三年前还有印象吗？"]) {
  assert.equal(detectTemporalAxisIntent(genericRecall), "MEMORY_RECALL", genericRecall);
}
const temporal = resolveTemporalFocus(query, null, { currentGameDate: "1150.6.1", currentTotalDays: 5000,
  turnEpoch: 1, conversationId: "conversation-a", sceneRevision: "scene-a" });
assert.equal(temporal.axisIntent, "MEMORY_RECALL");
assert.equal(temporal.targetGameYear, 1145);

const eventRef = { ...extractTemporalAnchors("1145年战争", { anchorGameDate: "1150.6.1", messageId: 1, speakerId: 1 })[0], segmentIds: ["segment-event"] };
const directConversation = { memoryId: "direct-conversation", eventDate: "1145.6.12", totalDays: null,
  content: "1145年与当前对话对象谈及旧事。", canonicalText: "与当前对话对象谈及旧事。", participants: [1, 2], subjects: [2],
  importance: 0.65, confidence: 0.9, provenance: { folderOwnerId: 1, counterpartId: 2, counterpartIds: [2],
    campaignToken: "campaign-a", temporalRefs: [], perspectiveMemoryIds: [] } };
const eventMemory = { ...directConversation, memoryId: "event-memory", eventDate: "1149.6.12",
  content: "1145年发生过一场战争。", canonicalText: "1145年战争。", provenance: { ...directConversation.provenance,
    temporalRefs: [eventRef], perspectiveMemoryIds: [] } };
const memories = [eventMemory, directConversation];
const index = buildDualTemporalIndex(memories, { ownerId: 1, counterpartId: 2, currentGameDate: "1150.6.1",
  currentTotalDays: 5000, campaignToken: "campaign-a" });
const genericRecall = selectDualTemporalExtras(index, memories, temporal, { query, directCounterpartIds: [2], limit: 1 });
assert.equal(genericRecall[0]?.memory.memoryId, "direct-conversation", "generic memory recall should guarantee the direct conversation counterpart in the target year");
const explicitEvent = resolveTemporalFocus("五年前那场战争", null, { currentGameDate: "1150.6.1", currentTotalDays: 5000,
  turnEpoch: 1, conversationId: "conversation-a", sceneRevision: "scene-a" });
assert.equal(explicitEvent.axisIntent, "EVENT");
assert.equal(selectDualTemporalExtras(index, memories, explicitEvent, { query: "五年前那场战争", limit: 1 })[0]?.reason.axis, "event");
assert.equal(detectTemporalAxisIntent("二十年前我们聊过什么？"), "CONVERSATION");
assert.equal(detectTemporalAxisIntent("你还记得二十年前那场战争吗？"), "EVENT");

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v8132-campaign-"));
try {
  const summaryFoldersDir = path.join(tempRoot, "summaries");
  const folder = path.join(summaryFoldersDir, "2_NPC");
  fs.mkdirSync(folder, { recursive: true });
  const summariesPath = path.join(folder, "与玩家的对话.json");
const summaries = [
    { finalizationId: "final-unique", playerId: 2, characterId: 1, date: "1150.1.1", content: "唯一战役证据" },
    { finalizationId: "recent-a", playerId: 2, characterId: 1, date: "1169.1.1", content: "较新的摘要 A", campaignToken: "campaign-a" },
    { finalizationId: "recent-b", playerId: 2, characterId: 1, date: "1168.1.1", content: "较新的摘要 B", campaignToken: "campaign-a" },
    { finalizationId: "final-ambiguous", playerId: 2, characterId: 1, date: "1146.1.1", content: "战役证据冲突" },
    { finalizationId: "final-missing", playerId: 2, characterId: 1, date: "1147.1.1", content: "没有对应事件" },
    { playerId: 2, characterId: 1, date: "1148.1.1", content: "缺少终局编号" }
  ];
  fs.writeFileSync(summariesPath, JSON.stringify(summaries), "utf8");
  const engine = new MemoryEngine({ baseDir: path.join(tempRoot, "memory"), summaryFoldersDir, trace: { record: () => {} } });
  engine.store.saveEpisode({ episodeId: "episode-unique", finalizationId: "final-unique", participants: [1, 2], campaignToken: "campaign-a" });
  engine.store.saveEpisode({ episodeId: "episode-ambiguous-a", finalizationId: "final-ambiguous", participants: [1, 2], campaignToken: "campaign-a" });
  engine.store.saveEpisode({ episodeId: "episode-ambiguous-b", finalizationId: "final-ambiguous", participants: [1, 2], campaignToken: "campaign-b" });
  const migrated = engine.loadOwnerFolderMemories(2);
  const byFinalization = new Map(migrated.map(memory => [memory.provenance.finalizationId, memory]));
  assert.equal(byFinalization.get("final-unique")?.provenance.campaignToken, "campaign-a");
  assert.equal(byFinalization.get("final-unique")?.provenance.campaignBinding.status, "bound");
  assert.equal(byFinalization.get("final-unique")?.provenance.campaignBinding.source, "migration");
  assert.equal(memoryMatchesCampaign(byFinalization.get("final-unique"), "campaign-a"), true);
  const legacyQuery = "你还记得二十年前的事情吗？";
  const recalled = engine.retrieveForResponder({ characterId: 2, query: legacyQuery, directCounterpartIds: [1], ownerFolderMemories: migrated,
    currentGameDate: "1170.6.1", currentTotalDays: 9000, campaignToken: "campaign-a", conversationId: "conversation-a",
    sceneRevision: "scene-a", turnEpoch: 1, tokenBudget: 3600, estimateTokens: text => text.length });
  assert.equal(recalled.temporal.targetGameYear, 1150);
  assert.equal(recalled.extra.length, 1, "migrated direct summary reaches the actual Extra injection route");
  assert.equal(recalled.extra[0].memory.provenance.finalizationId, "final-unique");
  assert.equal(recalled.temporalDiagnostics.axis, "MEMORY_RECALL");
  assert.deepEqual(recalled.temporalDiagnostics.selectedSummaryIds, [recalled.extra[0].memory.memoryId]);
  const isolated = engine.retrieveForResponder({ characterId: 2, query: legacyQuery, directCounterpartIds: [1], ownerFolderMemories: migrated,
    currentGameDate: "1170.6.1", currentTotalDays: 9000, campaignToken: "campaign-b", conversationId: "conversation-b",
    sceneRevision: "scene-b", turnEpoch: 1, tokenBudget: 3600, estimateTokens: text => text.length });
  assert.equal(isolated.extra.length, 0, "another campaign cannot recall the migrated summary");
  for (const finalizationId of ["final-ambiguous", "final-missing", null]) {
    const memory = migrated.find(item => item.provenance.finalizationId === finalizationId);
    assert(memory, `legacy projection ${finalizationId || "without finalizationId"} remains readable`);
    assert.equal(memory.provenance.campaignToken, null);
    assert.equal(memoryMatchesCampaign(memory, "campaign-a"), false, "uncertain campaign evidence stays isolated");
    assert.equal(memory.provenance.campaignBinding.status, "unresolved");
  }
  const persisted = JSON.parse(fs.readFileSync(summariesPath, "utf8"));
  assert.equal(persisted.find(summary => summary.finalizationId === "final-unique").campaignToken, "campaign-a");
  assert.equal(fs.existsSync(path.join(tempRoot, "memory", "summary-mutation.json")), false, "migration journal is cleared after commit");
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

console.log("V8.13.2 Temporal Recall: PASS (dual-axis routing, direct counterpart guarantee, conservative legacy campaign binding)");
