"use strict";

const planSourceBindings = new WeakMap();
const { createHmac, randomBytes } = require("node:crypto");
const planSourceDiagnosticKey = randomBytes(32);

// Read-only projection of sources already selected by the existing memory verifier.
function projectPlanSource(entry, scope) {
  const projection = { frozenText: entry.frozenText };
  Object.defineProperty(projection, "key", { value: createHmac("sha256", planSourceDiagnosticKey)
    .update(JSON.stringify([sourceKey(entry), scope.ownerId, scope.campaignToken, scope.conversationId, scope.playerId])).digest("hex") });
  Object.freeze(projection);
  const ownerId = Number(entry.memory?.provenance?.folderOwnerId);
  const campaignToken = entry.memory?.provenance?.campaignToken;
  const revision = entry.sourceRevision;
  if (ownerId === scope.ownerId && campaignToken === scope.campaignToken
    && typeof entry.sourceSummaryKey === "string" && entry.sourceSummaryKey.length > 0 && !entry.sourceSummaryKey.startsWith("pair-summary:legacy:")
    && (typeof revision === "string" && revision.length > 0 || Number.isSafeInteger(revision) && revision >= 0)) {
    planSourceBindings.set(projection, Object.freeze({ sourceKey: entry.sourceSummaryKey, sourceRevision: revision,
      ownerId, campaignToken, conversationId: scope.conversationId, playerId: scope.playerId }));
  }
  return projection;
}

function getPlanSourceBinding(projection) {
  return planSourceBindings.get(projection) || null;
}

function usesFrozenDynamicPolicy(options) {
  return options?.budgetPolicyRevision === "v9.3.9";
}

function sourceKey(entry) {
  return JSON.stringify([entry.memory?.provenance?.folderOwnerId,
    entry.sourceSummaryKey, entry.sourceRevision]);
}

function category(entry) {
  return entry.routeKind === "third_person_source" ? "thirdPerson" : "temporal";
}

function prepareScope(cache, options) {
  const scope = JSON.stringify([options.conversationId, options.campaignToken, options.trustedPlayerAnchorId]);
  if (cache.dynamicFreezeScope && cache.dynamicFreezeScope !== scope) cache.clear();
  cache.dynamicFreezeScope = scope;
}

function getQuota(cache, options, includeCurrentPending = false) {
  const participantCount = options.participantCount || options.memoryBudgetPlan?.participantCount
    || new Set(options.activeParticipantIds || []).size;
  const limits = { temporal: participantCount >= 4 ? 3 : 5, thirdPerson: 3 };
  const keys = { temporal: new Set(), thirdPerson: new Set() };
  for (const [ownerId, state] of cache) {
    const pending = state.dynamicTurn === options.turnEpoch
      && (includeCurrentPending || Number(ownerId) !== Number(options.characterId))
      ? state.pendingDynamicSources || [] : [];
    for (const entry of [...(state.frozenDynamicSources || []), ...pending]) {
      keys[category(entry)].add(sourceKey(entry));
    }
  }
  return { limits, keys, remaining: {
    temporal: Math.max(0, limits.temporal - keys.temporal.size),
    thirdPerson: Math.max(0, limits.thirdPerson - keys.thirdPerson.size)
  } };
}

function commitFrozenSources(cache, ownerId, turnEpoch, injectedMemoryIds) {
  const state = cache.get(ownerId);
  if (!state?.frozenDynamicPolicy || state.dynamicTurn !== turnEpoch) return null;
  const entries = (state.pendingDynamicSources || []).filter(entry => injectedMemoryIds.has(String(entry.memory.memoryId)));
  const quota = getQuota(cache, { ...state.dynamicQuotaOptions, characterId: ownerId, turnEpoch }, true);
  if (Object.keys(quota.limits).some(kind => quota.keys[kind].size > quota.limits[kind])) {
    return { committedCount: 0, reason: "conversation_source_limit" };
  }
  if (!Array.isArray(state.frozenDynamicSources)) state.frozenDynamicSources = [];
  const keys = new Set(state.frozenDynamicSources.map(sourceKey));
  let committedCount = 0;
  for (const entry of entries) {
    if (keys.has(sourceKey(entry))) continue;
    state.frozenDynamicSources.push(JSON.parse(JSON.stringify(entry)));
    keys.add(sourceKey(entry));
    committedCount++;
  }
  if (state.pendingDynamicQueryKey && (entries.length || state.frozenDynamicSources.length)) {
    if (!(state.frozenDynamicQueryKeys instanceof Set)) state.frozenDynamicQueryKeys = new Set();
    state.frozenDynamicQueryKeys.add(state.pendingDynamicQueryKey);
  }
  state.pendingDynamicSources = [];
  state.dynamicKey = null;
  state.dynamicResult = null;
  return { committedCount, reason: committedCount ? "provider_success" : "frozen_reuse" };
}

function discardPendingSources(cache, ownerId, turnEpoch) {
  const state = cache?.get(Number(ownerId));
  if (state?.frozenDynamicPolicy && state.dynamicTurn === turnEpoch) {
    state.pendingDynamicSources = [];
    state.dynamicKey = null;
    state.dynamicResult = null;
  }
}

module.exports = { usesFrozenDynamicPolicy, prepareScope, sourceKey, category,
  getQuota, commitFrozenSources, discardPendingSources, projectPlanSource, getPlanSourceBinding };
