"use strict";

const HASH_PATTERN = /^[a-f0-9]{64}$/i;
const FALLBACK_STATUSES = new Set([
  "BUDGET_OMITTED", "CAMPAIGN_UNBOUND", "CURRENT_DATE_REQUIRED", "IDENTITY_AMBIGUOUS",
  "IDENTITY_UNRESOLVED", "INDEX_HIT_ITEMS", "INDEX_HIT_SOURCE", "INDEX_MISS", "INDEX_UNAVAILABLE",
  "LEGACY_SOURCE_FALLBACK", "NOT_REQUESTED", "SOURCE_STALE"
]);
const INTENT_LEVELS = new Set(["L0", "L1", "L2"]);
const DIRECTORY_STATUSES = new Set(["COMPLETE", "SCOPED_DEGRADED", "STALE", "UNAVAILABLE", "AMBIGUOUS"]);
const DIRECTORY_REASONS = new Set(["NONE", "REFERENCE_MODE", "OWNER_SNAPSHOT_UNAVAILABLE", "OWNER_SNAPSHOT_STALE",
  "SOURCE_COVERAGE_INCOMPLETE", "SCOPED_LEGACY_SOURCE", "UNSCOPED_LEGACY_SOURCE", "ALIAS_PROFILE_AMBIGUOUS", "DIRECTORY_BUILD_FAILED", "DIRECTORY_INVALID"]);
const POLICY_REVISIONS = new Set(["v9.3.5", "v9.3.6", "v936-player-centered-1"]);
const INVALIDATION_REASONS = new Set([
  "CONTEXT_HEADROOM", "FIRST_PROMPT", "PLAYER_OR_CAMPAIGN_CHANGED", "SOURCE_OR_SCOPE_CHANGED",
  "SOURCE_REVISION_CHANGED", "FORGET_CHANGED"
]);
const TOKEN_BLOCK_FIELDS = Object.freeze({
  "memory-stable": "stableTokens",
  "memory-direct-frozen": "directTokens",
  "memory-player-ledger-frozen": "playerLedgerTokens",
  "memory-official-recollection": "officialRecollectionTokens",
  "memory-mentioned-snapshot": "mentionedSnapshotTokens",
  "memory-temporal-extra": "temporalExtraTokens",
  "memory-session-topic-anchor": "sessionTopicAnchorTokens",
  "memory-topic-patch": "topicPatchTokens",
  "third-party-evidence-patch": "thirdPartyEvidenceTokens"
});

const COUNT_FIELDS = Object.freeze([
  "playerLedgerAvailableCount", "playerLedgerInjectedCount", "playerLedgerOmittedCount",
  "recentLegacyCount", "thirdPersonTargetCount", "thirdPersonIndexHitCount", "thirdPersonInjectedItems",
  "thirdPersonSourceOpenedCount", "legacySourceResolvedCount", "legacyBudgetOmittedCount",
  "sourceKeyValidationFailedCount", "openedSummaryCount", "recentSummaryReferencedItems",
  "sourceResolveAttemptCount", "totalSourceResolveAttemptCount", "candidatePairCount", "actualIndexReadCount",
  "indexCacheHits", "indexCacheMisses", "ownerPairCount", "scopeRevisionChecks", "legacyScanFallbackCount",
  "trustedCoveredScopeCount", "uncertainScopedScopeCount", "uncertainSourceCount", "unscopedUnknownCount"
]);
const TOKEN_FIELDS = Object.freeze([
  "memoryBudget", "baselineBudgetUsed", "dynamicBudgetUsed", "finalInjectedTokens",
  "frozenTextTokenCount", "dynamicTextTokenCount", "finalMemoryTokenCount",
  "providerInputTokens", "providerCachedInputTokens", "providerOutputTokens"
]);

function safeCount(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function safeFinite(value) {
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function safeHash(value) {
  return typeof value === "string" && HASH_PATTERN.test(value) ? value.toLowerCase() : null;
}

function safeEnum(value, allowed) {
  return typeof value === "string" && allowed.has(value) ? value : null;
}

function safeBoolean(value) {
  return typeof value === "boolean" ? value : null;
}

function objectOrEmpty(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function projectPairMemoryMetrics(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const projected = {};
  for (const field of COUNT_FIELDS) projected[field] = safeCount(value[field]);
  for (const field of TOKEN_FIELDS) projected[field] = safeCount(value[field]);
  for (const field of ["indexLookupMs", "sourceResolveMs", "candidateDirectoryBuildMs", "ownerValidationMs"]) projected[field] = safeFinite(value[field]);
  projected.candidateDirectoryStatus = safeEnum(value.candidateDirectoryStatus, DIRECTORY_STATUSES);
  projected.candidateDirectoryCacheHit = safeBoolean(value.candidateDirectoryCacheHit);
  projected.legacyScanFallbackReason = safeEnum(value.legacyScanFallbackReason, DIRECTORY_REASONS);
  projected.candidateReductionRatio = Number.isFinite(value.candidateReductionRatio)
    && value.candidateReductionRatio >= 0 && value.candidateReductionRatio <= 1 ? value.candidateReductionRatio : null;
  projected.memoryLevel = safeEnum(value.thirdPersonIntentLevel, INTENT_LEVELS);
  projected.frozenSnapshotIdHash = safeHash(value.frozenSnapshotIdHash);
  projected.frozenSnapshotReuse = safeBoolean(value.frozenSnapshotReuse);
  projected.frozenInvalidationReason = safeEnum(value.frozenInvalidationReason, INVALIDATION_REASONS);
  projected.recentLegacyTruncated = safeBoolean(value.recentLegacyTruncated ?? value.recentSummaryTruncated);
  projected.officialRecollectionPresent = safeBoolean(value.officialRecollectionPresent);
  projected.officialRecollectionTruncated = safeBoolean(value.officialRecollectionTruncated ?? value.officialSummaryTruncated);
  projected.targetIdentityAmbiguous = safeBoolean(value.targetIdentityAmbiguous ?? value.identityAmbiguous);
  projected.thirdPersonIntentLevel = safeEnum(value.thirdPersonIntentLevel, INTENT_LEVELS);
  projected.thirdPersonLegacyFallbackStatus = safeEnum(value.thirdPersonLegacyFallbackStatus ?? value.thirdPersonFallbackStatus, FALLBACK_STATUSES);
  projected.fallbackStatus = safeEnum(value.fallbackStatus, FALLBACK_STATUSES);
  projected.playerLedgerCacheHit = safeBoolean(value.playerLedgerCacheHit ?? value.ledgerCacheHit);
  projected.indexCacheHit = safeBoolean(value.indexCacheHit);
  projected.dynamicCacheHit = safeBoolean(value.dynamicCacheHit);
  projected.legacyFallbackUsed = safeBoolean(value.legacyFallbackUsed);
  projected.budgetPolicyRevision = safeEnum(value.budgetPolicyRevision, POLICY_REVISIONS);
  return projected;
}

function projectMemoryBudgetPlan(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return {
    policyRevision: safeEnum(value.policyRevision, POLICY_REVISIONS),
    participantCount: safeCount(value.participantCount),
    contextWindow: safeCount(value.contextWindow),
    nonMemoryInputTokens: safeCount(value.nonMemoryInputTokens),
    providerHeadroomTokens: safeCount(value.providerHeadroomTokens),
    memoryBudgetTokens: safeCount(value.memoryBudgetTokens),
    reservedOutputTokens: safeCount(value.reservedOutputTokens),
    safetyMarginTokens: safeCount(value.safetyMarginTokens),
    protocolOverheadTokens: safeCount(value.protocolOverheadTokens)
  };
}

function projectContextDiagnostics(value) {
  const row = objectOrEmpty(value);
  return {
    contextMode: safeEnum(row.contextMode, new Set(["auto", "custom", "invalid"])),
    contextWindowSource: safeEnum(row.contextWindowSource, new Set(["provider_native", "provider_metadata",
      "provider_native_cap", "user_provided", "user_provided_unverified", "safe_fallback", "invalid_configuration_fallback"])),
    effectiveContextWindow: safeCount(row.effectiveContextWindow)
  };
}

function projectMemoryTokenMetrics(value) {
  const metadata = objectOrEmpty(value);
  const projected = {
    renderedMemoryTokens: safeCount(metadata.renderedMemoryTokens),
    memoryPlayerLedgerTokens: safeCount(metadata.memoryPlayerLedgerTokens),
    memoryOfficialTokens: safeCount(metadata.memoryOfficialTokens),
    memoryRecentTokens: safeCount(metadata.memoryRecentTokens),
    memoryTemporalExtraTokens: safeCount(metadata.memoryTemporalExtraTokens)
  };
  const blocks = Array.isArray(metadata.blocks) ? metadata.blocks : null;
  projected.memoryBlockTokens = blocks ? Object.fromEntries(Object.entries(TOKEN_BLOCK_FIELDS).map(([id, field]) => [
    field, blocks.reduce((total, block) => total + (block?.id === id ? safeCount(block.tokens) || 0 : 0), 0)
  ])) : null;
  return projected;
}

function projectPlayerMemoryDiagnostics(value) {
  const details = objectOrEmpty(value);
  const metrics = projectPairMemoryMetrics(details.pairMemoryMetrics || details) || {};
  const plan = projectMemoryBudgetPlan(details.memoryBudgetPlan);
  return {
    version: "9.3.6",
    conversationIdHash: safeHash(details.conversationIdHash),
    campaignHash: safeHash(details.campaignHash),
    responderIdHash: safeHash(details.responderIdHash),
    playerAnchorIdHash: safeHash(details.playerAnchorIdHash),
    ...metrics,
    participantCount: plan?.participantCount ?? safeCount(details.participantCount),
    contextWindow: plan?.contextWindow ?? safeCount(details.contextWindow),
    maxOutputTokens: plan?.reservedOutputTokens ?? safeCount(details.maxOutputTokens),
    reservedOutputTokens: plan?.reservedOutputTokens ?? safeCount(details.reservedOutputTokens),
    safetyMarginTokens: plan?.safetyMarginTokens ?? safeCount(details.safetyMarginTokens),
    providerHeadroomTokens: plan?.providerHeadroomTokens ?? safeCount(details.providerHeadroomTokens),
    memoryBudgetTokens: plan?.memoryBudgetTokens ?? safeCount(details.memoryBudget) ?? metrics.memoryBudget,
    budgetPolicyRevision: plan?.policyRevision ?? metrics.budgetPolicyRevision,
    finalMemoryTokenCount: metrics.finalMemoryTokenCount ?? metrics.finalInjectedTokens
  };
}

module.exports = {
  projectContextDiagnostics,
  projectPlayerMemoryDiagnostics,
  projectPairMemoryMetrics,
  projectMemoryBudgetPlan,
  projectMemoryTokenMetrics
};
