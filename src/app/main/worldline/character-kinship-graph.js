"use strict";

const { resolveCharacterSexConsensus } = require("./character-demographic-normalizer");
const { resolveLifeStatus } = require("./character-temporal-facts");
const { resolveKinshipLabel } = require("./kinship-label-resolver");
const { normalizeSpouseRecords } = require("./canonical-spouse-record");
const { compareCharacterSeniority } = require("./character-age-service");

function id(value) {
  const raw = value && typeof value === "object" ? value.id ?? value.characterId : value;
  return raw === null || raw === undefined || raw === "" ? null : String(raw);
}

function positiveRuntimeId(value) {
  const raw = value && typeof value === "object" ? value.id ?? value.characterId : value;
  const numeric = Number(raw);
  return Number.isSafeInteger(numeric) && numeric > 0 ? String(numeric) : null;
}

function createOtherParentEvidence(value, defaults = {}) {
  const expectedChildId = positiveRuntimeId(defaults.childId);
  const suppliedChildId = value?.childId === null || value?.childId === undefined ? null : positiveRuntimeId(value.childId);
  const childId = suppliedChildId || expectedChildId;
  const parentId = positiveRuntimeId(value?.parentId ?? value?.otherParentId ?? value?.otherParent ?? value?.id ?? defaults.parentId);
  const expectedOwnerId = positiveRuntimeId(defaults.sourceOwnerId);
  const suppliedOwnerId = value?.sourceOwnerId === null || value?.sourceOwnerId === undefined ? null : positiveRuntimeId(value.sourceOwnerId);
  const sourceOwnerId = suppliedOwnerId || expectedOwnerId;
  const sourceRelation = value?.sourceRelation ?? defaults.sourceRelation;
  const allowedSourceRelations = new Set(["kids.otherParent", "siblings.otherParent"]);
  if ((expectedChildId && childId !== expectedChildId) || (expectedOwnerId && sourceOwnerId !== expectedOwnerId)) return null;
  if (value?.childId !== null && value?.childId !== undefined && !suppliedChildId
    || value?.sourceOwnerId !== null && value?.sourceOwnerId !== undefined && !suppliedOwnerId) return null;
  if (value?.relationType && value.relationType !== "parent") return null;
  if (value?.source && value.source !== "CK3_OTHER_PARENT") return null;
  if (!allowedSourceRelations.has(sourceRelation)
    || defaults.sourceRelation && sourceRelation !== defaults.sourceRelation) return null;
  if (!childId || !parentId || !sourceOwnerId || childId === parentId) return null;
  const pick = (field) => value?.[field] ?? defaults[field] ?? null;
  const parentName = value?.parentName ?? value?.name ?? defaults.parentName ?? null;
  const parentGender = value?.parentGender ?? defaults.parentGender;
  return {
    childId,
    parentId,
    otherParentId: parentId,
    parentName: typeof parentName === "string" && parentName.trim() ? parentName : null,
    parentGender: parentGender === "male" || parentGender === "female" ? parentGender : "unknown",
    sourceOwnerId,
    relationType: "parent",
    source: "CK3_OTHER_PARENT",
    sourceRelation,
    publicStatus: pick("publicStatus") === "PUBLIC_LEGAL_PARENT" ? "PUBLIC_LEGAL_PARENT" : "UNKNOWN",
    knowledgeStatus: "UNKNOWN",
    campaignId: pick("campaignId"),
    campaignToken: pick("campaignToken"),
    sourceSnapshotId: pick("sourceSnapshotId"),
    checkpointId: pick("checkpointId"),
    evidenceConflict: value?.evidenceConflict === true
  };
}

function mergeParentEvidence(edge, incoming) {
  if (!Array.isArray(incoming) || incoming.length === 0) return;
  if (!Array.isArray(edge.parentEvidence)) edge.parentEvidence = [];
  for (const evidence of incoming) {
    const key = JSON.stringify(evidence);
    if (!edge.parentEvidence.some((item) => JSON.stringify(item) === key)) edge.parentEvidence.push(evidence);
    if (evidence?.evidenceConflict === true) edge.parentEvidenceConflict = true;
  }
  const publicStatuses = new Set(edge.parentEvidence.map((item) => item.publicStatus).filter((status) => status !== "UNKNOWN"));
  if (publicStatuses.size > 1) edge.parentEvidenceConflict = true;
}

function values(value) {
  if (Array.isArray(value)) return value;
  return value === null || value === undefined || value === "" ? [] : [value];
}

function explicitRelationshipKind(value) {
  if (!value || typeof value !== "object") return null;
  const marker = [value.relationshipKind, value.parentage, value.parentType, value.kinshipType, value.kind]
    .find(item => typeof item === "string" && item.trim());
  const normalized = String(marker || "").trim().toUpperCase().replace(/[\s-]+/g, "_");
  if (normalized.includes("ADOPT")) return "ADOPTIVE";
  if (normalized.includes("STEP")) return "STEP";
  if (normalized.includes("BIOLOG")) return "BIOLOGICAL";
  return null;
}

function relationshipDetails(value, details = {}) {
  const relationshipKind = explicitRelationshipKind(value);
  return relationshipKind ? { ...details, relationshipKind } : details;
}

function createCharacterMap(source) {
  if (source instanceof Map) return new Map([...source].map(([key, value]) => [String(key), value]));
  const characters = source?.characters && typeof source.characters === "object" ? source.characters : source;
  return new Map(Object.entries(characters || {}).map(([key, value]) => [String(key), value]));
}

function buildKinshipGraphInternal(source = {}, { includeOtherParents = true, otherParentEvidenceFilter = null, directParentEvidenceFilter = null, siblingEvidenceFilter = null,
  currentSpouseEvidenceFilter = null, formerSpouseEvidenceFilter = null, betrothalEvidenceFilter = null,
  allowUnverifiedFormerSpouses = false, allowedNodeIds = null, deriveExtendedRelations = true } = {}) {
  const allowedIds = allowedNodeIds instanceof Set ? new Set([...allowedNodeIds].map(String)) : null;
  const sourceCharacters = createCharacterMap(source);
  const characters = allowedIds
    ? new Map([...sourceCharacters].filter(([characterId]) => allowedIds.has(String(characterId))))
    : sourceCharacters;
  const nodes = new Map(characters);
  const edges = [];
  const edgeKeys = new Set();
  const edgeByKey = new Map();
  const outgoingEdges = new Map();
  const incomingEdges = new Map();
  const diagnosticKeys = new Set();
  const diagnostics = [];
  const rejectedParentPairs = new Map();
  const parentPairKey = (parentId, childId) => `${String(parentId)}:${String(childId)}`;
  const unorderedPairKey = (left, right) => [String(left), String(right)].sort().join(":");
  const rejectedSpousePairs = new Set();
  const rejectedSiblingPairs = new Set();
  const spouseProofsByOwnerPair = new Map();
  const rejectedBetrothalPairs = new Set();
  const rejectedBetrothalTargetsBySubject = new Map();
  const rejectBetrothalClaim = (subjectId, targetId) => {
    const subject = String(subjectId);
    const target = String(targetId);
    rejectedBetrothalPairs.add(unorderedPairKey(subject, target));
    if (!rejectedBetrothalTargetsBySubject.has(subject)) rejectedBetrothalTargetsBySubject.set(subject, new Set());
    rejectedBetrothalTargetsBySubject.get(subject).add(target);
  };
  const rejectParentEvidence = (parentId, childId, sourcePath) => {
    const normalizedParentId = positiveRuntimeId(parentId);
    const normalizedChildId = positiveRuntimeId(childId);
    if (!normalizedParentId || !normalizedChildId || normalizedParentId === normalizedChildId) return;
    const key = parentPairKey(normalizedParentId, normalizedChildId);
    if (!rejectedParentPairs.has(key)) rejectedParentPairs.set(key, new Set());
    rejectedParentPairs.get(key).add(sourcePath || "unknown");
  };
  const acceptsParentEvidence = (record, context) => {
    if (typeof directParentEvidenceFilter !== "function") return true;
    const accepted = directParentEvidenceFilter(record, context);
    if (!accepted) rejectParentEvidence(context.parentId, context.childId, context.sourcePath);
    return accepted;
  };
  const directParentProof = (childId, parentId, sourcePath, sourceRecord = null) => {
    const candidates = [];
    const candidateKeys = new Set();
    const addCandidate = (record) => {
      if (!record || typeof record !== "object") return;
      const key = JSON.stringify(record);
      if (candidateKeys.has(key)) return;
      candidateKeys.add(key);
      candidates.push(record);
    };
    addCandidate(sourceRecord);
    const child = characters.get(String(childId));
    const childParents = Array.isArray(child?.parents) ? child.parents
      : [child?.parents?.father ?? child?.father, child?.parents?.mother ?? child?.mother].filter(Boolean);
    for (const record of childParents) {
      if (positiveRuntimeId(record) === Number(parentId) && explicitRelationshipKind(record) !== "STEP") {
        addCandidate(record?.directParentEvidence || record);
      }
    }
    const parent = characters.get(String(parentId));
    for (const evidence of parent?.evidence?.relations || []) {
      if (positiveRuntimeId(evidence?.ownerId) === Number(childId) && evidence?.relationType === "parent") {
        addCandidate(evidence.directParentEvidence || evidence);
      }
    }
    for (const evidence of child?.evidence?.relations || []) {
      if (positiveRuntimeId(evidence?.ownerId) === Number(parentId) && evidence?.directParentEvidence) {
        addCandidate(evidence.directParentEvidence);
      }
    }
    if (typeof directParentEvidenceFilter !== "function") {
      const hasUnverifiedSourceEvidence = candidates.some((record) => [
        "source", "sourceRelation", "sourceOwnerId", "childId", "campaignToken", "sourceSnapshotId",
        "publicStatus", "knowledgeStatus", "evidenceConflict"
      ].some((field) => Object.hasOwn(record, field)));
      if (hasUnverifiedSourceEvidence) rejectParentEvidence(parentId, childId, sourcePath);
      return { accepted: !hasUnverifiedSourceEvidence, conflict: hasUnverifiedSourceEvidence, evidence: [] };
    }
    const evidence = [];
    let conflict = false;
    for (const record of candidates) {
      if (acceptsParentEvidence(record, { childId, parentId, sourcePath, direction: "parent" })) evidence.push(record);
      else conflict = true;
    }
    return { accepted: evidence.length > 0 && !conflict, conflict, evidence };
  };
  const ensureNode = (value) => {
    const key = id(value);
    if (!key) return null;
    if (allowedIds && !allowedIds.has(key)) return null;
    if (!nodes.has(key)) nodes.set(key, value && typeof value === "object" ? { ...value, id: key, partial: true } : { id: key, partial: true });
    else if (value && typeof value === "object") nodes.set(key, { ...value, ...nodes.get(key), id: key });
    return key;
  };
  const add = (from, to, type, relationPath, confidence = 1, details = {}) => {
    const fromId = ensureNode(from);
    const toId = ensureNode(to);
    if (!fromId || !toId || fromId === toId) return;
    const key = `${fromId}:${toId}:${type}`;
    if (edgeKeys.has(key)) {
      const existing = edgeByKey.get(key);
      mergeParentEvidence(existing, details.parentEvidence);
      if (existing && Array.isArray(details.betrothalSources)) {
        const sources = [...(existing.betrothalSources || []), ...details.betrothalSources];
        existing.betrothalSources = [...new Map(sources.map(item => [JSON.stringify(item), item])).values()];
      }
      if (existing && details.branch && existing.branch && existing.branch !== details.branch) existing.branchConflict = true;
      if (existing && details.branch && !existing.branch) existing.branch = details.branch;
      const incomingKind = details.relationshipKind || null;
      if (existing && incomingKind) {
        if (Array.isArray(existing.relationshipKindConflict)) {
          existing.relationshipKindConflict = [...new Set([...existing.relationshipKindConflict, incomingKind])];
        } else if (!existing.relationshipKind) {
          existing.relationshipKind = incomingKind;
        } else if (existing.relationshipKind !== incomingKind) {
          existing.relationshipKindConflict = [existing.relationshipKind, incomingKind];
          delete existing.relationshipKind;
        }
      }
      return;
    }
    edgeKeys.add(key);
    const edge = { from: fromId, to: toId, type, source: details.source || "SNAPSHOT_DIRECT", relationPath, confidence, ...details };
    edges.push(edge);
    edgeByKey.set(key, edge);
    if (!outgoingEdges.has(fromId)) outgoingEdges.set(fromId, []);
    if (!incomingEdges.has(toId)) incomingEdges.set(toId, []);
    outgoingEdges.get(fromId).push(edge);
    incomingEdges.get(toId).push(edge);
  };
  const recordSpouseProof = (ownerId, relatedId, spouse, isFormer) => {
    const raw = spouse.raw && typeof spouse.raw === "object" ? spouse.raw : {};
    const pairKey = unorderedPairKey(relatedId, spouse.runtimeId);
    const proofKey = `${String(ownerId)}:${pairKey}:${isFormer ? "FORMER" : "CURRENT"}`;
    const signature = JSON.stringify([raw.id, raw.name, raw.sheHe, raw.gender, raw.genderSource, raw.source,
      raw.sourceOwnerId, raw.relatedCharacterId, raw.observerRuntimeId, raw.sourceRelation, raw.relationType,
      raw.evidenceScope, raw.publicStatus, raw.knowledgeStatus, raw.historicalStatus, raw.campaignToken,
      raw.sourceSnapshotId, raw.evidenceConflict, raw.targetBound]);
    if (!spouseProofsByOwnerPair.has(proofKey)) spouseProofsByOwnerPair.set(proofKey, { pairKey, signatures: new Set() });
    spouseProofsByOwnerPair.get(proofKey).signatures.add(signature);
  };
  const addCurrentSpouseEdges = (ownerId, relatedId, relative, sourceRelation) => {
    if (typeof currentSpouseEvidenceFilter !== "function") return;
    const records = normalizeSpouseRecords(relative, { preserveEvidenceVariants: true });
    for (const spouse of records) {
      if (spouse.relationType !== "CURRENT_SPOUSE" || spouse.runtimeId === null) continue;
      const spouseContext = { ownerId, sourceOwnerId: ownerId, relatedCharacterId: relatedId,
        targetId: spouse.runtimeId, spouseId: spouse.runtimeId, sourceRelation };
      if (!currentSpouseEvidenceFilter(spouse.raw, spouseContext, source)) {
        rejectedSpousePairs.add(unorderedPairKey(relatedId, spouse.runtimeId));
        continue;
      }
      recordSpouseProof(ownerId, relatedId, spouse, false);
      const spouseId = ensureNode(spouse.raw && typeof spouse.raw === "object" ? spouse.raw : spouse.runtimeId);
      if (!spouseId) continue;
      const relatedLife = resolveLifeStatus(relative);
      const spouseLife = resolveLifeStatus(nodes.get(spouseId) || spouse.raw || {});
      const type = relatedLife.alive === false ? "DECEASED_SPOUSE_OF" : "SPOUSE_OF";
      const reverseType = spouseLife.alive === false ? "DECEASED_SPOUSE_OF" : "SPOUSE_OF";
      const details = { source: spouse.raw?.source, sourceOwnerId: String(ownerId),
        relatedCharacterId: String(relatedId), sourceRelation, sourceSnapshotId: spouse.raw?.sourceSnapshotId || null,
        campaignToken: spouse.raw?.campaignToken || null, knowledgeStatus: "UNKNOWN" };
      add(relatedId, spouseId, type, [relatedId, spouseId], spouse.confidence, details);
      add(spouseId, relatedId, reverseType, [spouseId, relatedId], spouse.confidence, details);
    }
  };
  const addOtherParent = (value, defaults = {}) => {
    const evidence = createOtherParentEvidence(value, defaults);
    if (!evidence || typeof otherParentEvidenceFilter !== "function" || !otherParentEvidenceFilter(evidence, value)) {
      rejectParentEvidence(value?.parentId ?? value?.otherParentId ?? value?.id ?? defaults.parentId,
        value?.childId ?? defaults.childId, defaults.sourceRelation);
      return;
    }
    const parentId = ensureNode({ id: evidence.parentId, name: evidence.parentName, gender: evidence.parentGender });
    const childId = ensureNode(evidence.childId);
    if (!parentId || !childId) return;
    const details = { source: evidence.source, parentEvidence: [evidence] };
    add(parentId, childId, "PARENT_OF", [parentId, childId], 1, details);
    add(childId, parentId, "CHILD_OF", [childId, parentId], 1, details);
  };
  for (const [characterId, character] of characters) {
    const sourceOwnerId = positiveRuntimeId(character?.id ?? characterId);
    const parentEntries = Array.isArray(character?.parents)
      ? character.parents.map((parent) => ({ parent, branch: null }))
      : [{ parent: character?.parents?.father ?? character?.father, branch: "PATERNAL" }, { parent: character?.parents?.mother ?? character?.mother, branch: "MATERNAL" }];
    for (const { parent, branch } of parentEntries.filter((entry) => entry.parent)) {
      if (explicitRelationshipKind(parent) === "STEP") continue;
      const expectedParentId = positiveRuntimeId(parent);
      const childId = sourceOwnerId || positiveRuntimeId(characterId);
      const proof = directParentProof(childId, expectedParentId, "parents", parent?.directParentEvidence || parent);
      if (!proof.accepted) continue;
      const parentNodeId = ensureNode(parent);
      if (!parentNodeId) continue;
      const details = relationshipDetails(parent, {
        branch,
        ...(directParentEvidenceFilter ? { parentEvidence: proof.evidence.map((item) => ({ ...item,
          id: item.id ?? parentNodeId, parentId: item.parentId ?? parentNodeId, childId: item.childId ?? childId })) } : {})
      });
      add(parentNodeId, characterId, "PARENT_OF", [parentNodeId, characterId], 1, details);
      add(characterId, parentNodeId, "CHILD_OF", [characterId, parentNodeId], 1, details);
    }
    for (const child of values(character?.children)) {
      const childId = ensureNode(child);
      if (!childId) continue;
      addCurrentSpouseEdges(sourceOwnerId ?? positiveRuntimeId(characterId), positiveRuntimeId(childId), child, "kids.spouses");
      const proof = child?.directParentEvidence || child?.parentEvidence || null;
      const directProof = directParentProof(positiveRuntimeId(childId), sourceOwnerId || positiveRuntimeId(characterId), "children", proof);
      if (directProof.accepted) {
        const details = relationshipDetails(child, { ...(directParentEvidenceFilter ? { parentEvidence: directProof.evidence.map((item) => ({ ...item,
          id: item.id ?? sourceOwnerId, parentId: item.parentId ?? sourceOwnerId, childId: item.childId ?? childId })) } : {}) });
        add(characterId, childId, "PARENT_OF", [characterId, childId], 1, details);
        add(childId, characterId, "CHILD_OF", [childId, characterId], 1, details);
      }
      if (includeOtherParents) {
        addOtherParent(child?.otherParent, {
          childId,
          sourceOwnerId,
          sourceRelation: "kids.otherParent",
          parentName: child?.otherParent?.name,
          campaignId: child?.otherParent?.campaignId ?? character?.campaignId,
          campaignToken: child?.otherParent?.campaignToken ?? character?.campaignToken,
          sourceSnapshotId: child?.otherParent?.sourceSnapshotId ?? character?.sourceSnapshotId,
          checkpointId: child?.otherParent?.checkpointId ?? character?.checkpointId,
          publicStatus: child?.otherParent?.publicStatus,
          parentGender: child?.otherParent?.parentGender
        });
      }
    }
    for (const sibling of values(character?.siblings)) {
      if (typeof siblingEvidenceFilter === "function" && !siblingEvidenceFilter(sibling, characterId)) {
        // A legacy, unmarked row is not evidence either way. It cannot cancel
        // a separately verified shared-parent relationship.
        if (sibling?.evidence?.age?.length || explicitRelationshipKind(sibling) || sibling?.evidenceConflict === true) {
          rejectedSiblingPairs.add(unorderedPairKey(characterId, id(sibling)));
        }
        continue;
      }
      const siblingId = ensureNode(sibling);
      if (!siblingId) continue;
      addCurrentSpouseEdges(sourceOwnerId ?? positiveRuntimeId(characterId), positiveRuntimeId(siblingId), sibling, "siblings.spouses");
      add(characterId, siblingId, "SIBLING_OF", [characterId, siblingId], 1, { source: "LOG_DIRECT" });
      add(siblingId, characterId, "SIBLING_OF", [siblingId, characterId], 1, { source: "LOG_DIRECT" });
      if (includeOtherParents) {
        addOtherParent(sibling?.otherParent, {
          childId: siblingId,
          sourceOwnerId,
          sourceRelation: "siblings.otherParent",
          parentName: sibling?.otherParent?.name,
          campaignId: sibling?.otherParent?.campaignId ?? character?.campaignId,
          campaignToken: sibling?.otherParent?.campaignToken ?? character?.campaignToken,
          sourceSnapshotId: sibling?.otherParent?.sourceSnapshotId ?? character?.sourceSnapshotId,
          checkpointId: sibling?.otherParent?.checkpointId ?? character?.checkpointId,
          publicStatus: sibling?.otherParent?.publicStatus,
          parentGender: sibling?.otherParent?.parentGender
        });
      }
    }
    const spouseRecords = normalizeSpouseRecords(character, {
      preserveEvidenceVariants: typeof currentSpouseEvidenceFilter === "function" || typeof formerSpouseEvidenceFilter === "function"
    });
    for (const spouse of spouseRecords) {
      if (spouse.runtimeId === null) continue;
      const isFormer = spouse.relationType === "FORMER_SPOUSE";
      const proofOwnerId = positiveRuntimeId(spouse.raw?.sourceOwnerId) ?? sourceOwnerId ?? characterId;
      const spouseContext = {
        ownerId: proofOwnerId,
        sourceOwnerId: proofOwnerId,
        relatedCharacterId: positiveRuntimeId(spouse.raw?.relatedCharacterId) ?? sourceOwnerId ?? positiveRuntimeId(characterId),
        targetId: spouse.runtimeId,
        spouseId: spouse.runtimeId,
        sourceRelation: spouse.raw?.sourceRelation
      };
      const formerAccepted = !isFormer || allowUnverifiedFormerSpouses
        || typeof formerSpouseEvidenceFilter === "function" && formerSpouseEvidenceFilter(spouse.raw, spouseContext, source);
      const currentAccepted = isFormer || typeof currentSpouseEvidenceFilter !== "function"
        || currentSpouseEvidenceFilter(spouse.raw, spouseContext, source);
      if (!formerAccepted || !currentAccepted) {
        rejectedSpousePairs.add(unorderedPairKey(characterId, spouse.runtimeId));
        continue;
      }
      if (isFormer && typeof formerSpouseEvidenceFilter === "function"
        || !isFormer && typeof currentSpouseEvidenceFilter === "function" && spouse.source !== "deceasedSpouses") {
        recordSpouseProof(proofOwnerId,
          positiveRuntimeId(spouse.raw?.relatedCharacterId) ?? sourceOwnerId ?? positiveRuntimeId(characterId), spouse, isFormer);
      }
      const spouseId = ensureNode(spouse.raw && typeof spouse.raw === "object" ? spouse.raw : spouse.runtimeId);
      if (!spouseId) continue;
      const spouseNode = nodes.get(spouseId);
      const characterLife = resolveLifeStatus(character);
      const spouseLife = resolveLifeStatus(spouseNode || spouse.raw || {});
      const type = isFormer ? "FORMER_SPOUSE_OF"
        : characterLife.alive === false ? "DECEASED_SPOUSE_OF" : "SPOUSE_OF";
      const reverseType = isFormer ? "FORMER_SPOUSE_OF"
        : spouse.relationType === "DECEASED_SPOUSE" || spouseLife.alive === false
          ? "DECEASED_SPOUSE_OF"
          : "SPOUSE_OF";
      const spouseEvidence = isFormer ? {
        source: "CK3_FORMER_SPOUSE",
        sourceOwnerId: String(proofOwnerId),
        sourceRelation: "formerSpouses",
        sourceSnapshotId: spouse.raw?.sourceSnapshotId || null,
        campaignToken: spouse.raw?.campaignToken || null,
        knowledgeStatus: "UNKNOWN"
      } : typeof currentSpouseEvidenceFilter === "function" && spouse.source !== "deceasedSpouses" ? {
        source: spouse.raw?.source,
        sourceOwnerId: String(proofOwnerId),
        sourceRelation: spouse.raw?.sourceRelation || null,
        sourceSnapshotId: spouse.raw?.sourceSnapshotId || null,
        campaignToken: spouse.raw?.campaignToken || null,
        knowledgeStatus: "UNKNOWN"
      } : {};
      add(characterId, spouseId, type, [characterId, spouseId], spouse.confidence,
        { source: spouseEvidence.source || (isFormer ? "CK3_FORMER_SPOUSE" : "SNAPSHOT_DIRECT"), ...spouseEvidence });
      add(spouseId, characterId, reverseType, [spouseId, characterId], spouse.confidence,
        { source: spouseEvidence.source || (isFormer ? "CK3_FORMER_SPOUSE" : "SNAPSHOT_DIRECT"), ...spouseEvidence });
    }
    for (const evidence of character?.evidence?.relations || []) {
      const ownerId = ensureNode(evidence.ownerId);
      if (!ownerId) continue;
      if (evidence.relationType === "parent") {
        const parentId = positiveRuntimeId(characterId);
        const childId = positiveRuntimeId(ownerId);
        const proof = directParentProof(childId, parentId, "evidence.relations.parent", evidence.directParentEvidence || evidence);
        if (!proof.accepted) continue;
        const details = relationshipDetails(evidence, { source: evidence.source || "SNAPSHOT_DIRECT",
          ...(directParentEvidenceFilter ? { parentEvidence: proof.evidence.map((item) => ({ ...item,
            id: item.id ?? parentId, parentId: item.parentId ?? parentId, childId: item.childId ?? childId })) } : {}) });
        add(characterId, ownerId, "PARENT_OF", [characterId, ownerId], 1, details);
        add(ownerId, characterId, "CHILD_OF", [ownerId, characterId], 1, details);
      } else if (evidence.relationType === "child") {
        const childId = positiveRuntimeId(characterId);
        const parentId = positiveRuntimeId(ownerId);
        const proof = directParentProof(childId, parentId, "evidence.relations.child", evidence.directParentEvidence || null);
        if (!proof.accepted) continue;
        const details = relationshipDetails(evidence, { source: evidence.source || "SNAPSHOT_DIRECT",
          ...(directParentEvidenceFilter ? { parentEvidence: proof.evidence.map((item) => ({ ...item,
            id: item.id ?? parentId, parentId: item.parentId ?? parentId, childId: item.childId ?? childId })) } : {}) });
        add(characterId, ownerId, "CHILD_OF", [characterId, ownerId], 1, details);
        add(ownerId, characterId, "PARENT_OF", [ownerId, characterId], 1, details);
      } else if (evidence.relationType === "sibling") {
        if (typeof siblingEvidenceFilter === "function") continue;
        add(characterId, ownerId, "SIBLING_OF", [characterId, ownerId], evidence.confidence ?? 1, { source: "LOG_DIRECT", evidenceSource: evidence.source || null });
        add(ownerId, characterId, "SIBLING_OF", [ownerId, characterId], evidence.confidence ?? 1, { source: "LOG_DIRECT", evidenceSource: evidence.source || null });
      }
    }
    if (includeOtherParents) {
      const relationSources = {
        "kids.otherParent": { relationType: "child", field: "children" },
        "siblings.otherParent": { relationType: "sibling", field: "siblings" }
      };
      for (const evidence of character?.evidence?.otherParentRelations || []) {
        const binding = relationSources[evidence?.sourceRelation];
        const evidenceOwnerId = positiveRuntimeId(evidence?.sourceOwnerId);
        const evidenceChildId = positiveRuntimeId(evidence?.childId);
        const evidenceParentId = positiveRuntimeId(evidence?.parentId ?? evidence?.otherParentId ?? evidence?.id);
        if (!binding || evidenceChildId !== sourceOwnerId || !evidenceOwnerId) {
          rejectParentEvidence(evidenceParentId, evidenceChildId, evidence?.sourceRelation);
          continue;
        }
        const expectedSource = `${evidenceOwnerId}.${binding.field}`;
        const relationBound = (character?.evidence?.relations || []).some((item) => Number(item?.ownerId) === Number(evidenceOwnerId)
          && item?.relationType === binding.relationType && item?.source === expectedSource);
        if (!relationBound) {
          rejectParentEvidence(evidenceParentId, evidenceChildId, evidence?.sourceRelation);
          continue;
        }
        addOtherParent(evidence, { childId: evidenceChildId, sourceOwnerId: evidenceOwnerId, sourceRelation: evidence.sourceRelation });
      }
    }
  }

  if (typeof betrothalEvidenceFilter === "function") {
    for (const [characterId, character] of characters) {
      const sourceOwnerId = positiveRuntimeId(character?.id ?? characterId);
      if (!sourceOwnerId) continue;
      for (const [field, sourceRelation] of [["children", "kids.betrothed"], ["siblings", "siblings.betrothed"]]) {
        for (const relative of values(character?.[field])) {
          const relatedCharacterId = positiveRuntimeId(relative);
          const evidence = relative?.betrothed;
          const targetId = positiveRuntimeId(evidence);
          if (!relatedCharacterId || relatedCharacterId === sourceOwnerId || !targetId || targetId === sourceOwnerId || targetId === relatedCharacterId) continue;
          const rejectClaim = () => rejectBetrothalClaim(relatedCharacterId, targetId);
          if (field === "children" && !directParentProof(relatedCharacterId, sourceOwnerId, "children.betrothed", relative?.directParentEvidence || null).accepted) {
            rejectClaim();
            continue;
          }
          const context = { sourceOwnerId, relatedCharacterId, targetId, sourceRelation };
          if (!betrothalEvidenceFilter(evidence, context, source)) {
            rejectClaim();
            continue;
          }
          const target = nodes.get(String(targetId)) || {
            id: String(targetId),
            ...(String(evidence.name || "").trim() ? { fullName: String(evidence.name).trim() } : {}),
            ...(evidence.gender === "male" || evidence.gender === "female" ? {
              gender: evidence.gender,
              genderSource: evidence.genderSource,
              sheHe: evidence.sheHe
            } : {}),
            partial: true
          };
          const betrothalSource = {
            source: "CK3_CURRENT_BETROTHAL",
            relationType: "BETROTHED",
            sourceOwnerId: String(sourceOwnerId),
            relatedCharacterId: String(relatedCharacterId),
            targetId: String(targetId),
            sourceRelation,
            sourceSnapshotId: evidence.sourceSnapshotId,
            campaignToken: evidence.campaignToken,
            targetGender: evidence.gender === "male" || evidence.gender === "female" ? evidence.gender : null,
            targetGenderSource: evidence.genderSource || null,
            publicStatus: evidence.publicStatus,
            evidenceScope: "SOURCE_OWNER_RECORD_ONLY",
            knowledgeStatus: "UNKNOWN"
          };
          const details = { source: "CK3_CURRENT_BETROTHAL", betrothalSources: [betrothalSource] };
          add(relatedCharacterId, target, "BETROTHED_TO", [relatedCharacterId, targetId], 1, details);
          add(target, relatedCharacterId, "BETROTHED_TO", [targetId, relatedCharacterId], 1, details);
        }
      }
    }
  }

  const relationStatusPairs = new Map();
  for (const edge of edges) {
    if (!["SPOUSE_OF", "FORMER_SPOUSE_OF", "DECEASED_SPOUSE_OF", "BETROTHED_TO"].includes(edge.type)) continue;
    const pair = [edge.from, edge.to].sort().join(":");
    if (!relationStatusPairs.has(pair)) relationStatusPairs.set(pair, []);
    relationStatusPairs.get(pair).push(edge);
  }
  for (const pairEdges of relationStatusPairs.values()) {
    const types = new Set(pairEdges.map(edge => edge.type));
    const directionalStatuses = new Map();
    for (const edge of pairEdges) {
      const direction = `${edge.from}:${edge.to}`;
      if (!directionalStatuses.has(direction)) directionalStatuses.set(direction, new Set());
      directionalStatuses.get(direction).add(edge.type);
    }
    // A surviving husband and deceased wife legitimately have different labels
    // in reciprocal directions. Former/current claims still conflict as a pair.
    const spouseStatusConflict = types.has("FORMER_SPOUSE_OF") && (types.has("SPOUSE_OF") || types.has("DECEASED_SPOUSE_OF"))
      || [...directionalStatuses.values()].some(statuses => statuses.has("SPOUSE_OF") && statuses.has("DECEASED_SPOUSE_OF"));
    const betrothalConflict = types.has("BETROTHED_TO")
      && ["SPOUSE_OF", "FORMER_SPOUSE_OF", "DECEASED_SPOUSE_OF"].some(type => types.has(type));
    const betrothalEdges = pairEdges.filter(edge => edge.type === "BETROTHED_TO");
    const sourceSignatures = new Set(betrothalEdges.map(edge => JSON.stringify((edge.betrothalSources || [])
      .map(item => ({ ...item }))
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))))));
    const sourceOwnerClaims = new Map();
    const targetGenderClaims = new Map();
    const allBetrothalSources = betrothalEdges.flatMap(edge => edge.betrothalSources || []);
    const campaignTokens = new Set(allBetrothalSources.map(source => source.campaignToken));
    const sourceSnapshots = new Set(allBetrothalSources.map(source => source.sourceSnapshotId));
    for (const source of allBetrothalSources) {
      const ownerId = String(source.sourceOwnerId);
      if (!sourceOwnerClaims.has(ownerId)) sourceOwnerClaims.set(ownerId, new Set());
      sourceOwnerClaims.get(ownerId).add(JSON.stringify([source.relatedCharacterId, source.targetId, source.sourceRelation]));
      if (source.targetGender === "male" || source.targetGender === "female") {
        const targetId = String(source.targetId);
        if (!targetGenderClaims.has(targetId)) targetGenderClaims.set(targetId, new Set());
        targetGenderClaims.get(targetId).add(source.targetGender);
      }
    }
    const sourceProofConflict = betrothalEdges.length > 0 && (sourceSignatures.size !== 1
      || betrothalEdges.some(edge => !(edge.betrothalSources || []).length
        || edge.betrothalSources.some(source => unorderedPairKey(source.relatedCharacterId, source.targetId) !== unorderedPairKey(edge.from, edge.to)
          || source.source !== "CK3_CURRENT_BETROTHAL" || source.relationType !== "BETROTHED"
          || source.publicStatus !== "CURRENT_BETROTHAL" || source.evidenceScope !== "SOURCE_OWNER_RECORD_ONLY"
          || source.knowledgeStatus !== "UNKNOWN"
          || source.targetGender !== null && !["male", "female"].includes(source.targetGender)
          || source.targetGender && source.targetGenderSource !== "CK3_LIVE_RELATIVE"))
      || [...sourceOwnerClaims.values()].some(claims => claims.size > 1)
      || [...targetGenderClaims.values()].some(genders => genders.size > 1)
      || campaignTokens.size !== 1 || sourceSnapshots.size !== 1
      || allBetrothalSources.some(source => !source.campaignToken || !source.sourceSnapshotId));
    if (spouseStatusConflict || betrothalConflict || sourceProofConflict) {
      for (const edge of pairEdges) edge.evidenceConflict = true;
    }
  }
  for (const pair of rejectedSpousePairs) {
    for (const edge of edges) {
      if (["SPOUSE_OF", "FORMER_SPOUSE_OF", "DECEASED_SPOUSE_OF"].includes(edge.type)
        && unorderedPairKey(edge.from, edge.to) === pair) edge.evidenceConflict = true;
    }
  }
  for (const { pairKey, signatures } of spouseProofsByOwnerPair.values()) {
    if (signatures.size === 1) continue;
    for (const edge of edges) {
      if (["SPOUSE_OF", "FORMER_SPOUSE_OF", "DECEASED_SPOUSE_OF"].includes(edge.type)
        && unorderedPairKey(edge.from, edge.to) === pairKey) edge.evidenceConflict = true;
    }
  }
  for (const pair of rejectedBetrothalPairs) {
    for (const edge of edges) {
      if (edge.type === "BETROTHED_TO" && unorderedPairKey(edge.from, edge.to) === pair) edge.evidenceConflict = true;
    }
  }
  for (const [subjectId, rejectedTargets] of rejectedBetrothalTargetsBySubject) {
    const acceptedTargets = new Set(edges.filter(edge => edge.type === "BETROTHED_TO" && edge.from === subjectId).map(edge => edge.to));
    if (![...rejectedTargets].some(targetId => [...acceptedTargets].some(acceptedId => acceptedId !== targetId))) continue;
    for (const edge of edges) {
      if (edge.type === "BETROTHED_TO" && (edge.from === subjectId || edge.to === subjectId)) edge.evidenceConflict = true;
    }
  }
  const betrothalPartners = new Map();
  for (const edge of edges.filter(item => item.type === "BETROTHED_TO")) {
    if (!betrothalPartners.has(edge.from)) betrothalPartners.set(edge.from, new Set());
    betrothalPartners.get(edge.from).add(edge.to);
  }
  for (const [characterId, partners] of betrothalPartners) {
    if (partners.size < 2) continue;
    for (const edge of edges) {
      if (edge.type === "BETROTHED_TO" && (edge.from === characterId || edge.to === characterId)) edge.evidenceConflict = true;
    }
  }

  for (const [key, sources] of rejectedParentPairs) {
    const [parentId, childId] = key.split(":");
    for (const edge of [
      edgeByKey.get(`${parentId}:${childId}:PARENT_OF`),
      edgeByKey.get(`${childId}:${parentId}:CHILD_OF`)
    ]) {
      if (!edge) continue;
      edge.parentEvidenceConflict = true;
      edge.rejectedParentEvidenceSources = [...sources].sort();
    }
  }

  const outgoing = (from, type) => (outgoingEdges.get(String(from)) || []).filter((edge) => !type || edge.type === type);
  const parentsOf = (characterId) => outgoing(characterId, "CHILD_OF").filter(edge => !edge.parentEvidenceConflict).map((edge) => edge.to);
  const childrenOf = (characterId) => outgoing(characterId, "PARENT_OF").filter(edge => !edge.parentEvidenceConflict).map((edge) => edge.to);
  const allIds = [...nodes.keys()];
  if (deriveExtendedRelations) {
    for (const parentId of allIds) {
      const children = childrenOf(parentId);
      for (let leftIndex = 0; leftIndex < children.length; leftIndex++) {
        for (let rightIndex = leftIndex + 1; rightIndex < children.length; rightIndex++) {
          const left = children[leftIndex];
          const right = children[rightIndex];
          add(left, right, "SIBLING_OF", [left, parentId, right], 1, { source: "DERIVED_SHARED_PARENT" });
          add(right, left, "SIBLING_OF", [right, parentId, left], 1, { source: "DERIVED_SHARED_PARENT" });
        }
      }
    }
    for (const childId of allIds) {
      for (const parentEdge of outgoing(childId, "CHILD_OF")) {
        const parentId = parentEdge.to;
        const parentSex = resolveCharacterSexConsensus({ snapshot: nodes.get(parentId) }).sex;
        const inferredBranch = parentSex === "male" ? "PATERNAL" : parentSex === "female" ? "MATERNAL" : null;
        const branch = parentEdge.branchConflict || parentEdge.branch && inferredBranch && parentEdge.branch !== inferredBranch
          ? null : parentEdge.branch || inferredBranch;
        for (const grandparentId of parentsOf(parentId)) {
          add(grandparentId, childId, "GRANDPARENT_OF", [grandparentId, parentId, childId], 0.95, { source: "DERIVED_KINSHIP", branch });
          add(childId, grandparentId, "GRANDCHILD_OF", [childId, parentId, grandparentId], 0.95, { source: "DERIVED_KINSHIP", branch });
        }
        for (const parentSibling of outgoing(parentId, "SIBLING_OF").map((edge) => edge.to)) {
          add(parentSibling, childId, "AUNT_UNCLE_OF", [parentSibling, parentId, childId], 0.9, { source: "DERIVED_KINSHIP", branch });
          add(childId, parentSibling, "NIECE_NEPHEW_OF", [childId, parentId, parentSibling], 0.9, { source: "DERIVED_KINSHIP", branch });
          const parentSiblingNode = nodes.get(parentSibling);
          const sex = resolveCharacterSexConsensus({ snapshot: parentSiblingNode }).sex;
          const cousinBranch = branch === "PATERNAL" ? sex === "male" ? "PATERNAL_MALE" : sex === "female" ? "PATERNAL_FEMALE" : null : branch;
          for (const cousinId of childrenOf(parentSibling)) {
            add(cousinId, childId, "COUSIN_OF", [cousinId, parentSibling, parentId, childId], 0.85, { source: "DERIVED_KINSHIP", branch: cousinBranch });
            // The reverse relation is derived from its own parent branch, not ours.
          }
        }
      }
    }
  }
  for (const edge of edges) if (edge.type === "SIBLING_OF" && rejectedSiblingPairs.has(unorderedPairKey(edge.from, edge.to))) edge.evidenceConflict = true;
  const resolveRelationBetween = (from, to, allowedTypes = null) => {
    const allowed = allowedTypes === null ? null : new Set((Array.isArray(allowedTypes) ? allowedTypes : []).map(String));
    const matches = outgoing(from).filter((edge) => edge.to === String(to) && (!allowed || allowed.has(edge.type)));
    const types = [...new Set(matches.map((edge) => edge.type))];
    if (types.length > 1) {
      const diagnostic = { code: "RELATION_CONFLICT_TYPE", from: String(from), to: String(to), types };
      const diagnosticKey = `${from}:${to}:${types.join(",")}`;
      if (!diagnosticKeys.has(diagnosticKey)) {
        diagnosticKeys.add(diagnosticKey);
        diagnostics.push(diagnostic);
      }
      return { relation: null, diagnostic };
    }
    const edge = matches[0] || null;
    if (!edge) return { relation: null, diagnostic: null };
    if (edge.branchConflict) return { relation: null, diagnostic: { code: "RELATION_CONFLICT_PATH", from: String(from), to: String(to) } };
    if (edge.parentEvidenceConflict || edge.relationshipKindConflict || edge.evidenceConflict) {
      return { relation: null, diagnostic: { code: edge.relationshipKindConflict ? "RELATIONSHIP_KIND_CONFLICT" : "RELATION_CONFLICT_EVIDENCE", from: String(from), to: String(to) } };
    }
    const node = nodes.get(String(from));
    const targetGenderClaims = edge.type === "BETROTHED_TO"
      ? [...new Set((edge.betrothalSources || []).filter(source => String(source.targetId) === String(from)
        && (source.targetGender === "male" || source.targetGender === "female")).map(source => source.targetGender))]
      : [];
    const sex = targetGenderClaims.length > 1
      ? { sex: "unknown", source: "CONFLICT", conflict: true, status: "RELATION_GENDER_CONFLICT" }
      : resolveCharacterSexConsensus({ snapshot: node, relation: targetGenderClaims.length ? { gender: targetGenderClaims[0] } : null });
    const seniorityReferenceId = edge.type === "AUNT_UNCLE_OF" ? edge.relationPath[1] : String(to);
    const seniority = compareCharacterSeniority(node, nodes.get(seniorityReferenceId));
    const structuredPath = [];
    for (let index = 0; index < edge.relationPath.length - 1; index++) {
      const pathFrom = String(edge.relationPath[index]);
      const pathTo = String(edge.relationPath[index + 1]);
      const direct = outgoing(pathFrom).find((candidate) => candidate.to === pathTo && candidate.source !== "DERIVED_KINSHIP" && candidate.source !== "DERIVED_SHARED_PARENT");
      const relationshipKind = direct?.relationshipKind || edge.relationshipKind
        || (direct?.type?.startsWith("STEP_") || edge.type.startsWith("STEP_") ? "STEP" : null);
      structuredPath.push({ type: direct?.type || edge.type, from: pathFrom, to: pathTo, ...(relationshipKind ? { relationshipKind } : {}) });
    }
    const relationshipKind = edge.relationshipKind || (edge.type.startsWith("STEP_") ? "STEP" : "UNSPECIFIED");
    const label = edge.type === "BETROTHED_TO" ? sex.sex === "male" ? "未婚夫" : sex.sex === "female" ? "未婚妻" : "订婚对象"
      : resolveKinshipLabel({ type: edge.type, sex: sex.sex, branch: edge.branch, seniority, relationshipKind });
    return { relation: { ...edge, seniority, seniorityReferenceId, relationshipKind, sex: sex.sex, sexSource: sex.source,
      sexConflict: sex.conflict === true, label, structuredPath }, diagnostic: null };
  };
  const relationBetween = (from, to) => resolveRelationBetween(from, to);
  const relationBetweenOfTypes = (from, to, allowedTypes) => resolveRelationBetween(from, to, allowedTypes);
  return { nodes, edges, diagnostics, relationBetween, relationBetweenOfTypes, relationsTo: (characterId) => [...(incomingEdges.get(String(characterId)) || [])] };
}

function buildKinshipGraph(source = {}, options = {}) {
  const directParentEvidenceFilter = typeof options.directParentEvidenceFilter === "function"
    ? options.directParentEvidenceFilter : () => false;
  return buildKinshipGraphInternal(source, { ...options, directParentEvidenceFilter });
}

function buildLegacyStructuralKinshipGraph(source = {}, options = {}) {
  // This explicitly named API is for historical structural tests/diagnostics only.
  // It does not verify freshness or grant current-fact/Memory permission.
  return buildKinshipGraphInternal(source, { ...options, allowUnverifiedFormerSpouses: options.allowUnverifiedFormerSpouses ?? true });
}

module.exports = { buildKinshipGraph, buildLegacyStructuralKinshipGraph, explicitRelationshipKind };
