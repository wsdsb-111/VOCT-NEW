"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const root = path.resolve(__dirname, "..");
const mainPath = path.join(root, "resources", "app", "out", "main", "main.js");
const { MemoryEngine, MentionTracker, FinalizationCoordinator } = require(path.join(root, "resources", "app", "out", "main", "memory-system"));

function writePair(folderRoot, owner, counterpart, summaries) {
  const folder = path.join(folderRoot, `${owner.id}_${owner.name}`);
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, `与${counterpart.name}的对话.json`), JSON.stringify(summaries.map((content, index) => ({
    date: `1121年1月${index + 1}日`,
    totalDays: index + 1,
    playerId: owner.id,
    playerName: owner.name,
    characterId: counterpart.id,
    characterName: counterpart.name,
    participants: [owner, counterpart],
    finalizationId: `fin_${index}`,
    content
  }))), "utf8");
}

(async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v721-stability-"));
  try {
    const summariesDir = path.join(tempDir, "summaries");
    const owner = { id: 2, name: "乙大人" };
    const counterpart = { id: 1, name: "玩家甲" };
    writePair(summariesDir, owner, counterpart, ["甲".repeat(420), "乙".repeat(420), "丙".repeat(420)]);
    const engine = new MemoryEngine({ baseDir: path.join(tempDir, "memory"), summaryFoldersDir: summariesDir, trace: { record() {} } });
    const recalled = engine.retrieveForResponder({
      characterId: owner.id,
      directCounterpartIds: [counterpart.id],
      mentionedEntityIds: [999],
      mentionedEntityNames: { 999: ["不存在的人物"] },
      query: "继续此前的话题",
      tokenBudget: 1000,
      estimateTokens: (text) => String(text).length
    });
    assert.strictEqual(recalled.routing.budgets.mentioned, 0, "an empty mentioned-person lane must not reserve 30% budget");
    assert.strictEqual(recalled.routing.budgets.direct, 1000, "all unused lanes must flow back to the direct relationship lane");
    assert(recalled.selectedTokens > 850, "direct memories must be able to consume the returned budget");

    const snapshotEngine = new MemoryEngine({ baseDir: path.join(tempDir, "snapshot-memory"), trace: { record() {} } });
    snapshotEngine.finalizeConversation({
      conversationId: "provider-hangs",
      participants: [counterpart, owner],
      messages: [{ id: 1, role: "user", content: "请记住。" }, { id: 2, role: "assistant", content: "我会记住。" }],
      rollingState: {},
      buildPrompt: () => [],
      requestSummary: () => new Promise(() => {})
    });
    await new Promise((resolve) => setImmediate(resolve));
    const [preRequestSnapshot] = snapshotEngine.listRecoverySnapshots();
    assert(preRequestSnapshot, "a recovery snapshot must exist before the provider request begins");
    const snapshot = snapshotEngine.store.readJson(preRequestSnapshot, null);
    assert.strictEqual(snapshot.finalizationStage, "request");
    assert.deepStrictEqual(snapshot.rawMessages.map((message) => message.id), [1, 2], "pre-request recovery must preserve the final conversation messages");

    const timeoutCoordinator = new FinalizationCoordinator({ logger: { error() {} } });
    timeoutCoordinator.enqueue("never-finishes", () => new Promise(() => {}));
    const startedAt = Date.now();
    const drainResult = await timeoutCoordinator.drain({ timeoutMs: 25 });
    assert.strictEqual(drainResult.timedOut, true, "drain must stop waiting after its timeout");
    assert(Date.now() - startedAt < 250, "drain timeout must keep application exit bounded");
    assert.strictEqual(drainResult.pendingCount, 1);

    const persistEngine = new MemoryEngine({ baseDir: path.join(tempDir, "persist-memory"), trace: { record() {} } });
    const persistResult = await persistEngine.finalizeConversation({
      conversationId: "undefined-folder-persist",
      participants: [counterpart, owner],
      messages: [{ id: 1, role: "user", content: "生成摘要。" }, { id: 2, role: "assistant", content: "好的。" }],
      rollingState: {},
      buildPrompt: () => [],
      requestSummary: async () => ({ content: JSON.stringify({ sessionSummary: "有效摘要", memories: [] }) }),
      persistCharacterFolders: async () => void 0
    });
    assert.strictEqual(persistResult.success, false, "undefined folder persistence must fail the finalization transaction");
    assert(persistResult.recoveryPath, "failed folder persistence must retain a recovery snapshot");

    const tracker = new MentionTracker();
    const candidates = [
      { id: 10, fullName: "皇后" },
      { id: 11, fullName: "李师" },
      { id: 12, fullName: "李师师" },
      { id: 13, fullName: "张三" },
      { id: 14, fullName: "张三" },
      { id: 15, fullName: "赵佶" },
      { id: 16, fullName: "John" }
    ];
    assert.deepStrictEqual(tracker.findMentionedCharacterIds([{ id: 1, content: "皇后已有旨意。" }], { candidates }), [10], "a unique title may resolve to its current character");
    assert.deepStrictEqual(tracker.findMentionedCharacterIds([{ id: 2, content: "李师师来了。" }], { candidates }), [12], "a short name must not match inside a longer character name");
    assert.deepStrictEqual(tracker.findMentionedCharacterIds([{ id: 3, content: "张三来了。" }], { candidates }), [], "an ambiguous same-name alias must fail closed");
    assert.deepStrictEqual(tracker.findMentionedCharacterIds([{ id: 4, content: "赵佶今年多大？" }], { candidates }), [15], "a unique two-character Chinese name must still resolve at a word boundary");
    assert.deepStrictEqual(tracker.findMentionedCharacterIds([{ id: 5, content: "xJohn并不在场，John来了。" }], { candidates }), [16], "ASCII aliases must require ASCII word boundaries while allowing adjacent Chinese text");
    const boundedState = tracker.createState();
    const longHistory = Array.from({ length: 1000 }, (_, index) => ({ id: 1000 + index, role: index % 2 ? "assistant" : "user", content: "没有人物提及。" }));
    tracker.update(boundedState, { history: longHistory, candidates });
    assert.strictEqual(boundedState.processedThroughIndex, 1000, "mention state must advance with a constant-size cursor");
    assert(!Object.prototype.hasOwnProperty.call(boundedState, "processedMessageKeys"), "mention state must not retain an unbounded message-key array");

    const mainSource = fs.readFileSync(mainPath, "utf8");
    assert(mainSource.includes("memoryEngine.findMentionedCharactersInHistory"), "GameData and Conversation mention detection must share one matcher");
    const letterBlock = mainSource.slice(mainSource.indexOf("class LetterPromptBuilder"), mainSource.indexOf("class LetterManager"));
    assert(letterBlock.includes("retrieveForResponder"), "letters must use the Engine 2.2 routed retrieval entrypoint");
    assert(letterBlock.includes("mentionedEntityIds"), "letters must route mentioned out-of-scene characters");
    assert(!letterBlock.includes("tokenBudget: 600"), "letters must not keep the old 600-token recall path");
    assert(mainSource.includes('error: "insufficient_summary_participants"'), "insufficient participant persistence must return an explicit failure");

    console.log("VOTC v7.2.1 stability: PASS (budget return, bounded exit, durable snapshot, precise mentions, letter routes)");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
