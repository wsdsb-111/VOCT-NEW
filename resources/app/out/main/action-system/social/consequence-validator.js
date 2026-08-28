"use strict";

const { createConsequence, LIMITS, CONFIDENCE_THRESHOLDS, RELATIONSHIP_ACTION_IDS } = require("./social-consequence-types");
const relationshipTransitionGraph = require("./relationship-transition-graph");

const CONFIRMED_REASONS = new Set(["rescue", "betrayal", "severe_injury", "family_death"]);

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
    return false;
  }
  if (!Number.isInteger(item.delta) || item.delta === 0 || item.delta < -10 || item.delta > 10) {
    rejected.push({ item, reason: "invalid_opinion_delta" });
    return false;
  }
  if (Number(item.confidence) < CONFIDENCE_THRESHOLDS.opinion) {
    rejected.push({ item, reason: "low_confidence" });
    return false;
  }
  const evidence = evidenceById(context, item.evidenceId);
  if (!evidence || !isKnown(context, sourceId, item.evidenceId)) {
    rejected.push({ item, reason: "unknown_evidence" });
    return false;
  }
  if (CONFIRMED_REASONS.has(item.reasonCluster) && evidence.worldStateConfirmed !== true) {
    rejected.push({ item, reason: "unconfirmed_world_event" });
    return false;
  }
  return true;
}

function characterForGraph(id, context, participants) {
  const participant = participants.get(Number(id));
  const relationsToCharacters = (context.relationshipStates || []).filter((item) => Number(item.sourceCharacterId) === Number(id)).map((item) => ({ id: Number(item.targetCharacterId), relations: [...(item.relations || [])] }));
  return { ...participant, relationsToCharacters };
}

function validateRelationship(item, context, participants, rejected) {
  if (!RELATIONSHIP_ACTION_IDS.includes(item?.actionId)) {
    rejected.push({ item, reason: "unknown_relationship_action" });
    return false;
  }
  const sourceId = Number(item.sourceCharacterId);
  const targetId = Number(item.targetCharacterId);
  if (!participants.has(sourceId) || !participants.has(targetId) || sourceId === targetId) {
    rejected.push({ item, reason: "invalid_participants" });
    return false;
  }
  if (Number(item.confidence) < CONFIDENCE_THRESHOLDS[item.actionId]) {
    rejected.push({ item, reason: "low_confidence" });
    return false;
  }
  if (!item.evidenceId || !evidenceById(context, item.evidenceId) || !isKnown(context, sourceId, item.evidenceId)) {
    rejected.push({ item, reason: "unknown_evidence" });
    return false;
  }
  const transition = relationshipTransitionGraph.canTransition({
    actionId: item.actionId,
    sourceCharacter: characterForGraph(sourceId, context, participants),
    targetCharacter: characterForGraph(targetId, context, participants)
  });
  if (!transition.allowed) {
    rejected.push({ item, reason: transition.reason });
    return false;
  }
  return true;
}

function validate({ consequence, context }) {
  const rejected = [];
  const participants = participantsById(context);
  const opinionChanges = (consequence?.opinionChanges || []).filter((item) => validateOpinion(item, context, participants, rejected)).slice(0, LIMITS.directOpinion);
  const observerEffects = (consequence?.observerEffects || []).filter((item) => validateOpinion(item, context, participants, rejected)).slice(0, LIMITS.observerOpinion);
  const relationshipTransition = consequence?.relationshipTransition && validateRelationship(consequence.relationshipTransition, context, participants, rejected)
    ? consequence.relationshipTransition
    : null;
  const validated = createConsequence({ ...consequence, opinionChanges, observerEffects, relationshipTransition });
  return {
    valid: opinionChanges.length > 0 || observerEffects.length > 0 || relationshipTransition != null,
    consequence: validated,
    rejected
  };
}

module.exports = { validate };
