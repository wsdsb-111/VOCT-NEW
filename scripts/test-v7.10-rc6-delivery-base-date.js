"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { createLetterManager } = require("../resources/app/out/main/letters/letter-manager");

function createManager(trackerDay, reconciledDay = null) {
  const settingsRepository = {
    getCK3UserFolderPath: () => null,
    getCK3DebugLogPath: () => null,
    getSummaryPromptSettings: () => ({ letterSummaryPrompt: "summary" })
  };
  const { LetterManager } = createLetterManager({
    settingsRepository, fs, path, TailFile: class {}, readline: {}, parseLog: async () => null,
    letterPromptBuilder: {}, llmManager: {}, PromptBuilder: {}, TokenCounter: {}, memoryEngine: {}, dataDir: null,
    setIntervalFn: () => ({ unref() {} }), clearIntervalFn: () => {}
  });
  const manager = new LetterManager();
  manager.currentTotalDays = trackerDay;
  let reconcileCalls = 0;
  manager.runDateTrackerHeartbeat = async ({ forceReconcile } = {}) => {
    if (forceReconcile) reconcileCalls++;
    if (Number.isFinite(reconciledDay)) {
      manager.currentTotalDays = reconciledDay;
      manager.lastDateReconciliationAt = Date.now();
      manager.lastDateScanResult = { found: true, value: reconciledDay };
    }
    return manager.getDateTrackerStatus();
  };
  return { manager, getReconcileCalls: () => reconcileCalls };
}

async function resolve(payloadDay, trackerDay, delay, reconciledDay = null) {
  const harness = createManager(trackerDay, reconciledDay);
  const timing = await harness.manager.resolveDeliveryTiming({ letterId: `letter_${payloadDay}_${delay}`, content: "x", totalDays: payloadDay, delay });
  return { ...harness, timing };
}

(async () => {
  let result = await resolve(100, 100, 7);
  assert.strictEqual(result.timing.dateSourceDecision, "PAYLOAD_ALIGNED", "D01 payload == tracker");
  assert.strictEqual(result.timing.expectedDeliveryDay, 107);
  assert.strictEqual(result.getReconcileCalls(), 0);

  result = await resolve(99, 100, 7);
  assert.strictEqual(result.timing.dateDelta, -1, "D02 payload -1 day");
  assert.strictEqual(result.timing.deliveryBaseDay, 100);

  result = await resolve(101, 100, 7);
  assert.strictEqual(result.timing.dateDelta, 1, "D03 payload +1 day");
  assert.strictEqual(result.timing.deliveryBaseDay, 100);

  result = await resolve(419184, 419198, 7, 419198);
  assert.strictEqual(result.timing.dateSourceEvent, "DATE_SOURCE_DIVERGENCE", "D04 stale payload must be explicit");
  assert.strictEqual(result.timing.deliveryBaseDay, 419198);
  assert.strictEqual(result.timing.expectedDeliveryDay, 419205);
  assert.strictEqual(result.timing.dateSourceDecision, "RECONCILED_TRACKER_AUTHORITATIVE");

  result = await resolve(214, 200, 7, 200);
  assert.strictEqual(result.timing.dateDelta, 14, "D05 future payload divergence");
  assert.strictEqual(result.timing.expectedDeliveryDay, 207);

  result = await resolve(300, 0, 3);
  assert.strictEqual(result.getReconcileCalls(), 1, "D06 tracker=0 must force reconciliation");

  result = await resolve(300, 0, 3, 320);
  assert.strictEqual(result.timing.reconciledGameDayAtCreation, 320, "D07 successful reconciliation");
  assert.strictEqual(result.timing.expectedDeliveryDay, 323);

  result = await resolve(300, 0, 3);
  assert.strictEqual(result.timing.dateSourceDecision, "PAYLOAD_FALLBACK", "D08 failed reconciliation falls back to payload only when tracker is unavailable");
  assert.strictEqual(result.timing.deliveryBaseDay, 300);

  result = await resolve(500, 500, 0);
  assert.strictEqual(result.timing.expectedDeliveryDay, 500, "D09 delay=0 is immediate");

  result = await resolve(500, 500, 7);
  assert.strictEqual(result.timing.expectedDeliveryDay - result.timing.deliveryBaseDay, 7, "D10 delay=7 remains seven days");
  assert(!fs.readFileSync(path.join(__dirname, "..", "resources", "app", "out", "main", "letters", "letter-manager.js"), "utf8").includes("this.currentTotalDays = Math.max(this.currentTotalDays, letterTotalDays)"));
  console.log("VOTC v7.10-RC6 Delivery Base Date: PASS (D01-D10, stale payload 419184 -> 419205)");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
