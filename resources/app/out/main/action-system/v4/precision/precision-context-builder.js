"use strict";

const pendingStore = require("../pending/explicit-pending-store");
const availableActionCatalog = require("../catalog/available-action-catalog");

function realDialogue(messages) {
  return (messages || []).filter((entry) => ["user", "assistant"].includes(entry?.role) && typeof entry.content === "string" && entry.content.trim().length > 0);
}

function build({ conversation, speaker, message, catalog, recentLimit = 4 }) {
  const previous = realDialogue(conversation.messages).filter((entry) => String(entry.id) !== String(message.id)).slice(-recentLimit);
  return Object.freeze({
    availableActions: JSON.parse(availableActionCatalog.serialize(catalog)),
    currentSpeaker: Object.freeze({ id: speaker.id, name: speaker.shortName || speaker.fullName, isPlayer: Number(speaker.id) === Number(conversation.gameData.playerID) }),
    activeParticipants: catalog.state.participants,
    relevantState: catalog.state,
    pending: Object.freeze(pendingStore.listActive(conversation).map((item) => ({
      pendingId: item.pendingId,
      actionId: item.actionId,
      sourceId: item.sourceId,
      targetId: item.targetId,
      arguments: item.arguments,
      expiresTurn: item.expiresTurn
    }))),
    recentDialogue: Object.freeze(previous.map((entry) => ({ id: entry.id, role: entry.role, name: entry.name || null, content: entry.content }))),
    currentMessage: Object.freeze({ id: message.id, role: message.role, name: message.name || null, content: message.content })
  });
}

function serialize(context) {
  return JSON.stringify(context);
}

module.exports = { realDialogue, build, serialize };
