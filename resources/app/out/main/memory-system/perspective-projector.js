"use strict";

const crypto = require("crypto");
const { uniqueIds } = require("./memory-types");

const PINNED_TYPES = new Set(["promise", "secret", "relationship", "plan", "unresolved"]);

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

module.exports = { buildPerspectiveSummaryMap, validatePerspectiveSummaryMap, projectionKey, isMemoryRelevantToPair, isMemoryInsidePairPresence, renderPerspectiveContent, PINNED_TYPES };
