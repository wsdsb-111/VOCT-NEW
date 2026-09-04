"use strict";

const { figures } = require("../historical-system/historical-data/figures");
const { figureMatchingRecords } = require("../historical-system/historical-data/figure-matching");
const { IDENTITY_SCORING } = require("../historical-system/historical-figure-resolver");

const figuresByKey = new Map(figures.map((figure) => [figure.figureKey, figure]));
const matchingByKey = new Map(figureMatchingRecords.map((record) => [record.figureKey, record]));
const reverseIndexes = new WeakMap();

function reverseIndex(bindings) {
  if (!bindings || typeof bindings !== "object") return new Map();
  if (reverseIndexes.has(bindings)) return reverseIndexes.get(bindings);
  const index = new Map();
  for (const runtimeId in bindings) for (const definitionId of Array.isArray(bindings[runtimeId]) ? bindings[runtimeId] : []) {
    if (!index.has(definitionId)) index.set(definitionId, []);
    index.get(definitionId).push(runtimeId);
  }
  reverseIndexes.set(bindings, index);
  return index;
}

function normalize(value) {
  return String(value || "").trim().toLocaleLowerCase("zh-CN");
}

function roundScore(value) {
  return Math.round(Math.max(0, Math.min(1, value)) * 10000) / 10000;
}

function parseYear(value) {
  const match = String(value || "").match(/^(\d+)\.(\d+)\.(\d+)$/);
  return match ? Number(match[1]) : null;
}

function scoreCandidate({ alias, figure, matching, definitionRecords = [], character, runtimeId, definitionIds, bindingConflict = false, currentYear }) {
  const metadata = definitionRecords.find((record) => definitionIds.includes(record.definitionId))?.metadata || {};
  const exactName = normalize(alias) === normalize(figure?.identity?.name || definitionRecords.find((record) => definitionIds.includes(record.definitionId))?.displayName);
  let rawScore = exactName ? IDENTITY_SCORING.nameExact : IDENTITY_SCORING.nameAlias;
  const evidence = [{ code: exactName ? "NAME_EXACT" : "NAME_ALIAS", weight: rawScore }];
  const conflicts = [];
  const hardConflicts = [];
  const add = (code, weight) => {
    rawScore += weight;
    evidence.push({ code, weight });
  };
  const conflict = (code, weight = 0, hard = false) => {
    rawScore += weight;
    conflicts.push({ code, weight });
    if (hard) hardConflicts.push(code);
  };
  if (definitionRecords.some((record) => definitionIds.includes(record.definitionId) && Array.isArray(record.conflicts) && record.conflicts.length)) {
    conflict("DEFINITION_SOURCE_CONFLICT", 0, true);
  }
  if (bindingConflict) conflict("DEFINITION_RUNTIME_BINDING_CONFLICT", 0, true);
  const birthYear = parseYear(character?.birth);
  const expectedBirthYear = matching?.intrinsic?.birthYear ?? figure?.life?.birthYear ?? parseYear(metadata.birthDate);
  const sourceBirthYear = parseYear(metadata.birthDate);
  if (sourceBirthYear !== null && expectedBirthYear !== null && Math.abs(sourceBirthYear - expectedBirthYear) > 2) conflict("CURATED_METADATA_CONFLICT", 0, true);
  if (Number.isInteger(currentYear) && Number.isInteger(birthYear) && Number.isInteger(expectedBirthYear)) {
    const difference = Math.abs((currentYear - birthYear) - (currentYear - expectedBirthYear));
    if (difference <= 2) add("AGE_MATCH_STRONG", IDENTITY_SCORING.ageStrong);
    else if (difference <= 5) add("AGE_MATCH_WEAK", IDENTITY_SCORING.ageWeak);
    else if (difference >= 15) conflict("AGE_IMPOSSIBLE", IDENTITY_SCORING.ageImpossible, true);
    else conflict("AGE_MISMATCH", IDENTITY_SCORING.ageMismatch);
  }
  const expectedGender = matching?.intrinsic?.gender ?? metadata.gender;
  if (["male", "female"].includes(metadata.gender) && ["male", "female"].includes(expectedGender) && metadata.gender !== expectedGender) conflict("CURATED_METADATA_CONFLICT", 0, true);
  if (expectedGender === "male" || expectedGender === "female") {
    if (character?.gender === expectedGender) add("GENDER_MATCH", IDENTITY_SCORING.genderMatch);
    else if (character?.gender === "male" || character?.gender === "female") conflict("GENDER_CONFLICT", IDENTITY_SCORING.genderConflict, true);
  }
  const cultures = matching?.hints?.cultures || [];
  if (cultures.some((culture) => normalize(culture) === normalize(character?.culture))) add("CULTURE_HINT_MATCH", IDENTITY_SCORING.cultureMatch);
  evidence.push({ code: "DEFINITION_RUNTIME_BINDING", definitionIds: [...definitionIds] });
  return {
    runtimeId: String(runtimeId),
    definitionId: definitionIds[0] || null,
    definitionIds: [...definitionIds],
    rawName: character?.firstName || null,
    aliasCandidate: alias,
    score: roundScore(rawScore),
    rawScore,
    evidence,
    conflicts,
    hardConflicts,
    hasStrongSecondaryIdentity: evidence.some((item) => item.code === "AGE_MATCH_STRONG" || item.code === "AGE_MATCH_WEAK" || item.code === "FAMILY_MATCH")
  };
}

function resolveHistoricalIdentity({ alias, figureKey, candidateDefinitionIds = [], definitionRecords = [], snapshot } = {}) {
  const figure = figuresByKey.get(figureKey);
  const matching = matchingByKey.get(figureKey);
  if ((!figure || matching?.resolverReady !== true) && definitionRecords.length === 0) {
    return { status: "REJECTED", resolvedRuntimeId: null, candidates: [], reason: "HISTORICAL_FIGURE_UNSUPPORTED", evidence: [] };
  }
  const candidatesByRuntime = new Map();
  const reverse = reverseIndex(snapshot?.runtimeToDefinitions);
  let multipleRuntimeBinding = false;
  for (const definitionId of candidateDefinitionIds) {
    const forwardRuntimeId = snapshot?.definitionToRuntime?.[definitionId];
    const reverseRuntimeIds = reverse.get(definitionId) || [];
    const runtimeIds = [...new Set([forwardRuntimeId, ...reverseRuntimeIds].filter(Boolean).map(String))];
    multipleRuntimeBinding ||= runtimeIds.length > 1;
    for (const runtimeId of runtimeIds) {
      const character = snapshot?.characters?.[runtimeId];
      if (!character) continue;
      const bindingConflict = runtimeIds.length > 1 || !!forwardRuntimeId && !reverseRuntimeIds.includes(String(forwardRuntimeId));
      const existing = candidatesByRuntime.get(runtimeId);
      if (existing) {
        existing.definitionIds.push(definitionId);
        existing.bindingConflict ||= bindingConflict;
      } else candidatesByRuntime.set(runtimeId, { runtimeId, character, definitionIds: [definitionId], bindingConflict });
    }
  }
  if (candidatesByRuntime.size === 0) return { status: "NO_MATCH", resolvedRuntimeId: null, candidates: [], reason: "NO_RUNTIME_CANDIDATES", evidence: [] };
  const currentYear = parseYear(snapshot?.gameDate);
  const candidates = [...candidatesByRuntime.values()].map((candidate) => scoreCandidate({ alias, figure, matching, definitionRecords, ...candidate, currentYear })).sort((left, right) => right.rawScore - left.rawScore || Number(left.runtimeId) - Number(right.runtimeId));
  if (multipleRuntimeBinding) return { status: candidates.length > 1 ? "AMBIGUOUS" : "REJECTED", resolvedRuntimeId: null, candidates, reason: "DEFINITION_RUNTIME_BINDING_CONFLICT", evidence: candidates.flatMap(candidate => candidate.conflicts) };
  const eligible = candidates.filter((candidate) => candidate.hardConflicts.length === 0);
  if (eligible.length === 0) return { status: "REJECTED", resolvedRuntimeId: null, candidates, reason: "ALL_CANDIDATES_CONFLICT", evidence: candidates.flatMap((candidate) => candidate.conflicts) };
  const top = eligible[0];
  const second = eligible[1] || null;
  const margin = second ? roundScore(top.rawScore - second.rawScore) : 1;
  if (top.score >= IDENTITY_SCORING.resolveThreshold && margin >= IDENTITY_SCORING.resolutionMargin && top.hasStrongSecondaryIdentity) {
    return { status: "RESOLVED", resolvedRuntimeId: top.runtimeId, candidates, reason: "UNIQUE_EVIDENCE_SUFFICIENT", evidence: top.evidence };
  }
  if (eligible.length > 1) return { status: "AMBIGUOUS", resolvedRuntimeId: null, candidates, reason: second?.score >= IDENTITY_SCORING.candidateThreshold ? "MULTIPLE_CANDIDATES" : "UNIQUE_EVIDENCE_INSUFFICIENT", evidence: top.evidence };
  return { status: "REJECTED", resolvedRuntimeId: null, candidates, reason: "UNIQUE_EVIDENCE_INSUFFICIENT", evidence: top.evidence };
}

module.exports = { resolveHistoricalIdentity };
