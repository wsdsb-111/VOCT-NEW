"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { MemoryEngine } = require("../resources/app/out/main/memory-system/memory-engine");
const { createMemoryRecord } = require("../resources/app/out/main/memory-system/memory-types");
const { buildDualTemporalIndex, selectDualTemporalExtras } = require("../resources/app/out/main/memory-system/summary-date-index");
const { resolveTemporalFocus } = require("../resources/app/out/main/memory-system/fuzzy-temporal-resolver");
const { createSummariesManager } = require("../resources/app/out/main/summaries/summaries-manager");
const { buildSummaryCatalogEntry } = require("../resources/app/out/main/memory-system/summary-catalog");
const { WorldlineService } = require("../resources/app/out/main/worldline/worldline-service");

async function main() {
  const responderId = 2;
  const playerId = 1;
  const otherNpcId = 3;
  const campaignToken = "campaign-live";
  const temporal = resolveTemporalFocus("你还记得二十年前的事情吗？", null, {
  currentGameDate: "1170.6.1", currentTotalDays: 9000, turnEpoch: 1, conversationId: "multi-npc", sceneRevision: "scene"
  });

  function conversationSummary(memoryId, counterpartId, date = "1150.6.1") {
  return createMemoryRecord({
    memoryId, type: "folder_summary", subtype: "conversation_summary", eventDate: date,
    participants: [responderId, counterpartId], subjects: [counterpartId], content: `${memoryId} 的旧对话摘要`,
    canonicalText: `${memoryId} 的旧对话摘要`, knownBy: [responderId], visibility: "known_group",
    provenance: { folderOwnerId: responderId, counterpartId, counterpartIds: [counterpartId], campaignToken, temporalRefs: [] }
  });
  }

  const playerSummary = conversationSummary("player-old", playerId);
  const otherNpcSummary = conversationSummary("npc-old", otherNpcId);
  const temporalMemories = [playerSummary, otherNpcSummary];
  const temporalIndex = [
  ...buildDualTemporalIndex([playerSummary], { ownerId: responderId, counterpartId: playerId, currentGameDate: "1170.6.1", currentTotalDays: 9000, campaignToken }),
  ...buildDualTemporalIndex([otherNpcSummary], { ownerId: responderId, counterpartId: otherNpcId, currentGameDate: "1170.6.1", currentTotalDays: 9000, campaignToken })
  ];
  const preferred = selectDualTemporalExtras(temporalIndex, temporalMemories, temporal, {
  query: "你还记得二十年前的事情吗？", directCounterpartIds: [playerId, otherNpcId], querySpeakerId: playerId, limit: 1
  });
  assert.equal(preferred[0]?.memory.memoryId, "player-old", "the player who asked must be the direct-conversation guarantee in a multi-NPC scene");
  const fallback = selectDualTemporalExtras(temporalIndex, temporalMemories, temporal, {
  query: "你还记得二十年前的事情吗？", directCounterpartIds: [otherNpcId], querySpeakerId: null, limit: 1
  });
  assert.equal(fallback[0]?.memory.memoryId, "npc-old", "direct counterparts remain a fallback when the actual speaker is unavailable");

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v81321-hotfix-"));
  try {
  const summaryFoldersDir = path.join(tempRoot, "summaries");
  const ownerFolder = path.join(summaryFoldersDir, "2_岳飞");
  fs.mkdirSync(ownerFolder, { recursive: true });
  const summariesPath = path.join(ownerFolder, "与玩家的对话.json");
  const summaries = [
    { playerId: 2, playerName: "岳飞", characterId: 1, characterName: "玩家", date: "1149.1.1", content: "campaign-A 已绑定", campaignToken: "campaign-A", campaignBinding: { status: "bound", source: "native", version: 1 } },
    { playerId: 2, playerName: "岳飞", characterId: 1, characterName: "玩家", date: "1148.1.1", content: "campaign-B 已绑定", campaignToken: "campaign-B", campaignBinding: { status: "bound", source: "native", version: 1 } },
    { playerId: 2, playerName: "岳飞", characterId: 1, characterName: "玩家", date: "1147.1.1", content: "用户选中的旧摘要", campaignToken: null, campaignBinding: { status: "unresolved", reason: "NO_UNIQUE_EPISODE_EVIDENCE", version: 1 } },
    { playerId: 2, playerName: "岳飞", characterId: 1, characterName: "玩家", date: "1146.1.1", content: "同文件未选中的旧摘要", campaignToken: null, campaignBinding: { status: "unresolved", reason: "NO_UNIQUE_EPISODE_EVIDENCE", version: 1 } }
  ];
  fs.writeFileSync(summariesPath, JSON.stringify(summaries), "utf8");
  const engine = new MemoryEngine({ baseDir: path.join(tempRoot, "memory"), summaryFoldersDir, trace: { record: () => {} } });
  const conversation = { id: "binding-test", gameData: {
    campaignToken: "campaign-A", characters: new Map([[1, { id: 1 }], [2, { id: 2 }]]),
    loadCharactersSummaries() {}
  } };
  const SummariesManager = createSummariesManager({ fs, path, summariesDir: summaryFoldersDir, memoryEngine: engine,
    memorySystem: { buildSummaryCatalogEntry }, getCurrentConversation: () => conversation });
  const catalog = await SummariesManager.listAllSummaries();
  const metadata = catalog.find(entry => entry.ownerId === 2);
  const selected = metadata?.summaries.find(summary => summary.content === "用户选中的旧摘要");
  assert.match(selected?.legacyBindingId || "", /^legacy-summary:[a-f0-9]{64}$/);
  const bound = SummariesManager.bindLegacySummaryCampaign({ ownerId: 2, counterpartId: 1, summaryIds: [selected.legacyBindingId] });
  assert.equal(bound.boundCount, 1);
  const afterBinding = JSON.parse(fs.readFileSync(summariesPath, "utf8"));
  assert.equal(afterBinding[0].campaignToken, "campaign-A", "existing campaign-A summary must remain unchanged");
  assert.equal(afterBinding[1].campaignToken, "campaign-B", "existing campaign-B summary must remain unchanged");
  assert.equal(afterBinding[2].campaignToken, "campaign-A");
  assert.equal(afterBinding[2].campaignBinding.source, "user_confirmed_migration");
  assert.equal(afterBinding[3].campaignToken, null, "an unselected legacy summary in the same file must remain isolated");
  assert.throws(() => SummariesManager.bindLegacySummaryCampaign({ ownerId: 2, counterpartId: 1, summaryIds: [selected.legacyBindingId] }), /already_bound/,
    "stale UI action cannot rebind an already bound target");
  conversation.gameData.characters.delete(1);
  assert.throws(() => SummariesManager.bindLegacySummaryCampaign({ ownerId: 2, counterpartId: 1, summaryIds: [metadata.summaries[3].legacyBindingId] }), /character_not_in_current_campaign/);

  const recoveryFolder = path.join(summaryFoldersDir, "4_恢复角色");
  fs.mkdirSync(recoveryFolder, { recursive: true });
  fs.writeFileSync(path.join(recoveryFolder, "与玩家的对话.json"), JSON.stringify([
    { finalizationId: "episode-after-recovery", playerId: 4, characterId: 1, date: "1150.1.1", content: "先前缺少 Episode 证据", campaignToken: null }
  ]), "utf8");
  const recoveryEngine = new MemoryEngine({ baseDir: path.join(tempRoot, "memory-recovery"), summaryFoldersDir, trace: { record: () => {} } });
  const beforeRecovery = recoveryEngine.loadOwnerFolderMemories(4);
  assert.equal(beforeRecovery[0]?.provenance.campaignBinding.reason, "NO_UNIQUE_EPISODE_EVIDENCE");
  assert.equal(recoveryEngine.summaryCampaignMigrationOwners.has(4), true);
  recoveryEngine.commitFinalization({ finalizationId: "episode-after-recovery", conversationId: "recovered", campaignToken: "campaign-A",
    participants: [{ id: 4 }, { id: 1 }], date: "1170.6.1" }, { memories: [], sessionSummary: "恢复后的 Episode", summarySegments: [] });
  assert.equal(recoveryEngine.summaryCampaignMigrationOwners.has(4), false, "a committed Episode must reopen migration for its participants");
  assert.equal(recoveryEngine.loadOwnerFolderMemories(4)[0]?.provenance.campaignToken, "campaign-A", "new Episode evidence should bind without restarting the process");

  const diagnosticMemories = Array.from({ length: 10 }, (_, index) => createMemoryRecord({
    memoryId: `diag-${index}`, type: "folder_summary", subtype: "conversation_summary", eventDate: "1160.1.1",
    participants: [2, 1], subjects: [1], content: `摘要 ${index}`, canonicalText: `摘要 ${index}`, knownBy: [2], visibility: "known_group",
    provenance: { folderOwnerId: 2, counterpartId: 1, counterpartIds: [1], campaignToken: index < 6 ? "campaign-A" : index < 9 ? null : "campaign-B" }
  }));
  const diagnosticEngine = new MemoryEngine({ baseDir: path.join(tempRoot, "memory-diagnostics"), trace: { record: () => {} } });
  const retrieval = diagnosticEngine.retrieveForResponder({ characterId: 2, query: "普通问题", directCounterpartIds: [1],
    ownerFolderMemories: diagnosticMemories, campaignToken: "campaign-A", currentGameDate: "1170.6.1", currentTotalDays: 9000,
    memoryEngine3Enabled: true, temporalSummaryRecallEnabled: false, tokenBudget: 1000, estimateTokens: text => String(text).length,
    mentionedRecallCache: new Map(), sessionRecallCache: new Map() });
  assert.equal(retrieval.temporalDiagnostics.folderMemoryCount, 10, "diagnostics count the raw owner-folder snapshot");
  assert.equal(retrieval.temporalDiagnostics.campaignAcceptedCount, 6);
  assert.equal(retrieval.temporalDiagnostics.campaignRejectedCount, 4);
  assert.equal(retrieval.temporalDiagnostics.legacyCampaignRejectedCount, 3);

  const patchFacts = Array.from({ length: 20 }, (_, index) => ({ factId: `fact-${index}`, entityId: String(index + 1), field: "IDENTITY",
    value: `获准事实${index}。当前获准信息`, sourceTier: "GAME_TRUTH" }));
  const patch = WorldlineService.prototype.getSubjectiveCoveragePatch.call({
    isSubjectivePromptIntegrationEnabled: () => true,
    getSubjectiveWorldView: () => ({ checkpointId: "cp", promptFacts: patchFacts })
  }, { responderId: 1, query: "概况", tokenBudget: 300 });
  assert.equal(patch.patchCandidateCount, 20);
  assert(patch.patchSelectedCount < patch.patchCandidateCount);
  assert.equal(patch.patchTruncated, true);
  assert(patch.patchText.includes("以下仅为当前上下文预算内可提供的部分获准事实，不代表完整列表。"));
  assert.equal(WorldlineService.prototype.getSubjectiveCoveragePatch.call({
    isSubjectivePromptIntegrationEnabled: () => true,
    getSubjectiveWorldView: () => ({ checkpointId: "cp", promptFacts: [patchFacts[0]] })
  }, { responderId: 1, query: "概况", tokenBudget: 300 }).patchTruncated, false, "complete patch remains unmarked");

  const preloadSource = fs.readFileSync(path.join(__dirname, "../resources/app/out/preload/preload.js"), "utf8");
  const rendererBundle = fs.readFileSync(path.join(__dirname, "../resources/app/out/renderer/assets/index-Dn3qWlAB.js"), "utf8");
  assert.match(preloadSource, /bindLegacySummaryCampaign/);
  assert.match(rendererBundle, /绑定当前战役/);
  assert.match(rendererBundle, /只修改此摘要/);
  } finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
  }

  console.log("V8.13.2.1 Acceptance Hotfix: PASS (speaker-specific temporal guarantee, explicit legacy binding, raw diagnostics, migration retry, partial patch warning)");
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
