"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { MemoryEngine } = require("../resources/app/out/main/memory-system/memory-engine");
const { validateSourceItem } = require("../resources/app/out/main/memory-system/finalization-visibility");
const { KnowledgeService } = require("../resources/app/out/main/memory-system/knowledge-service");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v814-sol-review-"));
const folders = path.join(root, "summaries");
for (const id of [1, 2]) fs.mkdirSync(path.join(folders, `${id}_NPC`), { recursive: true });
const engine = new MemoryEngine({ baseDir: path.join(root, "memory"), summaryFoldersDir: folders, trace: { record() {} } });
const store = engine.store;
const knowledge = new KnowledgeService({ store });
const spoken = "我愿意议和。";
const hidden = "我其实准备背叛。";
const people = [{ id: 1, name: "A" }, { id: 2, name: "B" }];
const presence = people.map(person => ({ characterId: person.id, joinedAtMessageId: 1, leftAtMessageId: null }));
const context = { campaignToken: "campaign-sol", conversationId: "conversation-sol", finalizationId: "finalization-sol",
  episodeId: "episode-sol", date: "1164.1.1", totalDays: 424000, participants: people, participantPresence: presence,
  finalizationVisibilityV1: true, buildPrompt: () => [], messages: [{ id: 1, role: "assistant", speakerCharacterId: 1, content: `${spoken}\n${hidden}` }] };
const segment = (content, visibility, participants) => ({ content, visibility, participants, source: "spoken",
  provenance: { messageIds: [1], speakerIds: [1] } });
let passed = 0, failed = 0;
async function check(name, test) {
  try { await test(); passed++; console.log(`PASS ${name}`); }
  catch (error) { failed++; console.error(`FAIL ${name}: ${error.message}`); }
}

async function run() {
  try {
    await check("Narrative source boundaries keep adjacent private prose out of the observer view", () => {
      const publicPart = segment(spoken, "public", [1, 2]);
      const privatePart = segment(hidden, "private", [1]);
      assert.deepEqual(validateSourceItem(publicPart, context).audience, [1, 2]);
      assert.deepEqual(validateSourceItem(privatePart, context).audience, [1]);
      assert.deepEqual(knowledge.resolveKnownBy(publicPart, { finalizationVisibilityV1: true, sourceContext: context }), [1, 2]);
      assert.deepEqual(knowledge.resolveKnownBy(privatePart, { finalizationVisibilityV1: true, sourceContext: context }), [1]);
    });
    await check("reported speech cannot be promoted to a witnessed CK3 fact", () => {
      const rumorContext = { ...context, messages: [{ ...context.messages[0], content: "A听说D已经死了。" }] };
      const reported = segment("A听说D已经死了。", "public", [1, 2]);
      assert.equal(validateSourceItem({ ...reported, source: "witnessed" }, rumorContext).reason, "visibility_reported_source_mismatch");
      assert.deepEqual(validateSourceItem({ ...reported, source: "rumor" }, rumorContext).audience, [1, 2]);
    });
    await check("Legacy owner summary remains recallable without sidecar evidence", () => {
      const file = path.join(folders, "2_NPC", "与1的对话.json");
      store.writeJson(file, [{ playerId: 2, playerName: "B", characterId: 1, characterName: "A", perspectiveOwnerId: 2,
        knownBy: [2], date: "1160.1.1", totalDays: 420000, content: "旧摘要仍可读取。", campaignToken: context.campaignToken,
        campaignBinding: { status: "bound", source: "fixture" } }]);
      const recalled = engine.retrieveForResponder({ characterId: 2, query: "上次谈了什么？", querySpeakerId: 1,
        directCounterpartIds: [1], activeParticipantIds: [1, 2], ownerFolderMemories: engine.loadOwnerFolderMemories(2),
        currentGameDate: "1164.1.1", currentTotalDays: 424000, campaignToken: context.campaignToken,
        memoryEngine3Enabled: true, tokenBudget: 1000, estimateTokens: () => 10, sessionRecallCache: new Map() });
      assert(recalled.direct.some(entry => entry.memory.content === "旧摘要仍可读取。"));
    });
    await check("Narrative finalization commits with zero Durable calls", async () => {
      const messages = [
        { id: 1, role: "assistant", speakerCharacterId: 1, content: spoken },
        { id: 2, role: "assistant", speakerCharacterId: 1, content: hidden }
      ];
      const output = JSON.stringify({ summarySegments: [
        { content: spoken, participants: [1, 2], visibility: "public", source: "spoken", messageIds: [1], speakerIds: [1] },
        { content: hidden, participants: [1], visibility: "private", source: "spoken", messageIds: [2], speakerIds: [1] }
      ], memories: [] });
      const marker = path.join(root, "summaries", "narrative-marker.txt");
      fs.writeFileSync(marker, "Narrative stays intact", "utf8");
      let durableCalls = 0;
      const result = await engine.finalizeConversation({ ...context, conversationId: "zero-durable", finalizationId: "zero-durable-final",
        messages, requestSummary: async () => ({ content: output, finish_reason: "stop" }),
        requestDurable: async () => { durableCalls++; throw new Error("retired_durable_callback_must_not_run"); },
        persistCharacterFolders: async () => ({ success: true }) });
      assert.equal(result.success, true, result.error?.message);
      assert.equal(durableCalls, 0);
      assert.equal(Object.hasOwn(result, "durable"), false);
      assert.equal(fs.readFileSync(marker, "utf8"), "Narrative stays intact");
      assert.deepEqual(result.extraction.summarySegments.map(item => item.knownBy), [[1, 2], [1]]);
    });
    await check("repeated finalization reuses committed Narrative without a second summary request", async () => {
      const messages = [{ id: 1, role: "assistant", speakerCharacterId: 1, content: spoken }];
      const output = JSON.stringify({ summarySegments: [{ content: spoken, participants: [1, 2], visibility: "public",
        source: "spoken", messageIds: [1], speakerIds: [1] }], memories: [] });
      let summaryCalls = 0, durableCalls = 0;
      const repeatContext = { ...context, conversationId: "idempotent-narrative", finalizationId: "idempotent-narrative-final", messages,
        requestSummary: async () => { summaryCalls++; return { content: output, finish_reason: "stop" }; },
        requestDurable: async () => { durableCalls++; throw new Error("retired_durable_callback_must_not_run"); },
        persistCharacterFolders: async () => ({ success: true }) };
      const first = await engine.finalizeConversation(repeatContext);
      const again = await engine.finalizeConversation(repeatContext);
      assert.equal(first.success, true);
      assert.equal(again.success, true);
      assert.equal(again.alreadyCommitted, true);
      assert.equal(summaryCalls, 1);
      assert.equal(durableCalls, 0);
    });
    await check("Narrative commit must not cross Campaign even when IDs collide", () => {
      store.saveEpisode({ episodeId: "prior-episode", conversationId: "same-conversation", finalizationId: "same-finalization",
        campaignToken: "old-campaign", participants: people, commitMarker: "committed" });
      assert.equal(engine.isCommitted({ conversationId: "same-conversation", finalizationId: "same-finalization", campaignToken: "new-campaign" }), null);
      store.saveEpisode({ episodeId: "current-episode", conversationId: "same-conversation", finalizationId: "same-finalization",
        campaignToken: "new-campaign", participants: people, commitMarker: "committed" });
      assert.equal(engine.isCommitted({ conversationId: "same-conversation", finalizationId: "same-finalization", campaignToken: "new-campaign" })?.episodeId, "current-episode");
    });
    await check("canceled Narrative finalization never commits or invokes Durable", async () => {
      let durableCalls = 0;
      const cancelled = new MemoryEngine({ baseDir: path.join(root, "cancelled-memory"), summaryFoldersDir: folders, trace: { record() {} } });
      const result = await cancelled.finalizeConversation({ ...context, conversationId: "cancelled", finalizationId: "cancelled-final",
        requestSummary: async () => {
          cancelled.memoryGeneration++;
          return { content: "not used", finish_reason: "stop" };
        },
        requestDurable: async () => { durableCalls++; throw new Error("retired_durable_callback_must_not_run"); } });
      assert.equal(result.cancelled, true);
      assert.equal(durableCalls, 0);
      assert.equal(cancelled.isCommitted({ ...context, conversationId: "cancelled", finalizationId: "cancelled-final" }), null);
    });
    console.log(`V8.14-A Sol review: ${passed} PASS, ${failed} FAIL`);
    if (failed) process.exitCode = 1;
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
