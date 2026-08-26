"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { MemoryEngine } = require("../resources/app/out/main/memory-system");

function writeOwnerSummary(summaryRoot, content) {
  const ownerDir = path.join(summaryRoot, "2_乙");
  fs.mkdirSync(ownerDir, { recursive: true });
  fs.writeFileSync(path.join(ownerDir, "与甲的对话.json"), JSON.stringify([{
    schemaVersion: 3,
    engineVersion: "2.4",
    playerId: 2,
    playerName: "乙",
    characterId: 1,
    characterName: "甲",
    participants: [{ id: 1, name: "甲" }, { id: 2, name: "乙" }],
    content
  }]), "utf8");
}

(async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v773-memory-"));
  try {
    const summaryRoot = path.join(tempRoot, "conversation_summaries");
    writeOwnerSummary(summaryRoot, "首次读取的摘要。");
    const engine = new MemoryEngine({ baseDir: path.join(tempRoot, "memory"), summaryFoldersDir: summaryRoot, trace: { record() {} } });

    const originalReaddirSync = fs.readdirSync;
    let summaryScanCount = 0;
    fs.readdirSync = function(target, ...args) {
      if (path.resolve(String(target)).startsWith(path.resolve(summaryRoot))) summaryScanCount += 1;
      return originalReaddirSync.call(this, target, ...args);
    };
    try {
      const first = engine.loadOwnerFolderMemories(2);
      assert.strictEqual(first[0].content, "首次读取的摘要。");
      const scansAfterFirstLoad = summaryScanCount;
      const second = engine.loadOwnerFolderMemories(2);
      assert.strictEqual(second[0].content, "首次读取的摘要。");
      assert.strictEqual(summaryScanCount, scansAfterFirstLoad, "same owner must reuse the in-process folder cache without another directory scan");

      await engine.persistCharacterFolders({
        participants: [{ id: 2 }],
        persistCharacterFolders: async () => {
          writeOwnerSummary(summaryRoot, "写入后刷新出的摘要。");
          return { success: true };
        }
      }, "写入后刷新出的摘要。");
      assert.strictEqual(engine.loadOwnerFolderMemories(2)[0].content, "写入后刷新出的摘要。", "targeted invalidation must expose the latest owner-folder content");
    } finally {
      fs.readdirSync = originalReaddirSync;
    }

    const context = { messages: [{ id: 10, content: "甲说明计划。" }, { id: 12, content: "乙表示同意。" }] };
    const validExtraction = {
      structured: true,
      sessionSummary: "甲说明计划，乙表示同意。",
      summarySegments: [{ provenance: { messageIds: [10, 12] } }],
      memories: [{ provenance: { messageIds: [12] } }]
    };
    assert.strictEqual(engine.validateExtractionMessageIds(context, validExtraction).success, true, "real source IDs must pass the fourth-layer validation");
    assert.strictEqual(engine.validateExtractionMessageIds(context, { ...validExtraction, summarySegments: [{ provenance: { messageIds: [99] } }] }).success, false, "out-of-range segment IDs must fail closed");
    assert.strictEqual(engine.validateExtractionMessageIds(context, { ...validExtraction, memories: [{ provenance: { messageIds: [11] } }] }).success, false, "an ID inside the numeric range but absent from real history must fail closed");
    assert.strictEqual(engine.validateExtractionMessageIds(context, { ...validExtraction, memories: [{ provenance: { messageIds: [] } }] }).success, false, "durable memories without source IDs must fail closed");

    let attempts = 0;
    let folderPersisted = false;
    const invalidResult = await engine.finalizeConversation({
      conversationId: "invalid-message-id",
      participants: [{ id: 1, name: "甲" }, { id: 2, name: "乙" }],
      participantPresence: [{ characterId: 1, joinedAtMessageId: 10 }, { characterId: 2, joinedAtMessageId: 10 }],
      messages: context.messages,
      buildPrompt: () => [],
      requestSummary: async () => {
        attempts += 1;
        return { content: JSON.stringify({
          summarySegments: [{ content: "模型引用了不存在的消息。", participants: [1, 2], visibility: "participants", messageIds: [11], speakerIds: [1, 2] }],
          memories: []
        }), finish_reason: "stop" };
      },
      persistCharacterFolders: async () => {
        folderPersisted = true;
        return { success: true };
      }
    });
    assert.strictEqual(invalidResult.success, false, "untrusted messageIds must reject the final summary transaction");
    assert.strictEqual(attempts, 2, "messageId validation failure must use the existing quality-retry path");
    assert.strictEqual(folderPersisted, false, "invalid extraction must not reach owner-folder persistence");
    assert(fs.existsSync(invalidResult.recoveryPath), "rejected output must remain recoverable instead of being silently persisted");
    assert.strictEqual(engine.store.listAllEpisodes().length, 0, "rejected extraction must not create a committed episode");

    const mainSource = fs.readFileSync(path.join(__dirname, "..", "resources", "app", "out", "main", "main.js"), "utf8");
    const summaryWriteSource = ["game-data/game-data.js", "summaries/summaries-manager.js"].map((relativePath) => fs.readFileSync(path.join(__dirname, "..", "resources", "app", "out", "main", ...relativePath.split("/")), "utf8")).join("\n");
    const ipcSource = fs.readFileSync(path.join(__dirname, "..", "resources", "app", "out", "main", "ipc", "register-ipc.js"), "utf8");
    assert(!summaryWriteSource.includes("memoryEngine.invalidateSummaryFolderCache([owner.id])"), "partial directed writes must not invalidate cache before final persistence verification");
    assert(fs.readFileSync(path.join(__dirname, "..", "resources", "app", "out", "main", "memory-system", "memory-engine.js"), "utf8").includes("this.invalidateSummaryFolderCache((context.participants || []).map((participant) => participant.id))"), "verified folder persistence must invalidate owner caches after the transaction succeeds");
    assert(summaryWriteSource.match(/memoryEngine\.invalidateSummaryFolderCache\(\[playerId\]\)/g)?.length >= 3, "edit and delete paths must invalidate the selected owner cache");
    assert(ipcSource.includes("memoryEngine.invalidateSummaryFolderCache();"), "clear-all must invalidate every owner cache");

    console.log("VOTC v7.7.3 Memory Engine 2.4: PASS (folder cache, write invalidation, source messageId trust and recovery)");
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
