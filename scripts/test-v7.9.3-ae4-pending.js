"use strict";

const assert = require("assert");
const path = require("path");

const root = path.resolve(__dirname, "..");
const { ActionEngineV4 } = require(path.join(root, "resources/app/out/main/action-system/action-engine"));
const pendingStore = require(path.join(root, "resources/app/out/main/action-system/v4/pending/explicit-pending-store"));
const actionMode = require(path.join(root, "resources/app/out/main/action-system/v4/constants/action-mode"));

const player = { id: 1, shortName: "Player", fullName: "Player", relationsToCharacters: [] };
const npc = { id: 2, shortName: "NPC", fullName: "NPC", relationsToCharacters: [] };
const third = { id: 3, shortName: "Third", fullName: "Third", relationsToCharacters: [] };
const gameData = { playerID: 1, playerName: "Player", characters: new Map([[1, player], [2, npc], [3, third]]) };
const effects = [];

function consentAction(actionId) {
  return {
    id: actionId,
    filePath: actionId,
    validation: { valid: true },
    definition: {
      signature: actionId,
      title: actionId,
      args: [],
      description: actionId,
      actionMetadata: { executionMode: "consent_required", relationshipTransition: true, pendingTtl: 10 },
      semantic: { bilateralPersistentEffect: true },
      check: () => ({ canExecute: true, validTargetCharacterIds: [2, 3] }),
      run: ({ runGameEffect }) => { runGameEffect(actionId); return actionId; }
    }
  };
}

const loaded = new Map(["becomeLoversWith", "becomeSoulmatesWith", "becomeBloodBrothersWith", "agreedToTruceWith"].map((id) => [id, consentAction(id)]));
const registry = {
  getAllActions: () => [...loaded.values()],
  getById: (id) => loaded.get(id),
  isActionDisabled: () => false,
  registerValidation: () => {},
  shouldRequireApproval: () => false,
  getEffectiveDestructive: () => false,
  getEffectiveRiskLevel: () => "medium"
};
const settingsRepository = {
  getActionSystemMode: () => "precision",
  getLanguage: () => "en",
  getActionApprovalSettings: () => ({ approvalMode: "none", pauseOnApproval: false })
};
ActionEngineV4.configure({
  actionRegistry: registry,
  settingsRepository,
  usageAnalytics: { record: () => {} },
  ActionSandbox: { executeAction: (filePath, context) => loaded.get(filePath).definition.run(context) },
  ActionEffectWriter: { writeEffect: (_gameData, sourceId, targetId, body) => effects.push({ sourceId, targetId, body }) },
  resolveI18nString: (value) => typeof value === "string" ? value : value.en
});

function conversation() {
  return { gameData, messages: [], inactiveParticipantIds: new Map(), getActiveConversationCharacters: () => [player, npc, third] };
}

function actionDecision(actionId, messageId) {
  return { type: "action_call", actionId, sourceCharacterId: 1, targetCharacterId: 2, arguments: {}, evidenceMessageIds: [messageId], confidence: 0.99 };
}

async function propose(conv, actionId, messageId) {
  const message = { id: messageId, role: "user", name: "Player", content: `proposal:${actionId}` };
  conv.messages.push(message);
  return ActionEngineV4.evaluateProposals(conv, player, message, [actionDecision(actionId, messageId)], { mode: "precision", origin: "precision_selector" });
}

(async () => {
  for (const [index, actionId] of [...loaded.keys()].entries()) {
    const conv = conversation();
    const result = await propose(conv, actionId, 100 + index);
    assert.strictEqual(result.autoApproved.length, 0, `${actionId} must never execute without consent`);
    assert.strictEqual(result.pendingConsent.length, 1, `${actionId} must create pending`);
  }

  const conv = conversation();
  const proposal = await propose(conv, "becomeLoversWith", 200);
  const pending = proposal.pendingConsent[0];
  assert.strictEqual(pending.expiresTurn - pending.createdTurn, 10);
  actionMode.syncConversationMode(conv, "performance");
  actionMode.syncConversationMode(conv, "precision");
  assert.strictEqual(pendingStore.listActive(conv).length, 1, "mode switch must preserve explicit pending");

  const wrongMessage = { id: 201, role: "user", name: "Player", content: "I accept" };
  conv.messages.push(wrongMessage);
  let result = await ActionEngineV4.evaluateProposals(conv, player, wrongMessage, [{ type: "pending_response", pendingId: pending.pendingId, response: "accept", evidenceMessageIds: [201], confidence: 1 }], { mode: "performance", origin: "performance_compact" });
  assert(result.rejected.some((item) => item.reason === "rejected_pending_actor_mismatch"));
  assert.strictEqual(effects.length, 0);

  const thirdMessage = { id: 202, role: "assistant", name: "Third", content: "I accept for them" };
  conv.messages.push(thirdMessage);
  result = await ActionEngineV4.evaluateProposals(conv, third, thirdMessage, [{ type: "pending_response", pendingId: pending.pendingId, response: "accept", evidenceMessageIds: [202], confidence: 1 }], { mode: "precision", origin: "precision_selector" });
  assert(result.rejected.some((item) => item.reason === "rejected_pending_actor_mismatch"));

  const deferMessage = { id: 203, role: "assistant", name: "NPC", content: "Let me think" };
  conv.messages.push(deferMessage);
  result = await ActionEngineV4.evaluateProposals(conv, npc, deferMessage, [{ type: "pending_response", pendingId: pending.pendingId, response: "defer", evidenceMessageIds: [203], confidence: 1 }], { mode: "precision", origin: "precision_selector" });
  assert.strictEqual(result.autoApproved.length, 0);
  assert.strictEqual(pendingStore.get(conv, pending.pendingId).status, "pending");

  const acceptMessage = { id: 204, role: "assistant", name: "NPC", content: "I accept" };
  conv.messages.push(acceptMessage);
  result = await ActionEngineV4.evaluateProposals(conv, npc, acceptMessage, [{ type: "pending_response", pendingId: pending.pendingId, response: "accept", evidenceMessageIds: [204], confidence: 1 }], { mode: "precision", origin: "precision_selector" });
  assert.strictEqual(result.autoApproved.length, 1, "target acceptance must execute once");
  assert.strictEqual(pendingStore.get(conv, pending.pendingId).status, "accepted");
  assert.strictEqual(effects.length, 1);

  const rejectConv = conversation();
  const rejectedProposal = await propose(rejectConv, "becomeBloodBrothersWith", 300);
  const rejectMessage = { id: 301, role: "assistant", name: "NPC", content: "No" };
  rejectConv.messages.push(rejectMessage);
  result = await ActionEngineV4.evaluateProposals(rejectConv, npc, rejectMessage, [{ type: "pending_response", pendingId: rejectedProposal.pendingConsent[0].pendingId, response: "reject", evidenceMessageIds: [301], confidence: 1 }], { mode: "precision", origin: "precision_selector" });
  assert.strictEqual(result.autoApproved.length, 0);
  assert.strictEqual(pendingStore.get(rejectConv, rejectedProposal.pendingConsent[0].pendingId).status, "rejected");

  const expiredConv = conversation();
  const expiredProposal = await propose(expiredConv, "agreedToTruceWith", 400);
  const expired = expiredProposal.pendingConsent[0];
  pendingStore.ensureState(expiredConv).dialogueTurn = expired.expiresTurn + 1;
  const expiredMessage = { id: 401, role: "assistant", name: "NPC", content: "I accept" };
  expiredConv.messages.push(expiredMessage);
  result = await ActionEngineV4.evaluateProposals(expiredConv, npc, expiredMessage, [{ type: "pending_response", pendingId: expired.pendingId, response: "accept", evidenceMessageIds: [401], confidence: 1 }], { mode: "precision", origin: "precision_selector" });
  assert(result.rejected.some((item) => item.reason === "rejected_pending_expired"));
  assert.strictEqual(pendingStore.get(expiredConv, expired.pendingId).status, "expired");

  console.log("PASS v7.9.3 AE4 Phase 4 consent pending");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
