"use strict";

const { buildKinshipGraph } = require("./character-kinship-graph");

const graphCache = new WeakMap();
const targetedGraphCache = new WeakMap();

function relationFingerprint(gameData) {
  const characters = gameData?.characters instanceof Map ? [...gameData.characters.values()] : Object.values(gameData?.characters || {});
  return characters.map((character) => JSON.stringify([
    character?.id,
    ...["parents", "children", "siblings", "spouse", "spouses", "formerSpouses", "deceasedSpouses"].map((field) => {
      const value = character?.[field] ?? null;
      // Step-family evidence is queried directly; its subtree is not a birth-graph input.
      return field === "parents" && Array.isArray(value)
        ? value.map(parent => parent?.source === "CK3_DIRECT_PARENT" ? { ...parent, spouses: undefined } : parent)
        : value;
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
    ? /"source":"CK3_(?:DIRECT|OTHER)_PARENT"/.test(fingerprint) ? `${gameData?.date ?? ""}/${gameData?.totalDays ?? ""}` : ""
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
      || ["children", "siblings"].some(field => character?.[field]?.some?.(entry => entry?.otherParent))
      || character?.evidence?.otherParentRelations?.length
      || character?.evidence?.relations?.some(item => item?.directParentEvidence?.source === "CK3_DIRECT_PARENT")) {
      return `${gameData?.date ?? ""}/${gameData?.totalDays ?? ""}`;
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

function currentPublicParentFilter(gameData) {
  const campaignToken = gameData?.campaignToken;
  const date = typeof gameData?.date === "string" ? gameData.date.trim() : "";
  const rawDays = gameData?.totalDays;
  const days = typeof rawDays === "number" || typeof rawDays === "string" && rawDays.trim()
    ? Number(rawDays) : NaN;
  const snapshotId = date && Number.isFinite(days) && days >= 0 ? `${date}/${days}` : null;
  // Raw/diagnostic graphs retain evidence. Shared presentation graphs must
  // reject it before deriving siblings/grandparents or freezing Prompt text.
  return (evidence, record) => typeof campaignToken === "string" && campaignToken.length > 0 && snapshotId !== null
    && record?.source === "CK3_OTHER_PARENT" && record.publicStatus === "PUBLIC_LEGAL_PARENT"
    && (record.knowledgeStatus === undefined || record.knowledgeStatus === "UNKNOWN")
    && record.campaignToken === campaignToken && record.sourceSnapshotId === snapshotId
    && evidence.campaignToken === campaignToken && evidence.sourceSnapshotId === snapshotId;
}

function currentDirectParentFilter(gameData) {
  const campaignToken = gameData?.campaignToken;
  const date = typeof gameData?.date === "string" ? gameData.date.trim() : "";
  const rawDays = gameData?.totalDays;
  const days = typeof rawDays === "number" || typeof rawDays === "string" && rawDays.trim()
    ? Number(rawDays) : NaN;
  const snapshotId = date && Number.isFinite(days) && days >= 0 ? `${date}/${days}` : null;
  return (record, childId) => {
    if (!record || typeof record !== "object") return true;
    if (Object.hasOwn(record, "publicStatus")
      && (record.publicStatus !== "PUBLIC_LEGAL_PARENT" || record.source !== "CK3_DIRECT_PARENT")) return false;
    if (record.source !== "CK3_DIRECT_PARENT") return true;
    return record.publicStatus === "PUBLIC_LEGAL_PARENT" && record.knowledgeStatus === "UNKNOWN" && !record.evidenceConflict
      && record.relationType === "parent" && record.sourceRelation === "parents"
      && Number(record.sourceOwnerId) === Number(childId) && Number(record.childId) === Number(childId)
      && typeof campaignToken === "string" && campaignToken.length > 0 && snapshotId !== null
      && record.campaignToken === campaignToken && record.sourceSnapshotId === snapshotId;
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

module.exports = { getCachedKinshipGraph, getTargetedKinshipGraph, revisionKey, currentDirectParentFilter, currentPublicParentFilter };
