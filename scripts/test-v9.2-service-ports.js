"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { EventEmitter } = require("events");
const { APPLICATION_SERVICE_METHODS, createApplicationServices } = require("../src/app/main/application/service-ports");
const { createConversationManager } = require("../src/app/main/conversation/conversation-manager");
const { FinalizationCoordinator } = require("../src/app/main/memory-system/finalization-coordinator");
const { Memory4Store } = require("../src/app/main/memory-system/memory4-store");

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

  assert.throws(() => createApplicationServices({ ...owners, persistence: undefined }),
    error => error instanceof TypeError && error.message === "application_service_owner_required:persistence");
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

function testRealMemory4StoreScopeAndQuerySemantics() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v92-service-ports-"));
  try {
    const summaryFoldersDir = path.join(tempRoot, "summaries");
    fs.mkdirSync(path.join(summaryFoldersDir, "42_fixture"), { recursive: true });
    const memory4Store = new Memory4Store({ summaryFoldersDir });
    const scope = { campaignToken: "service-port-fixture-campaign", ownerId: 42 };

    assert.deepStrictEqual(memory4Store.query(scope, {}), []);
    assert.throws(() => memory4Store.query({ campaignToken: "", ownerId: 42 }, {}),
      error => error.message === "memory4_scope_required");
    assert.throws(() => memory4Store.query(scope, { byUnknown: "value" }),
      error => error.message === "memory4_invalid_index_axis");
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

async function testIpcUsesInjectedPorts() {
  const { registerIpcHandlers } = require("../resources/app/out/main/ipc/register-ipc");
  const handlers = new Map();
  const owners = createFixtureOwners();
  const applicationServices = createApplicationServices(owners);
  const raw = new Proxy({}, { get: (_target, key) => key === "onConversationUpdate" ? () => {} : () => { throw new Error("unmigrated_owner_called"); } });
  registerIpcHandlers({
    electron: { ipcMain: { handle: (channel, handler) => handlers.set(channel, handler), on: () => {} } },
    applicationServices, conversationManager: raw, letterManager: raw, ActionEngine: raw,
    worldlineService: {}, SummariesManager: {
      auditMemory4Integrity: (request, persistence) => persistence.audit({ campaignToken: "fixture", ownerId: request.ownerId })
    }
  });
  const state = await handlers.get("conversation:getState")();
  assert.strictEqual(state.owner, owners.presence);
  assert.deepStrictEqual((await handlers.get("conversation:joinWaitingCharacter")(null, { characterId: 11 })).args, [11]);
  assert.strictEqual((await handlers.get("worldline:getCheckpointStatus")()).owner, owners.worldline);
  assert.strictEqual((await handlers.get("letters:getStatuses")()).owner, owners.letter);
  assert.strictEqual((await handlers.get("memory4:integrityAudit")(null, { ownerId: 1 })).owner, owners.persistence);
  assert.equal((await handlers.get("memory4:integrityAudit")(null, { ownerId: -1 })).success, false);
}

async function run() {
  testPortsBindAndPreserveCalls();
  testRealConversationManagerAndPresenceOwner();
  testRealMemory4StoreScopeAndQuerySemantics();
  await testIpcUsesInjectedPorts();
  console.log("V9.2 service ports passed");
}
run().catch(error => { console.error(error); process.exitCode = 1; });
