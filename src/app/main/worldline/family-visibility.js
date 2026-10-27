"use strict";

const { getTargetedKinshipGraph, isCurrentSiblingRow } = require("./kinship-graph-cache");
const { currentSpouseEvidenceFilter } = require("./canonical-spouse-record");
const { resolveLifeStatus } = require("./character-temporal-facts");

function id(value) {
  const number = Number(value && typeof value === "object" ? value.id ?? value.runtimeId : value);
  return Number.isSafeInteger(number) && number > 0 ? String(number) : null;
}

// One generational window per responder. Marriage may occur at either endpoint
// of the blood relationship, never recursively through another affine family.
function getFamilyVisibility(gameData, observerId, { maxNodes = 4096, targetId = null } = {}) {
  const observer = id(observerId);
  // Incoming-only parent/spouse records must be discoverable too. This small
  // index is rebuilt for each read (the parser permits same-day mutations);
  // it only nominates nodes and never authorizes a relationship.
  const discoveryIndex = new Map();
  const seenRecords = new WeakSet();
  const link = (left, right) => {
    const key = id(left);
    if (!key || !id(right)) return;
    if (!discoveryIndex.has(key)) discoveryIndex.set(key, new Set());
    discoveryIndex.get(key).add(right);
  };
  const discover = person => {
    if (!person || typeof person !== "object" || seenRecords.has(person)) return;
    seenRecords.add(person);
    for (const field of ["parents", "children", "siblings", "spouses", "spouse"]) {
      const value = person[field];
      const records = Array.isArray(value) ? value : field === "parents" ? Object.values(value || {}) : value ? [value] : [];
      for (const record of records) {
        link(person, record); link(record, person);
        discover(record);
      }
    }
  };
  const target = id(targetId);
  if (!target) {
    const people = gameData?.characters instanceof Map ? gameData.characters.values() : Object.values(gameData?.characters || {});
    for (const person of people) discover(person);
  }
  const graph = getTargetedKinshipGraph(gameData, target ? [observer, target] : [observer],
    { maxDepth: 9, maxNodes, deriveExtendedRelations: false, discoveryIndex });
  const ids = new Set(observer ? [observer] : []);
  const metrics = { ...graph.scopeMetrics, edgeVisits: 0 };
  if (!observer || graph.scopeTruncated) return { ids, scopeTruncated: !!graph.scopeTruncated, metrics };
  const parents = new Map();
  const children = new Map();
  const siblings = new Map();
  const spouses = new Map();
  const add = (index, from, to) => {
    if (!index.has(from)) index.set(from, new Set());
    index.get(from).add(to);
  };
  for (const edge of graph.edges) {
    metrics.edgeVisits++;
    if (edge.type !== "PARENT_OF" || edge.parentEvidenceConflict || edge.relationshipKindConflict
      || edge.evidenceConflict || edge.relationshipKind === "STEP" || !edge.parentEvidence?.length) continue;
    add(parents, edge.to, edge.from);
    add(children, edge.from, edge.to);
  }
  const siblingPairs = new Map();
  const marriagePairs = new Map();
  const conflictedMarriages = new Set(graph.edges.filter(edge => edge.evidenceConflict)
    .map(edge => [edge.from, edge.to].sort().join(":")));
  const marriageFilter = currentSpouseEvidenceFilter(gameData);
  const claim = (index, left, right, valid) => {
    if (!left || !right || left === right || !graph.nodes.has(left) || !graph.nodes.has(right)) return;
    const key = [left, right].sort().join(":");
    const previous = index.get(key);
    index.set(key, { left, right, valid: valid && previous?.valid !== false });
  };
  const marriage = (person, record) => {
    const left = id(person);
    const right = id(record);
    const statuses = [person, record, graph.nodes.get(right)].filter(Boolean).map(resolveLifeStatus);
    claim(marriagePairs, left, right, !conflictedMarriages.has([left, right].sort().join(":"))
      && statuses.every(status => !status.conflict && status.alive !== false)
      && marriageFilter(record, { sourceOwnerId: record?.sourceOwnerId, relatedCharacterId: left,
        targetId: right, sourceRelation: record?.sourceRelation }));
  };
  for (const person of graph.nodes.values()) {
    for (const row of person.siblings || []) claim(siblingPairs, id(person), id(row), isCurrentSiblingRow(person, row, gameData));
    for (const record of [...(person.spouses || []), ...(person.spouse ? [person.spouse] : [])]) marriage(person, record);
    // Parent and relative rows may carry newer source-bound marriage evidence
    // while the canonical character is present without that nested record.
    for (const relative of [...(Array.isArray(person.parents) ? person.parents : []), ...(person.children || []), ...(person.siblings || [])]) {
      for (const record of relative.spouses || []) marriage(relative, record);
    }
  }
  for (const pair of siblingPairs.values()) if (pair.valid) {
    add(siblings, pair.left, pair.right); add(siblings, pair.right, pair.left);
  }
  for (const pair of marriagePairs.values()) if (pair.valid) {
    add(spouses, pair.left, pair.right); add(spouses, pair.right, pair.left);
  }
  const siblingsOf = person => {
    const result = new Set(siblings.get(person));
    for (const parent of parents.get(person) || []) for (const child of children.get(parent) || []) if (child !== person) result.add(child);
    return result;
  };
  const bloodWindow = origin => {
    const ancestry = [new Set([origin])];
    for (let level = 1; level <= 4; level++) {
      const next = new Set();
      for (const person of ancestry[level - 1]) for (const parent of parents.get(person) || []) next.add(parent);
      ancestry.push(next);
    }
    const result = new Set([origin]);
    const descend = (roots, depth) => {
      let level = new Set();
      for (const root of roots) { level.add(root); for (const sibling of siblingsOf(root)) level.add(sibling); }
      for (let step = 0; step < depth; step++) {
        const next = new Set();
        for (const person of level) for (const child of children.get(person) || []) next.add(child);
        level = next;
      }
      for (const person of level) result.add(person);
    };
    // The same proven five-layer relationship grants knowledge in both
    // directions, including a younger collateral relative replying to an elder.
    for (let up = 0; up <= 2; up++) for (let down = 0; down <= up + 2; down++) {
      descend(ancestry[up], down);
      descend(ancestry[down], up);
    }
    return result;
  };
  const blood = bloodWindow(observer);
  for (const person of blood) {
    ids.add(person);
    for (const spouse of spouses.get(person) || []) ids.add(spouse);
  }
  for (const spouse of spouses.get(observer) || []) for (const person of bloodWindow(spouse)) ids.add(person);
  return { ids, scopeTruncated: false, metrics };
}

module.exports = { getFamilyVisibility, isCurrentSiblingRow };
