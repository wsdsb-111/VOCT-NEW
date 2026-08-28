"use strict";

const { createConsequence, LIMITS, CONFIDENCE_THRESHOLDS, RELATIONSHIP_ACTION_IDS } = require("./social-consequence-types");
const relationshipTransitionGraph = require("./relationship-transition-graph");
const evidencePolicy = require("./evidence-policy");

function participantsById(context) {
  return new Map([...(context.directParticipants || []), ...(context.observerParticipants || [])].map((item) => [Number(item.id), item]));
}

function evidenceById(context, evidenceId) {
  return [...(context.dialogueEvidence || []), ...(context.confirmedWorldEvents || []), ...(context.memoryEvidence || []), ...(context.gameFacts || [])].find((item) => item.evidenceId === evidenceId);
}

function isKnown(context, characterId, evidenceId) {
  return context.knowledgeMap?.[characterId]?.[evidenceId]?.known === true;
}

function validateOpinion(item, context, participants, rejected) {
  const sourceId = Number(item.sourceCharacterId);
  const targetId = Number(item.targetCharacterId);
  if (!participants.has(sourceId) || !participants.has(targetId) || sourceId === targetId) {
    rejected.push({ item, reason: "invalid_participants" });
    return null;
  }
  if (!Number.isInteger(item.delta) || item.delta === 0 || item.delta < -10 || item.delta > 10) {
    rejected.push({ item, reason: "invalid_opinion_delta" });
    return null;
  }
  if (Number(item.confidence) < CONFIDENCE_THRESHOLDS.opinion) {
    rejected.push({ item, reason: "low_confidence" });
    return null;
  }
  const evidence = evidenceById(context, item.evidenceId);
  if (!evidence || !isKnown(context, sourceId, item.evidenceId)) {
    rejected.push({ item, reason: "unknown_evidence" });
    return null;
  }
  const reasonCluster = evidencePolicy.canonicalReasonCluster(item.reasonCluster);
  const requiresWorldAuthority = evidencePolicy.MAJOR_WORLD_CLUSTERS.has(reasonCluster) || Math.abs(Number(item.delta)) >= 5;
  if (requiresWorldAuthority && !evidencePolicy.canSupportWorldConsequence(evidence)) {
    rejected.push({ item, reason: "world_authority_required" });
    return null;
  }
  return {
    ...item,
    reasonCluster,
    evidenceAuthority: evidencePolicy.evidenceAuthority(evidence),
    normalizedTopic: evidencePolicy.cooldownTopic({ item: { ...item, reasonCluster }, evidence, messageText: context.message?.content })
  };
}

function characterForGraph(id, context, participants) {
  const participant = participants.get(Number(id));
  const relationsToCharacters = (context.relationshipStates || []).filter((item) => Number(item.sourceCharacterId) === Number(id)).map((item) => ({ id: Number(item.targetCharacterId), relations: [...(item.relations || [])] }));
  return { ...participant, relationsToCharacters };
}

function validateRelationship(item, context, participants, rejected) {
  if (!RELATIONSHIP_ACTION_IDS.includes(item?.actionId)) {
    rejected.push({ item, reason: "unknown_relationship_action" });
    return null;
  }
  const sourceId = Number(item.sourceCharacterId);
  const targetId = Number(item.targetCharacterId);
  if (!participants.has(sourceId) || !participants.has(targetId) || sourceId === targetId) {
    rejected.push({ item, reason: "invalid_participants" });
    return null;
  }
  const directIds = new Set((context.directParticipants || []).map((participant) => Number(participant.id)));
  if (!directIds.has(sourceId) || !directIds.has(targetId)) {
    rejected.push({ item, reason: "relationship_requires_direct_participants" });
    return null;
  }
  if (Number(item.confidence) < CONFIDENCE_THRESHOLDS[item.actionId]) {
    rejected.push({ item, reason: "low_confidence" });
    return null;
  }
  const evidence = item.evidenceId ? evidenceById(context, item.evidenceId) : null;
  if (!evidence || !isKnown(context, sourceId, item.evidenceId)) {
    rejected.push({ item, reason: "unknown_evidence" });
    return null;
  }
  const evidenceDecision = evidencePolicy.validateRelationshipEvidence({ item, evidence, context });
  if (!evidenceDecision.allowed) {
    rejected.push({ item, reason: evidenceDecision.reason });
    return null;
  }
  const transition = relationshipTransitionGraph.canTransition({
    actionId: item.actionId,
    sourceCharacter: characterForGraph(sourceId, context, participants),
    targetCharacter: characterForGraph(targetId, context, participants)
  });
  if (!transition.allowed) {
    rejected.push({ item, reason: transition.reason });
    return null;
  }
  const reasonCluster = evidencePolicy.canonicalReasonCluster(item.reasonCluster || item.actionId);
  return {
    ...item,
    reasonCluster,
    evidenceAuthority: evidencePolicy.evidenceAuthority(evidence),
    evidencePolicyReason: evidenceDecision.reason,
    normalizedTopic: evidencePolicy.cooldownTopic({ item: { ...item, reasonCluster }, evidence, messageText: context.message?.content })
  };
}

function validate({ consequence, context }) {
  const rejected = [];
  const participants = participantsById(context);
  const opinionChanges = (consequence?.opinionChanges || []).map((item) => validateOpinion(item, context, participants, rejected)).filter(Boolean).slice(0, LIMITS.directOpinion);
  const observerEffects = (consequence?.observerEffects || []).map((item) => validateOpinion(item, context, participants, rejected)).filter(Boolean).slice(0, LIMITS.observerOpinion);
  const relationshipTransition = consequence?.relationshipTransition ? validateRelationship(consequence.relationshipTransition, context, participants, rejected) : null;
  const validated = createConsequence({ ...consequence, opinionChanges, observerEffects, relationshipTransition });
  return {
    valid: opinionChanges.length > 0 || observerEffects.length > 0 || relationshipTransition != null,
    consequence: validated,
    rejected
  };
}

module.exports = { validate };
