"use strict";

const { computeAgeAtDate, computeAgeAtDeath, resolveLifeStatus, normalizeGameDate } = require("./character-temporal-facts");

function nonnegativeNumber(value) {
  if (typeof value !== "number" && typeof value !== "string" || typeof value === "string" && !value.trim()) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function ageResult({ age = null, label = "age", source = "UNKNOWN", conflict = false, rawAge = null, calculatedCalendarAge = null, asOfGameDate = null, reason = null } = {}) {
  return {
    age,
    label,
    source,
    ageSource: source,
    conflict,
    rawAge,
    calculatedCalendarAge,
    asOfGameDate,
    ...(reason ? { reason } : {})
  };
}

function trustedCurrentAge(character = {}) {
  const source = character.ageSource;
  if (source !== "CK3_CURRENT_AGE" && source !== "CK3_LIVE_RELATIVE_AGE") return null;
  const value = nonnegativeNumber(character.age);
  if (value === null || !Number.isInteger(value)) return null;
  if (source === "CK3_LIVE_RELATIVE_AGE") {
    const bound = (character.evidence?.age || []).some(evidence => evidence.ageSource === source
      && nonnegativeNumber(evidence.value) === value
      && Number.isFinite(Number(evidence.sourceOwnerId)) && Number(evidence.sourceOwnerId) > 0
      && ["parent", "child", "sibling", "spouse"].includes(evidence.relationType)
      && typeof evidence.source === "string" && evidence.source.length > 0);
    if (!bound) return null;
  }
  return { value, source };
}

function resolveCharacterAge(character = {}, current = null) {
  const options = current && typeof current === "object" ? current : { currentGameDate: current };
  const lifeStatus = resolveLifeStatus(character);
  const asOfGameDate = normalizeGameDate(options.currentGameDate)?.canonical || null;
  if (lifeStatus.conflict) return ageResult({ source: "LIFE_STATUS_CONFLICT", conflict: true, asOfGameDate });
  const dead = lifeStatus.alive === false;
  if (dead) {
    const calculatedCalendarAge = computeAgeAtDate(character.birth || character.birthDate, character.deathDate);
    if (character.ageAtDeathSource === "CK3_AGE_AT_DEATH") {
      const explicitAge = nonnegativeNumber(character.ageAtDeath);
      if (explicitAge !== null && Number.isInteger(explicitAge)) {
        return ageResult({ age: explicitAge, label: "ageAtDeath", source: "CK3_AGE_AT_DEATH", rawAge: explicitAge, calculatedCalendarAge, conflict: character.ageEvidenceConflict === true || calculatedCalendarAge !== null && calculatedCalendarAge !== explicitAge, asOfGameDate: normalizeGameDate(character.deathDate)?.canonical || null });
      }
    }
    if (calculatedCalendarAge !== null) return ageResult({ age: calculatedCalendarAge, label: "ageAtDeath", source: "BIRTH_DEATH_CALENDAR", calculatedCalendarAge, asOfGameDate: normalizeGameDate(character.deathDate)?.canonical || null });
    const hasOrdinalDates = nonnegativeNumber(character.birthDateTotalDays ?? character.birthTotalDays) !== null
      || nonnegativeNumber(character.deathDateTotalDays ?? character.deathTotalDays) !== null;
    return ageResult({ label: "ageAtDeath", source: "AGE_AT_DEATH_UNAVAILABLE", asOfGameDate: normalizeGameDate(character.deathDate)?.canonical || null, reason: hasOrdinalDates ? "CALENDAR_DAY_MAPPING_UNVERIFIED" : "DATE_EVIDENCE_UNAVAILABLE" });
  }
  const currentAge = trustedCurrentAge(character);
  const calculatedCalendarAge = computeAgeAtDate(character.birth || character.birthDate, options.currentGameDate);
  if (currentAge) {
    return ageResult({
      age: currentAge.value,
      source: currentAge.source,
      rawAge: currentAge.value,
      calculatedCalendarAge,
      conflict: character.ageEvidenceConflict === true || calculatedCalendarAge !== null && calculatedCalendarAge !== currentAge.value,
      asOfGameDate
    });
  }
  if (character.ageSource === "AGE_SOURCE_CONFLICT" || character.ageEvidenceConflict === true && character.ageSource !== "CK3_CURRENT_AGE" && character.ageSource !== "CK3_LIVE_RELATIVE_AGE") {
    return ageResult({ source: "AGE_SOURCE_CONFLICT", conflict: true, calculatedCalendarAge, asOfGameDate, reason: "AGE_EVIDENCE_CONFLICT" });
  }
  if (calculatedCalendarAge !== null) return ageResult({ age: calculatedCalendarAge, source: "BIRTH_CURRENT_CALENDAR", calculatedCalendarAge, asOfGameDate });
  const hasBirthOrdinal = nonnegativeNumber(character.birthDateTotalDays ?? character.birthTotalDays) !== null;
  return ageResult({
    source: "UNKNOWN",
    calculatedCalendarAge: null,
    asOfGameDate,
    reason: hasBirthOrdinal ? "CALENDAR_DAY_MAPPING_UNVERIFIED" : "DATE_EVIDENCE_UNAVAILABLE"
  });
}

// Positive means subject is older. Age-at-death must never establish seniority.
function compareCharacterSeniority(subject = {}, reference = {}) {
  if (subject.evidence?.conflicts?.birthDate || reference.evidence?.conflicts?.birthDate) return null;
  const birth = nonnegativeNumber(subject.birthDateTotalDays ?? subject.birthTotalDays);
  const otherBirth = nonnegativeNumber(reference.birthDateTotalDays ?? reference.birthTotalDays);
  if (birth !== null && otherBirth !== null) return Math.sign(otherBirth - birth) || null;
  const date = normalizeGameDate(subject.birth || subject.birthDate);
  const otherDate = normalizeGameDate(reference.birth || reference.birthDate);
  if (date && otherDate) return Math.sign(otherDate.serial - date.serial) || null;
  const subjectLife = resolveLifeStatus(subject);
  const referenceLife = resolveLifeStatus(reference);
  if (subjectLife.conflict || referenceLife.conflict || subjectLife.alive === false || referenceLife.alive === false) return null;
  const age = nonnegativeNumber(subject.age);
  const otherAge = nonnegativeNumber(reference.age);
  return age !== null && otherAge !== null ? Math.sign(age - otherAge) || null : null;
}

module.exports = { resolveCharacterAge, nonnegativeNumber, compareCharacterSeniority };
