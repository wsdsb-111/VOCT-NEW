"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const root = path.resolve(__dirname, "..");
const { MemoryEngine, MemoryStore, MemoryTrace } = require(path.join(root, "resources", "app", "out", "main", "memory-system"));

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v701-finalization-"));
const store = new MemoryStore({ baseDir: path.join(tempDir, "memory") });
const engine = new MemoryEngine({ store, trace: new MemoryTrace({ logger: { log() {} } }) });
const context = {
  conversationId: "v701-finalization",
  date: "1066.1.1",
  totalDays: 1,
  participants: [{ id: 1, name: "玩家" }, { id: 2, name: "甲" }],
  participantPresence: [{ characterId: 1, joinedAtMessageId: 1, leftAtMessageId: null }, { characterId: 2, joinedAtMessageId: 1, leftAtMessageId: null }],
  messages: [{ id: 1, role: "user", name: "玩家", content: "我答应帮助甲。" }, { id: 2, role: "assistant", name: "甲", content: "我会记得。" }],
  rollingState: {}
};
const providerOutput = JSON.stringify({ sessionSummary: "玩家答应帮助甲。", memories: [{ type: "promise", participants: [1, 2], subjects: [2], content: "玩家答应帮助甲", importance: 0.9, confidence: 1, visibility: "participants", source: "spoken", messageIds: [1], speakerIds: [1] }] });

(async () => {
  let providerCalls = 0;
  const failed = await engine.finalizeConversation({
    ...context,
    buildPrompt: () => [],
    requestSummary: async () => ({ content: providerCalls++ === 0 ? providerOutput : "" }),
    persistCharacterFolders: async () => { throw new Error("summary_folder_disk_offline"); }
  });
  assert.strictEqual(failed.success, false);
  assert.strictEqual(providerCalls, 1);
  const [snapshotPath] = engine.listRecoverySnapshots();
  const snapshot = store.readJson(snapshotPath, null);
  assert.strictEqual(snapshot.finalizationStage, "persist");
  assert.strictEqual(snapshot.providerOutput, providerOutput);
  assert(snapshot.parsedExtraction, "parsed extraction must survive a persist failure");

  let folderWrites = 0;
  const recovered = await engine.recoverFailedFinalization(snapshotPath, {
    buildPrompt: () => { throw new Error("recovery must not rebuild an LLM request after provider success"); },
    requestSummary: async () => { throw new Error("recovery must not call LLM after provider success"); },
    persistCharacterFolders: async () => { folderWrites++; return { success: true }; }
  });
  assert.strictEqual(recovered.success, true);
  assert.strictEqual(folderWrites, 1);
  assert.strictEqual(providerCalls, 1);
  assert.strictEqual(engine.listRecoverySnapshots().length, 0);
  assert.strictEqual(store.listAllMemories().length, 1);
  assert.strictEqual(store.listAllEpisodes().length, 1);

  const repeated = await engine.finalizeConversation({
    ...context,
    buildPrompt: () => [],
    requestSummary: async () => { throw new Error("committed finalization must be idempotent"); },
    persistCharacterFolders: async () => { throw new Error("committed finalization must not rewrite character folders"); }
  });
  assert.strictEqual(repeated.success, true);
  assert.strictEqual(repeated.alreadyCommitted, true);
  assert.strictEqual(store.listAllMemories().length, 1);
  console.log("VOTC v7.0.1 finalization runtime: PASS (staged recovery, no repeat LLM, idempotency)");
})().finally(() => fs.rmSync(tempDir, { recursive: true, force: true })).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
