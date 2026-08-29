"use strict";

function isAlive(character) {
  return !!character && character.isDead !== true && character.dead !== true && character.alive !== false;
}

function activeParticipants(conversation) {
  const listed = typeof conversation.getActiveConversationCharacters === "function"
    ? conversation.getActiveConversationCharacters()
    : [...(conversation.gameData?.characters?.values?.() || [])];
  return listed
    .filter((character) => isAlive(character) && !conversation.inactiveParticipantIds?.has?.(character.id))
    .sort((left, right) => Number(left.id) - Number(right.id));
}

function compactCharacter(character, gameData) {
  return Object.freeze({
    id: character.id,
    name: character.shortName || character.fullName || String(character.id),
    isPlayer: Number(character.id) === Number(gameData.playerID),
    alive: isAlive(character),
    imprisoned: character.isImprisoned === true || character.imprisoned === true,
    gold: Number.isFinite(Number(character.gold)) ? Number(character.gold) : null,
    employerId: character.employerId ?? character.liegeId ?? null,
    courtPosition: character.courtPosition ?? null,
    councilPosition: character.councilPosition ?? null,
    relations: (character.relationsToCharacters || [])
      .map((entry) => ({ id: entry.id, relations: [...(entry.relations || [])].map(String).sort() }))
      .sort((left, right) => Number(left.id) - Number(right.id))
  });
}

function project(conversation, speaker) {
  const participants = activeParticipants(conversation);
  return Object.freeze({
    speakerId: speaker?.id ?? null,
    playerId: conversation.gameData?.playerID ?? null,
    participants: Object.freeze(participants.map((character) => compactCharacter(character, conversation.gameData)))
  });
}

module.exports = { isAlive, activeParticipants, compactCharacter, project };
