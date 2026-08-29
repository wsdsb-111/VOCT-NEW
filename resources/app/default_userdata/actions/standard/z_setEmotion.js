/** @import { GameData, Character } from '../../gamedata_typedefs.js' */
module.exports = {
  signature: "setEmotion",
  actionMetadata: { executionMode: "immediate", idempotent: true, targetPolicy: "self_or_other" },
  triggerCategories: ["drinking_or_toast", "visible_pose"],
  semantic: {
    match: ({ event, evidence }) => event.category === "visible_pose"
      ? /(?:微笑|笑了|轻笑|失笑|大笑|哭泣|流泪|抽泣|哽咽|怒视|怒目而视|瞪着|惊呆|跪下祈祷|祈祷|诵经|读书|翻书|写字|执笔|伏案(?:书写|写字)|偷听|侧耳倾听|争辩|争论|讲故事|跳舞|起舞|翩翩起舞|翻白眼|后退|举杖|手持权杖)/.test(evidence.text)
      : event.category === "drinking_or_toast" && /(?:饮酒|喝酒|饮茶|喝茶|小酌|痛饮|畅饮|一饮而尽|饮尽|饮罢|举杯|敬酒|碰杯|祝酒)/.test(evidence.text),
    participantRoles: { source: "actor", target: "patient" },
    poseSubject: true,
    deterministicInvocation: true,
    riskLevel: "low"
  },
  title: {
    en: "Set Target Emotion",
    ru: "Установить эмоцию цели",
    fr: "Définir l'émotion de la cible",
    de: "Ziel-Emotion festlegen",
    es: "Establecer emoción del objetivo",
    ja: "ターゲットの感情を設定",
    ko: "대상 감정 설정",
    pl: "Ustaw emocję celu",
    zh: "设置角色表情"
  },

  /**
   * @param {object} params
   * @param {Character} params.sourceCharacter
   */
  args: ({ sourceCharacter }) => [
    {
      name: "emotion",
      type: "enum",
      description: `Emotion to set for the target character (talk pose). Options: idle, sad, sadness, happy, happiness, love, admiration, pain, worry, speaking, anger, rage, fear, shock, stunned, disgust, disbelief, disapproval, dismissal, disappointed, beg, boredom, grief, crying, laugh, ecstasy, flirtation, interested, paranoia, scheme, schadenfreude, shame, stress, wailing, manic, eccentric, delirium, thinking, reading, writing, pageflipping, drinking, toast, praying, eavesdrop, debating, storyteller, dancing, eyeroll, betting, bribing, physician, survey, holdingstaff, scepter, lantern, stayback, heroflex`,
      required: true,
      options: [ "idle", "sad", "sadness", "happy", "happiness", "love", "admiration", "pain", "worry", "speaking", "anger", "rage", "fear", "shock", "stunned", "disgust", "disbelief", "disapproval", "dismissal", "disappointed", "beg", "boredom", "grief", "crying", "laugh", "ecstasy", "flirtation", "interested", "paranoia", "scheme", "schadenfreude", "shame", "stress", "wailing", "manic", "eccentric", "delirium", "thinking", "reading", "writing", "pageflipping", "drinking", "toast", "praying", "eavesdrop", "debating", "storyteller", "dancing", "eyeroll", "betting", "bribing", "physician", "survey", "holdingstaff", "scepter", "lantern", "stayback", "heroflex" ]
    }
  ],

  /**
   * @param {object} params
   * @param {Character} params.sourceCharacter
   */
  description: ({ sourceCharacter }) =>
    `Set an emotion (talk_pose) for a chosen target character. Only affects the target. Target may be source character.`,

  /**
   * Only target-based: allow choosing any character as target
   * @param {object} params
   * @param {GameData} params.gameData
   * @param {Character} params.sourceCharacter
   */
  check: ({ gameData, sourceCharacter }) => {
    const allIds = Array.from(gameData.characters.keys());
    // const validTargets = allIds.filter((id) => id !== gameData.playerID);
    return {
      canExecute: true,
      validTargetCharacterIds: allIds,
    };
  },

  /**
   * Execute by setting a simple variable on the target scope:
   * global_var:votc_action_target = {
   *   set_variable = { name = talk_pose value = flag:<emotion> }
   * }
   *
   * @param {object} params
   * @param {GameData} params.gameData
   * @param {Character} params.sourceCharacter
   * @param {Character} params.targetCharacter
   * @param {Function} params.runGameEffect
   * @param {Record<string, number|string|null>} params.args
   */
  run: ({ gameData, sourceCharacter, targetCharacter, runGameEffect, args }) => {
    if (!targetCharacter) return;

    const allowed = new Set([ "idle", "sad", "sadness", "happy", "happiness", "love", "admiration", "pain", "worry", "speaking", "anger", "rage", "fear", "shock", "stunned", "disgust", "disbelief", "disapproval", "dismissal", "disappointed", "beg", "boredom", "grief", "crying", "laugh", "ecstasy", "flirtation", "interested", "paranoia", "scheme", "schadenfreude", "shame", "stress", "wailing", "manic", "eccentric", "delirium", "thinking", "reading", "writing", "pageflipping", "drinking", "toast", "praying", "eavesdrop", "debating", "storyteller", "dancing", "eyeroll", "betting", "bribing", "physician", "survey", "holdingstaff", "scepter", "lantern", "stayback", "heroflex" ]);
    const raw = typeof args?.emotion === "string" ? args.emotion.toLowerCase().trim() : "";
    const emotion = allowed.has(raw) ? raw : "idle";

    runGameEffect(`
global_var:votc_action_target = {
    set_variable = {
        name = talk_pose
        value = flag:${emotion}
    }
}`);
  },
};
