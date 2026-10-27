"use strict";

const { resolveLifeStatus } = require("./character-temporal-facts");
const { inferGenderFromPronoun } = require("../game-data/character");

function values(value) {
  if (Array.isArray(value)) return value;
  return value === null || value === undefined || value === "" ? [] : [value];
}

function positiveRuntimeId(value) {
  const raw = value && typeof value === "object" ? value.id ?? value.characterId : value;
  const numeric = Number(raw);
  return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : null;
}

function currentSourceSnapshotId(gameData = {}) {
  const date = typeof gameData.date === "string" ? gameData.date.trim() : "";
  const rawDays = gameData.totalDays;
  const totalDays = typeof rawDays === "number" || typeof rawDays === "string" && rawDays.trim()
    ? Number(rawDays) : NaN;
  return date && Number.isFinite(totalDays) && totalDays >= 0 ? `${date}/${totalDays}` : null;
}

function containsCharacter(gameData = {}, runtimeId) {
  const characters = gameData.characters;
  if (characters instanceof Map) return characters.has(runtimeId) || characters.has(String(runtimeId)) || characters.has(Number(runtimeId));
  return !!(characters && (Object.hasOwn(characters, runtimeId) || Object.hasOwn(characters, String(runtimeId))));
}

function characterByRuntimeId(gameData = {}, runtimeId) {
  const characters = gameData.characters;
  return characters instanceof Map
    ? characters.get(runtimeId) ?? characters.get(String(runtimeId)) ?? characters.get(Number(runtimeId))
    : characters?.[runtimeId] ?? characters?.[String(runtimeId)];
}

function sameSourceRecord(left, right) {
  return positiveRuntimeId(left) === positiveRuntimeId(right)
    && ["name", "source", "sourceOwnerId", "relatedCharacterId", "observerRuntimeId", "sourceRelation", "relationType",
      "evidenceScope", "publicStatus", "knowledgeStatus", "historicalStatus", "campaignToken", "sourceSnapshotId",
      "evidenceConflict", "targetBound"].every(field => left?.[field] === right?.[field]);
}

function hasCurrentOwnerSpouseRecord(gameData, ownerId, relatedCharacterId, targetId, sourceRelation, record) {
  const owner = characterByRuntimeId(gameData, ownerId);
  if (sourceRelation === "parents.spouses") {
    return hasCurrentDirectParentOwnerRecord(gameData, ownerId, relatedCharacterId, targetId);
  }
  const field = sourceRelation === "kids.spouses" ? "children"
    : sourceRelation === "siblings.spouses" ? "siblings"
      : sourceRelation === "spouses" ? "spouses" : null;
  if (!field) return false;
  if (field === "spouses") {
    return Array.isArray(owner?.spouses) && owner.spouses.some(item => sameSourceRecord(item, record));
  }
  return Array.isArray(owner?.[field]) && owner[field].some(relative => positiveRuntimeId(relative) === relatedCharacterId
    && Array.isArray(relative.spouses) && relative.spouses.some(item => sameSourceRecord(item, record)));
}

function hasCurrentOwnerFormerSpouseRecord(gameData, ownerId, targetId, record) {
  const owner = characterByRuntimeId(gameData, ownerId);
  return Array.isArray(owner?.formerSpouses) && owner.formerSpouses.some(item => positiveRuntimeId(item) === targetId
    && sameSourceRecord(item, record));
}

function hasCurrentDirectParentOwnerRecord(gameData, ownerId, parentId, spouseId) {
  const characters = gameData?.characters;
  const owner = characters instanceof Map
    ? characters.get(ownerId) ?? characters.get(String(ownerId))
    : characters?.[ownerId] ?? characters?.[String(ownerId)];
  const campaignToken = gameData?.campaignToken;
  const snapshotId = currentSourceSnapshotId(gameData);
  return Array.isArray(owner?.parents) && owner.parents.some(parent => positiveRuntimeId(parent) === parentId
    && parent?.source === "CK3_DIRECT_PARENT"
    && positiveRuntimeId(parent.sourceOwnerId) === ownerId
    && positiveRuntimeId(parent.childId) === ownerId
    && parent.relationType === "parent"
    && parent.sourceRelation === "parents"
    && parent.publicStatus === "PUBLIC_LEGAL_PARENT"
    && parent.knowledgeStatus === "UNKNOWN"
    && parent.evidenceConflict !== true
    && parent.campaignToken === campaignToken
    && parent.sourceSnapshotId === snapshotId
    && Array.isArray(parent.spouses) && parent.spouses.some(spouse => positiveRuntimeId(spouse) === spouseId
      && spouse?.relationType === "CURRENT_SPOUSE"
      && spouse.source === "CK3_PARENT_SPOUSE"
      && positiveRuntimeId(spouse.parentId) === parentId
      && positiveRuntimeId(spouse.relatedCharacterId) === parentId
      && positiveRuntimeId(spouse.sourceOwnerId) === ownerId
      && positiveRuntimeId(spouse.observerRuntimeId) === ownerId
      && spouse.sourceRelation === "parents.spouses"
      && spouse.evidenceScope === "SOURCE_OWNER_RECORD_ONLY"
      && spouse.publicStatus === "PUBLIC_LEGAL_MARRIAGE"
      && spouse.knowledgeStatus === "UNKNOWN"
      && spouse.evidenceConflict !== true
      && spouse.campaignToken === campaignToken
      && spouse.sourceSnapshotId === snapshotId));
}

function hasCurrentRelationshipSource(record, context, gameData, { source, sourceRelation, relationType, publicStatus } = {}) {
  if (!record || typeof record !== "object" || !context || !gameData) return false;
  const ownerId = positiveRuntimeId(context.sourceOwnerId ?? context.ownerId);
  const targetId = positiveRuntimeId(context.targetId ?? context.spouseId ?? context.betrothedId ?? record.id);
  const sourceOwnerId = positiveRuntimeId(record.sourceOwnerId);
  const campaignToken = gameData.campaignToken;
  const snapshotId = currentSourceSnapshotId(gameData);
  return ownerId !== null && targetId !== null && sourceOwnerId === ownerId && ownerId !== targetId
    && positiveRuntimeId(record.id) === targetId
    && record.source === source && record.sourceRelation === sourceRelation && record.relationType === relationType
    && record.publicStatus === publicStatus && record.knowledgeStatus === "UNKNOWN"
    && record.evidenceConflict === false && typeof record.targetBound === "boolean"
    && typeof campaignToken === "string" && campaignToken.length > 0 && record.campaignToken === campaignToken
    && snapshotId !== null && record.sourceSnapshotId === snapshotId
    && String(record.name || "").trim().length > 0
    && record.targetBound === containsCharacter(gameData, targetId);
}

function isCurrentFormerSpouseEvidence(record, context = {}, gameData = {}) {
  const ownerId = positiveRuntimeId(context.sourceOwnerId ?? context.ownerId);
  const targetId = positiveRuntimeId(context.targetId ?? context.spouseId ?? record?.id);
  return record?.historicalStatus === "FORMER"
    && ownerId !== null && targetId !== null && hasCurrentOwnerFormerSpouseRecord(gameData, ownerId, targetId, record)
    && hasCurrentRelationshipSource(record, { ...context, sourceOwnerId: ownerId, targetId }, gameData, {
    source: "CK3_FORMER_SPOUSE",
    sourceRelation: "formerSpouses",
    relationType: "FORMER_SPOUSE",
    publicStatus: "FORMER_SPOUSE"
  });
}

function isCurrentSpouseEvidence(record, context = {}, gameData = {}) {
  const sourceRelation = context.sourceRelation ?? record?.sourceRelation;
  const ownerId = positiveRuntimeId(context.sourceOwnerId ?? context.ownerId);
  const relatedCharacterId = positiveRuntimeId(context.relatedCharacterId ?? record?.relatedCharacterId);
  const targetId = positiveRuntimeId(context.targetId ?? record?.id);
  const parentSpouse = sourceRelation === "parents.spouses";
  const expectedSource = parentSpouse ? "CK3_PARENT_SPOUSE" : "CK3_GAME_CURRENT_SPOUSE";
  const sourcePathAllowed = ["spouses", "kids.spouses", "siblings.spouses", "parents.spouses"].includes(sourceRelation);
  return sourcePathAllowed
    && ownerId !== null && relatedCharacterId !== null
    && (sourceRelation === "spouses" || relatedCharacterId !== ownerId && relatedCharacterId !== targetId)
    && (sourceRelation === "spouses" ? relatedCharacterId === ownerId
      : parentSpouse ? positiveRuntimeId(record?.parentId) === relatedCharacterId
        : true)
    && positiveRuntimeId(record?.relatedCharacterId) === relatedCharacterId
    && positiveRuntimeId(record?.observerRuntimeId) === ownerId
    && record?.evidenceScope === "SOURCE_OWNER_RECORD_ONLY"
    && hasCurrentOwnerSpouseRecord(gameData, ownerId, relatedCharacterId, targetId, sourceRelation, record)
    && hasCurrentRelationshipSource(record, { ...context, sourceOwnerId: ownerId, targetId: context.targetId ?? record?.id }, gameData, {
      source: expectedSource,
      sourceRelation,
      relationType: "CURRENT_SPOUSE",
      publicStatus: "PUBLIC_LEGAL_MARRIAGE"
    });
}

function isCurrentBetrothalEvidence(record, context = {}, gameData = {}) {
  const sourceRelation = context.sourceRelation ?? record?.sourceRelation;
  const sourceOwnerId = positiveRuntimeId(context.sourceOwnerId ?? context.ownerId);
  const relatedCharacterId = positiveRuntimeId(context.relatedCharacterId ?? record?.relatedCharacterId);
  const targetId = positiveRuntimeId(context.targetId ?? context.betrothedId ?? record?.id);
  const relativeField = sourceRelation === "kids.betrothed" ? "children" : sourceRelation === "siblings.betrothed" ? "siblings" : null;
  const owner = sourceOwnerId === null ? null : characterByRuntimeId(gameData, sourceOwnerId);
  const relatives = relativeField && Array.isArray(owner?.[relativeField])
    ? owner[relativeField].filter(item => positiveRuntimeId(item) === relatedCharacterId) : [];
  const relative = relatives[0];
  const betrothalProofFields = ["id", "name", "sheHe", "gender", "genderSource", "relationType", "source", "sourceOwnerId",
    "relatedCharacterId", "observerRuntimeId", "sourceRelation", "evidenceScope", "publicStatus", "knowledgeStatus",
    "campaignToken", "sourceSnapshotId", "evidenceConflict", "targetBound"];
  const sameBetrothalProof = candidate => candidate && record
    && betrothalProofFields.every(field => candidate[field] === record[field])
    && positiveRuntimeId(candidate) === targetId
    && positiveRuntimeId(candidate.relatedCharacterId) === relatedCharacterId;
  const betrothalProofSignatures = new Set(relatives.map(item => item?.betrothed
    ? JSON.stringify(betrothalProofFields.map(field => item.betrothed[field] ?? null))
    : "NO_BETROTHAL_RECORD"));
  const ownerRecordMatches = relatives.length > 0 && betrothalProofSignatures.size === 1
    && relatives.every(item => sameBetrothalProof(item?.betrothed));
  const hasSiblingAgeProof = sibling => sibling?.ageSource === "CK3_LIVE_RELATIVE_AGE"
    && Number.isSafeInteger(sibling.age) && sibling.age >= 0
    && Array.isArray(sibling.evidence?.age) && sibling.evidence.age.some(evidence => evidence?.ageSource === "CK3_LIVE_RELATIVE_AGE"
      && evidence.value === sibling.age
      && positiveRuntimeId(evidence.sourceOwnerId) === sourceOwnerId
      && evidence.relationType === "sibling"
      && evidence.source === `${sourceOwnerId}.siblings`
      && evidence.campaignToken === gameData.campaignToken
      && evidence.sourceSnapshotId === currentSourceSnapshotId(gameData));
  const siblingAgeSignatures = new Set(relatives.map(sibling => JSON.stringify([sibling.age, sibling.ageSource,
    ...(sibling.evidence?.age || []).map(evidence => [evidence.value, evidence.ageSource, evidence.sourceOwnerId,
      evidence.relationType, evidence.source, evidence.campaignToken, evidence.sourceSnapshotId])])));
  const siblingAgeProof = sourceRelation !== "siblings.betrothed" || relatives.length > 0
    && relatives.every(hasSiblingAgeProof) && siblingAgeSignatures.size === 1;
  return ["kids.betrothed", "siblings.betrothed"].includes(sourceRelation)
    && sourceOwnerId !== null
    && relatedCharacterId !== null && relatedCharacterId !== sourceOwnerId
    && targetId !== null && targetId !== relatedCharacterId
    && ownerRecordMatches && siblingAgeProof
    && positiveRuntimeId(record?.relatedCharacterId) === relatedCharacterId
    && record?.observerRuntimeId !== null
    && positiveRuntimeId(record?.observerRuntimeId) === sourceOwnerId
    && record?.evidenceScope === "SOURCE_OWNER_RECORD_ONLY"
    && hasCurrentRelationshipSource(record, { ...context, sourceOwnerId, targetId }, gameData, {
      source: "CK3_CURRENT_BETROTHAL",
      sourceRelation,
      relationType: "BETROTHED",
      publicStatus: "CURRENT_BETROTHAL"
    })
    && validBetrothalTargetSex(record);
}

function currentFormerSpouseEvidenceFilter(gameData = {}) {
  return (record, context = {}) => isCurrentFormerSpouseEvidence(record, context, gameData);
}

function currentBetrothalEvidenceFilter(gameData = {}) {
  return (record, context = {}) => isCurrentBetrothalEvidence(record, context, gameData);
}

function currentSpouseEvidenceFilter(gameData = {}) {
  return (record, context = {}) => isCurrentSpouseEvidence(record, context, gameData);
}

function validBetrothalTargetSex(record) {
  if (record?.gender === "unknown") return !record.genderSource || record.genderSource === "CK3_LIVE_RELATIVE";
  return (record?.gender === "male" || record?.gender === "female")
    && record.genderSource === "CK3_LIVE_RELATIVE"
    && inferGenderFromPronoun(record.sheHe) === record.gender;
}

function normalizeRecord(value, relationType, source, allowPrimitiveId) {
  const object = value && typeof value === "object" ? value : null;
  const rawId = object?.id ?? object?.characterId ?? (allowPrimitiveId ? value : null);
  const numericId = Number(rawId);
  const runtimeId = rawId !== null && rawId !== undefined && rawId !== "" && Number.isFinite(numericId) ? numericId : null;
  const name = String(object?.fullName || object?.shortName || object?.firstName || object?.name || (object || runtimeId !== null ? "" : value) || "").trim() || null;
  const hasDeathTotalDays = object?.deathDateTotalDays !== null && object?.deathDateTotalDays !== undefined && object?.deathDateTotalDays !== "" && Number.isFinite(Number(object.deathDateTotalDays));
  const lifeStatus = object ? resolveLifeStatus(object) : null;
  const deceased = lifeStatus?.alive === false;
  const normalizedRelationType = relationType === "FORMER_SPOUSE"
    ? "FORMER_SPOUSE"
    : relationType === "DECEASED_SPOUSE" || deceased
      ? "DECEASED_SPOUSE"
      : relationType;
  return {
    runtimeId,
    name,
    relationType: normalizedRelationType,
    alive: lifeStatus?.conflict ? null : deceased ? false : object?.alive ?? null,
    deathDate: object?.deathDate || null,
    deathDateTotalDays: hasDeathTotalDays ? Number(object.deathDateTotalDays) : null,
    source,
    confidence: runtimeId === null ? 0.4 : 1,
    raw: object || value
  };
}

function normalizeSpouseRecords(character = {}, { preserveEvidenceVariants = false } = {}) {
  const records = [];
  const add = (value, relationType, source, allowPrimitiveId = true) => {
    for (const item of values(value)) {
      const record = normalizeRecord(item, relationType, source, allowPrimitiveId);
      if (!record.name && record.runtimeId === null) continue;
      const proof = preserveEvidenceVariants && record.raw && typeof record.raw === "object"
        ? JSON.stringify(["source", "sourceOwnerId", "relatedCharacterId", "observerRuntimeId", "sourceRelation", "relationType",
          "evidenceScope", "publicStatus", "knowledgeStatus", "historicalStatus", "campaignToken", "sourceSnapshotId",
          "evidenceConflict", "targetBound", "parentId", "gender", "genderSource", "sheHe"].map(field => record.raw[field] ?? null))
        : "";
      const key = `${record.runtimeId ?? "name"}:${record.name || ""}:${record.relationType}:${proof}`;
      if (!records.some((entry) => entry.key === key)) records.push({ ...record, key });
    }
  };
  add(character.spouses, "CURRENT_SPOUSE", "spouses");
  add(character.spouse, "CURRENT_SPOUSE", "spouse");
  add(character.formerSpouses, "FORMER_SPOUSE", "formerSpouses");
  add(character.deceasedSpouses, "DECEASED_SPOUSE", "deceasedSpouses");
  add(character.consort, "UNKNOWN_CONSORT", "consort", false);
  return records.map(({ key, ...record }) => record);
}

module.exports = {
  normalizeSpouseRecords,
  currentSourceSnapshotId,
  isCurrentFormerSpouseEvidence,
  isCurrentBetrothalEvidence,
  isCurrentSpouseEvidence,
  currentFormerSpouseEvidenceFilter,
  currentBetrothalEvidenceFilter,
  currentSpouseEvidenceFilter
};
