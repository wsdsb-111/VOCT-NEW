"use strict";

class MemoryTrace {
  constructor({ logger = console, maxEntries = 500 } = {}) {
    this.logger = logger;
    this.maxEntries = maxEntries;
    this.entries = [];
  }

  record(stage, details = {}) {
    const safe = {
      timestamp: new Date().toISOString(),
      stage,
      success: typeof details.success === "boolean" ? details.success : null,
      finalizationStage: stage === "finalization" ? details.stage || null : null,
      providerSuccess: typeof details.providerSuccess === "boolean" ? details.providerSuccess : null,
      recoveryState: details.recoveryState || null,
      error: details.error || details.errorCode || null,
      attempt: Number.isInteger(details.attempt) ? details.attempt : null,
      durationMs: Number.isFinite(details.durationMs) ? details.durationMs : null,
      memoryId: details.memoryId || null,
      type: details.type || null,
      score: Number.isFinite(details.score) ? details.score : null,
      reason: details.reason || null,
      alias: details.alias || null,
      characterIds: Array.isArray(details.characterIds) ? [...details.characterIds] : [],
      patchInserted: details.patchInserted === true,
      temporalAxis: details.temporalAxis || "none",
      targetGameYear: Number.isInteger(details.targetGameYear) ? details.targetGameYear : null,
      eventTimeCandidates: details.eventTimeCandidates ?? null,
      conversationTimeCandidates: details.conversationTimeCandidates ?? null,
      temporalEventHitCount: details.temporalEventHitCount ?? null,
      temporalConversationHitCount: details.temporalConversationHitCount ?? null,
      selectedTemporalCount: details.temporalExtraCount ?? null,
      temporalFocusReused: details.temporalFocusReused === true,
      temporalFocusReuseCount: details.temporalFocusReuseCount ?? null,
      temporalMissCount: details.temporalMissCount ?? null,
      temporalBudgetOmittedCount: details.temporalBudgetOmittedCount ?? null,
      memoryStableTokens: details.memoryStableTokens ?? null,
      memoryDynamicExtraTokens: details.memoryDynamicExtraTokens ?? null,
      cachedTokens: Number.isFinite(details.cachedTokens) ? details.cachedTokens : null,
      firstChangedBlock: details.firstChangedBlock || null,
      characterId: details.characterId ?? null,
      participantId: details.participantId ?? null,
      conversationId: details.conversationId || null,
      finalizationId: details.finalizationId || null,
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
