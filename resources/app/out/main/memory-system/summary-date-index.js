"use strict";

const { normalizeGameDate } = require("../worldline/character-temporal-facts");

function buildSummaryDateIndex(memories, { ownerId, counterpartId, currentGameDate, currentTotalDays } = {}) {
  const current = normalizeGameDate(currentGameDate);
  const rawToday = currentTotalDays == null ? null : Number(currentTotalDays);
  const hasTotalDays = Number.isFinite(rawToday) && rawToday > 0;
  const today = hasTotalDays ? rawToday : current?.serial;
  return (memories || []).filter((memory) => {
    const ids = [memory.provenance?.counterpartId, ...(memory.provenance?.counterpartIds || [])].map(Number);
    return Number(memory.provenance?.folderOwnerId) === Number(ownerId)
      && (counterpartId == null || ids.includes(Number(counterpartId)));
  }).map((memory) => {
    const date = normalizeGameDate(memory.eventDate);
    const rawDays = Number(memory.totalDays);
    const totalDays = date && current && Number.isFinite(today) ? today + date.serial - current.serial
      : hasTotalDays && Number.isFinite(rawDays) && rawDays > 0 ? rawDays : null;
    return {
      summaryId: memory.memoryId,
      ownerId: Number(ownerId),
      counterpartId: counterpartId == null ? null : Number(counterpartId),
      totalDays,
      gameDate: date?.canonical || null,
      importance: Number(memory.importance) || 0,
      status: memory.status || null,
      unresolved: memory.unresolved === true,
      fileRef: memory.provenance?.conversationFile || null,
      revision: Number(memory.version) || 1
    };
  });
}

function selectTemporalExtras(index, memories, temporal, excludedSummaryIds = [], limit = 3) {
  if (!temporal?.triggered) return [];
  const byId = new Map((memories || []).map((memory) => [memory.memoryId, memory]));
  const excluded = new Set(excludedSummaryIds);
  const seen = new Set();
  const selected = [];
  const sort = (left, right) => temporal.order === "TARGET_DISTANCE"
    ? Math.abs(left.totalDays - temporal.targetTotalDays) - Math.abs(right.totalDays - temporal.targetTotalDays)
      || right.totalDays - left.totalDays || left.summaryId.localeCompare(right.summaryId)
    : right.totalDays - left.totalDays || left.summaryId.localeCompare(right.summaryId);
  for (const range of [temporal.primaryWindow, temporal.expansionWindow]) {
    const candidates = (index || []).filter((item) => Number.isFinite(item.totalDays)
      && item.totalDays >= range.fromTotalDays && item.totalDays <= range.toTotalDays
      && !excluded.has(item.summaryId) && !seen.has(item.summaryId) && byId.has(item.summaryId)).sort(sort);
    for (const candidate of candidates) {
      selected.push(byId.get(candidate.summaryId));
      seen.add(candidate.summaryId);
      if (selected.length >= Math.min(3, limit)) return selected;
    }
  }
  return selected;
}

module.exports = { buildSummaryDateIndex, selectTemporalExtras };
