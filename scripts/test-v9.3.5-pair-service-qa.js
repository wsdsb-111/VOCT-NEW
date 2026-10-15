"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const sourceVersionPath = require.resolve("../src/app/main/version");
require.cache[sourceVersionPath] = {
  id: sourceVersionPath,
  filename: sourceVersionPath,
  loaded: true,
  exports: require("../resources/app/out/main/version")
};
const { MemoryStore } = require("../src/app/main/memory-system/memory-store");
const { createPairMemoryService } = require("../src/app/main/memory-system/pair-memory-service");
const { registerIpcHandlers } = require("../src/app/main/ipc/register-ipc");

const ownerId = 101;
const counterpartId = 202;
const sameNameCounterpartId = 303;
const campaignToken = "v935-pair-service-qa-campaign";
const otherCampaignToken = "untrusted-campaign-token";
const sameName = "同名人物";

function profile(id) {
  return { id, name: sameName, shortName: sameName, firstName: sameName, fullName: sameName };
}

function summary({ otherId, finalizationId, content, token = campaignToken, date = "1066.3.14" }) {
  const participants = [profile(ownerId), profile(otherId)];
  return {
    schemaVersion: 2,
    date,
    totalDays: 100,
    campaignToken: token,
    campaignBinding: token
      ? { status: "bound", source: "synthetic_fixture", version: 1 }
      : { status: "unresolved", reason: "CAMPAIGN_TOKEN_UNAVAILABLE", version: 1 },
    content,
    playerName: sameName,
    playerId: ownerId,
    characterName: sameName,
    characterId: otherId,
    conversationType: "pair",
    participants,
    perspectiveOwnerId: ownerId,
    finalizationId,
    conversationId: "conversation-" + finalizationId
  };
}

function createIpcHandlers(service, getCurrentConversation) {
  const handlers = new Map();
  const noop = () => undefined;
  const proxy = new Proxy({}, {
    get(target, key) {
      if (Object.hasOwn(target, key)) return target[key];
      return noop;
    }
  });
  const conversationManager = new Proxy({
    getCurrentConversation,
    onConversationUpdate: noop
  }, {
    get(target, key) {
      return Object.hasOwn(target, key) ? target[key] : noop;
    }
  });
  const SummariesManager = {
    getPairMemoryIndex: request => service.get(request),
    previewPairMemoryBackfill: request => service.preview(request),
    applyPairMemoryBackfill: request => service.apply(request),
    openPairMemorySource: request => service.open(request)
  };
  const electron = new Proxy({
    ipcMain: { handle: (channel, callback) => handlers.set(channel, callback) }
  }, { get(target, key) { return Object.hasOwn(target, key) ? target[key] : proxy; } });
  registerIpcHandlers({
    electron, settingsRepository: proxy, promptConfigManager: proxy, uuid: () => "fixture",
    VOTC_PROMPTS_DIR: "", TemplateEngine: proxy, exportPromptsZip: noop, letterManager: proxy,
    runFileManager: proxy, llmManager: proxy, providerRegistry: proxy, usageAnalytics: proxy,
    providerDiagnostics: proxy, actionRegistry: proxy, VOTC_ACTIONS_DIR: "", resolveI18nString: value => value,
    conversationManager, ActionEngine: proxy, VOTC_SUMMARIES_DIR: "", SummariesManager,
    memoryEngine: proxy, worldlineService: null
  });
  return handlers;
}

function assertStaticIpcContract() {
  const ipcPath = require.resolve("../src/app/main/ipc/register-ipc");
  const ipcSource = fs.readFileSync(ipcPath, "utf8");
  const methodList = 'for (const method of ["getPairMemoryIndex", "previewPairMemoryBackfill", "applyPairMemoryBackfill", "openPairMemorySource"])';
  const start = ipcSource.indexOf(methodList);
  assert.notEqual(start, -1, "the four Pair Memory IPC handlers are registered together");
  const routeSource = ipcSource.slice(start);
  const allowedMatch = routeSource.match(/const allowed = new Set\(\[([^\]]+)\]\)/);
  assert(allowedMatch, "Pair Memory IPC exposes an explicit request allowlist");
  const allowedKeys = [...allowedMatch[1].matchAll(/"([^"]+)"/g)].map(match => match[1]);
  assert.deepEqual(allowedKeys, [
    "ownerId", "counterpartId", "page", "pageSize", "sort", "search", "fromDate", "toDate",
    "previewRevision", "sourceSummaryKey", "expectedSourceRevision"
  ]);
  assert.match(routeSource, /Object\.keys\(request\)\.some\(key => !allowed\.has\(key\)\)/,
    "unknown Renderer fields are rejected");
  for (const forbidden of ["campaignToken", "path", "baseDir", "summaryFoldersDir", "relativeSummaryPath"]) {
    assert(!allowedKeys.includes(forbidden), "IPC must reject caller-supplied " + forbidden);
  }

  const preload = fs.readFileSync(require.resolve("../src/app/preload/preload"), "utf8");
  for (const method of ["getPairMemoryIndex", "previewPairMemoryBackfill", "applyPairMemoryBackfill", "openPairMemorySource"]) {
    assert(preload.includes(method + ': (request) => electron.ipcRenderer.invoke("conversation:' + method + '", request)'),
      "preload exposes the expected request pass-through for " + method);
  }
}

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "v935-pair-service-qa-"));
  try {
    const summaryFoldersDir = path.join(root, "summaries");
    const memoryBaseDir = path.join(root, "memory");
    const folderName = ownerId + "_" + sameName;
    const conversationFile = "与" + sameName + "的对话.json";
    const sourceFile = path.join(summaryFoldersDir, folderName, conversationFile);
    fs.mkdirSync(path.dirname(sourceFile), { recursive: true });
    const store = new MemoryStore({ baseDir: memoryBaseDir, summaryFoldersDir });
    const rows = [
      summary({ otherId: counterpartId, finalizationId: "bound-202",
        content: "会谈摘要\n【需要长期记住的事项】\n- 双方约定将金印留存在内库。"}),
      summary({ otherId: counterpartId, finalizationId: "unbound-202", token: null,
        content: "旧摘要\n【需要长期记住的事项】\n- 未绑定战役的旧记录不得写入索引。", date: "1066.3.13"}),
      summary({ otherId: sameNameCounterpartId, finalizationId: "bound-303",
        content: "另一场会谈摘要\n【需要长期记住的事项】\n- 同名人物将账册交由书记官保管。", date: "1066.3.15"})
    ];
    store.writeJson(sourceFile, rows);

    const gameData = {
      campaignToken,
      date: "1066.3.20",
      totalDays: 106,
      characters: new Map([[ownerId, profile(ownerId)], [counterpartId, profile(counterpartId)],
        [sameNameCounterpartId, profile(sameNameCounterpartId)]])
    };
    const conversation = { id: "synthetic-active-conversation", gameData };
    let currentConversation = conversation;
    const service = createPairMemoryService({ store, getCurrentConversation: () => currentConversation });
    const handlers = createIpcHandlers(service, () => currentConversation);
    const ipc = method => {
      const handler = handlers.get("conversation:" + method);
      assert.equal(typeof handler, "function", "IPC handler registered: " + method);
      return handler;
    };

    const getResponse = await ipc("getPairMemoryIndex")(null, {
      ownerId, counterpartId, page: 0, pageSize: 10, sort: "oldest"
    });
    assert.equal(getResponse.success, true, JSON.stringify(getResponse));
    assert.equal(getResponse.writable, true);
    assert.equal(getResponse.ownerName, sameName);
    assert.equal(getResponse.counterpartName, sameName);
    assert.equal(getResponse.page, 0);
    assert.equal(getResponse.pageSize, 10);
    assert.equal(getResponse.totalCount, 1, "only the bound source becomes an index item");
    assert.equal(getResponse.items.length, 1);
    assert.equal(getResponse.items[0].scope.campaignToken, campaignToken);
    assert.equal(getResponse.items[0].scope.ownerId, ownerId);
    assert.equal(getResponse.items[0].scope.counterpartId, counterpartId);
    assert.equal(getResponse.items[0].text, "双方约定将金印留存在内库。");
    assert.match(getResponse.items[0].source.sourceSummaryKey, /^pair-summary:/);
    assert.match(getResponse.items[0].source.sourceRevision, /^[a-f0-9]{64}$/);
    assert.equal(getResponse.diagnostics.skipReasons.CAMPAIGN_UNBOUND, 1,
      "unbound historical source is previewable but excluded from the active Campaign index");

    const previewAll = await ipc("previewPairMemoryBackfill")(null, { ownerId });
    assert.equal(previewAll.success, true, JSON.stringify(previewAll));
    assert.deepEqual(previewAll.pairs.map(pair => pair.counterpartId).sort((a, b) => a - b),
      [counterpartId, sameNameCounterpartId], "same display names remain distinct by numeric counterpart ID");
    assert(previewAll.pairs.every(pair => pair.counterpartName === sameName));
    assert(previewAll.pairs.every(pair => pair.previewRevision && pair.counts));
    const unconnectedService = createPairMemoryService({ store, getCurrentConversation: () => null });
    const unconnectedPreview = unconnectedService.preview({ ownerId, counterpartId });
    assert.equal(unconnectedPreview.success, true);
    assert.equal(unconnectedPreview.writable, false);
    const pairScope = { campaignToken, ownerId, counterpartId };
    const indexPath = store.pairLedger.indexPath(pairScope);
    assert.equal(fs.existsSync(indexPath), false, "read-only preview does not persist an index");
    assert.throws(() => unconnectedService.apply({ ownerId, counterpartId,
      previewRevision: unconnectedPreview.pairs[0].previewRevision }),
    error => error.message === "PAIR_INDEX_READ_ONLY");
    assert.equal(fs.existsSync(indexPath), false, "a disconnected session cannot write the index");

    const sourceItem = getResponse.items[0];
    const openResponse = await ipc("openPairMemorySource")(null, {
      ownerId, counterpartId, sourceSummaryKey: sourceItem.source.sourceSummaryKey,
      expectedSourceRevision: sourceItem.source.sourceRevision
    });
    assert.equal(openResponse.success, true, JSON.stringify(openResponse));
    assert.equal(openResponse.summary.content, rows[0].content);
    assert.equal(openResponse.summary.campaignToken, campaignToken);
    assert.equal(openResponse.summaryIndex, 0);
    assert.equal(openResponse.relativeSummaryPath, folderName + "/" + conversationFile);
    assert(!openResponse.relativeSummaryPath.split(/[\\/]/).includes(".."));

    const forgedServiceResult = service.get({ ownerId, counterpartId, campaignToken: otherCampaignToken,
      relativeSummaryPath: "../../outside.json", baseDir: root });
    assert.equal(forgedServiceResult.success, true);
    assert.equal(forgedServiceResult.items[0].scope.campaignToken, campaignToken,
      "service derives Campaign scope from the active conversation, not request fields");
    assert.equal(forgedServiceResult.items[0].source.relativeSummaryPath, folderName + "/" + conversationFile,
      "service resolves a source from its verified index, not a caller path");
    for (const extra of [
      { campaignToken: otherCampaignToken },
      { path: path.join(root, "outside.json") },
      { baseDir: root },
      { summaryFoldersDir }
    ]) {
      const rejected = await ipc("getPairMemoryIndex")(null, { ownerId, counterpartId, ...extra });
      assert.deepEqual(rejected, { success: false, error: "PAIR_INDEX_REQUEST_INVALID" });
    }
    const rejectedOpen = await ipc("openPairMemorySource")(null, {
      ownerId, counterpartId, sourceSummaryKey: sourceItem.source.sourceSummaryKey,
      expectedSourceRevision: sourceItem.source.sourceRevision, relativeSummaryPath: "../../outside.json"
    });
    assert.deepEqual(rejectedOpen, { success: false, error: "PAIR_INDEX_REQUEST_INVALID" });

    const sourceBytesBeforePreview = fs.readFileSync(sourceFile);
    const stalePreview = await ipc("previewPairMemoryBackfill")(null, { ownerId, counterpartId });
    assert.equal(stalePreview.success, true);
    assert.deepEqual(fs.readFileSync(sourceFile), sourceBytesBeforePreview, "preview never edits the Legacy source");
    const changedRows = rows.map((row, index) => index === 0
      ? { ...row, content: "会谈摘要已修订\n【需要长期记住的事项】\n- 双方改约将金印保存在宫库。" }
      : row);
    store.writeJson(sourceFile, changedRows);
    store.invalidateFolderSummaryCache([ownerId]);
    const staleApply = await ipc("applyPairMemoryBackfill")(null, {
      ownerId, counterpartId, previewRevision: stalePreview.pairs[0].previewRevision
    });
    assert.deepEqual(staleApply, { success: false, error: "PAIR_INDEX_PREVIEW_STALE" },
      "confirmation against a changed source is rejected without a stale write");
    assert.equal(fs.existsSync(indexPath), false);
    assert.throws(() => service.open({ ownerId, counterpartId,
      sourceSummaryKey: sourceItem.source.sourceSummaryKey,
      expectedSourceRevision: sourceItem.source.sourceRevision }),
    error => error.message === "SOURCE_UNAVAILABLE_OR_STALE",
    "an old SourceKey + expected revision cannot open changed source bytes");

    const currentPreview = await ipc("previewPairMemoryBackfill")(null, { ownerId, counterpartId });
    assert.equal(currentPreview.success, true);
    const applyResponse = await ipc("applyPairMemoryBackfill")(null, {
      ownerId, counterpartId, previewRevision: currentPreview.pairs[0].previewRevision
    });
    assert.equal(applyResponse.success, true, JSON.stringify(applyResponse));
    assert.equal(applyResponse.ownerId, ownerId);
    assert.equal(applyResponse.counterpartId, counterpartId);
    assert.equal(applyResponse.pairs[0].itemCount, 1);
    assert(fs.existsSync(indexPath), "confirmed apply atomically creates the scoped index");
    const persistedIndex = JSON.parse(fs.readFileSync(indexPath, "utf8"));
    assert.equal(persistedIndex.pairScope.campaignToken, campaignToken);
    assert.equal(persistedIndex.pairScope.ownerId, ownerId);
    assert.equal(persistedIndex.pairScope.counterpartId, counterpartId);
    assert.equal(persistedIndex.items[0].text, "双方改约将金印保存在宫库。");
    assert.deepEqual(fs.readFileSync(sourceFile), Buffer.from(JSON.stringify(changedRows, null, 2)),
      "apply changes only the new index, never the source summary");

    assertStaticIpcContract();
    console.log("V9.3.5 Pair Memory Service IPC QA: PASS");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
