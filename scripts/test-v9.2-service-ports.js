"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { EventEmitter } = require("events");
const { APPLICATION_SERVICE_METHODS, createApplicationServices } = require("../resources/app/out/main/application/service-ports");
const { createConversationManager } = require("../resources/app/out/main/conversation/conversation-manager");
const { FinalizationCoordinator } = require("../resources/app/out/main/memory-system/finalization-coordinator");

function createFixtureOwner(methodNames) {
  const owner = {};
  for (const methodName of methodNames) {
    owner[methodName] = function (...args) {
      return { owner: this, methodName, args };
    };
  }
  return owner;
}

function createFixtureOwners() {
  return Object.fromEntries(Object.entries(APPLICATION_SERVICE_METHODS)
    .map(([serviceName, methodNames]) => [serviceName, createFixtureOwner(methodNames)]));
}

function testPortsBindAndPreserveCalls() {
  const owners = createFixtureOwners();
  const services = createApplicationServices(owners);
  assert.deepStrictEqual(Object.keys(services), Object.keys(APPLICATION_SERVICE_METHODS));
  for (const [serviceName, methodNames] of Object.entries(APPLICATION_SERVICE_METHODS)) {
    assert.deepStrictEqual(Object.keys(services[serviceName]), methodNames);
    const methodName = methodNames[0];
    const args = [{ fixture: serviceName }];
    const result = services[serviceName][methodName](...args);
    assert.strictEqual(result.owner, owners[serviceName]);
    assert.strictEqual(result.methodName, methodName);
    assert.deepStrictEqual(result.args, args);
  }

  assert.equal(Object.hasOwn(services, "persistence"), false, "retired Memory4 persistence is not an application service port");
  assert.throws(() => createApplicationServices({ ...owners, letter: undefined }),
    error => error instanceof TypeError && error.message === "application_service_owner_required:letter");
  const incompleteWorldline = { ...owners.worldline };
  delete incompleteWorldline.getCheckpointStatus;
  assert.throws(() => createApplicationServices({ ...owners, worldline: incompleteWorldline }),
    error => error instanceof TypeError && error.message === "application_service_method_required:worldline.getCheckpointStatus");

  const expectedError = new Error("fixture owner failure");
  owners.letter.processLatestLetter = function () { throw expectedError; };
  const errorServices = createApplicationServices(owners);
  assert.throws(() => errorServices.letter.processLatestLetter(), error => error === expectedError);
}

function testRealConversationManagerAndPresenceOwner() {
  class FixtureConversation {
    constructor({ conversationEpoch }) {
      this.conversationEpoch = conversationEpoch;
      this.isPaused = false;
      this.npcQueue = [];
      this.messages = [];
      this.presenceState = { conversationEpoch, presentCharacterIds: [11], waitingCharacterIds: [12] };
    }
    onConversationUpdate() {}
    getPresenceState() { return this.presenceState; }
  }

  const ConversationManager = createConversationManager({
    events: { EventEmitter },
    memorySystem: { FinalizationCoordinator },
    Conversation: FixtureConversation,
    PromptBuilder: class {},
    createActionFeedback() {},
    logVerboseLLM() {}
  });
  const manager = new ConversationManager();
  const owners = createFixtureOwners();
  const services = createApplicationServices({ ...owners, conversation: manager, presence: manager });
  const conversation = services.conversation.createConversation();

  assert(conversation instanceof FixtureConversation);
  assert.strictEqual(services.conversation.getCurrentConversation(), conversation);
  assert.deepStrictEqual(services.presence.getConversationState(), {
    isPaused: false,
    queueLength: 0,
    presence: conversation.presenceState
  });
  assert.strictEqual(manager.conversationEpoch, 1);
}

function testRetiredMemory4PortHasNoProductionIpc() {
  const ipcSource = fs.readFileSync(path.join(__dirname, "../resources/app/out/main/ipc/register-ipc.js"), "utf8");
  assert.doesNotMatch(ipcSource, /memory4:(?:getCoverage|getEntry|getSources|getOwnerData|mutate|audit|forget)/i,
    "the production IPC source no longer registers Memory4-specific persistence routes");
}

async function testIpcUsesInjectedPorts() {
  const { registerIpcHandlers } = require("../resources/app/out/main/ipc/register-ipc");
  const handlers = new Map();
  const owners = createFixtureOwners();
  const applicationServices = createApplicationServices(owners);
  const raw = new Proxy({}, { get: (_target, key) => key === "onConversationUpdate" ? () => {} : () => { throw new Error("unmigrated_owner_called"); } });
  const worldlineService = new Proxy({ setStateListener() {} }, { get: (target, key) => target[key] || (() => ({ owner: owners.worldline, methodName: key, args: [] })) });
  const summariesManager = {
    regenerateSummary(...args) { return { methodName: "regenerateSummary", args }; },
    updateSummary(...args) { return { methodName: "updateSummary", args }; },
    deleteSummary(...args) { return { methodName: "deleteSummary", args }; }
  };
  const inert = new Proxy({}, { get: () => () => ({}) });
  registerIpcHandlers({
    electron: { ipcMain: { handle: (channel, handler) => handlers.set(channel, handler), on() {} }, app: { getVersion: () => "fixture" } },
    applicationServices, conversationManager: raw, letterManager: raw, ActionEngine: raw,
    worldlineService, SummariesManager: summariesManager,
    settingsRepository: inert, promptConfigManager: inert, uuid: { v4: () => "fixture" },
    VOTC_PROMPTS_DIR: "", TemplateEngine: class {}, exportPromptsZip: inert,
    runFileManager: inert, llmManager: inert, providerRegistry: inert, usageAnalytics: inert,
    providerDiagnostics: inert, actionRegistry: inert, VOTC_ACTIONS_DIR: "", resolveI18nString: value => value,
    VOTC_SUMMARIES_DIR: "", memoryEngine: inert
  });
  const state = await handlers.get("conversation:getState")();
  assert.strictEqual(state.owner, owners.presence);
  assert.deepStrictEqual((await handlers.get("conversation:joinWaitingCharacter")(null, { characterId: 11 })).args, [11]);
  assert.strictEqual((await handlers.get("worldline:getCheckpointStatus")()).owner, owners.worldline);
  assert.strictEqual((await handlers.get("letters:getStatuses")()).owner, owners.letter);
  assert.equal([...handlers.keys()].some(channel => channel.startsWith("memory4:")), false,
    "registered IPC handlers expose no Memory4 namespace");
  assert(handlers.has("conversation:regenerateSummary"), "the established Legacy summary rewrite IPC remains registered");
  const regenerated = await handlers.get("conversation:regenerateSummary")(null, {
    playerId: 2, characterId: 1, summaryIndex: 0, expectedContent: "Legacy source"
  });
  assert.deepStrictEqual(regenerated, { methodName: "regenerateSummary", args: [2, 1, 0, "Legacy source"] });
  const updated = await handlers.get("conversation:updateSummary")(null, {
    playerId: 2, characterId: 1, summaryIndex: 0, newContent: "Edited Legacy summary"
  });
  assert.deepStrictEqual(updated, { methodName: "updateSummary", args: [2, 1, 0, "Edited Legacy summary"] });
  const deleted = await handlers.get("conversation:deleteSummary")(null, { playerId: 2, characterId: 1, summaryIndex: 0 });
  assert.deepStrictEqual(deleted, { methodName: "deleteSummary", args: [2, 1, 0] });
}

async function run() {
  testPortsBindAndPreserveCalls();
  testRealConversationManagerAndPresenceOwner();
  testRetiredMemory4PortHasNoProductionIpc();
  await testIpcUsesInjectedPorts();
  console.log("V9.2 service ports passed");
}
run().catch(error => { console.error(error); process.exitCode = 1; });
