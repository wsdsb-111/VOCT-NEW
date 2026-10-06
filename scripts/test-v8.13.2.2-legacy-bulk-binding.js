"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { MemoryEngine } = require("../resources/app/out/main/memory-system/memory-engine");
const { createSummariesManager } = require("../resources/app/out/main/summaries/summaries-manager");
const { buildSummaryCatalogEntry } = require("../resources/app/out/main/memory-system/summary-catalog");

function summary(ownerId, counterpartId, date, content, extra = {}) {
  return { playerId: ownerId, characterId: counterpartId, date, content, campaignToken: null, ...extra };
}

function writeSummaries(root, folder, file, summaries) {
  const directory = path.join(root, folder);
  fs.mkdirSync(directory, { recursive: true });
  const filePath = path.join(directory, file);
  fs.writeFileSync(filePath, JSON.stringify(summaries), "utf8");
  return filePath;
}

function createManager(root, campaignToken = "campaign-A", ownerId = 2, currentCounterpartIds = [1]) {
  const summaryFoldersDir = path.join(root, "summaries");
  const engine = new MemoryEngine({ baseDir: path.join(root, "memory"), summaryFoldersDir, trace: { record: () => {} } });
  let refreshedMemories = null;
  const frozenSnapshot = { prefixFingerprint: "unchanged-prefix-fingerprint" };
  const prefixByResponder = new Map([[ownerId, frozenSnapshot]]);
  const characters = new Map([[ownerId, { id: ownerId }], ...currentCounterpartIds.map(id => [id, { id }])]);
  const conversation = { id: "bulk-binding-test", cacheV2FrozenSnapshots: { prefixByResponder }, gameData: {
    campaignToken,
    characters,
    loadCharactersSummaries: () => { refreshedMemories = engine.loadOwnerFolderMemories(ownerId); }
  } };
  const SummariesManager = createSummariesManager({ fs, path, summariesDir: summaryFoldersDir, memoryEngine: engine,
    memorySystem: { buildSummaryCatalogEntry }, getCurrentConversation: () => conversation });
  return { engine, SummariesManager, conversation, frozenSnapshot, prefixByResponder, getRefreshedMemories: () => refreshedMemories };
}

async function main() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v81322-bulk-binding-"));
  try {
    const conversationPath = writeSummaries(path.join(tempRoot, "conversation", "summaries"), "2_岳飞", "与玩家的对话.json", [
      summary(2, 1, "1169.1.1", "当前战役内容不应变化", { campaignToken: "campaign-A", campaignBinding: { status: "bound", source: "native", version: 1 } }),
      summary(2, 1, "1148.1.1", "待迁移内容一"),
      summary(2, 1, "1147.1.1", "待迁移内容二", { campaignBinding: { status: "unresolved", reason: "NO_UNIQUE_EPISODE_EVIDENCE", version: 1 } }),
      summary(2, 1, "1146.1.1", "其他 Campaign 内容", { campaignToken: "campaign-B", campaignBinding: { status: "bound", source: "native", version: 1 } }),
      summary(2, 1, "1145.1.1", "官方追忆不迁移", { sourceType: "CK3_OFFICIAL_RECOLLECTION" })
    ]);
    const conversationFixture = createManager(path.join(tempRoot, "conversation"));
    const preview = await conversationFixture.SummariesManager.previewLegacyConversationBinding({ ownerId: 2, counterpartId: 1,
      folderName: "2_岳飞", conversationFile: "与玩家的对话.json" });
    assert.equal(preview.scannedFiles, 1);
    assert.equal(preview.scannedSummaries, 5);
    assert.equal(preview.bindableCount, 2);
    assert.equal(preview.alreadyCurrentCount, 1);
    assert.equal(preview.otherCampaignCount, 1);
    assert.equal(preview.officialCount, 1);
    assert.equal(preview.targetIds.length, 2);
    const conversationResult = await conversationFixture.SummariesManager.bindLegacyConversationCampaign({ ownerId: 2, counterpartId: 1,
      folderName: "2_岳飞", conversationFile: "与玩家的对话.json", expectedCampaignToken: "campaign-A", previewRevision: preview.previewRevision });
    assert.equal(conversationResult.boundCount, 2);
    const conversationAfter = JSON.parse(fs.readFileSync(conversationPath, "utf8"));
    assert.equal(conversationAfter[0].campaignBinding.source, "native", "native current-campaign metadata is preserved");
    assert.equal(conversationAfter[1].campaignToken, "campaign-A");
    assert.equal(conversationAfter[1].campaignBinding.source, "user_confirmed_bulk_migration");
    assert.equal(conversationAfter[2].campaignToken, "campaign-A");
    assert.equal(conversationAfter[3].campaignToken, "campaign-B", "other campaign is never overwritten");
    assert.deepEqual(conversationAfter[4], summary(2, 1, "1145.1.1", "官方追忆不迁移", { sourceType: "CK3_OFFICIAL_RECOLLECTION" }), "official recollection is preserved by bulk binding and automatic legacy migration");
    assert.equal(conversationFixture.prefixByResponder.has(2), false, "V8.15 summary mutations invalidate the old frozen memory prefix");
    assert.equal(conversationFixture.getRefreshedMemories().some(memory => memory.content === "待迁移内容一" && memory.provenance.campaignToken === "campaign-A"), true,
      "the current conversation refresh sees the newly bound summary");
    conversationFixture.prefixByResponder.set(2, conversationFixture.frozenSnapshot);
    const recalled = conversationFixture.engine.retrieveForResponder({ characterId: 2, query: "你还记得二十三年前的事情吗？",
      directCounterpartIds: [1], querySpeakerId: 1, ownerFolderMemories: conversationFixture.getRefreshedMemories(),
      currentGameDate: "1170.6.1", campaignToken: "campaign-A", conversationId: "bulk-binding-test", sceneRevision: "scene", turnEpoch: 1,
      tokenBudget: 1600, estimateTokens: text => text.length });
    assert.equal(recalled.direct.concat(recalled.extra).some(entry => entry.memory.content === "待迁移内容二"), true,
      "newly bound historical content remains available through the direct or temporal recall route");
    assert.equal(conversationFixture.prefixByResponder.get(2), conversationFixture.frozenSnapshot, "temporal recall leaves the frozen prefix unchanged");

    const ownerRoot = path.join(tempRoot, "owner");
    const ownerSummariesDir = path.join(ownerRoot, "summaries");
    const ownerFile1 = writeSummaries(ownerSummariesDir, "2_岳飞", "与甲的对话.json", [
      summary(2, 3, "1150.1.1", "Owner 批量迁移 1"),
      summary(2, 3, "1150.2.1", "本战役已绑定", { campaignToken: "campaign-A", campaignBinding: { status: "bound", source: "native", version: 1 } }),
      summary(2, 3, "1150.3.1", "其他战役保留", { campaignToken: "campaign-B" }),
      summary(2, 3, "1150.4.1", "官方追忆保留", { type: "official_recollection" })
    ]);
    const ownerFile2 = writeSummaries(ownerSummariesDir, "2_岳飞", "与乙的对话.json", [
      summary(2, 4, "1151.1.1", "Owner 批量迁移 2"),
      summary(2, 4, "1151.2.1", "Owner 批量迁移 3"),
      { date: "1151.3.1", content: "缺少稳定对话对象 ID", playerId: 2, characterId: null, campaignToken: null },
      { playerId: 2, characterId: 4, content: 17, campaignToken: null }
    ]);
    const invalidFile = path.join(path.dirname(ownerFile2), "legacy-broken.json");
    fs.writeFileSync(invalidFile, "{invalid json", "utf8");
    const ownerFixture = createManager(ownerRoot, "campaign-A", 2, [1]);
    const ownerPreview = await ownerFixture.SummariesManager.previewLegacyOwnerBinding({ ownerId: 2 });
    ownerFixture.conversation.gameData.loadCharactersSummaries = () => {};
    assert.equal(ownerPreview.scannedFiles, 3);
    assert.equal(ownerPreview.scannedSummaries, 8);
    assert.equal(ownerPreview.bindableCount, 3, "historical numeric counterpart IDs may bind even when those characters are not in the active scene");
    assert.equal(ownerPreview.alreadyCurrentCount, 1);
    assert.equal(ownerPreview.otherCampaignCount, 1);
    assert.equal(ownerPreview.officialCount, 1);
    assert.equal(ownerPreview.unresolvedCounterpartCount, 1);
    assert.equal(ownerPreview.invalidSummaryCount, 1);
    assert.equal(ownerPreview.invalidFileCount, 1, "malformed files are reported during preview rather than failing during commit");
    assert.equal(ownerPreview.files.length, 3);

    const stalePath = ownerFile1;
    const changedRows = JSON.parse(fs.readFileSync(stalePath, "utf8"));
    changedRows[0].content = "Preview 后发生变化";
    fs.writeFileSync(stalePath, JSON.stringify(changedRows), "utf8");
    const bytesBeforeStaleCommit = [ownerFile1, ownerFile2, invalidFile].map(file => fs.readFileSync(file));
    await assert.rejects(() => ownerFixture.SummariesManager.bindLegacyOwnerCampaign({ ownerId: 2, expectedCampaignToken: "campaign-A",
      previewRevision: ownerPreview.previewRevision }), /legacy_binding_preview_stale/);
    [ownerFile1, ownerFile2, invalidFile].forEach((file, index) => assert.deepEqual(fs.readFileSync(file), bytesBeforeStaleCommit[index], "stale commit must not write any file"));

    const freshOwnerPreview = await ownerFixture.SummariesManager.previewLegacyOwnerBinding({ ownerId: 2 });
    const originalWriteJson = ownerFixture.engine.store.writeJson.bind(ownerFixture.engine.store);
    let failOwnerSecondFile = true;
    ownerFixture.engine.store.writeJson = (filePath, value) => {
      if (failOwnerSecondFile && path.resolve(filePath) === path.resolve(ownerFile2)) {
        failOwnerSecondFile = false;
        throw new Error("injected_second_file_write_failure");
      }
      return originalWriteJson(filePath, value);
    };
    const beforeRollback = [ownerFile1, ownerFile2].map(file => fs.readFileSync(file));
    await assert.rejects(() => ownerFixture.SummariesManager.bindLegacyOwnerCampaign({ ownerId: 2, expectedCampaignToken: "campaign-A",
      previewRevision: freshOwnerPreview.previewRevision }), /injected_second_file_write_failure/);
    [ownerFile1, ownerFile2].forEach((file, index) => assert.deepEqual(fs.readFileSync(file), beforeRollback[index], "multi-file journal must roll back all files if a write fails"));
    ownerFixture.engine.store.writeJson = originalWriteJson;
    const ownerResult = await ownerFixture.SummariesManager.bindLegacyOwnerCampaign({ ownerId: 2, expectedCampaignToken: "campaign-A",
      previewRevision: freshOwnerPreview.previewRevision });
    assert.equal(ownerResult.boundCount, 3);
    assert.equal(JSON.parse(fs.readFileSync(ownerFile1, "utf8"))[1].campaignBinding.source, "native");
    assert.equal(JSON.parse(fs.readFileSync(ownerFile1, "utf8"))[2].campaignToken, "campaign-B");
    assert.equal(JSON.parse(fs.readFileSync(ownerFile1, "utf8"))[3].type, "official_recollection");
    assert.equal(JSON.parse(fs.readFileSync(ownerFile2, "utf8"))[2].campaignToken, null, "unresolved counterpart rows stay untouched");
    assert.equal(JSON.parse(fs.readFileSync(ownerFile2, "utf8"))[3].content, 17, "invalid summary rows stay untouched");

    const delayedRoot = path.join(tempRoot, "delayed");
    const delayedSummariesDir = path.join(delayedRoot, "summaries");
    writeSummaries(delayedSummariesDir, "2_岳飞", "与甲的对话.json", [summary(2, 3, "1150.1.1", "等待游戏数据")]);
    const delayedEngine = new MemoryEngine({ baseDir: path.join(delayedRoot, "memory"), summaryFoldersDir: delayedSummariesDir, trace: { record: () => {} } });
    let resolveGameData;
    const delayedConversation = { id: "delayed-game-data", gameData: null, gameDataReady: new Promise(resolve => { resolveGameData = resolve; }) };
    const delayedManager = createSummariesManager({ fs, path, summariesDir: delayedSummariesDir, memoryEngine: delayedEngine,
      memorySystem: { buildSummaryCatalogEntry }, getCurrentConversation: () => delayedConversation });
    let previewSettled = false;
    const delayedPreviewPromise = delayedManager.previewLegacyOwnerBinding({ ownerId: 2 }).then(value => { previewSettled = true; return value; });
    await Promise.resolve();
    assert.equal(previewSettled, false, "binding preview waits while current conversation GameData is still loading");
    delayedConversation.gameData = { campaignToken: "campaign-A", characters: new Map([[2, { id: 2 }]]) };
    resolveGameData();
    const delayedPreview = await delayedPreviewPromise;
    assert.equal(delayedPreview.bindableCount, 1, "binding preview resumes once the same conversation GameData is ready");

    const noSessionManager = createSummariesManager({ fs, path, summariesDir: delayedSummariesDir, memoryEngine: delayedEngine,
      memorySystem: { buildSummaryCatalogEntry }, getCurrentConversation: () => null });
    await assert.rejects(() => noSessionManager.previewLegacyOwnerBinding({ ownerId: 2 }), /legacy_binding_conversation_not_active/,
      "binding remains fail-closed when no current game conversation can establish Campaign identity");

    const preload = fs.readFileSync(path.join(__dirname, "../resources/app/out/preload/preload.js"), "utf8");
    const ipc = fs.readFileSync(path.join(__dirname, "../resources/app/out/main/ipc/register-ipc.js"), "utf8");
    const renderer = fs.readFileSync(path.join(__dirname, "../resources/app/out/renderer/assets/index-Dn3qWlAB.js"), "utf8");
    for (const api of ["previewLegacyConversationBinding", "bindLegacyConversationCampaign", "previewLegacyOwnerBinding", "bindLegacyOwnerCampaign"]) {
      assert(preload.includes(api), `preload exposes ${api}`);
      assert(ipc.includes(`conversation:${api}`), `main process registers ${api}`);
      assert(renderer.includes(api), `renderer calls ${api}`);
    }
    assert(renderer.includes("绑定本对话全部旧摘要"));
    assert(renderer.includes("绑定此人物全部旧摘要"));
    assert.match(renderer, /legacy_binding_preview_stale/);
    assert.match(renderer, /legacy_binding_conversation_not_active/);
    console.log("V8.13.2.2 Legacy Bulk Campaign Binding: PASS (scoped preview, fill-empty-only, stale rejection, multi-file rollback, current recall and frozen-prefix stability)");
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
