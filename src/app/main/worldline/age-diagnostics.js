"use strict";

const crypto = require("crypto");
const { diagnoseAgeLayers } = require("./character-age-service");

const AGE_DIAGNOSTIC_STAGES = ["ck3Panel", "rawCharacter", "parsedCharacter", "canonicalProfile", "resolvedAge", "familyFact", "prompt", "modelAnswer"];

function normalizeDiagnosticAge(value) {
  if (typeof value === "number") return Number.isSafeInteger(value) && value >= 0 ? value : null;
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!/^(?:0|[1-9]\d*)$/.test(text)) return null;
  const age = Number(text);
  return Number.isSafeInteger(age) ? age : null;
}

function hashCharacterId(value) {
  const id = typeof value === "number" || typeof value === "string" && value.trim()
    ? Number(value) : NaN;
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  return crypto.createHmac("sha256", crypto.randomBytes(32)).update(String(id)).digest("hex");
}

function collectAgeDiagnostic(input = {}) {
  const characterIdHash = hashCharacterId(input.characterId);
  const expectedSnapshotId = typeof input.snapshotId === "string" ? input.snapshotId.trim() : "";
  const observations = input.observations && typeof input.observations === "object" ? input.observations : {};
  const missingStages = [];
  const missingSnapshotStages = [];
  const mismatchedSnapshotStages = [];
  const normalized = [];

  for (const stage of AGE_DIAGNOSTIC_STAGES) {
    const observation = observations[stage];
    const age = normalizeDiagnosticAge(observation?.age);
    if (age === null) missingStages.push(stage);
    if (typeof observation?.snapshotId !== "string" || !observation.snapshotId.trim()) {
      missingSnapshotStages.push(stage);
    } else if (expectedSnapshotId && observation.snapshotId.trim() !== expectedSnapshotId) {
      mismatchedSnapshotStages.push(stage);
    }
    normalized.push({ stage, age });
  }

  if (!characterIdHash || !expectedSnapshotId || missingStages.length || missingSnapshotStages.length || mismatchedSnapshotStages.length) {
    return {
      status: "INCOMPLETE",
      diagnosticCode: null,
      characterIdHash,
      reasonCodes: [
        ...(!characterIdHash ? ["INVALID_CHARACTER_ID"] : []),
        ...(!expectedSnapshotId ? ["MISSING_EXPECTED_SNAPSHOT"] : []),
        ...(missingStages.length ? ["MISSING_AGE_OBSERVATION"] : []),
        ...(missingSnapshotStages.length ? ["MISSING_STAGE_SNAPSHOT"] : []),
        ...(mismatchedSnapshotStages.length ? ["SNAPSHOT_MISMATCH"] : [])
      ],
      missingStages,
      missingSnapshotStages,
      mismatchedSnapshotStages
    };
  }

  const result = diagnoseAgeLayers(normalized);
  return {
    status: result.status,
    diagnosticCode: result.diagnosticCode,
    characterIdHash,
    checkedFromStage: result.checkedFromStage,
    checkedThroughStage: result.checkedThroughStage,
    ...(result.firstMismatchStage ? {
      firstMismatchStage: result.firstMismatchStage,
      previousAge: result.previousAge,
      observedAge: result.observedAge
    } : {})
  };
}

module.exports = { AGE_DIAGNOSTIC_STAGES, collectAgeDiagnostic };
