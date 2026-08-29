/** @import { GameData, Character } from '../../gamedata_typedefs.js' */

const STATUSES = {
  drunk: { pose: "drinking", days: 1, en: "drunk", zh: "醉酒" },
  angry: { pose: "rage", days: 7, en: "enraged", zh: "暴怒" },
  insulted: { pose: "disapproval", days: 14, en: "insulted", zh: "受辱" },
  humiliated: { pose: "shame", days: 14, en: "humiliated", zh: "蒙羞" },
  grateful: { pose: "admiration", days: 30, en: "grateful", zh: "感激" },
  frightened: { pose: "fear", days: 7, en: "frightened", zh: "惊恐" },
  suspicious: { pose: "paranoia", days: 30, en: "suspicious", zh: "疑心" },
  affectionate: { pose: "love", days: 30, en: "affectionate", zh: "亲爱" },
  exhausted: { pose: "pain", days: 1, en: "exhausted", zh: "疲惫" }
};

module.exports = {
  signature: "setRoleplayStatus",
  triggerCategories: ["rp_status"],
  semantic: {
    evidencePatterns: [/.+/],
    riskLevel: "low"
  },
  title: { en: "Set Roleplay Status", zh: "设置 RP 状态" },

  args: [
    {
      name: "status",
      type: "enum",
      description: "The explicit current RP status of the target. Do not infer it from ordinary mood or dialogue tone.",
      required: true,
      options: Object.keys(STATUSES)
    }
  ],

  description: "Record a clearly stated temporary RP state on the exact target: drunk, angry, insulted, humiliated, grateful, frightened, suspicious, affectionate, or exhausted. This stores a CK3 character flag and updates the talk pose; it does not alter health, traits, relationships, or opinion.",

  check: ({ gameData, sourceCharacter }) => ({
    canExecute: gameData.characters.size > 0,
    requiresTarget: true,
    validTargetCharacterIds: Array.from(gameData.characters.keys()).filter((id) => id !== sourceCharacter.id)
  }),

  run: ({ targetCharacter, runGameEffect, args }) => {
    if (!targetCharacter) throw new Error("RP status requires a target character");
    const statusKey = typeof args?.status === "string" ? args.status : "";
    const status = STATUSES[statusKey];
    if (!status) throw new Error(`Unsupported RP status: ${statusKey || "missing"}`);

    runGameEffect(`
global_var:votc_action_target = {
    add_character_flag = {
        flag = votc_rp_status_${statusKey}
        days = ${status.days}
    }
    set_variable = {
        name = talk_pose
        value = flag:${status.pose}
    }
}`);

    if (Array.isArray(targetCharacter.traits)) {
      targetCharacter.traits = targetCharacter.traits.filter((trait) => trait.category !== "votc_rp_status");
      targetCharacter.traits.push({ category: "votc_rp_status", name: `RP: ${status.zh}`, desc: `Temporary roleplay state: ${status.en}` });
    }
    return {
      message: {
        en: `${targetCharacter.shortName} is now recorded as ${status.en}`,
        zh: `${targetCharacter.shortName}当前被记录为“${status.zh}”状态`
      },
      sentiment: ["angry", "insulted", "humiliated", "frightened", "exhausted"].includes(statusKey) ? "negative" : "neutral"
    };
  }
};
