"use strict";

const assert = require("assert");
const { EventEmitter } = require("events");
const { HistoricalDefinitionIndexClient } = require("../resources/app/out/main/worldline/historical-definition-index");

class FakeTimers {
  constructor() { this.tasks = []; this.nextId = 1; }
  setTimeout(callback, delay) { const task = { id: this.nextId++, callback, delay, cleared: false }; this.tasks.push(task); return task; }
  clearTimeout(task) { if (task) task.cleared = true; }
  run(delay) { const task = this.tasks.find((item) => !item.cleared && item.delay === delay); assert(task, `missing timer ${delay}`); task.cleared = true; task.callback(); }
  active(delay) { return this.tasks.filter((item) => !item.cleared && item.delay === delay).length; }
}

class FakeWorker extends EventEmitter {
  constructor() { super(); FakeWorker.instances.push(this); }
  postMessage(message) { this.messages = [...(this.messages || []), message]; }
  terminate() { this.terminated = true; return Promise.resolve(); }
  unref() {}
}
FakeWorker.instances = [];

const timers = new FakeTimers();
const client = new HistoricalDefinitionIndexClient({
  getCK3UserFolderPath: () => "fixture",
  WorkerClass: FakeWorker,
  setTimeout: timers.setTimeout.bind(timers),
  clearTimeout: timers.clearTimeout.bind(timers)
});

client.start();
FakeWorker.instances[0].emit("error", new Error("first"));
assert.equal(client.status, "FAILED_TRANSIENT");
assert.equal(client.retryCount, 1);
assert.equal(timers.active(1000), 1);

timers.run(1000);
FakeWorker.instances[1].emit("error", new Error("second"));
assert.equal(client.retryCount, 2);
assert.equal(timers.active(5000), 1);

timers.run(5000);
FakeWorker.instances[2].emit("error", new Error("third"));
assert.equal(client.retryCount, 3);
assert.equal(timers.active(30000), 1);

timers.run(30000);
FakeWorker.instances[3].emit("error", new Error("fourth"));
assert.equal(client.status, "FAILED_STABLE");
assert.equal(client.stableFailure, true);
assert.equal(timers.active(1000) + timers.active(5000) + timers.active(30000), 0, "stable failure cannot schedule another automatic worker");

client.invalidate();
client.start();
assert.equal(client.retryCount, 0, "explicit invalidation is an authorized new recovery episode");
const recovered = FakeWorker.instances[4];
recovered.emit("message", { type: "built", meta: { revision: "fixture", state: "READY", sourceComplete: true } });
recovered.emit("error", new Error("rapid-crash"));
assert.equal(client.retryCount, 1, "a brief READY state cannot erase the retry budget");

client.dispose();
assert.equal(timers.active(1000) + timers.active(5000) + timers.active(30000), 0, "dispose cancels scheduled recovery");

console.log("V8.6 Worker Recovery: PASS (1s/5s/30s single-flight retry, stable failure, explicit reset and dispose)");
