"use strict";

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const nested of Object.values(value)) deepFreeze(nested);
  return value;
}

const finiteNumber = (value) => {
  if (value === null || value === undefined || value === "" || typeof value === "boolean") return null;
  return Number.isFinite(Number(value)) ? Number(value) : null;
};
const stringValue = (value) => typeof value === "string" ? value : "";

function extractNamesFromRelationshipValue(value) {
  if (!value) return [];
  if (typeof value === "string") return value.split(/[、,，;\/]/).map((item) => item.trim()).filter(Boolean);
  if (Array.isArray(value)) return value.flatMap(extractNamesFromRelationshipValue);
  if (typeof value === "object") return [value.name, value.shortName, value.fullName].filter((item) => typeof item === "string" && item.trim());
  return [];
}

function buildFamilyEvidence(profile, profiles, canonicalCharacter) {
  const evidence = [];
  const seen = new Set();
  const add = (relation, relatedCharacterId, names) => {
    const usableNames = [...new Set((names || []).filter((name) => typeof name === "string" && name.trim()))];
    const key = `${relation}:${relatedCharacterId ?? usableNames.join("|")}`;
    if (seen.has(key) || usableNames.length === 0) return;
    seen.add(key);
    evidence.push({ relation, relatedCharacterId: finiteNumber(relatedCharacterId), names: usableNames });
  };
  for (const [field, relation] of [["parents", "parent"], ["children", "child"], ["siblings", "sibling"]]) {
    for (const entry of profile[field] || []) add(relation, entry?.id, [entry?.name, entry?.fullName, entry?.shortName]);
  }
  for (const relation of profile.evidence?.relations || []) {
    const related = profiles.get(Number(relation.ownerId));
    const inverse = relation.relationType === "parent" ? "child" : relation.relationType === "child" ? "parent" : relation.relationType;
    add(inverse, relation.ownerId, [related?.fullName, related?.shortName, related?.firstName]);
  }
  add("spouse", null, extractNamesFromRelationshipValue(profile.consort || canonicalCharacter?.consort));
  return evidence;
}

function buildHistoricalFigureInput({ gameData, relationshipResolver, inferGenderFromPronoun, parseGameDateStrict }) {
  if (!gameData || typeof gameData !== "object") throw new Error("historical_figure_input_game_data_required");
  if (!(gameData.characters instanceof Map)) throw new Error("historical_figure_input_characters_map_required");
  if (!relationshipResolver || typeof relationshipResolver.buildCanonicalProfiles !== "function") throw new Error("historical_figure_input_relationship_resolver_required");
  if (typeof inferGenderFromPronoun !== "function") throw new Error("historical_figure_input_gender_inference_required");
  if (typeof parseGameDateStrict !== "function") throw new Error("historical_figure_input_date_parser_required");
  const profiles = relationshipResolver.buildCanonicalProfiles(gameData.characters, gameData.totalDays, inferGenderFromPronoun);
  const characters = [...profiles.values()].filter((profile) => gameData.characters.has(Number(profile.id))).sort((left, right) => Number(left.id) - Number(right.id)).map((profile) => ({
    id: Number(profile.id),
    names: {
      shortName: stringValue(profile.shortName),
      fullName: stringValue(profile.fullName),
      firstName: stringValue(profile.firstName),
      canonicalNames: [...new Set([profile.fullName, profile.shortName, profile.firstName].filter((name) => typeof name === "string" && name.trim()))]
    },
    gender: profile.gender === "male" || profile.gender === "female" ? profile.gender : "unknown",
    age: finiteNumber(profile.age),
    birthDateTotalDays: finiteNumber(profile.birthDateTotalDays),
    culture: stringValue(profile.culture),
    faith: stringValue(profile.faith),
    house: stringValue(profile.house),
    primaryTitle: stringValue(profile.primaryTitle),
    heldCourtAndCouncilPositions: stringValue(profile.heldCourtAndCouncilPositions),
    titleRankConcept: stringValue(profile.titleRankConcept),
    liege: stringValue(profile.liege),
    topLiege: stringValue(profile.topLiege),
    capitalLocation: stringValue(profile.capitalLocation),
    isRuler: profile.isRuler === true,
    isIndependentRuler: profile.isIndependentRuler === true,
    isLandedRuler: profile.isLandedRuler === true,
    familyEvidence: buildFamilyEvidence(profile, profiles, gameData.characters.get(Number(profile.id))),
    conflicts: {
      gender: profile.evidence?.conflicts?.gender === true,
      birthDate: profile.evidence?.conflicts?.birthDate === true
    }
  }));
  return deepFreeze({
    date: { ...parseGameDateStrict(gameData.date) },
    totalDays: finiteNumber(gameData.totalDays),
    characters
  });
}

module.exports = { buildHistoricalFigureInput, deepFreeze, extractNamesFromRelationshipValue };
