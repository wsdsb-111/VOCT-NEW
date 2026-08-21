"use strict";

class MemoryConsolidator {
  constructor({ store, threshold = 100, trace = null } = {}) {
    this.store = store;
    this.threshold = threshold;
    this.trace = trace;
  }

  consolidateCharacter(characterId, memories = null) {
    const source = memories || this.store.queryMemories({ characterId, includeLegacy: false });
    if (source.length <= this.threshold) return null;
    const criticalMemoryIds = source.filter((memory) => memory.importance >= 0.9).map((memory) => memory.memoryId);
    const openPromiseIds = source.filter((memory) => memory.type === "promise" && memory.status !== "resolved").map((memory) => memory.memoryId);
    const unresolvedMemoryIds = source.filter((memory) => memory.unresolved || (memory.type === "unresolved" && memory.status !== "resolved")).map((memory) => memory.memoryId);
    const relationshipMemories = source.filter((memory) => memory.type === "relationship" || memory.relationshipImpact);
    const relationshipTrend = relationshipMemories.slice(0, 20).map((memory) => ({ memoryId: memory.memoryId, impact: memory.relationshipImpact, content: memory.content }));
    const consolidation = { criticalMemoryIds, openPromiseIds, unresolvedMemoryIds, relationshipTrend, derivedFrom: source.map((memory) => memory.memoryId) };
    this.store.saveCharacterConsolidation(characterId, consolidation);
    this.trace?.record("consolidate", { characterId, reason: `source_${source.length}` });
    return consolidation;
  }
}

module.exports = { MemoryConsolidator };
