const contractGroups = [
  "tributary_non_permanent", "tributary_permanent", "tributary_civilized",
  "tributary_league", "tributary_patronage", "tributary_subjugated"
];
const existingGroups = [
  "tributary_settled", "tributary_nomadic", "tributary_subjugated", "tributary_steppe",
  "tributary_celestial", "tributary_hegemonic", "tributary_mandala",
  "tributary_mandala_tribal", "tributary_wanua", ...contractGroups
].filter((group, index, groups) => groups.indexOf(group) === index);
const labels = {
  tributary_non_permanent: "羁縻",
  tributary_permanent: "藩属",
  tributary_civilized: "王化",
  tributary_league: "互市",
  tributary_patronage: "供奉",
  tributary_subjugated: "附庸"
};
const suzerainEligibility = {
  tributary_civilized: "TributeSystem_suzerain_is_civilized_trigger = yes",
  tributary_league: "TributeSystem_suzerain_is_league_trigger = yes",
  tributary_patronage: "TributeSystem_suzerain_is_patronage_trigger = yes"
};

module.exports = {
  signature: "changesTributaryContract",
  title: { en: "Change Tributary Contract", zh: "变更朝贡方式" },
  isDestructive: true,

  args: ({ gameData }) => [
    {
      name: "direction",
      type: "enum",
      options: ["offer", "demand"],
      description: "offer: source is the existing tributary; demand: source is the existing suzerain. The other ruler must accept the contract change.",
      required: true
    },
    {
      name: "contractGroup",
      type: "enum",
      options: contractGroups,
      description: "Eastern Dynasties contract: tributary_non_permanent=羁縻/羁糜, tributary_permanent=藩属, tributary_civilized=王化/怀柔, tributary_league=互市/会盟, tributary_patronage=供奉, tributary_subjugated=附庸/霸主.",
      required: true
    },
    {
      name: "isPlayerSource",
      type: "boolean",
      description: `True only when ${gameData.playerName} is the ruler proposing the contract change instead of the current NPC.`,
      required: false
    }
  ],

  description: ({ gameData, sourceCharacter }) =>
    `Choose a specific Eastern Dynasties 朝贡方式 only AFTER CK3 has already established the exact tributary-suzerain relationship and both rulers have agreed to this new contract in the current conversation. ${sourceCharacter.shortName} is the proposer unless isPlayerSource=true for ${gameData.playerName}. direction=offer means the proposer is the existing 贡臣; direction=demand means the proposer is the existing 宗主. This action must never create a new tributary relationship; use becomesTributaryOf first and wait for its CK3 confirmation. Never act on a proposal alone, a refusal, a question, a hypothetical or a past event. Requires the Eastern Dynasties mod active in CK3.`,

  check: ({ gameData, sourceCharacter }) => {
    const player = gameData.characters.get(gameData.playerID);
    const npcReady = !!(sourceCharacter?.isLandedRuler && sourceCharacter.isIndependentRuler);
    const playerReady = !!(player?.isLandedRuler && player.isIndependentRuler);
    const validTargetCharacterIds = Array.from(gameData.characters.keys()).filter((id) => {
      const target = gameData.characters.get(id);
      return target?.isLandedRuler && target.isIndependentRuler &&
        (npcReady && id !== sourceCharacter.id || playerReady && id !== player.id);
    });
    return { canExecute: validTargetCharacterIds.length > 0, validTargetCharacterIds };
  },

  run: ({ gameData, sourceCharacter, targetCharacter, runGameEffect, args }) => {
    const invalid = (reason) => ({ message: { en: `Tributary contract not changed: ${reason}`, zh: `朝贡方式未变更：${reason}` }, sentiment: "negative" });
    if (!args || !["offer", "demand"].includes(args.direction) || !contractGroups.includes(args.contractGroup) ||
      args.isPlayerSource !== undefined && typeof args.isPlayerSource !== "boolean") return invalid("invalid contract or source");
    const actor = args.isPlayerSource === true ? gameData.characters.get(gameData.playerID) : sourceCharacter;
    if (!actor || !targetCharacter || gameData.characters.get(actor.id) !== actor ||
      gameData.characters.get(targetCharacter.id) !== targetCharacter || actor.id === targetCharacter.id) return invalid("invalid ruler binding");
    if (!actor.isLandedRuler || !actor.isIndependentRuler || !targetCharacter.isLandedRuler || !targetCharacter.isIndependentRuler) return invalid("both rulers must be independent and landed");

    const tributaryScope = args.direction === "offer" ? "global_var:votc_action_source" : "global_var:votc_action_target";
    const suzerainScope = args.direction === "offer" ? "global_var:votc_action_target" : "global_var:votc_action_source";
    const targetGroup = args.contractGroup;
    const cases = existingGroups.map((oldGroup) => `${oldGroup} = {
        if = {
            limit = { has_subject_contract_group = ${targetGroup} }
            debug_log = "VOTC:TRIBUTARY_CONTRACT_REJECTED"
        }
        else = {
            end_tributary = yes
            start_tributary = { contract_group = ${targetGroup} suzerain = ${suzerainScope} }
            if = {
                limit = { is_tributary_of = ${suzerainScope} has_subject_contract_group = ${targetGroup} }
                add_trait = tributary
                change_tribute_exp_effect = { EXP = 5 }
                ${suzerainScope} = {
                    add_trait = oe_suzerain
                    change_tribute_exp_effect = { EXP = 2 }
                }
                debug_log = "VOTC:TRIBUTARY_CONTRACT_CONFIRMED/${targetGroup}"
            }
            else = {
                if = { limit = { is_tributary = yes } end_tributary = yes }
                start_tributary = { contract_group = ${oldGroup} suzerain = ${suzerainScope} }
                if = {
                    limit = { is_tributary_of = ${suzerainScope} has_subject_contract_group = ${oldGroup} }
                    debug_log = "VOTC:TRIBUTARY_CONTRACT_REJECTED"
                }
                else = { debug_log = "VOTC:TRIBUTARY_CONTRACT_ROLLBACK_FAILED" }
            }
        }
    }`).join("\n");
    const knownOldGroup = existingGroups.map((group) => `has_subject_contract_group = ${group}`).join("\n            ");
    runGameEffect(`
if = {
    limit = {
        ${tributaryScope} = {
            is_landed = yes
            is_tributary_of = ${suzerainScope}
            OR = { ${knownOldGroup} }
        }
        ${suzerainScope} = { is_landed = yes ${suzerainEligibility[targetGroup] || ""} }
    }
    ${tributaryScope} = {
        switch = {
            trigger = has_subject_contract_group
            ${cases}
        }
    }
}
else = { debug_log = "VOTC:TRIBUTARY_CONTRACT_REJECTED" }
`);
    const tributary = args.direction === "offer" ? actor : targetCharacter;
    const suzerain = args.direction === "offer" ? targetCharacter : actor;
    return {
      message: { en: "Tributary contract change submitted; awaiting CK3 readback", zh: "朝贡方式变更已提交，等待 CK3 回读" },
      confirmedMessage: { en: `${tributary.shortName} is now ${labels[targetGroup]} tributary of ${suzerain.shortName}`,
        zh: `${tributary.shortName}已成为${suzerain.shortName}的${labels[targetGroup]}贡臣` },
      sentiment: "neutral",
      expectedStateChange: {
        type: "TRIBUTARY_CONTRACT",
        sourceRuntimeId: actor.id,
        targetRuntimeId: targetCharacter.id,
        tributaryRuntimeId: tributary.id,
        suzerainRuntimeId: suzerain.id,
        contractGroup: targetGroup
      }
    };
  }
};
