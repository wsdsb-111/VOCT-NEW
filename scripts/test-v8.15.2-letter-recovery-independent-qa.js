"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const { createLetterManager } = require("../resources/app/out/main/letters/letter-manager");

const LOG_PATH = path.join("synthetic-votc", "debug.log");
const patchRoot = path.join(__dirname, "..", "compatibility-patches", "v8.15.2-letter-runner");
const runner = fs.readFileSync(path.join(patchRoot, "gui", "custom_gui", "letters_runner.gui"), "utf8");
const bootstrap = fs.readFileSync(path.join(patchRoot, "common", "on_action", "votc_load_boundary.txt"), "utf8");
assert(!runner.includes("GUI.ClearWidgets"), "a talk scene must pause the runner, not destroy its own recovery executor");
assert.match(runner, /duration\s*=\s*0\.1[\s\S]*next\s*=\s*_show_votc/);
assert.match(runner, /duration\s*=\s*1\.9[\s\S]*next\s*=\s*_show/);
assert.match(bootstrap, /on_game_start_after_lobby\s*=\s*\{[\s\S]*every_player[\s\S]*id\s*=\s*mcc_event_v2\.9998/);
assert.match(bootstrap, /on_game_start_after_lobby[\s\S]*debug_log\s*=\s*"\[Localize\('talk_event\.9999\.desc'\)\]"/);

function createReadOnlyMemoryFs(logText) {
  let bytes = Buffer.from(logText, "utf8");
  let mtimeMs = 1000;
  return {
    append(text) {
      bytes = Buffer.concat([bytes, Buffer.from(text, "utf8")]);
      mtimeMs++;
    },
    existsSync(file) { return file === LOG_PATH; },
    statSync(file) {
      assert.equal(file, LOG_PATH);
      return { size: bytes.length, mtimeMs, birthtimeMs: 1, ino: 7 };
    },
    openSync(file) {
      assert.equal(file, LOG_PATH);
      return 1;
    },
    readSync(fd, target, offset, length, position) {
      assert.equal(fd, 1);
      const count = Math.max(0, Math.min(length, bytes.length - position));
      bytes.copy(target, offset, position, position + count);
      return count;
    },
    closeSync(fd) { assert.equal(fd, 1); }
  };
}

function createManager(logText) {
  const fs = createReadOnlyMemoryFs(logText);
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
    letterEffectTransport: { ensureDateProducerFile: () => ({ success: true, effectFilePath: null }) },
    runFileManager: null,
    autoStartLogTailing: false,
    setIntervalFn: () => null,
    clearIntervalFn: () => null
  });
  return { manager: new LetterManager(), fs };
}

async function sameTokenAtNewOffsetStartsFreshDateSession() {
  const token = "votc-load-6";
  const oldDay = 400000;
  const resumedSaveDay = 350000;
  const marker = `VOTC:LOAD_SESSION/;/${token}`;
  const { manager, fs } = createManager([marker, `VOTC:DATE/;/${oldDay}`].join("\n"));

  await manager.reconcileLatestDateMarker("initial_session");
  assert.equal(manager.dateSessionId, token);
  assert.equal(manager.getCurrentTotalDays(), oldDay);
  const originalBoundary = manager.dateSessionBoundaryOffset;

  await manager.processLogLine(marker);
  assert.equal(manager.getCurrentTotalDays(), oldDay,
    "re-delivering the same marker at the same byte offset is not a new load");
  assert.equal(manager.dateSessionBoundaryOffset, originalBoundary);

  const pendingLetter = { letter: { letterId: "pending-preserved", totalDays: oldDay + 5 }, reply: "unchanged" };
  manager.storedLetters.set("pending-preserved", pendingLetter);
  manager.awaitingAcceptanceLetterId = "pending-preserved";
  fs.append(`\n${marker}`);
  manager.captureDebugLogMetadata();
  await manager.processLogLine(marker);

  const afterBoundary = await manager.reconcileLatestDateMarker("same_token_new_load");
  const violations = [];
  if (manager.dateSessionBoundaryOffset <= originalBoundary) violations.push("new byte-offset boundary was not recorded");
  if (manager.getCurrentTotalDays() !== 0) violations.push("pre-boundary DATE was retained as the new session date");
  if (afterBoundary.lastDateScanResult?.found) violations.push("scanner accepted a DATE that precedes the latest load boundary");
  if (manager.storedLetters.get("pending-preserved") !== pendingLetter) violations.push("pending letter was reset");
  if (manager.awaitingAcceptanceLetterId !== "pending-preserved") violations.push("acceptance lock was reset");

  fs.append(`\nVOTC:DATE/;/${resumedSaveDay}`);
  manager.captureDebugLogMetadata();
  await manager.processLogLine(`VOTC:DATE/;/${resumedSaveDay}`);
  const afterFreshDate = await manager.reconcileLatestDateMarker("fresh_date_after_same_token_load");
  if (!afterFreshDate.lastDateScanResult?.found || afterFreshDate.lastDateScanResult.value !== resumedSaveDay) {
    violations.push("fresh post-boundary DATE did not become authoritative");
  }
  if (manager.getCurrentTotalDays() !== resumedSaveDay) violations.push("fresh post-boundary DATE did not advance the tracker");
  if (manager.storedLetters.get("pending-preserved") !== pendingLetter) violations.push("fresh date changed pending letter state");
  if (manager.awaitingAcceptanceLetterId !== "pending-preserved") violations.push("fresh date changed acceptance lock");

  assert.deepEqual(violations, [], `same-token reload audit: ${violations.join("; ") || "none"}`);
}

async function delayedOldTailDateCannotAdvanceCurrentSession({ name, initialLog, activeSession, establishByAppend }) {
  const oldDay = 400000;
  const oldDateLine = `VOTC:DATE/;/${oldDay}`;
  const { manager, fs } = createManager(initialLog);

  if (establishByAppend) {
    await manager.reconcileLatestDateMarker("initial_session");
    assert.equal(manager.getCurrentTotalDays(), oldDay);
    fs.append(`\nVOTC:LOAD_SESSION/;/${activeSession}`);
    manager.captureDebugLogMetadata();
    await manager.processLogLine(`VOTC:LOAD_SESSION/;/${activeSession}`);
    await manager.reconcileLatestDateMarker("new_session_before_date");
  }

  const dueLetter = {
    letter: { letterId: `delayed-date-${name}`, totalDays: oldDay },
    expectedDeliveryDay: oldDay,
    reply: "synthetic"
  };
  const dueLetterId = dueLetter.letter.letterId;
  manager.storedLetters.set(dueLetterId, dueLetter);
  let deliveryAttempts = 0;
  manager.deliverLetter = async () => {
    deliveryAttempts++;
    return false;
  };

  await manager.processLogLine(oldDateLine);

  const violations = [];
  if (establishByAppend && manager.dateSessionId !== activeSession) violations.push("physical current session was not established");
  if (manager.getCurrentTotalDays() !== 0) violations.push("delayed pre-boundary DATE changed the current day");
  if (manager.lastObservedDateValue !== null) violations.push("delayed pre-boundary DATE refreshed observed-date state");
  if (deliveryAttempts !== 0) violations.push(`delayed pre-boundary DATE triggered ${deliveryAttempts} delivery attempt(s)`);
  return { name, violations, sessionIdAfterTail: manager.dateSessionId, deliveryAttempts };
}

async function delayedOldDateTailIsRejectedAcrossSessions() {
  const oldToken = "votc-load-A";
  const newToken = "votc-load-B";
  const oldDay = 400000;
  const oldDateLine = `VOTC:DATE/;/${oldDay}`;
  const base = [`VOTC:LOAD_SESSION/;/${oldToken}`, oldDateLine].join("\n");

  const results = [];
  results.push(await delayedOldTailDateCannotAdvanceCurrentSession({
    name: "same-token-new-boundary",
    initialLog: base,
    activeSession: oldToken,
    establishByAppend: true
  }));
  results.push(await delayedOldTailDateCannotAdvanceCurrentSession({
    name: "new-token-boundary",
    initialLog: base,
    activeSession: newToken,
    establishByAppend: true
  }));
  results.push(await delayedOldTailDateCannotAdvanceCurrentSession({
    name: "cold-start-session-null",
    initialLog: [
      `VOTC:LOAD_SESSION/;/${oldToken}`,
      oldDateLine,
      `VOTC:LOAD_SESSION/;/${newToken}`
    ].join("\n"),
    activeSession: newToken,
    establishByAppend: false
  }));
  const failures = results.filter(result => result.violations.length > 0)
    .map(result => `${result.name}: ${result.violations.join("; ")}`);
  assert.deepEqual(failures, [], `delayed tail DATE audit: ${failures.join(" | ") || "none"}`);
}

Promise.all([
  sameTokenAtNewOffsetStartsFreshDateSession(),
  delayedOldDateTailIsRejectedAcrossSessions()
]).then(() => {
  console.log("V8.15.2 letter recovery independent QA: PASS (session boundaries, delayed tail dates, fresh date, pending state)");
}).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
