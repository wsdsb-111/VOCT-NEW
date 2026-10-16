"use strict";

const { performance } = require("perf_hooks");
const crypto = require("crypto");
const { parseImportantMatters, searchTerms } = require("../../shared/pair-important-matters");
const { normalizeGameDate } = require("../worldline/character-temporal-facts");

const PLAYER_LEDGER_HEADER = "【与玩家的长期事项】以下日期是谈话记录日期；事项为当时记录，承诺或打算不表示已履行。";

function isRetrievablePairLedgerItem(item) {
  return !!item && item.confirmed !== false && (!item.ambiguous || item.confirmed === true);
}

function itemDateSerial(item) {
  const date = normalizeGameDate(item?.conversationDate);
  return date?.serial ?? (Number(item?.conversationTotalDays) || 0);
}

function compareLedgerItems(left, right) {
  return itemDateSerial(left) - itemDateSerial(right)
    || String(left?.source?.sourceSummaryKey || "").localeCompare(String(right?.source?.sourceSummaryKey || ""))
    || Number(left?.source?.sourceItemOrdinal || 0) - Number(right?.source?.sourceItemOrdinal || 0)
    || String(left?.itemId || "").localeCompare(String(right?.itemId || ""));
}

function itemYear(item) {
  const match = String(item?.conversationDate || "").match(/^(\d{3,6})[.\-/]/u);
  return match ? Number(match[1]) : null;
}

function evidenceLabel(evidence) {
  return { DIRECT_PAIR: "直接交流", GROUP_WITNESSED: "共同见证", UNDETERMINED: "交谈方式未确定" }[evidence]
    || "交谈方式未确定";
}

function formatPlayerLedgerItem(item) {
  return `- ${item.conversationDate}（${evidenceLabel(item.interactionEvidence)}）：${item.recentSummaryReference ? "详见近期摘要" : item.text}`;
}

function formatPlayerLedgerBlock(items) {
  return items.length ? `${PLAYER_LEDGER_HEADER}\n${items.map(formatPlayerLedgerItem).join("\n")}` : "";
}

function stableOrderDigest(items) {
  const order = items.map(item => [item.itemId, item.conversationDate,
    item.source?.sourceSummaryKey || null, item.source?.sourceRevision || null,
    item.source?.sourceItemOrdinal ?? null]);
  return crypto.createHash("sha256").update(JSON.stringify(order)).digest("hex");
}

function selectPlayerLedgerItems(items, tokenBudget, estimateTokens) {
  const buckets = new Map();
  for (const item of items) {
    const year = itemYear(item) ?? 0;
    if (!buckets.has(year)) buckets.set(year, []);
    buckets.get(year).push(item);
  }
  const sortedYears = [...buckets.keys()].sort((left, right) => right - left);
  const years = [];
  for (let first = 0, last = sortedYears.length - 1; first <= last; first++, last--) {
    years.push(sortedYears[first]);
    if (last !== first) years.push(sortedYears[last]);
  }
  for (const rows of buckets.values()) rows.sort((left, right) => compareLedgerItems(right, left));

  const selected = [];
  let round = 0;
  let hasRemaining = true;
  while (hasRemaining) {
    hasRemaining = false;
    for (const year of years) {
      const candidate = buckets.get(year)[round];
      if (!candidate) continue;
      hasRemaining = true;
      const candidateItems = [...selected, candidate].sort(compareLedgerItems);
      if (estimateTokens(formatPlayerLedgerBlock(candidateItems)) <= tokenBudget) selected.push(candidate);
    }
    round++;
  }
  return selected.sort(compareLedgerItems);
}

function emptyPlayerLedger(fallbackStatus, extraMetrics = {}) {
  const metrics = {
    indexLookupMs: 0,
    candidateSummaryCount: 0,
    totalVisibleItems: 0,
    injectedItems: 0,
    omittedItems: 0,
    omittedByBudget: 0,
    orderDigest: stableOrderDigest([]),
    scopeRevisions: [],
    finalInjectedTokens: 0,
    pairLedgerTokens: 0,
    legacyFallbackUsed: false,
    fallbackReason: fallbackStatus,
    ...extraMetrics
  };
  return { text: "", items: [], sources: [], metrics, fallbackStatus, legacyFallbackEligible: false };
}

function retrievePlayerBaselineLedger({ store, ownerId, counterpartIds = [], campaignToken, currentGameDate,
  currentTotalDays, memories = [], tokenBudget = 0, recentSummary = null,
  estimateTokens = text => Math.ceil(String(text).length / 2) } = {}) {
  if (!store?.pairLedger) return emptyPlayerLedger("INDEX_UNAVAILABLE");
  if (typeof campaignToken !== "string" || !campaignToken.trim()) return emptyPlayerLedger("CAMPAIGN_UNBOUND");
  if (!normalizeGameDate(currentGameDate)) return emptyPlayerLedger("CURRENT_DATE_REQUIRED");
  if (!Number.isSafeInteger(ownerId) || ownerId <= 0 || !Array.isArray(counterpartIds)
    || counterpartIds.length !== 1 || !Number.isSafeInteger(counterpartIds[0]) || counterpartIds[0] <= 0
    || counterpartIds[0] === ownerId) return emptyPlayerLedger("IDENTITY_UNRESOLVED");

  const counterpartId = counterpartIds[0];
  const scope = { campaignToken, ownerId, counterpartId };
  const started = performance.now();
  let read;
  try {
    read = store.pairLedger.read(scope, { currentGameDate, currentTotalDays, memories, readOnly: true });
  } catch (error) {
    const code = String(error?.message || "");
    const status = /CAMPAIGN/u.test(code) ? "CAMPAIGN_UNBOUND"
      : /SOURCE_STALE|SOURCE_UNSTABLE|FORGET/u.test(code) ? "SOURCE_STALE" : "INDEX_UNAVAILABLE";
    return emptyPlayerLedger(status, { indexLookupMs: performance.now() - started });
  }
  const indexLookupMs = performance.now() - started;
  if (!Array.isArray(read?.items) || typeof read.sourceRevision !== "string" || !read.sourceRevision) {
    return emptyPlayerLedger(read?.diagnostics?.currentDateRequired ? "CURRENT_DATE_REQUIRED" : "INDEX_UNAVAILABLE",
      { indexLookupMs });
  }

  const visibleItems = read.items.filter(item => isRetrievablePairLedgerItem(item)
    && typeof item.itemId === "string" && typeof item.text === "string" && item.text.trim());
  // Parse the actual rendered (possibly truncated) Recent copy with the same
  // boundaries as the index. A substring is not proof of a complete matter.
  const renderedRecentItems = parseImportantMatters(recentSummary?.text).items;
  const orderedItems = visibleItems.map(item => {
    const verifiedRecent = recentSummary?.sources?.some(source =>
      source.sourceSummaryKey === item.source?.sourceSummaryKey && source.sourceRevision === item.source?.sourceRevision);
    const completeItem = renderedRecentItems.some(row => !row.ambiguous
      && row.ordinal === item.source?.sourceItemOrdinal && row.text === item.text);
    return verifiedRecent && completeItem
      ? { ...item, recentSummaryReference: true } : item;
  }).sort(compareLedgerItems);
  const budget = Math.max(0, Number(tokenBudget) || 0);
  let selected = [];
  try {
    selected = selectPlayerLedgerItems(orderedItems, budget, estimateTokens);
  } catch {
    return emptyPlayerLedger("INDEX_UNAVAILABLE", { indexLookupMs });
  }
  const text = formatPlayerLedgerBlock(selected);

  try {
    const verified = store.pairLedger.read(scope, { currentGameDate, currentTotalDays, readOnly: true });
    if (verified.sourceRevision !== read.sourceRevision) {
      return emptyPlayerLedger("SOURCE_STALE", { indexLookupMs, totalVisibleItems: orderedItems.length,
        omittedItems: orderedItems.length,
        scopeRevisions: [{ ownerId, counterpartId, revision: read.sourceRevision }] });
    }
  } catch {
    return emptyPlayerLedger("SOURCE_STALE", { indexLookupMs, totalVisibleItems: orderedItems.length,
      omittedItems: orderedItems.length,
      scopeRevisions: [{ ownerId, counterpartId, revision: read.sourceRevision }] });
  }

  const omittedItems = orderedItems.length - selected.length;
  const fallbackStatus = !orderedItems.length ? "INDEX_MISS" : omittedItems ? "BUDGET_OMITTED" : "INDEX_HIT_ITEMS";
  const finalInjectedTokens = text ? estimateTokens(text) : 0;
  const metrics = {
    indexLookupMs,
    candidateSummaryCount: read.sourceSummaries?.length || 0,
    totalVisibleItems: orderedItems.length,
    injectedItems: selected.length,
    recentSummaryReferencedItems: selected.filter(item => item.recentSummaryReference).length,
    omittedItems,
    omittedByBudget: omittedItems,
    orderDigest: stableOrderDigest(selected),
    scopeRevisions: [{ ownerId, counterpartId, revision: read.sourceRevision }],
    finalInjectedTokens,
    pairLedgerTokens: finalInjectedTokens,
    legacyFallbackUsed: false,
    fallbackReason: fallbackStatus,
    ledgerCacheHit: read.cacheHit === true
  };
  return { text, items: selected, sources: [], metrics, fallbackStatus, legacyFallbackEligible: false };
}

function normalizeAlias(value) {
  return String(value || "").normalize("NFKC").toLocaleLowerCase().replace(/\s+/gu, " ").trim();
}

function buildEntityProfileIndex(entitiesProfile = []) {
  const byId = new Map();
  const aliasOwners = new Map();
  if (!Array.isArray(entitiesProfile)) return { byId, aliasOwners };
  for (const row of entitiesProfile) {
    const characterId = Number(row?.characterId);
    if (!Number.isSafeInteger(characterId) || characterId <= 0) continue;
    const rawAliases = [row.name, ...(Array.isArray(row.aliases) ? row.aliases : [])]
      .filter(value => typeof value === "string" && value.trim());
    const existing = byId.get(characterId) || { characterId, name: "", aliases: new Set(), aliasLabels: new Map() };
    if (!existing.name && typeof row.name === "string" && row.name.trim()) existing.name = row.name.trim();
    for (const rawAlias of rawAliases) {
      const alias = normalizeAlias(rawAlias);
      if (!alias) continue;
      existing.aliases.add(alias);
      if (!existing.aliasLabels.has(alias)) existing.aliasLabels.set(alias, rawAlias.trim());
    }
    byId.set(characterId, existing);
  }
  for (const profile of byId.values()) {
    for (const alias of profile.aliases) {
      if (!aliasOwners.has(alias)) aliasOwners.set(alias, new Set());
      aliasOwners.get(alias).add(profile.characterId);
    }
  }
  for (const profile of byId.values()) {
    profile.uniqueAliases = [...profile.aliases].filter(alias => aliasOwners.get(alias)?.size === 1 && [...alias].length >= 2);
    const uniqueName = normalizeAlias(profile.name);
    profile.displayName = profile.uniqueAliases.includes(uniqueName) ? profile.name
      : profile.aliasLabels.get(profile.uniqueAliases[0]) || profile.name;
  }
  return { byId, aliasOwners };
}

function collectOwnerCounterpartIds(memories, ownerId, campaignToken, excludedIds = []) {
  const excluded = new Set([ownerId, ...excludedIds]);
  const ids = new Set();
  for (const memory of Array.isArray(memories) ? memories : []) {
    const provenance = memory?.provenance;
    if (Number(provenance?.folderOwnerId) !== ownerId || !Array.isArray(memory?.knownBy)
      || !memory.knownBy.map(Number).includes(ownerId)
      || String(provenance.campaignToken || "").trim() !== campaignToken) continue;
    for (const value of [provenance.counterpartId, ...(Array.isArray(provenance.counterpartIds) ? provenance.counterpartIds : [])]) {
      const counterpartId = Number(value);
      if (Number.isSafeInteger(counterpartId) && counterpartId > 0 && !excluded.has(counterpartId)) ids.add(counterpartId);
    }
  }
  return [...ids].sort((left, right) => left - right);
}

function thirdPersonQueryTerms(query, targetProfiles) {
  let lexical = String(query || "").normalize("NFKC").toLocaleLowerCase();
  for (const profile of targetProfiles) {
    for (const alias of profile.aliases) lexical = lexical.split(alias).join(" ");
  }
  lexical = lexical.replace(/你们|你|还记得|记得|以前|曾经|过去|历史|当年|当时|关系|相处|认识|具体|究竟|到底|什么|怎么|如何|为何|为什么|发生|事情|说过|后来|请问|能否|吗/gu, " ");
  const stop = new Set(["我们", "当时", "当年", "以前", "曾经", "过去", "历史", "什么", "怎么", "如何", "为何", "关系", "认识"]);
  return [...new Set(searchTerms(lexical).filter(term => !stop.has(term)))];
}

function scoreThirdPersonItem(item, terms) {
  if (!terms.length) return 0;
  const itemTerms = new Set(item.searchTerms || searchTerms(item.text));
  return terms.reduce((score, term) => score + (itemTerms.has(term) ? term.length >= 3 ? 3 : 1 : 0), 0);
}

function compareCandidatePriority(left, right) {
  return (left.scopeKind === "DIRECT_PAIR" ? 0 : 1) - (right.scopeKind === "DIRECT_PAIR" ? 0 : 1)
    || right.score - left.score
    || itemDateSerial(right.item) - itemDateSerial(left.item)
    || String(left.item?.source?.sourceSummaryKey || "").localeCompare(String(right.item?.source?.sourceSummaryKey || ""))
    || String(left.item?.itemId || "").localeCompare(String(right.item?.itemId || ""));
}

function spreadItemsByYear(rows, limit = rows.length) {
  const buckets = new Map();
  for (const row of rows) {
    const year = itemYear(row.item) ?? 0;
    if (!buckets.has(year)) buckets.set(year, []);
    buckets.get(year).push(row);
  }
  const sortedYears = [...buckets.keys()].sort((left, right) => right - left);
  const years = [];
  for (let first = 0, last = sortedYears.length - 1; first <= last; first++, last--) {
    years.push(sortedYears[first]);
    if (last !== first) years.push(sortedYears[last]);
  }
  for (const bucket of buckets.values()) bucket.sort((left, right) => itemDateSerial(right.item) - itemDateSerial(left.item)
    || compareCandidatePriority(left, right));
  const result = [];
  for (let round = 0; result.length < limit; round++) {
    let added = false;
    for (const year of years) {
      const row = buckets.get(year)[round];
      if (!row) continue;
      result.push(row);
      added = true;
      if (result.length >= limit) break;
    }
    if (!added) break;
  }
  return result;
}

function formatThirdPersonItem(candidate) {
  return `- ${candidate.item.conversationDate}（${evidenceLabel(candidate.item.interactionEvidence)}，当时记录）：${candidate.item.text}`;
}

function formatThirdPersonLedger(candidates, targetOrder, profiles) {
  const blocks = [];
  for (const targetId of targetOrder) {
    const rows = candidates.filter(candidate => candidate.targetCharacterId === targetId).sort((left, right) => compareLedgerItems(left.item, right.item));
    if (!rows.length) continue;
    const profile = profiles.byId.get(targetId);
    const label = profile?.displayName || profile?.name;
    blocks.push(`【${label}的历史事项；日期是谈话记录日期，承诺或转述不表示已履行】\n${rows.map(formatThirdPersonItem).join("\n")}`);
  }
  return blocks.join("\n\n");
}

function formatThirdPersonSource(source) {
  return `【经来源键与修订验证的历史摘要；谈话记录日期${source.summary.date || source.conversationDate}】\n${source.summary.content}`;
}

function decisionForThirdPersonRetrieval(decision, ownerId, mode) {
  if (!decision || decision.level === "L0") {
    const ambiguousReasons = new Set(["IDENTITY_AMBIGUOUS", "HISTORY_TARGET_UNRESOLVED", "FOLLOWUP_BINDING_EXPIRED"]);
    const status = ambiguousReasons.has(decision?.reasonCode) ? "IDENTITY_AMBIGUOUS" : "NOT_REQUESTED";
    return { ok: false, status, level: "L0" };
  }
  const targetIds = Array.isArray(decision.targetCharacterIds) ? decision.targetCharacterIds.map(Number) : [];
  const validTargets = targetIds.length > 0 && targetIds.every(id => Number.isSafeInteger(id) && id > 0
    && id !== ownerId && id !== Number(decision.playerAnchorId)) && new Set(targetIds).size === targetIds.length;
  const validLevel = decision.level === "L1" || decision.level === "L2";
  const validIntent = typeof decision.historyIntent === "string" && decision.historyIntent !== "NONE";
  const validEvidence = ["EXPLICIT_ID", "UNIQUE_ALIAS", "BOUND_FOLLOWUP"].includes(decision.targetEvidence);
  const detailConsistent = decision.level === "L2" ? decision.explicitSourceDetailRequested === true
    : decision.explicitSourceDetailRequested !== true;
  if (!validTargets || !validLevel || !validIntent || !validEvidence || decision.denialDetected === true
    || Number(decision.responderId) !== ownerId || !Number.isSafeInteger(Number(decision.playerAnchorId))
    || Number(decision.playerAnchorId) <= 0 || Number(decision.playerAnchorId) === ownerId || !detailConsistent
    || mode === "THIRD_PERSON_SOURCE_DETAIL" && decision.level !== "L2") {
    return { ok: false, status: "IDENTITY_AMBIGUOUS", level: "L0" };
  }
  return { ok: true, status: null, level: decision.level, targetIds };
}

function candidatePointer(candidate) {
  const pointer = candidate.item.source || {};
  if (!pointer.sourceSummaryKey || !pointer.sourceRevision || !pointer.sourceMemoryId) return null;
  return {
    ownerId: candidate.scope.ownerId,
    counterpartId: candidate.scope.counterpartId,
    targetCharacterId: candidate.targetCharacterId,
    sourceSummaryKey: pointer.sourceSummaryKey,
    sourceRevision: pointer.sourceRevision,
    sourceMemoryId: pointer.sourceMemoryId,
    conversationDate: candidate.item.conversationDate,
    finalizationId: pointer.finalizationId || null,
    itemId: candidate.item.itemId,
    scopeKind: candidate.scopeKind,
    aliasEvidence: candidate.aliasEvidence || null
  };
}

function sourceMemoryMatchesPointer(memory, pointer, campaignToken) {
  const provenance = memory?.provenance;
  const knownBy = Array.isArray(memory?.knownBy) ? memory.knownBy.map(Number) : [];
  const counterpartIds = [provenance?.counterpartId,
    ...(Array.isArray(provenance?.counterpartIds) ? provenance.counterpartIds : [])].map(Number);
  return memory?.memoryId === pointer.sourceMemoryId
    && Number(provenance?.folderOwnerId) === pointer.ownerId
    && knownBy.includes(pointer.ownerId)
    && String(provenance?.campaignToken || "").trim() === campaignToken
    && counterpartIds.includes(pointer.counterpartId);
}

function sourceContainsExactMatter(source, item) {
  const ordinal = Number(item?.source?.sourceItemOrdinal);
  if (!Number.isSafeInteger(ordinal) || ordinal <= 0) return false;
  const parsed = parseImportantMatters(source?.summary?.content);
  const exactMatter = parsed.items.find(matter => matter.ordinal === ordinal);
  return exactMatter?.ambiguous !== true && exactMatter?.text === item.text;
}

function formatThirdPersonEmpty(status, { level = "L0", metrics = {}, candidateSourcePointers = [],
  legacyFallbackEligible = null } = {}) {
  return {
    text: "",
    items: [],
    sources: [],
    metrics: {
      indexLookupMs: 0,
      sourceResolveMs: 0,
      candidatePairCount: 0,
      actualIndexReadCount: 0,
      indexCacheHits: 0,
      indexCacheMisses: 0,
      indexCacheHit: false,
      candidateSummaryCount: 0,
      openedSummaryCount: 0,
      totalVisibleItems: 0,
      injectedItems: 0,
      omittedItems: 0,
      omittedByBudget: 0,
      orderDigest: stableOrderDigest([]),
      scopeRevisions: [],
      finalInjectedTokens: 0,
      pairLedgerTokens: 0,
      sourceRecallTokens: 0,
      legacyFallbackUsed: false,
      fallbackReason: status,
      ...metrics
    },
    fallbackStatus: status,
    legacyFallbackEligible: typeof legacyFallbackEligible === "boolean" ? legacyFallbackEligible
      : level === "L2" && ["INDEX_MISS", "INDEX_UNAVAILABLE", "SOURCE_STALE"].includes(status),
    candidateSourcePointers,
    verifiedCandidatePointers: []
  };
}

function retrieveThirdPersonHistory({ mode = "THIRD_PERSON_LEDGER", store, ownerId, decision, entitiesProfile = [],
  campaignToken, currentGameDate, currentTotalDays, memories = [], query = "", excludedMemoryIds = [], tokenBudget = 0,
  estimateTokens = text => Math.ceil(String(text).length / 2) } = {}) {
  const route = decisionForThirdPersonRetrieval(decision, ownerId, mode);
  if (!route.ok) return formatThirdPersonEmpty(route.status);
  const level = route.level;
  if (!store?.pairLedger) return formatThirdPersonEmpty("INDEX_UNAVAILABLE", { level });
  if (typeof campaignToken !== "string" || !campaignToken.trim()) return formatThirdPersonEmpty("CAMPAIGN_UNBOUND", { level });
  if (!normalizeGameDate(currentGameDate)) return formatThirdPersonEmpty("CURRENT_DATE_REQUIRED", { level });

  const profiles = buildEntityProfileIndex(entitiesProfile);
  const targetProfiles = route.targetIds.map(id => profiles.byId.get(id));
  if (targetProfiles.some(profile => !profile || !profile.displayName)) return formatThirdPersonEmpty("IDENTITY_AMBIGUOUS", { level });
  if (decision.targetEvidence === "UNIQUE_ALIAS" && targetProfiles.some(profile => !profile.uniqueAliases.length)) {
    return formatThirdPersonEmpty("IDENTITY_AMBIGUOUS", { level });
  }

  const terms = thirdPersonQueryTerms(query, targetProfiles);
  const otherIds = collectOwnerCounterpartIds(memories, ownerId, campaignToken, route.targetIds);
  const scopes = [...route.targetIds.map(counterpartId => ({ counterpartId, scopeKind: "DIRECT_PAIR" })),
    ...otherIds.map(counterpartId => ({ counterpartId, scopeKind: "CROSS_PAIR" }))];
  const candidatePairCount = scopes.length;
  const candidatesByTarget = new Map(route.targetIds.map(id => [id, new Map()]));
  const scopeRevisions = [];
  let indexLookupMs = 0;
  let candidateSummaryCount = 0;
  let actualIndexReadCount = 0;
  let indexCacheHits = 0;
  let indexCacheMisses = 0;
  let indexCacheOutcomeUnknown = false;
  const readIndex = (scope, options) => {
    actualIndexReadCount++;
    try {
      const result = store.pairLedger.read(scope, options);
      if (result?.cacheHit === true) indexCacheHits++;
      else indexCacheMisses++;
      return result;
    } catch (error) {
      indexCacheOutcomeUnknown = true;
      throw error;
    }
  };
  const indexReadMetrics = () => ({ candidatePairCount, actualIndexReadCount, indexCacheHits, indexCacheMisses,
    // True only when every explicit PairLedger.read call in this retrieval hit its scope cache.
    indexCacheHit: actualIndexReadCount > 0 && !indexCacheOutcomeUnknown && indexCacheMisses === 0 });
  const lookupStart = performance.now();
  for (const { counterpartId, scopeKind } of scopes) {
    const scope = { campaignToken, ownerId, counterpartId };
    let read;
    try {
      read = readIndex(scope, { currentGameDate, currentTotalDays, memories, readOnly: true });
    } catch (error) {
      const code = String(error?.code || error?.message || "");
      const identityConflict = /IDENTITY/u.test(code);
      const forgetConflict = /FORGET/u.test(code);
      const status = /CAMPAIGN/u.test(code) ? "CAMPAIGN_UNBOUND"
        : identityConflict ? "IDENTITY_AMBIGUOUS"
          : /SOURCE_STALE|SOURCE_UNSTABLE|SOURCE_UNAVAILABLE|FORGET/u.test(code) ? "SOURCE_STALE" : "INDEX_UNAVAILABLE";
      return formatThirdPersonEmpty(status, { level, legacyFallbackEligible: !identityConflict && !forgetConflict
        && level === "L2" && ["SOURCE_STALE", "INDEX_UNAVAILABLE"].includes(status),
        metrics: { ...indexReadMetrics(), indexLookupMs: performance.now() - lookupStart } });
    }
    if (!Array.isArray(read?.items) || typeof read.sourceRevision !== "string" || !read.sourceRevision) {
      return formatThirdPersonEmpty(read?.diagnostics?.currentDateRequired ? "CURRENT_DATE_REQUIRED" : "INDEX_UNAVAILABLE",
        { level, metrics: { ...indexReadMetrics(), indexLookupMs: performance.now() - lookupStart } });
    }
    scopeRevisions.push({ ownerId, counterpartId, revision: read.sourceRevision });
    candidateSummaryCount += read.sourceSummaries?.length || 0;
    for (const item of read.items) {
      if (!isRetrievablePairLedgerItem(item) || typeof item.text !== "string" || !item.text.trim()) continue;
      const score = scoreThirdPersonItem(item, terms);
      if (terms.length && score === 0) continue;
      const matchedTargets = scopeKind === "DIRECT_PAIR" ? [counterpartId] : route.targetIds.filter(targetId => {
        const profile = profiles.byId.get(targetId);
        const text = normalizeAlias(item.text);
        return profile.uniqueAliases.some(alias => text.includes(alias));
      });
      for (const targetCharacterId of matchedTargets) {
        const row = {
          item, score, targetCharacterId, scope,
          scopeKind,
          aliasEvidence: scopeKind === "CROSS_PAIR" ? "UNIQUE_ALIAS" : null
        };
        candidatesByTarget.get(targetCharacterId).set(`${counterpartId}|${item.itemId}`, row);
      }
    }
  }
  indexLookupMs = performance.now() - lookupStart;

  const perTarget = new Map();
  let totalRelevantItems = 0;
  let omittedByTargetLimit = 0;
  for (const targetId of route.targetIds) {
    const rows = [...candidatesByTarget.get(targetId).values()];
    totalRelevantItems += rows.length;
    const direct = rows.filter(row => row.scopeKind === "DIRECT_PAIR");
    const cross = rows.filter(row => row.scopeKind === "CROSS_PAIR");
    const orderRows = group => terms.length
      ? group.sort(compareCandidatePriority)
      : spreadItemsByYear(group);
    const ordered = [...orderRows(direct), ...orderRows(cross)];
    perTarget.set(targetId, ordered.slice(0, 16));
    omittedByTargetLimit += Math.max(0, ordered.length - 16);
  }
  const limitedCandidates = [...perTarget.values()].flat();
  const candidateMap = new Map();
  for (const candidate of limitedCandidates) {
    const pointer = candidatePointer(candidate);
    if (!pointer) continue;
    const key = JSON.stringify([pointer.ownerId, pointer.counterpartId, pointer.sourceSummaryKey, pointer.sourceRevision]);
    if (!candidateMap.has(key)) candidateMap.set(key, { candidate, pointer });
  }
  const candidateSourcePointers = [...candidateMap.values()].map(row => row.pointer);
  if (!totalRelevantItems) {
    return formatThirdPersonEmpty("INDEX_MISS", { level, candidateSourcePointers,
      metrics: { ...indexReadMetrics(), indexLookupMs, candidateSummaryCount, totalVisibleItems: 0, scopeRevisions } });
  }

  const excluded = new Set(excludedMemoryIds.map(String));
  const resolvedSources = [];
  const verifiedCandidatePointers = [];
  const staleSourceKeys = new Set();
  let fatalSourceStatus = null;
  let sourceResolveMs = 0;
  let sourceResolveAttemptCount = 0;
  if (level === "L2") {
    const resolveStart = performance.now();
    for (const row of candidateMap.values()) {
      if (sourceResolveAttemptCount >= 2 || resolvedSources.length >= 2) break;
      const { candidate, pointer } = row;
      if (excluded.has(String(pointer.sourceMemoryId))) continue;
      sourceResolveAttemptCount++;
      try {
        const resolved = store.pairLedger.resolveSource(candidate.scope, {
          sourceSummaryKey: pointer.sourceSummaryKey,
          sourceRevision: pointer.sourceRevision
        }, { currentGameDate, currentTotalDays, memories, readOnly: true });
        const base = memories.find(memory => sourceMemoryMatchesPointer(memory, pointer, campaignToken));
        if (resolved.success !== true || typeof resolved.summary?.content !== "string" || !base) {
          throw new Error("SOURCE_UNAVAILABLE_OR_STALE");
        }
        const source = { ...pointer, summary: resolved.summary, base, candidate };
        resolvedSources.push(source);
        verifiedCandidatePointers.push({ ...pointer, verified: true });
      } catch (error) {
        const code = String(error?.code || error?.message || "");
        if (/IDENTITY|FORGET/u.test(code)) {
          fatalSourceStatus = /IDENTITY/u.test(code) ? "IDENTITY_AMBIGUOUS" : "SOURCE_STALE";
          break;
        }
        staleSourceKeys.add(pointer.sourceSummaryKey);
      }
    }
    sourceResolveMs = performance.now() - resolveStart;
  }
  if (fatalSourceStatus) {
    return formatThirdPersonEmpty(fatalSourceStatus, { level, legacyFallbackEligible: false,
      candidateSourcePointers,
      metrics: { ...indexReadMetrics(), indexLookupMs, sourceResolveMs, sourceResolveAttemptCount, candidateSummaryCount,
        totalVisibleItems: totalRelevantItems, scopeRevisions } });
  }

  const sourceText = [];
  const includedSources = [];
  let sourceBudgetOmittedCount = 0;
  const preferredCandidates = route.targetIds.flatMap(id => perTarget.get(id));
  const firstCandidate = preferredCandidates.find(candidate => !staleSourceKeys.has(candidate.item.source?.sourceSummaryKey));
  for (const source of resolvedSources) {
    const nextText = [...sourceText, formatThirdPersonSource(source)].join("\n\n");
    const trialLedger = firstCandidate
      ? formatThirdPersonLedger([firstCandidate], route.targetIds, profiles) : "";
    if (estimateTokens([nextText, trialLedger].filter(Boolean).join("\n\n")) > Math.max(0, Number(tokenBudget) || 0)) {
      sourceBudgetOmittedCount++;
      continue;
    }
    sourceText.push(formatThirdPersonSource(source));
    includedSources.push({
      memory: { ...source.base, content: source.summary.content },
      tokens: estimateTokens(formatThirdPersonSource(source)),
      routeKind: "third_person_source",
      routeCharacterIds: [source.targetCharacterId],
      targetCharacterId: source.targetCharacterId,
      sourceScopeCharacterId: source.counterpartId,
      sourceSummaryKey: source.sourceSummaryKey,
      sourceRevision: source.sourceRevision
    });
  }

  const selectedByTarget = new Map(route.targetIds.map(id => [id, []]));
  const cursors = new Map(route.targetIds.map(id => [id, 0]));
  let hasRemaining = true;
  while (hasRemaining) {
    hasRemaining = false;
    for (const targetId of route.targetIds) {
      const candidates = perTarget.get(targetId);
      const index = cursors.get(targetId);
      if (index >= candidates.length) continue;
      hasRemaining = true;
      cursors.set(targetId, index + 1);
      const candidate = candidates[index];
      if (staleSourceKeys.has(candidate.item.source?.sourceSummaryKey)) continue;
      const trial = [...selectedByTarget.get(targetId), candidate];
      const flat = route.targetIds.flatMap(id => id === targetId ? trial : selectedByTarget.get(id));
      const ledgerText = formatThirdPersonLedger(flat, route.targetIds, profiles);
      if (estimateTokens([ledgerText, sourceText.join("\n\n")].filter(Boolean).join("\n\n")) <= Math.max(0, Number(tokenBudget) || 0)) {
        selectedByTarget.set(targetId, trial);
      }
    }
  }

  const selected = route.targetIds.flatMap(id => selectedByTarget.get(id));
  const selectedSourceMatterKeys = new Set();
  const includedSourcePointers = new Set(includedSources.map(source => `${source.sourceSummaryKey}|${source.sourceRevision}`));
  let duplicateIncludedCount = 0;
  for (const candidate of selected) {
    const source = resolvedSources.find(entry => entry.sourceSummaryKey === candidate.item.source?.sourceSummaryKey
      && entry.sourceRevision === candidate.item.source?.sourceRevision
      && includedSourcePointers.has(`${entry.sourceSummaryKey}|${entry.sourceRevision}`));
    if (source && sourceContainsExactMatter(source, candidate.item)) {
      selectedSourceMatterKeys.add(`${candidate.targetCharacterId}|${candidate.scope.counterpartId}|${candidate.item.itemId}`);
      duplicateIncludedCount++;
    }
  }
  const items = selected.filter(candidate => !selectedSourceMatterKeys.has(
    `${candidate.targetCharacterId}|${candidate.scope.counterpartId}|${candidate.item.itemId}`))
    .map(candidate => ({ ...candidate.item, targetCharacterId: candidate.targetCharacterId,
      targetName: profiles.byId.get(candidate.targetCharacterId)?.displayName,
      routeKind: candidate.scopeKind === "DIRECT_PAIR" ? "third_direct_pair" : "third_cross_pair",
      aliasEvidence: candidate.aliasEvidence }));
  const ledgerText = formatThirdPersonLedger(selected.filter(candidate => !selectedSourceMatterKeys.has(
    `${candidate.targetCharacterId}|${candidate.scope.counterpartId}|${candidate.item.itemId}`)), route.targetIds, profiles);

  let revisionChanged = false;
  let revisionFailureStatus = null;
  let revisionFallbackAllowed = true;
  for (const entry of scopeRevisions) {
    try {
      const verified = readIndex({ campaignToken, ownerId: entry.ownerId, counterpartId: entry.counterpartId },
        { currentGameDate, currentTotalDays, readOnly: true });
      if (verified.sourceRevision !== entry.revision) revisionChanged = true;
    } catch (error) {
      revisionChanged = true;
      const code = String(error?.code || error?.message || "");
      revisionFailureStatus = /FORGET/u.test(code) ? "SOURCE_STALE"
        : /IDENTITY/u.test(code) ? "IDENTITY_AMBIGUOUS"
          : /CAMPAIGN/u.test(code) ? "CAMPAIGN_UNBOUND"
            : /SOURCE_STALE|SOURCE_UNSTABLE|SOURCE_UNAVAILABLE/u.test(code) ? "SOURCE_STALE" : "INDEX_UNAVAILABLE";
      if (/FORGET|IDENTITY|CAMPAIGN/u.test(code)) revisionFallbackAllowed = false;
    }
  }
  if (revisionChanged) {
    const status = revisionFailureStatus || "SOURCE_STALE";
    const fallbackAllowed = revisionFallbackAllowed && level === "L2"
      && ["SOURCE_STALE", "INDEX_UNAVAILABLE"].includes(status);
    return formatThirdPersonEmpty(status, { level, legacyFallbackEligible: fallbackAllowed,
      metrics: { ...indexReadMetrics(), indexLookupMs, sourceResolveMs, sourceResolveAttemptCount, totalVisibleItems: totalRelevantItems,
        omittedItems: totalRelevantItems, omittedByTargetLimit, candidateSummaryCount, scopeRevisions } });
  }

  const text = [ledgerText, sourceText.join("\n\n")].filter(Boolean).join("\n\n");
  const finalInjectedTokens = text ? estimateTokens(text) : 0;
  const omittedItems = Math.max(0, totalRelevantItems - items.length - duplicateIncludedCount);
  const omittedByBudget = Math.max(0, limitedCandidates.length - selected.length);
  const hasStaleSource = staleSourceKeys.size > 0;
  const fallbackStatus = hasStaleSource ? "SOURCE_STALE"
    : includedSources.length ? "INDEX_HIT_SOURCE"
      : omittedByBudget || sourceBudgetOmittedCount ? "BUDGET_OMITTED" : "INDEX_HIT_ITEMS";
  const metrics = {
    indexLookupMs,
    sourceResolveMs,
    ...indexReadMetrics(),
    sourceResolveAttemptCount,
    candidateSummaryCount,
    openedSummaryCount: resolvedSources.length,
    indexHitCount: totalRelevantItems,
    sourceKeyValidationFailedCount: staleSourceKeys.size,
    totalVisibleItems: totalRelevantItems,
    injectedItems: items.length,
    omittedItems,
    omittedByBudget,
    sourceBudgetOmittedCount,
    omittedByTargetLimit,
    duplicateIncludedCount,
    orderDigest: stableOrderDigest(items),
    scopeRevisions,
    finalInjectedTokens,
    pairLedgerTokens: ledgerText ? estimateTokens(ledgerText) : 0,
    sourceRecallTokens: sourceText.length ? estimateTokens(sourceText.join("\n\n")) : 0,
    legacyFallbackUsed: false,
    fallbackReason: fallbackStatus
  };
  return {
    text,
    items,
    sources: includedSources,
    metrics,
    fallbackStatus,
    legacyFallbackEligible: level === "L2" && ["INDEX_MISS", "SOURCE_STALE"].includes(fallbackStatus),
    candidateSourcePointers,
    verifiedCandidatePointers
  };
}

function retrieveLegacyPairMemorySources({ store, ownerId, counterpartIds = [], query = "", campaignToken,
  currentGameDate, currentTotalDays, memories = [], excludedMemoryIds = [], tokenBudget = 0,
  estimateTokens = text => Math.ceil(String(text).length / 2) }) {
  const metrics = { indexLookupMs: 0, sourceResolveMs: 0, candidateSummaryCount: 0, openedSummaryCount: 0,
    legacyFallbackUsed: true, indexHitCount: 0, sourceKeyValidationFailedCount: 0, finalInjectedTokens: 0,
    pairLedgerTokens: 0, sourceRecallTokens: 0, ledgerCacheHit: false, fallbackReason: "INDEX_MISS" };
  const empty = { text: "", items: [], sources: [], metrics };
  if (!store.pairLedger || !campaignToken || !Number.isSafeInteger(ownerId) || !tokenBudget || !normalizeGameDate(currentGameDate)) return empty;
  const lookupStart = performance.now();
  const lexicalQuery = query.replace(/你还记得|还记得|记得|当年|当时|具体|什么|怎么|如何|为何|我们|事情|说过|后来|请问|能否/g, " ");
  const terms = new Set(searchTerms(lexicalQuery));
  const years = [...query.matchAll(/(\d{3,6})年/g)].map(match => Number(match[1]));
  const candidates = [];
  const revisions = [];
  const scopeRevisions = [];
  const excluded = new Set(excludedMemoryIds.map(String));
  for (const counterpartId of [...new Set(counterpartIds)]) {
    const scope = { campaignToken, ownerId, counterpartId };
    try {
      const index = store.pairLedger.read(scope, { currentGameDate, currentTotalDays, memories, readOnly: true });
      metrics.ledgerCacheHit ||= index.cacheHit === true;
      revisions.push(index.sourceRevision);
      scopeRevisions.push({ scope, revision: index.sourceRevision });
      for (const item of index.items) {
        if (excluded.has(String(item.sourceMemoryId || item.source?.sourceMemoryId))) continue;
        const itemTerms = new Set(item.searchTerms || searchTerms(item.text));
        const hits = [...terms].filter(term => itemTerms.has(term));
        const year = Number(String(item.conversationDate || "").split(/[.\-/年]/)[0]);
        const dateMatch = years.length && years.includes(year);
        const score = hits.reduce((sum, term) => sum + (term.length >= 3 ? 3 : 1), 0) + (dateMatch ? 8 : 0);
        if (!score || years.length && !dateMatch) continue;
        candidates.push({ item, scope, score });
      }
    } catch (error) { metrics.fallbackReason = error.message || "INDEX_UNAVAILABLE"; }
  }
  metrics.indexLookupMs = performance.now() - lookupStart;
  metrics.legacySourceVersion = revisions;
  candidates.sort((left, right) => right.score - left.score
    || String(right.item.conversationDate).localeCompare(String(left.item.conversationDate))
    || left.item.itemId.localeCompare(right.item.itemId));
  const selected = candidates.slice(0, 12);
  metrics.indexHitCount = selected.length;
  if (!selected.length) return empty;
  metrics.fallbackReason = null;
  const needDetails = /记得|回忆|当年|当时|具体|为何|怎么|如何|经过|曾经|约定|\d{3,6}年/.test(query);
  const uniqueSources = new Map();
  for (const candidate of selected) {
    const source = candidate.item.source || candidate.item;
    const key = source.sourceSummaryKey || candidate.item.sourceSummaryKey;
    if (key && !uniqueSources.has(key)) uniqueSources.set(key, candidate);
  }
  metrics.candidateSummaryCount = Math.min(4, uniqueSources.size);
  const sources = [];
  const staleSourceKeys = new Set();
  const openedMemoryIds = new Set();
  let sourceText = "";
  if (needDetails) {
    const resolveStart = performance.now();
    for (const candidate of [...uniqueSources.values()].slice(0, 4)) {
      if (sources.length >= 2) break;
      const item = candidate.item, pointer = item.source || item;
      try {
        const resolved = store.pairLedger.resolveSource(candidate.scope, {
          sourceSummaryKey: pointer.sourceSummaryKey || item.sourceSummaryKey,
          sourceRevision: pointer.sourceRevision || item.sourceRevision
        }, { currentGameDate, currentTotalDays, memories, readOnly: true });
        if (resolved.success !== true || typeof resolved.summary?.content !== "string") throw new Error("SOURCE_UNAVAILABLE_OR_STALE");
        const memoryId = item.sourceMemoryId || pointer.sourceMemoryId;
        if (excluded.has(String(memoryId)) || openedMemoryIds.has(String(memoryId))) continue;
        const block = `【经来源核验的历史摘要；对话日期${resolved.summary.date || item.conversationDate}】\n${resolved.summary.content}`;
        if (estimateTokens([sourceText, block].filter(Boolean).join("\n\n")) > tokenBudget * 0.7) continue;
        const base = memories.find(memory => memory.memoryId === memoryId);
        if (!base) throw new Error("SOURCE_UNAVAILABLE_OR_STALE");
        sourceText = [sourceText, block].filter(Boolean).join("\n\n");
        sources.push({ memory: { ...base, content: resolved.summary.content }, tokens: estimateTokens(block),
          routeKind: "pair_source", routeCharacterIds: [candidate.scope.counterpartId], sourceSummaryKey: pointer.sourceSummaryKey || item.sourceSummaryKey });
        openedMemoryIds.add(String(memoryId));
      } catch {
        staleSourceKeys.add(pointer.sourceSummaryKey || item.sourceSummaryKey);
        metrics.sourceKeyValidationFailedCount++; metrics.fallbackReason = "SOURCE_STALE";
      }
    }
    metrics.sourceResolveMs = performance.now() - resolveStart;
  }
  metrics.openedSummaryCount = sources.length;
  const itemLines = [];
  const items = [];
  for (const candidate of selected) {
    const item = candidate.item;
    if (staleSourceKeys.has(item.source?.sourceSummaryKey || item.sourceSummaryKey)) continue;
    if (openedMemoryIds.has(String(item.sourceMemoryId || item.source?.sourceMemoryId))) continue;
    const evidence = { DIRECT_PAIR: "直接交流", GROUP_WITNESSED: "共同见证", UNDETERMINED: "交谈方式未确定" }[item.interactionEvidence] || "交谈方式未确定";
    const line = `- ${item.conversationDate}（${evidence}，所述为当时记录而非当前事实）：${item.text}`;
    const candidateText = [sourceText, `【当前关系的长期事项原文索引】\n${[...itemLines, line].join("\n")}`].filter(Boolean).join("\n\n");
    if (estimateTokens(candidateText) > tokenBudget) continue;
    itemLines.push(line);
    items.push(item);
  }
  const itemText = itemLines.length ? `【当前关系的长期事项原文索引】\n${itemLines.join("\n")}` : "";
  for (const entry of scopeRevisions) {
    try {
      const verified = store.pairLedger.read(entry.scope, { currentGameDate, currentTotalDays, readOnly: true });
      if (verified.sourceRevision === entry.revision) continue;
    } catch { /* Derived-index failure must leave Legacy fallback available. */ }
      metrics.fallbackReason = "SOURCE_STALE";
      metrics.sourceKeyValidationFailedCount++;
      return empty;
  }
  const text = [itemText, sourceText].filter(Boolean).join("\n\n");
  metrics.pairLedgerTokens = itemText ? estimateTokens(itemText) : 0;
  metrics.sourceRecallTokens = sourceText ? estimateTokens(sourceText) : 0;
  metrics.finalInjectedTokens = text ? estimateTokens(text) : 0;
  metrics.legacyFallbackUsed = !sources.length;
  return { text, items, sources, metrics };
}

function retrievePairMemorySources(options = {}) {
  if (options.mode === "PLAYER_BASELINE_LEDGER") return retrievePlayerBaselineLedger(options);
  if (["THIRD_PERSON_LEDGER", "THIRD_PERSON_SOURCE_DETAIL"].includes(options.mode)) {
    return retrieveThirdPersonHistory(options);
  }
  return retrieveLegacyPairMemorySources(options);
}

module.exports = { retrievePairMemorySources };
