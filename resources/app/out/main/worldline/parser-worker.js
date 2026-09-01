"use strict";

const { parentPort, workerData } = require("worker_threads");
const fs = require("fs");
const { readSaveContainer } = require("./save-container");
const { parseGameState } = require("./game-state-adapter");

function nowMs() {
  return Number(process.hrtime.bigint()) / 1e6;
}

function validateSnapshotBounds(snapshot) {
  const counts = {
    characters: Object.keys(snapshot.characters || {}).length,
    titles: Object.keys(snapshot.titles || {}).length,
    wars: Object.keys(snapshot.wars || {}).length,
    bindings: Object.keys(snapshot.definitionToRuntime || {}).length
  };
  if (counts.characters > 300000 || counts.titles > 100000 || counts.wars > 20000 || counts.bindings > 500000) throw new Error("gamestate_index_bounds_exceeded");
}

function buildResult(savePath) {
  const startedAt = nowMs();
  const stat = fs.statSync(savePath);
  const container = readSaveContainer(savePath);
  if (!container.gamestate) {
    return {
      success: false,
      error: container.containerKind === "BINARY_CONTAINER" ? "binary_container_unsupported" : "save_container_unsupported",
      source: {
        path: savePath,
        fileSize: stat.size,
        modifiedAt: stat.mtime.toISOString(),
        container: container.containerKind,
        metadata: container.metadata
      },
      diagnostics: { parseDurationMs: Math.round(nowMs() - startedAt), workerPid: process.pid }
    };
  }
  const parseStartedAt = nowMs();
  const snapshot = parseGameState(container.gamestate);
  validateSnapshotBounds(snapshot);
  const finalStat = fs.statSync(savePath);
  if (finalStat.size !== stat.size || finalStat.mtimeMs !== stat.mtimeMs) throw new Error("save_changed_during_parse");
  return {
    success: true,
    source: {
      path: savePath,
      fileSize: stat.size,
      modifiedAt: stat.mtime.toISOString(),
      container: container.containerKind,
      metadata: container.metadata
    },
    snapshot,
    diagnostics: {
      parseDurationMs: Math.round(nowMs() - parseStartedAt),
      totalDurationMs: Math.round(nowMs() - startedAt),
      workerPid: process.pid
    }
  };
}

try {
  parentPort.postMessage(buildResult(workerData.savePath));
} catch (error) {
  parentPort.postMessage({
    success: false,
    error: error?.message || "worldline_worker_failed",
    diagnostics: { workerPid: process.pid }
  });
}
