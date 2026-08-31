"use strict";

const crypto = require("node:crypto");
const { VALID_VERDICTS } = require("./historical-ground-truth-store");

function createHistoricalDiagnosticsController({
  settingsRepository,
  parseLog,
  buildDiagnostics,
  figures,
  matchingRecords,
  groundTruthStore,
  clock = () => new Date(),
  randomUUID = () => crypto.randomUUID(),
  cacheTtlMs = 30 * 60 * 1000,
  maxCaptures = 5
}) {
  if (!settingsRepository || typeof settingsRepository.getCK3DebugLogPath !== "function") throw new Error("historical_diagnostics_settings_required");
  if (typeof parseLog !== "function" || typeof buildDiagnostics !== "function") throw new Error("historical_diagnostics_capture_dependencies_required");
  if (!groundTruthStore || typeof groundTruthStore.append !== "function") throw new Error("historical_diagnostics_ground_truth_store_required");
  const captures = new Map();
  const now = () => {
    const value = clock();
    return value instanceof Date ? value : new Date(value);
  };
  const prune = () => {
    const cutoff = now().getTime() - cacheTtlMs;
    for (const [captureId, entry] of captures) if (entry.storedAt < cutoff) captures.delete(captureId);
    while (captures.size > maxCaptures) captures.delete(captures.keys().next().value);
  };
  const getDashboard = async () => {
    const debugLogPath = settingsRepository.getCK3DebugLogPath();
    if (!debugLogPath) return { success: false, error: "ck3_debug_log_not_configured" };
    try {
      const gameData = await parseLog(debugLogPath);
      if (!gameData) return { success: false, error: "ck3_game_data_unavailable" };
      const captured = now();
      const captureId = randomUUID();
      const snapshot = buildDiagnostics({ gameData, figures, matchingRecords, captureId, capturedAt: captured.toISOString() });
      captures.set(captureId, { snapshot, storedAt: captured.getTime() });
      prune();
      return { success: true, data: snapshot };
    } catch (error) {
      console.error("[HistoricalDiagnostics] Dashboard capture failed:", error.message);
      return { success: false, error: "historical_dashboard_capture_failed" };
    }
  };
  const recordVerdict = (payload) => {
    prune();
    if (!payload || typeof payload !== "object" || typeof payload.captureId !== "string" || typeof payload.figureKey !== "string" || !VALID_VERDICTS.has(payload.verdict)) return { success: false, error: "ground_truth_payload_invalid" };
    const snapshot = captures.get(payload.captureId)?.snapshot;
    if (!snapshot) return { success: false, error: "ground_truth_capture_expired" };
    const row = snapshot.rows.find((item) => item.figureKey === payload.figureKey);
    if (!row) return { success: false, error: "ground_truth_figure_not_found" };
    const record = {
      schemaVersion: 1,
      captureId: snapshot.capture.captureId,
      capturedAt: snapshot.capture.capturedAt,
      campaignId: snapshot.capture.campaignId,
      campaignSource: snapshot.capture.campaignSource,
      gameDate: snapshot.capture.gameDate,
      totalDays: snapshot.capture.totalDays,
      figureKey: row.figureKey,
      resolverStatus: row.resolution.status,
      score: row.resolution.score,
      matchedCharacterId: row.resolution.matchedCharacterId ?? row.character?.id ?? null,
      actualAge: row.character?.age ?? null,
      actualCulture: row.character?.culture ?? null,
      evidence: row.evidence,
      conflicts: row.conflicts,
      alternatives: row.alternatives,
      verdict: payload.verdict
    };
    try {
      groundTruthStore.append(record);
      return { success: true, record };
    } catch (_error) {
      return { success: false, error: "ground_truth_save_failed" };
    }
  };
  return { getDashboard, recordVerdict };
}

function registerHistoricalDiagnosticsIpc({ electron, controller }) {
  if (!electron?.ipcMain || typeof electron.ipcMain.handle !== "function") throw new Error("historical_diagnostics_ipc_required");
  electron.ipcMain.handle("historical:getFigureGroundTruthDashboard", () => controller.getDashboard());
  electron.ipcMain.handle("historical:recordFigureGroundTruthVerdict", (_event, payload) => controller.recordVerdict(payload));
}

module.exports = { createHistoricalDiagnosticsController, registerHistoricalDiagnosticsIpc };
