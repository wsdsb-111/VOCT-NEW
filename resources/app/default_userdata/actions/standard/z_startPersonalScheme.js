/** @import { GameData, Character } from '../../gamedata_typedefs.js' */

const SCHEMES = {
  sway: { ck3: "sway", en: "sway", zh: "拉拢" },
  befriend: { ck3: "befriend", en: "befriend", zh: "交友" },
  seduce: { ck3: "seduce", en: "seduce", zh: "勾引" },
  romance: { ck3: "courting", en: "romance", zh: "追求" }
};

const isAdult = (character) => !!character && Number.isFinite(Number(character.age)) && Number(character.age) >= 16;

module.exports = {
  signature: "startPersonalScheme",
  triggerCategories: ["scheme_start"],
  title: { en: "Start Personal Scheme", zh: "启动人物计谋" },

  args: ({ gameData, sourceCharacter }) => [
    {
      name: "scheme",
      type: "enum",
      description: "Exact non-hostile scheme explicitly being initiated: sway, befriend, seduce, or romance.",
      required: true,
      options: Object.keys(SCHEMES)
    },
    {
      name: "isPlayerSource",
      type: "boolean",
      description: `True only when ${gameData.playerName} starts the scheme; false when ${sourceCharacter.shortName} starts it.`,
      required: true
    }
  ],

  description: ({ gameData, sourceCharacter }) =>
    `Start a real non-hostile CK3 personal scheme when the candidate explicitly says ${sourceCharacter.shortName} or ${gameData.playerName} begins operational planning. A wish, hypothetical, or vague future promise is not enough. Romance/seduction schemes require both characters to be adults. Hostile schemes use startHostileScheme. CK3's native can_start_scheme trigger remains authoritative.`,

  check: ({ gameData }) => ({
    canExecute: gameData.characters.size > 1,
    requiresTarget: true,
    validTargetCharacterIds: Array.from(gameData.characters.keys())
  }),

  run: ({ gameData, sourceCharacter, targetCharacter, runGameEffect, args }) => {
    if (!targetCharacter) throw new Error("Scheme requires a target character");
    const schemeKey = typeof args?.scheme === "string" ? args.scheme : "";
    const scheme = SCHEMES[schemeKey];
    if (!scheme) throw new Error(`Unsupported scheme: ${schemeKey || "missing"}`);
    const isPlayerSource = args?.isPlayerSource === true;
    const actor = isPlayerSource ? gameData.characters.get(gameData.playerID) : sourceCharacter;
    if (!actor) throw new Error("Scheme actor does not exist");
    if (actor.id === targetCharacter.id) throw new Error("Scheme actor and target must be different characters");
    if ((schemeKey === "seduce" || schemeKey === "romance") && (!isAdult(actor) || !isAdult(targetCharacter))) {
      throw new Error("Romance and seduction schemes require adult actor and target characters");
    }

    const actorScope = isPlayerSource ? "root" : "global_var:votc_action_source";
    runGameEffect(`
${actorScope} = {
    if = {
        limit = {
            can_start_scheme = {
                type = ${scheme.ck3}
                target_character = global_var:votc_action_target
            }
        }
        start_scheme = {
            type = ${scheme.ck3}
            target_character = global_var:votc_action_target
        }
    }
}`);

    return {
      message: {
        en: `${actor.shortName} submitted a request to ${scheme.en} ${targetCharacter.shortName}; CK3 will apply its native scheme prerequisites`,
        zh: `${actor.shortName}已请求对${targetCharacter.shortName}启动“${scheme.zh}”计谋；是否成立由 CK3 原生计谋前置条件判定`
      },
      sentiment: "neutral"
    };
  }
};
