/** @import { GameData, Character } from '../../gamedata_typedefs.js' */

module.exports = {
  signature: "resolvePrisoner",
  triggerCategories: ["prisoner_resolution"],
  semantic: {
    evidencePatterns: [/(?:释放(?:了)?|放了|放出|放走|获释|恢复自由|赦免(?:了)?|解除囚禁|放逐|流放|驱逐出境|released from prison|set .{0,12} free|freed|pardoned|banished|exiled)/i],
    riskLevel: "high"
  },
  title: { en: "Release or Banish Prisoner", zh: "释放或放逐囚犯" },
  isDestructive: true,

  args: [
    {
      name: "resolution",
      type: "enum",
      description: "The explicit prisoner resolution occurring now: release or banish.",
      required: true,
      options: ["release", "banish"]
    }
  ],

  description: "Apply an explicitly completed/current release or banishment to the target character. Do not execute for a proposal, threat, hypothetical, attempted action, or future plan. CK3 remains authoritative when the target is not in a valid prisoner state.",

  check: ({ gameData, sourceCharacter }) => ({
    canExecute: gameData.characters.size > 0,
    requiresTarget: true,
    validTargetCharacterIds: Array.from(gameData.characters.keys()).filter((id) => id !== sourceCharacter.id)
  }),

  run: ({ targetCharacter, runGameEffect, args }) => {
    if (!targetCharacter) throw new Error("Prisoner resolution requires a target character");
    const resolution = typeof args?.resolution === "string" ? args.resolution : "";
    if (resolution !== "release" && resolution !== "banish") throw new Error(`Unsupported prisoner resolution: ${resolution || "missing"}`);
    runGameEffect(`
global_var:votc_action_target = {
    ${resolution === "release" ? "release_from_prison = yes" : "banish = yes"}
}`);
    return {
      message: {
        en: `${targetCharacter.shortName} was submitted for ${resolution === "release" ? "release" : "banishment"}; CK3 will enforce native prisoner prerequisites`,
        zh: `${targetCharacter.shortName}已提交“${resolution === "release" ? "释放" : "放逐"}”处置；是否生效由 CK3 原生囚犯条件判定`
      },
      sentiment: resolution === "banish" ? "negative" : "positive"
    };
  }
};
