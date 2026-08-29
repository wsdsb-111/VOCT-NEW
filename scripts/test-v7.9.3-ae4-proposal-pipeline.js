"use strict";

const assert = require("assert");
const path = require("path");

const root = path.resolve(__dirname, "..");
const { ActionEngineV4 } = require(path.join(root, "resources/app/out/main/action-system/action-engine"));

function character(id, name) {
  return { id, shortName: name, fullName: name, gold: 500, relationsToCharacters: [] };
}

const player = character(1, "Player");
const target = character(2, "Target");
const gameData = { playerID: 1, playerName: "Player", characters: new Map([[1, player], [2, target]]) };
const effects = [];

function definition(actionId, options = {}) {
  return {
    signature: actionId,
    title: actionId,
    args: options.args || [],
    description: actionId,
    semantic: options.relationship ? { bilateralPersistentEffect: true } : {},
    actionMetadata: options.metadata || {},
    check: () => ({ canExecute: true, validTargetCharacterIds: options.targets || (options.target === false ? [] : [2]) }),
    run: ({ runGameEffect, args }) => {
      if (options.throwBeforeEffect) throw new Error("pre-send failure");
      if (options.writeEffect !== false) runGameEffect(`${actionId}:${JSON.stringify(args)}`);
      return { message: actionId, sentiment: "neutral" };
    }
  };
}

const amountArg = [{ name: "amount", type: "number", description: "amount", required: true, min: 1, max: 500, step: 1 }];
const actions = [
  definition("playerPaysGoldTo", { args: amountArg, metadata: { availabilityRequirements: { source: "player" } } }),
  definition("isImprisonedBy"),
  definition("isInjured", { args: [{ name: "injuryType", type: "enum", description: "injury", required: true, options: ["wounded_1"] }] }),
  definition("characterIsKilled"),
  definition("isAssignedToCourtPositionBy"),
  definition("isAssignedToCouncilBy"),
  definition("isFiredFromCouncilOf"),
  definition("becomeFriendsWith", { relationship: true, metadata: { relationshipTransition: true } }),
  definition("setEmotion", { targets: [1, 2], metadata: { targetPolicy: "self_or_other" }, args: [{ name: "emotion", type: "enum", description: "emotion", required: true, options: ["happy"] }] }),
  definition("changeLocation", { target: false, metadata: { targetPolicy: "none" }, args: [{ name: "location", type: "string", description: "location", required: true }] }),
  definition("confirmedFailure", { target: false, metadata: { targetPolicy: "none" }, writeEffect: false }),
  definition("preSendFailure", { target: false, metadata: { targetPolicy: "none" }, throwBeforeEffect: true }),
  definition("postSendUnknown", { target: false, metadata: { targetPolicy: "none" } })
];

const loaded = new Map(actions.map((item) => [item.signature, { id: item.signature, definition: item, filePath: item.signature, validation: { valid: true } }]));
const registry = {
  getAllActions: () => [...loaded.values()],
  getById: (id) => loaded.get(id),
  isActionDisabled: () => false,
  registerValidation: () => {},
  shouldRequireApproval: () => false,
  getEffectiveDestructive: () => false,
  getEffectiveRiskLevel: () => "low"
};
const settingsRepository = {
  getActionSystemMode: () => "performance",
  getLanguage: () => "en",
  getActionApprovalSettings: () => ({ approvalMode: "none", pauseOnApproval: false })
};
const ActionSandbox = {
  executeAction: (filePath, context) => loaded.get(filePath).definition.run(context)
};
const ActionEffectWriter = { writeEffect: (_gameData, sourceId, targetId, body) => {
  if (body.startsWith("postSendUnknown:")) throw new Error("write result unknown");
  effects.push({ sourceId, targetId, body });
} };
const analytics = [];

ActionEngineV4.configure({
  actionRegistry: registry,
  settingsRepository,
  usageAnalytics: { record: (entry) => analytics.push(entry) },
  ActionSandbox,
  ActionEffectWriter,
  resolveI18nString: (value) => typeof value === "string" ? value : value.en
});

let messageId = 100;
async function execute(actionId, args = {}, targetCharacterId = 2, expectedStatus = "confirmed_success") {
  const message = { id: messageId++, role: "user", name: "Player", content: actionId };
  const conversation = {
    gameData,
    messages: [message],
    inactiveParticipantIds: new Map(),
    getActiveConversationCharacters: () => [player, target]
  };
  const result = await ActionEngineV4.evaluateProposals(conversation, player, message, [{
    type: "action_call",
    actionId,
    sourceCharacterId: 1,
    targetCharacterId,
    arguments: args,
    evidenceMessageIds: [message.id],
    confidence: 0.5
  }], { mode: "performance", origin: "performance_local" });
  assert.strictEqual(result.rejected.length, 0, `${actionId} should validate`);
  assert.strictEqual(result.autoApproved.length, 1, `${actionId} should execute`);
  assert.strictEqual(result.autoApproved[0].executionStatus, expectedStatus);
  return result.autoApproved[0];
}

(async () => {
  await execute("playerPaysGoldTo", { amount: 50 });
  await execute("isImprisonedBy");
  await execute("isInjured", { injuryType: "wounded_1" });
  await execute("characterIsKilled");
  await execute("isAssignedToCourtPositionBy");
  await execute("isAssignedToCouncilBy");
  await execute("isFiredFromCouncilOf");
  await execute("becomeFriendsWith");
  await execute("setEmotion", { emotion: "happy" }, 1);
  await execute("changeLocation", { location: "court" }, null);
  assert.strictEqual((await execute("confirmedFailure", {}, null, "confirmed_failure")).success, false);
  assert.strictEqual((await execute("preSendFailure", {}, null, "pre_send_failure")).success, false);
  assert.strictEqual((await execute("postSendUnknown", {}, null, "post_send_unknown")).success, false);
  assert.strictEqual(effects.length, 10, "all independent legal proposals must execute");
  assert(analytics.some((entry) => entry.requestType === "action_v4_funnel" && entry.stage === "Executed"), "funnel must reach Executed");
  console.log("PASS v7.9.3 AE4 Phase 2 proposal pipeline");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
