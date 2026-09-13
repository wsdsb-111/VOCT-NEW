"use strict";

const { computeAgeAtDate, computeAgeAtDeath, resolveLifeStatus, normalizeGameDate } = require("./character-temporal-facts");

function nonnegativeNumber(value) {
  if (typeof value !== "number" && typeof value !== "string" || typeof value === "string" && !value.trim()) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function resolveCharacterAge(character = {}, current = null) {
  const options = current && typeof current === "object" ? current : { currentGameDate: current };
  const lifeStatus = resolveLifeStatus(character);
  if (lifeStatus.conflict) return { age: null, label: "age", source: "LIFE_STATUS_CONFLICT", conflict: true };
  const dead = lifeStatus.alive === false;
  const birthDays = nonnegativeNumber(character.birthDateTotalDays);
  const currentDays = nonnegativeNumber(options.currentTotalDays);
  const raw = nonnegativeNumber(character.age);
  let derived = dead ? computeAgeAtDeath(character) : null;
  let source = dead && derived !== null && birthDays !== null && nonnegativeNumber(character.deathDateTotalDays) !== null ? "BIRTH_DEATH_TOTAL_DAYS" : "BIRTH_DEATH_DATES";
  if (!dead && birthDays !== null && currentDays !== null && currentDays >= birthDays) {
    derived = Math.floor((currentDays - birthDays) / 365.2425);
    source = "BIRTH_CURRENT_TOTAL_DAYS";
  } else if (!dead) {
    derived = computeAgeAtDate(character.birth || character.birthDate, options.currentGameDate);
    source = "BIRTH_CURRENT_DATE";
  }
  if (derived !== null) return { age: derived, label: dead ? "ageAtDeath" : "age", source, conflict: raw !== null && raw !== derived };
  if (dead) return { age: null, label: "ageAtDeath", source: "AGE_AT_DEATH_UNAVAILABLE", conflict: false };
  return raw !== null ? { age: Math.floor(raw), label: "age", source: "RAW_AGE_FALLBACK", conflict: false } : { age: null, label: "age", source: "UNKNOWN", conflict: false };
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
