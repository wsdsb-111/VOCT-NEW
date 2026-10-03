"use strict";

const fs = require("fs");
const path = require("path");
const { assertScope, hash, ids, strings, legacySourceHash, validateEntry } = require("./memory4-contract");
const { projectVisibleTranscript } = require("./memory4-visibility");
const { Memory4Store } = require("./memory4-store");
const { Memory4ProfileService } = require("./memory4-profile");
const { Memory4RelationshipReadback } = require("./memory4-relationship-readback");
const { Memory4DerivedService } = require("./memory4-derived");
const { validateGenerationOutcome } = require("../providers/generation-outcome");
const { validateSourceItem, presentIds } = require("./finalization-visibility");

const MAX_FRAGMENTS_PER_REQUEST = 128;
const MAX_DURABLE_ENTRIES_PER_OWNER = 8;
const DURABLE_MAX_OUTPUT_TOKENS = 4096;

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

  async recompressLegacy(scope, { memoryId, expectedSourceHash = null, providerSnapshot = null } = {}) {
    assertScope(scope);
    scope = { campaignToken: scope.campaignToken, ownerId: scope.ownerId };
    const key = hash([scope, memoryId]);
    if (this.lazyInFlight.has(key)) return { status: "IN_PROGRESS", sourceMemoryId: memoryId, entryIds: [], retained: true };
    const source = this.legacySource(scope, memoryId);
    let facts = this.legacyFacts(scope, source);
    if (!source || expectedSourceHash && legacySourceHash(source) !== expectedSourceHash) return { status: "STALE", sourceMemoryId: memoryId, entryIds: [], retained: true };
    if (!facts.length) return { status: "RETAINED_LEGACY", sourceMemoryId: memoryId, entryIds: [], retained: true, reason: "UNPROVEN_FRAGMENT_BOUNDARY" };
    const index = this.store.loadIndex(scope);
    const covered = new Set(Object.values(index.entries).flatMap(row => (row.legacyRefs || []).filter(ref =>
      facts.some(fact => fact.memoryId === ref.memoryId && legacySourceHash(fact) === ref.sourceHash)).map(ref => ref.memoryId)));
    facts = facts.filter(fact => !covered.has(fact.memoryId)).slice(0, MAX_DURABLE_ENTRIES_PER_OWNER);
    if (!facts.length) return { status: "ALREADY_CONVERTED", sourceMemoryId: memoryId, entryIds: [], retained: true };
    const sourceHash = legacySourceHash(source), proofs = facts.map(memory => [memory.memoryId, legacySourceHash(memory)]);
    const current = () => (!this.derived.options.isCampaignCurrent || this.derived.options.isCampaignCurrent(scope.campaignToken))
      && legacySourceHash(this.legacySource(scope, memoryId) || {}) === sourceHash
      && proofs.every(([id, proof]) => {
        const memory = this.baseStore.getMemory(id);
        return memory && legacySourceHash(memory) === proof;
      });
    const fragments = facts.map(memory => ({ fragmentId: `legacy_${hash([memory.memoryId, legacySourceHash(memory)])}`,
      messageId: null, sourceMessageIds: [], text: memory.content,
      speakerId: ids(memory.provenance?.speakerIds).length === 1 ? ids(memory.provenance.speakerIds)[0] : scope.ownerId,
      presentIds: [scope.ownerId], knownBy: [scope.ownerId], visibility: "private", sourceType: "reported", recipientIds: [],
      entityIds: ids(memory.subjects), visibilityEvidence: "legacy_independent_owner_fact", legacyMemoryId: memory.memoryId,
      legacySourceHash: legacySourceHash(memory), legacyAnchorGameDate: memory.eventDate || source.eventDate || null }));
    const snapshot = { ...scope, conversationId: `legacy_${hash([memoryId, scope, proofs])}`, finalizationId: `legacy_${hash([scope, memoryId, sourceHash, proofs])}`,
      episodeId: null, date: source.eventDate || null, totalDays: source.totalDays ?? null, sourceRevision: hash([sourceHash, proofs]),
      fragments, presentMessageCount: 0, completeness: "partial", counterpartIds: [], summaryIds: [memoryId], legacyRetained: true, skipKnownEvidence: true };
    const prior = this.store.loadIndex(scope).finalizations[hash(snapshot.finalizationId)];
    if (prior) return { status: "ALREADY_CONVERTED", sourceMemoryId: memoryId, entryIds: [...prior.entryIds], retained: true };
    if (typeof this.derived.options.requestExtraction !== "function") return { status: "EXTRACTION_FAILED", sourceMemoryId: memoryId, entryIds: [], retained: true, reason: "memory4_provider_unavailable" };
    this.lazyInFlight.add(key);
    const controller = new AbortController();
    try {
      if (!current()) return { status: "CANCELLED", sourceMemoryId: memoryId, entryIds: [], retained: true };
      providerSnapshot ||= this.derived.options.getProviderSnapshot ? await this.derived.options.getProviderSnapshot() : null;
      const response = await this.derived.options.requestExtraction(this.buildPrompt(snapshot, fragments), {
        signal: controller.signal, maxTokens: DURABLE_MAX_OUTPUT_TOKENS, providerSnapshot, requestType: "memory4_durable" });
      if (!current()) return { status: "STALE", sourceMemoryId: memoryId, entryIds: [], retained: true };
      const result = this.parseResult(response, fragments, snapshot);
      if (!result.entries.length) return { status: "RETAINED_LEGACY", sourceMemoryId: memoryId, entryIds: [], retained: true, reason: "NO_DURABLE_CONTENT" };
      const committed = this.store.commitOwner(snapshot, result);
      this.derived.schedule(scope, { providerSnapshot });
      this.trace?.record("memory4_legacy_recompression", { ownerId: scope.ownerId, status: "COMPLETE", count: committed.entryIds.length });
      return { status: "COMPLETE", sourceMemoryId: memoryId, entryIds: [...committed.entryIds], retained: true };
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

  getKnownEntityProfile(scope, entityId, options = {}) {
    return this.profiles.getProfile(scope, entityId, options);
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
    for (const segment of context.verifiedSummarySegments || []) {
      const verified = validateSourceItem(segment, context, { segment: true });
      if (!verified.success) throw new Error(`memory4_visibility_source_invalid:${verified.reason}`);
      if (JSON.stringify(ids(segment.knownBy)) !== JSON.stringify(ids(verified.audience))) throw new Error("memory4_known_by_mismatch");
      if (!verified.audience.includes(ownerId) || !verified.speakers.length) continue;
      if (!segment.segmentId) throw new Error("memory4_segment_id_required");
      const speaker = verified.speakers[0];
      const text = String(segment.content || "");
      const recipientIds = ids(verified.audience.filter((id) => {
        if (id === speaker) return false;
        if (segment.visibility === "known_group") return true;
        const person = (context.participants || []).find((entry) => Number(entry.id) === id);
        return [person?.name, person?.fullName, person?.shortName].filter(Boolean)
          .some((name) => ["对", "向", "告诉", "问"].some((cue) => text.includes(`${cue}${name}`)));
      }));
      const entityIds = ids((context.participants || []).filter((person) => [person.name, person.fullName, person.shortName]
        .some((name) => name && text.includes(name))).map((person) => Number(person.id)));
      projection.fragments.push({ fragmentId: `segment_${segment.segmentId}`, messageId: verified.messageIds[0],
        sourceMessageIds: verified.messageIds, text, speakerId: speaker,
        presentIds: ids(verified.messageIds.reduce((common, messageId) =>
          common === null ? presentIds(context, messageId) : common.filter((id) => presentIds(context, messageId).includes(id)), null)),
        knownBy: ids(verified.audience), visibility: segment.visibility,
        sourceType: ["spoken", "reported", "rumor"].includes(segment.source) ? segment.source : "spoken", recipientIds,
        entityIds, visibilityEvidence: "finalization_validated_segment" });
    }
    projection.sourceRevision = hash([projection.sourceRevision, projection.fragments]);
    const visibleEntities = new Set(projection.fragments.flatMap(fragment => ids(fragment.entityIds)));
    const relationshipChangeEntityIds = ids((context.relationshipChanges || []).filter(change =>
      change.detected === true && change.campaignToken === context.campaignToken && change.ownerId === ownerId
      && visibleEntities.has(change.entityId)).map(change => change.entityId));
    return { campaignToken: context.campaignToken, ownerId, conversationId: context.conversationId,
      finalizationId: context.finalizationId, episodeId: context.episodeId,
      date: context.date || null, totalDays: context.totalDays ?? null, counterpartIds: [], summaryIds: [],
      summaryProviderSnapshot: context.summaryProviderSnapshot || null,
      ...projection, relationshipChangeEntityIds };
  }

  orderFragments(snapshot, fragments) {
    const priority = new Set(ids(snapshot.relationshipChangeEntityIds));
    return [...fragments].sort((left, right) =>
      Number(right.entityIds?.some(id => priority.has(id))) - Number(left.entityIds?.some(id => priority.has(id))));
  }

  buildPrompt(snapshot, fragments, remainingEntrySlots = MAX_DURABLE_ENTRIES_PER_OWNER) {
    const ordered = this.orderFragments(snapshot, fragments);
    return [
      { role: "system", content: `VOTC Memory Engine 4.0 Durable extraction. Return JSON only: {\"status\":\"STORE|NO_DURABLE_CONTENT\",\"entries\":[{\"memoryType\":\"RELATIONSHIP_CHANGE|COMMITMENT|DURABLE_KNOWLEDGE|MAJOR_EXPERIENCE|LONG_TERM_GOAL|EMOTIONAL_ANCHOR\",\"text\":\"...\",\"fragmentIds\":[\"...\"],\"entityIds\":[],\"participantIds\":[],\"topics\":[],\"eventTime\":{\"from\":null,\"to\":null,\"precision\":\"unknown\",\"status\":\"unknown\"}}]}. Only durable facts; ordinary conversation may have zero entries. Use only supplied fragments and their exact IDs. Entity IDs must be copied from the supplied fragment evidence; do not invent or infer IDs. Do not infer who heard other parts of an old message. Self-only legacy text is the author's statement, not proof of other people's private thoughts or CK3 facts. A reported event stays reported. Relative dates in Legacy fragments use their sourceAsOf, never the current runtime date or a different projection date. Uncertain event dates remain unknown. Do not change Campaign or Owner. Never claim an entry without a supporting fragment. Return no more than ${remainingEntrySlots} entries for this owner in this request.` },
      { role: "user", content: JSON.stringify({ ownerId: snapshot.ownerId, campaignToken: snapshot.campaignToken,
        conversationDate: snapshot.date, completeness: snapshot.completeness,
        fragments: ordered.map(fragment => ({ fragmentId: fragment.fragmentId, text: fragment.text,
          visibilityEvidence: fragment.visibilityEvidence, speakerId: fragment.speakerId, sourceType: fragment.sourceType,
          entityIds: fragment.entityIds, presentIds: fragment.presentIds,
          ...(fragment.legacyMemoryId ? { sourceAsOf: fragment.legacyAnchorGameDate } : {}) })) }) }
    ];
  }

  parseResult(response, allowedFragments, snapshot = null, maxEntries = MAX_DURABLE_ENTRIES_PER_OWNER) {
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
    const allowed = new Set(allowedFragments.map(fragment => fragment.fragmentId));
    if (parsed.entries.some(entry => !Array.isArray(entry.fragmentIds) || !entry.fragmentIds.length
      || entry.fragmentIds.some(id => !allowed.has(id)))) throw new Error("memory4_response_source_mismatch");
    const entries = [];
    let rejectedUnknownEntityCount = 0;
    for (const candidate of parsed.entries) {
      try {
        if (snapshot) validateEntry(candidate, snapshot);
        entries.push(candidate);
      } catch (error) {
        if (error.message !== "memory4_unknown_entity") throw error;
        rejectedUnknownEntityCount++;
      }
    }
    return { ...parsed, status: entries.length ? "STORE" : "NO_DURABLE_CONTENT", entries, rejectedUnknownEntityCount };
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
        if (fs.existsSync(file)) fs.unlinkSync(file);
        return { ownerId: snapshot.ownerId, ...committed, alreadyCommitted: true };
      }
      this.saveRecovery(snapshot, { status: "PENDING", retryCount: prior?.retryCount || 0, lastError: null });
      this.store.recordKnownEvidence(snapshot);
      let result;
      if (!snapshot.presentMessageCount && !snapshot.fragments.length) result = { status: "NOT_PRESENT", entries: [] };
      else if (!snapshot.fragments.length) result = { status: "NO_DURABLE_CONTENT", entries: [] };
      else {
        if (typeof requestDurable !== "function") throw new Error("memory4_provider_unavailable");
        const entries = [];
        let rejectedUnknownEntityCount = 0;
        const orderedFragments = this.orderFragments(snapshot, snapshot.fragments);
        const extractChunk = async (chunk, remainingEntrySlots) => {
          if (!chunk.length || remainingEntrySlots <= 0) return { entries: [], rejectedUnknownEntityCount: 0 };
          try {
            const response = await requestDurable(this.buildPrompt(snapshot, chunk, remainingEntrySlots), { ownerId: snapshot.ownerId,
              campaignToken: snapshot.campaignToken, maxTokens: DURABLE_MAX_OUTPUT_TOKENS, providerSnapshot: snapshot.summaryProviderSnapshot });
            if (!isCurrent()) throw new Error("memory4_generation_changed");
            const parsed = this.parseResult(response, chunk, snapshot, remainingEntrySlots);
            return parsed;
          } catch (error) {
            if (!isCurrent()) throw new Error("memory4_generation_changed");
            if (error.message !== "memory4_generation_incomplete") throw error;
            if (chunk.length > 1) {
              const midpoint = Math.ceil(chunk.length / 2);
              const first = await extractChunk(chunk.slice(0, midpoint), remainingEntrySlots);
              const second = await extractChunk(chunk.slice(midpoint), remainingEntrySlots - first.entries.length);
              return { entries: [...first.entries, ...second.entries],
                rejectedUnknownEntityCount: first.rejectedUnknownEntityCount + second.rejectedUnknownEntityCount };
            }
            throw error;
          }
        };
        for (let offset = 0; offset < orderedFragments.length; offset += MAX_FRAGMENTS_PER_REQUEST) {
          const chunk = orderedFragments.slice(offset, offset + MAX_FRAGMENTS_PER_REQUEST);
          const parsed = await extractChunk(chunk, MAX_DURABLE_ENTRIES_PER_OWNER - entries.length);
          entries.push(...parsed.entries);
          rejectedUnknownEntityCount += parsed.rejectedUnknownEntityCount;
          this.saveRecovery(snapshot, { status: "PENDING", retryCount: prior?.retryCount || 0, lastError: null, completedFragmentCount: offset + chunk.length });
          if (entries.length >= MAX_DURABLE_ENTRIES_PER_OWNER) break;
        }
        if (rejectedUnknownEntityCount) this.trace?.record("memory4_candidate_rejected", {
          ownerId: snapshot.ownerId, count: rejectedUnknownEntityCount, reason: "unknown_entity"
        });
        result = { status: entries.length ? "STORE" : "NO_DURABLE_CONTENT", entries };
      }
      if (!isCurrent()) throw new Error("memory4_generation_changed");
      const persisted = this.store.commitOwner(snapshot, result);
      if (persisted.entryIds.length) this.derived.schedule(snapshot, { providerSnapshot: snapshot.summaryProviderSnapshot, committedFinalization: true });
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
          if (!isNarrativeCommitted(snapshot)) { results[index] = { status: "WAITING_NARRATIVE", ownerId: snapshot.ownerId }; continue; }
          if (!manual && Number(record.retryCount || 0) >= 3) { results[index] = { status: "FAILED_MANUAL", ownerId: snapshot.ownerId }; continue; }
          results[index] = await this.finishOwner(snapshot, requestDurable, record, isCurrent);
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
