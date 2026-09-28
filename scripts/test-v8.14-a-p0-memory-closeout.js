"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { MemoryStore } = require("../resources/app/out/main/memory-system/memory-store");
const { MemoryEngine } = require("../resources/app/out/main/memory-system/memory-engine");
const { Memory4Coordinator } = require("../resources/app/out/main/memory-system/memory4-coordinator");
const { repairVisibilityBoundaries, validateVisibilityBoundaries } = require("../resources/app/out/main/memory-system/finalization-visibility");
const { validateSummarySegmentPresenceBoundaries } = require("../resources/app/out/main/memory-system/perspective-projector");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v814-p0-"));
const store = new MemoryStore({ baseDir: path.join(root, "memory"), summaryFoldersDir: path.join(root, "summaries") });
for (const id of [1, 2, 3, 4, 5]) fs.mkdirSync(path.join(root, "summaries", `${id}_NPC`), { recursive: true });
const people = [{ id: 1, name: "A" }, { id: 2, name: "B" }, { id: 3, name: "C" }];
const segment = (content, messageIds, speakerIds, participants = [1, 2, 3]) => ({ content, participants,
  visibility: "public", source: "spoken", provenance: { messageIds, speakerIds } });
let passed = 0;
async function check(name, fn) { await fn(); passed++; console.log(`PASS ${name}`); }

async function run() {
  try {
    await check("public speech remains restricted to known witnesses", () => {
      store.saveMemory({ memoryId: "public-ab", type: "information", content: "A向B说了秘密", visibility: "public",
        knownBy: [1, 2], participants: [1, 2], provenance: { campaignToken: "p0" } });
      store.markKnownBy(1, "public-ab");
      store.markKnownBy(2, "public-ab");
      assert.equal(store.queryMemories({ characterId: 3 }).some(memory => memory.memoryId === "public-ab"), false);
      assert.equal(store.getPairMemories(1, 2, { characterId: 3 }).some(memory => memory.memoryId === "public-ab"), false);
      store.markKnownBy(3, "public-ab");
      assert.equal(store.queryMemories({ characterId: 3 }).some(memory => memory.memoryId === "public-ab"), true);
    });
    await check("mixed-source visibility failure repairs from source paragraphs in one pass", () => {
      const scene = { participants: people, participantPresence: people.map(person => ({ characterId: person.id, joinedAtMessageId: 0, leftAtMessageId: null })),
        messages: [{ id: 1, role: "user", speakerCharacterId: 1, content: "A心里决定保密。\nA对众人说今晚守城。" },
          { id: 2, role: "assistant", speakerCharacterId: 2, content: "B确认今晚守城。" }] };
      const extraction = { summarySegments: [segment("A心里保密，然后A与B商定守城。", [1, 2], [1, 2])], memories: [] };
      assert.equal(repairVisibilityBoundaries(scene, extraction).repairedMessageIds.length, 2);
      assert.equal(validateVisibilityBoundaries(scene, extraction).success, true);
      assert.deepEqual(extraction.summarySegments.map(entry => entry.visibility), ["private", "public", "public"]);
    });
    await check("presence marker mixed with speech is split locally", () => {
      const scene = { participants: people,
        participantPresence: [{ characterId: 1, joinedAtMessageId: 0, leftAtMessageId: null },
          { characterId: 2, joinedAtMessageId: 0, leftAtMessageId: null },
          { characterId: 3, joinedAtMessageId: 2, leftAtMessageId: null }],
        messages: [{ id: 1, role: "user", speakerCharacterId: 1, content: "A说守城。" },
          { id: 2, role: "system", kind: "presence_join", content: "C进入房间。" },
          { id: 3, role: "assistant", speakerCharacterId: 2, content: "B欢迎C。" }] };
      const extraction = { summarySegments: [segment("A守城，C进入后B欢迎。", [1, 2, 3], [1, 2])], memories: [] };
      assert.equal(repairVisibilityBoundaries(scene, extraction).repairedMessageIds.length, 3);
      assert.equal(validateVisibilityBoundaries(scene, extraction).success, true);
      assert.equal(validateSummarySegmentPresenceBoundaries(scene, extraction).success, true);
    });
    await check("invalid durable candidate does not force another full summary request", () => {
      const scene = { participants: people.slice(0, 2),
        participantPresence: people.slice(0, 2).map(person => ({ characterId: person.id, joinedAtMessageId: 0, leftAtMessageId: null })),
        messages: [{ id: 1, role: "user", speakerCharacterId: 1, content: "A公开提出守城。" }] };
      const extraction = { summarySegments: [segment("A公开提出守城。", [1], [1], [1, 2])],
        memories: [{ ...segment("A公开提出守城。", [1], [1], [1, 2]), source: "game_fact" }] };
      repairVisibilityBoundaries(scene, extraction);
      assert.equal(extraction.memories.length, 0);
      assert.equal(validateVisibilityBoundaries(scene, extraction).success, true);
    });
    await check("one manual retry recovers both conversations without quality re-requests", async () => {
      const engine = new MemoryEngine({ store, trace: { record() {} } });
      const messages = [{ id: 1, role: "user", speakerCharacterId: 1, content: "A心里决定保密。\nA公开提出守城。" },
        { id: 2, role: "assistant", speakerCharacterId: 2, content: "B同意守城。" }];
      const output = JSON.stringify({ summarySegments: [{ content: "A心里保密，然后双方守城。", participants: [1, 2],
        visibility: "public", source: "spoken", messageIds: [1, 2], speakerIds: [1, 2] }], memories: [] });
      for (const suffix of ["one", "two"]) {
        const context = engine.prepareFinalizationContext({ conversationId: `p0-${suffix}`, campaignToken: "p0", date: "1164.1.1",
          finalizationVisibilityV1: true, participants: people.slice(0, 2), messages,
          participantPresence: people.slice(0, 2).map(person => ({ characterId: person.id, joinedAtMessageId: 0, leftAtMessageId: null })) });
        engine.writeRecoverySnapshot(context, { finalizationStatus: "failed_retryable", retryCount: 4 });
      }
      let requests = 0;
      const results = await engine.recoverPendingFinalizations({ manual: true,
        requestSummary: async () => { requests++; return { content: output, finish_reason: "stop" }; },
        buildPrompt: context => engine.buildFinalizationPrompt(context),
        persistCharacterFolders: async () => ({ success: true }) });
      assert.equal(results.filter(result => result.success).length, 2);
      assert.equal(requests, 2);
      assert.equal(engine.listRecoverySnapshots().length, 0);
    });
    await check("multi-owner Durable extraction runs with bounded parallelism", async () => {
      const coordinator = new Memory4Coordinator(store);
      const participants = [1, 2, 3, 4, 5].map(id => ({ id, name: `P${id}` }));
      const context = { campaignToken: "durable-p0", conversationId: "durable-p0", finalizationId: "durable-p0",
        participants, date: "1164.1.1", messages: [{ id: 1, role: "user", speakerCharacterId: 1, content: "P1公开宣布守城。" }],
        participantPresence: participants.map(person => ({ characterId: person.id, joinedAtMessageId: 0, leftAtMessageId: null })),
        verifiedSummarySegments: [{ ...segment("P1公开宣布守城。", [1], [1], [1]), segmentId: "shared-p0",
          knownBy: participants.map(person => person.id) }] };
      let active = 0, peak = 0, calls = 0;
      const result = await coordinator.finalizeCommitted(context, async () => {
        calls++; peak = Math.max(peak, ++active);
        await new Promise(resolve => setTimeout(resolve, 5));
        active--;
        return { content: JSON.stringify({ status: "NO_DURABLE_CONTENT", entries: [] }), finish_reason: "stop" };
      }, { isNarrativeCommitted: true });
      assert.equal(result.status, "COMPLETE", JSON.stringify(result.owners));
      assert.equal(calls, 5);
      assert.equal(peak, 2);
    });
    await check("one manual Durable retry processes every pending owner", async () => {
      const coordinator = new Memory4Coordinator(store);
      const participants = people;
      const context = { campaignToken: "durable-retry-p0", conversationId: "durable-retry-p0", finalizationId: "durable-retry-p0",
        participants, date: "1164.1.1", messages: [{ id: 1, role: "user", speakerCharacterId: 1, content: "A公开宣布守城。" }],
        participantPresence: participants.map(person => ({ characterId: person.id, joinedAtMessageId: 0, leftAtMessageId: null })),
        verifiedSummarySegments: [{ ...segment("A公开宣布守城。", [1], [1], [1]), segmentId: "shared-retry-p0",
          knownBy: participants.map(person => person.id) }] };
      for (const person of participants) coordinator.saveRecovery(coordinator.buildOwnerSnapshot(context, person.id), {
        status: "EXTRACTION_FAILED", retryCount: 3, lastError: "fixture_transient" });
      let calls = 0, active = 0, peak = 0;
      const results = await coordinator.recoverPending(async () => {
        calls++; peak = Math.max(peak, ++active);
        await new Promise(resolve => setTimeout(resolve, 5));
        active--;
        return { content: JSON.stringify({ status: "NO_DURABLE_CONTENT", entries: [] }), finish_reason: "stop" };
      }, { manual: true, activeCampaignToken: context.campaignToken, isNarrativeCommitted: () => true });
      assert.equal(results.filter(result => result.status === "NO_DURABLE_CONTENT").length, 3);
      assert.equal(calls, 3);
      assert.equal(peak, 2);
    });
    console.log(`V8.14-A P0 memory closeout: ${passed} PASS`);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
