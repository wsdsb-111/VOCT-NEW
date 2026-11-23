"use strict";

const assert = require("node:assert/strict");
const { connectCdp } = require("./test-v9.4-windows-packaged-smoke");

async function run() {
  const original = globalThis.WebSocket;
  const calls = [];
  class CdpSocket extends EventTarget {
    constructor() {
      super();
      queueMicrotask(() => this.dispatchEvent(new Event("open")));
    }
    send(json) {
      const { id, method, params } = JSON.parse(json);
      calls.push([method, params]);
      let response;
      if (method === "Runtime.evaluate" && params.awaitPromise) {
        response = { error: { code: -32000, message: "Promise was collected" } };
      } else if (method === "Runtime.evaluate" && params.expression === "1 + 1") {
        response = { result: { result: { value: 2 } } };
      } else if (method === "Runtime.evaluate") {
        response = { result: { result: { subtype: "promise", objectId: "fixture-handle" } } };
      } else if (method === "Runtime.awaitPromise") {
        response = { result: { result: { value: 32 } } };
      } else if (method === "Runtime.releaseObject") response = { result: {} };
      else throw Error("unexpected fixture method");
      queueMicrotask(() => this.dispatchEvent(new MessageEvent("message", {
        data: JSON.stringify({ id, ...response })
      })));
    }
  }
  globalThis.WebSocket = CdpSocket;
  try {
    const client = await connectCdp("ws://fixture.invalid", []);
    assert.equal(await client.evaluate("1 + 1"), 2);
    assert.equal(await client.evaluate("decodeExistingSample()", { pinPromise: true }), 32);
    assert.deepEqual(calls.map(([method]) => method), [
      "Runtime.evaluate", "Runtime.evaluate", "Runtime.awaitPromise", "Runtime.releaseObject"
    ]);
    assert.equal(calls[2][1].promiseObjectId, "fixture-handle");
    assert.equal(calls[3][1].objectId, "fixture-handle");
  } finally { globalThis.WebSocket = original; }
  console.log("PASS V9.8 packaged CDP retains and releases asynchronous probe handles");
}

run().catch(error => { console.error(error); process.exitCode = 1; });
