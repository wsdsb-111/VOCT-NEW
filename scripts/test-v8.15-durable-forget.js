"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { MemoryEngine } = require("../resources/app/out/main/memory-system/memory-engine");
const memorySystem = require("../resources/app/out/main/memory-system");
const { createSummariesManager } = require("../resources/app/out/main/summaries/summaries-manager");

const campaignToken = "campaign-legacy-forget-fixture";
const ownerId = 2;
const finalizationId = "shared-legacy-finalization";

function createFixture(name, summaries) {
  const directory = path.join(root, name);
  const summariesDir = path.join(directory, "summaries");
  const ownerFolder = path.join(summariesDir, `${ownerId}_owner`);
  fs.mkdirSync(ownerFolder, { recursive: true });
  for (const [fileName, rows] of summaries) fs.writeFileSync(path.join(ownerFolder, fileName), JSON.stringify(rows, null, 2), "utf8");
  const engine = new MemoryEngine({ baseDir: path.join(directory, "memory"), summaryFoldersDir: summariesDir,
    trace: { record() {} } });
  const manager = createSummariesManager({ fs, path, summariesDir, memoryEngine: engine, memorySystem,
    getCurrentConversation: () => null });
  return { directory, summariesDir, ownerFolder, engine, manager };
}

function summaryRecord(counterpartId, memoryId, segmentId, content) {
  return {
    playerId: ownerId,
    characterId: counterpartId,
    playerName: "Owner",
    characterName: `Counterpart ${counterpartId}`,
    perspectiveOwnerId: ownerId,
    campaignToken,
    conversationId: "legacy-conversation",
    finalizationId,
    date: "1164.1.1",
    totalDays: 425000,
    content,
    perspectiveMemoryIds: [memoryId],
    perspectiveSummarySegmentIds: [segmentId],
    sourceMessageIds: [counterpartId * 10]
  };
}

function addSharedEpisode(engine, records) {
  const memories = records.map(record => ({
    memoryId: record.memoryId,
    type: "information",
    subtype: "summary_projection",
    content: record.summary.content,
    canonicalText: record.summary.content,
    participants: [ownerId, record.counterpartId],
    subjects: [record.counterpartId],
    eventDate: record.summary.date,
    totalDays: record.summary.totalDays,
    source: "summary",
    visibility: "known_group",
    knownBy: [ownerId],
    provenance: { campaignToken, finalizationId, conversationId: "legacy-conversation",
      folderOwnerId: ownerId, counterpartId: record.counterpartId }
  }));
  for (const memory of memories) {
    engine.store.saveMemory(memory);
    engine.store.markKnownBy(ownerId, memory.memoryId, { awareness: "told", acquiredAt: memory.totalDays });
  }
  engine.store.saveEpisode({
    schemaVersion: 2,
    episodeId: "legacy-episode",
    conversationId: "legacy-conversation",
    finalizationId,
    campaignToken,
    commitMarker: "legacy-commit",
    date: "1164.1.1",
    totalDays: 425000,
    participants: [{ id: ownerId }, { id: 1 }, { id: 3 }],
    memoryIds: memories.map(memory => memory.memoryId),
    summarySegments: records.map(record => ({
      segmentId: record.summary.perspectiveSummarySegmentIds[0],
      content: record.summary.content,
      participants: [ownerId, record.counterpartId],
      knownBy: [ownerId],
      visibility: "known_group",
      provenance: { messageIds: record.summary.sourceMessageIds }
    }))
  });
}

function snapshotTree(directory) {
  if (!fs.existsSync(directory)) return null;
  const rows = [];
  const visit = (current, relative = "") => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const child = path.join(current, entry.name);
      const childRelative = path.join(relative, entry.name);
      if (entry.isSymbolicLink()) rows.push([childRelative, `symlink:${fs.readlinkSync(child)}`]);
      else if (entry.isDirectory()) {
        rows.push([childRelative, "directory"]);
        visit(child, childRelative);
      } else rows.push([childRelative, `file:${fs.readFileSync(child).toString("base64")}`]);
    }
  };
  visit(directory);
  return rows.sort(([left], [right]) => left.localeCompare(right));
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v815-legacy-forget-"));

async function testPureLegacyDeleteNeedsNoMemory4AndLeavesOldSidecarUntouched() {
  const summary = { playerId: ownerId, characterId: 1, playerName: "Owner", characterName: "Counterpart",
    perspectiveOwnerId: ownerId, campaignToken, date: "1164.1.1", content: "Legacy summary without a canonical memory mapping." };
  const fixture = createFixture("pure-legacy", [["pair.json", [summary]]]);
  const oldSidecar = path.join(fixture.ownerFolder, ".memory4", "opaque", "legacy.json");
  fs.mkdirSync(path.dirname(oldSidecar), { recursive: true });
  fs.writeFileSync(oldSidecar, "old sidecar sentinel", "utf8");
  try {
    assert.equal(fixture.engine.memory4, undefined, "the fixture has no Memory4 instance");
    const before = fs.readFileSync(oldSidecar);
    const result = await fixture.manager.deleteSummary(ownerId, 1, 0);
    assert.equal(result.success, true, JSON.stringify(result));
    assert.equal(fs.existsSync(path.join(fixture.ownerFolder, "pair.json")), false);
    assert.deepEqual(fs.readFileSync(oldSidecar), before, "Legacy deletion leaves historical sidecar bytes untouched");
    assert.equal(fs.existsSync(path.join(fixture.summariesDir, ".memory4")), false,
      "Legacy deletion does not create a new owner sidecar");
  } finally { /* the test root owns all fixture files */ }
}

async function testForgetIsScopedToOneLegacyProjection() {
  const summaryA = summaryRecord(1, "legacy_memory_a", "segment-a", "The owner discussed the western envoy.");
  const summaryC = summaryRecord(3, "legacy_memory_c", "segment-c", "The owner discussed the harvest.");
  const fixture = createFixture("scoped-delete", [["pair-a.json", [summaryA]], ["pair-c.json", [summaryC]]]);
  const oldSidecar = path.join(fixture.ownerFolder, ".memory4", "opaque", "legacy.json");
  fs.mkdirSync(path.dirname(oldSidecar), { recursive: true });
  fs.writeFileSync(oldSidecar, "preserve old archive", "utf8");
  addSharedEpisode(fixture.engine, [
    { counterpartId: 1, memoryId: "legacy_memory_a", summary: summaryA },
    { counterpartId: 3, memoryId: "legacy_memory_c", summary: summaryC }
  ]);
  const retainedFile = path.join(fixture.ownerFolder, "pair-c.json");
  const retainedBytes = fs.readFileSync(retainedFile);
  const sidecarBytes = fs.readFileSync(oldSidecar);

  const result = await fixture.manager.deleteSummary(ownerId, 1, 0);
  assert.equal(result.success, true, JSON.stringify(result));
  assert.equal(fs.existsSync(path.join(fixture.ownerFolder, "pair-a.json")), false);
  assert.deepEqual(fs.readFileSync(retainedFile), retainedBytes, "deleting owner→A leaves owner→C summary bytes intact");
  assert.equal(fixture.engine.store.getMemory("legacy_memory_a"), null, "the selected Legacy memory is removed");
  assert(fixture.engine.store.getMemory("legacy_memory_c"), "the other counterpart's Legacy memory remains");
  const [episode] = fixture.engine.store.listAllEpisodes();
  assert.deepEqual(episode.memoryIds, ["legacy_memory_c"]);
  assert.deepEqual(episode.summarySegments.map(segment => segment.segmentId), ["segment-c"]);
  const forgotten = fixture.engine.store.listForgottenSummaryProjections();
  assert.equal(forgotten.length, 1);
  assert.equal(forgotten[0].counterpartId, 1);
  assert.equal(forgotten[0].campaignToken, campaignToken);
  assert.deepEqual(fs.readFileSync(oldSidecar), sidecarBytes, "Forget does not read, rewrite or delete the historical sidecar");
}

async function testSummaryMutationRollsBackLegacyForgetFailure() {
  const summaryA = summaryRecord(1, "legacy_memory_a", "segment-a", "A transaction-bound summary.");
  const fixture = createFixture("rollback", [["pair-a.json", [summaryA]]]);
  addSharedEpisode(fixture.engine, [{ counterpartId: 1, memoryId: "legacy_memory_a", summary: summaryA }]);
  const visibleBefore = snapshotTree(fixture.summariesDir);
  const storeBefore = snapshotTree(fixture.engine.store.baseDir);
  const forget = fixture.engine.forgetSummaryProjection.bind(fixture.engine);
  fixture.engine.forgetSummaryProjection = (...args) => {
    const result = forget(...args);
    assert.equal(result.status, "FORGOTTEN");
    throw new Error("INJECTED_POST_FORGET_FAILURE");
  };

  const result = await fixture.manager.deleteSummary(ownerId, 1, 0);
  assert.equal(result.success, false);
  assert.equal(result.error, "INJECTED_POST_FORGET_FAILURE");
  assert.deepEqual(snapshotTree(fixture.summariesDir), visibleBefore,
    "failed deletion restores the visible Legacy projection byte-for-byte");
  assert.deepEqual(snapshotTree(fixture.engine.store.baseDir), storeBefore,
    "failed deletion restores MemoryStore index, memory and Episode data byte-for-byte");
  assert(fixture.engine.store.getMemory("legacy_memory_a"), "the in-memory store is reloaded to the pre-transaction state");
  assert.deepEqual(fixture.engine.store.listForgottenSummaryProjections(), [], "failed deletion leaves no Forget ledger entry");
}

async function run() {
  try {
    await testPureLegacyDeleteNeedsNoMemory4AndLeavesOldSidecarUntouched();
    await testForgetIsScopedToOneLegacyProjection();
    await testSummaryMutationRollsBackLegacyForgetFailure();
    console.log("V8.15 Legacy Summary Forget: PASS (no Memory4 instance; scoped delete, preserved archive, atomic rollback)");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
