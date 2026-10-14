"use strict";

const fs = require("fs");
const path = require("path");
const { assertScope, hash, ids, strings, legacySourceHash, directCounterpartIds, validateEntry } = require("./memory4-contract");
const { projectVisibleTranscript } = require("./memory4-visibility");
const { getFactCandidates, disclosureFactId, scanVisibleDisclosures, scanLetterDisclosures } = require("./memory4-disclosure");
const { Memory4Store, commitmentCore } = require("./memory4-store");
const { ScopedJsonRepository } = require("./scoped-json-repository");
const { projectionLineageFromSummary, createProjectionLineage } = require("./memory4-forget");
const { Memory4ProfileService } = require("./memory4-profile");
const { Memory4RelationshipReadback } = require("./memory4-relationship-readback");
const { memory4SourceValid } = require("./memory4-source-validity");
const { buildMemory4EntityContext } = require("./memory4-entity-context");
const { validateGenerationOutcome } = require("../providers/generation-outcome");
const { validateSourceItem, presentIds, sourceParagraphSegments } = require("./finalization-visibility");
const { MentionTracker } = require("./mention-tracker");
const { normalizeGameDate } = require("../worldline/character-temporal-facts");
const { estimateTokens } = require("../token-estimator");
const { planEvidence, PLANNER_VERSION, coverageProof, validCoverageProof } = require("./memory4-evidence-planner");

const MAX_FRAGMENTS_PER_REQUEST = 128;
const MAX_DURABLE_ENTRIES_PER_OWNER = 8;
const DURABLE_MAX_OUTPUT_TOKENS = 4096;
const DURABLE_INPUT_TOKEN_BUDGET = 8192;
const DURABLE_REPAIR_RESERVE = 1024;
const DURABLE_SINGLE_FRAGMENT_BUDGET = 16384;
const DURABLE_POLICY_VERSION = "9.3.3";
const DURABLE_REPAIRABLE_ERRORS = new Set(["memory4_response_invalid_json", "memory4_response_invalid_shape",
  "memory4_response_invalid_transitions", "memory4_response_source_mismatch", "memory4_invalid_entry",
  "memory4_scope_mismatch", "memory4_unknown_entity", "memory4_invalid_participant", "memory4_invalid_event_status",
  "memory4_invalid_event_date", "memory4_invalid_event_range", "memory4_unknown_time_has_date",
  "memory4_future_fact", "memory4_unverified_observation", "memory4_unsupported_event_date",
  "memory4_invalid_precision", "memory4_commitment_replacement_invalid", "memory4_commitment_transitions_invalid",
  "memory4_commitment_target_stale", "memory4_commitment_target_source_invalid", "memory4_commitment_date_invalid",
  "memory4_commitment_evidence_invalid", "memory4_commitment_binding_invalid", "memory4_commitment_evidence_uncertain",
  "memory4_commitment_fulfillment_unproven", "memory4_commitment_cancellation_unproven", "memory4_commitment_replacement_unproven",
  "memory4_commitment_conditions_unproven"]);

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

function safeMessageIds(values) {
  return [...new Set((Array.isArray(values) ? values : []).filter(id => Number.isSafeInteger(id) && id >= 0))].sort((a, b) => a - b);
}

function durableTraceFailure(error, attempt = null) {
  const errorCode = typeof error?.message === "string" ? error.message : "UNKNOWN";
  if (errorCode === "memory4_request_source_changed_before_send") {
    const sent = typeof attempt?.providerAttemptCount === "number" && Number.isSafeInteger(attempt.providerAttemptCount)
      && attempt.providerAttemptCount > 0;
    return { status: sent ? "FAILED" : "FAILED_PRE_SEND", parseStatus: "NOT_ATTEMPTED", errorCode };
  }
  if (errorCode.startsWith("provider_")) return { errorCode };
  if (errorCode === "memory4_generation_incomplete") return { status: "INCOMPLETE", parseStatus: "INCOMPLETE", errorCode };
  if (errorCode === "memory4_response_invalid_json") return { status: "INVALID_JSON", parseStatus: "INVALID_JSON", errorCode };
  if (errorCode === "memory4_response_invalid_shape") return { status: "INVALID_SHAPE", parseStatus: "INVALID_SHAPE", errorCode };
  if (errorCode === "memory4_response_invalid_transitions") return { status: "INVALID_SHAPE", parseStatus: "INVALID_TRANSITIONS", errorCode };
  if (errorCode === "memory4_response_source_mismatch") return { status: "REJECTED", parseStatus: "SOURCE_REJECTED", errorCode };
  return { status: "FAILED", parseStatus: "ERROR", errorCode };
}

class Memory4Coordinator {
  constructor(store, { trace = null } = {}) {
    this.store = new Memory4Store(store);
    this.repository = new ScopedJsonRepository({ memory4Store: this.store, memoryStore: store });
    this.profiles = new Memory4ProfileService(this.store);
    this.relationshipReadback = new Memory4RelationshipReadback();
    this.baseStore = store;
    this.trace = trace;
    this.durableRequestTrace = null;
    this.recoveryDir = store.paths.memory4Recovery;
    this.inFlight = new Set();
    this.extractionOptions = {};
    this.lazyInFlight = new Set();
    this.sourcePositions = new WeakMap();
  }

  configureExtraction(options = {}) { this.extractionOptions = { ...this.extractionOptions, ...options }; }

  sourceValid(scope, row, index, metadata) {
    return memory4SourceValid({ store: this.store, baseStore: this.baseStore, scope, row, index, metadata });
  }

  beginDurableTraceRun(snapshot, options) {
    try { return this.durableRequestTrace?.beginRun(snapshot, options) || null; }
    catch { return null; }
  }

  beginDurableTraceAttempt(run, chunk, retry) {
    try { return this.durableRequestTrace?.beginAttempt(run, chunk, retry) || null; }
    catch { return null; }
  }

  recordDurableTrace(attempt, fields) {
    try { this.durableRequestTrace?.record(attempt, fields); }
    catch { /* Diagnostics must never affect Memory4. */ }
  }

  durableTraceHash(domain, value) {
    try { return this.durableRequestTrace?.hashValue(domain, JSON.stringify(value)) || null; }
    catch { return null; }
  }

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
    isCurrent = () => true, allowPersistedArchive = false } = {}) {
    assertScope(scope);
    scope = { campaignToken: scope.campaignToken, ownerId: scope.ownerId };
    if (allowPersistedArchive) this.store.assertPersistedScope(scope);
    const key = hash([scope, memoryId]);
    if (this.lazyInFlight.has(key)) return { status: "IN_PROGRESS", sourceMemoryId: memoryId, entryIds: [], retained: true };
    const source = this.legacySource(scope, memoryId);
    const sourceFacts = this.legacyFacts(scope, source);
    let facts = sourceFacts;
    if (!source || expectedSourceHash && legacySourceHash(source) !== expectedSourceHash) return { status: "STALE", sourceMemoryId: memoryId, entryIds: [], retained: true };
    if (!facts.length) return { status: "RETAINED_LEGACY", sourceMemoryId: memoryId, entryIds: [], retained: true, reason: "UNPROVEN_FRAGMENT_BOUNDARY" };
    const sourceHash = legacySourceHash(source), sourceProofs = sourceFacts.map(memory => [memory.memoryId, legacySourceHash(memory)]);
    const current = () => (allowPersistedArchive || !this.extractionOptions.isCampaignCurrent || this.extractionOptions.isCampaignCurrent(scope.campaignToken))
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
    const metadata = this.store.read(path.join(this.store.directory(scope), "metadata.json"), null);
    const covered = new Set();
    for (const [entryId, row] of Object.entries(index.entries)) {
      const record = index.finalizations[hash(row.finalizationId)];
      if (row.deleted || record?.status !== "STORE" || !record.entryIds?.includes(entryId)) continue;
      try {
        const entry = this.store.readEntry(scope, entryId, index);
        if (!this.sourceValid(scope, row, index, metadata) || entry.source.finalizationId !== row.finalizationId) continue;
        const validRefs = (row.legacyRefs || []).filter(ref => facts.some(fact =>
          fact.memoryId === ref.memoryId && legacySourceHash(fact) === ref.sourceHash));
        if (validRefs.length) {
          validRefs.forEach(ref => covered.add(ref.memoryId));
        }
      } catch { /* Invalid or forgotten legacy coverage stays eligible for normal Durable recovery. */ }
    }
    facts = facts.filter(fact => !covered.has(fact.memoryId)).slice(0, MAX_DURABLE_ENTRIES_PER_OWNER);
    if (!facts.length) {
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
    const prior = this.store.loadIndex(scope).finalizations[hash(snapshot.finalizationId)];
    if (prior) {
      const committedProof = this.inspectCommittedSnapshot(snapshot);
      if (committedProof.state !== "COMMITTED") return { status: "RECOVERY_UNVERIFIED", reason: committedProof.reason || "LEGACY_COMMIT_UNVERIFIED",
        ...(fs.existsSync(recoveryFile) ? { recoveryPath: recoveryFile } : {}), sourceMemoryId: memoryId, entryIds: [], retained: true };
      if (!current()) return { status: "CANCELLED", sourceMemoryId: memoryId, entryIds: [], retained: true };
      const recovery = this.finishCanonicalRecovery(snapshot, recoveryFile);
      if (recovery.status !== "COMPLETE") return { status: recovery.status, ...recovery,
        durableStatus: committedProof.record.status, sourceMemoryId: memoryId, entryIds: [], retained: true };
      return { status: "ALREADY_CONVERTED", canonical: { status: "ALREADY_CONVERTED", entryIds: [...prior.entryIds] },
        durableStatus: committedProof.record.status,
        ...(fs.existsSync(recoveryFile) ? { recoveryPath: recoveryFile } : {}),
        sourceMemoryId: memoryId, entryIds: [...prior.entryIds], retained: true };
    }
    if (typeof this.extractionOptions.requestExtraction !== "function") {
      this.saveRecovery(snapshot, { status: "EXTRACTION_FAILED", retryCount: Number(priorRecovery?.retryCount || 0) + 1,
        lastError: "memory4_provider_unavailable" });
      return { status: "EXTRACTION_FAILED", sourceMemoryId: memoryId, entryIds: [], retained: true, reason: "memory4_provider_unavailable" };
    }
    this.lazyInFlight.add(key);
    const controller = new AbortController();
    try {
      if (!current()) return { status: "CANCELLED", sourceMemoryId: memoryId, entryIds: [], retained: true };
      providerSnapshot ||= this.extractionOptions.getProviderSnapshot ? await this.extractionOptions.getProviderSnapshot() : null;
      snapshot.summaryProviderSnapshot = providerSnapshot;
      const result = await this.finishOwner(snapshot, (messages, options) => this.extractionOptions.requestExtraction(messages,
        { ...options, signal: controller.signal, requestType: "memory4_durable" }), priorRecovery, current,
        { origin: "legacy_recompression", operation: "legacy_recompression" });
      if (!this.isLegacyRecompressionSnapshotCurrent(snapshot)) {
        return { status: "STALE", sourceMemoryId: memoryId, entryIds: [], retained: true };
      }
      if (!["STORE", "NO_DURABLE_CONTENT"].includes(result.durableStatus) || result.recoveryStatus !== "COMPLETE") {
        return { ...result, status: result.recoveryStatus === "RECOVERY_UNVERIFIED" ? "RECOVERY_UNVERIFIED" : result.status,
          sourceMemoryId: memoryId, entryIds: [], retained: true, reason: result.error || result.reason };
      }
      const status = result.durableStatus === "NO_DURABLE_CONTENT" ? "NO_DURABLE_CONTENT" : "COMPLETE";
      this.trace?.record("memory4_legacy_recompression", { ownerId: scope.ownerId, status, count: result.entryIds.length });
      return { status,
        durableStatus: result.durableStatus,
        ...(fs.existsSync(recoveryFile) ? { recoveryPath: recoveryFile } : {}), sourceMemoryId: memoryId,
        entryIds: [...result.entryIds], retained: true, ...(!result.entryIds.length ? { reason: "NO_DURABLE_CONTENT" } : {}) };
    } catch (error) {
      this.trace?.record("memory4_legacy_recompression", { ownerId: scope.ownerId, status: "EXTRACTION_FAILED", errorCode: error.message });
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

  canProveNoSummaryProjectionFootprint(summaryRecord, { ownerId = null, counterpartId = null, legacyMemoryIds = [] } = {}) {
    try {
      const provenance = summaryRecord?.provenance || {};
      const campaignToken = summaryRecord?.campaignToken || provenance.campaignToken;
      const numericOwnerId = Number(ownerId ?? summaryRecord?.perspectiveOwnerId ?? provenance.folderOwnerId);
      const numericCounterpartId = Number(counterpartId ?? summaryRecord?.characterId ?? provenance.counterpartId);
      if (typeof campaignToken !== "string" || !campaignToken.trim() || !Number.isSafeInteger(numericOwnerId)
        || numericOwnerId <= 0 || !Number.isSafeInteger(numericCounterpartId) || numericCounterpartId <= 0
        || numericCounterpartId === numericOwnerId) return false;
      if ([summaryRecord?.perspectiveOwnerId, summaryRecord?.playerId, provenance.folderOwnerId].some(value =>
        value != null && Number(value) !== numericOwnerId)) return false;

      const hasValue = value => typeof value === "string" && value.trim().length > 0;
      const hasIds = value => Array.isArray(value) ? value.length > 0 : hasValue(value);
      const lineageFields = [summaryRecord?.projectionId, provenance.projectionId,
        summaryRecord?.conversationId, provenance.conversationId,
        summaryRecord?.finalizationId, provenance.finalizationId,
        summaryRecord?.sourceLetterId, summaryRecord?.letterId, provenance.sourceLetterId, provenance.letterId];
      const sourceFields = [summaryRecord?.perspectiveMemoryIds, summaryRecord?.legacyMemoryIds,
        summaryRecord?.perspectiveSummarySegmentIds, summaryRecord?.segmentIds,
        summaryRecord?.sourceSegmentIds, summaryRecord?.sourceMessageIds,
        summaryRecord?.projectionLineages, provenance.perspectiveMemoryIds, provenance.legacyMemoryIds,
        provenance.perspectiveSummarySegmentIds, provenance.segmentIds,
        provenance.sourceSegmentIds, provenance.sourceMessageIds, provenance.projectionLineages];
      if (lineageFields.some(hasValue) || sourceFields.some(hasIds)) return false;

      const summaryRoot = this.baseStore.summaryFoldersDir;
      if (!summaryRoot) return false;
      const root = path.resolve(summaryRoot);
      if (!fs.existsSync(root) || !fs.lstatSync(root).isDirectory() || fs.lstatSync(root).isSymbolicLink()) return false;
      const campaignDirectory = hash(campaignToken);
      const targetExists = target => {
        const resolvedTarget = path.resolve(target);
        let checked = resolvedTarget;
        while (checked !== root) {
          if (!checked.startsWith(`${root}${path.sep}`)) return true;
          if (fs.existsSync(checked)) {
            const stat = fs.lstatSync(checked);
            if (stat.isSymbolicLink() || !stat.isDirectory()) return true;
            if (checked === resolvedTarget) return true;
          }
          checked = path.dirname(checked);
        }
        return false;
      };
      const canonicalOwner = path.join(root, ".memory4", String(numericOwnerId));
      if (fs.existsSync(path.join(root, ".memory4"))) {
        const sidecarRoot = path.join(root, ".memory4");
        if (!fs.lstatSync(sidecarRoot).isDirectory() || fs.lstatSync(sidecarRoot).isSymbolicLink()) return false;
      }
      if (targetExists(path.join(canonicalOwner, campaignDirectory))) return false;
      for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
        if (!entry.name.startsWith(`${numericOwnerId}_`)) continue;
        if (entry.isSymbolicLink()) return false;
        if (!entry.isDirectory()) continue;
        const ownerFolder = path.join(root, entry.name);
        const memory4Root = path.join(ownerFolder, "memory4");
        if (fs.existsSync(memory4Root) && (!fs.lstatSync(memory4Root).isDirectory() || fs.lstatSync(memory4Root).isSymbolicLink())) return false;
        if (targetExists(path.join(memory4Root, campaignDirectory))) return false;
      }

      if (!fs.existsSync(this.recoveryDir) || !fs.lstatSync(this.recoveryDir).isDirectory()
        || fs.lstatSync(this.recoveryDir).isSymbolicLink()) return false;
      for (const entry of fs.readdirSync(this.recoveryDir, { withFileTypes: true })) {
        if (!entry.isFile() || entry.isSymbolicLink() || !/^[a-f0-9]{64}\.json$/.test(entry.name)) return false;
        const record = this.readRecovery(path.join(this.recoveryDir, entry.name));
        const snapshot = record?.snapshot;
        if (snapshot?.campaignToken === campaignToken && Number(snapshot.ownerId) === numericOwnerId) return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  getKnownEntityProfile(scope, entityId, options = {}) {
    return this.profiles.getProfile(scope, entityId, options);
  }

  forgetSummaryProjection(summaryRecord, { ownerId = null, counterpartId = null, reason = "USER_DELETE_SUMMARY", legacyMemoryIds = [] } = {}) {
    const baseResult = { canonicalEntriesForgotten: 0, derivedInvalidated: 0,
      disclosureEvidenceRevoked: 0, recoveryDeleted: 0, recoveryUpdated: 0 };
    const lineage = projectionLineageFromSummary(summaryRecord, { ownerId, counterpartId });
    if (!lineage) {
      const safeToSkip = this.canProveNoSummaryProjectionFootprint(summaryRecord, { ownerId, counterpartId, legacyMemoryIds });
      return { status: safeToSkip ? "SKIPPED_SAFE_NO_FOOTPRINT" : "SKIPPED",
        reason: safeToSkip ? "NO_MEMORY4_FOOTPRINT" : "PROJECTION_LINEAGE_UNAVAILABLE", ...baseResult };
    }
    const scope = { campaignToken: lineage.campaignToken, ownerId: lineage.ownerId };
    try { this.store.directory(scope); }
    catch (error) {
      if (error.message === "memory4_owner_folder_not_unique") return { status: "SKIPPED", reason: "OWNER_FOLDER_UNAVAILABLE",
        projectionId: lineage.projectionId, canonicalEntriesForgotten: 0, derivedInvalidated: 0,
        disclosureEvidenceRevoked: 0, recoveryDeleted: 0, recoveryUpdated: 0 };
      throw error;
    }
    const mutate = () => {
      this.store.persistForgottenProjection(scope, lineage, reason);
      const canonical = this.store.forgetProjectionEntries(scope, lineage);
      const disclosures = this.store.revokeProjectionDisclosures(scope, lineage);
      let recoveryDeleted = 0, recoveryUpdated = 0;
      if (fs.existsSync(this.recoveryDir)) for (const name of fs.readdirSync(this.recoveryDir).filter(value => /^[a-f0-9]{64}\.json$/.test(value))) {
        const file = path.join(this.recoveryDir, name), record = this.readRecovery(file), snapshot = record.snapshot;
        if (snapshot.campaignToken !== scope.campaignToken || snapshot.ownerId !== scope.ownerId) continue;
        const result = this.store.filterForgottenSnapshot(snapshot);
        if (!result.forgottenProjectionIds.length && !result.removedFragmentCount) {
          if (lineage.finalizationId && snapshot.finalizationId === lineage.finalizationId
            && ids(snapshot.counterpartIds).includes(lineage.counterpartId) && !(snapshot.projectionLineages || []).length) {
            throw new Error("memory4_projection_recovery_unmapped");
          }
          continue;
        }
        if (result.snapshot.fragments.length === 0) {
          this.baseStore.removeSummaryMutationFile(file);
          recoveryDeleted++;
        } else {
          const { schemaVersion, snapshot: _oldSnapshot, updatedAt: _oldUpdatedAt, ...state } = record;
          this.saveRecovery(result.snapshot, { ...state,
            forgottenFragmentIds: strings([...(state.forgottenFragmentIds || []), ...(result.removedFragmentIds || [])]) });
          recoveryUpdated++;
        }
      }
      this.profiles.invalidate(scope);
      return { status: "FORGOTTEN", projectionId: lineage.projectionId,
        canonicalEntriesForgotten: canonical.canonicalEntriesForgotten,
        derivedInvalidated: canonical.derivedInvalidated,
        disclosureEvidenceRevoked: disclosures.disclosureEvidenceRevoked, recoveryDeleted, recoveryUpdated };
    };
    return this.baseStore.summaryMutation ? mutate() : this.baseStore.withSummaryMutation(null, mutate);
  }

  getCurrentDisclosures(scope, entityId, gameData, { readContext = null, currentGameDate = null } = {}) {
    return this.store.getCurrentDisclosures(scope, Number(entityId), gameData, { readContext, currentGameDate });
  }

  observeVisibleTraits({ campaignToken, gameDate, observerId, targetId, participantPresence, gameData,
    conversationId, messageBoundary } = {}) {
    const active = id => (participantPresence || []).some(window => Number(window.characterId) === id
      && Number(window.joinedAtMessageId) <= messageBoundary
      && (window.leftAtMessageId == null || messageBoundary < Number(window.leftAtMessageId)));
    const scope = { campaignToken, ownerId: Number(observerId) };
    const target = Number(targetId);
    if (!Number.isSafeInteger(scope.ownerId) || scope.ownerId <= 0 || !Number.isSafeInteger(target) || target <= 0
      || target === scope.ownerId || !conversationId || !Number.isSafeInteger(messageBoundary) || messageBoundary < 0
      || !normalizeGameDate(gameDate) || gameData?.date !== gameDate || gameData?.campaignToken !== campaignToken
      || !active(scope.ownerId) || !active(target)) {
      return { status: "SKIPPED", changed: false, observedFactKeys: [], removedCurrentFactKeys: [], diagnostics: [] };
    }
    this.store.ensureDisclosureScope(scope);
    const result = this.store.observeVisibleTraits(scope, target, gameData, { conversationId, messageBoundary });
    if (result.changed) this.profiles.invalidate(scope);
    for (const diagnostic of result.diagnostics || []) this.trace?.record(diagnostic.reason, {
      ownerId: scope.ownerId, targetId: target, canonicalKey: diagnostic.canonicalKey || null });
    return result;
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
    if (status === "MANUAL_HIDDEN" && current?.currentDirectObservation) throw new Error("memory4_disclosure_directly_observable");
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
    const filtered = snapshot ? this.store.filterForgottenSnapshot(snapshot) : null;
    if (filtered && (filtered.forgottenProjectionIds.length || filtered.removedFragmentCount)) snapshot = filtered.snapshot;
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
    for (const diagnostic of scanned.diagnostics || []) this.trace?.record(diagnostic.code, {
      ownerId: snapshot.ownerId, targetId: diagnostic.targetId, factKey: diagnostic.factKey });
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
    const forgottenProjections = this.store.listForgottenProjections(scope);
    const projectionForgetGeneration = this.store.projectionForgetGeneration(scope);
    const context = { scope, forgottenProjections, projectionForgetGeneration,
      index: this.store.loadIndex(scope, { forgottenProjections }),
      metadata: this.store.read(path.join(directory, "metadata.json"), null) || {},
      known: this.store.read(path.join(directory, "known-entities.json"), null) || { ...scope, entities: {} },
      snapshots: new Map() };
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

  inspectCommittedSnapshot(snapshot, { sourceFilteredByForget = false } = {}) {
    const unverified = reason => ({ state: "UNVERIFIED", reason });
    let scope, index, record;
    try {
      scope = { campaignToken: snapshot?.campaignToken, ownerId: snapshot?.ownerId };
      assertScope(scope);
      if (typeof snapshot.finalizationId !== "string" || !snapshot.finalizationId.trim()
        || typeof snapshot.conversationId !== "string" || !snapshot.conversationId.trim()
        || !/^[a-f0-9]{64}$/.test(snapshot.sourceRevision || "")) return unverified("SOURCE_IDENTITY_UNAVAILABLE");
      index = this.store.loadIndex(scope);
      record = index.finalizations[hash(snapshot.finalizationId)];
    } catch { return unverified("DURABLE_INDEX_UNAVAILABLE"); }
    if (!record) return Object.values(index.entries).some(row => row.finalizationId === snapshot.finalizationId)
      ? unverified("DURABLE_COMMIT_RECORD_MISSING") : { state: "UNCOMMITTED" };
    if (sourceFilteredByForget) return unverified("SOURCE_CHANGED_BY_FORGET");
    if (record.sourceRevision !== snapshot.sourceRevision) return unverified("SOURCE_REVISION_MISMATCH");
    let filtered;
    try { filtered = this.store.filterForgottenSnapshot(snapshot); }
    catch { return unverified("FORGET_STATE_UNAVAILABLE"); }
    if (filtered.removedFragmentCount || filtered.forgottenProjectionIds.length || hash(filtered.snapshot) !== hash(snapshot)) {
      return unverified("SOURCE_CHANGED_BY_FORGET");
    }
    const metadata = this.store.read(path.join(this.store.directory(scope), "metadata.json"), null);
    if (!metadata || metadata.knownEvidenceRevisions?.[hash([snapshot.conversationId, snapshot.ownerId])] !== snapshot.sourceRevision) {
      return unverified("SOURCE_REVISION_EVIDENCE_MISSING");
    }
    const evaluatedAll = Array.isArray(snapshot.fragments) && record.evaluatedFragmentCount === snapshot.fragments.length;
    if (record.extractionPolicyVersion === DURABLE_POLICY_VERSION && !validCoverageProof(record.coverageProof, record, snapshot)) {
      return unverified("DURABLE_COVERAGE_PROOF_INVALID");
    }
    const validCappedEvaluation = Array.isArray(snapshot.fragments) && ["9.3.2", DURABLE_POLICY_VERSION].includes(record.extractionPolicyVersion)
      && record.extractionCoverage === "CAPPED" && Number.isSafeInteger(record.evaluatedFragmentCount)
      && record.evaluatedFragmentCount > 0 && record.evaluatedFragmentCount < snapshot.fragments.length
      && Array.isArray(record.entryIds) && record.entryIds.length === MAX_DURABLE_ENTRIES_PER_OWNER;
    if (!Array.isArray(snapshot.fragments) || !["STORE", "NO_DURABLE_CONTENT", "NOT_PRESENT"].includes(record.status)
      || !evaluatedAll && !validCappedEvaluation || record.completeness !== snapshot.completeness
      || record.legacyRetained !== (snapshot.legacyRetained === true) || record.noDetailIsNotUnknown !== true
      || hash(record.visibilityEvidence ?? null) !== hash(snapshot.visibilityEvidence ?? null)
      || typeof record.committedAt !== "string" || !Number.isFinite(Date.parse(record.committedAt))) {
      return unverified("DURABLE_COMMIT_RECORD_INVALID");
    }
    const hasSource = Number(snapshot.presentMessageCount || 0) > 0 || snapshot.fragments.length > 0;
    const entryIds = record.entryIds;
    const changedEntryIds = record.changedEntryIds;
    if (!Array.isArray(entryIds) || new Set(entryIds).size !== entryIds.length
      || !Array.isArray(changedEntryIds) || new Set(changedEntryIds).size !== changedEntryIds.length
      || record.commitmentTransitionCount !== changedEntryIds.length
      || (record.status === "STORE") !== (entryIds.length > 0)
      || record.status === "NOT_PRESENT" && hasSource || record.status !== "NOT_PRESENT" && !hasSource
      || record.status !== "STORE" && entryIds.length || entryIds.some(id => changedEntryIds.includes(id))) {
      return unverified("DURABLE_COMMIT_ENTRIES_INVALID");
    }
    const indexedEntryIds = index.bySourceFinalization?.[snapshot.finalizationId] || [];
    if (!Array.isArray(indexedEntryIds) || hash([...indexedEntryIds].sort()) !== hash([...entryIds].sort())) {
      return unverified("DURABLE_COMMIT_ENTRY_INDEX_MISMATCH");
    }
    const validEntry = (entryId, entryKind) => {
      if (typeof entryId !== "string" || !/^m4_[a-f0-9]{64}$/.test(entryId)) return false;
      const row = index.entries[entryId];
      if (!row || row.deleted || !ids(row.knownBy).includes(scope.ownerId) || entryKind === "finalization"
          && (row.finalizationId !== snapshot.finalizationId || row.conversationId !== snapshot.conversationId)) return false;
      if (entryKind === "changed" && (row.stateSource?.finalizationId !== snapshot.finalizationId
        || row.stateSource?.conversationId !== snapshot.conversationId || row.stateSource?.sourceRevision !== snapshot.sourceRevision)) return false;
      try {
        const entry = this.store.readEntry(scope, entryId, index);
        if (!entry || entry.deleted || entry.ownerId !== scope.ownerId || entry.campaignToken !== scope.campaignToken
          || !ids(entry.evidence?.knownBy).includes(scope.ownerId)
          || entry.source?.finalizationId !== row.finalizationId || entry.source?.conversationId !== row.conversationId
          || entryKind === "changed" && (entry.state?.source?.finalizationId !== snapshot.finalizationId
            || entry.state?.source?.conversationId !== snapshot.conversationId || entry.state?.source?.sourceRevision !== snapshot.sourceRevision)
          || !this.sourceValid(scope, row, index, metadata)) return false;
        const sourceRecord = index.finalizations[hash(entry.source.finalizationId)];
        const sourceRevision = metadata.knownEvidenceRevisions?.[hash([entry.source.conversationId, scope.ownerId])];
        return !!sourceRecord?.sourceRevision && sourceRevision === sourceRecord.sourceRevision
          && (entry.source.sourceRevision == null || entry.source.sourceRevision === sourceRecord.sourceRevision);
      } catch { return false; }
    };
    if (entryIds.some(id => !validEntry(id, "finalization")) || changedEntryIds.some(id => !validEntry(id, "changed"))) {
      return unverified("DURABLE_COMMIT_BODY_INVALID");
    }
    return { state: "COMMITTED", record };
  }

  clearVerifiedRecovery(snapshot, file, { sourceFilteredByForget = false } = {}) {
    if (!fs.existsSync(file)) return true;
    try {
      const recovery = this.readRecovery(file);
      if (!recovery || recovery.snapshot.campaignToken !== snapshot.campaignToken || recovery.snapshot.ownerId !== snapshot.ownerId
        || recovery.snapshot.conversationId !== snapshot.conversationId || recovery.snapshot.finalizationId !== snapshot.finalizationId
        || recovery.snapshot.sourceRevision !== snapshot.sourceRevision) return false;
      if (this.inspectCommittedSnapshot(recovery.snapshot, { sourceFilteredByForget }).state !== "COMMITTED") return false;
      this.baseStore.removeSummaryMutationFile(file);
      return true;
    } catch { return false; }
  }

  getRecoveryStatus(activeCampaignToken, ownerId = null) {
    if (!activeCampaignToken || !fs.existsSync(this.recoveryDir)) return { pending: 0, manual: 0, balanceBlocked: 0 };
    let pending = 0, manual = 0, balanceBlocked = 0, invalid = 0;
    for (const name of fs.readdirSync(this.recoveryDir).filter(name => /^[a-f0-9]{64}\.json$/.test(name))) {
      let record;
      try { record = this.readRecovery(path.join(this.recoveryDir, name)); }
      catch { invalid++; continue; }
      if (record?.snapshot?.campaignToken !== activeCampaignToken || ownerId != null && record.snapshot.ownerId !== ownerId) continue;
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
      if (verified.source === "spoken") projection.spokenMessageIds.push(...verified.messageIds);
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
    projection.spokenMessageIds = [...new Set(projection.spokenMessageIds)].sort((a, b) => a - b);
    projection.sourceRevision = hash([projection.sourceRevision, projection.fragments, projection.spokenMessageIds, disclosureCharacters, entityContext,
      ...(disclosureFactEpochs ? [disclosureFactEpochs] : [])]);
    const visibleEntities = new Set(projection.fragments.flatMap(fragment => ids(fragment.entityIds)));
    const relationshipChangeEntityIds = ids((context.relationshipChanges || []).filter(change =>
      change.detected === true && change.campaignToken === context.campaignToken && change.ownerId === ownerId
      && visibleEntities.has(change.entityId)).map(change => change.entityId));
    const projectionLineages = this.projectionLineagesForSnapshot(context, ownerId, projection.fragments);
    const snapshot = { campaignToken: context.campaignToken, ownerId, conversationId: context.conversationId,
      finalizationId: context.finalizationId, episodeId: context.episodeId,
      date: context.date || null, totalDays: context.totalDays ?? null, counterpartIds: directCounterpartIds(projection.fragments, ownerId), summaryIds: [],
      summaryProviderSnapshot: context.summaryProviderSnapshot || null,
      ...projection, projectionLineages, disclosureCharacters, disclosureFactEpochs, relationshipChangeEntityIds, ...entityContext };
    return snapshot;
  }

  projectionLineagesForSnapshot(context, ownerId, fragments) {
    const rows = context.directedSummaries instanceof Map ? [...context.directedSummaries.entries()]
      : Object.entries(context.directedSummaries || {});
    const segments = new Map((context.verifiedSummarySegments || []).filter(segment => segment?.segmentId)
      .map(segment => [String(segment.segmentId), segment]));
    const lineages = [];
    for (const [key, projection] of rows) {
      const projectedOwner = Number(projection?.ownerId ?? String(key).split("->")[0]);
      const counterpartId = Number(projection?.counterpartId ?? String(key).split("->")[1]);
      if (projectedOwner !== ownerId || !Number.isSafeInteger(counterpartId) || counterpartId <= 0 || counterpartId === ownerId) continue;
      const segmentIds = strings(projection.summarySegmentIds);
      const sourceMessages = safeMessageIds(segmentIds.flatMap(id => {
        const segment = segments.get(id);
        return segment?.provenance?.messageIds || segment?.messageIds || [];
      }));
      const mappedFragments = fragments.filter(fragment => segmentIds.some(id =>
        fragment.fragmentId === id || fragment.fragmentId === `segment_${id}` || fragment.segmentId === id)
        || sourceMessages.some(id => (fragment.sourceMessageIds || [fragment.messageId]).includes(id))
        || fragment.knownBy?.includes(ownerId) && fragment.knownBy?.includes(counterpartId)
          && (fragment.recipientIds?.includes(counterpartId) || fragment.speakerId === counterpartId && fragment.recipientIds?.includes(ownerId)));
      const mappedMessageIds = safeMessageIds([...sourceMessages, ...mappedFragments.flatMap(fragment => fragment.sourceMessageIds || [fragment.messageId])]);
      lineages.push(createProjectionLineage({ campaignToken: context.campaignToken, ownerId,
        conversationId: context.conversationId, finalizationId: context.finalizationId, counterpartId,
        segmentIds, legacyMemoryIds: projection.memoryIds || [],
        sourceSegmentIds: mappedFragments.map(fragment => fragment.fragmentId || fragment.segmentId),
        sourceMessageIds: mappedMessageIds }));
    }
    return lineages;
  }

  orderFragments(snapshot, fragments) {
    const plan = planEvidence(snapshot, snapshot.fragments || fragments);
    const ranks = new Map(plan.orderedFragmentIds.map((id, position) => [id, position]));
    return [...fragments].sort((left, right) => ranks.get(left.fragmentId) - ranks.get(right.fragmentId));
  }

  relevantCommitments(entries, fragments) {
    // A valid transition must quote the complete concrete binding in its source.
    return (entries || []).filter(entry => {
      const core = commitmentCore(entry.text);
      return core && fragments.some(fragment => fragment.text.includes(core));
    });
  }

  estimateDurableInput(messages) {
    // Reserve the shared Summary anchor and the measured estimate/native gap.
    return Math.ceil(estimateTokens(JSON.stringify(messages)) * 1.5) + 256;
  }

  chunkFragments(snapshot, fragments) {
    const chunks = [];
    let chunk = [];
    for (const fragment of fragments) {
      const next = [...chunk, fragment];
      if (next.length > MAX_FRAGMENTS_PER_REQUEST
        || this.estimateDurableInput(this.buildPrompt(snapshot, next)) > DURABLE_INPUT_TOKEN_BUDGET - DURABLE_REPAIR_RESERVE) {
        if (chunk.length) chunks.push(chunk);
        chunk = [fragment];
        if (this.estimateDurableInput(this.buildPrompt(snapshot, chunk)) > DURABLE_SINGLE_FRAGMENT_BUDGET) {
          throw new Error("memory4_fragment_input_too_large");
        }
      } else chunk = next;
    }
    if (chunk.length) chunks.push(chunk);
    return chunks;
  }

  checkpointScope(snapshot) {
    return hash([snapshot.campaignToken, snapshot.ownerId, snapshot.conversationId, snapshot.finalizationId,
      snapshot.date, snapshot.sourceKind, snapshot.letterId]);
  }

  checkpointFragment(snapshot, fragment) {
    return hash([fragment, (snapshot.entityNameEvidence || []).filter(row => row.fragmentId === fragment.fragmentId),
      (snapshot.relationshipEvidence || []).filter(row => row.fragmentId === fragment.fragmentId)]);
  }

  durableFailureSource(snapshot) {
    try {
      const current = this.store.filterForgottenSnapshot(snapshot).snapshot;
      return hash([current.sourceRevision, current.fragments, current.projectionLineages,
        this.relevantCommitments(this.store.activeCommitments(current), current.fragments)]);
    } catch { return null; }
  }

  pruneDurableResult(result, availableIds) {
    const positions = new Map();
    const entries = result.entries.filter((entry, index) => {
      if (!entry.fragmentIds.every(id => availableIds.has(id))) return false;
      positions.set(index, positions.size);
      return true;
    });
    const commitmentTransitions = (result.commitmentTransitions || []).filter(transition =>
      transition.fragmentIds.every(id => availableIds.has(id))
      && (transition.status !== "superseded" || positions.has(transition.replacementEntryIndex)))
      .map(transition => ({ ...transition, ...(transition.status === "superseded"
        ? { replacementEntryIndex: positions.get(transition.replacementEntryIndex) } : {}) }));
    return { ...result, entries, commitmentTransitions, status: entries.length ? "STORE" : "NO_DURABLE_CONTENT" };
  }

  mergeDurableResults(first, second, snapshot) {
    const entries = [...first.entries];
    const keys = new Map(entries.map((entry, index) => [validateEntry(entry, snapshot).entryId, index]));
    const positions = new Map();
    for (const [index, entry] of second.entries.entries()) {
      const key = validateEntry(entry, snapshot).entryId;
      if (!keys.has(key)) { keys.set(key, entries.length); entries.push(entry); }
      positions.set(index, keys.get(key));
    }
    const commitmentTransitions = [...(first.commitmentTransitions || [])];
    for (const transition of second.commitmentTransitions || []) {
      const mapped = { ...transition, ...(transition.status === "superseded"
        ? { replacementEntryIndex: positions.get(transition.replacementEntryIndex) } : {}) };
      if (!commitmentTransitions.some(prior => hash(prior) === hash(mapped))) commitmentTransitions.push(mapped);
    }
    return { status: entries.length ? "STORE" : "NO_DURABLE_CONTENT", entries, commitmentTransitions,
      rejectedUnknownEntityCount: (first.rejectedUnknownEntityCount || 0) + (second.rejectedUnknownEntityCount || 0),
      localMetadataCorrectionCount: (first.localMetadataCorrectionCount || 0) + (second.localMetadataCorrectionCount || 0),
      rejectedCodes: [...(first.rejectedCodes || []), ...(second.rejectedCodes || [])] };
  }

  restoreDurableCheckpoint(snapshot, prior) {
    const scopeHash = this.checkpointScope(snapshot);
    const plan = planEvidence(snapshot);
    const sourceContext = { sourceRevision: snapshot.sourceRevision, completeness: snapshot.completeness,
      activeCommitmentsHash: hash(snapshot.activeCommitments),
      lineages: (snapshot.projectionLineages || []).map(row => ({ id: row.projectionId, digest: hash(row) })),
      sources: snapshot.fragments.map(fragment => ({ id: fragment.fragmentId, digest: this.checkpointFragment(snapshot, fragment) })) };
    const fresh = () => ({ version: 1, policyVersion: DURABLE_POLICY_VERSION, scopeHash,
      plannerVersion: PLANNER_VERSION, sourceDigest: plan.sourceDigest, planChecksum: plan.checksum,
      originalOrder: plan.originalOrder, orderedFragmentIds: plan.orderedFragmentIds,
      sourceContext, contextHash: hash([scopeHash, sourceContext]), chunks: [] });
    const checkpoint = prior?.extractionCheckpoint;
    if (!checkpoint) return fresh();
    if (checkpoint.version !== 1 || !["9.3.2", DURABLE_POLICY_VERSION].includes(checkpoint.policyVersion) || checkpoint.scopeHash !== scopeHash
      || !Array.isArray(checkpoint.chunks) || !Array.isArray(checkpoint.sourceContext?.sources)
      || !Array.isArray(checkpoint.sourceContext?.lineages)
      || checkpoint.contextHash !== hash([scopeHash, checkpoint.sourceContext])) {
      throw new Error("memory4_checkpoint_corrupt");
    }
    for (const saved of checkpoint.chunks) {
      if (!Array.isArray(saved.sources) || !saved.result || saved.digest !== hash([scopeHash, saved.sources, saved.result])) {
        throw new Error("memory4_checkpoint_corrupt");
      }
    }
    // Old leaves are readable but cannot certify completion under a different source plan.
    if (checkpoint.policyVersion !== DURABLE_POLICY_VERSION || checkpoint.plannerVersion !== PLANNER_VERSION) return fresh();
    const oldPlan = { sourceDigest: checkpoint.sourceDigest, planChecksum: checkpoint.planChecksum,
      originalOrder: checkpoint.originalOrder, orderedFragmentIds: checkpoint.orderedFragmentIds };
    if (!/^[a-f0-9]{64}$/.test(oldPlan.sourceDigest || "") || !/^[a-f0-9]{64}$/.test(oldPlan.planChecksum || "")
      || !Array.isArray(oldPlan.originalOrder) || !Array.isArray(oldPlan.orderedFragmentIds)) throw new Error("memory4_checkpoint_corrupt");
    if (checkpoint.contextHash === hash([scopeHash, sourceContext]) && (oldPlan.sourceDigest !== plan.sourceDigest
      || oldPlan.planChecksum !== plan.checksum || hash(oldPlan.originalOrder) !== hash(plan.originalOrder)
      || hash(oldPlan.orderedFragmentIds) !== hash(plan.orderedFragmentIds))) return fresh();
    if (checkpoint.contextHash !== hash([scopeHash, sourceContext])) {
      const old = checkpoint.sourceContext;
      const currentSources = new Map(sourceContext.sources.map(row => [row.id, row.digest]));
      const oldSources = new Map(old.sources.map(row => [row.id, row.digest]));
      const oldLineages = new Map(old.lineages.map(row => [row.id, row.digest]));
      const knownForgotten = new Set(strings(prior?.forgottenFragmentIds));
      const forgottenLineages = new Set(this.store.listForgottenProjections(snapshot).map(row => row.projectionId));
      const removedSources = old.sources.filter(row => !currentSources.has(row.id));
      const currentLineages = new Set(sourceContext.lineages.map(row => row.id));
      const removedLineages = old.lineages.filter(row => !currentLineages.has(row.id));
      const provenForget = (removedSources.length > 0 || removedLineages.length > 0)
        && old.activeCommitmentsHash === sourceContext.activeCommitmentsHash
        && sourceContext.sources.every(row => oldSources.get(row.id) === row.digest)
        && removedSources.every(row => knownForgotten.has(row.id))
        && sourceContext.lineages.every(row => oldLineages.get(row.id) === row.digest)
        && removedLineages.every(row => forgottenLineages.has(row.id));
      if (!provenForget) return fresh();
    }
    const current = new Map(snapshot.fragments.map(fragment => [fragment.fragmentId, fragment]));
    const chunks = [];
    for (const saved of checkpoint.chunks) {
      if (!Array.isArray(saved.sources) || !saved.result || saved.digest !== hash([scopeHash, saved.sources, saved.result])) {
        throw new Error("memory4_checkpoint_corrupt");
      }
      // A model saw the whole leaf: any removed or changed source invalidates that leaf.
      if (saved.sources.some(source => !current.has(source.id)
        || source.digest !== this.checkpointFragment(snapshot, current.get(source.id)))) continue;
      const available = new Set(saved.sources.filter(source => current.has(source.id)).map(source => source.id));
      const result = this.pruneDurableResult(saved.result, available);
      const verified = this.parseResult({ content: JSON.stringify(result), finish_reason: "stop" },
        [...available].map(id => current.get(id)), snapshot);
      if (verified.rejectedUnknownEntityCount) throw new Error("memory4_checkpoint_corrupt");
      const sources = saved.sources.filter(source => available.has(source.id));
      const record = { sources, result: { ...result, entries: verified.entries, commitmentTransitions: verified.commitmentTransitions } };
      record.digest = hash([scopeHash, record.sources, record.result]);
      chunks.push(record);
    }
    return { ...fresh(), chunks };
  }

  buildPrompt(snapshot, fragments, remainingEntrySlots = MAX_DURABLE_ENTRIES_PER_OWNER, remainingTransitionSlots = MAX_DURABLE_ENTRIES_PER_OWNER) {
    const sourceFragments = snapshot.fragments || fragments;
    if (!this.sourcePositions.has(sourceFragments)) this.sourcePositions.set(sourceFragments,
      new Map(sourceFragments.map((fragment, position) => [fragment.fragmentId, position])));
    const originalPositions = this.sourcePositions.get(sourceFragments);
    const entityNames = [], relationships = [];
    const nameKeys = new Map(), relationshipKeys = new Map();
    const reference = (rows, keys, row) => {
      const key = JSON.stringify(row);
      if (!keys.has(key)) { keys.set(key, rows.length); rows.push(row); }
      return keys.get(key);
    };
    const projected = fragments.map((fragment, position) => {
      const allowedEntityIds = ids([...(fragment.knownBy?.includes(snapshot.ownerId) ? [snapshot.ownerId] : []),
        fragment.speakerId, ...fragment.entityIds]);
      const nameRefs = (snapshot.entityNameEvidence || []).filter(row => row.fragmentId === fragment.fragmentId
        && allowedEntityIds.includes(row.entityId) && (row.ownerId == null || row.ownerId === snapshot.ownerId)
        && (row.campaignToken == null || row.campaignToken === snapshot.campaignToken))
        .map(row => reference(entityNames, nameKeys, { entityId: row.entityId, name: row.name }));
      const relationshipRefs = (snapshot.relationshipEvidence || []).filter(row => row.fragmentId === fragment.fragmentId
        && row.ownerId === snapshot.ownerId && row.campaignToken === snapshot.campaignToken
        && row.knownToOwner === true && allowedEntityIds.includes(row.entityId))
        .map(row => reference(relationships, relationshipKeys, { entityId: row.entityId, types: row.types, asOf: row.asOf }));
      const eventDate = normalizeGameDate(fragment.eventDate)?.canonical;
      const acquiredDate = normalizeGameDate(fragment.acquiredDate)?.canonical;
      return { fragmentId: fragment.fragmentId, fragmentRef: `f${position}`, sourceOrdinal: originalPositions.get(fragment.fragmentId), text: fragment.text, speakerId: fragment.speakerId,
        sourceType: fragment.sourceType, allowedEntityIds, participantIds: ids(fragment.presentIds), nameRefs, relationshipRefs,
        ...(fragment.legacyMemoryId ? { sourceAsOf: fragment.legacyAnchorGameDate } : {}),
        ...(eventDate ? { eventDate } : {}), ...(acquiredDate ? { acquiredDate } : {}) };
    });
    return [
      { role: "system", content: `VOTC Memory Engine 4.0 Durable extraction. Contract v9.3.3.
Return JSON only: {"status":"STORE"|"NO_DURABLE_CONTENT","entries":[],"commitmentTransitions":[]}.
Each entry: {"memoryType":"DURABLE_KNOWLEDGE","text":"evidence-backed third-person archival prose","fragmentIds":["copy exact supplied ID"],"entityIds":[],"participantIds":[],"topics":[],"eventTime":{"from":null,"to":null,"precision":"unknown","status":"unknown"}}. entityIds and participantIds contain JSON integers, never strings, names, table indices or quoted numbers. Copy actual IDs from the cited fragments only; use [] if uncertain.
memoryType must be RELATIONSHIP_CHANGE, COMMITMENT, DURABLE_KNOWLEDGE, MAJOR_EXPERIENCE, LONG_TERM_GOAL or EMOTIONAL_ANCHOR. Only significant lasting information qualifies; do not save routine chatter. Preserve important names, conditions and quantities without inventing facts. Owner is the memory holder (记忆持有人), never a master or 主人.
Prioritize lasting consequences, major events, experiences, historical recollections, reported news, relationships, conditional promises, goals and secrets. Plain greetings, empty gestures and repetitive scene decoration normally create no memory. "你好" or "我挠挠头，端起茶杯" alone normally yields no entry; "摸刀柄，昨晚看见刺客" contains an account; "拔刀刺伤使臣，当场被捕" contains a consequential event. Preserve negation and conditions such as "若北伐成功才恢复兵权". "听闻城池失守，尚未证实" stays reported or rumor; "十年前逃离汴京，日期未知" keeps unknown dates. Never fill a quota: fewer than eight entries is valid. Merge paraphrases with all supported source IDs. Input priority is not truth; sourceOrdinal preserves the original chronology, including cancellations after earlier promises.
eventTime.status must be observed, reported, planned or unknown. eventTime.precision must be day, month, year, range or unknown. Uncertain dates require from:null, to:null, precision:"unknown"; status describes the evidence, not whether the date is known. Dated events need both dates in the supplied evidence; never invent or translate a relative date using another fragment's date. sourceAsOf anchors Legacy statements. When sourceType is spoken, reported or rumor, use reported for accounts, planned for future intentions, or unknown; observed is forbidden even if a speaker says they saw it or the dialogue happened now. observed is allowed only when EVERY cited fragment has sourceType witnessed or game_fact. Future completed facts are prohibited; a future plan stays planned. Use status:"unknown" only when the event status is uncertain; that status never permits dates.
Every entry must cite at least one exact supplied fragmentId or its short fragmentRef, such as "f0", in fragmentIds. Prefer fragmentRef to avoid copying long IDs; the application resolves it to that request's original source. Never construct IDs or borrow references from another request. entityIds may only contain the union of allowedEntityIds from those cited fragments. participantIds are presence evidence only and never authorize entityIds. Owner ID may be used when listed in allowedEntityIds for a fact about the Owner as its own subject or as the listener; include it only when relevant. Empty entityIds is valid when no identity can be supported. Do not include everyone present or names found only in other fragments. Do not change Campaign or Owner. Source visibility and knownBy are granted locally, never by your output.
entityNames and relationships are deduplicated tables. Each fragment's nameRefs and relationshipRefs authorize only those table rows for that fragment. Names and roles never authorize an entity ID. Use only names authorized by the cited fragment; an absent name remains unknown. Preserve exact quotations for commitments. Relationships are scoped CK3 readback at asOf, not proof of a historical change, private knowledge or a confirmed game effect. Ambiguous identities stay ambiguous.
Follow the dynamic request limits: return no more than limits.maxEntries entries and limits.maxCommitmentTransitions commitment transitions for this owner in this request. STORE requires nonempty entries; NO_DURABLE_CONTENT requires entries:[]. Zero allowance means return no entries. A repair request supplies safe validation codes, not new evidence: correct only against the supplied fragments. Do not repeat alreadyAccepted facts.
Each transition: {"entryId":"copy activeCommitment ID","expectedRevision":1,"status":"fulfilled"|"cancelled"|"superseded","fragmentIds":["exact ID"],"evidenceQuote":"complete verbatim source quote","commitmentQuote":"exact concrete quote shared with the original commitment","replacementEntryIndex":0}. replacementEntryIndex is required only for superseded and must point to a new COMMITMENT whose text is copied verbatim from the replacement evidence. The binding must identify exactly one supplied active commitment and cover every original condition. Questions, future plans, hypotheticals, negations, hearsay, generic phrases, ambiguous references and years of silence never change status. No transition confirms a CK3 effect.` },
      { role: "user", content: JSON.stringify({ contractVersion: "9.3.3", ownerId: snapshot.ownerId,
        campaignToken: snapshot.campaignToken, conversationDate: snapshot.date, completeness: snapshot.completeness,
        entityNames, relationships, fragments: projected,
        activeCommitments: this.relevantCommitments(snapshot.activeCommitments, fragments).map(entry => ({ entryId: entry.entryId,
          expectedRevision: entry.revision, text: entry.text })),
        limits: { maxEntries: remainingEntrySlots, maxCommitmentTransitions: remainingTransitionSlots } }) }
    ];
  }

  parseResult(response, allowedFragments, snapshot = null, maxEntries = MAX_DURABLE_ENTRIES_PER_OWNER,
    maxTransitions = MAX_DURABLE_ENTRIES_PER_OWNER, forgottenFragmentIds = [], { collectRejections = false, fragmentRefs = null } = {}) {
    const outcome = validateGenerationOutcome(response);
    if (outcome.truncated || !outcome.complete) throw new Error("memory4_generation_incomplete");
    const content = String(outcome.content || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
    let parsed;
    try { parsed = JSON.parse(content); }
    catch { throw new Error("memory4_response_invalid_json"); }
    if (fragmentRefs) {
      const resolveRefs = candidate => candidate && typeof candidate === "object" && Array.isArray(candidate.fragmentIds)
        ? { ...candidate, fragmentIds: candidate.fragmentIds.map(id => fragmentRefs.get(id) || id) } : candidate;
      if (Array.isArray(parsed?.entries)) parsed.entries = parsed.entries.map(resolveRefs);
      if (Array.isArray(parsed?.commitmentTransitions)) parsed.commitmentTransitions = parsed.commitmentTransitions.map(resolveRefs);
    }
    const entryLimit = Math.max(0, Number.isInteger(maxEntries) ? maxEntries : MAX_DURABLE_ENTRIES_PER_OWNER);
    if (!parsed || !["STORE", "NO_DURABLE_CONTENT"].includes(parsed.status) || !Array.isArray(parsed.entries)
      || parsed.entries.length > entryLimit || (parsed.status === "STORE") !== (parsed.entries.length > 0)) throw new Error("memory4_response_invalid_shape");
    const transitions = parsed.commitmentTransitions || [];
    if (!Array.isArray(transitions) || transitions.length > maxTransitions) throw new Error("memory4_response_invalid_transitions");
    const allowed = new Set(allowedFragments.map(fragment => fragment.fragmentId));
    const forgotten = new Set(strings(forgottenFragmentIds));
    const validateLateSources = candidate => {
      if (!Array.isArray(candidate?.fragmentIds) || !candidate.fragmentIds.length
        || candidate.fragmentIds.some(id => typeof id !== "string" || !id
          || !allowed.has(id) && !forgotten.has(id))) throw new Error("memory4_response_source_mismatch");
      return !candidate.fragmentIds.some(id => forgotten.has(id));
    };
    const entries = [];
    const entryPositions = new Map();
    let rejectedUnknownEntityCount = 0;
    let localMetadataCorrectionCount = 0;
    const rejectedCodes = [];
    for (let [position, candidate] of parsed.entries.entries()) {
      try {
        if (!validateLateSources(candidate)) continue;
        let metadataCorrected = false;
        if (collectRejections && snapshot && candidate?.eventTime && typeof candidate.eventTime === "object") {
          const cited = strings(candidate.fragmentIds).map(id => snapshot.fragments.find(fragment => fragment.fragmentId === id));
          if (cited.length && cited.every(fragment => fragment?.knownBy.includes(snapshot.ownerId))) {
            const eventTime = { ...candidate.eventTime };
            if (eventTime.status === "observed" && !cited.every(fragment => ["witnessed", "game_fact"].includes(fragment.sourceType))) {
              eventTime.status = "reported";
              metadataCorrected = true;
            }
            if (eventTime.from == null && eventTime.to == null && ["day", "month", "year", "range"].includes(eventTime.precision)) {
              eventTime.precision = "unknown";
              metadataCorrected = true;
            }
            if (metadataCorrected) candidate = { ...candidate, eventTime };
          }
        }
        if (snapshot) validateEntry(candidate, snapshot);
        if (metadataCorrected) localMetadataCorrectionCount++;
        entryPositions.set(position, entries.length); entries.push(candidate);
      } catch (error) {
        if (error.message === "memory4_unknown_entity") rejectedUnknownEntityCount++;
        else if (!collectRejections || !DURABLE_REPAIRABLE_ERRORS.has(error.message)) throw error;
        rejectedCodes.push(error.message);
      }
    }
    const retainedTransitions = [];
    for (const transition of transitions) {
      try {
        if (!validateLateSources(transition)) continue;
        const retained = { ...transition };
        if (retained.status === "superseded") {
          if (!entryPositions.has(retained.replacementEntryIndex)) throw new Error("memory4_commitment_replacement_invalid");
          retained.replacementEntryIndex = entryPositions.get(retained.replacementEntryIndex);
        }
        if (collectRejections && snapshot) {
          const index = this.store.loadIndex(snapshot);
          const metadata = this.store.read(path.join(this.store.directory(snapshot), "metadata.json"), null);
          this.store.commitmentChanges(snapshot, [...retainedTransitions, retained],
            entries.map(entry => validateEntry(entry, snapshot)), index, metadata);
        }
        retainedTransitions.push(retained);
      } catch (error) {
        if (!collectRejections || !DURABLE_REPAIRABLE_ERRORS.has(error.message)) throw error;
        rejectedCodes.push(error.message);
      }
    }
    return { ...parsed, status: entries.length ? "STORE" : "NO_DURABLE_CONTENT", entries,
      commitmentTransitions: retainedTransitions, rejectedUnknownEntityCount,
      ...(collectRejections ? { rejectedCodes, localMetadataCorrectionCount } : {}) };
  }

  makeDurableSendGuard(snapshot, chunk, isCurrent = () => true) {
    const sourceIdentity = value => hash([value.campaignToken, value.ownerId, value.conversationId,
      value.finalizationId, value.sourceRevision, value.date, value.completeness, value.fragments, value.activeCommitments,
      value.entityNameEvidence, value.relationshipEvidence, value.projectionLineages]);
    const expectedIdentity = sourceIdentity(snapshot);
    const expectedChunk = hash(chunk);
    return () => {
      let latest, recovery;
      try {
        latest = this.store.filterForgottenSnapshot(snapshot).snapshot;
        recovery = this.readRecovery(this.recoveryPath(snapshot));
      } catch { throw new Error("memory4_request_source_changed_before_send"); }
      if (!isCurrent() || sourceIdentity(latest) !== expectedIdentity || hash(chunk) !== expectedChunk
        || !recovery || sourceIdentity(recovery.snapshot) !== expectedIdentity
        || hash(this.relevantCommitments(this.store.activeCommitments(latest), latest.fragments)) !== hash(snapshot.activeCommitments)
        || snapshot.legacyRecompression === true && !this.isLegacyRecompressionSnapshotCurrent(snapshot)) {
        throw new Error("memory4_request_source_changed_before_send");
      }
    };
  }

  async finishOwner(snapshot, requestDurable, prior = null, isCurrent = () => true,
    { handoffOnly = false, durableTraceRun = null, origin = "other", operation = null } = {}) {
    const file = this.recoveryPath(snapshot);
    if (this.inFlight.has(file)) return { status: "IN_PROGRESS", ownerId: snapshot.ownerId };
    this.inFlight.add(file);
    const traceRun = durableTraceRun || this.beginDurableTraceRun(snapshot, { origin, operation });
    const parsedAttempts = [];
    const forgottenFragmentIds = new Set(strings(prior?.forgottenFragmentIds));
    let forgetFilterPassed = false;
    let extractionCheckpoint = null;
    try {
      const hadFragments = Array.isArray(snapshot.fragments) && snapshot.fragments.length > 0;
      let sourceFilteredByForget = false;
      const filtered = this.store.filterForgottenSnapshot(snapshot);
      forgetFilterPassed = true;
      snapshot = filtered.snapshot;
      if (filtered.forgottenProjectionIds.length || filtered.removedFragmentCount) {
        (filtered.removedFragmentIds || []).forEach(id => forgottenFragmentIds.add(id));
        sourceFilteredByForget = true;
        if (prior?.status !== "DERIVED_REBUILD_FAILED") {
          const { schemaVersion: _schemaVersion, snapshot: _oldSnapshot, updatedAt: _updatedAt, ...priorState } = prior || {};
          this.saveRecovery(snapshot, { ...priorState, forgottenFragmentIds: [...forgottenFragmentIds], status: "PENDING", lastError: null });
        }
      }
      if (hadFragments && !snapshot.fragments.length && (filtered.forgottenProjectionIds.length || filtered.removedFragmentCount)) {
        if (prior?.status === "DERIVED_REBUILD_FAILED") return { ownerId: snapshot.ownerId, status: "RECOVERY_UNVERIFIED",
          reason: "DERIVED_RECOVERY_SOURCE_FORGOTTEN", recoveryPath: file };
        if (fs.existsSync(file)) this.baseStore.removeSummaryMutationFile(file);
        return { ownerId: snapshot.ownerId, status: "FORGOTTEN", forgottenProjectionIds: filtered.forgottenProjectionIds };
      }
      if (!isCurrent()) throw new Error("memory4_generation_changed");
      const committedProof = this.inspectCommittedSnapshot(snapshot, { sourceFilteredByForget });
      if (committedProof.state === "COMMITTED") {
        this.recordDisclosures(snapshot, { campaignToken: snapshot.campaignToken, date: snapshot.date,
          characters: new Map((snapshot.disclosureCharacters || []).map(character => [character.id, character])) });
        const recovery = this.finishCanonicalRecovery(snapshot, file, { sourceFilteredByForget });
        return { ownerId: snapshot.ownerId, ...committedProof.record, alreadyCommitted: true,
          durableStatus: committedProof.record.status, recoveryStatus: recovery.status,
          ...(fs.existsSync(file) ? { recoveryPath: file } : {}) };
      }
      if (committedProof.state === "UNVERIFIED" || prior?.status === "DERIVED_REBUILD_FAILED") {
        return { ownerId: snapshot.ownerId, status: "RECOVERY_UNVERIFIED", reason: committedProof.reason || "DERIVED_RECOVERY_COMMIT_UNVERIFIED",
          recoveryPath: file };
      }
      snapshot.activeCommitments = this.relevantCommitments(this.store.activeCommitments(snapshot), snapshot.fragments);
      extractionCheckpoint = this.restoreDurableCheckpoint(snapshot, { ...prior, forgottenFragmentIds: [...forgottenFragmentIds] });
      const saveProgress = () => this.saveRecovery(snapshot, { forgottenFragmentIds: [...forgottenFragmentIds],
        status: "PENDING", retryCount: prior?.retryCount || 0, lastError: null, extractionCheckpoint });
      saveProgress();
      if (!snapshot.skipKnownEvidence) this.store.recordKnownEvidence(snapshot);
      this.recordDisclosures(snapshot);
      if (handoffOnly) return { ownerId: snapshot.ownerId, status: "RECOVERY_PENDING", recoveryPath: file };
      let result;
      if (!snapshot.presentMessageCount && !snapshot.fragments.length) result = { status: "NOT_PRESENT", entries: [] };
      else if (!snapshot.fragments.length) result = { status: "NO_DURABLE_CONTENT", entries: [] };
      else {
        if (typeof requestDurable !== "function") throw new Error("memory4_provider_unavailable");
        const entries = [];
        const commitmentTransitions = [];
        let rejectedUnknownEntityCount = 0;
        const orderedFragments = this.orderFragments(snapshot, snapshot.fragments);
        const processed = new Set();
        const restoreProgress = () => {
          extractionCheckpoint = this.restoreDurableCheckpoint(snapshot, { extractionCheckpoint, forgottenFragmentIds: [...forgottenFragmentIds] });
          let accumulated = { entries: [], commitmentTransitions: [], rejectedUnknownEntityCount: 0, rejectedCodes: [] };
          processed.clear();
          for (const saved of extractionCheckpoint.chunks) {
            accumulated = this.mergeDurableResults(accumulated, saved.result, snapshot);
            for (const source of saved.sources) processed.add(source.id);
          }
          entries.splice(0, entries.length, ...accumulated.entries);
          commitmentTransitions.splice(0, commitmentTransitions.length, ...accumulated.commitmentTransitions);
          rejectedUnknownEntityCount = accumulated.rejectedUnknownEntityCount;
        };
        restoreProgress();
        const remember = (chunk, parsed) => {
          const record = { sources: chunk.map(fragment => ({ id: fragment.fragmentId,
            digest: this.checkpointFragment(snapshot, fragment) })), result: parsed };
          record.digest = hash([extractionCheckpoint.scopeHash, record.sources, record.result]);
          extractionCheckpoint.chunks.push(record);
          restoreProgress();
          saveProgress();
        };
        let generationCount = 0;
        const extractChunk = async (chunk, remainingEntrySlots, remainingTransitionSlots, lineage, refreshCount = 0) => {
          if (!isCurrent()) throw new Error("memory4_generation_changed");
          const beforeRequest = this.store.filterForgottenSnapshot(snapshot);
          if (beforeRequest.forgottenProjectionIds.length || beforeRequest.removedFragmentCount) {
            (beforeRequest.removedFragmentIds || []).forEach(id => forgottenFragmentIds.add(id));
            snapshot = beforeRequest.snapshot;
            sourceFilteredByForget = true;
            restoreProgress();
          }
          chunk = chunk.filter(fragment => !processed.has(fragment.fragmentId)
            && snapshot.fragments.some(current => current.fragmentId === fragment.fragmentId));
          if (!chunk.length || remainingEntrySlots === 0 && remainingTransitionSlots === 0) return;
          saveProgress();
          const durableTrace = this.beginDurableTraceAttempt(traceRun, { ownerId: snapshot.ownerId, campaignToken: snapshot.campaignToken,
            finalizationId: snapshot.finalizationId, chunkIndex: lineage.chunkIndex, chunkTotal: lineage.chunkTotal,
            chunkPath: lineage.chunkPath, fragmentCount: chunk.length, origin, operation,
            sourceDigest: this.durableTraceHash("source_digest", [snapshot.sourceRevision, chunk]) }, { parentAttemptId: lineage.parentAttemptId,
            retryDepth: lineage.retryDepth, retryReason: lineage.retryReason });
          const send = async (messages, attempt) => {
            if (++generationCount > 32) throw new Error("memory4_generation_budget_exhausted");
            const inputBudget = chunk.length === 1 ? DURABLE_SINGLE_FRAGMENT_BUDGET : DURABLE_INPUT_TOKEN_BUDGET;
            if (this.estimateDurableInput(messages) > inputBudget) throw new Error("memory4_fragment_input_too_large");
            const response = await requestDurable(messages, { ownerId: snapshot.ownerId, campaignToken: snapshot.campaignToken,
              maxTokens: DURABLE_MAX_OUTPUT_TOKENS, providerSnapshot: snapshot.summaryProviderSnapshot,
              durableTrace: attempt, beforeSendGuard: this.makeDurableSendGuard(snapshot, chunk, isCurrent) });
            if (!isCurrent()) throw new Error("memory4_generation_changed");
            const latest = this.store.filterForgottenSnapshot(snapshot);
            if (latest.forgottenProjectionIds.length || latest.removedFragmentCount) {
              (latest.removedFragmentIds || []).forEach(id => forgottenFragmentIds.add(id));
              snapshot = latest.snapshot;
              sourceFilteredByForget = true;
              restoreProgress();
              if (chunk.some(fragment => (latest.removedFragmentIds || []).includes(fragment.fragmentId))) {
                throw new Error("memory4_response_source_forgotten");
              }
            }
            const allowedChunk = chunk.filter(fragment => snapshot.fragments.some(current => current.fragmentId === fragment.fragmentId));
            const sentPayload = JSON.parse(messages[1].content);
            const sentLimits = sentPayload.limits;
            const fragmentRefs = new Map(sentPayload.fragments.map(fragment => [fragment.fragmentRef, fragment.fragmentId]));
            return this.parseResult(response, allowedChunk, snapshot, sentLimits.maxEntries, sentLimits.maxCommitmentTransitions,
              [...forgottenFragmentIds], { collectRejections: true, fragmentRefs });
          };
          try {
            let parsed;
            try { parsed = await send(this.buildPrompt(snapshot, chunk, remainingEntrySlots, remainingTransitionSlots), durableTrace); }
            catch (error) {
              if (!DURABLE_REPAIRABLE_ERRORS.has(error.message)) throw error;
              parsed = { entries: [], commitmentTransitions: [], rejectedCodes: [error.message], rejectedUnknownEntityCount: 0 };
            }
            const initialAccepted = parsed.entries.length > 0 || parsed.commitmentTransitions.length > 0 || parsed.rejectedCodes.length === 0;
            const initialRejected = parsed.rejectedCodes.length > 0;
            if (parsed.rejectedCodes.length) {
              this.recordDurableTrace(durableTrace, { status: "REJECTED", parseStatus: "SOURCE_REJECTED", errorCode: parsed.rejectedCodes[0] });
              if (parsed.rejectedUnknownEntityCount) this.trace?.record("memory4_candidate_rejected", {
                ownerId: snapshot.ownerId, count: parsed.rejectedUnknownEntityCount, reason: "unknown_entity" });
              const repairTrace = this.beginDurableTraceAttempt(traceRun, { ownerId: snapshot.ownerId, campaignToken: snapshot.campaignToken,
                finalizationId: snapshot.finalizationId, chunkIndex: lineage.chunkIndex, chunkTotal: lineage.chunkTotal,
                chunkPath: lineage.chunkPath, fragmentCount: chunk.length, origin, operation,
                sourceDigest: this.durableTraceHash("source_digest", [snapshot.sourceRevision, chunk]) },
                { parentAttemptId: durableTrace?.durableAttemptId, retryDepth: lineage.retryDepth + 1, retryReason: "other" });
              const messages = this.buildPrompt(snapshot, chunk, remainingEntrySlots - parsed.entries.length,
                remainingTransitionSlots - parsed.commitmentTransitions.length);
              const payload = JSON.parse(messages[1].content);
              payload.repair = { validationCodes: [...new Set(parsed.rejectedCodes)],
                alreadyAccepted: parsed.entries.map(entry => ({ memoryType: entry.memoryType, fragmentIds: entry.fragmentIds })) };
              if (parsed.rejectedCodes.includes("memory4_unknown_entity")) {
                payload.repair.entityIdHint = "For each entry independently, copy JSON integer IDs only from allowedEntityIds of its cited fragments. Do not copy names, table indices, quoted numbers or IDs from other fragments. If uncertain return entityIds:[]; that is valid.";
              }
              if (parsed.rejectedCodes.includes("memory4_unverified_observation")) {
                payload.repair.observationHint = "A spoken account cannot be observed, including first-person statements. Use reported for such accounts, planned for intentions, or unknown. Keep uncertain dates null.";
              }
              if (parsed.rejectedCodes.some(code => ["memory4_unsupported_event_date", "memory4_unknown_time_has_date", "memory4_future_fact"].includes(code))) {
                payload.repair.eventTimeHint = "conversationDate and acquiredDate are not event-date evidence. Do not date an event from another fragment or infer dates from relative wording. Unless the cited source supports the exact event dates, use from:null, to:null, precision:unknown; keep reported/planned/unknown according to that source. Never change the text or turn a future intention into an observed/completed fact.";
              }
              messages[1].content = JSON.stringify(payload);
              try {
                const repaired = await send(messages, repairTrace);
                const initial = parsed;
                parsed = this.mergeDurableResults(initial, repaired, snapshot);
                const repairAccepted = repaired.entries.length > 0 || repaired.commitmentTransitions.length > 0;
                // An empty repair cannot prove that rejected facts contained no durable content.
                parsed.rejectedCodes = repairAccepted ? repaired.rejectedCodes
                  : [...initial.rejectedCodes, ...repaired.rejectedCodes];
                parsed.rejectedUnknownEntityCount = repaired.rejectedUnknownEntityCount
                  + (repairAccepted ? 0 : initial.rejectedUnknownEntityCount);
                this.recordDurableTrace(repairTrace, { status: repairAccepted ? "PARSED_OK" : "REJECTED",
                  parseStatus: repairAccepted ? "PARSED_OK" : "SOURCE_REJECTED", errorCode: repaired.rejectedCodes[0] });
                if (repairTrace && repairAccepted) parsedAttempts.push(repairTrace);
              } catch (error) {
                this.recordDurableTrace(repairTrace, durableTraceFailure(error, repairTrace));
                if (!DURABLE_REPAIRABLE_ERRORS.has(error.message) && error.message !== "memory4_fragment_input_too_large") throw error;
                if (!parsed.entries.length && !parsed.commitmentTransitions.length) throw error;
              }
            }
            if (!parsed.entries.length && !parsed.commitmentTransitions.length && parsed.rejectedCodes.length) {
              throw new Error(parsed.rejectedCodes[0] === "memory4_unknown_entity"
                ? "memory4_response_no_valid_entries" : parsed.rejectedCodes[0]);
            }
            if (!initialRejected) this.recordDurableTrace(durableTrace, { status: "PARSED_OK", parseStatus: "PARSED_OK", complete: true, truncated: false });
            if (durableTrace && initialAccepted) parsedAttempts.push(durableTrace);
            const available = new Set(snapshot.fragments.map(fragment => fragment.fragmentId));
            parsed = this.pruneDurableResult(parsed, available);
            remember(chunk.filter(fragment => available.has(fragment.fragmentId)), parsed);
          } catch (error) {
            this.recordDurableTrace(durableTrace, durableTraceFailure(error, durableTrace));
            if (!isCurrent()) throw new Error("memory4_generation_changed");
            if (["memory4_request_source_changed_before_send", "memory4_response_source_forgotten"].includes(error.message)
              && refreshCount < 1) {
              const refreshed = this.store.filterForgottenSnapshot(snapshot);
              if (!refreshed.removedFragmentCount && !refreshed.forgottenProjectionIds.length
                && error.message !== "memory4_response_source_forgotten") throw error;
              (refreshed.removedFragmentIds || []).forEach(id => forgottenFragmentIds.add(id));
              snapshot = refreshed.snapshot;
              sourceFilteredByForget = true;
              restoreProgress();
              return extractChunk(chunk, MAX_DURABLE_ENTRIES_PER_OWNER - entries.length,
                snapshot.activeCommitments.length ? MAX_DURABLE_ENTRIES_PER_OWNER - commitmentTransitions.length : 0,
                { ...lineage, parentAttemptId: durableTrace?.durableAttemptId || lineage.parentAttemptId,
                  retryDepth: lineage.retryDepth + 1, retryReason: "source_changed_before_send" }, refreshCount + 1);
            }
            if (error.message !== "memory4_generation_incomplete" || chunk.length <= 1) throw error;
            const midpoint = Math.ceil(chunk.length / 2);
            const retry = branch => ({ ...lineage, chunkPath: [...lineage.chunkPath, branch],
              parentAttemptId: durableTrace?.durableAttemptId || lineage.parentAttemptId,
              retryDepth: lineage.retryDepth + 1, retryReason: "output_truncated" });
            await extractChunk(chunk.slice(0, midpoint), remainingEntrySlots, remainingTransitionSlots, retry(0));
            await extractChunk(chunk.slice(midpoint), MAX_DURABLE_ENTRIES_PER_OWNER - entries.length,
              snapshot.activeCommitments.length ? MAX_DURABLE_ENTRIES_PER_OWNER - commitmentTransitions.length : 0, retry(1));
          }
        };
        const chunks = this.chunkFragments(snapshot, orderedFragments.filter(fragment => !processed.has(fragment.fragmentId)));
        for (const [chunkIndex, chunk] of chunks.entries()) {
          await extractChunk(chunk, MAX_DURABLE_ENTRIES_PER_OWNER - entries.length,
            snapshot.activeCommitments.length ? MAX_DURABLE_ENTRIES_PER_OWNER - commitmentTransitions.length : 0,
            { chunkIndex, chunkTotal: chunks.length, chunkPath: [chunkIndex], parentAttemptId: null, retryDepth: 0, retryReason: "other" });
          if (entries.length >= MAX_DURABLE_ENTRIES_PER_OWNER
            && (!snapshot.activeCommitments.length || commitmentTransitions.length >= MAX_DURABLE_ENTRIES_PER_OWNER)) break;
        }
        if (rejectedUnknownEntityCount) this.trace?.record("memory4_candidate_rejected", {
          ownerId: snapshot.ownerId, count: rejectedUnknownEntityCount, reason: "unknown_entity"
        });
        result = { status: entries.length ? "STORE" : "NO_DURABLE_CONTENT", entries, commitmentTransitions,
          evaluatedFragmentCount: processed.size, extractionPolicyVersion: DURABLE_POLICY_VERSION,
          localMetadataCorrectionCount: extractionCheckpoint.chunks.reduce((count, saved) => count + (saved.result.localMetadataCorrectionCount || 0), 0),
          rejectedCandidateCount: extractionCheckpoint.chunks.reduce((count, saved) => count + (saved.result.rejectedCodes?.length || 0), 0) };
      }
      if (!isCurrent()) throw new Error("memory4_generation_changed");
      const latest = this.store.filterForgottenSnapshot(snapshot);
      if (latest.forgottenProjectionIds.length || latest.removedFragmentCount) {
        snapshot = latest.snapshot;
        (latest.removedFragmentIds || []).forEach(id => forgottenFragmentIds.add(id));
        sourceFilteredByForget = true;
        if (snapshot.fragments.length === 0) {
          if (fs.existsSync(file)) this.baseStore.removeSummaryMutationFile(file);
          return { ownerId: snapshot.ownerId, status: "FORGOTTEN", forgottenProjectionIds: latest.forgottenProjectionIds };
        }
        result = this.pruneDurableResult(result, new Set(snapshot.fragments.map(fragment => fragment.fragmentId)));
        extractionCheckpoint = this.restoreDurableCheckpoint(snapshot, { extractionCheckpoint,
          forgottenFragmentIds: [...forgottenFragmentIds] });
        result = extractionCheckpoint.chunks.reduce((accumulated, saved) => this.mergeDurableResults(accumulated, saved.result, snapshot),
          { entries: [], commitmentTransitions: [], rejectedUnknownEntityCount: 0, rejectedCodes: [] });
      }
      if (sourceFilteredByForget && snapshot.fragments.length === 0) {
        if (fs.existsSync(file)) this.baseStore.removeSummaryMutationFile(file);
        return { ownerId: snapshot.ownerId, status: "FORGOTTEN" };
      }
      const evaluatedSourceIds = [...new Set(extractionCheckpoint?.chunks.flatMap(saved => saved.sources.map(source => source.id)) || [])];
      result.evaluatedFragmentCount = evaluatedSourceIds.length;
      if (evaluatedSourceIds.length < snapshot.fragments.length && result.entries.length < MAX_DURABLE_ENTRIES_PER_OWNER) {
        throw new Error("memory4_response_source_forgotten");
      }
      result.extractionPolicyVersion = DURABLE_POLICY_VERSION;
      result.coverageProof = coverageProof(snapshot, evaluatedSourceIds, result.entries.length);
      const persisted = this.repository.commitOwner(snapshot, result);
      parsedAttempts.forEach(attempt => this.recordDurableTrace(attempt, { status: "COMMITTED" }));
      this.recordDisclosures(snapshot, { campaignToken: snapshot.campaignToken, date: snapshot.date,
        characters: new Map((snapshot.disclosureCharacters || []).map(character => [character.id, character])) });
      const recovery = this.finishCanonicalRecovery(snapshot, file);
      this.trace?.record("memory4_durable", { finalizationId: snapshot.finalizationId, ownerId: snapshot.ownerId,
        status: persisted.status, entryCount: persisted.entryIds.length, completeness: persisted.completeness,
        recoveryStatus: recovery.status });
      return { ownerId: snapshot.ownerId, ...persisted, durableStatus: persisted.status,
        recoveryStatus: recovery.status,
        ...(fs.existsSync(file) ? { recoveryPath: file } : {}) };
    } catch (error) {
      if (!isCurrent()) return { ownerId: snapshot.ownerId, status: "CANCELLED",
        ...(fs.existsSync(file) ? { recoveryPath: file } : {}) };
      const retryCount = Number(prior?.retryCount || 0) + 1;
      if (forgetFilterPassed && !["memory4_request_source_changed_before_send", "memory4_checkpoint_corrupt"].includes(error.message)) this.saveRecovery(snapshot, { forgottenFragmentIds: [...forgottenFragmentIds], status: "EXTRACTION_FAILED",
        retryCount, lastError: String(error?.message || error), ...(extractionCheckpoint ? { extractionCheckpoint } : {}),
        failurePolicyVersion: DURABLE_POLICY_VERSION, failureSourceHash: this.durableFailureSource(snapshot) });
      this.trace?.record("memory4_durable", { finalizationId: snapshot.finalizationId, ownerId: snapshot.ownerId,
        status: "EXTRACTION_FAILED", errorCode: String(error?.message || error) });
      return { ownerId: snapshot.ownerId, status: "EXTRACTION_FAILED", retryCount, error: String(error?.message || error),
        ...(forgetFilterPassed && fs.existsSync(file) ? { recoveryPath: file } : {}) };
    } finally { this.inFlight.delete(file); }
  }

  finishCanonicalRecovery(snapshot, file, options = {}) {
    const cleared = this.clearVerifiedRecovery(snapshot, file, options);
    return { status: cleared ? "COMPLETE" : "RECOVERY_UNVERIFIED", providerRequests: 0,
      ...(cleared ? {} : { recoveryRetained: true, recoveryPath: file }) };
  }

  async finalizeCommitted(context, requestDurable, { isNarrativeCommitted, isCurrent = () => true, handoffOnly = false } = {}) {
    if (!isNarrativeCommitted) throw new Error("memory4_narrative_commit_required");
    if (typeof context.campaignToken !== "string" || !context.campaignToken.trim()) {
      return { status: "CAMPAIGN_UNAVAILABLE", owners: [], durableHandoffComplete: false };
    }
    const participantIds = ids((context.participants || []).map(participant => participant.id));
    const traceRun = this.beginDurableTraceRun(context, { origin: "finalization" });
    const excludedOwnerIds = ids(context.excludedSummaryOwnerIds);
    const intentionalExclusions = participantIds.filter(id => excludedOwnerIds.includes(id));
    const owners = participantIds.filter(id => !excludedOwnerIds.includes(id));
    const results = new Array(owners.length);
    const sourceRevisions = new Array(owners.length);
    let nextOwner = 0;
    const worker = async () => {
      while (nextOwner < owners.length) {
        const index = nextOwner++;
        const ownerId = owners[index];
        let snapshot;
        try {
          snapshot = this.buildOwnerSnapshot(context, ownerId);
          sourceRevisions[index] = snapshot.sourceRevision;
          const prior = this.readRecovery(this.recoveryPath(snapshot));
          results[index] = await this.finishOwner(snapshot, requestDurable, prior, isCurrent,
            { handoffOnly, durableTraceRun: traceRun, origin: "finalization" });
        } catch (error) {
          results[index] = { ownerId, status: "EXTRACTION_FAILED", error: String(error?.message || error),
            ...(snapshot && fs.existsSync(this.recoveryPath(snapshot)) ? { recoveryPath: this.recoveryPath(snapshot) } : {}) };
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(2, owners.length) }, worker));
    const status = results.some(result => ["EXTRACTION_FAILED", "DERIVED_REBUILD_FAILED", "RECOVERY_UNVERIFIED"].includes(result.status)) ? "PARTIAL_FAILURE"
      : results.some(result => result.status === "CANCELLED") ? "CANCELLED"
      : results.some(result => result.status === "IN_PROGRESS") ? "IN_PROGRESS"
      : results.some(result => result.status === "RECOVERY_PENDING") ? "HANDOFF_PENDING" : "COMPLETE";
    const terminal = new Set(["STORE", "NO_DURABLE_CONTENT", "NOT_PRESENT", "FORGOTTEN"]);
    const durableHandoffComplete = participantIds.length > 0 && owners.length + intentionalExclusions.length === participantIds.length
      && results.length === owners.length && results.every((result, index) => {
      if (terminal.has(result.status)) return true;
      if (!["EXTRACTION_FAILED", "DERIVED_REBUILD_FAILED", "RECOVERY_UNVERIFIED", "RECOVERY_PENDING"].includes(result.status) || !result.recoveryPath) return false;
      try {
        const record = this.readRecovery(result.recoveryPath);
        return record.snapshot.ownerId === result.ownerId && record.snapshot.finalizationId === context.finalizationId
          && record.snapshot.campaignToken === context.campaignToken && record.snapshot.sourceRevision === sourceRevisions[index];
      } catch { return false; }
    });
    return { status, owners: results, durableHandoffComplete };
  }

  async recoverPending(requestDurable, { manual = false, activeCampaignToken = null, isCurrent = () => true, isNarrativeCommitted = () => false } = {}) {
    if (!fs.existsSync(this.recoveryDir)) return [];
    const files = fs.readdirSync(this.recoveryDir).filter(name => /^[a-f0-9]{64}\.json$/.test(name));
    const results = new Array(files.length);
    let nextFile = 0;
    const worker = async () => {
      while (nextFile < files.length) {
        const index = nextFile++;
        const file = path.join(this.recoveryDir, files[index]);
        try {
          const record = this.readRecovery(file);
          const snapshot = record.snapshot;
          if (!activeCampaignToken || snapshot.campaignToken !== activeCampaignToken) { results[index] = { status: "CAMPAIGN_MISMATCH", ownerId: snapshot.ownerId }; continue; }
          const legacyRecompression = snapshot.legacyRecompression === true;
          if (!["PENDING", "EXTRACTION_FAILED", "DERIVED_REBUILD_FAILED"].includes(record.status)) {
            results[index] = { status: "RECOVERY_UNVERIFIED", ownerId: snapshot.ownerId, recoveryPath: file,
              reason: "RECOVERY_STATUS_UNKNOWN" };
            continue;
          }
          const committedProof = this.inspectCommittedSnapshot(snapshot);
          if (committedProof.state === "COMMITTED") {
            if (legacyRecompression && !this.isLegacyRecompressionSnapshotCurrent(snapshot)) {
              results[index] = { status: "RECOVERY_UNVERIFIED", ownerId: snapshot.ownerId, recoveryPath: file,
                reason: "LEGACY_SOURCE_CHANGED_AFTER_COMMIT" };
              continue;
            }
            const cleared = this.clearVerifiedRecovery(snapshot, file);
            results[index] = cleared
              ? { ownerId: snapshot.ownerId, status: "COMPLETE", durableStatus: committedProof.record.status,
                generated: false, providerRequests: 0 }
              : { ownerId: snapshot.ownerId, status: "RECOVERY_UNVERIFIED", recoveryPath: file,
                reason: "DURABLE_RECOVERY_CLEANUP_UNVERIFIED" };
            continue;
          }
          if (committedProof.state === "UNVERIFIED" || record.status === "DERIVED_REBUILD_FAILED") {
            results[index] = { ownerId: snapshot.ownerId, status: "RECOVERY_UNVERIFIED", recoveryPath: file,
              reason: committedProof.reason || "DERIVED_RECOVERY_COMMIT_UNVERIFIED" };
            continue;
          }
          const discardStaleLegacy = () => {
            if (!fs.existsSync(file)) return;
            this.readRecovery(file);
            this.baseStore.removeSummaryMutationFile(file);
          };
          if (legacyRecompression && !this.isLegacyRecompressionSnapshotCurrent(snapshot)) {
            discardStaleLegacy();
            results[index] = { status: "STALE", ownerId: snapshot.ownerId };
            continue;
          }
          if (!isNarrativeCommitted(snapshot) && !legacyRecompression) { results[index] = { status: "WAITING_NARRATIVE", ownerId: snapshot.ownerId }; continue; }
          if (!manual && record.failurePolicyVersion === DURABLE_POLICY_VERSION
            && (!record.failureSourceHash || record.failureSourceHash === this.durableFailureSource(snapshot))
            && (DURABLE_REPAIRABLE_ERRORS.has(record.lastError)
              || ["memory4_response_no_valid_entries", "memory4_checkpoint_corrupt", "memory4_fragment_input_too_large",
                "memory4_generation_budget_exhausted"].includes(record.lastError))) {
            results[index] = { status: "FAILED_MANUAL", ownerId: snapshot.ownerId, reason: record.lastError };
            continue;
          }
          if (!manual && Number(record.retryCount || 0) >= 3) { results[index] = { status: "FAILED_MANUAL", ownerId: snapshot.ownerId }; continue; }
          const recoveryIsCurrent = () => isCurrent() && (!legacyRecompression || this.isLegacyRecompressionSnapshotCurrent(snapshot));
          const traceRun = this.beginDurableTraceRun(snapshot, { origin: "recovery",
            operation: legacyRecompression ? "legacy_recompression" : null });
          results[index] = await this.finishOwner(snapshot, requestDurable, record, recoveryIsCurrent,
            { durableTraceRun: traceRun, origin: "recovery", operation: legacyRecompression ? "legacy_recompression" : null });
          if (legacyRecompression && results[index].status === "CANCELLED" && !this.isLegacyRecompressionSnapshotCurrent(snapshot)) {
            discardStaleLegacy();
            results[index] = { status: "STALE", ownerId: snapshot.ownerId };
          }
        } catch (error) {
          const reason = String(error?.message || error);
          results[index] = { status: "RECOVERY_UNVERIFIED", recoveryPath: file, reason, error: reason };
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(2, files.length) }, worker));
    return results;
  }
}

module.exports = { Memory4Coordinator };
