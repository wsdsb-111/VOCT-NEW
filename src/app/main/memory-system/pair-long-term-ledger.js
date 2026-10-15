"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { normalizeGameDate } = require("../worldline/character-temporal-facts");
const { assertNoLinks } = require("./scoped-path");
const pairMatters = require("../../shared/pair-important-matters");

const INDEX_SCHEMA_VERSION = 1;
const INDEX_ALGORITHM_VERSION = 1;
const MAX_PAGE_SIZE = 50;
const INTERACTION_EVIDENCE = new Set(["DIRECT_PAIR", "GROUP_WITNESSED", "UNDETERMINED"]);

function makeError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function hash(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (!value || typeof value !== "object") return JSON.stringify(value);
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
}

function normalizeScope(scope = {}) {
  const campaignToken = typeof scope.campaignToken === "string" ? scope.campaignToken.trim() : "";
  const ownerId = Number(scope.ownerId), counterpartId = Number(scope.counterpartId);
  if (!campaignToken || campaignToken.length > 512 || !Number.isSafeInteger(ownerId) || ownerId <= 0
    || !Number.isSafeInteger(counterpartId) || counterpartId <= 0 || ownerId === counterpartId) {
    throw makeError("PAIR_INDEX_SCOPE_INVALID");
  }
  return { campaignToken, ownerId, counterpartId };
}

function safeDate(value) {
  return normalizeGameDate(value);
}

function validEvidence(value) {
  return INTERACTION_EVIDENCE.has(value) ? value : "UNDETERMINED";
}

function interactionEvidence(summary, ownerId, counterpartId) {
  if (summary?.interactionEvidence != null) return validEvidence(summary.interactionEvidence);
  const participants = Array.isArray(summary?.participants)
    ? summary.participants.map(item => Number(item?.id ?? item?.characterId ?? item)).filter(Number.isSafeInteger) : [];
  const presenceEvents = [
    ...(Array.isArray(summary?.presenceJoins) ? summary.presenceJoins : []),
    ...(Array.isArray(summary?.presenceLeaves) ? summary.presenceLeaves : [])
  ];
  const involvedPresence = presenceEvents
    .some(event => [ownerId, counterpartId].includes(Number(event?.characterId ?? event?.id)));
  if (summary?.conversationType === "pair" && participants.length === 2
    && participants.includes(ownerId) && participants.includes(counterpartId) && !involvedPresence) return "DIRECT_PAIR";
  if (summary?.conversationType === "group" && participants.includes(ownerId) && participants.includes(counterpartId)
    && !involvedPresence) return "GROUP_WITNESSED";
  return "UNDETERMINED";
}

function sourceDate(summary) {
  return safeDate(summary?.date);
}

function legacyGroupKey(source) {
  return JSON.stringify([source.relativeSummaryPath, source.conversationDate || null, source.conversationTotalDays ?? null]);
}

function legacyDuplicateKey(source) {
  return JSON.stringify([source.relativeSummaryPath, source.conversationDate || null,
    source.conversationTotalDays ?? null, source.sourceRevision]);
}

class PairLongTermLedger {
  constructor({ store } = {}) {
    if (!store) throw new Error("PAIR_INDEX_STORE_REQUIRED");
    this.store = store;
    this.cache = new Map();
    this.ownerSnapshots = new Map();
  }

  scopeKey(scope) {
    return `${hash(scope.campaignToken)}|${scope.ownerId}|${scope.counterpartId}`;
  }

  indexPath(scope) {
    return path.join(this.store.baseDir, "pair-important-index", "v1", hash(scope.campaignToken),
      String(scope.ownerId), `${scope.counterpartId}.json`);
  }

  invalidate(ownerIds = null) {
    if (ownerIds == null) {
      this.cache.clear();
      this.ownerSnapshots.clear();
      return;
    }
    const targets = new Set((Array.isArray(ownerIds) ? ownerIds : [ownerIds]).map(Number));
    for (const [key, entry] of this.cache) if (targets.has(entry.scope.ownerId)) this.cache.delete(key);
    for (const ownerId of targets) this.ownerSnapshots.delete(ownerId);
  }

  readIndex(scope) {
    const filePath = this.indexPath(scope);
    try {
      assertNoLinks(filePath);
      if (!fs.existsSync(filePath)) return null;
      const stat = fs.lstatSync(filePath);
      if (!stat.isFile() || stat.isSymbolicLink()) throw makeError("PAIR_INDEX_FILE_INVALID");
      const parsed = JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, ""));
      return this.isIndexShapeValid(parsed, scope) ? parsed : null;
    } catch (error) {
      if (error.code === "ENOENT") return null;
      if (error.code && error.code.startsWith("PAIR_")) throw error;
      return null;
    }
  }

  isIndexShapeValid(index, scope) {
    if (!(index && index.schemaVersion === INDEX_SCHEMA_VERSION
      && index.indexAlgorithmVersion === INDEX_ALGORITHM_VERSION
      && index.pairScope?.campaignToken === scope.campaignToken
      && Number(index.pairScope?.ownerId) === scope.ownerId
      && Number(index.pairScope?.counterpartId) === scope.counterpartId
      && /^[a-f0-9]{64}$/u.test(index.sourceSetDigest || "")
      && Array.isArray(index.items) && Array.isArray(index.sourceSummaries))) return false;
    if (!index.sourceSummaries.every(source => typeof source?.sourceSummaryKey === "string" && source.sourceSummaryKey
      && /^[a-f0-9]{64}$/u.test(source.sourceRevision || "")
      && typeof source.relativeSummaryPath === "string" && Number.isSafeInteger(source.summaryIndex) && source.summaryIndex >= 0)) return false;
    return index.items.every(item => item?.scope?.campaignToken === scope.campaignToken
      && Number(item.scope.ownerId) === scope.ownerId && Number(item.scope.counterpartId) === scope.counterpartId
      && typeof item.itemId === "string" && typeof item.text === "string"
      && typeof item.normalizedSearchText === "string" && Array.isArray(item.searchTerms)
      && typeof item.source?.sourceSummaryKey === "string"
      && /^[a-f0-9]{64}$/u.test(item.source.sourceRevision || "")
      && Number.isSafeInteger(item.source.sourceItemOrdinal) && item.source.sourceItemOrdinal > 0);
  }

  writeIndex(scope, index) {
    const filePath = this.indexPath(scope);
    const directory = path.dirname(filePath);
    assertNoLinks(directory);
    fs.mkdirSync(directory, { recursive: true });
    assertNoLinks(directory);
    const tempPath = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
    try {
      assertNoLinks(tempPath);
      fs.writeFileSync(tempPath, JSON.stringify(index, null, 2), { encoding: "utf8", flag: "wx" });
      fs.renameSync(tempPath, filePath);
    } finally {
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    }
  }

  loadSnapshot(scope, suppliedMemories = null) {
    const cachedSnapshot = this.ownerSnapshots.get(scope.ownerId);
    let memories = Array.isArray(suppliedMemories) ? suppliedMemories : cachedSnapshot?.memories;
    if (Array.isArray(suppliedMemories) && cachedSnapshot
      && this.store.getFolderSummarySnapshotRevision(suppliedMemories) === cachedSnapshot.snapshotRevision) {
      memories = cachedSnapshot.memories;
    }
    if (!memories) memories = this.store.loadFolderSummariesForCharacter(scope.ownerId);
    if (this.store.hasPairLedgerSourceChanges(memories) || this.store.hasPairLedgerSourceContentChanges(memories, scope.counterpartId)) {
      this.store.invalidateFolderSummaryCache([scope.ownerId]);
      memories = this.store.loadFolderSummariesForCharacter(scope.ownerId);
      if (this.store.hasPairLedgerSourceChanges(memories) || this.store.hasPairLedgerSourceContentChanges(memories, scope.counterpartId)) {
        throw makeError("PAIR_INDEX_SOURCE_UNSTABLE");
      }
    }
    const snapshotRevision = this.store.getFolderSummarySnapshotRevision(memories);
    if (!Number.isSafeInteger(snapshotRevision)) {
      throw makeError("PAIR_INDEX_SOURCE_SNAPSHOT_INVALID");
    }
    this.ownerSnapshots.set(scope.ownerId, { memories, snapshotRevision });
    return memories;
  }

  collectSources(scope, memories, diagnostics) {
    const sources = [];
    const seen = new Map();
    for (const memory of memories) {
      const provenance = memory?.provenance;
      if (Number(provenance?.folderOwnerId) !== scope.ownerId || !memory?.knownBy?.includes(scope.ownerId)) continue;
      for (const source of provenance.pairLedgerSources || []) {
        if (Number(source?.ownerId) !== scope.ownerId || Number(source?.counterpartId) !== scope.counterpartId) continue;
        diagnostics.scannedSummaryCount++;
        const raw = source.rawSummary;
        if (source.ownerAuthorized !== true || !raw || typeof raw !== "object" || Array.isArray(raw)) {
          diagnostics.skipReasons.SOURCE_AUTHORIZATION_UNVERIFIED = (diagnostics.skipReasons.SOURCE_AUTHORIZATION_UNVERIFIED || 0) + 1;
          continue;
        }
        if (raw.sourceType === "CK3_OFFICIAL_RECOLLECTION" || raw.type === "official_recollection" || raw.subtype === "official_recollection") {
          diagnostics.skipReasons.OFFICIAL_RECOLLECTION = (diagnostics.skipReasons.OFFICIAL_RECOLLECTION || 0) + 1;
          continue;
        }
        if (typeof raw.content !== "string" || !raw.content.trim()) {
          diagnostics.skipReasons.SUMMARY_CONTENT_INVALID = (diagnostics.skipReasons.SUMMARY_CONTENT_INVALID || 0) + 1;
          continue;
        }
        const rawIds = [Number(raw.playerId), Number(raw.characterId)];
        if (!rawIds.every(id => Number.isSafeInteger(id) && id > 0) || rawIds[0] === rawIds[1]
          || !rawIds.includes(scope.ownerId) || !rawIds.includes(scope.counterpartId)
          || raw.perspectiveOwnerId != null && Number(raw.perspectiveOwnerId) !== scope.ownerId) {
          diagnostics.skipReasons.SOURCE_PAIR_MISMATCH = (diagnostics.skipReasons.SOURCE_PAIR_MISMATCH || 0) + 1;
          continue;
        }
        const campaignToken = typeof raw.campaignToken === "string" ? raw.campaignToken.trim() : "";
        if (!campaignToken) {
          diagnostics.skipReasons.CAMPAIGN_UNBOUND = (diagnostics.skipReasons.CAMPAIGN_UNBOUND || 0) + 1;
          continue;
        }
        if (campaignToken !== scope.campaignToken) {
          diagnostics.skipReasons.CAMPAIGN_MISMATCH = (diagnostics.skipReasons.CAMPAIGN_MISMATCH || 0) + 1;
          continue;
        }
        if (raw.campaignBinding?.status === "unresolved" || source.campaignBinding?.status === "unresolved") {
          diagnostics.skipReasons.CAMPAIGN_UNRESOLVED = (diagnostics.skipReasons.CAMPAIGN_UNRESOLVED || 0) + 1;
          continue;
        }
        if (String(provenance.campaignToken || "").trim() !== scope.campaignToken
          || ![Number(provenance.counterpartId), ...(provenance.counterpartIds || []).map(Number)].includes(scope.counterpartId)) {
          diagnostics.skipReasons.MEMORY_SCOPE_MISMATCH = (diagnostics.skipReasons.MEMORY_SCOPE_MISMATCH || 0) + 1;
          continue;
        }
        const sourceRevision = source.sourceRevision;
        if (typeof sourceRevision !== "string" || !/^[a-f0-9]{64}$/u.test(sourceRevision)
          || source.sourceMemoryId !== memory.memoryId) {
          diagnostics.skipReasons.SOURCE_REVISION_MISMATCH = (diagnostics.skipReasons.SOURCE_REVISION_MISMATCH || 0) + 1;
          continue;
        }
        if (!source.fileSignature || !source.relativeSummaryPath) {
          diagnostics.skipReasons.SOURCE_FILE_UNVERIFIED = (diagnostics.skipReasons.SOURCE_FILE_UNVERIFIED || 0) + 1;
          continue;
        }
        let forgotten;
        try {
          forgotten = this.store.isSummaryProjectionForgotten(raw, { ownerId: scope.ownerId, counterpartId: scope.counterpartId });
        } catch {
          throw makeError("PAIR_INDEX_FORGET_CHECK_FAILED");
        }
        if (forgotten) {
          diagnostics.skipReasons.FORGOTTEN_SOURCE = (diagnostics.skipReasons.FORGOTTEN_SOURCE || 0) + 1;
          continue;
        }
        const date = sourceDate(raw);
        const candidate = {
          sourceSummaryKey: typeof source.sourceSummaryKey === "string" && source.sourceSummaryKey ? source.sourceSummaryKey : null,
          sourceRevision,
          sourceMemoryId: source.sourceMemoryId,
          relativeSummaryPath: source.relativeSummaryPath,
          folderName: source.folderName,
          conversationFile: source.conversationFile,
          summaryIndex: source.summaryIndex,
          conversationDate: date?.canonical || null,
          conversationTotalDays: Number.isFinite(Number(raw.totalDays)) ? Number(raw.totalDays) : null,
          conversationId: source.conversationId || null,
          finalizationId: source.finalizationId || null,
          projectionId: source.projectionId || null,
          interactionEvidence: interactionEvidence(raw, scope.ownerId, scope.counterpartId),
          rawSummary: raw
        };
        const sourceFingerprint = JSON.stringify([candidate.sourceSummaryKey, candidate.sourceRevision]);
        if (candidate.sourceSummaryKey && seen.has(candidate.sourceSummaryKey)) {
          const previous = seen.get(candidate.sourceSummaryKey);
          previous.identityConflict = true;
          candidate.identityConflict = true;
          continue;
        }
        candidate.sourceFingerprint = sourceFingerprint;
        seen.set(candidate.sourceSummaryKey || `legacy:${candidate.relativeSummaryPath}:${candidate.summaryIndex}`, candidate);
        sources.push(candidate);
      }
    }
    return sources;
  }

  bindLegacySourceKeys(scope, sources, previousSources, diagnostics) {
    const legacySources = sources.filter(source => !source.sourceSummaryKey);
    for (const source of legacySources) source.legacySource = true;
    const previousLegacy = (previousSources || []).filter(source => source.legacySource === true && source.sourceSummaryKey);
    const exactGroups = new Map();
    for (const source of legacySources) {
      const key = JSON.stringify([source.relativeSummaryPath, source.conversationDate, source.conversationTotalDays, source.sourceRevision]);
      if (!exactGroups.has(key)) exactGroups.set(key, []);
      exactGroups.get(key).push(source);
    }
    const priorByExact = new Map();
    for (const source of previousLegacy) {
      const key = JSON.stringify([source.relativeSummaryPath, source.conversationDate, source.conversationTotalDays, source.sourceRevision]);
      if (!priorByExact.has(key)) priorByExact.set(key, []);
      priorByExact.get(key).push(source);
    }
    const matchedPrevious = new Set();
    for (const [key, matches] of exactGroups) {
      const prior = priorByExact.get(key) || [];
      if (matches.length > 1) {
        for (const source of matches) source.identityAmbiguous = true;
        continue;
      }
      if (prior.length === 1) {
        matches[0].sourceSummaryKey = prior[0].sourceSummaryKey;
        matchedPrevious.add(prior[0]);
      }
    }

    const remainingCurrent = legacySources.filter(source => !source.sourceSummaryKey && !source.identityAmbiguous);
    const remainingPrior = previousLegacy.filter(source => !matchedPrevious.has(source));
    const currentByDate = new Map(), priorByDate = new Map();
    for (const source of remainingCurrent) {
      const key = legacyGroupKey(source);
      if (!currentByDate.has(key)) currentByDate.set(key, []);
      currentByDate.get(key).push(source);
    }
    for (const source of remainingPrior) {
      const key = legacyGroupKey(source);
      if (!priorByDate.has(key)) priorByDate.set(key, []);
      priorByDate.get(key).push(source);
    }
    for (const [key, current] of currentByDate) {
      const prior = priorByDate.get(key) || [];
      if (current.length === 1 && prior.length === 1) {
        current[0].sourceSummaryKey = prior[0].sourceSummaryKey;
        matchedPrevious.add(prior[0]);
      } else if (prior.length) {
        for (const source of current) source.identityAmbiguous = true;
      }
    }

    const newIdentityCounts = new Map();
    for (const source of legacySources) {
      const key = legacyDuplicateKey(source);
      newIdentityCounts.set(key, (newIdentityCounts.get(key) || 0) + 1);
    }
    for (const source of legacySources) {
      if (source.identityAmbiguous) {
        diagnostics.skipReasons.SOURCE_IDENTITY_AMBIGUOUS = (diagnostics.skipReasons.SOURCE_IDENTITY_AMBIGUOUS || 0) + 1;
        continue;
      }
      if (!source.sourceSummaryKey) {
        if (newIdentityCounts.get(legacyDuplicateKey(source)) > 1) {
          source.identityAmbiguous = true;
          diagnostics.skipReasons.SOURCE_IDENTITY_AMBIGUOUS = (diagnostics.skipReasons.SOURCE_IDENTITY_AMBIGUOUS || 0) + 1;
          continue;
        }
        const seed = JSON.stringify(["legacy-source-v1", scope.campaignToken, scope.ownerId, scope.counterpartId,
          source.relativeSummaryPath, source.conversationDate, source.conversationTotalDays, source.sourceRevision]);
        source.sourceSummaryKey = `pair-summary:legacy:${hash(seed)}`;
      }
    }

    const byKey = new Map();
    for (const source of sources) {
      if (!source.sourceSummaryKey || source.identityAmbiguous) continue;
      const previous = byKey.get(source.sourceSummaryKey);
      if (previous && previous.sourceRevision !== source.sourceRevision) {
        previous.identityConflict = true;
        source.identityConflict = true;
      } else if (!previous) byKey.set(source.sourceSummaryKey, source);
    }
    for (const source of sources) if (source.identityConflict) {
      diagnostics.skipReasons.SOURCE_IDENTITY_CONFLICT = (diagnostics.skipReasons.SOURCE_IDENTITY_CONFLICT || 0) + 1;
    }
    return sources.filter(source => !source.identityAmbiguous && !source.identityConflict);
  }

  buildIndex(scope, sources, previousIndex, options = {}) {
    const diagnostics = { scannedSummaryCount: sources.length, titledSummaryCount: 0, candidateItemCount: 0,
      skipReasons: {}, noTitleCount: 0, noMattersCount: 0, ambiguousSummaryCount: 0 };
    const priorSources = previousIndex?.sourceSummaries || [];
    const keyedSources = this.bindLegacySourceKeys(scope, sources, priorSources, diagnostics);
    const items = [], sourceSummaries = [];
    for (const source of keyedSources) {
      const summary = source.rawSummary;
      const date = sourceDate(summary);
      const summaryMetadata = {
        sourceSummaryKey: source.sourceSummaryKey,
        sourceRevision: source.sourceRevision,
        sourceMemoryId: source.sourceMemoryId,
        conversationDate: date?.canonical || null,
        conversationTotalDays: source.conversationTotalDays,
        relativeSummaryPath: source.relativeSummaryPath,
        folderName: source.folderName,
        conversationFile: source.conversationFile,
        summaryIndex: source.summaryIndex,
        conversationId: source.conversationId,
        finalizationId: source.finalizationId,
        projectionId: source.projectionId,
        interactionEvidence: source.interactionEvidence,
        legacySource: source.legacySource === true
      };
      sourceSummaries.push(summaryMetadata);
      if (!date) {
        diagnostics.skipReasons.MISSING_OR_INVALID_DATE = (diagnostics.skipReasons.MISSING_OR_INVALID_DATE || 0) + 1;
        continue;
      }
      const parsed = pairMatters.parseImportantMatters(summary.content);
      if (parsed.status === "NO_TITLE") {
        diagnostics.noTitleCount++;
        diagnostics.skipReasons.NO_IMPORTANT_MATTERS_TITLE = (diagnostics.skipReasons.NO_IMPORTANT_MATTERS_TITLE || 0) + 1;
        continue;
      }
      if (parsed.status === "NO_IMPORTANT_MATTERS") {
        diagnostics.noMattersCount++;
        diagnostics.skipReasons.NO_IMPORTANT_MATTERS = (diagnostics.skipReasons.NO_IMPORTANT_MATTERS || 0) + 1;
        continue;
      }
      if (parsed.status === "INVALID_CONTENT") {
        diagnostics.skipReasons.SUMMARY_CONTENT_INVALID = (diagnostics.skipReasons.SUMMARY_CONTENT_INVALID || 0) + 1;
        continue;
      }
      diagnostics.titledSummaryCount++;
      if (parsed.status === "AMBIGUOUS_ITEM_BOUNDARY") diagnostics.ambiguousSummaryCount++;
      for (const matter of parsed.items) {
        const itemId = `pairitem:${hash(`${source.sourceSummaryKey}|${matter.ordinal}`)}`;
        const text = matter.text;
        items.push({
          schemaVersion: INDEX_SCHEMA_VERSION,
          scope,
          itemId,
          conversationDate: date.canonical,
          conversationTotalDays: source.conversationTotalDays,
          text,
          normalizedSearchText: pairMatters.normalizedSearchText(text),
          searchTerms: pairMatters.searchTerms(text),
          source: {
            sourceType: "LEGACY_DIRECTED_SUMMARY",
            sourceSummaryKey: source.sourceSummaryKey,
            sourceRevision: source.sourceRevision,
            sourceMemoryId: source.sourceMemoryId,
            conversationId: source.conversationId,
            finalizationId: source.finalizationId,
            projectionId: source.projectionId,
            relativeSummaryPath: source.relativeSummaryPath,
            folderName: source.folderName,
            conversationFile: source.conversationFile,
            summaryIndex: source.summaryIndex,
            recordLocator: source.sourceSummaryKey,
            sourceItemOrdinal: matter.ordinal,
            sourceLine: matter.sourceLine
          },
          interactionEvidence: source.interactionEvidence,
          ambiguous: matter.ambiguous === true,
          confirmed: matter.ambiguous !== true
        });
        diagnostics.candidateItemCount++;
      }
    }
    items.sort((left, right) => (safeDate(left.conversationDate)?.serial || 0) - (safeDate(right.conversationDate)?.serial || 0)
      || (Number(left.conversationTotalDays) || 0) - (Number(right.conversationTotalDays) || 0)
      || left.source.sourceSummaryKey.localeCompare(right.source.sourceSummaryKey)
      || left.source.sourceItemOrdinal - right.source.sourceItemOrdinal);
    sourceSummaries.sort((left, right) => (safeDate(left.conversationDate)?.serial || 0) - (safeDate(right.conversationDate)?.serial || 0)
      || left.sourceSummaryKey.localeCompare(right.sourceSummaryKey));
    return {
      schemaVersion: INDEX_SCHEMA_VERSION,
      indexAlgorithmVersion: INDEX_ALGORITHM_VERSION,
      pairScope: scope,
      builtAt: new Date().toISOString(),
      sourceSummaries,
      items,
      diagnostics
    };
  }

  sourceSetDigest(scope, sources) {
    const records = sources.map(source => [source.relativeSummaryPath, source.summaryIndex,
      source.sourceSummaryKey || null, source.sourceRevision]).sort((left, right) => stableJson(left).localeCompare(stableJson(right)));
    return hash(stableJson([scope, records]));
  }

  visibleItems(items, currentGameDate, diagnostics = {}, includeUnconfirmedAmbiguous = false) {
    const current = safeDate(currentGameDate);
    const eligible = (items || []).filter(item => includeUnconfirmedAmbiguous || !item.ambiguous || item.confirmed === true);
    if (!current) {
      diagnostics.currentDateUnavailable = true;
      return eligible.slice();
    }
    return eligible.filter(item => {
      const date = safeDate(item.conversationDate);
      if (date && date.serial <= current.serial) return true;
      diagnostics.futureItemsFiltered = (diagnostics.futureItemsFiltered || 0) + 1;
      return false;
    });
  }

  read(scopeInput, options = {}) {
    const scope = normalizeScope(scopeInput);
    const memories = this.loadSnapshot(scope, options.memories);
    const diagnostics = { scope: { ownerId: scope.ownerId, counterpartId: scope.counterpartId }, scannedSummaryCount: 0, skipReasons: {} };
    const snapshotRevision = this.store.getFolderSummarySnapshotRevision(memories);
    const key = this.scopeKey(scope);
    const cached = this.cache.get(key);
    if (Number.isSafeInteger(snapshotRevision) && cached?.snapshotRevision === snapshotRevision) {
      const items = this.visibleItems(cached.index.items, options.currentGameDate, diagnostics,
        options.includeUnconfirmedAmbiguous === true);
      return { items, sourceSummaries: cached.index.sourceSummaries, sourceRevision: cached.sourceSetDigest,
        cacheHit: true, diagnostics: { ...diagnostics, ...cached.index.diagnostics } };
    }
    const rawSources = this.collectSources(scope, memories, diagnostics);
    const sourceSetDigest = this.sourceSetDigest(scope, rawSources);
    let storedIndex = this.readIndex(scope);
    let previousIndex = storedIndex;
    let sources = this.bindLegacySourceKeys(scope, rawSources, previousIndex?.sourceSummaries || [], diagnostics);
    const indexIsCurrent = previousIndex?.sourceSetDigest === sourceSetDigest
      && this.isIndexShapeValid(previousIndex, scope);
    if (!indexIsCurrent) {
      if (options.readOnly === true && !safeDate(options.currentGameDate) && options.allowHistoricalPreview !== true) {
        return { items: [], sourceSummaries: [], sourceRevision: sourceSetDigest, cacheHit: false,
          diagnostics: { ...diagnostics, currentDateRequired: true, status: "CURRENT_DATE_REQUIRED" } };
      }
      const index = this.buildIndex(scope, sources, previousIndex, options);
      index.sourceSetDigest = sourceSetDigest;
      index.diagnostics.scannedSummaryCount = diagnostics.scannedSummaryCount;
      index.diagnostics.skipReasons = { ...diagnostics.skipReasons, ...index.diagnostics.skipReasons };
      if (options.readOnly !== true) this.writeIndex(scope, index);
      previousIndex = index;
      this.cache.set(key, { scope, sourceSetDigest, index, snapshotRevision });
    } else {
      if (options.readOnly !== true && (!storedIndex || storedIndex.sourceSetDigest !== sourceSetDigest)) {
        this.writeIndex(scope, previousIndex);
      }
      this.cache.set(key, { scope, sourceSetDigest, index: previousIndex, snapshotRevision });
    }
    const items = this.visibleItems(previousIndex.items, options.currentGameDate, diagnostics,
      options.includeUnconfirmedAmbiguous === true);
    return { items, sourceSummaries: previousIndex.sourceSummaries, sourceRevision: sourceSetDigest,
      cacheHit: indexIsCurrent, diagnostics: { ...diagnostics, ...previousIndex.diagnostics,
        skipReasons: { ...diagnostics.skipReasons, ...(previousIndex.diagnostics?.skipReasons || {}) } } };
  }

  sortItems(items, sort = "newest") {
    if (sort !== "newest" && sort !== "oldest") throw makeError("PAIR_INDEX_SORT_INVALID");
    const direction = sort === "newest" ? -1 : 1;
    return items.slice().sort((left, right) => {
      const leftDate = safeDate(left.conversationDate)?.serial;
      const rightDate = safeDate(right.conversationDate)?.serial;
      if (Number.isFinite(leftDate) && Number.isFinite(rightDate) && leftDate !== rightDate) return (leftDate - rightDate) * direction;
      if (Number.isFinite(leftDate) !== Number.isFinite(rightDate)) return Number.isFinite(leftDate) ? -1 : 1;
      const leftDays = Number(left.conversationTotalDays), rightDays = Number(right.conversationTotalDays);
      if (Number.isFinite(leftDays) && Number.isFinite(rightDays) && leftDays !== rightDays) return (leftDays - rightDays) * direction;
      if (Number.isFinite(leftDays) !== Number.isFinite(rightDays)) return Number.isFinite(leftDays) ? -1 : 1;
      return left.source.sourceSummaryKey.localeCompare(right.source.sourceSummaryKey)
        || left.source.sourceItemOrdinal - right.source.sourceItemOrdinal;
    });
  }

  get(scopeInput, options = {}) {
    const result = this.read(scopeInput, options);
    const search = pairMatters.normalizedSearchText(options.search || "");
    const terms = pairMatters.searchTerms(options.search || "");
    const fromDate = options.fromDate ? safeDate(options.fromDate) : null;
    const toDate = options.toDate ? safeDate(options.toDate) : null;
    if (options.fromDate && !fromDate || options.toDate && !toDate) throw makeError("PAIR_INDEX_DATE_FILTER_INVALID");
    let items = result.items.filter(item => {
      const date = safeDate(item.conversationDate);
      if (fromDate && date && date.serial < fromDate.serial) return false;
      if (toDate && date && date.serial > toDate.serial) return false;
      if (!search) return true;
      return terms.length ? terms.every(term => item.searchTerms.includes(term)) : item.normalizedSearchText.includes(search);
    });
    items = this.sortItems(items, options.sort || "newest");
    const totalCount = items.length;
    const page = Number.isSafeInteger(Number(options.page)) && Number(options.page) >= 0 ? Number(options.page) : 0;
    const requestedSize = Number(options.pageSize);
    const pageSize = Number.isSafeInteger(requestedSize) && requestedSize > 0 ? Math.min(requestedSize, MAX_PAGE_SIZE) : 20;
    const pageItems = items.slice(page * pageSize, (page + 1) * pageSize);
    const sourceKeys = new Set(pageItems.map(item => item.source.sourceSummaryKey));
    const sourceSummaries = result.sourceSummaries.filter(source => sourceKeys.has(source.sourceSummaryKey));
    return { ...result, items: pageItems, sourceSummaries, totalCount, page, pageSize,
      diagnostics: { ...result.diagnostics, indexMiss: !!search && totalCount === 0 } };
  }

  preview(scopeInput, options = {}) {
    const scope = normalizeScope(scopeInput);
    const result = this.read(scope, { ...options, readOnly: true, includeUnconfirmedAmbiguous: true });
    const previous = this.readIndex(scope);
    const currentItems = result.items;
    const previousItems = previous?.items || [];
    const currentById = new Map(currentItems.map(item => [item.itemId, item]));
    const previousById = new Map(previousItems.map(item => [item.itemId, item]));
    let newCount = 0, updatedCount = 0, existingCount = 0;
    for (const item of currentItems) {
      const before = previousById.get(item.itemId);
      if (!before) newCount++;
      else if (before.text !== item.text || before.source.sourceRevision !== item.source.sourceRevision) updatedCount++;
      else existingCount++;
    }
    const removedCount = previousItems.filter(item => !currentById.has(item.itemId)).length;
    const counts = {
      scannedSummaryCount: result.diagnostics.scannedSummaryCount || 0,
      titledSummaryCount: result.diagnostics.titledSummaryCount || 0,
      candidateItemCount: currentItems.length,
      newCount, updatedCount, existingCount, removedCount,
      skippedCount: Object.values(result.diagnostics.skipReasons || {}).reduce((sum, value) => sum + Number(value || 0), 0),
      skipReasons: result.diagnostics.skipReasons || {}
    };
    const previewRevision = hash(stableJson({ scope, sourceRevision: result.sourceRevision,
      priorSourceRevision: previous?.sourceSetDigest || null,
      candidates: currentItems.map(item => [item.itemId, item.source.sourceRevision]) }));
    return { counts, sourceRevision: result.sourceRevision, previewRevision,
      pairs: [{ scope, counts, items: currentItems, sourceSummaries: result.sourceSummaries }], diagnostics: result.diagnostics };
  }

  apply(scopeInput, { previewRevision, ...options } = {}) {
    if (options.readOnly === true || options.allowHistoricalPreview === true) throw makeError("PAIR_INDEX_READ_ONLY");
    if (typeof previewRevision !== "string" || !/^[a-f0-9]{64}$/u.test(previewRevision)) throw makeError("PAIR_INDEX_PREVIEW_REQUIRED");
    const preview = this.preview(scopeInput, options);
    if (preview.previewRevision !== previewRevision) throw makeError("PAIR_INDEX_PREVIEW_STALE");
    const scope = normalizeScope(scopeInput);
    const read = this.read(scope, { ...options, readOnly: true });
    if (read.sourceRevision !== preview.sourceRevision) throw makeError("PAIR_INDEX_PREVIEW_STALE");
    const cacheKey = this.scopeKey(scope);
    const index = this.cache.get(cacheKey)?.index;
    if (!index || index.sourceSetDigest !== read.sourceRevision) throw makeError("PAIR_INDEX_SOURCE_UNSTABLE");
    const confirmedIndex = { ...index, items: index.items.map(item => item.ambiguous ? { ...item, confirmed: true } : item) };
    this.writeIndex(scope, confirmedIndex);
    const cacheEntry = this.cache.get(cacheKey);
    this.cache.set(cacheKey, { ...cacheEntry, index: confirmedIndex });
    return { success: true, counts: preview.counts, sourceRevision: read.sourceRevision,
      previewRevision, pairs: [{ scope, itemCount: index.items.length }], diagnostics: read.diagnostics };
  }

  resolveSource(scopeInput, { sourceSummaryKey, sourceRevision } = {}, options = {}) {
    const scope = normalizeScope(scopeInput);
    if (typeof sourceSummaryKey !== "string" || !sourceSummaryKey || typeof sourceRevision !== "string"
      || !/^[a-f0-9]{64}$/u.test(sourceRevision)) throw makeError("PAIR_INDEX_SOURCE_POINTER_INVALID");
    const memories = this.loadSnapshot(scope, options.memories);
    const diagnostics = { scope: { ownerId: scope.ownerId, counterpartId: scope.counterpartId }, scannedSummaryCount: 0, skipReasons: {} };
    const currentIndex = this.read(scope, { ...options, memories, readOnly: true });
    const source = currentIndex.sourceSummaries.filter(item => item.sourceSummaryKey === sourceSummaryKey
      && item.sourceRevision === sourceRevision);
    if (source.length !== 1) throw makeError(source.length ? "SOURCE_IDENTITY_AMBIGUOUS" : "SOURCE_UNAVAILABLE_OR_STALE");
    const locator = source[0];
    const currentMemories = this.loadSnapshot(scope);
    const rawSources = this.collectSources(scope, currentMemories, diagnostics);
    const boundSources = this.bindLegacySourceKeys(scope, rawSources, currentIndex.sourceSummaries, diagnostics);
    const exact = boundSources.filter(item => item.sourceSummaryKey === sourceSummaryKey
      && item.sourceRevision === sourceRevision && item.relativeSummaryPath === locator.relativeSummaryPath
      && item.summaryIndex === locator.summaryIndex);
    if (exact.length !== 1) throw makeError(exact.length ? "SOURCE_IDENTITY_AMBIGUOUS" : "SOURCE_UNAVAILABLE_OR_STALE");
    const rawSummary = exact[0].rawSummary;
    const date = sourceDate(rawSummary);
    const currentDate = safeDate(options.currentGameDate);
    if (currentDate && date && date.serial > currentDate.serial) throw makeError("SOURCE_UNAVAILABLE_OR_STALE");
    return { success: true, sourceSummaryKey, sourceRevision, summary: JSON.parse(JSON.stringify(rawSummary)),
      locator: { folderName: locator.folderName, conversationFile: locator.conversationFile,
        summaryIndex: locator.summaryIndex, relativeSummaryPath: locator.relativeSummaryPath },
      interactionEvidence: locator.interactionEvidence };
  }
}

module.exports = PairLongTermLedger;
