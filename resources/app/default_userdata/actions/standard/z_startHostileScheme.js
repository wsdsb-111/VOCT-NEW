/** @import { GameData, Character } from '../../gamedata_typedefs.js' */

const SCHEMES = {
  murder: { ck3: "murder", en: "murder", zh: "谋杀" },
  abduct: { ck3: "abduct", en: "abduct", zh: "绑架" },
  fabricate_hook: { ck3: "fabricate_hook", en: "fabricate a hook on", zh: "制造把柄牵制" }
};

module.exports = {
  signature: "startHostileScheme",
  triggerCategories: ["scheme_start"],
  title: { en: "Start Hostile Scheme", zh: "启动敌对计谋" },
  isDestructive: true,

  args: ({ gameData, sourceCharacter }) => [
    {
      name: "scheme",
      type: "enum",
      description: "Exact hostile scheme explicitly being initiated: murder, abduct, or fabricate_hook.",
      required: true,
      options: Object.keys(SCHEMES)
    },
    {
      name: "isPlayerSource",
      type: "boolean",
      description: `True only when ${gameData.playerName} starts the hostile scheme; false when ${sourceCharacter.shortName} starts it.`,
      required: true
    }
  ],

  description: ({ gameData, sourceCharacter }) =>
    `Start a real hostile CK3 scheme only when the candidate explicitly says ${sourceCharacter.shortName} or ${gameData.playerName} begins operational planning to murder, abduct, or fabricate a hook on the target. A threat, wish, hypothetical, or vague future promise is not enough. CK3's native can_start_scheme trigger remains authoritative.`,

  check: ({ gameData }) => ({
    canExecute: gameData.characters.size > 1,
    requiresTarget: true,
    validTargetCharacterIds: Array.from(gameData.characters.keys())
  }),

  run: ({ gameData, sourceCharacter, targetCharacter, runGameEffect, args }) => {
    if (!targetCharacter) throw new Error("Hostile scheme requires a target character");
    const schemeKey = typeof args?.scheme === "string" ? args.scheme : "";
    const scheme = SCHEMES[schemeKey];
    if (!scheme) throw new Error(`Unsupported hostile scheme: ${schemeKey || "missing"}`);
    const isPlayerSource = args?.isPlayerSource === true;
    const actor = isPlayerSource ? gameData.characters.get(gameData.playerID) : sourceCharacter;
    if (!actor) throw new Error("Hostile scheme actor does not exist");
    if (actor.id === targetCharacter.id) throw new Error("Hostile scheme actor and target must be different characters");
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
      sentiment: "negative"
    };
  }
};
