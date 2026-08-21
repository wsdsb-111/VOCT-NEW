"use strict";

const { ConversationTurnManager } = require("./conversation-turn-manager");
const { GenerationManager } = require("./generation-manager");
const { ConversationReferenceContext } = require("./reference-context");

function createConversationRuntime(conversation, { recordSkipped, createApprovalManager }) {
  const runtime = Object.freeze({
    turnManager: new ConversationTurnManager(conversation),
    generationManager: new GenerationManager(conversation, { recordSkipped }),
    referenceContext: new ConversationReferenceContext({ conversationId: conversation.id }),
    approvalManager: createApprovalManager()
  });
  return runtime;
}

module.exports = { createConversationRuntime };
