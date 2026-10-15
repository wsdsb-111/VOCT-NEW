"use strict";

const fs = require("fs");
const path = require("path");
const { buildEntityContext } = require("./entity-context");
const { createProjectionLineage, gameDate, hash, ids } = require("./legacy-source-lineage");
const { assertNoLinks } = require("./scoped-path");
const { normalizeGameDate } = require("../worldline/character-temporal-facts");
const { validateGenerationOutcome } = require("../providers/generation-outcome");

const SCHEMA_VERSION = 1;
const MAX_AUTOMATIC_FAILURES = 3;
const MAX_LETTER_LENGTH = 65536;

function freezeDeep(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freezeDeep(child);
  return Object.freeze(value);
}

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function profileRows(value, allowedIds = null) {
  if (!Array.isArray(value)) return [];
  const result = [];
  for (const row of value) {
    const id = Number(row?.id ?? row?.characterId);
    if (!Number.isSafeInteger(id) || id <= 0 || allowedIds && !allowedIds.includes(id)) continue;
    const profile = { id };
    for (const key of ["name", "shortName", "firstName", "fullName", "primaryTitle", "heldCourtAndCouncilPositions", "titleRankConcept"]) {
      if (typeof row[key] === "string" && row[key].trim()) profile[key] = row[key].trim();
    }
    if (!result.some(item => item.id === id)) result.push(profile);
  }
  return result;
}

function relationshipRows(value) {
  if (!Array.isArray(value)) return [];
  return value.filter(row => row && typeof row === "object").map(row => ({
    campaignToken: row.campaignToken,
    ownerId: Number(row.ownerId),
    entityId: Number(row.entityId),
    status: row.status,
    types: Array.isArray(row.types) ? row.types.filter(type => typeof type === "string") : [],
    source: row.source,
    knownToOwner: row.knownToOwner === true,
    asOf: gameDate(row.asOf)
  }));
}

function normalizeContext(input) {
  const campaignToken = typeof input?.campaignToken === "string" ? input.campaignToken : "";
  const letterId = typeof input?.letterId === "string" ? input.letterId : "";
  const senderId = input?.senderId, recipientId = input?.recipientId;
  const sourceDate = gameDate(input?.sourceDate), acceptedDate = gameDate(input?.acceptedDate);
  const sourceDay = normalizeGameDate(sourceDate), acceptedDay = normalizeGameDate(acceptedDate);
  const sourceTotalDays = input?.sourceTotalDays, acceptedTotalDays = input?.acceptedTotalDays;
  const letterText = typeof input?.text === "string" ? input.text : "";
  const reply = typeof input?.reply === "string" ? input.reply : "";
  const pair = ids([senderId, recipientId]);
  if (!campaignToken.trim() || campaignToken !== campaignToken.trim() || !letterId || letterId !== letterId.trim()
    || !/^[\p{L}\p{N}_.:-]{1,192}$/u.test(letterId)
    || pair.length !== 2 || pair[0] === pair[1]
    || !sourceDay || !acceptedDay || sourceDay.serial > acceptedDay.serial
    || !Number.isSafeInteger(sourceTotalDays) || sourceTotalDays < 0
    || !Number.isSafeInteger(acceptedTotalDays) || acceptedTotalDays < sourceTotalDays
    || !letterText.trim() || !reply.trim() || letterText.length > MAX_LETTER_LENGTH || reply.length > MAX_LETTER_LENGTH) {
    throw new Error("letter_memory_context_invalid");
  }
  const participants = profileRows(input.participantProfiles, pair);
  if (participants.length !== 2 || pair.some(id => !participants.some(profile => profile.id === id))) {
    throw new Error("letter_memory_context_invalid");
  }
  const mentionedEntities = profileRows(input.mentionedEntities).filter(profile => !pair.includes(profile.id));
  return freezeDeep({ campaignToken, letterId, senderId, recipientId, sourceDate, acceptedDate,
    sourceTotalDays, acceptedTotalDays, text: letterText, reply,
    participantProfiles: participants, mentionedEntities,
    relationshipEvidence: relationshipRows(input.relationshipEvidence) });
}

function successfulPersistence(result) {
  return result === true || result?.success === true;
}

function responseContent(response) {
  const outcome = validateGenerationOutcome(typeof response === "string" ? { content: response } : response);
  return outcome.complete && !outcome.truncated ? outcome.content.trim() : "";
}

class LetterSummaryFinalization {
  constructor({ memoryEngine, requestSummary, persistSummary,
    getSummarySettings = null, getProviderSnapshot = null, isCampaignCurrent = null } = {}) {
    if (!memoryEngine?.store?.paths?.recovery) throw new Error("letter_summary_store_required");
    this.memoryEngine = memoryEngine;
    this.requestSummary = requestSummary;
    this.persistSummary = persistSummary;
    this.getSummarySettings = getSummarySettings;
    this.getProviderSnapshot = getProviderSnapshot;
    this.isCampaignCurrent = isCampaignCurrent;
    this.inFlight = new Map();
    this.recoveryDir = path.join(path.resolve(memoryEngine.store.paths.recovery), "letter-summary");
    assertNoLinks(this.recoveryDir);
    fs.mkdirSync(this.recoveryDir, { recursive: true });
  }

  recoveryPath(jobId) {
    if (typeof jobId !== "string" || !/^[a-f0-9]{64}$/.test(jobId)) throw new Error("letter_memory_job_id_invalid");
    return path.join(this.recoveryDir, `letter_${jobId}.json`);
  }

  readJob(jobId) {
    const file = this.recoveryPath(jobId);
    if (!fs.existsSync(file)) throw new Error("letter_memory_job_missing");
    if (fs.lstatSync(file).isSymbolicLink()) throw new Error("letter_memory_job_symlink");
    let job;
    try { job = JSON.parse(fs.readFileSync(file, "utf8")); }
    catch { throw new Error("letter_memory_job_corrupt"); }
    let context;
    try { context = normalizeContext(job?.context); } catch { throw new Error("letter_memory_job_corrupt"); }
    if (job?.schemaVersion !== SCHEMA_VERSION || job.kind !== "LETTER_SUMMARY_FINALIZATION"
      || job.jobId !== jobId || this.jobId(context) !== jobId
      || hash(context) !== hash(job.context) || job.payloadHash !== hash([context.text, context.reply])
      || !job.narrative || !Number.isSafeInteger(job.attemptCount) || !Number.isSafeInteger(job.retryCount)) {
      throw new Error("letter_memory_job_corrupt");
    }
    job.context = context;
    return job;
  }

  writeJob(job) {
    job.updatedAt = new Date().toISOString();
    this.memoryEngine.store.writeJson(this.recoveryPath(job.jobId), job);
  }

  jobId(context) {
    return hash([context.campaignToken, context.letterId, hash([context.text, context.reply])]);
  }

  captureAccepted(input) {
    const context = normalizeContext(input);
    const jobId = this.jobId(context);
    const file = this.recoveryPath(jobId);
    if (fs.existsSync(file)) {
      const prior = this.readJob(jobId);
      if (hash(prior.context) !== hash(context)) throw new Error("letter_memory_identity_conflict");
      return Object.freeze({ jobId, recoveryPath: file, campaignToken: context.campaignToken, payloadHash: prior.payloadHash });
    }
    const job = {
      schemaVersion: SCHEMA_VERSION, kind: "LETTER_SUMMARY_FINALIZATION", jobId,
      payloadHash: hash([context.text, context.reply]), context,
      conversationId: `letter_${jobId}`, finalizationId: `letter_${jobId}`,
      episodeId: `letter_episode_${jobId}`, commitMarker: `commit_letter_${jobId}`,
      attemptCount: 0, retryCount: 0, lastErrorCode: null,
      narrative: { status: "PENDING", summaryStatus: "PENDING", summary: null,
        projectionStatus: "PENDING", legacyStatus: "PENDING", markerStatus: "PENDING", memoryId: null },
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
    };
    this.writeJob(job);
    return Object.freeze({ jobId, recoveryPath: file, campaignToken: context.campaignToken, payloadHash: job.payloadHash });
  }

  letterFragments(job) {
    const context = job.context;
    return [
      { fragmentId: `letter_${hash([job.jobId, "source"])}`, sourceLetterId: context.letterId,
        text: context.text, eventDate: context.sourceDate, acquiredDate: context.acceptedDate,
        speakerId: context.senderId, recipientIds: [context.recipientId], sourceRole: "user" },
      { fragmentId: `letter_${hash([job.jobId, "reply"])}`, sourceLetterId: context.letterId,
        text: context.reply, eventDate: context.acceptedDate, acquiredDate: context.acceptedDate,
        speakerId: context.recipientId, recipientIds: [context.senderId], sourceRole: "user" }
    ].map(fragment => ({ ...fragment, messageId: null, sourceMessageIds: [], speakerIds: [fragment.speakerId],
      presentIds: [], knownBy: [context.senderId, context.recipientId], visibility: "private",
      sourceType: "spoken", sourceTextVerified: true, visibilityEvidence: "validated_letter", entityIds: [] }));
  }

  scopedNameEvidence(job, fragments = this.letterFragments(job)) {
    const context = job.context;
    const result = [];
    for (const ownerId of [context.senderId, context.recipientId]) for (const fragment of fragments) {
      const scoped = buildEntityContext({ ownerId, campaignToken: context.campaignToken,
        date: fragment.eventDate, fragments: [fragment], participantProfiles: context.participantProfiles,
        mentionedEntities: context.mentionedEntities, relationshipEvidence: context.relationshipEvidence });
      const entities = scoped.entityNameEvidence.map(row => ({ entityId: row.entityId, name: row.name,
        evidence: row.evidence.map(item => ({ source: item.source,
          ...(item.matchedAlias ? { matchedAlias: item.matchedAlias } : {}),
          ...(item.sourceLetterId ? { sourceLetterId: item.sourceLetterId } : {}) })) }));
      if (entities.length) result.push({ ownerId, fragmentId: fragment.fragmentId, entities });
    }
    return result;
  }

  summaryPrompt(job) {
    let settings = {};
    try { settings = this.getSummarySettings?.() || {}; } catch { throw new Error("LETTER_SUMMARY_SETTINGS_FAILED"); }
    const stableInstructions = [text(settings.letterSummaryPrompt),
      "Summarize only the accepted letter exchange. Preserve its meaning, distinguish claims from facts, and add no events or motives absent from the letters. Write in third person, never address the memory owner as 'you', and never call anyone 主人 or master. Use names only from nameEvidence scoped to a cited letter fragment; never use unlisted profile names or infer identity from IDs. If no authorized name is available, use unambiguous role wording or remain neutral."]
      .filter(Boolean).join("\n\n");
    return [
      { role: "system", content: `Stable letter-summary instructions:\n${stableInstructions}` },
      { role: "user", content: JSON.stringify({ senderId: job.context.senderId, recipientId: job.context.recipientId,
        sourceDate: job.context.sourceDate, acceptedDate: job.context.acceptedDate,
        letter: job.context.text, reply: job.context.reply, nameEvidence: this.scopedNameEvidence(job) }) },
      { role: "user", content: "Generate the concise letter summary now." }
    ];
  }

  getForgottenOwnerIds(job) {
    const store = this.memoryEngine.store;
    if (typeof store?.isSummaryProjectionForgotten !== "function") throw new Error("LETTER_SUMMARY_FORGET_STORE_UNAVAILABLE");
    return [job.context.senderId, job.context.recipientId].filter(ownerId => {
      const counterpartId = ownerId === job.context.senderId ? job.context.recipientId : job.context.senderId;
      const lineage = createProjectionLineage({ campaignToken: job.context.campaignToken, ownerId, counterpartId,
        sourceLetterId: job.context.letterId, conversationId: job.conversationId, finalizationId: job.finalizationId });
      const legacyMemoryIds = job.narrative.memoryId ? [job.narrative.memoryId] : [];
      const summaryRecord = { campaignToken: job.context.campaignToken, perspectiveOwnerId: ownerId, characterId: counterpartId,
        conversationId: job.conversationId, finalizationId: job.finalizationId, sourceLetterId: job.context.letterId,
        perspectiveMemoryIds: legacyMemoryIds, perspectiveSummarySegmentIds: [], projectionId: lineage.projectionId };
      return store.isSummaryProjectionForgotten(summaryRecord, { ownerId, counterpartId, legacyMemoryIds });
    });
  }

  summaryContext(job) {
    return {
      conversationId: job.conversationId, finalizationId: job.finalizationId, episodeId: job.episodeId,
      commitMarker: job.commitMarker, campaignToken: job.context.campaignToken,
      sourceLetterId: job.context.letterId,
      currentCampaignNative: true, date: job.context.acceptedDate, totalDays: job.context.acceptedTotalDays,
      participants: job.context.participantProfiles, participantIds: [job.context.senderId, job.context.recipientId],
      participantProfiles: job.context.participantProfiles, excludedSummaryOwnerIds: this.getForgottenOwnerIds(job),
      joinEvents: [], leaveEvents: [], presenceJoins: [], presenceLeaves: []
    };
  }

  resolvePendingSummaryProjection(summary, ownerId, counterpartId) {
    const match = /^letter_([a-f0-9]{64})$/.exec(summary.finalizationId || "");
    if (!match || !fs.existsSync(this.recoveryPath(match[1]))) return null;
    const job = this.readJob(match[1]);
    if (job.context.campaignToken !== summary.campaignToken || job.conversationId !== summary.conversationId
      || job.finalizationId !== summary.finalizationId || job.narrative.summaryStatus !== "COMPLETE"
      || job.narrative.summary !== summary.content || job.context.acceptedDate !== summary.date
      || ![job.context.senderId, job.context.recipientId].includes(ownerId)
      || ![job.context.senderId, job.context.recipientId].includes(counterpartId)
      || ownerId === counterpartId) throw new Error("LEGACY_SUMMARY_MEMORY_MAPPING_INCOMPLETE");
    this.assertNoLegacyIdentityConflict(job);
    const memories = this.letterMemories(job);
    if (memories.some(memory => memory.content !== summary.content || gameDate(memory.eventDate) !== summary.date)) {
      throw new Error("LEGACY_SUMMARY_MEMORY_MAPPING_INCOMPLETE");
    }
    return { sourceLetterId: job.context.letterId,
      memoryIds: memories.filter(memory => memory.knownBy.includes(ownerId)).map(memory => memory.memoryId) };
  }

  async ensureNarrative(job, providerSnapshot) {
    const narrative = job.narrative;
    if (narrative.summaryStatus !== "COMPLETE") {
      if (typeof this.requestSummary !== "function") throw new Error("LETTER_SUMMARY_PROVIDER_UNAVAILABLE");
      narrative.summaryAttempts = (narrative.summaryAttempts || 0) + 1;
      this.writeJob(job);
      let response;
      try {
        response = await this.requestSummary(this.summaryPrompt(job), { attempt: narrative.summaryAttempts,
          maxTokens: 512, requestType: "letter_summary", providerSnapshot });
      } catch { throw new Error("LETTER_SUMMARY_REQUEST_FAILED"); }
      const summary = responseContent(response);
      if (!summary || summary.length > 16384) throw new Error("LETTER_SUMMARY_INVALID");
      narrative.summary = summary;
      narrative.summaryStatus = "COMPLETE";
      this.writeJob(job);
    }

    if (narrative.projectionStatus !== "COMPLETE") {
      this.assertNoLegacyIdentityConflict(job);
      if (typeof this.persistSummary !== "function") throw new Error("LETTER_SUMMARY_PERSIST_UNAVAILABLE");
      let persisted;
      try { persisted = await this.persistSummary(narrative.summary, this.summaryContext(job)); }
      catch { throw new Error("LETTER_SUMMARY_PERSIST_FAILED"); }
      if (!successfulPersistence(persisted)) throw new Error("LETTER_SUMMARY_PERSIST_FAILED");
      narrative.projectionStatus = "COMPLETE";
      this.writeJob(job);
    }

    if (narrative.legacyStatus !== "COMPLETE") {
      const campaignBinding = { status: "bound", source: `accepted_letter:${job.payloadHash}`, version: 1 };
      const existing = this.letterMemories(job);
      const memory = existing.find(item => item.provenance?.campaignBinding?.source === campaignBinding.source);
      if (existing.length && !memory) throw new Error("LETTER_MEMORY_LEGACY_IDENTITY_CONFLICT");
      let saved = memory;
      if (saved && (saved.content !== narrative.summary || gameDate(saved.eventDate) !== job.context.acceptedDate)) {
        throw new Error("LETTER_MEMORY_LEGACY_IDENTITY_CONFLICT");
      }
      if (!saved) {
        if (typeof this.memoryEngine.recordLetterMemory !== "function") throw new Error("LETTER_MEMORY_LEGACY_STORE_UNAVAILABLE");
        try {
          saved = this.memoryEngine.recordLetterMemory({ senderId: job.context.senderId,
            recipientId: job.context.recipientId, content: narrative.summary, date: job.context.acceptedDate,
            totalDays: job.context.acceptedTotalDays, letterId: job.context.letterId,
            campaignToken: job.context.campaignToken, campaignBinding });
        } catch { throw new Error("LETTER_MEMORY_LEGACY_SAVE_FAILED"); }
      }
      if (!saved?.memoryId) throw new Error("LETTER_MEMORY_LEGACY_SAVE_FAILED");
      const forgottenOwners = this.getForgottenOwnerIds(job);
      if (forgottenOwners.length) {
        const store = this.memoryEngine.store;
        for (const ownerId of forgottenOwners) store.revokeCharacterKnowledge(ownerId, saved.memoryId);
        const knownBy = saved.knownBy.filter(ownerId => !forgottenOwners.includes(ownerId));
        if (knownBy.length) store.updateMemory(saved.memoryId, { knownBy });
        else store.deleteMemory(saved.memoryId);
      }
      narrative.memoryId = saved.memoryId;
      narrative.legacyStatus = "COMPLETE";
      this.writeJob(job);
    }

    if (narrative.markerStatus !== "COMPLETE") {
      const store = this.memoryEngine.store;
      const existing = store.findEpisodeByFinalization?.(job.conversationId, job.finalizationId, job.context.campaignToken)
        || store.listAllEpisodes?.().find(item => item.conversationId === job.conversationId
          && item.finalizationId === job.finalizationId && item.campaignToken === job.context.campaignToken) || null;
      if (existing && existing.letterPayloadHash !== job.payloadHash) throw new Error("LETTER_MEMORY_MARKER_IDENTITY_CONFLICT");
      if (store.listAllEpisodes?.().some(item => item.letterId === job.context.letterId
        && item.campaignToken === job.context.campaignToken && item.letterPayloadHash !== job.payloadHash)) {
        throw new Error("LETTER_MEMORY_MARKER_IDENTITY_CONFLICT");
      }
      if (!existing) {
        const participants = [job.context.senderId, job.context.recipientId];
        const forgottenOwners = this.getForgottenOwnerIds(job);
        const knownBy = participants.filter(ownerId => !forgottenOwners.includes(ownerId));
        const episode = { schemaVersion: 2, episodeId: job.episodeId, conversationId: job.conversationId,
          finalizationId: job.finalizationId, campaignToken: job.context.campaignToken,
          commitMarker: job.commitMarker, date: job.context.acceptedDate, totalDays: job.context.acceptedTotalDays,
          participants: job.context.participantProfiles, memoryIds: store.getMemory(narrative.memoryId) ? [narrative.memoryId] : [],
          sessionSummary: narrative.summary, summarySegments: [{ segmentId: `letter_${job.jobId}`,
            content: narrative.summary, participants, knownBy, visibility: "known_group",
            provenance: { sourceLetterId: job.context.letterId } }], letterId: job.context.letterId,
          letterPayloadHash: job.payloadHash,
          createdAt: new Date().toISOString() };
        try { store.saveEpisode(episode); } catch { throw new Error("LETTER_MEMORY_MARKER_SAVE_FAILED"); }
      }
      narrative.markerStatus = "COMPLETE";
      narrative.status = "COMPLETE";
      this.writeJob(job);
    }
  }

  letterMemories(job) {
    return this.memoryEngine.store.listAllMemories?.().filter(memory =>
      memory.provenance?.conversationId === job.context.letterId
      && memory.provenance?.campaignToken === job.context.campaignToken
      && memory.provenance?.extractionMode === "letter_summary") || [];
  }

  assertNoLegacyIdentityConflict(job) {
    const expectedSource = `accepted_letter:${job.payloadHash}`;
    if (this.letterMemories(job).some(memory => memory.provenance?.campaignBinding?.source !== expectedSource)) {
      throw new Error("LETTER_MEMORY_LEGACY_IDENTITY_CONFLICT");
    }
    if (this.memoryEngine.store.listAllEpisodes?.().some(episode => episode.letterId === job.context.letterId
      && episode.campaignToken === job.context.campaignToken && episode.letterPayloadHash !== job.payloadHash)) {
      throw new Error("LETTER_MEMORY_MARKER_IDENTITY_CONFLICT");
    }
  }

  isCurrent(job) {
    try { return typeof this.isCampaignCurrent !== "function" || this.isCampaignCurrent(job.context.campaignToken) === true; }
    catch { return false; }
  }

  finalize(reference, { manual = false } = {}) {
    const jobId = typeof reference === "string" ? reference : reference?.jobId;
    if (typeof jobId !== "string") return Promise.reject(new Error("letter_memory_job_id_invalid"));
    const pending = this.inFlight.get(jobId);
    if (pending) return pending;
    let tracked;
    tracked = Promise.resolve().then(() => this.finalizeOnce(jobId, { manual })).finally(() => {
      if (this.inFlight.get(jobId) === tracked) this.inFlight.delete(jobId);
    });
    this.inFlight.set(jobId, tracked);
    return tracked;
  }

  async finalizeOnce(reference, { manual = false } = {}) {
    const job = this.readJob(typeof reference === "string" ? reference : reference?.jobId);
    if (job.narrative.status === "COMPLETE") return this.result(job);
    if (!this.isCurrent(job)) return { ...this.result(job), status: "CAMPAIGN_CHANGED" };
    if (!manual && job.retryCount >= MAX_AUTOMATIC_FAILURES) return { ...this.result(job), status: "FAILED_MANUAL" };
    job.attemptCount++;
    job.lastErrorCode = null;
    this.writeJob(job);
    try {
      let providerSnapshot = null;
      try { providerSnapshot = await this.getProviderSnapshot?.() || null; }
      catch { throw new Error("LETTER_PROVIDER_SNAPSHOT_FAILED"); }
      await this.ensureNarrative(job, providerSnapshot);
      if (!this.isCurrent(job)) return { ...this.result(job), status: "CAMPAIGN_CHANGED" };
    } catch (error) {
      job.lastErrorCode = error instanceof Error ? error.message : "LETTER_SUMMARY_FINALIZATION_FAILED";
    }
    const status = this.status(job);
    if (status !== "COMPLETE") job.retryCount++;
    else job.retryCount = 0;
    this.writeJob(job);
    return this.result(job);
  }

  status(job) {
    return job.narrative.status === "COMPLETE" ? "COMPLETE" : "FAILED_NARRATIVE";
  }

  result(job) {
    return { jobId: job.jobId, campaignToken: job.context.campaignToken, status: this.status(job),
      narrativeStatus: job.narrative.status,
      retryCount: job.retryCount, errorCode: job.lastErrorCode || null };
  }

  async retryPending({ activeCampaignToken, manual = false } = {}) {
    if (typeof activeCampaignToken !== "string" || !activeCampaignToken.trim() || !fs.existsSync(this.recoveryDir)) return [];
    const files = fs.readdirSync(this.recoveryDir).filter(name => /^letter_[a-f0-9]{64}\.json$/.test(name)).sort();
    const results = [];
    for (const file of files) {
      const jobId = file.slice("letter_".length, -".json".length);
      let job;
      try { job = this.readJob(jobId); } catch { results.push({ jobId, status: "INVALID" }); continue; }
      if (job.context.campaignToken !== activeCampaignToken) continue;
      if (this.status(job) === "COMPLETE") continue;
      if (!manual && job.retryCount >= MAX_AUTOMATIC_FAILURES) {
        results.push({ ...this.result(job), status: "FAILED_MANUAL" });
        continue;
      }
      results.push(await this.finalize(jobId, { manual }));
    }
    return results;
  }

  getRecoveryStatus(campaignToken) {
    const result = { pending: 0, manual: 0, invalid: 0 };
    if (typeof campaignToken !== "string" || !campaignToken.trim() || !fs.existsSync(this.recoveryDir)) return result;
    for (const file of fs.readdirSync(this.recoveryDir).filter(name => /^letter_[a-f0-9]{64}\.json$/.test(name))) {
      const jobId = file.slice("letter_".length, -".json".length);
      let job;
      try { job = this.readJob(jobId); } catch { result.invalid++; continue; }
      if (job.context.campaignToken !== campaignToken || this.status(job) === "COMPLETE") continue;
      result.pending++;
      if (job.retryCount >= MAX_AUTOMATIC_FAILURES) result.manual++;
    }
    return result;
  }
}

module.exports = { LetterSummaryFinalization };
