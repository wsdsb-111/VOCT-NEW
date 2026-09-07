"use strict";
const { parentPort, workerData } = require("worker_threads");
const { SupplementalStore } = require("./supplemental-store");
const { buildSupplementalIndex } = require("./supplemental-retriever");

// Disk parsing, revision verification and fsync never run on Electron's UI thread.
(async () => {
  try {
    const { root, scope, operation, payload, id, revision, options } = workerData;
    const store = new SupplementalStore({ root });
    let result;
    if (operation === "read") {
      const state = store.read(scope);
      result = { records: state.records, revision: state.revision, index: buildSupplementalIndex(state.records) };
    } else if (operation === "history") result = store.history(scope, id, options);
    else if (operation === "create") result = await store.create(scope, payload);
    else if (operation === "update") result = await store.update(scope, id, payload, revision);
    else if (operation === "supersede") result = await store.supersede(scope, id, payload, revision);
    else throw new Error("supplemental_operation_invalid");
    parentPort.postMessage({ result });
  } catch (error) { parentPort.postMessage({ error: error.message }); }
})();
