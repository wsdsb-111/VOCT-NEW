"use strict";

const { deepFreeze } = require("./historical-figure-input");

const textOrNull = (value) => typeof value === "string" && value.trim() ? value : null;
const numberOrNull = (value) => {
  if (value === null || value === undefined || value === "" || typeof value === "boolean") return null;
  return Number.isFinite(Number(value)) ? Number(value) : null;
};

function projectCharacter(characters, characterId) {
  const id = numberOrNull(characterId);
  if (id === null || !(characters instanceof Map)) return null;
  const character = characters.get(id);
  if (!character) return null;
  const shortName = textOrNull(character.shortName);
  const fullName = textOrNull(character.fullName);
  return {
    id,
    name: shortName || fullName,
    fullName: fullName || shortName,
    age: numberOrNull(character.age),
    gender: textOrNull(character.gender),
    culture: textOrNull(character.culture),
    faith: textOrNull(character.faith),
    house: textOrNull(character.house),
    primaryTitle: textOrNull(character.primaryTitle),
    positions: textOrNull(character.heldCourtAndCouncilPositions),
    liege: textOrNull(character.liege),
    topLiege: textOrNull(character.topLiege),
    capitalLocation: textOrNull(character.capitalLocation)
  };
}

function projectEvidence(items) {
  if (!Array.isArray(items)) return [];
  return items.filter((item) => item && typeof item.code === "string").map((item) => ({
    code: item.code,
    weight: Number.isFinite(Number(item.weight)) ? Number(item.weight) : 0
  }));
}

function projectAlternatives(items, characters) {
  if (!Array.isArray(items)) return [];
  return items.map((item) => ({
    characterId: numberOrNull(item?.characterId),
    displayName: textOrNull(item?.displayName),
    score: numberOrNull(item?.score) ?? 0,
    character: projectCharacter(characters, item?.characterId)
  }));
}

function buildHistoricalFigureDiagnostics({ gameData, figures, matchingRecords, captureId, capturedAt }) {
  if (!gameData || typeof gameData !== "object") throw new Error("historical_diagnostics_game_data_required");
  if (!Array.isArray(figures) || !Array.isArray(matchingRecords)) throw new Error("historical_diagnostics_dataset_required");
  if (typeof captureId !== "string" || !captureId) throw new Error("historical_diagnostics_capture_id_required");
  if (typeof capturedAt !== "string" || !capturedAt) throw new Error("historical_diagnostics_captured_at_required");
  const dynamicHistory = gameData.dynamicHistory;
  const figureResolution = dynamicHistory?.figureResolution;
  if (!figureResolution || !Array.isArray(figureResolution.results)) throw new Error("historical_diagnostics_resolution_unavailable");
  const matchingByKey = new Map(matchingRecords.map((record) => [record.figureKey, record]));
  const resultByKey = new Map(figureResolution.results.map((result) => [result.figureKey, result]));
  const rows = figures.map((figure) => {
    const matching = matchingByKey.get(figure.figureKey);
    const result = resultByKey.get(figure.figureKey);
    const alternatives = projectAlternatives(result?.alternatives, gameData.characters);
    const characterId = result?.matchedCharacterId ?? alternatives[0]?.characterId ?? null;
    const status = result?.status || (figureResolution.status === "error" ? "ERROR" : matching?.resolverReady ? "DUE_UNRESOLVED" : "UNSUPPORTED");
    return {
      figureKey: figure.figureKey,
      historical: {
        name: textOrNull(figure.identity?.name),
        aliases: Array.isArray(figure.identity?.aliases) ? [...figure.identity.aliases] : [],
        birthYear: numberOrNull(matching?.intrinsic?.birthYear ?? figure.life?.birthYear),
        deathYear: numberOrNull(figure.life?.deathYear),
        resolverReady: matching?.resolverReady === true
      },
      resolution: {
        status,
        score: numberOrNull(result?.score) ?? 0,
        confidence: textOrNull(result?.confidence) || "none",
        matchedCharacterId: numberOrNull(result?.matchedCharacterId)
      },
      character: projectCharacter(gameData.characters, characterId),
      evidence: projectEvidence(result?.evidence),
      conflicts: projectEvidence(result?.conflicts),
      alternatives
    };
  });
  const summary = { total: rows.length, resolverReady: rows.filter((row) => row.historical.resolverReady).length, unsupported: 0, notDue: 0, unresolved: 0, candidate: 0, ambiguous: 0, resolved: 0, error: 0 };
  const summaryKey = { UNSUPPORTED: "unsupported", NOT_DUE: "notDue", DUE_UNRESOLVED: "unresolved", CANDIDATE: "candidate", AMBIGUOUS: "ambiguous", RESOLVED: "resolved", ERROR: "error" };
  for (const row of rows) {
    const key = summaryKey[row.resolution.status];
    if (key) summary[key] += 1;
  }
  return deepFreeze({
    schemaVersion: 1,
    capture: {
      captureId,
      capturedAt,
      campaignId: textOrNull(dynamicHistory?.campaignId ?? dynamicHistory?.campaignIdentity?.campaignId),
      campaignSource: textOrNull(dynamicHistory?.campaignIdentity?.source),
      gameDate: textOrNull(gameData.date),
      totalDays: numberOrNull(gameData.totalDays),
      characterCount: gameData.characters instanceof Map ? gameData.characters.size : 0
    },
    summary,
    rows
  });
}

module.exports = { buildHistoricalFigureDiagnostics, projectCharacter };
