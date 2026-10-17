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
    checkpointId: pick("checkpointId")
  };
}

function mergeParentEvidence(edge, incoming) {
  if (!Array.isArray(incoming) || incoming.length === 0) return;
  if (!Array.isArray(edge.parentEvidence)) edge.parentEvidence = [];
  for (const evidence of incoming) {
    const key = JSON.stringify(evidence);
    if (!edge.parentEvidence.some((item) => JSON.stringify(item) === key)) edge.parentEvidence.push(evidence);
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

function buildKinshipGraph(source = {}, { includeOtherParents = true } = {}) {
  const characters = createCharacterMap(source);
  const nodes = new Map(characters);
  const edges = [];
  const edgeKeys = new Set();
  const edgeByKey = new Map();
  const outgoingEdges = new Map();
  const incomingEdges = new Map();
  const diagnosticKeys = new Set();
  const diagnostics = [];
  const ensureNode = (value) => {
    const key = id(value);
    if (!key) return null;
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
  const addOtherParent = (value, defaults = {}) => {
    const evidence = createOtherParentEvidence(value, defaults);
    if (!evidence) return;
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
      const parentId = ensureNode(parent);
      if (!parentId) continue;
      const details = relationshipDetails(parent, { branch });
      add(parentId, characterId, "PARENT_OF", [parentId, characterId], 1, details);
      add(characterId, parentId, "CHILD_OF", [characterId, parentId], 1, details);
    }
    for (const child of values(character?.children)) {
      const childId = ensureNode(child);
      if (!childId) continue;
      const details = relationshipDetails(child);
      add(characterId, childId, "PARENT_OF", [characterId, childId], 1, details);
      add(childId, characterId, "CHILD_OF", [childId, characterId], 1, details);
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
      const siblingId = ensureNode(sibling);
      if (!siblingId) continue;
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
    for (const spouse of normalizeSpouseRecords(character)) {
      if (spouse.runtimeId === null) continue;
      const spouseId = ensureNode(spouse.raw && typeof spouse.raw === "object" ? spouse.raw : spouse.runtimeId);
      if (!spouseId) continue;
      const spouseNode = nodes.get(spouseId);
      const characterLife = resolveLifeStatus(character);
      const spouseLife = resolveLifeStatus(spouseNode || spouse.raw || {});
      const isFormer = spouse.relationType === "FORMER_SPOUSE";
      const type = isFormer ? "FORMER_SPOUSE_OF"
        : characterLife.alive === false ? "DECEASED_SPOUSE_OF" : "SPOUSE_OF";
      const reverseType = isFormer ? "FORMER_SPOUSE_OF"
        : spouse.relationType === "DECEASED_SPOUSE" || spouseLife.alive === false
          ? "DECEASED_SPOUSE_OF"
          : "SPOUSE_OF";
      add(characterId, spouseId, type, [characterId, spouseId], spouse.confidence, { source: "SNAPSHOT_DIRECT" });
      add(spouseId, characterId, reverseType, [spouseId, characterId], spouse.confidence, { source: "SNAPSHOT_DIRECT" });
    }
    for (const evidence of character?.evidence?.relations || []) {
      const ownerId = ensureNode(evidence.ownerId);
      if (!ownerId) continue;
      if (evidence.relationType === "parent") {
        const details = relationshipDetails(evidence, { source: evidence.source || "SNAPSHOT_DIRECT" });
        add(characterId, ownerId, "PARENT_OF", [characterId, ownerId], 1, details);
        add(ownerId, characterId, "CHILD_OF", [ownerId, characterId], 1, details);
      } else if (evidence.relationType === "child") {
        const details = relationshipDetails(evidence, { source: evidence.source || "SNAPSHOT_DIRECT" });
        add(characterId, ownerId, "CHILD_OF", [characterId, ownerId], 1, details);
        add(ownerId, characterId, "PARENT_OF", [ownerId, characterId], 1, details);
      } else if (evidence.relationType === "sibling") {
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
        if (!binding || evidenceChildId !== sourceOwnerId || !evidenceOwnerId) continue;
        const expectedSource = `${evidenceOwnerId}.${binding.field}`;
        const relationBound = (character?.evidence?.relations || []).some((item) => Number(item?.ownerId) === Number(evidenceOwnerId)
          && item?.relationType === binding.relationType && item?.source === expectedSource);
        if (!relationBound) continue;
        addOtherParent(evidence, { childId: evidenceChildId, sourceOwnerId: evidenceOwnerId, sourceRelation: evidence.sourceRelation });
      }
    }
  }

  const outgoing = (from, type) => (outgoingEdges.get(String(from)) || []).filter((edge) => !type || edge.type === type);
  const parentsOf = (characterId) => outgoing(characterId, "CHILD_OF").map((edge) => edge.to);
  const childrenOf = (characterId) => outgoing(characterId, "PARENT_OF").map((edge) => edge.to);
  const allIds = [...nodes.keys()];
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
    const node = nodes.get(String(from));
    const sex = resolveCharacterSexConsensus({ snapshot: node });
    const seniorityReferenceId = edge.type === "AUNT_UNCLE_OF" ? edge.relationPath[1] : String(to);
    const seniority = compareCharacterSeniority(node, nodes.get(seniorityReferenceId));
    const structuredPath = [];
    for (let index = 0; index < edge.relationPath.length - 1; index++) {
      const pathFrom = String(edge.relationPath[index]);
      const pathTo = String(edge.relationPath[index + 1]);
      const direct = outgoing(pathFrom).find((candidate) => candidate.to === pathTo && candidate.source !== "DERIVED_KINSHIP" && candidate.source !== "DERIVED_SHARED_PARENT");
      const relationshipKind = direct?.relationshipKind || edge.relationshipKind || null;
      structuredPath.push({ type: direct?.type || edge.type, from: pathFrom, to: pathTo, ...(relationshipKind ? { relationshipKind } : {}) });
    }
    return { relation: { ...edge, seniority, seniorityReferenceId, relationshipKind: edge.relationshipKind || "UNSPECIFIED", sex: sex.sex, sexSource: sex.source, label: resolveKinshipLabel({ type: edge.type, sex: sex.sex, branch: edge.branch, seniority }), structuredPath }, diagnostic: null };
  };
  const relationBetween = (from, to) => resolveRelationBetween(from, to);
  const relationBetweenOfTypes = (from, to, allowedTypes) => resolveRelationBetween(from, to, allowedTypes);
  return { nodes, edges, diagnostics, relationBetween, relationBetweenOfTypes, relationsTo: (characterId) => [...(incomingEdges.get(String(characterId)) || [])] };
}

module.exports = { buildKinshipGraph, explicitRelationshipKind };
