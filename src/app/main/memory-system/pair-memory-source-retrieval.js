"use strict";

const { performance } = require("perf_hooks");
const { searchTerms } = require("../../shared/pair-important-matters");
const { normalizeGameDate } = require("../worldline/character-temporal-facts");

function retrievePairMemorySources({ store, ownerId, counterpartIds = [], query = "", campaignToken,
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

module.exports = { retrievePairMemorySources };
