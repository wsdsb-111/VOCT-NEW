"use strict";

const assert = require("assert");
const fs = require("fs");
const { createHarness } = require("./letter-pipeline-test-helper");

(async () => {
  const logReceive = createHarness({ letterContent: "近来可好？\n盼复。" });
  try {
    await logReceive.manager.processLogLine("VOTC:LETTER_TRANSPORT/A/probe");
    assert.equal(logReceive.providerCalls.length, 0, "diagnostic markers do not trigger reply generation");
    fs.appendFileSync(logReceive.debugLogPath, "VOTC:LETTER_TRANSPORT/A/probe\nVOTC:LETTER_DIAG/A3/POST/probe\n", "utf8");
    const first = logReceive.manager.processLogLine(logReceive.letterLine);
    const duplicate = logReceive.manager.processLatestLetter({ skipPayloadRequest: true });
    assert(await first, "the complete log payload receives a letter without clipboard notification");
    assert(await duplicate);
    assert.equal(logReceive.providerCalls.length, 2, "log and clipboard triggers share one reply and summary request");
    assert.equal(logReceive.manager.storedLetters.size, 1);
    assert.equal(logReceive.manager.storedLetters.get("letter_42").letter.content, "近来可好？\n盼复。", "multiline letter text remains complete");
    assert.equal(logReceive.manager.lastPayloadDiagnostics.lastParseResult, "letter_payload_ready", "transport diagnostics must not replace the letter payload");
    assert.equal(logReceive.manager.getAllLetterStatuses().letters[0].letterId, "letter_42");
    assert.equal(logReceive.manager.getAllLetterStatuses().pipeline.letterId, "letter_42", "duplicate notification keeps the visible pipeline attached to the letter");
  } finally {
    logReceive.cleanup();
  }
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
    assert.strictEqual(pipeline.state, timeout.LetterPipelineState.PAYLOAD_INVALID);
    assert.strictEqual(pipeline.attemptCount, 3);
    assert.strictEqual(pipeline.lastParseResult, "PAYLOAD_INCOMPLETE_TIMEOUT");
    assert.strictEqual(pipeline.debugLogPath, timeout.debugLogPath);
    const timeoutStatus = timeout.manager.getAllLetterStatuses().letters.find((status) => status.payloadErrorCode === "PAYLOAD_INCOMPLETE_TIMEOUT");
    assert(timeoutStatus?.letterId.startsWith("invalid_payload_"));
    assert.strictEqual(timeout.providerCalls.length, 0, "context timeout must happen before any provider request");
    console.log("VOTC v7.9.2 letter payload race: PASS (bounded retry, delayed payload and timeout diagnostics)");
  } finally {
    timeout.cleanup();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
