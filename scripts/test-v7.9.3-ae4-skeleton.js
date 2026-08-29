"use strict";

const assert = require("assert");
const path = require("path");

const root = path.resolve(__dirname, "..");
const { ActionEngine } = require(path.join(root, "resources/app/out/main/action-system/action-engine"));
const actionMode = require(path.join(root, "resources/app/out/main/action-system/v4/constants/action-mode"));
const engineVersion = require(path.join(root, "resources/app/out/main/action-system/v4/constants/action-engine-version"));
const { actionMetadata } = require(path.join(root, "resources/app/out/main/action-system/v4/catalog/master-action-dictionary"));
const pendingStore = require(path.join(root, "resources/app/out/main/action-system/v4/pending/explicit-pending-store"));

assert.strictEqual(engineVersion.ACTION_ENGINE_VERSION, 4);
assert.strictEqual(engineVersion.normalizeActionEngineVersion(3), 3);
assert.strictEqual(engineVersion.normalizeActionEngineVersion(2), 4);
assert.strictEqual(actionMode.normalizeActionMode("balanced"), "performance");
assert.strictEqual(actionMode.normalizeActionMode(null), "performance");
assert.strictEqual(actionMode.normalizeActionMode("invalid"), "performance");
assert.strictEqual(actionMode.normalizeActionMode("precision"), "precision");
assert.deepStrictEqual(actionMode.ACTION_MODES, ["performance", "precision"]);

const conversation = {};
const state = pendingStore.ensureState(conversation);
state.pending.set("pending:1", { pendingId: "pending:1" });
state.dedupeLedger.add("dedupe:1");
state.executionHistory.push({ actionId: "test" });
state.worldEventEvidence.push({ eventId: "world:1" });
actionMode.syncConversationMode(conversation, "performance");
actionMode.syncConversationMode(conversation, "precision");
assert.strictEqual(state.pending.size, 1, "mode switch must preserve pending");
assert.strictEqual(state.dedupeLedger.size, 1, "mode switch must preserve dedupe ledger");
assert.strictEqual(state.executionHistory.length, 1, "mode switch must preserve execution history");
assert.strictEqual(state.worldEventEvidence.length, 1, "mode switch must preserve world evidence");

assert.deepStrictEqual(actionMetadata({ definition: {} }), {
  executionMode: "immediate",
  idempotent: false,
  dependencies: [],
  pendingTtl: null,
  requiredArguments: [],
  optionalArguments: [],
  riskLevel: "low",
  relationshipTransition: false,
  availabilityRequirements: {},
  dependencyMetadata: {},
  socialCategory: null,
  targetPolicy: "other_only",
  selectorVisible: true
});

ActionEngine.configure({ actionEngineVersion: 3 });
assert.strictEqual(ActionEngine.getActiveEngineVersion(), 3, "explicit engine-level rollback must select frozen AE3");
ActionEngine.configure({ actionEngineVersion: 4 });
assert.strictEqual(ActionEngine.getActiveEngineVersion(), 4, "AE4 must be the default active engine");

console.log("PASS v7.9.3 AE4 Phase 1 skeleton");
