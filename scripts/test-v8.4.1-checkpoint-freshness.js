"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { STALE_AFTER_DAYS, getCheckpointFreshness, parseCK3Date } = require("../resources/app/out/main/worldline/checkpoint-freshness");
const { WorldlineService } = require("../resources/app/out/main/worldline/worldline-service");

assert.deepEqual(getCheckpointFreshness({ pipelineState: "ACTIVE", checkpointAsOf: "1155.1.1", liveDate: "1155.1.1" }), {
  pipelineState: "ACTIVE",
  checkpointAsOf: "1155.1.1",
  liveDate: "1155.1.1",
  ageDays: 0,
  freshnessStatus: "FRESH",
  verificationMode: "LIVE_VERIFIED",
  reason: "SAME_DAY"
}, "same-day Live and Checkpoint facts must be fresh");
assert.equal(getCheckpointFreshness({ pipelineState: "ACTIVE", checkpointAsOf: "1155.1.1", liveDate: "1155.1.2" }).freshnessStatus, "AGING", "a newer Live date must separate checkpoint facts without calling them current");
assert.equal(parseCK3Date("1155年11月8日"), parseCK3Date("1155.11.8"), "the localized Live probe date must use the same calendar parser");
const localizedLive = getCheckpointFreshness({ pipelineState: "ACTIVE", checkpointAsOf: "1155.1.1", liveDate: "1155年11月8日" });
assert.equal(localizedLive.freshnessStatus, "AGING", "a localized Live date within the freshness window must not be rejected as stale");
assert.equal(localizedLive.reason, "LIVE_AHEAD_OF_CHECKPOINT", "a localized newer Live date must retain the normal aging reason");
assert.ok(localizedLive.ageDays > 0 && localizedLive.ageDays < STALE_AFTER_DAYS, "the localized Live date must produce a bounded checkpoint age");
assert.equal(getCheckpointFreshness({ pipelineState: "ACTIVE", checkpointAsOf: "1155.1.1", liveDate: "1156.1.2" }).freshnessStatus, "STALE", `a checkpoint older than ${STALE_AFTER_DAYS} days must not enter prompts`);
assert.equal(getCheckpointFreshness({ pipelineState: "STALE", checkpointAsOf: "1155.1.1", liveDate: "1155.1.1" }).freshnessStatus, "STALE", "a non-active pipeline must remain stale even when dates match");
assert.equal(getCheckpointFreshness({ pipelineState: "ACTIVE", checkpointAsOf: "1155.1.1", liveDate: "1154.12.30" }).reason, "LIVE_DATE_BEFORE_CHECKPOINT", "a reversed Live date must fail closed");
assert.equal(getCheckpointFreshness({ pipelineState: "ACTIVE", checkpointAsOf: "1155.1.1", liveDate: null }).freshnessStatus, "FRESH", "an active checkpoint without a Live probe may remain available only with an explicit missing-Live boundary");
assert.equal(getCheckpointFreshness({ pipelineState: "ACTIVE", checkpointAsOf: "1155.1.1", liveDate: null }).verificationMode, "CHECKPOINT_ONLY", "a missing Live probe must never be represented as a real-time verification");

class SettingsFixture {
  constructor(autosavePath) {
    this.settings = { autosavePath, autoWatchEnabled: false, promptIntegrationEnabled: true, lastValidatedAt: "fixture", lastValidationStatus: "VALID" };
  }
  getWorldlineSettings() { return this.settings; }
  saveWorldlineSettings(settings) { this.settings = settings; }
  getCK3DebugLogPath() { return null; }
}

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v841-freshness-"));
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
      diagnostics: { characterCount: 1, activeWarCount: 0 },
      characters: { "100": { id: "100", firstName: "Yuefei", alive: true, location: "8841" } },
      nameToCharacterIds: { yuefei: ["100"] },
      definitionToRuntime: {},
      runtimeToDefinitions: {},
      titles: {}
    }
  };
  service.buildState = "ACTIVE";
  service.getLiveState = () => ({ connected: true, gameDate: "1155.1.2", totalDays: 1, characters: [] });
  const aging = service.getPromptContext({ query: "Yuefei" });
  assert.match(aging.currentText, /Checkpoint 世界事实截至：1155\.1\.1/, "prompt context must state the checkpoint as-of date");
  assert.match(aging.currentText, /Live 当前日期：1155\.1\.2/, "prompt context must state the distinct Live date");
  assert.match(aging.currentText, /未被 Live Probe 更新的可变事实仍仅截至 Checkpoint 日期/, "prompt context must prohibit relabeling checkpoint facts as live facts");
  assert.equal(aging.freshnessStatus, "AGING", "an active older checkpoint may be used only with explicit aging metadata");
  assert.deepEqual(service.getDiagnostics().diagnostics.freshnessStatus, "AGING", "diagnostics must expose the same freshness status used by prompt gating");

  service.getLiveState = () => ({ connected: true, gameDate: "1155.1.3", totalDays: 2, characters: [] });
  const refreshed = service.getPromptContext({ query: "Yuefei" });
  assert.equal(refreshed.cacheHit, false, "a changed Live date must invalidate the cached current-world projection");
  assert.match(refreshed.currentText, /1155\.1\.3/, "the refreshed projection must use the newest Live date");

  service.getLiveState = () => ({ connected: true, gameDate: "1156.1.2", totalDays: 367, characters: [] });
  assert.equal(service.getPromptContext({ query: "Yuefei" }), null, "stale checkpoints must never enter production prompts");
  service.dispose();
  console.log("V8.4.1 Checkpoint Freshness: PASS (as-of boundary, live invalidation and stale prompt gate)");
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
