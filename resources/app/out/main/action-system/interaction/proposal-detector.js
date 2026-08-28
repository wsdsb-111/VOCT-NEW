"use strict";

const { getInteractionPolicy } = require("./interaction-policy");
const { MONEY_UNIT_PATTERN, MONEY_TRANSFER_VERB_PATTERN } = require("../money-lexicon");
const moneyAmountResolver = require("../money-amount-resolver");

function isMoneyProposal(text, directionPattern) {
  const source = String(text || "");
  MONEY_UNIT_PATTERN.lastIndex = 0;
  MONEY_TRANSFER_VERB_PATTERN.lastIndex = 0;
  return MONEY_UNIT_PATTERN.test(source) && MONEY_TRANSFER_VERB_PATTERN.test(source) && directionPattern.test(source) && /(?:[？?]|吗|么|可好|能否|能不能|可以|可否|愿意|要不要)/.test(source);
}

const PROPOSALS = [
  { actionId: "makeAlliance", category: "relationship", pattern: /(?:(?:愿意|可愿|是否愿意|愿不愿意).{0,16}(?:结盟|联盟)|(?:与我|同我|我们).{0,8}(?:结盟|缔结同盟).{0,6}(?:吗|么|可好)?|(?:提议|提倡|希望).{0,16}(?:建立|缔结|结成).{0,8}(?:军事)?(?:盟约|同盟|联盟))/i },
  { actionId: "agreedToTruceWith", category: "relationship", pattern: /(?:(?:愿意|可愿|是否愿意|同意).{0,16}(?:停战|休战)|(?:停战|休战).{0,8}(?:吗|么|可好))/i },
  { actionId: "becomeLoversWith", category: "relationship", pattern: /(?:(?:愿意|可愿|是否愿意|愿不愿意).{0,16}(?:成为|做|当|结为).{0,6}(?:情人|恋人)|(?:与我|同我).{0,8}(?:相恋|定情).{0,6}(?:吗|么|可好)?)/i },
  { actionId: "becomeFriendsWith", category: "relationship", pattern: /(?:(?:愿意|可愿|是否愿意|愿不愿意).{0,16}(?:成为|做|结为).{0,6}(?:朋友|好友)|(?:与我|同我).{0,8}(?:为友|成为朋友).{0,6}(?:吗|么|可好)?)/i },
  { actionId: "becomeBestFriendsWith", category: "relationship", pattern: /(?:(?:愿意|可愿|是否愿意).{0,16}(?:成为|做|结为).{0,6}(?:挚友|至交))/i },
  { actionId: "becomeSoulmatesWith", category: "relationship", pattern: /(?:(?:愿意|可愿|是否愿意).{0,16}(?:成为|做|结为).{0,6}(?:灵魂伴侣|命定之人))/i },
  { actionId: "becomeBloodBrothersWith", category: "relationship", pattern: /(?:(?:愿意|可愿|是否愿意).{0,16}(?:结拜|义结金兰|结为义兄弟)|(?:与我|同我).{0,8}(?:结拜|义结金兰).{0,6}(?:吗|么|可好)?)/i },
  { actionId: "paysGoldTo", category: "gold", match: (text) => isMoneyProposal(text, /(?:给我|付我|交给我)/i) },
  { actionId: "playerPaysGoldTo", category: "gold", match: (text) => isMoneyProposal(text, /(?:我.{0,8}(?:给|付|交给|递给).{0,6}(?:你|您)|(?:要我|让我|可要我).{0,12}(?:给你|付你))/i) }
];
const SOCIAL_PROPOSAL = { category: "social_affection", pattern: /(?:(?:我可以|能否|可否|让我|请让我).{0,8}(?:亲吻|吻|拥抱|抱抱|牵手)|(?:愿意|可愿).{0,8}(?:让我|与我).{0,8}(?:亲吻|拥抱|牵手))/i };

function findTarget({ speaker, characters, text }) {
  const others = (characters || []).filter((character) => Number(character.id) !== Number(speaker?.id));
  const named = others.filter((character) => [character.fullName, character.shortName].filter(Boolean).some((name) => String(text).includes(name)));
  if (named.length === 1) return named[0];
  return others.length === 1 ? others[0] : null;
}

function detect({ text, speaker, characters, registry }) {
  const match = PROPOSALS.find((entry) => (entry.match ? entry.match(text) : entry.pattern.test(String(text || ""))) && registry?.getById?.(entry.actionId)?.validation?.valid !== false && registry?.isActionDisabled?.(entry.actionId) !== true);
  const socialOnly = !match && SOCIAL_PROPOSAL.pattern.test(String(text || ""));
  if (!match && !socialOnly) return null;
  const target = findTarget({ speaker, characters, text });
  if (!target) return null;
  if (socialOnly) {
    return {
      category: SOCIAL_PROPOSAL.category,
      candidateActionIds: [],
      initiatorId: Number(speaker.id),
      targetId: Number(target.id),
      interactionType: "requested_social_interaction",
      confirmationPolicy: "explicit_execution_required",
      expiresAfterTurns: 2,
      extractedArgs: {},
      confidence: 0.95,
      provenance: { source: "local_social_proposal_detector" }
    };
  }
  const policy = getInteractionPolicy(match.actionId);
  const amountResolution = moneyAmountResolver.resolve(text);
  return {
    category: match.category,
    candidateActionIds: [match.actionId],
    initiatorId: Number(speaker.id),
    targetId: Number(target.id),
    interactionType: policy.type,
    confirmationPolicy: policy.acceptancePolicy,
    expiresAfterTurns: policy.expiresAfterTurns,
    extractedArgs: amountResolution.resolved ? { amount: amountResolution.normalizedAmount } : {},
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
  const amountResolution = moneyAmountResolver.resolve(text);
  return {
    category: action.definition?.triggerCategories?.[0] || "other",
    candidateActionIds: [actionId],
    initiatorId: Number(speaker.id),
    targetId: Number(target.id),
    interactionType: policy.type,
    confirmationPolicy: policy.acceptancePolicy,
    expiresAfterTurns: policy.expiresAfterTurns,
    extractedArgs: amountResolution.resolved ? { amount: amountResolution.normalizedAmount } : {},
    confidence: 0.95,
    provenance: { source: "precision_stage_a" }
  };
}

module.exports = { detect, createForAction, findTarget, PROPOSALS };
