/** @import { GameData, Character } from '../../gamedata_typedefs.js' */

const ACTIONS = [
  "walk",
  "run",
  "take",
  "touch",
  "lift",
  "carry",
  "wear",
  "eat",
  "look"
];

const LABELS = {
  walk: { en: "walks", zh: "行走" },
  run: { en: "runs", zh: "奔跑" },
  take: { en: "takes", zh: "拿起" },
  touch: { en: "touches", zh: "触摸" },
  lift: { en: "lifts", zh: "提起" },
  carry: { en: "carries", zh: "携带" },
  wear: { en: "puts on", zh: "穿戴" },
  eat: { en: "eats", zh: "食用" },
  look: { en: "looks at", zh: "查看" }
};

module.exports = {
  signature: "performDailyAction",
  triggerCategories: ["daily_movement", "daily_object_interaction"],
  title: {
    en: "Perform Daily Scene Action",
    zh: "执行日常场景动作"
  },

  args: ({ gameData, sourceCharacter }) => [
    {
      name: "action",
      type: "enum",
      description: "The exact completed/current daily action in the candidate message.",
      required: true,
      options: ACTIONS
    },
    {
      name: "object",
      type: "string",
      description: "Optional short object, food, clothing, direction, or thing being observed. Use only words supported by the candidate message.",
      required: false,
      minLength: 1,
      maxLength: 80
    },
    {
      name: "isPlayerSource",
      type: "boolean",
      description: `True only when ${gameData.playerName} performs the action; false when ${sourceCharacter.shortName} performs it.`,
      required: true
    }
  ],

  description: ({ gameData, sourceCharacter }) =>
    `Record a concrete daily scene action performed now by ${sourceCharacter.shortName} or ${gameData.playerName}: walking, running, taking, touching, lifting/carrying an object, dressing, eating, or looking. This is an RP scene action and must not invent an item transfer, injury, location change, or other CK3 state change.`,

  check: ({ gameData }) => ({
    canExecute: true,
    requiresTarget: false,
    validTargetCharacterIds: Array.from(gameData.characters.keys())
  }),

  run: ({ gameData, sourceCharacter, targetCharacter, args, lang = "en" }) => {
    const action = typeof args?.action === "string" ? args.action : "";
    if (!ACTIONS.includes(action)) throw new Error(`Unsupported daily action: ${action || "missing"}`);
    const actor = args?.isPlayerSource ? gameData.characters.get(gameData.playerID) : sourceCharacter;
    if (!actor) throw new Error("Daily action actor does not exist");
    const object = typeof args?.object === "string" ? args.object.trim().slice(0, 80) : "";
    const targetTextEn = targetCharacter ? ` ${targetCharacter.shortName}` : object ? ` ${object}` : "";
    const targetTextZh = targetCharacter ? `“${targetCharacter.shortName}”` : object ? `“${object}”` : "";
    const labels = LABELS[action];
    return {
      message: {
        en: `${actor.shortName} ${labels.en}${targetTextEn}`,
        zh: `${actor.shortName}${labels.zh}${targetTextZh}`
      },
      sentiment: "neutral"
    };
  }
};
