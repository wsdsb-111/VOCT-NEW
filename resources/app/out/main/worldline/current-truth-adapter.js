"use strict";

const { resolveLifeStatus } = require("./character-temporal-facts");

const CURRENT_CLAIM_FIELDS = Object.freeze(["location", "alive", "faith", "culture", "liege", "courtEmployer"]);
const CURRENT_CLAIM_FIELD_SET = new Set(CURRENT_CLAIM_FIELDS);
const BOOLEAN_CLAIM_FIELDS = new Set(["alive"]);

function normalizeField(field) {
  const value = String(field || "").trim();
  if (!value) return null;
  const match = CURRENT_CLAIM_FIELDS.find((item) => item.toLocaleLowerCase() === value.toLocaleLowerCase());
  return match || null;
}

function characterDisplay(snapshot, runtimeId) {
  const character = snapshot?.characters?.[String(runtimeId)];
  const name = String(character?.fullName || character?.firstName || character?.shortName || "").trim();
  return name || `#${runtimeId}`;
}

function displayValue(snapshot, field, rawValue) {
  if (field === "alive") return rawValue ? "在世" : "已故";
  if (["liege", "courtEmployer"].includes(field)) return characterDisplay(snapshot, rawValue);
  return String(rawValue);
}

function getCurrentTruth(snapshot, entityId, field) {
  const normalizedField = normalizeField(field);
  if (!normalizedField) return { available: false, reason: "CURRENT_TRUTH_FIELD_UNSUPPORTED" };
  const character = snapshot?.characters?.[String(entityId)];
  if (!character) return { available: false, reason: "CURRENT_TRUTH_CHARACTER_UNAVAILABLE" };
  const lifeStatus = normalizedField === "alive" ? resolveLifeStatus(character) : null;
  if (lifeStatus?.conflict) return { available: false, reason: "CURRENT_TRUTH_LIFE_STATUS_CONFLICT", field: normalizedField };
  const value = normalizedField === "alive" ? lifeStatus?.alive : character[normalizedField];
  if (value === null || value === undefined || value === "") return { available: false, reason: "CURRENT_TRUTH_VALUE_UNAVAILABLE", field: normalizedField };
  const rawValue = BOOLEAN_CLAIM_FIELDS.has(normalizedField) ? value === true : String(value);
  if (BOOLEAN_CLAIM_FIELDS.has(normalizedField) && typeof value !== "boolean") return { available: false, reason: "CURRENT_TRUTH_VALUE_INVALID", field: normalizedField };
  return {
    available: true,
    entityId: String(entityId),
    field: normalizedField,
    rawValue,
    displayValue: displayValue(snapshot, normalizedField, rawValue),
    asOf: snapshot?.gameDate || null,
    source: "CHECKPOINT_CHARACTER"
  };
}

function currentTruthFact(snapshot, entityId, field, values = {}) {
  const truth = getCurrentTruth(snapshot, entityId, field);
  if (!truth.available) return null;
  return {
    ...values,
    entityId: truth.entityId,
    field: truth.field.replace(/[A-Z]/g, (letter) => `_${letter}`).toUpperCase(),
    // Keep the established human-readable fact text for policy/prompt output;
    // only structuredValue is the canonical comparison value.
    value: values.value ?? truth.displayValue,
    structuredValue: truth.rawValue,
    structuredDisplayValue: truth.displayValue,
    sourceTier: "GAME_TRUTH",
    asOf: truth.asOf
  };
}

module.exports = { BOOLEAN_CLAIM_FIELDS, CURRENT_CLAIM_FIELDS, CURRENT_CLAIM_FIELD_SET, currentTruthFact, getCurrentTruth, normalizeField };
