"use strict";

const { ids } = require("./memory4-contract");
const { currentRelationship } = require("./memory4-profile");
const { normalizeGameDate } = require("../worldline/character-temporal-facts");

const CURRENT_RELATIONSHIP_SOURCE = "CURRENT_RUNTIME_RELATIONSHIP";
const QUOTE_CLOSE = new Map([["“", "”"], ["‘", "’"], ["「", "」"], ["『", "』"], ["\"", "\""]]);

function rows(value) {
  if (value instanceof Map) return [...value.values()];
  if (Array.isArray(value)) return value;
  return value && typeof value === "object" ? Object.values(value) : [];
}

function characterId(character) {
  const id = Number(character?.id);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function displayName(character) {
  for (const value of [character?.shortName, character?.name, character?.fullName, character?.firstName]) {
    if (typeof value === "string" && value.trim() && !/^none(?:\s|$)/i.test(value.trim())) return value.trim();
  }
  return null;
}

function buildCurrentMemory4RelationshipEvidence({ gameData, ownerIds = [], entityIds = [] } = {}) {
  const asOf = normalizeGameDate(gameData?.date);
  if (!gameData?.campaignToken || !asOf || !(gameData.characters instanceof Map)) return [];
  const owners = ids(ownerIds).filter(id => gameData.characters.has(id));
  const entities = ids(entityIds).filter(id => gameData.characters.has(id));
  const evidence = [];
  for (const ownerId of owners) for (const entityId of entities) {
    if (ownerId === entityId) continue;
    const relationship = currentRelationship(gameData, ownerId, entityId);
    if (relationship.status !== "CONFIRMED" || relationship.knownToOwner !== true || !relationship.types.length) continue;
    evidence.push({ campaignToken: gameData.campaignToken, ownerId, entityId, status: "CONFIRMED",
      types: [...relationship.types], source: CURRENT_RELATIONSHIP_SOURCE, knownToOwner: true, asOf: asOf.canonical });
  }
  return evidence;
}

function profileAliases(character) {
  return [...new Set([character?.firstName, character?.shortName, character?.name, character?.fullName]
    .filter(value => typeof value === "string" && value.trim().length >= 2 && !/^none(?:\s|$)/i.test(value.trim()))
    .map(value => value.trim()))];
}

function sourceIds(fragment) {
  const values = [...(Array.isArray(fragment.sourceMessageIds) ? fragment.sourceMessageIds : []), fragment.messageId];
  return [...new Set(values.filter(value => Number.isSafeInteger(value) && value >= 0))].sort((left, right) => left - right);
}

function aliasOccurrences(text, alias) {
  const matches = [];
  let offset = 0;
  while ((offset = text.indexOf(alias, offset)) >= 0) {
    const end = offset + alias.length;
    const asciiAlias = /^[a-z0-9 ]+$/i.test(alias);
    const before = text[offset - 1] || "";
    const after = text[end] || "";
    if (!asciiAlias || !/[\p{L}\p{N}_-]/u.test(before) && !/[\p{L}\p{N}_-]/u.test(after)) matches.push({ start: offset, end });
    offset = end;
  }
  return matches;
}

function explicitNameTexts(fragment, text) {
  if (fragment.sourceRole === "mixed") return [];
  if (fragment.sourceRole !== "assistant") return [text];
  const quoted = [];
  for (let index = 0; index < text.length; index++) {
    const close = QUOTE_CLOSE.get(text[index]);
    if (!close) continue;
    const end = text.indexOf(close, index + 1);
    if (end <= index + 1) continue;
    quoted.push(text.slice(index + 1, end));
    index = end;
  }
  return quoted;
}

function sourceParagraphs(fragment) {
  const sourceMessageIds = sourceIds(fragment);
  const applicationSource = fragment.visibilityEvidence === "application_fragment";
  const finalizationSource = ["finalization_validated_segment", "finalization_source_paragraph"].includes(fragment.visibilityEvidence)
    && fragment.sourceTextVerified === true;
  const letterSource = fragment.visibilityEvidence === "validated_letter" && fragment.sourceTextVerified === true
    && typeof fragment.sourceLetterId === "string" && !!fragment.sourceLetterId.trim();
  if (!letterSource && !sourceMessageIds.length || !applicationSource && !finalizationSource && !letterSource
    || typeof fragment.text !== "string" || !fragment.text.trim()) return [];
  return [{ text: fragment.text, sourceMessageIds, ...(letterSource ? { sourceLetterId: fragment.sourceLetterId } : {}) }];
}

function visibleConversationEntityIds(fragment) {
  return ids([fragment.speakerId, ...(fragment.recipientIds || [])]);
}

function relationshipIsValid(row, ownerId, campaignToken, sourceDate) {
  const entityId = Number(row?.entityId);
  const asOf = normalizeGameDate(row?.asOf);
  const date = normalizeGameDate(sourceDate);
  return Number(row?.ownerId) === ownerId && Number.isSafeInteger(entityId) && entityId > 0 && entityId !== ownerId
    && row?.campaignToken === campaignToken && row?.status === "CONFIRMED" && row?.knownToOwner === true
    && row?.source === CURRENT_RELATIONSHIP_SOURCE && Array.isArray(row.types) && row.types.length > 0
    && row.types.every(type => typeof type === "string" && type.trim())
    && asOf && date && asOf.serial <= date.serial;
}

function buildMemory4EntityContext({ ownerId, campaignToken, date, fragments = [], participantProfiles = [],
  mentionedEntities = [], relationshipEvidence = [] } = {}) {
  const owner = Number(ownerId);
  if (!Number.isSafeInteger(owner) || owner < 1 || !campaignToken || !normalizeGameDate(date)) {
    return { entityNameEvidence: [], relationshipEvidence: [] };
  }
  const profiles = new Map();
  for (const profile of [...rows(participantProfiles), ...rows(mentionedEntities)]) {
    const id = characterId(profile);
    if (id && !profiles.has(id)) profiles.set(id, profile);
  }
  const ownerName = displayName(profiles.get(owner));
  const entityNameEvidence = [];
  const scopedRelationships = [];
  const relationshipRows = Array.isArray(relationshipEvidence) ? relationshipEvidence : [];

  for (const fragment of fragments || []) {
    if (!fragment?.fragmentId || !ids(fragment.knownBy).includes(owner)) continue;
    const paragraphs = sourceParagraphs(fragment);
    const profileAliasOwners = new Map();
    for (const [id, profile] of profiles) for (const alias of profileAliases(profile)) {
      if (!profileAliasOwners.has(alias)) profileAliasOwners.set(alias, new Set());
      profileAliasOwners.get(alias).add(id);
    }
    const explicit = new Map();
    for (const paragraph of paragraphs) {
      const matches = [];
      for (const text of explicitNameTexts(fragment, paragraph.text)) {
        for (const [alias, owners] of profileAliasOwners) {
          if (owners.size !== 1) continue;
          const entityId = [...owners][0];
          for (const occurrence of aliasOccurrences(text, alias)) matches.push({ ...occurrence, entityId, alias,
            sourceMessageIds: paragraph.sourceMessageIds, sourceLetterId: paragraph.sourceLetterId });
        }
      }
      matches.sort((left, right) => left.start - right.start || right.end - right.start - (left.end - left.start));
      const occupied = [];
      for (const match of matches) {
        if (occupied.some(([start, end]) => match.start < end && match.end > start)) continue;
        occupied.push([match.start, match.end]);
        if (!explicit.has(match.entityId)) explicit.set(match.entityId, { alias: match.alias,
          sourceMessageIds: [...match.sourceMessageIds], sourceLetterId: match.sourceLetterId });
      }
    }

    const allowedIds = new Set([owner, ...visibleConversationEntityIds(fragment), ...explicit.keys()]);
    const relationships = relationshipRows.filter(row => relationshipIsValid(row, owner, campaignToken, date)
      && allowedIds.has(Number(row.entityId)));
    for (const row of relationships) scopedRelationships.push({ fragmentId: fragment.fragmentId, ownerId: owner,
      entityId: Number(row.entityId), types: [...row.types], status: row.status, knownToOwner: true,
      campaignToken, source: row.source, asOf: normalizeGameDate(row.asOf).canonical });

    const evidenceByEntity = new Map();
    const addName = (entityId, name, source, matchedAlias = null, sourceMessageIds = [], sourceLetterId = null) => {
      if (!name) return;
      const key = Number(entityId);
      if (!evidenceByEntity.has(key)) evidenceByEntity.set(key, { fragmentId: fragment.fragmentId,
        entityId: key, name, evidence: [] });
      const row = evidenceByEntity.get(key);
      if (!row.evidence.some(item => item.source === source && item.matchedAlias === matchedAlias)) {
        row.evidence.push({ source, ...(matchedAlias ? { matchedAlias } : {}),
          sourceMessageIds: [...sourceMessageIds], ...(sourceLetterId ? { sourceLetterId } : {}) });
      }
    };
    if (ownerName) addName(owner, ownerName, "OWNER_SELF");
    for (const [entityId, matched] of explicit) {
      if (entityId === owner) continue;
      addName(entityId, matched.alias, "SOURCE_EXPLICIT_NAME", matched.alias, matched.sourceMessageIds, matched.sourceLetterId);
    }
    for (const row of relationships) {
      const entityId = Number(row.entityId);
      if (entityId === owner || explicit.has(entityId)) continue;
      addName(entityId, displayName(profiles.get(entityId)), "OWNER_DIRECT_RELATIONSHIP");
    }
    entityNameEvidence.push(...evidenceByEntity.values());
  }

  return { entityNameEvidence, relationshipEvidence: scopedRelationships };
}

module.exports = { buildCurrentMemory4RelationshipEvidence, buildMemory4EntityContext };
