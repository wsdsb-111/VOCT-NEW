"use strict";

const { parentPort, workerData } = require("worker_threads");
const { TemporalArchiveStore } = require("./temporal-archive-store");
const { retrieveHistorical } = require("./historical-retriever");

try {
  const store = new TemporalArchiveStore({ root: workerData.root });
  const { projections = [], ...retrieval } = retrieveHistorical({ store, ...workerData.input, includeProjections: workerData.includeCanonProjections });
  parentPort.postMessage({ retrieval, projections });
} catch (error) {
  parentPort.postMessage({ error: error.message || "HISTORY_WORKER_STOPPED" });
}
