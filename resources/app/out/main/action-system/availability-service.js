"use strict";
const { createAvailableAction } = require("./action-types");

function buildAvailableAction({ action, args, checkResult, sourceCharacter, targetCharacter, description, binding }) {
  const requiresTarget = typeof checkResult.requiresTarget === "boolean" ? checkResult.requiresTarget : !!(checkResult.validTargetCharacterIds && checkResult.validTargetCharacterIds.length > 0);
  return createAvailableAction({
    signature: action.id,
    args,
    requiresTarget: targetCharacter ? true : requiresTarget,
    validTargetCharacterIds: targetCharacter ? [targetCharacter.id] : checkResult.validTargetCharacterIds,
    description,
    sourceCharacterId: sourceCharacter.id,
    sourceCharacterName: sourceCharacter.shortName,
    sourceLocked: binding?.mode === "resolved" && sourceCharacter != null,
    resolvedTargetCharacterId: targetCharacter?.id,
    targetLocked: binding?.mode === "resolved" && targetCharacter != null,
    participantBinding: binding || null,
    deterministicInvocation: action.definition?.semantic?.deterministicInvocation === true
  });
}

module.exports = { buildAvailableAction };
