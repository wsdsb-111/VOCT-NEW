"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { WorldlineService } = require("../resources/app/out/main/worldline/worldline-service");

class SettingsFixture {
  constructor(autosavePath) {
    this.settings = { autosavePath, autoWatchEnabled: false, promptIntegrationEnabled: true, lastValidatedAt: "fixture", lastValidationStatus: "VALID" };
  }
  getWorldlineSettings() { return this.settings; }
  saveWorldlineSettings(settings) { this.settings = settings; }
  getCK3DebugLogPath() { return null; }
}

function yueFeiCandidate(id, rawName) {
  return { id, firstName: rawName, birth: "1103.3.24", gender: "male", culture: "汉", alive: true, location: "fixture" };
}

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v842-sol-gates-"));
try {
  const autosavePath = path.join(tempRoot, "autosave.ck3");
  fs.writeFileSync(autosavePath, "fixture", "utf8");
  const service = new WorldlineService({ settingsRepository: new SettingsFixture(autosavePath), dataDir: tempRoot, stabilityDelayMs: 0 });
  service.currentCheckpoint = {
    id: "fixture-checkpoint",
    source: { path: autosavePath },
    snapshot: {
      gameDate: "1155.1.1",
      playerId: "100",
      playthroughId: "fixture",
      diagnostics: { characterCount: 3, activeWarCount: 0 },
      characters: {
        "100": { id: "100", firstName: "Player", alive: true },
        "96896": yueFeiCandidate("96896", "飞"),
        "96895": yueFeiCandidate("96895", "Fei_name11")
      },
      nameToCharacterIds: {},
      definitionToRuntime: { nansong_yue_085: "96896", tangyin_yue_014: "96895" },
      runtimeToDefinitions: { "96896": ["nansong_yue_085"], "96895": ["tangyin_yue_014"] },
      titles: {},
      wars: {}
    }
  };
  service.supplemental = [
    { id: "related", title: "襄阳军报", body: "岳飞已抵达襄阳", entities: ["岳飞"], visibility: "PUBLIC_WORLD", hidden: false, checkpointId: "fixture-checkpoint", source: "PLAYER_SUPPLEMENTAL" },
    { id: "generic", title: "宫廷传闻", body: "皇帝现在在哪里尚不清楚", entities: [], visibility: "PUBLIC_WORLD", hidden: false, checkpointId: "fixture-checkpoint", source: "PLAYER_SUPPLEMENTAL" }
  ];
  service.buildState = "ACTIVE";
  service.getLiveState = () => ({ connected: true, gameDate: "1155.1.1", totalDays: 1, characters: [] });

  const context = service.getPromptContext({ query: "岳飞现在在哪里" });
  assert.equal(context.queryAnalysis.identityResolution.status, "AMBIGUOUS", "the production analyzer must retain the two-runtime ambiguity");
  assert.deepEqual(context.queryAnalysis.resolvedCharacters, [], "ambiguous candidates must remain outside resolved characters");
  assert.deepEqual(context.queryAnalysis.candidateCharacters.map((item) => item.runtimeId).sort(), ["96895", "96896"], "both runtime candidates must remain diagnosable");
  assert.equal(context.topicText, null, "ambiguous runtime candidates must contribute no authoritative topic Game Truth");
  assert.match(context.supplementalText, /岳飞已抵达襄阳/, "an explicit historical entity anchor must recall related supplemental knowledge");
  assert.doesNotMatch(context.supplementalText, /皇帝现在在哪里尚不清楚/, "generic CJK question terms must not recall an unrelated supplemental entry");

  const diagnostics = service.getPromptDiagnostics({ query: "岳飞现在在哪里" }).promptDiagnostics;
  assert.deepEqual(diagnostics.gameTruth.characters, [], "diagnostics must report the same fail-closed Game Truth gate as production Prompt");
  assert.equal(diagnostics.queryAnalysis.candidateCharacters.length, 2, "diagnostics must preserve candidates separately");
  assert.equal(diagnostics.worldPromptTokens, diagnostics.tokenBreakdown.reduce((total, block) => total + block.tokens, 0), "the existing Token Breakdown sum gate must remain exact");
  service.dispose();

  const renderer = fs.readFileSync(path.join(__dirname, "..", "resources", "app", "out", "renderer", "assets", "index-Dn3qWlAB.js"), "utf8");
  const candidateRenderer = renderer.slice(renderer.indexOf("const identityCandidateRows"), renderer.indexOf("const promptTokenBreakdownRows"));
  assert.ok(candidateRenderer.includes('text("身份候选", "Identity candidate")} #'), "candidate cards must use a neutral Runtime-labelled heading");
  assert.ok(candidateRenderer.includes('text("Alias candidate", "Alias candidate")'), "the historical alias must be shown only as candidate metadata");
  assert.ok(!candidateRenderer.includes('candidateField(candidate, "displayName", "aliasCandidate")'), "candidate cards must not promote alias/displayName to an authoritative heading");
  assert.ok(renderer.includes("promptIdentityResolution || null"), "the Historical Definition page must consume the latest read-only identity diagnostic");

  const worldlineStart = renderer.indexOf("function WorldlineView()");
  const worldlineEnd = renderer.indexOf("function ConfigPanel", worldlineStart);
  assert.ok(worldlineStart >= 0 && worldlineEnd > worldlineStart, "WorldlineView boundaries must be present for the initial-render regression");
  const worldlineSource = renderer.slice(worldlineStart, worldlineEnd);
  const jsxRuntimeExports = { jsx: () => null, jsxs: () => null };
  const reactExports = { useState: (initial) => [initial, () => {}], useEffect: () => {} };
  const useTranslation = () => ({ i18n: { language: "zh-CN" } });
  const renderWorldline = new Function("reactExports", "jsxRuntimeExports", "useTranslation", "window", "navigator", `${worldlineSource}; return WorldlineView;`)(reactExports, jsxRuntimeExports, useTranslation, {}, {});
  assert.doesNotThrow(() => renderWorldline(), "WorldlineView must render before Prompt diagnostics have produced query arrays");

  const worldlineServiceSource = fs.readFileSync(path.join(__dirname, "..", "resources", "app", "out", "main", "worldline", "worldline-service.js"), "utf8");
  assert.equal((worldlineServiceSource.match(/source: "PLAYER_SUPPLEMENTAL"/g) || []).length, 1, "PLAYER_SUPPLEMENTAL provenance must originate only from player creation");
  assert.ok(worldlineServiceSource.includes("promptIntegrationEnabled: false"), "Prompt Default On must remain disabled");
  console.log("V8.4.2 Sol Safety Gates: PASS (ambiguous Prompt isolation, recall precision, neutral candidate UI and provenance)");
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
