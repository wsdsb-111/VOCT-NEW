"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const root = path.resolve(__dirname, "..");
const { FinalizationCoordinator, MemoryEngine } = require(path.join(root, "resources", "app", "out", "main", "memory-system"));

(async () => {
  const events = [];
  let releaseFirst;
  const firstGate = new Promise((resolve) => { releaseFirst = resolve; });
  const coordinator = new FinalizationCoordinator({ logger: { error() {} } });
  const first = coordinator.enqueue("conversation-a", async () => {
    events.push("a:start");
    await firstGate;
    events.push("a:end");
    return "a";
  });
  const duplicateFirst = coordinator.enqueue("conversation-a", async () => {
    throw new Error("same conversation must not finalize twice");
  });
  assert.strictEqual(duplicateFirst, first, "same conversation ID must reuse the in-flight finalization");
  const second = coordinator.enqueue("conversation-b", async () => {
    events.push("b:start");
    events.push("b:end");
    return "b";
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepStrictEqual(events, ["a:start"], "second finalization must wait while the first is persisting");
  assert.strictEqual(coordinator.pendingCount, 2);
  releaseFirst();
  assert.deepStrictEqual(await Promise.all([first, second]), ["a", "b"]);
  await coordinator.drain();
  assert.deepStrictEqual(events, ["a:start", "a:end", "b:start", "b:end"]);
  assert.strictEqual(coordinator.pendingCount, 0);

  const order = [];
  for (let index = 0; index < 50; index++) {
    coordinator.enqueue(`conversation-${index}`, async () => { order.push(index); });
  }
  await coordinator.drain();
  assert.deepStrictEqual(order, Array.from({ length: 50 }, (_, index) => index), "50 rapid conversations must finalize in queue order");

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v72-finalization-"));
  try {
    const summariesDir = path.join(tempDir, "conversation_summaries");
    const engine = new MemoryEngine({ baseDir: path.join(tempDir, "memory"), summaryFoldersDir: summariesDir, trace: { record() {} } });
    const participantsById = new Map([[1, "玩家"], [2, "甲"], [3, "乙"]]);
    let providerCalls = 0;
    const persistFolders = (summary, context) => {
      for (const owner of context.participants) {
        for (const counterpart of context.participants) {
          if (owner.id === counterpart.id) continue;
          const folder = path.join(summariesDir, `${owner.id}_${owner.name}`);
          const filePath = path.join(folder, `与${counterpart.name}的对话.json`);
          fs.mkdirSync(folder, { recursive: true });
          const existing = fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, "utf8")) : [];
          if (!existing.some((entry) => entry.finalizationId === context.finalizationId)) {
            existing.unshift({
              date: context.date,
              totalDays: context.totalDays,
              playerId: owner.id,
              playerName: owner.name,
              characterId: counterpart.id,
              characterName: counterpart.name,
              participants: context.participants,
              finalizationId: context.finalizationId,
              content: summary
            });
            fs.writeFileSync(filePath, JSON.stringify(existing), "utf8");
          }
        }
      }
      return { success: true };
    };
    const finalizations = [];
    for (let index = 0; index < 50; index++) {
      const npcId = index % 2 === 0 ? 2 : 3;
      const participants = [1, npcId].map((id) => ({ id, name: participantsById.get(id) }));
      finalizations.push(coordinator.enqueue(`persisted-conversation-${index}`, () => engine.finalizeConversation({
        conversationId: `persisted-conversation-${index}`,
        date: `1121.1.${index + 1}`,
        totalDays: index + 1,
        participants,
        participantPresence: participants.map((participant) => ({ characterId: participant.id, joinedAtMessageId: 1, leftAtMessageId: null })),
        messages: [
          { id: 1, role: "user", name: "玩家", content: `第 ${index + 1} 场对话。` },
          { id: 2, role: "assistant", name: participantsById.get(npcId), content: "我会记得。" }
        ],
        rollingState: {},
        buildPrompt: () => [],
        requestSummary: async () => {
          providerCalls++;
          return { content: JSON.stringify({ sessionSummary: `第 ${index + 1} 场摘要`, memories: [] }) };
        },
        persistCharacterFolders: persistFolders
      })));
    }
    const results = await Promise.all(finalizations);
    assert(results.every((result) => result.success), "all 50 Memory Engine finalizations must commit");
    assert.strictEqual(providerCalls, 50, "each independent conversation must request exactly one final summary");
    assert.strictEqual(engine.store.listAllEpisodes().length, 50, "all 50 conversations must have unique committed episodes");
    const playerWithA = JSON.parse(fs.readFileSync(path.join(summariesDir, "1_玩家", "与甲的对话.json"), "utf8"));
    const playerWithB = JSON.parse(fs.readFileSync(path.join(summariesDir, "1_玩家", "与乙的对话.json"), "utf8"));
    const aWithPlayer = JSON.parse(fs.readFileSync(path.join(summariesDir, "2_甲", "与玩家的对话.json"), "utf8"));
    const bWithPlayer = JSON.parse(fs.readFileSync(path.join(summariesDir, "3_乙", "与玩家的对话.json"), "utf8"));
    assert.deepStrictEqual([playerWithA.length, playerWithB.length, aWithPlayer.length, bWithPlayer.length], [25, 25, 25, 25], "alternating NPC sessions must save both directed folders 50/50");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  const mainSource = fs.readFileSync(path.join(root, "resources", "app", "out", "main", "main.js"), "utf8");
  assert(mainSource.includes("finalizationCoordinator.enqueue"), "ConversationManager must enqueue detached conversations");
  assert(mainSource.includes("flushFinalizations"), "ConversationManager must expose an application-quit drain");
  assert(!/endCurrentConversation\(\)\s*\{[\s\S]{0,220}currentConversation\.finalizeConversation\(\)/.test(mainSource), "endCurrentConversation must not fire-and-forget finalize directly");

  console.log("VOTC v7.2 sequential finalization: PASS (dedupe, serialization, 50/50 directed persistence)");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
