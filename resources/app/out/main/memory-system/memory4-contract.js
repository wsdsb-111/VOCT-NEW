"use strict";

const crypto = require("crypto");
const { normalizeGameDate } = require("../worldline/character-temporal-facts");
const { extractTemporalAnchors } = require("./temporal-anchor-extractor");

const MEMORY_TYPES = new Set(["RELATIONSHIP_CHANGE", "COMMITMENT", "DURABLE_KNOWLEDGE", "MAJOR_EXPERIENCE", "LONG_TERM_GOAL", "EMOTIONAL_ANCHOR"]);
const hash = value => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
const ids = values => [...new Set((Array.isArray(values) ? values : []).filter(value => Number.isSafeInteger(value) && value > 0))].sort((a, b) => a - b);
const strings = values => [...new Set((Array.isArray(values) ? values : []).filter(value => typeof value === "string" && value.trim()))].sort();

function assertScope(scope) {
  if (typeof scope?.campaignToken !== "string" || !scope.campaignToken.trim() || !Number.isSafeInteger(scope.ownerId) || scope.ownerId <= 0) {
    throw new Error("memory4_scope_required");
  }
}

function gameDate(value) {
  return value == null ? null : normalizeGameDate(value)?.canonical || null;
}

// Only the projected source, never model-supplied ownership or knowledge, grants access.
function validateEntry(candidate, snapshot) {
  assertScope(snapshot);
  if (!candidate || !MEMORY_TYPES.has(candidate.memoryType) || typeof candidate.text !== "string" || !candidate.text.trim()) throw new Error("memory4_invalid_entry");
  if (candidate.ownerId != null && candidate.ownerId !== snapshot.ownerId || candidate.campaignToken != null && candidate.campaignToken !== snapshot.campaignToken) throw new Error("memory4_scope_mismatch");
  const fragmentIds = strings(candidate.fragmentIds);
  const fragments = fragmentIds.map(id => snapshot.fragments.find(fragment => fragment.fragmentId === id));
  if (!fragments.length || fragments.some(fragment => !fragment || !fragment.knownBy.includes(snapshot.ownerId))) throw new Error("memory4_invisible_source");
  const availableEntities = ids(fragments.flatMap(fragment => [fragment.speakerId, ...fragment.entityIds]));
  const entityIds = ids(candidate.entityIds);
  if ((candidate.entityIds || []).length !== entityIds.length || entityIds.some(id => !availableEntities.includes(id))) throw new Error("memory4_unknown_entity");
  const participantIds = ids(candidate.participantIds);
  if (participantIds.some(id => !fragments.some(fragment => fragment.presentIds.includes(id)))) throw new Error("memory4_invalid_participant");
  const requested = candidate.eventTime || {};
  const status = requested.status || "unknown";
  const precision = requested.precision || "unknown";
  if (!["observed", "reported", "planned", "unknown"].includes(status)) throw new Error("memory4_invalid_event_status");
  const from = gameDate(requested.from);
  const to = gameDate(requested.to);
  if (requested.from != null && !from || requested.to != null && !to || (from == null) !== (to == null)) throw new Error("memory4_invalid_event_date");
  if (from && normalizeGameDate(from).serial > normalizeGameDate(to).serial) throw new Error("memory4_invalid_event_range");
  if (status === "unknown" && from) throw new Error("memory4_unknown_time_has_date");
  if (from && status !== "planned" && snapshot.date && normalizeGameDate(to).serial > normalizeGameDate(snapshot.date).serial) throw new Error("memory4_future_fact");
  // Spoken accounts are not CK3/witnessed facts. A model cannot promote hearsay.
  const observed = fragments.every(fragment => fragment.sourceType === "witnessed" || fragment.sourceType === "game_fact");
  if (status === "observed" && !observed) throw new Error("memory4_unverified_observation");
  const temporalRefs = fragments.flatMap(fragment => extractTemporalAnchors(fragment.text,
    { anchorGameDate: snapshot.date, messageId: fragment.messageId }));
  if (from && !(observed && from === gameDate(snapshot.date) && to === from)
    && !temporalRefs.some(ref => ref.fromGameDate === from && ref.toGameDate === to && ref.precision === precision)) throw new Error("memory4_unsupported_event_date");
  if (!["day", "month", "year", "range", "unknown"].includes(precision) || from && precision === "unknown" || !from && precision !== "unknown") throw new Error("memory4_invalid_precision");
  const text = candidate.text.trim();
  const counterpartIds = ids(snapshot.counterpartIds);
  if (counterpartIds.some(id => id === snapshot.ownerId || !fragments.some(fragment => fragment.presentIds.includes(id)))) throw new Error("memory4_invalid_counterpart");
  const source = {
    conversationId: snapshot.conversationId, finalizationId: snapshot.finalizationId,
    summaryIds: strings(snapshot.summaryIds), episodeIds: strings([snapshot.episodeId]),
    messageIds: [...new Set(fragments.flatMap(fragment => fragment.sourceMessageIds || [fragment.messageId])
      .filter(id => Number.isSafeInteger(id) && id >= 0))].sort((a, b) => a - b),
    segmentIds: fragmentIds, legacyMemoryIds: strings(fragments.map(fragment => fragment.legacyMemoryId))
  };
  const knownBy = ids(fragments[0].knownBy).filter(id => fragments.every(fragment => fragment.knownBy.includes(id)));
  const eventTime = { from, to, precision, status };
  const entryId = `m4_${hash([snapshot.campaignToken, snapshot.ownerId, source.finalizationId, fragmentIds,
    candidate.memoryType, eventTime, text.normalize("NFKC").replace(/\s+/g, " ")])}`;
  const now = new Date().toISOString();
  return {
    memory4SchemaVersion: 1, entryId, revision: 1, campaignToken: snapshot.campaignToken, ownerId: snapshot.ownerId, source,
    conversationDate: gameDate(snapshot.date), conversationTotalDays: snapshot.totalDays ?? null, acquiredDate: gameDate(snapshot.date),
    eventTime, temporalRefs, counterpartIds, participantIds, entityIds, locationEntityId: null,
    memoryType: candidate.memoryType, text, topics: strings(candidate.topics).slice(0, 12),
    evidence: { sourceType: observed ? "witnessed" : fragments.some(fragment => fragment.sourceType === "rumor") ? "rumor"
      : fragments.some(fragment => fragment.sourceType === "reported") ? "reported"
        : fragments.every(fragment => fragment.sourceType === "spoken") ? "spoken" : "reported",
      epistemicStatus: observed ? "observed" : "reported",
      confidence: observed ? 1 : 0.5, visibility: fragments.some(fragment => fragment.visibility === "private") ? "private"
        : fragments.some(fragment => fragment.visibility === "known_group") ? "known_group" : "participants",
      knownBy, reportedBy: ids(fragments.map(fragment => fragment.speakerId)),
      visibilityEvidence: strings(fragments.map(fragment => fragment.visibilityEvidence)), completeness: snapshot.completeness || "partial" },
    importance: Number.isFinite(candidate.importance) ? Math.max(0, Math.min(1, candidate.importance)) : 0.5,
    state: { status: "active", supportedByEntryIds: [], supersedesEntryIds: [] },
    edit: { mode: "auto", editedAt: null, editedBy: null }, deleted: false, createdAt: now, updatedAt: now
  };
}

module.exports = { MEMORY_TYPES, assertScope, gameDate, hash, ids, strings, validateEntry };
