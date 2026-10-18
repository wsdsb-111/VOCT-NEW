"use strict";

const APPLICATION_SERVICE_METHODS = Object.freeze({
  conversation: Object.freeze([
    "createConversation", "getCurrentConversation", "sendMessage", "endCurrentConversation",
    "flushFinalizations", "hasPendingFinalizations"
  ]),
  // Presence state remains owned by Conversation; these are its existing manager entry points.
  presence: Object.freeze([
    "getConversationState", "joinWaitingCharacter", "leavePresentCharacter",
    "temporarilyLeaveCharacter", "returnTemporaryCharacter"
  ]),
  memory: Object.freeze([
    "retrieveForResponder", "finalizeConversation", "forgetSummaryProjection", "recoverPendingFinalizations"
  ]),
  worldline: Object.freeze([
    "getPromptContext", "getSubjectivePromptContextAsync", "getCheckpointStatus"
  ]),
<<<<<<< Updated upstream
=======
  characterKnowledge: Object.freeze(["getDisclosureProfile", "getConversationView", "getOwnerView", "getTargetView", "setManualStatus", "recordConversation"]),
>>>>>>> Stashed changes
  action: Object.freeze(["evaluateForCharacter", "runInvocation"]),
  letter: Object.freeze(["processLatestLetter", "clearLettersFile", "getAllLetterStatuses"])
});

function bindRequiredMethods(serviceName, owner, methodNames) {
  if ((typeof owner !== "object" && typeof owner !== "function") || owner === null) {
    throw new TypeError(`application_service_owner_required:${serviceName}`);
  }

  const port = {};
  for (const methodName of methodNames) {
    if (typeof owner[methodName] !== "function") {
      throw new TypeError(`application_service_method_required:${serviceName}.${methodName}`);
    }
    port[methodName] = owner[methodName].bind(owner);
  }
  return Object.freeze(port);
}

function createApplicationServices({ conversation, presence, memory, worldline, action, letter } = {}) {
  const owners = { conversation, presence, memory, worldline, action, letter };
  const services = {};
  for (const [serviceName, methodNames] of Object.entries(APPLICATION_SERVICE_METHODS)) {
    services[serviceName] = bindRequiredMethods(serviceName, owners[serviceName], methodNames);
  }
  return Object.freeze(services);
}

module.exports = { APPLICATION_SERVICE_METHODS, createApplicationServices };
