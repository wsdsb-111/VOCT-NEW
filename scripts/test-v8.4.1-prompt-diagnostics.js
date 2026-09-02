"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { WorldlineService } = require("../resources/app/out/main/worldline/worldline-service");

class SettingsFixture {
  constructor(autosavePath) {
    this.settings = { autosavePath, autoWatchEnabled: false, promptIntegrationEnabled: false, lastValidatedAt: "fixture", lastValidationStatus: "VALID" };
  }
  getWorldlineSettings() { return this.settings; }
  saveWorldlineSettings(settings) { this.settings = settings; }
  getCK3DebugLogPath() { return null; }
}

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v841-prompt-diagnostics-"));
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
      diagnostics: { characterCount: 2, activeWarCount: 0 },
      characters: {
        "100": { id: "100", firstName: "Player", alive: true, location: "8841" },
        "101": { id: "101", firstName: "Yuefei", fullName: "Yuefei", alive: true, location: "kaifeng" },
        "102": { id: "102", firstName: "YuefeiJunior", fullName: "YuefeiJunior", alive: true, location: "kaifeng" }
      },
      nameToCharacterIds: { yuefei: ["101"], yuefeijunior: ["102"] },
      definitionToRuntime: {},
      runtimeToDefinitions: {},
      titles: { "1": { id: "1", key: "title_yuefei", holder: "101" } }
    }
  };
  service.supplemental = [1, 2, 3, 4].map((id) => ({ id: `supp-${id}`, title: `Yuefei note ${id}`, body: `Yuefei supplemental fact ${id}`, visibility: "PUBLIC_WORLD", hidden: false, checkpointId: "fixture-checkpoint" }));
  service.buildState = "ACTIVE";
  service.getLiveState = () => ({ connected: true, gameDate: "1155年11月8日", totalDays: 1, characters: [] });

  const first = service.getPromptDiagnostics({ query: "Yuefei现在在哪里" }).promptDiagnostics;
  assert.equal(first.available, true, "diagnostics must remain available while production prompt integration is disabled");
  assert.equal(first.freshnessStatus, "AGING", "localized Live dates must keep a recent checkpoint available for diagnostics");
  assert.equal(first.liveDate, "1155年11月8日", "diagnostics must preserve the localized Live date for display");
  assert.equal(first.query, "Yuefei现在在哪里", "diagnostics must echo the inspected query");
  assert.equal(first.queryAnalysis.characters[0].id, "101", "diagnostics must expose Shared Query Analyzer character matches");
  assert.equal(first.gameTruth.characters[0].id, "101", "diagnostics must expose matched Game Truth");
  assert.equal(first.supplemental.length, 3, "production supplemental selection must remain capped at three");
  assert.ok(first.trimmedItems.some((item) => item.id === "supp-4"), "diagnostics must expose supplemental entries trimmed by the selection cap");
  assert.ok(first.worldPromptTokens > 0, "diagnostics must expose the estimated world prompt token total");
  assert.ok(first.tokenBreakdown.some((block) => block.id === "worldline-current"), "diagnostics must expose world prompt block token breakdown");
  assert.ok(first.tokenBreakdown.some((block) => block.id === "worldline-stable" && block.tokens > 0), "diagnostics must expose a measurable stable world block");
  assert.equal(first.worldPromptTokens, first.tokenBreakdown.reduce((total, block) => total + block.tokens, 0), "world prompt total must equal the sum of block tokens");
  assert.equal(first.cacheHit, false, "the first diagnostic query must be a cache miss");

  const inspectedContext = service.getPromptContext({ query: "Yuefei现在在哪里", diagnostic: true });
  assert.match(inspectedContext.stableText, /事实优先级：.*Live.*回应角色权威游戏资料.*Checkpoint.*Supplemental.*Personal Memory.*模型推断/, "stable world context must state the complete source priority");
  assert.match(inspectedContext.topicText, /Checkpoint 事实（截至 1155\.1\.1）/, "topic Game Truth must expose its checkpoint as-of date");
  assert.match(inspectedContext.topicText, /若与本轮 Live、回应角色权威游戏资料或场景直接事实冲突，必须以后者为准/, "topic Game Truth must yield to direct current facts");
  assert.match(inspectedContext.currentText, /未被 Live Probe 更新的可变事实仍仅截至 Checkpoint 日期/, "Live date must not disguise checkpoint facts as current");

  const second = service.getPromptDiagnostics({ query: "Yuefei现在在哪里" }).promptDiagnostics;
  assert.equal(second.cacheHit, true, "the same diagnostic query must report the world recall cache hit");
  assert.equal(service.getPromptContext({ query: "Yuefei现在在哪里" }), null, "diagnostics must not enable production prompt integration");
  service.dispose();
  console.log("V8.4.1 Prompt Diagnostics: PASS (query, matches, as-of, tokens, cache and trims)");
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
