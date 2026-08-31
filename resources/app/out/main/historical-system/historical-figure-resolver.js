"use strict";

const { validateFigureMatchingDataset } = require("./schema");
const { buildHistoricalFigureInput, deepFreeze } = require("./historical-figure-input");
const { normalizeHistoricalName, buildFigureNameIndex, findFigureCandidates } = require("./figure-name-index");

const FIGURE_STATUS = Object.freeze({
  UNSUPPORTED: "UNSUPPORTED",
  NOT_DUE: "NOT_DUE",
  DUE_UNRESOLVED: "DUE_UNRESOLVED",
  CANDIDATE: "CANDIDATE",
  AMBIGUOUS: "AMBIGUOUS",
  RESOLVED: "RESOLVED"
});

const roundScore = (value) => Math.round(Math.max(0, Math.min(1, value)) * 10000) / 10000;
const normalizedIncludes = (value, hints) => {
  const normalized = normalizeHistoricalName(value);
  return normalized && hints.some((hint) => normalized.includes(normalizeHistoricalName(hint)));
};
const normalizedEquals = (value, hints) => {
  const normalized = normalizeHistoricalName(value);
  return normalized && hints.some((hint) => normalized === normalizeHistoricalName(hint));
};

function scoreCandidate(figure, matching, character, nameEvidence, currentYear) {
  let rawScore = nameEvidence.weight;
  const evidence = [{ ...nameEvidence }];
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
  const birthYear = matching.intrinsic.birthYear ?? figure.life?.birthYear;
  if (Number.isInteger(currentYear) && Number.isInteger(birthYear) && Number.isFinite(character.age)) {
    if (character.conflicts?.birthDate) {
      conflict("RELATION_BIRTH_CONFLICT");
    } else {
      const difference = Math.abs(character.age - (currentYear - birthYear));
      if (difference <= 2) add("AGE_MATCH_STRONG", 0.18);
      else if (difference <= 5) add("AGE_MATCH_WEAK", 0.10);
      else if (difference >= 15) conflict("AGE_IMPOSSIBLE", -0.50, true);
      else conflict("AGE_MISMATCH", -0.15);
    }
  }
  if (matching.intrinsic.gender === "male" || matching.intrinsic.gender === "female") {
    if (character.conflicts?.gender) conflict("RELATION_GENDER_CONFLICT");
    else if (character.gender === matching.intrinsic.gender) add("GENDER_MATCH", 0.05);
    else if (character.gender === "male" || character.gender === "female") conflict("GENDER_CONFLICT", -0.40, true);
  }
  for (const familyHint of matching.familyHints) {
    const expected = new Set(familyHint.names.map(normalizeHistoricalName));
    const matched = character.familyEvidence.some((entry) => entry.relation === familyHint.relation && entry.names.some((name) => expected.has(normalizeHistoricalName(name))));
    if (matched) {
      add("FAMILY_MATCH", 0.20);
      break;
    }
  }
  if (normalizedEquals(character.culture, matching.hints.cultures)) add("CULTURE_HINT_MATCH", 0.07);
  if (normalizedEquals(character.house, matching.hints.houses)) add("HOUSE_HINT_MATCH", 0.08);
  if ([character.primaryTitle, character.titleRankConcept].some((value) => normalizedIncludes(value, matching.hints.titles))) add("TITLE_HINT_MATCH", 0.05);
  if (normalizedIncludes(character.heldCourtAndCouncilPositions, matching.hints.positions)) add("POSITION_HINT_MATCH", 0.06);
  if ([character.liege, character.topLiege].some((value) => normalizedIncludes(value, matching.hints.realms))) add("REALM_HINT_MATCH", 0.04);
  if (normalizedIncludes(character.capitalLocation, matching.hints.locations)) add("LOCATION_HINT_MATCH", 0.03);
  if (Number.isInteger(currentYear) && Number.isInteger(figure.life?.deathYear) && currentYear > figure.life.deathYear) evidence.push({ code: "SURVIVED_BEYOND_BASELINE_DEATH", weight: 0 });
  return {
    characterId: character.id,
    displayName: character.names.fullName || character.names.shortName || character.names.firstName,
    score: roundScore(rawScore),
    evidence,
    conflicts,
    hardConflicts,
    hasStrongSecondaryIdentity: evidence.some((entry) => ["AGE_MATCH_STRONG", "AGE_MATCH_WEAK", "FAMILY_MATCH"].includes(entry.code))
  };
}

function baseResult(figureKey, status, temporalStatus) {
  return {
    figureKey,
    status,
    matchedCharacterId: null,
    displayName: null,
    score: 0,
    confidence: "none",
    temporalStatus,
    evidence: [],
    conflicts: [],
    candidateCount: 0,
    alternatives: []
  };
}

function resolveFigure(figure, matching, input, nameIndex) {
  if (!matching || matching.resolverReady !== true) return baseResult(figure.figureKey, FIGURE_STATUS.UNSUPPORTED, "unknown");
  const currentYear = input.date?.valid ? input.date.year : null;
  const dueYear = matching.intrinsic.birthYear ?? figure.activeWindow?.earliestYear ?? figure.life?.birthYear;
  const temporalStatus = Number.isInteger(currentYear) ? "due" : "unknown";
  if (Number.isInteger(currentYear) && Number.isInteger(dueYear) && currentYear < dueYear) return baseResult(figure.figureKey, FIGURE_STATUS.NOT_DUE, "not_due");
  const candidates = findFigureCandidates(figure, nameIndex).map(({ character, nameEvidence }) => scoreCandidate(figure, matching, character, nameEvidence, currentYear)).sort((left, right) => right.score - left.score || left.characterId - right.characterId);
  if (candidates.length === 0) return baseResult(figure.figureKey, FIGURE_STATUS.DUE_UNRESOLVED, temporalStatus);
  const top = candidates[0];
  const second = candidates[1] || null;
  const margin = second ? roundScore(top.score - second.score) : 1;
  let status = FIGURE_STATUS.DUE_UNRESOLVED;
  if (top.score >= 0.65 && second?.score >= 0.65 && margin < 0.15) status = FIGURE_STATUS.AMBIGUOUS;
  else if (top.score >= 0.85 && margin >= 0.15 && top.hardConflicts.length === 0 && top.hasStrongSecondaryIdentity) status = FIGURE_STATUS.RESOLVED;
  else if (top.score >= 0.65 && top.hardConflicts.length === 0) status = FIGURE_STATUS.CANDIDATE;
  return {
    figureKey: figure.figureKey,
    status,
    matchedCharacterId: status === FIGURE_STATUS.RESOLVED ? top.characterId : null,
    displayName: status === FIGURE_STATUS.RESOLVED ? top.displayName : null,
    score: top.score,
    confidence: status === FIGURE_STATUS.RESOLVED ? "high" : status === FIGURE_STATUS.CANDIDATE || status === FIGURE_STATUS.AMBIGUOUS ? "medium" : "none",
    temporalStatus,
    evidence: top.evidence,
    conflicts: top.conflicts,
    candidateCount: candidates.length,
    alternatives: candidates.slice(0, 3).map((candidate) => ({ characterId: candidate.characterId, displayName: candidate.displayName, score: candidate.score }))
  };
}

function resolveHistoricalFigures({ figures, matchingRecords, input }) {
  const matchingByKey = new Map(matchingRecords.map((record) => [record.figureKey, record]));
  const nameIndex = buildFigureNameIndex(input.characters);
  const results = figures.map((figure) => resolveFigure(figure, matchingByKey.get(figure.figureKey), input, nameIndex));
  const summary = { total: results.length, unsupported: 0, notDue: 0, unresolved: 0, candidate: 0, ambiguous: 0, resolved: 0 };
  const summaryKey = {
    [FIGURE_STATUS.UNSUPPORTED]: "unsupported",
    [FIGURE_STATUS.NOT_DUE]: "notDue",
    [FIGURE_STATUS.DUE_UNRESOLVED]: "unresolved",
    [FIGURE_STATUS.CANDIDATE]: "candidate",
    [FIGURE_STATUS.AMBIGUOUS]: "ambiguous",
    [FIGURE_STATUS.RESOLVED]: "resolved"
  };
  for (const result of results) summary[summaryKey[result.status]] += 1;
  return deepFreeze({ status: "ready", summary, results });
}

class HistoricalFigureResolver {
  constructor({ figures, matchingRecords, relationshipResolver, inferGenderFromPronoun, parseGameDateStrict }) {
    validateFigureMatchingDataset(matchingRecords, figures);
    if (!relationshipResolver || typeof relationshipResolver.buildCanonicalProfiles !== "function") throw new Error("historical_figure_relationship_resolver_required");
    if (typeof inferGenderFromPronoun !== "function") throw new Error("historical_figure_gender_inference_required");
    if (typeof parseGameDateStrict !== "function") throw new Error("historical_figure_date_parser_required");
    this.figures = figures;
    this.matchingRecords = matchingRecords;
    this.relationshipResolver = relationshipResolver;
    this.inferGenderFromPronoun = inferGenderFromPronoun;
    this.parseGameDateStrict = parseGameDateStrict;
  }

  resolve(gameData) {
    const input = buildHistoricalFigureInput({
      gameData,
      relationshipResolver: this.relationshipResolver,
      inferGenderFromPronoun: this.inferGenderFromPronoun,
      parseGameDateStrict: this.parseGameDateStrict
    });
    return resolveHistoricalFigures({ figures: this.figures, matchingRecords: this.matchingRecords, input });
  }
}

module.exports = { FIGURE_STATUS, HistoricalFigureResolver, resolveHistoricalFigures };
