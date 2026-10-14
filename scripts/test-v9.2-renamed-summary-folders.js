"use strict";

const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { MemoryStore } = require("../resources/app/out/main/memory-system/memory-store");
const { Memory4Coordinator } = require("../resources/app/out/main/memory-system/memory4-coordinator");
const { Memory4Store } = require("../resources/app/out/main/memory-system/memory4-store");
const { hash } = require("../resources/app/out/main/memory-system/memory4-contract");
const { createProjectionLineage } = require("../resources/app/out/main/memory-system/memory4-forget");
const { projectVisibleTranscript } = require("../resources/app/out/main/memory-system/memory4-visibility");
const memorySystem = require("../resources/app/out/main/memory-system");
const { createGameData } = require("../resources/app/out/main/game-data/game-data");
const { createSummariesManager } = require("../resources/app/out/main/summaries/summaries-manager");

const OWNER_ID = 42;
const COUNTERPART_ID = 77;
const CAMPAIGN = "summary-folder-rename-campaign";
const FACT = { factType: "TITLE", factKey: "title_duchy_of_canis", value: "Duchy of Canis" };
const temporaryRoots = [];

function makeFixture(label) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `votc-v92-summary-rename-${label}-`));
  temporaryRoots.push(root);
  const summaryRoot = path.join(root, "summaries");
  const baseDir = path.join(root, "memory");
  fs.mkdirSync(summaryRoot, { recursive: true });
  return { root, summaryRoot, baseDir, store: new MemoryStore({ baseDir, summaryFoldersDir: summaryRoot }) };
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8");
}

function readTree(directory) {
  const result = new Map();
  if (!fs.existsSync(directory)) return result;
  const visit = (current, relative = "") => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const file = path.join(current, entry.name);
      const key = path.join(relative, entry.name);
      const stat = fs.lstatSync(file);
      if (stat.isSymbolicLink()) result.set(key, `link:${fs.readlinkSync(file)}`);
      else if (stat.isDirectory()) visit(file, key);
      else result.set(key, fs.readFileSync(file));
    }
  };
  visit(directory);
  return result;
}

function assertSameTree(actual, expected, message) {
  assert.deepStrictEqual([...actual.keys()].sort(), [...expected.keys()].sort(), `${message}: paths`);
  for (const [file, expectedBytes] of expected) assert.deepStrictEqual(actual.get(file), expectedBytes, `${message}: ${file}`);
}

function summary(content, date, options = {}) {
  const campaignToken = options.campaignToken ?? null;
  const ownerId = options.ownerId ?? OWNER_ID;
  const characterId = options.characterId ?? COUNTERPART_ID;
  const playerName = options.playerName || "旧名";
  const characterName = options.characterName || "旧对手名";
  const row = {
    schemaVersion: 1,
    date,
    totalDays: options.totalDays ?? 100,
    content,
    playerId: ownerId,
    playerName,
    characterId,
    characterName,
    finalizationId: options.finalizationId || "final-shared",
    campaignToken,
    campaignBinding: campaignToken
      ? { status: "bound", source: "native", version: 1 }
      : { status: "unresolved", reason: "CAMPAIGN_TOKEN_UNAVAILABLE", version: 1 },
    sourceSegmentIds: ["segment-shared"],
    participants: [
      { id: ownerId, name: playerName, shortName: playerName },
      { id: characterId, name: characterName, shortName: characterName }
    ]
  };
  if (options.legacyTag) row.legacyTag = options.legacyTag;
  return row;
}

function writeConversation(folder, fileName, summaries) {
  const filePath = path.join(folder, fileName);
  writeJson(filePath, summaries);
  return filePath;
}

function projectedEntry({ ownerId = OWNER_ID, counterpartId = COUNTERPART_ID, campaignToken = CAMPAIGN,
  finalizationId, conversationId = `conversation-${finalizationId}`, text = `记忆 ${finalizationId}`, topics = ["court"],
  candidateText = text } = {}) {
  const context = {
    campaignToken,
    conversationId,
    finalizationId,
    date: "1164.1.1",
    totalDays: 425000,
    participants: [
      { id: ownerId, firstName: `Owner ${ownerId}`, shortName: `Owner ${ownerId}`, fullName: `Owner ${ownerId}` },
      { id: counterpartId, firstName: `Person ${counterpartId}`, shortName: `Person ${counterpartId}`, fullName: `Person ${counterpartId}` }
    ],
    participantPresence: [ownerId, counterpartId].map(characterId => ({ characterId, joinedAtMessageId: 1, leftAtMessageId: null })),
    messages: [{ id: 1, role: "user", speakerCharacterId: ownerId, content: text, memory4Fragments: [{
      start: 0, end: text.length, visibility: "participants", sourceType: "spoken",
      recipientIds: [counterpartId], entityIds: [counterpartId]
    }] }]
  };
  const projected = projectVisibleTranscript(context, ownerId);
  assert.strictEqual(projected.fragments.length, 1, "fixture transcript must project one visible fragment");
  const projectionLineage = createProjectionLineage({ campaignToken, ownerId, conversationId, finalizationId,
    counterpartId, segmentIds: [projected.fragments[0].fragmentId], sourceMessageIds: [1] });
  const snapshot = { ...context, ownerId, episodeId: `episode-${finalizationId}`, presentMessageCount: projected.presentMessageCount,
    completeness: projected.completeness, legacyRetained: projected.legacyRetained,
    visibilityEvidence: projected.visibilityEvidence, sourceRevision: projected.sourceRevision,
    summaryIds: [], counterpartIds: [counterpartId], fragments: projected.fragments, projectionLineages: [projectionLineage] };
  const candidate = { memoryType: "DURABLE_KNOWLEDGE", text: candidateText,
    fragmentIds: [projected.fragments[0].fragmentId], participantIds: [ownerId, counterpartId], entityIds: [counterpartId],
    topics, eventTime: { status: "unknown" } };
  return { snapshot, candidate, projectionLineage };
}

function commitEntry(coordinator, args) {
  const { snapshot, candidate } = projectedEntry(args);
  const result = coordinator.store.commitOwner(snapshot, { status: "STORE", entries: [candidate] });
  const entryId = result.entryIds[0];
  return { snapshot, entryId, entry: coordinator.store.readEntry(snapshot, entryId) };
}

function createSidecar(label, { ownerId = OWNER_ID, campaignToken = CAMPAIGN, entries = null,
  manualStatus = null, manualCounterpartId = COUNTERPART_ID } = {}) {
  const fixture = makeFixture(label);
  const sourceFolder = path.join(fixture.summaryRoot, `${ownerId}_source`);
  fs.mkdirSync(sourceFolder, { recursive: true });
  const store = new MemoryStore({ baseDir: fixture.baseDir, summaryFoldersDir: fixture.summaryRoot });
  const coordinator = new Memory4Coordinator(store);
  const scope = { campaignToken, ownerId };
  coordinator.store.ensureDisclosureScope(scope);
  const committed = (entries || [{ finalizationId: `${label}-entry`, counterpartId: manualCounterpartId, text: `${label} memory` }])
    .map(spec => commitEntry(coordinator, { ...spec, ownerId, campaignToken }));
  if (manualStatus) {
    const gameData = { campaignToken, date: "1164.1.1", characters: new Map([
      { id: ownerId, shortName: `Owner ${ownerId}` },
      { id: manualCounterpartId, shortName: `Person ${manualCounterpartId}`, primaryTitle: FACT.value }
    ].map(character => [character.id, character])) };
    coordinator.updateManualDisclosure(scope, manualCounterpartId, FACT, manualStatus, gameData, { expectedRevision: 0 });
  }
  const sidecarPath = path.join(fixture.summaryRoot, ".memory4", String(ownerId), hash(campaignToken));
  assert(fs.existsSync(path.join(sidecarPath, "index.json")), "fixture sidecar is committed through Memory4Coordinator");
  return { fixture, folder: sourceFolder, store, coordinator, scope, sidecarPath, committed };
}

function copySidecar(sourceSidecar, ownerFolder, campaignToken) {
  const destination = path.join(ownerFolder, "memory4", hash(campaignToken));
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  for (const [relative, bytes] of readTree(sourceSidecar)) {
    const file = path.join(destination, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, bytes, { flag: "wx" });
  }
  assertSameTree(readTree(destination), readTree(sourceSidecar), "fixture sidecar copy is complete");
  return destination;
}

function createLegacyAliasFixture(label, { ownerId = OWNER_ID, oldName = "旧名", newName = "新名" } = {}) {
  const fixture = makeFixture(label);
  const oldFolder = path.join(fixture.summaryRoot, `${ownerId}_${oldName}`);
  const currentFolder = path.join(fixture.summaryRoot, `${ownerId}_${newName}`);
  fs.mkdirSync(oldFolder, { recursive: true });
  fs.mkdirSync(currentFolder, { recursive: true });
  return { ...fixture, oldFolder, currentFolder, ownerId };
}

function writeDerivedViews(store, scope, directory, entry) {
  const stamp = `${entry.entryId}@${entry.revision}`;
  store.writeJson(path.join(directory, "years", "1164.json"), {
    memory4SchemaVersion: 1, campaignToken: scope.campaignToken, ownerId: scope.ownerId, revision: 4,
    eventYear: 1164, sourceHash: hash([entry.entryId, entry.revision]), sourceRevisionSet: [stamp], dirty: false,
    items: [{ itemId: `year_item_${entry.entryId}`, text: entry.text, sourceEntryIds: [entry.entryId] }], tokens: 3
  });
  store.writeJson(path.join(directory, "life.json"), {
    memory4SchemaVersion: 1, campaignToken: scope.campaignToken, ownerId: scope.ownerId, revision: 2,
    sourceHash: hash([entry.entryId, entry.revision, "life"]), sourceRevisionSet: [stamp], dirty: false,
    segments: [{ segmentId: `life_${entry.entryId}`, period: { fromYear: 1164, toYear: 1164 }, text: entry.text, sourceEntryIds: [entry.entryId] }]
  });
}

function testMergeRowsAndRealSidecar() {
  const target = createLegacyAliasFixture("rows");
  const sidecarSeed = createSidecar("rows-memory", { entries: [
    { finalizationId: "forgotten-entry", counterpartId: COUNTERPART_ID, text: "source to forget" },
    { finalizationId: "deleted-entry", counterpartId: COUNTERPART_ID, text: "source to delete" },
    { finalizationId: "surviving-entry", counterpartId: COUNTERPART_ID, text: "surviving memory" }
  ], manualStatus: "MANUAL_HIDDEN" });
  try {
    const mirrorOld = summary("共同经历", "1100.1.1", { campaignToken: "campaign-alpha", playerName: "旧名", characterName: "旧对手名" });
    const mirrorRenamed = summary("共同经历", "1100.1.1", { campaignToken: "campaign-alpha", playerName: "新名", characterName: "新对手名" });
    const divergentOld = summary("甲方记得的细节", "1101.1.1", { campaignToken: "campaign-alpha" });
    const divergentNew = summary("乙方记得的不同细节", "1101.1.1", { campaignToken: "campaign-alpha", playerName: "新名" });
    const otherCampaign = summary("共同经历", "1102.1.1", { campaignToken: "campaign-beta" });
    const unknownOld = summary("未绑定的共同经历", "1103.1.1", { legacyTag: "legacy-old" });
    const unknownNew = summary("未绑定的共同经历", "1103.1.1", { legacyTag: "legacy-new", playerName: "新名" });
    const newest = summary("最近的共同经历", "1110.1.1", { campaignToken: "campaign-alpha" });
    const oldFile = writeConversation(target.oldFolder, "与旧对手名的对话.json", [mirrorOld, divergentOld, unknownOld, newest]);
    const currentFile = writeConversation(target.currentFolder, "与新对手名的对话.json", [mirrorRenamed, divergentNew, otherCampaign, unknownNew]);
    const oldBindingId = target.store.getLegacySummaryBindingId(oldFile, 2, unknownOld);
    const newBindingId = target.store.getLegacySummaryBindingId(currentFile, 3, unknownNew);
    const sidecarBytes = readTree(sidecarSeed.sidecarPath);
    const entryIds = sidecarSeed.committed.map(row => row.entryId);
    const memory4 = new Memory4Store(sidecarSeed.store);
    const memory4Directory = memory4.directory(sidecarSeed.scope);
    const forgottenLineage = sidecarSeed.committed[0].snapshot.projectionLineages[0];
    memory4.persistForgottenProjection(sidecarSeed.scope, forgottenLineage);
    assert.deepStrictEqual(memory4.query(sidecarSeed.scope).map(row => row.entryId), entryIds.slice(1),
      "a persisted forgotten projection hides its exact source before relocation");
    assert.strictEqual(memory4.deleteEntry(sidecarSeed.scope, entryIds[1], { expectedRevision: 1 }), true,
      "Memory4Store creates a real tombstone through its supported mutation");
    const survivor = memory4.readEntry(sidecarSeed.scope, entryIds[2]);
    writeDerivedViews(sidecarSeed.store, sidecarSeed.scope, memory4Directory, survivor);
    copySidecar(sidecarSeed.sidecarPath, target.oldFolder, sidecarSeed.scope.campaignToken);
    const legacySidecar = path.join(target.oldFolder, "memory4", hash(sidecarSeed.scope.campaignToken));
    const beforeSidecar = readTree(legacySidecar);

    const result = target.store.mergeRenamedSummaryFolders(OWNER_ID, "新名");
    assert.strictEqual(result.folderPath, target.currentFolder);
    assert.strictEqual(result.changed, true);
    assert(!fs.existsSync(target.oldFolder), "the stale owner alias is removed after a successful merge");
    const conversationFiles = fs.readdirSync(target.currentFolder).filter(name => /^与.+的对话\.json$/.test(name));
    assert.strictEqual(conversationFiles.length, 1, "files for the same stable counterpart ID coalesce across renamed filenames");
    const mergedFile = path.join(target.currentFolder, conversationFiles[0]);
    const mergedRows = JSON.parse(fs.readFileSync(mergedFile, "utf8"));
    assert.strictEqual(mergedRows.filter(row => row.campaignToken === "campaign-alpha" && row.content === "共同经历").length, 1,
      "an identical bound mirror is kept once despite renamed participant metadata");
    assert.strictEqual(mergedRows.filter(row => row.campaignToken === "campaign-alpha" && row.content.startsWith("甲方")).length, 1);
    assert.strictEqual(mergedRows.filter(row => row.campaignToken === "campaign-alpha" && row.content.startsWith("乙方")).length, 1,
      "divergent bound text from both perspectives is preserved");
    assert.strictEqual(mergedRows.filter(row => row.campaignToken === "campaign-beta" && row.content === "共同经历").length, 1,
      "the same body from another campaign remains separate");
    const unknownRows = mergedRows.filter(row => row.campaignToken == null && row.content === "未绑定的共同经历");
    assert.strictEqual(unknownRows.length, 2, "unknown campaign records remain separate instead of inheriting a folder campaign");
    assert.deepStrictEqual(new Set(unknownRows.map(row => row.legacyBindingId)), new Set([oldBindingId, newBindingId]),
      "unbound migration IDs are persisted from their original files");
    for (const [index, row] of mergedRows.entries()) {
      if (row.campaignToken == null) assert.strictEqual(target.store.getLegacySummaryBindingId(mergedFile, index, row), row.legacyBindingId,
        "legacy binding IDs remain stable after file move and chronological sorting");
    }
    const dates = mergedRows.map(row => row.date);
    assert.deepStrictEqual(dates, [...dates].sort((left, right) => right.localeCompare(left)), "summaries are newest first");

    const canonical = path.join(target.summaryRoot, ".memory4", String(OWNER_ID), hash(sidecarSeed.scope.campaignToken));
    assert(fs.existsSync(canonical), "the sidecar is relocated under the canonical owner and campaign path");
    assert(!fs.existsSync(legacySidecar), "the legacy sidecar path is removed after relocation");
    assertSameTree(readTree(canonical), beforeSidecar, "all sidecar files retain their original bytes");
    const relocated = new Memory4Store(target.store);
    assert.strictEqual(relocated.directory(sidecarSeed.scope), canonical, "fresh Memory4Store instances resolve the canonical path");
    const index = relocated.loadIndex(sidecarSeed.scope);
    assert.strictEqual(hash(relocated.readEntry(sidecarSeed.scope, entryIds[2])), index.entries[entryIds[2]].bodyHash,
      "relocation preserves the committed body and index hash");
    assert.strictEqual(relocated.readEntry(sidecarSeed.scope, entryIds[1]).deleted, true, "the deleted entry remains a valid tombstone");
    assert(!relocated.query(sidecarSeed.scope).some(row => row.entryId === entryIds[1]), "the tombstoned entry stays out of recall");
    assert(!relocated.query(sidecarSeed.scope).some(row => row.entryId === entryIds[0]), "the forgotten projection stays out of recall");
    assert.deepStrictEqual(relocated.query(sidecarSeed.scope).map(row => row.entryId), [entryIds[2]], "only the surviving entry is recalled");
    assert(fs.existsSync(path.join(canonical, "life.json")) && fs.existsSync(path.join(canonical, "years", "1164.json"))
      && fs.existsSync(path.join(canonical, "forgotten-projections.json")) && fs.existsSync(path.join(canonical, "known-entities.json"))
      && fs.existsSync(path.join(canonical, "index.json")) && fs.existsSync(path.join(canonical, "metadata.json")),
    "derived, tombstone, forgotten, known, index, and metadata records all survive relocation");
    const known = relocated.read(path.join(canonical, "known-entities.json"), null);
    assert(Object.values(known.entities[String(COUNTERPART_ID)].disclosedFacts).some(row => row.status === "MANUAL_HIDDEN"),
      "the manual disclosure state remains present after relocation");
  } finally {
    fs.rmSync(sidecarSeed.fixture.root, { recursive: true, force: true });
    fs.rmSync(target.root, { recursive: true, force: true });
  }
}

function testDisjointSameCampaignUnion() {
  const target = createLegacyAliasFixture("union");
  const left = createSidecar("union-left", { entries: [{ finalizationId: "union-left-fin", counterpartId: 77, text: "left fact" }],
    manualStatus: "MANUAL_KNOWN", manualCounterpartId: 77 });
  const right = createSidecar("union-right", { entries: [{ finalizationId: "union-right-fin", counterpartId: 78, text: "right fact" }],
    manualStatus: "MANUAL_KNOWN", manualCounterpartId: 78 });
  try {
    writeDerivedViews(left.store, left.scope, left.sidecarPath, left.committed[0].entry);
    writeDerivedViews(right.store, right.scope, right.sidecarPath, right.committed[0].entry);
    const leftLife = JSON.parse(fs.readFileSync(path.join(left.sidecarPath, "life.json"), "utf8"));
    leftLife.segments[0].period = { fromYear: 1150, toYear: 1159 };
    writeJson(path.join(left.sidecarPath, "life.json"), leftLife);
    copySidecar(left.sidecarPath, target.oldFolder, CAMPAIGN);
    copySidecar(right.sidecarPath, target.currentFolder, CAMPAIGN);
    const beforeRetiredConflict = readTree(target.summaryRoot);
    assert.throws(() => target.store.mergeRenamedSummaryFolders(OWNER_ID, "新名"), /memory4_sidecar_file_conflict/,
      "retired views with different bodies must block union without rewriting them");
    assertSameTree(readTree(target.summaryRoot), beforeRetiredConflict, "retired-view rejection preserves every source byte");
    for (const folder of [target.oldFolder, target.currentFolder]) {
      const sidecar = path.join(folder, "memory4", hash(CAMPAIGN));
      fs.unlinkSync(path.join(sidecar, "years", "1164.json"));
      assert.deepEqual(fs.readdirSync(path.join(sidecar, "years")), [], "fixture retirement must identify all year files");
      fs.rmdirSync(path.join(sidecar, "years"));
      fs.unlinkSync(path.join(sidecar, "life.json"));
    }
    const result = target.store.mergeRenamedSummaryFolders(OWNER_ID, "新名");
    assert.strictEqual(result.folderPath, target.currentFolder);
    const memory4 = new Memory4Store(target.store);
    const rows = memory4.query({ ownerId: OWNER_ID, campaignToken: CAMPAIGN });
    assert.deepStrictEqual(new Set(rows.map(row => row.text)), new Set(["left fact", "right fact"]),
      "disjoint valid sidecars in the same owner-campaign scope are unioned");
    const known = memory4.readKnownEntities({ ownerId: OWNER_ID, campaignToken: CAMPAIGN });
    assert.deepStrictEqual(Object.keys(known.currentFactState).sort(), ["77", "78"],
      "union preserves current fact epochs for disjoint counterpart IDs");
    assert.deepStrictEqual(Object.keys(known.currentFactObservedDates).sort(), ["77", "78"],
      "union preserves current fact observation high-water dates for disjoint counterpart IDs");
    assert.strictEqual(fs.readdirSync(path.join(target.summaryRoot, ".memory4", String(OWNER_ID))).length, 1,
      "the disjoint union has one canonical campaign sidecar");
    const canonical = memory4.directory(left.scope);
    assert(!fs.existsSync(path.join(canonical, "years")) && !fs.existsSync(path.join(canonical, "life.json")),
      "canonical union after explicit fixture retirement never recreates removed views");
  } finally {
    for (const item of [left, right]) fs.rmSync(item.fixture.root, { recursive: true, force: true });
    fs.rmSync(target.root, { recursive: true, force: true });
  }
}

function assertMergeRejectsWithoutMutation(label, left, right, expectedError) {
  const target = createLegacyAliasFixture(label);
  try {
    copySidecar(left.sidecarPath, target.oldFolder, left.scope.campaignToken);
    copySidecar(right.sidecarPath, target.currentFolder, right.scope.campaignToken);
    const beforeSummaries = readTree(target.summaryRoot);
    const beforeMemory = readTree(target.baseDir);
    assert.throws(() => target.store.mergeRenamedSummaryFolders(OWNER_ID, "新名"), expectedError,
      "conflicting valid disclosures or bodies must fail closed");
    assertSameTree(readTree(target.summaryRoot), beforeSummaries, "rejected merge leaves source summary folders byte-for-byte intact");
    assertSameTree(readTree(target.baseDir), beforeMemory, "rejected merge leaves journal and repository state unchanged");
  } finally {
    fs.rmSync(target.root, { recursive: true, force: true });
  }
}

function testConflictingManualDisclosureFailsClosed() {
  const hidden = createSidecar("manual-hidden", { manualStatus: "MANUAL_HIDDEN" });
  const known = createSidecar("manual-known", { manualStatus: "MANUAL_KNOWN" });
  try {
    const hiddenFact = Object.values(hidden.coordinator.store.readKnownEntities(hidden.scope).entities[String(COUNTERPART_ID)].disclosedFacts)[0];
    const knownFact = Object.values(known.coordinator.store.readKnownEntities(known.scope).entities[String(COUNTERPART_ID)].disclosedFacts)[0];
    assert.strictEqual(hiddenFact.factId, knownFact.factId, "the sidecars describe the same manual disclosure identity");
    assert.strictEqual(hiddenFact.status, "MANUAL_HIDDEN");
    assert.strictEqual(knownFact.status, "MANUAL_KNOWN");
    assertMergeRejectsWithoutMutation("manual-conflict", hidden, known, /conflict|disclosure|known|index/i);
  } finally {
    for (const item of [hidden, known]) fs.rmSync(item.fixture.root, { recursive: true, force: true });
  }
}

function testSameEntryDifferentValidBodyFailsClosed() {
  const shared = { finalizationId: "same-entry-finalization", conversationId: "same-entry-conversation", counterpartId: 77,
    text: "same projected transcript", candidateText: "same body", topics: ["topic-left"] };
  const left = createSidecar("entry-body-left", { entries: [shared] });
  const right = createSidecar("entry-body-right", { entries: [{ ...shared, topics: ["topic-right"] }] });
  try {
    const leftEntry = left.committed[0].entry;
    const rightEntry = right.committed[0].entry;
    assert.strictEqual(leftEntry.entryId, rightEntry.entryId, "both valid entries collide on the stable entry identity");
    assert.notStrictEqual(hash(leftEntry), hash(rightEntry), "their valid JSON bodies differ outside the entry ID inputs");
    assertMergeRejectsWithoutMutation("entry-body-conflict", left, right, /conflict|entry|body|index/i);
  } finally {
    for (const item of [left, right]) fs.rmSync(item.fixture.root, { recursive: true, force: true });
  }
}

function testCorruptBodyAndRevisionMismatchFailClosed() {
  for (const mode of ["body", "revision"]) {
    const target = createLegacyAliasFixture(`corrupt-${mode}`);
    const source = createSidecar(`corrupt-${mode}-source`);
    try {
      copySidecar(source.sidecarPath, target.oldFolder, CAMPAIGN);
      const sidecarPath = path.join(target.oldFolder, "memory4", hash(CAMPAIGN));
      const entryId = source.committed[0].entryId;
      const bodyPath = path.join(sidecarPath, "entries", `${entryId}.json`);
      const body = JSON.parse(fs.readFileSync(bodyPath, "utf8"));
      if (mode === "body") {
        body.text = "tampered body without matching bodyHash";
        writeJson(bodyPath, body);
      } else {
        body.revision++;
        writeJson(bodyPath, body);
        const indexPath = path.join(sidecarPath, "index.json");
        const index = JSON.parse(fs.readFileSync(indexPath, "utf8"));
        index.entries[entryId].bodyHash = hash(body);
        writeJson(indexPath, index);
        const metadataPath = path.join(sidecarPath, "metadata.json");
        const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
        metadata.indexHash = hash(index);
        writeJson(metadataPath, metadata);
      }
      const before = readTree(target.summaryRoot);
      assert.throws(() => target.store.mergeRenamedSummaryFolders(OWNER_ID, "新名"), /body|revision|index|mismatch|invalid/i,
        `${mode} corruption must fail closed`);
      assertSameTree(readTree(target.summaryRoot), before, `${mode} corruption does not mutate any summary data`);
      assert.strictEqual(readTree(target.baseDir).size, 0, `${mode} corruption does not leave a mutation journal`);
    } finally {
      fs.rmSync(source.fixture.root, { recursive: true, force: true });
      fs.rmSync(target.root, { recursive: true, force: true });
    }
  }
}

function testCorruptSummaryJsonIsFailClosed() {
  const target = createLegacyAliasFixture("corrupt-summary-json");
  try {
    writeConversation(target.currentFolder, "与乙的对话.json", [summary("valid", "1100.1.1", { campaignToken: "campaign-alpha" })]);
    fs.writeFileSync(path.join(target.oldFolder, "与甲的对话.json"), "[{broken", "utf8");
    const before = readTree(target.summaryRoot);
    assert.throws(() => target.store.mergeRenamedSummaryFolders(OWNER_ID, "新名"), /corrupt|invalid|JSON/i);
    assertSameTree(readTree(target.summaryRoot), before, "corrupt summary JSON does not mutate any files");
  } finally {
    fs.rmSync(target.root, { recursive: true, force: true });
  }
}

async function testGameDataAndSummaryManagerIntegration() {
  const fixture = makeFixture("integration");
  try {
    const staleFolder = path.join(fixture.summaryRoot, `${OWNER_ID}_旧名`);
    fs.mkdirSync(staleFolder, { recursive: true });
    const existingFileName = "与旧对手名的对话.json";
    writeConversation(staleFolder, existingFileName, [summary("既有记忆", "1100.1.1", { campaignToken: "old-campaign" })]);
    const memoryEngine = { store: fixture.store, invalidateSummaryFolderCache: ids => fixture.store.invalidateFolderSummaryCache(ids) };
    const GameData = createGameData({ fs, path, memorySystem, memoryEngine, summariesDir: fixture.summaryRoot,
      getHistoricalReferenceByYear: () => ({ period: "fixture", context: "", notableEvents: [], notableFigures: [] }) });
    const gameData = Object.create(GameData.prototype);
    const owner = { id: OWNER_ID, firstName: "新名", shortName: "新名", fullName: "新名" };
    const counterpart = { id: COUNTERPART_ID, firstName: "新对手名", shortName: "新对手名", fullName: "新对手名" };
    gameData.characters = new Map([[OWNER_ID, owner], [COUNTERPART_ID, counterpart]]);
    gameData.date = "1111.1.1";
    gameData.totalDays = 1000;

    const pathBeforeSave = gameData.getConversationFilePath(OWNER_ID, owner.shortName, COUNTERPART_ID, counterpart.shortName);
    assert.strictEqual(path.dirname(pathBeforeSave), staleFolder, "one existing owner folder is reused after a rename");
    fs.mkdirSync(path.join(fixture.summaryRoot, `${OWNER_ID}_新名`));
    const mergedPath = gameData.getConversationFilePath(OWNER_ID, owner.shortName, COUNTERPART_ID, counterpart.shortName);
    assert.strictEqual(path.basename(mergedPath), existingFileName,
      "GameData reuses the old counterpart filename by stable character ID");
    const records = gameData.saveSummaryForDirectedPair(owner, counterpart, "新近对话", [owner, counterpart], {
      date: gameData.date, totalDays: gameData.totalDays, finalizationId: "final-new", campaignToken: "new-campaign"
    });
    assert.strictEqual(records.length, 2, "the new directed summary is appended to the existing counterpart file");
    assert.strictEqual(records[0].content, "新近对话");
    assert.strictEqual(fs.existsSync(staleFolder), false, "saving after a rename does not recreate the stale owner folder");
    assert.strictEqual(path.basename(path.dirname(mergedPath)), `${OWNER_ID}_新名`);

    const SummariesManager = createSummariesManager({ fs, path, summariesDir: fixture.summaryRoot, memoryEngine, memorySystem,
      getCurrentConversation: () => ({ gameData }), getMemory4ReadConversation: () => ({ gameData }) });
    const listed = await SummariesManager.listAllSummaries();
    const ownerFiles = listed.filter(item => Number(item.ownerId) === OWNER_ID);
    assert.strictEqual(ownerFiles.length, 1, "listAllSummaries returns one consolidated owner conversation file");
    assert.strictEqual(ownerFiles[0].folderName, `${OWNER_ID}_新名`);
    assert.strictEqual(ownerFiles[0].conversationFile, existingFileName);
    const beforeMissingNames = fs.readFileSync(mergedPath);
    gameData.characters = new Map([[OWNER_ID, { id: OWNER_ID }], [COUNTERPART_ID, { id: COUNTERPART_ID }]]);
    assert.strictEqual(gameData.getCharacterFolderPath(OWNER_ID), path.dirname(mergedPath),
      "a runtime snapshot without names retains the known owner folder");
    const missingNamesCatalog = await SummariesManager.listAllSummaries();
    assert.strictEqual(missingNamesCatalog.find(item => item.ownerId === OWNER_ID).folderName, `${OWNER_ID}_新名`);
    assert.deepStrictEqual(fs.readFileSync(mergedPath), beforeMissingNames, "missing names do not rewrite known summary data");
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
}

function testSameNameCounterpartIdsStaySeparate() {
  const target = createLegacyAliasFixture("same-name-counterparts");
  try {
    writeConversation(target.oldFolder, "与同名人物的对话.json", [summary("person 77 memory", "1100.1.1", {
      campaignToken: "campaign-alpha", characterId: 77, characterName: "同名人物"
    })]);
    writeConversation(target.currentFolder, "与同名人物的对话.json", [summary("person 78 memory", "1101.1.1", {
      campaignToken: "campaign-alpha", characterId: 78, characterName: "同名人物", playerName: "新名"
    })]);
    target.store.mergeRenamedSummaryFolders(OWNER_ID, "新名");
    const files = fs.readdirSync(target.currentFolder).filter(name => /^与.+的对话\.json$/.test(name));
    assert.strictEqual(files.length, 2, "different counterpart IDs with the same display name keep separate regex-compatible files");
    const fileFor = id => files.find(file => JSON.parse(fs.readFileSync(path.join(target.currentFolder, file), "utf8"))
      .some(row => Number(row.characterId) === id));
    const file77 = fileFor(77), file78 = fileFor(78);
    assert(file77 && file78 && file77 !== file78, "the two same-name counterparts have distinct filenames");

    const memoryEngine = { store: target.store };
    const GameData = createGameData({ fs, path, memorySystem, memoryEngine, summariesDir: target.summaryRoot,
      getHistoricalReferenceByYear: () => ({ period: "fixture", context: "", notableEvents: [], notableFigures: [] }) });
    const gameData = Object.create(GameData.prototype);
    const owner = { id: OWNER_ID, shortName: "新名" };
    const sameName77 = { id: 77, shortName: "同名人物" };
    const sameName78 = { id: 78, shortName: "同名人物" };
    const sameName99 = { id: 99, shortName: "同名人物" };
    const sameName100 = { id: 100, shortName: "同名人物" };
    gameData.characters = new Map([owner, sameName77, sameName78, sameName99, sameName100].map(row => [row.id, row]));
    const path77 = gameData.getConversationFilePath(OWNER_ID, owner.shortName, 77, sameName77.shortName);
    const path78 = gameData.getConversationFilePath(OWNER_ID, owner.shortName, 78, sameName78.shortName);
    assert.notStrictEqual(path77, path78, "GameData resolves existing conversations by stable counterpart ID");
    assert.strictEqual(path.basename(path77), file77);
    assert.strictEqual(path.basename(path78), file78);
    assert(/^与.+的对话\.json$/.test(path.basename(path77)) && /^与.+的对话\.json$/.test(path.basename(path78)),
      "resolved counterpart files keep the application filename pattern");

    const path99 = gameData.getConversationFilePath(OWNER_ID, owner.shortName, 99, sameName99.shortName);
    assert(![path77, path78].includes(path99), "an unregistered same-name ID does not reuse either counterpart's file");
    writeConversation(target.currentFolder, path.basename(path99), [summary("person 99 memory", "1102.1.1", {
      campaignToken: "campaign-alpha", characterId: 99, characterName: "同名人物", playerName: "新名"
    })]);
    const path100 = gameData.getConversationFilePath(OWNER_ID, owner.shortName, 100, sameName100.shortName);
    assert(![path77, path78, path99].includes(path100), "a cached same-name file cannot capture a fourth stable ID");
    assert(/^与.+的对话\.json$/.test(path.basename(path99)) && /^与.+的对话\.json$/.test(path.basename(path100)),
      "new same-name ID paths remain compatible with conversation-file discovery");
  } finally {
    fs.rmSync(target.root, { recursive: true, force: true });
  }
}

function testNamesakeOwnerIsolation() {
  const target = createLegacyAliasFixture("owner-isolation");
  try {
    const namesake = path.join(target.summaryRoot, `99_新名`);
    fs.mkdirSync(namesake, { recursive: true });
    writeConversation(target.oldFolder, "与乙的对话.json", [summary("owner 42", "1100.1.1", { campaignToken: "campaign-alpha" })]);
    const namesakeFile = writeConversation(namesake, "与乙的对话.json", [summary("owner 99", "1100.1.1", {
      campaignToken: "campaign-alpha", ownerId: 99
    })]);
    const beforeNamesake = fs.readFileSync(namesakeFile);
    target.store.mergeRenamedSummaryFolders(OWNER_ID, "新名");
    assert(fs.existsSync(namesake), "a same-name folder with another numeric owner ID remains separate");
    assert.deepStrictEqual(fs.readFileSync(namesakeFile), beforeNamesake, "the other owner remains byte-for-byte unchanged");
  } finally {
    fs.rmSync(target.root, { recursive: true, force: true });
  }
}

function testNativeJunctionSafety() {
  const target = createLegacyAliasFixture("junction");
  const outside = path.join(target.root, "outside");
  try {
    fs.mkdirSync(outside, { recursive: true });
    const canary = writeConversation(outside, "与外部人物的对话.json", [summary("outside canary", "1100.1.1", { campaignToken: "campaign-alpha" })]);
    const junction = path.join(target.summaryRoot, `${OWNER_ID}_映射`);
    let junctionError = null;
    try { fs.symlinkSync(outside, junction, "junction"); }
    catch (error) {
      if (["EPERM", "EACCES", "ENOTSUP"].includes(error.code)) junctionError = error;
      else throw error;
    }
    if (junctionError) {
      console.log(`V9.2 rename folder junction: NATIVE_UNVERIFIED (${junctionError.code})`);
      return;
    }
    const beforeOutside = readTree(outside);
    assert.throws(() => target.store.mergeRenamedSummaryFolders(OWNER_ID, "新名"), /unsafe_summary_mutation_path/);
    assertSameTree(readTree(outside), beforeOutside, "a native junction target is never mutated");
    assert(fs.existsSync(canary), "the external canary remains in place");
  } finally {
    fs.rmSync(target.root, { recursive: true, force: true });
  }
}

function testSourceChangedAfterPlanning() {
  const target = createLegacyAliasFixture("source-changed");
  const file = writeConversation(target.oldFolder, "与乙的对话.json", [summary("original", "1100.1.1")]);
  const changed = Buffer.from(JSON.stringify([summary("manual edit", "1100.1.1")]), "utf8");
  const originalMkdir = fs.mkdirSync;
  let edited = false;
  try {
    fs.mkdirSync = (directory, ...args) => {
      const result = originalMkdir(directory, ...args);
      if (!edited && String(directory).includes("renamed-summary-folders")) {
        edited = true;
        fs.writeFileSync(file, changed);
      }
      return result;
    };
    assert.throws(() => target.store.mergeRenamedSummaryFolders(OWNER_ID, "新名"), /summary_merge_source_changed_during_backup/);
    assert.deepStrictEqual(fs.readFileSync(file), changed, "a manual edit after planning is never overwritten");
    assert(fs.existsSync(target.oldFolder), "source-change rejection preserves the original owner directory");
    assert(!fs.existsSync(path.join(target.baseDir, "summary-mutation.json")), "source-change rejection starts no mutation");
  } finally {
    fs.mkdirSync = originalMkdir;
    fs.rmSync(target.root, { recursive: true, force: true });
  }
}

function testCrashRecoveryDuringSidecarRelocation() {
  const target = createLegacyAliasFixture("crash");
  const source = createSidecar("crash-source");
  try {
    writeConversation(target.oldFolder, "与旧乙的对话.json", [summary("old summary", "1100.1.1", { campaignToken: CAMPAIGN })]);
    copySidecar(source.sidecarPath, target.oldFolder, CAMPAIGN);
    const oldSidecar = path.join(target.oldFolder, "memory4", hash(CAMPAIGN));
    const sourceBytes = readTree(oldSidecar);
    const originalSummaries = readTree(target.summaryRoot);
    const memoryStorePath = require.resolve("../resources/app/out/main/memory-system/memory-store");
    const childScript = String.raw`
      const fs = require("node:fs");
      const path = require("node:path");
      const [summaryRoot, baseDir, memoryStorePath, ownerFolder, canonicalPath] = process.argv.slice(1);
      const originalRename = fs.renameSync.bind(fs);
      let interrupted = false;
      fs.renameSync = (from, to, ...rest) => {
        const result = originalRename(from, to, ...rest);
        const target = path.resolve(String(to));
        if (!interrupted && target.startsWith(path.resolve(canonicalPath) + path.sep)
          && /\.json$/i.test(target)) {
          interrupted = true;
          process.exit(86);
        }
        return result;
      };
      const { MemoryStore } = require(memoryStorePath);
      new MemoryStore({ baseDir, summaryFoldersDir: summaryRoot }).mergeRenamedSummaryFolders(42, "全新名");
      process.exit(0);
    `;
    const canonicalPath = path.join(target.summaryRoot, ".memory4", String(OWNER_ID), hash(CAMPAIGN));
    const child = childProcess.spawnSync(process.execPath,
      ["-e", childScript, target.summaryRoot, target.baseDir, memoryStorePath, target.oldFolder, canonicalPath],
      { encoding: "utf8", timeout: 15000, windowsHide: true });
    assert.strictEqual(child.status, 86, `child exits after a real canonical sidecar file write: ${child.stderr || child.stdout}`);
    new MemoryStore({ baseDir: target.baseDir, summaryFoldersDir: target.summaryRoot });
    assertSameTree(readTree(target.summaryRoot), originalSummaries, "restart restores every original summary file and path");
    assert.strictEqual(fs.existsSync(canonicalPath), false, "rollback removes the created empty canonical sidecar");
    assert.strictEqual(fs.existsSync(path.join(target.summaryRoot, `${OWNER_ID}_全新名`)), false,
      "rollback removes the newly created summary folder");
    assertSameTree(readTree(oldSidecar), sourceBytes, "restart restores the legacy sidecar after interrupted relocation");
    const recovered = new Memory4Store(new MemoryStore({ baseDir: target.baseDir, summaryFoldersDir: target.summaryRoot }));
    assert.strictEqual(recovered.readEntry({ ownerId: OWNER_ID, campaignToken: CAMPAIGN }, source.committed[0].entryId).text,
      source.committed[0].entry.text, "recovery leaves the original sidecar available for recall");
    assert.strictEqual(fs.existsSync(path.join(target.baseDir, "summary-mutation.json")), false,
      "startup recovery clears the completed summary mutation journal");
  } finally {
    fs.rmSync(source.fixture.root, { recursive: true, force: true });
    fs.rmSync(target.root, { recursive: true, force: true });
  }
}

async function run() {
  try {
    testMergeRowsAndRealSidecar();
    testDisjointSameCampaignUnion();
    testConflictingManualDisclosureFailsClosed();
    testSameEntryDifferentValidBodyFailsClosed();
    testCorruptBodyAndRevisionMismatchFailClosed();
    testCorruptSummaryJsonIsFailClosed();
    await testGameDataAndSummaryManagerIntegration();
    testSameNameCounterpartIdsStaySeparate();
    testNamesakeOwnerIsolation();
    testNativeJunctionSafety();
    testSourceChangedAfterPlanning();
    testCrashRecoveryDuringSidecarRelocation();
    console.log("V9.2 renamed summary folders: PASS");
  } finally {
    for (const root of temporaryRoots) fs.rmSync(root, { recursive: true, force: true });
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
