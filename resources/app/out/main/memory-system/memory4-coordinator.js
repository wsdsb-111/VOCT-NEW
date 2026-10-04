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
const { validateGenerationOutcome } = require("../providers/generation-outcome");
const { validateSourceItem, presentIds } = require("./finalization-visibility");
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

  getCurrentDisclosures(scope, entityId, gameData, { readContext = null, currentGameDate = null } = {}) {
    return this.store.getCurrentDisclosures(scope, Number(entityId), gameData, { readContext, currentGameDate });
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
      const entityIds = ids(mentionTracker.findMentionedCharacterIds([{ content: text }], { candidates: entityProfiles, resolveCoreference: false }));
      projection.fragments.push({ fragmentId: `segment_${segment.segmentId}`, messageId: verified.messageIds[0],
        sourceMessageIds: verified.messageIds, text, speakerId: speaker, speakerIds: verified.speakers,
        sourceTextVerified,
        presentIds: ids(verified.messageIds.reduce((common, messageId) =>
          common === null ? presentIds(context, messageId) : common.filter((id) => presentIds(context, messageId).includes(id)), null)),
        knownBy: ids(verified.audience), visibility: segment.visibility,
        sourceType: segment.source, recipientIds,
        entityIds, visibilityEvidence: "finalization_validated_segment" });
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
    projection.sourceRevision = hash([projection.sourceRevision, projection.fragments, disclosureCharacters]);
    const visibleEntities = new Set(projection.fragments.flatMap(fragment => ids(fragment.entityIds)));
    const relationshipChangeEntityIds = ids((context.relationshipChanges || []).filter(change =>
      change.detected === true && change.campaignToken === context.campaignToken && change.ownerId === ownerId
      && visibleEntities.has(change.entityId)).map(change => change.entityId));
    return { campaignToken: context.campaignToken, ownerId, conversationId: context.conversationId,
      finalizationId: context.finalizationId, episodeId: context.episodeId,
      date: context.date || null, totalDays: context.totalDays ?? null, counterpartIds: directCounterpartIds(projection.fragments, ownerId), summaryIds: [],
      summaryProviderSnapshot: context.summaryProviderSnapshot || null,
      ...projection, disclosureCharacters, relationshipChangeEntityIds };
  }

  orderFragments(snapshot, fragments) {
    const priority = new Set(ids(snapshot.relationshipChangeEntityIds));
    return [...fragments].sort((left, right) =>
      Number(right.entityIds?.some(id => priority.has(id))) - Number(left.entityIds?.some(id => priority.has(id))));
  }

  buildPrompt(snapshot, fragments, remainingEntrySlots = MAX_DURABLE_ENTRIES_PER_OWNER, remainingTransitionSlots = MAX_DURABLE_ENTRIES_PER_OWNER) {
    const ordered = this.orderFragments(snapshot, fragments);
    return [
      { role: "system", content: `VOTC Memory Engine 4.0 Durable extraction. Return JSON only: {\"status\":\"STORE|NO_DURABLE_CONTENT\",\"entries\":[{\"memoryType\":\"RELATIONSHIP_CHANGE|COMMITMENT|DURABLE_KNOWLEDGE|MAJOR_EXPERIENCE|LONG_TERM_GOAL|EMOTIONAL_ANCHOR\",\"text\":\"...\",\"fragmentIds\":[\"...\"],\"entityIds\":[],\"participantIds\":[],\"topics\":[],\"eventTime\":{\"from\":null,\"to\":null,\"precision\":\"unknown\",\"status\":\"unknown\"}}],\"commitmentTransitions\":[{\"entryId\":\"...\",\"expectedRevision\":1,\"status\":\"fulfilled|cancelled|superseded\",\"fragmentIds\":[\"...\"],\"commitmentQuote\":\"...\",\"evidenceQuote\":\"...\",\"replacementEntryIndex\":null}]}. Only durable facts; ordinary conversation may have zero entries. Use only supplied fragments and their exact IDs. Entity IDs must be copied from the supplied fragment evidence; do not invent or infer IDs. Do not infer who heard other parts of an old message. Self-only legacy text is the author's statement, not proof of other people's private thoughts or CK3 facts. A reported event stays reported. Relative dates in Legacy fragments use their sourceAsOf, never the current runtime date or a different projection date. Uncertain event dates remain unknown. Do not change Campaign or Owner. Never claim an entry without a supporting fragment. Return no more than ${remainingEntrySlots} entries and ${remainingTransitionSlots} commitment transitions for this owner in this request. A transition must copy an activeCommitment entryId and expectedRevision, cite a complete verbatim evidenceQuote from a verified source fragment, and bind it by an exact, concrete commitmentQuote appearing in both the original commitment and the evidence. The binding must identify exactly one supplied active commitment; generic words are invalid. Only explicit fulfilled/cancelled/replacement statements qualify. Questions, future plans, hypothetical, negation, hearsay, ambiguous references and years of silence never change status. Fulfillment needs explicit completion of every original condition; cancellation/replacement must explicitly cover the original agreement including all its conditions. For superseded, replacementEntryIndex must point to a new COMMITMENT in this response, whose text is copied verbatim from the same replacement evidence. Use NO_DURABLE_CONTENT with entries:[] when only transitions are needed. No transition is CK3 effect confirmation.` },
      { role: "user", content: JSON.stringify({ ownerId: snapshot.ownerId, campaignToken: snapshot.campaignToken,
        conversationDate: snapshot.date, completeness: snapshot.completeness,
        activeCommitments: (snapshot.activeCommitments || []).map(entry => ({ entryId: entry.entryId,
          expectedRevision: entry.revision, text: entry.text })),
        fragments: ordered.map(fragment => ({ fragmentId: fragment.fragmentId, text: fragment.text,
          visibilityEvidence: fragment.visibilityEvidence, speakerId: fragment.speakerId, sourceType: fragment.sourceType,
          entityIds: fragment.entityIds, presentIds: fragment.presentIds,
          ...(fragment.legacyMemoryId ? { sourceAsOf: fragment.legacyAnchorGameDate } : {}) })) }) }
    ];
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
        this.recordDisclosures(snapshot, { campaignToken: snapshot.campaignToken, date: snapshot.date,
          characters: new Map((snapshot.disclosureCharacters || []).map(character => [character.id, character])) });
        if (fs.existsSync(file)) fs.unlinkSync(file);
        return { ownerId: snapshot.ownerId, ...committed, alreadyCommitted: true };
      }
      snapshot.activeCommitments ||= this.store.activeCommitments(snapshot);
      this.saveRecovery(snapshot, { status: "PENDING", retryCount: prior?.retryCount || 0, lastError: null });
      this.store.recordKnownEvidence(snapshot);
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
        result = { status: entries.length ? "STORE" : "NO_DURABLE_CONTENT", entries, commitmentTransitions };
      }
      if (!isCurrent()) throw new Error("memory4_generation_changed");
      const persisted = this.store.commitOwner(snapshot, result);
      this.recordDisclosures(snapshot, { campaignToken: snapshot.campaignToken, date: snapshot.date,
        characters: new Map((snapshot.disclosureCharacters || []).map(character => [character.id, character])) });
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
