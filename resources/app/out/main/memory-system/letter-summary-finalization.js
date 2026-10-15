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
    const sourceRevision = this.sourceRevision(context, job.payloadHash);
    if (job.sourceRevision == null) {
      job.sourceRevision = sourceRevision;
      job.legacySourceRevision = true;
    } else if (job.sourceRevision !== sourceRevision) {
      throw new Error("letter_memory_job_corrupt");
    }
    return job;
  }

  writeJob(job) {
    job.updatedAt = new Date().toISOString();
    this.memoryEngine.store.writeJson(this.recoveryPath(job.jobId), job);
  }

  jobId(context) {
    return hash([context.campaignToken, context.letterId, hash([context.text, context.reply])]);
  }

  sourceRevision(context, payloadHash = hash([context.text, context.reply])) {
    return hash([context.campaignToken, context.letterId, context.senderId, context.recipientId,
      context.sourceDate, context.acceptedDate, context.sourceTotalDays, context.acceptedTotalDays, payloadHash]);
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
      sourceRevision: this.sourceRevision(context, hash([context.text, context.reply])),
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
      sourceLetterId: job.context.letterId, sourceRevision: job.sourceRevision,
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

  projectionTargetFileId(ownerId, counterpartId) {
    return `legacy_${hash(["letter_summary_target", ownerId, counterpartId]).slice(0, 24)}`;
  }

  hasVerifiedLegacyMarker(job) {
    if (job.narrative.markerStatus !== "COMPLETE") return false;
    const store = this.memoryEngine.store;
    const marker = store.findEpisodeByFinalization?.(job.conversationId, job.finalizationId, job.context.campaignToken)
      || store.listAllEpisodes?.().find(item => item.conversationId === job.conversationId
        && item.finalizationId === job.finalizationId && item.campaignToken === job.context.campaignToken) || null;
    const participantIds = (Array.isArray(marker?.participants) ? marker.participants : [])
      .map(profile => Number(profile?.id ?? profile?.characterId)).filter(Number.isSafeInteger);
    return marker?.commitMarker === job.commitMarker
      && marker.letterId === job.context.letterId
      && marker.letterPayloadHash === job.payloadHash
      && marker.sessionSummary === job.narrative.summary
      && gameDate(marker.date) === job.context.acceptedDate
      && Number(marker.totalDays) === job.context.acceptedTotalDays
      && participantIds.includes(job.context.senderId) && participantIds.includes(job.context.recipientId);
  }

  verifyLegacyProjection(job, ownerId, counterpartId, forgottenOwners) {
    const expectedLineage = createProjectionLineage({ campaignToken: job.context.campaignToken,
      ownerId, counterpartId, sourceLetterId: job.context.letterId,
      conversationId: job.conversationId, finalizationId: job.finalizationId });
    const proof = { ownerId, counterpartId, targetFileId: this.projectionTargetFileId(ownerId, counterpartId),
      projectionId: expectedLineage.projectionId, sourceRevision: job.sourceRevision, status: "MISSING", errorCode: null };
    if (forgottenOwners.includes(ownerId)) {
      proof.status = "FORGOTTEN";
      proof.errorCode = "LETTER_SUMMARY_OWNER_FORGOTTEN";
      return proof;
    }
    try {
      const store = this.memoryEngine.store;
      if (typeof store.getSummaryConversationFile !== "function" || !store.summaryFoldersDir) {
        throw new Error("LETTER_SUMMARY_PROJECTION_STORE_UNAVAILABLE");
      }
      const counterpartProfile = job.context.participantProfiles.find(profile => profile.id === counterpartId);
      const fallbackName = counterpartProfile?.shortName || counterpartProfile?.firstName
        || counterpartProfile?.name || counterpartProfile?.fullName || `角色 ${counterpartId}`;
      const filePath = store.getSummaryConversationFile(ownerId, counterpartId, fallbackName);
      if (!filePath) return proof;
      const root = path.resolve(store.summaryFoldersDir);
      const resolvedPath = path.resolve(filePath);
      const relativePath = path.relative(root, resolvedPath);
      if (!relativePath || relativePath === ".." || relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath)) {
        throw new Error("LETTER_SUMMARY_PROJECTION_PATH_INVALID");
      }
      assertNoLinks(root);
      assertNoLinks(resolvedPath);
      if (!fs.existsSync(resolvedPath)) return proof;
      const stat = fs.lstatSync(resolvedPath);
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("LETTER_SUMMARY_PROJECTION_FILE_INVALID");
      let rows;
      try { rows = JSON.parse(fs.readFileSync(resolvedPath, "utf8").replace(/^\uFEFF/, "")); }
      catch { throw new Error("LETTER_SUMMARY_PROJECTION_JSON_INVALID"); }
      if (!Array.isArray(rows)) throw new Error("LETTER_SUMMARY_PROJECTION_JSON_INVALID");
      const matchingRows = rows.filter(row => row?.finalizationId === job.finalizationId);
      if (!matchingRows.length) return proof;
      if (matchingRows.length !== 1) throw new Error("LETTER_SUMMARY_PROJECTION_DUPLICATE");
      const row = matchingRows[0];
      const participantIds = (Array.isArray(row.participants) ? row.participants : [])
        .map(profile => Number(profile?.id ?? profile?.characterId)).filter(Number.isSafeInteger);
      if (row.campaignToken !== job.context.campaignToken
        || row.conversationId !== job.conversationId
        || row.finalizationId !== job.finalizationId
        || Number(row.playerId) !== ownerId || Number(row.characterId) !== counterpartId
        || Number(row.perspectiveOwnerId) !== ownerId
        || row.sourceLetterId !== job.context.letterId
        || row.projectionId !== expectedLineage.projectionId
        || row.content !== job.narrative.summary
        || gameDate(row.date) !== job.context.acceptedDate
        || Number(row.totalDays) !== job.context.acceptedTotalDays
        || row.campaignBinding?.status !== "bound"
        || !participantIds.includes(ownerId) || !participantIds.includes(counterpartId)) {
        throw new Error("LETTER_SUMMARY_PROJECTION_IDENTITY_MISMATCH");
      }
      if (row.sourceRevision === job.sourceRevision) {
        proof.sourceRevisionStatus = "VERIFIED";
      } else if (row.sourceRevision == null && job.legacySourceRevision === true) {
        // Accept V9.3.4 rows only when their exact source-bound finalization marker survives.
        if (!this.hasVerifiedLegacyMarker(job)) throw new Error("LETTER_SUMMARY_LEGACY_MARKER_UNVERIFIED");
        proof.sourceRevisionStatus = "LEGACY_FINALIZATION_BOUND";
      } else {
        throw new Error(row.sourceRevision == null
          ? "LETTER_SUMMARY_SOURCE_REVISION_MISSING" : "LETTER_SUMMARY_SOURCE_REVISION_MISMATCH");
      }
      proof.status = "COMPLETE";
      return proof;
    } catch (error) {
      const rawCode = error instanceof Error ? error.message.split(":", 1)[0] : "";
      proof.status = rawCode === "LETTER_SUMMARY_PROJECTION_IDENTITY_MISMATCH"
        || rawCode === "LETTER_SUMMARY_PROJECTION_DUPLICATE"
        || rawCode === "LETTER_SUMMARY_LEGACY_MARKER_UNVERIFIED"
        || rawCode === "LETTER_SUMMARY_SOURCE_REVISION_MISMATCH"
        || rawCode === "LETTER_SUMMARY_PROJECTION_PATH_INVALID"
        ? "CONFLICT" : "ERROR";
      proof.errorCode = /^[A-Za-z0-9_-]{1,96}$/.test(rawCode)
        ? rawCode : "LETTER_SUMMARY_PROJECTION_VERIFY_FAILED";
      return proof;
    }
  }

  refreshProjectionProofs(job) {
    const forgottenOwners = this.getForgottenOwnerIds(job);
    const senderId = job.context.senderId, recipientId = job.context.recipientId;
    const sender = this.verifyLegacyProjection(job, senderId, recipientId, forgottenOwners);
    const recipient = this.verifyLegacyProjection(job, recipientId, senderId, forgottenOwners);
    job.narrative.projections = { sender, recipient };
    return job.narrative.projections;
  }

  hasCompleteProjectionProofs(job) {
    return job.narrative.projections?.sender?.status === "COMPLETE"
      && job.narrative.projections?.recipient?.status === "COMPLETE";
  }

  async ensureProjections(job) {
    this.assertNoLegacyIdentityConflict(job);
    let projections = this.refreshProjectionProofs(job);
    if (this.hasCompleteProjectionProofs(job)) {
      job.narrative.projectionStatus = "COMPLETE";
      this.writeJob(job);
      return;
    }

    const hasUnsafeProof = [projections.sender, projections.recipient].some(proof =>
      proof.status === "ERROR" || proof.status === "CONFLICT");
    const hasMissingAllowedProjection = [projections.sender, projections.recipient]
      .some(proof => proof.status === "MISSING");
    if (!hasUnsafeProof && hasMissingAllowedProjection) {
      if (typeof this.persistSummary !== "function") throw new Error("LETTER_SUMMARY_PERSIST_UNAVAILABLE");
      let persistError = null;
      try { await this.persistSummary(job.narrative.summary, this.summaryContext(job)); }
      catch (error) { persistError = error; }
      // The writer result (including success:true) is acceptance only. Re-read each owner file.
      projections = this.refreshProjectionProofs(job);
      if (this.hasCompleteProjectionProofs(job)) {
        job.narrative.projectionStatus = "COMPLETE";
        this.writeJob(job);
        return;
      }
      if (persistError && projections.sender.status === "ERROR" && projections.recipient.status === "ERROR") {
        const code = persistError instanceof Error ? persistError.message.split(":", 1)[0] : "";
        if (/^[A-Za-z0-9_-]{1,96}$/.test(code)) throw new Error(code);
      }
    }

    const senderError = projections.sender.errorCode, recipientError = projections.recipient.errorCode;
    if ([projections.sender, projections.recipient].some(proof => proof.status === "FORGOTTEN" || proof.status === "CONFLICT")) {
      job.narrative.projectionStatus = "MANUAL_BLOCKED";
      const errorCode = senderError || recipientError || "LETTER_SUMMARY_PROJECTION_MANUAL_BLOCKED";
      this.writeJob(job);
      throw new Error(errorCode);
    }
    job.narrative.projectionStatus = "FAILED";
    const errorCode = senderError || recipientError || "LETTER_SUMMARY_PROJECTION_MISSING";
    this.writeJob(job);
    throw new Error(errorCode);
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

    // Re-check both owner files even when the job previously completed. A Forget
    // tombstone can invalidate one direction while a later marker still needs writing.
    await this.ensureProjections(job);

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
      narrative.status = this.canComplete(job) ? "COMPLETE" : "PENDING";
      this.writeJob(job);
    }
  }

  canComplete(job) {
    return job.narrative.summaryStatus === "COMPLETE"
      && job.narrative.projectionStatus === "COMPLETE"
      && this.hasCompleteProjectionProofs(job)
      && job.narrative.legacyStatus === "COMPLETE"
      && job.narrative.markerStatus === "COMPLETE";
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
    const currentStatus = this.status(job);
    if (currentStatus === "COMPLETE" || currentStatus === "MANUAL_BLOCKED") return this.result(job);
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
      if (job.narrative.projectionStatus === "MANUAL_BLOCKED") job.narrative.status = "MANUAL_BLOCKED";
    }
    const status = this.status(job);
    if (status === "COMPLETE") job.retryCount = 0;
    else if (status !== "MANUAL_BLOCKED") job.retryCount++;
    this.writeJob(job);
    return this.result(job);
  }

  status(job) {
    if (job.narrative.summaryStatus === "COMPLETE"
      && (job.narrative.status === "COMPLETE" || job.narrative.projectionStatus === "COMPLETE")) {
      try {
        const projections = this.refreshProjectionProofs(job);
        if (this.hasCompleteProjectionProofs(job)) {
          job.narrative.projectionStatus = "COMPLETE";
        } else if ([projections.sender, projections.recipient].some(proof =>
          proof.status === "FORGOTTEN" || proof.status === "ERROR" || proof.status === "CONFLICT")) {
          job.narrative.projectionStatus = "MANUAL_BLOCKED";
          job.narrative.status = "MANUAL_BLOCKED";
          job.lastErrorCode = projections.sender.errorCode || projections.recipient.errorCode
            || "LETTER_SUMMARY_PROJECTION_MANUAL_BLOCKED";
        } else {
          job.narrative.projectionStatus = "PENDING";
          job.narrative.status = "PENDING";
        }
      } catch {
        job.narrative.projections = { sender: { status: "ERROR", errorCode: "LETTER_SUMMARY_PROJECTION_VERIFY_FAILED" },
          recipient: { status: "ERROR", errorCode: "LETTER_SUMMARY_PROJECTION_VERIFY_FAILED" } };
        job.narrative.projectionStatus = "MANUAL_BLOCKED";
        job.narrative.status = "MANUAL_BLOCKED";
        job.lastErrorCode = "LETTER_SUMMARY_PROJECTION_VERIFY_FAILED";
      }
    }
    if (job.narrative.status === "COMPLETE" && !this.canComplete(job)) job.narrative.status = "PENDING";
    if (job.narrative.status === "COMPLETE") return "COMPLETE";
    return job.narrative.status === "MANUAL_BLOCKED" ? "MANUAL_BLOCKED" : "FAILED_NARRATIVE";
  }

  result(job) {
    return { jobId: job.jobId, campaignToken: job.context.campaignToken, status: this.status(job),
      narrativeStatus: job.narrative.status,
      archiveStatus: this.status(job) === "COMPLETE" ? "SUMMARY_COMPLETE"
        : this.status(job) === "MANUAL_BLOCKED" ? "SUMMARY_MANUAL_BLOCKED" : "SUMMARY_RETRYABLE_FAILED",
      deliveryStatus: "DELIVERED", sourceLetterId: job.context.letterId,
      sourceRevision: job.sourceRevision,
      summaryStatus: job.narrative.summaryStatus, projectionStatus: job.narrative.projectionStatus,
      senderProjection: job.narrative.projections?.sender || null,
      recipientProjection: job.narrative.projections?.recipient || null,
      legacyStatus: job.narrative.legacyStatus, markerStatus: job.narrative.markerStatus,
      retryCount: job.retryCount, errorCode: job.lastErrorCode || null };
  }

  getJobStatus(jobId) {
    try { return this.result(this.readJob(jobId)); }
    catch (error) {
      return { jobId, status: "INVALID", archiveStatus: "SUMMARY_MANUAL_BLOCKED",
        errorCode: error instanceof Error ? error.message : "LETTER_SUMMARY_JOB_INVALID" };
    }
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
      if (this.status(job) === "MANUAL_BLOCKED") { results.push(this.result(job)); continue; }
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
      if (job.narrative.status === "MANUAL_BLOCKED" || job.retryCount >= MAX_AUTOMATIC_FAILURES) result.manual++;
    }
    return result;
  }
}

module.exports = { LetterSummaryFinalization };
