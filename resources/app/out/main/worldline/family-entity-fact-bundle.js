"use strict";

const { resolveCharacterAge } = require("./character-age-service");
const { resolveCharacterSexConsensus } = require("./character-demographic-normalizer");
const { formatDeathFact, resolveLifeStatus } = require("./character-temporal-facts");

function buildFamilyEntityFactBundle({ graph = null, responderId = null, targetRuntimeId = null, temporal = {} } = {}) {
  if (!graph || responderId === null || responderId === undefined || targetRuntimeId === null || targetRuntimeId === undefined) return null;
  const targetId = String(targetRuntimeId);
  const character = graph.nodes.get(targetId);
  const relationResult = graph.relationBetween(targetId, responderId);
  if (!character || !relationResult.relation) return null;
  const sex = resolveCharacterSexConsensus({ snapshot: character });
  const life = resolveLifeStatus(character);
  const age = resolveCharacterAge(character, temporal);
  const death = formatDeathFact(character, { ...temporal, characters: graph.nodes });
  return {
    entityId: targetId,
    responderEntityId: String(responderId),
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
    sourceComplete: true
  };
}

module.exports = { buildFamilyEntityFactBundle };
