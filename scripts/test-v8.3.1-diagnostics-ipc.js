"use strict";

const assert = require("assert");
const path = require("path");
const root = path.resolve(__dirname, "..");
const { createHistoricalDiagnosticsController, registerHistoricalDiagnosticsIpc } = require(path.join(root, "resources", "app", "out", "main", "historical-system", "historical-diagnostics-ipc"));
const { buildHistoricalFigureDiagnostics } = require(path.join(root, "resources", "app", "out", "main", "historical-system", "historical-figure-diagnostics"));

const figures = [{ figureKey: "figure_a", identity: { name: "人物甲", aliases: [] }, life: { birthYear: 980, deathYear: null } }];
const matchingRecords = [{ figureKey: "figure_a", resolverReady: true }];
const createGameData = () => {
  const gameData = { date: "1010年1月1日", totalDays: 368900, characters: new Map([[1, { id: 1, shortName: "人物甲", fullName: "人物甲", age: 30, gender: "male", culture: "汉" }]]) };
  Object.defineProperty(gameData, "dynamicHistory", { enumerable: false, value: {
    campaignId: "session-a",
    campaignIdentity: { campaignId: "session-a", source: "session_fallback" },
    figureResolution: { status: "ready", summary: { total: 1, unsupported: 0, notDue: 0, unresolved: 0, candidate: 0, ambiguous: 0, resolved: 1 }, results: [{ figureKey: "figure_a", status: "RESOLVED", matchedCharacterId: 1, displayName: "人物甲", score: 0.85, confidence: "high", evidence: [], conflicts: [], alternatives: [{ characterId: 1, displayName: "人物甲", score: 0.85 }] }] }
  } });
  return gameData;
};

let parseCount = 0;
const stored = [];
let captureNumber = 0;
const controller = createHistoricalDiagnosticsController({
  settingsRepository: { getCK3DebugLogPath: () => "C:\\CK3\\logs\\debug.log" },
  parseLog: async () => { parseCount += 1; return createGameData(); },
  buildDiagnostics: buildHistoricalFigureDiagnostics,
  figures,
  matchingRecords,
  groundTruthStore: { append: (record) => stored.push(record) },
  clock: () => new Date("2026-08-31T12:00:00.000Z"),
  randomUUID: () => `capture-${++captureNumber}`
});

(async () => {
  const dashboard = await controller.getDashboard();
  assert.strictEqual(dashboard.success, true);
  assert.strictEqual(parseCount, 1, "one dashboard click must parse exactly once");
  assert.strictEqual(dashboard.data.capture.captureId, "capture-1");
  assert(!("gameData" in dashboard.data));

  const verdict = controller.recordVerdict({ captureId: "capture-1", figureKey: "figure_a", verdict: "INCORRECT" });
  assert.strictEqual(verdict.success, true);
  assert.strictEqual(stored.length, 1);
  assert.strictEqual(stored[0].score, 0.85, "stored score must come from the trusted snapshot cache");
  assert.strictEqual(stored[0].actualCulture, "汉");
  assert.strictEqual(dashboard.data.rows[0].resolution.status, "RESOLVED", "verdict must not mutate resolver output");

  const handlers = new Map();
  registerHistoricalDiagnosticsIpc({ electron: { ipcMain: { handle: (name, handler) => handlers.set(name, handler) } }, controller });
  assert(handlers.has("historical:getFigureGroundTruthDashboard"));
  assert(handlers.has("historical:recordFigureGroundTruthVerdict"));
  const ipcDashboard = await handlers.get("historical:getFigureGroundTruthDashboard")();
  assert.strictEqual(ipcDashboard.success, true);
  assert.strictEqual(parseCount, 2);

  const missingController = createHistoricalDiagnosticsController({
    settingsRepository: { getCK3DebugLogPath: () => null },
    parseLog: async () => { throw new Error("must not parse"); },
    buildDiagnostics: buildHistoricalFigureDiagnostics,
    figures,
    matchingRecords,
    groundTruthStore: { append: () => false }
  });
  assert.deepStrictEqual(await missingController.getDashboard(), { success: false, error: "ck3_debug_log_not_configured" });

  const failingStoreController = createHistoricalDiagnosticsController({
    settingsRepository: { getCK3DebugLogPath: () => "debug.log" },
    parseLog: async () => createGameData(),
    buildDiagnostics: buildHistoricalFigureDiagnostics,
    figures,
    matchingRecords,
    groundTruthStore: { append: () => { throw new Error("disk failure"); } },
    randomUUID: () => "failure-capture"
  });
  assert.strictEqual((await failingStoreController.getDashboard()).success, true);
  assert.deepStrictEqual(failingStoreController.recordVerdict({ captureId: "failure-capture", figureKey: "figure_a", verdict: "CORRECT" }), { success: false, error: "ground_truth_save_failed" });
  assert.strictEqual((await failingStoreController.getDashboard()).success, true, "store failure must not block dashboard reads");

  console.log("VOTC v8.3.1 Diagnostics IPC: PASS (single parse, no conversation dependency, trusted cache, verdict fail-open)");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
