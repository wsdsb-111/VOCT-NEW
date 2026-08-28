"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { createHarness } = require("./letter-pipeline-test-helper");

(async () => {
  const harness = createHarness();
  try {
    const reply = await harness.manager.processLatestLetter();
    assert.strictEqual(reply, "一切安好，盼君珍重。");
    assert.deepStrictEqual(harness.providerCalls.map((entry) => entry.type), ["letter", "letter_summary"], "one normal letter must create one chat request and one summary request");
    assert.strictEqual(harness.providerCalls[0].metadata.requestType, "letter");
    assert.strictEqual(harness.providerCalls[1].metadata.requestType, "letter_summary");
    assert.strictEqual(harness.savedSummaries.length, 1, "letter summary must be persisted to the recipient summary");
    assert.strictEqual(harness.memoryRecords.length, 1, "recordLetterMemory must persist the letter memory");
    const status = harness.manager.getLetterStatus("letter_42");
    assert.strictEqual(status.summaryStatus, "saved");
    assert.strictEqual(status.pipelineState, harness.LetterPipelineState.PENDING_DELIVERY);
    for (const state of ["TRIGGER_RECEIVED", "CONTEXT_WAITING", "CONTEXT_READY", "PROMPT_BUILDING", "PROMPT_READY", "REPLY_REQUESTED", "REPLY_RECEIVED", "SUMMARY_REQUESTED", "SUMMARY_SAVED", "PENDING_DELIVERY"]) {
      assert(status.pipelineHistory.some((entry) => entry.state === state), `letter pipeline must expose ${state}`);
    }
    const pendingPath = path.join(harness.dataDir, "pending-letters.json");
    assert(fs.existsSync(pendingPath));
    assert.strictEqual(JSON.parse(fs.readFileSync(pendingPath, "utf8")).letters.length, 1);
    console.log("VOTC v7.9.2 letter pipeline E2E: PASS (parse, prompt, chat, summary, memory and pending delivery)");
  } finally {
    harness.cleanup();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
