"use strict";

const assert = require("assert");
const fs = require("fs");
const { createHarness } = require("./letter-pipeline-test-helper");

(async () => {
  const race = createHarness({
    includeLetter: false,
    onSleep: async ({ sleepCalls, debugLogPath, letterLine }) => {
      if (sleepCalls.length === 1) fs.appendFileSync(debugLogPath, letterLine, "utf8");
    }
  });
  try {
    const reply = await race.manager.processLatestLetter();
    assert(reply, "delayed CK3 payload must still reach the provider");
    assert.deepStrictEqual(race.sleepCalls, [100]);
    assert.strictEqual(race.manager.lastPayloadDiagnostics.attemptCount, 2);
    assert.strictEqual(race.manager.lastPayloadDiagnostics.lastParseResult, "letter_payload_ready");
    assert.strictEqual(race.providerCalls.length, 2);
  } finally {
    race.cleanup();
  }

  const timeout = createHarness({ includeLetter: false, retryDelays: [10, 20] });
  try {
    assert.strictEqual(await timeout.manager.processLatestLetter(), null);
    const pipeline = timeout.manager.getAllLetterStatuses().pipeline;
    assert.strictEqual(pipeline.state, timeout.LetterPipelineState.CONTEXT_TIMEOUT);
    assert.strictEqual(pipeline.attemptCount, 3);
    assert.strictEqual(pipeline.lastParseResult, "letter_payload_missing");
    assert.strictEqual(pipeline.debugLogPath, timeout.debugLogPath);
    assert.strictEqual(timeout.providerCalls.length, 0, "context timeout must happen before any provider request");
    console.log("VOTC v7.9.2 letter payload race: PASS (bounded retry, delayed payload and timeout diagnostics)");
  } finally {
    timeout.cleanup();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
