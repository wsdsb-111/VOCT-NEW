// Historical V8.15 Durable orphan-audit behavior; run only with the matching pre-V9.3.4 baseline out files.
// This archived suite is not a current release check.
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { MemoryEngine } = require("../resources/app/out/main/memory-system");
const { Memory4OrphanAudit } = require("../resources/app/out/main/memory-system/memory4-orphan-audit");
const { createProjectionLineage } = require("../resources/app/out/main/memory-system/memory4-forget");
const { hash } = require("../resources/app/out/main/memory-system/memory4-contract");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v815-retired-durable-audit-"));
const campaignToken = "votc-v815-independent-qa-campaign";
const ownerId = 2;
const summaryDate = "1164.1.1";
const names = new Map([[1, "玩家"], [2, "张道素"], [3, "赵光义"], [4, "赵匡胤"], [5, "旧友"]]);
let checks = 0;
const failures = [];

function check(name, operation) {
  return Promise.resolve().then(operation).then(() => {
    checks++;
    console.log(`PASS ${name}`);
  }).catch(error => {
    failures.push({ name, error });
    console.error(`FAIL ${name}: ${error.message}`);
  });
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2), "utf8");
}
function snapshotTree(directory) {
  const result = {};
  const visit = current => {
    if (!fs.existsSync(current)) return;
    for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(current, entry.name);
      if (entry.isSymbolicLink()) throw new Error("unexpected_test_symlink");
      if (entry.isDirectory()) visit(file);
      else result[path.relative(directory, file)] = {
        bytes: fs.readFileSync(file).toString("base64"),
        mtimeMs: fs.statSync(file).mtimeMs
      };
    }
  };
  visit(directory);
  return result;
}
function summaryRow({ owner = ownerId, counterpart = 5, subjectIds = [], content, date = summaryDate,
  conversationId = "qa-summary-conversation", finalizationId = "qa-summary-finalization",
  segmentId = "qa-summary-segment", projectionId = null, perspectiveMemoryIds = [], campaign = campaignToken,
  includeLineage = true } = {}) {
  const row = { playerId: owner, characterId: counterpart, perspectiveOwnerId: owner,
    playerName: names.get(owner), characterName: names.get(counterpart) || `人物${counterpart}`,
    content, date, totalDays: 425000, campaignToken: campaign, campaignBinding: { status: "bound" },
    participants: [...new Set([owner, counterpart, ...subjectIds])].map(id => ({ id, name: names.get(id) || `人物${id}`,
      shortName: names.get(id) || `人物${id}`, fullName: names.get(id) || `人物${id}` })) };
  if (includeLineage) Object.assign(row, { conversationId, finalizationId,
    perspectiveSummarySegmentIds: [segmentId], perspectiveMemoryIds,
    ...(projectionId ? { projectionId } : {}) });
  return row;
}
function fragment(fragmentId, counterpartIds) {
  return { fragmentId, messageId: fragmentId, sourceMessageIds: [fragmentId], text: `source ${fragmentId}`,
    speakerId: ownerId, speakerIds: [ownerId], sourceTextVerified: true, sourceRole: "assistant",
    presentIds: [ownerId, ...counterpartIds], knownBy: [ownerId, ...counterpartIds], visibility: "participants",
    sourceType: "spoken", recipientIds: counterpartIds, entityIds: counterpartIds, visibilityEvidence: "application_fragment" };
}

function commitCanonical(engine, { finalizationId, fragments, counterpartIds, entries, projectionLineages = [] }) {
  const snapshot = { campaignToken, ownerId, conversationId: `conversation-${finalizationId}`, finalizationId,
    episodeId: `episode-${finalizationId}`, date: summaryDate, totalDays: 425000,
    sourceRevision: hash([finalizationId, "source"]), presentMessageCount: fragments.length,
    completeness: "complete", summaryIds: [], counterpartIds, fragments, projectionLineages };
  return engine.memory4.store.commitOwner(snapshot, { status: "STORE", entries });
}

function canonicalEntry(text, fragmentId, counterpartIds, topics, entityIds) {
  return { memoryType: "DURABLE_KNOWLEDGE", text, fragmentIds: [fragmentId],
    participantIds: [ownerId, ...counterpartIds], entityIds, topics, eventTime: { status: "unknown" } };
}
function createAuditFixture(directory, { includeRecovery = false, includeVisibleC = true,
  visibleA = false, inferredUnknown = false, unprovenSharedCoverage = false, singleProjectionA = false } = {}) {
  const summariesDir = path.join(directory, "summaries");
  const ownerFolder = path.join(summariesDir, "2_张道素");
  fs.mkdirSync(ownerFolder, { recursive: true });
  const engine = new MemoryEngine({ baseDir: path.join(directory, "memory"), summaryFoldersDir: summariesDir,
    trace: { record() {} } });
  const scope = { campaignToken, ownerId };
  const conversationId = `orphan-conversation-${path.basename(directory)}`;
  const finalizationId = `orphan-finalization-${path.basename(directory)}`;
  const sourceA = "orphan-source-a", sourceC = "orphan-source-c";
  const projectionA = createProjectionLineage({ ...scope, conversationId, finalizationId, counterpartId: 1,
    segmentIds: ["summary-A"], sourceSegmentIds: [sourceA], sourceMessageIds: [10] });
  const projectionC = createProjectionLineage({ ...scope, conversationId, finalizationId, counterpartId: 3,
    segmentIds: ["summary-C"], sourceSegmentIds: [unprovenSharedCoverage ? sourceC : sourceA],
    sourceMessageIds: [unprovenSharedCoverage ? 11 : 10] });
  const sharedFragment = fragment(sourceA, unprovenSharedCoverage ? [1] : [1, 3]);
  const snapshot = { campaignToken, ownerId, conversationId, finalizationId, episodeId: `episode-${finalizationId}`,
    date: summaryDate, totalDays: 425000, sourceRevision: hash([finalizationId, "shared"]), presentMessageCount: 1,
    completeness: "complete", summaryIds: [], counterpartIds: [1, 3], fragments: [sharedFragment],
    projectionLineages: inferredUnknown ? [] : singleProjectionA ? [projectionA] : [projectionA, projectionC] };
  const entry = inferredUnknown
    ? canonicalEntry("AMBIGUOUS_SOURCE_ENTRY", sourceA, [1, 3], ["shared"], [1, 3])
    : canonicalEntry("SHARED_CANONICAL_SENTINEL", sourceA, [1, 3], ["shared"], [1, 3]);
  if (inferredUnknown) {
    snapshot.fragments = [sharedFragment, { ...fragment(sourceC, [3]), messageId: 11 }];
    snapshot.presentMessageCount = 2;
    entry.fragmentIds = [sourceA, sourceC];
  }
  if (unprovenSharedCoverage) {
    snapshot.fragments = [sharedFragment, { ...fragment(sourceC, [3]), messageId: 11 }];
    snapshot.presentMessageCount = 2;
    entry.fragmentIds = [sourceA, sourceC];
  }
  const committed = engine.memory4.store.commitOwner(snapshot, { status: "STORE", entries: [entry] });
  const entryId = committed.entryIds[0];
  if (includeVisibleC) {
    writeJson(path.join(ownerFolder, "与赵光义的对话.json"), [summaryRow({ counterpart: 3,
      subjectIds: [3], content: "VISIBLE_C_SHARED_SOURCE", conversationId, finalizationId,
      segmentId: "summary-C", projectionId: inferredUnknown ? null : projectionC.projectionId })]);
  }
  if (visibleA) {
    writeJson(path.join(ownerFolder, "与玩家的对话.json"), [summaryRow({ counterpart: 1,
      subjectIds: [1], content: "AMBIGUOUS_VISIBLE_A", conversationId: null, finalizationId: null,
      includeLineage: false })]);
  }
  if (includeRecovery) engine.memory4.saveRecovery(snapshot, { status: "PENDING", retryCount: 0, lastError: null });
  return { directory, summariesDir, ownerFolder, engine, scope, snapshot, entryId, projectionA, projectionC,
    auditor: new Memory4OrphanAudit(engine) };
}

function expectStale(fixture, expectedAuditToken, projectionId = fixture.projectionA.projectionId) {
  assert.throws(() => fixture.auditor.forget(fixture.scope, { projectionId, expectedAuditToken, confirmed: true }),
    /memory4_orphan_audit_stale/);
}

async function run() {
  try {
    await check("orphan audit is byte-for-byte read-only and distinguishes shared A orphan from active C", async () => {
      const fixture = createAuditFixture(path.join(root, "shared-read-only"), { includeRecovery: true });
      const before = snapshotTree(fixture.directory);
      const audited = fixture.auditor.audit(fixture.scope);
      assert.deepEqual(snapshotTree(fixture.directory), before, "audit must not persist repair, tombstone, or cache files");
      const a = audited.items.find(item => item.projectionId === fixture.projectionA.projectionId);
      const c = audited.items.find(item => item.projectionId === fixture.projectionC.projectionId);
      assert.equal(a?.status, "ORPHANED_PRE_V815_PROJECTION", JSON.stringify(a));
      assert.equal(c?.status, "ACTIVE", JSON.stringify(c));
      assert.deepEqual(a.canonicalEntryIds, [fixture.entryId]);
      assert.equal(a.recoveryFiles.length, 1, "the audit should identify the recovery source without changing it");
    });

    await check("visible summary with incomplete mapping is UNKNOWN and cannot be forgotten", () => {
      const fixture = createAuditFixture(path.join(root, "visible-unknown"), { includeRecovery: false,
        includeVisibleC: false, visibleA: true });
      const before = snapshotTree(fixture.directory);
      const audited = fixture.auditor.audit(fixture.scope);
      const a = audited.items.find(item => item.projectionId === fixture.projectionA.projectionId);
      assert.equal(a?.status, "UNKNOWN", JSON.stringify(a));
      assert.throws(() => fixture.auditor.forget(fixture.scope, { projectionId: fixture.projectionA.projectionId,
        expectedAuditToken: audited.auditToken, confirmed: true }), /memory4_orphan_not_confirmed/);
      assert.deepEqual(snapshotTree(fixture.directory), before, "UNKNOWN must remain unmodified after rejected forget");
    });

    await check("visible summary with missing counterpart and matching source IDs is UNKNOWN", () => {
      const fixture = createAuditFixture(path.join(root, "visible-missing-counterpart"), { includeVisibleC: false });
      const visible = summaryRow({ counterpart: 1, content: "VISIBLE_WITH_MISSING_COUNTERPART", includeLineage: false });
      delete visible.characterId;
      visible.conversationId = fixture.projectionA.conversationId;
      visible.finalizationId = fixture.projectionA.finalizationId;
      writeJson(path.join(fixture.ownerFolder, "uncertain-pair.json"), [visible]);
      const before = snapshotTree(fixture.directory);
      const audited = fixture.auditor.audit(fixture.scope);
      const a = audited.items.find(item => item.projectionId === fixture.projectionA.projectionId);
      assert.equal(a?.status, "UNKNOWN", JSON.stringify(a));
      assert(a.reasons.includes("VISIBLE_SOURCE_MAPPING_UNCERTAIN"));
      assert.throws(() => fixture.auditor.forget(fixture.scope, { projectionId: fixture.projectionA.projectionId,
        expectedAuditToken: audited.auditToken, confirmed: true }), /memory4_orphan_not_confirmed/);
      assert.deepEqual(snapshotTree(fixture.directory), before, "unknown visible counterpart must block deletion without mutation");
    });

    await check("visible C sharing a Legacy source ID blocks A orphan deletion", () => {
      const fixture = createAuditFixture(path.join(root, "visible-shared-legacy-source"), { includeVisibleC: false,
        singleProjectionA: true });
      const legacyMemoryId = "legacy-source-shared-with-c";
      fixture.engine.store.saveMemory({ memoryId: legacyMemoryId, type: "information", content: "C source retained in Legacy store",
        participants: [ownerId, 3], subjects: [3], knownBy: [ownerId], visibility: "known_group",
        provenance: { campaignToken, folderOwnerId: ownerId, counterpartId: 3, counterpartIds: [ownerId, 3] } });
      const store = fixture.engine.memory4.store, directory = store.directory(fixture.scope);
      const index = store.loadIndex(fixture.scope), entry = store.read(store.entryPath(directory, fixture.entryId), null);
      entry.source.summaryIds = [legacyMemoryId];
      entry.source.projectionLineages = [fixture.projectionA];
      fixture.engine.store.writeJson(store.entryPath(directory, fixture.entryId), entry);
      index.entries[fixture.entryId] = store.indexRow(entry);
      const metadata = store.read(path.join(directory, "metadata.json"), null);
      metadata.indexHash = hash(index);
      fixture.engine.store.writeJson(path.join(directory, "index.json"), index);
      fixture.engine.store.writeJson(path.join(directory, "metadata.json"), metadata);
      writeJson(path.join(fixture.ownerFolder, "visible-c-legacy-ref.json"), [summaryRow({ counterpart: 3,
        subjectIds: [3], content: "VISIBLE_C_STILL_USES_SHARED_LEGACY_SOURCE", projectionId: fixture.projectionC.projectionId,
        conversationId: fixture.projectionC.conversationId, finalizationId: fixture.projectionC.finalizationId,
        segmentId: fixture.projectionC.segmentIds[0], perspectiveMemoryIds: [legacyMemoryId] })]);
      const audited = fixture.auditor.audit(fixture.scope);
      const a = audited.items.find(item => item.projectionId === fixture.projectionA.projectionId);
      assert.equal(a?.status, "UNKNOWN", JSON.stringify(a));
      assert.throws(() => fixture.auditor.forget(fixture.scope, { projectionId: fixture.projectionA.projectionId,
        expectedAuditToken: audited.auditToken, confirmed: true }), /memory4_orphan_not_confirmed/);
      assert(fixture.engine.store.getMemory(legacyMemoryId), "visible C's shared Legacy source must remain stored");
    });

    await check("ambiguous source without a unique counterpart remains UNKNOWN", () => {
      const fixture = createAuditFixture(path.join(root, "source-unknown"), { includeVisibleC: false,
        inferredUnknown: true });
      const before = snapshotTree(fixture.directory);
      const audited = fixture.auditor.audit(fixture.scope);
      const unknown = audited.items.find(item => item.canonicalEntryIds.includes(fixture.entryId));
      assert.equal(unknown?.status, "UNKNOWN", JSON.stringify(unknown));
      assert.equal(unknown?.projectionId, null);
      assert.throws(() => fixture.auditor.forget(fixture.scope, { projectionId: unknown.projectionId,
        expectedAuditToken: audited.auditToken, confirmed: true }), /memory4_orphan_not_confirmed/);
      assert.deepEqual(snapshotTree(fixture.directory), before, "ambiguous lineage must remain unmodified after rejected forget");
    });

    await check("shared canonical with incomplete per-projection coverage stays UNKNOWN", () => {
      const fixture = createAuditFixture(path.join(root, "shared-coverage-unknown"), {
        includeVisibleC: true, unprovenSharedCoverage: true
      });
      const before = snapshotTree(fixture.directory);
      const audited = fixture.auditor.audit(fixture.scope);
      const a = audited.items.find(item => item.projectionId === fixture.projectionA.projectionId);
      assert.equal(a?.status, "UNKNOWN", JSON.stringify(a));
      assert(a.reasons.includes("SHARED_SOURCE_COVERAGE_UNPROVEN"));
      assert.throws(() => fixture.auditor.forget(fixture.scope, { projectionId: fixture.projectionA.projectionId,
        expectedAuditToken: audited.auditToken, confirmed: true }), /memory4_orphan_not_confirmed/);
      assert.deepEqual(snapshotTree(fixture.directory), before,
        "incomplete source partition must not permit a tombstone or canonical deletion");
    });

    await check("stale orphan confirmation rejects visible-catalog changes", () => {
      const fixture = createAuditFixture(path.join(root, "stale-visible"));
      const audited = fixture.auditor.audit(fixture.scope);
      const file = path.join(fixture.ownerFolder, "与赵光义的对话.json");
      const rows = JSON.parse(fs.readFileSync(file, "utf8"));
      rows[0].content += " changed after audit";
      writeJson(file, rows);
      const afterMutation = snapshotTree(fixture.directory);
      expectStale(fixture, audited.auditToken);
      assert.deepEqual(snapshotTree(fixture.directory), afterMutation, "rejected stale confirmation must not mutate files");
    });

    await check("stale orphan confirmation rejects canonical sidecar changes", () => {
      const fixture = createAuditFixture(path.join(root, "stale-sidecar"));
      const audited = fixture.auditor.audit(fixture.scope);
      fixture.engine.memory4.store.updateEntry(fixture.scope, fixture.entryId, "UPDATED_CANONICAL_AFTER_AUDIT",
        { expectedRevision: 1 });
      const afterMutation = snapshotTree(fixture.directory);
      expectStale(fixture, audited.auditToken);
      assert.deepEqual(snapshotTree(fixture.directory), afterMutation, "rejected stale confirmation must not add a tombstone");
    });

    await check("stale orphan confirmation rejects recovery snapshot changes", () => {
      const fixture = createAuditFixture(path.join(root, "stale-recovery"), { includeRecovery: true });
      const audited = fixture.auditor.audit(fixture.scope);
      fixture.engine.memory4.saveRecovery(fixture.snapshot, { status: "PENDING", retryCount: 1,
        lastError: "fixture changed after audit" });
      const afterMutation = snapshotTree(fixture.directory);
      expectStale(fixture, audited.auditToken);
      assert.deepEqual(snapshotTree(fixture.directory), afterMutation, "rejected stale confirmation must not alter recovery data");
    });

    await check("explicitly confirmed orphan forget removes only A and preserves shared C after restart", () => {
      const fixture = createAuditFixture(path.join(root, "shared-forget"), { includeRecovery: true });
      const filesBefore = snapshotTree(fixture.directory);
      const before = fixture.auditor.audit(fixture.scope);
      assert.throws(() => fixture.auditor.forget(fixture.scope, { projectionId: fixture.projectionA.projectionId,
        expectedAuditToken: before.auditToken, confirmed: false }), /memory4_orphan_confirmation_required/);
      assert.deepEqual(snapshotTree(fixture.directory), filesBefore, "missing confirmation must be read-only");
      const forgotten = fixture.auditor.forget(fixture.scope, { projectionId: fixture.projectionA.projectionId,
        expectedAuditToken: before.auditToken, confirmed: true });
      assert.equal(forgotten.status, "FORGOTTEN", JSON.stringify(forgotten));
      const restarted = new MemoryEngine({ baseDir: path.join(fixture.directory, "memory"),
        summaryFoldersDir: fixture.summariesDir, trace: { record() {} } });
      const entry = restarted.memory4.store.readEntry(fixture.scope, fixture.entryId);
      assert.equal(entry.deleted, false);
      assert.deepEqual(entry.source.projectionLineages.map(lineage => lineage.projectionId), [fixture.projectionC.projectionId]);
      const recovery = restarted.memory4.readRecovery(restarted.memory4.recoveryPath(fixture.snapshot));
      assert.deepEqual(recovery.snapshot.projectionLineages.map(lineage => lineage.projectionId), [fixture.projectionC.projectionId]);
      const afterRestart = new Memory4OrphanAudit(restarted).audit(fixture.scope);
      assert.equal(afterRestart.items.find(item => item.projectionId === fixture.projectionA.projectionId)?.status, "FORGOTTEN");
      assert.equal(afterRestart.items.find(item => item.projectionId === fixture.projectionC.projectionId)?.status, "ACTIVE");
    });
    console.log("Historical Durable OrphanAudit suite: baseline-only");
    if (failures.length) throw new Error(`${failures.length} archived audit case(s) failed: ${failures.map(item => item.name).join("; ")}`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

run().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
