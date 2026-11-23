"use strict";

const assert = require("node:assert/strict");
const { createStartupPerformanceTrace } = require("../src/app/main/runtime/startup-performance-trace");
const { ConversationTurnManager } = require("../src/app/main/conversation/conversation-turn-manager");
const { measure } = require("./measure-v9.8-multi-npc");

async function run() {
  const aggregate = await measure({ npcCount: 2, turns: 2, historyPairs: 5 });
  assert.equal(aggregate.queueWaitMs.count, 4);
  assert.equal(aggregate.serializationMs.count, 4);
  assert.equal(aggregate.failures, 0);

  let clock = 0;
  const trace = createStartupPerformanceTrace({ enabled: true, now: () => clock });
  const conversation = {
    id: "private-campaign-label",
    performanceTraceContext: trace.forConversation("private-campaign-label"),
    emitUpdate() {},
    async respondAs(id, epoch, { traceAttempt }) {
      assert.equal(epoch, this.turnEpoch);
      assert.equal(traceAttempt.context.responderOrdinal, id);
      clock += 5;
      traceAttempt.settle({ result: id === 1 ? "OK" : "ERROR" });
    }
  };
  const manager = new ConversationTurnManager(conversation);
  const start = () => manager.startUserTurn({ playerMessageId: 1 });
  start();
  clock = 2;
  manager.fillQueue({ customQueue: [1, 2] });
  await manager.processQueue();
  start();
  clock = 20;
  manager.supersede("synthetic cancellation");
  trace.record("process.resources", { wallMs: 30000, cpuMs: 55, rssBytes: 1024, heapUsedBytes: 512,
    activeResources: 3, privateText: "synthetic cancellation" });
  const events = trace.snapshot().events;
  assert.deepEqual(events.filter(event => event.step === "conversation.queueWait").map(event =>
    [event.logicalTurnOrdinal, event.attemptOrdinal, event.responderOrdinal, event.wallMs]), [[1, 1, 1, 2], [1, 1, 2, 7]]);
  assert.deepEqual(events.filter(event => event.step === "conversation.logicalTurn").map(event => [event.result, event.wallMs, event.count]),
    [["ERROR", 12, 2], ["CANCELLED", 8, 0]]);
  assert.equal(events.filter(event => event.step === "conversation.turnDispatch").length, 1);
  assert.equal(events.find(event => event.step === "process.resources").activeResources, 3);
  assert.doesNotMatch(JSON.stringify(events), /private-campaign-label|synthetic cancellation/);
  console.log("PASS V9.8 sequential NPC prompts, serialization, turn attribution, cancellation and trace privacy");
}

run().catch(error => { console.error(error); process.exitCode = 1; });
