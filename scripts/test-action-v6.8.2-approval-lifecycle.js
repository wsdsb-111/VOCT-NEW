"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
globalThis.__V67ActionSystem = require(path.join(root, "resources", "app", "out", "main", "action-system"));
const source = fs.readFileSync(path.join(root, "resources", "app", "out", "main", "main.js"), "utf8");
const { getConversationClass } = require("./conversation-test-helper");

const player = { id: 1, fullName: "玩家", shortName: "玩家" };
const zhangSan = { id: 2, fullName: "张三", shortName: "张三" };
const analytics = [];
const executions = [];
globalThis.settingsRepository = {
  getLanguage: () => "zh",
  getActionApprovalSettings: () => ({ pauseOnApproval: false })
};
globalThis.resolveI18nString = (value) => typeof value === "object" ? value.zh || value.en : value;
globalThis.usageAnalytics = { record: (entry) => analytics.push(entry) };
globalThis.actionRegistry = {
  getById: (id) => id === "characterIsKilled" ? { validation: { valid: true } } : null
};
globalThis.ActionEngine = {
  runInvocation: async (_conversation, caller, invocation, options) => {
    executions.push({ callerId: caller?.id, invocation, dryRun: options?.dryRun === true });
    return { actionId: invocation.actionId, success: true, feedback: { message: "preview", sentiment: "neutral" } };
  }
};
globalThis.createActionApproval = (params) => ({ ...params, type: "action-approval", status: "pending" });

const Conversation = getConversationClass();
const social = globalThis.__V67ActionSystem.social;

function createConversation() {
  const conversation = {
    gameData: { characters: new Map([[player.id, player], [zhangSan.id, zhangSan]]) },
    inactiveParticipantIds: new Map(),
    pendingActionApprovals: new Map(),
    messages: [],
    npcQueue: [zhangSan],
    customQueue: null,
    nextId: 10,
    isPaused: false,
    emitUpdate: () => {},
    resumeConversation: () => {},
    pauseConversation: () => {}
  };
  for (const method of ["getActionSystem", "createApprovalManager", "getApprovalManager", "isCharacterAvailableForConversation", "invalidatePendingActionApproval", "invalidateApprovalsForCharacter", "markParticipantInactive", "handleActionResults", "approveActions", "removeCharacterFromConversation", "getConfirmedExecutionResults", "hasPendingApprovalForMessage", "releaseSocialEvidenceIfSettled", "processSocialConsequences", "onActionExecutionSettled"]) {
    conversation[method] = Conversation.prototype[method];
  }
  const approvalManager = conversation.createApprovalManager();
  conversation.runtime = { approvalManager };
  conversation.approvalManager = approvalManager;
  return conversation;
}

function pendingAction() {
  const invocation = Object.freeze({
    actionId: "characterIsKilled",
    args: {},
    sourceCharacterId: zhangSan.id,
    targetCharacterId: player.id,
    bindingId: "bind_pending_1"
  });
  return {
    actionId: invocation.actionId,
    actionTitle: "被目标杀死",
    sourceCharacterId: zhangSan.id,
    targetCharacterId: player.id,
    args: {},
    isDestructive: true,
    riskLevel: "high",
    invocation
  };
}

(async () => {
  const parityConversation = createConversation();
  await parityConversation.handleActionResults(5, player, { autoApproved: [], needsApproval: [pendingAction()] });
  assert.strictEqual(executions[0].dryRun, true, "pending action must preview the validated invocation");
  const [approvalId, pending] = Array.from(parityConversation.pendingActionApprovals.entries())[0];
  assert.strictEqual(pending.bindingId, "bind_pending_1", "pending approval must snapshot binding identity");
  assert.strictEqual(pending.sourceCharacterId, zhangSan.id, "pending approval must snapshot resolved source");
  assert.strictEqual(pending.targetCharacterId, player.id, "pending approval must snapshot resolved target");
  await parityConversation.approveActions(approvalId);
  assert.strictEqual(executions[1].dryRun, false, "approved action must execute after preview");
  assert.strictEqual(executions[0].invocation, executions[1].invocation, "preview and final execution must reuse the same invocation object");

  const sourceInactive = createConversation();
  await sourceInactive.handleActionResults(6, player, { autoApproved: [], needsApproval: [pendingAction()] });
  const sourceApprovalId = Array.from(sourceInactive.pendingActionApprovals.keys())[0];
  sourceInactive.markParticipantInactive(zhangSan.id, "dead");
  assert(!sourceInactive.pendingActionApprovals.has(sourceApprovalId), "source inactivity must invalidate pending approval immediately");
  assert.strictEqual(sourceInactive.messages.find((entry) => entry.id === sourceApprovalId).status, "declined", "invalidated approval must leave a non-pending UI entry");
  assert(analytics.some((entry) => entry.reason === "approval.stale_approval_source_unavailable"), "source invalidation must be observable");

  const targetRemoved = createConversation();
  const targetAction = pendingAction();
  targetAction.invocation = Object.freeze({ ...targetAction.invocation, sourceCharacterId: player.id, targetCharacterId: zhangSan.id, bindingId: "bind_target_1" });
  targetAction.sourceCharacterId = player.id;
  targetAction.targetCharacterId = zhangSan.id;
  await targetRemoved.handleActionResults(7, player, { autoApproved: [], needsApproval: [targetAction] });
  const targetApprovalId = Array.from(targetRemoved.pendingActionApprovals.keys())[0];
  targetRemoved.removeCharacterFromConversation(zhangSan.id);
  assert(!targetRemoved.pendingActionApprovals.has(targetApprovalId), "target removal must invalidate pending approval");
  assert(analytics.some((entry) => entry.reason === "approval.stale_approval_target_unavailable"), "target invalidation must be observable");

  const staleAtClick = createConversation();
  await staleAtClick.handleActionResults(8, player, { autoApproved: [], needsApproval: [pendingAction()] });
  const staleApprovalId = Array.from(staleAtClick.pendingActionApprovals.keys())[0];
  staleAtClick.inactiveParticipantIds.set(zhangSan.id, "dead");
  const executionsBeforeApproval = executions.length;
  await staleAtClick.approveActions(staleApprovalId);
  assert.strictEqual(executions.length, executionsBeforeApproval, "stale source must be rejected before final execution");
  assert(analytics.some((entry) => entry.reason === "approval.stale_approval_source_unavailable"), "approval-time stale validation must record its reason");

  const previewWithoutFeedback = createConversation();
  let realExecutionCount = 0;
  globalThis.ActionEngine.runInvocation = async (_conversation, _caller, invocation, options) => {
    if (options?.dryRun) return { actionId: invocation.actionId, success: true, feedback: undefined };
    realExecutionCount += 1;
    return { actionId: invocation.actionId, success: true };
  };
  await previewWithoutFeedback.handleActionResults(9, player, { autoApproved: [], needsApproval: [pendingAction()] });
  assert.strictEqual(realExecutionCount, 0, "preview without feedback must not bypass manual approval");
  assert.strictEqual(previewWithoutFeedback.pendingActionApprovals.size, 1, "preview without feedback must still create a pending approval");
  assert.strictEqual(previewWithoutFeedback.messages[0].status, "pending", "preview without feedback must keep approval pending");

  const executionFailure = createConversation();
  let effectWriteCount = 0;
  globalThis.ActionEngine.runInvocation = async (_conversation, _caller, invocation, options) => {
    if (options?.dryRun) return { actionId: invocation.actionId, success: true, feedback: { message: "preview", sentiment: "neutral" } };
    return { actionId: invocation.actionId, success: false, error: "Resolved target character unavailable" };
  };
  await executionFailure.handleActionResults(10, player, { autoApproved: [], needsApproval: [pendingAction()] });
  const failedApprovalId = Array.from(executionFailure.pendingActionApprovals.keys())[0];
  await executionFailure.approveActions(failedApprovalId);
  const failedApprovalEntry = executionFailure.messages.find((entry) => entry.id === failedApprovalId);
  assert.strictEqual(failedApprovalEntry.resultSentiment, "negative", "approved action execution failure must surface a negative result");
  assert(failedApprovalEntry.resultFeedback.includes("Resolved target character unavailable"), "approved action execution failure must show the local execution error");
  assert.strictEqual(effectWriteCount, 0, "failed approved action must not write a CK3 effect");

  const published = [];
  const approvedEffect = createConversation();
  approvedEffect.messages.push({ id: 20, role: "user", name: player.fullName, content: "真实动作" });
  approvedEffect.processSocialConsequences = async (payload) => { published.push(payload); return null; };
  globalThis.ActionEngine.runInvocation = async (_conversation, _caller, invocation, options) => options?.dryRun
    ? { actionId: invocation.actionId, success: true, effectWritten: false }
    : { actionId: invocation.actionId, success: true, effectWritten: true, origin: "action", sourceMessageId: 20, eventId: "normal-20" };
  await approvedEffect.handleActionResults(20, player, { autoApproved: [], needsApproval: [pendingAction()] });
  await approvedEffect.approveActions([...approvedEffect.pendingActionApprovals.keys()][0]);
  assert.strictEqual(published.length, 1, "approved written effect must publish one confirmed event to Social Engine");
  assert.strictEqual(published[0].confirmedEvents.length, 1);

  const declinedEffect = createConversation();
  declinedEffect.messages.push({ id: 21, role: "user", name: player.fullName, content: "拒绝动作" });
  let declinedPublications = 0;
  declinedEffect.processSocialConsequences = async () => { declinedPublications++; };
  await declinedEffect.handleActionResults(21, player, { autoApproved: [], needsApproval: [pendingAction()] });
  declinedEffect.getApprovalManager().decline([...declinedEffect.pendingActionApprovals.keys()][0]);
  await Promise.resolve();
  assert.strictEqual(declinedPublications, 0, "declined approval must not publish a confirmed event");

  const unwrittenEffect = createConversation();
  unwrittenEffect.messages.push({ id: 22, role: "user", name: player.fullName, content: "无写入动作" });
  let unwrittenPublications = 0;
  unwrittenEffect.processSocialConsequences = async () => { unwrittenPublications++; };
  globalThis.ActionEngine.runInvocation = async (_conversation, _caller, invocation, options) => ({
    actionId: invocation.actionId,
    success: true,
    effectWritten: options?.dryRun ? false : false,
    origin: "action",
    sourceMessageId: 22
  });
  await unwrittenEffect.handleActionResults(22, player, { autoApproved: [], needsApproval: [pendingAction()] });
  await unwrittenEffect.approveActions([...unwrittenEffect.pendingActionApprovals.keys()][0]);
  assert.strictEqual(unwrittenPublications, 0, "successful dry or unwritten execution must not publish a confirmed event");

  const socialApproved = createConversation();
  const socialItem = { sourceCharacterId: 2, targetCharacterId: 1, reasonCluster: "gratitude", sourceEventId: "social-topic", delta: 2 };
  const socialReservation = social.consequenceCooldown.reserve(socialApproved, social.consequenceCooldown.scaleDelta(socialApproved, socialItem));
  const socialAction = pendingAction();
  socialAction.origin = "social";
  socialAction.socialReservationId = socialReservation.reservationId;
  socialAction.invocation = Object.freeze({ ...socialAction.invocation, eventId: "social:test:approval", origin: "social" });
  globalThis.ActionEngine.runInvocation = async (_conversation, _caller, invocation, options) => ({
    actionId: invocation.actionId,
    success: true,
    effectWritten: options?.dryRun ? false : true,
    eventId: invocation.eventId,
    origin: invocation.origin
  });
  await socialApproved.handleActionResults(23, player, { autoApproved: [], needsApproval: [socialAction] });
  await socialApproved.approveActions([...socialApproved.pendingActionApprovals.keys()][0]);
  assert.strictEqual(social.consequenceCooldown.scaleDelta(socialApproved, socialItem).delta, 1, "approved Social action must commit its reservation");

  const socialDeclined = createConversation();
  const declinedReservation = social.consequenceCooldown.reserve(socialDeclined, social.consequenceCooldown.scaleDelta(socialDeclined, socialItem));
  const declinedSocialAction = pendingAction();
  declinedSocialAction.origin = "social";
  declinedSocialAction.socialReservationId = declinedReservation.reservationId;
  declinedSocialAction.invocation = Object.freeze({ ...declinedSocialAction.invocation, eventId: "social:test:decline", origin: "social" });
  await socialDeclined.handleActionResults(24, player, { autoApproved: [], needsApproval: [declinedSocialAction] });
  socialDeclined.getApprovalManager().decline([...socialDeclined.pendingActionApprovals.keys()][0]);
  await Promise.resolve();
  assert.strictEqual(social.consequenceCooldown.scaleDelta(socialDeclined, socialItem).delta, 2, "declined Social action must release its reservation");

  console.log("VOTC v6.8.2 approval lifecycle: PASS (binding snapshots, stale participants and execution failures)");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
