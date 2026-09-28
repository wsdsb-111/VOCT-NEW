"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { MemoryStore } = require("../resources/app/out/main/memory-system/memory-store");
const { MemoryEngine } = require("../resources/app/out/main/memory-system/memory-engine");
const { Memory4Store } = require("../resources/app/out/main/memory-system/memory4-store");
const { Memory4Coordinator } = require("../resources/app/out/main/memory-system/memory4-coordinator");
const { projectVisibleTranscript } = require("../resources/app/out/main/memory-system/memory4-visibility");
const { validateEntry } = require("../resources/app/out/main/memory-system/memory4-contract");
const { buildLegacyBridge } = require("../resources/app/out/main/memory-system/memory4-legacy-bridge");
const { createMemoryRecord } = require("../resources/app/out/main/memory-system/memory-types");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v814-sol-review-"));
const folders = path.join(root, "summaries");
fs.mkdirSync(path.join(folders, "1_A"), { recursive: true });
fs.mkdirSync(path.join(folders, "2_B"), { recursive: true });
const store = new MemoryStore({ baseDir: path.join(root, "memory"), summaryFoldersDir: folders });
const memory4 = new Memory4Store(store);
const coordinator = new Memory4Coordinator(store);
const spoken = "我愿意议和。";
const hidden = "我其实准备背叛。";
const context = { campaignToken: "campaign-sol", conversationId: "conversation-sol", finalizationId: "finalization-sol",
  episodeId: "episode-sol", date: "1164.1.1", totalDays: 424000, participants: [{ id: 1 }, { id: 2 }],
  participantPresence: [{ characterId: 1, joinedAtMessageId: 0, leftAtMessageId: null },
    { characterId: 2, joinedAtMessageId: 0, leftAtMessageId: null }],
  messages: [{ id: 1, role: "assistant", speakerCharacterId: 1, content: spoken + hidden,
    memory4Fragments: [{ start: 0, end: spoken.length, visibility: "participants", sourceType: "spoken", recipientIds: [2], entityIds: [] },
      { start: spoken.length, end: spoken.length + hidden.length, visibility: "private", sourceType: "spoken", entityIds: [] }] }] };

let passed = 0, failed = 0;
async function check(name, test) {
  try { await test(); passed++; console.log(`PASS ${name}`); }
  catch (error) { failed++; console.error(`FAIL ${name}: ${error.message}`); }
}

async function run() {
  try {
    await check("visible projector never sends adjacent private prose to observer", () => {
      const observer = coordinator.buildOwnerSnapshot(context, 2);
      const prompt = coordinator.buildPrompt(observer, observer.fragments);
      assert.equal(observer.fragments.length, 1);
      assert.equal(prompt[1].content.includes(hidden), false);
      assert.equal(projectVisibleTranscript(context, 1).fragments.length, 2);
    });
    await check("spoken report cannot be promoted to observed CK3 fact", () => {
      const snapshot = coordinator.buildOwnerSnapshot(context, 2);
      const candidate = { memoryType: "COMMITMENT", text: "一号答应议和。", fragmentIds: [snapshot.fragments[0].fragmentId],
        participantIds: [1, 2], entityIds: [], eventTime: { status: "observed" } };
      assert.throws(() => validateEntry(candidate, snapshot), /unverified_observation/);
      assert.equal(validateEntry({ ...candidate, eventTime: { status: "reported" } }, snapshot).evidence.epistemicStatus, "reported");
    });
    await check("partial old speech keeps Legacy but denies new observer detail", () => {
      const old = { ...context, messages: [{ ...context.messages[0], memory4Fragments: undefined }] };
      const observer = projectVisibleTranscript(old, 2);
      assert.equal(observer.completeness, "partial");
      assert.equal(observer.fragments.length, 0);
      const legacy = createMemoryRecord({ memoryId: "legacy-sol", type: "folder_summary", content: "旧摘要仍可召回。", knownBy: [2],
        provenance: { campaignToken: context.campaignToken, folderOwnerId: 2 } });
      assert.equal(buildLegacyBridge([legacy], { campaignToken: context.campaignToken, ownerId: 2 }).memories.length, 1);
    });
    await check("zero Durable preserves Narrative bytes and co-presence evidence", () => {
      const c = { ...context, campaignToken: "zero-campaign", conversationId: "zero-c", finalizationId: "zero-f",
        messages: [{ ...context.messages[0], memory4Fragments: undefined }] };
      const snapshot = coordinator.buildOwnerSnapshot(c, 2);
      const narrative = path.join(folders, "2_B", "narrative-sol.json");
      fs.writeFileSync(narrative, "Narrative stays intact");
      memory4.recordKnownEvidence(snapshot);
      memory4.commitOwner(snapshot, { status: "NO_DURABLE_CONTENT", entries: [] });
      assert.equal(fs.readFileSync(narrative, "utf8"), "Narrative stays intact");
      assert.equal(memory4.getKnownEntityEvidence(snapshot, 1).status, "SHARED_SCENE");
      assert.equal(memory4.query(snapshot).length, 0);
    });
    await check("per-owner retry is idempotent after successful commit", () => {
      const snapshot = coordinator.buildOwnerSnapshot({ ...context, campaignToken: "idempotent-campaign",
        conversationId: "idempotent-c", finalizationId: "idempotent-f" }, 2);
      const candidate = { memoryType: "COMMITMENT", text: "一号提出议和。", fragmentIds: [snapshot.fragments[0].fragmentId],
        participantIds: [1, 2], entityIds: [], eventTime: { status: "reported" } };
      const first = memory4.commitOwner(snapshot, { status: "STORE", entries: [candidate] });
      const again = memory4.commitOwner(snapshot, { status: "STORE", entries: [candidate] });
      assert.equal(again.alreadyCommitted, true);
      assert.deepEqual(again.entryIds, first.entryIds);
      assert.equal(memory4.query(snapshot).length, 1);
    });
    await check("Narrative commit must not cross Campaign even when IDs collide", () => {
      store.saveEpisode({ episodeId: "prior-episode", conversationId: "same-conversation", finalizationId: "same-finalization",
        campaignToken: "old-campaign", participants: [{ id: 1 }, { id: 2 }], commitMarker: "committed" });
      const engine = new MemoryEngine({ store, trace: { record() {} } });
      assert.equal(engine.isCommitted({ conversationId: "same-conversation", finalizationId: "same-finalization", campaignToken: "new-campaign" }), null);
      store.saveEpisode({ episodeId: "current-episode", conversationId: "same-conversation", finalizationId: "same-finalization",
        campaignToken: "new-campaign", participants: [{ id: 1 }, { id: 2 }], commitMarker: "committed" });
      assert.equal(engine.isCommitted({ conversationId: "same-conversation", finalizationId: "same-finalization", campaignToken: "new-campaign" })?.episodeId, "current-episode");
    });
    await check("Known direct interaction must retract when revised source loses speech evidence", () => {
      const first = coordinator.buildOwnerSnapshot({ ...context, conversationId: "known-revision" }, 2);
      memory4.recordKnownEvidence(first);
      assert.equal(memory4.getKnownEntityEvidence(first, 1).status, "DIRECT_INTERACTION");
      const revised = coordinator.buildOwnerSnapshot({ ...context, conversationId: "known-revision",
        messages: [{ ...context.messages[0], memory4Fragments: undefined }] }, 2);
      memory4.recordKnownEvidence(revised);
      assert.equal(memory4.getKnownEntityEvidence(revised, 1).status, "SHARED_SCENE");
      assert.equal(memory4.getKnownEntityEvidence(revised, 1).directConversationCount, 0);
    });
    await check("Known revision preserves independent conversation evidence", () => {
      const first = coordinator.buildOwnerSnapshot({ ...context, conversationId: "known-one" }, 2);
      const other = coordinator.buildOwnerSnapshot({ ...context, conversationId: "known-two" }, 2);
      memory4.recordKnownEvidence(first);
      memory4.recordKnownEvidence(other);
      assert.equal(memory4.getKnownEntityEvidence(other, 1).directConversationCount, 2);
      const revised = coordinator.buildOwnerSnapshot({ ...context, conversationId: "known-one",
        messages: [{ ...context.messages[0], memory4Fragments: undefined }] }, 2);
      memory4.recordKnownEvidence(revised);
      assert.equal(memory4.getKnownEntityEvidence(other, 1).directConversationCount, 1);
      assert.equal(memory4.getKnownEntityEvidence(other, 1).sourceConversationIds.includes("known-two"), true);
    });
    await check("Known revision removes unsupported entity row without claiming never met", () => {
      const first = coordinator.buildOwnerSnapshot({ ...context, conversationId: "known-removed" }, 1);
      memory4.recordKnownEvidence(first);
      assert.equal(memory4.getKnownEntityEvidence(first, 2).status, "DIRECT_INTERACTION");
      const revised = coordinator.buildOwnerSnapshot({ ...context, conversationId: "known-removed", participantPresence: [],
        messages: [{ ...context.messages[0], memory4Fragments: undefined }] }, 1);
      memory4.recordKnownEvidence(revised);
      assert.equal(memory4.getKnownEntityEvidence(revised, 2).status, "UNKNOWN");
    });
    await check("cancelled owner extraction cannot be reported as COMPLETE", async () => {
      let current = true;
      const result = await coordinator.finalizeCommitted({ ...context, conversationId: "cancel-c", finalizationId: "cancel-f" },
        async () => { current = false; return { content: '{"status":"NO_DURABLE_CONTENT","entries":[]}' }; },
        { isNarrativeCommitted: true, isCurrent: () => current });
      assert.notEqual(result.status, "COMPLETE");
      assert.equal(result.owners[0].status, "CANCELLED");
    });
    console.log(`V8.14-A Sol review: ${passed} PASS, ${failed} FAIL`);
    if (failed) process.exitCode = 1;
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
