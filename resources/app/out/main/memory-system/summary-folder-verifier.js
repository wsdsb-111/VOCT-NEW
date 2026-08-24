"use strict";

function verifyDirectedSummaryPersistence({ directedPairs = [], finalizationId, getFilePath, readSummaries } = {}) {
  if (!finalizationId || typeof getFilePath !== "function" || typeof readSummaries !== "function") {
    return { success: false, error: "summary_persistence_verification_context_required", missingPairs: [] };
  }
  const missingPairs = [];
  for (const { owner, counterpart } of directedPairs) {
    const filePath = getFilePath(owner, counterpart);
    const summaries = readSummaries(filePath);
    if (!Array.isArray(summaries) || !summaries.some((summary) => summary?.finalizationId === finalizationId)) {
      missingPairs.push({ ownerId: Number(owner?.id), counterpartId: Number(counterpart?.id), filePath });
    }
  }
  return missingPairs.length === 0
    ? { success: true, missingPairs: [] }
    : { success: false, error: "directed_summary_persistence_incomplete", missingPairs };
}

module.exports = { verifyDirectedSummaryPersistence };
