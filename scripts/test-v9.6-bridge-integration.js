"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { BridgeCompatibilityService } = require("../src/app/main/bridge/bridge-compatibility-service");
const { createBridgeBusinessEvidence } = require("../src/app/main/bridge/bridge-business-evidence");
const { createActionEffectWriter } = require("../src/app/main/actions/action-effect-writer");
const { createActionEngine } = require("../src/app/main/actions/action-engine");
const { createRunFileManager } = require("../src/app/main/actions/run-file-manager");
const { createLetterManager } = require("../src/app/main/letters/letter-manager");
// These modules use the packaged relative package.json layout; verify the real build.
const { createGameData } = require("../.build/runtime/app/out/main/game-data/game-data");
const { Conversation } = require("../.build/runtime/app/out/main/conversation/conversation");
const manifest = require("../src/app/main/bridge/runtime-manifest.json");

const root = path.resolve(__dirname, "..");
const source = relative => fs.readFileSync(path.join(root, "src/app", relative), "utf8");
const caps = Object.keys(manifest.capabilities);
const hello = (load, omit = []) => `VOTC:BRIDGE_HELLO/;/schema=1/;/protocol=1.0/;/mod=2.0.5/;/upstream=2.0.4/;/revision=1/;/load=${load}/;/caps=${caps.filter(id => !omit.includes(id)).map(id => `${id}:1`).join(",")}`;

async function main() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v96-integration-"));
  const logPath = path.join(directory, "debug.log");
  const carrier = path.join(directory, "votc.txt");
  fs.writeFileSync(logPath, "");
  fs.writeFileSync(carrier, "anonymous-existing-command-do-not-replay");
  const service = new BridgeCompatibilityService({ getLogPath: () => logPath, pollIntervalMs: 60000 });
  try {
    await service.start();
    const evidence = createBridgeBusinessEvidence(service);
    let writes = 0;
    let releases = 0;
    const manager = {
      releaseStalledActionForNewAction() { releases++; },
      getQueueHealth() { return { queueBlocked: false }; },
      write() { writes++; const commandId = `anonymous-${writes}`; evidence.trackDispatch(commandId); return { commandId }; }
    };
    const Writer = createActionEffectWriter({ runFileManager: manager, bridgeService: service });
    const gameData = { playerID: 1, characters: new Map([[1, { id: 1 }], [2, { id: 2 }]]) };
    assert.equal(Writer.writeEffect(gameData, 2, 1, "# synthetic effect").commandId, "anonymous-1", "no-Hello legacy retains the original writer path");
    evidence.observeCommand("runFileAck", "anonymous-1");
    assert.equal(service.getState().channels.runFileAck, "UNKNOWN", "pre-boundary legacy commands cannot prove current channel health");

    const load = async (token, omitted = []) => {
      fs.appendFileSync(logPath, `VOTC:LOAD_SESSION/;/${token}\n${hello(token, omitted)}\n`);
      return service.redetect();
    };
    await load("votc-load-a");
    assert.equal(service.getState().channels.runFileAck, "UNKNOWN", "Hello is not an ACK");
    const dispatched = Writer.writeEffect(gameData, 2, 1, "# synthetic effect");
    evidence.observeCommand("runFileAck", "arbitrary-old-command");
    assert.equal(service.getState().channels.runFileAck, "UNKNOWN");
    evidence.observeCommand("runFileAck", dispatched.commandId);
    evidence.observeCommand("actionReadback", dispatched.commandId);
    evidence.observeClipboard();
    assert.equal(service.getState().channels.runFileAck, "OBSERVED");
    assert.equal(service.getState().channels.actionReadback, "OBSERVED");
    assert.equal(service.getState().channels.clipboard, "OBSERVED");
    await load("votc-load-a");
    evidence.observeCommand("runFileAck", dispatched.commandId);
    assert.equal(service.getState().channels.runFileAck, "UNKNOWN", "even repeated LOAD tokens reset dispatch evidence");
    assert.equal(evidence.isCurrentCommand(dispatched.commandId), false);
    Conversation.configure({ bridgeService: service, bridgeEvidence: evidence, runFileManager: { expireQueuedActions() {} } });
    const stale = await Conversation.prototype.waitForActionConfirmation.call({
      getRunCommand: () => ({ commandId: dispatched.commandId, status: "acknowledged" })
    }, { confirmation: { requireCommandReadback: true, type: "GOLD_TRANSFER", dispatch: { commandId: dispatched.commandId } } });
    assert.equal(stale.lifecycle.status, "UNCONFIRMED", "stale dispatches cannot be confirmed using a prior log readback");

    await load("votc-load-b", ["runfile_consumer"]);
    const before = { writes, releases };
    assert.throws(() => Writer.writeEffect(gameData, 2, 1, "# blocked effect"), /bridge_feature_unavailable/);
    assert.deepEqual({ writes, releases }, before, "known incompatible Action must stop before queue release or write");
    const { LetterManager } = createLetterManager({ settingsRepository: {}, fs, path, letterEffectTransport: {}, bridgeService: service });
    await assert.rejects(LetterManager.prototype.writeLetterEffect.call({}, "synthetic reply", {}), /bridge_feature_unavailable/);
    await assert.rejects(LetterManager.prototype.retryFailedLetter.call({}, "synthetic-letter"), /bridge_feature_unavailable/);
    const Engine = createActionEngine({ bridgeService: service });
    await assert.rejects(Engine.evaluateForCharacter({}, {}), /bridge_feature_unavailable/, "blocked actions stop before provider/check work");
    assert.equal(service.assertFeature("conversation"), true, "unaffected conversation remains usable");

    await load("votc-load-c", ["action_readback", "trait_export", "official_recollection_export"]);
    let legacyReadAttempted = false;
    evidence.trackDispatch("anonymous-ack");
    const result = await Conversation.prototype.waitForActionConfirmation.call({
      getRunCommand: () => ({ commandId: "anonymous-ack", status: "acknowledged" }),
      refreshGameDataForActionConfirmation() { legacyReadAttempted = true; }
    }, { confirmation: { requireCommandReadback: true, type: "GOLD_TRANSFER", dispatch: { commandId: "anonymous-ack" } } });
    assert.equal(result.lifecycle.status, "UNCONFIRMED");
    assert.equal(result.success, false, "ACK without a readback capability cannot become effect confirmation");
    assert.equal(legacyReadAttempted, false);
    const parsed = { characters: new Map([[2, { traits: [{ name: "synthetic" }], children: [{ traits: [{ name: "synthetic-child" }] }] }]]) };
    evidence.projectGameData(parsed);
    assert.deepEqual(parsed.characters.get(2).traits, []);
    assert.equal(parsed.characters.get(2).traitsAvailable, false);
    assert.deepEqual(parsed.characters.get(2).children[0].traits, []);
    const GameData = createGameData({ fs, path, memorySystem: {}, summariesDir: directory });
    assert.equal(GameData.prototype.getOfficialRecollectionSummary.call(parsed, 2, "synthetic-session"), null);
    assert.equal(GameData.prototype.syncOfficialRecollectionSummaries.call(parsed, "synthetic-session"), undefined);
    assert.equal(service.assertFeature("action"), true, "missing readback does not disable dispatch when consumer and ACK remain available");

    const beforeRedetect = service.getState().sessionEvidence.generation;
    await service.redetect();
    assert.equal(service.getState().sessionEvidence.generation, beforeRedetect);
    assert.equal(fs.readFileSync(carrier, "utf8"), "anonymous-existing-command-do-not-replay", "read-only diagnostics must never touch the carrier");
    const exposed = {};
    const invocations = [];
    vm.runInNewContext(source("preload/preload.js"), {
      require: name => {
        assert.equal(name, "electron");
        return { contextBridge: { exposeInMainWorld: (name, api) => { exposed[name] = api; } },
          ipcRenderer: { invoke: (...args) => { invocations.push(args); }, on() {}, send() {} } };
      }
    });
    assert.deepEqual(Object.keys(exposed.bridgeAPI), ["getState", "redetect"]);
    exposed.bridgeAPI.getState("untrusted-path");
    exposed.bridgeAPI.redetect({ write: true });
    assert.deepEqual(invocations, [["bridge:getState"], ["bridge:redetect"]], "bridge IPC accepts no client paths, writes, or probe payloads");
    const main = source("main/main.js");
    assert.match(main, /await bridgeService\.start\(\)/);
    assert.match(main, /bridgeService\.stop\(\)/);
    assert.match(main, /createActionEffectWriter\(\{ runFileManager, bridgeService \}\)/);
    assert.match(main, /onCommandWritten: command => bridgeEvidence\.trackDispatch\(command\.commandId\)/);
    const ck3Dir = path.join(directory, "synthetic-ck3");
    fs.mkdirSync(path.join(ck3Dir, "run"), { recursive: true });
    const Queue = createRunFileManager({ settingsRepository: { getCK3UserFolderPath: () => ck3Dir }, path, fs,
      dataDir: path.join(directory, "queue-state"), onCommandWritten: command => evidence.trackDispatch(command.commandId) });
    const queue = new Queue();
    queue.initializeAfterAckReconciliation();
    const first = queue.enqueueCommand({ owner: "action", kind: "action_effect", effectText: "# synthetic first" });
    const second = queue.enqueueCommand({ owner: "letter", kind: "letter_effect", effectText: "# synthetic queued" });
    assert.equal(queue.getPendingCommands()[1].status, "queued");
    await load("votc-load-queue-next");
    assert.equal(evidence.isCurrentCommand(first.commandId), false);
    assert(queue.ackCommand(first.commandId));
    assert.equal(evidence.isCurrentCommand(second.commandId), true, "queue callback records actual write generation after a load change");
    assert.match(source("main/letters/letter-manager.js"), /if \(acknowledged\) bridgeEvidence\?\.observeCommand\("runFileAck", acknowledged\.commandId\)/);
    assert.match(source("renderer/assets/index-Dn3qWlAB.js"), /jsxRuntimeExports\.jsx\(BridgeDiagnosticsView, \{ uiLanguage: isChinese/);
    console.log("V9.6 production Bridge integration: PASS (legacy, feature gates, dispatch generations, no replay, read-only preload)");
  } finally {
    await service.stop();
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

main().catch(error => { console.error(error.stack); process.exitCode = 1; });
