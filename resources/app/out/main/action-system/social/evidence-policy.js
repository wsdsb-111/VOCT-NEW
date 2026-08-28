"use strict";

const { REASON_CLUSTERS } = require("./social-consequence-types");

const REASON_CLUSTER_SET = new Set(REASON_CLUSTERS);
const WORLD_EVIDENCE_TYPES = new Set(["confirmed_world_event", "game_fact"]);
const MAJOR_WORLD_ACTIONS = new Set(["rescue", "rescuedCharacter", "betrayal", "isInjured", "characterIsKilled"]);
const MAJOR_WORLD_CLUSTERS = new Set(["rescue", "betrayal", "severe_harm", "family_loss"]);

const REASON_ALIASES = Object.freeze({
  polite_positive: "praise",
  trust: "friendship",
  affection_accepted: "affection",
  affection_rejected: "rejection",
  affection_rejection: "rejection",
  romantic_affection: "affection",
  physical_affection: "affection",
  intimate_contact: "affection",
  betrayal_claim: "other",
  severe_injury: "severe_harm",
  family_death: "family_loss",
  hate: "hostility",
  revenge: "hostility",
  becomeFriendsWith: "friendship",
  becomeBestFriendsWith: "friendship",
  becomeLoversWith: "romance",
  becomeSoulmatesWith: "romance",
  becomeRivalsWith: "hostility",
  becomeNemesisWith: "hostility",
  becomeBloodBrothersWith: "friendship"
});

function canonicalReasonCluster(value) {
  const normalized = String(value || "").trim();
  if (REASON_CLUSTER_SET.has(normalized)) return normalized;
  if (normalized.startsWith("observer_")) return canonicalReasonCluster(normalized.slice("observer_".length));
  return REASON_ALIASES[normalized] || "other";
}

function evidenceAuthority(evidence) {
  if (!evidence) return "missing";
  if (evidence.worldStateConfirmed === true && WORLD_EVIDENCE_TYPES.has(evidence.type)) return evidence.type === "game_fact" ? "game_fact" : "confirmed_world";
  if (evidence.type === "dialogue") return "dialogue";
  if (evidence.type === "memory") return "belief";
  if (evidence.type === "relationship_state") return "state";
  return "unconfirmed";
}

function canSupportWorldConsequence(evidence) {
  return evidenceAuthority(evidence) === "confirmed_world" || evidenceAuthority(evidence) === "game_fact";
}

function isMajorWorldEvidence(evidence) {
  if (!canSupportWorldConsequence(evidence)) return false;
  return MAJOR_WORLD_ACTIONS.has(evidence.actionId || evidence.content) || MAJOR_WORLD_CLUSTERS.has(canonicalReasonCluster(evidence.reasonCluster || evidence.content));
}

function semanticSubject(text, reasonCluster) {
  const source = String(text || "").toLocaleLowerCase();
  const subjects = [
    ["intelligence", /聪明|智慧|才智|机敏|睿智|英明|intelligen|wisdom|clever/],
    ["appearance", /美丽|漂亮|俊美|英俊|容貌|姿色|appearance|beautiful|handsome/],
    ["courage", /勇敢|勇气|胆识|英勇|courage|brave/],
    ["loyalty", /忠诚|忠心|信任|可靠|loyal|trust/],
    ["rescue", /救命|救我|救了|搭救|rescu/],
    ["help", /帮助|帮忙|相助|援助|解围|help/],
    ["family", /父亲|母亲|父母|兄弟|姐妹|孩子|家人|亲属|family/],
    ["romance", /爱|恋人|情人|亲吻|拥抱|灵魂伴侣|lover|romance|kiss/],
    ["friendship", /朋友|挚友|至交|友情|friend/],
    ["honor", /荣誉|名誉|尊严|羞辱|耻辱|honou?r|humili/],
    ["threat", /威胁|杀了你|要你命|付出代价|threat/]
  ];
  return subjects.find(([, pattern]) => pattern.test(source))?.[0] || canonicalReasonCluster(reasonCluster);
}

function cooldownTopic({ item, evidence, messageText }) {
  if (canSupportWorldConsequence(evidence) && (evidence.sourceEventId || item.sourceEventId)) {
    return `event:${evidence.sourceEventId || item.sourceEventId}`;
  }
  const cluster = canonicalReasonCluster(item.reasonCluster);
  return `${cluster}:${semanticSubject(messageText, cluster)}`;
}

function currentRelations(context, sourceId, targetId) {
  return (context.relationshipStates || []).filter((entry) => (
    Number(entry.sourceCharacterId) === Number(sourceId) && Number(entry.targetCharacterId) === Number(targetId)
  ) || (
    Number(entry.sourceCharacterId) === Number(targetId) && Number(entry.targetCharacterId) === Number(sourceId)
  )).flatMap((entry) => entry.relations || []).map((relation) => String(relation).toLocaleLowerCase());
}

function explicitRelationshipEvidence(actionId, text) {
  const source = String(text || "");
  const rules = {
    becomeFriendsWith: /(?:我们|你我|彼此).{0,12}(?:正式成为|从此(?:便|就)?是|以后(?:便|就)?是|结为).{0,6}(?:朋友|好友)/,
    becomeBestFriendsWith: /(?:我们|你我|彼此).{0,12}(?:正式成为|从此(?:便|就)?是|结为).{0,6}(?:挚友|至交|最好的朋友)/,
    becomeLoversWith: /(?:我们|你我|彼此).{0,12}(?:正式成为|从此(?:便|就)?是|愿意成为|已是).{0,6}(?:恋人|情人)|(?:我们|你我|彼此).{0,8}彼此相爱/,
    becomeSoulmatesWith: /(?:我们|你我|彼此).{0,12}(?:灵魂伴侣|命定之人|此生唯一)/,
    becomeRivalsWith: /(?:我们|你我|彼此).{0,12}(?:正式成为|从此(?:便|就)?是|结为).{0,6}(?:仇敌|敌人|宿敌)|(?:与你|和你).{0,6}(?:不共戴天|势不两立)/,
    becomeBloodBrothersWith: /(?:结拜|义结金兰|义结兄弟|结义兄弟)/
  };
  return rules[actionId]?.test(source) === true;
}

function hasEnduringHostility(text) {
  return /(?:我恨你|憎恨你|永远不会原谅|不可原谅|不共戴天|势不两立|我要报仇|定要报仇|血债血偿)/.test(String(text || ""));
}

function validateRelationshipEvidence({ item, evidence, context }) {
  const actionId = item.actionId;
  const text = context.message?.content || "";
  const relations = currentRelations(context, item.sourceCharacterId, item.targetCharacterId);
  const isFriend = relations.some((relation) => ["friend", "朋友", "ami", "freund", "친구"].includes(relation));
  const isLover = relations.some((relation) => ["lover", "情人", "恋人", "amant", "geliebte", "연인"].includes(relation));
  const isRival = relations.some((relation) => ["rival", "仇敌", "rivale", "好敵手", "경쟁자", "rywal", "соперник"].includes(relation));
  if (actionId === "becomeFriendsWith") return explicitRelationshipEvidence(actionId, text) ? { allowed: true, reason: "explicit_friendship_confirmation" } : { allowed: false, reason: "friendship_evidence_required" };
  if (actionId === "becomeBestFriendsWith") return isFriend && explicitRelationshipEvidence(actionId, text) ? { allowed: true, reason: "friendship_upgrade_confirmed" } : { allowed: false, reason: "best_friend_evidence_required" };
  if (actionId === "becomeLoversWith") return explicitRelationshipEvidence(actionId, text) ? { allowed: true, reason: "mutual_romance_confirmation" } : { allowed: false, reason: "lover_evidence_required" };
  if (actionId === "becomeSoulmatesWith") return isLover && explicitRelationshipEvidence(actionId, text) ? { allowed: true, reason: "lover_commitment_confirmed" } : { allowed: false, reason: "soulmate_evidence_required" };
  if (actionId === "becomeRivalsWith") {
    if (explicitRelationshipEvidence(actionId, text)) return { allowed: true, reason: "explicit_hostility_confirmation" };
    return isMajorWorldEvidence(evidence) && hasEnduringHostility(text) ? { allowed: true, reason: "confirmed_harm_and_enduring_hostility" } : { allowed: false, reason: "rival_evidence_required" };
  }
  if (actionId === "becomeNemesisWith") {
    const sourceEventId = evidence.sourceEventId || item.sourceEventId;
    const alreadyConsumed = !sourceEventId || (context.recentConsequences || []).some((entry) => entry.sourceEventId === sourceEventId && ["becomeRivalsWith", "becomeNemesisWith"].includes(entry.actionId));
    return isRival && isMajorWorldEvidence(evidence) && hasEnduringHostility(text) && !alreadyConsumed ? { allowed: true, reason: "rival_plus_new_confirmed_harm" } : { allowed: false, reason: alreadyConsumed ? "independent_severe_event_required" : "nemesis_evidence_required" };
  }
  if (actionId === "becomeBloodBrothersWith") return explicitRelationshipEvidence(actionId, text) ? { allowed: true, reason: "explicit_brotherhood_confirmation" } : { allowed: false, reason: "brotherhood_evidence_required" };
  return { allowed: false, reason: "unknown_relationship_action" };
}

module.exports = {
  WORLD_EVIDENCE_TYPES,
  MAJOR_WORLD_ACTIONS,
  MAJOR_WORLD_CLUSTERS,
  canonicalReasonCluster,
  evidenceAuthority,
  canSupportWorldConsequence,
  isMajorWorldEvidence,
  semanticSubject,
  cooldownTopic,
  explicitRelationshipEvidence,
  hasEnduringHostility,
  validateRelationshipEvidence
};
