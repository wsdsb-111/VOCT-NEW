"use strict";

const crypto = require("crypto");
const { normalizeGameDate } = require("../worldline/character-temporal-facts");

const hash = value => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
const ids = values => [...new Set((Array.isArray(values) ? values : []).filter(value => Number.isSafeInteger(value) && value > 0))].sort((a, b) => a - b);
const strings = values => [...new Set((Array.isArray(values) ? values : []).filter(value => typeof value === "string" && value.trim()))].sort();
const gameDate = value => value == null ? null : normalizeGameDate(value)?.canonical || null;

function assertScope(scope) {
  if (typeof scope?.campaignToken !== "string" || !scope.campaignToken.trim() || !Number.isSafeInteger(scope.ownerId) || scope.ownerId <= 0) throw new Error("legacy_scope_required");
}

// Preserve existing projection identities when moving shared Legacy source proof out of Durable.
function optionalId(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function messageIds(values) {
  return [...new Set((Array.isArray(values) ? values : []).filter(value => Number.isSafeInteger(value) && value >= 0))]
    .sort((a, b) => a - b);
}

function createProjectionLineage({ campaignToken, ownerId, conversationId = null, finalizationId = null, sourceLetterId = null,
  counterpartId, segmentIds = [], legacyMemoryIds = [], projectionId = null, sourceSegmentIds = [], sourceMessageIds = [] } = {}) {
  const scope = { campaignToken, ownerId };
  assertScope(scope);
  const counterpart = Number(counterpartId);
  if (!Number.isSafeInteger(counterpart) || counterpart <= 0 || counterpart === ownerId) throw new Error("memory4_projection_counterpart_invalid");
  const conversation = optionalId(conversationId), finalization = optionalId(finalizationId), letter = optionalId(sourceLetterId);
  const segments = strings(segmentIds), legacyIds = strings(legacyMemoryIds);
  if (!conversation && !finalization && !segments.length && !legacyIds.length) throw new Error("memory4_projection_lineage_incomplete");
  const identity = ["memory4_projection_v1", campaignToken, ownerId, conversation, finalization, counterpart, segments];
  if (!conversation && !finalization && !segments.length) identity.push("legacy", legacyIds);
  const expectedId = `m4p_${hash(identity)}`;
  if (projectionId != null && projectionId !== expectedId) throw new Error("memory4_projection_id_mismatch");
  return { campaignToken, ownerId, conversationId: conversation, finalizationId: finalization, sourceLetterId: letter,
    counterpartId: counterpart, segmentIds: segments, legacyMemoryIds: legacyIds, projectionId: expectedId,
    ...(strings(sourceSegmentIds).length ? { sourceSegmentIds: strings(sourceSegmentIds) } : {}),
    ...(messageIds(sourceMessageIds).length ? { sourceMessageIds: messageIds(sourceMessageIds) } : {}) };
}

function projectionLineageFromSummary(summary, { ownerId = null, counterpartId = null, legacyMemoryIds = [] } = {}) {
  const provenance = summary?.provenance || {};
  const campaignToken = summary?.campaignToken || provenance.campaignToken;
  if (typeof campaignToken !== "string" || !campaignToken.trim()) return null;
  const numericOwnerId = Number(summary?.perspectiveOwnerId ?? provenance.folderOwnerId ?? ownerId);
  const numericCounterpartId = Number(counterpartId ?? summary?.characterId ?? provenance.counterpartId);
  if (!Number.isSafeInteger(numericOwnerId) || !Number.isSafeInteger(numericCounterpartId) || numericCounterpartId === numericOwnerId) return null;
  const conversationId = summary?.conversationId || provenance.conversationId;
  const finalizationId = summary?.finalizationId || provenance.finalizationId;
  const segmentIds = summary?.perspectiveSummarySegmentIds || summary?.segmentIds || provenance.perspectiveSummarySegmentIds || provenance.segmentIds || [];
  const sourceIds = [summary?.perspectiveMemoryIds, summary?.legacyMemoryIds,
    provenance.perspectiveMemoryIds, provenance.legacyMemoryIds, legacyMemoryIds].flatMap(value => Array.isArray(value) ? value : []);
  const sourceSegmentIds = summary?.sourceSegmentIds || provenance.sourceSegmentIds || [];
  const sourceMessageIds = summary?.sourceMessageIds || provenance.sourceMessageIds || [];
  if (!optionalId(conversationId) && !optionalId(finalizationId) && !strings(segmentIds).length && !strings(sourceIds).length) return null;
  return createProjectionLineage({ campaignToken, ownerId: numericOwnerId,
    conversationId, finalizationId, counterpartId: numericCounterpartId, segmentIds,
    legacyMemoryIds: sourceIds, projectionId: summary?.projectionId || provenance.projectionId || null,
    sourceSegmentIds, sourceMessageIds, sourceLetterId: summary?.sourceLetterId || summary?.letterId
      || provenance.sourceLetterId || provenance.letterId || null });
}

function segmentAliases(values) {
  return new Set(strings(values).flatMap(value => {
    const aliases = [value];
    let stripped = value;
    while (stripped.startsWith("segment_")) {
      stripped = stripped.slice("segment_".length);
      aliases.push(stripped);
    }
    return aliases;
  }));
}

function intersects(left, right) {
  const values = segmentAliases(left);
  return strings(right).some(value => values.has(value) || [...values].some(alias => segmentAliases([value]).has(alias)));
}

function sameOptional(left, right, key) {
  return !left[key] || !right[key] || left[key] === right[key];
}

function matchesProjectionLineage(left, right) {
  if (!left || !right || left.campaignToken !== right.campaignToken || Number(left.ownerId) !== Number(right.ownerId)
    || Number(left.counterpartId) !== Number(right.counterpartId)) return false;
  if (left.projectionId && right.projectionId && left.projectionId === right.projectionId) return true;
  if (!sameOptional(left, right, "conversationId") || !sameOptional(left, right, "finalizationId")
    || !sameOptional(left, right, "sourceLetterId")) return false;
  return intersects(left.segmentIds, right.sourceSegmentIds?.length ? right.sourceSegmentIds : right.segmentIds)
    || intersects(left.legacyMemoryIds, right.legacyMemoryIds);
}

module.exports = { createProjectionLineage, projectionLineageFromSummary, matchesProjectionLineage, hash, ids, strings, assertScope, gameDate };
