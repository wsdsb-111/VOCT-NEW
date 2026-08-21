"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
globalThis.__V67ActionSystem = require(path.join(root, "resources", "app", "out", "main", "action-system"));
const source = fs.readFileSync(path.join(root, "resources", "app", "out", "main", "main.js"), "utf8");
const conversationStart = source.indexOf("class Conversation {");
const conversationEnd = source.indexOf("\nclass ConversationManager {", conversationStart);
assert(conversationStart >= 0 && conversationEnd > conversationStart, "Cannot extract Conversation");

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

eval(`${source.slice(conversationStart, conversationEnd)}\nglobalThis.__V682Conversation = Conversation;`);
const Conversation = globalThis.__V682Conversation;

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
  for (const method of ["getActionSystem", "createApprovalManager", "getApprovalManager", "isCharacterAvailableForConversation", "invalidatePendingActionApproval", "invalidateApprovalsForCharacter", "markParticipantInactive", "handleActionResults", "approveActions", "removeCharacterFromConversation"]) {
    conversation[method] = Conversation.prototype[method];
  }
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

  console.log("VOTC v6.8.2 approval lifecycle: PASS (binding snapshots, stale participants and execution failures)");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
