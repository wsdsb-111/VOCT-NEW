"use strict";

const crypto = require("crypto");

const MEMORY_TYPES = new Set([
  "event", "promise", "relationship", "secret", "belief", "plan",
  "conflict", "information", "rumor", "unresolved", "letter", "folder_summary", "legacy_summary"
]);
const VISIBILITIES = new Set(["private", "participants", "known_group", "public", "world"]);
const SOURCES = new Set(["witnessed", "spoken", "letter", "game_fact", "reported", "rumor", "inferred", "imported"]);

function uniqueIds(values) {
  return [...new Set((Array.isArray(values) ? values : []).map(Number).filter(Number.isFinite))];
}

function clamp(value, fallback, min = 0, max = 1) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(min, Math.min(max, numeric)) : fallback;
}

function createMemoryId(prefix = "memory") {
  return `${prefix}_${crypto.randomUUID()}`;
}

function createMemoryRecord(input = {}) {
  const now = new Date().toISOString();
  const type = MEMORY_TYPES.has(input.type) ? input.type : "information";
  const visibility = VISIBILITIES.has(input.visibility) ? input.visibility : "participants";
  const source = SOURCES.has(input.source) ? input.source : "spoken";
  const content = String(input.content || "").trim();
  const provenance = input.provenance && typeof input.provenance === "object" ? input.provenance : {};
  return {
    schemaVersion: input.schemaVersion === 1 ? 1 : 2,
    memoryId: input.memoryId || createMemoryId(),
    version: Number.isFinite(Number(input.version)) ? Number(input.version) : 1,
    updatedBy: String(input.updatedBy || "system"),
    editHistory: Array.isArray(input.editHistory) ? input.editHistory.slice(-20).map((entry) => ({ ...entry })) : [],
    type,
    subtype: String(input.subtype || "").trim(),
    eventDate: input.eventDate || null,
    totalDays: Number.isFinite(Number(input.totalDays)) ? Number(input.totalDays) : null,
    participants: uniqueIds(input.participants),
    subjects: uniqueIds(input.subjects),
    content,
    canonicalText: String(input.canonicalText || content).trim(),
    importance: clamp(input.importance, type === "secret" || type === "promise" ? 0.8 : 0.5),
    confidence: clamp(input.confidence, source === "rumor" || type === "rumor" ? 0.45 : 0.8),
    epistemicStatus: String(input.epistemicStatus || (type === "belief" ? "believed" : type === "rumor" ? "unverified" : "asserted")),
    source,
    provenance: {
      conversationId: provenance.conversationId || null,
      messageIds: Array.isArray(provenance.messageIds) ? [...new Set(provenance.messageIds)] : [],
      speakerIds: uniqueIds(provenance.speakerIds),
      extractionMode: provenance.extractionMode || "structured",
      summaryRequestId: provenance.summaryRequestId || null,
      finalizationId: provenance.finalizationId || null,
      folderOwnerId: Number.isFinite(Number(provenance.folderOwnerId)) ? Number(provenance.folderOwnerId) : null,
      folderName: provenance.folderName || null,
      conversationFile: provenance.conversationFile || null,
      conversationFiles: Array.isArray(provenance.conversationFiles) ? [...new Set(provenance.conversationFiles.map(String))] : [],
      counterpartId: Number.isFinite(Number(provenance.counterpartId)) ? Number(provenance.counterpartId) : null,
      counterpartName: provenance.counterpartName || null
    },
    relationshipImpact: input.relationshipImpact && typeof input.relationshipImpact === "object" ? input.relationshipImpact : null,
    unresolved: input.unresolved === true || type === "unresolved",
    status: input.status || (type === "promise" || type === "plan" || type === "unresolved" ? "open" : null),
    visibility,
    knownBy: uniqueIds(input.knownBy),
    tags: Array.isArray(input.tags) ? [...new Set(input.tags.map((tag) => String(tag).trim()).filter(Boolean))] : [],
    createdAt: input.createdAt || now,
    updatedAt: input.updatedAt || now
  };
}

module.exports = {
  MEMORY_TYPES,
  VISIBILITIES,
  SOURCES,
  createMemoryId,
  createMemoryRecord,
  uniqueIds
};
