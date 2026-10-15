"use strict";

function buildIncidentDiagnostics({ memoryEngine, conversation, providerDiagnostics }) {
  const recall = [...(conversation?.memoryState?.recallDiagnostics?.values?.() || [])].slice(-12);
  const recovery = memoryEngine.listRecoverySnapshots().map(file => {
    const snapshot = memoryEngine.store.readJson(file, null);
    if (!snapshot) return null;
    return {
      conversationId: snapshot.conversationId, finalizationId: snapshot.finalizationId,
      stage: snapshot.finalizationStage, retryCount: snapshot.retryCount || 0,
      lastFailureClass: snapshot.lastFailureClass || null,
      lastFailureReasons: snapshot.lastFailureReasons || [snapshot.lastError].filter(Boolean),
      sameFailureCount: snapshot.sameFailureCount || 0, repairAttempted: snapshot.repairAttempted === true,
      narrativeState: memoryEngine.isCommitted(snapshot) ? "STORE" : "EXTRACTION_FAILED"
    };
  }).filter(Boolean).slice(-30);
  const providerCache = (providerDiagnostics?.getRecent?.(100) || []).filter(entry => entry.requestType === "chat").slice(0, 10).map(entry => ({
    timestamp: entry.timestamp, provider: entry.provider, model: entry.model,
    rawPromptTokens: entry.rawUsage?.prompt_tokens ?? null,
    rawCachedTokens: entry.rawUsage?.prompt_tokens_details?.cached_tokens ?? entry.rawUsage?.prompt_cache_hit_tokens ?? null,
    normalizedCachedTokens: entry.normalizedUsage?.prompt_cache_hit_tokens ?? null,
    stablePrefixTokens: entry.realRequestDiff?.actualStablePrefixTokens ?? null,
    prefixFingerprint: entry.realRequestDiff?.currentPrefixFingerprint ?? null,
    serializedPrefixSha256: entry.realRequestDiff?.serializedPrefixSha256 ?? null,
    stablePrefixEndPosition: entry.realRequestDiff?.stablePrefixEndPosition ?? null,
    stablePrefixUnchanged: entry.realRequestDiff?.stablePrefixUnchanged ?? null,
    firstChangedBlock: entry.realRequestDiff?.firstDifferentBlockId ?? null,
    firstChangedMessageIndex: entry.realRequestDiff?.firstDifferentMessagePosition ?? null
  }));
  return { recall, recovery, providerCache };
}

module.exports = { buildIncidentDiagnostics };
