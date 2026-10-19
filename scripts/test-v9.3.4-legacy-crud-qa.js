"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const sourceVersionPath = require.resolve("../src/app/main/version");
require.cache[sourceVersionPath] = {
  id: sourceVersionPath,
  filename: sourceVersionPath,
  loaded: true,
  exports: require("../resources/app/out/main/version")
};
const { MemoryEngine } = require("../src/app/main/memory-system/memory-engine");
const memorySystem = require("../src/app/main/memory-system");
const { createSummariesManager } = require("../src/app/main/summaries/summaries-manager");

const OWNER_ID = 2;
const COUNTERPART_ID = 1;
const CAMPAIGN = "CampaignC";
const OTHER_CAMPAIGN = "CampaignOther";
const TEMP_PREFIX = "votc-v934-legacy-crud-";

function makeFixture(label) {
  const root = fs.mkdtempSync(path.join(__dirname, `${TEMP_PREFIX}${label}-`));
  const summariesDir = path.join(root, "summaries");
  const engine = new MemoryEngine({
    baseDir: path.join(root, "memory"),
    summaryFoldersDir: summariesDir,
    trace: { record() {} }
  });
  const SummariesManager = createSummariesManager({
    fs,
    path,
    summariesDir,
    memoryEngine: engine,
    memorySystem
  });
  return { root, summariesDir, engine, SummariesManager };
}

function ownerFile(summariesDir, ownerId, ownerName, counterpartName) {
  return path.join(summariesDir, `${ownerId}_${ownerName}`, `与${counterpartName}的对话.json`);
}

function legacySummary({ ownerId = OWNER_ID, counterpartId = COUNTERPART_ID, ownerName = "乙",
  counterpartName = "甲", campaignToken = CAMPAIGN, finalizationId, content }) {
  // These are pre-projection Legacy rows: their missing perspectiveMemoryIds
  // field is part of the incident being covered.
  return {
    playerId: ownerId,
    playerName: ownerName,
    characterId: counterpartId,
    characterName: counterpartName,
    campaignToken,
    finalizationId,
    date: "1066.1.1",
    content
  };
}

function seedCanonical(engine, { memoryId, ownerId, counterpartId, campaignToken, finalizationId, content,
  memoryConversationId }) {
  const memory = engine.store.saveMemory({
    memoryId,
    type: "information",
    subtype: "legacy_crud_fixture",
    content,
    participants: [ownerId, counterpartId],
    subjects: [counterpartId],
    source: "imported",
    visibility: "known_group",
    knownBy: [ownerId],
    provenance: {
      campaignToken,
      ...(finalizationId === undefined ? {} : { finalizationId }),
      ...(memoryConversationId === undefined ? {} : { conversationId: memoryConversationId }),
      folderOwnerId: ownerId,
      counterpartId,
      extractionMode: "legacy_crud_fixture"
    }
  });
  engine.store.markKnownBy(ownerId, memory.memoryId, { awareness: "imported" });
  return engine.store.getMemory(memory.memoryId);
}

function seedEpisodeLinkedMemory(engine, { memoryId, ownerId = OWNER_ID, counterpartId = COUNTERPART_ID,
  campaignToken = CAMPAIGN, finalizationId, content, segmentId, memoryFinalizationId,
  episodeId = `qa-episode-${finalizationId}`, episodeConversationId = `qa-conversation-${finalizationId}`,
  episodeParticipants = [ownerId, counterpartId], memoryConversationId = episodeConversationId }) {
  const memory = seedCanonical(engine, { memoryId, ownerId, counterpartId, campaignToken,
    finalizationId: memoryFinalizationId, memoryConversationId, content });
  engine.store.saveEpisode({
    episodeId,
    conversationId: episodeConversationId,
    finalizationId,
    campaignToken,
    participants: episodeParticipants.map(id => ({ id })),
    memoryIds: [memoryId],
    summarySegments: [{ segmentId, content, participants: [ownerId, counterpartId], knownBy: [ownerId],
      visibility: "known_group", provenance: { messageIds: [] } }]
  });
  return memory;
}

function mappedSummary({ finalizationId, content, memoryIds, segmentIds }) {
  return {
    ...legacySummary({ finalizationId, content }),
    perspectiveOwnerId: OWNER_ID,
    perspectiveMemoryIds: memoryIds,
    perspectiveSummarySegmentIds: segmentIds
  };
}

function writeFixtureSummary(filePath, summaries) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(summaries, null, "\t"), "utf8");
}

function snapshotFiles(directory) {
  const result = {};
  const visit = (current, relative = "") => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const target = path.join(current, entry.name);
      const key = path.join(relative, entry.name).split(path.sep).join("/");
      if (entry.isDirectory()) visit(target, key);
      else if (entry.isFile()) result[key] = fs.readFileSync(target).toString("base64");
      else throw new Error(`unexpected_fixture_entry:${key}`);
    }
  };
  visit(directory);
  return result;
}

function cleanup(fixture) {
  const target = path.resolve(fixture.root);
  const tempRoot = path.resolve(__dirname);
  assert.equal(path.dirname(target), tempRoot, "cleanup target is a direct child of the test script directory");
  assert(path.basename(target).startsWith(TEMP_PREFIX), "cleanup target has this test's unique prefix");
  fs.rmSync(target, { recursive: true, force: true });
}

async function testEditThenDeleteKeepsOtherValidSources() {
  const fixture = makeFixture("edit-delete");
  try {
    const { engine, summariesDir, SummariesManager } = fixture;
    const file = ownerFile(summariesDir, OWNER_ID, "乙", "甲");
    const first = legacySummary({ finalizationId: "f1", content: "legacy row f1" });
    const second = legacySummary({ finalizationId: "f2", content: "legacy row f2" });

    const crossCampaignMemory = seedCanonical(engine, {
      memoryId: "qa-cross-campaign-source",
      ownerId: OWNER_ID,
      counterpartId: COUNTERPART_ID,
      campaignToken: OTHER_CAMPAIGN,
      finalizationId: "other-campaign-finalization",
      content: "valid source in another campaign"
    });
    const otherOwnerMemory = seedCanonical(engine, {
      memoryId: "qa-other-owner-source",
      ownerId: 3,
      counterpartId: COUNTERPART_ID,
      campaignToken: CAMPAIGN,
      finalizationId: "owner3-f1",
      content: "valid source owned by another character"
    });
    const crossCampaignRow = {
      ...legacySummary({ campaignToken: OTHER_CAMPAIGN, finalizationId: "other-campaign-finalization",
        content: crossCampaignMemory.content }),
      perspectiveOwnerId: OWNER_ID,
      perspectiveMemoryIds: [crossCampaignMemory.memoryId]
    };
    const otherOwnerFile = ownerFile(summariesDir, 3, "丙", "甲");
    const otherOwnerRow = {
      ...legacySummary({ ownerId: 3, ownerName: "丙", campaignToken: CAMPAIGN, finalizationId: "owner3-f1",
        content: otherOwnerMemory.content }),
      perspectiveOwnerId: 3,
      perspectiveMemoryIds: [otherOwnerMemory.memoryId]
    };

    // Use the production SummariesManager atomic writer to seed the real
    // owner-folder files, then use its public edit/delete methods below.
    SummariesManager.writeSummaryJsonAtomic(file, [first, second, crossCampaignRow]);
    SummariesManager.writeSummaryJsonAtomic(otherOwnerFile, [otherOwnerRow]);

    const edit = await SummariesManager.updateSummary(OWNER_ID, COUNTERPART_ID, 0,
      "edited Legacy row f1 survives deleting f2");
    assert.equal(edit.success, true, `editing f1 should succeed: ${edit.error || ""}`);
    const rowsAfterEdit = JSON.parse(fs.readFileSync(file, "utf8"));
    assert.equal(rowsAfterEdit[0].finalizationId, "f1");
    assert(Array.isArray(rowsAfterEdit[0].perspectiveMemoryIds) && rowsAfterEdit[0].perspectiveMemoryIds.length === 1,
      "editing creates an explicit canonical projection for f1");
    const editedMemoryId = rowsAfterEdit[0].perspectiveMemoryIds[0];
    const editedCanonical = engine.store.getMemory(editedMemoryId);
    assert(editedCanonical, "the edited f1 projection is present in the real MemoryStore");
    assert.equal(editedCanonical.provenance.finalizationId, "f1");
    assert.equal(editedCanonical.provenance.campaignToken, CAMPAIGN);
    assert(editedCanonical.knownBy.includes(OWNER_ID));
    assert.equal(rowsAfterEdit[1].finalizationId, "f2");
    assert.equal(Object.hasOwn(rowsAfterEdit[1], "perspectiveMemoryIds"), false,
      "the untouched f2 row still has no projection mapping");

    const deleteSecond = await SummariesManager.deleteSummary(OWNER_ID, COUNTERPART_ID, 1);
    assert.equal(deleteSecond.success, true,
      `deleting unmapped f2 after editing f1 should succeed: ${deleteSecond.error || ""}`);

    const remainingRows = JSON.parse(fs.readFileSync(file, "utf8"));
    assert.deepEqual(remainingRows.map(row => [row.campaignToken, row.finalizationId, row.content]), [
      [CAMPAIGN, "f1", "edited Legacy row f1 survives deleting f2"],
      [OTHER_CAMPAIGN, "other-campaign-finalization", crossCampaignMemory.content]
    ], "only the requested f2 Legacy row is removed; f1 and the other Campaign row remain");
    assert.deepEqual(engine.store.getMemory(editedMemoryId), editedCanonical,
      "the same-Owner canonical f1 source remains byte-equivalent at the record level");
    assert.deepEqual(engine.store.getMemory(crossCampaignMemory.memoryId), crossCampaignMemory,
      "the other Campaign canonical source is untouched");
    assert.deepEqual(engine.store.getMemory(otherOwnerMemory.memoryId), otherOwnerMemory,
      "another Owner's valid same-Campaign source is untouched");
    assert(engine.store.getCharacterKnowledge(3).some(record => record.memoryId === otherOwnerMemory.memoryId),
      "the other Owner retains its knowledge entry");
  } finally {
    cleanup(fixture);
  }
}

async function testUnknownOwnerSourceFailsClosedWithByteExactRollback() {
  const fixture = makeFixture("unmapped-source");
  try {
    const { engine, summariesDir, SummariesManager } = fixture;
    const file = ownerFile(summariesDir, OWNER_ID, "乙", "甲");
    const row = legacySummary({ finalizationId: "f2", content: "unmapped Legacy row f2" });
    SummariesManager.writeSummaryJsonAtomic(file, [row]);
    const unmapped = seedCanonical(engine, {
      memoryId: "qa-owner-source-without-finalization",
      ownerId: OWNER_ID,
      counterpartId: COUNTERPART_ID,
      campaignToken: CAMPAIGN,
      content: "Owner canonical source with unknown finalization"
    });
    const unrelatedTargetFinalization = seedCanonical(engine, {
      memoryId: "qa-owner-different-pair-same-finalization",
      ownerId: OWNER_ID,
      counterpartId: 3,
      campaignToken: CAMPAIGN,
      finalizationId: "f2",
      content: "same finalization, different counterpart"
    });
    assert.equal(unmapped.provenance.finalizationId, null, "the canonical source has no source finalizationId");
    assert.equal(unrelatedTargetFinalization.provenance.finalizationId, "f2");

    const before = snapshotFiles(fixture.root);
    const result = await SummariesManager.deleteSummary(OWNER_ID, COUNTERPART_ID, 0);
    assert.equal(result.success, false,
      "an unmapped same-Owner source must stay fail-closed even if an f2 source exists for another counterpart");
    assert.equal(result.error, "LEGACY_SUMMARY_MEMORY_MAPPING_INCOMPLETE");
    assert.deepEqual(snapshotFiles(fixture.root), before,
      "rejection rolls every file, including summary JSON, Store index, knowledge and mutation journal, back byte-for-byte");
    assert.equal(engine.store.getMemory(unmapped.memoryId).provenance.finalizationId, null,
      "the uncertain canonical source remains intact after rollback");
    assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).length, 1, "the rejected Legacy row remains visible");
  } finally {
    cleanup(fixture);
  }
}

async function testEpisodeLinkedMemoryCanBeDeletedWithoutMemoryFinalizationProvenance() {
  const fixture = makeFixture("episode-linked-delete");
  try {
    const { engine, summariesDir, SummariesManager } = fixture;
    const file = ownerFile(summariesDir, OWNER_ID, "乙", "甲");
    const finalizationId = "qa-episode-linked-delete";
    const content = "合成对话摘要。\n【需要长期记住的事项】\n- QA_DELETE_PAIR_SENTINEL";
    const segmentId = "qa-delete-segment";
    const row = mappedSummary({ finalizationId, content, memoryIds: ["qa-delete-memory"], segmentIds: [segmentId] });
    const exactSource = seedEpisodeLinkedMemory(engine, { memoryId: "qa-delete-memory", finalizationId,
      content: "QA canonical source linked only by the episode", segmentId,
      episodeParticipants: [OWNER_ID, COUNTERPART_ID, 3] });
    row.participants = [{ id: OWNER_ID }, { id: COUNTERPART_ID }, { id: 3 }];
    const unrelatedSameCampaign = seedCanonical(engine, { memoryId: "qa-unrelated-same-campaign", ownerId: OWNER_ID,
      counterpartId: 3, campaignToken: CAMPAIGN, content: "unrelated owner source" });
    const otherCampaign = seedCanonical(engine, { memoryId: "qa-delete-other-campaign", ownerId: OWNER_ID,
      counterpartId: COUNTERPART_ID, campaignToken: OTHER_CAMPAIGN, content: "other campaign source" });
    const otherOwner = seedCanonical(engine, { memoryId: "qa-delete-other-owner", ownerId: 3,
      counterpartId: COUNTERPART_ID, campaignToken: CAMPAIGN, content: "other owner source" });
    writeFixtureSummary(file, [row]);

    const scope = { campaignToken: CAMPAIGN, ownerId: OWNER_ID, counterpartId: COUNTERPART_ID };
    const before = engine.store.pairLedger.get(scope, { currentGameDate: "1066.1.1", pageSize: 50 });
    assert.equal(before.totalCount, 1, "the selected Legacy row supplies one derived Pair item before deletion");
    const deleted = await SummariesManager.deleteSummary(OWNER_ID, COUNTERPART_ID, 0);
    assert.equal(deleted.success, true, `the episode proves the missing per-memory finalization mapping: ${deleted.error || ""}`);
    assert.equal(fs.existsSync(file), false, "single-delete removes only the selected raw Legacy file");
    assert.equal(engine.store.getMemory(exactSource.memoryId), null, "the linked owner source is forgotten");
    assert.equal(engine.store.getCharacterKnowledge(OWNER_ID).some(record => record.memoryId === exactSource.memoryId), false,
      "the selected Owner knowledge row is revoked");
    assert.equal(engine.store.isSummaryProjectionForgotten(row, { ownerId: OWNER_ID, counterpartId: COUNTERPART_ID }), true,
      "the scoped Legacy Forget tombstone commits");
    assert.equal(engine.store.listAllEpisodes().some(episode => (episode.memoryIds || []).includes(exactSource.memoryId)
      || (episode.summarySegments || []).some(segment => segment.segmentId === segmentId)), false,
    "episode memory and segment references are compacted with the raw summary");
    assert(engine.store.getMemory(unrelatedSameCampaign.memoryId), "an unrelated same-Campaign Pair source remains intact");
    assert(engine.store.getMemory(otherCampaign.memoryId), "another Campaign source remains intact");
    assert(engine.store.getMemory(otherOwner.memoryId), "another Owner source remains intact");
    const after = engine.store.pairLedger.get(scope, { currentGameDate: "1066.1.1", pageSize: 50 });
    assert.equal(after.totalCount, 0, "the derived Pair index no longer exposes the deleted Legacy item");
    assert.equal(after.sourceSummaries.length, 0, "the derived Pair source list matches the removed raw summary");
  } finally {
    cleanup(fixture);
  }
}

async function testDeleteAllForgetsEpisodeLinkedRows() {
  const fixture = makeFixture("episode-linked-delete-all");
  try {
    const { engine, summariesDir, SummariesManager } = fixture;
    const file = ownerFile(summariesDir, OWNER_ID, "乙", "甲");
    const rows = [];
    const memoryIds = [];
    for (const [index, date] of ["1066.1.1", "1066.1.2"].entries()) {
      const finalizationId = `qa-delete-all-${index}`;
      const memoryId = `qa-delete-all-memory-${index}`;
      const segmentId = `qa-delete-all-segment-${index}`;
      const content = `合成摘要${index}。\n【需要长期记住的事项】\n- QA_DELETE_ALL_${index}`;
      rows.push({ ...mappedSummary({ finalizationId, content, memoryIds: [memoryId], segmentIds: [segmentId] }), date });
      const memory = seedEpisodeLinkedMemory(engine, { memoryId, finalizationId, content: `canonical ${index}`, segmentId });
      memoryIds.push(memory.memoryId);
    }
    writeFixtureSummary(file, rows);
    const scope = { campaignToken: CAMPAIGN, ownerId: OWNER_ID, counterpartId: COUNTERPART_ID };
    assert.equal(engine.store.pairLedger.get(scope, { currentGameDate: "1066.1.2", pageSize: 50 }).totalCount, 2);

    const deleted = await SummariesManager.deleteCharacterSummaries(OWNER_ID, COUNTERPART_ID);
    assert.equal(deleted.success, true, `bulk-delete accepts each exact episode mapping: ${deleted.error || ""}`);
    assert.equal(fs.existsSync(file), false, "bulk-delete removes the selected owner Pair file");
    for (const memoryId of memoryIds) assert.equal(engine.store.getMemory(memoryId), null, "each linked canonical source is forgotten");
    for (const row of rows) assert.equal(engine.store.isSummaryProjectionForgotten(row, {
      ownerId: OWNER_ID, counterpartId: COUNTERPART_ID
    }), true, "each bulk-deleted row has a committed scoped Forget tombstone");
    assert.equal(engine.store.listAllEpisodes().some(episode => memoryIds.some(memoryId => (episode.memoryIds || []).includes(memoryId))), false,
      "bulk-delete compacts every episode memory reference");
    assert.equal(engine.store.pairLedger.get(scope, { currentGameDate: "1066.1.2", pageSize: 50 }).totalCount, 0,
      "the derived Pair index contains no deleted rows");
  } finally {
    cleanup(fixture);
  }
}

async function testMappingConflictsAndUnlinkedSourcesRollback() {
  for (const fixtureName of ["finalization-conflict", "episode-missing"]) {
    const fixture = makeFixture(fixtureName);
    try {
      const { engine, summariesDir, SummariesManager } = fixture;
      const file = ownerFile(summariesDir, OWNER_ID, "乙", "甲");
      const finalizationId = `qa-${fixtureName}`;
      const memoryId = `qa-${fixtureName}-memory`;
      const segmentId = `qa-${fixtureName}-segment`;
      const content = `synthetic ${fixtureName}`;
      const row = mappedSummary({ finalizationId, content, memoryIds: [memoryId], segmentIds: [segmentId] });
      if (fixtureName === "finalization-conflict") {
        seedEpisodeLinkedMemory(engine, { memoryId, finalizationId, memoryFinalizationId: "qa-explicit-other-finalization",
          content: "conflicting source", segmentId });
      } else {
        seedCanonical(engine, { memoryId, ownerId: OWNER_ID, counterpartId: COUNTERPART_ID,
          campaignToken: CAMPAIGN, content: "unlinked legacy source" });
      }
      writeFixtureSummary(file, [row]);
      const before = snapshotFiles(fixture.root);
      const result = await SummariesManager.deleteSummary(OWNER_ID, COUNTERPART_ID, 0);
      assert.equal(result.success, false, `${fixtureName} must stay fail-closed`);
      assert.equal(result.error, "LEGACY_SUMMARY_MEMORY_MAPPING_INCOMPLETE");
      assert.deepEqual(snapshotFiles(fixture.root), before, `${fixtureName} leaves raw summary and all derived state byte-identical`);
      assert.equal(fs.existsSync(file), true, `${fixtureName} keeps the visible summary`);
    } finally {
      cleanup(fixture);
    }
  }
}

async function testPostForgetFailureRollsBackByteExactly() {
  const fixture = makeFixture("post-forget-rollback");
  try {
    const { engine, summariesDir, SummariesManager } = fixture;
    const file = ownerFile(summariesDir, OWNER_ID, "乙", "甲");
    const finalizationId = "qa-post-forget-rollback";
    const segmentId = "qa-post-forget-rollback-segment";
    const row = mappedSummary({ finalizationId, content: "first summary", memoryIds: ["qa-post-forget-memory"], segmentIds: [segmentId] });
    const remaining = legacySummary({ finalizationId: "qa-remains", content: "second summary" });
    const source = seedEpisodeLinkedMemory(engine, { memoryId: "qa-post-forget-memory", finalizationId,
      content: "canonical source", segmentId });
    writeFixtureSummary(file, [row, remaining]);
    const before = snapshotFiles(fixture.root);
    const originalWriter = SummariesManager.writeSummaryJsonAtomic;
    SummariesManager.writeSummaryJsonAtomic = () => { throw new Error("synthetic_summary_persist_failure"); };
    try {
      const result = await SummariesManager.deleteSummary(OWNER_ID, COUNTERPART_ID, 0);
      assert.equal(result.success, false);
      assert.equal(result.error, "synthetic_summary_persist_failure");
    } finally {
      SummariesManager.writeSummaryJsonAtomic = originalWriter;
    }
    assert.deepEqual(snapshotFiles(fixture.root), before,
      "failure after Forget writes restores the original summary, canonical memory, episode and Pair data byte-for-byte");
    assert(engine.store.getMemory(source.memoryId), "the source is restored after rollback");
  } finally {
    cleanup(fixture);
  }
}

async function testConflictingEpisodeConversationIdentityFailsClosed() {
  for (const fixtureName of ["episode-conversation-conflict", "summary-conversation-mismatch",
    "memory-conversation-mismatch", "memory-episode-conversation-mismatch",
    "memory-conversation-conflict-without-episode-identity", "duplicate-episode-identity"]) {
    const fixture = makeFixture(fixtureName);
    try {
      const { engine, summariesDir, SummariesManager } = fixture;
      const file = ownerFile(summariesDir, OWNER_ID, "乙", "甲");
      const finalizationId = `qa-${fixtureName}`;
      const currentConversationId = "qa-current-conversation";
      const row = legacySummary({ finalizationId, content: `synthetic ${fixtureName}` });
      if (fixtureName !== "memory-episode-conversation-mismatch") row.conversationId = currentConversationId;
      if (fixtureName === "episode-conversation-conflict") {
        seedEpisodeLinkedMemory(engine, { memoryId: "qa-memory-current", finalizationId,
          content: "synthetic current conversation memory", segmentId: "qa-current-segment",
          episodeId: "qa-current-episode", episodeConversationId: currentConversationId });
        seedEpisodeLinkedMemory(engine, { memoryId: "qa-memory-other", finalizationId,
          content: "synthetic other conversation memory", segmentId: "qa-other-segment",
          episodeId: "qa-other-episode", episodeConversationId: "qa-other-conversation" });
      } else if (fixtureName === "memory-conversation-conflict-without-episode-identity") {
        delete row.conversationId;
        seedEpisodeLinkedMemory(engine, { memoryId: "qa-memory-current", finalizationId,
          content: "synthetic current conversation memory", segmentId: "qa-current-segment",
          episodeId: "qa-current-episode", episodeConversationId: null,
          memoryConversationId: currentConversationId });
        seedEpisodeLinkedMemory(engine, { memoryId: "qa-memory-other", finalizationId,
          content: "synthetic other conversation memory", segmentId: "qa-other-segment",
          episodeId: "qa-other-episode", episodeConversationId: null,
          memoryConversationId: "qa-other-conversation" });
      } else if (fixtureName === "duplicate-episode-identity") {
        seedEpisodeLinkedMemory(engine, { memoryId: "qa-memory-current", finalizationId,
          content: "synthetic first episode memory", segmentId: "qa-current-segment",
          episodeId: "qa-current-episode", episodeConversationId: currentConversationId });
        seedEpisodeLinkedMemory(engine, { memoryId: "qa-memory-other", finalizationId,
          content: "synthetic duplicate episode memory", segmentId: "qa-other-segment",
          episodeId: "qa-other-episode", episodeConversationId: currentConversationId });
      } else {
        const episodeConversationId = fixtureName === "summary-conversation-mismatch"
          ? "qa-other-conversation" : currentConversationId;
        seedEpisodeLinkedMemory(engine, { memoryId: "qa-memory-current", finalizationId,
          content: "synthetic current conversation memory", segmentId: "qa-current-segment",
          episodeId: "qa-current-episode", episodeConversationId });
        if (fixtureName === "summary-conversation-mismatch" || fixtureName === "memory-conversation-mismatch") {
          row.conversationId = currentConversationId;
        }
        seedCanonical(engine, { memoryId: "qa-memory-other", ownerId: OWNER_ID, counterpartId: COUNTERPART_ID,
          campaignToken: CAMPAIGN, finalizationId, memoryConversationId: "qa-other-conversation",
          content: "synthetic fallback memory from another conversation" });
      }
      writeFixtureSummary(file, [row]);
      const before = snapshotFiles(fixture.root);
      const result = await SummariesManager.deleteSummary(OWNER_ID, COUNTERPART_ID, 0);
      assert.equal(result.success, false, `${fixtureName} must reject mismatched Episode identity`);
      assert.equal(result.error, "LEGACY_SUMMARY_MEMORY_MAPPING_INCOMPLETE");
      assert.deepEqual(snapshotFiles(fixture.root), before,
        `${fixtureName} leaves raw summary and every source/derived file byte-identical`);
      assert.equal(fs.existsSync(file), true, `${fixtureName} preserves the visible summary`);
    } finally {
      cleanup(fixture);
    }
  }
}

(async () => {
  await testEditThenDeleteKeepsOtherValidSources();
  console.log("PASS Legacy CRUD: edit f1, delete unmapped f2, preserve canonical and unrelated sources");
  await testUnknownOwnerSourceFailsClosedWithByteExactRollback();
  console.log("PASS Legacy CRUD: unknown Owner finalization stays fail-closed with byte-exact rollback");
  await testEpisodeLinkedMemoryCanBeDeletedWithoutMemoryFinalizationProvenance();
  console.log("PASS Legacy delete: episode-linked sources and Pair index clear without per-memory finalizationId");
  await testDeleteAllForgetsEpisodeLinkedRows();
  console.log("PASS Legacy delete-all: every exact episode-linked row and Pair item is forgotten");
  await testMappingConflictsAndUnlinkedSourcesRollback();
  console.log("PASS Legacy delete: explicit conflicts and unlinked sources remain fail-closed");
  await testPostForgetFailureRollsBackByteExactly();
  console.log("PASS Legacy delete: transaction failure after Forget restores all files byte-exactly");
  await testConflictingEpisodeConversationIdentityFailsClosed();
  console.log("PASS Legacy delete: conflicting Episode conversation identities stay fail-closed");
  console.log("Legacy Summary CRUD QA: 7 PASS / 0 FAIL");
})().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
