"use strict";

async function execute({ actionSandbox, effectWriter, action, filePath, gameData, sourceCharacter, targetCharacter, args, conversation, dryRun, lang }) {
  if (!actionSandbox || !effectWriter || !sourceCharacter) throw new Error("missing_action_execution_dependency");
  let effectWritten = false;
  let effectAttempted = false;
  const runGameEffect = (effectBody) => {
    if (!dryRun) {
      effectAttempted = true;
      try {
        effectWriter.writeEffect(gameData, sourceCharacter.id, targetCharacter?.id ?? null, effectBody);
        effectWritten = true;
      } catch (error) {
        error.executionStatus = "post_send_unknown";
        throw error;
      }
    }
  };
  try {
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
    return { result, effectWritten, effectAttempted };
  } catch (error) {
    if (!error.executionStatus) error.executionStatus = effectAttempted ? "post_send_unknown" : "pre_send_failure";
    throw error;
  }
}

module.exports = { execute };
