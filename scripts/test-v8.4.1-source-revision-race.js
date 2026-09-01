"use strict";

const assert = require("assert");
const { EventEmitter } = require("events");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { WorldlineService } = require("../resources/app/out/main/worldline/worldline-service");

function makeSave() {
  const metadata = Buffer.from("meta_date=1155.1.1\n", "utf8");
  const header = Buffer.from(`SAV0100RANDOM01${metadata.length.toString(16).padStart(8, "0")}\n`, "ascii");
  return Buffer.concat([header, metadata, Buffer.from("date=1155.1.1\nplaythrough_id=fixture\n", "utf8")]);
}

function makeSnapshot(sourceTag) {
  return {
    gameDate: "1155.1.1",
    playthroughId: `campaign_${sourceTag}`,
    contentFingerprint: `fingerprint_${sourceTag}`,
    playerId: "100",
    characters: { "100": { id: "100", firstName: "Player", domainTitles: [] } },
    titles: {},
    wars: {},
    definitionToRuntime: {},
    runtimeToDefinitions: {},
    diagnostics: { characterCount: 1, titleCount: 0, activeWarCount: 0 }
  };
}

class SettingsFixture {
  constructor() {
    this.settings = { autosavePath: null, autoWatchEnabled: false, promptIntegrationEnabled: false, lastValidatedAt: null, lastValidationStatus: "UNCONFIGURED" };
  }
  getWorldlineSettings() { return this.settings; }
  saveWorldlineSettings(settings) { this.settings = settings; }
  getCK3DebugLogPath() { return null; }
}

class DeferredWorker extends EventEmitter {
  static instances = [];
  constructor(_workerPath, options) {
    super();
    this.savePath = options.workerData.savePath;
    DeferredWorker.instances.push(this);
  }
  terminate() { return Promise.resolve(0); }
  complete(snapshot) {
    this.emit("message", {
      success: true,
      source: { path: this.savePath, fileSize: 1, modifiedAt: "2026-01-01T00:00:00.000Z", container: "PLAIN_TEXT_SAVE", metadata: {} },
      snapshot,
      diagnostics: { parseDurationMs: 1, totalDurationMs: 1 }
    });
  }
  fail(error = new Error("worker failure")) { this.emit("error", error); }
}

async function waitForWorker(count) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (DeferredWorker.instances.length >= count) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`worker_${count}_not_started`);
}

async function run() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v841-race-"));
  try {
    const sourceA = path.join(tempRoot, "source-a", "autosave.ck3");
    const sourceB = path.join(tempRoot, "source-b", "autosave.ck3");
    fs.mkdirSync(path.dirname(sourceA), { recursive: true });
    fs.mkdirSync(path.dirname(sourceB), { recursive: true });
    fs.writeFileSync(sourceA, makeSave());
    fs.writeFileSync(sourceB, makeSave());
    const service = new WorldlineService({ settingsRepository: new SettingsFixture(), dataDir: path.join(tempRoot, "data"), Worker: DeferredWorker, stabilityDelayMs: 0 });

    service.setAutosavePath(sourceA);
    const buildA = service.rebuildCheckpoint();
    await waitForWorker(1);

    service.setAutosavePath(sourceB);
    const buildB = service.rebuildCheckpoint();
    await waitForWorker(2);
    DeferredWorker.instances[0].complete(makeSnapshot("a"));
    const resultA = await buildA;
    assert.equal(resultA.error, "worldline_build_superseded", "an old source worker must be marked superseded");
    assert.equal(service.currentCheckpoint, null, "a superseded worker that finishes first must not activate an old checkpoint");
    assert.equal(fs.existsSync(service.checkpointPath), false, "a superseded worker that finishes first must not write durable state");

    DeferredWorker.instances[1].complete(makeSnapshot("b"));
    const resultB = await buildB;
    assert.equal(resultB.success, true, "the current source build must activate");
    assert.equal(service.currentCheckpoint.source.path, sourceB, "source B must own the active checkpoint");
    const persisted = JSON.parse(fs.readFileSync(service.checkpointPath, "utf8"));
    assert.equal(persisted.currentCheckpoint.source.path, sourceB, "a superseded worker must not overwrite durable active state");
    service.dispose();

    DeferredWorker.instances = [];
    const failureService = new WorldlineService({ settingsRepository: new SettingsFixture(), dataDir: path.join(tempRoot, "failure-data"), Worker: DeferredWorker, stabilityDelayMs: 0 });
    failureService.setAutosavePath(sourceA);
    const failedBuildA = failureService.rebuildCheckpoint();
    await waitForWorker(1);
    failureService.setAutosavePath(sourceB);
    const activeBuildB = failureService.rebuildCheckpoint();
    await waitForWorker(2);
    DeferredWorker.instances[1].complete(makeSnapshot("b-active"));
    assert.equal((await activeBuildB).success, true, "the replacement source must become active before the old worker fails");
    const activeCheckpointId = failureService.currentCheckpoint.id;
    const stateChanges = [];
    failureService.setStateListener((event) => stateChanges.push(event.reason));
    DeferredWorker.instances[0].fail(new Error("old source parse failure"));
    const failedResultA = await failedBuildA;
    assert.equal(failedResultA.error, "worldline_build_superseded", "an old worker failure must be classified as superseded");
    assert.equal(failureService.currentCheckpoint.id, activeCheckpointId, "an old worker failure must not replace the active checkpoint");
    assert.equal(failureService.buildState, "ACTIVE", "an old worker failure must not downgrade the current source state");
    assert.equal(failureService.lastError, null, "an old worker failure must not replace the current source error state");
    assert.deepEqual(stateChanges, [], "an old worker failure must not emit a current-source failure notification");
    failureService.dispose();

    console.log("V8.4.1 Source Revision Race: PASS (superseded success/failure cannot activate, persist or downgrade old-source state)");
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
