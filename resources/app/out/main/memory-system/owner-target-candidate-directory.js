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
    const fail = (status, reason) => ({ status, reason, coverage: "INCOMPLETE",
      candidateCounterpartIds: [], constructionMs: performance.now() - started, cacheHit: false });
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
    const sources = [];
    for (const memory of ownerSnapshot) {
      const provenance = memory?.provenance;
      if (Number(provenance?.folderOwnerId) !== ownerId || !memory.knownBy?.map(Number).includes(ownerId)
        || String(provenance.campaignToken || "").trim() !== campaignToken) continue;
      if (!Array.isArray(provenance.pairLedgerSources) || !provenance.pairLedgerSources.length) {
        return fail("UNAVAILABLE", "SOURCE_COVERAGE_INCOMPLETE");
      }
      for (const source of provenance.pairLedgerSources) {
        const counterpartId = Number(source.counterpartId);
        if (Number(source.ownerId) !== ownerId || !universe.has(counterpartId)) continue;
        const raw = source.rawSummary;
        if (source.ownerAuthorized !== true || !raw || typeof raw.content !== "string"
          || !source.fileSignature || !source.fileDigest || !source.relativeSummaryPath
          || source.sourceMemoryId !== memory.memoryId) return fail("UNAVAILABLE", "SOURCE_COVERAGE_INCOMPLETE");
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
        sources.push({ counterpartId, texts, identity: [source.sourceSummaryKey, source.sourceRevision,
          source.relativeSummaryPath, source.summaryIndex, source.fileDigest, raw.content] });
      }
    }
    if (counterpartIds.some(id => !covered.has(id) && !targetCharacterIds.includes(id))) {
      return fail("UNAVAILABLE", "SOURCE_COVERAGE_INCOMPLETE");
    }
    const sourceIdentityFingerprint = digest(sources.map(source => source.identity));
    const key = digest([ownerId, campaignToken, snapshotRevision, profileFingerprint, sourceIdentityFingerprint,
      targetCharacterIds, counterpartIds, sceneRevision, currentGameDate, currentTotalDays, epoch]);
    const cached = this.cache.get(key);
    if (cached && cached.checksum === digest(cached.result) && cached.ownerId === ownerId) {
      this.cache.delete(key);
      this.cache.set(key, cached);
      return { ...cached.result, candidateCounterpartIds: [...cached.result.candidateCounterpartIds],
        constructionMs: 0, cacheHit: true };
    }
    const candidates = new Set(targetCharacterIds);
    for (const source of sources) if (targets.some(profile => profile.uniqueAliases.some(alias =>
      source.texts.some(text => text.includes(alias))))) candidates.add(source.counterpartId);
    const result = { status: "COMPLETE", reason: "NONE", coverage: "CONSERVATIVE_SUPERSET",
      ownerId, campaignToken, snapshotRevision, profileFingerprint, sourceIdentityFingerprint,
      candidateCounterpartIds: counterpartIds.filter(id => candidates.has(id)), ownerPairCount: counterpartIds.length };
    this.cache.set(key, { ownerId, result: Object.freeze({ ...result,
      candidateCounterpartIds: Object.freeze([...result.candidateCounterpartIds]) }), checksum: digest(result) });
    while (this.cache.size > 64) this.cache.delete(this.cache.keys().next().value);
    return { ...result, constructionMs: performance.now() - started, cacheHit: false };
  }
}

module.exports = { OwnerTargetCandidateDirectory };
