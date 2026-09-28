"use strict";

const { assertScope, ids } = require("./memory4-contract");
const { buildDualTemporalIndex } = require("./summary-date-index");

// Read-only compatibility lane. A successful/empty Memory4 extraction is not
// coverage proof for a legacy document. In particular, one migrated fact may
// never suppress the rest of the old owner projection.
function buildLegacyBridge(memories, scope) {
  assertScope(scope);
  const candidates = (memories || []).filter(memory => memory?.type === "folder_summary"
    && memory.subtype !== "official_recollection" && memory.sourceType !== "CK3_OFFICIAL_RECOLLECTION"
    && memory.provenance?.extractionMode !== "ck3_native_recollection"
    && memory.provenance?.campaignToken === scope.campaignToken && memory.provenance?.folderOwnerId === scope.ownerId
    && memory.provenance?.campaignBinding?.status !== "unresolved"
    && ids(memory.knownBy).includes(scope.ownerId) && !memory.deleted
    && typeof memory.content === "string" && memory.content.trim());
  return {
    memories: candidates,
    temporalIndex: buildDualTemporalIndex(candidates, scope),
    coverage: candidates.map(memory => ({ summaryId: memory.memoryId, ownerId: scope.ownerId, campaignToken: scope.campaignToken,
      completeness: "partial", visibilityEvidence: "legacy visibility evidence", retained: true, forcedMigration: false,
      perspectiveMemoryIds: [...(memory.provenance.perspectiveMemoryIds || [])], projectionHash: memory.provenance.projectionHash || null }))
  };
}

module.exports = { buildLegacyBridge };
