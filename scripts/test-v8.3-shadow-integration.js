"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const root = path.resolve(__dirname, "..");
const { DynamicHistoryService } = require(path.join(root, "resources", "app", "out", "main", "historical-system", "dynamic-history-service"));
const { WorldlineStore } = require(path.join(root, "resources", "app", "out", "main", "historical-system", "worldline-store"));

const identityA = Object.freeze({ campaignId: `ck3-${"a".repeat(32)}`, source: "ck3_mod_token", persistenceAllowed: true, tokenFingerprint: "a".repeat(64) });
const identityB = Object.freeze({ campaignId: `ck3-${"b".repeat(32)}`, source: "ck3_mod_token", persistenceAllowed: true, tokenFingerprint: "b".repeat(64) });
const stateFor = (identity) => Object.freeze({ schemaVersion: 1, campaignId: identity.campaignId, mode: "shadow" });
const resolver = {
  resolve(gameData) {
    return Object.freeze({ status: "ready", summary: Object.freeze({ total: 1, unsupported: 0, notDue: 0, unresolved: 0, candidate: 0, ambiguous: 0, resolved: 1 }), results: Object.freeze([{ figureKey: gameData.figureKey, status: "RESOLVED", matchedCharacterId: gameData.characterId }]) });
  }
};
const service = new DynamicHistoryService({
  identityResolver: { resolve: (token) => token === "A" ? identityA : identityB },
  worldlineStore: { loadOrCreate: (identity) => ({ status: "loaded", state: stateFor(identity), path: "fixture" }) },
  historicalFigureResolver: resolver
});
const gameDataA = { campaignToken: "A", figureKey: "figure_a", characterId: 101 };
const gameDataB = { campaignToken: "B", figureKey: "figure_b", characterId: 202 };
service.updateFromGameData(gameDataA);
service.updateFromGameData(gameDataB);
assert.strictEqual(gameDataA.dynamicHistory.figureResolution.results[0].matchedCharacterId, 101);
assert.strictEqual(gameDataB.dynamicHistory.figureResolution.results[0].matchedCharacterId, 202);
assert.doesNotThrow(() => service.updateFromGameData(gameDataA));
assert(!Object.keys(gameDataA).includes("dynamicHistory"));
assert(!JSON.stringify(gameDataA).includes("figureResolution"));

const failureService = new DynamicHistoryService({
  identityResolver: { resolve: () => identityA },
  worldlineStore: { loadOrCreate: () => ({ status: "loaded", state: stateFor(identityA), path: "fixture" }) },
  historicalFigureResolver: { resolve: () => { throw new Error("fixture failure"); } }
});
const failedGameData = { campaignToken: "A" };
assert.doesNotThrow(() => failureService.updateFromGameData(failedGameData));
assert.strictEqual(failedGameData.dynamicHistory.figureResolution.status, "error");
assert.strictEqual(failureService.getDiagnostics()[0].code, "HISTORICAL_FIGURE_RESOLUTION_FAILED");

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v83-no-persistence-"));
try {
  const persistentService = new DynamicHistoryService({
    identityResolver: { resolve: () => identityA },
    worldlineStore: new WorldlineStore({ rootDir: tempRoot, clock: () => "2026-08-31T00:00:00.000Z" }),
    historicalFigureResolver: resolver
  });
  const persistentGameData = { campaignToken: "A", figureKey: "figure_a", characterId: 101 };
  const created = persistentService.updateFromGameData(persistentGameData);
  const before = fs.readFileSync(created.path, "utf8");
  persistentService.updateFromGameData(persistentGameData);
  const after = fs.readFileSync(created.path, "utf8");
  assert.strictEqual(after, before, "figure resolution must not mutate worldline persistence");
  assert(!after.includes("figureBindings") && !after.includes("figureResolution"));
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

console.log("VOTC v8.3 Shadow Integration: PASS (GameData scope, hidden metadata, fail-open and zero figure persistence)");
