"use strict";

const crypto = require("crypto");
const dynamicFreeze = require("./dynamic-summary-freeze");
const { normalizeGameDate } = require("../worldline/character-temporal-facts");
const { retrievePairMemorySources } = require("./pair-memory-source-retrieval");
const { ROUTE_SCHEMA_VERSION, classifyThirdPersonHistoryRequest, classifyTemporalIntent, removeQuotedText } = require("./pair-memory-routing");
const { resolveTemporalFocus } = require("./fuzzy-temporal-resolver");
const { hasTemporalAxisCue } = require("./temporal-anchor-extractor");
const { getCachedKinshipGraph } = require("../worldline/kinship-graph-cache");
const { resolveAnchoredRelationMention } = require("../worldline/anchored-relation-resolver");
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
  const recentSummaries = engine.store.loadDirectPairSummaries(ownerId, playerId, memories)
    .filter(memory => matchesCampaign(memory, campaignToken) && memory.knownBy?.includes(ownerId)
      && normalizeGameDate(memory.eventDate)?.serial <= normalizeGameDate(currentGameDate).serial
      && memory.subtype !== "official_recollection" && memory.provenance?.extractionMode !== "ck3_native_recollection")
    .sort((left, right) => engine.getMemoryRecency(right) - engine.getMemoryRecency(left)
      || engine.getRouteMemoryKey(left).localeCompare(engine.getRouteMemoryKey(right)))
    .slice(0, options.fullTextRequired ? 2 : 1);
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
  const recentBlocks = recentSummaries.map(memory => fitNarrative(engine,
    options.fullTextRequired ? "与玩家最近两篇 Legacy 摘要" : "与玩家最近一篇 Legacy 摘要", memory,
    options.fullTextRequired ? Number.MAX_SAFE_INTEGER : Math.max(0, budget - officialReserve - ledgerReserve),
    countTokens, "direct", playerId));
  const recentBlock = { entries: recentBlocks.flatMap(block => block.entries),
    text: joinBlocks(recentBlocks.map(block => block.text)), truncated: recentBlocks.some(block => block.truncated) };
  const officialBlock = fitNarrative(engine, "合法官方追忆", official,
    options.fullTextRequired ? Number.MAX_SAFE_INTEGER
      : Math.max(0, budget - countMemoryBlocks([recentBlock.text], countTokens) - ledgerReserve), countTokens, "official", ownerId);
  const remaining = () => Math.max(0, budget - countMemoryBlocks([recentBlock.text, officialBlock.text], countTokens));
  const stableCandidates = engine.store.queryMemories({ characterId: ownerId, includeFolderSummaries: false })
    .filter(memory => matchesCampaign(memory, campaignToken)
      && (!normalizeGameDate(memory.eventDate) || normalizeGameDate(memory.eventDate).serial <= normalizeGameDate(currentGameDate).serial)
      && (memory.importance >= 0.9 || memory.status === "open" || memory.unresolved));
  const rankedStable = engine.ranker.rank(stableCandidates, { query: "", entityIds: [], participantIds: [], currentTotalDays });
  const stableBudget = options.fullTextRequired ? FROZEN_ALLOCATION.stableMaximumTokens
    : Math.min(FROZEN_ALLOCATION.stableMaximumTokens, Math.floor(remaining() / 4));
  const stable = engine.ranker.selectWithinBudget(rankedStable, { tokenBudget: stableBudget, estimateTokens: countTokens });
  let stableText = engine.formatMemoryBlock("长期稳定记忆", stable) || "";
  while (stable.length && countMemoryBlocks([stableText], countTokens) > stableBudget) {
    stable.pop(); stableText = engine.formatMemoryBlock("长期稳定记忆", stable) || "";
  }
  const dynamicReserve = Math.min(FROZEN_ALLOCATION.dynamicMaximumTokens, Math.floor(remaining() * FROZEN_ALLOCATION.dynamicReserveShare));
  const ledgerBudget = Math.max(0, remaining() - countMemoryBlocks([stableText], countTokens) - dynamicReserve - 8);
  const ledger = retrievePairMemorySources({ mode: "PLAYER_BASELINE_LEDGER", store: engine.store,
    ownerId, counterpartIds: [playerId], campaignToken, currentGameDate, currentTotalDays,
    memories, tokenBudget: options.fullTextRequired ? Number.MAX_SAFE_INTEGER : ledgerBudget, estimateTokens: countTokens,
    recentSummaries: options.fullTextRequired ? recentBlocks.map((block, index) => ({ text: block.text,
      sources: recentSummaries[index].provenance?.pairLedgerSources || [] })) : null,
    recentSummary: { text: recentBlock.text, sources: recentSummaries.flatMap(memory => memory.provenance?.pairLedgerSources || []) } });
  if (ledger.fallbackStatus === "SOURCE_STALE" || engine.store.getFolderSummaryRevision(ownerId) !== revision) {
    throw new Error("player_memory_source_changed_during_build");
  }
  const texts = { directStableText: recentBlock.text || null, officialRecollectionText: officialBlock.text || null,
    playerLedgerFrozenText: ledger.text || null, stableText: stableText || null };
  const formattedTokens = countMemoryBlocks(Object.values(texts), countTokens);
  if (!options.fullTextRequired && formattedTokens > budget) throw new Error("player_memory_formatted_budget_exceeded");
  const proofIds = new Set([...recentSummaries.map(memory => memory.memoryId),
    ...ledger.items.map(item => item.source?.sourceMemoryId).filter(Boolean)]);
  const sourceProofs = memories.filter(memory => proofIds.has(memory.memoryId))
    .map(memory => ({ memoryId: memory.memoryId, contentHash: digest(memory.content) }));
  return { identity, scopeIdentity: options.scopeIdentity, sourceProofs,
    snapshotId: digest([identity, texts, ledger.metrics.orderDigest]), texts,
    direct: recentBlock.entries, official: officialBlock.entries, stable, items: ledger.items,
    sourceFolderRevision: revision, budgetTokens: budget, formattedTokens,
    officialFingerprint: officialFingerprint(officialSummary),
    ledgerMetrics: ledger.metrics, recentTruncated: recentBlock.truncated,
    officialTruncated: officialBlock.truncated, createdTurnEpoch: options.turnEpoch };
}

function resolveHistoryDecision(engine, options, state, memories) {
  if (state.routeSchemaVersion !== ROUTE_SCHEMA_VERSION) {
    state.historyBinding = null;
    state.namedTargetFocus = null;
    state.dynamicKey = null;
    state.dynamicResult = null;
    state.temporalFocus = null;
    state.pendingTemporalFocus = null;
    state.routeSchemaVersion = ROUTE_SCHEMA_VERSION;
  }
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
  const temporalIntent = classifyTemporalIntent(query);
  const targetQuery = temporalIntent.kind === "PAST_HISTORY" ? temporalIntent.historicalText
    : temporalIntent.kind === "FOLLOWUP" ? query : "";
  const focus = state.namedTargetFocus;
  const focusValid = focus && (focus.logicalTurnEpoch != null
    ? focus.logicalTurnEpoch + 1 === currentPlayerTurn?.logicalTurnEpoch : focus.turnEpoch + 1 === options.turnEpoch)
    && focus.sceneRevision === options.sceneRevision;
  const deniedTargetIds = new Set();
  let denialScopeAmbiguous = false;
  let hasTargetScopedDenial = false;
  for (const clause of temporalIntent.clauses) {
    const negation = /别|不要|不必|不用|无需|不想|暂时不/u.exec(clause.text);
    const remainder = negation ? clause.text.slice(negation.index + negation[0].length) : "";
    const talkAction = /谈|说|讲|提起/u.exec(remainder);
    const targetScopedTalkDenial = !clause.denialScope && !!talkAction && talkAction.index <= 12;
    if (!clause.denialScope && !targetScopedTalkDenial) continue;
    const ids = engine.mentionTracker.findMentionedCharacterIds([{ role: "user", content: clause.text }], {
      candidates: profiles, excludedIds: [ownerId, playerId], resolveCoreference: false
    });
    const ambiguousAliases = (engine.mentionTracker.lastAmbiguousAliases || [])
      .filter(alias => clause.text.includes(alias.name));
    if (targetScopedTalkDenial && !ids.length && !ambiguousAliases.length) continue;
    if (targetScopedTalkDenial) hasTargetScopedDenial = true;
    for (const id of ids) deniedTargetIds.add(id);
    if (engine.mentionTracker.lastScanUnresolved === true) {
      denialScopeAmbiguous = true;
      for (const alias of ambiguousAliases) for (const id of alias.characterIds) deniedTargetIds.add(id);
    }
  }
  const explicitIds = engine.mentionTracker.findMentionedCharacterIds([{ role: "user", content: targetQuery }], {
    candidates: profiles, excludedIds: [ownerId, playerId], resolveCoreference: false
  });
  const explicitAmbiguous = engine.mentionTracker.lastScanUnresolved === true;
  const explicitTargetIds = explicitIds.filter(id => !deniedTargetIds.has(id));
  const relation = temporalIntent.kind === "PAST_HISTORY" && !explicitIds.length && !explicitAmbiguous && options.gameData
    ? resolveAnchoredRelationMention({ query: targetQuery, responderId: ownerId,
      graph: getCachedKinshipGraph(options.gameData, { includeOtherParents: false }), recentTargetId: null }) : null;
  const relationRequested = relation && relation.status !== "NO_RELATION_INTENT";
  const kinshipId = relation?.status === "RELATION_RESOLVED" ? Number(relation.targetRuntimeId) : null;
  const kinshipResolved = Number.isSafeInteger(kinshipId) && kinshipId > 0 && ![ownerId, playerId].includes(kinshipId);
  const reciprocalTargetReference = /(?:你们|你俩|两人|彼此|双方)/u.test(targetQuery);
  const targetIds = relationRequested ? kinshipResolved ? [kinshipId] : []
    : explicitIds.length || explicitAmbiguous || temporalIntent.denialScopes.length || hasTargetScopedDenial ? explicitTargetIds
    : temporalIntent.kind === "PAST_HISTORY" && focusValid
      ? reciprocalTargetReference ? [Number(focus.characterId)] : engine.mentionTracker.findMentionedCharacterIds([{ role: "user", content: targetQuery }], {
        candidates: profiles, excludedIds: [ownerId, playerId], recentCharacterId: focus.characterId
      })
      : [];
  const ambiguous = explicitAmbiguous || engine.mentionTracker.lastScanUnresolved === true
    || relationRequested && !kinshipResolved && /AMBIGUOUS|CONFLICT|INCOMPLETE/u.test(relation.status);
  const decision = classifyThirdPersonHistoryRequest({ ownerId, playerAnchorId: playerId,
    trustedPlayerTurn: currentPlayerTurn,
    deniedTargetCharacterIds: [...deniedTargetIds], denialScopeAmbiguous, targetScopedDenial: hasTargetScopedDenial,
    resolvedTargets: ambiguous ? [{ ambiguous: true }] : targetIds.map(characterId => ({ characterId,
      evidence: kinshipResolved ? "KINSHIP_UNIQUE" : "UNIQUE_ALIAS" })),
    conversationBinding: state.historyBinding || null });
  if (decision.level !== "L0" && !kinshipResolved && !explicitIds.length && targetIds.length && focusValid) decision.targetEvidence = "BOUND_FOLLOWUP";
  if (currentPlayerTurn?.trusted === true && query && state.namedTargetFocus?.turnEpoch !== options.turnEpoch) {
    state.namedTargetFocus = explicitTargetIds.length === 1 && !ambiguous
      ? { characterId: explicitTargetIds[0], turnEpoch: options.turnEpoch,
        logicalTurnEpoch: currentPlayerTurn?.logicalTurnEpoch ?? null, sceneRevision: options.sceneRevision }
      : decision.level !== "L0" && focusValid ? focus : null;
    if (state.namedTargetFocus) state.namedTargetFocus.routeSchemaVersion = ROUTE_SCHEMA_VERSION;
  }
  if (decision.level !== "L0" && decision.targetEvidence !== "BOUND_FOLLOWUP") state.historyBinding = {
    responderId: ownerId, playerAnchorId: playerId, targetCharacterIds: decision.targetCharacterIds,
    authorizedTurnEpoch: options.turnEpoch, expiresAfterTurnEpoch: options.turnEpoch + 1,
    authorizedLogicalTurnEpoch: currentPlayerTurn?.logicalTurnEpoch ?? null,
    conversationId: options.conversationId, sceneRevision: options.sceneRevision,
    routeSchemaVersion: ROUTE_SCHEMA_VERSION
  };
  else if (decision.level === "L0" && decision.reasonCode !== "NO_TRUSTED_PLAYER_TURN") state.historyBinding = null;
  return { decision, query: temporalIntent.kind === "PAST_HISTORY" ? temporalIntent.historicalText : query,
    profiles, mentionedTargetIds: targetIds, ambiguous, temporalIntentKind: temporalIntent.kind,
    targetResolution: ambiguous ? "TARGET_AMBIGUOUS" : kinshipResolved ? "KINSHIP_UNIQUE"
      : decision.targetCharacterIds.length ? decision.targetEvidence === "BOUND_FOLLOWUP" ? "BOUND_FOLLOWUP" : "EXPLICIT_ALIAS"
        : relationRequested ? "TARGET_UNRESOLVED" : "NO_HISTORY_TARGET",
    relationRequested, temporalIntent };
}

function retrieveLegacyDetails(engine, options, query, memories, targets, profiles, temporal, excludedIds, tokenBudget, countTokens, limit) {
  if (limit <= 0) return { text: "", sources: [], sourcePairIds: [], rejected: 0, opened: 0, omittedByBudget: 0 };
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
    let dateIndex = buildDualTemporalIndex(candidates, { ownerId, currentGameDate: options.currentGameDate,
      currentTotalDays: options.currentTotalDays, campaignToken: options.campaignToken });
    if (options.strictTemporalAxis && hasTemporalAxisCue(query) && ["EVENT", "CONVERSATION"].includes(temporal.axisIntent)) {
      dateIndex = dateIndex.filter(entry => entry.axis === temporal.axisIntent.toLowerCase());
    }
    temporalEntries = selectDualTemporalExtras(dateIndex, candidates, temporal, { query,
      entityIds: targets, directCounterpartIds: targets, excludedKeys: [...excludedIds],
      getKey: memory => String(memory.memoryId), limit });
    const allowed = new Set(temporalEntries.map(entry => entry.memory.memoryId));
    candidates = candidates.filter(memory => allowed.has(memory.memoryId));
  } else if (temporal.requested) candidates = [];
  const ranked = engine.ranker.rank(candidates, { query,
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
          routeCharacterIds: targets, sourceSummaryKey: pointer.sourceSummaryKey, sourceRevision: pointer.sourceRevision,
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
  const { decision, query, profiles, mentionedTargetIds, ambiguous, temporalIntentKind, targetResolution, relationRequested,
    temporalIntent } = resolveHistoryDecision(engine, options, state, memories);
  const mixedPlayerClauses = options.fullTextRequired && decision.level !== "L0" && !decision.denialDetected
    ? temporalIntent.clauses.filter(clause => clause.kind === "PAST_HISTORY" && !clause.denialScope
      && /我们|咱们|你我|我与你|我和你|你与我|你和我|咱俩/u.test(clause.text)
      && !engine.mentionTracker.findMentionedCharacterIds([{ role: "user", content: clause.text }], {
        candidates: profiles, excludedIds: [Number(options.characterId), Number(options.trustedPlayerAnchorId)], resolveCoreference: false
      }).length && engine.mentionTracker.lastScanUnresolved !== true) : [];
  const mixedPlayerQuery = mixedPlayerClauses.map(clause => clause.text).join("；");
  const thirdPersonQuery = mixedPlayerQuery ? temporalIntent.clauses.filter(clause => clause.kind === "PAST_HISTORY"
    && !mixedPlayerClauses.includes(clause)).map(clause => clause.text).join("；") : query;
  const messageOverhead = countMemoryBlocks([" "], countTokens) - countTokens(" ") + 1;
  const budget = options.fullTextRequired ? Number.MAX_SAFE_INTEGER
    : Math.max(0, options.tokenBudget - baseline.formattedTokens - messageOverhead);
  const temporal = resolveTemporalFocus(thirdPersonQuery, state.temporalFocus || null, { currentGameDate: options.currentGameDate,
    currentTotalDays: options.currentTotalDays, turnEpoch: options.turnEpoch,
    logicalTurnEpoch: decision.authorizationMessageId != null ? options.trustedPlayerTurn?.logicalTurnEpoch : null,
    conversationId: options.conversationId, sceneRevision: options.sceneRevision });
  const frozenPolicy = dynamicFreeze.usesFrozenDynamicPolicy(options);
  const quota = frozenPolicy ? dynamicFreeze.getQuota(options.sessionRecallCache, options) : null;
  const queryKey = digest([baseline.snapshotId, query, decision.level, decision.targetCharacterIds,
    temporal.mode, temporal.primaryWindow, temporal.expansionWindow, options.sceneRevision]);
  state.pendingDynamicQueryKey = queryKey;
  const repeated = frozenPolicy && state.frozenDynamicQueryKeys?.has(queryKey);
  const temporalLimit = frozenPolicy ? repeated ? 0 : quota.remaining.temporal : 3;
  const thirdLimit = frozenPolicy ? repeated ? 0 : quota.remaining.thirdPerson : options.fullTextRequired ? 3 : 2;
  const dynamicKey = digest([baseline.snapshotId, options.turnEpoch, options.sceneRevision, quota?.remaining, repeated,
    options.trustedPlayerTurn?.messageId, options.currentGameDate, options.currentTotalDays,
    ROUTE_SCHEMA_VERSION, decision.queryFingerprint, decision.level, decision.targetCharacterIds, decision.reasonCode,
    temporal.requested, temporal.mode, temporal.primaryWindow, temporal.expansionWindow, budget,
    options.memoryBudgetPlan?.providerHeadroomTokens]);
  if (state.dynamicKey === dynamicKey && state.dynamicResult) return { ...state.dynamicResult, cacheHit: true };
  const excludedIds = new Set([...baseline.direct, ...baseline.official, ...baseline.stable,
    ...(frozenPolicy ? state.frozenDynamicSources || [] : [])].map(entry => String(entry.memory.memoryId)));
  const entitiesProfile = profiles.map(profile => ({ characterId: Number(profile.id),
    name: profile.fullName || profile.shortName || profile.name || engine.getCharacterMentionAliases(profile)[0],
    aliases: engine.getCharacterMentionAliases(profile) }));
  let pair = { text: "", items: [], sources: [], fallbackStatus: ambiguous ? "IDENTITY_AMBIGUOUS" : "NOT_REQUESTED",
    legacyFallbackEligible: false, metrics: { finalInjectedTokens: 0, scopeRevisions: [] } };
  if (decision.level !== "L0" && (!frozenPolicy || !repeated && (decision.level === "L1" || thirdLimit > 0))) pair = retrievePairMemorySources({
    mode: decision.level === "L2" ? "THIRD_PERSON_SOURCE_DETAIL" : "THIRD_PERSON_LEDGER",
    store: engine.store, ownerId: Number(options.characterId), decision, entitiesProfile,
    sceneRevision: options.sceneRevision,
    campaignToken: options.campaignToken, currentGameDate: options.currentGameDate, currentTotalDays: options.currentTotalDays,
    memories: rawMemories, query: thirdPersonQuery, temporal, excludedMemoryIds: [...excludedIds], tokenBudget: budget,
    sourceLimit: thirdLimit, estimateTokens: countTokens
  });
  const playerHistoryRequested = options.trustedPlayerTurn?.trusted === true && !ambiguous && (mixedPlayerQuery || !mentionedTargetIds.length
    && decision.level === "L0" && !decision.denialDetected && !relationRequested
    && ["PAST_HISTORY", "FOLLOWUP"].includes(temporalIntentKind)
    && (turnRecall.detectIntent(query).triggered || temporal.requested));
  const fallbackEligible = pair.legacyFallbackEligible === true && decision.level === "L2";
  const sourceAttempts = Number.isSafeInteger(pair.metrics.sourceResolveAttemptCount)
    ? pair.metrics.sourceResolveAttemptCount
    : (pair.verifiedCandidatePointers?.length || 0) + (pair.metrics.sourceKeyValidationFailedCount || 0);
  const thirdSourceLimit = thirdLimit;
  const fallback = fallbackEligible || playerHistoryRequested && !mixedPlayerQuery
    ? retrieveLegacyDetails(engine, { ...options, rawOwnerSnapshot: rawMemories, directPairOnly: playerHistoryRequested && !fallbackEligible,
      strictTemporalAxis: fallbackEligible }, thirdPersonQuery, memories,
      fallbackEligible ? decision.targetCharacterIds : [Number(options.trustedPlayerAnchorId)], profiles, temporal,
      new Set([...excludedIds, ...pair.sources.map(entry => String(entry.memory.memoryId))]),
      Math.max(0, budget - countTokens(pair.text) - (pair.text ? 2 : 0)), countTokens, fallbackEligible ? Math.max(0, thirdSourceLimit - sourceAttempts) : temporalLimit)
    : { text: "", sources: [], sourcePairIds: [], rejected: 0, opened: 0, omittedByBudget: 0 };
  if (options.fullTextRequired && fallbackEligible) {
    for (const entry of fallback.sources) entry.routeKind = "third_person_source";
  }
  if (mixedPlayerQuery && playerHistoryRequested) {
    const playerTemporal = resolveTemporalFocus(mixedPlayerQuery, null, { currentGameDate: options.currentGameDate,
      currentTotalDays: options.currentTotalDays, turnEpoch: options.turnEpoch });
    const playerExtra = retrieveLegacyDetails(engine, { ...options, rawOwnerSnapshot: rawMemories, directPairOnly: true },
      mixedPlayerQuery, memories, [Number(options.trustedPlayerAnchorId)], profiles, playerTemporal,
      new Set([...excludedIds, ...pair.sources.map(entry => String(entry.memory.memoryId)),
        ...fallback.sources.map(entry => String(entry.memory.memoryId))]), Number.MAX_SAFE_INTEGER, countTokens, temporalLimit);
    fallback.text = joinBlocks([fallback.text, playerExtra.text]);
    fallback.sources.push(...playerExtra.sources);
    fallback.sourcePairIds.push(...playerExtra.sourcePairIds);
    fallback.rejected += playerExtra.rejected;
    fallback.opened += playerExtra.opened;
  }
  const sources = [...pair.sources, ...fallback.sources];
  if (frozenPolicy) {
    sources.sort((left, right) => dynamicFreeze.sourceKey(left).localeCompare(dynamicFreeze.sourceKey(right)));
    for (const entry of sources) {
      entry.frozenText = engine.formatMemoryBlock(entry.routeKind === "third_person_source"
        ? "本场已核验第三人历史摘要" : "本场已核验时间历史摘要", [entry]);
      entry.tokens = countTokens(entry.frozenText);
    }
  }
  const nonSummaryText = frozenPolicy && decision.level === "L1" ? pair.text : "";
  const text = frozenPolicy ? joinBlocks([nonSummaryText, ...sources.map(entry => entry.frozenText)])
    : joinBlocks([pair.text, fallback.text]);
  const result = { text, nonSummaryText, decision, temporal, items: frozenPolicy && decision.level === "L2" ? [] : pair.items, sources,
    sourcePairIds: [...new Set([...(pair.metrics.scopeRevisions || []).map(entry => entry.counterpartId), ...fallback.sourcePairIds])],
    metrics: { ...pair.metrics, targetResolution, trustedPlayerTurnResolved: decision.authorizationMessageId != null,
      intentReasonCode: decision.reasonCode, thirdPersonIntentLevel: decision.level, thirdPersonTargetCount: decision.targetCharacterIds.length,
      thirdPersonFallbackStatus: fallback.sources.length && fallbackEligible ? "LEGACY_SOURCE_FALLBACK"
        : fallback.omittedByBudget ? "BUDGET_OMITTED" : pair.fallbackStatus,
      legacyFallbackUsed: fallback.sources.length > 0 && fallbackEligible,
      legacySourceResolvedCount: fallback.opened, legacyBudgetOmittedCount: fallback.omittedByBudget,
      totalSourceResolveAttemptCount: sourceAttempts + fallback.opened,
      sourceKeyValidationFailedCount: (pair.metrics.sourceKeyValidationFailedCount || 0) + fallback.rejected,
      finalInjectedTokens: countMemoryBlocks([text], countTokens) } };
  state.dynamicKey = dynamicKey; state.dynamicResult = result;
  return result;
}

function retrievePlayerCenteredMemory(engine, options) {
  options = { ...options, fullTextRequired: ["v9.3.8", "v9.3.9"].includes(options.budgetPolicyRevision) };
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
  options.sessionRecallCache = cache;
  const frozenPolicy = dynamicFreeze.usesFrozenDynamicPolicy(options);
  if (frozenPolicy) dynamicFreeze.prepareScope(cache, options);
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
    officialFingerprint(officialSummary), budgetPolicyRevision, options.configurationRevision || null, engine.memoryGeneration,
    engine.store.pairLedger?.retrievalEpoch]);
  const scopeIdentity = digest([campaignToken, conversationId, ownerId, playerId, today, sourceForgetFingerprint,
    officialFingerprint(officialSummary), budgetPolicyRevision, options.sceneRevision]);
  const prior = state.frozenPlayerBaseline;
  const byId = new Map(memories.map(memory => [memory.memoryId, memory]));
  const unchangedBaseline = frozenPolicy && prior?.scopeIdentity === scopeIdentity
    && prior.sourceProofs?.every(proof => byId.has(proof.memoryId) && digest(byId.get(proof.memoryId).content) === proof.contentHash);
  const reuse = (prior?.identity === identity || unchangedBaseline) && (options.fullTextRequired || prior.formattedTokens <= budget)
    && (prior.budgetTokens > 0 || budget === 0);
  if (!reuse) {
    const retained = frozenPolicy && state.playerMemoryScope === scopeIdentity
      ? (state.frozenDynamicSources || []).filter(entry => {
        const current = byId.get(entry.memory.memoryId);
        return current?.content === entry.memory.content && current.provenance?.pairLedgerSources?.some(pointer =>
          pointer.sourceSummaryKey === entry.sourceSummaryKey && pointer.sourceRevision === entry.sourceRevision);
      }) : [];
    state = { frozenPlayerBaseline: buildBaseline(engine, { ...options, scopeIdentity, characterId: ownerId,
      trustedPlayerAnchorId: playerId }, rawMemories, revision, identity, countTokens),
      ...(retained.length ? { frozenDynamicSources: retained } : {}),
      seenDynamicSummaries: new Set(), temporalFocus: null };
  } else if (frozenPolicy) {
    state.frozenPlayerBaseline = { ...prior, identity, sourceFolderRevision: revision };
    state.frozenDynamicSources = (state.frozenDynamicSources || []).filter(entry => {
      const current = byId.get(entry.memory.memoryId);
      return current?.content === entry.memory.content && current.provenance?.pairLedgerSources?.some(pointer =>
        pointer.sourceSummaryKey === entry.sourceSummaryKey && pointer.sourceRevision === entry.sourceRevision);
    });
  }
  state.playerMemoryScope = scopeIdentity;
  const baseline = state.frozenPlayerBaseline;
  state.frozenDynamicPolicy = frozenPolicy;
  state.dynamicQuotaOptions = { participantCount: options.participantCount, activeParticipantIds: options.activeParticipantIds,
    memoryBudgetPlan: { participantCount: options.memoryBudgetPlan?.participantCount } };
  cache.set(ownerId, state);
  let dynamic = retrieveDynamicMemory(engine, { ...options, characterId: ownerId, trustedPlayerAnchorId: playerId,
    tokenBudget: budget }, state, baseline, memories, rawMemories, countTokens);
  let frozenDynamicText = null;
  if (frozenPolicy) {
    state.pendingDynamicSources = dynamic.sources;
    const byKey = new Map((state.frozenDynamicSources || []).map(entry => [dynamicFreeze.sourceKey(entry), entry]));
    for (const entry of dynamic.sources) if (!byKey.has(dynamicFreeze.sourceKey(entry))) byKey.set(dynamicFreeze.sourceKey(entry), entry);
    const sources = [...byKey.values()];
    frozenDynamicText = joinBlocks(sources.map(entry => entry.frozenText)) || null;
    const text = joinBlocks([frozenDynamicText, dynamic.nonSummaryText]);
    dynamic = { ...dynamic, sources, text, metrics: { ...dynamic.metrics, finalInjectedTokens: countMemoryBlocks([text], countTokens) } };
  }
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
    candidatePairCount: dynamic.metrics.candidatePairCount || 0,
    candidateDirectoryStatus: dynamic.metrics.candidateDirectoryStatus || "UNAVAILABLE",
    candidateDirectoryCacheHit: dynamic.metrics.candidateDirectoryCacheHit === true,
    candidateDirectoryBuildMs: dynamic.metrics.candidateDirectoryBuildMs || 0,
    trustedCoveredScopeCount: dynamic.metrics.trustedCoveredScopeCount || 0,
    uncertainScopedScopeCount: dynamic.metrics.uncertainScopedScopeCount || 0,
    uncertainSourceCount: dynamic.metrics.uncertainSourceCount || 0,
    unscopedUnknownCount: dynamic.metrics.unscopedUnknownCount || 0,
    ownerValidationMs: dynamic.metrics.ownerValidationMs || 0,
    indexLookupMs: (baseline.ledgerMetrics.indexLookupMs || 0) + (dynamic.metrics.indexLookupMs || 0),
    sourceResolveMs: dynamic.metrics.sourceResolveMs || 0,
    ownerPairCount: dynamic.metrics.ownerPairCount || 0,
    candidateReductionRatio: dynamic.metrics.candidateReductionRatio ?? null,
    scopeRevisionChecks: dynamic.metrics.scopeRevisionChecks || 0,
    legacyScanFallbackCount: dynamic.metrics.legacyScanFallbackCount || 0,
    legacyScanFallbackReason: dynamic.metrics.legacyScanFallbackReason || "NONE",
    actualIndexReadCount: dynamic.metrics.actualIndexReadCount || 0,
    indexCacheHits: dynamic.metrics.indexCacheHits || 0,
    indexCacheMisses: dynamic.metrics.indexCacheMisses || 0,
    indexCacheHit: dynamic.metrics.indexCacheHit === true,
    dynamicCacheHit: dynamic.cacheHit === true, legacyFallbackUsed: dynamic.metrics.legacyFallbackUsed === true };
  if (frozenPolicy) {
    const quota = dynamicFreeze.getQuota(cache, options);
    metrics.temporalRecallLimit = quota.limits.temporal;
    metrics.thirdPersonRecallLimit = quota.limits.thirdPerson;
    metrics.frozenDynamicCount = state.frozenDynamicSources?.length || 0;
    metrics.pendingDynamicCount = state.pendingDynamicSources?.length || 0;
    metrics.dynamicRecallStatus = metrics.pendingDynamicCount ? "NEW_SOURCES" : metrics.frozenDynamicCount ? "FROZEN_REUSE"
      : !quota.remaining.temporal || !quota.remaining.thirdPerson ? "SOURCE_LIMIT" : "NOT_REQUESTED";
  }
  metrics.legacySourceResolvedCount = dynamic.metrics.legacySourceResolvedCount;
  metrics.legacyBudgetOmittedCount = dynamic.metrics.legacyBudgetOmittedCount;
  metrics.sourceResolveAttemptCount = dynamic.metrics.sourceResolveAttemptCount || 0;
  metrics.totalSourceResolveAttemptCount = dynamic.metrics.totalSourceResolveAttemptCount;
  for (const field of ["targetResolution", "trustedPlayerTurnResolved", "intentReasonCode", "temporalMode", "timeAnchorStatus",
    "timeWindowStart", "timeWindowEnd", "timeFallbackReason", "candidateVisibleCount", "matchedWindowCount", "temporalExpansionUsed"]) {
    metrics[field] = dynamic.metrics[field] ?? null;
  }
  metrics.budgetOmittedCount = (dynamic.metrics.budgetOmittedCount || 0) + (dynamic.metrics.legacyBudgetOmittedCount || 0);
  if (metrics.finalInjectedTokens > budget) {
    if (options.fullTextRequired) {
      const error = new Error("记忆全文超出本次可用上下文；已暂停发送，未裁剪摘要或事项。");
      error.code = "MEMORY_CONTEXT_OVERFLOW";
      error.memoryBudgetDetails = { requiredTokens: metrics.finalInjectedTokens, availableTokens: budget,
        breakdown: { recent: countMemoryBlocks([baseline.texts.directStableText], countTokens),
          official: countMemoryBlocks([baseline.texts.officialRecollectionText], countTokens),
          ledger: countMemoryBlocks([baseline.texts.playerLedgerFrozenText], countTokens),
          stable: countMemoryBlocks([baseline.texts.stableText], countTokens),
          temporal: dynamic.sources.filter(entry => entry.routeKind !== "third_person_source").reduce((sum, entry) => sum + entry.tokens, 0),
          thirdPerson: Math.max(0, dynamic.metrics.finalInjectedTokens - dynamic.sources.filter(entry => entry.routeKind !== "third_person_source")
            .reduce((sum, entry) => sum + entry.tokens, 0)) } };
      throw error;
    }
    throw new Error("player_memory_formatted_budget_exceeded");
  }
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
    ...(frozenPolicy ? {
      committedDynamicPlanSources: (state.frozenDynamicSources || []).map(entry => dynamicFreeze.projectPlanSource(entry,
        { ownerId, campaignToken, conversationId, playerId })),
      pendingDynamicPlanSources: (state.pendingDynamicSources || []).filter(entry => !(state.frozenDynamicSources || [])
        .some(committed => dynamicFreeze.sourceKey(committed) === dynamicFreeze.sourceKey(entry)))
        .map(entry => dynamicFreeze.projectPlanSource(entry, { ownerId, campaignToken, conversationId, playerId }))
    } : {}),
    frozenDynamicText, temporalExtraText: (frozenPolicy ? dynamic.nonSummaryText : dynamic.text) || null, mentionedSnapshotText: null, mentionedText: null, entityTargetText: null,
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
  try {
    const snapshot = engine.store.loadFolderSummariesForCharacter(ownerId);
    if (engine.store.getFolderSummarySnapshotRevision(snapshot) !== context.sourceFolderRevision) {
      engine.store.invalidateFolderSummaryCache([ownerId]);
      return reject("SOURCE_REVISION_CHANGED");
    }
    if ((context.sourcePairIds || []).some(id => engine.store.hasPairLedgerSourceContentChanges(snapshot, id))
      || engine.store.hasOwnerSummaryContentChanges(snapshot)) {
      engine.store.invalidateFolderSummaryCache([ownerId]);
      return reject("SOURCE_CONTENT_CHANGED");
    }
  } catch {
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
