/** @import { GameData, Character } from '../../gamedata_typedefs.js' */

const ACTIONS = [
  "caress",
  "lick",
  "kiss",
  "tease",
  "suck",
  "penetrate",
  "insert",
  "thrust",
  "grind",
  "rub"
];

const LABELS = {
  caress: { en: "caresses", zh: "抚摸" },
  lick: { en: "licks", zh: "舔舐" },
  kiss: { en: "kisses", zh: "亲吻" },
  tease: { en: "teases", zh: "挑逗" },
  suck: { en: "sucks", zh: "吮吸" },
  penetrate: { en: "penetrates", zh: "顶入" },
  insert: { en: "inserts into", zh: "插入" },
  thrust: { en: "thrusts against", zh: "挺动" },
  grind: { en: "grinds against", zh: "研磨" },
  rub: { en: "rubs against", zh: "摩擦" }
};

const isAdult = (character) => !!character && Number.isFinite(Number(character.age)) && Number(character.age) >= 16;

module.exports = {
  signature: "performIntimateAction",
  triggerCategories: ["intimate_contact"],
  semantic: {
    evidencePatterns: [/.+/],
    riskLevel: "low"
  },
  title: {
    en: "Perform Intimate Scene Action",
    zh: "执行亲密场景动作"
  },

  args: ({ gameData, sourceCharacter }) => [
    {
      name: "action",
      type: "enum",
      description: "The exact intimate contact explicitly occurring in the candidate message. It does not by itself mean intercourse is completed.",
      required: true,
      options: ACTIONS
    },
    {
      name: "detail",
      type: "string",
      description: "Optional brief body-area or manner detail explicitly present in the candidate message. Do not invent details.",
      required: false,
      minLength: 1,
      maxLength: 80
    },
    {
      name: "isPlayerSource",
      type: "boolean",
      description: `True only when adult player ${gameData.playerName} performs the contact; false when adult NPC ${sourceCharacter.shortName} performs it.`,
      required: true
    }
  ],

  description: ({ gameData, sourceCharacter }) =>
    `Record explicit intimate contact between adult characters involving ${sourceCharacter.shortName} or ${gameData.playerName}: caress, lick, kiss, tease, suck, penetrate, insert, thrust, grind, or rub. This is a scene action only. Never infer completed intercourse, pregnancy, injury, consent, or relationship changes from it.`,

  check: ({ gameData, sourceCharacter }) => {
    const player = gameData.characters.get(gameData.playerID);
    // isPlayerSource decides the true actor after selection, so retain every
    // adult in the target enum and reject actor === target inside run().
    const validTargets = Array.from(gameData.characters.values()).filter((character) => isAdult(character)).map((character) => character.id);
    return {
      canExecute: (isAdult(sourceCharacter) || isAdult(player)) && validTargets.length > 0,
      reason: "Intimate scene actions require adult actor and target characters",
      requiresTarget: true,
      validTargetCharacterIds: validTargets
    };
  },

  run: ({ gameData, sourceCharacter, targetCharacter, args, lang = "en" }) => {
    if (!targetCharacter) throw new Error("Intimate action requires a target character");
    const action = typeof args?.action === "string" ? args.action : "";
    if (!ACTIONS.includes(action)) throw new Error(`Unsupported intimate action: ${action || "missing"}`);
    const actor = args?.isPlayerSource ? gameData.characters.get(gameData.playerID) : sourceCharacter;
    if (!isAdult(actor) || !isAdult(targetCharacter)) throw new Error("Intimate action requires adult actor and target characters");
    if (actor.id === targetCharacter.id) throw new Error("Intimate action actor and target must be different characters");
    const detail = typeof args?.detail === "string" ? args.detail.trim().slice(0, 80) : "";
    const detailEn = detail ? ` (${detail})` : "";
    const detailZh = detail ? `（${detail}）` : "";
    const labels = LABELS[action];
    return {
      message: {
        en: `${actor.shortName} ${labels.en} ${targetCharacter.shortName}${detailEn}; completed intercourse is not implied`,
        zh: `${actor.shortName}${labels.zh}${targetCharacter.shortName}${detailZh}；此动作本身不代表性交已经完成`
      },
      sentiment: "neutral"
    };
  }
};
