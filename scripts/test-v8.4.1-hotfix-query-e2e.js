"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { WorldlineService } = require("../resources/app/out/main/worldline/worldline-service");

class SettingsFixture {
  constructor(autosavePath, userFolder) {
    this.settings = { autosavePath, autoWatchEnabled: false, promptIntegrationEnabled: false, lastValidatedAt: "fixture", lastValidationStatus: "VALID" };
    this.userFolder = userFolder;
  }
  getWorldlineSettings() { return this.settings; }
  saveWorldlineSettings(settings) { this.settings = settings; }
  getCK3DebugLogPath() { return null; }
  getCK3UserFolderPath() { return this.userFolder; }
}

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v841-hotfix-e2e-"));
try {
  const userFolder = path.join(tempRoot, "Documents", "Paradox Interactive", "Crusader Kings III");
  const steamapps = path.join(tempRoot, "SteamLibrary", "steamapps");
  const baseGameRoot = path.join(steamapps, "common", "Crusader Kings III", "game");
  const modRoot = path.join(steamapps, "workshop", "content", "1158310", "42");
  const localizationPath = path.join(modRoot, "localization", "simp_chinese", "nansong_l_simp_chinese.yml");
  fs.mkdirSync(path.dirname(localizationPath), { recursive: true });
  fs.mkdirSync(path.join(baseGameRoot, "localization", "simp_chinese"), { recursive: true });
  fs.writeFileSync(localizationPath, "\uFEFFl_simp_chinese:\n Yuefei_name:0 \"岳飞\"\n", "utf8");
  const descriptorPath = path.join(userFolder, "mod", "ugc_42.mod");
  fs.mkdirSync(path.dirname(descriptorPath), { recursive: true });
  fs.writeFileSync(descriptorPath, `path="${modRoot.replaceAll("\\", "/")}"\nremote_file_id="42"\n`, "utf8");
  fs.writeFileSync(path.join(userFolder, "dlc_load.json"), JSON.stringify({ enabled_mods: ["mod/ugc_42.mod"] }), "utf8");
  const autosavePath = path.join(tempRoot, "autosave.ck3");
  fs.writeFileSync(autosavePath, "fixture", "utf8");

  const service = new WorldlineService({ settingsRepository: new SettingsFixture(autosavePath, userFolder), dataDir: tempRoot, stabilityDelayMs: 0 });
  service.currentCheckpoint = {
    id: "fixture-checkpoint",
    source: { path: autosavePath },
    snapshot: {
      gameDate: "1155.1.1", playerId: "100", playthroughId: "fixture", diagnostics: { characterCount: 2, activeWarCount: 0 },
      characters: { "100": { id: "100", firstName: "Player", alive: true }, "96896": { id: "96896", firstName: "Yuefei_name", fullName: "岳飞", alive: true, location: "kaifeng" } },
      nameToCharacterIds: { player: ["100"], yuefei_name: ["96896"] },
      definitionToRuntime: { nansong_yue_085: "96896" }, runtimeToDefinitions: { "96896": ["nansong_yue_085"] }, titles: {}
    }
  };
  service.buildState = "ACTIVE";
  service.getLiveState = () => ({ connected: true, gameDate: "1155年11月8日", totalDays: 1, characters: [] });

  const diagnostics = service.getPromptDiagnostics({ query: "岳飞现在在哪里" }).promptDiagnostics;
  assert.equal(diagnostics.available, true, "the real resolver path must remain available while Prompt Default On is disabled");
  assert.ok(diagnostics.queryAnalysis.matchedAliases.includes("岳飞"), "the analyzed Chinese query must record its historical alias");
  assert.deepEqual(diagnostics.gameTruth.characters.map((item) => item.id), ["96896"], "the resolver, analyzer and diagnostics path must reach the observed runtime character without mocked reverse lookup");
  assert.ok(diagnostics.gameTruth.characters[0].matchSources.includes("historical_alias"), "the end-to-end result must retain historical-alias provenance");
  assert.equal(diagnostics.resolverTrace.localization.status, "NOT_REQUIRED_HISTORICAL_MATCH", "a confirmed historical identity must avoid an unnecessary reverse localization scan");
  assert.deepEqual(diagnostics.resolverTrace.historical.matchedRuntimeIds, ["96896"], "the trace must prove definition-to-runtime bridging");
  assert.equal(service.getPromptContext({ query: "岳飞现在在哪里" }), null, "the E2E gate must not turn on production prompt integration");
  service.dispose();
  console.log("V8.4.1 Hotfix Query E2E: PASS (resolver, alias bridge, runtime Game Truth and diagnostics)");
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
