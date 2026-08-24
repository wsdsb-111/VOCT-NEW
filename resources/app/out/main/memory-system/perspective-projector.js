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

function renderPerspectiveContent(owner, memories) {
  const ownerId = Number(owner.id);
  const ownerName = owner.name || owner.shortName || owner.fullName || `角色${ownerId}`;
  const lines = memories.map((memory) => `- ${memory.content}`).filter((line) => line.length > 2);
  return lines.length > 0
    ? `【${ownerName}能够知道并记住的本场内容】\n${lines.join("\n")}`
    : `【${ownerName}的本场记忆】\n- 本场对话没有形成该人物能够确认并长期保存的明确事件。`;
}

function buildPerspectiveSummaryMap(context = {}, extraction = {}) {
  const participants = (context.participants || []).filter((entry) => Number.isFinite(Number(entry?.id)));
  const excludedOwners = new Set(uniqueIds(context.excludedSummaryOwnerIds));
  const memories = Array.isArray(extraction.memories) ? extraction.memories : [];
  const projections = new Map();
  for (const owner of participants) {
    const ownerId = Number(owner.id);
    if (excludedOwners.has(ownerId)) continue;
    for (const counterpart of participants) {
      const counterpartId = Number(counterpart.id);
      if (counterpartId === ownerId) continue;
      const known = memories.filter((memory) => uniqueIds(memory.knownBy).includes(ownerId) && isMemoryRelevantToPair(memory, ownerId, counterpartId));
      const memoryIds = known.map((memory) => memory.memoryId).filter(Boolean);
      const pinned = known.some((memory) => PINNED_TYPES.has(memory.type) || memory.status === "open" || memory.unresolved === true || Number(memory.importance) >= 0.9);
      const open = known.some((memory) => memory.status === "open" || memory.unresolved === true);
      const content = renderPerspectiveContent(owner, known);
      const projectionHash = crypto.createHash("sha256").update(JSON.stringify({ ownerId, counterpartId, memoryIds, content })).digest("hex");
      projections.set(projectionKey(ownerId, counterpartId), {
        ownerId,
        counterpartId,
        content,
        memoryIds: [...memoryIds],
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
        return !memory || !uniqueIds(memory.knownBy).includes(ownerId) || !isMemoryRelevantToPair(memory, ownerId, counterpartId);
      });
      if (leaked) {
        invalidPairs.push({ ownerId, counterpartId, reason: "knowledge_or_pair_boundary_violation" });
        continue;
      }
      const expectedMemories = (projection.memoryIds || []).map((memoryId) => memoriesById.get(memoryId)).filter(Boolean);
      const expectedContent = renderPerspectiveContent(owner, expectedMemories);
      const expectedHash = crypto.createHash("sha256").update(JSON.stringify({ ownerId, counterpartId, memoryIds: projection.memoryIds || [], content: expectedContent })).digest("hex");
      if (projection.content !== expectedContent || projection.projectionHash !== expectedHash) {
        invalidPairs.push({ ownerId, counterpartId, reason: "projection_content_integrity_violation" });
      }
    }
  }
  return invalidPairs.length === 0
    ? { success: true, invalidPairs: [] }
    : { success: false, error: "perspective_summary_validation_failed", invalidPairs };
}

module.exports = { buildPerspectiveSummaryMap, validatePerspectiveSummaryMap, projectionKey, isMemoryRelevantToPair, renderPerspectiveContent, PINNED_TYPES };
