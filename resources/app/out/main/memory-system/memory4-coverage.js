"use strict";

const { assertScope, hash, ids, strings, legacySourceHash } = require("./memory4-contract");
const { validCoverageProof } = require("./memory4-evidence-planner");
const { memory4SourceValid } = require("./memory4-source-validity");
const { createProjectionLineage, projectionLineageFromSummary } = require("./memory4-forget");

const MAX_COVERAGE_PAGE = 40;
const MAX_COVERAGE_FACTS = 512;
const FINALIZATION_STATUSES = new Set(["STORE", "NO_DURABLE_CONTENT", "NOT_PRESENT"]);

function finalizationIdOf(memory) {
  return memory?.finalizationId || memory?.provenance?.finalizationId || null;
}

function perspectiveIds(memory) {
  return strings(memory?.perspectiveMemoryIds || memory?.provenance?.perspectiveMemoryIds);
}

function legacySourceIdentity(memory) {
  const provenance = memory?.provenance || {};
  return {
    messageIds: [...new Set([...(memory?.sourceMessageIds || []), ...(provenance.sourceMessageIds || []),
      ...(provenance.messageIds || [])]
      .filter(id => Number.isSafeInteger(id) && id >= 0))].sort((a, b) => a - b),
    segmentIds: strings([...(memory?.sourceSegmentIds || []), ...(memory?.perspectiveSummarySegmentIds || []),
      ...(provenance.sourceSegmentIds || []), ...(provenance.segmentIds || []),
      ...(provenance.perspectiveSummarySegmentIds || [])]),
    lineages: [...(memory?.projectionLineages || []), ...(provenance.projectionLineages || [])]
  };
}

function verifiedLegacyLineages(scope, legacyMemories, store, getLegacyFacts) {
  const result = new Map();
  for (const memory of legacyMemories) {
    if (!authorizedLegacy(memory, scope)) continue;
    const relatedIds = new Set([memory.memoryId, ...perspectiveIds(memory)]);
    const declaredIds = perspectiveIds(memory);
    const facts = declaredIds.length && declaredIds.length <= MAX_COVERAGE_FACTS && typeof getLegacyFacts === "function"
      ? getLegacyFacts(scope, memory).filter(fact => declaredIds.includes(String(fact?.memoryId))) : [];
    const finalizationId = finalizationIdOf(memory);
    const stored = memory.provenance?.projectionLineages;
    let candidates = Array.isArray(stored) ? stored : [];
    if (!candidates.length) {
      const fallback = projectionLineageFromSummary(memory, { ownerId: scope.ownerId,
        counterpartId: memory.provenance?.counterpartId, legacyMemoryIds: [...relatedIds] });
      if (fallback) candidates = [fallback];
    }
    for (const candidate of candidates) {
      let lineage;
      try {
        if (candidate?.campaignToken !== scope.campaignToken || Number(candidate?.ownerId) !== scope.ownerId) continue;
        if (!finalizationId || candidate.finalizationId !== finalizationId) continue;
        lineage = createProjectionLineage(candidate);
      } catch { /* Invalid or cross-scope lineage cannot establish a source link. */ }
      if (!lineage || !lineage.legacyMemoryIds.some(id => relatedIds.has(id))) continue;
      const factBacked = facts.some(fact => {
        if (!lineage.legacyMemoryIds.includes(String(fact.memoryId))) return false;
        const identity = legacySourceIdentity(fact);
        return identity.messageIds.some(id => lineage.sourceMessageIds?.includes(id))
          || identity.segmentIds.some(id => lineage.sourceSegmentIds?.includes(id));
      });
      if (!factBacked) continue;
      if (store.isProjectionLineageForgotten(scope, lineage)) continue;
      result.set(lineage.projectionId, lineage);
    }
  }
  return [...result.values()];
}

function sourceIntersects(legacy, entry, verifiedLineages) {
  const source = entry?.source || {};
  const identity = legacySourceIdentity(legacy);
  const messageIds = new Set(source.messageIds || []);
  const segmentIds = new Set([...(source.segmentIds || []), ...(source.fragmentIds || [])].map(String));
  return verifiedLineages.some(lineage => {
    const lineageMessages = new Set(lineage.sourceMessageIds || []);
    const lineageSegments = new Set((lineage.sourceSegmentIds || []).map(String));
    return identity.messageIds.some(id => messageIds.has(id) && lineageMessages.has(id))
      || identity.segmentIds.some(id => segmentIds.has(id) && lineageSegments.has(id));
  });
}

function authorizedLegacy(memory, scope) {
  return !!memory && memory.deleted !== true && memory.provenance?.campaignToken === scope.campaignToken
    && Number(memory.provenance?.folderOwnerId) === scope.ownerId
    && ids(memory.knownBy).includes(scope.ownerId);
}

function readValidEntries({ scope, finalizationId, index, metadata, store, baseStore }) {
  const record = index.finalizations[hash(finalizationId)];
  if (!record || record.status !== "STORE" || !Array.isArray(record.entryIds)) return { entries: [], invalid: 0, forgotten: 0, revoked: 0 };
  if (record.entryIds.length > 8 || new Set(record.entryIds).size !== record.entryIds.length) {
    return { entries: [], invalid: 1, forgotten: 0, revoked: 0 };
  }
  const result = { entries: [], invalid: 0, forgotten: 0, revoked: 0 };
  for (const entryId of record.entryIds) {
    const row = index.entries?.[entryId];
    if (!row || row.finalizationId !== finalizationId || !ids(row.knownBy).includes(scope.ownerId)) { result.invalid++; continue; }
    if (row.deleted) { result.revoked++; continue; }
    try {
      if (store.isEntryForgotten(scope, row)) { result.forgotten++; continue; }
      if (!memory4SourceValid({ store, baseStore, scope, row, index, metadata })) { result.invalid++; continue; }
      const entry = store.readEntry(scope, entryId, index);
      if (!entry || entry.deleted || entry.ownerId !== scope.ownerId || entry.campaignToken !== scope.campaignToken
        || !ids(entry.evidence?.knownBy).includes(scope.ownerId) || entry.source?.finalizationId !== finalizationId
        || entry.source?.conversationId !== row.conversationId) { result.invalid++; continue; }
      result.entries.push({ entryId, row, entry, record });
    } catch {
      if (store.isEntryForgotten(scope, row)) result.forgotten++;
      else result.invalid++;
    }
  }
  return result;
}

function finalizationSourceRevisionCurrent({ scope, finalizationId, index, metadata }) {
  const record = index.finalizations?.[hash(finalizationId)];
  if (!record || !/^[a-f0-9]{64}$/.test(record.sourceRevision || "")) return false;
  const proof = record.coverageProof;
  if (proof && (proof.ownerId !== scope.ownerId || proof.campaignToken !== scope.campaignToken || proof.finalizationId !== finalizationId)) return false;
  const rows = Object.values(index.entries || {}).filter(item => item.finalizationId === finalizationId);
  const conversationIds = new Set(rows.map(item => item.conversationId).filter(value => typeof value === "string" && value));
  const conversationId = proof?.conversationId || (conversationIds.size === 1 ? [...conversationIds][0] : null);
  return typeof conversationId === "string"
    && (!proof?.conversationId || !conversationIds.size || conversationIds.size === 1 && conversationIds.has(conversationId))
    && metadata?.knownEvidenceRevisions?.[hash([conversationId, scope.ownerId])] === record.sourceRevision;
}

function finalizationSnapshot({ scope, finalizationId, index, metadata, store, baseStore, cache }) {
  if (cache?.has(finalizationId)) return cache.get(finalizationId);
  const snapshot = {
    record: index.finalizations?.[hash(finalizationId)],
    sourceRevisionCurrent: finalizationSourceRevisionCurrent({ scope, finalizationId, index, metadata }),
    entryState: readValidEntries({ scope, finalizationId, index, metadata, store, baseStore })
  };
  cache?.set(finalizationId, snapshot);
  return snapshot;
}

function finalizationData({ scope, finalizationId, index, metadata, store, baseStore, cache }) {
  if (typeof finalizationId !== "string" || !finalizationId.trim()) return null;
  const record = index.finalizations?.[hash(finalizationId)];
  if (!record || !FINALIZATION_STATUSES.has(record.status) || !/^[a-f0-9]{64}$/.test(record.sourceRevision || "")) {
    return { finalizationId, durable: { commitState: "UNKNOWN", coverageState: "UNVERIFIED_LEGACY",
      committed: null, sourceCounts: null, sourceCountPrecision: "UNKNOWN" } };
  }
  const snapshot = finalizationSnapshot({ scope, finalizationId, index, metadata, store, baseStore, cache });
  const entryState = snapshot.entryState;
  const entries = entryState.entries;
  const proof = record.coverageProof;
  const proofScopeValid = !proof || (proof.ownerId === scope.ownerId && proof.campaignToken === scope.campaignToken
    && proof.finalizationId === finalizationId);
  const sourceRevisionCurrent = snapshot.sourceRevisionCurrent;
  const proofValid = proofScopeValid && sourceRevisionCurrent && validCoverageProof(proof, record);
  const historicalCapped = record.extractionPolicyVersion === "9.3.2" && record.extractionCoverage === "CAPPED"
    && Number.isSafeInteger(record.evaluatedFragmentCount) && record.evaluatedFragmentCount > 0
    && Array.isArray(record.entryIds) && record.entryIds.length === 8 && sourceRevisionCurrent;
  const entriesCurrent = entryState.invalid === 0 && entryState.forgotten === 0 && entryState.revoked === 0
    && entries.length === (record.entryIds || []).length;
  const coverageState = !sourceRevisionCurrent || !proofValid && !historicalCapped || !entriesCurrent
    ? "UNVERIFIED_LEGACY" : proofValid ? proof.coverageState : historicalCapped ? "CAPPED" : "UNVERIFIED_LEGACY";
  const usableProof = coverageState !== "UNVERIFIED_LEGACY" && proofValid ? proof : null;
  return { finalizationId, durable: {
    commitState: !sourceRevisionCurrent || !entriesCurrent ? "UNVERIFIED" : record.status,
    coverageState,
    committed: entries.length,
    storedEntryCount: Array.isArray(record.entryIds) ? record.entryIds.length : null,
    retractedCount: entryState.forgotten + entryState.revoked,
    capReached: usableProof ? usableProof.capReached : historicalCapped && entriesCurrent ? true : null,
    sourceCounts: usableProof ? {
      authorized: usableProof.authorizedSourceCount,
      screened: usableProof.screenedSourceCount,
      planned: usableProof.plannedSourceCount,
      modelEvaluated: usableProof.modelEvaluatedSourceCount,
      unmodeled: usableProof.unmodeledSourceCount,
      locallyExcluded: usableProof.locallyExcludedSourceCount,
      noiseLikely: usableProof.noiseLikelySourceCount,
      uncertain: usableProof.uncertainSourceCount
    } : {
      authorized: null, screened: null, planned: null,
      modelEvaluated: historicalCapped && entriesCurrent ? record.evaluatedFragmentCount : null,
      unmodeled: null, locallyExcluded: null, noiseLikely: null, uncertain: null
    },
    sourceCountPrecision: usableProof ? "EXACT" : historicalCapped && entriesCurrent ? "LEGACY_PARTIAL" : "UNKNOWN"
  }, _entries: entries, _entryState: entryState };
}

function legacyFactRows({ scope, legacyMemories, getLegacyFacts }) {
  const rows = [];
  let remaining = MAX_COVERAGE_FACTS;
  for (const memory of legacyMemories) {
    if (!authorizedLegacy(memory, scope)) continue;
    const declaredIds = perspectiveIds(memory);
    const finalizationId = finalizationIdOf(memory);
    if (!declaredIds.length || declaredIds.length > remaining) {
      rows.push({ summaryId: memory.memoryId || null, finalizationId, fact: null, relation: "UNVERIFIED",
        durableEntryIds: [], completeMigrationProof: false, _legacy: memory });
      continue;
    }
    remaining -= declaredIds.length;
    const facts = declaredIds.length && typeof getLegacyFacts === "function"
      ? getLegacyFacts(scope, memory).filter(fact => declaredIds.includes(String(fact?.memoryId))) : [];
    const factsById = new Map(facts.map(fact => [String(fact.memoryId), fact]));
    for (const legacyMemoryId of declaredIds) {
      const fact = factsById.get(legacyMemoryId);
      rows.push({ summaryId: memory.memoryId || null, finalizationId, legacyMemoryId, fact: fact || null,
        factHash: fact ? legacySourceHash(fact) : null, _legacy: memory });
    }
  }
  return rows;
}

function classifyRows({ scope, rows, index, metadata, store, baseStore, verifiedLineages, cache }) {
  for (const finalizationId of new Set(rows.map(row => row.finalizationId).filter(Boolean))) {
    finalizationSnapshot({ scope, finalizationId, index, metadata, store, baseStore, cache });
  }
  return rows.map(row => {
    if (!row.fact || !row.factHash || row.finalizationId && !cache.get(row.finalizationId)?.sourceRevisionCurrent) {
      return { ...row, relation: "UNVERIFIED", durableEntryIds: [], completeMigrationProof: false };
    }
    const entryState = cache.get(row.finalizationId)?.entryState || { entries: [], invalid: 0, forgotten: 0, revoked: 0 };
    const entries = entryState.entries;
    const exact = entries.filter(item => (item.entry.source?.legacyRefs || []).some(ref =>
      ref.memoryId === row.fact.memoryId && ref.sourceHash === row.factHash));
    if (exact.length) return { ...row, relation: "LEGACY_SOURCE_EXACT",
      durableEntryIds: exact.map(item => item.entryId),
      completeMigrationProof: exact.some(item => (item.entry.source?.legacyRefs || []).some(ref =>
        ref.memoryId === row.fact.memoryId && ref.sourceHash === row.factHash && ref.complete === true)) };
    const shared = entries.filter(item => sourceIntersects(row.fact, item.entry, verifiedLineages));
    if (shared.length) return { ...row, relation: "SHARED_FRAGMENT_SOURCE",
      durableEntryIds: shared.map(item => item.entryId), completeMigrationProof: false };
    if (entries.length) return { ...row, relation: "RELATED_FINALIZATION_ONLY", durableEntryIds: [], completeMigrationProof: false };
    if (entryState.forgotten) return { ...row, relation: "FORGOTTEN", durableEntryIds: [], completeMigrationProof: false };
    if (entryState.revoked) return { ...row, relation: "REVOKED", durableEntryIds: [], completeMigrationProof: false };
    if (entryState.invalid) return { ...row, relation: "UNVERIFIED", durableEntryIds: [], completeMigrationProof: false };
    return { ...row, relation: "LEGACY_ONLY", durableEntryIds: [], completeMigrationProof: false };
  });
}

function durableOnlyCoverage({ scope, finalizationId, legacyMemories, getLegacyFacts, index, metadata, store, baseStore, cache }) {
  const unknown = { relation: "DURABLE_ONLY", count: null, entries: [] };
  if (!finalizationId) return unknown;
  const snapshot = finalizationSnapshot({ scope, finalizationId, index, metadata, store, baseStore, cache });
  if (!snapshot.sourceRevisionCurrent) return unknown;
  const record = snapshot.record;
  if (!record || !FINALIZATION_STATUSES.has(record.status)) return unknown;
  if (record.status !== "STORE") return { relation: "DURABLE_ONLY", count: 0, entries: [] };
  const entryState = snapshot.entryState;
  if (entryState.invalid || entryState.forgotten || entryState.revoked) return unknown;
  const scopedMemories = legacyMemories.filter(memory => authorizedLegacy(memory, scope) && finalizationIdOf(memory) === finalizationId);
  const declaredFactCount = scopedMemories.reduce((count, memory) => count + Math.max(1, perspectiveIds(memory).length), 0);
  if (declaredFactCount > MAX_COVERAGE_FACTS) return unknown;
  const rows = legacyFactRows({ scope, legacyMemories: scopedMemories, getLegacyFacts });
  const verifiedLineages = verifiedLegacyLineages(scope, scopedMemories, store, getLegacyFacts);
  const classified = classifyRows({ scope, rows, index, metadata, store, baseStore, verifiedLineages, cache });
  const linkedEntryIds = new Set(classified.flatMap(row => ["LEGACY_SOURCE_EXACT", "SHARED_FRAGMENT_SOURCE"].includes(row.relation)
    ? row.durableEntryIds : []));
  if (classified.some(row => row.relation === "UNVERIFIED" || row.relation === "FORGOTTEN" || row.relation === "REVOKED")) return unknown;
  const entries = entryState.entries.filter(item => !linkedEntryIds.has(item.entryId)).map(({ entryId, row }) => ({
    entryId, revision: row.revision, bodyHash: row.bodyHash
  }));
  return { relation: "DURABLE_ONLY", count: entries.length, entries };
}

function publicCoverageRow(row) {
  return { summaryId: row.summaryId, finalizationId: row.finalizationId || null,
    legacyMemoryId: row.legacyMemoryId || null, relation: row.relation,
    durableEntryIds: row.durableEntryIds || [], completeMigrationProof: row.completeMigrationProof === true,
    durableEntries: (row._durableEntries || []).map(({ entryId, row: indexRow }) => ({ entryId,
      revision: indexRow.revision, bodyHash: indexRow.bodyHash })),
    semanticEquivalence: "NOT_ASSERTED" };
}

function summaryHashFor({ scope, finalizationId, rows, index, legacyRevision, forgetGeneration, durable }) {
  return hash({ scope, finalizationId: finalizationId || null, indexRevision: index.revision,
    legacyRevision: legacyRevision ?? null, forgetGeneration: forgetGeneration ?? null,
    legacy: rows.map(row => [row.summaryId, row.legacyMemoryId || null, row.factHash || null, row.relation]) });
}

function buildCoverageSummary({ scope, index, metadata = {}, legacyMemories = [], getLegacyFacts, store, baseStore,
  legacyRevision = null, forgetGeneration = null, latestFinalizationId = null, offset = 0, limit = MAX_COVERAGE_PAGE }) {
  assertScope(scope);
  if (!index || index.ownerId !== scope.ownerId || index.campaignToken !== scope.campaignToken) throw new Error("memory4_coverage_scope_mismatch");
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > MAX_COVERAGE_PAGE) {
    throw new Error("memory4_coverage_page_invalid");
  }
  const pageMemories = legacyMemories.slice(offset, offset + limit);
  const rawRows = legacyFactRows({ scope, legacyMemories: pageMemories, getLegacyFacts });
  const verifiedLineages = verifiedLegacyLineages(scope, pageMemories, store, getLegacyFacts);
  const cache = new Map();
  const rows = classifyRows({ scope, rows: rawRows, index, metadata, store, baseStore, verifiedLineages, cache });
  const byFinalization = new Map();
  for (const finalizationId of new Set(rows.map(row => row.finalizationId).filter(Boolean))) {
    const group = rows.filter(row => row.finalizationId === finalizationId);
    const durable = finalizationData({ scope, finalizationId, index, metadata, store, baseStore, cache });
    const exactCount = group.filter(row => row.relation === "LEGACY_SOURCE_EXACT").length;
    const sharedCount = group.filter(row => row.relation === "SHARED_FRAGMENT_SOURCE").length;
    const relatedCount = group.filter(row => row.relation === "RELATED_FINALIZATION_ONLY").length;
    const legacyOnlyCount = group.filter(row => row.relation === "LEGACY_ONLY").length;
    const unverifiedCount = group.filter(row => row.relation === "UNVERIFIED").length;
    const forgottenCount = group.filter(row => row.relation === "FORGOTTEN").length;
    const revokedCount = group.filter(row => row.relation === "REVOKED").length;
    const declaredCount = group.some(row => row.relation === "UNVERIFIED" && !row.legacyMemoryId)
      ? null : group.filter(row => row.legacyMemoryId).length || null;
    byFinalization.set(finalizationId, {
      ...durable,
      legacy: { importantItemCount: declaredCount, provenSourceLinkedCount: exactCount + sharedCount,
        exactSourceCount: exactCount, sharedFragmentSourceCount: sharedCount, sourceRelatedOnlyCount: relatedCount,
        legacyOnlyCount, unverifiedCount, forgottenCount, revokedCount },
      summaryHash: summaryHashFor({ scope, finalizationId, rows: group, index, legacyRevision, forgetGeneration, durable })
    });
  }
  const summaries = [];
  const bySummary = new Map();
  for (const row of rows) {
    const key = row.summaryId || "unknown:" + (row.finalizationId || "legacy");
    if (!bySummary.has(key)) bySummary.set(key, []);
    bySummary.get(key).push(row);
  }
  for (const [summaryId, group] of bySummary) {
    const finalizationId = group[0]?.finalizationId || null;
    summaries.push({ summaryId: summaryId.startsWith("unknown:") ? null : summaryId, finalizationId,
      legacy: {
        importantItemCount: group.some(row => row.relation === "UNVERIFIED" && !row.legacyMemoryId)
          ? null : group.filter(row => row.legacyMemoryId).length || null,
        provenSourceLinkedCount: group.filter(row => ["LEGACY_SOURCE_EXACT", "SHARED_FRAGMENT_SOURCE"].includes(row.relation)).length,
        sourceRelatedOnlyCount: group.filter(row => row.relation === "RELATED_FINALIZATION_ONLY").length,
        legacyOnlyCount: group.filter(row => row.relation === "LEGACY_ONLY").length,
        unverifiedCount: group.filter(row => row.relation === "UNVERIFIED").length,
        forgottenCount: group.filter(row => row.relation === "FORGOTTEN").length,
        revokedCount: group.filter(row => row.relation === "REVOKED").length
      },
      summaryHash: summaryHashFor({ scope, finalizationId, rows: group, index, legacyRevision, forgetGeneration })
    });
  }
  const current = latestFinalizationId
    ? finalizationData({ scope, finalizationId: latestFinalizationId, index, metadata, store, baseStore, cache }) : null;
  const currentDurableOnly = latestFinalizationId
    ? durableOnlyCoverage({ scope, finalizationId: latestFinalizationId, legacyMemories, getLegacyFacts, index, metadata, store, baseStore, cache }) : null;
  const summaryHash = summaryHashFor({ scope, rows, index, legacyRevision, forgetGeneration, durable: current });
  return { ownerId: scope.ownerId, campaignToken: scope.campaignToken, indexRevision: index.revision,
    legacyRevision, forgetGeneration, summaryHash, offset, limit, total: legacyMemories.length,
    latest: current ? { ...current, durableOnly: currentDurableOnly, _entries: undefined, _entryState: undefined } : null,
    legacy: { importantItemCount: rows.some(row => row.relation === "UNVERIFIED" && !row.legacyMemoryId)
      ? null : rows.filter(row => row.legacyMemoryId).length || null,
      provenSourceLinkedCount: rows.filter(row => ["LEGACY_SOURCE_EXACT", "SHARED_FRAGMENT_SOURCE"].includes(row.relation)).length,
      sourceRelatedOnlyCount: rows.filter(row => row.relation === "RELATED_FINALIZATION_ONLY").length,
      legacyOnlyCount: rows.filter(row => row.relation === "LEGACY_ONLY").length,
      unverifiedCount: rows.filter(row => row.relation === "UNVERIFIED").length,
      forgottenCount: rows.filter(row => row.relation === "FORGOTTEN").length,
      revokedCount: rows.filter(row => row.relation === "REVOKED").length },
    summaries, finalizations: [...byFinalization.values()].map(item => ({ ...item, _entries: undefined, _entryState: undefined })) };
}

function getCoveragePage({ scope, index, metadata = {}, legacyMemories = [], getLegacyFacts, store, baseStore,
  finalizationId = null, legacyMemoryId = null, offset = 0, limit = MAX_COVERAGE_PAGE,
  expectedIndexRevision = null, expectedSummaryHash = null, legacyRevision = null, forgetGeneration = null }) {
  assertScope(scope);
  if ((!finalizationId && !legacyMemoryId) || finalizationId != null && (typeof finalizationId !== "string" || finalizationId.length > 512)
    || legacyMemoryId != null && (typeof legacyMemoryId !== "string" || legacyMemoryId.length > 256)
    || !Number.isSafeInteger(offset) || offset < 0 || offset > 1000000
    || !Number.isSafeInteger(limit) || limit < 1 || limit > MAX_COVERAGE_PAGE
    || expectedIndexRevision != null && (!Number.isSafeInteger(expectedIndexRevision) || expectedIndexRevision < 0)
    || expectedSummaryHash != null && !/^[a-f0-9]{64}$/.test(expectedSummaryHash)) throw new Error("memory4_coverage_page_invalid");
  if (!index || index.ownerId !== scope.ownerId || index.campaignToken !== scope.campaignToken) throw new Error("memory4_coverage_scope_mismatch");
  if (expectedIndexRevision != null && expectedIndexRevision !== index.revision) {
    return { status: "STALE", indexRevision: index.revision, summaryHash: null, items: [], offset, limit, total: 0 };
  }
  const matchingMemories = legacyMemories.filter(memory => {
    if (!authorizedLegacy(memory, scope)) return false;
    if (finalizationId && finalizationIdOf(memory) !== finalizationId) return false;
    if (!legacyMemoryId) return true;
    return memory.memoryId === legacyMemoryId || perspectiveIds(memory).includes(legacyMemoryId);
  });
  const rawRows = legacyFactRows({ scope, legacyMemories: matchingMemories, getLegacyFacts });
  const verifiedLineages = verifiedLegacyLineages(scope, matchingMemories, store, getLegacyFacts);
  const cache = new Map();
  const classifiedRows = classifyRows({ scope, rows: rawRows, index, metadata, store, baseStore, verifiedLineages, cache });
  const durableRows = new Map();
  for (const finalization of new Set(classifiedRows.map(row => row.finalizationId).filter(Boolean))) {
    const state = cache.get(finalization)?.entryState || { entries: [] };
    durableRows.set(finalization, state.entries);
  }
  const rows = classifiedRows.map(row => ({ ...row, _durableEntries: row.durableEntryIds.map(id =>
    (durableRows.get(row.finalizationId) || []).find(item => item.entryId === id)).filter(Boolean) }));
  const snapshotHash = summaryHashFor({ scope, finalizationId, rows, index, legacyRevision, forgetGeneration, durable: null });
  if (expectedIndexRevision != null && expectedIndexRevision !== index.revision
    || expectedSummaryHash != null && expectedSummaryHash !== snapshotHash) {
    return { status: "STALE", indexRevision: index.revision, summaryHash: snapshotHash, items: [], offset, limit, total: rows.length };
  }
  const items = rows.slice(offset, offset + limit).map(publicCoverageRow);
  const durableOnly = durableOnlyCoverage({ scope, finalizationId: finalizationId || rows[0]?.finalizationId || null,
    legacyMemories, getLegacyFacts, index, metadata, store, baseStore, cache });
  return { status: "OK", indexRevision: index.revision, summaryHash: snapshotHash,
    items, durableOnly, offset, limit, total: rows.length };
}

module.exports = { MAX_COVERAGE_PAGE, buildCoverageSummary, getCoveragePage };
