/** @import { GameData, Character } from '../../gamedata_typedefs.js' */
module.exports = {
  signature: "characterIsKilled",
  actionMetadata: { selectorContract: { shortDescription: "Source character is killed by target character.", sourceRole: "victim", targetRole: "killer" } },
  title: {
    en: "Source Character Is Killed",
    ru: "Исходный персонаж убит",
    fr: "Le personnage source est tué",
    de: "Quellcharakter wird getötet",
    es: "El personaje fuente es asesinado",
    ja: "ソースキャラクターが殺される",
    ko: "출처 캐릭터가 살해됨",
    pl: "Postać źródłowa jest zabita",
    zh: "角色被杀害"
  },
  isDestructive: true,
  triggerCategories: ["death_or_injury"],
  semantic: {
    candidatePatterns: [/(?:杀死|杀了|砍死|刺死|毒死|勒死|掐死|打死|烧死|淹死|处死|斩首|枭首|人头落地|身首异处|毙命|殒命|气绝|断气|倒地(?:身亡|死去)|(?:割|砍|斩|削)(?:了)?(?:下|断|落).{0,4}(?:脑袋|头颅|首级|头)|(?:脑袋|头颅|首级|头).{0,6}(?:被)?(?:割|砍|斩|削)(?:了)?(?:下|断|落)|killed?|executed|died)/i],
    evidencePatterns: [/(?:杀死|杀了|砍死|刺死|毒死|勒死|掐死|打死|烧死|淹死|处死|斩首|枭首|人头落地|身首异处|毙命|殒命|气绝|断气|倒地(?:身亡|死去)|(?:割|砍|斩|削)(?:了)?(?:下|断|落).{0,4}(?:脑袋|头颅|首级|头)|(?:脑袋|头颅|首级|头).{0,6}(?:被)?(?:割|砍|斩|削)(?:了)?(?:下|断|落)|killed?|executed|died)/i],
    exclusiveGroup: "physical_outcome",
    priority: 100,
    riskLevel: "high",
    participantRoles: { source: "patient", target: "actor" }
  },

  /**
   * @param {object} params
   * @param {GameData} params.gameData
   * @param {Character} params.sourceCharacter
   */
  args: [],

  /**
   * @param {object} params
   * @param {Character} params.sourceCharacter
   */
  description: ({ sourceCharacter }) =>
    `Execute ONLY when ${sourceCharacter.shortName} (id=${sourceCharacter.id}) is the victim. The target is the killer and is already bound from the narrated action; do not change either participant.`,

  /**
   * @param {object} params
   * @param {Character} params.sourceCharacter
   * @param {GameData} params.gameData
   */
  check: ({ gameData, sourceCharacter }) => {
    const allIds = Array.from(gameData.characters.keys());
    const validTargets = allIds.filter((id) => id !== sourceCharacter.id);
    return {
      canExecute: true,
      validTargetCharacterIds: validTargets,
    };
  },

  /**
   * @param {object} params
   * @param {Character} params.sourceCharacter
   * @param {Character} params.targetCharacter
   * @param {Function} params.runGameEffect
   * @param {GameData} params.gameData
   * @param {Record<string, number|string|boolean|null>} params.args
   * @param {string} params.lang - Language code for i18n
   */
  run: ({ gameData, sourceCharacter, targetCharacter, runGameEffect, args, lang }) => {
    if (!targetCharacter) {
      return {
        message: {
          en: "Failed: No killer specified",
          ru: "Ошибка: Убийца не указан",
          fr: "Échec : Aucun meurtrier spécifié",
          de: "Fehler: Kein Mörder angegeben",
          es: "Error: No se especificó un asesino",
          ja: "失敗: 殺害者が指定されていません",
          ko: "실패: 살인자가 지정되지 않았습니다",
          pl: "Niepowodzenie: Nie określono zabójcy",
          zh: "失败: 未指定凶手"
        },
        sentiment: 'negative'
      };
    }

    // Participant binding is fixed before this action is invoked. Keep this
    // legacy variable false so a stale external isPlayerSource argument cannot
    // redirect a resolved death to the player.
    const isPlayerSource = false;

    if (isPlayerSource) {
      runGameEffect(`
root = {
    death = {
        death_reason = death_murder
        killer = global_var:votc_action_target
    }
}`);

      return {
        message: {
          en: `${gameData.playerName} was killed by ${targetCharacter.shortName}`,
          ru: `${gameData.playerName} был убит ${targetCharacter.shortName}`,
          fr: `${gameData.playerName} a été tué par ${targetCharacter.shortName}`,
          de: `${gameData.playerName} wurde von ${targetCharacter.shortName} getötet`,
          es: `${gameData.playerName} fue asesinado por ${targetCharacter.shortName}`,
          ja: `${gameData.playerName}は${targetCharacter.shortName}に殺されました`,
          ko: `${gameData.playerName}은(는) ${targetCharacter.shortName}에 의해 살해되었습니다`,
          pl: `${gameData.playerName} został zabity przez ${targetCharacter.shortName}`,
          zh: `${gameData.playerName}被${targetCharacter.shortName}杀害了`
        },
        sentiment: 'negative'
      };
    } else {
      runGameEffect(`
global_var:votc_action_source = {
    death = {
        death_reason = death_murder
        killer = global_var:votc_action_target
    }
}`);

      return {
        message: {
          en: `${sourceCharacter.shortName} was killed by ${targetCharacter.shortName}`,
          ru: `${sourceCharacter.shortName} был убит ${targetCharacter.shortName}`,
          fr: `${sourceCharacter.shortName} a été tué par ${targetCharacter.shortName}`,
          de: `${sourceCharacter.shortName} wurde von ${targetCharacter.shortName} getötet`,
          es: `${sourceCharacter.shortName} fue asesinado por ${targetCharacter.shortName}`,
          ja: `${sourceCharacter.shortName}は${targetCharacter.shortName}に殺されました`,
          ko: `${sourceCharacter.shortName}은(는) ${targetCharacter.shortName}에 의해 살해되었습니다`,
          pl: `${sourceCharacter.shortName} został zabity przez ${targetCharacter.shortName}`,
          zh: `${sourceCharacter.shortName}被${targetCharacter.shortName}杀害了`
        },
        sentiment: 'negative'
      };
    }
  },
};
