"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { MEMORY_ENGINE_VERSION } = require("../version");
const { MEMORY_TYPES, VISIBILITIES, createMemoryId, createMemoryRecord, uniqueIds } = require("./memory-types");
const { MemoryStore } = require("./memory-store");
const { MemoryExtractor } = require("./memory-extractor");
const { MemoryRanker } = require("./memory-ranker");
const { KnowledgeService } = require("./knowledge-service");
const { RollingSummaryManager } = require("./rolling-summary-manager");
const { MemoryConsolidator } = require("./memory-consolidator");
const { MemoryTrace } = require("./memory-trace");
const { MentionTracker } = require("./mention-tracker");
const { getCharacterMentionAliases } = require("./character-identity");
const { buildPerspectiveSummaryMap, validatePerspectiveSummaryMap } = require("./perspective-projector");
const turnRecall = require("./turn-recall");

const FINAL_SUMMARY_MAX_ATTEMPTS = 2;
const RECOVERY_MAX_ATTEMPTS = 3;

class MemoryEngine {
  constructor({ baseDir, summaryFoldersDir = null, recoveryDir = null, store = null, trace = null } = {}) {
    this.trace = trace || new MemoryTrace();
    this.store = store || new MemoryStore({ baseDir, summaryFoldersDir, recoveryDir });
    this.extractor = new MemoryExtractor();
    this.ranker = new MemoryRanker();
    this.knowledge = new KnowledgeService({ store: this.store, trace: this.trace });
    this.rolling = new RollingSummaryManager({ trace: this.trace });
    this.consolidator = new MemoryConsolidator({ store: this.store, trace: this.trace });
    this.mentionTracker = new MentionTracker({
      onUnresolved: (entry) => {
        this.trace.record("mention_unresolved", { reason: entry.reason, alias: entry.alias, characterIds: entry.characterIds });
        console.warn(`[Memory] 未能唯一绑定：${entry.alias} (${entry.reason})`);
      }
    });
    this.activeFinalizationIds = new Set();
  }

  createConversationState(conversationId) {
    return { conversationId, rollingState: this.rolling.createState(), participantPresence: [], mentionState: this.mentionTracker.createState(), mentionedRecallCache: new Map(), responderRecallCache: new Map(), turnRecallCache: new Map() };
  }

  ensureConversationState(conversation) {
    if (!conversation.memoryState) conversation.memoryState = this.createConversationState(conversation.id);
    if (!conversation.memoryState.rollingState) conversation.memoryState.rollingState = this.rolling.createState();
    if (!Array.isArray(conversation.memoryState.participantPresence)) conversation.memoryState.participantPresence = [];
    if (!conversation.memoryState.mentionState) conversation.memoryState.mentionState = this.mentionTracker.createState();
    if (!(conversation.memoryState.mentionedRecallCache instanceof Map)) conversation.memoryState.mentionedRecallCache = new Map();
    if (!(conversation.memoryState.responderRecallCache instanceof Map)) conversation.memoryState.responderRecallCache = new Map();
    if (!(conversation.memoryState.turnRecallCache instanceof Map)) conversation.memoryState.turnRecallCache = new Map();
    return conversation.memoryState;
  }

  findMentionedOutOfSceneCharacters({ conversation, history = [], candidates = [], excludedIds = [] } = {}) {
    if (!conversation) return [];
    const state = this.ensureConversationState(conversation);
    const characterIds = this.mentionTracker.update(state.mentionState, { history, candidates, excludedIds });
    this.trace.record("mention_scan", {
      conversationId: conversation.id,
      processedMessageCount: state.mentionState.processedThroughIndex,
      mentionedCharacterCount: characterIds.length
    });
    return characterIds;
  }

  findMentionedCharactersInHistory({ history = [], candidates = [], excludedIds = [] } = {}) {
    return this.mentionTracker.findMentionedCharacterIds(history, { candidates, excludedIds });
  }

  getCharacterMentionAliases(character) {
    return getCharacterMentionAliases(character);
  }

  deleteOwnedSummaryFolders(characterId) {
    const result = this.store.deleteOwnedSummaryFolders(characterId);
    this.trace.record("summary_owner_cleanup", { characterId: Number(characterId), removedFolderCount: result.removedFolderCount });
    return result;
  }

  markSummaryOwnerDeceased(characterId, details = {}) {
    const result = this.store.markSummaryOwnerDeceased(characterId, details);
    this.trace.record("summary_owner_tombstone", { characterId: Number(characterId), status: result.status });
    return result;
  }

  reviveSummaryOwner(characterId) {
    const result = this.store.reviveSummaryOwner(characterId);
    this.trace.record("summary_owner_reactivated", { characterId: Number(characterId) });
    return result;
  }

  isSummaryOwnerDeceased(characterId) {
    return this.store.isSummaryOwnerDeceased(characterId);
  }

  loadOwnerFolderMemories(characterId) {
    return this.store.loadFolderSummariesForCharacter(characterId);
  }

  invalidateSummaryFolderCache(characterIds = null) {
    this.store.invalidateFolderSummaryCache(characterIds);
  }

  getMentionableProfilesFromFolderMemories(memories = []) {
    const profiles = new Map();
    const ordered = [...(memories || [])].sort((left, right) => Number(left?.totalDays ?? -1) - Number(right?.totalDays ?? -1));
    for (const memory of ordered) {
      const observedTotalDays = Number(memory?.totalDays);
      for (const rawProfile of memory?.provenance?.participantProfiles || []) {
        const id = Number(rawProfile?.id ?? rawProfile?.characterId);
        if (!Number.isFinite(id)) continue;
        const previous = profiles.get(id) || { id, lastSeenTotalDays: -1 };
        profiles.set(id, {
          ...previous,
          ...rawProfile,
          id,
          allowDerivedHonorifics: false,
          lastSeenTotalDays: Number.isFinite(observedTotalDays) ? observedTotalDays : previous.lastSeenTotalDays
        });
      }
    }
    const assignLatestHonorific = (pattern, aliases) => {
      const candidates = [...profiles.values()].filter((profile) => pattern.test([
        profile.primaryTitle,
        profile.shortName,
        profile.fullName,
        profile.titleRankConcept
      ].filter(Boolean).join(" ").toLowerCase()));
      if (candidates.length === 0) return;
      const latestDay = Math.max(...candidates.map((profile) => Number(profile.lastSeenTotalDays ?? -1)));
      const latest = candidates.filter((profile) => Number(profile.lastSeenTotalDays ?? -1) === latestDay);
      if (latest.length !== 1) return;
      latest[0].mentionAliases = [...new Set([...(latest[0].mentionAliases || []), ...aliases])];
    };
    assignLatestHonorific(/皇帝|天子|帝国|emperor|kaiser|basileus|imperator|concept_emperor/, ["陛下", "皇帝", "天子"]);
    assignLatestHonorific(/皇后|empress/, ["陛下", "皇后"]);
    assignLatestHonorific(/国王|女王|王国|\bking\b|\bqueen\b|concept_kingdom/, ["陛下"]);
    assignLatestHonorific(/太子|王子|公主|亲王|prince|princess/, ["殿下"]);
    return profiles;
  }

  resolveRecoveryParticipantProfiles(snapshot = {}, currentProfiles = []) {
    const profiles = new Map();
    for (const profile of [...(snapshot.participants || []), ...(currentProfiles || [])]) {
      const id = Number(profile?.id);
      if (Number.isFinite(id)) profiles.set(id, { ...(profiles.get(id) || {}), ...profile, id });
    }
    const participantIds = uniqueIds([
      ...(snapshot.participants || []).map((profile) => profile?.id),
      ...(snapshot.participantPresence || []).map((presence) => presence?.characterId)
    ]);
    for (const characterId of participantIds) {
      if (profiles.has(characterId)) continue;
      const folderProfile = this.store.getSummaryFolderProfile(characterId);
      if (folderProfile) profiles.set(characterId, folderProfile);
    }
    return participantIds.map((characterId) => profiles.get(characterId)).filter(Boolean);
  }

  observeParticipants(conversation, characterIds, messageId) {
    const state = this.ensureConversationState(conversation);
    for (const characterId of uniqueIds(characterIds)) {
      if (!state.participantPresence.some((window) => window.characterId === characterId && window.leftAtMessageId == null)) {
        state.participantPresence.push({ characterId, joinedAtMessageId: messageId, leftAtMessageId: null });
      }
    }
    return state.participantPresence;
  }

  markParticipantLeft(conversation, characterId, messageId) {
    const state = this.ensureConversationState(conversation);
    const window = [...state.participantPresence].reverse().find((entry) => entry.characterId === Number(characterId) && entry.leftAtMessageId == null);
    if (window) window.leftAtMessageId = messageId;
    return window || null;
  }

  syncConversationRollingFields(conversation) {
    const rollingState = this.ensureConversationState(conversation).rollingState;
    conversation.currentSummary = rollingState.currentSummary;
    conversation.lastSummarizedMessageIndex = rollingState.committedThroughHistoryIndex;
  }

  syncRollingStateFromConversationFields(conversation) {
    const rollingState = this.ensureConversationState(conversation).rollingState;
    if (conversation.currentSummary && !rollingState.currentSummary) rollingState.currentSummary = conversation.currentSummary;
    if (Number(conversation.lastSummarizedMessageIndex) > rollingState.committedThroughHistoryIndex) {
      rollingState.committedThroughHistoryIndex = Number(conversation.lastSummarizedMessageIndex);
    }
    return rollingState;
  }

  async maybeCreateRollingCheckpoint({ conversation, history, contextLimit, percentage = 0.4, estimateMessageTokens, buildPrompt, requestSummary }) {
    const state = this.syncRollingStateFromConversationFields(conversation);
    const result = await this.rolling.checkpoint({
      state,
      history,
      tokensToSummarize: Math.floor(contextLimit * percentage),
      estimateMessageTokens,
      buildPrompt,
      requestSummary
    });
    this.syncConversationRollingFields(conversation);
    return result;
  }

  buildEpisode(context, extraction) {
    const perspectives = [];
    for (const memory of extraction.memories) {
      for (const characterId of memory.knownBy || []) {
        perspectives.push({ characterId, memoryId: memory.memoryId, awareness: "witnessed", content: memory.content });
      }
    }
    return {
      schemaVersion: 2,
      episodeId: context.episodeId || `episode_${context.conversationId}_${context.finalizationId}`,
      conversationId: context.conversationId,
      finalizationId: context.finalizationId,
      summaryRequestId: context.summaryRequestId,
      commitMarker: context.commitMarker || null,
      date: context.date || null,
      totalDays: context.totalDays ?? null,
      participants: context.participants || [],
      excludedSummaryOwnerIds: uniqueIds(context.excludedSummaryOwnerIds),
      participantPresence: context.participantPresence || [],
      joinEvents: context.joinEvents || [],
      leaveEvents: context.leaveEvents || [],
      sessionSummary: extraction.sessionSummary,
      summarySegments: (extraction.summarySegments || []).map((segment) => ({ ...segment })),
      memoryIds: extraction.memories.map((memory) => memory.memoryId),
      perspectives,
      createdAt: new Date().toISOString()
    };
  }

  persistExtraction(context, extraction) {
    const messageIds = (context.messages || []).map((message) => Number(message.id)).filter(Number.isFinite);
    const episodeContext = {
      conversationId: context.conversationId,
      participantPresence: context.participantPresence || [],
      conversationStartMessageId: messageIds.length > 0 ? Math.min(...messageIds) : null,
      conversationEndMessageId: messageIds.length > 0 ? Math.max(...messageIds) : null
    };
    const allowedIds = new Set(uniqueIds([
      ...(context.participants || []).map((entry) => entry.id),
      ...(context.participantPresence || []).map((entry) => entry.characterId)
    ]));
    const participantByName = new Map();
    for (const participant of context.participants || []) {
      for (const name of [participant.name, participant.fullName].filter(Boolean)) participantByName.set(name, Number(participant.id));
    }
    const messageById = new Map((context.messages || []).map((message) => [Number(message.id), message]));
    extraction.summarySegments = (extraction.summarySegments || []).map((rawSegment) => {
      const segmentMessageIds = uniqueIds(rawSegment.provenance?.messageIds).filter((messageId) => messageById.has(messageId));
      const derivedSpeakerIds = segmentMessageIds.map((messageId) => participantByName.get(messageById.get(messageId)?.name)).filter(Number.isFinite);
      const participants = uniqueIds(rawSegment.participants).filter((characterId) => allowedIds.has(characterId));
      const visibility = VISIBILITIES.has(rawSegment.visibility) ? rawSegment.visibility : "participants";
      const segment = {
        ...rawSegment,
        participants: participants.length > 0 ? participants : derivedSpeakerIds,
        visibility: ["public", "world"].includes(visibility) ? "participants" : visibility,
        knownBy: [],
        provenance: {
          ...rawSegment.provenance,
          messageIds: segmentMessageIds,
          speakerIds: derivedSpeakerIds.length > 0 ? derivedSpeakerIds : uniqueIds(rawSegment.provenance?.speakerIds).filter((characterId) => allowedIds.has(characterId))
        }
      };
      return { ...segment, knownBy: this.knowledge.resolveKnownBy(segment, episodeContext) };
    });
    const saved = [];
    for (const rawCandidate of extraction.memories) {
      const candidateMessageIds = rawCandidate.provenance.messageIds.map(Number).filter((messageId) => messageById.has(messageId));
      const derivedSpeakerIds = candidateMessageIds.map((messageId) => participantByName.get(messageById.get(messageId)?.name)).filter(Number.isFinite);
      const participants = uniqueIds(rawCandidate.participants).filter((characterId) => allowedIds.has(characterId));
      const candidate = createMemoryRecord({
        ...rawCandidate,
        participants: participants.length > 0 ? participants : derivedSpeakerIds,
        subjects: uniqueIds(rawCandidate.subjects).filter((characterId) => allowedIds.has(characterId)),
        visibility: rawCandidate.type === "secret" ? "known_group" : (["public", "world"].includes(rawCandidate.visibility) && rawCandidate.source !== "game_fact" ? "participants" : rawCandidate.visibility),
        knownBy: [],
        provenance: {
          ...rawCandidate.provenance,
          messageIds: candidateMessageIds,
          speakerIds: derivedSpeakerIds.length > 0 ? derivedSpeakerIds : uniqueIds(rawCandidate.provenance.speakerIds).filter((characterId) => allowedIds.has(characterId))
        }
      });
      const knownBy = this.knowledge.resolveKnownBy(candidate, episodeContext);
      const memory = this.store.saveMemory({ ...candidate, knownBy });
      this.store.removeKnowledgeForMemory(memory.memoryId, knownBy);
      this.knowledge.markKnownBy(memory.memoryId, knownBy, { awareness: memory.source === "letter" ? "told" : "witnessed", acquiredAt: memory.totalDays, confidence: memory.confidence });
      saved.push(this.store.getMemory(memory.memoryId));
      this.trace.record("persist", { memoryId: memory.memoryId, type: memory.type, conversationId: context.conversationId });
    }
    extraction.memories = saved;
    const episode = this.store.saveEpisode(this.buildEpisode(context, extraction));
    for (const characterId of uniqueIds((context.participants || []).map((entry) => entry.id))) {
      this.consolidator.consolidateCharacter(characterId);
    }
    return { extraction, episode };
  }

  evaluateFinalSummaryQuality(context, extraction) {
    const messages = Array.isArray(context.messages) ? context.messages : [];
    const sourceChars = messages.reduce((total, message) => total + String(message?.content || "").trim().length, 0);
    const messageCount = messages.filter((message) => String(message?.content || "").trim()).length;
    const substantiveConversation = messageCount >= 2 && sourceChars > 0;
    const narrativeChars = String(extraction?.sessionSummary || "").replace(/\s/g, "").length;
    const segments = Array.isArray(extraction?.summarySegments) ? extraction.summarySegments : [];
    const reasons = [];
    if (!extraction?.structured) reasons.push("structured JSON was not returned");
    if (narrativeChars === 0) reasons.push("detailed narrative is empty");
    if (substantiveConversation && segments.length === 0) reasons.push("summarySegments are missing");
    reasons.push(...this.validateExtractionMessageIds(context, extraction).reasons);
    return { success: reasons.length === 0, reasons, sourceChars, messageCount, narrativeChars };
  }

  validateExtractionMessageIds(context, extraction) {
    const sourceIds = (context.messages || []).map((message) => Number(message?.id)).filter(Number.isFinite);
    const sourceSet = new Set(sourceIds);
    const minId = sourceIds.length > 0 ? Math.min(...sourceIds) : null;
    const maxId = sourceIds.length > 0 ? Math.max(...sourceIds) : null;
    const participantIds = new Set((context.participants || []).map((participant) => Number(participant?.id)).filter(Number.isFinite));
    const reasons = [];
    const validateItems = (items, label) => {
      if (!Array.isArray(items)) return;
      for (let index = 0; index < items.length; index++) {
        const rawIds = items[index]?.provenance?.messageIds;
        if (!Array.isArray(rawIds) || rawIds.length === 0) {
          reasons.push(`${label}[${index}] needs supporting messageIds`);
          continue;
        }
        if (rawIds.some((messageId) => !Number.isInteger(messageId) || messageId < minId || messageId > maxId || !sourceSet.has(messageId))) {
          reasons.push(`${label}[${index}] contains messageIds outside the source conversation`);
        }
        if (new Set(rawIds).size !== rawIds.length || rawIds.some((messageId, messageIndex) => messageIndex > 0 && messageId <= rawIds[messageIndex - 1])) reasons.push(`${label}[${index}] messageIds must be unique and chronological`);
        const speakerIds = items[index]?.provenance?.speakerIds;
        if (Array.isArray(speakerIds) && speakerIds.some((speakerId) => !Number.isInteger(speakerId) || !participantIds.has(speakerId))) reasons.push(`${label}[${index}] contains speakerIds outside the participants`);
      }
    };
    validateItems(extraction?.summarySegments, "summarySegments");
    validateItems(extraction?.memories, "memories");
    return { success: reasons.length === 0, reasons, minId, maxId };
  }

  buildSummaryQualityRetryPrompt(prompt, quality) {
    const correction = {
      role: "system",
      content: `Final-summary quality correction: the previous response was rejected (${quality.reasons.join("; ")}). Regenerate the complete JSON from the supplied conversation. Put the full chronological narrative in summarySegments, preserve concrete details and exact source messageIds without inventing facts. Do not return a shortened overview.`
    };
    const sourcePrompt = Array.isArray(prompt) ? [...prompt] : [];
    const finalUser = sourcePrompt.at(-1)?.role === "user" ? sourcePrompt.pop() : null;
    sourcePrompt.push(correction);
    if (finalUser) sourcePrompt.push(finalUser);
    return sourcePrompt;
  }

  async requestFinalSummary(context) {
    const prompt = context.buildPrompt(context);
    let lastError = null;
    let retryQuality = null;
    for (let attempt = 1; attempt <= FINAL_SUMMARY_MAX_ATTEMPTS; attempt++) {
      const startedAt = Date.now();
      try {
        const requestPrompt = retryQuality ? this.buildSummaryQualityRetryPrompt(prompt, retryQuality) : prompt;
        const result = await context.requestSummary(requestPrompt, { attempt });
        const content = typeof result?.content === "string" ? result.content.trim() : "";
        if (result?.finish_reason === "length") {
          lastError = new Error("truncated_final_summary_response");
        } else if (content) {
          const parsed = this.extractor.parseOutput(content, context);
          const quality = this.evaluateFinalSummaryQuality(context, parsed);
          if (quality.success) {
            this.trace.record("summary_provider", { conversationId: context.conversationId, attempt, success: true, durationMs: Date.now() - startedAt });
            return content;
          }
          retryQuality = quality;
          lastError = new Error(`final_summary_quality_failed:${quality.reasons.join("|")}`);
        } else {
          lastError = new Error("invalid_final_summary_response");
        }
      } catch (error) {
        lastError = error;
      }
      this.trace.record("summary_provider", { conversationId: context.conversationId, attempt, success: false, durationMs: Date.now() - startedAt, error: lastError?.message || "unknown" });
      if (attempt < FINAL_SUMMARY_MAX_ATTEMPTS) {
        this.trace.record("recover", { conversationId: context.conversationId, reason: "final_summary_retry" });
      }
    }
    throw lastError || new Error("invalid_final_summary_response");
  }

  getFinalizationId(context) {
    if (context.finalizationId) return String(context.finalizationId);
    const source = JSON.stringify({
      conversationId: context.conversationId || "unknown",
      messages: (context.messages || []).map((message) => [message.id ?? null, message.name || message.role || "", message.content || ""])
    });
    return `fin_${crypto.createHash("sha256").update(source).digest("hex").slice(0, 20)}`;
  }

  prepareFinalizationContext(context) {
    const finalizationId = this.getFinalizationId(context);
    return {
      ...context,
      finalizationId,
      summaryRequestId: context.summaryRequestId || finalizationId,
      episodeId: context.episodeId || `episode_${context.conversationId}_${finalizationId}`
    };
  }

  assignStableMemoryIds(context, extraction) {
    extraction.summarySegments = (extraction.summarySegments || []).map((segment, index) => {
      const fingerprint = JSON.stringify({
        finalizationId: context.finalizationId,
        index,
        content: segment.content,
        messageIds: segment.provenance?.messageIds || []
      });
      return {
        ...segment,
        segmentId: `segment_${crypto.createHash("sha256").update(fingerprint).digest("hex").slice(0, 24)}`,
        provenance: { ...segment.provenance, conversationId: context.conversationId, summaryRequestId: context.summaryRequestId }
      };
    });
    extraction.memories = (extraction.memories || []).map((memory, index) => {
      const fingerprint = JSON.stringify({
        finalizationId: context.finalizationId,
        index,
        type: memory.type,
        content: memory.content,
        messageIds: memory.provenance?.messageIds || []
      });
      const memoryId = `memory_${crypto.createHash("sha256").update(fingerprint).digest("hex").slice(0, 24)}`;
      return createMemoryRecord({
        ...memory,
        memoryId,
        provenance: { ...memory.provenance, conversationId: context.conversationId, summaryRequestId: context.summaryRequestId }
      });
    });
    return extraction;
  }

  serializeExtraction(extraction) {
    return {
      structured: extraction.structured === true,
      sessionSummary: extraction.sessionSummary || "",
      summarySegments: (extraction.summarySegments || []).map((segment) => ({ ...segment })),
      memories: (extraction.memories || []).map((memory) => ({ ...memory }))
    };
  }

  restoreExtraction(serialized) {
    if (!serialized || !Array.isArray(serialized.memories)) return null;
    return {
      structured: serialized.structured === true,
      sessionSummary: String(serialized.sessionSummary || ""),
      summarySegments: Array.isArray(serialized.summarySegments) ? serialized.summarySegments.map((segment) => ({ ...segment })) : [],
      memories: serialized.memories.map((memory) => createMemoryRecord(memory))
    };
  }

  isCommitted(context) {
    const episode = this.store.findEpisodeByFinalization(context.conversationId, context.finalizationId);
    return episode?.commitMarker ? episode : null;
  }

  traceFinalization(context, stage, details = {}) {
    this.trace.record("finalization", {
      conversationId: context.conversationId,
      finalizationId: context.finalizationId,
      stage,
      requestType: details.requestType || "final_summary",
      providerSuccess: details.providerSuccess === true,
      parseMode: details.parseMode || null,
      memoryCount: details.memoryCount ?? null,
      episodeSaved: details.episodeSaved === true,
      knowledgeSaved: details.knowledgeSaved === true,
      summaryFoldersSaved: details.summaryFoldersSaved === true,
      recoveryState: details.recoveryState || null,
      errorCode: details.errorCode || null
    });
  }

  async persistCharacterFolders(context, finalSummary, directedSummaries = null) {
    const persist = context.persistCharacterFolders;
    if (typeof persist !== "function") return { saved: false, skipped: true };
    const result = await persist(finalSummary, { ...context, directedSummaries });
    if (result !== true && result?.success !== true) throw new Error(result?.error || "summary_folder_persist_result_required");
    this.invalidateSummaryFolderCache((context.participants || []).map((participant) => participant.id));
    return { saved: true };
  }

  commitFinalization(context, extraction) {
    const commitMarker = `commit_${context.finalizationId}`;
    const episode = this.store.saveEpisode({
      ...this.buildEpisode(context, extraction),
      commitMarker,
      committedAt: new Date().toISOString()
    });
    return episode;
  }

  async finalizeWithAvailableOutput(context, { providerOutput = null, parsedExtraction = null, recoveryPath = null } = {}) {
    const committed = this.isCommitted(context);
    if (committed) {
      return { success: true, alreadyCommitted: true, finalSummary: committed.sessionSummary || "", extraction: null, recoveryPath };
    }
    let content = providerOutput;
    let snapshotPath = recoveryPath;
    if (!content) {
      snapshotPath = snapshotPath || this.writeRecoverySnapshot(context, {
        finalizationStage: "request",
        finalizationStatus: "pending",
        providerOutput: null
      });
      try {
        content = await this.requestFinalSummary(context);
      } catch (error) {
        snapshotPath = this.writeRecoverySnapshot(context, { finalizationStage: "request", finalizationStatus: "pending", providerOutput: null }, error);
        this.traceFinalization(context, "request", { recoveryState: "pending", errorCode: error.message });
        return { success: false, error, recoveryPath: snapshotPath };
      }
    }
    snapshotPath = snapshotPath || this.writeRecoverySnapshot(context, {
      finalizationStage: "parse",
      finalizationStatus: "pending",
      providerOutput: content
    });
    this.traceFinalization(context, "provider_received", { providerSuccess: true, recoveryState: "pending" });
    let extraction = this.restoreExtraction(parsedExtraction);
    try {
      if (!extraction) extraction = this.assignStableMemoryIds(context, this.extractor.parseOutput(content, context));
      let quality = this.evaluateFinalSummaryQuality(context, extraction);
      if (!quality.success && typeof context.requestSummary === "function") {
        content = await this.requestFinalSummary(context);
        extraction = this.assignStableMemoryIds(context, this.extractor.parseOutput(content, context));
        quality = this.evaluateFinalSummaryQuality(context, extraction);
      }
      if (!quality.success) throw new Error(`final_summary_quality_failed:${quality.reasons.join("|")}`);
      this.trace.record("extract", { conversationId: context.conversationId, reason: extraction.structured ? "structured" : "prose_fallback" });
      for (const memory of extraction.memories) this.trace.record("classify", { memoryId: memory.memoryId, type: memory.type, conversationId: context.conversationId });
      this.writeRecoverySnapshot(context, {
        finalizationStage: "persist",
        finalizationStatus: "pending",
        providerOutput: content,
        parsedExtraction: this.serializeExtraction(extraction)
      });
      this.traceFinalization(context, "parsed", { providerSuccess: true, parseMode: extraction.structured ? "structured" : "prose_fallback", memoryCount: extraction.memories.length, recoveryState: "pending" });
    } catch (error) {
      const failedPath = this.writeRecoverySnapshot(context, { finalizationStage: "parse", finalizationStatus: "pending", providerOutput: content }, error);
      this.traceFinalization(context, "parse", { providerSuccess: true, recoveryState: "pending", errorCode: error.message });
      return { success: false, error, recoveryPath: failedPath };
    }
    const persistStartedAt = Date.now();
    try {
      const persisted = this.persistExtraction(context, extraction);
      const directedSummaries = buildPerspectiveSummaryMap(context, extraction);
      const projectionValidation = validatePerspectiveSummaryMap(context, extraction, directedSummaries);
      if (!projectionValidation.success) {
        throw new Error(`${projectionValidation.error}:${projectionValidation.invalidPairs.map((pair) => `${pair.ownerId}->${pair.counterpartId}:${pair.reason}`).join(",")}`);
      }
      const folderPersistence = await this.persistCharacterFolders(context, extraction.sessionSummary || content, directedSummaries);
      this.commitFinalization(context, extraction);
      this.trace.record("summary_persist", { conversationId: context.conversationId, finalizationId: context.finalizationId, success: true, durationMs: Date.now() - persistStartedAt, memoryCount: extraction.memories.length });
      if (fs.existsSync(snapshotPath)) fs.unlinkSync(snapshotPath);
      this.traceFinalization(context, "committed", {
        providerSuccess: true,
        parseMode: extraction.structured ? "structured" : "prose_fallback",
        memoryCount: extraction.memories.length,
        episodeSaved: !!persisted.episode,
        knowledgeSaved: true,
        summaryFoldersSaved: folderPersistence.saved === true,
        recoveryState: "committed"
      });
      return { success: true, finalSummary: extraction.sessionSummary || content, extraction, directedSummaries };
    } catch (error) {
      this.trace.record("summary_persist", { conversationId: context.conversationId, finalizationId: context.finalizationId, success: false, durationMs: Date.now() - persistStartedAt, memoryCount: extraction.memories.length, error: error.message || String(error) });
      const failedPath = this.writeRecoverySnapshot(context, {
        finalizationStage: "persist",
        finalizationStatus: "pending",
        providerOutput: content,
        parsedExtraction: this.serializeExtraction(extraction)
      }, error);
      this.traceFinalization(context, "persist", { providerSuccess: true, memoryCount: extraction.memories.length, recoveryState: "pending", errorCode: error.message });
      return { success: false, error, recoveryPath: failedPath };
    }
  }

  async finalizeConversation(context) {
    const prepared = this.prepareFinalizationContext(context);
    this.activeFinalizationIds.add(prepared.finalizationId);
    try {
      return await this.finalizeWithAvailableOutput(prepared);
    } finally {
      this.activeFinalizationIds.delete(prepared.finalizationId);
    }
  }

  checkpointConversation(context, { reason = "conversation_active" } = {}) {
    const prepared = this.prepareFinalizationContext(context);
    const recoveryPath = this.writeRecoverySnapshot(prepared, {
      finalizationStage: "request",
      finalizationStatus: "conversation_active",
      providerOutput: null,
      parsedExtraction: null,
      lastError: null,
      checkpointReason: reason
    });
    this.traceFinalization(prepared, "checkpoint", { recoveryState: "conversation_active" });
    return recoveryPath;
  }

  buildFinalizationPrompt(context) {
    return this.extractor.buildPrompt({
      ...context,
      rollingSummary: context.rollingState?.currentSummary || ""
    });
  }

  writeRecoverySnapshot(context, state = {}, error = null) {
    const safeId = String(context.conversationId || createMemoryId("conversation")).replace(/[^a-zA-Z0-9_-]/g, "_");
    const filePath = path.join(this.store.paths.recovery, `conversation_${safeId}.json`);
    const existing = this.store.readJson(filePath, {});
    const lastError = error instanceof Error ? error.message : error ? String(error) : state.lastError || existing.lastError || null;
    this.store.writeJson(filePath, {
      ...existing,
      schemaVersion: 2,
      conversationId: context.conversationId,
      finalizationId: context.finalizationId,
      summaryRequestId: context.summaryRequestId,
      date: context.date || null,
      totalDays: context.totalDays ?? null,
      participants: context.participants || [],
      excludedSummaryOwnerIds: uniqueIds(context.excludedSummaryOwnerIds),
      participantPresence: context.participantPresence || [],
      joinEvents: context.joinEvents || [],
      leaveEvents: context.leaveEvents || [],
      rollingState: context.rollingState || this.rolling.createState(),
      rawMessages: context.messages || [],
      finalizationStage: state.finalizationStage || existing.finalizationStage || "request",
      finalizationStatus: state.finalizationStatus || existing.finalizationStatus || "pending",
      providerOutput: state.providerOutput ?? existing.providerOutput ?? null,
      parsedExtraction: state.parsedExtraction ?? existing.parsedExtraction ?? null,
      checkpointReason: state.checkpointReason || existing.checkpointReason || null,
      retryCount: Number(state.retryCount ?? existing.retryCount ?? context.retryCount ?? 0),
      lastError,
      lastTriedAt: state.lastTriedAt || existing.lastTriedAt || null,
      createdAt: existing.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    return filePath;
  }

  listRecoverySnapshots() {
    if (!fs.existsSync(this.store.paths.recovery)) return [];
    return fs.readdirSync(this.store.paths.recovery).filter((name) => name.endsWith(".json")).map((name) => path.join(this.store.paths.recovery, name));
  }

  async recoverFailedFinalization(filePath, { requestSummary, buildPrompt, persistCharacterFolders, resolveParticipantProfiles, automatic = false } = {}) {
    const snapshot = this.store.readJson(filePath, null);
    if (!snapshot) return { success: false, reason: "invalid_recovery_snapshot" };
    const participants = typeof resolveParticipantProfiles === "function" ? resolveParticipantProfiles(snapshot) : snapshot.participants;
    const context = this.prepareFinalizationContext({
      conversationId: snapshot.conversationId,
      finalizationId: snapshot.finalizationId,
      summaryRequestId: snapshot.summaryRequestId,
      date: snapshot.date,
      totalDays: snapshot.totalDays,
      participants,
      excludedSummaryOwnerIds: snapshot.excludedSummaryOwnerIds || [],
      participantPresence: snapshot.participantPresence,
      joinEvents: snapshot.joinEvents || [],
      leaveEvents: snapshot.leaveEvents || [],
      messages: snapshot.rawMessages,
      rollingState: snapshot.rollingState,
      retryCount: Number(snapshot.retryCount || 0) + 1,
      requestSummary,
      buildPrompt,
      persistCharacterFolders
    });
    if (this.isCommitted(context)) {
      fs.unlinkSync(filePath);
      return { success: true, alreadyCommitted: true, participants: context.participants };
    }
    this.writeRecoverySnapshot(context, {
      finalizationStage: snapshot.finalizationStage || "request",
      finalizationStatus: "recovering",
      providerOutput: snapshot.providerOutput || null,
      parsedExtraction: snapshot.parsedExtraction || null,
      retryCount: context.retryCount,
      lastTriedAt: new Date().toISOString()
    });
    const result = await this.finalizeWithAvailableOutput(context, {
      providerOutput: snapshot.providerOutput || null,
      parsedExtraction: snapshot.parsedExtraction || null,
      recoveryPath: filePath
    });
    if (result.success) {
      this.trace.record("recover", { conversationId: context.conversationId, reason: "recovered" });
      return { ...result, participants: context.participants };
    }
    const retryCount = context.retryCount;
    this.writeRecoverySnapshot(context, {
      finalizationStage: this.store.readJson(filePath, snapshot)?.finalizationStage || snapshot.finalizationStage || "request",
      finalizationStatus: automatic && retryCount >= RECOVERY_MAX_ATTEMPTS ? "failed_manual" : "failed_retryable",
      retryCount,
      lastTriedAt: new Date().toISOString()
    }, result.error);
    return { ...result, recoveryPath: filePath };
  }

  async recoverPendingFinalizations({ requestSummary, buildPrompt, persistCharacterFolders, resolveParticipantProfiles } = {}) {
    const results = [];
    for (const filePath of this.listRecoverySnapshots()) {
      let snapshot = this.store.readJson(filePath, null);
      if (!snapshot) continue;
      const obsoleteFixedLengthFailure = snapshot.finalizationStatus === "failed_manual"
        && /^final_summary_quality_failed:detailed narrative has \d+ chars; require at least \d+$/.test(String(snapshot.lastError || ""));
      if (obsoleteFixedLengthFailure) {
        snapshot = {
          ...snapshot,
          finalizationStatus: "failed_retryable",
          retryCount: 0,
          lastError: null,
          updatedAt: new Date().toISOString()
        };
        this.store.writeJson(filePath, snapshot);
        this.trace.record("recover", { conversationId: snapshot.conversationId, reason: "obsolete_fixed_length_quality_gate" });
      }
      if (snapshot.finalizationId && this.activeFinalizationIds.has(String(snapshot.finalizationId))) {
        this.trace.record("recover", { conversationId: snapshot.conversationId, reason: "active_finalization" });
        continue;
      }
      if (Number(snapshot.retryCount || 0) >= RECOVERY_MAX_ATTEMPTS) {
        if (snapshot.finalizationStatus !== "failed_manual") this.writeRecoverySnapshot(this.prepareFinalizationContext(snapshot), { finalizationStatus: "failed_manual", retryCount: snapshot.retryCount });
        continue;
      }
      results.push(await this.recoverFailedFinalization(filePath, { requestSummary, buildPrompt, persistCharacterFolders, resolveParticipantProfiles, automatic: true }));
    }
    return results;
  }

  getRouteMemoryKey(memory) {
    const finalizationId = memory.provenance?.finalizationId;
    return finalizationId ? `${memory.provenance?.folderOwnerId ?? "internal"}|${finalizationId}` : memory.memoryId;
  }

  getMemoryRecency(memory) {
    const totalDays = Number(memory.totalDays);
    if (Number.isFinite(totalDays)) return totalDays;
    const timestamp = Date.parse(memory.updatedAt || memory.createdAt || memory.eventDate || "");
    return Number.isFinite(timestamp) ? timestamp : 0;
  }

  selectRoutedMemories(routeGroups, { tokenBudget, estimateTokens, mode } = {}) {
    const groups = [...routeGroups.entries()].filter(([, entries]) => entries.length > 0);
    if (groups.length === 0 || tokenBudget <= 0) return [];
    const selected = [];
    const selectedByKey = new Map();
    let usedTokens = 0;
    const add = (entry, routeCharacterId, allowance = tokenBudget - usedTokens) => {
      if (!entry || allowance <= 0) return { added: false, merged: false };
      const key = this.getRouteMemoryKey(entry.memory);
      const existing = selectedByKey.get(key);
      if (existing) {
        existing.routeCharacterIds = [...new Set([...existing.routeCharacterIds, Number(routeCharacterId)])];
        return { added: false, merged: true };
      }
      const [fitted] = this.ranker.selectWithinBudget([entry], {
        tokenBudget: Math.min(allowance, tokenBudget - usedTokens),
        estimateTokens,
        allowTruncate: true
      });
      if (!fitted) return { added: false, merged: false };
      const routed = { ...fitted, routeKind: mode, routeCharacterIds: [Number(routeCharacterId)] };
      selected.push(routed);
      selectedByKey.set(key, routed);
      usedTokens += fitted.tokens;
      return { added: true, merged: false };
    };

    const recentByRoute = new Map(groups.map(([routeId, entries]) => [routeId, [...entries].sort((left, right) => this.getMemoryRecency(right.memory) - this.getMemoryRecency(left.memory))]));
    const baselineRounds = mode === "direct" && groups.length === 1 ? 2 : 1;
    const baselineAllowance = Math.max(1, Math.floor(tokenBudget / Math.max(1, groups.length * baselineRounds)));
    for (let round = 0; round < baselineRounds; round++) {
      for (const [routeId] of groups) add(recentByRoute.get(routeId)?.[round], routeId, baselineAllowance);
    }

    if (mode === "direct") {
      const extraLimit = groups.length === 1 ? Math.max(0, 3 - selected.length) : 2;
      const pool = groups.flatMap(([routeId, entries]) => entries.map((entry) => ({ routeId, entry })))
        .sort((left, right) => right.entry.score - left.entry.score);
      let extrasAdded = 0;
      for (const candidate of pool) {
        if (extrasAdded >= extraLimit || usedTokens >= tokenBudget) break;
        const result = add(candidate.entry, candidate.routeId);
        if (result.added) extrasAdded++;
      }
    } else if (mode === "mentioned") {
      for (let index = 0; index < groups.length; index++) {
        const [routeId, entries] = groups[index];
        const candidate = entries.find((entry) => !selectedByKey.has(this.getRouteMemoryKey(entry.memory)));
        const routesRemaining = Math.max(1, groups.length - index);
        add(candidate, routeId, Math.max(1, Math.floor((tokenBudget - usedTokens) / routesRemaining)));
      }
    }
    return selected;
  }

  retrieveForResponder({ characterId, query = "", directCounterpartIds = [], mentionedEntityIds = [], mentionedEntityNames = {}, mentionedRecallCache = null, sessionRecallCache = null, ownerFolderMemories = null, currentTotalDays = null, tokenBudget = 800, estimateTokens } = {}) {
    const startedAt = Date.now();
    const ownerId = Number(characterId);
    const directIds = uniqueIds(directCounterpartIds).filter((id) => id !== ownerId);
    const mentionedIds = uniqueIds(mentionedEntityIds).filter((id) => id !== ownerId && !directIds.includes(id));
    const budget = Math.max(0, Number(tokenBudget) || 0);
    const folderMemories = Array.isArray(ownerFolderMemories) ? ownerFolderMemories : directIds.length > 0 || mentionedIds.length > 0 ? this.store.loadFolderSummariesForCharacter(ownerId) : [];
    const directGroups = new Map();
    for (const counterpartId of directIds) {
      const memories = this.store.loadDirectPairSummaries(ownerId, counterpartId, folderMemories);
      directGroups.set(counterpartId, this.ranker.rank(memories, { query: "", participantIds: [counterpartId], currentTotalDays }));
    }
    const namesForEntity = (entityId) => {
      if (Array.isArray(mentionedEntityNames)) return mentionedEntityNames;
      return mentionedEntityNames?.[entityId] || mentionedEntityNames?.[String(entityId)] || [];
    };
    const cachedMentioned = mentionedRecallCache instanceof Map ? mentionedRecallCache.get(ownerId) : null;
    const cachedGroups = cachedMentioned?.groups instanceof Map ? cachedMentioned.groups : new Map();
    const mentionedGroups = new Map();
    let capturedMentioned = false;
    for (const entityId of mentionedIds) {
      if (cachedGroups.has(entityId)) {
        mentionedGroups.set(entityId, cachedGroups.get(entityId));
        continue;
      }
      const names = namesForEntity(entityId);
      const memories = this.store.searchOwnerFolderForEntity(ownerId, entityId, names, folderMemories);
      mentionedGroups.set(entityId, this.ranker.rank(memories, { query: [query, ...names].filter(Boolean).join(" "), entityIds: [entityId], currentTotalDays }));
      capturedMentioned = true;
    }
    if (mentionedRecallCache instanceof Map && (capturedMentioned || !cachedMentioned)) mentionedRecallCache.set(ownerId, { groups: new Map([...cachedGroups, ...mentionedGroups]) });
    const mentionedCacheHit = mentionedIds.length > 0 && !capturedMentioned && cachedMentioned?.groups instanceof Map;
    const internalMemories = this.store.queryMemories({ characterId: ownerId, includeFolderSummaries: false });
    const responderCache = sessionRecallCache instanceof Map
      ? sessionRecallCache.get(ownerId) || { mentionedSnapshots: new Map(), topicPatch: null }
      : { mentionedSnapshots: new Map(), topicPatch: null };
    if (!(responderCache.mentionedSnapshots instanceof Map)) responderCache.mentionedSnapshots = new Map();
    // This lane is deliberately query-independent. Re-ranking the so-called
    // stable block for every line made it the first cache breakpoint in most
    // long conversations. Direct recall and each out-of-scene entity are now
    // selected once per responder and then reused for the whole conversation.
    const stableRanked = this.ranker.rank(internalMemories, { query: "", entityIds: [], participantIds: [], currentTotalDays })
      .filter((entry) => entry.memory.importance >= 0.9 || entry.memory.status === "open" || entry.memory.unresolved);
    const patchBudgetLimit = query.trim() ? Math.floor(budget * 0.12) : 0;
    const frozenBudget = budget;
    const laneWeights = {
      direct: [...directGroups.values()].some((entries) => entries.length > 0) ? 55 : 0,
      mentioned: [...mentionedGroups.values()].some((entries) => entries.length > 0) ? 30 : 0,
      stable: stableRanked.length > 0 ? 15 : 0
    };
    const totalWeight = laneWeights.direct + laneWeights.mentioned + laneWeights.stable;
    const laneBudgets = { direct: 0, mentioned: 0, stable: 0 };
    if (totalWeight > 0) {
      for (const lane of ["direct", "mentioned", "stable"]) {
        laneBudgets[lane] = Math.floor(frozenBudget * laneWeights[lane] / totalWeight);
      }
      const remainder = frozenBudget - laneBudgets.direct - laneBudgets.mentioned - laneBudgets.stable;
      const firstActiveLane = ["direct", "mentioned", "stable"].find((lane) => laneWeights[lane] > 0);
      if (firstActiveLane) laneBudgets[firstActiveLane] += remainder;
    }
    const directBudget = laneBudgets.direct;
    const mentionedBudget = laneBudgets.mentioned;
    const stableBudget = laneBudgets.stable;
    const direct = Array.isArray(responderCache.direct)
      ? responderCache.direct
      : this.selectRoutedMemories(directGroups, { tokenBudget: directBudget, estimateTokens, mode: "direct" });
    if (!Array.isArray(responderCache.direct)) responderCache.direct = direct;
    const mentioned = [];
    for (const entityId of mentionedIds) {
      let snapshot = responderCache.mentionedSnapshots.get(entityId);
      if (!Array.isArray(snapshot)) {
        snapshot = this.selectRoutedMemories(new Map([[entityId, mentionedGroups.get(entityId) || []]]), { tokenBudget: Math.max(1, Math.floor(mentionedBudget / Math.max(1, mentionedIds.length))), estimateTokens, mode: "mentioned" });
        responderCache.mentionedSnapshots.set(entityId, snapshot);
      }
      mentioned.push(...snapshot);
    }
    const directByKey = new Map(direct.map((entry) => [this.getRouteMemoryKey(entry.memory), entry]));
    const deduplicatedMentioned = mentioned.filter((entry) => {
      const directEntry = directByKey.get(this.getRouteMemoryKey(entry.memory));
      if (!directEntry) return true;
      directEntry.mentionedCharacterIds = [...new Set([...(directEntry.mentionedCharacterIds || []), ...entry.routeCharacterIds])];
      return false;
    });
    const selectedFolderKeys = new Set([...direct, ...deduplicatedMentioned].map((entry) => this.getRouteMemoryKey(entry.memory)));
    const stable = Array.isArray(responderCache.stable)
      ? responderCache.stable
      : this.ranker.selectWithinBudget(stableRanked.filter((entry) => !selectedFolderKeys.has(this.getRouteMemoryKey(entry.memory))), { tokenBudget: stableBudget, estimateTokens });
    if (!Array.isArray(responderCache.stable)) responderCache.stable = stable;
    const frozenSelectedTokens = [...direct, ...deduplicatedMentioned, ...stable].reduce((total, entry) => total + Number(entry.tokens || 0), 0);
    const patchBudget = Math.max(0, Math.min(patchBudgetLimit, budget - frozenSelectedTokens));
    let topicPatch = Array.isArray(responderCache.topicPatch) ? responderCache.topicPatch : [];
    if (!responderCache.topicPatchLocked && patchBudget > 0) {
      const rankedPatchCandidates = this.ranker.rank(folderMemories, { query, entityIds: mentionedIds, participantIds: directIds, currentTotalDays })
        .filter((entry) => !selectedFolderKeys.has(this.getRouteMemoryKey(entry.memory)) && Number(entry.reason?.query) >= 0.28);
      topicPatch = this.ranker.selectWithinBudget(rankedPatchCandidates.slice(0, 1), { tokenBudget: patchBudget, estimateTokens, allowTruncate: true });
      if (topicPatch.length > 0) {
        topicPatch = topicPatch.map((entry) => ({ ...entry, routeKind: "session_topic_anchor", routeCharacterIds: uniqueIds([...directIds, ...mentionedIds]) }));
        responderCache.topicPatch = topicPatch;
        responderCache.topicPatchLocked = true;
      }
    }
    if (sessionRecallCache instanceof Map) sessionRecallCache.set(ownerId, responderCache);
    const relevant = [...direct, ...deduplicatedMentioned, ...topicPatch];
    for (const entry of [...stable, ...relevant]) {
      const reason = entry.routeKind === "direct" ? "direct_pair_route" : entry.routeKind === "mentioned" ? "mentioned_entity_route" : entry.routeKind === "session_topic_anchor" ? "session_topic_anchor" : "stable_memory";
      this.trace.record("rank", { memoryId: entry.memory.memoryId, type: entry.memory.type, score: entry.score, characterId: ownerId, reason });
      this.trace.record("retrieve", { memoryId: entry.memory.memoryId, type: entry.memory.type, score: entry.score, characterId: ownerId, reason });
      this.trace.record("inject", { memoryId: entry.memory.memoryId, type: entry.memory.type, score: entry.score, characterId: ownerId, reason });
    }
    const selectedTokens = [...stable, ...relevant].reduce((total, entry) => total + Number(entry.tokens || 0), 0);
    const folderCandidateCount = new Set([...directGroups.values(), ...mentionedGroups.values()].flat().map((entry) => this.getRouteMemoryKey(entry.memory))).size;
    this.trace.record("retrieval_metrics", {
      characterId: ownerId,
      durationMs: Date.now() - startedAt,
      candidateCount: folderCandidateCount + internalMemories.length,
      selectedCount: stable.length + relevant.length,
      selectedTokens,
      tokenBudget: budget,
      directRouteCount: directIds.length,
      mentionedRouteCount: mentionedIds.length,
      mentionedCacheHit,
      patchInserted: topicPatch.length > 0,
      indexSize: Object.keys(this.store.index.memories || {}).length
    });
    return {
      engineVersion: MEMORY_ENGINE_VERSION,
      folderSummaryCache: this.store.getFolderSummaryCacheMetrics(),
      respondingCharacterId: ownerId,
      stable,
      relevant,
      direct,
      mentioned: deduplicatedMentioned,
      topicPatch,
      stableText: this.formatMemoryBlock("长期稳定记忆", stable),
      directText: this.formatMemoryBlock("与当前在场人物的直接记忆", direct),
      directStableText: this.formatMemoryBlock("冻结的直接关系记忆（钉住项与最近记录）", direct),
      mentionedText: this.formatMemoryBlock("与被提及场外人物有关的记忆", deduplicatedMentioned),
      mentionedSnapshotText: this.formatMemoryBlock("冻结的场外人物记忆快照", deduplicatedMentioned),
      topicPatchText: this.formatMemoryBlock("会话话题记忆锚点（本场冻结）", topicPatch),
      relevantText: this.formatMemoryBlock("与当前话题相关的记忆", relevant),
      tokenBudget: budget,
      selectedTokens,
      folderCandidateCount,
      routing: {
        ownerId,
        directCounterpartIds: directIds,
        mentionedOutOfSceneIds: mentionedIds,
        mentionedSnapshot: mentionedIds.length > 0 ? capturedMentioned ? "captured" : "reused" : "empty",
        topicPatch: topicPatch.length > 0 ? "locked" : "empty",
        budgets: { direct: directBudget, mentioned: mentionedBudget, stable: stableBudget, topicPatch: patchBudget }
      }
    };
  }

  retrieveTurnRecall({ characterId, query = "", assistContext = "", entityIds = [], entityNames = [], participantIds = [], ownerFolderMemories = null, currentTotalDays = null, tokenBudget = 256, estimateTokens, cache = null, turnEpoch = 0 } = {}) {
    const ownerId = Number(characterId);
    const expandedQuery = turnRecall.expandQuery(query);
    const lexicalQuery = turnRecall.expandQuery(turnRecall.removeEntityNames(query, entityNames));
    const fingerprint = turnRecall.createQueryFingerprint(expandedQuery);
    const cacheKey = `${turnEpoch}:${ownerId}:${fingerprint}`;
    if (cache instanceof Map && cache.has(cacheKey)) return { ...cache.get(cacheKey), cacheHit: true };
    const intent = turnRecall.detectIntent(query, { entityNames });
    const budget = Math.min(320, Math.max(0, Number(tokenBudget) || 256));
    const folderMemories = Array.isArray(ownerFolderMemories) ? ownerFolderMemories : this.store.loadFolderSummariesForCharacter(ownerId);
    const internalMemories = this.store.queryMemories({ characterId: ownerId, includeFolderSummaries: false });
    const candidatesByKey = new Map();
    for (const memory of [...folderMemories, ...internalMemories]) candidatesByKey.set(this.getRouteMemoryKey(memory), memory);
    const ranked = this.ranker.rankTurnRecall([...candidatesByKey.values()], {
      query: lexicalQuery,
      assistQuery: assistContext,
      entityIds,
      participantIds,
      currentTotalDays
    });
    const top = ranked[0] || null;
    const primaryScore = Number(top?.reason?.primaryQuery || 0);
    const assistScore = Number(top?.reason?.assistQuery || 0);
    const explicitRecallRelevant = intent.triggered && (primaryScore >= 0.08 || assistScore >= 0.20);
    const similarityRecallRelevant = primaryScore >= 0.30;
    const intentTriggered = intent.triggered || similarityRecallRelevant;
    const triggered = top != null && budget > 0 && (explicitRecallRelevant || similarityRecallRelevant);
    const selected = triggered ? this.ranker.selectWithinBudget([top], { tokenBudget: budget, estimateTokens, allowTruncate: true }) : [];
    const text = this.formatTurnRecallBlock(selected);
    const actualTokens = text ? Math.max(1, (estimateTokens || ((value) => Math.ceil(String(value || "").length / 2)))(text)) : 0;
    let reason;
    if (!intent.triggered && !similarityRecallRelevant) reason = "no_recall_intent";
    else if (intent.triggered && !explicitRecallRelevant && !similarityRecallRelevant) reason = "explicit_recall_no_relevant_memory";
    else if (selected.length > 0 && intent.triggered) reason = "explicit_recall_intent";
    else if (selected.length > 0) reason = "similarity_threshold";
    else if (!top) reason = "no_memory_candidate";
    else reason = "token_budget_exhausted";
    const result = {
      triggered: selected.length > 0,
      intentTriggered,
      reason,
      selected,
      text,
      tokens: actualTokens,
      queryFingerprint: fingerprint,
      cacheHit: false,
      candidateCount: ranked.length
    };
    if (cache instanceof Map) cache.set(cacheKey, result);
    this.trace.record("turn_recall", { characterId: ownerId, turnEpoch, reason: result.reason, selectedCount: selected.length, tokens: result.tokens, candidateCount: ranked.length, queryFingerprint: fingerprint });
    return result;
  }

  retrieveForCharacter({ characterId, query = "", entityIds = [], entityNames = [], participantIds = [], currentTotalDays = null, tokenBudget = 800, estimateTokens } = {}) {
    const mentionedEntityNames = Object.fromEntries(uniqueIds(entityIds).map((entityId) => [entityId, entityNames || []]));
    return this.retrieveForResponder({
      characterId,
      query,
      directCounterpartIds: participantIds,
      mentionedEntityIds: entityIds,
      mentionedEntityNames,
      currentTotalDays,
      tokenBudget,
      estimateTokens
    });
  }

  retrieveMentionedCharacterMemories(options = {}) {
    return this.retrieveForCharacter(options);
  }

  updateMemoryContent(memoryId, content) {
    return this.updateMemory(memoryId, { content });
  }

  updateMemory(memoryId, updates = {}, { advanced = false } = {}) {
    const existing = this.store.getMemory(memoryId);
    if (!existing) return { success: false, error: "memory_not_found" };
    const next = {};
    const has = (key) => Object.prototype.hasOwnProperty.call(updates, key);
    if (has("content")) {
      const content = String(updates.content || "").trim();
      if (!content) return { success: false, error: "memory_content_required" };
      next.content = content;
      // Keep the retrieval representation correct unless advanced editing
      // explicitly supplies a different canonical form.
      next.canonicalText = has("canonicalText") && advanced ? String(updates.canonicalText || "").trim() || content : content;
    }
    if (has("type")) {
      if (!MEMORY_TYPES.has(updates.type)) return { success: false, error: "invalid_memory_type" };
      next.type = updates.type;
    }
    for (const key of ["subtype", "status"]) if (has(key)) next[key] = updates[key] == null ? null : String(updates[key]).trim();
    for (const key of ["importance", "confidence"]) {
      if (!has(key)) continue;
      const value = Number(updates[key]);
      if (!Number.isFinite(value) || value < 0 || value > 1) return { success: false, error: `invalid_${key}` };
      next[key] = value;
    }
    if (has("unresolved")) next.unresolved = updates.unresolved === true;
    if (has("tags")) next.tags = Array.isArray(updates.tags) ? [...new Set(updates.tags.map((tag) => String(tag).trim()).filter(Boolean))] : [];
    if (advanced) {
      if (has("visibility")) {
        if (!VISIBILITIES.has(updates.visibility)) return { success: false, error: "invalid_visibility" };
        next.visibility = updates.visibility;
      }
      for (const key of ["knownBy", "participants", "subjects"]) if (has(key)) next[key] = uniqueIds(updates[key]);
    }
    if (Object.keys(next).length === 0) return { success: false, error: "no_editable_memory_fields" };
    const changedFields = Object.keys(next);
    next.updatedBy = advanced ? "player_advanced" : "player";
    next.editHistory = [...(existing.editHistory || []), {
      version: existing.version,
      updatedAt: existing.updatedAt,
      updatedBy: existing.updatedBy,
      changedFields,
      content: existing.content,
      type: existing.type,
      subtype: existing.subtype,
      importance: existing.importance,
      confidence: existing.confidence,
      status: existing.status,
      unresolved: existing.unresolved,
      tags: existing.tags,
      visibility: existing.visibility,
      knownBy: existing.knownBy,
      participants: existing.participants,
      subjects: existing.subjects
    }].slice(-20);
    const affectedCharacterIds = uniqueIds([
      ...existing.knownBy,
      ...(next.knownBy || existing.knownBy),
      ...existing.participants,
      ...existing.subjects,
      ...(next.participants || existing.participants),
      ...(next.subjects || existing.subjects),
      ...this.store.listKnowledgeCharacterIds()
    ]);
    const capture = (filePath) => fs.existsSync(filePath) ? this.store.readJson(filePath, null) : null;
    const knowledgeBackup = new Map(affectedCharacterIds.map((characterId) => [characterId, capture(this.store.knowledgePath(characterId))]));
    const consolidationBackup = new Map(affectedCharacterIds.map((characterId) => [characterId, capture(path.join(this.store.paths.characters, `${characterId}.json`))]));
    const restore = (filePath, value) => {
      if (value === null) {
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      } else {
        this.store.writeJson(filePath, value);
      }
    };
    try {
      const memory = this.store.updateMemory(memoryId, next);
      if (!memory) throw new Error("memory_update_failed");
      this.store.removeKnowledgeForMemory(memoryId, memory.knownBy);
      for (const characterId of memory.knownBy) {
        this.store.markKnownBy(characterId, memory.memoryId, { awareness: "edited", acquiredAt: memory.totalDays, confidence: memory.confidence });
      }
      for (const characterId of uniqueIds([...existing.participants, ...existing.subjects, ...memory.participants, ...memory.subjects])) {
        this.consolidator.consolidateCharacter(characterId);
      }
      this.trace.record("memory_update", { memoryId, advanced, changedFields, version: memory.version, updatedBy: memory.updatedBy });
      return { success: true, memory };
    } catch (error) {
      try {
        this.store.saveMemory(existing);
        for (const [characterId, value] of knowledgeBackup) restore(this.store.knowledgePath(characterId), value);
        for (const [characterId, value] of consolidationBackup) restore(path.join(this.store.paths.characters, `${characterId}.json`), value);
        this.trace.record("memory_update_rollback", { memoryId, changedFields, error: error.message || String(error) });
      } catch (rollbackError) {
        this.trace.record("memory_update_rollback_failed", { memoryId, error: rollbackError.message || String(rollbackError) });
        return { success: false, error: "memory_update_rollback_failed", details: rollbackError.message || String(rollbackError) };
      }
      return { success: false, error: error.message || "memory_update_failed" };
    }
  }

  deleteMemory(memoryId) {
    const memory = this.store.getMemory(memoryId);
    if (!memory) return { success: false, error: "memory_not_found" };
    const deleted = this.store.deleteMemory(memoryId);
    if (!deleted) return { success: false, error: "memory_delete_failed" };
    for (const characterId of uniqueIds([...memory.participants, ...memory.subjects])) this.consolidator.consolidateCharacter(characterId);
    this.trace.record("memory_delete", { memoryId });
    return { success: true };
  }

  getUiOverview({ summaryCatalog = [] } = {}) {
    return {
      engineVersion: MEMORY_ENGINE_VERSION,
      folderSummaryCache: this.store.getFolderSummaryCacheMetrics(),
      totals: {
        structuredMemories: Object.keys(this.store.index.memories || {}).length,
        episodes: Object.keys(this.store.index.episodes || {}).length,
        knowledgeCharacters: this.store.listKnowledgeCharacterIds().length,
        summaryFolders: new Set(summaryCatalog.map((metadata) => metadata.folderName)).size,
        summaryFiles: summaryCatalog.length,
        summaryRecords: summaryCatalog.reduce((total, metadata) => total + (metadata.summaries?.length || 0), 0)
      },
      boundaries: [
        "每名 NPC 只读取自己的 ID_姓名目录；玩家目录保存摘要但玩家不执行提示词记忆召回。",
        "同一场对话内，长期稳定记忆、直接关系最近记录和场外人物快照不随当前问题重排；只在新会话读取最新终局记忆。",
        "直接参与者按自己的目录精确召回最近 2 条，并保留承诺、秘密或未决事项等钉住记忆。",
        "首次提到场外人物时，每名 NPC 分别从自己的目录建立记忆快照；Session Topic Anchor 首次命中后整场冻结。",
        "明确回忆问题可在当前用户消息之后追加 Top1 Turn Recall；默认 256 token、硬上限 320 token，同回合查询复用缓存。",
        "终局摘要按每名目录所有者的知情边界生成视角投影；不知情角色不会获得他人的私密内容。",
        "同一场群聊写入多个关系文件时按 finalizationId 去重；内容长度由每次 800–2400 token 的动态预算约束。"
      ],
      routingPolicy: {
        stablePrefix: "同一场对话每轮保持一致；新会话重新读取",
        directPair: "直接关系：最近 2 条 + 钉住记忆，整场冻结",
        group: "多人：分别按每个回应角色的知情视角召回",
        mentioned: "场外人物：首次提及时锁定快照，整场复用",
        sessionTopicAnchor: "首次话题命中 Top1，整场冻结并保留在历史前稳定区",
        turnRecall: "明确回忆意图且相关度达标时 Top1；当前用户消息后插入，默认 256 token",
        tokenBudget: "冻结记忆每名 NPC 每次回复使用上下文约 8%，最少 800、最多 2400 token"
      },
      characters: []
    };
  }

  formatMemoryBlock(title, entries) {
    if (!entries || entries.length === 0) return null;
    return `${title}（仅包含当前回应角色应当知道的内容）：\n${entries.map((entry) => `- [${entry.memory.type === "folder_summary" ? "人物目录摘要" : `${entry.memory.type}/${entry.memory.epistemicStatus}`}] ${entry.memory.eventDate || "日期不详"}：${entry.memory.content}`).join("\n")}`;
  }

  formatTurnRecallBlock(entries) {
    if (!entries || entries.length === 0) return null;
    return `=== Turn Recall：当前回应角色真实可知的过去事实 ===\n${entries.map((entry) => `- ${entry.memory.eventDate || "日期不详"}：${entry.memory.content}`).join("\n")}\n权威规则：不得否认上述明确记录。当前 CK3 数据表示现在，摘要/记忆表示过去；若信息不足，只能承认记忆模糊，不得编造。`;
  }

  recordLetterMemory({ senderId, recipientId, content, date = null, totalDays = null, letterId = null }) {
    const memory = this.store.saveMemory(createMemoryRecord({
      type: "letter", subtype: "correspondence", eventDate: date, totalDays,
      participants: [senderId, recipientId], subjects: [senderId, recipientId], content,
      importance: 0.65, confidence: 1, source: "letter", visibility: "known_group",
      knownBy: [senderId, recipientId], provenance: { conversationId: letterId, extractionMode: "letter_summary", messageIds: [], speakerIds: [senderId] }
    }));
    this.knowledge.markKnownBy(memory.memoryId, [senderId, recipientId], { awareness: "told", acquiredAt: totalDays, confidence: 1 });
    return memory;
  }

}

module.exports = { MemoryEngine };
