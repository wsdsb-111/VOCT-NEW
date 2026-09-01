"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { readSavePreamble } = require("../resources/app/out/main/worldline/save-container");
const { WorldlineService, readLiveProbe } = require("../resources/app/out/main/worldline/worldline-service");

const root = path.resolve(__dirname, "..");
const serviceSource = fs.readFileSync(path.join(root, "resources", "app", "out", "main", "worldline", "worldline-service.js"), "utf8");
const workerSource = fs.readFileSync(path.join(root, "resources", "app", "out", "main", "worldline", "parser-worker.js"), "utf8");
const promptSource = fs.readFileSync(path.join(root, "resources", "app", "out", "main", "prompts", "prompt-builder.js"), "utf8");
const ipcSource = fs.readFileSync(path.join(root, "resources", "app", "out", "main", "ipc", "register-ipc.js"), "utf8");
const preloadSource = fs.readFileSync(path.join(root, "resources", "app", "out", "preload", "preload.js"), "utf8");
const rendererSource = fs.readFileSync(path.join(root, "resources", "app", "out", "renderer", "assets", "index-Dn3qWlAB.js"), "utf8");

function makeSave(kind, gamestate, metadata = "meta_date=1154.1.1\nversion=\"fixture\"\n") {
  const metadataBuffer = Buffer.from(metadata, "utf8");
  const header = Buffer.from(`SAV01${kind.toString(16).padStart(2, "0")}RANDOM01${metadataBuffer.length.toString(16).padStart(8, "0")}\n`, "ascii");
  return Buffer.concat([header, metadataBuffer, Buffer.from(gamestate, "utf8")]);
}

function gamestate(campaign, date, { allyAlive = true, playerName = "Yuefei" } = {}) {
  return `date=${date}
playthrough_id=${campaign}
played_character={ character=100 }
living={
  100={ first_name=${playerName} alive_data={ location={ location=8841 } } }
  ${allyAlive ? "101={ first_name=HanShizhong alive_data={ location={ location=8841 } } }" : ""}
}
dead_unprunable={ ${allyAlive ? "" : `101={ first_name=HanShizhong dead_data={ date=${date} reason=natural } }`} }
characters={ dead_prunable={} }
character_lookup={ definition_a=100 definition_b=100 definition_ally=101 }
landed_titles={ landed_titles={ 500={ key=c_fixture holder=100 date=${date} history={} } } }
wars={ active_wars={} }
`;
}

class SettingsFixture {
  constructor(debugLogPath = null, ck3Folder = null) {
    this.debugLogPath = debugLogPath;
    this.ck3Folder = ck3Folder;
    this.settings = { autosavePath: null, autoWatchEnabled: false, promptIntegrationEnabled: false, lastValidatedAt: null, lastValidationStatus: "UNCONFIGURED" };
  }
  getWorldlineSettings() { return this.settings; }
  saveWorldlineSettings(settings) { this.settings = settings; }
  getCK3DebugLogPath() { return this.debugLogPath; }
  getCK3UserFolderPath() { return this.ck3Folder; }
}

async function run() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v84-sol-"));
  try {
    const saveDir = path.join(tempRoot, "save-games");
    fs.mkdirSync(saveDir, { recursive: true });
    const autosavePath = path.join(saveDir, "autosave.ck3");
    fs.writeFileSync(autosavePath, makeSave(0, gamestate("campaign_a", "1154.1.1")));

    const boundedFs = {
      statSync: fs.statSync,
      openSync: fs.openSync,
      readSync: fs.readSync,
      closeSync: fs.closeSync,
      readFileSync() { throw new Error("full_file_read_forbidden"); }
    };
    const preamble = readSavePreamble(autosavePath, { fs: boundedFs });
    assert.equal(preamble.containerKind, "PLAIN_TEXT_SAVE", "main-process validation must use bounded reads only");

    const automaticFolder = path.join(tempRoot, "automatic-ck3");
    const automaticSaveDir = path.join(automaticFolder, "save games");
    fs.mkdirSync(automaticSaveDir, { recursive: true });
    const automaticSave = path.join(automaticSaveDir, "autosave.ck3");
    fs.writeFileSync(automaticSave, makeSave(0, gamestate("automatic_campaign", "1154.1.1")));
    const automaticSettings = new SettingsFixture(null, automaticFolder);
    const automaticService = new WorldlineService({ settingsRepository: automaticSettings, dataDir: path.join(tempRoot, "automatic-runtime"), stabilityDelayMs: 0 });
    const stateEvents = [];
    automaticService.setStateListener((event) => stateEvents.push(event.reason));
    assert.equal((await automaticService.start()).success, true, "startup must auto-discover and build CK3 save games/autosave.ck3");
    assert.equal(automaticService.getSettings().autosavePath, automaticSave, "auto-discovered autosave must populate the UI settings source");
    assert.equal(automaticService.getCheckpointStatus().checkpoint.status, "ACTIVE", "auto-discovered source must complete the worker pipeline");
    assert.ok(stateEvents.includes("checkpoint_building") && stateEvents.includes("checkpoint_active"), "worker state changes must be emitted for Renderer refresh");
    automaticService.dispose();

    const unsupportedPath = path.join(saveDir, "manual.ck3");
    fs.writeFileSync(unsupportedPath, makeSave(4, gamestate("campaign_a", "1154.1.1")));
    const unsupportedSettings = new SettingsFixture();
    const unsupportedService = new WorldlineService({ settingsRepository: unsupportedSettings, dataDir: path.join(tempRoot, "unsupported"), stabilityDelayMs: 0 });
    unsupportedService.setAutosavePath(unsupportedPath);
    assert.equal(unsupportedService.validateAutosavePath().validationStatus, "UNSUPPORTED_CONTAINER", "split or unknown save containers must fail closed");
    unsupportedService.dispose();

    const debugLogPath = path.join(tempRoot, "debug.log");
    fs.writeFileSync(debugLogPath, "ordinary CK3 log line\n", "utf8");
    assert.equal(readLiveProbe({ fs, debugLogPath }).connected, false, "an existing log without VOTC markers is not a live connection");
    fs.appendFileSync(debugLogPath, "VOTC:TEST_DATE/;/1154.1.1/;/days=421000\nVOTC:TEST_CHAR/;/runtime=100/;/history=definition_a/;/date=1154.1.1\n", "utf8");
    const live = readLiveProbe({ fs, debugLogPath });
    assert.equal(live.connected, true, "VOTC probes must establish live connectivity");
    assert.equal(live.gameDate, "1154.1.1", "TEST_CHAR without optional days must still parse the game date");
    assert.equal(live.totalDays, 421000, "TEST_DATE must provide the live total-days fallback");

    const settings = new SettingsFixture(debugLogPath);
    const service = new WorldlineService({ settingsRepository: settings, dataDir: path.join(tempRoot, "runtime"), stabilityDelayMs: 0 });
    service.setAutosavePath(autosavePath);
    assert.equal(service.validateAutosavePath().validationStatus, "VALID", "only autosave.ck3 is eligible for automatic checkpoints");
    assert.equal((await service.rebuildCheckpoint()).success, true, "Sol fixture checkpoint must build");
    const firstId = service.currentCheckpoint.id;
    assert.ok(service.lastObservedFile, "a successful build must seed the watcher fingerprint and avoid an immediate duplicate parse");
    const liveEvents = [];
    service.setStateListener((event) => liveEvents.push(event.reason));
    fs.appendFileSync(debugLogPath, "VOTC:TEST_DATE/;/1154.1.2/;/days=421001\n", "utf8");
    service._scheduleRefresh();
    await new Promise((resolve) => setTimeout(resolve, 650));
    assert.ok(liveEvents.includes("live_updated"), "debug.log changes must refresh Renderer state without requiring a save rebuild");
    assert.equal(service.getLiveState().gameDate, "1154.1.2", "the latest log marker must win over an older TEST_CHAR date");
    assert.equal(service.currentCheckpoint.id, firstId, "a Live-only update must not rebuild an unchanged autosave");
    const bindings = service.getHistoricalBindings().bindings.filter((item) => item.runtimeId === "100");
    assert.ok(bindings.length === 2 && bindings.every((item) => item.status === "AMBIGUOUS_PROVENANCE"), "multiple definitions for one runtime ID must remain ambiguous");

    fs.writeFileSync(autosavePath, makeSave(0, gamestate("campaign_a", "1154.1.1", { playerName: "Yuexie" })));
    assert.equal((await service.rebuildCheckpoint()).success, true, "same-size middle-content changes must rebuild");
    assert.notEqual(service.currentCheckpoint.id, firstId, "checkpoint fingerprint must cover the complete gamestate");

    fs.writeFileSync(autosavePath, makeSave(0, gamestate("campaign_a", "1155.1.1", { allyAlive: false })));
    const checkpointBeforeFailure = service.currentCheckpoint;
    const deltaBeforeFailure = service.annualDelta.slice();
    const persistCheckpoint = service._persistCheckpoint.bind(service);
    service._persistCheckpoint = () => { throw new Error("fixture_checkpoint_write_failed"); };
    assert.equal((await service.rebuildCheckpoint()).success, false, "checkpoint write failure must fail closed");
    assert.equal(service.currentCheckpoint.id, checkpointBeforeFailure.id, "failed checkpoint persistence must preserve active memory state");
    assert.deepEqual(service.annualDelta, deltaBeforeFailure, "failed checkpoint persistence must preserve Delta memory state");
    service._persistCheckpoint = persistCheckpoint;
    assert.equal((await service.rebuildCheckpoint()).success, true, "checkpoint may activate after durable persistence succeeds");
    assert.ok(service.getAnnualDelta().annualDelta.some((item) => item.type === "IMPORTANT_CHARACTER_DIED"), "same-campaign annual changes must be retained");

    settings.settings = { ...settings.settings, promptIntegrationEnabled: true };
    const created = service.createSupplemental({ title: "Moon treaty", body: "The moon treaty is publicly proclaimed.", visibility: "PUBLIC_WORLD", importance: "HIGH" }).supplemental;
    assert.match(service.getPromptContext({ query: "moon treaty" }).supplementalText, /Moon treaty/, "visible public Supplemental knowledge may be recalled");
    service.updateSupplemental(created.id, { ...created, hidden: true });
    assert.equal(service.getPromptContext({ query: "moon treaty" }).supplementalText, null, "hidden Supplemental knowledge must be excluded immediately");
    const persistedSupplemental = JSON.parse(fs.readFileSync(service.supplementalPath, "utf8"));
    assert.equal(persistedSupplemental.entries[0].hidden, true, "hidden state must be persisted");

    const supplementalBeforeFailure = service.listSupplemental().supplemental;
    const persistSupplemental = service._persistSupplemental.bind(service);
    service._persistSupplemental = () => { throw new Error("fixture_supplemental_write_failed"); };
    assert.throws(() => service.createSupplemental({ title: "Rejected", body: "This write must not enter memory.", visibility: "PUBLIC_WORLD", importance: "NORMAL" }), /fixture_supplemental_write_failed/);
    assert.deepEqual(service.listSupplemental().supplemental, supplementalBeforeFailure, "failed Supplemental persistence must not mutate memory state");
    service._persistSupplemental = persistSupplemental;

    const deltaCountBeforeBranch = service.annualDelta.length;
    fs.writeFileSync(autosavePath, makeSave(0, gamestate("campaign_b", "1156.1.1", { allyAlive: true })));
    assert.equal((await service.rebuildCheckpoint()).success, true, "a new campaign may establish its own checkpoint");
    assert.equal(service.annualDelta.length, deltaCountBeforeBranch, "cross-campaign checkpoints must never generate a Delta");
    assert.equal(service.getAnnualDelta().annualDelta.length, 0, "old-campaign Delta must not leak into the current branch view");

    const manualPath = path.join(saveDir, "manual-supported.ck3");
    fs.writeFileSync(manualPath, makeSave(0, gamestate("campaign_manual", "1157.1.1")));
    service.setAutosavePath(manualPath);
    const manualValidation = service.validateAutosavePath();
    assert.equal(manualValidation.manualDiagnostic, true, "other CK3 files are manual diagnostics only");
    assert.equal((await service.rebuildCheckpoint()).success, true, "supported manual saves may be parsed diagnostically");
    assert.equal(service.getPromptContext({ query: "Yuefei" }), null, "manual diagnostic saves must never enter production prompts");
    service.dispose();

    assert.match(workerSource, /save_changed_during_parse/, "worker must reject a save that changes during parsing");
    assert.match(workerSource, /gamestate_index_bounds_exceeded/, "worker must bound indexed snapshot memory");
    assert.doesNotMatch(serviceSource, /readFileSync\(target\)/, "main-process validation must not read the full save");
    assert.ok(promptSource.indexOf("if (memoryContext?.worldStableText)") < promptSource.indexOf("if (memoryContext?.topicPatchText)"), "stable Game Truth must precede personal topic patches");
    assert.ok(promptSource.indexOf("if (options.worldTopicText)") < promptSource.indexOf("if (options.worldSupplementalText)"), "Game Truth topic facts must precede Supplemental knowledge");
    assert.ok(promptSource.indexOf("if (options.worldSupplementalText)") < promptSource.indexOf("if (options.worldCurrentText)"), "world layers must retain explicit source separation");
    assert.ok(promptSource.indexOf("if (options.worldCurrentText)") < promptSource.indexOf("\n          appendPriorHistory();"), "current world context must be placed before conversation history");
    assert.ok(promptSource.indexOf("if (currentUserMessage)") < promptSource.indexOf("if (options.turnRecallText)"), "V7 current-user then Turn Recall compatibility must remain frozen");
    assert.match(rendererSource, /invoke\("updateSupplemental", id, \{ \.\.\.current, hidden: !current\.hidden \}\)/, "hide/show must persist through main IPC");
    assert.match(rendererSource, /if \(!result\) return;/, "failed Supplemental writes must not clear or falsify the editor state");
    assert.match(ipcSource, /syncAutosaveFromCK3Folder/, "changing the CK3 user folder must synchronize the managed autosave source");
    assert.match(ipcSource, /worldline:updated/, "main IPC must publish worldline state changes");
    assert.match(preloadSource, /onUpdated/, "Preload must expose a removable worldline update subscription");
    assert.match(rendererSource, /onUpdated\?\.\(\(\) => refresh\(\)\)/, "Renderer must refresh from backend state events");
    assert.match(rendererSource, /validation\.validationStatus === "VALID"\) await invoke\("rebuildCheckpoint"\)/, "successful path validation must immediately build the checkpoint");
    console.log("V8.4 Sol freeze review: PASS");
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
