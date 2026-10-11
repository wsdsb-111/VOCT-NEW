"use strict";

const { parentPort, workerData } = require("worker_threads");
const { TemporalArchiveStore } = require("./temporal-archive-store");
const { inspectTemporalArchive } = require("./temporal-archive-diagnostics");
const diagnostics = [];
try {
  const store = new TemporalArchiveStore({ root: workerData.root, onDiagnostic: entry => diagnostics.push(entry) });
  const result = workerData.operation === "capture" ? store.commit(workerData.input) : inspectTemporalArchive(store, workerData.input.scope);
  parentPort.postMessage({ ...result, diagnostics, success: true });
} catch (error) { parentPort.postMessage({ success: false, status: "BLOCKED", error: error.message, diagnostics }); }
