"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const readline = require("node:readline");
const { createLetterManager } = require("../resources/app/out/main/letters/letter-manager");
const LetterLogReader = require("../resources/app/out/main/letters/letter-log-reader");

const LOG_PATH = path.join("synthetic-votc", "debug.log");
const patchRoot = path.join(__dirname, "..", "compatibility-patches", "v8.15.2-letter-runner");
const runner = fs.readFileSync(path.join(patchRoot, "gui", "custom_gui", "letters_runner.gui"), "utf8");
const invisibleEvent = fs.readFileSync(path.join(patchRoot, "gui", "event_windows", "votc_invisible_event.gui"), "utf8");
const bootstrap = fs.readFileSync(path.join(patchRoot, "common", "on_action", "votc_load_boundary.txt"), "utf8");
const nativeBridgeBootstrap = fs.readFileSync(path.join(patchRoot, "gui", "scripted_widgets", "votc_runtime_bridge.txt"), "utf8");
const nativeBridge = fs.readFileSync(path.join(patchRoot, "gui", "custom_gui", "votc_runtime_bridge.gui"), "utf8");
const nativeClock = fs.readFileSync(path.join(patchRoot, "common", "scripted_guis", "votc_runtime_clock.txt"), "utf8");
const richDateProducer = 'debug_log = "VOTC:DATE/;/[GetCurrentDate.GetDateAsTotalDays]/;/[GetCurrentDate.GetStringShort]"';

function readBracedBlock(source, openIndex) {
  assert.equal(source[openIndex], "{");
  let depth = 0;
  let inString = false;
  let escaped = false;
  let inComment = false;
  for (let index = openIndex; index < source.length; index++) {
    const char = source[index];
    if (inComment) {
      if (char === "\n") inComment = false;
      continue;
    }
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === "#") inComment = true;
    else if (char === '"') inString = true;
    else if (char === "{") depth++;
    else if (char === "}" && --depth === 0) return { body: source.slice(openIndex + 1, index), end: index + 1 };
  }
  assert.fail("unclosed on_action block");
}

function getNamedBlock(source, name) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const definition = new RegExp(`^${escapedName}\\s*=\\s*\\{`, "m").exec(source);
  assert(definition, `missing on_action definition: ${name}`);
  assert.equal([...source.matchAll(new RegExp(`^${escapedName}\\s*=\\s*\\{`, "gm"))].length, 1,
    `on_action definition must be unique: ${name}`);
  return readBracedBlock(source, source.indexOf("{", definition.index)).body;
}

function mergeOnActionHook(current, added) {
  const merged = { ...current, ...added };
  if (current.on_actions || added.on_actions) {
    merged.on_actions = [...(current.on_actions || []), ...(added.on_actions || [])];
  }
  return merged;
}

function assertNamedHookChildOnly(hookName, expectedChildContent) {
  const childRef = /^\s*on_actions\s*=\s*\{\s*([A-Za-z_][A-Za-z0-9_.]*)\s*\}\s*$/s.exec(getNamedBlock(bootstrap, hookName));
  assert(childRef, `${hookName} root only appends one named child; it must not define a competing effect`);
  const childName = childRef[1];
  const childEffect = /^\s*effect\s*=\s*\{([\s\S]*)\}\s*$/s.exec(getNamedBlock(bootstrap, childName));
  assert(childEffect, `${childName} owns its behavior in one effect block`);
  assert.match(childEffect[1], expectedChildContent, `${childName} retains its required behavior`);

  // Minimal merge model: root effect is a replaceable field, while named
  // on_actions are appended and continue to resolve to their independent body.
  const existingMod = { effect: { marker: "existing-mod-effect" }, on_actions: ["existing_mod_child"] };
  const laterMod = { effect: { marker: "later-mod-effect" } };
  const legacyDirectEffect = mergeOnActionHook(existingMod, { effect: { marker: "votc-direct-effect" } });
  const legacyAfterLaterLoad = mergeOnActionHook(legacyDirectEffect, laterMod);
  assert.equal(legacyAfterLaterLoad.effect.marker, "later-mod-effect", "a later same-name effect replaces the earlier root effect");
  assert.notEqual(legacyAfterLaterLoad.effect.marker, "votc-direct-effect", "direct root effect would be lost on merge");

  const namedChildPatch = { on_actions: [childName] };
  const mergedNamedHook = mergeOnActionHook(mergeOnActionHook(existingMod, namedChildPatch), laterMod);
  assert(mergedNamedHook.on_actions.includes(childName), `${hookName} named child survives a later same-name effect`);
  const namedChildEffects = new Map([[childName, childEffect[1]]]);
  assert.equal(namedChildEffects.get(mergedNamedHook.on_actions.find(name => name === childName)), childEffect[1],
    `${childName} remains independently resolvable after root-hook merge`);
}

assertNamedHookChildOnly("on_game_start", /change_global_variable\s*=\s*\{[\s\S]*name\s*=\s*votc_load_epoch[\s\S]*add\s*=\s*1[\s\S]*\}[\s\S]*VOTC:LOAD_SESSION\/;\//);
assertNamedHookChildOnly("on_game_start_after_lobby", /debug_log\s*=\s*"VOTC:DATE\/;\/\[GetCurrentDate\.GetDateAsTotalDays\]\/;\/\[GetCurrentDate\.GetStringShort\]"/);
assert.match(nativeClock, /scope\s*=\s*character[\s\S]*is_ai\s*=\s*no[\s\S]*VOTC:DATE\/;\/\[GetCurrentDate\.GetDateAsTotalDays\]\/;\/\[GetCurrentDate\.GetStringShort\]/,
  "the native clock emits the rich DATE marker without using a carrier");
assert(nativeClock.includes(richDateProducer));

function createReadOnlyMemoryFs(logText) {
  const complete = value => value.endsWith("\n") ? value : `${value}\n`;
  let bytes = Buffer.from(complete(logText), "utf8");
  let mtimeMs = 1000;
  return {
    append(text) {
      bytes = Buffer.concat([bytes, Buffer.from(complete(text), "utf8")]);
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
    runFileManager: null,
    autoStartLogTailing: false,
    setIntervalFn: () => null,
    clearIntervalFn: () => null
  });
  return { manager: new LetterManager(), fs };
}

function createManagerWithRealLog(debugLogPath) {
  const { LetterManager } = createLetterManager({
    settingsRepository: {
      getCK3UserFolderPath: () => null,
      getCK3DebugLogPath: () => debugLogPath
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
    runFileManager: null,
    autoStartLogTailing: false,
    setIntervalFn: () => null,
    clearIntervalFn: () => null
  });
  return new LetterManager();
}

async function richDateMarkerUpdatesNumericDateWithoutResettingAcceptance() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "votc-rich-date-audit-"));
  try {
    const debugLogPath = path.join(tempRoot, "debug.log");
    const numericDay = 350123;
    const marker = `VOTC:DATE/;/${numericDay}/;/5/10/1164`;
    fs.writeFileSync(debugLogPath, `${marker}\n`, "utf8");
    const manager = createManagerWithRealLog(debugLogPath);
    manager.captureDebugLogMetadata();
    manager.currentTotalDays = numericDay - 100;

    const letterId = "rich-date-accepted-summary-gate";
    const pendingLetter = {
      letter: { letterId, totalDays: numericDay - 1 },
      expectedDeliveryDay: numericDay - 1,
      acceptedMemoryAwaitingProof: true,
      reply: "synthetic"
    };
    const gateStatus = {
      letterId,
      responseStatus: "effect_file_written",
      summaryStatus: "saved",
      acceptanceProofRequired: true
    };
    manager.storedLetters.set(letterId, pendingLetter);
    manager.letterStatuses.set(letterId, gateStatus);
    manager.awaitingAcceptanceLetterId = letterId;

    await manager.processLogLine(marker);
    assert.equal(manager.lastObservedDateValue, numericDay, "rich DATE uses the first numeric total-days field only");
    assert.equal(manager.getCurrentTotalDays(), numericDay, "rich DATE advances the date tracker numerically");
    assert.equal(manager.storedLetters.get(letterId), pendingLetter, "DATE processing preserves the pending letter object");
    assert.equal(manager.awaitingAcceptanceLetterId, letterId, "DATE processing does not release its acceptance lock");
    assert.equal(manager.letterStatuses.get(letterId), gateStatus, "DATE processing leaves accepted-summary gate status unchanged");
    assert.equal(gateStatus.summaryStatus, "saved");
    assert.equal(pendingLetter.acceptedMemoryAwaitingProof, true);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
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

function activeGuiText(source) {
  return source.replace(/^[ \t]*#.*$/gm, "");
}

function legacyRunnerAndInvisibleEventHaveNoSideEffects() {
  const activeRunner = activeGuiText(runner);
  const activeEvent = activeGuiText(invisibleEvent);
  assert.match(activeRunner, /name\s*=\s*"letters_runner"/);
  assert.doesNotMatch(activeRunner, /\b(?:state|duration|next|trigger_on_create)\s*=|ExecuteConsoleCommand|GUI\.ClearWidgets|run\s+(?:letters|votc)\.txt/i,
    "the retired letters_runner widget must contain no timer or command");
  assert.match(activeEvent, /name\s*=\s*"votc_invisible_event"/);
  assert.doesNotMatch(activeEvent, /gui\.createwidget/i,
    "the invisible event must not create a widget");
  assert.doesNotMatch(activeEvent, /letters_runner|ExecuteConsoleCommand|GUI\.ClearWidgets/i,
    "the invisible event must not recreate or drive the retired runner");
  assert.doesNotMatch(bootstrap, /letters_runner|mcc_event_v2\.9998/,
    "load-boundary hooks must not bootstrap the legacy event runner");
}

function createPersistentLifecycleManager({ dataDir, debugLogPath, transport, memoryEngine }) {
  const { LetterManager } = createLetterManager({
    settingsRepository: {
      getCK3UserFolderPath: () => dataDir,
      getCK3DebugLogPath: () => debugLogPath
    },
    fs,
    path,
    TailFile: null,
    readline: null,
    parseLog: async () => null,
    letterPromptBuilder: {},
    llmManager: {},
    PromptBuilder: {},
    TokenCounter: {},
    memoryEngine,
    dataDir,
    letterEffectTransport: transport,
    runFileManager: null,
    autoStartLogTailing: false,
    setIntervalFn: () => null,
    clearIntervalFn: () => {},
    setRunCommandIntervalFn: () => null,
    clearRunCommandIntervalFn: () => {}
  });
  return new LetterManager();
}

async function savedLetterWaitsTwoMonthsAndDispatchesOnceWithoutAcceptance() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "votc-letter-native-bridge-lifecycle-"));
  const dataDir = path.join(tempRoot, "data");
  const debugLogPath = path.join(tempRoot, "debug.log");
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(debugLogPath, "", "utf8");
  const writtenEffects = [];
  let acceptedMemoryCaptures = 0;
  const transport = {
    getOutboundMode: () => "votc_run_file",
    writeOutboundLetterEffect(effectText, mode) {
      writtenEffects.push({ effectText, mode });
      return { success: true, mode, effectFilePath: path.join(tempRoot, "run", "votc.txt") };
    },
    clearOutboundEffect: mode => ({ success: true, mode, effectFilePath: path.join(tempRoot, "run", "votc.txt") }),
  };
  const memoryEngine = {
    letterMemoryFinalization: {
      captureAccepted() { acceptedMemoryCaptures++; return { jobId: "synthetic-accepted-job" }; },
      finalize: async () => ({ status: "COMPLETE" })
    }
  };
  const letter = { letterId: "letter_4", content: "Synthetic long-wait letter", totalDays: 400000, delay: 60 };
  const expectedDeliveryDay = letter.totalDays + letter.delay;
  const dateLine = totalDays => `VOTC:DATE/;/${totalDays}`;
  const appendDate = async (manager, totalDays) => {
    const line = dateLine(totalDays);
    fs.appendFileSync(debugLogPath, `${line}\n`, "utf8");
    await manager.processLogLine(line);
  };

  try {
    const firstManager = createPersistentLifecycleManager({ dataDir, debugLogPath, transport, memoryEngine });
    firstManager.createLetterStatus(letter, "Synthetic recipient");
    firstManager.storedLetters.set(letter.letterId, {
      letter,
      reply: "Synthetic reply fixture",
      expectedDeliveryDay,
      characterName: "Synthetic recipient"
    });
    firstManager.savePendingLetters();
    await appendDate(firstManager, letter.totalDays);
    assert.equal(writtenEffects.length, 0, "the letter stays pending during its two-month delivery delay");

    const restoredManager = createPersistentLifecycleManager({ dataDir, debugLogPath, transport, memoryEngine });
    assert(restoredManager.storedLetters.has(letter.letterId), "pending letter_4 survives manager save/restore");
    await appendDate(restoredManager, expectedDeliveryDay - 1);
    assert.equal(writtenEffects.length, 0, "restoring a pending letter does not send it before the due date");
    await appendDate(restoredManager, expectedDeliveryDay);
    assert.equal(writtenEffects.length, 1, "the due letter is dispatched once when the date advances");
    assert.equal(restoredManager.awaitingAcceptanceLetterId, letter.letterId);
    assert.match(writtenEffects[0].effectText, /create_artifact\s*=\s*\{/,
      "the real LetterManager due path writes the official Artifact CreateEffect body");
    assert.match(writtenEffects[0].effectText, /trigger_event\s*=\s*message_event\.362/,
      "the artifact body retains its acceptance-popup event");

    // Repeated native DATE observations must not duplicate an awaiting letter.
    await appendDate(restoredManager, expectedDeliveryDay);
    await appendDate(restoredManager, expectedDeliveryDay);
    await restoredManager.checkAndDeliverLetters();
    assert.equal(writtenEffects.length, 1, "duplicate child events cannot dispatch another copy while acceptance is pending");

    const afterDispatchRestore = createPersistentLifecycleManager({ dataDir, debugLogPath, transport, memoryEngine });
    assert.equal(afterDispatchRestore.awaitingAcceptanceLetterId, letter.letterId, "the pending acceptance lock survives save/restore");
    await appendDate(afterDispatchRestore, expectedDeliveryDay + 1);
    await afterDispatchRestore.checkAndDeliverLetters();
    assert.equal(writtenEffects.length, 1, "date advancement after restore cannot resend an unaccepted letter");
    assert.equal(acceptedMemoryCaptures, 0, "no accepted-memory summary is captured before an acceptance event");
    assert.equal(afterDispatchRestore.getLetterStatus(letter.letterId).responseStatus, "effect_file_written");
    assert.equal(afterDispatchRestore.getLetterStatus(letter.letterId).summaryStatus, "not_started");
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

async function waitFor(predicate, label) {
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.fail(`Timed out waiting for ${label}`);
}

function createReaderBackedManager({ debugLogPath, runFileManager = null, letterEffectTransport = null }) {
  class FastLetterLogReader extends LetterLogReader {
    constructor(filePath, options) {
      super(filePath, { ...options, pollIntervalMs: 2, readChunkBytes: 4096, highWaterMark: 4096 });
    }
  }
  const { LetterManager } = createLetterManager({
    settingsRepository: { getCK3UserFolderPath: () => path.dirname(debugLogPath), getCK3DebugLogPath: () => debugLogPath },
    fs,
    path,
    TailFile: FastLetterLogReader,
    readline,
    parseLog: async () => null,
    letterPromptBuilder: {},
    llmManager: {},
    PromptBuilder: {},
    TokenCounter: {},
    memoryEngine: {},
    dataDir: null,
    letterEffectTransport: letterEffectTransport || {},
    runFileManager,
    autoStartLogTailing: false,
    setIntervalFn: () => null,
    clearIntervalFn: () => null,
    setRunCommandIntervalFn: () => null,
    clearRunCommandIntervalFn: () => null
  });
  return new LetterManager();
}

async function managerReaderRestartRetiresOldCallbacksAndPartialAcks() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "votc-letter-manager-reader-"));
  const debugLogPath = path.join(tempRoot, "debug.log");
  fs.writeFileSync(debugLogPath, "preexisting\n", "utf8");
  const ackCalls = [];
  const runFileManager = {
    ackCommand: (commandId, kind) => { ackCalls.push({ commandId, kind }); return null; },
    getPendingCommands: () => []
  };
  const manager = createReaderBackedManager({ debugLogPath, runFileManager });
  const processedLines = [];
  const processLogLine = manager.processLogLine.bind(manager);
  manager.processLogLine = line => { processedLines.push(line); return processLogLine(line); };
  try {
    await manager.startLogTailing();
    const retiredReader = manager.tailFile;
    const retiredLineCallback = manager.readline.listeners("line")[0];
    retiredReader.pause();
    fs.appendFileSync(debugLogPath, "VOTC:RUN_ACK/retired/OLD\n".repeat(4000), "utf8");
    await waitFor(() => retiredReader.readableLength >= retiredReader.readableHighWaterMark, "reader backpressure");

    const restarted = await Promise.race([
      manager.restartLogTailing().then(() => true),
      new Promise(resolve => setTimeout(() => resolve(false), 500))
    ]);
    assert.equal(restarted, true, "LetterManager can restart its dedicated reader while the old stream is backpressured");
    assert.equal(manager.tailState, "ACTIVE");
    assert.notEqual(manager.tailFile, retiredReader, "restart installs a fresh reader");
    retiredLineCallback("VOTC:RUN_ACK/retired/OLD");
    assert.deepEqual(ackCalls, [], "a saved callback from a retired reader cannot acknowledge a command");

    const activeReader = manager.tailFile;
    fs.appendFileSync(debugLogPath, "VOTC:RUN_ACK/partial-");
    await waitFor(() => activeReader.offset >= fs.statSync(debugLogPath).size, "partial ACK bytes read");
    let resetCount = 0;
    activeReader.on("log_reset", () => { resetCount++; });
    fs.truncateSync(debugLogPath, 0);
    await waitFor(() => resetCount === 1, "reader truncation boundary");
    fs.appendFileSync(debugLogPath, "suffix/OLD\n", "utf8");
    await waitFor(() => processedLines.includes("suffix/OLD"), "post-truncation complete line");
    assert.deepEqual(ackCalls, [], "a truncated partial ACK cannot combine with bytes after the reset and become an acknowledgement");

    fs.appendFileSync(debugLogPath, "VOTC:RUN_ACK/fresh/TYPE\n", "utf8");
    await waitFor(() => ackCalls.length === 1, "complete post-reset ACK");
    assert.deepEqual(ackCalls, [{ commandId: "TYPE", kind: "fresh" }], "only the complete current ACK reaches RunFileManager");
  } finally {
    await manager.stopLogTailing();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

async function a2ExecutionMarkerCanPassWithoutAnyDateMarker() {
  const writes = [];
  const recorded = [];
  const transport = {
    writeDiagnosticEffect(effectText, mode) {
      writes.push({ effectText, mode });
      return { success: true, mode, effectFilePath: "synthetic-votc.txt", commandId: "synthetic-command" };
    },
    cancelOutboundEffect: () => ({ success: true }),
    recordTransportDiagnostic: (stage, result) => recorded.push({ stage, result })
  };
  const diagnosticManager = createReaderBackedManager({
    debugLogPath: path.join(os.tmpdir(), "unused-no-date-debug.log"),
    letterEffectTransport: transport
  });
  assert.equal(diagnosticManager.getCurrentTotalDays(), 0, "fixture begins with no known DATE");
  assert.equal(diagnosticManager.effectDiagnosticStages.A1, null, "A1 starts disabled and does not need to pass before A2");
  const disabledA1 = diagnosticManager.runEffectDiagnostic("A1");
  assert.equal(disabledA1.success, false, "the retired letters.txt diagnostic is disabled");
  assert.match(disabledA1.disableReason, /letters\.txt.*停用/);
  assert.equal(writes.length, 0, "disabled A1 must not write to the legacy carrier");
  const result = diagnosticManager.runEffectDiagnostic("A2");
  assert.equal(result.success, true, "A2 works without A1 or any DATE marker");
  assert.equal(writes.length, 1);
  assert.equal(writes[0].mode, "votc_run_file");
  assert.match(writes[0].effectText, /VOTC:LETTER_TRANSPORT\/B\//);
  await diagnosticManager.processLogLine(result.marker);
  assert.equal(diagnosticManager.effectDiagnosticStages.A2.result, "PASS", "the exact A2 execution marker confirms independently of DATE state");
  assert.deepEqual(recorded, [{ stage: "A2", result: "PASS" }]);
  assert.equal(diagnosticManager.getCurrentTotalDays(), 0, "A2 confirmation does not synthesize a date");
}

async function repeatedLiveDateDoesNotDeclareProducerStalled() {
  const { manager } = createManager("VOTC:DATE/;/420000/;/1/1/1200\n");
  manager.tailState = "ACTIVE";
  let producerRestarts = 0;
  manager.ensureDateProducerRunning = async () => { producerRestarts++; };
  const marker = "VOTC:DATE/;/420000/;/1/1/1200";
  await manager.processLogLine(marker);
  await manager.processLogLine(marker);
  assert.equal(manager.dateProducerState, "LIVE_NO_PROGRESS", "a stable calendar day is distinct from a silent producer");
  const status = await manager.runDateTrackerHeartbeat();
  assert.equal(status.dateSourceState, "HEALTHY", "recent repeated DATE heartbeats keep the source healthy");
  assert.equal(status.dateProducerState, "LIVE_NO_PROGRESS");
  assert.equal(producerRestarts, 0, "identical but freshly emitted dates do not trigger producer recovery");
}

function nativeBridgeProvidesDialogueIndependentClockAndVotcPolling() {
  assert.match(nativeBridgeBootstrap, /gui\/custom_gui\/votc_runtime_bridge\.gui\s*=\s*votc_runtime_bridge/);
  assert.match(nativeBridge, /name\s*=\s*"votc_runtime_bridge"/);
  assert.match(nativeBridge, /duration\s*=\s*0\.1[\s\S]*next\s*=\s*outbound/);
  assert.match(nativeBridge, /duration\s*=\s*1\.9[\s\S]*next\s*=\s*clock/);
  assert.match(nativeBridge, /GetScriptedGui\('votc_runtime_clock'\)\.Execute/);
  assert.match(nativeBridge, /Select_CString\(GetPlayer\.IsValid, 'run votc\.txt', ''\)/,
    "outbound polling must depend only on player validity, not dialogue-window lifetime");
  const runFileCommands = [...nativeBridge.matchAll(/\brun\s+([A-Za-z0-9_.-]+\.txt)\b/g)].map(match => match[1]);
  assert.deepEqual(runFileCommands, ["votc.txt"], "the native bridge polls only the outbound votc.txt carrier");
  assert.doesNotMatch(nativeBridge, /letters\.txt/);
  assert.match(nativeClock, /scope\s*=\s*character[\s\S]*is_ai\s*=\s*no[\s\S]*VOTC:DATE\/;\/\[GetCurrentDate\.GetDateAsTotalDays\]\/;\/\[GetCurrentDate\.GetStringShort\]/);
  assert.doesNotMatch(nativeClock, /letters\.txt|votc\.txt/, "the native clock emits DATE directly without a Run File");
}

Promise.all([
  richDateMarkerUpdatesNumericDateWithoutResettingAcceptance(),
  sameTokenAtNewOffsetStartsFreshDateSession(),
  delayedOldDateTailIsRejectedAcrossSessions(),
  Promise.resolve().then(legacyRunnerAndInvisibleEventHaveNoSideEffects),
  savedLetterWaitsTwoMonthsAndDispatchesOnceWithoutAcceptance(),
  managerReaderRestartRetiresOldCallbacksAndPartialAcks(),
  a2ExecutionMarkerCanPassWithoutAnyDateMarker(),
  repeatedLiveDateDoesNotDeclareProducerStalled(),
  Promise.resolve().then(nativeBridgeProvidesDialogueIndependentClockAndVotcPolling)
]).then(() => {
  console.log("V8.15.2 letter recovery independent QA: PASS (named-hook merge, inert legacy runner, native DATE/votc bridge, dedicated-reader restart/ACK isolation, A2 without A1 or DATE, stable-date health, save/restore and acceptance gates)");
}).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
