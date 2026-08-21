"use strict";

class GenerationManager {
  constructor(conversation, { recordSkipped } = {}) {
    this.conversation = conversation;
    this.recordSkippedCallback = recordSkipped;
    this.activeResponse = conversation.activeResponse || null;
    this.currentStreamController = conversation.currentStreamController || null;
    Object.defineProperty(conversation, "activeResponse", {
      configurable: true,
      enumerable: true,
      get: () => this.activeResponse,
      set: (value) => { this.activeResponse = value; }
    });
    Object.defineProperty(conversation, "currentStreamController", {
      configurable: true,
      enumerable: true,
      get: () => this.currentStreamController,
      set: (value) => { this.currentStreamController = value; }
    });
  }

  start({ turnEpoch, messageId, npcId }) {
    const controller = new AbortController();
    const responseState = {
      responseId: `${turnEpoch}:${messageId}:${npcId}`,
      turnEpoch,
      npcId,
      messageId,
      controller,
      status: "active",
      phase: "generating",
      stale: false,
      staleReason: null,
      skipRecorded: false
    };
    this.activeResponse = responseState;
    this.currentStreamController = controller;
    return responseState;
  }

  isCurrent(responseState, npc = null) {
    const conversation = this.conversation;
    return !!responseState && this.activeResponse === responseState && responseState.turnEpoch === conversation.turnEpoch && responseState.stale !== true && (!npc || conversation.isCharacterAvailableForConversation(npc));
  }

  markPhase(responseState, phase) {
    if (responseState) responseState.phase = phase;
  }

  recordSkipped(responseState, reason) {
    if (!responseState || responseState.skipRecorded) return;
    responseState.skipRecorded = true;
    this.recordSkippedCallback?.(responseState, reason);
  }

  cancel(reason = "explicit_abort") {
    const conversation = this.conversation;
    const responseState = this.activeResponse;
    if (!responseState) return false;
    responseState.stale = true;
    responseState.staleReason = reason;
    responseState.status = reason === "explicit_abort" ? "aborted" : "stale";
    if (!responseState.controller.signal.aborted) responseState.controller.abort();
    const placeholder = conversation.messages.find((message) => message.id === responseState.messageId);
    if (placeholder?.isStreaming) conversation.messages = conversation.messages.filter((message) => message.id !== responseState.messageId);
    this.recordSkipped(responseState, reason);
    if (this.activeResponse === responseState) this.activeResponse = null;
    if (this.currentStreamController === responseState.controller) this.currentStreamController = null;
    conversation.emitUpdate();
    return true;
  }

  cancelCurrent(reason = "explicit_abort") {
    if (this.activeResponse) return this.cancel(reason);
    if (!this.currentStreamController) return false;
    this.currentStreamController.abort();
    this.currentStreamController = null;
    return true;
  }

  fail(responseState) {
    if (responseState && responseState.status === "active") responseState.status = "failed";
  }

  finish(responseState, { wasCancelled = false } = {}) {
    const conversation = this.conversation;
    const ownsActiveResponse = this.activeResponse === responseState;
    if (!ownsActiveResponse) return false;
    if (wasCancelled && conversation.npcQueue.length === 0 && conversation.isPaused) conversation.isPaused = false;
    if (responseState.status === "active") responseState.status = "completed";
    this.activeResponse = null;
    if (this.currentStreamController === responseState.controller) this.currentStreamController = null;
    conversation.emitUpdate();
    return true;
  }
}

module.exports = { GenerationManager };
