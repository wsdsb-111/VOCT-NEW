"use strict";

function memoryFactsForResponder(memoryEngine, responderId, limit = 24) {
  const store = memoryEngine?.store;
  const ownerId = Number(responderId);
  if (!store || !Number.isFinite(ownerId)) return [];
  const knowledge = store.getCharacterKnowledge?.(ownerId) || [];
  const facts = [];
  for (const entry of knowledge.slice(0, limit)) {
    const memory = store.getMemory?.(entry.memoryId);
    if (!memory) continue;
    facts.push({
      factId: `memory:${memory.memoryId}`,
      entityId: String(ownerId),
      field: "MEMORY",
      sourceTier: "PERSONAL_MEMORY",
      knowledgeLevel: memory.visibility === "private" || memory.type === "secret" ? "SECRET" : "PERSONAL_MEMORY",
      ownerId: String(ownerId),
      knownBy: [String(ownerId)],
      participantIds: (memory.participants || []).map(String),
      participationVerified: true,
      authorizationComplete: true,
      asOf: memory.eventDate || null,
      contentRef: String(memory.memoryId)
    });
  }
  return facts;
}

module.exports = { memoryFactsForResponder };
