"use strict";

const { buildKinshipGraph } = require("./character-kinship-graph");
const { normalizeGameDate } = require("./character-temporal-facts");

const graphCache = new WeakMap();
const targetedGraphCache = new WeakMap();

function relationFingerprint(gameData) {
  const characters = gameData?.characters instanceof Map ? [...gameData.characters.values()] : Object.values(gameData?.characters || {});
  return characters.map((character) => JSON.stringify([
    character?.id,
    ...["parents", "children", "siblings", "spouse", "spouses", "formerSpouses", "deceasedSpouses"].map((field) => {
      const value = character?.[field] ?? null;
      return value;
    }),
    character?.consort && typeof character.consort === "object" ? character.consort.id ?? character.consort.name : character?.consort || "",
    character?.gender ?? character?.sex ?? character?.female ?? "",
    character?.evidence?.conflicts?.gender === true,
    character?.birthDateTotalDays ?? character?.birthTotalDays ?? "",
    character?.birthDate ?? character?.birth ?? "",
    character?.age ?? "",
    character?.ageSource ?? "",
    character?.evidence?.age ?? null,
    character?.evidence?.otherParentRelations ?? null,
    character?.evidence?.relations ?? null,
    character?.alive,
    character?.evidence?.conflicts?.alive === true,
    character?.deathDateTotalDays ?? character?.deathDate ?? ""
  ])).sort().join("|");
}

function revisionKey(gameData) {
  // Production checkpoints use parseGameState's SHA-256 of the complete gamestate;
  // runtime objects without that invariant fall back to the demographic fingerprint.
  const explicitRevision = gameData?.contentFingerprint ?? gameData?.saveContentHash ?? gameData?.relationFingerprint;
  const fingerprint = explicitRevision ?? relationFingerprint(gameData);
  // The fallback already serializes the exact parent source metadata. Reuse
  // that proof instead of walking the same character collection a second time.
  const liveScope = explicitRevision === null || explicitRevision === undefined
    ? /"source":"CK3_(?:DIRECT|OTHER)_PARENT"/.test(fingerprint) ? `${gameData?.date ?? ""}/${gameData?.totalDays ?? ""}`
      : /"source":"CK3_SAVE_LEGAL_PARENT"/.test(fingerprint) ? `${gameData?.playthroughId ?? ""}/${gameData?.gameDate ?? ""}/${gameData?.contentFingerprint ?? ""}` : ""
    : liveParentScope(gameData);
  return [
    gameData?.campaignToken ?? gameData?.campaignId ?? "",
    gameData?.checkpointId ?? gameData?.currentCheckpoint?.id ?? "",
    gameData?.gameDataRevision ?? "",
    gameData?.structuralRevision ?? "",
    gameData?.participantRelationRevision ?? "",
    liveScope,
    fingerprint
  ].join("|");
}

function liveParentScope(gameData) {
  const characters = gameData?.characters instanceof Map ? gameData.characters.values() : Object.values(gameData?.characters || {});
  for (const character of characters) {
    if ((character?.parents || []).some?.(parent => parent?.source === "CK3_DIRECT_PARENT")
      || character?.children?.some?.(entry => entry?.directParentEvidence?.source === "CK3_DIRECT_PARENT")
      || ["children", "siblings"].some(field => character?.[field]?.some?.(entry => entry?.otherParent))
      || character?.evidence?.otherParentRelations?.length
      || character?.evidence?.relations?.some(item => item?.directParentEvidence?.source === "CK3_DIRECT_PARENT")) {
      return `${gameData?.date ?? ""}/${gameData?.totalDays ?? ""}`;
    }
    if (character?.evidence?.relations?.some(item => item?.directParentEvidence?.source === "CK3_SAVE_LEGAL_PARENT")) {
      return `${gameData?.playthroughId ?? ""}/${gameData?.gameDate ?? ""}/${gameData?.contentFingerprint ?? ""}`;
    }
  }
  // Legacy structural graphs have no live parent source to expire. Preserve
  // their cache identity when only the game clock changes.
  return "";
}

function referenceId(value) {
  const raw = value && typeof value === "object" ? value.id ?? value.runtimeId ?? value.characterId : value;
  return raw === null || raw === undefined || raw === "" ? null : String(raw);
}

function relatedIds(character = {}) {
  const values = [];
  const add = value => {
    for (const item of Array.isArray(value) ? value : value === null || value === undefined ? [] : [value]) {
      const id = referenceId(item);
      if (id) values.push(id);
    }
  };
  if (Array.isArray(character.parents)) add(character.parents);
  else add(Object.values(character.parents || {}));
  for (const field of ["father", "mother", "children", "siblings", "spouse", "spouses", "formerSpouses", "deceasedSpouses", "consort"]) add(character[field]);
  for (const evidence of character?.evidence?.relations || []) add(evidence?.ownerId);
  return [...new Set(values)];
}

function positiveRuntimeId(value) {
  const raw = value && typeof value === "object" ? value.id ?? value.runtimeId ?? value.characterId : value;
  const numeric = Number(raw);
  return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : null;
}

function currentParentSnapshotId(gameData) {
  const date = typeof gameData?.date === "string" ? gameData.date.trim() : "";
  const rawDays = gameData?.totalDays;
  const days = typeof rawDays === "number" || typeof rawDays === "string" && rawDays.trim()
    ? Number(rawDays) : NaN;
  return date && Number.isFinite(days) && days >= 0 ? `${date}/${days}` : null;
}

function isCurrentDirectParentEvidence(record, context = {}, gameData = {}) {
  if (!record || typeof record !== "object") return false;
  const childId = positiveRuntimeId(context.childId ?? context.sourceOwnerId ?? record.childId);
  const parentId = positiveRuntimeId(context.parentId ?? record.parentId ?? record.id);
  const recordId = positiveRuntimeId(record.id ?? record.parentId ?? record.parentRuntimeId);
  if (record.source === "CK3_SAVE_LEGAL_PARENT") {
    const playthroughId = gameData?.playthroughId;
    const gameDate = gameData?.gameDate;
    const contentFingerprint = gameData?.contentFingerprint;
    const parentField = record.sourceRelation === "family_data.father" ? "father"
      : record.sourceRelation === "family_data.mother" ? "mother" : null;
    const characters = gameData?.characters;
    const child = characters instanceof Map
      ? characters.get(childId) ?? characters.get(String(childId))
      : characters?.[childId] ?? characters?.[String(childId)];
    const parent = characters instanceof Map
      ? characters.get(parentId) ?? characters.get(String(parentId))
      : characters?.[parentId] ?? characters?.[String(parentId)];
    const rawLegalParentId = parentField ? positiveRuntimeId(child?.parents?.[parentField]) : null;
    return gameData?.schemaVersion === 1
      && typeof playthroughId === "string" && playthroughId.length > 0
      && typeof gameDate === "string" && normalizeGameDate(gameDate) !== null
      && typeof contentFingerprint === "string" && /^[a-f0-9]{64}$/iu.test(contentFingerprint)
      && childId !== null && parentId !== null && (recordId === null || recordId === parentId)
      && record.sourceSchemaVersion === 1
      && record.sourceOwnerId === String(childId) && record.childId === String(childId)
      && record.parentId === String(parentId)
      && record.relationType === "parent"
      && parentField !== null && rawLegalParentId === parentId && !!parent
      && record.publicStatus === "PUBLIC_LEGAL_PARENT" && record.knowledgeStatus === "UNKNOWN"
      && record.evidenceConflict !== true
      && record.playthroughId === playthroughId && record.gameDate === gameDate
      && record.contentFingerprint === contentFingerprint
      && record.sourceSnapshotId === `${playthroughId}/${gameDate}/${contentFingerprint}`;
  }
  const campaignToken = gameData?.campaignToken;
  const snapshotId = currentParentSnapshotId(gameData);
  return childId !== null && parentId !== null
    && (recordId === null || recordId === parentId)
    && record.source === "CK3_DIRECT_PARENT"
    && record.publicStatus === "PUBLIC_LEGAL_PARENT"
    && record.knowledgeStatus === "UNKNOWN"
    && record.evidenceConflict !== true
    && record.relationType === "parent"
    && record.sourceRelation === "parents"
    && positiveRuntimeId(record.sourceOwnerId) === childId
    && positiveRuntimeId(record.childId) === childId
    && typeof campaignToken === "string" && campaignToken.length > 0
    && record.campaignToken === campaignToken
    && snapshotId !== null && record.sourceSnapshotId === snapshotId;
}

function currentPublicParentFilter(gameData) {
  const campaignToken = gameData?.campaignToken;
  const snapshotId = currentParentSnapshotId(gameData);
  return (evidence, record, context = {}) => {
    const parentId = positiveRuntimeId(evidence?.parentId ?? evidence?.otherParentId ?? evidence?.id);
    const childId = positiveRuntimeId(context.childId ?? evidence?.childId ?? record?.childId);
    const sourceOwnerId = positiveRuntimeId(evidence?.sourceOwnerId);
    const expectedOwnerId = positiveRuntimeId(context.sourceOwnerId ?? record?.sourceOwnerId);
    return typeof campaignToken === "string" && campaignToken.length > 0 && snapshotId !== null
      && parentId !== null && childId !== null && sourceOwnerId !== null
      && (expectedOwnerId === null || sourceOwnerId === expectedOwnerId)
      && sourceOwnerId === positiveRuntimeId(record?.sourceOwnerId)
      && (record?.childId === null || record?.childId === undefined || positiveRuntimeId(record.childId) === childId)
      && record?.source === "CK3_OTHER_PARENT" && evidence?.source === "CK3_OTHER_PARENT"
      && record?.publicStatus === "PUBLIC_LEGAL_PARENT" && evidence?.publicStatus === "PUBLIC_LEGAL_PARENT"
      && record?.knowledgeStatus === "UNKNOWN" && evidence?.knowledgeStatus === "UNKNOWN"
      && record?.evidenceConflict !== true && evidence?.evidenceConflict !== true
      && record?.relationType === "parent" && evidence?.relationType === "parent"
      && record?.sourceRelation === evidence?.sourceRelation
      && ["kids.otherParent", "siblings.otherParent"].includes(record?.sourceRelation)
      && sourceOwnerId === positiveRuntimeId(record?.sourceOwnerId)
      && record?.campaignToken === campaignToken && evidence?.campaignToken === campaignToken
      && record?.sourceSnapshotId === snapshotId && evidence?.sourceSnapshotId === snapshotId;
  };
}

function currentDirectParentFilter(gameData) {
  return (record, contextOrChildId = {}) => {
    const context = contextOrChildId && typeof contextOrChildId === "object"
      ? contextOrChildId : { childId: contextOrChildId };
    return isCurrentDirectParentEvidence(record, context, gameData);
  };
}

function getTargetedKinshipGraph(gameData, seedIds = [], { maxDepth = 3, maxNodes = 4096 } = {}) {
  if (!gameData || typeof gameData !== "object") return buildKinshipGraph({});
  const characters = gameData.characters instanceof Map ? gameData.characters : new Map(Object.entries(gameData.characters || {}));
  const seeds = [...new Set(seedIds.map(referenceId).filter(Boolean))].sort();
  const key = `${revisionKey(gameData)}:${seeds.join(",")}:${maxDepth}:${maxNodes}`;
  let cache = targetedGraphCache.get(gameData);
  if (!cache) { cache = new Map(); targetedGraphCache.set(gameData, cache); }
  if (cache.has(key)) return cache.get(key);
  const selected = new Map();
  const queue = seeds.map(id => ({ id, depth: 0 }));
  const visited = new Set();
  let truncated = false;
  while (queue.length) {
    const current = queue.shift();
    if (visited.has(current.id)) continue;
    visited.add(current.id);
    const character = characters.get(current.id) ?? characters.get(Number(current.id));
    if (!character) continue;
    selected.set(current.id, character);
    const neighborIds = current.depth < maxDepth ? relatedIds(character) : [];
    if (selected.size >= maxNodes) { truncated = queue.length > 0 || neighborIds.some(id => !visited.has(id)); break; }
    if (current.depth >= maxDepth) continue;
    for (const relatedId of neighborIds) if (!visited.has(relatedId)) queue.push({ id: relatedId, depth: current.depth + 1 });
  }
  const graph = buildKinshipGraph(selected, { otherParentEvidenceFilter: currentPublicParentFilter(gameData),
    directParentEvidenceFilter: currentDirectParentFilter(gameData) });
  graph.scopeTruncated = truncated;
  cache.set(key, graph);
  if (cache.size > 16) cache.delete(cache.keys().next().value);
  return graph;
}

function getCachedKinshipGraph(gameData, { includeOtherParents = true } = {}) {
  if (!gameData || typeof gameData !== "object") return buildKinshipGraph({});
  const key = `${revisionKey(gameData)}:${includeOtherParents}`;
  let variants = graphCache.get(gameData);
  if (!variants) { variants = new Map(); graphCache.set(gameData, variants); }
  const cached = variants.get(includeOtherParents);
  if (cached?.key === key) return cached.graph;
  const profiles = typeof gameData.getMentionableCharacterProfiles === "function" ? gameData.getMentionableCharacterProfiles() : gameData.characters;
  const graph = buildKinshipGraph(profiles, { includeOtherParents, otherParentEvidenceFilter: currentPublicParentFilter(gameData),
    directParentEvidenceFilter: currentDirectParentFilter(gameData) });
  variants.set(includeOtherParents, { key, graph });
  return graph;
}

module.exports = { getCachedKinshipGraph, getTargetedKinshipGraph, revisionKey, currentDirectParentFilter, currentPublicParentFilter, isCurrentDirectParentEvidence };
