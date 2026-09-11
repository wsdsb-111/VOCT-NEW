"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { createActionEngine } = require("../resources/app/out/main/actions/action-engine");
const { ACTION_LIFECYCLE_STATUSES, createActionDiagnostic, createActionLifecycle } = require("../resources/app/out/main/actions/types");

const root = path.resolve(__dirname, "..");
const engineSource = fs.readFileSync(path.join(root, "resources", "app", "out", "main", "actions", "action-engine.js"), "utf8");
const conversationSource = fs.readFileSync(path.join(root, "resources", "app", "out", "main", "conversation", "conversation.js"), "utf8");
const promptBuilderSource = fs.readFileSync(path.join(root, "resources", "app", "out", "main", "actions", "action-prompt-builder.js"), "utf8");
const rendererSource = fs.readFileSync(path.join(root, "resources", "app", "out", "renderer", "assets", "index-Dn3qWlAB.js"), "utf8");

const player = { id: 101, shortName: "Player", gold: 1000 };
const npc = { id: 202, shortName: "NPC", gold: 200 };
const target = { id: 303, shortName: "Target", gold: 50 };
const loadedActions = new Map(["dispatch", "noEffect", "failure", "preview"].map((id) => [id, { filePath: `${id}.js`, validation: { valid: true } }]));
const settingsRepository = { getLanguage: () => "zh-CN" };
const conversation = {
  gameData: { revision: 17, characters: new Map([[player.id, player], [npc.id, npc], [target.id, target]]) }
};

function makeEngine(writeEffect) {
  return createActionEngine({
    actionRegistry: { getById: (actionId) => loadedActions.get(actionId) },
    settingsRepository,
    ActionSandbox: {
      executeAction: async (filePath, context) => {
        const actionId = path.basename(filePath, ".js");
        if (actionId === "dispatch" || actionId === "failure") context.runGameEffect("test_effect = yes");
        if (actionId === "failure") return { message: "not reached" };
        return actionId === "dispatch" ? { message: actionId, sentiment: "neutral", expectedStateChange: { type: "GOLD_TRANSFER", sourceRuntimeId: npc.id, targetRuntimeId: target.id, amount: 50 } } : { message: actionId, sentiment: "neutral" };
      }
    },
    ActionEffectWriter: { writeEffect },
    resolveI18nString: (value) => value
  });
}

(async () => {
  assert.strictEqual(ACTION_LIFECYCLE_STATUSES.DISPATCHED, "DISPATCHED");
  assert.deepStrictEqual(createActionLifecycle({ selected: true, validated: true, dispatched: true, confirmed: false, status: "DISPATCHED" }), {
    selected: true,
    validated: true,
    dispatched: true,
    confirmed: false,
    status: "DISPATCHED"
  });
  const diagnostic = createActionDiagnostic({ actionId: "dispatch", sourceRuntimeId: npc.id, targetRuntimeId: target.id, args: { amount: 50 }, revisionBefore: 17, confirmationStatus: "PENDING_CONFIRMATION" });
  assert.strictEqual(diagnostic.sourceRuntimeId, npc.id);
  assert.strictEqual(diagnostic.targetRuntimeId, target.id);
  assert.deepStrictEqual(diagnostic.selectedArgs, { amount: 50 });
  assert.strictEqual(diagnostic.confirmationStatus, "PENDING_CONFIRMATION");

  const writes = [];
  const engine = makeEngine((gameData, sourceId, targetId, effectBody) => { writes.push({ sourceId, targetId, effectBody }); return { commandId: "rc6-test", status: "awaiting_ack" }; });
  const dispatched = await engine.runInvocation(conversation, npc, { actionId: "dispatch", targetCharacterId: target.id, args: { amount: 50 }, requestedArgs: { amount: 50 } });
  assert.strictEqual(dispatched.success, false);
  assert.strictEqual(dispatched.lifecycle.status, ACTION_LIFECYCLE_STATUSES.DISPATCHED);
  assert.deepStrictEqual(dispatched.lifecycle, { selected: true, validated: true, dispatched: true, confirmed: false, status: "DISPATCHED" });
  assert.strictEqual(dispatched.diagnostic.dispatchStatus, "awaiting_ack");
  assert.strictEqual(dispatched.diagnostic.confirmationStatus, "PENDING_CONFIRMATION");
  assert.strictEqual(dispatched.diagnostic.revisionBefore, 17);
  assert.strictEqual(writes.length, 1);

  const preview = await engine.runInvocation(conversation, npc, { actionId: "preview", targetCharacterId: target.id, args: {} }, { dryRun: true });
  assert.strictEqual(preview.lifecycle.status, ACTION_LIFECYCLE_STATUSES.VALIDATED);
  assert.strictEqual(preview.lifecycle.dispatched, false);
  assert.strictEqual(preview.diagnostic.dispatchStatus, "NOT_DISPATCHED");
  assert.strictEqual(preview.diagnostic.confirmationStatus, "PREVIEW_ONLY");
  assert.strictEqual(writes.length, 1, "dry-run must not write a game effect");

  const noEffect = await engine.runInvocation(conversation, npc, { actionId: "noEffect", args: {} });
  assert.strictEqual(noEffect.lifecycle.status, ACTION_LIFECYCLE_STATUSES.NO_EFFECT);
  assert.strictEqual(noEffect.diagnostic.dispatchStatus, "NOT_REQUIRED");

  const failingEngine = makeEngine(() => { throw new Error("writer unavailable"); });
  const failed = await failingEngine.runInvocation(conversation, npc, { actionId: "failure", targetCharacterId: target.id, args: { amount: 50 } });
  assert.strictEqual(failed.success, false);
  assert.strictEqual(failed.lifecycle.status, ACTION_LIFECYCLE_STATUSES.DISPATCH_FAILED);
  assert.strictEqual(failed.diagnostic.dispatchStatus, "FAILED");
  assert.strictEqual(failed.diagnostic.confirmationStatus, "NOT_CONFIRMED");

  assert(engineSource.includes("PENDING_APPROVAL"), "approval selections must carry a lifecycle state");
  assert(engineSource.includes("PENDING_CONFIRMATION"), "executed actions must remain unconfirmed until Terra confirmation");
  assert(conversationSource.includes("lifecycle: r.lifecycle || null"), "conversation feedback must persist lifecycle state");
  assert(promptBuilderSource.includes("lifecycleStatus === \"CONFIRMED\""), "action prompt history must not mark unconfirmed actions as completed");
  assert(rendererSource.includes("feedback.lifecycle?.status"), "Renderer must consume lifecycle status");
  console.log("VOTC v8.8.3 Luna Action lifecycle fixtures: PASS");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
