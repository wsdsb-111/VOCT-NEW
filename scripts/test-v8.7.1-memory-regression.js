"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { MemoryEngine, MemoryTrace, RollingSummaryManager } = require("../resources/app/out/main/memory-system");
const { buildThirdPartyEvidencePatch } = require("../resources/app/out/main/memory-system/third-party-evidence");
const { evidenceMemory } = require("./v8.6.2-test-fixtures");

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v871-memory-"));
  try {
    const engine = new MemoryEngine({ baseDir: path.join(root, "memory"), summaryFoldersDir: path.join(root, "summaries"), recoveryDir: path.join(root, "recovery"), trace: { record() {} } });
    const direct = { memoryId: "direct-v871", type: "folder_summary", epistemicStatus: "known", content: "玩家与韩世忠约定下月赴约。", canonicalText: "玩家与韩世忠约定下月赴约。", participants: [1, 2], subjects: [1, 2], importance: 0.9, confidence: 1, totalDays: 429999, eventDate: "1174年12月30日", provenance: { folderOwnerId: 2, finalizationId: "direct-v871", counterpartId: 1, counterpartIds: [1] } };
    const retrieval = engine.retrieveForResponder({ characterId: 2, query: "还记得赴约吗？", directCounterpartIds: [1], ownerFolderMemories: [direct], currentTotalDays: 430000, tokenBudget: 800, estimateTokens: (value) => Math.ceil(String(value).length / 2), sessionRecallCache: new Map(), mentionedRecallCache: new Map() });
    assert.deepEqual(retrieval.direct.map((entry) => entry.memory.memoryId), [direct.memoryId]);
    const turn = engine.retrieveTurnRecall({ characterId: 2, query: "还记得下月赴约吗？", entityIds: [1], entityNames: ["玩家"], participantIds: [1], ownerFolderMemories: [direct], currentTotalDays: 430000, tokenBudget: 256, estimateTokens: (value) => Math.ceil(String(value).length / 2), cache: new Map(), turnEpoch: 1 });
    assert.deepEqual(turn.selected.map((entry) => entry.memory.memoryId), [direct.memoryId]);
    assert(turn.tokens <= 256);
    const thirdParty = buildThirdPartyEvidencePatch({ query: "韩世忠答应了吗？", entities: [{ id: 3, aliases: ["韩世忠"], memories: [evidenceMemory()] }] });
    assert.equal(thirdParty.triggered, true);
    assert.match(thirdParty.text, /不得否认/);

    const manager = new RollingSummaryManager({ trace: new MemoryTrace({ logger: { log() {} } }) });
    const state = manager.createState();
    const checkpoint = await manager.checkpoint({ state, history: [{ id: 0, role: "user", name: "玩家", content: "约定" }, { id: 1, role: "assistant", name: "韩世忠", content: "记得" }], tokensToSummarize: 2, estimateMessageTokens: () => 1, buildPrompt: (batch) => batch, requestSummary: async () => ({ content: "双方确认赴约。" }) });
    assert.equal(checkpoint.committed, true);
    assert.equal(state.currentSummary, "双方确认赴约。");

    const promptSource = fs.readFileSync(path.join(__dirname, "../resources/app/out/main/prompts/prompt-builder.js"), "utf8");
    const current = promptSource.indexOf("currentUserMessage");
    const memory = promptSource.indexOf("memory-turn-recall", current);
    const world = promptSource.indexOf("worldline-turn-recall", memory);
    assert(current >= 0 && memory > current && world > memory, "Memory Turn Recall must remain before dynamic Worldline recall");
    console.log("V8.7.1 memory regression PASS");
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
