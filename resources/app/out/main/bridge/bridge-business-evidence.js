"use strict";

// Only current-process dispatches can supply current-generation business evidence.
function createBridgeBusinessEvidence(bridgeService) {
  const commands = new Map();
  const current = () => bridgeService.getState().sessionEvidence;
  return {
    projectGameData(gameData) {
      gameData.bridgeFeatureAvailable = name => {
        try { return bridgeService.assertFeature(name); } catch (_error) { return false; }
      };
      const state = bridgeService.getState();
      if (["UNKNOWN", "PENDING"].includes(state.status)) return;
      gameData.bridgeUnavailableFeatures = Object.entries(state.features).filter(([, feature]) => !feature.allowed).map(([name]) => name);
      if (!gameData.bridgeUnavailableFeatures.includes("traits")) return;
      for (const character of gameData.characters.values()) {
        character.traits = [];
        character.traitsAvailable = false;
        for (const relative of [...(character.parents || []), ...(character.children || []), ...(character.siblings || [])]) {
          relative.traits = [];
          relative.traitsAvailable = false;
        }
      }
    },
    trackDispatch(commandId) {
      const session = current();
      if (!commandId || !session.logIdentityKnown) return;
      commands.set(commandId, session.generation);
      if (commands.size > 128) commands.delete(commands.keys().next().value);
    },
    isCurrentCommand(commandId) {
      const state = bridgeService.getState();
      const generation = commands.get(commandId);
      if (generation === undefined) return ["UNKNOWN", "PENDING"].includes(state.status);
      return state.sessionEvidence.logIdentityKnown && generation === state.sessionEvidence.generation;
    },
    observeCommand(channel, commandId) {
      const generation = commands.get(commandId);
      if (generation === undefined) return;
      bridgeService.observeEvidence(channel, { verified: true, generation });
    },
    observeClipboard() {
      const session = current();
      if (session.loadSessionSeen && session.logIdentityKnown) {
        bridgeService.observeEvidence("clipboard", { verified: true, generation: session.generation });
      }
    }
  };
}

module.exports = { createBridgeBusinessEvidence };
