"use strict";

async function execute({ actionSandbox, effectWriter, action, filePath, gameData, sourceCharacter, targetCharacter, args, conversation, dryRun, lang }) {
  if (!actionSandbox || !effectWriter || !sourceCharacter) throw new Error("missing_action_execution_dependency");
  const runGameEffect = (effectBody) => {
    if (!dryRun) effectWriter.writeEffect(gameData, sourceCharacter.id, targetCharacter?.id ?? null, effectBody);
  };
  return actionSandbox.executeAction(filePath, {
    gameData,
    sourceCharacter,
    targetCharacter,
    runGameEffect,
    args: args || {},
    conversation,
    dryRun,
    lang
  });
}

module.exports = { execute };
