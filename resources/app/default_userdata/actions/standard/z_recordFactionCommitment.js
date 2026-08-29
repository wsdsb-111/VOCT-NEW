/** @import { GameData, Character } from '../../gamedata_typedefs.js' */

const OPERATIONS = {
  join: { flag: "votc_faction_commitment_join", en: "committed to join the faction associated with", zh: "承诺加入相关派系，关联人物为" },
  leave: { flag: "votc_faction_commitment_leave", en: "committed to leave their faction", zh: "承诺退出派系" },
  support_claimant: { flag: "votc_faction_commitment_support_claimant", en: "committed to support the claimant", zh: "承诺支持宣称者" },
  oppose: { flag: "votc_faction_commitment_oppose", en: "committed to oppose the faction associated with", zh: "承诺反对相关派系，关联人物为" }
};

module.exports = {
  signature: "recordFactionCommitment",
  triggerCategories: ["faction_commitment"],
  semantic: {
    evidencePatterns: [/(?:加入|退出|离开|投入|倒向).{0,18}(?:派系|阵营)|(?:支持|拥护|反对|抵制).{0,18}(?:宣称者|宣称派系|派系|阵营)|拥立.{0,16}(?:宣称者|为王|为君)|(?:joined|left|support(?:ed)?|opposed|backed).{0,20}(?:faction|claimant)/i],
    riskLevel: "high"
  },
  title: { en: "Record Faction Commitment", zh: "记录派系承诺" },
  isDestructive: true,

  args: ({ gameData, sourceCharacter }) => [
    {
      name: "operation",
      type: "enum",
      description: "Accepted faction commitment explicitly stated now. join/support_claimant/oppose require the relevant faction leader or claimant as target; leave may omit a target.",
      required: true,
      options: Object.keys(OPERATIONS)
    },
    {
      name: "isPlayerSource",
      type: "boolean",
      description: `True only when ${gameData.playerName} makes the commitment; false when ${sourceCharacter.shortName} makes it.`,
      required: true
    }
  ],

  description: "Record an accepted political commitment to join, leave, support a claimant, or oppose a faction. Current VOTC game data has no faction ID/scope, so this action deliberately records a persistent CK3 character flag and target reference instead of falsely claiming that CK3 faction membership changed. Wishes, threats, and unaccepted proposals must not execute.",

  check: ({ gameData, sourceCharacter }) => ({
    canExecute: gameData.characters.size > 0,
    requiresTarget: false,
    validTargetCharacterIds: Array.from(gameData.characters.keys()).filter((id) => id !== sourceCharacter.id)
  }),

  run: ({ gameData, sourceCharacter, targetCharacter, runGameEffect, args }) => {
    const operationKey = typeof args?.operation === "string" ? args.operation : "";
    const operation = OPERATIONS[operationKey];
    if (!operation) throw new Error(`Unsupported faction commitment: ${operationKey || "missing"}`);
    const isPlayerSource = args?.isPlayerSource === true;
    const actor = isPlayerSource ? gameData.characters.get(gameData.playerID) : sourceCharacter;
    if (!actor) throw new Error("Faction commitment actor does not exist");
    if (operationKey !== "leave" && !targetCharacter) throw new Error(`${operationKey} requires a faction leader or claimant target`);
    if (targetCharacter && actor.id === targetCharacter.id) throw new Error("Faction commitment actor and target must be different characters");
    const actorScope = isPlayerSource ? "root" : "global_var:votc_action_source";
    const targetVariable = targetCharacter ? `
    set_variable = {
        name = votc_faction_commitment_target
        value = global_var:votc_action_target
    }` : `
    remove_variable = votc_faction_commitment_target`;
    runGameEffect(`
${actorScope} = {
    remove_character_flag = votc_faction_commitment_join
    remove_character_flag = votc_faction_commitment_leave
    remove_character_flag = votc_faction_commitment_support_claimant
    remove_character_flag = votc_faction_commitment_oppose
    add_character_flag = {
        flag = ${operation.flag}
        years = 1
    }${targetVariable}
}`);

    const targetEn = targetCharacter ? ` ${targetCharacter.shortName}` : "";
    const targetZh = targetCharacter ? `${targetCharacter.shortName}` : "";
    return {
      message: {
        en: `${actor.shortName} ${operation.en}${targetEn}; this records a commitment and does not claim CK3 faction membership changed`,
        zh: `${actor.shortName}${operation.zh}${targetZh}；当前仅记录政治承诺，不宣称 CK3 派系成员关系已改变`
      },
      sentiment: operationKey === "oppose" ? "negative" : "neutral"
    };
  }
};
