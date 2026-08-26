"use strict";

const { uniqueIds } = require("./memory-types");

class KnowledgeService {
  constructor({ store, trace = null } = {}) {
    this.store = store;
    this.trace = trace;
  }

  resolveKnownBy(memory, episode = {}) {
    const presence = Array.isArray(episode.participantPresence) ? episode.participantPresence : [];
    const messageIds = Array.isArray(memory.provenance?.messageIds) ? memory.provenance.messageIds.map(Number).filter(Number.isFinite) : [];
    const eventStart = messageIds.length > 0 ? Math.min(...messageIds) : episode.conversationStartMessageId ?? null;
    const eventEnd = messageIds.length > 0 ? Math.max(...messageIds) : episode.conversationEndMessageId ?? null;
    const windowsByCharacter = new Map();
    for (const window of presence) {
      const characterId = Number(window.characterId);
      if (!Number.isFinite(characterId)) continue;
      if (!windowsByCharacter.has(characterId)) windowsByCharacter.set(characterId, []);
      windowsByCharacter.get(characterId).push(window);
    }
    const isInsideWindow = (window, messageId) => {
      const joined = Number(window.joinedAtMessageId ?? 0);
      const left = window.leftAtMessageId == null ? Infinity : Number(window.leftAtMessageId);
      return joined <= messageId && messageId < left;
    };
    const presentIds = [...windowsByCharacter.entries()].filter(([, windows]) => {
      if (eventStart == null) return true;
      if (messageIds.length > 0) return messageIds.every((messageId) => windows.some((window) => isInsideWindow(window, messageId)));
      return windows.some((window) => {
        const joined = Number(window.joinedAtMessageId ?? 0);
        const left = window.leftAtMessageId == null ? Infinity : Number(window.leftAtMessageId);
        return joined <= eventStart && (eventEnd == null || eventEnd < left);
      });
    }).map(([characterId]) => characterId);
    let knownBy;
    if (memory.visibility === "private") {
      const presentSet = new Set(presentIds);
      knownBy = [...memory.participants, ...memory.provenance.speakerIds].filter((characterId) => presentSet.has(Number(characterId)));
    } else if (memory.visibility === "public" || memory.visibility === "world") {
      knownBy = presentIds;
    } else {
      knownBy = presentIds;
    }
    const resolved = uniqueIds(knownBy);
    this.trace?.record("knowledge", { memoryId: memory.memoryId, type: memory.type, reason: `known_by_${resolved.length}` });
    return resolved;
  }

  markKnownBy(memoryId, characterIds, details = {}) {
    const ids = uniqueIds(characterIds);
    for (const characterId of ids) this.store.markKnownBy(characterId, memoryId, details);
    this.store.updateMemory(memoryId, (memory) => ({ knownBy: uniqueIds([...memory.knownBy, ...ids]) }));
    return ids;
  }

  transferKnowledge(memoryId, { fromCharacterId, toCharacterId, acquiredAt = null, awareness = "told" } = {}) {
    const sourceKnows = this.store.getCharacterKnowledge(fromCharacterId).some((entry) => entry.memoryId === memoryId);
    if (!sourceKnows) return false;
    this.store.markKnownBy(toCharacterId, memoryId, { awareness, acquiredAt, sourceCharacterId: fromCharacterId });
    this.store.updateMemory(memoryId, (memory) => ({ knownBy: uniqueIds([...memory.knownBy, toCharacterId]) }));
    this.trace?.record("knowledge", { memoryId, characterId: toCharacterId, reason: "explicit_transfer" });
    return true;
  }
}

module.exports = { KnowledgeService };
