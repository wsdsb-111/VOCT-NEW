"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createFixture, pendingLetter, makeReceiptLine, waitFor } = require("./test-v8.15.2-letter-archive-independent-qa");
const { Memory4DerivedService } = require("../resources/app/out/main/memory-system/memory4-derived");

const LOAD_LINE = "VOTC:LOAD_SESSION/;/fix5-independent-load";

async function prepareWrittenLetter(fixture, { manager = fixture.manager, letter = fixture.originalLetter,
  reply = "隔离测试回信：已妥善收存。" } = {}) {
  fs.writeFileSync(fixture.debugLogPath, `${LOAD_LINE}\nVOTC:DATE/;/100\n`, "utf8");
  pendingLetter(fixture, manager, letter, reply, 103);
  const stored = manager.storedLetters.get(letter.letterId);
  assert.equal(await manager.writeLetterEffect(reply, letter), true, "fixture records one real LetterManager Effect write");
  assert.equal(manager.awaitingAcceptanceLetterId, letter.letterId);
  assert.match(stored.receiptToken, /^[a-f0-9]{32}$/);
  assert.equal(stored.receiptSessionProof.sessionId, "fix5-independent-load");
  return stored;
}

async function rejectsRotatedPhysicalLog() {
  const fixture = createFixture();
  try {
    const stored = await prepareWrittenLetter(fixture);
    const receiptLine = makeReceiptLine({ token: stored.receiptToken });
    fs.appendFileSync(fixture.debugLogPath, `${receiptLine}\n`, "utf8");

    const oldPath = `${fixture.debugLogPath}.old`;
    fs.renameSync(fixture.debugLogPath, oldPath);
    fs.writeFileSync(fixture.debugLogPath, `${LOAD_LINE}\nVOTC:DATE/;/103\n`, "utf8");
    const restored = fixture.createManager();
    const result = await restored.recoverPendingLetterReceipt();

    assert.equal(result.status, "AMBIGUOUS_OR_STALE", "a same-token session in a replacement physical file is not the dispatched file");
    assert.equal(restored.awaitingAcceptanceLetterId, fixture.originalLetter.letterId);
    assert.equal(restored.getLetterStatus(fixture.originalLetter.letterId).responseStatus, "effect_file_written");
    assert.equal(fixture.summaryCalls.length, 0, "the detached old file cannot start archival");
    assert.equal(fixture.effectWrites, 1, "recovery never retries the Effect");
  } finally {
    await fixture.close();
  }
}

async function rejectsReceiptBeforeSameTokenNewLoad() {
  const fixture = createFixture();
  try {
    const stored = await prepareWrittenLetter(fixture);
    const receiptLine = makeReceiptLine({ token: stored.receiptToken });
    fs.appendFileSync(fixture.debugLogPath, `${receiptLine}\n${LOAD_LINE}\n`, "utf8");

    const restored = fixture.createManager();
    const result = await restored.recoverPendingLetterReceipt();

    assert.equal(result.status, "AMBIGUOUS_OR_STALE", "a later physical LOAD rejects earlier receipt evidence even with the same token");
    assert.equal(restored.awaitingAcceptanceLetterId, fixture.originalLetter.letterId);
    assert.equal(fixture.summaryCalls.length, 0);
    assert.equal(fixture.effectWrites, 1);
  } finally {
    await fixture.close();
  }
}

async function failedAcceptanceProofPersistenceRetainsOldState() {
  const fixture = createFixture();
  const originalRename = fs.renameSync;
  try {
    const manager = fixture.manager;
    const stored = await prepareWrittenLetter(fixture, { manager });
    const receiptLine = makeReceiptLine({ token: stored.receiptToken });
    fs.appendFileSync(fixture.debugLogPath, `${receiptLine}\n`, "utf8");
    const oldPendingBytes = fs.readFileSync(fixture.pendingPath);
    fs.renameSync = (source, destination) => {
      if (destination === fixture.pendingPath) throw Object.assign(new Error("synthetic_pending_replace_failure"), { code: "EIO" });
      return originalRename(source, destination);
    };

    const result = await manager.processLogLine(receiptLine);

    assert.equal(result.success, false, "failed durable proof write rejects the acceptance transition");
    assert.equal(result.reason, "letter_acceptance_persist_failed");
    assert.deepEqual(fs.readFileSync(fixture.pendingPath), oldPendingBytes, "failed atomic replacement leaves the prior pending file intact");
    assert.equal(manager.awaitingAcceptanceLetterId, fixture.originalLetter.letterId, "the original lock stays active");
    assert.equal(manager.getLetterStatus(fixture.originalLetter.letterId).responseStatus, "effect_file_written");
    assert.equal(fixture.summaryCalls.length, 0, "no archive starts without durable proof");
    assert.equal(fixture.effectWrites, 1, "persistence failure never resends the Effect");
  } finally {
    fs.renameSync = originalRename;
    await fixture.close();
  }
}

async function delayedReceiptCannotConsumeNextAcceptanceLock() {
  const fixture = createFixture();
  try {
    const manager = fixture.manager;
    const first = await prepareWrittenLetter(fixture, { manager });
    const oldReceipt = makeReceiptLine({ token: first.receiptToken });
    fs.appendFileSync(fixture.debugLogPath, `${oldReceipt}\n`, "utf8");
    await manager.processLogLine(oldReceipt);
    await waitFor(() => fixture.summaryCalls.length > 0, "first letter acceptance completes before installing the next lock");

    const next = { letterId: "letter_fix5_next", content: "第二封合成信。", totalDays: 100, delay: 3 };
    pendingLetter(fixture, manager, next, "第二封合成回信。", 103);
    const nextStored = manager.storedLetters.get(next.letterId);
    nextStored.receiptToken = "b".repeat(32);
    manager.awaitingAcceptanceLetterId = next.letterId;
    manager.updateLetterStatus(next.letterId, {
      responseStatus: "effect_file_written", effectFileWrittenAt: Date.now(), effectTransportMode: "votc_run_file"
    });
    assert.equal(manager.savePendingLetters(), true);

    const summariesBefore = fixture.summaryCalls.length;
    await manager.processLogLine(oldReceipt);

    assert.equal(manager.awaitingAcceptanceLetterId, next.letterId, "a previous letter's late receipt cannot clear the next letter's lock");
    assert.equal(manager.getLetterStatus(next.letterId).responseStatus, "effect_file_written");
    assert.equal(nextStored.acceptedReceipt, undefined);
    assert.equal(fixture.summaryCalls.length, summariesBefore);
    assert.equal(fixture.effectWrites, 1, "late receipt rejection does not write another Effect");
  } finally {
    await fixture.close();
  }
}

async function concurrentLiveAndRecoveryReceiptIsSingleAcceptance() {
  const fixture = createFixture();
  try {
    const manager = fixture.manager;
    const stored = await prepareWrittenLetter(fixture, { manager });
    const receiptLine = makeReceiptLine({ token: stored.receiptToken, date: "1038年4月4日" });
    fs.appendFileSync(fixture.debugLogPath, `${receiptLine}\n${receiptLine}\n`, "utf8");
    let captureCount = 0;
    const captureAccepted = fixture.archive.captureAccepted.bind(fixture.archive);
    fixture.archive.captureAccepted = context => {
      captureCount++;
      return captureAccepted(context);
    };

    await Promise.all([
      manager.processLogLine(receiptLine),
      manager.recoverPendingLetterReceipt(),
      manager.recoverPendingLetterReceipt()
    ]);
    await waitFor(() => fixture.summaryCalls.length > 0, "one concurrent receipt path finalizes the accepted letter");

    assert.equal(manager.awaitingAcceptanceLetterId, null, "the matching lock is released once");
    assert.equal(captureCount, 1, "live and recovery callbacks create one accepted-memory job");
    assert.equal(fixture.effectWrites, 1, "receipt competition does not resend the Effect");
    const summaryCount = fixture.summaryCalls.length;
    await manager.processLogLine(receiptLine);
    await manager.recoverPendingLetterReceipt();
    assert.equal(fixture.summaryCalls.length, summaryCount, "duplicate receipt delivery does not re-run archival");
    assert.equal(fixture.effectWrites, 1);
  } finally {
    await fixture.close();
  }
}

async function halfReceiptWaitsForCompleteUtf8Line() {
  const fixture = createFixture();
  try {
    const stored = await prepareWrittenLetter(fixture);
    const receiptLine = makeReceiptLine({ token: stored.receiptToken, date: "1038年4月4日" });
    fs.appendFileSync(fixture.debugLogPath, receiptLine, "utf8");
    const restored = fixture.createManager();
    const incomplete = await restored.recoverPendingLetterReceipt();

    assert.equal(incomplete.status, "NO_VERIFIABLE_RECEIPT", "a final unterminated receipt is not complete evidence");
    assert.equal(restored.awaitingAcceptanceLetterId, fixture.originalLetter.letterId);
    assert.equal(fixture.summaryCalls.length, 0);

    fs.appendFileSync(fixture.debugLogPath, "\n", "utf8");
    const completed = await restored.recoverPendingLetterReceipt();
    assert.equal(completed.status, "RECOVERED_VERIFIED", "the same Chinese-date receipt becomes eligible after its newline arrives");
    await waitFor(() => fixture.summaryCalls.length > 0, "completed UTF-8 receipt starts archival");
    assert.equal(fixture.effectWrites, 1, "completing a receipt line does not replay the Effect");
  } finally {
    await fixture.close();
  }
}

async function physicallyTruncatedReceiptDoesNotRecover() {
  const fixture = createFixture();
  try {
    const stored = await prepareWrittenLetter(fixture);
    const receiptLine = makeReceiptLine({ token: stored.receiptToken, date: "1038年4月4日" });
    const before = fs.statSync(fixture.debugLogPath);
    fs.appendFileSync(fixture.debugLogPath, `${receiptLine}\n`, "utf8");
    const truncatedSize = stored.receiptSessionProof.dispatchOffset + Buffer.byteLength(receiptLine, "utf8") - 5;
    fs.truncateSync(fixture.debugLogPath, truncatedSize);
    const after = fs.statSync(fixture.debugLogPath);
    assert.equal(`${before.birthtimeMs}:${before.ino}:${before.dev}`, `${after.birthtimeMs}:${after.ino}:${after.dev}`,
      "the receipt was physically truncated in place without replacing the log file");

    const restored = fixture.createManager();
    const result = await restored.recoverPendingLetterReceipt();

    assert.equal(result.status, "NO_VERIFIABLE_RECEIPT", "an in-place truncated receipt without its terminating newline is not evidence");
    assert.equal(restored.awaitingAcceptanceLetterId, fixture.originalLetter.letterId);
    assert.equal(restored.getLetterStatus(fixture.originalLetter.letterId).responseStatus, "effect_file_written");
    assert.equal(fixture.summaryCalls.length, 0);
    assert.equal(fixture.effectWrites, 1, "truncation cannot trigger another Effect write");
  } finally {
    await fixture.close();
  }
}

async function replacedLoadInSamePhysicalLogInvalidatesProof() {
  const fixture = createFixture();
  try {
    const stored = await prepareWrittenLetter(fixture);
    const receiptLine = makeReceiptLine({ token: stored.receiptToken });
    const before = fs.statSync(fixture.debugLogPath);
    const original = fs.readFileSync(fixture.debugLogPath, "utf8");
    const replaced = original.replace(LOAD_LINE, "VOTC:LOAD_SESSION/;/fix5-independent-loax");
    assert.equal(Buffer.byteLength(replaced, "utf8"), Buffer.byteLength(original, "utf8"), "replacement LOAD preserves the dispatch offset");
    fs.writeFileSync(fixture.debugLogPath, replaced, "utf8");
    fs.appendFileSync(fixture.debugLogPath, `${receiptLine}\n`, "utf8");
    const after = fs.statSync(fixture.debugLogPath);
    assert.equal(`${before.birthtimeMs}:${before.ino}:${before.dev}`, `${after.birthtimeMs}:${after.ino}:${after.dev}`,
      "the LOAD marker was replaced in place without creating a new physical log");

    const restored = fixture.createManager();
    const result = await restored.recoverPendingLetterReceipt();

    assert.equal(result.status, "AMBIGUOUS_OR_STALE", "a same-file replacement LOAD invalidates the original dispatch-session proof");
    assert.equal(result.reason, "RECEIPT_SESSION_CHANGED");
    assert.equal(restored.awaitingAcceptanceLetterId, fixture.originalLetter.letterId);
    assert.equal(restored.getLetterStatus(fixture.originalLetter.letterId).responseStatus, "effect_file_written");
    assert.equal(fixture.summaryCalls.length, 0);
    assert.equal(fixture.effectWrites, 1, "a replacement LOAD cannot replay the Effect");
  } finally {
    await fixture.close();
  }
}

async function incompleteNewLoadMakesReceiptAmbiguous() {
  const fixture = createFixture();
  try {
    const stored = await prepareWrittenLetter(fixture);
    const receiptLine = makeReceiptLine({ token: stored.receiptToken, date: "1038年4月4日" });
    fs.appendFileSync(fixture.debugLogPath, `${receiptLine}\nVOTC:LOAD_SESSION/;/partially-written`, "utf8");
    const restored = fixture.createManager();
    const result = await restored.recoverPendingLetterReceipt();

    assert.notEqual(result.status, "RECOVERED_VERIFIED", "an unterminated LOAD marker makes session ownership unknown");
    assert.equal(restored.awaitingAcceptanceLetterId, fixture.originalLetter.letterId);
    assert.equal(restored.getLetterStatus(fixture.originalLetter.letterId).responseStatus, "effect_file_written");
    assert.equal(fixture.summaryCalls.length, 0, "ambiguous session evidence cannot start archival");
    assert.equal(fixture.effectWrites, 1, "ambiguous session evidence never resends the Effect");
  } finally {
    await fixture.close();
  }
}

async function malformedReceiptFieldsDoNotRecover() {
  const fixture = createFixture();
  try {
    const stored = await prepareWrittenLetter(fixture);
    const malformed = [
      makeReceiptLine({ token: "G".repeat(32) }),
      makeReceiptLine({ token: stored.receiptToken, campaignToken: "another-campaign" }),
      makeReceiptLine({ token: stored.receiptToken, letterId: "another-letter" }),
      makeReceiptLine({ token: stored.receiptToken, playerId: 99 }),
      makeReceiptLine({ token: stored.receiptToken, aiId: 98 }),
      makeReceiptLine({ token: stored.receiptToken, totalDays: 102 }),
      makeReceiptLine({ token: stored.receiptToken, date: "not-a-date" }),
      makeReceiptLine({ token: stored.receiptToken, date: "1038.99.99" })
    ];
    fs.appendFileSync(fixture.debugLogPath, `${malformed.join("\n")}\n`, "utf8");

    const restored = fixture.createManager();
    const result = await restored.recoverPendingLetterReceipt();

    assert.equal(result.status, "NO_VERIFIABLE_RECEIPT", "invalid token, campaign, IDs, expected day, and dates are not acceptance evidence");
    assert.equal(restored.awaitingAcceptanceLetterId, fixture.originalLetter.letterId);
    assert.equal(restored.getLetterStatus(fixture.originalLetter.letterId).responseStatus, "effect_file_written");
    assert.equal(fixture.summaryCalls.length, 0);
    assert.equal(fixture.effectWrites, 1, "malformed receipt candidates never replay the Effect");
  } finally {
    await fixture.close();
  }
}

async function currentCampaignMismatchRejectsReceiptRecovery() {
  const fixture = createFixture();
  try {
    const stored = await prepareWrittenLetter(fixture);
    fs.appendFileSync(fixture.debugLogPath, `${makeReceiptLine({ token: stored.receiptToken })}\n`, "utf8");
    fixture.setParsedGameData(fixture.makeGameData({ campaignToken: "votc8c-202610080002" }));

    const restored = fixture.createManager();
    const result = await restored.recoverPendingLetterReceipt();

    assert.equal(result.status, "AMBIGUOUS_OR_STALE", "a receipt is not recoverable when the current game campaign differs from its stored binding");
    assert.equal(result.reason, "RECEIPT_CAMPAIGN_UNPROVEN");
    assert.equal(restored.awaitingAcceptanceLetterId, fixture.originalLetter.letterId);
    assert.equal(fixture.summaryCalls.length, 0);
    assert.equal(fixture.effectWrites, 1);
  } finally {
    await fixture.close();
  }
}

async function runAckOnlyIsNotLetterAcceptance() {
  const fixture = createFixture();
  try {
    await prepareWrittenLetter(fixture);
    fs.appendFileSync(fixture.debugLogPath, "VOTC:RUN_ACK/letter-command/letter-token\n", "utf8");

    const restored = fixture.createManager();
    const result = await restored.recoverPendingLetterReceipt();

    assert.equal(result.status, "NO_VERIFIABLE_RECEIPT", "RUN_ACK confirms command handling but cannot substitute for a game-side letter receipt");
    assert.equal(restored.awaitingAcceptanceLetterId, fixture.originalLetter.letterId);
    assert.equal(restored.getLetterStatus(fixture.originalLetter.letterId).responseStatus, "effect_file_written");
    assert.equal(fixture.summaryCalls.length, 0);
    assert.equal(fixture.effectWrites, 1);
  } finally {
    await fixture.close();
  }
}

async function missingSessionProofFailsClosed() {
  const fixture = createFixture();
  try {
    const stored = await prepareWrittenLetter(fixture);
    delete stored.receiptSessionProof;
    assert.equal(fixture.manager.savePendingLetters(), true);
    fs.appendFileSync(fixture.debugLogPath, `${makeReceiptLine({ token: stored.receiptToken })}\n`, "utf8");

    const restored = fixture.createManager();
    const result = await restored.recoverPendingLetterReceipt();

    assert.equal(result.status, "AMBIGUOUS_OR_STALE", "a matching token without its dispatch-session proof cannot be auto-accepted after restart");
    assert.equal(result.reason, "RECEIPT_SESSION_UNPROVEN");
    assert.equal(restored.awaitingAcceptanceLetterId, fixture.originalLetter.letterId);
    assert.equal(fixture.summaryCalls.length, 0);
    assert.equal(fixture.effectWrites, 1);
  } finally {
    await fixture.close();
  }
}

async function recoveryScanBudgetFailsClosed() {
  const fixture = createFixture();
  try {
    const stored = await prepareWrittenLetter(fixture);
    const receiptLine = makeReceiptLine({ token: stored.receiptToken });
    const fillerLine = Buffer.from(`${"x".repeat(65535)}\n`, "ascii");
    fs.appendFileSync(fixture.debugLogPath, `${receiptLine}\n`, "utf8");
    const filler = Buffer.alloc(fillerLine.length * 513);
    for (let offset = 0; offset < filler.length; offset += fillerLine.length) fillerLine.copy(filler, offset);
    fs.appendFileSync(fixture.debugLogPath, filler);

    const restored = fixture.createManager();
    const result = await restored.recoverPendingLetterReceipt();

    assert.equal(result.status, "NO_VERIFIABLE_RECEIPT", "a valid-looking receipt beyond the bounded recovery scan cannot be accepted");
    assert.equal(result.reason, "RECOVERY_SCAN_BUDGET_EXCEEDED");
    assert.equal(restored.awaitingAcceptanceLetterId, fixture.originalLetter.letterId);
    assert.equal(fixture.summaryCalls.length, 0);
    assert.equal(fixture.effectWrites, 1);
  } finally {
    await fixture.close();
  }
}

async function acceptedProofResumesAfterCrashBeforeFinalization() {
  const fixture = createFixture();
  try {
    const manager = fixture.manager;
    const stored = await prepareWrittenLetter(fixture, { manager });
    const receiptLine = makeReceiptLine({ token: stored.receiptToken });
    fs.appendFileSync(fixture.debugLogPath, `${receiptLine}\n`, "utf8");

    manager.recordAcceptedLetterDisclosure = async () => { throw new Error("synthetic_crash_after_acceptance_proof"); };
    await assert.rejects(manager.processLogLine(receiptLine), /synthetic_crash_after_acceptance_proof/);
    const durable = JSON.parse(fs.readFileSync(fixture.pendingPath, "utf8"));
    const durableLetter = durable.letters.find(row => row.letter?.letterId === fixture.originalLetter.letterId);
    assert.equal(durable.awaitingAcceptanceLetterId, null, "acceptance proof is committed before the crash point");
    assert.equal(durableLetter.acceptedReceiptRecorded, true);
    assert.equal(durableLetter.status.responseStatus, "sent");
    assert.equal(durableLetter.acceptedMemoryContext, undefined, "finalization has not started at this crash point");

    const restored = fixture.createManager();
    assert.equal(restored.awaitingAcceptanceLetterId, null, "restart does not need the cleared acceptance lock");
    await restored.recoverPendingLetterReceipt();
    await waitFor(() => fixture.summaryCalls.length > 0, "persisted acceptance proof resumes archival after restart");
    assert.equal(fixture.effectWrites, 1, "crash recovery does not recreate the Artifact Effect");
    assert.equal(restored.awaitingAcceptanceLetterId, null);

    const summaryCount = fixture.summaryCalls.length;
    const again = fixture.createManager();
    await again.recoverPendingLetterReceipt();
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal(fixture.summaryCalls.length, summaryCount, "resuming a committed proof is idempotent across another restart");
    assert.equal(fixture.effectWrites, 1);
  } finally {
    await fixture.close();
  }
}

function makeDerivedFixture(responseText) {
  const calls = [];
  const service = new Memory4DerivedService({ store: {}, baseStore: {} });
  service.configure({
    estimateTokens: text => String(text).length,
    requestCompression: async (messages, options) => {
      calls.push({ messages, options });
      const request = JSON.parse(messages[1].content);
      const sourceEntryIds = request.items.flatMap(item => item.sourceEntryIds);
      return JSON.stringify({ items: [{ text: responseText, sourceEntryIds }] });
    }
  });
  return { service, calls };
}

function derivedEntry(entryId, text) {
  return {
    entryId, text, importance: 1, entityIds: [], topics: [],
    evidence: { sourceType: "fact", epistemicStatus: "reported" },
    state: { status: "active" },
    eventTime: { from: "1164.1.1", to: "1164.12.31", precision: "year", status: "reported" },
    acquiredDate: "1164.1.1"
  };
}

function derivedItem(entry) {
  return { itemId: `item_${entry.entryId}`, text: entry.text, sourceEntryIds: [entry.entryId],
    entityIds: [], topics: [], importance: 1 };
}

async function lifeBudgetRetainsSourcesBetweenYearAndLifeLimits() {
  const first = derivedEntry("life_source_1", "a".repeat(700));
  const second = derivedEntry("life_source_2", "b".repeat(700));
  const { service, calls } = makeDerivedFixture("c".repeat(900));
  const result = await service.compress({ campaignToken: "qa-campaign", ownerId: 2 }, "life",
    [derivedItem(first), derivedItem(second)], [first, second],
    { cancelled: false, controller: { signal: null } }, null);

  assert.equal(calls.length, 1, "1401 LIFE input tokens must compress even though they fit the YEAR cap");
  assert.match(calls[0].messages[0].content, /fit 700 tokens and never exceed 1000/i);
  assert.deepEqual(result[0].sourceEntryIds, [first.entryId, second.entryId], "compressed LIFE output retains each source exactly once");
  assert.equal(result[0].timeAxis, "event");
}

async function lifeHardLimitRejectsOverageAndYearAcceptsItsOwnRange() {
  const entry = derivedEntry("budget_boundary_source", "s".repeat(1800));
  const items = [derivedItem(entry)];
  const lifeOver = makeDerivedFixture("l".repeat(1001));
  await assert.rejects(lifeOver.service.compress({ campaignToken: "qa-campaign", ownerId: 2 }, "life", items, [entry],
    { cancelled: false, controller: { signal: null } }, null), error => error.message === "memory4_compression_quality_failed");

  const yearAllowed = makeDerivedFixture("y".repeat(1450));
  const yearResult = await yearAllowed.service.compress({ campaignToken: "qa-campaign", ownerId: 2 }, "year", items, [entry],
    { cancelled: false, controller: { signal: null } }, null);
  assert.equal(yearAllowed.calls.length, 1);
  assert.equal(yearResult[0].text.length, 1450);
  assert.deepEqual(yearResult[0].sourceEntryIds, [entry.entryId]);

  const lostSource = makeDerivedFixture("z".repeat(900));
  lostSource.service.options.requestCompression = async () => JSON.stringify({ items: [{ text: "compressed", sourceEntryIds: ["wrong_source"] }] });
  await assert.rejects(lostSource.service.compress({ campaignToken: "qa-campaign", ownerId: 2 }, "year", items, [entry],
    { cancelled: false, controller: { signal: null } }, null), error => error.message === "memory4_compression_source_mismatch");
}

async function dateScannerCountsUtf8BytesAcrossChunks() {
  const fixture = createFixture();
  try {
    const manager = fixture.manager;
    manager.dateSessionScanner.chunkBytes = 5;
    const prefix = "中文🐉 marker lead\n";
    const logText = `${prefix}${LOAD_LINE}\nVOTC:DATE/;/395231\n`;
    fs.writeFileSync(fixture.debugLogPath, logText, "utf8");

    const result = await manager.scanLatestDateMarker();

    assert.equal(result.found, true);
    assert.equal(result.value, 395231);
    assert.equal(result.sessionBoundaryOffset, Buffer.byteLength(prefix, "utf8"), "session offsets count source bytes across split UTF-8 characters");
    assert.equal(result.scan.mode, "COLD_RECOVERY");

    fs.appendFileSync(fixture.debugLogPath, "VOTC:DATE/;/395232\n", "utf8");
    const appended = await manager.scanLatestDateMarker();
    assert.equal(appended.value, 395232);
    assert.equal(appended.scan.mode, "INCREMENTAL");
  } finally {
    await fixture.close();
  }
}

async function partialNewLoadCannotAdvanceDateFromOldSession() {
  const fixture = createFixture();
  try {
    const manager = fixture.manager;
    manager.dateSessionScanner.chunkBytes = 7;
    fs.writeFileSync(fixture.debugLogPath,
      `${LOAD_LINE}\nVOTC:DATE/;/395239\nVOTC:LOAD_SESSION/;/partially-written`, "utf8");
    const updates = [];
    manager.updateCurrentDate = totalDays => {
      updates.push(totalDays);
      return Promise.resolve();
    };

    await manager.processLogLine("VOTC:DATE/;/395239");

    assert.deepEqual(updates, [], "an unterminated newer LOAD marker makes the preceding session date unusable");
    assert.equal(manager.lastObservedDateValue, null);
  } finally {
    await fixture.close();
  }
}

async function completedPartialLoadRecoversNewSessionDate() {
  const fixture = createFixture();
  try {
    const manager = fixture.manager;
    manager.dateSessionScanner.chunkBytes = 7;
    fs.writeFileSync(fixture.debugLogPath, `${LOAD_LINE}\nVOTC:DATE/;/395239\n`, "utf8");
    const prior = await manager.scanLatestDateMarker();
    assert.equal(prior.found, true);
    assert.equal(prior.sessionId, "fix5-independent-load");
    assert.equal(prior.value, 395239);

    const partial = "VOTC:LOAD_SESSION/;/new-session-frag";
    fs.appendFileSync(fixture.debugLogPath, partial, "utf8");
    const incomplete = await manager.scanLatestDateMarker();
    assert.equal(incomplete.reason, "scan_invalidated", "the incomplete LOAD marker invalidates the previous session view");
    assert.equal(incomplete.sessionId, null);
    assert.equal(manager.lastDateScanResult.reason, "scan_invalidated");
    assert(incomplete.scan.bytesRead <= 256 + Buffer.byteLength(partial, "utf8"), "partial detection rereads only the anchor and appended bytes");

    const suffix = "ment-complete\nVOTC:DATE/;/395241\n";
    fs.appendFileSync(fixture.debugLogPath, suffix, "utf8");
    const completed = await manager.scanLatestDateMarker();

    assert.equal(completed.found, true);
    assert.equal(completed.sessionId, "new-session-fragment-complete");
    assert.equal(completed.value, 395241, "only the completed new session's date is returned");
    assert.equal(completed.scan.mode, "INCREMENTAL", "the scanner completes the retained partial LOAD carry on the next chunk");
    assert(completed.scan.bytesRead <= 256 + Buffer.byteLength(suffix, "utf8"), "completion reads only the anchor and appended bytes");
    assert.equal(completed.scan.resetReason, null);
    assert(completed.sessionBoundaryOffset > prior.sessionBoundaryOffset, "the completed LOAD establishes a newer session boundary");
    assert.equal(completed.previousSessionId, "fix5-independent-load");
    assert.notEqual(completed.value, prior.value, "the old session's date is not carried into the new session");
  } finally {
    await fixture.close();
  }
}

async function rotatedScannerCannotWriteFirstLetterEffect() {
  const fixture = createFixture();
  try {
    const manager = fixture.manager;
    manager.dateSessionScanner.chunkBytes = 7;
    const primed = await manager.scanLatestDateMarker();
    assert.equal(primed.found, false, "the fixture primes the scanner on the original physical log");
    const originalStat = fs.statSync(fixture.debugLogPath);

    fs.renameSync(fixture.debugLogPath, `${fixture.debugLogPath}.before-first-effect`);
    fs.writeFileSync(fixture.debugLogPath, `${LOAD_LINE}\nVOTC:DATE/;/100\n`, "utf8");
    const replacementStat = fs.statSync(fixture.debugLogPath);
    assert.notEqual(`${originalStat.birthtimeMs}:${originalStat.ino}:${originalStat.dev}`,
      `${replacementStat.birthtimeMs}:${replacementStat.ino}:${replacementStat.dev}`, "the debug log is now a different physical file");

    pendingLetter(fixture, manager, fixture.originalLetter, "隔离测试回信：已妥善收存。", 103);
    const written = await manager.writeLetterEffect("隔离测试回信：已妥善收存。", fixture.originalLetter);

    assert.equal(written, false, "an invalidated proof scan must stop the first Effect write");
    assert.equal(fixture.effectWrites, 0, "the new physical log is not grounds to dispatch without a session proof");
    assert.equal(manager.awaitingAcceptanceLetterId, null, "a failed first write must not acquire the acceptance lock");
    assert.equal(manager.storedLetters.has(fixture.originalLetter.letterId), true, "the pending letter remains available for a later safe attempt");
    assert.equal(manager.getLetterStatus(fixture.originalLetter.letterId).responseStatus, "pending_delivery");
    assert.equal(fixture.summaryCalls.length, 0, "no receipt archival runs without a dispatched Effect");
  } finally {
    await fixture.close();
  }
}

async function oldReaderDateCallbackCannotPublishAfterRotation() {
  const fixture = createFixture();
  const manager = fixture.manager;
  try {
    const oldReader = {};
    const nextReader = {};
    manager.tailFile = oldReader;
    manager.tailState = "ACTIVE";
    manager.dateSessionScanner.chunkBytes = 7;
    const oldText = `${"前置文字🧭\n"}${LOAD_LINE}\nVOTC:DATE/;/395240\n`;
    fs.writeFileSync(fixture.debugLogPath, oldText, "utf8");
    const initial = await manager.scanLatestDateMarker();
    assert.equal(initial.value, 395240);
    manager.beginDateSessionFromScan(initial.sessionId, initial);
    manager.currentTotalDays = 0;

    const originalScan = manager.scanLatestDateMarker.bind(manager);
    let scanFinished;
    let releaseScan;
    const scanHasFinished = new Promise(resolve => { scanFinished = resolve; });
    const release = new Promise(resolve => { releaseScan = resolve; });
    manager.scanLatestDateMarker = async () => {
      const result = await originalScan();
      scanFinished();
      await release;
      return result;
    };
    const dateUpdates = [];
    manager.updateCurrentDate = totalDays => {
      dateUpdates.push(totalDays);
      manager.currentTotalDays = totalDays;
      return Promise.resolve();
    };

    const bufferedCallback = manager.processLogLine("VOTC:DATE/;/395240", oldReader);
    await scanHasFinished;
    const oldPath = `${fixture.debugLogPath}.before-rotation`;
    fs.renameSync(fixture.debugLogPath, oldPath);
    fs.writeFileSync(fixture.debugLogPath, `${"新日志🧭\n"}${LOAD_LINE}\nVOTC:DATE/;/395240\n`, "utf8");
    manager.resetDateSession();
    manager.captureDebugLogMetadata();
    manager.tailFile = nextReader;
    manager.tailState = "ACTIVE";
    releaseScan();
    await bufferedCallback;

    assert.deepEqual(dateUpdates, [], "a callback from the old reader cannot update date after the scan await");
    assert.equal(manager.currentTotalDays, 0, "the replacement log cannot inherit the old callback's date");
    assert.equal(manager.lastObservedDateValue, null);

    const replacement = await manager.scanLatestDateMarker();
    assert.equal(replacement.found, true);
    assert.equal(replacement.value, 395240);
    assert.equal(replacement.sessionId, "fix5-independent-load");
    assert.notEqual(replacement.logIdentity, initial.logIdentity, "the replacement file is a new physical identity");
  } finally {
    manager.tailFile = null;
    await fixture.close();
  }
}

async function run() {
  const cases = [
    ["replacement physical file", rejectsRotatedPhysicalLog],
    ["same-token newer LOAD boundary", rejectsReceiptBeforeSameTokenNewLoad],
    ["acceptance proof persistence failure", failedAcceptanceProofPersistenceRetainsOldState],
    ["late receipt and next lock", delayedReceiptCannotConsumeNextAcceptanceLock],
    ["live and recovery race", concurrentLiveAndRecoveryReceiptIsSingleAcceptance],
    ["half UTF-8 receipt line", halfReceiptWaitsForCompleteUtf8Line],
    ["in-place truncated receipt", physicallyTruncatedReceiptDoesNotRecover],
    ["same-file replacement LOAD", replacedLoadInSamePhysicalLogInvalidatesProof],
    ["partial new LOAD boundary", incompleteNewLoadMakesReceiptAmbiguous],
    ["malformed receipt fields", malformedReceiptFieldsDoNotRecover],
    ["current campaign mismatch", currentCampaignMismatchRejectsReceiptRecovery],
    ["RUN_ACK only", runAckOnlyIsNotLetterAcceptance],
    ["missing session proof", missingSessionProofFailsClosed],
    ["recovery scan budget", recoveryScanBudgetFailsClosed],
    ["persisted acceptance crash recovery", acceptedProofResumesAfterCrashBeforeFinalization],
    ["LIFE cap and source retention", lifeBudgetRetainsSourcesBetweenYearAndLifeLimits],
    ["independent YEAR and LIFE limits", lifeHardLimitRejectsOverageAndYearAcceptsItsOwnRange],
    ["UTF-8 chunked DATE offsets", dateScannerCountsUtf8BytesAcrossChunks],
    ["partial LOAD cannot advance old DATE", partialNewLoadCannotAdvanceDateFromOldSession],
    ["completed partial LOAD recovers new date", completedPartialLoadRecoversNewSessionDate],
    ["rotated scanner blocks first Effect", rotatedScannerCannotWriteFirstLetterEffect],
    ["rotated old-reader DATE callback", oldReaderDateCallbackCannotPublishAfterRotation]
  ];
  const failures = [];
  for (const [name, test] of cases) {
    try {
      await test();
      console.log(`PASS ${name}`);
    } catch (error) {
      failures.push({ name, error });
      console.error(`FAIL ${name}: ${error.stack || error}`);
    }
  }
  if (failures.length) process.exitCode = 1;
  else console.log(`V8.15.2 fix5 independent adversarial QA: PASS (${cases.length} cases)`);
}

if (require.main === module) run().catch(error => { console.error(error); process.exitCode = 1; });

module.exports = { run };
