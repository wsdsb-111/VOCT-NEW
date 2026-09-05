"use strict";

const { figures } = require("../historical-system/historical-data/figures");
const { figureMatchingRecords } = require("../historical-system/historical-data/figure-matching");

const figuresByKey = new Map(figures.map((figure) => [figure.figureKey, figure]));
const matchingByKey = new Map(figureMatchingRecords.map((record) => [record.figureKey, record]));
const reverseIndexes = new WeakMap();

function reverseIndex(bindings) {
  if (!bindings || typeof bindings !== "object") return new Map();
  if (reverseIndexes.has(bindings)) return reverseIndexes.get(bindings);
  const index = new Map();
  for (const runtimeId in bindings) for (const definitionId of Array.isArray(bindings[runtimeId]) ? bindings[runtimeId] : []) {
    if (!index.has(definitionId)) index.set(definitionId, []);
    index.get(definitionId).push(String(runtimeId));
  }
  reverseIndexes.set(bindings, index);
  return index;
}

function normalize(value) {
  return String(value || "").trim().normalize("NFKC").toLocaleLowerCase("zh-CN");
}

function candidateFor({ alias, definitionId, runtimeId, character, conflicts = [] }) {
  return {
    runtimeId: runtimeId ? String(runtimeId) : null,
    definitionId: definitionId || null,
    definitionIds: definitionId ? [definitionId] : [],
    rawName: character?.fullName || character?.firstName || null,
    aliasCandidate: alias,
    score: null,
    rawScore: null,
    evidence: [],
    conflicts: conflicts.map((code) => ({ code, category: "IDENTITY_CORE" })),
    hardConflicts: [...conflicts],
    hasStrongSecondaryIdentity: false
  };
}

function resolveHistoricalIdentity({ alias, figureKey, candidateDefinitionIds = [], definitionRecords = [], snapshot, sourceComplete = true, candidateSetComplete = true } = {}) {
  const figure = figuresByKey.get(figureKey);
  const matching = matchingByKey.get(figureKey);
  const definitionIds = [...new Set(candidateDefinitionIds.filter(Boolean).map(String))];
  const recordsById = new Map(definitionRecords.map((record) => [String(record.definitionId), record]));
  const reverse = reverseIndex(snapshot?.runtimeToDefinitions);
  const observedCandidates = [];
  for (const definitionId of definitionIds) {
    const forward = snapshot?.definitionToRuntime?.[definitionId];
    const runtimeIds = [...new Set([forward, ...(reverse.get(definitionId) || [])].filter(Boolean).map(String))];
    for (const runtimeId of runtimeIds) observedCandidates.push(candidateFor({ alias, definitionId, runtimeId, character: snapshot?.characters?.[runtimeId] }));
  }

  if (sourceComplete !== true || definitionRecords.some(record => record?.sourceComplete === false)) return { status: "REJECTED", resolvedRuntimeId: null, candidates: observedCandidates, reason: "SOURCE_INCOMPLETE", evidence: [] };
  if (candidateSetComplete !== true) return { status: "REJECTED", resolvedRuntimeId: null, candidates: observedCandidates, reason: "CANDIDATE_SET_INCOMPLETE", evidence: [] };
  if ((!figure || matching?.resolverReady !== true) && definitionRecords.length === 0) {
    return { status: "REJECTED", resolvedRuntimeId: null, candidates: observedCandidates, reason: "HISTORICAL_FIGURE_UNSUPPORTED", evidence: [] };
  }
  if (definitionIds.length === 0) return { status: "NO_MATCH", resolvedRuntimeId: null, candidates: [], reason: "NO_HISTORICAL_DEFINITION", evidence: [] };
  if (definitionIds.length > 1) return { status: "AMBIGUOUS", resolvedRuntimeId: null, candidates: observedCandidates, reason: "MULTIPLE_DEFINITIONS", evidence: [] };

  const definitionId = definitionIds[0];
  const record = recordsById.get(definitionId);
  const sourceConflicts = Array.isArray(record?.conflicts) ? record.conflicts.filter(Boolean) : [];
  if (sourceConflicts.length) {
    const candidates = observedCandidates.map((candidate) => ({ ...candidate, conflicts: sourceConflicts.map(code => ({ code, category: "IDENTITY_CORE" })), hardConflicts: [...sourceConflicts] }));
    return { status: "REJECTED", resolvedRuntimeId: null, candidates, reason: "DEFINITION_SOURCE_CONFLICT", evidence: sourceConflicts.map(code => ({ code, category: "IDENTITY_CORE" })) };
  }

  const verifiedNames = new Set([...(record?.names || []), record?.displayName, figure?.identity?.name].filter(Boolean).map(normalize));
  if (!verifiedNames.has(normalize(alias))) {
    return { status: "REJECTED", resolvedRuntimeId: null, candidates: observedCandidates, reason: "HISTORICAL_FULL_NAME_NOT_EXACT", evidence: [] };
  }

  const forwardRuntimeId = snapshot?.definitionToRuntime?.[definitionId];
  const reverseRuntimeIds = [...new Set((reverse.get(definitionId) || []).map(String))];
  if (!forwardRuntimeId && reverseRuntimeIds.length === 0) return { status: "NO_MATCH", resolvedRuntimeId: null, candidates: [], reason: "NO_RUNTIME_CANDIDATES", evidence: [] };
  const forwardId = forwardRuntimeId ? String(forwardRuntimeId) : null;
  const reciprocalDefinitions = forwardId ? [...new Set((snapshot?.runtimeToDefinitions?.[forwardId] || []).map(String))] : [];
  const bindingConsistent = !!forwardId && reverseRuntimeIds.length === 1 && reverseRuntimeIds[0] === forwardId && reciprocalDefinitions.length === 1 && reciprocalDefinitions[0] === definitionId;
  if (!bindingConsistent) {
    const runtimeIds = [...new Set([forwardId, ...reverseRuntimeIds].filter(Boolean))];
    const candidates = runtimeIds.map(runtimeId => candidateFor({ alias, definitionId, runtimeId, character: snapshot?.characters?.[runtimeId], conflicts: ["DEFINITION_RUNTIME_BINDING_CONFLICT"] }));
    return { status: runtimeIds.length > 1 ? "AMBIGUOUS" : "REJECTED", resolvedRuntimeId: null, candidates, reason: "DEFINITION_RUNTIME_BINDING_CONFLICT", evidence: [{ code: "DEFINITION_RUNTIME_BINDING_CONFLICT", category: "IDENTITY_CORE" }] };
  }

  const character = snapshot?.characters?.[forwardId];
  if (!character) return { status: "NO_MATCH", resolvedRuntimeId: null, candidates: [], reason: "RUNTIME_CHARACTER_MISSING", evidence: [] };
  const expectedGender = matching?.intrinsic?.gender ?? record?.metadata?.gender;
  const sourceGender = record?.metadata?.gender;
  if (["male", "female"].includes(sourceGender) && ["male", "female"].includes(expectedGender) && sourceGender !== expectedGender) {
    const candidate = candidateFor({ alias, definitionId, runtimeId: forwardId, character, conflicts: ["CURATED_METADATA_CONFLICT"] });
    return { status: "REJECTED", resolvedRuntimeId: null, candidates: [candidate], reason: "CURATED_METADATA_CONFLICT", evidence: candidate.conflicts };
  }
  if (["male", "female"].includes(expectedGender) && ["male", "female"].includes(character.gender) && character.gender !== expectedGender) {
    const candidate = candidateFor({ alias, definitionId, runtimeId: forwardId, character, conflicts: ["GENDER_CONFLICT"] });
    return { status: "REJECTED", resolvedRuntimeId: null, candidates: [candidate], reason: "GENDER_CONFLICT", evidence: candidate.conflicts };
  }

  const evidence = [
    { code: "HISTORICAL_FULL_NAME_EXACT", category: "IDENTITY_CORE", definitionId },
    { code: "DEFINITION_UNIQUE", category: "IDENTITY_CORE", definitionId },
    { code: "DEFINITION_RUNTIME_BINDING", category: "IDENTITY_CORE", definitionIds: [definitionId], runtimeId: forwardId },
    { code: "BIDIRECTIONAL_BINDING_CONSISTENT", category: "IDENTITY_CORE", definitionId, runtimeId: forwardId }
  ];
  if (["male", "female"].includes(expectedGender) && character.gender === expectedGender) evidence.push({ code: "GENDER_MATCH", category: "IDENTITY_SUPPORT" });
  else evidence.push({ code: "GENDER_UNKNOWN", category: "IDENTITY_SUPPORT" });
  const candidate = { ...candidateFor({ alias, definitionId, runtimeId: forwardId, character }), evidence };
  return { status: "RESOLVED", resolvedRuntimeId: forwardId, candidates: [candidate], reason: "HISTORICAL_IDENTITY_CORE_CONFIRMED", evidence };
}

module.exports = { resolveHistoricalIdentity };
