"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const { createLetterManager } = require("../resources/app/out/main/letters/letter-manager");

const LOG_PATH = path.join("C:\\synthetic-votc", "debug.log");

function createReadOnlyMemoryFs(logText) {
  const complete = value => value.endsWith("\n") ? value : `${value}\n`;
  let bytes = Buffer.from(complete(logText), "utf8");
  let identity = "1:7";
  let mtimeMs = 1000;
  let openCount = 0;
  let available = true;
  return {
    append(text) {
      bytes = Buffer.concat([bytes, Buffer.from(complete(text), "utf8")]);
      mtimeMs++;
    },
    replace(text, { nextIdentity = identity } = {}) {
      bytes = Buffer.from(complete(text), "utf8");
      identity = nextIdentity;
      mtimeMs++;
    },
    setAvailable(value) { available = value; },
    existsSync(file) { return available && file === LOG_PATH; },
    statSync(file) {
      assert.equal(file, LOG_PATH);
      if (!available) throw Object.assign(new Error("missing fixture log"), { code: "ENOENT" });
      const [birthtimeMs, ino] = identity.split(":").map(Number);
      return { size: bytes.length, mtimeMs, birthtimeMs, ino };
    },
    openSync(file) {
      assert.equal(file, LOG_PATH);
      openCount++;
      return 1;
    },
    readSync(fd, target, offset, length, position) {
      assert.equal(fd, 1);
      const count = Math.max(0, Math.min(length, bytes.length - position));
      bytes.copy(target, offset, position, position + count);
      return count;
    },
    closeSync(fd) { assert.equal(fd, 1); },
    get openCount() { return openCount; }
  };
}

function createManager({ logText, runFileManager = null, dateChunkBytes = 64 * 1024 } = {}) {
  const fs = createReadOnlyMemoryFs(logText);
  const letterEffectTransport = {
    ensureDateProducerFile() { return { success: true, effectFilePath: null }; }
  };
  const { LetterManager } = createLetterManager({
    settingsRepository: {
      getCK3UserFolderPath: () => null,
      getCK3DebugLogPath: () => LOG_PATH
    },
    fs,
    path,
    TailFile: null,
    readline: null,
    parseLog: null,
    letterPromptBuilder: {},
    llmManager: {},
    PromptBuilder: {},
    TokenCounter: {},
    memoryEngine: {},
    dataDir: null,
    letterEffectTransport,
    runFileManager,
    autoStartLogTailing: false,
    setIntervalFn: () => null,
    clearIntervalFn: () => null
  });
  const manager = new LetterManager();
  manager.dateSessionScanner.chunkBytes = dateChunkBytes;
  return { manager, fs, logSize: fs.statSync(LOG_PATH).size };
}

async function staleDateDoesNotCrossLoadBoundary() {
  const staleDay = 395233;
  const logText = [
    `VOTC:DATE/;/${staleDay}`,
    "VOTC:LOAD_SESSION/;/votc-load-2"
  ].join("\n");
  const { manager } = createManager({ logText });

  const result = await manager.reconcileLatestDateMarker("synthetic_load_boundary_audit");

  assert.equal(result.lastDateScanResult.found, false,
    "a DATE marker before the latest LOAD_SESSION must not be accepted");
  assert.equal(manager.getCurrentTotalDays(), 0,
    "an old session date must not advance the current game date");
}

async function freshDateAfterLoadBoundaryAdvances() {
  const freshDay = 395234;
  const logText = [
    "VOTC:LOAD_SESSION/;/votc-load-2",
    `VOTC:DATE/;/${freshDay}`
  ].join("\n");
  const { manager } = createManager({ logText });

  const result = await manager.reconcileLatestDateMarker("synthetic_fresh_session_audit");

  assert.equal(result.lastDateScanResult.found, true);
  assert.equal(result.lastDateScanResult.value, freshDay);
  assert.equal(manager.getCurrentTotalDays(), freshDay);
}

async function duplicateBoundaryDoesNotClearObservedDate() {
  const day = 395235;
  const { manager } = createManager({
    logText: [
      "VOTC:LOAD_SESSION/;/votc-load-2",
      `VOTC:DATE/;/${day}`
    ].join("\n")
  });

  await manager.processLogLine("VOTC:LOAD_SESSION/;/votc-load-2");
  await manager.processLogLine(`VOTC:DATE/;/${day}`);
  const observedAt = manager.lastObservedDateMarkerAt;
  const boundaryOffset = manager.dateSessionBoundaryOffset;
  await manager.processLogLine("VOTC:LOAD_SESSION/;/votc-load-2");

  assert.equal(manager.getCurrentTotalDays(), day,
    "re-delivery of the same physical boundary must not reset the current date");
  assert.equal(manager.lastObservedDateValue, day);
  assert.equal(manager.lastObservedDateMarkerAt, observedAt);
  assert.equal(manager.dateSessionBoundaryOffset, boundaryOffset);
}

async function sameTokenPhysicalLoadOutsideTailStartsNewSession() {
  const latestDay = 395238;
  const logText = [
    "VOTC:LOAD_SESSION/;/votc-load-2",
    "VOTC:DATE/;/395237",
    "x".repeat(200),
    `VOTC:DATE/;/${latestDay}`,
    "VOTC:LOAD_SESSION/;/votc-load-2",
    "x".repeat(200)
  ].join("\n");
  const { manager } = createManager({ logText, dateChunkBytes: 100 });

  const result = await manager.reconcileLatestDateMarker("synthetic_duplicate_tail_audit");

  assert.equal(result.lastDateScanResult.found, false,
    "a later physical LOAD_SESSION with the same token must start a new session");
  assert.equal(result.lastDateScanResult.reason, "date_marker_missing");
  assert.equal(manager.getCurrentTotalDays(), 0,
    "a date before the latest physical load must not advance the new session");
  assert.equal(manager.dateSessionBoundaryOffset,
    Buffer.byteLength(logText.slice(0, logText.lastIndexOf("VOTC:LOAD_SESSION/;/votc-load-2")), "utf8"),
    "reverse scanning must keep the latest physical same-token boundary offset");
}

async function appendedSameTokenPhysicalLoadClearsObservedDate() {
  const day = 395238;
  const { manager, fs } = createManager({
    logText: [
      "VOTC:LOAD_SESSION/;/votc-load-2",
      `VOTC:DATE/;/${day}`
    ].join("\n")
  });

  await manager.processLogLine("VOTC:LOAD_SESSION/;/votc-load-2");
  await manager.processLogLine(`VOTC:DATE/;/${day}`);
  const oldBoundaryOffset = manager.dateSessionBoundaryOffset;
  fs.append("\nVOTC:LOAD_SESSION/;/votc-load-2");
  await manager.processLogLine("VOTC:LOAD_SESSION/;/votc-load-2");

  assert.ok(manager.dateSessionBoundaryOffset > oldBoundaryOffset,
    "a later physical boundary must advance its byte offset even when the token repeats");
  assert.equal(manager.getCurrentTotalDays(), 0,
    "a newly appended same-token boundary must clear the preceding session date");
  assert.equal(manager.lastObservedDateValue, null);

  const freshDay = day + 1;
  fs.append(`\nVOTC:DATE/;/${freshDay}`);
  await manager.processLogLine(`VOTC:DATE/;/${freshDay}`);
  assert.equal(manager.getCurrentTotalDays(), freshDay,
    "a fresh date after the same-token load must advance normally");
}

async function delayedOldDateAfterSameTokenLoadIsRejected() {
  const oldDay = 395239;
  const { manager, fs } = createManager({
    logText: [
      "VOTC:LOAD_SESSION/;/votc-load-2",
      `VOTC:DATE/;/${oldDay}`
    ].join("\n")
  });
  const pendingLetter = { letter: { letterId: "pending-stale-date", totalDays: oldDay }, reply: "unchanged" };

  await manager.processLogLine("VOTC:LOAD_SESSION/;/votc-load-2");
  await manager.processLogLine(`VOTC:DATE/;/${oldDay}`);
  const oldBoundaryOffset = manager.dateSessionBoundaryOffset;
  manager.storedLetters.set("pending-stale-date", pendingLetter);
  manager.awaitingAcceptanceLetterId = "pending-stale-date";
  let deliveryChecks = 0;
  manager.checkAndDeliverLetters = () => {
    deliveryChecks++;
    return Promise.resolve();
  };

  fs.append("\nVOTC:LOAD_SESSION/;/votc-load-2");
  await manager.processLogLine(`VOTC:DATE/;/${oldDay}`);

  assert.ok(manager.dateSessionBoundaryOffset > oldBoundaryOffset,
    "the delayed DATE should bind the observed newer physical load boundary");
  assert.equal(manager.getCurrentTotalDays(), 0,
    "a DATE from before the current same-token load must not restore the old day");
  assert.equal(manager.lastObservedDateValue, null);
  assert.equal(deliveryChecks, 0,
    "a stale DATE must not enter the letter-delivery check");
  assert.equal(manager.storedLetters.get("pending-stale-date"), pendingLetter,
    "pending letter state must remain untouched");
  assert.equal(manager.awaitingAcceptanceLetterId, "pending-stale-date",
    "the acceptance lock must remain untouched");
}

async function startupRejectsDateBeforeExistingPhysicalLoad() {
  const staleDay = 395240;
  const { manager, fs } = createManager({
    logText: [
      "VOTC:LOAD_SESSION/;/votc-load-2",
      `VOTC:DATE/;/${staleDay}`
    ].join("\n")
  });
  const pendingLetter = { letter: { letterId: "startup-pending", totalDays: staleDay }, reply: "unchanged" };
  manager.storedLetters.set("startup-pending", pendingLetter);
  manager.awaitingAcceptanceLetterId = "startup-pending";
  let deliveryChecks = 0;
  manager.checkAndDeliverLetters = () => {
    deliveryChecks++;
    return Promise.resolve();
  };
  fs.append("\nVOTC:LOAD_SESSION/;/votc-load-2");

  await manager.processLogLine(`VOTC:DATE/;/${staleDay}`);

  assert.equal(manager.dateSessionId, "votc-load-2",
    "startup must bind the physical current session before validating a tail DATE");
  assert.equal(manager.getCurrentTotalDays(), 0);
  assert.equal(manager.lastObservedDateValue, null);
  assert.equal(deliveryChecks, 0);
  assert.equal(manager.storedLetters.get("startup-pending"), pendingLetter);
  assert.equal(manager.awaitingAcceptanceLetterId, "startup-pending");
}

async function dateWithoutPhysicalLoadKeepsLegacyBehavior() {
  const legacyDay = 395241;
  const { manager } = createManager({ logText: `VOTC:DATE/;/${legacyDay}` });

  await manager.processLogLine(`VOTC:DATE/;/${legacyDay}`);

  assert.equal(manager.getCurrentTotalDays(), legacyDay,
    "a DATE in a log with no LOAD_SESSION must retain legacy behavior");
}

async function boundSessionRejectsUnverifiableDate() {
  const day = 395242;
  const { manager, fs } = createManager({
    logText: [
      "VOTC:LOAD_SESSION/;/votc-load-2",
      `VOTC:DATE/;/${day}`
    ].join("\n")
  });
  const pendingLetter = { letter: { letterId: "unverifiable-pending", totalDays: day }, reply: "unchanged" };

  await manager.processLogLine("VOTC:LOAD_SESSION/;/votc-load-2");
  await manager.processLogLine(`VOTC:DATE/;/${day}`);
  manager.storedLetters.set("unverifiable-pending", pendingLetter);
  manager.awaitingAcceptanceLetterId = "unverifiable-pending";
  let deliveryChecks = 0;
  manager.checkAndDeliverLetters = () => {
    deliveryChecks++;
    return Promise.resolve();
  };

  fs.setAvailable(false);
  await manager.processLogLine(`VOTC:DATE/;/${day}`);
  fs.setAvailable(true);
  fs.replace(`VOTC:DATE/;/${day}`);
  await manager.processLogLine(`VOTC:DATE/;/${day}`);

  assert.equal(manager.getCurrentTotalDays(), 0,
    "invalidated physical evidence withdraws the old current date and never authorizes the unverifiable callback");
  assert.equal(deliveryChecks, 0,
    "an unreadable or markerless log must not send a bound session's tail date to delivery");
  assert.equal(manager.storedLetters.get("unverifiable-pending"), pendingLetter);
  assert.equal(manager.awaitingAcceptanceLetterId, "unverifiable-pending");
}

async function olderPhysicalLoadTailCannotReplaceCurrentSession() {
  const currentDay = 395243;
  const { manager } = createManager({
    logText: [
      "VOTC:LOAD_SESSION/;/votc-load-1",
      "VOTC:DATE/;/395242",
      "VOTC:LOAD_SESSION/;/votc-load-2",
      `VOTC:DATE/;/${currentDay}`
    ].join("\n")
  });

  await manager.processLogLine("VOTC:LOAD_SESSION/;/votc-load-2");
  await manager.processLogLine(`VOTC:DATE/;/${currentDay}`);
  const currentBoundaryOffset = manager.dateSessionBoundaryOffset;
  await manager.processLogLine("VOTC:LOAD_SESSION/;/votc-load-1");

  assert.equal(manager.dateSessionId, "votc-load-2",
    "a delayed older LOAD_SESSION line must not replace the physical current session");
  assert.equal(manager.dateSessionBoundaryOffset, currentBoundaryOffset,
    "a delayed older LOAD_SESSION line must not move the boundary backward");
  assert.equal(manager.getCurrentTotalDays(), currentDay);
}

async function olderSameTokenScanCannotMoveTailSessionBackward() {
  const oldDay = 395244;
  const currentDay = 395245;
  const { manager } = createManager({
    logText: [
      "VOTC:LOAD_SESSION/;/votc-load-2",
      `VOTC:DATE/;/${oldDay}`,
      "VOTC:LOAD_SESSION/;/votc-load-2",
      `VOTC:DATE/;/${currentDay}`
    ].join("\n")
  });

  await manager.processLogLine("VOTC:LOAD_SESSION/;/votc-load-2");
  await manager.processLogLine(`VOTC:DATE/;/${currentDay}`);
  const latestScan = await manager.scanLatestDateMarker();
  const currentBoundaryOffset = manager.dateSessionBoundaryOffset;
  let deliveryChecks = 0;
  manager.checkAndDeliverLetters = () => {
    deliveryChecks++;
    return Promise.resolve();
  };
  manager.scanLatestDateMarker = async () => ({
      ...latestScan,
      found: true,
      value: oldDay,
      sessionBoundaryOffset: 0
  });

  await manager.processLogLine("VOTC:LOAD_SESSION/;/votc-load-2");
  await manager.processLogLine(`VOTC:DATE/;/${oldDay}`);

  assert.equal(manager.dateSessionBoundaryOffset, currentBoundaryOffset,
    "a stale same-token scan must not move the bound physical boundary backward");
  assert.equal(manager.getCurrentTotalDays(), currentDay,
    "an older same-token DATE scan must be rejected instead of replacing the current date");
  assert.equal(deliveryChecks, 0);
}

async function newBoundaryClearsOldDateAndScanCannotCrossCurrentSession() {
  const oldDay = 395236;
  const { manager, fs } = createManager({
    logText: [
      "VOTC:LOAD_SESSION/;/votc-load-1",
      `VOTC:DATE/;/${oldDay}`
    ].join("\n")
  });

  fs.append("\nVOTC:LOAD_SESSION/;/votc-load-2");
  await manager.processLogLine("VOTC:LOAD_SESSION/;/votc-load-2");
  assert.equal(manager.getCurrentTotalDays(), 0,
    "a distinct load session must discard the prior session's live date");
  assert.equal(manager.lastObservedDateValue, null);

  const result = await manager.reconcileLatestDateMarker("synthetic_stale_scan_audit");
  assert.equal(result.lastDateScanResult.found, false,
    "a scan for another session must not cross the live session boundary");
  assert.equal(manager.getCurrentTotalDays(), 0);
}

async function missedLoadBoundaryRecoversFromLaterScan() {
  const firstDay = 395239;
  const freshDay = 395240;
  const { manager, fs } = createManager({
    logText: [
      "VOTC:LOAD_SESSION/;/votc-load-1",
      `VOTC:DATE/;/${firstDay}`
    ].join("\n")
  });

  await manager.processLogLine("VOTC:LOAD_SESSION/;/votc-load-1");
  await manager.processLogLine(`VOTC:DATE/;/${firstDay}`);
  fs.append([
    "\nVOTC:LOAD_SESSION/;/votc-load-2",
    `VOTC:DATE/;/${freshDay}`
  ].join("\n"));
  manager.captureDebugLogMetadata();

  const result = await manager.reconcileLatestDateMarker("synthetic_missed_load_audit");

  assert.equal(result.lastDateScanResult.found, true);
  assert.equal(result.lastDateScanResult.value, freshDay,
    "a later boundary in the same log must recover when tail missed its line");
  assert.equal(manager.dateSessionId, "votc-load-2");
  assert.equal(manager.getCurrentTotalDays(), freshDay);
}

async function oldBoundaryCannotOverrideNewerTailSession() {
  const currentDay = 395242;
  const { manager, fs } = createManager({
    logText: [
      "VOTC:LOAD_SESSION/;/votc-load-2",
      "VOTC:DATE/;/395241",
      "VOTC:LOAD_SESSION/;/votc-load-1",
      `VOTC:DATE/;/${currentDay}`
    ].join("\n")
  });

  await manager.processLogLine("VOTC:LOAD_SESSION/;/votc-load-1");
  await manager.processLogLine(`VOTC:DATE/;/${currentDay}`);
  const staleLog = [
    "VOTC:LOAD_SESSION/;/votc-load-1",
    "VOTC:DATE/;/395240",
    "VOTC:LOAD_SESSION/;/votc-load-2",
    "VOTC:DATE/;/395241",
    "x".repeat(180)
  ].join("\n");
  fs.replace(staleLog);

  const result = await manager.reconcileLatestDateMarker("synthetic_older_scan_audit");

  assert.equal(result.lastDateScanResult.found, false,
    "a lower byte-offset boundary in the same log must be rejected");
  assert.equal(manager.dateSessionId, "votc-load-1");
  assert.equal(manager.getCurrentTotalDays(), 0,
    "a rewritten log withdraws its previously current date until a valid physical scan recovers");
}

async function replacementAndTruncationRebuildSessionBoundary() {
  const oldDay = 395243;
  const replacementDay = 395244;
  const replacementFixture = createManager({
    logText: [
      "VOTC:LOAD_SESSION/;/votc-load-1",
      `VOTC:DATE/;/${oldDay}`,
      "x".repeat(200)
    ].join("\n")
  });
  await replacementFixture.manager.processLogLine("VOTC:LOAD_SESSION/;/votc-load-1");
  await replacementFixture.manager.processLogLine(`VOTC:DATE/;/${oldDay}`);
  const pendingSentinel = { letter: { letterId: "pending-sentinel", totalDays: oldDay }, reply: "unchanged" };
  replacementFixture.manager.storedLetters.set("pending-sentinel", pendingSentinel);
  replacementFixture.fs.replace([
    "VOTC:LOAD_SESSION/;/votc-load-2",
    `VOTC:DATE/;/${replacementDay}`
  ].join("\n"), { nextIdentity: "2:8" });
  replacementFixture.manager.captureDebugLogMetadata();

  const invalidatedReplacement = await replacementFixture.manager.reconcileLatestDateMarker("synthetic_log_replacement_audit");
  assert.equal(invalidatedReplacement.lastDateScanResult.found, false);
  assert.equal(replacementFixture.manager.getCurrentTotalDays(), 0);
  const replaced = await replacementFixture.manager.reconcileLatestDateMarker("synthetic_log_replacement_recovery");

  assert.equal(replaced.lastDateScanResult.found, true);
  assert.equal(replacementFixture.manager.dateSessionId, "votc-load-2");
  assert.equal(replacementFixture.manager.getCurrentTotalDays(), replacementDay);
  assert.equal(replacementFixture.manager.storedLetters.get("pending-sentinel"), pendingSentinel,
    "session reset must not mutate pending letter state");

  const truncatedFixture = createManager({
    logText: [
      "VOTC:LOAD_SESSION/;/votc-load-3",
      `VOTC:DATE/;/${oldDay}`,
      "x".repeat(200)
    ].join("\n")
  });
  await truncatedFixture.manager.processLogLine("VOTC:LOAD_SESSION/;/votc-load-3");
  await truncatedFixture.manager.processLogLine(`VOTC:DATE/;/${oldDay}`);
  truncatedFixture.fs.replace([
    "VOTC:LOAD_SESSION/;/votc-load-4",
    `VOTC:DATE/;/${replacementDay}`
  ].join("\n"));
  truncatedFixture.manager.captureDebugLogMetadata();

  const invalidatedTruncation = await truncatedFixture.manager.reconcileLatestDateMarker("synthetic_log_truncation_audit");
  assert.equal(invalidatedTruncation.lastDateScanResult.found, false);
  assert.equal(truncatedFixture.manager.getCurrentTotalDays(), 0);
  const truncated = await truncatedFixture.manager.reconcileLatestDateMarker("synthetic_log_truncation_recovery");

  assert.equal(truncated.lastDateScanResult.found, true);
  assert.equal(truncatedFixture.manager.dateSessionId, "votc-load-4");
  assert.equal(truncatedFixture.manager.getCurrentTotalDays(), replacementDay);
}

async function unchangedLogScanIsCachedAndUsesOneDescriptor() {
  const { manager, fs } = createManager({
    logText: [
      "VOTC:LOAD_SESSION/;/votc-load-5",
      "VOTC:DATE/;/395245",
      "x".repeat(160000),
      "VOTC:DATE/;/395246"
    ].join("\n"),
    dateChunkBytes: 100
  });

  await manager.reconcileLatestDateMarker("synthetic_scan_cache_audit");
  const openedAfterFirstScan = fs.openCount;
  assert.equal(openedAfterFirstScan, 1,
    "one complete scan should reuse a single file descriptor");
  await manager.reconcileLatestDateMarker("synthetic_scan_cache_audit_repeat");

  assert.equal(fs.openCount, openedAfterFirstScan + 1,
    "unchanged logs revalidate the bounded anchor using one descriptor, without a history scan");
}

async function legacyLogWithoutLoadBoundaryRemainsCompatible() {
  const legacyDay = 395237;
  const { manager } = createManager({ logText: `VOTC:DATE/;/${legacyDay}` });

  const result = await manager.reconcileLatestDateMarker("synthetic_legacy_log_audit");

  assert.equal(result.lastDateScanResult.found, true);
  assert.equal(result.lastDateScanResult.value, legacyDay);
  assert.equal(manager.getCurrentTotalDays(), legacyDay);
}

async function missingNativeBridgeDoesNotRecreateLegacyRunner() {
  const logText = "VOTC:LOAD_SESSION/;/votc-load-3";
  const pendingCommands = [];
  const runFileManager = {
    isAvailable: () => true,
    findPendingCommand: predicate => pendingCommands.find(predicate) || null,
    enqueueCommand(command) {
      const queued = { ...command, status: "awaiting_ack", writeAttempts: 1, writtenAt: 1000 };
      pendingCommands.push(queued);
      return queued;
    },
    getPendingCommands: () => pendingCommands,
    getQueueHealth: () => ({ pendingCount: pendingCommands.length })
  };
  const { manager, logSize } = createManager({ logText, runFileManager });
  manager.tailState = "ACTIVE";
  manager.debugLogIdentity = "1:7";
  manager.debugLogSize = logSize;

  const status = await manager.runDateTrackerHeartbeat({ forceReconcile: true });

  assert.equal(status.lastDateScanResult.found, false);
  assert.equal(status.dateProducerRecovery.status, "NATIVE_BRIDGE_WAITING");
  assert.equal(pendingCommands.length, 0, "missing native DATE must not recreate the retired runner");
  assert.equal(manager.getCurrentTotalDays(), 0,
    "without a live CK3 DATE marker, recovery cannot synthesize a current date");
  assert.deepEqual(status.runCommands, []);
}

(async () => {
  await staleDateDoesNotCrossLoadBoundary();
  await freshDateAfterLoadBoundaryAdvances();
  await duplicateBoundaryDoesNotClearObservedDate();
  await sameTokenPhysicalLoadOutsideTailStartsNewSession();
  await appendedSameTokenPhysicalLoadClearsObservedDate();
  await delayedOldDateAfterSameTokenLoadIsRejected();
  await startupRejectsDateBeforeExistingPhysicalLoad();
  await dateWithoutPhysicalLoadKeepsLegacyBehavior();
  await boundSessionRejectsUnverifiableDate();
  await olderPhysicalLoadTailCannotReplaceCurrentSession();
  await olderSameTokenScanCannotMoveTailSessionBackward();
  await newBoundaryClearsOldDateAndScanCannotCrossCurrentSession();
  await missedLoadBoundaryRecoversFromLaterScan();
  await oldBoundaryCannotOverrideNewerTailSession();
  await replacementAndTruncationRebuildSessionBoundary();
  await unchangedLogScanIsCachedAndUsesOneDescriptor();
  await legacyLogWithoutLoadBoundaryRemainsCompatible();
  await missingNativeBridgeDoesNotRecreateLegacyRunner();
  console.log("Letter DATE session-boundary checks passed.");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
