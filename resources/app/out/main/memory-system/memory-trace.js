"use strict";

class MemoryTrace {
  constructor({ logger = console, maxEntries = 500 } = {}) {
    this.logger = logger;
    this.maxEntries = maxEntries;
    this.entries = [];
  }

  record(stage, details = {}) {
    const safe = {
      timestamp: new Date().toISOString(),
      stage,
      memoryId: details.memoryId || null,
      type: details.type || null,
      score: Number.isFinite(details.score) ? details.score : null,
      reason: details.reason || null,
      alias: details.alias || null,
      characterIds: Array.isArray(details.characterIds) ? [...details.characterIds] : [],
      patchInserted: details.patchInserted === true,
      firstChangedBlock: details.firstChangedBlock || null,
      characterId: details.characterId ?? null,
      conversationId: details.conversationId || null
    };
    this.entries.push(safe);
    if (this.entries.length > this.maxEntries) this.entries.shift();
    this.logger?.log?.(`[MemoryTrace] ${stage}`, safe);
    return safe;
  }

  list() {
    return this.entries.map((entry) => ({ ...entry }));
  }
}

module.exports = { MemoryTrace };
