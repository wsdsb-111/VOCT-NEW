"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createRunFileManager } = require("../resources/app/out/main/actions/run-file-manager");

const patchRoot = path.join(__dirname, "..", "compatibility-patches", "v8.15.2-letter-runner");
const bridgePath = path.join(patchRoot, "gui", "custom_gui", "votc_runtime_bridge.gui");
const bridge = fs.readFileSync(bridgePath, "utf8");

function extractBlock(source, openBrace) {
  let depth = 0;
  let quote = null;
  let inComment = false;
  for (let index = openBrace; index < source.length; index += 1) {
    const character = source[index];
    if (inComment) {
      if (character === "\n") inComment = false;
      continue;
    }
    if (quote) {
      if (character === quote && source[index - 1] !== "\\") quote = null;
      continue;
    }
    if (character === "#") {
      inComment = true;
      continue;
    }
    if (character === "\"" || character === "'") {
      quote = character;
      continue;
    }
    if (character === "{") depth += 1;
    if (character === "}" && --depth === 0) return source.slice(openBrace, index + 1);
  }
  throw new Error("unterminated Clausewitz block");
}

function getStateBlocks(source) {
  return [...source.matchAll(/\bstate\s*=\s*\{/g)].map(match => {
    const openBrace = source.indexOf("{", match.index);
    return extractBlock(source, openBrace);
  });
}

function matchingParen(expression, openParen) {
  let depth = 0;
  let quote = null;
  for (let index = openParen; index < expression.length; index += 1) {
    const character = expression[index];
    if (quote) {
      if (character === quote && expression[index - 1] !== "\\") quote = null;
      continue;
    }
    if (character === "\"" || character === "'") {
      quote = character;
      continue;
    }
    if (character === "(") depth += 1;
    if (character === ")" && --depth === 0) return index;
  }
  throw new Error("unterminated GUI expression call");
}

function splitArguments(source) {
  const args = [];
  let depth = 0;
  let quote = null;
  let start = 0;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (character === quote && source[index - 1] !== "\\") quote = null;
      continue;
    }
    if (character === "\"" || character === "'") {
      quote = character;
      continue;
    }
    if (character === "(") depth += 1;
    if (character === ")") depth -= 1;
    if (character === "," && depth === 0) {
      args.push(source.slice(start, index).trim());
      start = index + 1;
    }
  }
  args.push(source.slice(start).trim());
  return args;
}

function callArguments(expression, name) {
  const callStart = expression.indexOf(`${name}(`);
  assert.notStrictEqual(callStart, -1, `${name} call must be present`);
  const openParen = callStart + name.length;
  const closeParen = matchingParen(expression, openParen);
  return splitArguments(expression.slice(openParen + 1, closeParen));
}

function evaluateCondition(expression, fixture) {
  const condition = expression.trim();
  if (condition === "GetPlayer.IsValid") return fixture.playerValid;
  if (condition === "GetGlobalVariable('talk_scene').IsSet") return fixture.talkSceneSet;
  if (condition.startsWith("And(")) return callArguments(condition, "And").every(arg => evaluateCondition(arg, fixture));
  if (condition.startsWith("Not(")) return !evaluateCondition(callArguments(condition, "Not")[0], fixture);
  throw new Error(`unsupported GUI condition: ${condition}`);
}

const stateBlocks = getStateBlocks(bridge);
const stateNames = stateBlocks.map(block => block.match(/\bname\s*=\s*([A-Za-z0-9_]+)/)?.[1]);
assert.deepStrictEqual(stateNames, ["bridge_registered", "clock", "outbound"],
  "the existing registration and single clock/outbound loop remain intact");

const clockState = stateBlocks[1];
const outboundState = stateBlocks[2];
assert.match(clockState, /duration\s*=\s*0\.1[\s\S]*?next\s*=\s*outbound/);
assert.match(clockState, /GetScriptedGui\('votc_runtime_clock'\)\.Execute/,
  "the native DATE clock call must remain intact");
assert.match(outboundState, /duration\s*=\s*1\.9[\s\S]*?next\s*=\s*clock/);
assert.strictEqual((bridge.match(/\brun\s+votc\.txt\b/g) || []).length, 1);
assert.doesNotMatch(bridge, /\brun\s+letters\.txt\b/,
  "the bridge must not revive the retired letters.txt consumer");

const onStart = outboundState.match(/\bon_start\s*=\s*"([^"]+)"/)?.[1];
assert.ok(onStart, "outbound state must have an on_start expression");
const executeArgs = callArguments(onStart, "ExecuteConsoleCommand");
assert.strictEqual(executeArgs.length, 1);
const selectArgs = callArguments(executeArgs[0], "Select_CString");
assert.strictEqual(selectArgs.length, 3);
const [condition, runCommand, noCommand] = selectArgs;
assert.strictEqual(runCommand, "'run votc.txt'");
assert.strictEqual(noCommand, "''");

assert.strictEqual(evaluateCondition(condition, {
  playerValid: true,
  talkSceneSet: true,
  talkWindowCounterExists: false
}) ? "run votc.txt" : "",
"run votc.txt", "a leftover talk_scene without talk_window_counter must not stop outbound polling");
assert.strictEqual(evaluateCondition(condition, {
  playerValid: false,
  talkSceneSet: false,
  talkWindowCounterExists: false
}) ? "run votc.txt" : "", "",
"outbound polling must remain disabled when there is no player");
assert.strictEqual(condition, "GetPlayer.IsValid",
  "outbound polling must depend only on the current player");

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v8152-outbound-bridge-"));
try {
  const ck3UserPath = path.join(tempRoot, "ck3");
  const RunFileManager = createRunFileManager({
    settingsRepository: { getCK3UserFolderPath: () => ck3UserPath },
    path,
    fs,
    dataDir: path.join(tempRoot, "data")
  });
  const manager = new RunFileManager();
  const commandId = "bridge-consumer-test";
  const commandBody = manager.composeCommandText({
    commandId,
    kind: "letter_effect",
    effectText: 'debug_log = "VOTC:BRIDGE_CONSUMER_TEST"'
  });
  const dedupStart = commandBody.indexOf("set_global_variable = { name = votc_last_run_command value = flag:bridge-consumer-test }");
  const effectPosition = commandBody.indexOf('debug_log = "VOTC:BRIDGE_CONSUMER_TEST"');
  const ackPosition = commandBody.indexOf('debug_log = "VOTC:RUN_ACK/LETTER_EFFECT/bridge-consumer-test"');
  assert(dedupStart >= 0 && effectPosition > dedupStart && ackPosition > effectPosition,
    "the real RunFile command body must keep command-ID dedup before the Effect and ACK after it");
  assert.match(commandBody, /global_var:votc_last_run_command = flag:bridge-consumer-test/);
  assert.doesNotMatch(commandBody, /votc_last_action_command/,
    "Letter commands must retain the shared non-Action run-command dedup variable");
  assert.strictEqual(fs.existsSync(path.join(ck3UserPath, "run", "votc.txt")), false,
    "inspecting the composed command body must not write a runtime carrier");
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

console.log("V8.15.2 outbound bridge regression: PASS");
