"use strict";

const { resolveCharacterSex } = require("./character-demographic-normalizer");
const { resolveKinshipLabel } = require("./kinship-label-resolver");

function id(value) {
  const raw = value && typeof value === "object" ? value.id ?? value.characterId : value;
  return raw === null || raw === undefined || raw === "" ? null : String(raw);
}

function values(value) {
  if (Array.isArray(value)) return value;
  return value === null || value === undefined || value === "" ? [] : [value];
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
    if (edgeKeys.has(key)) return;
    edgeKeys.add(key);
    edges.push({ from: fromId, to: toId, type, source: details.source || "SNAPSHOT_DIRECT", relationPath, confidence, ...details });
  };
  for (const [characterId, character] of characters) {
    const parentEntries = Array.isArray(character?.parents)
      ? character.parents.map((parent) => ({ parent, branch: null }))
      : [{ parent: character?.parents?.father ?? character?.father, branch: "PATERNAL" }, { parent: character?.parents?.mother ?? character?.mother, branch: "MATERNAL" }];
    for (const { parent, branch } of parentEntries.filter((entry) => entry.parent)) {
      const parentId = ensureNode(parent);
      if (!parentId) continue;
      add(parentId, characterId, "PARENT_OF", [parentId, characterId], 1, { branch });
      add(characterId, parentId, "CHILD_OF", [characterId, parentId], 1, { branch });
    }
    for (const child of values(character?.children)) {
      const childId = ensureNode(child);
      if (!childId) continue;
      add(characterId, childId, "PARENT_OF", [characterId, childId]);
      add(childId, characterId, "CHILD_OF", [childId, characterId]);
    }
    for (const spouse of values(character?.spouses ?? character?.spouse)) {
      const spouseId = ensureNode(spouse);
      if (!spouseId) continue;
      const spouseNode = nodes.get(spouseId);
      const type = spouseNode?.alive === false || spouseNode?.deathDate ? "DECEASED_SPOUSE_OF" : "SPOUSE_OF";
      add(characterId, spouseId, type, [characterId, spouseId]);
      add(spouseId, characterId, type, [spouseId, characterId]);
    }
    for (const spouse of values(character?.formerSpouses)) {
      const spouseId = ensureNode(spouse);
      if (!spouseId) continue;
      add(characterId, spouseId, "FORMER_SPOUSE_OF", [characterId, spouseId]);
      add(spouseId, characterId, "FORMER_SPOUSE_OF", [spouseId, characterId]);
    }
    for (const spouse of values(character?.deceasedSpouses)) {
      const spouseId = ensureNode(spouse);
      if (!spouseId) continue;
      add(characterId, spouseId, "DECEASED_SPOUSE_OF", [characterId, spouseId]);
      add(spouseId, characterId, "DECEASED_SPOUSE_OF", [spouseId, characterId]);
    }
    for (const evidence of character?.evidence?.relations || []) {
      const ownerId = ensureNode(evidence.ownerId);
      if (!ownerId) continue;
      if (evidence.relationType === "parent") {
        add(characterId, ownerId, "PARENT_OF", [characterId, ownerId], 1, { source: evidence.source || "SNAPSHOT_DIRECT" });
        add(ownerId, characterId, "CHILD_OF", [ownerId, characterId], 1, { source: evidence.source || "SNAPSHOT_DIRECT" });
      } else if (evidence.relationType === "child") {
        add(characterId, ownerId, "CHILD_OF", [characterId, ownerId], 1, { source: evidence.source || "SNAPSHOT_DIRECT" });
        add(ownerId, characterId, "PARENT_OF", [ownerId, characterId], 1, { source: evidence.source || "SNAPSHOT_DIRECT" });
      }
    }
  }

  const outgoing = (from, type) => edges.filter((edge) => edge.from === String(from) && (!type || edge.type === type));
  const parentsOf = (characterId) => outgoing(characterId, "CHILD_OF").map((edge) => edge.to);
  const childrenOf = (characterId) => outgoing(characterId, "PARENT_OF").map((edge) => edge.to);
  const allIds = [...nodes.keys()];
  for (let leftIndex = 0; leftIndex < allIds.length; leftIndex++) {
    for (let rightIndex = leftIndex + 1; rightIndex < allIds.length; rightIndex++) {
      const left = allIds[leftIndex];
      const right = allIds[rightIndex];
      const sharedParents = parentsOf(left).filter((parentId) => parentsOf(right).includes(parentId));
      if (sharedParents.length) {
        add(left, right, "SIBLING_OF", [left, sharedParents[0], right], 1, { source: "DERIVED_SHARED_PARENT" });
        add(right, left, "SIBLING_OF", [right, sharedParents[0], left], 1, { source: "DERIVED_SHARED_PARENT" });
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
        const sex = resolveCharacterSex({ snapshot: parentSiblingNode }).sex;
        const cousinBranch = branch === "PATERNAL" && sex === "male" ? "PATERNAL_MALE" : branch;
        for (const cousinId of childrenOf(parentSibling)) {
          add(cousinId, childId, "COUSIN_OF", [cousinId, parentSibling, parentId, childId], 0.85, { source: "DERIVED_KINSHIP", branch: cousinBranch });
          add(childId, cousinId, "COUSIN_OF", [childId, parentId, parentSibling, cousinId], 0.85, { source: "DERIVED_KINSHIP", branch: cousinBranch });
        }
      }
    }
  }
  const relationBetween = (from, to) => {
    const matches = edges.filter((edge) => edge.from === String(from) && edge.to === String(to));
    const types = [...new Set(matches.map((edge) => edge.type))];
    if (types.length > 1) {
      const diagnostic = { code: "RELATION_CONFLICT_TYPE", from: String(from), to: String(to), types };
      diagnostics.push(diagnostic);
      return { relation: null, diagnostic };
    }
    const edge = matches[0] || null;
    if (!edge) return { relation: null, diagnostic: null };
    const node = nodes.get(String(from));
    const sex = resolveCharacterSex({ snapshot: node });
    return { relation: { ...edge, sex: sex.sex, sexSource: sex.source, label: resolveKinshipLabel({ type: edge.type, sex: sex.sex, branch: edge.branch }) }, diagnostic: null };
  };
  return { nodes, edges, diagnostics, relationBetween, relationsTo: (characterId) => edges.filter((edge) => edge.to === String(characterId)) };
}

module.exports = { buildKinshipGraph };
