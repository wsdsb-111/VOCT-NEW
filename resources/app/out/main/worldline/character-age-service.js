"use strict";

const crypto = require("crypto");
const { computeAgeAtDate, resolveLifeStatus, normalizeGameDate } = require("./character-temporal-facts");

function nonnegativeNumber(value) {
  if (typeof value !== "number" && typeof value !== "string" || typeof value === "string" && !value.trim()) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function ageResult({ age = null, label = "age", source = "UNKNOWN", conflict = false, sourceConflict = conflict, rawAge = null, calculatedCalendarAge = null, calendarEstimateDiffers = false, asOfGameDate = null, reason = null, diagnosticCode = null, sourceOwnerId = null, currentAgeSourceOwnerIdHash = null, currentAgeRelationType = null, currentAgeEvidenceSourceType = null } = {}) {
  return {
    age,
    label,
    source,
    ageSource: source,
    conflict,
    sourceConflict,
    rawAge,
    calculatedCalendarAge,
    calendarEstimateDiffers,
    asOfGameDate,
    diagnosticCode,
    sourceOwnerId,
    currentAgeSourceOwnerIdHash,
    currentAgeRelationType,
    currentAgeEvidenceSourceType,
    ...(reason ? { reason } : {})
  };
}

function sourceSnapshotId(gameDate, totalDays) {
  const date = String(gameDate || "").trim();
  const days = nonnegativeNumber(totalDays);
  return date && days !== null ? `${date}/${days}` : null;
}

function trustedCurrentAge(character = {}, options = {}) {
  const source = character.ageSource;
  if (source !== "CK3_CURRENT_AGE" && source !== "CK3_LIVE_RELATIVE_AGE") return null;
  const value = nonnegativeNumber(character.age);
  if (value === null || !Number.isInteger(value)) return null;
  let evidence = null;
  if (source === "CK3_LIVE_RELATIVE_AGE") {
    evidence = (character.evidence?.age || []).find(item => item.ageSource === source
      && nonnegativeNumber(item.value) === value
      && Number.isSafeInteger(Number(item.sourceOwnerId)) && Number(item.sourceOwnerId) > 0
      && ["parent", "child", "sibling", "spouse"].includes(item.relationType)
      && typeof item.source === "string" && item.source.trim().length > 0
      && (item.relationType === "spouse"
        ? item.source.startsWith(`${Number(item.sourceOwnerId)}.`) || item.source.startsWith("spouse.")
        : item.source === `${Number(item.sourceOwnerId)}.${{ parent: "parents", child: "children", sibling: "siblings" }[item.relationType]}`));
    evidence = evidence && typeof evidence.campaignToken === "string" && evidence.campaignToken.length > 0
      && evidence.campaignToken === options.currentCampaignToken
      && typeof evidence.sourceSnapshotId === "string" && evidence.sourceSnapshotId.length > 0
      && evidence.sourceSnapshotId === sourceSnapshotId(options.currentGameDate, options.currentTotalDays)
      ? evidence
      : null;
    if (!evidence) return null;
  }
  return { value, source, evidence };
}

function sourceOwnerIdHash(evidence) {
  if (!evidence) return null;
  return crypto.createHash("sha256").update(String(evidence.sourceOwnerId)).digest("hex");
}

function evidenceSourceType(evidence) {
  if (typeof evidence?.source !== "string") return null;
  if (evidence.source.startsWith("spouse.")) return "spouse";
  const segments = evidence.source.split(".");
  const sourceType = segments[segments.length - 1];
  return ["parents", "children", "siblings", "spouses"].includes(sourceType) ? sourceType : "other";
}

function resolveCharacterAge(character = {}, current = null) {
  const options = current && typeof current === "object" ? current : { currentGameDate: current };
  const lifeStatus = resolveLifeStatus(character);
  const asOfGameDate = normalizeGameDate(options.currentGameDate)?.canonical || null;
  if (lifeStatus.conflict) return ageResult({ source: "LIFE_STATUS_CONFLICT", conflict: true, asOfGameDate, diagnosticCode: "LIFE_STATUS_CONFLICT" });
  const dead = lifeStatus.alive === false;
  if (dead) {
    const calculatedCalendarAge = computeAgeAtDate(character.birth || character.birthDate, character.deathDate);
    if (character.ageAtDeathSource === "CK3_AGE_AT_DEATH") {
      const explicitAge = nonnegativeNumber(character.ageAtDeath);
      if (explicitAge !== null && Number.isInteger(explicitAge)) {
        return ageResult({
          age: explicitAge,
          label: "ageAtDeath",
          source: "CK3_AGE_AT_DEATH",
          rawAge: explicitAge,
          calculatedCalendarAge,
          calendarEstimateDiffers: calculatedCalendarAge !== null && calculatedCalendarAge !== explicitAge,
          conflict: character.ageEvidenceConflict === true || calculatedCalendarAge !== null && calculatedCalendarAge !== explicitAge,
          sourceConflict: character.ageEvidenceConflict === true,
          diagnosticCode: character.ageEvidenceConflict === true ? "AGE_EVIDENCE_CONFLICT" : calculatedCalendarAge !== null ? "CALENDAR_AGE_UNVERIFIED" : "CK3_AGE_AT_DEATH_SELECTED",
          asOfGameDate: normalizeGameDate(character.deathDate)?.canonical || null
        });
      }
    }
    const hasOrdinalDates = nonnegativeNumber(character.birthDateTotalDays ?? character.birthTotalDays) !== null
      || nonnegativeNumber(character.deathDateTotalDays ?? character.deathTotalDays) !== null;
    return ageResult({
      label: "ageAtDeath",
      source: "AGE_AT_DEATH_UNAVAILABLE",
      calculatedCalendarAge,
      asOfGameDate: normalizeGameDate(character.deathDate)?.canonical || null,
      reason: calculatedCalendarAge !== null ? "CALENDAR_RULE_UNVERIFIED" : hasOrdinalDates ? "CALENDAR_DAY_MAPPING_UNVERIFIED" : "DATE_EVIDENCE_UNAVAILABLE",
      diagnosticCode: calculatedCalendarAge !== null ? "CALENDAR_AGE_UNVERIFIED" : hasOrdinalDates ? "CALENDAR_DAY_MAPPING_UNVERIFIED" : "DATE_EVIDENCE_UNAVAILABLE"
    });
  }
  const currentAge = trustedCurrentAge(character, options);
  const calculatedCalendarAge = computeAgeAtDate(character.birth || character.birthDate, options.currentGameDate);
  if (currentAge) {
    return ageResult({
      age: currentAge.value,
      source: currentAge.source,
      rawAge: currentAge.value,
      calculatedCalendarAge,
      calendarEstimateDiffers: calculatedCalendarAge !== null && calculatedCalendarAge !== currentAge.value,
      conflict: character.ageEvidenceConflict === true || calculatedCalendarAge !== null && calculatedCalendarAge !== currentAge.value,
      sourceConflict: character.ageEvidenceConflict === true,
      asOfGameDate,
      diagnosticCode: character.ageEvidenceConflict === true ? "AGE_EVIDENCE_CONFLICT" : calculatedCalendarAge !== null ? "CALENDAR_AGE_UNVERIFIED" : "CURRENT_AGE_SELECTED",
      sourceOwnerId: currentAge.evidence?.sourceOwnerId ?? null,
      currentAgeSourceOwnerIdHash: sourceOwnerIdHash(currentAge.evidence),
      currentAgeRelationType: currentAge.evidence?.relationType || null,
      currentAgeEvidenceSourceType: evidenceSourceType(currentAge.evidence)
    });
  }
  const rawAge = nonnegativeNumber(character.age);
  if (character.ageSource === "CK3_LIVE_RELATIVE_AGE") {
    return ageResult({
      source: "UNKNOWN",
      rawAge,
      calculatedCalendarAge,
      asOfGameDate,
      reason: "RELATIVE_AGE_EVIDENCE_UNBOUND",
      diagnosticCode: "RELATIVE_AGE_UNBOUND"
    });
  }
  if (character.ageSource === "AGE_SOURCE_CONFLICT" || character.ageEvidenceConflict === true && character.ageSource !== "CK3_CURRENT_AGE" && character.ageSource !== "CK3_LIVE_RELATIVE_AGE") {
    return ageResult({ source: "AGE_SOURCE_CONFLICT", conflict: true, rawAge, calculatedCalendarAge, asOfGameDate, reason: "AGE_EVIDENCE_CONFLICT", diagnosticCode: "AGE_EVIDENCE_CONFLICT" });
  }
  if (character.ageSource === "CK3_CURRENT_AGE" && rawAge === null) {
    return ageResult({ source: "UNKNOWN", calculatedCalendarAge, asOfGameDate, reason: "CURRENT_AGE_INVALID", diagnosticCode: "CURRENT_AGE_INVALID" });
  }
  if (rawAge !== null && !character.ageSource) {
    return ageResult({ source: "UNKNOWN", rawAge, calculatedCalendarAge, asOfGameDate, reason: "CURRENT_AGE_SOURCE_UNAVAILABLE", diagnosticCode: "CURRENT_AGE_SOURCE_UNAVAILABLE" });
  }
  if (calculatedCalendarAge !== null) {
    return ageResult({ source: "UNKNOWN", rawAge, calculatedCalendarAge, asOfGameDate, reason: "CALENDAR_RULE_UNVERIFIED", diagnosticCode: "CALENDAR_AGE_UNVERIFIED" });
  }
  const hasBirthOrdinal = nonnegativeNumber(character.birthDateTotalDays ?? character.birthTotalDays) !== null;
  return ageResult({
    source: "UNKNOWN",
    rawAge,
    asOfGameDate,
    reason: hasBirthOrdinal ? "CALENDAR_DAY_MAPPING_UNVERIFIED" : "DATE_EVIDENCE_UNAVAILABLE",
    diagnosticCode: hasBirthOrdinal ? "CALENDAR_DAY_MAPPING_UNVERIFIED" : "DATE_EVIDENCE_UNAVAILABLE"
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
