"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const root = path.resolve(__dirname, "..");
const { MemoryEngine } = require(path.join(root, "resources", "app", "out", "main", "memory-system"));

(async () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v761-recovery-race-"));
  try {
    const engine = new MemoryEngine({
      baseDir: path.join(temporaryRoot, "memory"),
      summaryFoldersDir: path.join(temporaryRoot, "conversation_summaries"),
      recoveryDir: path.join(temporaryRoot, "memory_recovery"),
      trace: { record() {} }
    });
    const context = engine.prepareFinalizationContext({
      conversationId: "conversation-in-flight",
      participants: [{ id: 1, name: "玩家" }, { id: 2, name: "燕青" }],
      participantPresence: [{ characterId: 1 }, { characterId: 2 }],
      messages: [{ id: 1, role: "user", name: "玩家", content: "测试。" }]
    });
    const snapshotPath = engine.writeRecoverySnapshot(context, {
      finalizationStage: "request",
      finalizationStatus: "pending"
    });
    engine.activeFinalizationIds.add(context.finalizationId);
    let providerCalls = 0;
    const results = await engine.recoverPendingFinalizations({
      buildPrompt: () => [],
      requestSummary: async () => {
        providerCalls++;
        return { content: JSON.stringify({ sessionSummary: "不应请求", memories: [] }) };
      },
      persistCharacterFolders: () => ({ success: true })
    });
    assert.strictEqual(providerCalls, 0, "a new conversation must not recover a finalization still active in this process");
    assert.deepStrictEqual(results, [], "an active finalization snapshot must remain for its owner, not be retried in parallel");
    assert.strictEqual(fs.existsSync(snapshotPath), true, "the active finalization keeps its own recovery snapshot until it commits or fails");
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
  console.log("VOTC v7.6.1 recovery race: PASS (new conversation skips an active finalization snapshot)");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
