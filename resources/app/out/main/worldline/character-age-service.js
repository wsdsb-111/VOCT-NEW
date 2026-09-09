"use strict";

const { computeAgeAtDate, computeAgeAtDeath, resolveLifeStatus } = require("./character-temporal-facts");

function resolveCharacterAge(character = {}, current = null) {
  const options = current && typeof current === "object" ? current : { currentGameDate: current };
  const lifeStatus = resolveLifeStatus(character);
  if (lifeStatus.conflict) return { age: null, label: "age", source: "LIFE_STATUS_CONFLICT", conflict: true };
  const dead = lifeStatus.alive === false;
  let derived = dead ? computeAgeAtDeath(character) : null;
  let source = dead && derived !== null && Number.isFinite(Number(character.birthDateTotalDays)) && Number.isFinite(Number(character.deathDateTotalDays)) ? "BIRTH_DEATH_TOTAL_DAYS" : "BIRTH_DEATH_DATES";
  if (!dead && Number.isFinite(Number(character.birthDateTotalDays)) && Number.isFinite(Number(options.currentTotalDays))) {
    derived = Math.max(0, Math.floor((Number(options.currentTotalDays) - Number(character.birthDateTotalDays)) / 365.2425));
    source = "BIRTH_CURRENT_TOTAL_DAYS";
  } else if (!dead) {
    derived = computeAgeAtDate(character.birth || character.birthDate, options.currentGameDate);
    source = "BIRTH_CURRENT_DATE";
  }
  if (derived !== null) return { age: derived, label: dead ? "ageAtDeath" : "age", source, conflict: Number.isFinite(Number(character.age)) && Number(character.age) !== derived };
  if (dead) return { age: null, label: "ageAtDeath", source: "AGE_AT_DEATH_UNAVAILABLE", conflict: false };
  const raw = Number(character.age);
  return Number.isFinite(raw) ? { age: Math.floor(raw), label: "age", source: "RAW_AGE_FALLBACK", conflict: false } : { age: null, label: "age", source: "UNKNOWN", conflict: false };
}

module.exports = { resolveCharacterAge };
