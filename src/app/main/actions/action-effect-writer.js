"use strict";

function createActionEffectWriter({ runFileManager }) {
  return class ActionEffectWriter {
    static composeScopePrelude(sourceIndex, targetIndex, isPlayerTarget, isPlayerSource = false) {
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
      if (isPlayerSource) {
        prelude = "root = { set_global_variable = { name = votc_action_source value = root } }\n";
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

    static composeFullEffect(gameData, sourceCharacterId, targetCharacterId, effectBody, trackGold = false, trackOpinion = false, goldAmount = null) {
      const sourceIndex = this.getCharacterIndex(gameData, sourceCharacterId);
      const targetIndex = targetCharacterId != null ? this.getCharacterIndex(gameData, targetCharacterId) : null;
      const isPlayerTarget = targetCharacterId != null && targetCharacterId === gameData.playerID;
      const prelude = this.composeScopePrelude(sourceIndex, targetIndex, isPlayerTarget, sourceCharacterId === gameData.playerID);
      const readback = trackGold ? "global_var:votc_action_source = { log_income = yes }\nglobal_var:votc_action_target = { log_income = yes }\n" : trackOpinion ? 'global_var:votc_action_target = { global_var:votc_action_source = { debug_log = "VOTC:IN/;/opinions/;/[THIS.Char.GetID]/;/[PREV.Char.GetID]/;/[THIS.Char.GetOpinionOf(PREV.Char.Self)]/;/" } }\n' : "";
      const targetGuard = targetCharacterId == null ? "" : "exists = global_var:votc_action_target";
      const binding = 'global_var:votc_action_source = { debug_log = "VOTC:ACTION_SOURCE/;/[THIS.Char.GetID]" }\n'
        + (targetCharacterId == null ? "" : 'global_var:votc_action_target = { debug_log = "VOTC:ACTION_TARGET/;/[THIS.Char.GetID]" }\n');
      const guardedBody = trackGold && Number.isFinite(goldAmount) && goldAmount > 0
        ? `if = { limit = { global_var:votc_action_source = { gold >= ${Math.floor(goldAmount)} } }\n${effectBody}\n}\nelse = { debug_log = "VOTC:ACTION_INSUFFICIENT_GOLD" }` : effectBody;
      return `remove_global_variable = votc_action_source\nremove_global_variable = votc_action_target\n${prelude}\nif = { limit = { exists = global_var:votc_action_source ${targetGuard} }\n${binding}${readback}${guardedBody}\n${readback}\n}\nelse = { debug_log = "VOTC:ACTION_BINDING_FAILED" }\n`;
    }

    static writeEffect(gameData, sourceCharacterId, targetCharacterId, effectBody, context = {}) {
      runFileManager.releaseStalledActionForNewAction?.();
      if (runFileManager.getQueueHealth?.()?.queueBlocked) throw new Error("action_queue_blocked");
      const sourceIndex = this.getCharacterIndex(gameData, sourceCharacterId);
      const targetIndex = targetCharacterId != null ? this.getCharacterIndex(gameData, targetCharacterId) : null;
      if (context.trackGold && (!Number.isFinite(context.goldAmount) || context.goldAmount < 1)) throw new Error("invalid_gold_readback_amount");
      const effectText = this.composeFullEffect(gameData, sourceCharacterId, targetCharacterId, effectBody, context.trackGold === true, context.trackOpinion === true, context.goldAmount);
      const result = runFileManager.write(effectText, {
        owner: "action",
        kind: "action_effect",
        scopeId: context.scopeId,
        epoch: context.epoch
      });
      return result ? { ...result, sourceIndex, targetIndex, effectBody: String(effectBody).trim(), effectText, hasCommandEnvelope: true, hasGoldReadback: context.trackGold === true, hasOpinionReadback: context.trackOpinion === true } : result;
    }

    static getCharacterIndex(gameData, characterId) {
      // CK3's global list contains NPCs; the player is emitted separately by the log producer.
      const ids = Array.from(gameData.characters.keys()).filter(id => characterId === gameData.playerID || id !== gameData.playerID);
      const index = ids.indexOf(characterId);
      if (index === -1) throw new Error(`Character id ${characterId} not found in GameData.characters`);
      return index;
    }
  };
}

module.exports = { createActionEffectWriter };
