"use strict";

const { getInteractionPolicy } = require("./interaction-policy");

const PROPOSALS = [
  { actionId: "makeAlliance", category: "relationship", pattern: /(?:(?:愿意|可愿|是否愿意|愿不愿意).{0,16}(?:结盟|联盟)|(?:与我|同我|我们).{0,8}(?:结盟|缔结同盟).{0,6}(?:吗|么|可好)?)/i },
  { actionId: "agreedToTruceWith", category: "relationship", pattern: /(?:(?:愿意|可愿|是否愿意|同意).{0,16}(?:停战|休战)|(?:停战|休战).{0,8}(?:吗|么|可好))/i },
  { actionId: "becomeLoversWith", category: "relationship", pattern: /(?:(?:愿意|可愿|是否愿意|愿不愿意).{0,16}(?:成为|做|当|结为).{0,6}(?:情人|恋人)|(?:与我|同我).{0,8}(?:相恋|定情).{0,6}(?:吗|么|可好)?)/i },
  { actionId: "becomeFriendsWith", category: "relationship", pattern: /(?:(?:愿意|可愿|是否愿意|愿不愿意).{0,16}(?:成为|做|结为).{0,6}(?:朋友|好友)|(?:与我|同我).{0,8}(?:为友|成为朋友).{0,6}(?:吗|么|可好)?)/i },
  { actionId: "becomeBestFriendsWith", category: "relationship", pattern: /(?:(?:愿意|可愿|是否愿意).{0,16}(?:成为|做|结为).{0,6}(?:挚友|至交))/i },
  { actionId: "becomeSoulmatesWith", category: "relationship", pattern: /(?:(?:愿意|可愿|是否愿意).{0,16}(?:成为|做|结为).{0,6}(?:灵魂伴侣|命定之人))/i },
  { actionId: "becomeBloodBrothersWith", category: "relationship", pattern: /(?:(?:愿意|可愿|是否愿意).{0,16}(?:结拜|义结金兰|结为义兄弟)|(?:与我|同我).{0,8}(?:结拜|义结金兰).{0,6}(?:吗|么|可好)?)/i },
  { actionId: "paysGoldTo", category: "gold", pattern: /(?:(?:能否|能不能|可以|可否|愿意).{0,16}(?:给我|付我|交给我).{0,10}(?:金|金币|钱)|(?:给我|付我).{0,10}(?:金|金币|钱).{0,6}(?:吗|么|可好))/i },
  { actionId: "playerPaysGoldTo", category: "gold", pattern: /(?:(?:要我|让我|可要我).{0,12}(?:给你|付你).{0,10}(?:金|金币|钱)|(?:我给你).{0,10}(?:金|金币|钱).{0,6}(?:吗|么|可好))/i }
];

function findTarget({ speaker, characters, text }) {
  const others = (characters || []).filter((character) => Number(character.id) !== Number(speaker?.id));
  const named = others.filter((character) => [character.fullName, character.shortName].filter(Boolean).some((name) => String(text).includes(name)));
  if (named.length === 1) return named[0];
  return others.length === 1 ? others[0] : null;
}

function detect({ text, speaker, characters, registry }) {
  const match = PROPOSALS.find((entry) => entry.pattern.test(String(text || "")) && registry?.getById?.(entry.actionId)?.validation?.valid !== false && registry?.isActionDisabled?.(entry.actionId) !== true);
  if (!match) return null;
  const target = findTarget({ speaker, characters, text });
  if (!target) return null;
  const policy = getInteractionPolicy(match.actionId);
  const amountMatch = String(text || "").match(/(\d+(?:\.\d+)?)\s*(?:金|金币|钱)/);
  return {
    category: match.category,
    candidateActionIds: [match.actionId],
    initiatorId: Number(speaker.id),
    targetId: Number(target.id),
    interactionType: policy.type,
    confirmationPolicy: policy.acceptancePolicy,
    expiresAfterTurns: policy.expiresAfterTurns,
    extractedArgs: amountMatch ? { amount: Number(amountMatch[1]) } : {},
    confidence: 0.95,
    provenance: { source: "local_proposal_detector" }
  };
}

function createForAction({ actionId, text, speaker, characters, registry }) {
  const action = registry?.getById?.(actionId);
  if (!action || action.validation?.valid === false || registry?.isActionDisabled?.(actionId) === true) return null;
  const target = findTarget({ speaker, characters, text });
  if (!target) return null;
  const policy = getInteractionPolicy(actionId);
  const amountMatch = String(text || "").match(/(\d+(?:\.\d+)?)\s*(?:金|金币|钱)/);
  return {
    category: action.definition?.triggerCategories?.[0] || "other",
    candidateActionIds: [actionId],
    initiatorId: Number(speaker.id),
    targetId: Number(target.id),
    interactionType: policy.type,
    confirmationPolicy: policy.acceptancePolicy,
    expiresAfterTurns: policy.expiresAfterTurns,
    extractedArgs: amountMatch ? { amount: Number(amountMatch[1]) } : {},
    confidence: 0.95,
    provenance: { source: "precision_stage_a" }
  };
}

module.exports = { detect, createForAction, findTarget, PROPOSALS };
