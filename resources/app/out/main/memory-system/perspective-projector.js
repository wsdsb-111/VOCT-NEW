"use strict";

const crypto = require("crypto");
const { uniqueIds } = require("./memory-types");

const PINNED_TYPES = new Set(["promise", "secret", "relationship", "plan", "unresolved"]);
const PRESENCE_MARKER_KINDS = new Set(["presence_join", "presence_leave", "presence_temporary_leave", "presence_temporary_return"]);

function projectionKey(ownerId, counterpartId) {
  return `${Number(ownerId)}->${Number(counterpartId)}`;
}

function isMemoryRelevantToPair(memory, ownerId, counterpartId) {
  const participants = uniqueIds(memory?.participants);
  const subjects = uniqueIds(memory?.subjects);
  const speakers = uniqueIds(memory?.provenance?.speakerIds);
  if (subjects.length > 0) {
    return subjects.includes(counterpartId) || speakers.includes(counterpartId);
  }
  return participants.includes(counterpartId) || speakers.includes(counterpartId);
}

function isMessageInsidePresenceWindow(window, messageId) {
  const joined = Number(window?.joinedAtMessageId ?? 0);
  const left = window?.leftAtMessageId == null ? Infinity : Number(window.leftAtMessageId);
  return joined <= Number(messageId) && Number(messageId) < left;
}

function getPresenceSignature(context = {}, messageId) {
  const presence = Array.isArray(context.participantPresence) ? context.participantPresence : [];
  const participants = (context.participants || []).map((participant) => Number(participant?.id)).filter(Number.isFinite);
  const activeIds = presence.length > 0
    ? presence.filter((window) => isMessageInsidePresenceWindow(window, messageId)).map((window) => window.characterId)
    : participants;
  return uniqueIds(activeIds).sort((left, right) => left - right).join(",");
}

function getSegmentPresenceSignatures(context = {}, segment = {}) {
  return uniqueIds(segment?.provenance?.messageIds).map((messageId) => getPresenceSignature(context, messageId));
}

function validateSummarySegmentPresenceBoundaries(context = {}, extraction = {}) {
  const boundaryMessageIds = uniqueIds((context.participantPresence || []).flatMap((window) => [window?.joinedAtMessageId, window?.leftAtMessageId])).sort((left, right) => left - right);
  const failures = [];
  for (const [index, segment] of (extraction.summarySegments || []).entries()) {
    const messageIds = uniqueIds(segment?.provenance?.messageIds);
    const presenceSignatures = [...new Set(getSegmentPresenceSignatures(context, segment))];
    const minimumMessageId = messageIds.length > 0 ? Math.min(...messageIds) : null;
    const maximumMessageId = messageIds.length > 0 ? Math.max(...messageIds) : null;
    const crossedBoundaryMessageIds = boundaryMessageIds.filter((boundaryMessageId) => minimumMessageId < boundaryMessageId && boundaryMessageId <= maximumMessageId);
    if (messageIds.length > 0 && (presenceSignatures.length > 1 || crossedBoundaryMessageIds.length > 0)) {
      failures.push({
        index,
        segmentId: segment.segmentId || null,
        segmentMessageIds: messageIds,
        presenceSignatures,
        crossedBoundaryMessageIds
      });
    }
  }
  return {
    success: failures.length === 0,
    failures,
    reasons: failures.map(() => "summary_segment_crosses_presence_boundary")
  };
}

function resolveMessageSpeakerId(message, participants) {
  const directId = Number(message?.speakerCharacterId ?? message?.characterId);
  if (Number.isFinite(directId)) return directId;
  const name = message?.name;
  if (!name) return null;
  const participant = participants.find((entry) => [entry.name, entry.shortName, entry.fullName].filter(Boolean).includes(name));
  return participant ? Number(participant.id) : null;
}

function getVisibleDialogueStats(context = {}, participantId, counterpartId = null) {
  const participants = (context.participants || []).filter((entry) => Number.isFinite(Number(entry?.id)));
  const messages = Array.isArray(context.messages) ? context.messages : [];
  const visible = messages.filter((message) => {
    const content = String(message?.content || "").trim();
    if (!content || PRESENCE_MARKER_KINDS.has(message?.kind) || !["user", "assistant"].includes(message?.role)) return false;
    const presence = Array.isArray(context.participantPresence) ? context.participantPresence : [];
    if (presence.length === 0) return true;
    const participantPresent = presence.some((window) => Number(window.characterId) === Number(participantId) && isMessageInsidePresenceWindow(window, message.id));
    const counterpartPresent = counterpartId == null || presence.some((window) => Number(window.characterId) === Number(counterpartId) && isMessageInsidePresenceWindow(window, message.id));
    return participantPresent && counterpartPresent;
  });
  let previousSpeakerId = null;
  let visibleSpeakerTurns = 0;
  for (const message of visible) {
    const speakerId = resolveMessageSpeakerId(message, participants);
    if (speakerId !== previousSpeakerId) visibleSpeakerTurns++;
    previousSpeakerId = speakerId;
  }
  return {
    visibleDialogueMessageCount: visible.length,
    visibleDialogueChars: visible.reduce((total, message) => total + String(message.content || "").trim().length, 0),
    visibleSpeakerTurns
  };
}

function validatePerspectiveCoverage(context = {}, extraction = {}, projections) {
  if (!(projections instanceof Map)) return { success: false, error: "perspective_summary_map_required", invalidPairs: [] };
  const excludedOwners = new Set(uniqueIds(context.excludedSummaryOwnerIds));
  const participants = (context.participants || []).filter((entry) => Number.isFinite(Number(entry?.id)));
  const invalidPairs = [];
  const statsByParticipant = {};
  for (const owner of participants) {
    const ownerId = Number(owner.id);
    if (excludedOwners.has(ownerId)) continue;
    statsByParticipant[ownerId] = getVisibleDialogueStats(context, ownerId);
    for (const counterpart of participants) {
      const counterpartId = Number(counterpart.id);
      if (counterpartId === ownerId) continue;
      const stats = getVisibleDialogueStats(context, ownerId, counterpartId);
      const substantivePresence = stats.visibleDialogueMessageCount >= 3 && stats.visibleDialogueChars >= 120;
      if (!substantivePresence) continue;
      const projection = projections.get(projectionKey(ownerId, counterpartId));
      if (!projection || (projection.summarySegmentIds || []).length > 0) continue;
      invalidPairs.push({
        ownerId,
        counterpartId,
        reason: "projection_narrative_coverage_missing",
        ...stats,
        projectionSegmentCount: (projection?.summarySegmentIds || []).length,
        projectionMemoryCount: (projection?.memoryIds || []).length
      });
    }
  }
  return { success: invalidPairs.length === 0, invalidPairs, statsByParticipant };
}

function isMemoryInsidePairPresence(context, memory, ownerId, counterpartId) {
  const presence = Array.isArray(context?.participantPresence) ? context.participantPresence : [];
  if (presence.length === 0) return true;
  const ownerWindows = presence.filter((window) => Number(window.characterId) === Number(ownerId));
  const counterpartWindows = presence.filter((window) => Number(window.characterId) === Number(counterpartId));
  if (ownerWindows.length === 0 || counterpartWindows.length === 0) return false;
  let messageIds = uniqueIds(memory?.provenance?.messageIds);
  if (messageIds.length === 0) {
    messageIds = uniqueIds((context.messages || []).map((message) => message?.id));
  }
  if (messageIds.length > 0) {
    return messageIds.every((messageId) => ownerWindows.some((window) => isMessageInsidePresenceWindow(window, messageId)) && counterpartWindows.some((window) => isMessageInsidePresenceWindow(window, messageId)));
  }
  return ownerWindows.some((ownerWindow) => counterpartWindows.some((counterpartWindow) => {
    const joined = Math.max(Number(ownerWindow.joinedAtMessageId ?? 0), Number(counterpartWindow.joinedAtMessageId ?? 0));
    const ownerLeft = ownerWindow.leftAtMessageId == null ? Infinity : Number(ownerWindow.leftAtMessageId);
    const counterpartLeft = counterpartWindow.leftAtMessageId == null ? Infinity : Number(counterpartWindow.leftAtMessageId);
    return joined < Math.min(ownerLeft, counterpartLeft);
  }));
}

function renderPerspectiveContent(owner, memories, summarySegments = []) {
  const ownerId = Number(owner.id);
  const ownerName = owner.name || owner.shortName || owner.fullName || `角色${ownerId}`;
  const narrative = summarySegments.map((segment) => String(segment.content || "").trim()).filter(Boolean);
  const lines = memories.map((memory) => `- ${memory.content}`).filter((line) => line.length > 2);
  if (narrative.length > 0) {
    const durable = lines.length > 0 ? `\n\n【需要长期记住的事项】\n${lines.join("\n")}` : "";
    return `【${ownerName}能够知道并记住的本场经过】\n${narrative.join("\n\n")}${durable}`;
  }
  return lines.length > 0
    ? `【${ownerName}能够知道并记住的本场内容】\n${lines.join("\n")}`
    : `【${ownerName}的本场记忆】\n- 本场对话没有形成该人物能够确认并长期保存的明确事件。`;
}

function buildPerspectiveSummaryMap(context = {}, extraction = {}) {
  const participants = (context.participants || []).filter((entry) => Number.isFinite(Number(entry?.id)));
  const excludedOwners = new Set(uniqueIds(context.excludedSummaryOwnerIds));
  const memories = Array.isArray(extraction.memories) ? extraction.memories : [];
  const summarySegments = Array.isArray(extraction.summarySegments) ? extraction.summarySegments : [];
  const projections = new Map();
  for (const owner of participants) {
    const ownerId = Number(owner.id);
    if (excludedOwners.has(ownerId)) continue;
    for (const counterpart of participants) {
      const counterpartId = Number(counterpart.id);
      if (counterpartId === ownerId) continue;
      const known = memories.filter((memory) => uniqueIds(memory.knownBy).includes(ownerId) && isMemoryRelevantToPair(memory, ownerId, counterpartId) && isMemoryInsidePairPresence(context, memory, ownerId, counterpartId));
      const sharedSegments = summarySegments.filter((segment) => {
        const knownBy = uniqueIds(segment.knownBy);
        return knownBy.includes(ownerId) && knownBy.includes(counterpartId) && isMemoryInsidePairPresence(context, segment, ownerId, counterpartId);
      });
      const memoryIds = known.map((memory) => memory.memoryId).filter(Boolean);
      const summarySegmentIds = sharedSegments.map((segment) => segment.segmentId).filter(Boolean);
      const pinned = known.some((memory) => PINNED_TYPES.has(memory.type) || memory.status === "open" || memory.unresolved === true || Number(memory.importance) >= 0.9);
      const open = known.some((memory) => memory.status === "open" || memory.unresolved === true);
      const content = renderPerspectiveContent(owner, known, sharedSegments);
      const projectionHash = crypto.createHash("sha256").update(JSON.stringify({ ownerId, counterpartId, memoryIds, summarySegmentIds, content })).digest("hex");
      projections.set(projectionKey(ownerId, counterpartId), {
        ownerId,
        counterpartId,
        content,
        memoryIds: [...memoryIds],
        summarySegmentIds: [...summarySegmentIds],
        pinned,
        open,
        projectionHash
      });
    }
  }
  return projections;
}

function validatePerspectiveSummaryMap(context = {}, extraction = {}, projections) {
  if (!(projections instanceof Map)) return { success: false, error: "perspective_summary_map_required", invalidPairs: [] };
  const excludedOwners = new Set(uniqueIds(context.excludedSummaryOwnerIds));
  const participants = (context.participants || []).filter((entry) => Number.isFinite(Number(entry?.id)));
  const memoriesById = new Map((extraction.memories || []).map((memory) => [memory.memoryId, memory]));
  const segmentsById = new Map((extraction.summarySegments || []).map((segment) => [segment.segmentId, segment]));
  const invalidPairs = [];
  for (const owner of participants) {
    const ownerId = Number(owner.id);
    if (excludedOwners.has(ownerId)) continue;
    for (const counterpart of participants) {
      const counterpartId = Number(counterpart.id);
      if (counterpartId === ownerId) continue;
      const key = projectionKey(ownerId, counterpartId);
      const projection = projections.get(key);
      if (!projection || Number(projection.ownerId) !== ownerId || Number(projection.counterpartId) !== counterpartId) {
        invalidPairs.push({ ownerId, counterpartId, reason: "missing_projection" });
        continue;
      }
      const leaked = (projection.memoryIds || []).some((memoryId) => {
        const memory = memoriesById.get(memoryId);
        return !memory || !uniqueIds(memory.knownBy).includes(ownerId) || !isMemoryRelevantToPair(memory, ownerId, counterpartId) || !isMemoryInsidePairPresence(context, memory, ownerId, counterpartId);
      });
      if (leaked) {
        invalidPairs.push({ ownerId, counterpartId, reason: "knowledge_or_pair_boundary_violation" });
        continue;
      }
      const leakedSegment = (projection.summarySegmentIds || []).some((segmentId) => {
        const segment = segmentsById.get(segmentId);
        const knownBy = uniqueIds(segment?.knownBy);
        return !segment || !knownBy.includes(ownerId) || !knownBy.includes(counterpartId) || !isMemoryInsidePairPresence(context, segment, ownerId, counterpartId);
      });
      if (leakedSegment) {
        invalidPairs.push({ ownerId, counterpartId, reason: "summary_segment_knowledge_or_presence_violation" });
        continue;
      }
      const expectedMemories = (projection.memoryIds || []).map((memoryId) => memoriesById.get(memoryId)).filter(Boolean);
      const expectedSegments = (projection.summarySegmentIds || []).map((segmentId) => segmentsById.get(segmentId)).filter(Boolean);
      const expectedContent = renderPerspectiveContent(owner, expectedMemories, expectedSegments);
      const expectedHash = crypto.createHash("sha256").update(JSON.stringify({ ownerId, counterpartId, memoryIds: projection.memoryIds || [], summarySegmentIds: projection.summarySegmentIds || [], content: expectedContent })).digest("hex");
      if (projection.content !== expectedContent || projection.projectionHash !== expectedHash) {
        invalidPairs.push({ ownerId, counterpartId, reason: "projection_content_integrity_violation" });
      }
    }
  }
  return invalidPairs.length === 0
    ? { success: true, invalidPairs: [] }
    : { success: false, error: "perspective_summary_validation_failed", invalidPairs };
}

module.exports = { buildPerspectiveSummaryMap, validatePerspectiveSummaryMap, validateSummarySegmentPresenceBoundaries, validatePerspectiveCoverage, getPresenceSignature, getSegmentPresenceSignatures, getVisibleDialogueStats, projectionKey, isMemoryRelevantToPair, isMemoryInsidePairPresence, renderPerspectiveContent, PINNED_TYPES };
