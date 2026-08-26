"use strict";

const { SUPPORTED_PERSPECTIVE_SUMMARY_ENGINE_VERSIONS } = require("../version");

function verifyDirectedSummaryPersistence({ directedPairs = [], finalizationId, getFilePath, readSummaries, requirePerspective = false } = {}) {
  if (!finalizationId || typeof getFilePath !== "function" || typeof readSummaries !== "function") {
    return { success: false, error: "summary_persistence_verification_context_required", missingPairs: [] };
  }
  const missingPairs = [];
  for (const { owner, counterpart } of directedPairs) {
    const filePath = getFilePath(owner, counterpart);
    const summaries = readSummaries(filePath);
    const persisted = Array.isArray(summaries) ? summaries.find((summary) => summary?.finalizationId === finalizationId) : null;
    const perspectiveValid = !requirePerspective || SUPPORTED_PERSPECTIVE_SUMMARY_ENGINE_VERSIONS.has(persisted?.engineVersion) && Number(persisted?.perspectiveOwnerId) === Number(owner?.id) && typeof persisted?.projectionHash === "string" && persisted.projectionHash.length > 0;
    if (!persisted || !perspectiveValid) {
      missingPairs.push({ ownerId: Number(owner?.id), counterpartId: Number(counterpart?.id), filePath });
    }
  }
  return missingPairs.length === 0
    ? { success: true, missingPairs: [] }
    : { success: false, error: "directed_summary_persistence_incomplete", missingPairs };
}

module.exports = { verifyDirectedSummaryPersistence };
