"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { MemoryEngine } = require("../resources/app/out/main/memory-system/memory-engine");
const { Memory4OrphanAudit } = require("../resources/app/out/main/memory-system/memory4-orphan-audit");
const { createProjectionLineage } = require("../resources/app/out/main/memory-system/memory4-forget");
const { hash } = require("../resources/app/out/main/memory-system/memory4-contract");
const { disclosureFactId } = require("../resources/app/out/main/memory-system/memory4-disclosure");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v815-orphan-audit-"));
const scope = { campaignToken: "orphan-campaign", ownerId: 2 };
function fixture(name, { shared = false, old = false } = {}) {
  const directory = path.join(root, name), summaryFoldersDir = path.join(directory, "summaries");
  const ownerFolder = path.join(summaryFoldersDir, "2_owner");
  fs.mkdirSync(ownerFolder, { recursive: true });
  const options = { baseDir: path.join(directory, "memory"), summaryFoldersDir, trace: { record() {} } };
  const engine = new MemoryEngine(options);
  const conversationId = `conversation-${name}`, finalizationId = `finalization-${name}`;
  const fragmentId = `fragment-${name}`;
  const counterpartIds = shared ? [1, 3] : [1];
  const lineages = counterpartIds.map(counterpartId => createProjectionLineage({ ...scope, counterpartId,
    conversationId, finalizationId, segmentIds: [`summary-${name}-${counterpartId}`],
    sourceSegmentIds: [fragmentId], sourceMessageIds: [0] }));
  const snapshot = { ...scope, conversationId, finalizationId, episodeId: `episode-${name}`, date: "1164.1.1",
    totalDays: 425000, sourceRevision: hash([name, "source"]), presentMessageCount: 1, completeness: "complete",
    summaryIds: [], counterpartIds, projectionLineages: lineages,
    fragments: [{ fragmentId, messageId: 0, sourceMessageIds: [0], text: `source-${name}`, speakerId: 2,
      speakerIds: [2], sourceTextVerified: true, sourceRole: "assistant", presentIds: [2, ...counterpartIds],
      knownBy: [2, ...counterpartIds], visibility: "participants", sourceType: "spoken", recipientIds: counterpartIds,
      entityIds: counterpartIds, visibilityEvidence: "application_fragment" }] };
  engine.memory4.store.commitOwner(snapshot, { status: "STORE", entries: [{ memoryType: "DURABLE_KNOWLEDGE",
    text: `ORPHAN_${name}_SENTINEL`, fragmentIds: [fragmentId], participantIds: [2, ...counterpartIds],
    entityIds: counterpartIds, topics: ["old fact"], eventTime: { status: "unknown" } }] });
  if (old) {
    const store = engine.memory4.store, sidecar = store.directory(scope), index = store.loadIndex(scope);
    for (const [entryId] of Object.entries(index.entries)) {
      const file = path.join(sidecar, "entries", `${entryId}.json`), entry = store.read(file, null);
      delete entry.source.projectionLineages;
      engine.store.writeJson(file, entry);
      index.entries[entryId] = store.indexRow(entry);
    }
    engine.store.writeJson(path.join(sidecar, "index.json"), index);
    const metadata = store.read(path.join(sidecar, "metadata.json"), null);
    metadata.indexHash = hash(index);
    engine.store.writeJson(path.join(sidecar, "metadata.json"), metadata);
  }
  return { engine, options, ownerFolder, snapshot, lineages, audit: new Memory4OrphanAudit(engine) };
}

function treeHashes(folder) {
  const result = {};
  if (!fs.existsSync(folder)) return result;
  for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
    const file = path.join(folder, entry.name);
    if (entry.isDirectory()) Object.assign(result, treeHashes(file));
    else result[file] = hash(fs.readFileSync(file).toString("base64"));
  }
  return result;
}

function seedDisclosure(fixture) {
  const { engine, snapshot, lineages } = fixture;
  const factId = disclosureFactId(scope, 9, "TITLE", "title_fixture");
  const proof = { sourceKind: "CONVERSATION", sourceId: snapshot.finalizationId,
    sourceFinalizationId: snapshot.finalizationId, sourceConversationId: snapshot.conversationId,
    sourceRevision: snapshot.sourceRevision, acquiredDate: snapshot.date, knownBy: [2],
    sourceMessageIds: [0], sourceFragmentIds: [snapshot.fragments[0].fragmentId], sourceTextHashes: [hash("source")],
    visibilityEvidence: ["application_fragment"], projectionLineages: lineages };
  engine.store.writeJson(path.join(engine.memory4.store.directory(scope), "known-entities.json"), {
    ...scope, revision: 1, entities: { 9: { entityId: 9, revision: 1, disclosedFacts: { [factId]: {
      factId, factType: "TITLE", factKey: "title_fixture", value: "Fixture kingdom", status: "AUTO_DISCLOSED",
      firstAcquiredDate: snapshot.date, lastConfirmedDate: snapshot.date, knownBy: [2], revision: 1,
      evidenceBySource: { [hash(["CONVERSATION", snapshot.finalizationId])]: proof }
    } } } }
  });
  return factId;
}

async function run() {
  try {
    const orphan = fixture("orphan");
    seedDisclosure(orphan);
    orphan.engine.memory4.saveRecovery(orphan.snapshot, { status: "PENDING", retryCount: 0 });
    await orphan.engine.memory4.derived.rebuild(scope, { kind: "all", overwriteManual: false });
    const before = treeHashes(root);
    const audited = orphan.audit.audit(scope);
    assert.deepEqual(treeHashes(root), before, "audit must not create or mutate any persisted file");
    const item = audited.items.find(row => row.projectionId === orphan.lineages[0].projectionId);
    assert.equal(item.status, "ORPHANED_PRE_V815_PROJECTION");
    assert.equal(item.canonicalEntryIds.length, 1);
    assert.equal(item.disclosureFactIds.length, 1);
    assert.equal(item.recoveryFiles.length, 1);
    assert.equal(JSON.stringify(audited).includes("ORPHAN_orphan_SENTINEL"), false, "DTO excludes narrative bodies");
    assert.throws(() => orphan.audit.forget(scope, { projectionId: item.projectionId, expectedAuditToken: audited.auditToken }), /confirmation_required/);
    assert.deepEqual(treeHashes(root), before);
    const forgotten = orphan.audit.forget(scope, { projectionId: item.projectionId, expectedAuditToken: audited.auditToken, confirmed: true });
    assert.equal(forgotten.status, "FORGOTTEN");
    const restarted = new MemoryEngine(orphan.options);
    assert.equal(restarted.memory4.store.query(scope).length, 0);
    assert.equal(restarted.memory4.store.getDisclosedFacts(scope, 9).length, 0);
    assert.equal(fs.readdirSync(restarted.memory4.recoveryDir).filter(name => name.endsWith(".json")).length, 0);
    assert.equal(JSON.stringify(restarted.memory4.derived.list(scope)).includes("ORPHAN_orphan_SENTINEL"), false);
    assert.equal(new Memory4OrphanAudit(restarted).audit(scope).items[0].status, "FORGOTTEN");
    console.log("PASS orphan audit is read-only; explicit forget survives restart across all durable layers");

    const shared = fixture("shared", { shared: true });
    seedDisclosure(shared);
    shared.engine.store.writeJson(path.join(shared.ownerFolder, "pair-c.json"), [{ ...scope, playerId: 2,
      perspectiveOwnerId: 2, characterId: 3, content: "active C", ...shared.lineages[1],
      perspectiveSummarySegmentIds: shared.lineages[1].segmentIds }]);
    const sharedAudit = shared.audit.audit(scope);
    assert.equal(sharedAudit.items.find(row => row.counterpartId === 1).status, "ORPHANED_PRE_V815_PROJECTION");
    assert.equal(sharedAudit.items.find(row => row.counterpartId === 3).status, "ACTIVE");
    shared.audit.forget(scope, { projectionId: shared.lineages[0].projectionId, expectedAuditToken: sharedAudit.auditToken, confirmed: true });
    const retained = new MemoryEngine(shared.options).memory4.store.query(scope);
    assert.equal(retained.length, 1);
    assert.deepEqual(retained[0].source.projectionLineages.map(lineage => lineage.counterpartId), [3]);
    assert.deepEqual(retained[0].evidence.knownBy, [1, 2, 3]);
    console.log("PASS orphan lineage cleanup preserves shared active C evidence and physical knowledge");

    const legacy = fixture("pre-v815", { old: true });
    const oldAudit = legacy.audit.audit(scope);
    assert.equal(oldAudit.items[0].status, "ORPHANED_PRE_V815_PROJECTION");
    assert(oldAudit.items[0].reasons.includes("EXACT_SINGLE_PAIR_SOURCE"));
    legacy.audit.forget(scope, { projectionId: oldAudit.items[0].projectionId, expectedAuditToken: oldAudit.auditToken, confirmed: true });
    assert.equal(new MemoryEngine(legacy.options).memory4.store.query(scope).length, 0);
    console.log("PASS pre-V8.15 single-pair exact source maps without fabricating a shared projection");

    const unknown = fixture("unknown-shared", { shared: true, old: true });
    const unknownAudit = unknown.audit.audit(scope), unknownBefore = treeHashes(root);
    assert.equal(unknownAudit.items[0].status, "UNKNOWN");
    assert.throws(() => unknown.audit.forget(scope, { projectionId: unknownAudit.items[0].projectionId,
      expectedAuditToken: unknownAudit.auditToken, confirmed: true }), /orphan_not_confirmed/);
    assert.deepEqual(treeHashes(root), unknownBefore);
    console.log("PASS incomplete shared source is UNKNOWN and cannot be explicitly forgotten");

    const stale = fixture("stale"), firstAudit = stale.audit.audit(scope);
    stale.engine.store.writeJson(path.join(stale.ownerFolder, "new-visible.json"), [{ ...stale.lineages[0],
      playerId: 2, characterId: 1, content: "restored visible source", perspectiveSummarySegmentIds: stale.lineages[0].segmentIds }]);
    const staleBefore = treeHashes(root);
    assert.throws(() => stale.audit.forget(scope, { projectionId: stale.lineages[0].projectionId,
      expectedAuditToken: firstAudit.auditToken, confirmed: true }), /audit_stale/);
    assert.deepEqual(treeHashes(root), staleBefore);
    console.log("PASS stale confirmation cannot delete a newly restored visible projection");
    console.log("V8.15 orphan audit: PASS (5 cases)");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
