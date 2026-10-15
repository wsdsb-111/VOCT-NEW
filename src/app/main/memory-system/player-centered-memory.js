"use strict";

const crypto = require("crypto");
const { normalizeGameDate } = require("../worldline/character-temporal-facts");
const { retrievePairMemorySources } = require("./pair-memory-source-retrieval");
const { classifyThirdPersonHistoryRequest, removeQuotedText } = require("./pair-memory-routing");
const { resolveTemporalFocus } = require("./fuzzy-temporal-resolver");
const { buildDualTemporalIndex, selectDualTemporalExtras } = require("./summary-date-index");
const turnRecall = require("./turn-recall");
const FROZEN_ALLOCATION = Object.freeze({ ledgerMinimumShare: 0.3, officialMinimumShare: 0.2,
  stableMaximumTokens: 256, dynamicReserveShare: 0.15, dynamicMaximumTokens: 512 });

function digest(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function matchesCampaign(memory, campaignToken) {
  return typeof campaignToken === "string" && !!campaignToken.trim()
    && memory?.provenance?.campaignToken === campaignToken
    && memory.provenance.campaignBinding?.status !== "unresolved";
}

function officialFingerprint(summary) {
  return digest(summary ? [summary.sourceType, summary.playerId, summary.campaignToken,
    summary.officialCaptureSessionId, summary.memoryCount, summary.content] : null);
}

function forgetFingerprint(engine, ownerId) {
  return digest(engine.store.listForgottenSummaryProjections().filter(row => Number(row.ownerId) === ownerId));
}

function joinBlocks(blocks) {
  return blocks.filter(Boolean).join("\n\n");
}

function countMemoryBlocks(blocks, countTokens) {
  const texts = blocks.filter(Boolean);
  return Math.max(countTokens(joinBlocks(texts)), texts.reduce((sum, text) => sum
    + Math.max(countTokens(text), countTokens.messageTokens?.(text) || 0) + 8, 0));
}

function fitNarrative(engine, title, memory, budget, countTokens, routeKind, counterpartId) {
  if (!memory || budget <= 0) return { entries: [], text: "", truncated: false };
  const entry = { memory, score: 1, routeKind, routeCharacterIds: [counterpartId] };
  const render = selected => engine.formatMemoryBlock(title, selected) || "";
  const fullText = render([entry]);
  if (countMemoryBlocks([fullText], countTokens) <= budget) return { entries: [entry], text: fullText, truncated: false };
  // Truncate only the recall copy, including its title/date overhead. Stored Legacy stays intact.
  let low = 1, high = memory.content.length, fitted = null;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const candidate = { ...entry, memory: { ...memory, content: `${memory.content.slice(0, middle)}…` } };
    if (countMemoryBlocks([render([candidate])], countTokens) <= budget) { fitted = candidate; low = middle + 1; }
    else high = middle - 1;
  }
  return { entries: fitted ? [fitted] : [], text: fitted ? render([fitted]) : "", truncated: true };
}

function buildBaseline(engine, options, memories, revision, identity, countTokens) {
  const { characterId: ownerId, trustedPlayerAnchorId: playerId, campaignToken, currentGameDate,
    currentTotalDays, tokenBudget, officialSummary } = options;
  const budget = Math.max(0, Math.floor(Number(tokenBudget) || 0));
  const recent = engine.store.loadDirectPairSummaries(ownerId, playerId, memories)
    .filter(memory => matchesCampaign(memory, campaignToken) && memory.knownBy?.includes(ownerId)
      && normalizeGameDate(memory.eventDate)?.serial <= normalizeGameDate(currentGameDate).serial
      && memory.subtype !== "official_recollection" && memory.provenance?.extractionMode !== "ck3_native_recollection")
    .sort((left, right) => engine.getMemoryRecency(right) - engine.getMemoryRecency(left)
      || engine.getRouteMemoryKey(left).localeCompare(engine.getRouteMemoryKey(right)))[0];
  const official = officialSummary?.sourceType === "CK3_OFFICIAL_RECOLLECTION"
    && Number(officialSummary.playerId) === ownerId && officialSummary.memoryCount > 0
    && officialSummary.campaignToken === campaignToken
    && officialSummary.officialCaptureSessionId === options.conversationId
    ? { memoryId: `official_${ownerId}`, type: "folder_summary", subtype: "official_recollection", content: officialSummary.content } : null;
  const officialFull = official ? engine.formatMemoryBlock("合法官方追忆", [{ memory: official }]) : "";
  let ledgerPreview;
  try {
    ledgerPreview = engine.store.pairLedger.read({ ownerId, counterpartId: playerId, campaignToken }, {
      currentGameDate, currentTotalDays, memories, readOnly: true });
  } catch (error) {
    if (/IDENTITY|FORGET|SOURCE_UNSTABLE/.test(String(error.message))) throw error;
    ledgerPreview = { items: [] };
  }
  const ledgerReserve = ledgerPreview.items?.length ? Math.floor(budget * FROZEN_ALLOCATION.ledgerMinimumShare) : 0;
  const officialReserve = official ? Math.min(countMemoryBlocks([officialFull], countTokens),
    Math.max(0, Math.floor(budget * FROZEN_ALLOCATION.officialMinimumShare))) : 0;
  const recentBlock = fitNarrative(engine, "与玩家最近一篇 Legacy 摘要", recent,
    Math.max(0, budget - officialReserve - ledgerReserve), countTokens, "direct", playerId);
  const officialBlock = fitNarrative(engine, "合法官方追忆", official,
    Math.max(0, budget - countMemoryBlocks([recentBlock.text], countTokens) - ledgerReserve), countTokens, "official", ownerId);
  const remaining = () => Math.max(0, budget - countMemoryBlocks([recentBlock.text, officialBlock.text], countTokens));
  const stableCandidates = engine.store.queryMemories({ characterId: ownerId, includeFolderSummaries: false })
    .filter(memory => matchesCampaign(memory, campaignToken)
      && (!normalizeGameDate(memory.eventDate) || normalizeGameDate(memory.eventDate).serial <= normalizeGameDate(currentGameDate).serial)
      && (memory.importance >= 0.9 || memory.status === "open" || memory.unresolved));
  const rankedStable = engine.ranker.rank(stableCandidates, { query: "", entityIds: [], participantIds: [], currentTotalDays });
  const stableBudget = Math.min(FROZEN_ALLOCATION.stableMaximumTokens, Math.floor(remaining() / 4));
  const stable = engine.ranker.selectWithinBudget(rankedStable, { tokenBudget: stableBudget, estimateTokens: countTokens });
  let stableText = engine.formatMemoryBlock("长期稳定记忆", stable) || "";
  while (stable.length && countMemoryBlocks([stableText], countTokens) > stableBudget) {
    stable.pop(); stableText = engine.formatMemoryBlock("长期稳定记忆", stable) || "";
  }
  const dynamicReserve = Math.min(FROZEN_ALLOCATION.dynamicMaximumTokens, Math.floor(remaining() * FROZEN_ALLOCATION.dynamicReserveShare));
  const ledgerBudget = Math.max(0, remaining() - countMemoryBlocks([stableText], countTokens) - dynamicReserve - 8);
  const ledger = retrievePairMemorySources({ mode: "PLAYER_BASELINE_LEDGER", store: engine.store,
    ownerId, counterpartIds: [playerId], campaignToken, currentGameDate, currentTotalDays,
    memories, tokenBudget: ledgerBudget, estimateTokens: countTokens,
    recentSummary: { text: recentBlock.text, sources: recent?.provenance?.pairLedgerSources || [] } });
  if (ledger.fallbackStatus === "SOURCE_STALE" || engine.store.getFolderSummaryRevision(ownerId) !== revision) {
    throw new Error("player_memory_source_changed_during_build");
  }
  const texts = { directStableText: recentBlock.text || null, officialRecollectionText: officialBlock.text || null,
    playerLedgerFrozenText: ledger.text || null, stableText: stableText || null };
  const formattedTokens = countMemoryBlocks(Object.values(texts), countTokens);
  if (formattedTokens > budget) throw new Error("player_memory_formatted_budget_exceeded");
  return { identity, snapshotId: digest([identity, texts, ledger.metrics.orderDigest]), texts,
    direct: recentBlock.entries, official: officialBlock.entries, stable, items: ledger.items,
    sourceFolderRevision: revision, budgetTokens: budget, formattedTokens,
    officialFingerprint: officialFingerprint(officialSummary),
    ledgerMetrics: ledger.metrics, recentTruncated: recentBlock.truncated,
    officialTruncated: officialBlock.truncated, createdTurnEpoch: options.turnEpoch };
}

function resolveHistoryDecision(engine, options, state, memories) {
  const ownerId = Number(options.characterId), playerId = Number(options.trustedPlayerAnchorId);
  const sourceProfiles = options.entityProfiles || options.gameData?.getMentionableCharacterProfiles?.()
    || engine.getMentionableProfilesFromFolderMemories(memories);
  const profiles = sourceProfiles instanceof Map ? [...sourceProfiles.values()] : Array.isArray(sourceProfiles) ? sourceProfiles : [];
  const proposedTurn = options.trustedPlayerTurn;
  const currentPlayerTurn = proposedTurn?.conversationId === options.conversationId
    && proposedTurn?.sceneRevision === options.sceneRevision && proposedTurn?.turnEpoch === options.turnEpoch
    ? proposedTurn : null;
  const query = currentPlayerTurn?.trusted === true && currentPlayerTurn?.isCurrent === true
    && currentPlayerTurn?.role === "user" && Number(currentPlayerTurn?.speakerCharacterId) === playerId
    ? removeQuotedText(currentPlayerTurn.content) : "";
  const focus = state.namedTargetFocus;
  const focusValid = focus && focus.turnEpoch + 1 === options.turnEpoch && focus.sceneRevision === options.sceneRevision;
  const explicitIds = engine.mentionTracker.findMentionedCharacterIds([{ role: "user", content: query }], {
    candidates: profiles, excludedIds: [ownerId, playerId], resolveCoreference: false
  });
  const explicitAmbiguous = engine.mentionTracker.lastScanUnresolved === true;
  const targetIds = explicitIds.length || explicitAmbiguous ? explicitIds
    : engine.mentionTracker.findMentionedCharacterIds([{ role: "user", content: query }], {
      candidates: profiles, excludedIds: [ownerId, playerId],
      recentCharacterId: focusValid ? focus.characterId : null
    });
  const ambiguous = explicitAmbiguous || engine.mentionTracker.lastScanUnresolved === true;
  const decision = classifyThirdPersonHistoryRequest({ ownerId, playerAnchorId: playerId,
    trustedPlayerTurn: currentPlayerTurn,
    resolvedTargets: ambiguous ? [{ ambiguous: true }] : targetIds.map(characterId => ({ characterId, evidence: "UNIQUE_ALIAS" })),
    conversationBinding: state.historyBinding || null });
  if (decision.level !== "L0" && !explicitIds.length && targetIds.length && focusValid) decision.targetEvidence = "BOUND_FOLLOWUP";
  if (currentPlayerTurn?.trusted === true && query && state.namedTargetFocus?.turnEpoch !== options.turnEpoch) {
    state.namedTargetFocus = explicitIds.length === 1 && !ambiguous
      ? { characterId: explicitIds[0], turnEpoch: options.turnEpoch, sceneRevision: options.sceneRevision } : null;
  }
  if (decision.level !== "L0" && decision.targetEvidence !== "BOUND_FOLLOWUP") state.historyBinding = {
    responderId: ownerId, playerAnchorId: playerId, targetCharacterIds: decision.targetCharacterIds,
    authorizedTurnEpoch: options.turnEpoch, expiresAfterTurnEpoch: options.turnEpoch + 1,
    conversationId: options.conversationId, sceneRevision: options.sceneRevision
  };
  else if (decision.level === "L0" && decision.reasonCode !== "NO_TRUSTED_PLAYER_TURN") state.historyBinding = null;
  return { decision, query, profiles, mentionedTargetIds: targetIds, ambiguous };
}

function retrieveLegacyDetails(engine, options, memories, targets, profiles, temporal, excludedIds, tokenBudget, countTokens, limit) {
  const ownerId = Number(options.characterId);
  const uniqueAliases = engine.mentionTracker.buildAliases(profiles);
  let candidates = memories.filter(memory => memory.subtype !== "official_recollection"
    && !excludedIds.has(String(memory.memoryId))
    && targets.some(targetId => {
      if ([memory.provenance?.counterpartId, ...(memory.provenance?.counterpartIds || [])].map(Number).includes(targetId)) return true;
      if (options.directPairOnly) return false;
      return uniqueAliases.some(alias => alias.id === targetId && String(memory.content).includes(alias.name));
    }));
  let temporalEntries = [];
  if (temporal.triggered) {
    const dateIndex = buildDualTemporalIndex(candidates, { ownerId, currentGameDate: options.currentGameDate,
      currentTotalDays: options.currentTotalDays, campaignToken: options.campaignToken });
    temporalEntries = selectDualTemporalExtras(dateIndex, candidates, temporal, { query: options.trustedPlayerTurn?.content || "",
      entityIds: targets, directCounterpartIds: targets, excludedKeys: [...excludedIds],
      getKey: memory => String(memory.memoryId), limit });
    const allowed = new Set(temporalEntries.map(entry => entry.memory.memoryId));
    candidates = candidates.filter(memory => allowed.has(memory.memoryId));
  } else if (temporal.requested) candidates = [];
  const ranked = engine.ranker.rank(candidates, { query: options.trustedPlayerTurn?.content || "",
    entityIds: targets, participantIds: targets, currentTotalDays: options.currentTotalDays });
  const sources = [], texts = [], sourcePairs = new Set();
  const verifiedScopes = new Map();
  let rejected = 0, opened = 0, omittedByBudget = 0;
  for (const candidate of ranked) {
    if (sources.length >= limit || opened >= limit) break;
    const memory = candidate.memory;
    if (!temporal.triggered && Number(candidate.reason?.query) <= 0) continue;
    const pairSources = memory.provenance?.pairLedgerSources || [];
    for (const source of pairSources) {
      if (sources.some(entry => entry.memory.memoryId === memory.memoryId)) break;
      const counterpartId = Number(source.counterpartId);
      if (options.directPairOnly && !targets.includes(counterpartId)) continue;
      const scope = { ownerId, counterpartId, campaignToken: options.campaignToken };
      try {
        let index = verifiedScopes.get(counterpartId);
        if (!index) {
          index = engine.store.pairLedger.read(scope, { currentGameDate: options.currentGameDate,
            currentTotalDays: options.currentTotalDays, memories: options.rawOwnerSnapshot, readOnly: true });
          verifiedScopes.set(counterpartId, index);
        }
        const pointer = index.sourceSummaries.find(row => row.sourceMemoryId === memory.memoryId
          && row.sourceRevision === source.sourceRevision);
        if (!pointer || opened >= limit) continue;
        opened++;
        const resolved = engine.store.pairLedger.resolveSource(scope, pointer, { currentGameDate: options.currentGameDate,
          currentTotalDays: options.currentTotalDays, memories: options.rawOwnerSnapshot, readOnly: true });
        if (!resolved?.success || typeof resolved.summary?.content !== "string") { rejected++; continue; }
        const entry = { memory: { ...memory, content: resolved.summary.content }, routeKind: "dynamic_extra",
          routeCharacterIds: targets, sourceSummaryKey: pointer.sourceSummaryKey,
          reason: temporalEntries.find(row => row.memory.memoryId === memory.memoryId)?.reason || { source: "legacy_detail" } };
        const text = engine.formatMemoryBlock(temporal.triggered ? "本轮历史时间核对：按谈话／事件双时间轴引用" : "本轮经来源复验的历史经过", [entry]);
        if (countTokens(joinBlocks([...texts, text])) > tokenBudget) { omittedByBudget++; continue; }
        entry.tokens = countTokens(text);
        texts.push(text); sources.push(entry); sourcePairs.add(counterpartId);
      } catch { rejected++; }
    }
  }
  for (const [counterpartId, index] of verifiedScopes) {
    const current = engine.store.pairLedger.read({ ownerId, counterpartId, campaignToken: options.campaignToken }, {
      currentGameDate: options.currentGameDate, currentTotalDays: options.currentTotalDays, readOnly: true });
    if (current.sourceRevision !== index.sourceRevision) throw new Error("player_memory_source_changed_during_recall");
  }
  return { text: joinBlocks(texts), sources, sourcePairIds: [...sourcePairs], rejected, opened, omittedByBudget };
}

function retrieveDynamicMemory(engine, options, state, baseline, memories, rawMemories, countTokens) {
  const { decision, query, profiles, mentionedTargetIds, ambiguous } = resolveHistoryDecision(engine, options, state, memories);
  const messageOverhead = countMemoryBlocks([" "], countTokens) - countTokens(" ") + 1;
  const budget = Math.max(0, options.tokenBudget - baseline.formattedTokens - messageOverhead);
  const dynamicKey = digest([baseline.snapshotId, options.turnEpoch, options.sceneRevision,
    decision.queryFingerprint, decision.level, decision.targetCharacterIds, decision.reasonCode, budget]);
  if (state.dynamicKey === dynamicKey && state.dynamicResult) return { ...state.dynamicResult, cacheHit: true };
  const excludedIds = new Set([...baseline.direct, ...baseline.official, ...baseline.stable].map(entry => String(entry.memory.memoryId)));
  const temporal = resolveTemporalFocus(query, state.temporalFocus || null, { currentGameDate: options.currentGameDate,
    currentTotalDays: options.currentTotalDays, turnEpoch: options.turnEpoch,
    conversationId: options.conversationId, sceneRevision: options.sceneRevision });
  const entitiesProfile = profiles.map(profile => ({ characterId: Number(profile.id),
    name: engine.getCharacterMentionAliases(profile)[0], aliases: engine.getCharacterMentionAliases(profile) }));
  let pair = { text: "", items: [], sources: [], fallbackStatus: ambiguous ? "IDENTITY_AMBIGUOUS" : "NOT_REQUESTED",
    legacyFallbackEligible: false, metrics: { finalInjectedTokens: 0, scopeRevisions: [] } };
  if (decision.level !== "L0") pair = retrievePairMemorySources({
    mode: decision.level === "L2" ? "THIRD_PERSON_SOURCE_DETAIL" : "THIRD_PERSON_LEDGER",
    store: engine.store, ownerId: Number(options.characterId), decision, entitiesProfile,
    campaignToken: options.campaignToken, currentGameDate: options.currentGameDate, currentTotalDays: options.currentTotalDays,
    memories: rawMemories, query, excludedMemoryIds: [...excludedIds], tokenBudget: budget, estimateTokens: countTokens
  });
  const playerHistoryRequested = options.trustedPlayerTurn?.trusted === true && !ambiguous && !mentionedTargetIds.length
    && decision.level === "L0" && !decision.denialDetected
    && (turnRecall.detectIntent(query).triggered || temporal.requested);
  const fallbackEligible = pair.legacyFallbackEligible === true && decision.level === "L2";
  const sourceAttempts = (pair.verifiedCandidatePointers?.length || 0) + (pair.metrics.sourceKeyValidationFailedCount || 0);
  const fallback = fallbackEligible || playerHistoryRequested
    ? retrieveLegacyDetails(engine, { ...options, rawOwnerSnapshot: rawMemories, directPairOnly: playerHistoryRequested }, memories,
      fallbackEligible ? decision.targetCharacterIds : [Number(options.trustedPlayerAnchorId)], profiles, temporal,
      new Set([...excludedIds, ...pair.sources.map(entry => String(entry.memory.memoryId))]),
      Math.max(0, budget - countTokens(pair.text) - (pair.text ? 2 : 0)), countTokens, fallbackEligible ? Math.max(0, 2 - sourceAttempts) : 3)
    : { text: "", sources: [], sourcePairIds: [], rejected: 0, opened: 0, omittedByBudget: 0 };
  const text = joinBlocks([pair.text, fallback.text]);
  const result = { text, decision, temporal, items: pair.items, sources: [...pair.sources, ...fallback.sources],
    sourcePairIds: [...new Set([...(pair.metrics.scopeRevisions || []).map(entry => entry.counterpartId), ...fallback.sourcePairIds])],
    metrics: { ...pair.metrics, thirdPersonIntentLevel: decision.level, thirdPersonTargetCount: decision.targetCharacterIds.length,
      thirdPersonFallbackStatus: fallback.sources.length && fallbackEligible ? "LEGACY_SOURCE_FALLBACK"
        : fallback.omittedByBudget ? "BUDGET_OMITTED" : pair.fallbackStatus,
      legacyFallbackUsed: fallback.sources.length > 0 && fallbackEligible,
      legacySourceResolvedCount: fallback.opened, legacyBudgetOmittedCount: fallback.omittedByBudget,
      sourceKeyValidationFailedCount: (pair.metrics.sourceKeyValidationFailedCount || 0) + fallback.rejected,
      finalInjectedTokens: countMemoryBlocks([text], countTokens) } };
  state.dynamicKey = dynamicKey; state.dynamicResult = result;
  return result;
}

function retrievePlayerCenteredMemory(engine, options) {
  const { characterId, trustedPlayerAnchorId, campaignToken, conversationId, currentGameDate,
    sessionRecallCache, officialSummary, budgetPolicyRevision = "v936-player-centered-1" } = options;
  const ownerId = Number(characterId), playerId = Number(trustedPlayerAnchorId);
  const countTokens = text => text ? Math.max(0, Number((options.estimateTokens || (value => Math.ceil(String(value).length / 2)))(text)) || 0) : 0;
  if (typeof options.estimateMessageTokens === "function") countTokens.messageTokens = text =>
    options.estimateMessageTokens({ role: "system", content: text });
  const budget = Math.max(0, Math.floor(Number(options.tokenBudget) || 0));
  const valid = Number.isSafeInteger(ownerId) && ownerId > 0 && Number.isSafeInteger(playerId) && playerId > 0
    && ownerId !== playerId && typeof campaignToken === "string" && !!campaignToken.trim()
    && !!conversationId && !!normalizeGameDate(currentGameDate);
  if (!valid) return { playerCenteredRecallEnabled: true, engineVersion: require("../version").MEMORY_ENGINE_VERSION,
    memoryEngine3Enabled: true, respondingCharacterId: ownerId,
    playerAnchorId: Number.isSafeInteger(playerId) && playerId > 0 && playerId !== ownerId ? playerId : null,
    conversationId, sourceCampaignToken: campaignToken, sourceGameDate: currentGameDate,
    sourceSceneRevision: options.sceneRevision, sourcePairIds: [],
    direct: [], stable: [], relevant: [], extra: [], pairMemoryItems: [], pairMemorySources: [],
    tokenBudget: budget, selectedTokens: 0, directStableText: null, officialRecollectionText: null,
    playerLedgerFrozenText: null, stableText: null, temporalExtraText: null,
    pairMemoryMetrics: { fallbackStatus: "CAMPAIGN_UNBOUND", finalInjectedTokens: 0 },
    routing: { ownerId, directCounterpartIds: [], playerAnchorId: null } };

  const cache = sessionRecallCache instanceof Map ? sessionRecallCache : new Map();
  let state = cache.get(ownerId) || {};
  const previousSources = engine.store.folderSummaryCache?.get(ownerId);
  const guardedPairs = [...new Set([playerId, ...(state.sourcePairIds || [])])];
  if (previousSources && guardedPairs.some(id => engine.store.hasPairLedgerSourceContentChanges(previousSources, id))) {
    engine.store.invalidateFolderSummaryCache([ownerId]);
  }
  const revision = engine.store.getFolderSummaryRevision(ownerId);
  const supplied = options.ownerFolderMemories;
  const rawMemories = Array.isArray(supplied) && engine.store.getFolderSummarySnapshotRevision(supplied) === revision
    ? supplied : engine.store.loadFolderSummariesForCharacter(ownerId);
  const today = normalizeGameDate(currentGameDate).serial;
  const memories = rawMemories.filter(memory => Number(memory.provenance?.folderOwnerId) === ownerId
    && memory.knownBy?.includes(ownerId) && matchesCampaign(memory, campaignToken)
    && (!normalizeGameDate(memory.eventDate) || normalizeGameDate(memory.eventDate).serial <= today));
  const sourceForgetFingerprint = forgetFingerprint(engine, ownerId);
  const identity = digest([campaignToken, conversationId, ownerId, playerId, revision, today, sourceForgetFingerprint,
    officialFingerprint(officialSummary), budgetPolicyRevision, options.configurationRevision || null, engine.memoryGeneration]);
  const prior = state.frozenPlayerBaseline;
  const reuse = prior?.identity === identity && prior.formattedTokens <= budget && (prior.budgetTokens > 0 || budget === 0);
  if (!reuse) {
    state = { frozenPlayerBaseline: buildBaseline(engine, { ...options, characterId: ownerId,
      trustedPlayerAnchorId: playerId }, rawMemories, revision, identity, countTokens),
    seenDynamicSummaries: new Set(), temporalFocus: null };
  }
  const baseline = state.frozenPlayerBaseline;
  const dynamic = retrieveDynamicMemory(engine, { ...options, characterId: ownerId, trustedPlayerAnchorId: playerId,
    tokenBudget: budget }, state, baseline, memories, rawMemories, countTokens);
  state.sourcePairIds = [...new Set([...(reuse ? guardedPairs : [playerId]), ...dynamic.sourcePairIds])];
  state.folderSummaryRevision = revision;
  state.dynamicTurn = options.turnEpoch;
  state.dynamicExtra = dynamic.sources;
  state.pendingTemporalFocus = dynamic.temporal.nextFocus || null;
  cache.set(ownerId, state);
  const metrics = { ...baseline.ledgerMetrics, playerLedgerAvailableCount: baseline.ledgerMetrics.totalVisibleItems,
    playerLedgerInjectedCount: baseline.items.length, playerLedgerOmittedCount: baseline.ledgerMetrics.omittedItems,
    recentSummaryTruncated: baseline.recentTruncated, officialSummaryTruncated: baseline.officialTruncated,
    recentLegacyCount: baseline.direct.length, officialRecollectionPresent: baseline.official.length > 0,
    targetIdentityAmbiguous: dynamic.decision.reasonCode === "IDENTITY_AMBIGUOUS", budgetPolicyRevision,
    frozenSnapshotReuse: reuse, frozenSnapshotIdHash: baseline.snapshotId,
    frozenInvalidationReason: reuse ? null : prior ? prior.identity !== identity ? "SOURCE_OR_SCOPE_CHANGED" : "CONTEXT_HEADROOM" : "FIRST_PROMPT",
    baselineBudgetUsed: baseline.formattedTokens, dynamicBudgetUsed: dynamic.metrics.finalInjectedTokens,
    finalInjectedTokens: countMemoryBlocks([...Object.values(baseline.texts), dynamic.text], countTokens),
    sourceKeyValidationFailedCount: dynamic.metrics.sourceKeyValidationFailedCount || 0,
    openedSummaryCount: dynamic.sources.length, activePairIds: [playerId],
    thirdPersonIntentLevel: dynamic.decision.level, thirdPersonTargetCount: dynamic.decision.targetCharacterIds.length,
    thirdPersonIndexHitCount: dynamic.metrics.indexHitCount || 0, thirdPersonInjectedItems: dynamic.items.length,
    thirdPersonSourceOpenedCount: dynamic.sources.filter(entry => entry.routeKind === "third_person_source").length,
    thirdPersonLegacyFallbackStatus: dynamic.metrics.thirdPersonFallbackStatus,
    dynamicCacheHit: dynamic.cacheHit === true, legacyFallbackUsed: dynamic.metrics.legacyFallbackUsed === true };
  metrics.legacySourceResolvedCount = dynamic.metrics.legacySourceResolvedCount;
  metrics.legacyBudgetOmittedCount = dynamic.metrics.legacyBudgetOmittedCount;
  if (metrics.finalInjectedTokens > budget) throw new Error("player_memory_formatted_budget_exceeded");
  engine.trace.record("player_memory_retrieval", { responderId: ownerId, playerAnchorId: playerId,
    conversationIdHash: digest(conversationId), campaignHash: digest(campaignToken),
    responderIdHash: digest(ownerId), playerAnchorIdHash: digest(playerId), memoryBudgetPlan: options.memoryBudgetPlan,
    memoryBudget: budget, ...metrics });
  if (cache.recallDiagnostics instanceof Map) cache.recallDiagnostics.set(ownerId, {
    responderId: ownerId, ownerId, activeParticipantIds: options.activeParticipantIds || [],
    explicitTargetEntityIds: dynamic.decision.targetCharacterIds, mentionedOutOfSceneIds: [],
    campaignStatus: "RESOLVED", queryFingerprint: dynamic.decision.queryFingerprint,
    intent: dynamic.decision.level, pairMemoryMetrics: metrics,
    selectedOverviewIds: baseline.direct.map(entry => entry.memory.memoryId),
    selectedDetailIds: dynamic.sources.map(entry => entry.memory.memoryId),
    selectedStableIds: baseline.stable.map(entry => entry.memory.memoryId),
    seenSuppressedIds: [], injectedBlockIds: [], injectedTokens: null,
    injectionStatus: "PENDING", seenCommitStatus: "PENDING_PROVIDER_SUCCESS",
    stages: {
      pair: { status: "PLAYER_ANCHORED", requestedIds: [playerId], acceptedIds: [playerId], rejectedIds: [] },
      campaign: { status: "FILTERED", acceptedCount: memories.length, rejectedCount: rawMemories.length - memories.length },
      selection: { overviewIds: baseline.direct.map(entry => entry.memory.memoryId),
        detailIds: dynamic.sources.map(entry => entry.memory.memoryId), stableIds: baseline.stable.map(entry => entry.memory.memoryId) },
      seen: { status: "PENDING_PROVIDER_SUCCESS", suppressedIds: [] },
      injection: { status: "PENDING", injectedBlockIds: [], injectedTokens: null }
    }
  });
  return { engineVersion: require("../version").MEMORY_ENGINE_VERSION, playerCenteredRecallEnabled: true,
    memoryEngine3Enabled: true, respondingCharacterId: ownerId, playerAnchorId: playerId, conversationId,
    baselineSnapshotId: baseline.snapshotId, budgetPolicyRevision, frozenBaseline: baseline,
    sourceFolderRevision: revision, sourceCampaignToken: campaignToken, sourcePairIds: state.sourcePairIds,
    sourceGameDate: currentGameDate, sourceOfficialFingerprint: baseline.officialFingerprint,
    sourceForgetFingerprint, sourceSceneRevision: options.sceneRevision,
    ...baseline.texts, directText: baseline.texts.directStableText,
    direct: baseline.direct, official: baseline.official, stable: baseline.stable,
    relevant: [...baseline.direct, ...baseline.official, ...dynamic.sources], extra: dynamic.sources, mentioned: [], topicPatch: [],
    pairMemoryItems: [...baseline.items, ...dynamic.items], pairMemorySources: dynamic.sources, pairMemoryMetrics: metrics,
    thirdPersonDecision: dynamic.decision, temporal: dynamic.temporal,
    temporalExtraText: dynamic.text || null, mentionedSnapshotText: null, mentionedText: null, entityTargetText: null,
    topicPatchText: null, relevantText: null, tokenBudget: budget, selectedTokens: metrics.finalInjectedTokens,
    routing: { ownerId, playerAnchorId: playerId, directCounterpartIds: [playerId], activeParticipantIds: options.activeParticipantIds || [],
      budgets: { fixed: baseline.formattedTokens, extra: Math.max(0, budget - baseline.formattedTokens) } } };
}

function validatePlayerMemorySources(engine, context, gameData, conversationId) {
  if (!context?.playerCenteredRecallEnabled) return { valid: true };
  const ownerId = Number(context.respondingCharacterId);
  const reject = reason => ({ valid: false, reason });
  if (gameData?.campaignToken !== context.sourceCampaignToken || Number(gameData?.playerID) !== context.playerAnchorId
    || conversationId !== context.conversationId) return reject("PLAYER_OR_CAMPAIGN_CHANGED");
  if (context.sourceGameDate !== gameData?.date) return reject("GAME_DATE_CHANGED");
  if (!context.baselineSnapshotId && ![context.directStableText, context.officialRecollectionText,
    context.playerLedgerFrozenText, context.stableText, context.temporalExtraText].some(Boolean)) return { valid: true, reason: "NO_AUTHORIZED_MEMORY" };
  if (forgetFingerprint(engine, ownerId) !== context.sourceForgetFingerprint) return reject("FORGET_CHANGED");
  if (engine.store.getFolderSummaryRevision(ownerId) !== context.sourceFolderRevision) return reject("SOURCE_REVISION_CHANGED");
  const snapshot = engine.store.folderSummaryCache?.get(ownerId) || [];
  if ((context.sourcePairIds || []).some(id => engine.store.hasPairLedgerSourceContentChanges(snapshot, id))) {
    engine.store.invalidateFolderSummaryCache([ownerId]);
    return reject("SOURCE_CONTENT_CHANGED");
  }
  if (typeof gameData?.getOfficialRecollectionSummary === "function"
    && officialFingerprint(gameData.getOfficialRecollectionSummary(ownerId, conversationId)) !== context.sourceOfficialFingerprint) {
    return reject("OFFICIAL_SOURCE_CHANGED");
  }
  return { valid: true };
}

module.exports = { retrievePlayerCenteredMemory, validatePlayerMemorySources };
