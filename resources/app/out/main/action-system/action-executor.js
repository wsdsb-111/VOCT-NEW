"use strict";

async function execute({ actionSandbox, effectWriter, action, filePath, gameData, sourceCharacter, targetCharacter, args, conversation, dryRun, lang }) {
  if (!actionSandbox || !effectWriter || !sourceCharacter) throw new Error("missing_action_execution_dependency");
  let effectWritten = false;
  const runGameEffect = (effectBody) => {
    if (!dryRun) {
      effectWriter.writeEffect(gameData, sourceCharacter.id, targetCharacter?.id ?? null, effectBody);
      effectWritten = true;
    }
  };
  const result = await actionSandbox.executeAction(filePath, {
    gameData,
    sourceCharacter,
    targetCharacter,
    runGameEffect,
    args: args || {},
    conversation,
    dryRun,
    lang
  });
  return { result, effectWritten };
}

module.exports = { execute };
