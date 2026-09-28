module.exports = {
  signature: "becomesTributaryOf",
  title: { en: "Establish Tributary Relationship", zh: "建立朝贡关系" },
  isDestructive: true,

  args: ({ gameData }) => [
    {
      name: "direction",
      type: "enum",
      options: ["offer", "demand"],
      description: "offer: source ruler voluntarily becomes the target's tributary; demand: source ruler becomes the target's suzerain after the target accepts the demand.",
      required: true
    },
    {
      name: "isPlayerSource",
      type: "boolean",
      description: `Set true only when ${gameData.playerName} is the ruler offering or demanding tribute, rather than the current NPC.`,
      required: false
    }
  ],

  description: ({ gameData, sourceCharacter }) =>
    `Establish 朝贡 / 入贡 / 贡臣-宗主 (tributary) status only after both rulers have explicitly agreed in the current conversation. With direction=offer, ${sourceCharacter.shortName} offers to become the target's tributary; with direction=demand, ${sourceCharacter.shortName} demands that the target become their tributary and the target accepts. Set isPlayerSource=true when ${gameData.playerName} is the offering or demanding ruler. Use this instead of isVassalizedBy for tribute: it is not feudal vassalage or a one-time tribute payment. Never use for an unanswered proposal, rejected demand, hypothetical plan or past event.`,

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
    const invalid = (reason) => ({ message: { en: `Tributary action rejected: ${reason}`, zh: `朝贡动作未执行：${reason}` }, sentiment: "negative" });
    if (!args || !["offer", "demand"].includes(args.direction) || args.isPlayerSource !== undefined && typeof args.isPlayerSource !== "boolean") return invalid("invalid direction or source");
    const actor = args.isPlayerSource === true ? gameData.characters.get(gameData.playerID) : sourceCharacter;
    if (!actor || !targetCharacter || gameData.characters.get(actor.id) !== actor || gameData.characters.get(targetCharacter.id) !== targetCharacter || actor.id === targetCharacter.id) return invalid("invalid ruler binding");
    if (!actor.isLandedRuler || !actor.isIndependentRuler || !targetCharacter.isLandedRuler || !targetCharacter.isIndependentRuler) return invalid("both rulers must be independent and landed");

    const tributaryScope = args.direction === "offer" ? "global_var:votc_action_source" : "global_var:votc_action_target";
    const suzerainScope = args.direction === "offer" ? "global_var:votc_action_target" : "global_var:votc_action_source";
    runGameEffect(`
if = {
    limit = {
        ${tributaryScope} = { is_landed = yes is_independent_ruler = yes is_tributary = no }
        ${suzerainScope} = { is_landed = yes is_independent_ruler = yes can_have_tributaries_trigger = yes }
    }
    start_tributary_interaction_effect = { TRIBUTARY = ${tributaryScope} SUZERAIN = ${suzerainScope} }
    if = {
        limit = { ${tributaryScope} = { is_tributary_of = ${suzerainScope} } }
        debug_log = "VOTC:TRIBUTARY_ESTABLISHED"
    }
    else = { debug_log = "VOTC:TRIBUTARY_REJECTED" }
}
else = { debug_log = "VOTC:TRIBUTARY_REJECTED" }
`);
    const tributary = args.direction === "offer" ? actor : targetCharacter;
    const suzerain = args.direction === "offer" ? targetCharacter : actor;
    return {
      message: { en: "Tributary order submitted; awaiting CK3 relationship readback", zh: "朝贡关系指令已提交，等待 CK3 关系回读" },
      confirmedMessage: { en: `${tributary.shortName} became a tributary of ${suzerain.shortName}`, zh: `${tributary.shortName}成为${suzerain.shortName}的贡臣` },
      sentiment: "neutral",
      expectedStateChange: {
        type: "TRIBUTARY_RELATION",
        sourceRuntimeId: actor.id,
        targetRuntimeId: targetCharacter.id,
        tributaryRuntimeId: tributary.id,
        suzerainRuntimeId: suzerain.id
      }
    };
  }
};
