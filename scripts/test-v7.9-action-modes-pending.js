"use strict";

const assert = require("assert");
const path = require("path");

const root = path.resolve(__dirname, "..");
const actionSystem = require(path.join(root, "resources", "app", "out", "main", "action-system"));
globalThis.__V67ActionSystem = actionSystem;

const { getActionEngine } = require("./action-engine-test-helper");
const ActionEngine = getActionEngine();
const allianceDefinition = require(path.join(root, "resources", "app", "default_userdata", "actions", "standard", "z_makeAlliance.js"));
const alliance = { id: "makeAlliance", definition: allianceDefinition, validation: { valid: true }, filePath: "z_makeAlliance.js" };
const truceDefinition = require(path.join(root, "resources", "app", "default_userdata", "actions", "standard", "z_agreedToTruceWith.js"));
const truce = { id: "agreedToTruceWith", definition: truceDefinition, validation: { valid: true }, filePath: "z_agreedToTruceWith.js" };
const friendsDefinition = require(path.join(root, "resources", "app", "default_userdata", "actions", "standard", "z_becomeFriendsWith.js"));
const friends = { id: "becomeFriendsWith", definition: friendsDefinition, validation: { valid: true }, filePath: "z_becomeFriendsWith.js" };
const actions = [alliance, truce, friends];
const player = { id: 1, shortName: "李思昭", fullName: "李思昭", isRuler: true, relationsToCharacters: [] };
const npc = { id: 2, shortName: "李思念", fullName: "李思念", isRuler: true, relationsToCharacters: [] };
const gameData = { playerID: 1, playerName: player.fullName, characters: new Map([[1, player], [2, npc]]) };
const analytics = [];
const effects = [];
let providerCalls = 0;
let mode = "balanced";

globalThis.actionRegistry = {
  getAllActions: () => actions,
  getActionIdsForCategories: (categories) => new Set(categories.includes("relationship") ? actions.map((action) => action.id) : []),
  getById: (id) => actions.find((action) => action.id === id) || null,
  isActionDisabled: () => false,
  registerValidation() {},
  getEffectiveDestructive: () => true,
  getEffectiveRiskLevel: () => "high",
  hasDestructiveOverride: () => false,
  shouldRequireApproval: () => false
};
globalThis.settingsRepository = {
  getLanguage: () => "zh",
  getActionSystemMode: () => mode,
  getActionApprovalSettings: () => ({ approvalMode: "never" }),
  getActionsProviderConfig: () => ({ useMinimizedActionsSchema: true })
};
globalThis.usageAnalytics = { record: (metadata) => analytics.push(metadata) };
globalThis.llmManager = { sendActionsRequest: async () => { providerCalls++; return { content: '{"actions":[]}' }; } };
globalThis.resolveI18nString = (value) => typeof value === "string" ? value : value?.zh || value?.en || "";
globalThis.ActionSandbox = { executeAction: async (filePath, context) => filePath.includes("agreedToTruce") ? truceDefinition.run(context) : filePath.includes("becomeFriends") ? friendsDefinition.run(context) : allianceDefinition.run(context) };
globalThis.ActionEffectWriter = { writeEffect: (_gameData, sourceId, targetId, body) => effects.push({ sourceId, targetId, body }) };

function conversation(id) {
  return {
    id,
    turnEpoch: 1,
    gameData,
    messages: [],
    actionGateProcessedTriggers: new Set(),
    processedActionEventIds: new Set(),
    inactiveParticipantIds: new Set(),
    getActiveConversationCharacters: () => [player, npc]
  };
}

async function evaluatePair(conv, firstContent, secondContent) {
  const proposal = { id: `${conv.id}:proposal`, role: "user", name: player.fullName, content: firstContent };
  conv.messages.push(proposal);
  const first = await ActionEngine.evaluateForCharacter(conv, player, null, proposal);
  conv.turnEpoch++;
  const reply = { id: `${conv.id}:reply`, role: "assistant", name: npc.fullName, content: secondContent };
  conv.messages.push(reply);
  const second = await ActionEngine.evaluateForCharacter(conv, npc, null, reply);
  return { first, second };
}

(async () => {
  const { actionModes, interaction } = actionSystem;
  assert.strictEqual(actionModes.normalizeActionSystemMode("unknown"), "balanced");
  assert.strictEqual(interaction.acceptanceResolver.resolve("不愿").decision, "reject");
  assert.strictEqual(interaction.acceptanceResolver.resolve("好。 ").decision, "accept");
  assert.strictEqual(interaction.acceptanceResolver.resolve("好，不过先等等").decision, "none");

  const ambiguousTarget = interaction.proposalDetector.detect({
    text: "你们愿意与我结盟吗？",
    speaker: player,
    characters: [player, npc, { id: 3, shortName: "李思青", fullName: "李思青" }],
    registry: globalThis.actionRegistry
  });
  assert.strictEqual(ambiguousTarget, null, "multi-party proposal without a named target must fail closed");

  const expiring = new interaction.PendingIntentStore();
  const expiringIntent = expiring.create({ initiatorId: 1, targetId: 2, category: "relationship", candidateActionIds: ["makeAlliance"], createdTurnEpoch: 1, expiresAfterTurns: 2 });
  assert.strictEqual(expiring.awaitingForTarget(2, 3).length, 1);
  assert.strictEqual(expiring.awaitingForTarget(2, 4).length, 0);
  assert.strictEqual(expiring.get(expiringIntent.pendingId).status, "expired");

  mode = "balanced";
  const balanced = conversation("balanced");
  const balancedResult = await evaluatePair(balanced, "李思念，你愿意与我结盟吗？", "好");
  assert.deepStrictEqual(balancedResult.second, { autoApproved: [], needsApproval: [] });
  assert.strictEqual(effects.length, 0, "balanced mode must preserve v7.8.3 proposal behavior");
  assert.strictEqual(providerCalls, 0);

  mode = "performance";
  const performance = conversation("performance");
  const performanceResult = await evaluatePair(performance, "李思念，你愿意与我结盟吗？", "我愿意");
  assert.strictEqual(performanceResult.first.autoApproved.length, 0);
  assert.strictEqual(performanceResult.second.autoApproved.length, 1, "accepted bilateral pending intent must execute once");
  assert.strictEqual(performanceResult.second.autoApproved[0].success, true);
  assert.strictEqual(effects.length, 1);
  assert.deepStrictEqual([effects[0].sourceId, effects[0].targetId], [player.id, npc.id], "proposal-time participant binding must remain frozen");
  assert.strictEqual(providerCalls, 0, "pending acceptance fast path must not call Action Provider");
  assert(analytics.some((entry) => entry.metric === "pendingCreated"));
  assert(analytics.some((entry) => entry.metric === "pendingConfirmed"));

  const truceConversation = conversation("truce");
  const truceResult = await evaluatePair(truceConversation, "李思念，你愿意与我停战吗？", "我答应");
  assert.strictEqual(truceResult.second.autoApproved[0].actionId, "agreedToTruceWith", "truce acceptance must use the truce module");
  const friendshipConversation = conversation("friendship");
  const friendshipResult = await evaluatePair(friendshipConversation, "李思念，你愿意与我成为朋友吗？", "愿意");
  assert.strictEqual(friendshipResult.second.autoApproved[0].actionId, "becomeFriendsWith", "relationship acceptance must use the requested relationship module");
  assert.strictEqual(friendshipResult.second.autoApproved[0].success, true);
  assert.strictEqual(providerCalls, 0);

  const rejected = conversation("rejected");
  const beforeRejectedEffects = effects.length;
  await evaluatePair(rejected, "李思念，你愿意与我结盟吗？", "不愿");
  assert.strictEqual(effects.length, beforeRejectedEffects, "rejection must not execute an effect");
  assert([...rejected.pendingActionIntentStore.items.values()].some((intent) => intent.status === "rejected"));

  const payment = conversation("payment");
  const beforePaymentEffects = effects.length;
  await evaluatePair(payment, "李思念，你愿意给我100金币吗？", "好");
  assert.strictEqual(effects.length, beforePaymentEffects, "accepting a payment request is not evidence that payment completed");
  assert([...payment.pendingActionIntentStore.items.values()].some((intent) => intent.status === "confirmed" && intent.confirmationPolicy === "explicit_execution_required"));

  const multiple = conversation("multiple");
  multiple.pendingActionIntentStore = new interaction.PendingIntentStore();
  multiple.actionSystemModeSnapshot = "performance";
  multiple.pendingActionIntentStore.create({ proposalMessageId: "p1", initiatorId: 1, targetId: 2, category: "relationship", candidateActionIds: ["makeAlliance"], confirmationPolicy: "acceptance_completes", createdTurnEpoch: 1, expiresAfterTurns: 2 });
  multiple.pendingActionIntentStore.create({ proposalMessageId: "p2", initiatorId: 1, targetId: 2, category: "gold", candidateActionIds: ["paysGoldTo"], confirmationPolicy: "explicit_execution_required", createdTurnEpoch: 1, expiresAfterTurns: 2 });
  multiple.messages.push({ id: "p1", content: "结盟吗" }, { id: "p2", content: "给钱吗" });
  const ambiguousReply = { id: "p3", role: "assistant", name: npc.fullName, content: "好" };
  multiple.messages.push(ambiguousReply);
  const beforeAmbiguousEffects = effects.length;
  await ActionEngine.evaluateForCharacter(multiple, npc, null, ambiguousReply);
  assert.strictEqual(effects.length, beforeAmbiguousEffects, "generic acceptance with multiple pending intents must fail closed");
  assert(analytics.some((entry) => entry.metric === "pendingAmbiguous"));

  const modeChange = conversation("mode-change");
  modeChange.actionSystemModeSnapshot = "performance";
  modeChange.pendingActionIntentStore = new interaction.PendingIntentStore();
  const cancelled = modeChange.pendingActionIntentStore.create({ initiatorId: 1, targetId: 2, category: "relationship", candidateActionIds: ["makeAlliance"], createdTurnEpoch: 1, expiresAfterTurns: 2 });
  mode = "precision";
  ActionEngine.getModeState(modeChange);
  assert.strictEqual(modeChange.pendingActionIntentStore.get(cancelled.pendingId).status, "cancelled", "mode switch must clear pending intents on the next message");

  console.log("VOTC v7.9 action modes and pending intents: PASS");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
