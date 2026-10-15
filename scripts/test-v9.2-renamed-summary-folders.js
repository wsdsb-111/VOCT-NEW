"use strict";

const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const Module = require("node:module");
const os = require("node:os");
const path = require("node:path");
const sourceVersionPath = require.resolve("../src/app/main/version.js");
const originalModuleLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "../../package.json" && parent?.filename === sourceVersionPath) return require("../package.json");
  return originalModuleLoad.call(this, request, parent, isMain);
};
const { MemoryStore } = require("../src/app/main/memory-system/memory-store");
const memorySystem = require("../src/app/main/memory-system");
const { createGameData } = require("../src/app/main/game-data/game-data");
const { createSummariesManager } = require("../src/app/main/summaries/summaries-manager");

const OWNER_ID = 42;
const COUNTERPART_ID = 77;
const CAMPAIGN = "summary-folder-rename-campaign";
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

function writeOpaqueSidecar(directory) {
  const opaqueBytes = Buffer.from([0x00, 0xff, 0x4d, 0x34, 0x00, 0x7b, 0x80]);
  for (const relative of ["index.json", "metadata.json", "known-entities.json", "forgotten-projections.json",
    "entries/opaque.bin", "years/1164.json", "life.json"]) {
    const filePath = path.join(directory, ...relative.split("/"));
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, opaqueBytes);
  }
  return opaqueBytes;
}

function withoutSidecarReads(sidecarPaths, action) {
  const sidecarRoots = sidecarPaths.map(item => path.resolve(item).toLowerCase());
  const withinSidecar = candidate => {
    const resolved = path.resolve(String(candidate)).toLowerCase();
    return sidecarRoots.some(root => resolved === root || resolved.startsWith(root + path.sep.toLowerCase()));
  };
  const originalReadFileSync = fs.readFileSync, originalReaddirSync = fs.readdirSync;
  let attempted = null, actionError = null;
  try {
    fs.readFileSync = (file, ...args) => {
      if (withinSidecar(file)) { attempted = `read:${file}`; throw new Error("test_retired_sidecar_read"); }
      return originalReadFileSync(file, ...args);
    };
    fs.readdirSync = (directory, ...args) => {
      if (withinSidecar(directory)) { attempted = `list:${directory}`; throw new Error("test_retired_sidecar_list"); }
      return originalReaddirSync(directory, ...args);
    };
    action();
  } catch (error) {
    actionError = error;
  } finally {
    fs.readFileSync = originalReadFileSync;
    fs.readdirSync = originalReaddirSync;
  }
  assert.strictEqual(attempted, null, "retired sidecar contents are never opened or listed");
  if (actionError) throw actionError;
}

function createLegacyAliasFixture(label, { ownerId = OWNER_ID, oldName = "旧名", newName = "新名" } = {}) {
  const fixture = makeFixture(label);
  const oldFolder = path.join(fixture.summaryRoot, `${ownerId}_${oldName}`);
  const currentFolder = path.join(fixture.summaryRoot, `${ownerId}_${newName}`);
  fs.mkdirSync(oldFolder, { recursive: true });
  fs.mkdirSync(currentFolder, { recursive: true });
  return { ...fixture, oldFolder, currentFolder, ownerId };
}

function testMergeLegacyRows() {
  const target = createLegacyAliasFixture("rows");
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
  } finally {
    fs.rmSync(target.root, { recursive: true, force: true });
  }
}

function testOpaqueRetiredSidecarsBlockWithoutAccess() {
  for (const location of ["renamed-folder", "canonical-owner"]) {
    const target = createLegacyAliasFixture(`opaque-${location}`);
    try {
      const oldFile = writeConversation(target.oldFolder, "与旧乙的对话.json", [summary("legacy old", "1100.1.1", { characterId: 77 })]);
      const currentFile = writeConversation(target.currentFolder, "与新乙的对话.json", [summary("legacy current", "1101.1.1", { characterId: 78 })]);
      const sidecarPath = location === "renamed-folder"
        ? path.join(target.oldFolder, "memory4")
        : path.join(target.summaryRoot, ".memory4", String(OWNER_ID));
      const opaqueBytes = writeOpaqueSidecar(sidecarPath);
      const before = readTree(target.summaryRoot);
      let mergeResult, gameData, owner, counterpart77;
      withoutSidecarReads([sidecarPath], () => {
        mergeResult = target.store.mergeRenamedSummaryFolders(OWNER_ID, "新名");
        assert.strictEqual(mergeResult.blocked, "RETIRED_SIDECAR_PRESENT",
          "a retired sidecar skips the rename merge without opening or parsing its contents");
        assert.strictEqual(target.store.getSummaryConversationFile(OWNER_ID, 77, "旧乙"), oldFile,
          "Legacy lookup still resolves the unique counterpart file in a preserved owner alias");
        assert.strictEqual(target.store.getSummaryConversationFile(OWNER_ID, 78, "新乙"), currentFile,
          "Legacy lookup still resolves counterpart files from every preserved owner alias");
        const GameData = createGameData({ fs, path, memorySystem,
          memoryEngine: { store: target.store, invalidateSummaryFolderCache: ids => target.store.invalidateFolderSummaryCache(ids) },
          summariesDir: target.summaryRoot,
          getHistoricalReferenceByYear: () => ({ period: "fixture", context: "", notableEvents: [], notableFigures: [] }) });
        gameData = Object.create(GameData.prototype);
        owner = { id: OWNER_ID, firstName: "新名", shortName: "新名", fullName: "新名" };
        counterpart77 = { id: 77, firstName: "旧乙", shortName: "旧乙", fullName: "旧乙" };
        const counterpart78 = { id: 78, firstName: "新乙", shortName: "新乙", fullName: "新乙" };
        gameData.characters = new Map([[OWNER_ID, owner], [77, counterpart77], [78, counterpart78]]);
        gameData.date = "1112.1.1";
        gameData.totalDays = 1200;
        gameData.loadAllConversationsForCharacter(owner);
        assert.deepStrictEqual(new Set(owner.allConversationSummaries.map(item => item.content)), new Set(["legacy old", "legacy current"]),
          "Legacy character loading reads every legal numeric-owner folder when maintenance is blocked");
        const newCounterpartPath = gameData.getConversationFilePath(OWNER_ID, "新名", 99, "新乙");
        assert(path.basename(newCounterpartPath).includes("_99"), "a new counterpart uses an ID-qualified file when the canonical name collides");
      });
      assertSameTree(readTree(target.summaryRoot), before, "a blocked merge preserves all legacy and opaque sidecar bytes");
      assert(fs.existsSync(target.oldFolder) && fs.existsSync(target.currentFolder), "both owner aliases remain after the safe block");
      assert.strictEqual(fs.existsSync(path.join(target.baseDir, "summary-mutation.json")), false, "a blocked merge starts no transaction journal");
      assert(opaqueBytes.length > 0, "the opaque sidecar fixture contains bytes");
      const beforeSidecar = readTree(sidecarPath);
      withoutSidecarReads([sidecarPath], () => {
        gameData.saveSummaryForDirectedPair(owner, counterpart77, "Legacy write remains available", [owner, counterpart77], {
          date: gameData.date, totalDays: gameData.totalDays, finalizationId: "blocked-merge-write", campaignToken: CAMPAIGN
        });
      });
      assert(fs.existsSync(target.oldFolder), "the source Legacy owner directory remains present after a directed write");
      assertSameTree(readTree(sidecarPath), beforeSidecar, "Legacy CRUD leaves retired sidecar bytes untouched");
      assert(JSON.parse(fs.readFileSync(oldFile, "utf8")).some(row => row.content === "Legacy write remains available"),
        "a unique Legacy counterpart file remains writable while maintenance is blocked");
      writeConversation(target.currentFolder, "与另一个乙的对话.json", [summary("conflicting legacy", "1102.1.1", { characterId: 77 })]);
      withoutSidecarReads([sidecarPath], () => {
        assert.throws(() => target.store.getSummaryConversationFile(OWNER_ID, 77, "旧乙"), /summary_merge_counterpart_file_conflict/,
          "only conflicting counterpart-to-file mappings fail closed");
      });
    } finally {
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

function testCrashRecoveryDuringLegacyMerge() {
  const target = createLegacyAliasFixture("crash");
  try {
    writeConversation(target.oldFolder, "与旧乙的对话.json", [summary("old summary", "1100.1.1", { campaignToken: CAMPAIGN })]);
    writeConversation(target.currentFolder, "与现乙的对话.json", [summary("current summary", "1101.1.1", { campaignToken: CAMPAIGN })]);
    const originalSummaries = readTree(target.summaryRoot);
    const memoryStorePath = require.resolve("../src/app/main/memory-system/memory-store");
    const childScript = String.raw`
      const fs = require("node:fs");
      const path = require("node:path");
      const [summaryRoot, baseDir, memoryStorePath, packageJsonPath, targetFolder] = process.argv.slice(1);
      const Module = require("node:module");
      const originalLoad = Module._load;
      const versionPath = path.resolve(path.dirname(memoryStorePath), "../version.js");
      Module._load = function (request, parent, isMain) {
        if (request === "../../package.json" && parent && path.resolve(parent.filename) === versionPath) {
          return originalLoad.call(this, packageJsonPath, parent, isMain);
        }
        return originalLoad.call(this, request, parent, isMain);
      };
      const originalRename = fs.renameSync.bind(fs);
      let interrupted = false;
      fs.renameSync = (from, to, ...rest) => {
        const result = originalRename(from, to, ...rest);
        const target = path.resolve(String(to));
        if (!interrupted && target.startsWith(path.resolve(targetFolder) + path.sep)
          && /^与.+的对话\.json$/.test(path.basename(target))) {
          interrupted = true;
          process.exit(86);
        }
        return result;
      };
      const { MemoryStore } = require(memoryStorePath);
      new MemoryStore({ baseDir, summaryFoldersDir: summaryRoot }).mergeRenamedSummaryFolders(42, "全新名");
      process.exit(0);
    `;
    const targetFolder = path.join(target.summaryRoot, `${OWNER_ID}_全新名`);
    const packageJsonPath = require.resolve("../package.json");
    const child = childProcess.spawnSync(process.execPath,
      ["-e", childScript, target.summaryRoot, target.baseDir, memoryStorePath, packageJsonPath, targetFolder],
      { encoding: "utf8", timeout: 15000, windowsHide: true });
    assert.strictEqual(child.status, 86, `child exits after a real Legacy summary write: ${child.stderr || child.stdout}`);
    new MemoryStore({ baseDir: target.baseDir, summaryFoldersDir: target.summaryRoot });
    assertSameTree(readTree(target.summaryRoot), originalSummaries, "restart restores every original summary file and path");
    assert.strictEqual(fs.existsSync(targetFolder), false, "rollback removes the newly created summary folder");
    assert.strictEqual(fs.existsSync(path.join(target.baseDir, "summary-mutation.json")), false,
      "startup recovery clears the completed summary mutation journal");
  } finally {
    fs.rmSync(target.root, { recursive: true, force: true });
  }
}

async function run() {
  try {
    testMergeLegacyRows();
    testOpaqueRetiredSidecarsBlockWithoutAccess();
    testCorruptSummaryJsonIsFailClosed();
    await testGameDataAndSummaryManagerIntegration();
    testSameNameCounterpartIdsStaySeparate();
    testNamesakeOwnerIsolation();
    testNativeJunctionSafety();
    testSourceChangedAfterPlanning();
    testCrashRecoveryDuringLegacyMerge();
    console.log("V9.2 renamed summary folders: PASS");
  } finally {
    for (const root of temporaryRoots) fs.rmSync(root, { recursive: true, force: true });
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
