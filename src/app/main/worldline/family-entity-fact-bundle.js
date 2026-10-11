"use strict";

const { resolveCharacterAge } = require("./character-age-service");
const { resolveCharacterSexConsensus } = require("./character-demographic-normalizer");
const { formatDeathFact, resolveLifeStatus } = require("./character-temporal-facts");

function buildFamilyEntityFactBundle({ graph = null, responderId = null, relationAnchorId = responderId, targetRuntimeId = null, relationTypes = null, temporal = {} } = {}) {
  if (!graph || responderId === null || responderId === undefined || relationAnchorId === null || relationAnchorId === undefined || targetRuntimeId === null || targetRuntimeId === undefined) return null;
  const targetId = String(targetRuntimeId);
  const character = graph.nodes.get(targetId);
  const relationResult = Array.isArray(relationTypes) && typeof graph.relationBetweenOfTypes === "function"
    ? graph.relationBetweenOfTypes(targetId, relationAnchorId, relationTypes)
    : graph.relationBetween(targetId, relationAnchorId);
  if (!character || !relationResult.relation) return null;
  const sex = resolveCharacterSexConsensus({ snapshot: character });
  const life = resolveLifeStatus(character);
  const age = resolveCharacterAge(character, temporal);
  const death = formatDeathFact(character, { ...temporal, characters: graph.nodes });
  return {
    entityId: targetId,
    responderEntityId: String(responderId),
    relationAnchorEntityId: String(relationAnchorId),
    relation: relationResult.relation.type,
    relationLabel: relationResult.relation.label,
    relationshipKind: relationResult.relation.relationshipKind || "UNSPECIFIED",
    relationPath: relationResult.relation.structuredPath,
    name: character.fullName || character.shortName || character.firstName || `#${targetId}`,
    gender: sex.sex,
    genderStatus: sex.status,
    lifeStatus: life.status,
    age: age.age,
    ageLabel: age.label,
    death: death?.fact || null,
    sourceTier: "GAME_TRUTH",
    sourceComplete: graph.scopeTruncated !== true && character.partial !== true && !relationResult.diagnostic
  };
}

module.exports = { buildFamilyEntityFactBundle };
