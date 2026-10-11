"use strict";

function buildPresenceObservationFacts({ responderId, presentCharacterIds = [], characters, asOf = null } = {}) {
  const responder = responderId === null || responderId === undefined ? null : String(responderId);
  if (!responder || !(characters instanceof Map)) return [];
  const present = [...new Set((Array.isArray(presentCharacterIds) ? presentCharacterIds : []).map((id) => String(id)).filter(Boolean))];
  if (!present.includes(responder)) return [];
  return present.filter((characterId) => characterId !== responder).flatMap((characterId) => {
    const character = characters.get(Number(characterId)) || characters.get(characterId);
    const name = String(character?.shortName || character?.firstName || character?.fullName || "").trim();
    if (!name) return [];
    return [{
      factId: `presence:${responder}:${characterId}`,
      entityId: characterId,
      field: "PRESENCE",
      value: `${name}目前正在本次对话场景中。`,
      sourceTier: "GAME_TRUTH",
      knowledgeLevel: "DIRECT_OBSERVATION",
      directObserverIds: [responder],
      observationEvidenceComplete: true,
      temporalSafe: true,
      asOf
    }];
  });
}

module.exports = { buildPresenceObservationFacts };
