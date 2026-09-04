"use strict";

const assert = require("assert");
const { EventEmitter } = require("events");
const { LocalizationWorkerClient } = require("../resources/app/out/main/worldline/localization-worker-client");

async function main() {
  const workers = [];
  class FakeWorker extends EventEmitter {
    constructor() { super(); this.requests = []; workers.push(this); }
    postMessage(request) { this.requests.push(request); }
    unref() {}
    terminate() { this.terminated = true; return Promise.resolve(); }
  }
  let folder = "fixture-a", updated = 0;
  const client = new LocalizationWorkerClient({ getCK3UserFolderPath: () => folder, WorkerClass: FakeWorker, onUpdated: () => updated++ });
  try {
    const first = client.findRawKeysByLocalizedValue("title", "中华");
    assert.equal(first.pending, true);
    assert.equal(first.sourceComplete, false);
    assert.deepEqual(first.matches, []);
    client.findRawKeysByLocalizedValue("title", "中华");
    assert.equal(workers[0].requests.length, 1, "in-flight lookups are deduplicated");
    const request = workers[0].requests[0];
    workers[0].emit("message", { key: request.key, result: { status: "CONFLICT", matches: [], sourceComplete: true } });
    assert.equal(client.findRawKeysByLocalizedValue("title", "中华").status, "CONFLICT");
    assert.equal(updated, 1);
    client.resolve("title", "h_old");
    const old = workers[0], stale = old.requests.at(-1);
    folder = "fixture-b";
    client.resolve("title", "h_new");
    assert.equal(old.terminated, true);
    old.emit("message", { key: stale.key, result: { confidence: "CONFIRMED", localizedValue: "Wrong campaign" } });
    assert.equal(client.cache.has(stale.key), false, "late worker replies never survive invalidation");
    workers[1].emit("error", new Error("fixture worker failure"));
    assert.equal(client.resolve("title", "h_new").workerFailed, true);
    assert.equal(client.pending.size, 0);
    assert.equal(workers.length, 2, "worker failure cannot cause a restart loop");
    client.invalidate();
    client.resolve("title", "h_retry");
    assert.equal(workers.length, 3);
    await client.settle(1);
    assert.equal(client.pending.size, 1, "a diagnostic timeout must not block the event loop");
    for (let i = 0; i < 80; i++) client.resolve("title", `h_${i}`);
    assert.equal(client.pending.size, 32, "lookup queue is bounded");
  } finally { client.dispose(); }
  console.log("V8.5 Localization Worker: PASS (nonblocking, dedupe, conflict, source isolation, failure, bounded queue)");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
