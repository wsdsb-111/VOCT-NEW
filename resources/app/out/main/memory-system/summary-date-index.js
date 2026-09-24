"use strict";

const { normalizeGameDate } = require("../worldline/character-temporal-facts");
const { normalizeTemporalRefs } = require("./temporal-anchor-extractor");
const { MemoryRanker } = require("./memory-ranker");

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

function buildEventTimeIndex(memories, { ownerId, counterpartId, currentGameDate, currentTotalDays, campaignToken } = {}) {
  const current = normalizeGameDate(currentGameDate);
  if (!current || !campaignToken) return [];
  const today = Number(currentTotalDays) > 0 ? Number(currentTotalDays) : current.serial;
  return (memories || []).filter(memory => Number(memory.provenance?.folderOwnerId) === Number(ownerId)
    && memory.provenance?.campaignToken === campaignToken
    && memory.subtype !== "official_recollection"
    && (counterpartId == null || [memory.provenance.counterpartId, ...(memory.provenance.counterpartIds || [])].map(Number).includes(Number(counterpartId))))
    .flatMap(memory => normalizeTemporalRefs(memory.provenance?.temporalRefs).filter(ref => ref.timeRole === "event" && ref.segmentIds.length > 0).flatMap(ref => {
      const from = normalizeGameDate(ref.fromGameDate), to = normalizeGameDate(ref.toGameDate);
      if (from.serial > current.serial) return [];
      return [{ summaryId: memory.memoryId, ownerId: Number(ownerId), counterpartId: counterpartId ?? null,
        axis: "event", fromTotalDays: today + from.serial - current.serial,
        toTotalDays: today + Math.min(to.serial, current.serial) - current.serial,
        precision: ref.precision, ref }];
    }));
}

function buildDualTemporalIndex(memories, options = {}) {
  const scoped = (memories || []).filter(memory => !memory.provenance?.campaignToken || memory.provenance.campaignToken === options.campaignToken);
  return [...buildSummaryDateIndex(scoped, options).map(entry => ({ ...entry, axis: "conversation",
    fromTotalDays: entry.totalDays, toTotalDays: entry.totalDays, precision: "day" })), ...buildEventTimeIndex(scoped, options)];
}

function selectDualTemporalExtras(index, memories, temporal, { query = "", entityIds = [], excludedKeys = [], getKey = memory => memory.memoryId, limit = 3 } = {}) {
  if (!temporal?.triggered || limit <= 0) return [];
  const byId = new Map((memories || []).map(memory => [memory.memoryId, memory]));
  const excluded = new Set(excludedKeys);
  // Date words and generic recall phrases must not outrank the requested subject.
  const topic = String(query).replace(temporal.focusReused ? "\u0000" : temporal.expression || "\u0000", "")
    .replace(/你还记得|还记得|我们|什么|事情|那一年|当年|那年|那场|当时|后来|之后|随后|[的了吗呢？?]/g, "");
  const relevance = new Map(new MemoryRanker().rank(memories, { query: topic, entityIds }).map(entry =>
    [entry.memory.memoryId, 200 * entry.reason.query + 150 * entry.reason.entity]));
  const preferred = temporal.axisIntent === "CONVERSATION" ? "conversation" : temporal.axisIntent === "EVENT" ? "event" : null;
  const selected = [], seen = new Set();
  const ranges = temporal.mode === "TARGET_DATE" ? [temporal.primaryWindow] : [temporal.primaryWindow, temporal.expansionWindow];
  for (const range of ranges.filter(Boolean)) {
    const candidates = (index || []).filter(entry => {
      const memory = byId.get(entry.summaryId);
      return memory && !excluded.has(getKey(memory)) && !seen.has(getKey(memory))
        && Number.isFinite(entry.fromTotalDays) && Number.isFinite(entry.toTotalDays)
        && entry.fromTotalDays <= range.toTotalDays && entry.toTotalDays >= range.fromTotalDays;
    }).map(entry => ({ ...entry, score: (preferred && entry.axis === preferred ? 1000 : 0)
      + (relevance.get(entry.summaryId) || 0) + ({ day: 60, month: 30, year: 10 }[entry.precision] || 0) }));
    const distance = entry => {
      const target = temporal.targetTotalDays;
      return Number.isFinite(target) ? Math.max(entry.fromTotalDays - target, target - entry.toTotalDays, 0) : 0;
    };
    candidates.sort((a, b) => b.score - a.score || (temporal.order === "TARGET_DISTANCE" ? distance(a) - distance(b) : 0)
      || b.toTotalDays - a.toTotalDays || a.summaryId.localeCompare(b.summaryId));
    for (const entry of candidates) {
      const memory = byId.get(entry.summaryId), key = getKey(memory);
      if (seen.has(key)) continue;
      seen.add(key);
      selected.push({ memory, score: entry.score, reason: { source: "temporal", axis: entry.axis, precision: entry.precision,
        targetGameYear: temporal.targetGameYear || null, matchedExpression: entry.ref?.expression || temporal.expression,
        fromGameDate: entry.ref?.fromGameDate || entry.gameDate, toGameDate: entry.ref?.toGameDate || entry.gameDate } });
      if (selected.length >= Math.min(3, limit)) return selected;
    }
  }
  return selected;
}

module.exports = { buildSummaryDateIndex, selectTemporalExtras, buildConversationTimeIndex: buildSummaryDateIndex,
  buildEventTimeIndex, buildDualTemporalIndex, selectDualTemporalExtras };
