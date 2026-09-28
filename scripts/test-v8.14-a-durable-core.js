"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { MemoryStore } = require("../resources/app/out/main/memory-system/memory-store");
const { Memory4Store } = require("../resources/app/out/main/memory-system/memory4-store");
const { Memory4Coordinator } = require("../resources/app/out/main/memory-system/memory4-coordinator");
const { MemoryEngine } = require("../resources/app/out/main/memory-system/memory-engine");
const { createSummariesManager } = require("../resources/app/out/main/summaries/summaries-manager");
const { validateEntry, hash } = require("../resources/app/out/main/memory-system/memory4-contract");
const { projectVisibleTranscript, updateKnownEntities } = require("../resources/app/out/main/memory-system/memory4-visibility");
const { buildLegacyBridge } = require("../resources/app/out/main/memory-system/memory4-legacy-bridge");
const { createMemoryRecord } = require("../resources/app/out/main/memory-system/memory-types");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "votc-memory4-core-"));
let assertions = 0;
function check(name, test) { test(); assertions++; console.log(`PASS ${name}`); }
async function checkAsync(name, test) { await test(); assertions++; console.log(`PASS ${name}`); }
async function run() {
try {
  const folders = path.join(root, "summaries");
  for (const id of [1, 2, 3]) fs.mkdirSync(path.join(folders, `${id}_fixture`), { recursive: true });
  const store = new MemoryStore({ baseDir: path.join(root, "memory"), summaryFoldersDir: folders });
  const memory4 = new Memory4Store(store);
  const text = "我准备议和。心里却希望他失败。";
  const context = { campaignToken: "campaign-A", conversationId: "conversation-1", finalizationId: "final-1", episodeId: "episode-1", date: "1164.1.1", totalDays: 425000,
    participants: [1, 2, 3].map(id => ({ id })), participantPresence: [
      { characterId: 1, joinedAtMessageId: 0, leftAtMessageId: null },
      { characterId: 2, joinedAtMessageId: 0, leftAtMessageId: 5 },
      { characterId: 3, joinedAtMessageId: 5, leftAtMessageId: null }
    ], messages: [{ id: 1, role: "assistant", speakerCharacterId: 1, content: text, memory4Fragments: [
      { start: 0, end: 6, visibility: "participants", sourceType: "spoken", recipientIds: [2], entityIds: [] },
      { start: 6, end: text.length, visibility: "private", sourceType: "spoken", entityIds: [99] }
    ] }] };
  const projection = projectVisibleTranscript(context, 2);
  const snapshot = { ...context, ...projection, ownerId: 2, counterpartIds: [1], summaryIds: ["summary-1"] };
  const candidate = { memoryType: "LONG_TERM_GOAL", text: "甲提出议和意向。", fragmentIds: [projection.fragments[0].fragmentId],
    participantIds: [1, 2], entityIds: [1], topics: ["议和"], eventTime: { status: "unknown" } };
  check("private fragments do not reach observer", () => {
    assert.equal(projection.fragments.length, 1);
    assert.equal(projection.fragments[0].text, "我准备议和。");
    assert.equal(JSON.stringify(projection).includes("失败"), false);
    assert.equal(projectVisibleTranscript(context, 1).fragments.length, 2);
  });
  check("late join, early leave and rejoin use half-open source windows", () => {
    assert.equal(projectVisibleTranscript(context, 3).presentMessageCount, 0);
    const later = { ...context, messages: [{ ...context.messages[0], id: 5 }, { ...context.messages[0], id: 10 }] };
    assert.equal(projectVisibleTranscript(later, 2).presentMessageCount, 0);
    later.participantPresence = [...context.participantPresence, { characterId: 2, joinedAtMessageId: 10, leftAtMessageId: null }];
    assert.equal(projectVisibleTranscript(later, 2).fragments.length, 1);
  });
  check("unannotated text is incomplete, never presumed public", () => {
    const legacy = projectVisibleTranscript({ ...context, messages: [{ ...context.messages[0], memory4Fragments: undefined }] }, 2);
    assert.equal(legacy.completeness, "partial");
    assert.deepEqual(legacy.fragments, []);
    const result = memory4.commitOwner({ ...snapshot, ...legacy, finalizationId: "legacy-only", conversationId: "legacy-only" }, { status: "NO_DURABLE_CONTENT", entries: [] });
    assert.equal(result.completeness, "partial");
    assert.equal(result.legacyRetained, true);
    assert.equal(result.noDetailIsNotUnknown, true);
    const missingSpan = projectVisibleTranscript({ ...context, messages: [{ ...context.messages[0], memory4Fragments: [context.messages[0].memory4Fragments[0]] }] }, 2);
    assert.equal(missingSpan.completeness, "partial");
  });
  check("ambiguous prose permits self but never guesses bystanders", () => {
    const legacyContext = { ...context, messages: [{ ...context.messages[0], memory4Fragments: undefined, knownBy: [1, 2], visibility: "public" }] };
    const own = projectVisibleTranscript(legacyContext, 1);
    const observer = projectVisibleTranscript(legacyContext, 2);
    assert.equal(own.fragments.length, 1);
    assert.equal(own.fragments[0].text, text);
    assert.deepEqual(own.fragments[0].knownBy, [1]);
    assert.equal(own.fragments[0].visibilityEvidence, "legacy_author_perspective");
    assert.equal(observer.fragments.length, 0);
    assert.equal(own.completeness, "partial");
    const entry = validateEntry({ ...candidate, fragmentIds: [own.fragments[0].fragmentId] }, { ...snapshot, ...own, ownerId: 1, counterpartIds: [2] });
    assert.equal(entry.evidence.completeness, "partial");
    assert.deepEqual(entry.evidence.knownBy, [1]);
    assert.throws(() => validateEntry({ ...candidate, fragmentIds: [own.fragments[0].fragmentId] }, { ...snapshot, ...observer }), /invisible_source/);
  });
  check("trusted public slice reused while adjacent unknown text remains self-only", () => {
    const mixed = { ...context, messages: [{ ...context.messages[0], memory4Fragments: [context.messages[0].memory4Fragments[0]] }] };
    const own = projectVisibleTranscript(mixed, 1);
    const other = projectVisibleTranscript(mixed, 2);
    assert.equal(own.fragments.length, 2);
    assert.equal(other.fragments.length, 1);
    assert.equal(other.fragments[0].text, "我准备议和。");
    assert.equal(other.completeness, "partial");
    assert.deepEqual(other.fragments[0].knownBy, [1, 2]);
    const result = memory4.commitOwner({ ...snapshot, ...other, campaignToken: "partial-safe-campaign", finalizationId: "partial-safe" }, { status: "STORE", entries: [candidate] });
    assert.equal(result.completeness, "partial");
    assert.equal(result.entryIds.length, 1);
  });
  check("existing knownBy narrows trusted fragments without granting new audience", () => {
    const restricted = { ...context, messages: [{ ...context.messages[0], knownBy: [1] }] };
    assert.equal(projectVisibleTranscript(restricted, 2).fragments.length, 0);
    const group = JSON.parse(JSON.stringify(context));
    group.messages[0].memory4Fragments[0] = { ...group.messages[0].memory4Fragments[0], visibility: "known_group", knownBy: [1, 2, 3], recipientIds: [] };
    assert.equal(projectVisibleTranscript(group, 2).fragments.length, 1);
    assert.equal(projectVisibleTranscript(group, 3).fragments.length, 0);
  });
  check("old unique speaker identity works, duplicate names never resolve by guess", () => {
    const old = { ...context, participantPresence: [], participants: [{ id: 1, name: "甲" }, { id: 2, name: "乙" }],
      messages: [{ id: 1, role: "assistant", name: "甲", content: text }] };
    assert.equal(projectVisibleTranscript(old, 1).fragments.length, 1);
    assert.equal(projectVisibleTranscript(old, 2).fragments.length, 0);
    old.participants[1].name = "甲";
    assert.equal(projectVisibleTranscript(old, 1).fragments.length, 0);
  });
  check("manual legacy perspective grants only its explicit owner, not all participants", () => {
    const record = createMemoryRecord({ memoryId: "edited-record", content: "我已收到甲的提醒。", updatedBy: "user", knownBy: [2], subjects: [1],
      provenance: { campaignToken: "campaign-A", folderOwnerId: 2, finalizationId: "final-1", extractionMode: "user_edited_summary" } });
    const c = { ...context, messages: [], legacyMemories: [record] };
    assert.equal(projectVisibleTranscript(c, 2).fragments.length, 1);
    assert.equal(projectVisibleTranscript(c, 1).fragments.length, 0);
    assert.equal(projectVisibleTranscript({ ...c, campaignToken: "campaign-B" }, 2).fragments.length, 0);
    record.updatedBy = "model";
    record.provenance.extractionMode = "structured";
    assert.equal(projectVisibleTranscript(c, 2).fragments.length, 0);
  });
  check("shared scene survives zero Detail; unknown is not never acquainted", () => {
    const noDetail = projectVisibleTranscript({ ...context, messages: [{ ...context.messages[0], memory4Fragments: undefined }] }, 2);
    memory4.recordKnownEvidence({ ...snapshot, ...noDetail });
    const known = memory4.getKnownEntityEvidence(snapshot, 1);
    assert.equal(known.status, "SHARED_SCENE");
    assert.equal(known.directConversationCount, 0);
    const unknown = memory4.getKnownEntityEvidence(snapshot, 999);
    assert.equal(unknown.status, "UNKNOWN");
    assert.equal(unknown.reason, "INSUFFICIENT_EVIDENCE");
  });
  check("Legacy owner/campaign lane retains full projections and existing temporal index", () => {
    const legacy = createMemoryRecord({ memoryId: "legacy-summary", type: "folder_summary", content: "五件旧事仍保留完整正文。", eventDate: "1154.1.1", knownBy: [2],
      provenance: { campaignToken: "campaign-A", folderOwnerId: 2, counterpartId: 1, counterpartIds: [1], projectionHash: "old-hash", perspectiveMemoryIds: ["one", "two"] } });
    const before = JSON.stringify(legacy);
    const bridge = buildLegacyBridge([legacy, { ...legacy, memoryId: "private-other", knownBy: [3] },
      { ...legacy, memoryId: "other-campaign", provenance: { ...legacy.provenance, campaignToken: "campaign-B" } }],
    { ...snapshot, currentGameDate: "1164.1.1", currentTotalDays: 425000 });
    assert.equal(bridge.memories.length, 1);
    assert.equal(bridge.memories[0].content, legacy.content);
    assert.equal(bridge.coverage[0].forcedMigration, false);
    assert.equal(bridge.coverage[0].visibilityEvidence, "legacy visibility evidence");
    assert.equal(bridge.temporalIndex.length > 0, true);
    assert.equal(JSON.stringify(legacy), before);
  });
  check("private fragment cannot be referenced by another owner", () => {
    const privateId = projectVisibleTranscript(context, 1).fragments[1].fragmentId;
    assert.throws(() => validateEntry({ ...candidate, fragmentIds: [privateId] }, snapshot), /invisible_source/);
  });
  check("restricted recipients do not expand to all present", () => {
    const group = JSON.parse(JSON.stringify(context));
    group.messages[0].memory4Fragments[0].visibility = "known_group";
    group.messages[0].memory4Fragments[0].recipientIds = [3];
    assert.equal(projectVisibleTranscript(group, 2).fragments.length, 0);
    assert.equal(projectVisibleTranscript(group, 3).fragments.length, 0);
  });
  check("unsupported dates, outside entities, owner and campaign rejected", () => {
    assert.throws(() => validateEntry({ ...candidate, ownerId: 3 }, snapshot), /scope_mismatch/);
    assert.throws(() => validateEntry({ ...candidate, campaignToken: "other" }, snapshot), /scope_mismatch/);
    assert.throws(() => validateEntry({ ...candidate, entityIds: [99] }, snapshot), /unknown_entity/);
    assert.throws(() => validateEntry(candidate, { ...snapshot, counterpartIds: [999999] }), /invalid_counterpart/);
    assert.throws(() => validateEntry({ ...candidate, eventTime: { from: "1154.1.1", to: "1154.12.31", precision: "year", status: "reported" } }, snapshot), /unsupported_event_date/);
    assert.throws(() => validateEntry({ ...candidate, eventTime: { status: "observed" } }, snapshot), /unverified_observation/);
    assert.equal(validateEntry(candidate, snapshot).eventTime.from, null);
  });
  check("explicit past event date distinct from conversation and acquired dates", () => {
    const historical = { ...snapshot, fragments: [{ ...snapshot.fragments[0], text: "1154年发生战争。" }] };
    const entry = validateEntry({ ...candidate, eventTime: { from: "1154.1.1", to: "1154.12.31", precision: "year", status: "reported" } }, historical);
    assert.equal(entry.conversationDate, "1164.1.1");
    assert.equal(entry.acquiredDate, "1164.1.1");
    assert.equal(entry.eventTime.from, "1154.1.1");
    assert.equal(entry.evidence.epistemicStatus, "reported");
  });
  check("idempotent owner commit and source revision conflict", () => {
    const result = memory4.commitOwner(snapshot, { status: "STORE", entries: [candidate] });
    const indexBefore = memory4.loadIndex(snapshot);
    assert.equal(result.entryIds.length, 1);
    assert.equal(memory4.commitOwner(snapshot, { status: "STORE", entries: [candidate] }).alreadyCommitted, true);
    assert.deepEqual(memory4.loadIndex(snapshot), indexBefore);
    assert.throws(() => memory4.commitOwner({ ...snapshot, sourceRevision: "changed" }, { status: "STORE", entries: [candidate] }), /source_revision_conflict/);
  });
  check("entry ids are stable under result ordering and separate facts", () => {
    const a = validateEntry(candidate, snapshot);
    const b = validateEntry({ ...candidate, text: "甲希望长期维持停战。" }, snapshot);
    assert.equal(validateEntry(candidate, snapshot).entryId, a.entryId);
    assert.notEqual(a.entryId, b.entryId);
  });
  check("campaign and owner isolate files and index reads", () => {
    assert.equal(memory4.query(snapshot).length, 1);
    assert.deepEqual(memory4.query({ ...snapshot, campaignToken: "campaign-B" }), []);
    assert.deepEqual(memory4.query({ ...snapshot, ownerId: 1 }), []);
    assert.throws(() => memory4.query({ ...snapshot, campaignToken: null }), /scope_required/);
    assert.throws(() => memory4.query({ ...snapshot, ownerId: 0 }), /scope_required/);
  });
  check("zero durable keeps Narrative bytes and known interaction evidence", () => {
    const narrative = path.join(folders, "2_fixture", "narrative.json");
    fs.writeFileSync(narrative, '[{"content":"普通闲聊摘要仍必须保留"}]');
    const before = fs.readFileSync(narrative);
    const next = { ...snapshot, finalizationId: "final-zero", conversationId: "conversation-zero", sourceRevision: "source-zero" };
    memory4.commitOwner(next, { status: "NO_DURABLE_CONTENT", entries: [] });
    assert.deepEqual(fs.readFileSync(narrative), before);
    const known = memory4.read(path.join(memory4.directory(snapshot), "known-entities.json"), null);
    assert.equal(known.entities[1].directConversationCount, 2);
    assert.equal(memory4.query(snapshot).length, 1);
  });
  check("known evidence deduplicates mirror/chunk/retry and separates mention/shared", () => {
    const s = { ...snapshot, fragments: [{ ...snapshot.fragments[0], recipientIds: [], entityIds: [99] }] };
    const first = updateKnownEntities(null, s);
    const second = updateKnownEntities(first, s);
    assert.equal(second.entities[1].sharedSceneCount, 1);
    assert.equal(second.entities[1].directConversationCount, 0);
    assert.equal(second.entities[99].mentionCount, 1);
    assert.equal(second.entities[99].directConversationCount, 0);
    const older = updateKnownEntities(second, { ...s, date: "1150.1.1", conversationId: "earlier" });
    const later = updateKnownEntities(older, { ...s, date: "1170.1.1", conversationId: "later" });
    assert.equal(later.entities[99].firstSeenDate, "1150.1.1");
    assert.equal(later.entities[99].lastSeenDate, "1170.1.1");
  });
  check("mid-transaction failure rolls back body and index", () => {
    const before = fs.readFileSync(path.join(memory4.directory(snapshot), "index.json"));
    const original = store.writeJson.bind(store);
    let injected = false;
    store.writeJson = (file, value) => {
      if (!injected && file.endsWith("known-entities.json")) { injected = true; throw new Error("injected_failure"); }
      return original(file, value);
    };
    assert.throws(() => memory4.commitOwner({ ...snapshot, finalizationId: "rollback" }, { status: "STORE", entries: [{ ...candidate, text: "新事实" }] }), /injected_failure/);
    store.writeJson = original;
    assert.deepEqual(fs.readFileSync(path.join(memory4.directory(snapshot), "index.json")), before);
    assert.equal(memory4.query(snapshot).length, 1);
  });
  check("missing and corrupt index fail closed", () => {
    const file = path.join(memory4.directory(snapshot), "index.json");
    const bytes = fs.readFileSync(file);
    fs.writeFileSync(file, "{");
    assert.throws(() => memory4.query(snapshot), /corrupt_json/);
    fs.writeFileSync(file, JSON.stringify({ ...JSON.parse(bytes), byOwner: {} }));
    assert.throws(() => memory4.query(snapshot), /metadata_index_mismatch/);
    fs.unlinkSync(file);
    assert.throws(() => memory4.query(snapshot), /index_missing/);
    fs.writeFileSync(file, bytes);
  });
  check("body corruption and cross-campaign replacement fail closed", () => {
    const entry = memory4.query(snapshot)[0];
    const file = path.join(memory4.directory(snapshot), "entries", `${entry.entryId}.json`);
    const bytes = fs.readFileSync(file);
    fs.writeFileSync(file, JSON.stringify({ ...entry, campaignToken: "campaign-B" }));
    assert.throws(() => memory4.query(snapshot), /index_body_mismatch/);
    fs.writeFileSync(file, bytes);
  });
  check("tombstone blocks index lookup and committed retry resurrection", () => {
    const id = memory4.query(snapshot)[0].entryId;
    assert.equal(memory4.deleteEntry(snapshot, id), true);
    assert.deepEqual(memory4.query(snapshot), []);
    memory4.commitOwner(snapshot, { status: "STORE", entries: [candidate] });
    assert.deepEqual(memory4.query(snapshot), []);
    assert.equal(memory4.read(path.join(memory4.directory(snapshot), "metadata.json"), null).derivedDirty, true);
  });
  check("indexed candidate query does not read 1000 detail bodies", () => {
    const scope = { campaignToken: "large", ownerId: 3 };
    const directory = memory4.directory(scope);
    const index = memory4.loadIndex(scope);
    fs.mkdirSync(path.join(directory, "entries"), { recursive: true });
    for (let i = 0; i < 1000; i++) {
      const entry = { ...validateEntry(candidate, snapshot), ...scope, entryId: `m4_${hash(i)}`, topics: [`topic-${i}`] };
      if (i === 10) entry.eventTime = { from: "1158.8.11", to: "1158.8.13", precision: "range", status: "reported" };
      if (i === 11) entry.eventTime = { from: "1154.1.1", to: "1154.12.31", precision: "year", status: "reported" };
      fs.writeFileSync(path.join(directory, "entries", `${entry.entryId}.json`), JSON.stringify(entry));
      index.entries[entry.entryId] = memory4.indexRow(entry);
    }
    memory4.reindex(index);
    fs.writeFileSync(path.join(directory, "index.json"), JSON.stringify(index));
    fs.writeFileSync(path.join(directory, "metadata.json"), JSON.stringify({ ...scope, revision: index.revision, indexHash: hash(index) }));
    const original = memory4.read.bind(memory4);
    let bodies = 0;
    memory4.read = (file, fallback) => { if (path.dirname(file).endsWith("entries")) bodies++; return original(file, fallback); };
    assert.equal(memory4.query(scope, { byTopic: "topic-413" }).length, 1);
    assert.equal(bodies, 1);
    assert.equal(memory4.query(scope, { byEventDate: "1158.8.12" }).length, 1);
    assert.equal(memory4.query(scope, { byEventDate: "1154.1.1" }).length, 0, "year precision must not invent an exact day hit");
    memory4.read = original;
  });
  await checkAsync("Narrative commit starts owner-isolated Durable; failure retries without replaying successful owner", async () => {
    const engine = new MemoryEngine({ store, trace: { record() {} } });
    const coordinator = engine.memory4;
    const c = { ...context, campaignToken: "campaign-coordinator", conversationId: "coordinator-c", finalizationId: "coordinator-f",
      episodeId: "coordinator-e", participants: [{ id: 1 }, { id: 2 }],
      participantPresence: context.participantPresence.slice(0, 2),
      messages: [{ ...context.messages[0], content: "我准备议和。", memory4Fragments: [context.messages[0].memory4Fragments[0]] }] };
    let narrativeRequests = 0, ownerOneRequests = 0, ownerTwoRequests = 0;
    engine.finalizeWithAvailableOutput = async () => ({ success: true, finalSummary: "已提交的 Narrative" });
    engine.isCommitted = () => ({ commitMarker: "narrative_committed", campaignToken: c.campaignToken, participants: c.participants });
    assert.equal(engine.isMemory4NarrativeCommitted({ ...c, campaignToken: "another" }), false);
    assert.equal(engine.isMemory4NarrativeCommitted({ ...c, ownerId: 3 }), false);
    const requestDurable = async (prompt, options) => {
      assert.equal(prompt[1].content.includes("失败"), false);
      if (options.ownerId === 1) ownerOneRequests++;
      else if (++ownerTwoRequests === 1) throw new Error("temporary_provider_failure");
      const fragmentId = JSON.parse(prompt[1].content).fragments[0].fragmentId;
      return { content: JSON.stringify({ status: "STORE", entries: [{ memoryType: "LONG_TERM_GOAL", text: "提出议和意向。", fragmentIds: [fragmentId],
        participantIds: [], entityIds: [], topics: ["议和"], eventTime: { status: "unknown" } }] }) };
    };
    const first = await engine.finalizeConversation({ ...c, requestSummary: () => narrativeRequests++, requestDurable });
    assert.equal(first.success, true);
    assert.equal(first.durable.status, "PARTIAL_FAILURE");
    assert.deepEqual(first.durable.owners.map(row => row.status), ["STORE", "EXTRACTION_FAILED"]);
    assert.equal(coordinator.getRecoveryStatus(c.campaignToken).pending, 1);
    const manager = createSummariesManager({ fs, path, summariesDir: folders, memoryEngine: engine, memorySystem: null,
      getCurrentConversation: () => ({ id: "active", gameData: { campaignToken: c.campaignToken } }) });
    assert.equal(manager.getRecoveryStatus().durablePending, 1);
    assert.equal(manager.getRecoveryStatus().pending, 1);
    assert.equal(coordinator.store.query({ campaignToken: c.campaignToken, ownerId: 1 }).length, 1);
    assert.equal((await coordinator.recoverPending(requestDurable, { activeCampaignToken: "another", isNarrativeCommitted: () => true }))[0].status, "CAMPAIGN_MISMATCH");
    assert.equal((await coordinator.recoverPending(requestDurable, { activeCampaignToken: c.campaignToken, isNarrativeCommitted: () => false }))[0].status, "WAITING_NARRATIVE");
    const restarted = new Memory4Coordinator(store);
    const recovered = await restarted.recoverPending(requestDurable, { activeCampaignToken: c.campaignToken, isNarrativeCommitted: () => true });
    assert.equal(recovered[0].status, "STORE");
    assert.equal(restarted.getRecoveryStatus(c.campaignToken).pending, 0);
    assert.equal(ownerOneRequests, 1);
    assert.equal(ownerTwoRequests, 2);
    assert.equal(narrativeRequests, 0);
    assert.equal((await engine.finalizeConversation({ ...c, requestDurable })).durable.owners[0].alreadyCommitted, true);
    assert.equal(ownerOneRequests, 1);
  });
  await checkAsync("corrupt recovery is isolated from valid owner retry", async () => {
    const coordinator = new Memory4Coordinator(store);
    const c = { ...context, campaignToken: "campaign-corrupt", conversationId: "corrupt-c", finalizationId: "corrupt-f",
      episodeId: "corrupt-e", participants: [{ id: 1 }], messages: [] };
    coordinator.saveRecovery(coordinator.buildOwnerSnapshot(c, 1), { status: "PENDING", retryCount: 0 });
    const corruptFile = path.join(coordinator.recoveryDir, `${"a".repeat(64)}.json`);
    fs.writeFileSync(corruptFile, "{");
    assert.equal(coordinator.getRecoveryStatus(c.campaignToken).invalid, 1);
    const results = await coordinator.recoverPending(null, { activeCampaignToken: c.campaignToken, isNarrativeCommitted: () => true });
    assert.equal(results.some(result => result.status === "NOT_PRESENT"), true);
    assert.equal(results.some(result => result.error === "memory4_recovery_corrupt"), true);
  });
  console.log(`Memory4 deterministic core: ${assertions} checks passed (not Phase A acceptance)`);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
}
run().catch(error => { console.error(error); process.exitCode = 1; });
