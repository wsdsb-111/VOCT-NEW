"use strict";

const assert = require("assert");
const path = require("path");
const root = path.resolve(__dirname, "..");
const { buildHistoricalFigureDiagnostics } = require(path.join(root, "resources", "app", "out", "main", "historical-system", "historical-figure-diagnostics"));

const figures = [{
  figureKey: "yue_fei",
  identity: { name: "岳飞", aliases: ["岳武穆"] },
  life: { birthYear: 1103, deathYear: 1142 }
}, {
  figureKey: "unsupported_figure",
  identity: { name: "未校准人物", aliases: [] },
  life: { birthYear: null, deathYear: null }
}];
const matchingRecords = [{ figureKey: "yue_fei", resolverReady: true }, { figureKey: "unsupported_figure", resolverReady: false }];
const characters = new Map([
  [101, { id: 101, shortName: "岳飞", fullName: "岳飞", age: 50, gender: "male", culture: "汉人", faith: "儒教", house: "岳氏", primaryTitle: "枢密使", heldCourtAndCouncilPositions: "太尉", liege: "宋帝", topLiege: "宋帝", capitalLocation: "临安" }],
  [102, { id: 102, shortName: "岳飞", fullName: "同名岳飞", age: 49, gender: "male", culture: "汉", faith: "儒教", house: "", primaryTitle: "—", heldCourtAndCouncilPositions: "", liege: "", topLiege: "", capitalLocation: "" }]
]);
const gameData = { date: "1153年4月2日", totalDays: 421000, characters };
Object.defineProperty(gameData, "dynamicHistory", {
  enumerable: false,
  configurable: false,
  value: {
    campaignId: `ck3-${"a".repeat(32)}`,
    campaignIdentity: { campaignId: `ck3-${"a".repeat(32)}`, source: "ck3_mod_token" },
    figureResolution: {
      status: "ready",
      summary: { total: 2, unsupported: 1, notDue: 0, unresolved: 0, candidate: 0, ambiguous: 1, resolved: 0 },
      results: [{
        figureKey: "yue_fei",
        status: "AMBIGUOUS",
        matchedCharacterId: null,
        displayName: null,
        score: 0.88,
        confidence: "medium",
        evidence: [{ code: "NAME_EXACT", weight: 0.55 }, { code: "SURVIVED_BEYOND_BASELINE_DEATH", weight: 0 }],
        conflicts: [],
        alternatives: [{ characterId: 101, displayName: "岳飞", score: 0.88 }, { characterId: 102, displayName: "同名岳飞", score: 0.85 }]
      }, {
        figureKey: "unsupported_figure",
        status: "UNSUPPORTED",
        matchedCharacterId: null,
        score: 0,
        confidence: "none",
        evidence: [],
        conflicts: [],
        alternatives: []
      }]
    }
  }
});

const snapshot = buildHistoricalFigureDiagnostics({
  gameData,
  figures,
  matchingRecords,
  captureId: "capture-a",
  capturedAt: "2026-08-31T12:00:00.000Z"
});

assert.strictEqual(snapshot.schemaVersion, 1);
assert.strictEqual(snapshot.capture.captureId, "capture-a");
assert.strictEqual(snapshot.capture.gameDate, "1153年4月2日");
assert.strictEqual(snapshot.capture.characterCount, 2);
assert.strictEqual(snapshot.summary.resolverReady, 1);
assert.strictEqual(snapshot.summary.ambiguous, 1);
assert.strictEqual(snapshot.rows[0].historical.name, "岳飞");
assert.strictEqual(snapshot.rows[1].historical.deathYear, null, "missing numeric diagnostics must not coerce to zero");
assert.strictEqual(snapshot.rows[0].character.culture, "汉人", "raw CK3 culture must be projected");
assert.strictEqual(snapshot.rows[0].alternatives[1].character.age, 49);
assert(snapshot.rows[0].evidence.some((item) => item.code === "SURVIVED_BEYOND_BASELINE_DEATH"));
assert.doesNotThrow(() => JSON.stringify(snapshot));
assert(!JSON.stringify(snapshot).includes("dynamicHistory"));
assert(!Object.keys(gameData).includes("dynamicHistory"), "diagnostics must preserve hidden metadata");
assert(!snapshot.rows.some((row) => row.character instanceof Map));

console.log("VOTC v8.3.1 Figure Diagnostics: PASS (compact serializable snapshot, raw culture, alternatives, hidden metadata)");
