"use strict";

const ACTION_SYSTEM_MODES = Object.freeze(["balanced", "performance", "precision"]);

function normalizeActionSystemMode(mode) {
  return ACTION_SYSTEM_MODES.includes(mode) ? mode : "balanced";
}

function syncConversationMode(conversation, mode) {
  const normalized = normalizeActionSystemMode(mode);
  const previous = conversation.actionSystemModeSnapshot;
  conversation.actionSystemModeSnapshot = normalized;
  if (previous === undefined || previous === normalized) return { mode: normalized, changed: false, previous: previous ?? null };
  conversation.pendingActionIntentStore?.clear("mode_changed");
  return { mode: normalized, changed: true, previous };
}

module.exports = { ACTION_SYSTEM_MODES, normalizeActionSystemMode, syncConversationMode };
