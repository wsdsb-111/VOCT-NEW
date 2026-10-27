"use strict";

const { buildKinshipGraph } = require("./character-kinship-graph");
const { normalizeGameDate } = require("./character-temporal-facts");
const { currentBetrothalEvidenceFilter, currentFormerSpouseEvidenceFilter, currentSpouseEvidenceFilter } = require("./canonical-spouse-record");

const graphCache = new WeakMap();
const targetedGraphCache = new WeakMap();

function relationFingerprint(gameData) {
  const characters = gameData?.characters instanceof Map ? [...gameData.characters.values()] : Object.values(gameData?.characters || {});
  return characters.map((character) => JSON.stringify([
    character?.id, character?.name, character?.firstName, character?.shortName, character?.fullName,
    ...["parents", "children", "siblings", "spouse", "spouses", "formerSpouses", "deceasedSpouses", "betrothed"].map((field) => {
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
  ])).join("|");
}

function revisionKey(gameData) {
  // Live objects can change within one day. Exact source content is cache
  // authority; supplied revision labels do not certify immutable GameData.
  const fingerprint = relationFingerprint(gameData);
  const liveScope = /"sourceSnapshotId"/.test(fingerprint) ? String(gameData?.date ?? "") + "/" + String(gameData?.totalDays ?? "") : "";
  return [gameData?.campaignToken ?? gameData?.campaignId ?? "", gameData?.checkpointId ?? "",
    gameData?.playthroughId ?? "", gameData?.gameDate ?? "", gameData?.contentFingerprint ?? "",
    gameData?.gameDataRevision ?? "", gameData?.structuralRevision ?? "", gameData?.participantRelationRevision ?? "",
    liveScope, fingerprint].join("|");
}

function referenceId(value) {
  const raw = value && typeof value === "object" ? value.id ?? value.runtimeId ?? value.characterId : value;
  return raw === null || raw === undefined || raw === "" ? null : String(raw);
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
  if (["relationshipKind", "parentage", "parentType", "kinshipType", "kind"].some(key => /STEP|继亲|繼親/iu.test(record[key] || ""))) return false;
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

function isCurrentSiblingRow(owner, row, gameData) {
  return !!referenceId(owner) && !!referenceId(row) && referenceId(owner) !== referenceId(row) && row.evidenceConflict !== true
    && !["relationshipKind", "parentage", "parentType", "kinshipType", "kind"].some(key => /STEP|继亲|繼親/iu.test(row[key] || ""))
    && typeof gameData.campaignToken === "string" && !!gameData.campaignToken
    && typeof gameData.date === "string" && Number.isFinite(gameData.totalDays)
    && row.evidence?.age?.length > 0
    && row.evidence.age.every(proof => proof.ageSource === "CK3_LIVE_RELATIVE_AGE" && proof.evidenceConflict !== true
      && !/STEP/iu.test(proof.relationshipKind || "")
      && Number(proof.sourceOwnerId) === Number(owner.id) && proof.relationType === "sibling"
      && proof.source === `${owner.id}.siblings` && proof.campaignToken === gameData.campaignToken
      && proof.sourceSnapshotId === `${gameData.date}/${gameData.totalDays}`);
}

function selectRelationScope(gameData, seedIds, { maxDepth, maxNodes, discoveryIndex }) {
  const characters = gameData.characters instanceof Map ? gameData.characters : new Map(Object.entries(gameData.characters || {}));
  const selected = new Map();
  const queued = new Map();
  const levels = Array.from({ length: maxDepth + 1 }, () => []);
  const enqueue = (value, depth) => {
    const id = referenceId(value);
    if (!id || depth > maxDepth) return;
    if (typeof value !== "object" && !characters.has(id) && !characters.has(Number(id))) return;
    const previous = queued.get(id);
    if (previous && previous.depth <= depth) return;
    const entry = { id, depth, record: typeof value === "object" ? value : previous?.record || null };
    queued.set(id, entry);
    levels[depth].push(entry);
  };
  for (const seed of seedIds) enqueue(seed, 0);
  let queueReads = 0;
  traversal: for (const level of levels) for (let head = 0; head < level.length; head++) {
    const current = level[head];
    queueReads++;
    if (queued.get(current.id) !== current) continue;
    if (selected.size >= maxNodes) break traversal;
    const character = characters.get(current.id) ?? characters.get(Number(current.id)) ?? current.record;
    if (!character) continue;
    selected.set(current.id, character);
    if (current.depth >= maxDepth) continue;
    // Keep partial, source-bound relatives as well as canonical characters. This
    // discovers off-scene spouses/betrothals without seeding the entire save.
    const records = new Map();
    const inlineDepths = new WeakMap();
    const add = (value, depth) => {
      for (const item of Array.isArray(value) ? value : value == null ? [] : [value]) {
        const id = referenceId(item);
        if (id && (!records.has(id) || records.get(id).depth > depth)) records.set(id, { item, depth });
        walk(item, depth);
      }
    };
    const walk = (record, depth) => {
      if (!record || typeof record !== "object" || depth >= maxDepth
        || (inlineDepths.get(record) ?? Infinity) <= depth) return;
      inlineDepths.set(record, depth);
      add(Array.isArray(record.parents) ? record.parents : Object.values(record.parents || {}), depth + 1);
      for (const field of ["father", "mother", "children", "siblings", "spouse", "spouses", "formerSpouses", "deceasedSpouses", "consort", "betrothed", "otherParent"]) add(record[field], depth + 1);
      for (const evidence of record.evidence?.relations || []) add(evidence.ownerId, depth + 1);
      for (const evidence of record.evidence?.otherParentRelations || []) { add(evidence.sourceOwnerId, depth + 1); add(evidence.parentId, depth + 1); }
    };
    walk(character, current.depth);
    if (current.record !== character) walk(current.record, current.depth);
    for (const { item, depth } of [...records.values()].sort((left, right) => left.depth - right.depth)) enqueue(item, depth);
    for (const related of discoveryIndex?.get(current.id) || []) enqueue(related, current.depth + 1);
  }
  const truncated = [...queued.values()].some(item => !selected.has(item.id) && (characters.has(item.id) || characters.has(Number(item.id)) || item.record));
  return { selected, truncated, metrics: { nodeVisits: selected.size, queued: queued.size, queueReads, fingerprintComputations: 1 } };
}

function currentCheckpointSpouse(record, context, gameData) {
  if (record && typeof record === "object" || gameData?.schemaVersion !== 1
    || typeof gameData.playthroughId !== "string" || !gameData.playthroughId
    || !normalizeGameDate(gameData.gameDate) || !/^[a-f0-9]{64}$/iu.test(gameData.contentFingerprint || "")) return false;
  const ownerId = positiveRuntimeId(context.sourceOwnerId);
  const targetId = positiveRuntimeId(context.targetId);
  const people = gameData.characters;
  const lookup = id => people instanceof Map ? people.get(id) ?? people.get(String(id)) : people?.[id];
  const owner = lookup(ownerId);
  if (!ownerId || !targetId || ownerId === targetId || !lookup(targetId)
    || positiveRuntimeId(record) !== targetId || positiveRuntimeId(owner?.spouse) !== targetId
    || owner.evidence?.conflicts?.spouse === true) return false;
  const rows = (owner.evidence?.relations || []).filter(row => row.relationType === "spouse" && positiveRuntimeId(row.ownerId) === targetId);
  return rows.length > 0 && rows.every(row => {
    const proof = row.spouseEvidence;
    return row.evidenceConflict !== true && row.source === "CK3_SAVE_LEGAL_SPOUSE" && proof?.source === row.source && proof.sourceSchemaVersion === 1
      && proof.sourceOwnerId === String(ownerId) && proof.spouseId === String(targetId)
      && proof.relationType === "spouse" && proof.sourceRelation === "family_data.spouse"
      && proof.publicStatus === "PUBLIC_LEGAL_MARRIAGE" && proof.knowledgeStatus === "UNKNOWN" && proof.evidenceConflict !== true
      && proof.playthroughId === gameData.playthroughId && proof.gameDate === gameData.gameDate
      && proof.contentFingerprint === gameData.contentFingerprint
      && proof.sourceSnapshotId === `${gameData.playthroughId}/${gameData.gameDate}/${gameData.contentFingerprint}`;
  });
}

function relationshipOptions(gameData) {
  const liveMarriage = currentSpouseEvidenceFilter(gameData);
  return { otherParentEvidenceFilter: currentPublicParentFilter(gameData),
    directParentEvidenceFilter: currentDirectParentFilter(gameData),
    siblingEvidenceFilter: (record, ownerId) => isCurrentSiblingRow({ id: ownerId }, record, gameData),
    currentSpouseEvidenceFilter: (record, context) => liveMarriage(record, context) || currentCheckpointSpouse(record, context, gameData),
    formerSpouseEvidenceFilter: currentFormerSpouseEvidenceFilter(gameData),
    betrothalEvidenceFilter: currentBetrothalEvidenceFilter(gameData) };
}

function getTargetedKinshipGraph(gameData, seedIds = [], { maxDepth = 3, maxNodes = 4096, deriveExtendedRelations = true, discoveryIndex = null } = {}) {
  if (!gameData || typeof gameData !== "object") return buildKinshipGraph({});
  const seeds = [...new Set(seedIds.map(referenceId).filter(Boolean))].sort();
  const scope = selectRelationScope(gameData, seeds, { maxDepth, maxNodes, discoveryIndex });
  // The live GameData parser mutates objects in place. Revalidate the bounded
  // neighborhood even on a hit; caller-supplied revision strings cannot certify
  // immutability. No whole-save fingerprint is needed for this local graph.
  const key = JSON.stringify([gameData.campaignToken, gameData.campaignId, gameData.checkpointId,
    gameData.date, gameData.totalDays, gameData.playthroughId, gameData.gameDate, gameData.contentFingerprint,
    seeds, maxDepth, maxNodes, deriveExtendedRelations, scope.truncated, relationFingerprint({ characters: scope.selected })]);
  let cache = targetedGraphCache.get(gameData);
  if (!cache) { cache = new Map(); targetedGraphCache.set(gameData, cache); }
  if (cache.has(key)) return cache.get(key);
  const graph = buildKinshipGraph(scope.selected, { ...relationshipOptions(gameData),
    allowedNodeIds: new Set(scope.selected.keys()), deriveExtendedRelations });
  graph.scopeTruncated = scope.truncated;
  graph.scopeMetrics = scope.metrics;
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
  const graph = buildKinshipGraph(profiles, { includeOtherParents, ...relationshipOptions(gameData) });
  variants.set(includeOtherParents, { key, graph });
  return graph;
}

module.exports = { getCachedKinshipGraph, getTargetedKinshipGraph, revisionKey, currentDirectParentFilter, currentPublicParentFilter, isCurrentDirectParentEvidence, isCurrentSiblingRow };
