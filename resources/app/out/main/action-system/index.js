"use strict";

const { ConversationReferenceContext, buildMessageReferenceIndex } = require("./reference-context");
const { ReferenceResolver } = require("./reference-resolver");
const { ParticipantResolver } = require("./participant-resolver");
const actionTypes = require("./action-types");
const riskPolicy = require("./risk-policy");
const invocationValidator = require("./invocation-validator");
const eventTracker = require("./event-tracker");
const actionExecutor = require("./action-executor");
const candidateGate = require("./candidate-gate");
const eventParser = require("./event-parser");
const semanticResolver = require("./semantic-resolver");
const availabilityService = require("./availability-service");
const injuryTypeResolver = require("./injury-type-resolver");
const emotionTypeResolver = require("./emotion-type-resolver");
const deterministicInvocation = require("./deterministic-invocation");
const actionRuleRegistry = require("./action-rule-registry");
const { ConversationTurnManager } = require("./conversation-turn-manager");
const { GenerationManager } = require("./generation-manager");
const { ApprovalManager } = require("./approval-manager");
const participantLifecycle = require("./participant-lifecycle");
const actionDecisionTrace = require("./action-decision-trace");
const { ActionEngine } = require("./action-engine");
const { Conversation } = require("./conversation");
const actionSchema = require("./action-schema");
const { ActionRegistry } = require("./action-registry");
const { createConversationRuntime } = require("./conversation-runtime");
const { ActionPromptBuilder } = require("./action-prompt-builder");

module.exports = {
  ConversationReferenceContext,
  buildMessageReferenceIndex,
  ReferenceResolver,
  ParticipantResolver,
  ...actionTypes,
  riskPolicy,
  invocationValidator,
  eventTracker,
  actionExecutor,
  candidateGate,
  eventParser,
  semanticResolver,
  availabilityService,
  injuryTypeResolver,
  emotionTypeResolver,
  deterministicInvocation,
  actionRuleRegistry,
  ConversationTurnManager,
  GenerationManager,
  ApprovalManager,
  participantLifecycle,
  actionDecisionTrace,
  ActionEngine,
  Conversation,
  actionSchema,
  ActionRegistry,
  createConversationRuntime,
  ActionPromptBuilder
};
