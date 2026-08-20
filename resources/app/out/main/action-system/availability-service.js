"use strict";

function buildAvailableAction({ action, args, checkResult, sourceCharacter, targetCharacter, description, binding }) {
  const requiresTarget = typeof checkResult.requiresTarget === "boolean" ? checkResult.requiresTarget : !!(checkResult.validTargetCharacterIds && checkResult.validTargetCharacterIds.length > 0);
  return {
    signature: action.id,
    args,
    requiresTarget: targetCharacter ? true : requiresTarget,
    validTargetCharacterIds: targetCharacter ? [targetCharacter.id] : checkResult.validTargetCharacterIds,
    description,
    sourceCharacterId: sourceCharacter.id,
    sourceCharacterName: sourceCharacter.shortName,
    resolvedTargetCharacterId: targetCharacter?.id,
    targetLocked: binding?.mode === "resolved" && targetCharacter != null,
    participantBinding: binding || null
  };
}

module.exports = { buildAvailableAction };
