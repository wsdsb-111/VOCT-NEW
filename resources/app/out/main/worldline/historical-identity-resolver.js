"use strict";

const { figures } = require("../historical-system/historical-data/figures");
const { figureMatchingRecords } = require("../historical-system/historical-data/figure-matching");
const { IDENTITY_SCORING } = require("../historical-system/historical-figure-resolver");

const figuresByKey = new Map(figures.map((figure) => [figure.figureKey, figure]));
const matchingByKey = new Map(figureMatchingRecords.map((record) => [record.figureKey, record]));

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

function scoreCandidate({ alias, figure, matching, character, runtimeId, definitionIds, currentYear }) {
  const exactName = normalize(alias) === normalize(figure?.identity?.name);
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
  const birthYear = parseYear(character?.birth);
  const expectedBirthYear = matching?.intrinsic?.birthYear ?? figure?.life?.birthYear;
  if (Number.isInteger(currentYear) && Number.isInteger(birthYear) && Number.isInteger(expectedBirthYear)) {
    const difference = Math.abs((currentYear - birthYear) - (currentYear - expectedBirthYear));
    if (difference <= 2) add("AGE_MATCH_STRONG", IDENTITY_SCORING.ageStrong);
    else if (difference <= 5) add("AGE_MATCH_WEAK", IDENTITY_SCORING.ageWeak);
    else if (difference >= 15) conflict("AGE_IMPOSSIBLE", IDENTITY_SCORING.ageImpossible, true);
    else conflict("AGE_MISMATCH", IDENTITY_SCORING.ageMismatch);
  }
  const expectedGender = matching?.intrinsic?.gender;
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

function resolveHistoricalIdentity({ alias, figureKey, candidateDefinitionIds = [], snapshot } = {}) {
  const figure = figuresByKey.get(figureKey);
  const matching = matchingByKey.get(figureKey);
  if (!figure || matching?.resolverReady !== true) {
    return { status: "REJECTED", resolvedRuntimeId: null, candidates: [], reason: "HISTORICAL_FIGURE_UNSUPPORTED", evidence: [] };
  }
  const candidatesByRuntime = new Map();
  for (const definitionId of candidateDefinitionIds) {
    const runtimeId = snapshot?.definitionToRuntime?.[definitionId];
    const character = snapshot?.characters?.[String(runtimeId)];
    if (!runtimeId || !character) continue;
    const existing = candidatesByRuntime.get(String(runtimeId));
    if (existing) existing.definitionIds.push(definitionId);
    else candidatesByRuntime.set(String(runtimeId), { runtimeId: String(runtimeId), character, definitionIds: [definitionId] });
  }
  if (candidatesByRuntime.size === 0) return { status: "NO_MATCH", resolvedRuntimeId: null, candidates: [], reason: "NO_RUNTIME_CANDIDATES", evidence: [] };
  const currentYear = parseYear(snapshot?.gameDate);
  const candidates = [...candidatesByRuntime.values()].map((candidate) => scoreCandidate({ alias, figure, matching, ...candidate, currentYear })).sort((left, right) => right.rawScore - left.rawScore || Number(left.runtimeId) - Number(right.runtimeId));
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
