"use strict";

const fs = require("fs");
const path = require("path");
const { assertScope, hash, ids, strings, legacySourceHash, directCounterpartIds, validateEntry } = require("./memory4-contract");
const { projectVisibleTranscript } = require("./memory4-visibility");
const { getFactCandidates, disclosureFactId, scanVisibleDisclosures, scanLetterDisclosures } = require("./memory4-disclosure");
const { Memory4Store } = require("./memory4-store");
const { Memory4ProfileService } = require("./memory4-profile");
const { Memory4RelationshipReadback } = require("./memory4-relationship-readback");
const { Memory4DerivedService } = require("./memory4-derived");
const { buildMemory4EntityContext } = require("./memory4-entity-context");
const { validateGenerationOutcome } = require("../providers/generation-outcome");
const { validateSourceItem, presentIds, sourceParagraphSegments } = require("./finalization-visibility");
const { MentionTracker } = require("./mention-tracker");
const { normalizeGameDate } = require("../worldline/character-temporal-facts");

const MAX_FRAGMENTS_PER_REQUEST = 128;
const MAX_DURABLE_ENTRIES_PER_OWNER = 8;
const DURABLE_MAX_OUTPUT_TOKENS = 4096;

function disclosureCharacterRows(value) {
  const rows = value instanceof Map ? [...value.values()] : Array.isArray(value) ? value
    : value && typeof value === "object" ? Object.values(value) : [];
  return rows.map(character => {
    const id = Number(character?.id);
    if (!Number.isSafeInteger(id) || id <= 0) return null;
    const names = [...new Set((Array.isArray(character.names) ? character.names
      : [character.firstName, character.shortName, character.fullName, character.name])
      .filter(name => typeof name === "string" && name.trim()).map(name => name.trim()))];
    return { id, names, nickname: typeof character.nickname === "string" && character.nickname.trim() ? character.nickname.trim() : null,
      facts: getFactCandidates(character) };
  }).filter(Boolean);
}

function disclosureCharacterMap(rows) {
  const characters = disclosureCharacterRows(rows);
  const result = new Map();
  for (const character of characters) {
    if (result.has(character.id)) throw new Error("memory4_disclosure_character_duplicate");
    result.set(character.id, character);
  }
  return result;
}

function disclosureCharacterHash(characters) {
  return hash([...characters.values()].sort((left, right) => left.id - right.id));
}

class Memory4Coordinator {
  constructor(store, { trace = null } = {}) {
    this.store = new Memory4Store(store);
    this.profiles = new Memory4ProfileService(this.store);
    this.relationshipReadback = new Memory4RelationshipReadback();
    this.baseStore = store;
    this.trace = trace;
    this.recoveryDir = store.paths.memory4Recovery;
    this.inFlight = new Set();
    this.derived = new Memory4DerivedService(this);
    this.store.derived = this.derived;
    this.lazyInFlight = new Set();
  }

  configureDerived(options = {}) { this.derived.configure(options); }

  legacySource(scope, memoryId) {
    const memories = this.baseStore.loadFolderSummariesForCharacter(scope.ownerId);
    return memories.find(memory => memory.memoryId === memoryId) || this.baseStore.getMemory(memoryId) || null;
  }

  legacyFacts(scope, memory) {
    if (!memory || memory.deleted || memory.provenance?.campaignToken !== scope.campaignToken
      || memory.provenance?.folderOwnerId !== scope.ownerId || !ids(memory.knownBy).includes(scope.ownerId)
      || memory.subtype === "official_recollection" || memory.sourceType === "CK3_OFFICIAL_RECOLLECTION") return [];
    const sourceIds = memory.provenance?.perspectiveMemoryIds || [];
    if (!sourceIds.length) return memory.updatedBy === "user" && memory.provenance.extractionMode === "user_edited_summary" ? [memory] : [];
    const sources = sourceIds.map(id => this.baseStore.getMemory(id));
    const header = memory.content.match(/^【[^\n]*能够知道并记住的本场内容】\n/);
    if (!header || sources.some(source => !source || source.deleted || source.provenance?.campaignToken !== scope.campaignToken
      || source.provenance?.folderOwnerId !== scope.ownerId || !ids(source.knownBy).includes(scope.ownerId))
      || memory.content !== header[0] + sources.map(source => `- ${source.content}`).join("\n")) return [];
    return sources;
  }

  isLegacyRecompressionSnapshotCurrent(snapshot) {
    if (snapshot?.legacyRecompression !== true || snapshot.summaryIds?.length !== 1
      || snapshot.summaryIds[0] !== snapshot.legacySourceMemoryId || !Array.isArray(snapshot.fragments) || !snapshot.fragments.length) return false;
    try {
      const scope = { campaignToken: snapshot.campaignToken, ownerId: snapshot.ownerId };
      const source = this.legacySource(scope, snapshot.legacySourceMemoryId);
      if (snapshot.legacyArchiveScope === true) this.store.assertPersistedScope(scope);
      if (!source || legacySourceHash(source) !== snapshot.legacySourceProof) return false;
      const facts = new Map(this.legacyFacts(scope, source).map(fact => [fact.memoryId, fact]));
      if (!Array.isArray(snapshot.legacySourceFactProofs) || snapshot.legacySourceFactProofs.length !== facts.size
        || !snapshot.legacySourceFactProofs.every(([id, proof]) => facts.has(id) && legacySourceHash(facts.get(id)) === proof)) return false;
      return snapshot.fragments.every(fragment => {
        const fact = facts.get(fragment.legacyMemoryId);
        return !!fact && fragment.text === fact.content && fragment.legacySourceHash === legacySourceHash(fact);
      });
    } catch { return false; }
  }

  getLegacyCoverage(scope, memories = []) {
    assertScope(scope);
    scope = { campaignToken: scope.campaignToken, ownerId: scope.ownerId };
    const index = this.store.loadIndex(scope);
    const items = memories.map(memory => {
      const facts = this.legacyFacts(scope, memory), refs = [];
      for (const [entryId, row] of Object.entries(index.entries)) for (const ref of row.legacyRefs || []) {
        if (facts.some(fact => fact.memoryId === ref.memoryId && legacySourceHash(fact) === ref.sourceHash)) refs.push({ entryId, ...ref });
      }
      const suppressed = new Set(refs.filter(ref => ref.complete).map(ref => ref.memoryId));
      return { memoryId: memory.memoryId, sourceHash: legacySourceHash(memory), convertedEntryIds: strings(refs.map(ref => ref.entryId)),
        suppressedFacts: suppressed.size, retainedFacts: Math.max(1, facts.length) - suppressed.size,
        partial: refs.length > 0 && suppressed.size < facts.length, eligible: facts.some(fact => !refs.some(ref => ref.memoryId === fact.memoryId)),
        reason: facts.length ? null : "UNPROVEN_FRAGMENT_BOUNDARY" };
    });
    return { items, counts: { eligible: items.filter(item => item.eligible).length, partial: items.filter(item => item.partial).length,
      retained: items.filter(item => item.retainedFacts > 0).length } };
  }

  async recompressLegacy(scope, { memoryId, expectedSourceHash = null, providerSnapshot = null,
    isCurrent = () => true, allowPersistedArchive = false, rebuildDerived = false } = {}) {
    assertScope(scope);
    scope = { campaignToken: scope.campaignToken, ownerId: scope.ownerId };
    if (allowPersistedArchive) this.store.assertPersistedScope(scope);
    const key = hash([scope, memoryId]);
    const rebuildDerivedViews = proof => this.derived.rebuild(scope, { kind: "all", providerSnapshot, committedFinalization: true,
      finalizationProof: proof }).catch(error => ({ status: "FAILED", kind: "all", reason: String(error?.message || error) }));
    if (this.lazyInFlight.has(key)) return { status: "IN_PROGRESS", sourceMemoryId: memoryId, entryIds: [], retained: true };
    const source = this.legacySource(scope, memoryId);
    const sourceFacts = this.legacyFacts(scope, source);
    let facts = sourceFacts;
    if (!source || expectedSourceHash && legacySourceHash(source) !== expectedSourceHash) return { status: "STALE", sourceMemoryId: memoryId, entryIds: [], retained: true };
    if (!facts.length) return { status: "RETAINED_LEGACY", sourceMemoryId: memoryId, entryIds: [], retained: true, reason: "UNPROVEN_FRAGMENT_BOUNDARY" };
    const sourceHash = legacySourceHash(source), sourceProofs = sourceFacts.map(memory => [memory.memoryId, legacySourceHash(memory)]);
    const current = () => (allowPersistedArchive || !this.derived.options.isCampaignCurrent || this.derived.options.isCampaignCurrent(scope.campaignToken))
      && isCurrent() && legacySourceHash(this.legacySource(scope, memoryId) || {}) === sourceHash
      && sourceProofs.every(([id, proof]) => {
        const memory = this.baseStore.getMemory(id);
        return memory && legacySourceHash(memory) === proof;
      });
    const legacyFragments = memories => memories.map(memory => ({ fragmentId: `legacy_${hash([memory.memoryId, legacySourceHash(memory)])}`,
      messageId: null, sourceMessageIds: [], text: memory.content,
      speakerId: ids(memory.provenance?.speakerIds).length === 1 ? ids(memory.provenance.speakerIds)[0] : scope.ownerId,
      presentIds: [scope.ownerId], knownBy: [scope.ownerId], visibility: "private", sourceType: "reported", recipientIds: [],
      entityIds: ids(memory.subjects), visibilityEvidence: "legacy_independent_owner_fact", legacyMemoryId: memory.memoryId,
      legacySourceHash: legacySourceHash(memory), legacyAnchorGameDate: memory.eventDate || source.eventDate || null }));
    const index = this.store.loadIndex(scope);
    const covered = new Set(Object.values(index.entries).flatMap(row => (row.legacyRefs || []).filter(ref =>
      facts.some(fact => fact.memoryId === ref.memoryId && legacySourceHash(fact) === ref.sourceHash)).map(ref => ref.memoryId)));
    facts = facts.filter(fact => !covered.has(fact.memoryId)).slice(0, MAX_DURABLE_ENTRIES_PER_OWNER);
    if (!facts.length) {
      if (rebuildDerived) {
        const coveredProof = Object.entries(index.entries).filter(([entryId, row]) => !row.deleted
          && (row.legacyRefs || []).some(ref => sourceFacts.some(fact =>
            fact.memoryId === ref.memoryId && legacySourceHash(fact) === ref.sourceHash))
          && index.finalizations[hash(row.finalizationId)]?.status === "STORE"
          && index.finalizations[hash(row.finalizationId)]?.entryIds?.includes(entryId))
          .sort((left, right) => String(left[1].finalizationId).localeCompare(String(right[1].finalizationId)))[0];
        const record = coveredProof && index.finalizations[hash(coveredProof[1].finalizationId)];
        if (coveredProof && record?.sourceRevision) {
          if (!current()) return { status: "CANCELLED", sourceMemoryId: memoryId, entryIds: [], retained: true };
          const snapshot = { ...scope, conversationId: `legacy_${hash([memoryId, scope, sourceProofs])}`,
            finalizationId: coveredProof[1].finalizationId, sourceRevision: record.sourceRevision,
            episodeId: null, date: source.eventDate || null, totalDays: source.totalDays ?? null,
            fragments: legacyFragments(sourceFacts), presentMessageCount: 0, completeness: "partial", counterpartIds: [], summaryIds: [memoryId],
            legacyRetained: true, skipKnownEvidence: true, legacyRecompression: true, legacySourceMemoryId: memoryId,
            legacySourceProof: sourceHash, legacySourceFactProofs: sourceProofs, legacyArchiveScope: allowPersistedArchive === true,
            summaryProviderSnapshot: providerSnapshot };
          const recoveryFile = this.recoveryPath(snapshot), priorRecovery = this.readRecovery(recoveryFile);
          this.saveRecovery(snapshot, { status: "PENDING", retryCount: priorRecovery?.retryCount || 0, lastError: null });
          const derived = await rebuildDerivedViews({ finalizationId: coveredProof[1].finalizationId, sourceRevision: record.sourceRevision });
          if (["COMPLETE", "MANUAL_OVERRIDE"].includes(derived?.status)) {
            if (fs.existsSync(recoveryFile)) { this.readRecovery(recoveryFile); fs.unlinkSync(recoveryFile); }
          } else this.saveRecovery(snapshot, { status: "DERIVED_REBUILD_FAILED", retryCount: priorRecovery?.retryCount || 0,
            lastError: String(derived?.reason || derived?.status || "memory4_derived_failed") });
          return { status: "ALREADY_CONVERTED", canonical: { status: "ALREADY_CONVERTED", entryIds: [] }, derived,
            sourceMemoryId: memoryId, entryIds: [], retained: true };
        }
        return { status: "ALREADY_CONVERTED", canonical: { status: "ALREADY_CONVERTED", entryIds: [] },
          derived: { status: "FAILED", kind: "all", reason: "COMMITTED_SOURCE_PROOF_UNAVAILABLE" },
          sourceMemoryId: memoryId, entryIds: [], retained: true };
      }
      return { status: "ALREADY_CONVERTED", sourceMemoryId: memoryId, entryIds: [], retained: true };
    }
    const proofs = facts.map(memory => [memory.memoryId, legacySourceHash(memory)]);
    const fragments = legacyFragments(facts);
    const snapshot = { ...scope, conversationId: `legacy_${hash([memoryId, scope, proofs])}`, finalizationId: `legacy_${hash([scope, memoryId, sourceHash, proofs])}`,
      episodeId: null, date: source.eventDate || null, totalDays: source.totalDays ?? null, sourceRevision: hash([sourceHash, proofs]),
      fragments, presentMessageCount: 0, completeness: "partial", counterpartIds: [], summaryIds: [memoryId], legacyRetained: true, skipKnownEvidence: true,
      legacyRecompression: true, legacySourceMemoryId: memoryId, legacySourceProof: sourceHash, legacySourceFactProofs: sourceProofs,
      legacyArchiveScope: allowPersistedArchive === true };
    const recoveryFile = this.recoveryPath(snapshot);
    const priorRecovery = this.readRecovery(recoveryFile);
    const clearRecovery = () => {
      if (!fs.existsSync(recoveryFile)) return;
      this.readRecovery(recoveryFile);
      fs.unlinkSync(recoveryFile);
    };
    const persistDerivedRecovery = derived => {
      if (["COMPLETE", "MANUAL_OVERRIDE"].includes(derived?.status)) { clearRecovery(); return; }
      const priorAttempt = this.readRecovery(recoveryFile);
      this.saveRecovery(snapshot, { status: "DERIVED_REBUILD_FAILED", retryCount: priorAttempt?.retryCount || 0,
        lastError: String(derived?.reason || derived?.status || "memory4_derived_failed") });
    };
    const prior = this.store.loadIndex(scope).finalizations[hash(snapshot.finalizationId)];
    if (prior) {
      if (rebuildDerived) {
        if (!current()) return { status: "CANCELLED", sourceMemoryId: memoryId, entryIds: [], retained: true };
        const derived = await rebuildDerivedViews({ finalizationId: snapshot.finalizationId, sourceRevision: snapshot.sourceRevision });
        persistDerivedRecovery(derived);
        return { status: "ALREADY_CONVERTED", canonical: { status: "ALREADY_CONVERTED", entryIds: [...prior.entryIds] }, derived,
          sourceMemoryId: memoryId, entryIds: [...prior.entryIds], retained: true };
      }
      return { status: "ALREADY_CONVERTED", sourceMemoryId: memoryId, entryIds: [...prior.entryIds], retained: true };
    }
    if (typeof this.derived.options.requestExtraction !== "function") {
      this.saveRecovery(snapshot, { status: "EXTRACTION_FAILED", retryCount: Number(priorRecovery?.retryCount || 0) + 1,
        lastError: "memory4_provider_unavailable" });
      return { status: "EXTRACTION_FAILED", sourceMemoryId: memoryId, entryIds: [], retained: true, reason: "memory4_provider_unavailable" };
    }
    this.lazyInFlight.add(key);
    const controller = new AbortController();
    try {
      if (!current()) return { status: "CANCELLED", sourceMemoryId: memoryId, entryIds: [], retained: true };
      this.saveRecovery(snapshot, { status: "PENDING", retryCount: priorRecovery?.retryCount || 0, lastError: null });
      providerSnapshot ||= this.derived.options.getProviderSnapshot ? await this.derived.options.getProviderSnapshot() : null;
      snapshot.summaryProviderSnapshot = providerSnapshot;
      this.saveRecovery(snapshot, { status: "PENDING", retryCount: priorRecovery?.retryCount || 0, lastError: null });
      if (!current()) return { status: this.isLegacyRecompressionSnapshotCurrent(snapshot) ? "CANCELLED" : "STALE",
        sourceMemoryId: memoryId, entryIds: [], retained: true };
      const response = await this.derived.options.requestExtraction(this.buildPrompt(snapshot, fragments), {
        signal: controller.signal, maxTokens: DURABLE_MAX_OUTPUT_TOKENS, providerSnapshot, requestType: "memory4_durable" });
      if (!current()) {
        const sourceCurrent = this.isLegacyRecompressionSnapshotCurrent(snapshot);
        if (!sourceCurrent) clearRecovery();
        return { status: sourceCurrent ? "CANCELLED" : "STALE", sourceMemoryId: memoryId, entryIds: [], retained: true };
      }
      const result = this.parseResult(response, fragments, snapshot);
      if (result.rejectedUnknownEntityCount) this.trace?.record("memory4_candidate_rejected", {
        ownerId: scope.ownerId, count: result.rejectedUnknownEntityCount, reason: "unknown_entity"
      });
      if (!result.entries.length && !result.commitmentTransitions.length && result.rejectedUnknownEntityCount > 0) {
        throw new Error("memory4_response_no_valid_entries");
      }
      if (!result.entries.length && !rebuildDerived) {
        clearRecovery();
        return { status: "RETAINED_LEGACY", sourceMemoryId: memoryId, entryIds: [], retained: true, reason: "NO_DURABLE_CONTENT" };
      }
      const committed = this.store.commitOwner(snapshot, result);
      let derived = null;
      if (rebuildDerived) {
        derived = await rebuildDerivedViews({ finalizationId: snapshot.finalizationId, sourceRevision: snapshot.sourceRevision });
        persistDerivedRecovery(derived);
      } else if (committed.entryIds.length || committed.changedEntryIds?.length) this.derived.schedule(snapshot, { providerSnapshot, committedFinalization: true });
      else clearRecovery();
      const status = result.status === "NO_DURABLE_CONTENT" ? "NO_DURABLE_CONTENT" : "COMPLETE";
      this.trace?.record("memory4_legacy_recompression", { ownerId: scope.ownerId, status, count: committed.entryIds.length });
      return { status, ...(rebuildDerived ? { canonical: { status, entryIds: [...committed.entryIds] }, derived } : {}),
        sourceMemoryId: memoryId, entryIds: [...committed.entryIds], retained: true };
    } catch (error) {
      this.trace?.record("memory4_legacy_recompression", { ownerId: scope.ownerId, status: "EXTRACTION_FAILED", errorCode: error.message });
      if (!this.isLegacyRecompressionSnapshotCurrent(snapshot)) clearRecovery();
      else if (current()) this.saveRecovery(snapshot, { status: "EXTRACTION_FAILED", retryCount: Number(this.readRecovery(recoveryFile)?.retryCount || 0) + 1,
        lastError: String(error?.message || error) });
      return { status: "EXTRACTION_FAILED", sourceMemoryId: memoryId, entryIds: [], retained: true, reason: error.message };
    } finally { this.lazyInFlight.delete(key); }
  }

  queueLegacyRecompression(scope, { sourceRefs = [], providerSnapshot = null } = {}) {
    assertScope(scope);
    scope = { campaignToken: scope.campaignToken, ownerId: scope.ownerId };
    const ids = strings(sourceRefs.filter(ref => ref.kind === "legacy").map(ref => ref.parentId || ref.id));
    for (const memoryId of ids) setImmediate(() => this.recompressLegacy(scope, { memoryId, providerSnapshot }).catch(() => {}));
    return { queued: ids.length };
  }

  getKnownEntityProfile(scope, entityId, options = {}) {
    return this.profiles.getProfile(scope, entityId, options);
  }

  getCurrentDisclosures(scope, entityId, gameData, { readContext = null, currentGameDate = null } = {}) {
    return this.store.getCurrentDisclosures(scope, Number(entityId), gameData, { readContext, currentGameDate });
  }

  refreshCurrentFactState(scope, gameData, options = {}) {
    assertScope(scope);
    if (gameData?.campaignToken !== scope.campaignToken || !normalizeGameDate(gameData?.date)) throw new Error("memory4_disclosure_current_scope_invalid");
    this.store.ensureDisclosureScope(scope);
    const result = this.store.refreshCurrentFactState(scope, gameData, options);
    if (result.changed) this.profiles.invalidate(scope);
    return result;
  }

  captureDisclosureFactEpochs(scope, gameData) {
    const { currentFactState } = this.refreshCurrentFactState(scope, gameData);
    return Object.fromEntries(Object.entries(currentFactState).map(([entityId, facts]) => [entityId,
      Object.fromEntries(Object.entries(facts).filter(([, state]) => state.present).map(([key, state]) => [key, state.epoch]))]));
  }

  updateManualDisclosure(scope, entityId, factRef, status, gameData, { expectedRevision } = {}) {
    assertScope(scope);
    const targetId = Number(entityId);
    if (gameData?.campaignToken !== scope.campaignToken || !gameData?.date || !Number.isSafeInteger(targetId)
      || targetId <= 0 || targetId === scope.ownerId) throw new Error("memory4_disclosure_current_scope_invalid");
    const rows = disclosureCharacterRows(gameData.characters);
    const character = rows.find(candidate => candidate.id === targetId);
    const candidate = getFactCandidates(character).find(item => item.factType === factRef?.factType
      && item.factKey === factRef?.factKey && item.value === factRef?.value);
    if (!candidate || factRef.factId != null
      && factRef.factId !== disclosureFactId(scope, targetId, candidate.factType, candidate.factKey)) {
      throw new Error("memory4_disclosure_fact_not_current");
    }
    this.refreshCurrentFactState(scope, gameData);
    const current = this.getCurrentDisclosures(scope, targetId, gameData).find(item => item.factType === candidate.factType && item.factKey === candidate.factKey);
    if (factRef.factEpoch != null && factRef.factEpoch !== current?.factEpoch) throw new Error("memory4_disclosure_revision_stale");
    this.store.updateManualDisclosure(scope, targetId, candidate, status, gameData.date, expectedRevision);
    this.profiles.invalidate(scope);
    const factId = disclosureFactId(scope, targetId, candidate.factType, candidate.factKey);
    return this.getCurrentDisclosures(scope, targetId, gameData).find(row => row.factId === factId) || null;
  }

  deleteDisclosure(scope, entityId, factRef, gameData, { expectedRevision } = {}) {
    return this.updateManualDisclosure(scope, entityId, factRef, "MANUAL_HIDDEN", gameData, { expectedRevision });
  }

  recordDisclosures(snapshot, { campaignToken = snapshot?.campaignToken, date = snapshot?.date, characters = snapshot?.disclosureCharacters } = {}) {
    if (!Array.isArray(snapshot?.disclosureCharacters) || !snapshot.disclosureCharacters.length) {
      return { status: "SKIPPED", changed: false, count: 0, entityIds: [], skipped: "disclosure_characters_missing" };
    }
    if (campaignToken !== snapshot.campaignToken || date !== snapshot.date) {
      throw new Error("memory4_disclosure_snapshot_mismatch");
    }
    const snapshotCharacters = disclosureCharacterMap(snapshot.disclosureCharacters);
    const sourceCharacters = disclosureCharacterMap(characters);
    if (disclosureCharacterHash(snapshotCharacters) !== disclosureCharacterHash(sourceCharacters)) {
      throw new Error("memory4_disclosure_characters_mismatch");
    }
    const gameData = { campaignToken, date, characters: snapshotCharacters };
    const scanned = snapshot.sourceKind === "LETTER"
      ? scanLetterDisclosures(snapshot, gameData, "LETTER", { letterId: snapshot.letterId,
        senderId: Number(snapshot.senderId), recipientId: Number(snapshot.recipientId) })
      : scanVisibleDisclosures(snapshot, gameData);
    if (scanned.skipped) return { status: "SKIPPED", changed: false, count: 0, entityIds: [], skipped: scanned.skipped };
    if (snapshot.sourceKind === "LETTER") {
      const letterScope = { campaignToken: snapshot.campaignToken, ownerId: snapshot.ownerId };
      if (scanned.disclosures.length) this.store.ensureDisclosureScope(letterScope);
      else {
        try { this.store.directory(letterScope); }
        catch (error) {
          if (error.message === "memory4_owner_folder_not_unique") {
            return { status: "NO_DISCLOSURE", changed: false, count: 0, entityIds: [], skipped: null };
          }
          throw error;
        }
      }
    }
    const scope = { campaignToken: snapshot.campaignToken, ownerId: snapshot.ownerId };
    if (snapshot.sourceKind !== "LETTER") {
      const metadata = this.store.read(path.join(this.store.directory(scope), "metadata.json"), null);
      if (metadata?.knownEvidenceRevisions?.[hash([snapshot.conversationId, scope.ownerId])] !== snapshot.sourceRevision) {
        return { status: "SKIPPED", changed: false, count: 0, entityIds: [], stale: true, skipped: "source_revision_stale" };
      }
    }
    // Frozen recovery is not a newer CK3 observation, especially within the same game day.
    this.refreshCurrentFactState(scope, gameData, { historical: true });
    const persisted = this.store.recordDisclosures(snapshot, scanned.disclosures);
    if (persisted.changed) this.profiles.invalidate({ campaignToken: snapshot.campaignToken, ownerId: snapshot.ownerId });
    this.trace?.record("memory4_disclosure", { ownerId: snapshot.ownerId, campaignToken: snapshot.campaignToken,
      sourceKind: snapshot.sourceKind === "LETTER" ? "LETTER" : "CONVERSATION", count: persisted.count,
      changed: persisted.changed });
    return { status: persisted.stale ? "SKIPPED" : persisted.count ? "RECORDED" : "NO_DISCLOSURE", ...persisted,
      skipped: persisted.stale ? "source_revision_stale" : null };
  }

  recordLetterDisclosures({ campaignToken, date, ownerId, senderId, recipientId, letterId, text, characters }) {
    const owner = ids([ownerId])[0], sender = ids([senderId])[0], recipient = ids([recipientId])[0];
    const disclosureCharacters = disclosureCharacterRows(characters);
    if (!campaignToken || !normalizeGameDate(date) || !owner || owner !== recipient || !sender || sender === recipient
      || typeof letterId !== "string" || !letterId.trim() || typeof text !== "string" || !text.trim()
      || !disclosureCharacters.some(character => character.id === sender)
      || !disclosureCharacters.some(character => character.id === recipient)) {
      throw new Error("memory4_disclosure_letter_invalid");
    }
    const snapshot = { campaignToken, ownerId: owner, sourceKind: "LETTER", senderId: sender, recipientId: recipient,
      letterId: letterId.trim(), date: normalizeGameDate(date).canonical,
      disclosureFactEpochs: this.captureDisclosureFactEpochs({ campaignToken, ownerId: owner }, { campaignToken, date, characters }),
      sourceRevision: hash(["LETTER", campaignToken, owner, sender, recipient, letterId.trim(),
        normalizeGameDate(date).canonical, hash(text)]), disclosureCharacters,
      fragments: [{ fragmentId: `letter_${hash([letterId.trim(), sender, recipient])}`, sourceLetterId: letterId.trim(),
        sourceType: "spoken", text: text.trim(), speakerId: sender, presentIds: [sender, recipient],
        knownBy: [recipient], visibility: "private", entityIds: disclosureCharacters.map(character => character.id),
        visibilityEvidence: "validated_letter" }] };
    const result = this.recordDisclosures(snapshot, { campaignToken, date: snapshot.date,
      characters: new Map(disclosureCharacters.map(character => [character.id, character])) });
    return result;
  }

  createProfileReadContext(scope) {
    assertScope(scope);
    scope = { campaignToken: scope.campaignToken, ownerId: scope.ownerId };
    const directory = this.store.directory(scope);
    const context = { scope, index: this.store.loadIndex(scope),
      metadata: this.store.read(path.join(directory, "metadata.json"), null) || {},
      known: this.store.read(path.join(directory, "known-entities.json"), null) || { ...scope, entities: {} },
      snapshots: new Map(), rawYears: new Map() };
    context.derived = this.derived.list(scope, { readContext: context });
    return context;
  }

  observeCK3Readback(gameData, stamp) {
    const changes = this.relationshipReadback.observe(gameData, stamp);
    if (stamp?.complete === true && gameData?.campaignToken && normalizeGameDate(gameData.date)) {
      for (const ownerId of this.store.listExistingDisclosureOwners(gameData.campaignToken)) {
        this.refreshCurrentFactState({ campaignToken: gameData.campaignToken, ownerId }, gameData);
      }
    }
    for (const change of changes) this.profiles.invalidate({ campaignToken: change.campaignToken, ownerId: change.ownerId });
    return changes;
  }

  recoveryPath(snapshot) {
    assertScope(snapshot);
    if (!snapshot.finalizationId) throw new Error("memory4_finalization_required");
    return path.join(this.recoveryDir, `${hash([snapshot.campaignToken, snapshot.ownerId, snapshot.finalizationId])}.json`);
  }

  readRecovery(file) {
    if (!fs.existsSync(file)) return null;
    if (fs.lstatSync(file).isSymbolicLink()) throw new Error("memory4_recovery_symlink");
    try {
      const record = JSON.parse(fs.readFileSync(file, "utf8"));
      if (record?.schemaVersion !== 1 || !record.snapshot || this.recoveryPath(record.snapshot) !== file) throw new Error();
      return record;
    }
    catch { throw new Error("memory4_recovery_corrupt"); }
  }

  saveRecovery(snapshot, state) {
    const file = this.recoveryPath(snapshot);
    this.baseStore.writeJson(file, { schemaVersion: 1, snapshot, ...state, updatedAt: new Date().toISOString() });
    return file;
  }

  getRecoveryStatus(activeCampaignToken) {
    if (!activeCampaignToken || !fs.existsSync(this.recoveryDir)) return { pending: 0, manual: 0, balanceBlocked: 0 };
    let pending = 0, manual = 0, balanceBlocked = 0, invalid = 0;
    for (const name of fs.readdirSync(this.recoveryDir).filter(name => /^[a-f0-9]{64}\.json$/.test(name))) {
      let record;
      try { record = this.readRecovery(path.join(this.recoveryDir, name)); }
      catch { invalid++; continue; }
      if (record?.snapshot?.campaignToken !== activeCampaignToken) continue;
      pending++;
      if (Number(record.retryCount || 0) >= 3) manual++;
      if (/402|insufficient balance/i.test(record.lastError || "")) balanceBlocked++;
    }
    return { pending, manual, balanceBlocked, invalid };
  }

  buildOwnerSnapshot(context, ownerId) {
    const projection = projectVisibleTranscript(context, ownerId);
    const verifiedTexts = new Map();
    const entityProfiles = [...(context.participants || []), ...(context.mentionedEntities || [])];
    const mentionTracker = new MentionTracker();
    for (const segment of context.verifiedSummarySegments || []) {
      const verified = validateSourceItem(segment, context, { segment: true });
      if (!verified.success) throw new Error(`memory4_visibility_source_invalid:${verified.reason}`);
      if (JSON.stringify(ids(segment.knownBy)) !== JSON.stringify(ids(verified.audience))) throw new Error("memory4_known_by_mismatch");
      for (const messageId of verified.messageIds) {
        if (!verifiedTexts.has(messageId)) verifiedTexts.set(messageId, []);
        verifiedTexts.get(messageId).push(String(segment.content || ""));
      }
      if (!verified.audience.includes(ownerId) || !verified.speakers.length) continue;
      if (!segment.segmentId) throw new Error("memory4_segment_id_required");
      const speaker = verified.speakers[0];
      const text = String(segment.content || "");
      const sourceTextVerified = verified.messageIds.some(messageId => (context.messages || []).find(message => message.id === messageId)?.content
        .split(/\r?\n/).some(paragraph => paragraph.trim() === text.trim()));
      const recipientIds = ids(verified.audience.filter((id) => {
        if (id === speaker) return false;
        if (segment.visibility === "known_group") return true;
        if (!sourceTextVerified) return false;
        const person = (context.participants || []).find((entry) => Number(entry.id) === id);
        return [person?.name, person?.fullName, person?.shortName].filter(Boolean)
          .some((name) => ["对", "向", "告诉", "问"].some((cue) => text.includes(`${cue}${name}`)));
      }));
      const sourceRole = verified.messageIds.length === 1 && verified.speakers.length === 1
        ? (context.messages || []).find(message => Number(message.id) === verified.messageIds[0])?.role : "mixed";
      const entityIds = ids(mentionTracker.findMentionedCharacterIds([{ content: text }], { candidates: entityProfiles, resolveCoreference: false }));
      projection.fragments.push({ fragmentId: `segment_${segment.segmentId}`, messageId: verified.messageIds[0],
        sourceMessageIds: verified.messageIds, text, speakerId: speaker, speakerIds: verified.speakers,
        sourceTextVerified, sourceRole,
        presentIds: ids(verified.messageIds.reduce((common, messageId) =>
          common === null ? presentIds(context, messageId) : common.filter((id) => presentIds(context, messageId).includes(id)), null)),
        knownBy: ids(verified.audience), visibility: segment.visibility,
        sourceType: segment.source, recipientIds,
        entityIds, visibilityEvidence: "finalization_validated_segment" });
    }
    for (const message of context.messages || []) {
      // Only native Finalization can authorize raw paragraphs; legacy gaps stay withheld.
      if (context.finalizationVisibilityV1 !== true) continue;
      if (!Number.isSafeInteger(message.id) || !["user", "assistant"].includes(message.role)) continue;
      // Existing annotations own this message's boundaries; unmarked gaps remain withheld.
      if (Array.isArray(message.memory4Fragments) && message.memory4Fragments.length) continue;
      const restrictUnmarked = (context.verifiedSummarySegments || []).some(segment =>
        ["private", "known_group"].includes(segment.visibility)
          && Array.isArray(segment.provenance?.messageIds) && segment.provenance.messageIds.includes(message.id));
      const sourceParagraphs = sourceParagraphSegments(context, message, restrictUnmarked);
      if (!sourceParagraphs) continue;
      for (const [paragraphIndex, paragraph] of sourceParagraphs.entries()) {
        const verified = validateSourceItem(paragraph, context, { segment: true });
        if (!verified.success || verified.source !== "spoken" || !verified.audience.includes(ownerId)
          || verified.speakers.length !== 1) continue;
        const text = String(paragraph.content || "");
        if (message.role === "assistant" && !/"[^"]+"|“[^”]+”|‘[^’]+’|'[^']+'|「[^」]+」|『[^』]+』/u.test(text)
          && !/^(?:我|吾|朕|寡人|孤|本王|在下|鄙人|本人)/u.test(text.trim())) continue;
        const sourceTextVerified = String(message.content || "").split(/\r?\n/)
          .some(sourceParagraph => sourceParagraph.trim() === text.trim());
        if (!sourceTextVerified) continue;
        const speaker = verified.speakers[0];
        const sameSourceFragment = projection.fragments.some(fragment => fragment.text === text
          && fragment.sourceType === "spoken"
          && (Array.isArray(fragment.sourceMessageIds) ? fragment.sourceMessageIds : [fragment.messageId]).includes(message.id)
          && ids(fragment.knownBy).join() === ids(verified.audience).join());
        if (sameSourceFragment) continue;
        const entityIds = ids(mentionTracker.findMentionedCharacterIds([{ content: text }], {
          candidates: entityProfiles, resolveCoreference: false
        }));
        projection.fragments.push({ fragmentId: `source_${hash([context.conversationId, message.id, paragraphIndex,
          text, verified.audience, verified.visibility])}`, messageId: message.id, sourceMessageIds: verified.messageIds,
        text, speakerId: speaker, speakerIds: verified.speakers, sourceRole: message.role, sourceTextVerified,
        presentIds: presentIds(context, message.id), knownBy: ids(verified.audience), visibility: verified.visibility,
        sourceType: verified.source, recipientIds: ids(verified.audience.filter(id => id !== speaker)), entityIds,
        visibilityEvidence: "finalization_source_paragraph" });
      }
    }
    const classified = new Set((context.messages || []).filter(message => {
      const texts = verifiedTexts.get(message.id);
      return texts?.length && String(message.content || "").split(/\r?\n/).filter(text => text.trim())
        .every(paragraph => texts.some(text => text.includes(paragraph.trim())));
    }).map(message => message.id));
    projection.fragments = projection.fragments.filter(fragment =>
      fragment.visibilityEvidence !== "legacy_author_perspective" || !classified.has(fragment.messageId));
    projection.withheldMessageIds = projection.withheldMessageIds.filter(messageId => !classified.has(messageId));
    projection.legacyRetained = projection.withheldMessageIds.length > 0 || projection.fragments.some(fragment => fragment.legacyMemoryId);
    projection.completeness = projection.legacyRetained ? "partial" : "complete";
    // A reciprocal visible exchange in a two-person presence window is a
    // direct pair; another person merely sharing the scene is not a recipient.
    const pairs = new Map();
    for (const fragment of projection.fragments) {
      if (fragment.visibility === "private" || fragment.presentIds.length !== 2 || fragment.speakerIds?.length > 1
        || !["spoken", "reported", "rumor"].includes(fragment.sourceType)) continue;
      const key = fragment.presentIds.join(":");
      if (!pairs.has(key)) pairs.set(key, { speakers: new Set(), fragments: [] });
      const pair = pairs.get(key);
      pair.speakers.add(fragment.speakerId); pair.fragments.push(fragment);
    }
    for (const pair of pairs.values()) if (pair.speakers.size === 2) {
      for (const fragment of pair.fragments) fragment.recipientIds = ids([...fragment.recipientIds,
        ...fragment.presentIds.filter(id => id !== fragment.speakerId && fragment.knownBy.includes(id))]);
    }
    const disclosureCharacters = disclosureCharacterRows(context.disclosureCharacters);
    const entityContext = buildMemory4EntityContext({ ownerId, campaignToken: context.campaignToken, date: context.date,
      fragments: projection.fragments, participantProfiles: context.participants,
      mentionedEntities: context.mentionedEntities, relationshipEvidence: context.memory4RelationshipEvidence,
      speechAttributionCharacters: disclosureCharacters });
    const disclosureFactEpochs = context.disclosureFactEpochsByOwner?.[ownerId] || null;
    projection.sourceRevision = hash([projection.sourceRevision, projection.fragments, disclosureCharacters, entityContext,
      ...(disclosureFactEpochs ? [disclosureFactEpochs] : [])]);
    const visibleEntities = new Set(projection.fragments.flatMap(fragment => ids(fragment.entityIds)));
    const relationshipChangeEntityIds = ids((context.relationshipChanges || []).filter(change =>
      change.detected === true && change.campaignToken === context.campaignToken && change.ownerId === ownerId
      && visibleEntities.has(change.entityId)).map(change => change.entityId));
    return { campaignToken: context.campaignToken, ownerId, conversationId: context.conversationId,
      finalizationId: context.finalizationId, episodeId: context.episodeId,
      date: context.date || null, totalDays: context.totalDays ?? null, counterpartIds: directCounterpartIds(projection.fragments, ownerId), summaryIds: [],
      summaryProviderSnapshot: context.summaryProviderSnapshot || null,
      ...projection, disclosureCharacters, disclosureFactEpochs, relationshipChangeEntityIds, ...entityContext };
  }

  orderFragments(snapshot, fragments) {
    const priority = new Set(ids(snapshot.relationshipChangeEntityIds));
    return [...fragments].sort((left, right) =>
      Number(right.entityIds?.some(id => priority.has(id))) - Number(left.entityIds?.some(id => priority.has(id))));
  }

  buildPrompt(snapshot, fragments, remainingEntrySlots = MAX_DURABLE_ENTRIES_PER_OWNER, remainingTransitionSlots = MAX_DURABLE_ENTRIES_PER_OWNER) {
    const ordered = this.orderFragments(snapshot, fragments);
    const prompt = [
      { role: "system", content: `VOTC Memory Engine 4.0 Durable extraction. Return JSON only: {\"status\":\"STORE|NO_DURABLE_CONTENT\",\"entries\":[{\"memoryType\":\"RELATIONSHIP_CHANGE|COMMITMENT|DURABLE_KNOWLEDGE|MAJOR_EXPERIENCE|LONG_TERM_GOAL|EMOTIONAL_ANCHOR\",\"text\":\"...\",\"fragmentIds\":[\"...\"],\"entityIds\":[],\"participantIds\":[],\"topics\":[],\"eventTime\":{\"from\":null,\"to\":null,\"precision\":\"unknown\",\"status\":\"unknown\"}}],\"commitmentTransitions\":[{\"entryId\":\"...\",\"expectedRevision\":1,\"status\":\"fulfilled|cancelled|superseded\",\"fragmentIds\":[\"...\"],\"commitmentQuote\":\"...\",\"evidenceQuote\":\"...\",\"replacementEntryIndex\":null}]}. Only durable facts; ordinary conversation may have zero entries. Use only supplied fragments and their exact IDs. For entityIds, each fragment's allowedEntityIds is the complete numeric allowlist; copy only those IDs. The Owner ID may be used when listed in allowedEntityIds for a fact about the Owner as its own subject or as the listener; include it only when relevant. participantIds are presence evidence only and never authorize entityIds. Do not infer or invent entity IDs. Do not infer who heard other parts of an old message. Self-only legacy text is the author's statement, not proof of other people's private thoughts or CK3 facts. A reported event stays reported. Relative dates in Legacy fragments use their sourceAsOf, never the current runtime date or a different projection date. Uncertain event dates remain unknown. Do not change Campaign or Owner. Never claim an entry without a supporting fragment. Return no more than ${remainingEntrySlots} entries and ${remainingTransitionSlots} commitment transitions for this owner in this request. A transition must copy an activeCommitment entryId and expectedRevision, cite a complete verbatim evidenceQuote from a verified source fragment, and bind it by an exact, concrete commitmentQuote appearing in both the original commitment and the evidence. The binding must identify exactly one supplied active commitment; generic words are invalid. Only explicit fulfilled/cancelled/replacement statements qualify. Questions, future plans, hypothetical, negation, hearsay, ambiguous references and years of silence never change status. Fulfillment needs explicit completion of every original condition; cancellation/replacement must explicitly cover the original agreement including all its conditions. For superseded, replacementEntryIndex must point to a new COMMITMENT in this response, whose text is copied verbatim from the same replacement evidence. Use NO_DURABLE_CONTENT with entries:[] when only transitions are needed. No transition is CK3 effect confirmation.` },
      { role: "user", content: JSON.stringify({ ownerId: snapshot.ownerId, campaignToken: snapshot.campaignToken,
        conversationDate: snapshot.date, completeness: snapshot.completeness,
        activeCommitments: (snapshot.activeCommitments || []).map(entry => ({ entryId: entry.entryId,
          expectedRevision: entry.revision, text: entry.text })),
        fragments: ordered.map(fragment => {
          const eventDate = normalizeGameDate(fragment.eventDate)?.canonical || null;
          const acquiredDate = normalizeGameDate(fragment.acquiredDate)?.canonical || null;
          return { fragmentId: fragment.fragmentId, text: fragment.text,
          visibilityEvidence: fragment.visibilityEvidence, speakerId: fragment.speakerId, sourceType: fragment.sourceType,
          entityIds: fragment.entityIds, presentIds: fragment.presentIds,
          entityNames: (snapshot.entityNameEvidence || []).filter(row => row.fragmentId === fragment.fragmentId),
          relationships: (snapshot.relationshipEvidence || []).filter(row => row.fragmentId === fragment.fragmentId),
          allowedEntityIds: ids([...(fragment.knownBy?.includes(snapshot.ownerId) ? [snapshot.ownerId] : []),
            fragment.speakerId, ...fragment.entityIds]), participantIds: ids(fragment.presentIds),
          ...(fragment.legacyMemoryId ? { sourceAsOf: fragment.legacyAnchorGameDate } : {}),
          ...(eventDate ? { eventDate } : {}), ...(acquiredDate ? { acquiredDate } : {}) };
        }) }) }
    ];
    prompt[0].content += " Owner means the memory holder (记忆持有人), never a master or 主人. Write archival prose in third person, identifying people by the evidence-backed names in the cited fragment's entityNames instead of bare 主人, 玩家, 师父 or 天师. A role may supplement an authorized name (师父 + 姓名) only when the source or scoped relationships proves that role. entityNames supplies only names this Owner can know from that fragment; absent names remain unknown and must not be obtained from a different Owner, unseen paragraph or backend profile. Preserve verbatim quotations required for commitments. relationships is the existing CK3 relationship readback scoped to this Owner and source date: use it to distinguish known people, not to manufacture an event, historical relationship change, current effect confirmation or a third person's private knowledge. Ambiguous roles and pronouns must remain ambiguous; do not guess an entity. Cite the original supporting fragments when their named entities were lost in a paraphrased summary.";
    return prompt;
  }

  parseResult(response, allowedFragments, snapshot = null, maxEntries = MAX_DURABLE_ENTRIES_PER_OWNER, maxTransitions = MAX_DURABLE_ENTRIES_PER_OWNER) {
    const outcome = typeof response === "string" ? { content: response, complete: true, truncated: false }
      : validateGenerationOutcome(response);
    if (outcome.truncated || !outcome.complete) throw new Error("memory4_generation_incomplete");
    const content = String(outcome.content || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
    let parsed;
    try { parsed = JSON.parse(content); }
    catch { throw new Error("memory4_response_invalid_json"); }
    const entryLimit = Math.max(0, Number.isInteger(maxEntries) ? maxEntries : MAX_DURABLE_ENTRIES_PER_OWNER);
    if (!parsed || !["STORE", "NO_DURABLE_CONTENT"].includes(parsed.status) || !Array.isArray(parsed.entries)
      || parsed.entries.length > entryLimit || (parsed.status === "STORE") !== (parsed.entries.length > 0)) throw new Error("memory4_response_invalid_shape");
    const transitions = parsed.commitmentTransitions || [];
    if (!Array.isArray(transitions) || transitions.length > maxTransitions) throw new Error("memory4_response_invalid_transitions");
    const allowed = new Set(allowedFragments.map(fragment => fragment.fragmentId));
    if (parsed.entries.some(entry => !Array.isArray(entry.fragmentIds) || !entry.fragmentIds.length
      || entry.fragmentIds.some(id => !allowed.has(id)))) throw new Error("memory4_response_source_mismatch");
    const entries = [];
    const entryPositions = new Map();
    let rejectedUnknownEntityCount = 0;
    for (const [position, candidate] of parsed.entries.entries()) {
      try {
        if (snapshot) validateEntry(candidate, snapshot);
        entryPositions.set(position, entries.length); entries.push(candidate);
      } catch (error) {
        if (error.message !== "memory4_unknown_entity") throw error;
        rejectedUnknownEntityCount++;
      }
    }
    for (const transition of transitions) {
      if (!Array.isArray(transition.fragmentIds) || !transition.fragmentIds.length || transition.fragmentIds.some(id => !allowed.has(id))) throw new Error("memory4_response_source_mismatch");
      if (transition.status === "superseded") {
        if (!entryPositions.has(transition.replacementEntryIndex)) throw new Error("memory4_commitment_replacement_invalid");
        transition.replacementEntryIndex = entryPositions.get(transition.replacementEntryIndex);
      }
    }
    return { ...parsed, status: entries.length ? "STORE" : "NO_DURABLE_CONTENT", entries,
      commitmentTransitions: transitions, rejectedUnknownEntityCount };
  }

  async finishOwner(snapshot, requestDurable, prior = null, isCurrent = () => true) {
    const file = this.recoveryPath(snapshot);
    if (this.inFlight.has(file)) return { status: "IN_PROGRESS", ownerId: snapshot.ownerId };
    this.inFlight.add(file);
    try {
      if (!isCurrent()) throw new Error("memory4_generation_changed");
      const committed = this.store.loadIndex(snapshot).finalizations[hash(snapshot.finalizationId)];
      if (committed) {
        if (committed.sourceRevision !== snapshot.sourceRevision) throw new Error("memory4_source_revision_conflict");
        if (snapshot.legacyRecompression === true) {
          const derived = await this.derived.rebuild(snapshot, { kind: "all", providerSnapshot: snapshot.summaryProviderSnapshot,
            committedFinalization: true, finalizationProof: { finalizationId: snapshot.finalizationId, sourceRevision: snapshot.sourceRevision } });
          const derivedComplete = ["COMPLETE", "MANUAL_OVERRIDE"].includes(derived.status);
          if (derivedComplete) {
            if (fs.existsSync(file)) fs.unlinkSync(file);
          } else this.saveRecovery(snapshot, { status: "DERIVED_REBUILD_FAILED", retryCount: prior?.retryCount || 0,
            lastError: String(derived.reason || derived.status || "memory4_derived_failed") });
          return { ownerId: snapshot.ownerId, ...committed,
            ...(derivedComplete ? { alreadyCommitted: true, derivedRecovered: true } : { status: "DERIVED_REBUILD_FAILED" }), derived };
        }
        this.recordDisclosures(snapshot, { campaignToken: snapshot.campaignToken, date: snapshot.date,
          characters: new Map((snapshot.disclosureCharacters || []).map(character => [character.id, character])) });
        if (fs.existsSync(file)) fs.unlinkSync(file);
        return { ownerId: snapshot.ownerId, ...committed, alreadyCommitted: true };
      }
      snapshot.activeCommitments ||= this.store.activeCommitments(snapshot);
      this.saveRecovery(snapshot, { status: "PENDING", retryCount: prior?.retryCount || 0, lastError: null });
      if (!snapshot.skipKnownEvidence) this.store.recordKnownEvidence(snapshot);
      let result;
      if (!snapshot.presentMessageCount && !snapshot.fragments.length) result = { status: "NOT_PRESENT", entries: [] };
      else if (!snapshot.fragments.length) result = { status: "NO_DURABLE_CONTENT", entries: [] };
      else {
        if (typeof requestDurable !== "function") throw new Error("memory4_provider_unavailable");
        const entries = [];
        const commitmentTransitions = [];
        let rejectedUnknownEntityCount = 0;
        const orderedFragments = this.orderFragments(snapshot, snapshot.fragments);
        const extractChunk = async (chunk, remainingEntrySlots, remainingTransitionSlots) => {
          if (!chunk.length) return { entries: [], commitmentTransitions: [], rejectedUnknownEntityCount: 0 };
          try {
            const response = await requestDurable(this.buildPrompt(snapshot, chunk, remainingEntrySlots, remainingTransitionSlots), { ownerId: snapshot.ownerId,
              campaignToken: snapshot.campaignToken, maxTokens: DURABLE_MAX_OUTPUT_TOKENS, providerSnapshot: snapshot.summaryProviderSnapshot });
            if (!isCurrent()) throw new Error("memory4_generation_changed");
            const parsed = this.parseResult(response, chunk, snapshot, remainingEntrySlots, remainingTransitionSlots);
            return parsed;
          } catch (error) {
            if (!isCurrent()) throw new Error("memory4_generation_changed");
            if (error.message !== "memory4_generation_incomplete") throw error;
            if (chunk.length > 1) {
              const midpoint = Math.ceil(chunk.length / 2);
              const first = await extractChunk(chunk.slice(0, midpoint), remainingEntrySlots, remainingTransitionSlots);
              const second = await extractChunk(chunk.slice(midpoint), remainingEntrySlots - first.entries.length, remainingTransitionSlots - first.commitmentTransitions.length);
              return { entries: [...first.entries, ...second.entries],
                commitmentTransitions: [...first.commitmentTransitions, ...second.commitmentTransitions.map(transition => ({ ...transition,
                  ...(transition.status === "superseded" ? { replacementEntryIndex: transition.replacementEntryIndex + first.entries.length } : {}) }))],
                rejectedUnknownEntityCount: first.rejectedUnknownEntityCount + second.rejectedUnknownEntityCount };
            }
            throw error;
          }
        };
        for (let offset = 0; offset < orderedFragments.length; offset += MAX_FRAGMENTS_PER_REQUEST) {
          const chunk = orderedFragments.slice(offset, offset + MAX_FRAGMENTS_PER_REQUEST);
          const parsed = await extractChunk(chunk, MAX_DURABLE_ENTRIES_PER_OWNER - entries.length, MAX_DURABLE_ENTRIES_PER_OWNER - commitmentTransitions.length);
          commitmentTransitions.push(...parsed.commitmentTransitions.map(transition => ({ ...transition,
            ...(transition.status === "superseded" ? { replacementEntryIndex: transition.replacementEntryIndex + entries.length } : {}) })));
          entries.push(...parsed.entries);
          rejectedUnknownEntityCount += parsed.rejectedUnknownEntityCount;
          this.saveRecovery(snapshot, { status: "PENDING", retryCount: prior?.retryCount || 0, lastError: null, completedFragmentCount: offset + chunk.length });
          if (entries.length >= MAX_DURABLE_ENTRIES_PER_OWNER && commitmentTransitions.length >= MAX_DURABLE_ENTRIES_PER_OWNER) break;
        }
        if (rejectedUnknownEntityCount) this.trace?.record("memory4_candidate_rejected", {
          ownerId: snapshot.ownerId, count: rejectedUnknownEntityCount, reason: "unknown_entity"
        });
        if (!entries.length && !commitmentTransitions.length && rejectedUnknownEntityCount > 0) {
          throw new Error("memory4_response_no_valid_entries");
        }
        result = { status: entries.length ? "STORE" : "NO_DURABLE_CONTENT", entries, commitmentTransitions };
      }
      if (!isCurrent()) throw new Error("memory4_generation_changed");
      const persisted = this.store.commitOwner(snapshot, result);
      this.recordDisclosures(snapshot, { campaignToken: snapshot.campaignToken, date: snapshot.date,
        characters: new Map((snapshot.disclosureCharacters || []).map(character => [character.id, character])) });
      if (snapshot.legacyRecompression === true) {
        const derived = await this.derived.rebuild(snapshot, { kind: "all", providerSnapshot: snapshot.summaryProviderSnapshot,
          committedFinalization: true, finalizationProof: { finalizationId: snapshot.finalizationId, sourceRevision: snapshot.sourceRevision } })
          .catch(error => ({ status: "FAILED", kind: "all", reason: String(error?.message || error) }));
        if (["COMPLETE", "MANUAL_OVERRIDE"].includes(derived.status)) {
          if (fs.existsSync(file)) fs.unlinkSync(file);
        } else this.saveRecovery(snapshot, { status: "DERIVED_REBUILD_FAILED", retryCount: prior?.retryCount || 0,
          lastError: String(derived.reason || derived.status || "memory4_derived_failed") });
        this.trace?.record("memory4_durable", { finalizationId: snapshot.finalizationId, ownerId: snapshot.ownerId,
          status: persisted.status, entryCount: persisted.entryIds.length, derivedStatus: derived.status });
        return { ownerId: snapshot.ownerId, ...persisted,
          ...( ["COMPLETE", "MANUAL_OVERRIDE"].includes(derived.status) ? {} : { status: "DERIVED_REBUILD_FAILED" }), derived };
      }
      if (persisted.entryIds.length || persisted.changedEntryIds?.length) this.derived.schedule(snapshot, { providerSnapshot: snapshot.summaryProviderSnapshot, committedFinalization: true });
      if (fs.existsSync(file)) fs.unlinkSync(file);
      this.trace?.record("memory4_durable", { finalizationId: snapshot.finalizationId, ownerId: snapshot.ownerId,
        status: persisted.status, entryCount: persisted.entryIds.length, completeness: persisted.completeness });
      return { ownerId: snapshot.ownerId, ...persisted };
    } catch (error) {
      if (!isCurrent()) return { ownerId: snapshot.ownerId, status: "CANCELLED" };
      const retryCount = Number(prior?.retryCount || 0) + 1;
      this.saveRecovery(snapshot, { status: "EXTRACTION_FAILED", retryCount, lastError: String(error?.message || error) });
      this.trace?.record("memory4_durable", { finalizationId: snapshot.finalizationId, ownerId: snapshot.ownerId,
        status: "EXTRACTION_FAILED", errorCode: String(error?.message || error) });
      return { ownerId: snapshot.ownerId, status: "EXTRACTION_FAILED", retryCount, error: String(error?.message || error), recoveryPath: file };
    } finally { this.inFlight.delete(file); }
  }

  async finalizeCommitted(context, requestDurable, { isNarrativeCommitted, isCurrent = () => true } = {}) {
    if (!isNarrativeCommitted) throw new Error("memory4_narrative_commit_required");
    if (typeof context.campaignToken !== "string" || !context.campaignToken.trim()) return { status: "CAMPAIGN_UNAVAILABLE", owners: [] };
    const owners = ids((context.participants || []).map(participant => participant.id))
      .filter(id => !ids(context.excludedSummaryOwnerIds).includes(id));
    const results = new Array(owners.length);
    let nextOwner = 0;
    const worker = async () => {
      while (nextOwner < owners.length) {
        const index = nextOwner++;
        const ownerId = owners[index];
        try {
          const snapshot = this.buildOwnerSnapshot(context, ownerId);
          results[index] = await this.finishOwner(snapshot, requestDurable, null, isCurrent);
        } catch (error) {
          results[index] = { ownerId, status: "EXTRACTION_FAILED", error: String(error?.message || error) };
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(2, owners.length) }, worker));
    const status = results.some(result => result.status === "EXTRACTION_FAILED") ? "PARTIAL_FAILURE"
      : results.some(result => result.status === "CANCELLED") ? "CANCELLED"
      : results.some(result => result.status === "IN_PROGRESS") ? "IN_PROGRESS" : "COMPLETE";
    return { status, owners: results };
  }

  async recoverPending(requestDurable, { manual = false, activeCampaignToken = null, isCurrent = () => true, isNarrativeCommitted = () => false } = {}) {
    if (!fs.existsSync(this.recoveryDir)) return [];
    const files = fs.readdirSync(this.recoveryDir).filter(name => /^[a-f0-9]{64}\.json$/.test(name));
    const results = new Array(files.length);
    let nextFile = 0;
    const worker = async () => {
      while (nextFile < files.length) {
        const index = nextFile++;
        try {
          const record = this.readRecovery(path.join(this.recoveryDir, files[index]));
          const snapshot = record.snapshot;
          if (!activeCampaignToken || snapshot.campaignToken !== activeCampaignToken) { results[index] = { status: "CAMPAIGN_MISMATCH", ownerId: snapshot.ownerId }; continue; }
          const legacyRecompression = snapshot.legacyRecompression === true;
          const file = path.join(this.recoveryDir, files[index]);
          const discardStaleLegacy = () => {
            if (!fs.existsSync(file)) return;
            this.readRecovery(file);
            fs.unlinkSync(file);
          };
          if (legacyRecompression && !this.isLegacyRecompressionSnapshotCurrent(snapshot)) {
            discardStaleLegacy();
            results[index] = { status: "STALE", ownerId: snapshot.ownerId };
            continue;
          }
          if (!isNarrativeCommitted(snapshot) && !legacyRecompression) { results[index] = { status: "WAITING_NARRATIVE", ownerId: snapshot.ownerId }; continue; }
          if (!manual && Number(record.retryCount || 0) >= 3) { results[index] = { status: "FAILED_MANUAL", ownerId: snapshot.ownerId }; continue; }
          const recoveryIsCurrent = () => isCurrent() && (!legacyRecompression || this.isLegacyRecompressionSnapshotCurrent(snapshot));
          results[index] = await this.finishOwner(snapshot, requestDurable, record, recoveryIsCurrent);
          if (legacyRecompression && results[index].status === "CANCELLED" && !this.isLegacyRecompressionSnapshotCurrent(snapshot)) {
            discardStaleLegacy();
            results[index] = { status: "STALE", ownerId: snapshot.ownerId };
          }
        } catch (error) {
          results[index] = { status: "EXTRACTION_FAILED", error: String(error?.message || error) };
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(2, files.length) }, worker));
    return results;
  }
}

module.exports = { Memory4Coordinator };
