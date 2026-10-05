"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { MemoryStore } = require("../resources/app/out/main/memory-system/memory-store");
const { Memory4Coordinator } = require("../resources/app/out/main/memory-system/memory4-coordinator");
const { MemoryTrace } = require("../resources/app/out/main/memory-system/memory-trace");
const { validateEntry } = require("../resources/app/out/main/memory-system/memory4-contract");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v8142-durable-"));
const failures = [];
let assertions = 0;

function check(name, test) {
  try {
    test();
    assertions++;
    console.log(`PASS ${name}`);
  } catch (error) {
    failures.push(`${name}: ${error.message}`);
    console.error(`FAIL ${name}: ${error.message}`);
  }
}

async function checkAsync(name, test) {
  try {
    await test();
    assertions++;
    console.log(`PASS ${name}`);
  } catch (error) {
    failures.push(`${name}: ${error.message}`);
    console.error(`FAIL ${name}: ${error.message}`);
  }
}

const people = [
  { id: 1, name: "叙述者甲" },
  { id: 2, name: "记录者乙" },
  { id: 3, name: "记录者丙" }
];
const spokenText = "我答应给你三百石粮食，八月初在邢州交付。";
const narrativeText = "约定八月初在邢州交付三百石粮食。";

function fixture(label, { annotated = false, sourceText = spokenText, segmentText = narrativeText, date = "1164.8.11" } = {}) {
  const summariesDir = path.join(root, "summaries");
  for (const person of people) fs.mkdirSync(path.join(summariesDir, `${person.id}_NPC`), { recursive: true });
  const store = new MemoryStore({ baseDir: path.join(root, label, "memory"), summaryFoldersDir: summariesDir });
  const trace = new MemoryTrace({ logger: null });
  const coordinator = new Memory4Coordinator(store, { trace });
  const scheduled = [];
  coordinator.derived.schedule = (scope, options) => scheduled.push({ scope, options });
  const message = { id: 1, role: "assistant", speakerCharacterId: 1, content: sourceText,
    ...(annotated ? { memory4Fragments: [{ start: 0, end: sourceText.length, visibility: "participants",
      sourceType: "spoken", recipientIds: [2, 3], entityIds: [] }] } : {}) };
  const context = { campaignToken: `campaign-${label}`, conversationId: `conversation-${label}`,
    finalizationId: `finalization-${label}`, episodeId: `episode-${label}`, date, finalizationVisibilityV1: true,
    participants: people, participantPresence: people.map(person => ({ characterId: person.id, joinedAtMessageId: 1, leftAtMessageId: null })),
    messages: [message], verifiedSummarySegments: annotated ? [] : [{ segmentId: `segment-${label}`,
      content: segmentText, participants: [1, 2, 3], visibility: "participants", source: "spoken", knownBy: [1, 2, 3],
      provenance: { messageIds: [1], speakerIds: [1] } }] };
  return { coordinator, context, trace, scheduled };
}

function durableCandidate(snapshot, fragment, entityIds) {
  return { memoryType: "COMMITMENT", text: "约定八月初在邢州交付三百石粮食。",
    fragmentIds: [fragment.fragmentId], entityIds, participantIds: [1, snapshot.ownerId], topics: ["粮食", "邢州"],
    eventTime: { status: "unknown" } };
}

function requestFor(entries, status = "STORE", transitions = []) {
  return async prompt => {
    assert.equal(prompt.length, 2);
    const payload = JSON.parse(prompt[1].content);
    return { content: JSON.stringify({ status, entries: typeof entries === "function" ? entries(payload) : entries,
      commitmentTransitions: typeof transitions === "function" ? transitions(payload) : transitions }), finish_reason: "stop" };
  };
}

async function run() {
  try {
    const shared = fixture("owner-allowlist");
    const ownerTwo = shared.coordinator.buildOwnerSnapshot(shared.context, 2);
    const ownerThree = shared.coordinator.buildOwnerSnapshot(shared.context, 3);
    check("Memory4 fragment retains Narrative text with original message and segment evidence", () => {
      assert.equal(ownerTwo.fragments.length, 2);
      assert.equal(ownerTwo.fragments[0].text, narrativeText);
      assert.notEqual(ownerTwo.fragments[0].text, spokenText);
      assert.deepEqual(ownerTwo.fragments[0].sourceMessageIds, [1]);
      assert.equal(ownerTwo.fragments[0].visibilityEvidence, "finalization_validated_segment");
      assert.equal(ownerTwo.fragments[1].text, spokenText);
      assert.deepEqual(ownerTwo.fragments[1].sourceMessageIds, [1]);
      assert.deepEqual(ownerTwo.fragments[1].knownBy, [1, 2, 3]);
      assert.equal(ownerTwo.fragments[1].visibilityEvidence, "finalization_source_paragraph");
      assert.equal(ownerTwo.fragments[1].sourceTextVerified, true);
    });
    check("Durable Prompt separates Owner entity authorization from presence participants", () => {
      const promptTwo = shared.coordinator.buildPrompt(ownerTwo, ownerTwo.fragments);
      const promptThree = shared.coordinator.buildPrompt(ownerThree, ownerThree.fragments);
      const fragmentTwo = JSON.parse(promptTwo[1].content).fragments[0];
      const fragmentThree = JSON.parse(promptThree[1].content).fragments[0];
      assert.deepEqual(fragmentTwo.allowedEntityIds, [1, 2]);
      assert.deepEqual(fragmentThree.allowedEntityIds, [1, 3]);
      assert.deepEqual(fragmentTwo.participantIds, [1, 2, 3]);
      assert.match(promptTwo[0].content, /participantIds are presence evidence only and never authorize entityIds/);
      assert.match(promptTwo[0].content, /Owner ID may be used when listed in allowedEntityIds for a fact about the Owner as its own subject or as the listener; include it only when relevant/);
    });
    check("Owner is allowed only in their own verified source scope", () => {
      const promptFragmentTwo = JSON.parse(shared.coordinator.buildPrompt(ownerTwo, ownerTwo.fragments)[1].content).fragments[0];
      const promptFragmentThree = JSON.parse(shared.coordinator.buildPrompt(ownerThree, ownerThree.fragments)[1].content).fragments[0];
      assert.doesNotThrow(() => validateEntry(durableCandidate(ownerTwo, ownerTwo.fragments[0], [2]), ownerTwo));
      assert.doesNotThrow(() => validateEntry(durableCandidate(ownerThree, ownerThree.fragments[0], [3]), ownerThree));
      assert.throws(() => validateEntry(durableCandidate(ownerTwo, ownerTwo.fragments[0], [3]), ownerTwo), /unknown_entity/);
      assert.throws(() => validateEntry(durableCandidate(ownerThree, ownerThree.fragments[0], [2]), ownerThree), /unknown_entity/);
      assert.deepEqual(promptFragmentTwo.allowedEntityIds, [1, 2]);
      assert.deepEqual(promptFragmentThree.allowedEntityIds, [1, 3]);
    });
    await checkAsync("Owner-scoped entity candidate stores canonical Detail and schedules derived refresh", async () => {
      const promptFragment = JSON.parse(shared.coordinator.buildPrompt(ownerTwo, ownerTwo.fragments)[1].content).fragments[0];
      const result = await shared.coordinator.finishOwner(ownerTwo, requestFor(payload => [
        durableCandidate(ownerTwo, ownerTwo.fragments[0], [payload.fragments[0].allowedEntityIds[1]])
      ]));
      assert.equal(result.status, "STORE");
      assert.equal(result.entryIds.length, 1);
      assert.equal(shared.coordinator.store.query(ownerTwo).length, 1);
      assert.equal(shared.coordinator.store.query(ownerThree).length, 0);
      assert.equal(shared.scheduled.length, 1);
      assert.equal(promptFragment.allowedEntityIds.includes(2), true);
    });
    await checkAsync("all unknown third-party IDs remain rejected and keep a retryable recovery snapshot", async () => {
      const f = fixture("unknown-third-party");
      const snapshot = f.coordinator.buildOwnerSnapshot(f.context, 2);
      const result = await f.coordinator.finishOwner(snapshot, requestFor(payload => [
        durableCandidate(snapshot, snapshot.fragments[0], [999])
      ]));
      assert.equal(result.status, "EXTRACTION_FAILED");
      assert.equal(result.error, "memory4_response_no_valid_entries");
      assert.equal(fs.existsSync(result.recoveryPath), true);
      assert.equal(f.coordinator.store.query(snapshot).length, 0);
      assert.equal(f.scheduled.length, 0);
      const rejection = f.trace.list().find(entry => entry.stage === "memory4_candidate_rejected");
      assert.equal(rejection.memory4RejectedUnknownEntityCount, 1);
      assert.equal(rejection.memory4OwnerId, snapshot.ownerId);
      assert.equal(JSON.stringify(rejection).includes(narrativeText), false);
    });
    await checkAsync("numeric-string IDs are not normalized and cannot become empty success", async () => {
      const f = fixture("string-entity-id");
      const snapshot = f.coordinator.buildOwnerSnapshot(f.context, 2);
      const result = await f.coordinator.finishOwner(snapshot, requestFor(payload => [
        durableCandidate(snapshot, snapshot.fragments[0], [String(snapshot.ownerId)])
      ]));
      assert.equal(result.status, "EXTRACTION_FAILED");
      assert.equal(result.error, "memory4_response_no_valid_entries");
      assert.equal(fs.existsSync(result.recoveryPath), true);
      assert.equal(f.trace.list().find(entry => entry.stage === "memory4_candidate_rejected").memory4RejectedUnknownEntityCount, 1);
    });
    await checkAsync("mixed valid and unknown candidates store only valid entries and a count-only rejection", async () => {
      const f = fixture("mixed-candidates");
      const snapshot = f.coordinator.buildOwnerSnapshot(f.context, 2);
      const result = await f.coordinator.finishOwner(snapshot, requestFor(payload => [
        durableCandidate(snapshot, snapshot.fragments[0], [snapshot.ownerId]),
        { ...durableCandidate(snapshot, snapshot.fragments[0], [999]), text: "越界实体候选。" }
      ]));
      assert.equal(result.status, "STORE");
      assert.equal(result.entryIds.length, 1);
      assert.equal(f.coordinator.store.query(snapshot).length, 1);
      const rejection = f.trace.list().find(entry => entry.stage === "memory4_candidate_rejected");
      assert.equal(rejection.memory4RejectedUnknownEntityCount, 1);
      assert.equal(JSON.stringify(rejection).includes("越界实体候选"), false);
    });
    await checkAsync("a valid commitment transition prevents unknown-entry rejection from becoming empty success", async () => {
      const quote = "我已经归还玉印，履行了归还玉印的承诺。";
      const f = fixture("mixed-transition", { sourceText: "我承诺归还玉印。", segmentText: "我承诺归还玉印。" });
      const initial = f.coordinator.buildOwnerSnapshot(f.context, 2);
      const saved = f.coordinator.store.commitOwner(initial, { status: "STORE", entries: [{
        memoryType: "COMMITMENT", text: "我承诺归还玉印。", fragmentIds: [initial.fragments[0].fragmentId],
        entityIds: [1], participantIds: [1, 2], topics: ["玉印"], eventTime: { status: "unknown" }
      }] });
      const context = { ...f.context, conversationId: "mixed-transition-follow-up", finalizationId: "final-mixed-transition-follow-up",
        episodeId: "episode-mixed-transition-follow-up", date: "1164.8.12",
        messages: [{ id: 1, role: "assistant", speakerCharacterId: 1, content: quote }],
        verifiedSummarySegments: [{ segmentId: "segment-mixed-transition-follow-up", content: quote,
          participants: [1, 2, 3], visibility: "participants", source: "spoken", knownBy: [1, 2, 3],
          provenance: { messageIds: [1], speakerIds: [1] } }] };
      const snapshot = f.coordinator.buildOwnerSnapshot(context, 2);
      const result = await f.coordinator.finishOwner(snapshot, requestFor(payload => [
        durableCandidate(snapshot, snapshot.fragments[0], [999])
      ], "STORE", payload => [{ entryId: saved.entryIds[0], expectedRevision: 1, status: "fulfilled",
        fragmentIds: [payload.fragments[0].fragmentId], commitmentQuote: "归还玉印", evidenceQuote: quote }]));
      assert.equal(result.status, "NO_DURABLE_CONTENT");
      assert.equal(result.commitmentTransitionCount, 1);
      assert.equal(f.coordinator.store.readEntry(snapshot, saved.entryIds[0]).state.status, "fulfilled");
      assert.equal(f.coordinator.getRecoveryStatus(snapshot.campaignToken).pending, 0);
      assert.equal(f.trace.list().find(entry => entry.stage === "memory4_candidate_rejected").memory4RejectedUnknownEntityCount, 1);
    });
    await checkAsync("legacy recompression reports all-invalid entity output as extraction failure", async () => {
      const f = fixture("legacy-recompression");
      const scope = { campaignToken: f.context.campaignToken, ownerId: 2 };
      const sourceFact = f.coordinator.baseStore.saveMemory({ memoryId: "legacy-fact", content: "1164年答应交还玉印。",
        knownBy: [2], subjects: [999], provenance: { campaignToken: scope.campaignToken, folderOwnerId: 2, speakerIds: [1] } });
      const parent = { memoryId: "legacy-parent", eventDate: "1164.8.11", knownBy: [2],
        content: `【乙能够知道并记住的本场内容】\n- ${sourceFact.content}`,
        provenance: { campaignToken: scope.campaignToken, folderOwnerId: 2, perspectiveMemoryIds: [sourceFact.memoryId] } };
      f.coordinator.baseStore.loadFolderSummariesForCharacter = () => [parent];
      f.coordinator.configureDerived({ requestExtraction: async prompt => {
        const fragment = JSON.parse(prompt[1].content).fragments[0];
        return JSON.stringify({ status: "STORE", entries: [{ memoryType: "MAJOR_EXPERIENCE", text: fragment.text,
          fragmentIds: [fragment.fragmentId], entityIds: [998], participantIds: [], topics: [], eventTime: { status: "unknown" } }] });
      } });
      const result = await f.coordinator.recompressLegacy(scope, { memoryId: parent.memoryId });
      assert.equal(result.status, "EXTRACTION_FAILED");
      assert.equal(result.reason, "memory4_response_no_valid_entries");
      assert.equal(f.coordinator.store.query(scope).length, 0);
      assert.equal(f.trace.list().find(entry => entry.stage === "memory4_candidate_rejected").memory4RejectedUnknownEntityCount, 1);
      f.coordinator.configureDerived({ requestExtraction: async () => JSON.stringify({ status: "NO_DURABLE_CONTENT", entries: [] }) });
      const empty = await f.coordinator.recompressLegacy(scope, { memoryId: parent.memoryId });
      assert.equal(empty.status, "RETAINED_LEGACY");
      assert.equal(empty.reason, "NO_DURABLE_CONTENT");
      assert.equal(f.coordinator.store.query(scope).length, 0);
    });
    await checkAsync("genuine zero-memory response commits NO_DURABLE_CONTENT without recovery or derived work", async () => {
      const f = fixture("genuine-empty", { annotated: true });
      const snapshot = f.coordinator.buildOwnerSnapshot(f.context, 2);
      const result = await f.coordinator.finishOwner(snapshot, requestFor([], "NO_DURABLE_CONTENT"));
      assert.equal(result.status, "NO_DURABLE_CONTENT");
      assert.equal(result.entryIds.length, 0);
      assert.equal(f.coordinator.getRecoveryStatus(snapshot.campaignToken).pending, 0);
      assert.equal(f.scheduled.length, 0);
    });
    assert.deepEqual(failures, [], failures.join("\n"));
    console.log(`V8.14.2 Durable generation incident: ${assertions} checks passed`);
  } finally {
    assert(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(root, { recursive: true, force: true });
  }
}

run().catch(error => { console.error(error.stack); process.exitCode = 1; });
