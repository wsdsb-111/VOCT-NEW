"use strict";

const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const Module = require("node:module");
const os = require("node:os");
const path = require("node:path");
const { createLetterManager } = require("../resources/app/out/main/letters/letter-manager");

const CAMPAIGN = "votc8c-202610080001";
const LETTER_ID = "letter_timer_qa";
const LETTER_TOKEN = "a".repeat(32);
const DATE_CARRIER = 'debug_log = "VOTC:DATE/;/100/;/1038.4.1"\n';
const UNKNOWN_LETTERS_EFFECT = '\uFEFFdebug_log = "user_owned_unknown_effect"\n';

function maskNonCode(source) {
  let output = "";
  let mode = "code";
  let quote = "";
  for (let index = 0; index < source.length; index++) {
    const character = source[index];
    if (mode === "line_comment") {
      if (character === "\n") {
        output += "\n";
        mode = "code";
      } else output += " ";
      continue;
    }
    if (mode === "string") {
      if (character === "\\") {
        output += "  ";
        index++;
      } else if (character === quote) {
        output += " ";
        mode = "code";
      } else output += character === "\n" ? "\n" : " ";
      continue;
    }
    if (character === "#") {
      output += " ";
      mode = "line_comment";
    } else if (character === '"' || character === "'") {
      output += " ";
      quote = character;
      mode = "string";
    } else output += character;
  }
  return output;
}

function matchingBrace(masked, openIndex) {
  assert.equal(masked[openIndex], "{", "block parser starts at an opening brace");
  let depth = 0;
  for (let index = openIndex; index < masked.length; index++) {
    if (masked[index] === "{") depth++;
    if (masked[index] === "}" && --depth === 0) return index;
  }
  throw new Error("Unclosed scripted block");
}

function blocksFor(source, expression) {
  const masked = maskNonCode(source);
  const blocks = [];
  for (const match of masked.matchAll(expression)) {
    const openIndex = masked.indexOf("{", match.index);
    const closeIndex = matchingBrace(masked, openIndex);
    blocks.push(source.slice(openIndex + 1, closeIndex));
  }
  return blocks;
}

function createFakeRunFileManager() {
  const pending = [];
  const recent = [];
  const calls = [];
  let sequence = 0;
  return {
    calls,
    enqueueCommand(command) {
      const row = { ...command, commandId: command.commandId || "qa-" + (++sequence), status: "awaiting_ack" };
      pending.push(row);
      calls.push(row);
      return { ...row };
    },
    isAvailable: () => true,
    findPendingCommand(predicate) {
      const row = pending.find(predicate);
      return row ? { ...row } : null;
    },
    getPendingCommands: () => pending.map(row => ({ ...row })),
    getRecentCommands: () => recent.map(row => ({ ...row })),
    ackCommand(commandId, kind = null) {
      const index = pending.findIndex(row => row.commandId === commandId && (!kind || row.kind === kind));
      if (index < 0) return null;
      const row = pending.splice(index, 1)[0];
      row.status = "acknowledged";
      recent.push(row);
      return { ...row };
    },
    callsByKind(kind) {
      return calls.filter(row => row.kind === kind);
    }
  };
}

function createFakeTransport(runFileManager, votcPath) {
  const writes = [];
  const dateProducerChecks = [];
  let clearCalls = 0;
  const enqueue = (effectText, kind) => runFileManager.enqueueCommand({
    owner: "letter", kind, effectText
  });
  return {
    writes,
    dateProducerChecks,
    get clearCalls() { return clearCalls; },
    getOutboundMode: () => "votc_run_file",
    writeOutboundLetterEffect(effectText) {
      const command = enqueue(effectText, "letter_effect");
      writes.push(command);
      return { success: true, mode: "votc_run_file", effectFilePath: votcPath,
        commandId: command.commandId, commandStatus: "awaiting_ack" };
    },
    writeDiagnosticEffect(effectText, mode) {
      const command = enqueue(effectText, "letter_diagnostic");
      writes.push(command);
      return { success: true, mode, effectFilePath: votcPath,
        commandId: command.commandId, commandStatus: "awaiting_ack" };
    },
    ensureDateProducerFile() {
      dateProducerChecks.push("legacy ensure called");
      return { success: false, error: "legacy date carrier retired" };
    },
    clearOutboundEffect(mode) {
      clearCalls++;
      return { success: true, mode, effectFilePath: votcPath };
    },
    cancelOutboundEffect(mode) {
      return { success: true, mode, effectFilePath: votcPath };
    },
    recordTransportDiagnostic(stage, result) {
      return { diagnostics: { [stage]: { result } } };
    }
  };
}

function seedPendingLetter() {
  return {
    letter: { letterId: LETTER_ID, content: "信中托付一枚印章。", totalDays: 100, delay: 10 },
    reply: "我已妥善收存。",
    expectedDeliveryDay: 110,
    characterName: "收信人",
    receiptToken: LETTER_TOKEN,
    disclosureBinding: {
      campaignToken: CAMPAIGN, playerId: 1, aiId: 2,
      sourceDate: "1038.4.1", sourceTotalDays: 100
    },
    sourceMemoryContext: { participantProfiles: [], relationshipEvidence: [] }
  };
}

function createFixture(managerFactory = createLetterManager) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "votc-letter-timer-retirement-"));
  const ck3Dir = path.join(root, "ck3");
  const runDir = path.join(ck3Dir, "run");
  const dataDir = path.join(root, "data");
  const logDir = path.join(ck3Dir, "logs");
  const debugLogPath = path.join(logDir, "debug.log");
  const votcPath = path.join(runDir, "votc.txt");
  const lettersPath = path.join(runDir, "letters.txt");
  fs.mkdirSync(runDir, { recursive: true });
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(logDir, { recursive: true });
  fs.writeFileSync(votcPath, DATE_CARRIER, "utf8");
  fs.writeFileSync(lettersPath, UNKNOWN_LETTERS_EFFECT, "utf8");
  fs.writeFileSync(debugLogPath, "VOTC:DATE/;/100/;/1038.4.1\n", "utf8");
  fs.writeFileSync(path.join(dataDir, "pending-letters.json"), JSON.stringify({
    version: 4, awaitingAcceptanceLetterId: null, letters: [seedPendingLetter()], failedLetters: []
  }, null, 2), "utf8");

  const settingsRepository = {
    getCK3UserFolderPath: () => ck3Dir,
    getCK3DebugLogPath: () => debugLogPath,
    getSummaryPromptSettings: () => ({})
  };
  const runFileManager = createFakeRunFileManager();
  const letterEffectTransport = createFakeTransport(runFileManager, votcPath);
  const archiveCaptures = [];
  const memoryEngine = {
    letterMemoryFinalization: {
      captureAccepted(context) {
        archiveCaptures.push(structuredClone(context));
        return { jobId: "job-" + archiveCaptures.length };
      },
      async finalize(job) { return { status: "COMPLETE", jobId: job.jobId }; }
    }
  };
  let parsedGameData = null;
  const noInterval = callback => ({ callback, unref() {} });
  const dependencies = {
    settingsRepository, fs, path, TailFile: class {}, readline: {},
    parseLog: async () => parsedGameData,
    letterPromptBuilder: { buildMessages: () => [{ role: "user", content: "fixture" }] },
    llmManager: { sendChatRequest: async () => ({ content: "回信内容。" }) },
    PromptBuilder: {}, TokenCounter: { estimateMessageTokens: message => message.content.length },
    memoryEngine, dataDir, letterEffectTransport, runFileManager, autoStartLogTailing: false,
    letterPayloadRetryDelays: [], setIntervalFn: noInterval, clearIntervalFn() {},
    setRunCommandIntervalFn: noInterval, clearRunCommandIntervalFn() {}
  };
  const managers = [];
  const createManager = () => {
    const { LetterManager } = managerFactory(dependencies);
    const manager = new LetterManager();
    manager.currentTotalDays = 100;
    manager.tailState = "ACTIVE";
    manager.buildLetterSourceMemoryContext = () => ({ participantProfiles: [], relationshipEvidence: [] });
    managers.push(manager);
    return manager;
  };
  const manager = createManager();

  return {
    root, runDir, dataDir, debugLogPath, votcPath, lettersPath, manager, managers, createManager,
    runFileManager, letterEffectTransport, archiveCaptures,
    setParsedGameData(value) { parsedGameData = value; },
    readCarriers() {
      return { votc: fs.readFileSync(votcPath), letters: fs.readFileSync(lettersPath) };
    },
    close() {
      assert.equal(path.dirname(root), os.tmpdir(), "fixture root is inside the OS temporary directory");
      fs.rmSync(root, { recursive: true, force: true });
    }
  };
}

function writeDateLog(fixture, day, date) {
  fs.writeFileSync(fixture.debugLogPath,
    "VOTC:LOAD_SESSION/;/timer-qa\nVOTC:DATE/;/" + day + "/;/" + date + "\n", "utf8");
}

function makeGameData() {
  return {
    campaignToken: CAMPAIGN, playerID: 1, aiID: 2, totalDays: 100, date: "1038.4.1",
    characters: new Map([[1, { id: 1, name: "发信人" }], [2, { id: 2, name: "收信人" }]]),
    letterData: { letterId: "letter_payload_qa", content: "请代为保管一封信。", totalDays: 100, delay: 50 },
    getAi: () => ({ fullName: "收信人" }),
    loadCharactersSummaries() {}
  };
}

async function testRetiredRecoveryAndSingleDelivery(managerFactory = createLetterManager) {
  const fixture = createFixture(managerFactory);
  try {
    const originalCarriers = fixture.readCarriers();
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(fixture.manager.storedLetters.has(LETTER_ID), true, "startup restores the pending letter");
    assert.equal(fixture.manager.dateProducerRecovery?.status, "NATIVE_BRIDGE_WAITING",
      "startup records native bridge ownership without rebuilding the event runner");

    fixture.manager.lastObservedDateMarkerAt = Date.now() - 60_000;
    for (let attempt = 0; attempt < 3; attempt++) {
      await fixture.manager.runDateTrackerHeartbeat({ forceReconcile: true });
    }
    const restartedManagers = [fixture.createManager(), fixture.createManager()];
    for (const restarted of restartedManagers) {
      await Promise.resolve();
      await Promise.resolve();
      assert.equal(restarted.dateProducerRecovery?.status, "NATIVE_BRIDGE_WAITING",
        "each application start waits for the native bridge");
      restarted.lastObservedDateMarkerAt = Date.now() - 60_000;
      await restarted.runDateTrackerHeartbeat({ forceReconcile: true });
    }
    assert.equal(fixture.runFileManager.callsByKind("date_producer_rearm").length, 0,
      "repeated stale heartbeats and application starts never enqueue a date producer rearm");

    for (const manager of [fixture.manager, ...restartedManagers]) {
      const close = fixture.runFileManager.enqueueCommand({
        owner: "conversation", kind: "conversation_close", effectText: 'debug_log = "close"'
      });
      await manager.processLogLine("VOTC:RUN_ACK/CONVERSATION_CLOSE/" + close.commandId);
    }
    assert.equal(fixture.runFileManager.callsByKind("date_producer_rearm").length, 0,
      "repeated conversation-close ACKs never re-arm the retired runner");
    assert.equal(fixture.letterEffectTransport.dateProducerChecks.length, 0,
      "the retired date-carrier writer is never called");
    assert.deepEqual(fixture.readCarriers(), originalCarriers,
      "startup, stale recovery and close ACK preserve the existing DATE and unknown legacy carriers");

    fixture.setParsedGameData(makeGameData());
    await fixture.manager.processLatestLetter();
    assert.deepEqual(fixture.readCarriers(), originalCarriers,
      "processing a new letter payload never writes letters.txt or changes the native DATE carrier");

    writeDateLog(fixture, 110, "1038.4.11");
    await fixture.manager.processLogLine("VOTC:DATE/;/110/;/1038.4.11");
    assert.equal(fixture.letterEffectTransport.writes.filter(row => row.kind === "letter_effect").length, 1,
      "the live DATE marker reaching the delivery day queues one letter effect");
    await fixture.manager.processLogLine("VOTC:DATE/;/110/;/1038.4.11");
    assert.equal(fixture.letterEffectTransport.writes.filter(row => row.kind === "letter_effect").length, 1,
      "the same live DATE marker cannot queue the due letter twice");

    const receipt = "VOTC:LETTER_RECEIPT/;/" + LETTER_ID + "/;/" + LETTER_TOKEN + "/;/" +
      CAMPAIGN + "/;/1/;/2/;/110/;/1038.4.11";
    await fixture.manager.processLogLine(receipt);
    const writesAfterReceipt = fixture.letterEffectTransport.writes.length;
    assert.equal(fixture.archiveCaptures.length, 1, "the accepted receipt is archived once");
    assert.equal(fixture.manager.getLetterStatus(LETTER_ID)?.responseStatus, "sent",
      "valid receipt confirms delivery");
    await fixture.manager.processLogLine(receipt);
    await Promise.resolve();
    assert.equal(fixture.archiveCaptures.length, 1, "duplicate receipt does not archive again");
    assert.equal(fixture.letterEffectTransport.writes.length, writesAfterReceipt,
      "duplicate receipt does not rewrite a letter effect");
    assert.deepEqual(fixture.readCarriers(), originalCarriers,
      "live DATE delivery and receipt handling preserve both carriers");
    assert.equal(fixture.runFileManager.callsByKind("date_producer_rearm").length, 0,
      "the complete lifecycle never queues the retired producer");
  } finally {
    fixture.close();
  }
}

async function testDiagnosticStages() {
  const fixture = createFixture();
  try {
    const a1 = fixture.manager.getDiagnosticDisableReason("A1");
    assert.ok(a1 && /停用|退休/.test(a1), "A1 clearly reports the retired letters.txt transport");
    assert.equal(fixture.manager.getDiagnosticDisableReason("A2"), null,
      "A2 is enabled without an A1 prerequisite");
    const result = fixture.manager.runEffectDiagnostic("A2");
    assert.equal(result.success, true, "A2 writes through the votc.txt transport");
    assert.equal(result.transportMode, "votc_run_file");
    assert.equal(fixture.runFileManager.callsByKind("letter_diagnostic").length, 1);
    assert.deepEqual(fixture.readCarriers(), {
      votc: Buffer.from(DATE_CARRIER), letters: Buffer.from(UNKNOWN_LETTERS_EFFECT)
    }, "diagnostic transport leaves existing carriers untouched");
  } finally {
    fixture.close();
  }
}

function testGameScriptStructure() {
  const patchRoot = path.join(__dirname, "..", "compatibility-patches", "v8.15.2-letter-runner");
  const bridgePath = path.join(patchRoot, "gui", "custom_gui", "votc_runtime_bridge.gui");
  const legacyRunnerPath = path.join(patchRoot, "gui", "custom_gui", "letters_runner.gui");
  const invisibleEventPath = path.join(patchRoot, "gui", "event_windows", "votc_invisible_event.gui");
  const onActionPath = path.join(patchRoot, "common", "on_action", "votc_load_boundary.txt");
  const clockPath = path.join(patchRoot, "common", "scripted_guis", "votc_runtime_clock.txt");
  const bridge = fs.readFileSync(bridgePath, "utf8");
  const runner = fs.readFileSync(legacyRunnerPath, "utf8");
  const invisibleEvent = fs.readFileSync(invisibleEventPath, "utf8");
  const onAction = fs.readFileSync(onActionPath, "utf8");
  const clock = fs.readFileSync(clockPath, "utf8");

  const bridgeStates = blocksFor(bridge, /\bstate\s*=\s*\{/g);
  const stateNames = bridgeStates.map(block => maskNonCode(block).match(/\bname\s*=\s*([A-Za-z0-9_]+)/)?.[1]);
  assert.deepEqual(stateNames, ["bridge_registered", "clock", "outbound"],
    "native bridge has registration plus one bounded clock/outbound loop");
  assert.equal((bridge.match(/\brun\s+votc\.txt\b/g) || []).length, 1,
    "the native GUI route consumes votc.txt exactly once");
  assert.equal((bridge.match(/\brun\s+letters\.txt\b/g) || []).length, 0,
    "the native GUI route never consumes letters.txt");
  assert.match(bridgeStates[1], /duration\s*=\s*0\.1[\s\S]*?next\s*=\s*outbound/);
  assert.match(bridgeStates[2], /duration\s*=\s*1\.9[\s\S]*?next\s*=\s*clock/);
  assert.equal(blocksFor(runner, /\bstate\s*=\s*\{/g).length, 0,
    "retired legacy runner contains no timer states");
  assert.equal(/\bcreatewidget\b/i.test(maskNonCode(invisibleEvent)), false,
    "invisible event no longer creates the old runner");

  const afterLobby = blocksFor(onAction, /(?:^|\n)\s*votc_load_boundary_after_lobby\s*=\s*\{/g);
  assert.equal(afterLobby.length, 1, "after-lobby action is structurally present once");
  assert.match(afterLobby[0], /VOTC:DATE/);
  assert.doesNotMatch(afterLobby[0], /mcc_event_v2\.9998/);
  assert.match(clock, /VOTC:DATE\/;\//, "native scripted GUI emits the live DATE marker");
  assert.doesNotMatch(clock, /run\s+letters\.txt/);
}

function loadHeadManagerFactory() {
  const root = path.resolve(__dirname, "..");
  const filename = path.join(root, "resources", "app", "out", "main", "letters", "letter-manager.js");
  const source = execFileSync("git", ["show", "HEAD:resources/app/out/main/letters/letter-manager.js"], {
    cwd: root, encoding: "utf8", windowsHide: true, maxBuffer: 4 * 1024 * 1024
  });
  const headModule = new Module(filename, module);
  headModule.filename = filename;
  headModule.paths = Module._nodeModulePaths(path.dirname(filename));
  headModule._compile(source, filename);
  assert.equal(typeof headModule.exports.createLetterManager, "function", "HEAD manager factory compiles in memory");
  return headModule.exports.createLetterManager;
}

async function testPayloadCarrierAssertion(managerFactory) {
  const fixture = createFixture(managerFactory);
  try {
    const before = fixture.readCarriers();
    fixture.setParsedGameData(makeGameData());
    await fixture.manager.processLatestLetter();
    assert.deepEqual(fixture.readCarriers(), before,
      "processing a letter payload must not alter either pre-existing carrier");
  } finally {
    fixture.close();
  }
}

async function runNormal() {
  testGameScriptStructure();
  await testRetiredRecoveryAndSingleDelivery();
  await testDiagnosticStages();
}

async function runHeadBaseline() {
  try {
    await testPayloadCarrierAssertion(loadHeadManagerFactory());
  } catch (error) {
    console.error("HEAD baseline RED as expected: " + error.message);
    process.exitCode = 1;
    return;
  }
  console.error("HEAD baseline unexpectedly passed the retired-carrier assertion.");
  process.exitCode = 1;
}

async function main() {
  if (process.argv.includes("--head-baseline")) return runHeadBaseline();
  await runNormal();
  console.log("V8.15.2 letter timer retirement QA: PASS (manager heartbeat/ACK isolation, live DATE single delivery, duplicate receipt, A1 retirement/A2 independence, game script structure)");
}

main().catch(error => {
  console.error("V8.15.2 letter timer retirement QA: FAIL");
  console.error(error);
  process.exitCode = 1;
});
