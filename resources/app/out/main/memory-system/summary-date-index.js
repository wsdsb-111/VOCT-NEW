"use strict";

const { normalizeGameDate } = require("../worldline/character-temporal-facts");
const { normalizeTemporalRefs } = require("./temporal-anchor-extractor");
const { MemoryRanker } = require("./memory-ranker");
const { memoryMatchesCampaign } = require("./memory-types");
const FIRST_MEETING_SUMMARY_CUE = /第(?:一|1)次.{0,6}(?:见到|见过|见面|见你|遇见|遇到|相遇|认识|相识|相见|相逢)|初次(?:见到|见面|相遇|相识|相见|相逢)|初识|初遇|最初相识|头一回.{0,6}(?:见到|见过|见面|认识|相识)|(?:我们|我与你|我和你|你我|与你|与君|彼此).{0,4}初见/u;
const FIRST_MEETING_NOT_ASSERTED = /(?:不是|并不是|并非|从未|未曾|不曾|没有).{0,8}(?:第(?:一|1)次|初次|初见|初识|初遇|最初相识)|(?:以后|将来|未来|下次|下一次|日后|将).{0,8}(?:第(?:一|1)次|初次|初见|初识|初遇|最初相识)/u;

function isFirstMeetingSummary(memory) {
  const content = memory?.content || memory?.canonicalText || "";
  return FIRST_MEETING_SUMMARY_CUE.test(content) && !FIRST_MEETING_NOT_ASSERTED.test(content);
}

function normalizePerspectiveTemporalRefs(refs, perspectiveMemoryIds) {
  const allowed = new Set((Array.isArray(perspectiveMemoryIds) ? perspectiveMemoryIds : []).map(String).filter(Boolean));
  return normalizeTemporalRefs(refs).map(ref => ({ ...ref,
    sourceMemoryIds: ref.sourceMemoryIds.filter(id => allowed.has(id))
  })).filter(ref => ref.segmentIds.length > 0 || ref.sourceMemoryIds.length > 0);
}

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
  if (!current) return [];
  const today = Number(currentTotalDays) > 0 ? Number(currentTotalDays) : current.serial;
  return (memories || []).filter(memory => Number(memory.provenance?.folderOwnerId) === Number(ownerId)
    && memoryMatchesCampaign(memory, campaignToken)
    && memory.subtype !== "official_recollection"
    && (counterpartId == null || [memory.provenance.counterpartId, ...(memory.provenance.counterpartIds || [])].map(Number).includes(Number(counterpartId))))
    .flatMap(memory => normalizePerspectiveTemporalRefs(memory.provenance?.temporalRefs, memory.provenance?.perspectiveMemoryIds).filter(ref => ref.timeRole === "event").flatMap(ref => {
      const from = normalizeGameDate(ref.fromGameDate), to = normalizeGameDate(ref.toGameDate);
      if (from.serial > current.serial) return [];
      return [{ summaryId: memory.memoryId, ownerId: Number(ownerId), counterpartId: counterpartId ?? null,
        axis: "event", fromTotalDays: today + from.serial - current.serial,
        toTotalDays: today + Math.min(to.serial, current.serial) - current.serial,
        precision: ref.precision, ref }];
    }));
}

function buildDualTemporalIndex(memories, options = {}) {
  const scoped = (memories || []).filter(memory => memoryMatchesCampaign(memory, options.campaignToken));
  return [...buildSummaryDateIndex(scoped, options).map(entry => ({ ...entry, axis: "conversation",
    fromTotalDays: entry.totalDays, toTotalDays: entry.totalDays, precision: "day" })), ...buildEventTimeIndex(scoped, options)];
}

function selectDualTemporalExtras(index, memories, temporal, { query = "", entityIds = [], directCounterpartIds = [], querySpeakerId = null, excludedKeys = [], getKey = memory => memory.memoryId, limit = 3 } = {}) {
  if (!temporal?.triggered || limit <= 0) return [];
  const byId = new Map((memories || []).map(memory => [memory.memoryId, memory]));
  const excluded = new Set(excludedKeys);
  if (temporal.mode === "EARLIEST_AVAILABLE") {
    const speakerId = Number(querySpeakerId);
    const counterpartIds = Number.isSafeInteger(speakerId) && speakerId > 0
      ? new Set([speakerId]) : new Set(directCounterpartIds.map(Number).filter(id => Number.isSafeInteger(id) && id > 0));
    const firstMeeting = (index || []).filter(entry => {
      const memory = byId.get(entry.summaryId);
      return entry.axis === "conversation" && memory && counterpartIds.has(Number(entry.counterpartId))
        && Number.isFinite(entry.fromTotalDays)
        && Number.isFinite(entry.toTotalDays) && entry.fromTotalDays >= temporal.primaryWindow.fromTotalDays
        && entry.toTotalDays <= temporal.primaryWindow.toTotalDays && isFirstMeetingSummary(memory);
    }).sort((left, right) => left.fromTotalDays - right.fromTotalDays || left.summaryId.localeCompare(right.summaryId));
    const earliest = firstMeeting[0];
    if (!earliest || excluded.has(getKey(byId.get(earliest.summaryId)))) return [];
    return [{ memory: byId.get(earliest.summaryId), score: 1000,
      reason: { source: "temporal", axis: "conversation", precision: earliest.precision,
        targetGameYear: null, matchedExpression: temporal.expression,
        fromGameDate: earliest.gameDate || null, toGameDate: earliest.gameDate || null,
        selectionBasis: "EARLIEST_AVAILABLE_MATCH" } }];
  }
  // Date words and generic recall phrases must not outrank the requested subject.
  const topic = String(query).replace(temporal.focusReused ? "\u0000" : temporal.expression || "\u0000", "")
    .replace(/你还记得|还记得|记得|记忆|回忆|经历|往事|故事|事情|那段(?:时间|经历|往事)|我们|什么|那一年|当年|那年|那场|当时|后来|之后|随后|[的了吗呢？?]/g, "");
  const relevance = new Map(new MemoryRanker().rank(memories, { query: topic, entityIds }).map(entry =>
    [entry.memory.memoryId, 200 * entry.reason.query + 150 * entry.reason.entity]));
  const preferred = temporal.axisIntent === "CONVERSATION" ? "conversation" : temporal.axisIntent === "EVENT" ? "event" : null;
  const selected = [], seen = new Set();
  const ranges = temporal.mode === "TARGET_DATE" ? [temporal.primaryWindow] : [temporal.primaryWindow, temporal.expansionWindow];
  const candidatesByKey = new Map();
  for (const range of ranges.filter(Boolean)) {
    const candidates = (index || []).filter(entry => {
      const memory = byId.get(entry.summaryId);
      return memory && !excluded.has(getKey(memory)) && !seen.has(getKey(memory))
        && Number.isFinite(entry.fromTotalDays) && Number.isFinite(entry.toTotalDays)
        && entry.fromTotalDays <= range.toTotalDays && entry.toTotalDays >= range.fromTotalDays;
    }).map(entry => ({ ...entry, score: (preferred && entry.axis === preferred ? 1000 : 0)
      + (relevance.get(entry.summaryId) || 0) + ({ day: 60, month: 30, year: 10 }[entry.precision] || 0) }));
    for (const entry of candidates) {
      const key = `${getKey(byId.get(entry.summaryId))}|${entry.axis}`;
      if (!candidatesByKey.has(key)) candidatesByKey.set(key, entry);
    }
  }
  const distance = entry => {
    const target = temporal.targetTotalDays;
    return Number.isFinite(target) ? Math.max(entry.fromTotalDays - target, target - entry.toTotalDays, 0) : 0;
  };
  const ranked = [...candidatesByKey.values()].sort((a, b) => b.score - a.score || (temporal.order === "TARGET_DISTANCE" ? distance(a) - distance(b) : 0)
    || b.toTotalDays - a.toTotalDays || a.summaryId.localeCompare(b.summaryId));
  if (temporal.axisIntent === "MEMORY_RECALL") {
    const speakerId = Number(querySpeakerId);
    const preferredCounterpartIds = Number.isSafeInteger(speakerId) && speakerId > 0
      ? new Set([speakerId]) : new Set(directCounterpartIds.map(Number));
    const directConversation = ranked.find(entry => entry.axis === "conversation" && preferredCounterpartIds.has(Number(entry.counterpartId))
      && temporal.primaryWindow && entry.fromTotalDays >= temporal.primaryWindow.fromTotalDays && entry.toTotalDays <= temporal.primaryWindow.toTotalDays);
    if (directConversation) ranked.unshift(...ranked.splice(ranked.indexOf(directConversation), 1));
  }
  for (const entry of ranked) {
    const memory = byId.get(entry.summaryId), key = getKey(memory);
    if (seen.has(key)) continue;
    seen.add(key);
    selected.push({ memory, score: entry.score, reason: { source: "temporal", axis: entry.axis, precision: entry.precision,
      targetGameYear: temporal.targetGameYear || null, matchedExpression: entry.ref?.expression || temporal.expression,
      fromGameDate: entry.ref?.fromGameDate || entry.gameDate, toGameDate: entry.ref?.toGameDate || entry.gameDate } });
    if (selected.length >= Math.min(3, limit)) break;
  }
  return selected;
}

module.exports = { buildSummaryDateIndex, selectTemporalExtras, buildConversationTimeIndex: buildSummaryDateIndex,
  buildEventTimeIndex, buildDualTemporalIndex, selectDualTemporalExtras, normalizePerspectiveTemporalRefs, isFirstMeetingSummary };
