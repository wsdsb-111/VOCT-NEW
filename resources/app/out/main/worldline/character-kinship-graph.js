"use strict";

const { resolveCharacterSexConsensus } = require("./character-demographic-normalizer");
const { resolveLifeStatus } = require("./character-temporal-facts");
const { resolveKinshipLabel } = require("./kinship-label-resolver");
const { normalizeSpouseRecords } = require("./canonical-spouse-record");

function id(value) {
  const raw = value && typeof value === "object" ? value.id ?? value.characterId : value;
  return raw === null || raw === undefined || raw === "" ? null : String(raw);
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

function buildKinshipGraph(source = {}) {
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
  for (const [characterId, character] of characters) {
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
    }
    for (const spouse of normalizeSpouseRecords(character)) {
      if (spouse.runtimeId === null) continue;
      const spouseId = ensureNode(spouse.raw && typeof spouse.raw === "object" ? spouse.raw : spouse.runtimeId);
      if (!spouseId) continue;
      const spouseNode = nodes.get(spouseId);
      const spouseLife = resolveLifeStatus(spouseNode || spouse.raw || {});
      const type = spouse.relationType === "FORMER_SPOUSE" ? "FORMER_SPOUSE_OF"
        : spouse.relationType === "DECEASED_SPOUSE" || spouseLife.alive === false
        ? "DECEASED_SPOUSE_OF"
        : "SPOUSE_OF";
      const reverseLife = resolveLifeStatus(character);
      const reverseType = spouse.relationType === "FORMER_SPOUSE" ? "FORMER_SPOUSE_OF"
        : reverseLife.alive === false ? "DECEASED_SPOUSE_OF" : "SPOUSE_OF";
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
      const branch = parentEdge.branch || null;
      for (const grandparentId of parentsOf(parentId)) {
        add(grandparentId, childId, "GRANDPARENT_OF", [grandparentId, parentId, childId], 0.95, { source: "DERIVED_KINSHIP", branch });
        add(childId, grandparentId, "GRANDCHILD_OF", [childId, parentId, grandparentId], 0.95, { source: "DERIVED_KINSHIP", branch });
      }
      for (const parentSibling of outgoing(parentId, "SIBLING_OF").map((edge) => edge.to)) {
        add(parentSibling, childId, "AUNT_UNCLE_OF", [parentSibling, parentId, childId], 0.9, { source: "DERIVED_KINSHIP", branch });
        add(childId, parentSibling, "NIECE_NEPHEW_OF", [childId, parentId, parentSibling], 0.9, { source: "DERIVED_KINSHIP", branch });
        const parentSiblingNode = nodes.get(parentSibling);
        const sex = resolveCharacterSexConsensus({ snapshot: parentSiblingNode }).sex;
        const cousinBranch = branch === "PATERNAL" && sex === "male" ? "PATERNAL_MALE" : branch;
        for (const cousinId of childrenOf(parentSibling)) {
          add(cousinId, childId, "COUSIN_OF", [cousinId, parentSibling, parentId, childId], 0.85, { source: "DERIVED_KINSHIP", branch: cousinBranch });
          add(childId, cousinId, "COUSIN_OF", [childId, parentId, parentSibling, cousinId], 0.85, { source: "DERIVED_KINSHIP", branch: cousinBranch });
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
    const node = nodes.get(String(from));
    const sex = resolveCharacterSexConsensus({ snapshot: node });
    const structuredPath = [];
    for (let index = 0; index < edge.relationPath.length - 1; index++) {
      const pathFrom = String(edge.relationPath[index]);
      const pathTo = String(edge.relationPath[index + 1]);
      const direct = outgoing(pathFrom).find((candidate) => candidate.to === pathTo && candidate.source !== "DERIVED_KINSHIP" && candidate.source !== "DERIVED_SHARED_PARENT");
      const relationshipKind = direct?.relationshipKind || edge.relationshipKind || null;
      structuredPath.push({ type: direct?.type || edge.type, from: pathFrom, to: pathTo, ...(relationshipKind ? { relationshipKind } : {}) });
    }
    return { relation: { ...edge, relationshipKind: edge.relationshipKind || "UNSPECIFIED", sex: sex.sex, sexSource: sex.source, label: resolveKinshipLabel({ type: edge.type, sex: sex.sex, branch: edge.branch }), structuredPath }, diagnostic: null };
  };
  const relationBetween = (from, to) => resolveRelationBetween(from, to);
  const relationBetweenOfTypes = (from, to, allowedTypes) => resolveRelationBetween(from, to, allowedTypes);
  return { nodes, edges, diagnostics, relationBetween, relationBetweenOfTypes, relationsTo: (characterId) => [...(incomingEdges.get(String(characterId)) || [])] };
}

module.exports = { buildKinshipGraph, explicitRelationshipKind };
