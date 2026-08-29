"use strict";

const { ActionEngine: LegacyActionEngineV3 } = require("./action-engine-v3");
const { ActionEngineV4 } = require("./v4/action-engine-v4");
const engineVersion = require("./v4/constants/action-engine-version");

let activeVersion = engineVersion.configuredActionEngineVersion();

class ActionEngine {
  static configure(dependencies = {}) {
    activeVersion = engineVersion.configuredActionEngineVersion(dependencies.actionEngineVersion);
    LegacyActionEngineV3.configure(dependencies);
    ActionEngineV4.configure(dependencies);
    return this;
  }

  static getActiveEngineVersion() {
    return activeVersion;
  }

  static getActiveEngine() {
    return activeVersion === engineVersion.LEGACY_ACTION_ENGINE_VERSION ? LegacyActionEngineV3 : ActionEngineV4;
  }

  static buildTurnEvaluationPlan({ playerMessage, player, npcMessage, npc }) {
    const evaluations = [];
    if (playerMessage && player) evaluations.push({ source: player, message: playerMessage, associatedMessageId: playerMessage.id, kind: "player" });
    if (npcMessage && npc) evaluations.push({ source: npc, message: npcMessage, associatedMessageId: npcMessage.id, kind: "npc" });
    return evaluations;
  }

  static evaluateForCharacter(...args) {
    return this.getActiveEngine().evaluateForCharacter(...args);
  }

  static runInvocation(...args) {
    return this.getActiveEngine().runInvocation(...args);
  }

  static evaluateProposals(...args) {
    return ActionEngineV4.evaluateProposals(...args);
  }
}

for (const method of [
  "getActionTriggers",
  "parseActionEvents",
  "getActionEvents",
  "resolveMetadataSemanticCandidates",
  "resolveSemanticEvent",
  "getSemanticActionProfile",
  "getActionTrigger",
  "getAllowedPoseOptions",
  "getConversationReferenceContext",
  "resolveEventParticipants",
  "shouldEvaluateForMessage",
  "traceDecision"
]) {
  ActionEngine[method] = (...args) => LegacyActionEngineV3[method](...args);
}

module.exports = { ActionEngine, LegacyActionEngineV3, ActionEngineV4 };
