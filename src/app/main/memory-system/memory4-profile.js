"use strict";

const { assertScope, ids } = require("./memory4-contract");
const { buildLegacyBridge } = require("./memory4-legacy-bridge");
const { normalizeSpouseRecords } = require("../worldline/canonical-spouse-record");
const { normalizeGameDate } = require("../worldline/character-temporal-facts");
const { getCurrentTruth } = require("../worldline/current-truth-adapter");
const { resolveKnowledgeScope } = require("../worldline/knowledge-scope-resolver");
const { classifyKnowledge } = require("../worldline/character-knowledge-policy");

function runtimeCharacter(gameData, characterId) {
  const characters = gameData?.characters;
  return characters instanceof Map ? characters.get(characterId) || null : characters?.[String(characterId)] || null;
}

function currentRelationship(gameData, ownerId, entityId) {
  const owner = runtimeCharacter(gameData, ownerId);
  if (!owner) return { status: "UNKNOWN", types: [], source: null, knownToOwner: false };
  const explicit = value => typeof value === "string" && value.trim()
    && !/^(?:none|unknown|neutral|无|未知|无明确正式关系)$/i.test(value.trim());
  const types = new Set((owner.relationsToCharacters || []).filter(item => Number(item.id) === entityId)
    .flatMap(item => item.relations || []).map(value => String(value).trim()).filter(explicit));
  if (Number(gameData.playerID) === entityId) for (const type of owner.relationsToPlayer || []) {
    if (explicit(type)) types.add(type.trim());
  }
  const spouses = normalizeSpouseRecords(owner).filter(item => item.runtimeId === entityId);
  if (spouses.some(item => item.relationType === "CURRENT_SPOUSE")
    && !spouses.some(item => ["FORMER_SPOUSE", "DECEASED_SPOUSE"].includes(item.relationType))) types.add("spouse");
  // Missing CK3 relationship data is not evidence of a neutral relationship.
  return types.size ? { status: "CONFIRMED", types: [...types].sort(), source: "CURRENT_RUNTIME_RELATION", knownToOwner: true }
    : { status: "UNKNOWN", types: [], source: null, knownToOwner: false };
}

function validLiveScope(scope, snapshot, gameData) {
  const live = normalizeGameDate(gameData?.date);
  return gameData?.campaignToken === scope.campaignToken && live
    && (!snapshot || snapshot.campaignToken === scope.campaignToken);
}

function authorizedCurrentTruth(scope, snapshot, gameData, entityId) {
  if (!validLiveScope(scope, snapshot, gameData)) return {};
  const ownerId = scope.ownerId;
  // Annual checkpoints can already be stale within the same game day. Only
  // live GameData supplies current values and the authorization scope.
  const liveSnapshot = { gameDate: gameData.date, characters: gameData.characters instanceof Map
    ? Object.fromEntries(gameData.characters) : gameData.characters };
  const context = resolveKnowledgeScope({ snapshot: liveSnapshot, responderId: ownerId, subjectId: entityId,
    runtimeGameData: gameData, includeCloseKnowledge: true });
  const result = {};
  for (const field of ["alive", "location"]) {
    const truth = getCurrentTruth(liveSnapshot, entityId, field);
    if (!truth.available) continue;
    const decision = classifyKnowledge({ factId: `memory4-profile:${entityId}:${field}`, entityId: String(entityId),
      field: field.toUpperCase(), value: truth.rawValue, sourceTier: "GAME_TRUTH", knowledgeLevel: "COURT_PUBLIC",
      public: true, temporalSafe: true, sourceComplete: true, candidateSetComplete: true, asOf: truth.asOf },
    { id: ownerId }, context);
    if (decision.decision === "ALLOW") result[field] = truth.rawValue;
  }
  return result;
}

class Memory4ProfileService {
  constructor(memory4Store) {
    this.store = memory4Store;
    this.pointerCache = new Map();
  }

  invalidate(scope) {
    assertScope(scope);
    const prefix = `${scope.campaignToken}:${scope.ownerId}:`;
    for (const key of this.pointerCache.keys()) if (key.startsWith(prefix)) this.pointerCache.delete(key);
  }

  getProfile(scope, entityId, { snapshot = null, gameData = null, currentGameDate = null, legacyMemories = [], readContext = null } = {}) {
    assertScope(scope);
    if (ids([entityId]).length !== 1 || entityId === scope.ownerId) throw new Error("memory4_profile_entity_invalid");
    if (readContext && (readContext.scope.campaignToken !== scope.campaignToken || readContext.scope.ownerId !== scope.ownerId)) throw new Error("memory4_profile_scope_mismatch");
    const index = readContext?.index || this.store.loadIndex(scope);
    const key = `${scope.campaignToken}:${scope.ownerId}:${entityId}`;
    let pointers = this.pointerCache.get(key);
    if (!pointers || pointers.revision !== index.revision) {
      pointers = { revision: index.revision, detailIds: (index.byEntity[String(entityId)] || [])
        .filter(id => index.entries[id] && !index.entries[id].deleted) };
      this.pointerCache.set(key, pointers);
    }
    const evidence = this.store.getKnownEntityEvidence(scope, entityId, { currentGameDate: currentGameDate || gameData?.date || snapshot?.gameDate, readContext });
    const relationship = validLiveScope(scope, snapshot, gameData)
      ? currentRelationship(gameData, scope.ownerId, entityId)
      : { status: "UNKNOWN", types: [], source: null, knownToOwner: false };
    const level = relationship.status === "CONFIRMED" ? "DIRECT_RELATIONSHIP"
      : evidence.status === "SHARED_SCENE" ? "DIRECT_OBSERVATION" : evidence.status || "UNKNOWN";
    const bridge = buildLegacyBridge(legacyMemories, scope);
    return { campaignToken: scope.campaignToken, ownerId: scope.ownerId, entityId,
      recognition: { level, reason: level === "UNKNOWN" ? "INSUFFICIENT_EVIDENCE" : null,
        directConversationCount: evidence.directConversationCount || 0, sharedSceneCount: evidence.sharedSceneCount || 0,
        mentionCount: evidence.mentionCount || 0, firstSeen: evidence.firstSeenDate || null,
        lastSeen: evidence.lastSeenDate || null, evidenceCompleteness: evidence.completeness || "partial" },
      relationship, currentTruth: authorizedCurrentTruth(scope, snapshot, gameData, entityId),
      nickname: validLiveScope(scope, snapshot, gameData) ? runtimeCharacter(gameData, entityId)?.nickname || null : null,
      disclosedFacts: this.store.getCurrentDisclosures(scope, entityId,
        validLiveScope(scope, snapshot, gameData) ? gameData : null,
        { readContext, currentGameDate: currentGameDate || gameData?.date || snapshot?.gameDate }),
      memoryPointers: { detailIds: [...pointers.detailIds], ...(this.store.derived?.getPointers(scope, entityId, { currentGameDate: currentGameDate || gameData?.date || snapshot?.gameDate, readContext }) || { yearKeys: [], lifeItemIds: [] }),
        legacyCoverageRefs: bridge.memories.filter(memory => ids([
          ...(memory.subjects || []), ...(memory.provenance?.counterpartIds || []), memory.provenance?.counterpartId
        ]).includes(entityId)).map(memory => memory.memoryId) } };
  }
}

function detectRelationshipChange({ before, after, effectEvidence } = {}) {
  const safe = before?.status === "CONFIRMED" && after?.status === "CONFIRMED"
    && before.campaignToken && before.campaignToken === after.campaignToken
    && Number.isSafeInteger(before.ownerId) && before.ownerId === after.ownerId
    && Number.isSafeInteger(before.entityId) && before.entityId === after.entityId
    && normalizeGameDate(before.asOf) && normalizeGameDate(after.asOf)
    && normalizeGameDate(before.asOf).serial <= normalizeGameDate(after.asOf).serial
    && Number.isSafeInteger(before.revision) && Number.isSafeInteger(after.revision) && after.revision > before.revision
    && effectEvidence?.status === "CONFIRMED" && effectEvidence.source === "CK3_READBACK"
    && effectEvidence.campaignToken === before.campaignToken && effectEvidence.ownerId === before.ownerId
    && effectEvidence.entityId === before.entityId && normalizeGameDate(effectEvidence.observedAt)
    && effectEvidence.beforeRevision === before.revision && effectEvidence.afterRevision === after.revision
    && normalizeGameDate(effectEvidence.observedAt).serial >= normalizeGameDate(after.asOf).serial;
  if (!safe || !Array.isArray(before.types) || !Array.isArray(after.types)) return { detected: false };
  const oldTypes = [...new Set(before.types)].sort();
  const newTypes = [...new Set(after.types)].sort();
  return oldTypes.join("\0") === newTypes.join("\0") ? { detected: false }
    : { detected: true, before: oldTypes, after: newTypes, asOf: after.asOf, reason: "unknown", extractionPriority: "elevated" };
}

module.exports = { Memory4ProfileService, currentRelationship, detectRelationshipChange };
