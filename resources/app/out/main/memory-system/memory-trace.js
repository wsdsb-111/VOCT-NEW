"use strict";

class MemoryTrace {
  constructor({ logger = console, maxEntries = 500 } = {}) {
    this.logger = logger;
    this.maxEntries = maxEntries;
    this.entries = [];
  }

  record(stage, details = {}) {
    const derivedStage = ["memory4_derived", "memory4_legacy_recompression"].includes(stage);
    if (derivedStage) details = Object.fromEntries(["ownerId", "status", "kind", "count", "indexRevision", "derivedRevision", "sourceHash", "durationMs", "errorCode", "eventYear", "quality"]
      .map(key => [key, details[key]]));
    const safe = {
      timestamp: new Date().toISOString(),
      stage,
      success: typeof details.success === "boolean" ? details.success : null,
      finalizationStage: stage === "finalization" ? details.stage || null : null,
      providerSuccess: typeof details.providerSuccess === "boolean" ? details.providerSuccess : null,
      recoveryState: details.recoveryState || null,
      error: derivedStage ? /^memory4_[a-z_]+$/.test(details.errorCode || "") ? details.errorCode : null : details.error || details.errorCode || null,
      attempt: Number.isInteger(details.attempt) ? details.attempt : null,
      durationMs: Number.isFinite(details.durationMs) ? details.durationMs : null,
      memoryId: details.memoryId || null,
      type: details.type || null,
      score: Number.isFinite(details.score) ? details.score : null,
      reason: details.reason || null,
      alias: details.alias || null,
      characterIds: Array.isArray(details.characterIds) ? [...details.characterIds] : [],
      patchInserted: details.patchInserted === true,
      temporalRequested: details.temporalRequested === true,
      temporalAxis: details.temporalAxis || "none",
      temporalExpression: typeof details.temporalExpression === "string" ? details.temporalExpression.slice(0, 80) : null,
      temporalOwnerId: Number.isSafeInteger(Number(details.temporalOwnerId)) ? Number(details.temporalOwnerId) : null,
      temporalDirectCounterpartIds: Array.isArray(details.temporalDirectCounterpartIds) ? details.temporalDirectCounterpartIds.map(Number).filter(Number.isSafeInteger).slice(0, 8) : [],
      temporalSelectedSummaryIds: Array.isArray(details.temporalSelectedSummaryIds) ? details.temporalSelectedSummaryIds.map(String).filter(Boolean).slice(0, 3) : [],
      currentGameDate: details.currentGameDate || null,
      targetGameYear: Number.isInteger(details.targetGameYear) ? details.targetGameYear : null,
      folderMemoryCount: details.folderMemoryCount ?? null,
      campaignAcceptedCount: details.campaignAcceptedCount ?? null,
      campaignRejectedCount: details.campaignRejectedCount ?? null,
      legacyCampaignRejectedCount: details.legacyCampaignRejectedCount ?? null,
      eventTimeCandidates: details.eventTimeCandidates ?? null,
      conversationTimeCandidates: details.conversationTimeCandidates ?? null,
      temporalEventHitCount: details.temporalEventHitCount ?? null,
      temporalConversationHitCount: details.temporalConversationHitCount ?? null,
      selectedTemporalCount: details.temporalExtraCount ?? null,
      temporalFocusReused: details.temporalFocusReused === true,
      temporalFocusReuseCount: details.temporalFocusReuseCount ?? null,
      temporalMissCount: details.temporalMissCount ?? null,
      temporalBudgetOmittedCount: details.temporalBudgetOmittedCount ?? null,
      temporalSeenSuppressedCount: details.temporalSeenSuppressedCount ?? null,
      memoryStableTokens: details.memoryStableTokens ?? null,
      memoryDynamicExtraTokens: details.memoryDynamicExtraTokens ?? null,
      cachedTokens: Number.isFinite(details.cachedTokens) ? details.cachedTokens : null,
      firstChangedBlock: details.firstChangedBlock || null,
      characterId: details.characterId ?? null,
      participantId: details.participantId ?? null,
      conversationId: details.conversationId || null,
      finalizationId: details.finalizationId || null,
      projectionId: /^m4p_[a-f0-9]{64}$/.test(details.projectionId || "") ? details.projectionId : null,
      visibleDeleted: Number.isSafeInteger(details.visibleDeleted) ? details.visibleDeleted : null,
      baseMemoryDeleted: Number.isSafeInteger(details.baseMemoryDeleted) ? details.baseMemoryDeleted : null,
      memory4EntriesForgotten: Number.isSafeInteger(details.memory4EntriesForgotten) ? details.memory4EntriesForgotten : null,
      derivedInvalidated: Number.isSafeInteger(details.derivedInvalidated) ? details.derivedInvalidated : null,
      disclosureEvidenceRevoked: Number.isSafeInteger(details.disclosureEvidenceRevoked) ? details.disclosureEvidenceRevoked : null,
      recoveryDeleted: Number.isSafeInteger(details.recoveryDeleted) ? details.recoveryDeleted : null,
      memory4Orphan: ["memory4_orphan_audit", "memory4_orphan_forget"].includes(stage) ? {
        ownerId: Number.isSafeInteger(details.ownerId) ? details.ownerId : null,
        candidateCount: Number.isSafeInteger(details.candidateCount) ? details.candidateCount : null,
        unknownCount: Number.isSafeInteger(details.unknownCount) ? details.unknownCount : null,
        canonicalEntriesForgotten: Number.isSafeInteger(details.canonicalEntriesForgotten) ? details.canonicalEntriesForgotten : null
      } : null,
      memory4Status: stage === "memory4_durable" ? details.status || null : null,
      memory4OwnerId: ["memory4_durable", "memory4_candidate_rejected"].includes(stage) && Number.isSafeInteger(details.ownerId) ? details.ownerId : null,
      memory4EntryCount: stage === "memory4_durable" && Number.isInteger(details.entryCount) ? details.entryCount : null,
      memory4Completeness: stage === "memory4_durable" ? details.completeness || null : null,
      memory4RejectedUnknownEntityCount: stage === "memory4_candidate_rejected" && details.reason === "unknown_entity"
        && Number.isSafeInteger(details.count) ? details.count : null,
      memory4Derived: derivedStage ? {
        ownerId: Number.isSafeInteger(details.ownerId) ? details.ownerId : null,
        status: ["RUNNING", "COMPLETE", "MANUAL_OVERRIDE", "QUEUED", "REQUEUED", "FAILED", "CANCELLED", "EXTRACTION_FAILED"].includes(details.status) ? details.status : null,
        kind: ["year", "life", "all"].includes(details.kind) ? details.kind : null,
        count: Number.isSafeInteger(details.count) ? details.count : null,
        ...(Number.isSafeInteger(details.eventYear) ? { eventYear: details.eventYear } : {}),
        ...(details.quality ? { quality: Object.fromEntries(["outputTokens", "finalTokens", "hardLimit", "missingGuardCount", "invalidTimeAxisCount"]
          .filter(key => Number.isSafeInteger(details.quality[key]) && details.quality[key] >= 0).map(key => [key, details.quality[key]])) } : {}),
        indexRevision: Number.isSafeInteger(details.indexRevision) ? details.indexRevision : null,
        derivedRevision: Number.isSafeInteger(details.derivedRevision) ? details.derivedRevision : null,
        sourceHash: /^[a-f0-9]{64}$/.test(details.sourceHash || "") ? details.sourceHash : null,
        durationMs: Number.isFinite(details.durationMs) ? details.durationMs : null
      } : null,
      memory4Recall: stage === "memory4_recall" ? {
        ownerId: Number.isSafeInteger(details.ownerId) ? details.ownerId : null,
        indexRevision: Number.isSafeInteger(details.indexRevision) ? details.indexRevision : null,
        axis: ["EVENT", "CONVERSATION", "MIXED", "MEMORY_RECALL"].includes(details.axis) ? details.axis : null,
        granularity: ["LIFE", "PERIOD", "YEAR", "EVENT", "EXACT_DATE", "FOLLOW_UP"].includes(details.granularity) ? details.granularity : null,
        queryHash: /^[a-f0-9]{64}$/.test(details.queryHash || "") ? details.queryHash : null,
        candidateCount: Number.isSafeInteger(details.candidateCount) ? details.candidateCount : null,
        bodyReads: Number.isSafeInteger(details.bodyReads) ? details.bodyReads : null,
        selectedIds: Array.isArray(details.selectedIds) ? details.selectedIds.map(String).slice(0, 3) : [],
        explicitTargetEntityIds: Array.isArray(details.explicitTargetEntityIds) ? details.explicitTargetEntityIds.filter(Number.isSafeInteger).slice(0, 32) : [],
        activeParticipantIds: Array.isArray(details.activeParticipantIds) ? details.activeParticipantIds.filter(Number.isSafeInteger).slice(0, 32) : [],
        mentionedOutOfSceneIds: Array.isArray(details.mentionedOutOfSceneIds) ? details.mentionedOutOfSceneIds.filter(Number.isSafeInteger).slice(0, 32) : [],
        entityTargetCandidateCount: Number.isSafeInteger(details.entityTargetCandidateCount) ? details.entityTargetCandidateCount : null,
        entityTargetSelectedIds: Array.isArray(details.entityTargetSelectedIds) ? details.entityTargetSelectedIds.map(String).slice(0, 3) : [],
        memory4SelectedIds: Array.isArray(details.memory4SelectedIds) ? details.memory4SelectedIds.map(String).slice(0, 3) : [],
        legacyCandidateCount: Number.isSafeInteger(details.legacyCandidateCount) ? details.legacyCandidateCount : null,
        legacyRejected: Object.fromEntries(Object.entries(details.legacyRejected || {}).filter(([key, value]) =>
          ["identity", "lexical", "topic", "budget", "stale", "forgotten"].includes(key) && Number.isSafeInteger(value))),
        rejected: Object.fromEntries(Object.entries(details.rejected || {}).filter(([key, value]) =>
          ["identity", "visibility", "deleted", "revision", "future_knowledge", "temporal", "chain", "state", "seen"].includes(key) && Number.isSafeInteger(value))),
        tokens: Number.isFinite(details.tokens) ? details.tokens : null,
        elapsedMs: Number.isFinite(details.elapsedMs) ? details.elapsedMs : null
      } : null,
      counterpartId: details.counterpartId ?? null,
      segmentId: details.segmentId || null,
      segmentMessageIds: Array.isArray(details.segmentMessageIds) ? [...details.segmentMessageIds] : [],
      presenceSignatures: Array.isArray(details.presenceSignatures) ? [...details.presenceSignatures] : [],
      visibleDialogueMessageCount: Number.isFinite(details.visibleDialogueMessageCount) ? details.visibleDialogueMessageCount : null,
      visibleDialogueChars: Number.isFinite(details.visibleDialogueChars) ? details.visibleDialogueChars : null,
      visibleSpeakerTurns: Number.isFinite(details.visibleSpeakerTurns) ? details.visibleSpeakerTurns : null,
      projectionSegmentCount: Number.isFinite(details.projectionSegmentCount) ? details.projectionSegmentCount : null,
      projectionMemoryCount: Number.isFinite(details.projectionMemoryCount) ? details.projectionMemoryCount : null
    };
    this.entries.push(safe);
    if (this.entries.length > this.maxEntries) this.entries.shift();
    this.logger?.log?.(`[MemoryTrace] ${stage}`, safe);
    return safe;
  }

  list() {
    return this.entries.map((entry) => ({ ...entry }));
  }
}

module.exports = { MemoryTrace };
