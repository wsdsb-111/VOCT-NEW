"use strict";

const DEFAULT_ACTION_MODE = "performance";
const ACTION_MODES = Object.freeze(["performance", "precision"]);

function normalizeActionMode(value) {
  if (value === "precision") return "precision";
  return DEFAULT_ACTION_MODE;
}

function syncConversationMode(conversation, configuredMode) {
  const mode = normalizeActionMode(configuredMode);
  const previous = conversation.actionSystemModeSnapshot ?? null;
  conversation.actionSystemModeSnapshot = mode;
  return { mode, previous, changed: previous != null && previous !== mode };
}

module.exports = { DEFAULT_ACTION_MODE, ACTION_MODES, normalizeActionMode, syncConversationMode };
