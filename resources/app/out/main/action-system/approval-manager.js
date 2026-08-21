"use strict";

class ApprovalManager {
  constructor(conversation, dependencies) {
    this.conversation = conversation;
    this.dependencies = dependencies;
    this.pending = conversation.pendingActionApprovals instanceof Map ? conversation.pendingActionApprovals : new Map();
    Object.defineProperty(conversation, "pendingActionApprovals", {
      configurable: true,
      enumerable: true,
      get: () => this.pending,
      set: (value) => { this.pending = value instanceof Map ? value : new Map(); }
    });
  }

  async handleActionResults(associatedMessageId, npc, actionResults) {
    const conversation = this.conversation;
    const deps = this.dependencies;
    const autoFeedbackResults = [...actionResults.autoApproved];
    for (const action of actionResults.needsApproval) {
      let previewFeedback;
      let previewSentiment;
      try {
        const previewResult = await deps.runInvocation(conversation, npc, action.invocation, { dryRun: true });
        if (previewResult.feedback?.message) {
          previewFeedback = previewResult.feedback.message;
          previewSentiment = previewResult.feedback.sentiment || "neutral";
        }
      } catch (error) {
        console.error("[ApprovalManager] Preview action failed:", error);
      }
      const approvalEntry = deps.createApproval({
        id: conversation.nextId++,
        associatedMessageId,
        action: {
          actionId: action.actionId,
          actionTitle: action.actionTitle,
          sourceCharacterId: action.sourceCharacterId,
          sourceCharacterName: action.sourceCharacterName,
          targetCharacterId: action.targetCharacterId,
          targetCharacterName: action.targetCharacterName,
          args: action.args,
          isDestructive: action.isDestructive,
          riskLevel: action.riskLevel
        },
        previewFeedback,
        previewSentiment
      });
      conversation.messages.push(approvalEntry);
      this.pending.set(approvalEntry.id, {
        npc,
        action,
        invocation: action.invocation,
        bindingId: action.invocation?.bindingId ?? null,
        sourceCharacterId: action.invocation?.sourceCharacterId ?? action.sourceCharacterId ?? null,
        targetCharacterId: action.invocation?.targetCharacterId ?? action.targetCharacterId ?? null,
        previewFeedback,
        previewSentiment,
        approvalEntryId: approvalEntry.id
      });
    }
    if (autoFeedbackResults.length > 0) deps.addFeedback(associatedMessageId, autoFeedbackResults);
    const approvalSettings = deps.getApprovalSettings();
    if (this.pending.size > 0 && approvalSettings.pauseOnApproval && conversation.npcQueue.length > 0) conversation.pauseConversation();
    if (this.pending.size > 0) conversation.emitUpdate();
  }

  invalidate(approvalId, reason) {
    const conversation = this.conversation;
    const pending = this.pending.get(approvalId);
    if (!pending) return false;
    this.pending.delete(approvalId);
    const entry = conversation.messages.find((message) => message.type === "action-approval" && message.id === approvalId);
    if (entry) {
      entry.status = "declined";
      entry.resultFeedback = this.dependencies.invalidationFeedback();
      entry.resultSentiment = "negative";
    }
    this.dependencies.recordInvalidation({
      requestType: "action_approval_invalidated",
      actionId: pending.action?.actionId,
      sourceCharacterId: pending.sourceCharacterId ?? null,
      targetCharacterId: pending.targetCharacterId ?? null,
      bindingId: pending.bindingId ?? null,
      reason
    });
    conversation.emitUpdate();
    return true;
  }

  invalidateForCharacter(characterId) {
    for (const [approvalId, pending] of this.pending.entries()) {
      const sourceId = pending.invocation?.sourceCharacterId ?? pending.sourceCharacterId ?? pending.action?.sourceCharacterId ?? pending.npc?.id ?? null;
      const targetId = pending.invocation?.targetCharacterId ?? pending.targetCharacterId ?? pending.action?.targetCharacterId ?? null;
      if (pending.npc?.id === characterId || sourceId === characterId || targetId === characterId) {
        const reason = sourceId === characterId ? "stale_approval_source_unavailable" : targetId === characterId ? "stale_approval_target_unavailable" : "approval_binding_invalidated";
        this.invalidate(approvalId, reason);
      }
    }
  }

  async approve(approvalEntryId) {
    const conversation = this.conversation;
    const deps = this.dependencies;
    const pending = this.pending.get(approvalEntryId);
    if (!pending) throw new Error(`No pending approval found for ID ${approvalEntryId}`);
    const approvalEntry = conversation.messages.find((message) => message.type === "action-approval" && message.id === approvalEntryId);
    if (!approvalEntry) throw new Error(`Approval entry not found for ID ${approvalEntryId}`);
    const invocation = pending.invocation || pending.action.invocation;
    const sourceId = invocation?.sourceCharacterId ?? pending.sourceCharacterId ?? pending.npc?.id ?? null;
    const targetId = invocation?.targetCharacterId ?? pending.targetCharacterId ?? null;
    let invalidationReason = null;
    if ((pending.bindingId != null && invocation?.bindingId !== pending.bindingId) || (pending.sourceCharacterId != null && sourceId !== pending.sourceCharacterId) || (pending.targetCharacterId != null && targetId !== pending.targetCharacterId)) {
      invalidationReason = "approval_binding_invalidated";
    } else {
      const loaded = deps.getAction(invocation?.actionId);
      const source = sourceId != null ? conversation.gameData.characters.get(sourceId) : null;
      const target = targetId != null ? conversation.gameData.characters.get(targetId) : null;
      if (!loaded || !loaded.validation?.valid || deps.isActionDisabled(invocation?.actionId)) invalidationReason = "stale_approval_action_unavailable";
      else if (!source || !conversation.isCharacterAvailableForConversation(source)) invalidationReason = "stale_approval_source_unavailable";
      else if (targetId != null && (!target || !conversation.isCharacterAvailableForConversation(target))) invalidationReason = "stale_approval_target_unavailable";
    }
    if (invalidationReason) {
      this.invalidate(approvalEntryId, invalidationReason);
      return;
    }
    approvalEntry.status = "approved";
    approvalEntry.resultFeedback = pending.previewFeedback || pending.action.actionTitle || pending.action.actionId;
    approvalEntry.resultSentiment = pending.previewSentiment || "neutral";
    this.pending.delete(approvalEntryId);
    conversation.emitUpdate();
    try {
      const result = await deps.runInvocation(conversation, pending.npc, invocation);
      if (!result?.success) {
        approvalEntry.resultFeedback = `Failed: ${result?.error || "Action execution failed"}`;
        approvalEntry.resultSentiment = "negative";
        conversation.emitUpdate();
      } else if (result.feedback?.message && result.feedback.message !== approvalEntry.resultFeedback) {
        approvalEntry.resultFeedback = result.feedback.message;
        approvalEntry.resultSentiment = result.feedback.sentiment || "neutral";
        conversation.emitUpdate();
      }
    } catch (error) {
      console.error("[ApprovalManager] Background action execution failed:", error);
      approvalEntry.resultFeedback = `Failed: ${error instanceof Error ? error.message : String(error)}`;
      approvalEntry.resultSentiment = "negative";
      conversation.emitUpdate();
    }
    this.resumeIfNeeded();
  }

  decline(approvalEntryId) {
    const conversation = this.conversation;
    if (!this.pending.has(approvalEntryId)) throw new Error(`No pending approval found for ID ${approvalEntryId}`);
    const entryIndex = conversation.messages.findIndex((message) => message.type === "action-approval" && message.id === approvalEntryId);
    if (entryIndex === -1) throw new Error(`Approval entry not found for ID ${approvalEntryId}`);
    conversation.messages.splice(entryIndex, 1);
    this.pending.delete(approvalEntryId);
    conversation.emitUpdate();
    this.resumeIfNeeded();
  }

  resumeIfNeeded() {
    const conversation = this.conversation;
    const settings = this.dependencies.getApprovalSettings();
    if (settings.pauseOnApproval && conversation.isPaused && conversation.npcQueue.length > 0) conversation.resumeConversation();
  }
}

module.exports = { ApprovalManager };
