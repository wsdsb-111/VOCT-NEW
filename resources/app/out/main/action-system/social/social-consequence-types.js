"use strict";

const EVIDENCE_TYPES = Object.freeze([
  "dialogue",
  "confirmed_world_event",
  "memory",
  "game_fact",
  "relationship_state"
]);

const LIMITS = Object.freeze({
  directOpinion: 2,
  observerOpinion: 2,
  relationship: 1,
  memoryTokens: 256,
  recentDialogue: 4
});

const CONFIDENCE_THRESHOLDS = Object.freeze({
  opinion: 0.8,
  becomeFriendsWith: 0.88,
  becomeRivalsWith: 0.88,
  becomeBestFriendsWith: 0.92,
  becomeLoversWith: 0.92,
  becomeSoulmatesWith: 0.95,
  becomeNemesisWith: 0.95,
  becomeBloodBrothersWith: 0.92
});

const RELATIONSHIP_ACTION_IDS = Object.freeze([
  "becomeFriendsWith",
  "becomeBestFriendsWith",
  "becomeLoversWith",
  "becomeSoulmatesWith",
  "becomeRivalsWith",
  "becomeNemesisWith",
  "becomeBloodBrothersWith"
]);

function freezeArray(values) {
  return Object.freeze([...(values || [])]);
}

function createEvidence(input = {}) {
  if (!EVIDENCE_TYPES.includes(input.type)) throw new Error("invalid_evidence_type");
  return Object.freeze({
    evidenceId: String(input.evidenceId || "evidence"),
    type: input.type,
    sourceMessageId: input.sourceMessageId ?? null,
    sourceEventId: input.sourceEventId ?? null,
    actorId: input.actorId ?? null,
    targetId: input.targetId ?? null,
    content: String(input.content || ""),
    confidence: Number.isFinite(Number(input.confidence)) ? Number(input.confidence) : 1,
    worldStateConfirmed: input.worldStateConfirmed === true
  });
}

function createConsequence(input = {}) {
  const directParticipants = Object.freeze({
    actorId: input.directParticipants?.actorId ?? null,
    targetId: input.directParticipants?.targetId ?? null
  });
  return Object.freeze({
    consequenceId: String(input.consequenceId || "consequence"),
    conversationId: input.conversationId ?? null,
    turnEpoch: input.turnEpoch ?? null,
    sourceEventId: input.sourceEventId ?? null,
    evidenceText: String(input.evidenceText || ""),
    directParticipants,
    opinionChanges: freezeArray((input.opinionChanges || []).map((item) => Object.freeze({ ...item }))),
    relationshipTransition: input.relationshipTransition ? Object.freeze({ ...input.relationshipTransition }) : null,
    observerEffects: freezeArray((input.observerEffects || []).map((item) => Object.freeze({ ...item }))),
    inferenceMode: input.inferenceMode === "precision" ? "precision" : "local",
    riskLevel: ["low", "medium", "high"].includes(input.riskLevel) ? input.riskLevel : "low"
  });
}

module.exports = {
  EVIDENCE_TYPES,
  LIMITS,
  CONFIDENCE_THRESHOLDS,
  RELATIONSHIP_ACTION_IDS,
  createEvidence,
  createConsequence
};
