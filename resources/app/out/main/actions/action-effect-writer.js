"use strict";

function createActionEffectWriter({ runFileManager }) {
  return class ActionEffectWriter {
    static composeScopePrelude(sourceIndex, targetIndex, isPlayerTarget) {
      let prelude = "";
      if (sourceIndex !== null && sourceIndex !== undefined) {
        prelude += `
ordered_in_global_list = {
    variable = mcc_characters_list_v2
    position = ${sourceIndex}
    set_global_variable = {
        name = votc_action_source
        value = this
    }
}
`;
      }
      if (targetIndex !== null && targetIndex !== undefined) {
        if (isPlayerTarget) {
          prelude += `
root = {
    set_global_variable = {
        name = votc_action_target
        value = root
    }
}
`;
        } else {
          prelude += `
ordered_in_global_list = {
    variable = mcc_characters_list_v2
    position = ${targetIndex}
    set_global_variable = {
        name = votc_action_target
        value = this
    }
}
`;
        }
      }
      return prelude;
    }

    static composeFullEffect(gameData, sourceCharacterId, targetCharacterId, effectBody) {
      const sourceIndex = this.getCharacterIndex(gameData, sourceCharacterId);
      const targetIndex = targetCharacterId != null ? this.getCharacterIndex(gameData, targetCharacterId) : null;
      const isPlayerTarget = targetCharacterId != null && targetCharacterId === gameData.playerID;
      return `${this.composeScopePrelude(sourceIndex, targetIndex, isPlayerTarget)}\n${effectBody}\n`;
    }

    static writeEffect(gameData, sourceCharacterId, targetCharacterId, effectBody) {
      runFileManager.write(this.composeFullEffect(gameData, sourceCharacterId, targetCharacterId, effectBody));
    }

    static getCharacterIndex(gameData, characterId) {
      const ids = Array.from(gameData.characters.keys());
      const index = ids.indexOf(characterId);
      if (index === -1) throw new Error(`Character id ${characterId} not found in GameData.characters`);
      return index;
    }
  };
}

module.exports = { createActionEffectWriter };
