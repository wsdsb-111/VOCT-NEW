"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { TemporalArchiveStore } = require("../resources/app/out/main/worldline/temporal-archive-store");
const { HistoricalCheckpointIndex, boundedRead } = require("../resources/app/out/main/worldline/historical-checkpoint-index");
const { inspectTemporalArchive } = require("../resources/app/out/main/worldline/temporal-archive-diagnostics");
const { parseGameState } = require("../resources/app/out/main/worldline/game-state-adapter");
const { digest } = require("../resources/app/out/main/worldline/historical-query-projection");
const { normalizeGameDate } = require("../resources/app/out/main/worldline/character-temporal-facts");
const { WorldlineService, normalizeSettings } = require("../resources/app/out/main/worldline/worldline-service");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v812-archive-"));
const branchId = `branch_${crypto.randomUUID()}`;
function fixture(date = "1145.1.1", campaign = "fixture", revision = "") {
  const snapshot = parseGameState(`date=${date} playthrough_id="${campaign}" played_character=1
    living={1={first_name="甲${revision}" birth=1100.1.1 family_data={spouse=2} alive_data={location=123}}
    2={first_name="乙" family_data={father=1}} 3={first_name="丙" family_data={father=1}}}
    landed_titles={11={key="k_song" holder=1 title_name_data={name="宋"}}}
    wars={active_wars={10={attacker={character=1} defender={character=2} start_date=1144.1.1}}}`);
  snapshot.parserOnlySecret = "not projected";
  return { checkpoint: { id: digest(`${campaign}|${date}|${snapshot.contentFingerprint}`).slice(0, 24), state: "ACTIVE", snapshot,
    source: { path: path.join(root, "autosave.ck3"), fingerprint: snapshot.contentFingerprint } },
    scope: { campaignId: `campaign_${digest(campaign)}`, branchId, state: "SAME_BRANCH" },
    parserComplete: true, pipelineState: "ACTIVE", freshness: "FRESH", sourceMatches: true };
}

(async () => {
  let service;
  try {
    const diagnostics = [];
    const store = new TemporalArchiveStore({ root: path.join(root, "worldline-v8.12"), onDiagnostic: item => diagnostics.push(item) });
    const first = fixture();
    const second = fixture("1146.1.1");
    assert.equal(store.commit(first).status, "COMMITTED");
    const index = new HistoricalCheckpointIndex(store.root, first.scope);
    const firstEntry = index.load().nodes[0];
    assert.equal(index.load().indexLayoutVersion, 2);
    assert.equal(firstEntry.characterIds, undefined, "new index nodes must not duplicate character IDs");
    assert.equal(firstEntry.titleIds, undefined, "new index nodes must not duplicate title IDs");
    assert.equal(firstEntry.warIds, undefined, "new index nodes must not duplicate war IDs");
    assert.equal(firstEntry.characterCount, 3);
    assert.equal(firstEntry.titleCount, 1);
    assert.equal(firstEntry.warCount, 1);
    const firstFile = path.join(index.directory, firstEntry.file);
    const firstBytes = fs.readFileSync(firstFile);
    assert.equal(firstBytes[0], 0x1f);
    assert.equal(firstBytes[1], 0x8b);
    assert.equal(store.commit(first).status, "IDEMPOTENT");
    assert.equal(index.load().nodes.length, 1);
    assert.equal(store.commit(second).nodeCount, 2);
    assert.deepEqual(fs.readFileSync(firstFile), firstBytes, "later nodes cannot rewrite history");
    assert.throws(() => store.commit(fixture("1145.1.1", "fixture", "revision")), /HISTORY_SAME_DATE_REVISION_CONFLICT/);
    const restarted = new TemporalArchiveStore({ root: store.root });
    const projection = restarted.read(first.scope, first.checkpoint.id);
    assert.equal(projection.characters[1].ageAtCheckpoint, 45);
    assert.deepEqual(projection.characters[2].siblingIds, ["3"]);
    assert.equal(projection.characters[1].location, "123");
    assert.equal(projection.titles[11].localizedName, "宋");
    assert.equal(projection.wars[10].attackerActors[0].runtimeId, "1");
    assert(!JSON.stringify(projection).includes("not projected"));
    assert.equal(index.find({ characterId: 1, limit: 1 }).length, 1);
    assert.equal(index.find({ gameDate: "1145.1.1" }).length, 1);
    assert(inspectTemporalArchive(restarted, first.scope).latestReadable);
    const otherCampaign = fixture("1145.1.1", "different");
    assert.equal(store.commit(otherCampaign).nodeCount, 1);
    assert.equal(store.read(otherCampaign.scope, second.checkpoint.id), null);
    const otherBranch = { ...first, scope: { ...first.scope, branchId: `branch_${crypto.randomUUID()}` } };
    assert.equal(store.commit(otherBranch).nodeCount, 1);
    assert.equal(new HistoricalCheckpointIndex(store.root, first.scope).load().nodes.length, 2);
    for (const patch of [{ parserComplete: false }, { pipelineState: "STALE" }, { freshness: "STALE" }, { sourceMatches: false }, { scope: { ...first.scope, state: "LOAD_BOUNDARY_CANDIDATE" } }, { scope: { ...first.scope, branchId: null } }]) {
      assert.throws(() => store.commit({ ...first, ...patch }), /HISTORY_/);
    }
    assert.throws(() => store.commit({ ...first, checkpoint: { ...first.checkpoint, source: { fingerprint: "a".repeat(64) } } }), /HISTORY_SOURCE_INVALID/);
    assert.throws(() => store.commit({ ...first, checkpoint: { ...first.checkpoint, snapshot: { ...first.checkpoint.snapshot, characters: {} } } }), /HISTORY_SNAPSHOT_INVALID/);
    assert.throws(() => boundedRead(firstFile, 1), /HISTORY_READ_BOUND_EXCEEDED/);
    // Node commit succeeds but index commit fails: no dangling index references;
    // retry adopts the identical orphan without replacing immutable bytes.
    const third = fixture("1147.1.1");
    const commitIndex = store.commitIndex;
    store.commitIndex = () => { throw new Error("disk_failure"); };
    assert.throws(() => store.commit(third), /disk_failure/);
    assert.equal(index.load().nodes.length, 2);
    store.commitIndex = commitIndex;
    assert.equal(store.commit(third).nodeCount, 3);
    const legacyIndex = JSON.parse(fs.readFileSync(index.file, "utf8"));
    delete legacyIndex.indexLayoutVersion;
    legacyIndex.nodes = legacyIndex.nodes.map(node => ({ ...node,
      characterIds: Array.from({ length: node.characterCount }, (_, i) => String(i + 1)),
      titleIds: Array.from({ length: node.titleCount }, (_, i) => String(i + 1)),
      warIds: Array.from({ length: node.warCount }, (_, i) => String(i + 1)) }));
    for (const node of legacyIndex.nodes) { delete node.characterCount; delete node.titleCount; delete node.warCount; }
    fs.writeFileSync(index.file, JSON.stringify(legacyIndex));
    const compatibleIndex = index.load();
    assert.equal(compatibleIndex.indexLayoutVersion, 2, "legacy array index must be normalized in memory");
    assert.equal(compatibleIndex.nodes[0].characterCount, 3);
    assert.equal(compatibleIndex.nodes[0].characterIds, undefined);
    assert.equal(store.commit(first).status, "IDEMPOTENT", "an idempotent capture may atomically migrate index.json only");
    const migratedPersisted = JSON.parse(fs.readFileSync(index.file, "utf8"));
    assert.equal(migratedPersisted.nodes[0].characterIds, undefined);
    const linearScope = { campaignId: `campaign_${"b".repeat(64)}`, branchId: `branch_${crypto.randomUUID()}` };
    const linearIndex = new HistoricalCheckpointIndex(path.join(root, "linear"), linearScope);
    fs.mkdirSync(linearIndex.directory, { recursive: true });
    const linearNodes = Array.from({ length: 120 }, (_, i) => {
      const gameDate = `${1145 + i}.1.1`;
      const date = normalizeGameDate(gameDate);
      const checkpointId = i.toString(16).padStart(24, "0");
      return { schemaVersion: 1, archiveRevision: 1, campaignId: linearScope.campaignId, branchId: linearScope.branchId, checkpointId, gameDate, totalDays: date.serial, year: date.year, playerId: "1", sourceFingerprint: "c".repeat(64), projectionKind: "HISTORICAL_CHECKPOINT", characterCount: 300000, titleCount: 100000, warCount: 20000, file: `${gameDate}_${checkpointId}.json.gz`, sha256: "d".repeat(64) };
    });
    fs.writeFileSync(linearIndex.file, JSON.stringify({ schemaVersion: 1, indexLayoutVersion: 2, ...linearScope, archiveRevision: linearNodes.length, migrationCompleted: true, nodes: linearNodes }));
    assert.equal(linearIndex.load().nodes.length, 120);
    assert(fs.statSync(linearIndex.file).size < 120 * 700, "compact index metadata must stay linear and bounded per node");
    fs.writeFileSync(firstFile, "corrupt fixture");
    assert.equal(store.read(first.scope, first.checkpoint.id), null);
    assert(diagnostics.some(item => item.code === "HISTORY_CHECKPOINT_CORRUPT"));
    assert(store.read(first.scope, second.checkpoint.id), "a damaged node must not hide a good one");
    assert.throws(() => store.commit(first), /HISTORY_CHECKPOINT_CORRUPT/);

    const settings = { autosavePath: first.checkpoint.source.path, autoWatchEnabled: false, lastValidationStatus: "VALID", subjectiveWorldMode: "PRODUCTION", promptIntegrationEnabled: true };
    service = new WorldlineService({ dataDir: path.join(root, "service"), settingsRepository: { getWorldlineSettings: () => settings, saveWorldlineSettings: value => Object.assign(settings, value) } });
    service.currentCheckpoint = second.checkpoint;
    service.buildState = "ACTIVE";
    service.getLiveState = () => ({ connected: false, gameDate: null, characters: [] });
    const realBranch = service.canon.branch.bind(service.canon);
    service.canon.branch = () => second.scope;
    service._persistCheckpoint();
    const oldBytes = fs.readFileSync(service.checkpointPath);
    const currentBefore = service.getPromptContext({ query: "现在有哪些战争" });
    assert(currentBefore);
    assert.equal((await service.runTemporalArchive({ operation: "capture" })).error, "HISTORY_DISABLED");
    assert.equal(service.setRecallSettings({ v812HistoricalPromptIntegration: true }).v812HistoricalPromptInjection, true);
    assert.throws(() => service.setRecallSettings({ v812TemporalArchiveShadowMode: false }), /shadow_required/);
    assert.equal(normalizeSettings({ v812HistoricalPromptIntegration: true }).v812HistoricalPromptIntegration, true);
    service.setRecallSettings({ v812TemporalArchiveEnabled: true });
    assert((await service.runTemporalArchive({ operation: "capture" })).success);
    assert((await service.runTemporalArchive({ operation: "inspect" })).latestReadable);
    const currentAfter = service.getPromptContext({ query: "现在有哪些战争" });
    for (const key of ["stableText", "currentText", "topicText", "supplementalText"]) assert.equal(currentAfter[key], currentBefore[key], key);
    assert.equal(typeof currentBefore.stableText, "string");
    assert.equal(typeof currentBefore.currentText, "string");
    assert.deepEqual(fs.readFileSync(service.checkpointPath), oldBytes, "legacy current checkpoint is never migrated away");
    const serviceIndex = new HistoricalCheckpointIndex(path.join(service.dataDir, "worldline-v8.12"), second.scope);
    fs.writeFileSync(path.join(serviceIndex.directory, serviceIndex.load().nodes[0].file), "broken shadow node");
    assert.equal((await service.runTemporalArchive({ operation: "capture" })).error, "HISTORY_CHECKPOINT_CORRUPT");
    assert.equal(service.buildState, "ACTIVE");
    assert.equal(service.lastError, null);
    assert.equal(service.getPromptContext({ query: "现在有哪些战争" }).topicText, currentBefore.topicText);
    fs.writeFileSync(path.join(serviceIndex.directory, serviceIndex.load().nodes[0].file), fs.readFileSync(path.join(index.directory, index.load().nodes.find(node => node.checkpointId === second.checkpoint.id).file)));
    service.setRecallSettings({ v812TemporalArchiveEnabled: false });
    assert.equal((await service.runTemporalArchive({ operation: "capture" })).error, "HISTORY_DISABLED");
    assert((await service.runTemporalArchive({ operation: "inspect" })).latestReadable, "disable preserves archive");
    const validIndexBytes = fs.readFileSync(index.file);
    fs.writeFileSync(index.file, "bad index");
    assert.equal(store.read(first.scope, second.checkpoint.id), null);
    assert(diagnostics.some(item => item.code === "HISTORY_INDEX_CORRUPT"));
    assert.throws(() => store.commit(fixture("1148.1.1")), /HISTORY_INDEX_CORRUPT/);
    assert.equal(fs.readFileSync(index.file, "utf8"), "bad index", "never replace corrupt indexes with empty history");
    fs.writeFileSync(index.file, validIndexBytes);
    // Real parser -> legacy checkpoint -> existing BranchRegistry -> archive
    // hook, followed by a restart. The save is entirely synthetic.
    fs.writeFileSync(settings.autosavePath, 'SAV0100abcdefgh00000000\ndate=1149.1.1 playthrough_id="fixture" played_character=1 living={1={first_name="甲" birth=1100.1.1}}');
    service.canon.branch = realBranch;
    service.stabilityDelayMs = 1;
    service.setRecallSettings({ v812TemporalArchiveEnabled: true });
    assert((await service.rebuildCheckpoint()).success);
    assert.equal(service.archiveResult.status, "COMMITTED");
    const realScope = service.canon.branch();
    const realIndex = new HistoricalCheckpointIndex(path.join(service.dataDir, "worldline-v8.12"), realScope);
    assert.equal(realIndex.load().nodes.length, 1);
    const restartedDataDir = service.dataDir;
    service.dispose();
    service = new WorldlineService({ dataDir: restartedDataDir, stabilityDelayMs: 1, settingsRepository: { getWorldlineSettings: () => settings, saveWorldlineSettings: value => Object.assign(settings, value) } });
    assert.equal(service.buildState, "STALE", "startup does not pretend the old checkpoint was just parsed");
    assert.equal((await service.runTemporalArchive({ operation: "capture" })).error, "HISTORY_CHECKPOINT_INELIGIBLE");
    assert((await service.start()).success);
    assert.equal(service.archiveResult.status, "IDEMPOTENT");
    const lock = path.join(realIndex.directory, "commit.lock");
    fs.writeFileSync(lock, "synthetic busy writer");
    assert((await service.rebuildCheckpoint()).success, "shadow writer failure cannot fail current checkpoint rebuild");
    assert.equal(service.archiveResult.success, false);
    assert.equal(service.buildState, "ACTIVE");
    fs.unlinkSync(lock);
    console.log("V8.12 Temporal Archive: PASS (gzip, immutable/idempotent, isolation, restart, corruption, atomic index, shadow integration)");
  } finally { service?.dispose(); fs.rmSync(root, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
