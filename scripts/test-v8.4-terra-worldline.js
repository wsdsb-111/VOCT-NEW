"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const zlib = require("zlib");
const { readSaveContainer } = require("../resources/app/out/main/worldline/save-container");
const { WorldlineService } = require("../resources/app/out/main/worldline/worldline-service");

const root = path.resolve(__dirname, "..");
const worldlineServiceSource = fs.readFileSync(path.join(root, "resources", "app", "out", "main", "worldline", "worldline-service.js"), "utf8");
const ipcSource = fs.readFileSync(path.join(root, "resources", "app", "out", "main", "ipc", "register-ipc.js"), "utf8");
const preloadSource = fs.readFileSync(path.join(root, "resources", "app", "out", "preload", "preload.js"), "utf8");
const promptSource = fs.readFileSync(path.join(root, "resources", "app", "out", "main", "prompts", "prompt-builder.js"), "utf8");

function makeSave(kind, gamestate, metadata = "meta_date=1154.1.1\nversion=\"fixture\"\n") {
  const metadataBuffer = Buffer.from(metadata, "utf8");
  const header = Buffer.from(`SAV01${kind.toString(16).padStart(2, "0")}RANDOM01${metadataBuffer.length.toString(16).padStart(8, "0")}\n`, "ascii");
  return Buffer.concat([header, metadataBuffer, Buffer.isBuffer(gamestate) ? gamestate : Buffer.from(gamestate, "utf8")]);
}

function zipGamestate(text) {
  const name = Buffer.from("gamestate", "utf8");
  const payload = Buffer.from(text, "utf8");
  const compressed = zlib.deflateRawSync(payload);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(compressed.length, 18);
  local.writeUInt32LE(payload.length, 22);
  local.writeUInt16LE(name.length, 26);
  const centralOffset = local.length + name.length + compressed.length;
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(compressed.length, 20);
  central.writeUInt32LE(payload.length, 24);
  central.writeUInt16LE(name.length, 28);
  central.writeUInt32LE(0, 42);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + name.length, 12);
  end.writeUInt32LE(centralOffset, 16);
  return Buffer.concat([local, name, compressed, central, name, end]);
}

function gamestate(date, { yuefeiAlive = true, includeOldWar = true, includeNewWar = false, titleHolder = "100" } = {}) {
  return `date=${date}
playthrough_id=fixture_campaign
played_character={ character=100 }
living={
  100={ first_name=Yuefei family_data={ child={ 102 } } alive_data={ location={ location=8841 } } landed_data={ domain={ 500 } } }
  ${yuefeiAlive ? "101={ first_name=HanShizhong alive_data={ location={ location=8841 } } }" : ""}
}
dead_unprunable={ ${yuefeiAlive ? "" : "101={ first_name=HanShizhong dead_data={ date=1155.1.1 reason=natural } }"} }
characters={ dead_prunable={} }
character_lookup={ nansong_yue_085=100 nansong_han_001=101 }
landed_titles={ landed_titles={ 500={ key=c_fixture holder=${titleHolder} date=${date} history={ 1154.1.1={ type=appointment holder=100 } 1155.1.1={ type=appointment_succession holder=${titleHolder} } } } } }
wars={ active_wars={ ${includeOldWar ? "900={ attacker=100 defender=101 start_date=1153.4.15 casus_belli=fixture_cb }" : ""} ${includeNewWar ? "901={ attacker=100 defender=102 start_date=1155.1.1 casus_belli=fixture_cb }" : ""} } }
`;
}

class SettingsRepositoryFixture {
  constructor() {
    this.settings = { autosavePath: null, autoWatchEnabled: false, lastValidatedAt: null, lastValidationStatus: "UNCONFIGURED" };
  }
  getWorldlineSettings() { return this.settings; }
  saveWorldlineSettings(settings) { this.settings = settings; }
  getCK3DebugLogPath() { return null; }
}

async function run() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v84-terra-"));
  try {
    const autosavePath = path.join(tempRoot, "autosave.ck3");
    fs.writeFileSync(autosavePath, makeSave(0, gamestate("1154.1.1")));
    const plain = readSaveContainer(autosavePath);
    assert.equal(plain.containerKind, "PLAIN_TEXT_SAVE", "plain-text save must be detected");
    assert.match(plain.gamestate.toString("utf8"), /fixture_campaign/, "plain-text gamestate must be extracted");

    const zippedPath = path.join(tempRoot, "autosave_zip.ck3");
    fs.writeFileSync(zippedPath, makeSave(2, zipGamestate(gamestate("1154.1.1"))));
    const zipped = readSaveContainer(zippedPath);
    assert.equal(zipped.containerKind, "UNIFIED_TEXT_ZIP", "unified zip save must be detected");
    assert.match(zipped.gamestate.toString("utf8"), /date=1154.1.1/, "zip gamestate must be extracted");

    const settingsRepository = new SettingsRepositoryFixture();
    const service = new WorldlineService({ settingsRepository, dataDir: tempRoot, stabilityDelayMs: 0 });
    service.setAutosavePath(autosavePath);
    assert.equal(service.validateAutosavePath().validationStatus, "VALID", "autosave.ck3 must validate for automatic watch");
    const firstBuild = await service.rebuildCheckpoint();
    assert.equal(firstBuild.success, true, "first checkpoint must build in a worker");
    const firstStatus = service.getCheckpointStatus().checkpoint;
    assert.equal(firstStatus.status, "ACTIVE", "successful build must atomically activate checkpoint");
    assert.equal(firstStatus.characters, 2, "character buckets must be indexed without an AST");
    assert.equal(firstStatus.historicalBindings, 2, "lookup must expose direct historical bindings");
    assert.equal(service.getHistoricalBindings().bindings[0].status, "DIRECT", "unprobed bindings remain direct rather than guessed");
    const largeDefinitions = {};
    for (let index = 0; index < 100000; index += 1) largeDefinitions[`fixture_${index}`] = index;
    service.currentCheckpoint.snapshot.definitionToRuntime = largeDefinitions;
    service.currentCheckpoint.snapshot.runtimeToDefinitions = {};
    const largeBindings = service.getHistoricalBindings();
    assert.equal(largeBindings.total, 100000, "historical binding totals must include every definition without sorting the checkpoint");
    assert.equal(largeBindings.bindings.length, 500, "historical binding UI payload must remain bounded for large checkpoints");
    assert.equal(largeBindings.truncated, true, "large historical binding payloads must report truncation");
    const historicalBindingsMethod = worldlineServiceSource.slice(worldlineServiceSource.indexOf("  getHistoricalBindings()"), worldlineServiceSource.indexOf("  listSupplemental()"));
    assert.ok(!historicalBindingsMethod.includes(".sort("), "historical binding UI loading must never sort the full checkpoint on the main process");
    assert.ok(!historicalBindingsMethod.includes("Object.entries("), "historical binding UI loading must not materialize the full checkpoint before truncation");
    await service.rebuildCheckpoint();
    assert.equal(service.getPromptContext({ query: "Yuefei" }), null, "world prompt integration must remain opt-in during Terra");
    settingsRepository.settings = { ...settingsRepository.settings, promptIntegrationEnabled: true };
    const worldContext = service.getPromptContext({ query: "Yuefei" });
    assert.match(worldContext.stableText, /已确认 Checkpoint/, "enabled world recall must expose stable checkpoint facts");
    assert.match(worldContext.topicText, /Yuefei/, "world topic recall must use the existing turn query");
    assert.match(worldContext.currentText, /当前世界视图/, "current world view must be isolated from stable recall");
    assert.equal(service.getPromptContext({ query: "Yuefei" }).cacheHit, true, "world topic recall must be checkpoint/query cached");
    settingsRepository.settings = { ...settingsRepository.settings, promptIntegrationEnabled: false };

    fs.writeFileSync(autosavePath, makeSave(0, gamestate("1155.1.1", { yuefeiAlive: false, includeOldWar: false, includeNewWar: true, titleHolder: "102" })));
    const secondBuild = await service.rebuildCheckpoint();
    assert.equal(secondBuild.success, true, "replacement autosave must rebuild");
    const delta = service.getAnnualDelta().annualDelta;
    assert.ok(delta.some((entry) => entry.type === "IMPORTANT_CHARACTER_DIED" && entry.source === "GAMESTATE"), "death must reconcile from game truth");
    assert.ok(delta.some((entry) => entry.type === "WAR_STARTED" && entry.reconciliationStatus === "CONFIRMED_BY_GAMESTATE"), "dated war start must reconcile from game truth");
    assert.ok(delta.some((entry) => entry.type === "WAR_ENDED" && entry.source === "SUPPLEMENTAL"), "missing active war must not be fabricated as game truth");
    assert.ok(delta.some((entry) => entry.type === "TITLE_HOLDER_CHANGED" && entry.source === "GAMESTATE"), "dated title history must reconcile from game truth");

    const supplemental = service.createSupplemental({ title: "Player canon", body: "The court received a private letter.", visibility: "PERSONAL", importance: "HIGH" }).supplemental;
    assert.equal(service.listSupplemental().supplemental.length, 1, "supplemental entry must be checkpoint-scoped");
    assert.equal(service.updateSupplemental(supplemental.id, { title: "Revised canon", body: "The court received a sealed letter.", visibility: "PERSONAL", importance: "HIGH" }).supplemental.title, "Revised canon", "supplemental entry must be editable");
    assert.equal(service.deleteSupplemental(supplemental.id).success, true, "supplemental entry must be removable");

    const activeCheckpointId = service.getCheckpointStatus().checkpoint.id;
    fs.writeFileSync(autosavePath, Buffer.from("not a save", "utf8"));
    const failedBuild = await service.rebuildCheckpoint();
    assert.equal(failedBuild.success, false, "invalid replacement must fail closed");
    assert.equal(service.getCheckpointStatus().checkpoint.id, activeCheckpointId, "failed rebuild must preserve the prior active checkpoint");

    service.setAutosavePath(zippedPath);
    const manualValidation = service.validateAutosavePath();
    assert.equal(manualValidation.validationStatus, "NOT_AUTOSAVE", "non-autosave CK3 files are diagnostic-only");
    assert.equal(manualValidation.manualDiagnostic, true, "manual diagnostic state must be explicit");
    service.dispose();
    for (const method of ["getSettings", "setAutosavePath", "validateAutosavePath", "selectAutosaveFile", "getCheckpointStatus", "rebuildCheckpoint", "getOverview", "getAnnualDelta", "getWorldKnowledge", "getHistoricalBindings", "getDiagnostics", "listSupplemental", "createSupplemental", "updateSupplemental", "deleteSupplemental"]) {
      assert.ok(ipcSource.includes(`worldline:${method}`), `main IPC must register ${method}`);
      assert.ok(preloadSource.includes(`worldline:${method}`), `preload must expose ${method}`);
    }
    assert.ok(promptSource.includes("worldline-stable"), "PromptBuilder must have a cache-stable world block");
    assert.ok(promptSource.includes("worldline-current"), "PromptBuilder must have a current-world block");
    console.log("V8.4 Terra Worldline: PASS");
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
