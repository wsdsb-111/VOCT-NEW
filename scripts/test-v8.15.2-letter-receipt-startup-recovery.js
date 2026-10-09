"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const readline = require("node:readline");
const { createFixture, pendingLetter, makeReceiptLine, waitFor } = require("./test-v8.15.2-letter-archive-independent-qa");
const LetterLogReader = require("../resources/app/out/main/letters/letter-log-reader");

async function offlineReceipt({ restartReader = false } = {}) {
  const fixture = createFixture();
  try {
    fixture.managerDependencies.TailFile = LetterLogReader;
    fixture.managerDependencies.readline = readline;
    fs.writeFileSync(fixture.debugLogPath, "VOTC:LOAD_SESSION/;/startup-load\nVOTC:DATE/;/103\n");
    const manager = fixture.createManager();
    pendingLetter(fixture, manager, fixture.originalLetter, "李师师回信赵祯，确认已经妥善收存。", 103);
    await manager.writeLetterEffect(manager.storedLetters.get(fixture.originalLetter.letterId).reply, fixture.originalLetter);
    if (restartReader) {
      await manager.startLogTailing();
      await manager.stopLogTailing();
    }
    const stored = manager.storedLetters.get(fixture.originalLetter.letterId);
    const receipt = makeReceiptLine({ token: stored.receiptToken });
    fs.appendFileSync(fixture.debugLogPath, `${receipt}\n`);
    const recovering = restartReader ? manager : fixture.createManager();
    await recovering.startLogTailing();
    await new Promise(resolve => setTimeout(resolve, 40));
    assert.equal(recovering.awaitingAcceptanceLetterId, null, "verified offline receipt must release the original acceptance lock");
    await waitFor(() => fixture.summaryCalls.length === 1, "offline receipt archives once");
    assert.equal(fixture.effectWrites, 1, "recovery must never rewrite Effect");
    assert.equal(fixture.durableOwners.length, 2);
    await recovering.restartLogTailing();
    await recovering.processLogLine(receipt);
    assert.equal(fixture.summaryCalls.length, 1);
    assert.equal(fixture.effectWrites, 1);
  } finally { await fixture.close(); }
}

async function main() {
  await offlineReceipt();
  await offlineReceipt({ restartReader: true });
  console.log("V8.15.2 letter receipt startup/restart recovery: PASS");
}

main().catch(error => { console.error(error); process.exitCode = 1; });
