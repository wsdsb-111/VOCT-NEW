"use strict";

const { LIMITS } = require("./social-consequence-types");
const { normalizeRelation } = require("./relationship-transition-graph");
const evidencePolicy = require("./evidence-policy");

const MAJOR_REASONS = new Set(["betrayal", "severe_harm", "family_loss"]);
const RELATION_WEIGHT = Object.freeze({
  soulmate: 0.65,
  lover: 0.65,
  best_friend: 0.65,
  blood_brother: 0.65,
  friend: 0.45,
  rival: -0.45,
  nemesis: -0.45
});

function relationBetween(context, sourceId, targetId) {
  const states = context.relationshipStates || [];
  const entries = states.filter((item) => (
    Number(item.sourceCharacterId) === Number(sourceId) && Number(item.targetCharacterId) === Number(targetId)
  ) || (
    Number(item.sourceCharacterId) === Number(targetId) && Number(item.targetCharacterId) === Number(sourceId)
  ));
  return entries.flatMap((item) => item.relations || []).map(normalizeRelation).filter(Boolean);
}

function resolve({ context, directConsequence, mode }) {
  const direct = (directConsequence?.opinionChanges || []).map((item) => ({ ...item, reasonCluster: evidencePolicy.canonicalReasonCluster(item.reasonCluster) })).find((item) => MAJOR_REASONS.has(item.reasonCluster));
  if (!direct) return [];
  const evidence = (context.confirmedWorldEvents || []).find((item) => item.evidenceId === direct.evidenceId);
  if (!evidence || evidence.worldStateConfirmed !== true) return [];
  const effects = [];
  for (const observer of context.observerParticipants || []) {
    if (effects.length >= LIMITS.observerOpinion) break;
    if (context.knowledgeMap?.[observer.id]?.[evidence.evidenceId]?.known !== true) continue;
    const relations = relationBetween(context, observer.id, direct.sourceCharacterId);
    const weighted = relations.map((relation) => RELATION_WEIGHT[relation]).filter((weight) => weight != null).sort((left, right) => Math.abs(right) - Math.abs(left))[0];
    if (weighted == null) continue;
    const delta = Math.round(direct.delta * weighted);
    if (delta === 0) continue;
    effects.push(Object.freeze({
      sourceCharacterId: observer.id,
      targetCharacterId: direct.targetCharacterId,
      delta,
      reason: `observer_${direct.reasonCluster}`,
      reasonCluster: direct.reasonCluster,
      confidence: mode === "precision" ? Math.min(0.9, direct.confidence || 0.8) : 0.9,
      evidenceId: evidence.evidenceId,
      sourceEventId: evidence.sourceEventId
    }));
  }
  return effects;
}

module.exports = { MAJOR_REASONS, resolve };
