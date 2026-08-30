"use strict";

class ConversationTurnManager {
  constructor(conversation) {
    this.conversation = conversation;
    this.epoch = Number(conversation.turnEpoch) || 0;
    this.queue = Array.isArray(conversation.npcQueue) ? conversation.npcQueue : [];
    this.currentTurn = null;
    Object.defineProperty(conversation, "turnEpoch", {
      configurable: true,
      enumerable: true,
      get: () => this.epoch,
      set: (value) => { this.epoch = Number(value) || 0; }
    });
    Object.defineProperty(conversation, "npcQueue", {
      configurable: true,
      enumerable: true,
      get: () => this.queue,
      set: (value) => { this.queue = Array.isArray(value) ? value : []; }
    });
  }

  startUserTurn({ playerMessageId, activeParticipantIds = [] }) {
    this.epoch += 1;
    this.conversation.cancelActiveResponse?.("superseded_by_new_user_turn");
    this.queue = [];
    this.currentTurn = Object.freeze({
      turnId: `${this.conversation.id || "conversation"}:${this.epoch}`,
      epoch: this.epoch,
      playerMessageId,
      startedAt: Date.now(),
      activeParticipantIds: Object.freeze([...activeParticipantIds]),
      queueState: "cleared"
    });
    return this.currentTurn;
  }

  supersede(reason) {
    this.epoch += 1;
    this.conversation.cancelActiveResponse?.(reason);
    this.queue = [];
    this.currentTurn = null;
    return this.epoch;
  }

  isCurrent(turn) {
    return !!turn && turn.epoch === this.epoch;
  }

  fillQueue({ customQueue, npcs, persistCustomQueue }) {
    if (Array.isArray(customQueue) && customQueue.length > 0) {
      this.queue = [...customQueue];
      return { mode: "custom", consumeCustomQueue: !persistCustomQueue };
    }
    this.queue = [...(npcs || [])].sort(() => Math.random() - 0.5);
    return { mode: "shuffled", consumeCustomQueue: false };
  }

  async processQueue(epoch = this.epoch) {
    const conversation = this.conversation;
    if (epoch !== this.epoch || this.queue.length === 0 || conversation.isPaused) return;
    console.log("Processing queue with", this.queue.length, "NPCs remaining");
    while (epoch === this.epoch && this.queue.length > 0 && !conversation.isPaused) {
      const npc = this.queue.shift();
      try {
        await conversation.respondAs(npc, epoch);
      } catch (error) {
        console.error("Unhandled error in respondAs for", npc.shortName, ":", error);
        conversation.emitUpdate();
      }
    }
    if (this.queue.length === 0 && conversation.isPaused) conversation.isPaused = false;
    if (this.queue.length === 0) conversation.emitUpdate();
  }
}

module.exports = { ConversationTurnManager };
