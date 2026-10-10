"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createRunFileManager } = require("../resources/app/out/main/actions/run-file-manager");
const { createLetterEffectTransport } = require("../resources/app/out/main/letters/letter-effect-transport");
const { createLetterManager } = require("../resources/app/out/main/letters/letter-manager");

const root = path.join(__dirname, "..");
const patchRoot = path.join(root, "compatibility-patches", "v8.15.2-letter-runner");
const bridgePath = path.join(patchRoot, "gui", "custom_gui", "votc_runtime_bridge.gui");
const bridgeSource = fs.readFileSync(bridgePath, "utf8");
const legacyBlockedGate = "ExecuteConsoleCommand(Select_CString(And(GetPlayer.IsValid, Not(GetGlobalVariable('talk_scene').IsSet)), 'run votc.txt', ''))";
const tempRoots = [];

function maskNonCode(source) {
  let output = "";
  let inString = false;
  let escaped = false;
  let inComment = false;
  for (const character of source) {
    if (inComment) {
      if (character === "\n") {
        output += "\n";
        inComment = false;
      } else output += " ";
      continue;
    }
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      output += character === "\n" ? "\n" : " ";
      continue;
    }
    if (character === "#") {
      inComment = true;
      output += " ";
    } else if (character === '"') {
      inString = true;
      output += " ";
    } else output += character;
  }
  return output;
}

function findClosingBrace(masked, openIndex) {
  assert.equal(masked[openIndex], "{", "GUI parser starts at a block opening");
  let depth = 0;
  for (let index = openIndex; index < masked.length; index++) {
    if (masked[index] === "{") depth++;
    else if (masked[index] === "}" && --depth === 0) return index;
  }
  assert.fail("unclosed GUI block");
}

function extractNamedState(source, stateName) {
  const masked = maskNonCode(source);
  const statePattern = /\bstate\s*=\s*\{/g;
  for (const match of masked.matchAll(statePattern)) {
    const openIndex = masked.indexOf("{", match.index);
    const closeIndex = findClosingBrace(masked, openIndex);
    const body = source.slice(openIndex + 1, closeIndex);
    if (new RegExp(`\\bname\\s*=\\s*${stateName}\\b`).test(maskNonCode(body))) return body;
  }
  assert.fail(`missing GUI state ${stateName}`);
}

function tokenizeExpression(source) {
  const tokens = [];
  for (let index = 0; index < source.length;) {
    if (/\s/.test(source[index])) {
      index++;
      continue;
    }
    const character = source[index];
    if ("(),.".includes(character)) {
      tokens.push(character);
      index++;
      continue;
    }
    if (character === "'") {
      let value = "";
      index++;
      while (index < source.length && source[index] !== "'") {
        if (source[index] === "\\" && index + 1 < source.length) index++;
        value += source[index++];
      }
      assert.equal(source[index], "'", "GUI expression has a closed single-quoted string");
      index++;
      tokens.push({ type: "string", value });
      continue;
    }
    const identifier = source.slice(index).match(/^[A-Za-z_][A-Za-z0-9_]*/);
    assert(identifier, `unsupported token in GUI expression at offset ${index}`);
    tokens.push({ type: "identifier", value: identifier[0] });
    index += identifier[0].length;
  }
  return tokens;
}

function parseExpression(source) {
  const tokens = tokenizeExpression(source);
  let cursor = 0;
  function take(expected) {
    const token = tokens[cursor++];
    assert(token !== undefined, `expected ${expected || "expression token"}`);
    if (expected) assert.equal(token, expected, `expected ${expected}`);
    return token;
  }
  function parsePrimary() {
    const token = take();
    let node;
    if (token.type === "string") node = { type: "string", value: token.value };
    else {
      assert.equal(token.type, "identifier", "Pdx expression starts with a name or string");
      node = { type: "identifier", name: token.value };
    }
    while (cursor < tokens.length) {
      if (tokens[cursor] === ".") {
        take(".");
        const property = take();
        assert.equal(property.type, "identifier", "Pdx member name is an identifier");
        node = { type: "member", object: node, property: property.value };
      } else if (tokens[cursor] === "(") {
        take("(");
        const args = [];
        if (tokens[cursor] !== ")") {
          do {
            args.push(parsePrimary());
            if (tokens[cursor] !== ",") break;
            take(",");
          } while (true);
        }
        take(")");
        node = { type: "call", callee: node, args };
      } else break;
    }
    return node;
  }
  const expression = parsePrimary();
  assert.equal(cursor, tokens.length, "Pdx expression has no unparsed suffix");
  return expression;
}

function evaluateExpression(node, state) {
  if (node.type === "string") return node.value;
  if (node.type === "identifier") {
    if (node.name === "GetPlayer") return { type: "player" };
    return { type: "function", name: node.name };
  }
  if (node.type === "member") {
    const object = evaluateExpression(node.object, state);
    if (object?.type === "player" && node.property === "IsValid") return state.playerValid === true;
    if (object?.type === "global_variable" && node.property === "IsSet") return state.talkSceneSet === true;
    assert.fail(`unsupported GUI member ${node.property}`);
  }
  if (node.type === "call") {
    const callee = evaluateExpression(node.callee, state);
    assert.equal(callee?.type, "function", "GUI call target is a supported function");
    const args = node.args.map(argument => evaluateExpression(argument, state));
    switch (callee.name) {
      case "Select_CString": return args[0] ? args[1] : args[2];
      case "ExecuteConsoleCommand": return args[0];
      case "And": return args.every(Boolean);
      case "Not": return !args[0];
      case "GetGlobalVariable":
        assert.equal(args[0], "talk_scene", "negative control references the legacy scene gate");
        return { type: "global_variable" };
      default: assert.fail(`unsupported GUI function ${callee.name}`);
    }
  }
  assert.fail(`unsupported GUI expression node ${node.type}`);
}

function evaluateOutboundGate(source, state) {
  const outbound = extractNamedState(source, "outbound");
  const onStart = outbound.match(/\bon_start\s*=\s*"\[([^\]]+)\]"/);
  assert(onStart, "outbound GUI state has an executable on_start expression");
  return evaluateExpression(parseExpression(onStart[1]), state);
}

function extractRunGuard(carrier) {
  const guard = carrier.match(/limit\s*=\s*\{\s*NOT\s*=\s*\{\s*global_var:([A-Za-z0-9_]+)\s*=\s*flag:([A-Za-z0-9_-]+)\s*\}\s*\}/);
  assert(guard, "real RunFileManager carrier includes its per-command global dedup guard");
  const assignment = [...carrier.matchAll(/set_global_variable\s*=\s*\{\s*name\s*=\s*([A-Za-z0-9_]+)\s+value\s*=\s*flag:([A-Za-z0-9_-]+)\s*\}/g)]
    .find(match => match[1] === guard[1] && match[2] === guard[2]);
  assert(assignment, "game-side guard has a matching command-ID assignment");
  return { variable: guard[1], commandId: guard[2] };
}

function pollCarrier(carrier, gameState) {
  const guard = extractRunGuard(carrier);
  if (gameState.globals[guard.variable] === guard.commandId) {
    return { executed: false, artifactCount: 0, ackMarker: null, commandId: guard.commandId };
  }
  gameState.globals[guard.variable] = guard.commandId;
  const ack = carrier.match(/debug_log\s*=\s*"(VOTC:RUN_ACK\/[A-Z0-9_-]+\/[A-Za-z0-9_-]+)"/);
  assert(ack, "actual carrier contains an app-consumable command ACK marker");
  return {
    executed: true,
    artifactCount: (carrier.match(/\bcreate_artifact\s*=\s*\{/g) || []).length,
    ackMarker: ack[1],
    commandId: guard.commandId
  };
}

function createHarness(name) {
  const tempRoot = fs.mkdtempSync(path.join(__dirname, `.tmp-v8.15.2-outbound-bridge-${name}-`));
  tempRoots.push(tempRoot);
  const ck3Dir = path.join(tempRoot, "ck3");
  const dataDir = path.join(tempRoot, "data");
  const runDir = path.join(ck3Dir, "run");
  const logDir = path.join(ck3Dir, "logs");
  const runFile = path.join(runDir, "votc.txt");
  const debugLog = path.join(logDir, "debug.log");
  fs.mkdirSync(runDir, { recursive: true });
  fs.mkdirSync(logDir, { recursive: true });
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(runFile, "", "utf8");
  fs.writeFileSync(debugLog, "", "utf8");

  let clock = 1_000;
  const settingsRepository = {
    getCK3UserFolderPath: () => ck3Dir,
    getCK3DebugLogPath: () => debugLog,
    getSummaryPromptSettings: () => ({})
  };
  const RunFileManager = createRunFileManager({
    settingsRepository, path, fs, dataDir,
    now: () => clock,
    random: () => 0.25
  });
  const runFileManager = new RunFileManager();
  runFileManager.initializeAfterAckReconciliation();
  const { LetterEffectTransport } = createLetterEffectTransport({ settingsRepository, fs, path, runFileManager, dataDir });
  const letterEffectTransport = new LetterEffectTransport();
  const intervalStub = callback => ({ callback, unref() {} });
  let providerCalls = 0;
  const { LetterManager, LetterResponseStatus } = createLetterManager({
    settingsRepository, fs, path, TailFile: class {}, readline: {}, parseLog: async () => null,
    letterPromptBuilder: { buildMessages: () => [] },
    llmManager: { sendChatRequest: async () => { providerCalls++; throw new Error("Provider must not be called in this fixture"); } },
    PromptBuilder: {}, TokenCounter: { estimateMessageTokens: () => 1 }, memoryEngine: null,
    dataDir, letterEffectTransport, runFileManager, autoStartLogTailing: false,
    setIntervalFn: intervalStub, clearIntervalFn() {},
    setRunCommandIntervalFn: intervalStub, clearRunCommandIntervalFn() {}
  });
  const letterManager = new LetterManager();
  letterManager.currentTotalDays = 100;

  return {
    ck3Dir, dataDir, runFile, debugLog, runFileManager, letterManager, LetterResponseStatus,
    providerCallCount: () => providerCalls,
    advance: milliseconds => { clock += milliseconds; },
    cleanup() {
      assert.equal(path.dirname(tempRoot), __dirname, "fixture cleanup stays inside scripts/");
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  };
}

function seedPendingLetter(harness, { letterId, expectedDay, content }) {
  const letter = { letterId, totalDays: 100, delay: expectedDay - 100, content };
  const timing = {
    payloadGameDay: 100, trackerGameDayAtCreation: 100, reconciledGameDayAtCreation: null,
    deliveryBaseDay: 100, dateDelta: 0, dateSourceDecision: "PAYLOAD_ALIGNED",
    dateSourceEvent: "DATE_ALIGNED", expectedDeliveryDay: expectedDay
  };
  const { letterManager, LetterResponseStatus } = harness;
  letterManager.createLetterStatus(letter, "Synthetic Recipient", timing);
  letterManager.updateLetterStatus(letterId, {
    responseStatus: LetterResponseStatus.PENDING_DELIVERY,
    responseContent: "Synthetic reply",
    expectedDeliveryDay: expectedDay
  });
  letterManager.storedLetters.set(letterId, {
    letter, reply: "Synthetic reply", expectedDeliveryDay: expectedDay,
    characterName: "Synthetic Recipient", ...timing
  });
  letterManager.savePendingLetters();
}

async function run() {
  try {
    const talkSceneAfterClose = { playerValid: true, talkSceneSet: true, counterDestroyed: true };
    assert.doesNotMatch(bridgeSource, /talk_scene|talk_window_counter/,
      "global outbound bridge must not depend on scene or counter-widget lifetime");
    assert.equal(evaluateOutboundGate(bridgeSource, talkSceneAfterClose), "run votc.txt",
      "a valid player with stale talk_scene and a destroyed counter must still poll the actual bridge carrier");
    assert.equal(evaluateOutboundGate(bridgeSource, { ...talkSceneAfterClose, playerValid: false }), "",
      "without a valid player the bridge must not issue a Run File command");
    assert.equal(evaluateExpression(parseExpression(legacyBlockedGate), talkSceneAfterClose), "",
      "negative control: the retired talk_scene gate would suppress this exact scenario");

    const harness = createHarness("delivery-and-close");
    try {
      seedPendingLetter(harness, { letterId: "letter_other_pending", expectedDay: 110, content: "Synthetic older pending" });
      seedPendingLetter(harness, { letterId: "letter_due_qa", expectedDay: 102, content: "Synthetic due letter" });
      const { letterManager, runFileManager } = harness;

      await letterManager.updateCurrentDate(101);
      assert.equal(runFileManager.getPendingCommands().length, 0,
        "a pending letter must not queue a Run File command before its exact due day");
      assert.equal(letterManager.awaitingAcceptanceLetterId, null);

      await letterManager.updateCurrentDate(102);
      const firstDueCommand = runFileManager.getPendingCommands()[0];
      assert(firstDueCommand, "the exact due-day transition queues the formal letter command");
      assert.equal(firstDueCommand.kind, "letter_effect");
      assert.match(firstDueCommand.effectText, /message_second_scope_letter_due_qa/,
        "the queued formal effect belongs to the due letter ID");
      assert.doesNotMatch(firstDueCommand.effectText, /message_second_scope_letter_other_pending/,
        "another pending letter ID is not linked into the due command");
      await letterManager.updateCurrentDate(102);
      await letterManager.checkAndDeliverLetters();
      assert.equal(runFileManager.getPendingCommands().length, 1,
        "repeated date polling of the due day queues exactly one formal effect");
      assert.equal(runFileManager.getPendingCommands()[0].commandId, firstDueCommand.commandId);
      assert.equal(runFileManager.getPendingCommands()[0].writeAttempts, 1);

      const carrierSnapshot = fs.readFileSync(harness.runFile, "utf8");
      assert.equal((carrierSnapshot.match(/\bcreate_artifact\s*=\s*\{/g) || []).length, 1,
        "the real RunFileManager carrier contains one formal artifact creation");
      const gameState = { globals: {} };
      const automaticConsumer = pollCarrier(carrierSnapshot, gameState);
      const talkCounterConsumer = pollCarrier(carrierSnapshot, gameState);
      assert.equal(automaticConsumer.executed, true, "the first independent consumer executes the same carrier command");
      assert.equal(automaticConsumer.artifactCount, 1);
      assert.equal(talkCounterConsumer.executed, false, "a second consumer with the same command ID is stopped by the game-side guard");
      assert.equal(talkCounterConsumer.artifactCount, 0, "two consumers do not create a duplicate artifact");
      assert.equal(automaticConsumer.commandId, firstDueCommand.commandId);

      await letterManager.processLogLine("VOTC:RUN_ACK/LETTER_EFFECT/unrelated_old_command");
      assert.equal(runFileManager.getPendingCommands()[0].commandId, firstDueCommand.commandId,
        "an ACK associated with another pending ID cannot consume this letter");
      fs.appendFileSync(harness.debugLog, `${automaticConsumer.ackMarker}\n`, "utf8");
      await letterManager.processLogLine(automaticConsumer.ackMarker);
      assert.equal(runFileManager.getPendingCommands().length, 0,
        "the app ACK fixture consumes the exact command written by the actual RunFileManager");
      assert.equal(letterManager.awaitingAcceptanceLetterId, "letter_due_qa");
      assert.equal(letterManager.getLetterStatus("letter_other_pending").responseStatus,
        harness.LetterResponseStatus.PENDING_DELIVERY,
        "ACK for the due letter leaves the different pending letter untouched");

      const conversationSource = fs.readFileSync(path.join(root, "resources", "app", "out", "main", "conversation", "conversation.js"), "utf8");
      assert.match(conversationSource, /runFileManager\.write\("trigger_event = mcc_event_v2\.9002",\s*\{[\s\S]*?kind:\s*"conversation_close"/,
        "the real conversation close producer queues mcc_event_v2.9002 through RunFileManager");
      const closeCommand = runFileManager.write("trigger_event = mcc_event_v2.9002", {
        owner: "conversation", kind: "conversation_close", scopeId: "bridge-qa-scene",
        epoch: 1, expiresInMs: 15_000, destructive: true, supersedable: true
      });
      assert.equal(evaluateOutboundGate(bridgeSource, talkSceneAfterClose), "run votc.txt",
        "conversation_close remains consumable while talk_scene is set and the counter widget is gone");
      const closeCarrier = fs.readFileSync(harness.runFile, "utf8");
      assert(closeCarrier.includes(`trigger_event = mcc_event_v2.9002`),
        "the queued close carrier contains the existing scene-close event");
      const closePoll = pollCarrier(closeCarrier, gameState);
      assert.equal(closePoll.commandId, closeCommand.commandId);
      assert.equal(closePoll.executed, true);
      const sceneState = { talkSceneSet: true };
      if (closeCarrier.includes("trigger_event = mcc_event_v2.9002")) sceneState.talkSceneSet = false;
      assert.equal(sceneState.talkSceneSet, false,
        "synthetic close-event fixture clears the stale scene after the bridge dispatches it");
      fs.appendFileSync(harness.debugLog, `${closePoll.ackMarker}\n`, "utf8");
      await letterManager.processLogLine(closePoll.ackMarker);
      assert.equal(runFileManager.getPendingCommands().length, 0,
        "the app ACK fixture also releases the conversation-close queue head");
      assert.equal(harness.providerCallCount(), 0, "scheduled delivery and close tests do not call a Provider");
    } finally {
      harness.cleanup();
    }

    const stalledHarness = createHarness("ack-timeout-stalled");
    try {
      const command = stalledHarness.runFileManager.write("create_artifact = { name = qa_no_ack }", {
        owner: "action", kind: "action_effect", commandId: "qa_no_ack_timeout"
      });
      assert.equal(command.status, "awaiting_ack");
      const gameState = { globals: {} };
      const firstWriteCarrier = fs.readFileSync(stalledHarness.runFile, "utf8");
      const automaticConsumer = pollCarrier(firstWriteCarrier, gameState);
      assert.equal(automaticConsumer.executed, true, "the automatic consumer executes the first write once");
      assert.equal(automaticConsumer.artifactCount, 1);
      const initialAttempts = stalledHarness.runFileManager.getPendingCommands()[0].writeAttempts;
      assert.equal(initialAttempts, 1);
      stalledHarness.advance(30_001);
      const timeout = stalledHarness.runFileManager.markActiveCommandStalledIfNeeded({ ackTimeoutMs: 30_000 });
      assert.equal(timeout.status, "stalled", "a missing ACK becomes STALLED");
      assert.equal(stalledHarness.runFileManager.getPendingCommands()[0].writeAttempts, initialAttempts);
      assert.equal(stalledHarness.runFileManager.recoverPendingCommands()[0].status, "stalled");
      stalledHarness.runFileManager.writeActiveCommand();
      assert.equal(stalledHarness.runFileManager.getPendingCommands()[0].writeAttempts, initialAttempts,
        "timeout recovery and another poll do not replay an unacknowledged effect");
      assert.doesNotMatch(fs.readFileSync(stalledHarness.runFile, "utf8"), /qa_no_ack_timeout/,
        "the uncertain carrier is neutralized instead of being automatically re-executed");

      const explicitlyRetried = stalledHarness.runFileManager.retryStalledCommand(command.commandId);
      assert.equal(explicitlyRetried.status, "awaiting_ack", "a manual retry remains an explicit user-authorized transition");
      assert.equal(explicitlyRetried.writeAttempts, 2);
      const manualRetryConsumer = pollCarrier(fs.readFileSync(stalledHarness.runFile, "utf8"), gameState);
      assert.equal(manualRetryConsumer.executed, false,
        "the manual retry's same command ID is deduplicated after the automatic consumer already executed it");
      assert.equal(manualRetryConsumer.artifactCount, 0, "automatic delivery plus manual retry still creates only one artifact");
      assert.equal(stalledHarness.runFileManager.getPendingCommands()[0].writeAttempts, 2,
        "a second poll of the explicitly retried carrier does not write or execute another effect");
    } finally {
      stalledHarness.cleanup();
    }

    console.log("V8.15.2 outbound bridge independent QA: PASS (gate AST, due-day dispatch, dual-consumer dedup, scene-close queue, ACK timeout and unrelated pending letter)");
  } finally {
    for (const tempRoot of tempRoots) {
      assert.equal(path.dirname(tempRoot), __dirname, "fixture cleanup stays inside scripts/");
      if (fs.existsSync(tempRoot)) fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  }
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
