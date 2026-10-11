"use strict";

const { ids } = require("./memory4-contract");
const { currentRelationship, detectRelationshipChange } = require("./memory4-profile");
const { normalizeSpouseRecords } = require("../worldline/canonical-spouse-record");
const { normalizeGameDate } = require("../worldline/character-temporal-facts");

class Memory4RelationshipReadback {
  constructor() {
    this.previous = null;
    this.sequence = 0;
  }

  observe(gameData, stamp) {
    if (!gameData?.campaignToken || !normalizeGameDate(gameData.date) || !(gameData.characters instanceof Map)
      || stamp?.complete !== true || !Number.isSafeInteger(stamp.size) || stamp.size < 1
      || !Number.isFinite(stamp.mtimeMs)) return [];
    const source = stamp.sourceId || "CK3_DEBUG_LOG";
    const old = this.previous;
    if (old && old.source === source && old.campaignToken === gameData.campaignToken) {
      if (stamp.mtimeMs < old.mtimeMs || stamp.mtimeMs === old.mtimeMs && stamp.size <= old.size) return [];
      if (stamp.size < old.size || normalizeGameDate(gameData.date).serial < normalizeGameDate(old.date).serial) {
        this.previous = null;
      }
    } else this.previous = null;
    const pairs = new Map();
    for (const [ownerId, owner] of gameData.characters) {
      if (!Number.isSafeInteger(ownerId) || ownerId < 1) continue;
      const targets = ids([...(owner.relationsToCharacters || []).map(item => Number(item.id)),
        ...(Number.isSafeInteger(gameData.playerID) && owner.relationsToPlayer?.length ? [gameData.playerID] : []),
        ...normalizeSpouseRecords(owner).map(item => item.runtimeId)]);
      for (const entityId of targets) {
        if (entityId === ownerId || !gameData.characters.has(entityId)) continue;
        const relationship = currentRelationship(gameData, ownerId, entityId);
        if (relationship.status === "CONFIRMED") pairs.set(`${ownerId}:${entityId}`, { campaignToken: gameData.campaignToken,
          ownerId, entityId, status: "CONFIRMED", types: relationship.types, asOf: gameData.date, revision: this.sequence + 1 });
      }
    }
    const changes = [];
    const prior = this.previous;
    if (prior) for (const [key, after] of pairs) {
      const before = prior.pairs.get(key);
      if (!before) continue;
      const change = detectRelationshipChange({ before, after, effectEvidence: { status: "CONFIRMED", source: "CK3_READBACK",
        campaignToken: after.campaignToken, ownerId: after.ownerId, entityId: after.entityId, observedAt: after.asOf,
        beforeRevision: before.revision, afterRevision: after.revision } });
      if (change.detected) changes.push({ campaignToken: after.campaignToken, ownerId: after.ownerId, entityId: after.entityId, ...change });
    }
    this.sequence++;
    this.previous = { campaignToken: gameData.campaignToken, date: gameData.date, source, size: stamp.size,
      mtimeMs: stamp.mtimeMs, pairs };
    return changes;
  }
}

module.exports = { Memory4RelationshipReadback };
