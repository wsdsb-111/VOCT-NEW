"use strict";

const crypto = require("crypto");
const { performance } = require("perf_hooks");
const { parseImportantMatters } = require("../../shared/pair-important-matters");

function digest(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function normalizeAlias(value) {
  return String(value || "").normalize("NFKC").toLocaleLowerCase().replace(/\s+/gu, " ").trim();
}

// A derived, process-local superset only. PairLedger remains the authority for
// items, confirmation, date/Forget visibility, and source revisions.
class OwnerTargetCandidateDirectory {
  constructor({ store }) {
    this.store = store;
    this.cache = new Map();
  }

  invalidate(ownerIds = null) {
    if (ownerIds == null) return this.cache.clear();
    const ids = new Set((Array.isArray(ownerIds) ? ownerIds : [ownerIds]).map(Number));
    for (const [key, entry] of this.cache) if (ids.has(entry.ownerId)) this.cache.delete(key);
  }

  getCandidateScopes({ ownerId, campaignToken, ownerSnapshot, snapshotRevision, profiles,
    targetCharacterIds, counterpartIds, sceneRevision = null, currentGameDate, currentTotalDays, epoch } = {}) {
    const started = performance.now();
    const fail = (status, reason, metrics = {}) => ({ status, reason, coverage: "INCOMPLETE",
      candidateCounterpartIds: [], constructionMs: performance.now() - started, cacheHit: false, ...metrics });
    if (!Array.isArray(ownerSnapshot) || !Number.isSafeInteger(snapshotRevision)
      || this.store.getFolderSummarySnapshotRevision(ownerSnapshot) !== snapshotRevision
      || this.store.getFolderSummarySnapshotSources(ownerSnapshot)?.ownerId !== ownerId) {
      return fail("UNAVAILABLE", "OWNER_SNAPSHOT_UNAVAILABLE");
    }
    const targets = targetCharacterIds.map(id => profiles.byId.get(id));
    if (targets.some(profile => !profile?.uniqueAliases?.length)) return fail("AMBIGUOUS", "ALIAS_PROFILE_AMBIGUOUS");
    const profileFingerprint = digest([...profiles.byId].map(([id, profile]) => [id, [...profile.aliases].sort(), profile.uniqueAliases]));
    const universe = new Set(counterpartIds);
    const covered = new Set();
    const uncertain = new Set();
    let uncertainSourceCount = 0;
    let unscopedUnknownCount = 0;
    const sources = [];
    const coverageRecords = [];
    const scopeIds = values => [...new Set(values.map(Number).filter(id => Number.isSafeInteger(id)
      && id > 0 && id !== ownerId && universe.has(id)))];
    const markUncertain = ids => {
      if (!ids.length) { unscopedUnknownCount++; return; }
      uncertainSourceCount++;
      for (const id of ids) uncertain.add(id);
    };
    for (const memory of ownerSnapshot) {
      const provenance = memory?.provenance;
      if (Number(provenance?.folderOwnerId) !== ownerId || !Array.isArray(memory.knownBy)
        || !memory.knownBy.map(Number).includes(ownerId)
        || String(provenance.campaignToken || "").trim() !== campaignToken) continue;
      const pairSources = Array.isArray(provenance.pairLedgerSources) ? provenance.pairLedgerSources : [];
      const provenanceIds = scopeIds([provenance.counterpartId,
        ...(Array.isArray(provenance.counterpartIds) ? provenance.counterpartIds : [])]);
      const recordIds = scopeIds([...provenanceIds, ...pairSources.map(source => source?.counterpartId)]);
      coverageRecords.push([memory.memoryId, provenanceIds, provenance.pairLedgerSources ?? null]);
      if (!pairSources.length) {
        markUncertain(recordIds);
        continue;
      }
      const represented = new Set();
      for (const source of pairSources) {
        const counterpartId = Number(source?.counterpartId);
        const sourceIds = scopeIds([counterpartId]);
        for (const id of sourceIds) represented.add(id);
        if (!sourceIds.length) { markUncertain(recordIds); continue; }
        const raw = source?.rawSummary;
        if (source?.ownerAuthorized !== true || !raw || typeof raw.content !== "string"
          || !source.fileSignature || !/^[a-f0-9]{64}$/u.test(source.fileDigest || "")
          || typeof source.relativeSummaryPath !== "string" || !source.relativeSummaryPath
          || Number(source.ownerId) !== ownerId || typeof source.sourceSummaryKey !== "string" || !source.sourceSummaryKey.trim()
          || !/^[a-f0-9]{64}$/u.test(source.sourceRevision || "")
          || source.sourceMemoryId !== memory.memoryId) {
          markUncertain(sourceIds);
          continue;
        }
        covered.add(counterpartId);
        const ids = [Number(raw.playerId), Number(raw.characterId)];
        if (!ids.includes(ownerId) || !ids.includes(counterpartId)
          || raw.perspectiveOwnerId != null && Number(raw.perspectiveOwnerId) !== ownerId
          || String(raw.campaignToken || "").trim() !== campaignToken
          || raw.campaignBinding?.status === "unresolved" || source.campaignBinding?.status === "unresolved"
          || raw.sourceType === "CK3_OFFICIAL_RECOLLECTION" || raw.type === "official_recollection"
          || raw.subtype === "official_recollection") continue;
        // Include raw content AND parser-normalized items: every old alias-matched
        // matter is represented, including confirmed ambiguous and Legacy items.
        const parsed = parseImportantMatters(raw.content);
        const texts = [normalizeAlias(raw.content), ...parsed.items.map(item => normalizeAlias(item.text))];
        sources.push({ counterpartId, texts });
      }
      const missingIds = provenanceIds.filter(id => !represented.has(id));
      if (missingIds.length) markUncertain(missingIds);
    }
    for (const id of counterpartIds) if (!covered.has(id)) uncertain.add(id);
    const coverageMetrics = { trustedCoveredScopeCount: counterpartIds.filter(id => covered.has(id) && !uncertain.has(id)).length,
      uncertainScopedScopeCount: uncertain.size, uncertainSourceCount, unscopedUnknownCount };
    if (unscopedUnknownCount) return fail("UNAVAILABLE", "UNSCOPED_LEGACY_SOURCE", coverageMetrics);
    const sourceIdentityFingerprint = digest(coverageRecords);
    const key = digest(["v9363-scoped-coverage-1", ownerId, campaignToken, snapshotRevision, profileFingerprint, sourceIdentityFingerprint,
      targetCharacterIds, counterpartIds, sceneRevision, currentGameDate, currentTotalDays, epoch]);
    const cached = this.cache.get(key);
    if (cached && cached.checksum === digest(cached.result) && cached.ownerId === ownerId) {
      this.cache.delete(key);
      this.cache.set(key, cached);
      return { ...cached.result, candidateCounterpartIds: [...cached.result.candidateCounterpartIds],
        uncertainCounterpartIds: [...cached.result.uncertainCounterpartIds],
        constructionMs: 0, cacheHit: true };
    }
    const candidates = new Set([...targetCharacterIds, ...uncertain]);
    for (const source of sources) if (targets.some(profile => profile.uniqueAliases.some(alias =>
      source.texts.some(text => text.includes(alias))))) candidates.add(source.counterpartId);
    const result = { status: uncertain.size ? "SCOPED_DEGRADED" : "COMPLETE",
      reason: uncertain.size ? "SCOPED_LEGACY_SOURCE" : "NONE", coverage: "CONSERVATIVE_SUPERSET",
      ownerId, campaignToken, snapshotRevision, profileFingerprint, sourceIdentityFingerprint,
      candidateCounterpartIds: counterpartIds.filter(id => candidates.has(id)), ownerPairCount: counterpartIds.length,
      uncertainCounterpartIds: counterpartIds.filter(id => uncertain.has(id)), ...coverageMetrics };
    this.cache.set(key, { ownerId, result: Object.freeze({ ...result,
      candidateCounterpartIds: Object.freeze([...result.candidateCounterpartIds]),
      uncertainCounterpartIds: Object.freeze([...result.uncertainCounterpartIds]) }), checksum: digest(result) });
    while (this.cache.size > 64) this.cache.delete(this.cache.keys().next().value);
    return { ...result, constructionMs: performance.now() - started, cacheHit: false };
  }
}

module.exports = { OwnerTargetCandidateDirectory };
