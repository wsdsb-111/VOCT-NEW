"use strict";

function createConversationManager({ events, memorySystem, Conversation, PromptBuilder, createActionFeedback, logVerboseLLM }) {
  class ConversationManager {
    constructor() {
      this.currentConversation = null;
      this.eventEmitter = new events.EventEmitter();
      this.finalizationCoordinator = new memorySystem.FinalizationCoordinator({ logger: console });
    }
    static getInstance() {
      if (!ConversationManager.instance) {
        ConversationManager.instance = new ConversationManager();
      }
      return ConversationManager.instance;
    }
    setupConversationListeners() {
      if (this.currentConversation) {
        this.currentConversation.onConversationUpdate((entries) => {
          this.eventEmitter.emit("conversation-updated", entries);
        });
      }
    }
    emitConversationUpdate() {
      const entries = this.getConversationEntries();
      this.eventEmitter.emit("conversation-updated", entries);
    }
    /**
     * Create a new conversation with an NPC
     */
    createConversation() {
      try {
        this.endCurrentConversation();
        this.currentConversation = new Conversation();
        this.setupConversationListeners();
        return this.currentConversation;
      } catch (error) {
        console.error("Failed to create conversation:", error);
        return null;
      }
    }
    /**
     * Get the current active conversation
     */
    getCurrentConversation() {
      return this.currentConversation;
    }
    /**
     * Send a message in the current conversation
     */
    async sendMessage(userMessage, streaming = false) {
      console.log(`ConversationManager.sendMessage called (characters=${typeof userMessage === "string" ? userMessage.length : 0}, streaming=${streaming})`);
      logVerboseLLM("[ConversationManager][verbose] User message:", userMessage);
      console.log("Current conversation exists:", !!this.currentConversation);
      console.log("Current conversation active:", this.currentConversation?.isActive);
      if (!this.currentConversation) {
        console.error("No active conversation");
        throw new Error("No active conversation");
      }
      if (!this.currentConversation.isActive) {
        console.error("Current conversation is not active");
        throw new Error("Current conversation is not active");
      }
      try {
        const result = await this.currentConversation.sendMessage(userMessage);
        console.log("Conversation sendMessage returned type:", typeof result);
        if (streaming && result && typeof result[Symbol.asyncIterator] === "function") {
          console.log("Returning async generator for streaming");
          return result;
        } else {
          console.log("Conversation sendMessage returned:", result);
          this.emitConversationUpdate();
          return result;
        }
      } catch (error) {
        console.error("Error in ConversationManager.sendMessage:", error);
        this.emitConversationUpdate();
        throw error;
      }
    }
    /**
     * Get all conversation entries (messages and errors)
     */
    getConversationEntries() {
      if (!this.currentConversation) {
        return [];
      }
      return this.currentConversation.messages.map((entry) => {
        if ("role" in entry) {
          return {
            type: "message",
            id: entry.id,
            role: entry.role,
            content: entry.content,
            datetime: entry.datetime,
            name: entry.name,
            isStreaming: entry.isStreaming,
            streamStatus: entry.streamStatus
          };
        } else if (entry.type === "action-feedback") {
          return {
            type: "action-feedback",
            id: entry.id,
            associatedMessageId: entry.associatedMessageId,
            feedbacks: entry.feedbacks.map((f) => ({
              actionId: f.actionId,
              success: f.success,
              message: f.message,
              sentiment: f.sentiment
            })),
            datetime: entry.datetime
          };
        } else if (entry.type === "action-approval") {
          return {
            type: "action-approval",
            id: entry.id,
            associatedMessageId: entry.associatedMessageId,
            action: entry.action,
            status: entry.status,
            previewFeedback: entry.previewFeedback,
            previewSentiment: entry.previewSentiment,
            resultFeedback: entry.resultFeedback,
            resultSentiment: entry.resultSentiment,
            datetime: entry.datetime
          };
        } else {
          return {
            type: "error",
            id: entry.id,
            content: entry.content,
            datetime: entry.datetime,
            details: entry.details
          };
        }
      });
    }
    /**
     * End current conversation
     */
    endCurrentConversation() {
      const conversation = this.currentConversation;
      this.currentConversation = null;
      if (!conversation) return Promise.resolve(null);
      console.log(`Conversation ${conversation.id} detached; finalization queued`);
      return this.finalizationCoordinator.enqueue(conversation.id, () => conversation.finalizeConversation()).catch((error) => {
        console.error(`Conversation ${conversation.id} finalization failed:`, error);
        return { success: false, error };
      });
    }
    flushFinalizations(options = {}) {
      return this.finalizationCoordinator.drain(options);
    }
    hasPendingFinalizations() {
      return this.finalizationCoordinator.pendingCount > 0;
    }
    /**
     * Cancel the current stream in the active conversation
     */
    cancelCurrentStream() {
      if (this.currentConversation) {
        this.currentConversation.cancelCurrentStream();
      }
    }
    /**
     * Check if there's an active conversation
     */
    hasActiveConversation() {
      return this.currentConversation !== null && this.currentConversation.isActive;
    }
    /**
     * Pause the current conversation
     */
    pauseConversation() {
      if (this.currentConversation) {
        this.currentConversation.pauseConversation();
      }
    }
    /**
     * Resume the current conversation
     */
    resumeConversation() {
      if (this.currentConversation) {
        this.currentConversation.resumeConversation();
      }
    }
    /**
     * Get conversation state (paused, queue length)
     */
    getConversationState() {
      if (!this.currentConversation) {
        return { isPaused: false, queueLength: 0, presence: null };
      }
      return {
        isPaused: this.currentConversation.isPaused,
        queueLength: this.currentConversation.npcQueue.length,
        presence: this.currentConversation.getPresenceState()
      };
    }
    async joinWaitingCharacter(characterId) {
      if (!this.currentConversation?.isActive) return { success: false, error: "no_active_conversation" };
      const result = await this.currentConversation.joinWaitingCharacter(characterId);
      this.emitConversationUpdate();
      return result;
    }
    async leavePresentCharacter(characterId) {
      if (!this.currentConversation?.isActive) return { success: false, error: "no_active_conversation" };
      const result = await this.currentConversation.leavePresentCharacter(characterId);
      this.emitConversationUpdate();
      return result;
    }
    async temporarilyLeaveCharacter(characterId, mode) {
      if (!this.currentConversation?.isActive) return { success: false, error: "no_active_conversation" };
      const result = await this.currentConversation.temporarilyLeaveCharacter(characterId, mode);
      this.emitConversationUpdate();
      return result;
    }
    async returnTemporaryCharacter(characterId) {
      if (!this.currentConversation?.isActive) return { success: false, error: "no_active_conversation" };
      const result = await this.currentConversation.returnTemporaryCharacter(characterId);
      this.emitConversationUpdate();
      return result;
    }
    /**
     * Regenerate an error message
     */
    async regenerateError(messageId) {
      if (!this.currentConversation) {
        throw new Error("No active conversation");
      }
      try {
        await this.currentConversation.regenerateError(messageId);
        this.emitConversationUpdate();
        return { success: true };
      } catch (error) {
        console.error("Error in ConversationManager.regenerateError:", error);
        this.emitConversationUpdate();
        throw error;
      }
    }
    /**
     * Subscribe to conversation updates
     */
    onConversationUpdate(callback) {
      this.eventEmitter.on("conversation-updated", callback);
    }
    /**
     * Unsubscribe from conversation updates
     */
    offConversationUpdate(callback) {
      this.eventEmitter.off("conversation-updated", callback);
    }
    /**
     * Get active conversation data
     */
    getActiveConversationData() {
      if (!this.currentConversation || !this.currentConversation.isActive) {
        return null;
      }
      const characters = Array.from(this.currentConversation.gameData.characters.values()).map((char) => ({
        id: char.id,
        fullName: char.fullName,
        shortName: char.shortName
      }));
      return {
        characters,
        playerID: this.currentConversation.gameData.playerID,
        aiID: this.currentConversation.gameData.aiID,
        historyLength: this.currentConversation.getHistory().length,
        presence: this.currentConversation.getPresenceState()
      };
    }
    /**
     * Get prompt preview for a specific character
     */
    getPromptPreview(characterId) {
      if (!this.currentConversation || !this.currentConversation.isActive) {
        return null;
      }
      const character = this.currentConversation.gameData.characters.get(characterId);
      if (!character) {
        return null;
      }
      const history = this.currentConversation.getPromptHistoryForCharacter(characterId);
      const result = PromptBuilder.buildMessagesWithTokenCount(
        history,
        character,
        this.currentConversation.gameData,
        this.currentConversation.getPromptSummaryForCharacter(characterId),
        {
          activeParticipantIds: this.currentConversation.getActiveConversationCharacters().map((participant) => participant.id),
          presenceText: this.currentConversation.buildPresenceContext()
        }
      );
      return {
        characterId,
        characterName: character.fullName,
        ...result
      };
    }
    /**
     * Add an action feedback entry for a manually executed action
     */
    addManualActionFeedback(feedback) {
      if (!this.currentConversation || !this.currentConversation.isActive) {
        console.warn("No active conversation to add action feedback");
        return;
      }
      const feedbackEntry = createActionFeedback({
        id: this.currentConversation["nextId"]++,
        feedbacks: [{
          actionId: feedback.actionId,
          success: feedback.success,
          message: feedback.message,
          sentiment: feedback.sentiment
        }]
      });
      this.currentConversation["messages"].push(feedbackEntry);
      this.currentConversation["emitUpdate"]();
    }
  }
  
  return ConversationManager;
}

module.exports = { createConversationManager };
