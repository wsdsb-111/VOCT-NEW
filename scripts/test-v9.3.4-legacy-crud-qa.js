"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { MemoryEngine } = require("../resources/app/out/main/memory-system/memory-engine");
const memorySystem = require("../resources/app/out/main/memory-system");
const { createSummariesManager } = require("../resources/app/out/main/summaries/summaries-manager");

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

function seedCanonical(engine, { memoryId, ownerId, counterpartId, campaignToken, finalizationId, content }) {
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
      folderOwnerId: ownerId,
      counterpartId,
      extractionMode: "legacy_crud_fixture"
    }
  });
  engine.store.markKnownBy(ownerId, memory.memoryId, { awareness: "imported" });
  return engine.store.getMemory(memory.memoryId);
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

(async () => {
  await testEditThenDeleteKeepsOtherValidSources();
  console.log("PASS Legacy CRUD: edit f1, delete unmapped f2, preserve canonical and unrelated sources");
  await testUnknownOwnerSourceFailsClosedWithByteExactRollback();
  console.log("PASS Legacy CRUD: unknown Owner finalization stays fail-closed with byte-exact rollback");
  console.log("V9.3.4 Legacy CRUD QA: 2 PASS / 0 FAIL");
})().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
