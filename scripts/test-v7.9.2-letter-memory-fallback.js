"use strict";

const assert = require("assert");
const { createHarness } = require("./letter-pipeline-test-helper");

(async () => {
  const harness = createHarness({ memoryFailure: true, summaryLoadFailure: true });
  try {
    const reply = await harness.manager.processLatestLetter();
    assert(reply, "Memory Engine failure must not make the letter unavailable");
    assert.deepStrictEqual(harness.providerCalls.map((entry) => entry.type), ["letter", "letter_summary"]);
    const requestMessages = harness.providerCalls[0].messages;
    assert(requestMessages[0].content.startsWith("Stable letter roleplay rules:"), "fallback must use the minimal official-compatible prompt");
    assert(requestMessages.some((message) => message.content.includes("Recipient identity")));
    assert(requestMessages.some((message) => message.content.includes("Player identity")));
    assert(requestMessages.some((message) => message.content.includes("近来可好")));
    const status = harness.manager.getLetterStatus("letter_42");
    assert.strictEqual(status.promptMode, "minimal_fallback");
    assert(status.promptBuildError.includes("memory retrieval failed"));
    assert.strictEqual(status.summaryStatus, "saved");
    assert.strictEqual(harness.memoryRecords.length, 1);
    console.log("VOTC v7.9.2 letter Memory fallback: PASS (context degradation still replies, summarizes and persists)");
  } finally {
    harness.cleanup();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
