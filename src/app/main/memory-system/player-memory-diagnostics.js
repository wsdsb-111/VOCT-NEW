"use strict";

const crypto = require("crypto");
const HASH_PATTERN = /^[a-f0-9]{64}$/i;
const FALLBACK_STATUSES = new Set([
  "BUDGET_OMITTED", "CAMPAIGN_UNBOUND", "CURRENT_DATE_REQUIRED", "IDENTITY_AMBIGUOUS",
  "IDENTITY_UNRESOLVED", "INDEX_HIT_ITEMS", "INDEX_HIT_SOURCE", "INDEX_MISS", "INDEX_UNAVAILABLE",
  "LEGACY_SOURCE_FALLBACK", "NOT_REQUESTED", "SOURCE_STALE", "TIME_WINDOW_NO_MATCH", "TEMPORAL_WINDOW_MISMATCH"
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
  "trustedCoveredScopeCount", "uncertainScopedScopeCount", "uncertainSourceCount", "unscopedUnknownCount",
  "candidateVisibleCount", "matchedWindowCount", "budgetOmittedCount"
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
  projected.targetResolution = safeEnum(value.targetResolution, new Set(["EXPLICIT_ALIAS", "KINSHIP_UNIQUE", "BOUND_FOLLOWUP", "TARGET_AMBIGUOUS", "TARGET_UNRESOLVED", "NO_HISTORY_TARGET"]));
  projected.trustedPlayerTurnResolved = safeBoolean(value.trustedPlayerTurnResolved);
  projected.temporalMode = safeEnum(value.temporalMode, new Set(["NO_TIME", "EXPLICIT_YEAR", "TARGET_DATE", "FUZZY_RECENCY", "EARLIEST_AVAILABLE"]));
  projected.timeAnchorStatus = safeEnum(value.timeAnchorStatus, new Set(["NO_TIME", "TRUSTED_PLAYER_QUERY", "UNAVAILABLE"]));
  for (const field of ["timeWindowStart", "timeWindowEnd"]) projected[field] = typeof value[field] === "string" && /^\d{1,6}\.\d{1,2}\.\d{1,2}$/u.test(value[field]) ? value[field] : null;
  projected.timeFallbackReason = safeEnum(value.timeFallbackReason, new Set(["NONE", "TIME_WINDOW_NO_MATCH", "TEMPORAL_WINDOW_MISMATCH", "TEMPORAL_EXPANSION_USED"]));
  projected.temporalExpansionUsed = safeBoolean(value.temporalExpansionUsed);
  projected.intentReasonCode = safeEnum(value.intentReasonCode, new Set(["EXPLICIT_HISTORY_REQUEST", "EXPLICIT_HISTORY_DETAIL",
    "NO_TRUSTED_PLAYER_TURN", "PLAYER_TURN_INVALID", "NO_HISTORICAL_INTENT", "AMBIGUOUS_TEMPORAL_CLAUSE",
    "DENIAL_OR_CURRENT_ONLY", "IDENTITY_AMBIGUOUS", "HISTORY_TARGET_UNRESOLVED", "FOLLOWUP_BINDING_EXPIRED",
    "RESPONDER_ID_INVALID", "PLAYER_ANCHOR_UNAVAILABLE", "BOUND_HISTORY_FOLLOWUP"]));
  return projected;
}

function buildMemoryAttemptDiagnostics({ memoryContext = {}, promptBuild = {}, logicalPlayerMessageId, attemptEpoch, regenerateOf, previous } = {}) {
  const hash = value => crypto.createHash("sha256").update(JSON.stringify(value ?? null)).digest("hex");
  const contentHash = value => crypto.createHash("sha256").update(String(value || "")).digest("hex");
  const decision = memoryContext.thirdPersonDecision || {};
  const temporal = memoryContext.temporal || {};
  const blocks = (promptBuild.blocks || []).filter(({ block }) => Object.hasOwn(TOKEN_BLOCK_FIELDS, block?.id));
  const narrative = ["direct", "official", "stable", "pairMemorySources"].flatMap(kind =>
    (memoryContext[kind] || []).map(entry => [kind, entry.memory?.memoryId, entry.sourceSummaryKey,
      entry.sourceRevision ?? entry.memory?.sourceRevision, entry.targetCharacterId]));
  const selected = [...narrative, ...(memoryContext.pairMemoryItems || []).map(item => [item.itemId, item.source?.sourceSummaryKey,
    item.source?.sourceRevision, item.targetCharacterId]), ...(memoryContext.pairMemorySources || []).map(source =>
    [source.sourceSummaryKey, source.sourceRevision, source.targetCharacterId])];
  const logicalPlayerMessageIdHash = logicalPlayerMessageId == null ? null : hash(logicalPlayerMessageId);
  const scopeDigest = hash([memoryContext.conversationId, memoryContext.respondingCharacterId, memoryContext.playerAnchorId,
    memoryContext.sourceCampaignToken, memoryContext.sourceSceneRevision, memoryContext.sourceGameDate,
    memoryContext.tokenBudget, temporal.mode, temporal.primaryWindow, temporal.expansionWindow]);
  const row = {
    logicalPlayerMessageIdHash, attemptEpoch: safeCount(attemptEpoch), regenerateOfHash: regenerateOf == null ? null : hash(regenerateOf),
    responderIdHash: hash(memoryContext.respondingCharacterId), conversationIdHash: hash(memoryContext.conversationId),
    campaignTokenHash: hash(memoryContext.sourceCampaignToken),
    trustedPlayerTurnResolved: memoryContext.pairMemoryMetrics?.trustedPlayerTurnResolved === true,
    memoryQueryFingerprint: safeHash(decision.logicalQueryFingerprint || decision.queryFingerprint),
    authorizationDigest: hash([decision.level, decision.targetCharacterIds, decision.targetEvidence, decision.historyIntent]),
    sourceRevisionDigest: hash([memoryContext.sourceFolderRevision, memoryContext.sourceForgetFingerprint,
      memoryContext.sourceOfficialFingerprint, narrative,
      (memoryContext.pairMemoryItems || []).map(item => [item.source?.sourceSummaryKey, item.source?.sourceRevision])]),
    memorySelectionDigest: hash(selected), scopeDigest,
    memoryInjectionDigest: hash(blocks.map(({ block, content, tokens }) => [block.id, contentHash(content), safeCount(tokens)])),
    renderedMemoryTokens: blocks.reduce((total, block) => total + (safeCount(block.tokens) || 0), 0),
    selectedMemoryTokens: safeCount(memoryContext.selectedTokens),
    comparisonStatus: "FIRST_ATTEMPT"
  };
  row.ageDiagnostics = projectAgeDiagnostics(promptBuild.ageDiagnostics);
  row.familyDiagnostics = projectFamilyDiagnostics(promptBuild.familyDiagnostics);
  row.ageSourceConflictCount = row.ageDiagnostics.filter(age => age.ageConflict === true).length;
  if (previous && logicalPlayerMessageIdHash && previous.logicalPlayerMessageIdHash === logicalPlayerMessageIdHash) {
    row.comparisonStatus = previous.scopeDigest !== row.scopeDigest ? "SNAPSHOT_CHANGED"
      : previous.authorizationDigest !== row.authorizationDigest || previous.memoryQueryFingerprint !== row.memoryQueryFingerprint ? "AUTHORIZATION_CHANGED"
        : previous.sourceRevisionDigest !== row.sourceRevisionDigest ? "SOURCE_CHANGED"
          : previous.memorySelectionDigest !== row.memorySelectionDigest ? "SELECTION_CHANGED"
            : previous.memoryInjectionDigest !== row.memoryInjectionDigest ? "PROMPT_INJECTION_CHANGED" : "MATCH";
  }
  return row;
}

function projectMemoryAttemptDiagnostics(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = {};
  for (const field of ["logicalPlayerMessageIdHash", "regenerateOfHash", "responderIdHash", "conversationIdHash", "campaignTokenHash", "memoryQueryFingerprint", "authorizationDigest", "sourceRevisionDigest", "memorySelectionDigest", "memoryInjectionDigest", "scopeDigest"]) row[field] = safeHash(value[field]);
  for (const field of ["attemptEpoch", "renderedMemoryTokens", "selectedMemoryTokens"]) row[field] = safeCount(value[field]);
  row.trustedPlayerTurnResolved = safeBoolean(value.trustedPlayerTurnResolved);
  row.comparisonStatus = safeEnum(value.comparisonStatus, new Set(["FIRST_ATTEMPT", "MATCH", "SNAPSHOT_CHANGED", "AUTHORIZATION_CHANGED", "SOURCE_CHANGED", "SELECTION_CHANGED", "PROMPT_INJECTION_CHANGED"]));
  row.ageDiagnostics = projectAgeDiagnostics(value.ageDiagnostics);
  row.familyDiagnostics = projectFamilyDiagnostics(value.familyDiagnostics);
  row.ageSourceConflictCount = row.ageDiagnostics.filter(age => age.ageConflict === true).length;
  return row;
}

function projectAgeDiagnostics(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 1).map(age => ({
    characterIdHash: safeHash(age?.characterIdHash),
    ageSource: safeEnum(age?.ageSource, new Set(["CK3_CURRENT_AGE", "CK3_LIVE_RELATIVE_AGE", "CK3_AGE_AT_DEATH",
      "BIRTH_CURRENT_CALENDAR", "BIRTH_DEATH_CALENDAR", "UNKNOWN", "LIFE_STATUS_CONFLICT", "AGE_SOURCE_CONFLICT", "AGE_AT_DEATH_UNAVAILABLE"])),
    rawAge: safeCount(age?.rawAge), calculatedCalendarAge: safeCount(age?.calculatedCalendarAge),
    ageConflict: safeBoolean(age?.ageConflict),
    selectedAge: safeCount(age?.selectedAge), promptAge: safeCount(age?.promptAge),
    currentAgeSourceOwnerIdHash: safeHash(age?.currentAgeSourceOwnerIdHash),
    currentAgeRelationType: safeEnum(age?.currentAgeRelationType, new Set(["parent", "child", "sibling", "spouse"])),
    currentAgeEvidenceSourceType: safeEnum(age?.currentAgeEvidenceSourceType, new Set(["parents", "children", "siblings", "spouses", "spouse", "other"])),
    sourceConflict: safeBoolean(age?.sourceConflict),
    profileSelectionPath: safeEnum(age?.profileSelectionPath, new Set(["CURRENT_CANONICAL", "BOUND_RELATIVE_OR_UNKNOWN"])),
    diagnosticCode: safeEnum(age?.diagnosticCode, new Set(["RAW_CK3_AGE_MISMATCH", "RELATIVE_AGE_MISSING", "AGE_SOURCE_SELECTION_MISMATCH", "CALENDAR_AGE_MISMATCH", "PROFILE_AGE_STALE", "PROMPT_AGE_MISMATCH", "MODEL_ANSWER_MISMATCH", "AGE_SOURCE_MATCH", "AGE_SOURCE_CONFLICT", "AGE_EVIDENCE_CONFLICT", "CALENDAR_AGE_UNVERIFIED", "LIFE_STATUS_CONFLICT", "CK3_AGE_AT_DEATH_SELECTED", "CURRENT_AGE_SELECTED", "RELATIVE_AGE_UNBOUND", "CURRENT_AGE_INVALID", "CURRENT_AGE_SOURCE_UNAVAILABLE", "CALENDAR_DAY_MAPPING_UNVERIFIED", "DATE_EVIDENCE_UNAVAILABLE"])),
    asOfGameDate: typeof age?.asOfGameDate === "string" && /^\d{1,6}\.\d{1,2}\.\d{1,2}$/u.test(age.asOfGameDate) ? age.asOfGameDate : null
  }));
}

function projectFamilyDiagnostics(value) {
  return Array.isArray(value) ? value.slice(0, 1).map(item => ({
    nodeVisits: safeCount(item?.nodeVisits), edgeVisits: safeCount(item?.edgeVisits),
    targetedParentQuery: safeBoolean(item?.targetedParentQuery), buildMs: safeFinite(item?.buildMs), tokenCount: safeCount(item?.tokenCount)
  })) : [];
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
  buildMemoryAttemptDiagnostics,
  projectMemoryAttemptDiagnostics,
  projectContextDiagnostics,
  projectPlayerMemoryDiagnostics,
  projectPairMemoryMetrics,
  projectMemoryBudgetPlan,
  projectMemoryTokenMetrics
};
