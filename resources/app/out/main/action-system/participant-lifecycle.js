"use strict";

function deactivate(conversation, characterId, state) {
  if (characterId == null) return false;
  conversation.inactiveParticipantIds.set(characterId, state);
  conversation.npcQueue = conversation.npcQueue.filter((npc) => npc?.id !== characterId);
  if (conversation.activeResponse?.npcId === characterId && conversation.activeResponse.phase === "generating") {
    conversation.cancelActiveResponse("inactive_participant_generation");
  }
  if (conversation.referenceContext?.activeParticipantIds) {
    conversation.referenceContext.activeParticipantIds = conversation.referenceContext.activeParticipantIds.filter((id) => id !== characterId);
  }
  conversation.invalidateApprovalsForCharacter?.(characterId, state);
  console.log(`[Conversation] Participant ${characterId} marked inactive: ${state}`);
  return true;
}

module.exports = { deactivate };
