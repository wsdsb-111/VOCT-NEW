/** @import { GameData, Character } from '../../gamedata_typedefs.js' */

const ACTIONS = [
  "hit",
  "slash",
  "chop",
  "push",
  "kick",
  "ram",
  "stab",
  "cleave"
];

const LABELS = {
  hit: { en: "strikes", zh: "击打" },
  slash: { en: "slashes at", zh: "挥砍" },
  chop: { en: "chops at", zh: "劈砍" },
  push: { en: "pushes", zh: "推搡" },
  kick: { en: "kicks", zh: "踢向" },
  ram: { en: "rams into", zh: "撞向" },
  stab: { en: "stabs at", zh: "刺向" },
  cleave: { en: "cleaves at", zh: "斩向" }
};

module.exports = {
  signature: "performCombatAction",
  triggerCategories: ["combat"],
  title: {
    en: "Perform Combat Scene Action",
    zh: "执行战斗场景动作"
  },

  args: ({ gameData, sourceCharacter }) => [
    {
      name: "action",
      type: "enum",
      description: "The exact attack attempt described in the candidate message. This does not itself prove injury or death.",
      required: true,
      options: ACTIONS
    },
    {
      name: "weapon",
      type: "string",
      description: "Optional weapon explicitly mentioned in the candidate message, such as sword, axe, spear, fist, or shield.",
      required: false,
      minLength: 1,
      maxLength: 60
    },
    {
      name: "isPlayerSource",
      type: "boolean",
      description: `True only when ${gameData.playerName} attacks; false when ${sourceCharacter.shortName} attacks.`,
      required: true
    }
  ],

  description: ({ gameData, sourceCharacter }) =>
    `Record an immediate attack attempt by ${sourceCharacter.shortName} or ${gameData.playerName}: hit, slash, chop, push, kick, ram, stab, or cleave. This action never applies injury or death by itself. Select isInjured or characterIsKilled separately only when the exact message explicitly states that result.`,

  check: ({ gameData, sourceCharacter }) => ({
    canExecute: gameData.characters.size > 1,
    requiresTarget: true,
    // Keep both player and current NPC available because isPlayerSource decides
    // the true actor. run() rejects actor === target after that choice is known.
    validTargetCharacterIds: Array.from(gameData.characters.keys())
  }),

  run: ({ gameData, sourceCharacter, targetCharacter, args, lang = "en" }) => {
    if (!targetCharacter) throw new Error("Combat action requires a target character");
    const action = typeof args?.action === "string" ? args.action : "";
    if (!ACTIONS.includes(action)) throw new Error(`Unsupported combat action: ${action || "missing"}`);
    const actor = args?.isPlayerSource ? gameData.characters.get(gameData.playerID) : sourceCharacter;
    if (!actor) throw new Error("Combat action actor does not exist");
    if (actor.id === targetCharacter.id) throw new Error("Combat action actor and target must be different characters");
    const weapon = typeof args?.weapon === "string" ? args.weapon.trim().slice(0, 60) : "";
    const weaponEn = weapon ? ` with ${weapon}` : "";
    const weaponZh = weapon ? `，使用“${weapon}”` : "";
    const labels = LABELS[action];
    return {
      message: {
        en: `${actor.shortName} ${labels.en} ${targetCharacter.shortName}${weaponEn}; no injury result is implied`,
        zh: `${actor.shortName}${labels.zh}${targetCharacter.shortName}${weaponZh}；此动作本身不代表已经受伤`
      },
      sentiment: "negative"
    };
  }
};
