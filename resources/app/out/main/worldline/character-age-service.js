"use strict";

const { computeAgeAtDate, computeAgeAtDeath } = require("./character-temporal-facts");

function resolveCharacterAge(character = {}, currentGameDate = null) {
  const dead = character.alive === false || !!character.deathDate;
  const derived = dead ? computeAgeAtDeath(character) : computeAgeAtDate(character.birth || character.birthDate, currentGameDate);
  if (derived !== null) return { age: derived, label: dead ? "ageAtDeath" : "age", source: dead ? "BIRTH_DEATH_DATES" : "BIRTH_CURRENT_DATE", conflict: Number.isFinite(Number(character.age)) && Number(character.age) !== derived };
  const raw = Number(character.age);
  return Number.isFinite(raw) ? { age: Math.floor(raw), label: dead ? "ageAtDeath" : "age", source: "RAW_AGE_FALLBACK", conflict: false } : { age: null, label: dead ? "ageAtDeath" : "age", source: "UNKNOWN", conflict: false };
}

module.exports = { resolveCharacterAge };
