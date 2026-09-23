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
const { buildPerspectiveSummaryMap, validatePerspectiveSummaryMap, validateSummarySegmentPresenceBoundaries, validatePerspectiveCoverage, isMemoryRelevantToPair } = require("./perspective-projector");
const turnRecall = require("./turn-recall");
const { buildThirdPartyEvidencePatch } = require("./third-party-evidence");
const { planSummaryRequest } = require("./summary-budget-planner");
const { estimateTokens } = require("../token-estimator");
const { validateGenerationOutcome } = require("../providers/generation-outcome");
const { normalizeGameDate } = require("../worldline/character-temporal-facts");
const { resolveTemporalWindow } = require("./fuzzy-temporal-resolver");
const { selectTemporalExtras } = require("./summary-date-index");

const FINAL_SUMMARY_MAX_ATTEMPTS = 2;
const RECOVERY_MAX_ATTEMPTS = 3;
const SUMMARY_CHUNK_HARD_LIMIT = 64;

function countSummaryTokens(messages) {
  return (messages || []).reduce((total, message) => total + estimateTokens(message?.name ? `${message.name}: ${message.content || ""}` : message?.content || ""), 0);
}

function classifySummaryFailure(error) {
  const message = String(error?.message || error || "");
  if (/truncated_final_summary_response/.test(message)) return "LENGTH";
  if (/summary_(chunk|request)_budget_exceeded|context[_ ]length[_ ]exceeded|maximum context|too many tokens|prompt is too long/i.test(message)) return "CONTEXT_EXCEEDED";
  if (/429|rate[_ -]?limit/i.test(message)) return "RATE_LIMIT";
  if (/402|insufficient balance|abort|cancel/i.test(message)) return "FATAL";
  if (/final_summary_quality_failed|invalid_final_summary_response/i.test(message)) return "QUALITY";
  if (/5\d\d|ECONN|ETIMEDOUT|fetch failed/i.test(message)) return "TRANSIENT";
  return "UNKNOWN";
}

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
    this.memoryGeneration = 0;
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
      mentionedCharacterCount: characterIds.length,
      currentTurnMentionedCharacterCount: state.mentionState.currentTurnMentionedCharacterIds?.length || 0
    });
    return characterIds;
  }

  getCurrentTurnMentionedOutOfSceneCharacters({ conversation, excludedIds = [] } = {}) {
    if (!conversation) return [];
    const state = this.ensureConversationState(conversation);
    const excluded = new Set(uniqueIds(excludedIds).map(Number));
    return uniqueIds(state.mentionState.currentTurnMentionedCharacterIds).map(Number).filter((characterId) => !excluded.has(characterId));
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

  invalidateConversationRecallState(conversation) {
    if (!conversation) return;
    const state = this.ensureConversationState(conversation);
    state.mentionProfileCache = null;
    state.mentionedRecallCache = new Map();
    state.responderRecallCache = new Map();
    state.turnRecallCache = new Map();
    state.mentionState = this.mentionTracker.createState();
    const gameData = conversation.gameData;
    if (gameData?.mentionedCharactersInContext?.clear) gameData.mentionedCharactersInContext.clear();
    for (const character of gameData?.characters?.values?.() || []) {
      character.conversationSummaries = [];
      character.conversationCache = new Map();
      character.dynamicMemoryCache = null;
    }
  }

  clearAllLongTermMemory({ conversations = [] } = {}) {
    this.memoryGeneration += 1;
    this.store.clearLongTermMemoryStorage();
    for (const conversation of conversations) this.invalidateConversationRecallState(conversation);
    this.trace.record("memory_clear_all", { memoryGeneration: this.memoryGeneration });
    return { success: true, memoryGeneration: this.memoryGeneration };
  }

  refreshCharacterConsolidation(characterId) {
    this.store.deleteCharacterConsolidation(characterId);
    return this.consolidator.consolidateCharacter(characterId);
  }

  resolveSummaryProjection(summaryRecord, ownerId, counterpartId = null) {
    const numericOwnerId = Number(ownerId ?? summaryRecord?.perspectiveOwnerId ?? summaryRecord?.playerId);
    if (!Number.isSafeInteger(numericOwnerId) || numericOwnerId <= 0) throw new Error("summary_owner_id_required");
    const finalizationId = summaryRecord?.finalizationId ? String(summaryRecord.finalizationId) : null;
    if (finalizationId && this.activeFinalizationIds.has(finalizationId)) throw new Error("SUMMARY_FINALIZATION_IN_PROGRESS");
    if (finalizationId && this.listRecoverySnapshots().some(file => {
      const recovery = this.store.readJson(file, null);
      return recovery?.finalizationId === finalizationId && !this.isCommitted(recovery);
    })) throw new Error("SUMMARY_FINALIZATION_RECOVERY_PENDING");
    const episodes = finalizationId ? this.store.listAllEpisodes().filter(episode => String(episode.finalizationId || "") === finalizationId) : [];
    let memoryIds = summaryRecord?.perspectiveMemoryIds;
    if (!Array.isArray(memoryIds)) {
      const pairId = Number(counterpartId ?? summaryRecord?.characterId);
      if (!Number.isSafeInteger(pairId) || pairId <= 0 || pairId === numericOwnerId) {
        this.trace.record("LEGACY_SUMMARY_MEMORY_MAPPING_INCOMPLETE", { characterId: numericOwnerId, finalizationId });
        throw new Error("LEGACY_SUMMARY_MEMORY_MAPPING_INCOMPLETE");
      }
      const ownerKnown = new Set(this.store.getCharacterKnowledge(numericOwnerId).map(record => record.memoryId));
      const allMemories = this.store.listAllMemories();
      const matches = finalizationId ? allMemories.filter(memory => memory.provenance?.finalizationId === finalizationId) : [];
      const candidateIds = [...new Set([...episodes.flatMap(episode => episode.memoryIds || []), ...matches.map(memory => memory.memoryId)])];
      memoryIds = candidateIds.filter(id => {
        const memory = this.store.getMemory(id);
        const owned = memory && (ownerKnown.has(id) || memory.knownBy.includes(numericOwnerId) || memory.provenance?.folderOwnerId === numericOwnerId);
        if (owned && !uniqueIds([...memory.subjects, ...memory.participants, ...(memory.provenance?.speakerIds || [])]).length) throw new Error("LEGACY_SUMMARY_MEMORY_MAPPING_INCOMPLETE");
        return owned && isMemoryRelevantToPair(memory, numericOwnerId, pairId);
      });
      if (!episodes.length && !matches.length && (ownerKnown.size || allMemories.some(memory => memory.knownBy.includes(numericOwnerId) || memory.provenance?.folderOwnerId === numericOwnerId))) {
        this.trace.record("LEGACY_SUMMARY_MEMORY_MAPPING_INCOMPLETE", { characterId: numericOwnerId, finalizationId });
        throw new Error("LEGACY_SUMMARY_MEMORY_MAPPING_INCOMPLETE");
      }
    }
    return { numericOwnerId, finalizationId, episodes, memoryIds: [...new Set(memoryIds.map(String).filter(Boolean))] };
  }

  updateSummaryProjection(summaryRecord, editedText, { ownerId = null, counterpartId = null, invalidateConversations = [], summaryPath = null, persistSummary = null } = {}) {
    if (typeof editedText !== "string" || !editedText.trim() || editedText.length > 1048576) throw new Error("summary_content_required");
    const mapping = this.resolveSummaryProjection(summaryRecord, ownerId, counterpartId);
    const numericCounterpartId = Number(counterpartId ?? summaryRecord.characterId);
    if (!Number.isSafeInteger(numericCounterpartId) || numericCounterpartId <= 0) throw new Error("summary_counterpart_id_required");
    return this.store.withSummaryMutation(summaryPath, () => {
      this.forgetSummaryProjection({ ...summaryRecord, perspectiveMemoryIds: mapping.memoryIds }, { ownerId: mapping.numericOwnerId, counterpartId: numericCounterpartId });
      const finalizationId = mapping.finalizationId || createMemoryId("summary_edit");
      const memory = this.store.saveMemory({
        type: "information", subtype: "edited_summary_projection", content: editedText, canonicalText: editedText,
        participants: [mapping.numericOwnerId, numericCounterpartId], subjects: [numericCounterpartId],
        eventDate: summaryRecord.date, totalDays: summaryRecord.totalDays, source: "imported", updatedBy: "user",
        visibility: "known_group", knownBy: [mapping.numericOwnerId],
        provenance: { finalizationId, folderOwnerId: mapping.numericOwnerId, counterpartId: numericCounterpartId, extractionMode: "user_edited_summary" }
      });
      this.store.markKnownBy(mapping.numericOwnerId, memory.memoryId, { awareness: "imported", acquiredAt: memory.totalDays });
      const segmentId = createMemoryId("summary_edit_segment");
      const episode = mapping.episodes[0] ? this.store.listAllEpisodes().find(item => item.episodeId === mapping.episodes[0].episodeId) : { episodeId: createMemoryId("summary_edit_episode"), finalizationId, memoryIds: [], summarySegments: [] };
      this.store.saveEpisode({ ...episode, memoryIds: [...(episode.memoryIds || []), memory.memoryId], summarySegments: [...(episode.summarySegments || []), { segmentId, content: editedText, knownBy: [mapping.numericOwnerId], participants: memory.participants, visibility: "known_group" }] });
      const updatedRecord = { ...summaryRecord, content: editedText, finalizationId, perspectiveOwnerId: mapping.numericOwnerId, perspectiveMemoryIds: [memory.memoryId], perspectiveSummarySegmentIds: [segmentId], projectionHash: crypto.createHash("sha256").update(JSON.stringify([mapping.numericOwnerId, numericCounterpartId, editedText, memory.memoryId])).digest("hex") };
      if (persistSummary) persistSummary(updatedRecord);
      this.refreshCharacterConsolidation(mapping.numericOwnerId);
      this.invalidateSummaryFolderCache([mapping.numericOwnerId]);
      for (const conversation of invalidateConversations) this.invalidateConversationRecallState(conversation);
      this.trace.record("summary_projection_updated", { ownerId: mapping.numericOwnerId, finalizationId, memoryId: memory.memoryId });
      return { success: true, summaryRecord: updatedRecord };
    });
  }

  forgetSummaryProjection(summaryRecord, { ownerId = null, counterpartId = null, invalidateConversations = [] } = {}) {
    const { numericOwnerId, memoryIds } = this.resolveSummaryProjection(summaryRecord, ownerId, counterpartId);
    const segmentIds = new Set((summaryRecord?.perspectiveSummarySegmentIds || []).map(String).filter(Boolean));
    const finalizationId = summaryRecord?.finalizationId ? String(summaryRecord.finalizationId) : null;
    const pairId = Number(counterpartId ?? summaryRecord?.characterId);
    const episodes = this.store.listAllEpisodes().filter(episode => !finalizationId || String(episode.finalizationId || "") === finalizationId);
    // Resolve every legacy segment before revoking anything. A conversation-wide
    // knownBy list alone is not evidence that a segment belongs to this pair.
    const pairSegments = new Set();
    if (!Array.isArray(summaryRecord?.perspectiveSummarySegmentIds) && finalizationId) {
      for (const episode of episodes) for (const segment of episode.summarySegments || []) {
        if (!uniqueIds(segment.knownBy).includes(numericOwnerId)) continue;
        const ids = uniqueIds([...(segment.subjects || []), ...(segment.participants || []), ...(segment.provenance?.speakerIds || [])]);
        const knownBy = uniqueIds(segment.knownBy);
        if (!ids.length && knownBy.length !== 2) throw new Error("LEGACY_SUMMARY_MEMORY_MAPPING_INCOMPLETE");
        if (ids.length ? isMemoryRelevantToPair(segment, numericOwnerId, pairId) : knownBy.includes(pairId)) pairSegments.add(segment);
      }
    }
    let revokedMemoryCount = 0;
    let deletedMemoryCount = 0;
    for (const memoryId of memoryIds) {
      const memory = this.store.getMemory(memoryId);
      if (!memory) continue;
      this.store.revokeCharacterKnowledge(numericOwnerId, memoryId);
      const knownBy = uniqueIds(memory.knownBy).filter((characterId) => characterId !== numericOwnerId);
      if (knownBy.length === 0 && !["public", "world"].includes(memory.visibility)) {
        if (this.store.deleteMemory(memoryId)) deletedMemoryCount++;
      } else {
        this.store.updateMemory(memoryId, { knownBy });
        this.store.removeKnowledgeForMemory(memoryId, knownBy);
      }
      revokedMemoryCount++;
    }
    if (finalizationId || segmentIds.size > 0) {
      for (const episode of episodes) {
        if (finalizationId && String(episode.finalizationId || "") !== finalizationId) continue;
        let changed = false;
        const summarySegments = (episode.summarySegments || []).map((segment) => {
          if (Array.isArray(summaryRecord?.perspectiveSummarySegmentIds) ? !segmentIds.has(String(segment.segmentId || "")) : !pairSegments.has(segment)) return segment;
          const knownBy = uniqueIds(segment.knownBy).filter((characterId) => characterId !== numericOwnerId);
          if (knownBy.length === uniqueIds(segment.knownBy).length) return segment;
          changed = true;
          return { ...segment, knownBy };
        });
        if (changed) this.store.saveEpisode({ ...episode, summarySegments });
      }
    }
    this.compactEpisodeReferences();
    this.refreshCharacterConsolidation(numericOwnerId);
    this.invalidateSummaryFolderCache([numericOwnerId]);
    for (const conversation of invalidateConversations) this.invalidateConversationRecallState(conversation);
    this.trace.record("summary_projection_forgotten", {
      ownerId: numericOwnerId,
      counterpartId: Number.isFinite(Number(counterpartId)) ? Number(counterpartId) : null,
      finalizationId,
      revokedMemoryCount,
      deletedMemoryCount
    });
    return { success: true, revokedMemoryCount, deletedMemoryCount };
  }

  compactEpisodeReferences() {
    const retained = new Set(this.activeFinalizationIds);
    for (const file of this.listRecoverySnapshots()) {
      const recovery = this.store.readJson(file, null);
      if (!recovery) return { skipped: true, reason: "RECOVERY_UNREADABLE" };
      retained.add(String(recovery.finalizationId || ""));
    }
    let updated = 0;
    for (const episode of this.store.listAllEpisodes()) {
      if (retained.has(String(episode.finalizationId || "")) || episode.auditRequired === true) continue;
      const memoryIds = (episode.memoryIds || []).filter(id => this.store.getMemory(id));
      const summarySegments = (episode.summarySegments || []).filter(segment => !Array.isArray(segment.knownBy) || segment.knownBy.length || segment.auditRequired === true || segment.recoveryRequired === true);
      if (memoryIds.length === (episode.memoryIds || []).length && summarySegments.length === (episode.summarySegments || []).length) continue;
      this.store.saveEpisode({ ...episode, memoryIds, summarySegments });
      updated++;
    }
    return { updated };
  }

  forgetOwnerConversation(ownerId, counterpartId, summaryRecords = [], { invalidateConversations = [] } = {}) {
    const results = (summaryRecords || []).map((summaryRecord) => this.forgetSummaryProjection(summaryRecord, {
      ownerId,
      counterpartId,
      invalidateConversations: []
    }));
    this.invalidateSummaryFolderCache([ownerId]);
    for (const conversation of invalidateConversations) this.invalidateConversationRecallState(conversation);
    return {
      success: true,
      summaryCount: results.length,
      revokedMemoryCount: results.reduce((total, result) => total + result.revokedMemoryCount, 0),
      deletedMemoryCount: results.reduce((total, result) => total + result.deletedMemoryCount, 0)
    };
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
    for (const profile of [...(currentProfiles || []), ...(snapshot.participants || [])]) {
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
    if (!Array.isArray(rollingState.segments)) rollingState.segments = [];
    if (!Number.isInteger(rollingState.cacheEpoch)) rollingState.cacheEpoch = 0;
    if (rollingState.legacySummary == null) rollingState.legacySummary = rollingState.segments.length ? "" : String(rollingState.currentSummary || "");
    if (conversation.currentSummary && !rollingState.currentSummary) rollingState.currentSummary = conversation.currentSummary;
    if (Number(conversation.lastSummarizedMessageIndex) > rollingState.committedThroughHistoryIndex) {
      rollingState.committedThroughHistoryIndex = Number(conversation.lastSummarizedMessageIndex);
    }
    return rollingState;
  }

  async maybeCreateRollingCheckpoint({ conversation, history, contextLimit, percentage = 0.4, estimateMessageTokens, buildPrompt, requestSummary }) {
    const state = this.syncRollingStateFromConversationFields(conversation);
    const participantPresence = this.ensureConversationState(conversation).participantPresence;
    const result = await this.rolling.checkpoint({
      state,
      history,
      tokensToSummarize: Math.floor(contextLimit * percentage),
      estimateMessageTokens,
      buildPrompt,
      requestSummary,
      participantPresence: participantPresence.length ? participantPresence : null,
      minRecentRawMessages: 6
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
    const presenceBoundary = validateSummarySegmentPresenceBoundaries(context, extraction);
    reasons.push(...presenceBoundary.reasons);
    return { success: reasons.length === 0, reasons, sourceChars, messageCount, narrativeChars, presenceBoundaryFailures: presenceBoundary.failures };
  }

  recordSummaryQualityDiagnostics(context, quality) {
    for (const failure of quality?.presenceBoundaryFailures || []) {
      this.trace.record("summary_presence_boundary_failure", {
        conversationId: context.conversationId,
        finalizationId: context.finalizationId,
        reason: "summary_segment_crosses_presence_boundary",
        segmentId: failure.segmentId,
        segmentMessageIds: failure.segmentMessageIds,
        presenceSignatures: failure.presenceSignatures
      });
    }
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
    const boundaryCorrection = (quality.presenceBoundaryFailures || []).length > 0
      ? ` Affected segments: ${(quality.presenceBoundaryFailures || []).map((failure) => failure.segmentId || `summarySegments[${failure.index}]`).join(", ")} cross a participant-presence boundary. Split the narrative into separate chronological segments so every messageId in one segment belongs to the same participant-presence window. Keep all exact supporting messageIds in the appropriate split segments. Do not remove substantive detail, compress the narrative, or merge content across join, leave, temporary-leave, or return boundaries.`
      : "";
    const correction = {
      role: "system",
      content: `Final-summary quality correction: the previous response was rejected (${quality.reasons.join("; ")}). Regenerate the complete JSON from the supplied conversation. Put the full chronological narrative in summarySegments, preserve concrete details and exact source messageIds without inventing facts. Do not return a shortened overview.${boundaryCorrection}`
    };
    const sourcePrompt = Array.isArray(prompt) ? [...prompt] : [];
    const finalUser = sourcePrompt.at(-1)?.role === "user" ? sourcePrompt.pop() : null;
    sourcePrompt.push(correction);
    if (finalUser) sourcePrompt.push(finalUser);
    return sourcePrompt;
  }

  async resolveSummaryCapabilities(context) {
    const capabilities = typeof context.getSummaryCapabilities === "function"
      ? await context.getSummaryCapabilities(context.summaryProviderSnapshot || null)
      : context.summaryProviderSnapshot || { providerId: null, providerType: null, modelId: null, contextWindow: 8192, maxOutputTokens: 2048, source: "fallback" };
    context.summaryProviderSnapshot = {
      providerId: capabilities.providerId,
      providerType: capabilities.providerType,
      modelId: capabilities.modelId,
      contextWindow: capabilities.contextWindow,
      maxOutputTokens: capabilities.maxOutputTokens,
      capabilityRevision: capabilities.capabilityRevision || null
    };
    return { ...capabilities, maxOutputTokens: Math.min(capabilities.maxOutputTokens, Number(context.summaryOutputLimit) || capabilities.maxOutputTokens) };
  }

  async requestFinalSummary(context) {
    const capabilities = await this.resolveSummaryCapabilities(context);
    const prompt = context.buildPrompt(context);
    const budget = planSummaryRequest({ prompt, context, capabilities, countTokens: countSummaryTokens });
    if (!context.summaryChunk && (context.preferChunkedSummary || !budget.wholeRequestSafe)) {
      return this.requestChunkedSummary(context, capabilities);
    }
    if (context.summaryChunk && !budget.wholeRequestSafe) throw new Error("summary_chunk_budget_exceeded");
    let lastError = null;
    let retryQuality = null;
    for (let attempt = 1; attempt <= FINAL_SUMMARY_MAX_ATTEMPTS; attempt++) {
      const startedAt = Date.now();
      try {
        const requestPrompt = retryQuality ? this.buildSummaryQualityRetryPrompt(prompt, retryQuality) : prompt;
        const retryBudget = planSummaryRequest({ prompt: requestPrompt, context, capabilities, countTokens: countSummaryTokens });
        if (!retryBudget.safe) throw new Error("summary_request_budget_exceeded");
        const result = await context.requestSummary(requestPrompt, { attempt, maxTokens: retryBudget.reservedOutputTokens, providerSnapshot: context.summaryProviderSnapshot,
          summaryBudget: { requiredOutputTokens: retryBudget.requiredOutputTokens, sourceTokens: retryBudget.sourceTokens, wholeSafe: retryBudget.wholeRequestSafe, chunkIndex: context.summaryChunkIndex ?? null } });
        const outcome = validateGenerationOutcome(result);
        const content = outcome.content.trim();
        if (outcome.truncated) {
          lastError = new Error("truncated_final_summary_response");
        } else if (!outcome.complete) {
          lastError = new Error(`summary_generation_incomplete:${outcome.finishReason || "unknown"}`);
        } else if (content) {
          const parsed = this.extractor.parseOutput(content, context);
          const quality = this.evaluateFinalSummaryQuality(context, parsed);
          if (quality.success) {
            this.trace.record("summary_provider", { conversationId: context.conversationId, attempt, success: true, durationMs: Date.now() - startedAt });
            return content;
          }
          this.recordSummaryQualityDiagnostics(context, quality);
          retryQuality = quality;
          lastError = new Error(`final_summary_quality_failed:${quality.reasons.join("|")}`);
        } else {
          lastError = new Error("invalid_final_summary_response");
        }
      } catch (error) {
        lastError = error;
      }
      this.trace.record("summary_provider", { conversationId: context.conversationId, attempt, success: false, durationMs: Date.now() - startedAt, error: lastError?.message || "unknown" });
      const failureKind = classifySummaryFailure(lastError);
      if (["LENGTH", "CONTEXT_EXCEEDED", "FATAL"].includes(failureKind)) break;
      if (failureKind === "RATE_LIMIT" && attempt < FINAL_SUMMARY_MAX_ATTEMPTS) await new Promise((resolve) => setTimeout(resolve, 500));
    }
    if (!context.summaryChunk && context.messages?.length >= 2 && ["LENGTH", "CONTEXT_EXCEEDED"].includes(classifySummaryFailure(lastError))) {
      return this.requestChunkedSummary(context, capabilities);
    }
    throw lastError || new Error("invalid_final_summary_response");
  }

  getSummaryPresenceSignature(context, message) {
    if (!context.participantPresence?.length) return "all";
    const messageId = Number(message.id);
    return uniqueIds(context.participantPresence.filter((window) => Number(window.joinedAtMessageId ?? 0) <= messageId
      && (window.leftAtMessageId == null || messageId < Number(window.leftAtMessageId))).map((window) => window.characterId)).sort((a, b) => a - b).join(",");
  }

  partitionSummaryMessages(context, capabilities) {
    const maxSourceTokens = Math.max(512, Math.min(Math.floor(capabilities.maxOutputTokens * 1.4), Math.floor(capabilities.contextWindow * 0.3)));
    const chunks = [];
    let current = [];
    let currentTokens = 0;
    let currentSignature = null;
    for (const message of context.messages || []) {
      const signature = this.getSummaryPresenceSignature(context, message);
      const messageTokens = Math.max(1, countSummaryTokens([message]));
      if (current.length && (signature !== currentSignature || currentTokens + messageTokens > maxSourceTokens)) {
        chunks.push(current);
        current = [];
        currentTokens = 0;
      }
      current.push(message);
      currentTokens += messageTokens;
      currentSignature = signature;
    }
    if (current.length) chunks.push(current);
    if (chunks.length > SUMMARY_CHUNK_HARD_LIMIT) throw new Error("summary_chunk_hard_limit_exceeded");
    return chunks;
  }

  getChunkParticipants(context, messages) {
    if (!context.participantPresence?.length) return context.participants || [];
    const presentIds = new Set(messages.flatMap((message) => this.getSummaryPresenceSignature(context, message).split(",").map(Number).filter(Number.isFinite)));
    const text = messages.map((message) => `${message.name || ""} ${message.content || ""}`).join("\n");
    return (context.participants || []).filter((participant) => presentIds.has(Number(participant.id))
      || [participant.name, participant.fullName, participant.shortName].some((name) => name && text.includes(name)));
  }

  async requestChunkedSummary(context, capabilities) {
    const chunks = this.partitionSummaryMessages(context, capabilities);
    if (!chunks.length) throw new Error("summary_no_source_messages");
    if (chunks.length === 1 && chunks[0].length > 1) {
      const middle = Math.floor(chunks[0].length / 2);
      chunks.splice(0, 1, chunks[0].slice(0, middle), chunks[0].slice(middle));
    }
    const fingerprint = crypto.createHash("sha256").update(JSON.stringify({
      conversationId: context.conversationId,
      finalizationId: context.finalizationId,
      chunks: chunks.map((messages) => messages.map((message) => [message.id, message.content])),
      presence: context.participantPresence,
      participants: context.participants,
      provider: context.summaryProviderSnapshot,
      instructions: context.finalInstructions
    })).digest("hex");
    const saved = context.summaryChunkState?.fingerprint === fingerprint ? context.summaryChunkState.outputs || {} : {};
    const outputs = { ...saved };
    const boundaryKinds = new Set(["presence_join", "presence_leave", "presence_temporary_leave", "presence_temporary_return"]);
    let requestCount = 0;
    const summarize = async (messages) => {
      if (messages.every((message) => boundaryKinds.has(message.kind))) {
        return {
          summarySegments: messages.map((message) => ({ content: message.content, participants: this.getSummaryPresenceSignature(context, message).split(",").map(Number).filter(Number.isFinite), visibility: "participants", messageIds: [message.id], speakerIds: [] })),
          memories: []
        };
      }
      const participants = this.getChunkParticipants(context, messages);
      const participantIds = new Set(participants.map((participant) => Number(participant.id)));
      const firstId = Number(messages[0].id), lastId = Number(messages.at(-1).id);
      const participantPresence = (context.participantPresence || []).filter((window) => participantIds.has(Number(window.characterId))
        && Number(window.joinedAtMessageId ?? 0) <= lastId && (window.leftAtMessageId == null || Number(window.leftAtMessageId) > firstId));
      const chunk = { ...context, summaryChunk: true, summaryChunkIndex: requestCount + 1, rollingState: null, messages, participants, participantPresence };
      requestCount += 1;
      if (requestCount > SUMMARY_CHUNK_HARD_LIMIT) throw new Error("summary_chunk_hard_limit_exceeded");
      try {
        this.trace.record("summary_chunk", { conversationId: context.conversationId, reason: "preflight_or_failure", attempt: requestCount });
        const parsed = this.extractor.parseOutput(await this.requestFinalSummary(chunk), chunk);
        return {
          summarySegments: parsed.summarySegments.map((segment) => ({ ...segment, segmentId: null, messageIds: segment.provenance.messageIds, speakerIds: segment.provenance.speakerIds })),
          memories: parsed.memories.map((memory) => ({ ...memory, memoryId: null, messageIds: memory.provenance.messageIds, speakerIds: memory.provenance.speakerIds }))
        };
      } catch (error) {
        if (messages.length < 2 || !["LENGTH", "CONTEXT_EXCEEDED"].includes(classifySummaryFailure(error))) throw error;
        const middle = Math.floor(messages.length / 2);
        const left = await summarize(messages.slice(0, middle));
        const right = await summarize(messages.slice(middle));
        return { summarySegments: [...left.summarySegments, ...right.summarySegments], memories: [...left.memories, ...right.memories] };
      }
    };
    for (const [index, messages] of chunks.entries()) {
      if (outputs[index]) continue;
      outputs[index] = await summarize(messages);
      context.summaryChunkState = { fingerprint, outputs };
      if (context.finalizationId) this.writeRecoverySnapshot(context, { summaryChunkState: context.summaryChunkState });
    }
    const combined = {
      summarySegments: chunks.flatMap((_, index) => outputs[index].summarySegments),
      memories: chunks.flatMap((_, index) => outputs[index].memories)
    };
    const substantive = (context.messages || []).filter((message) => ["user", "assistant"].includes(message.role) && String(message.content || "").trim().length >= 8);
    const covered = new Set(combined.summarySegments.flatMap((segment) => segment.messageIds || []));
    const missing = substantive.filter((message) => !covered.has(message.id));
    if (missing.length >= 3 && missing.length / Math.max(1, substantive.length) > 0.2) {
      this.trace.record("summary_coverage_gap", { conversationId: context.conversationId, sourceMessageCount: substantive.length, uncoveredMessageIds: missing.map((message) => message.id) });
      const repairContext = { ...context, messages: missing };
      for (const repairMessages of this.partitionSummaryMessages(repairContext, capabilities)) {
        const repair = await summarize(repairMessages);
        combined.summarySegments.push(...repair.summarySegments);
        combined.memories.push(...repair.memories);
      }
      const repaired = new Set(combined.summarySegments.flatMap((segment) => segment.messageIds || []));
      if (missing.some((message) => !repaired.has(message.id))) throw new Error("summary_coverage_repair_failed");
    }
    combined.summarySegments.sort((left, right) => (left.messageIds?.[0] ?? Infinity) - (right.messageIds?.[0] ?? Infinity));
    const memoryKeys = new Set();
    combined.memories = combined.memories.filter((memory) => {
      const key = JSON.stringify([memory.type, memory.canonicalText || memory.content, memory.messageIds]);
      if (memoryKeys.has(key)) return false;
      memoryKeys.add(key);
      return true;
    });
    const content = JSON.stringify(combined);
    const quality = this.evaluateFinalSummaryQuality(context, this.extractor.parseOutput(content, context));
    if (!quality.success) throw new Error(`final_summary_quality_failed:${quality.reasons.join("|")}`);
    return content;
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
      memoryGeneration: Number.isFinite(Number(context.memoryGeneration)) ? Number(context.memoryGeneration) : this.memoryGeneration,
      finalizationId,
      summaryRequestId: context.summaryRequestId || finalizationId,
      episodeId: context.episodeId || `episode_${context.conversationId}_${finalizationId}`
    };
  }

  isFinalizationCurrent(context) {
    return Number(context?.memoryGeneration) === this.memoryGeneration;
  }

  cancelledFinalizationResult(context) {
    const error = new Error("memory_cleared_during_finalization");
    this.traceFinalization(context, "cancelled", { errorCode: error.message, recoveryState: "cleared" });
    return { success: false, cancelled: true, error, recoveryPath: null };
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
    if (!this.isFinalizationCurrent(context)) return this.cancelledFinalizationResult(context);
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
        await this.resolveSummaryCapabilities(context);
        this.writeRecoverySnapshot(context, { summaryProviderSnapshot: context.summaryProviderSnapshot });
        content = await this.requestFinalSummary(context);
        if (!this.isFinalizationCurrent(context)) return this.cancelledFinalizationResult(context);
      } catch (error) {
        if (!this.isFinalizationCurrent(context)) return this.cancelledFinalizationResult(context);
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
        if (!this.isFinalizationCurrent(context)) return this.cancelledFinalizationResult(context);
        extraction = this.assignStableMemoryIds(context, this.extractor.parseOutput(content, context));
        quality = this.evaluateFinalSummaryQuality(context, extraction);
      }
      this.recordSummaryQualityDiagnostics(context, quality);
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
      if (!this.isFinalizationCurrent(context)) return this.cancelledFinalizationResult(context);
      const failedPath = this.writeRecoverySnapshot(context, { finalizationStage: "parse", finalizationStatus: "pending", providerOutput: content }, error);
      this.traceFinalization(context, "parse", { providerSuccess: true, recoveryState: "pending", errorCode: error.message });
      return { success: false, error, recoveryPath: failedPath };
    }
    const persistStartedAt = Date.now();
    try {
      if (!this.isFinalizationCurrent(context)) return this.cancelledFinalizationResult(context);
      const persisted = this.persistExtraction(context, extraction);
      const directedSummaries = buildPerspectiveSummaryMap(context, extraction);
      const projectionValidation = validatePerspectiveSummaryMap(context, extraction, directedSummaries);
      if (!projectionValidation.success) {
        throw new Error(`${projectionValidation.error}:${projectionValidation.invalidPairs.map((pair) => `${pair.ownerId}->${pair.counterpartId}:${pair.reason}`).join(",")}`);
      }
      const coverage = validatePerspectiveCoverage(context, extraction, directedSummaries);
      if (!coverage.success) {
        for (const failure of coverage.invalidPairs) {
          const details = {
            conversationId: context.conversationId,
            finalizationId: context.finalizationId,
            characterId: failure.ownerId,
            participantId: failure.ownerId,
            counterpartId: failure.counterpartId,
            reason: failure.reason,
            visibleDialogueMessageCount: failure.visibleDialogueMessageCount,
            visibleDialogueChars: failure.visibleDialogueChars,
            visibleSpeakerTurns: failure.visibleSpeakerTurns,
            projectionSegmentCount: failure.projectionSegmentCount,
            projectionMemoryCount: failure.projectionMemoryCount
          };
          this.trace.record("projection_narrative_coverage_missing", details);
          if (failure.projectionMemoryCount > 0) this.trace.record("projection_memory_only_fallback", details);
        }
        throw new Error(`projection_narrative_coverage_missing:${coverage.invalidPairs.map((pair) => `${pair.ownerId}->${pair.counterpartId}`).join(",")}`);
      }
      const folderPersistence = await this.persistCharacterFolders(context, extraction.sessionSummary || content, directedSummaries);
      if (!this.isFinalizationCurrent(context)) return this.cancelledFinalizationResult(context);
      this.commitFinalization(context, extraction);
      this.trace.record("summary_persist", { conversationId: context.conversationId, finalizationId: context.finalizationId, success: true, durationMs: Date.now() - persistStartedAt, memoryCount: extraction.memories.length });
      if (snapshotPath && fs.existsSync(snapshotPath)) fs.unlinkSync(snapshotPath);
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
      if (!this.isFinalizationCurrent(context)) return this.cancelledFinalizationResult(context);
      this.trace.record("summary_persist", { conversationId: context.conversationId, finalizationId: context.finalizationId, success: false, durationMs: Date.now() - persistStartedAt, memoryCount: extraction.memories.length, error: error.message || String(error) });
      const needsSummaryRegeneration = String(error?.message || error).startsWith("projection_narrative_coverage_missing:");
      const failedPath = this.writeRecoverySnapshot(context, {
        finalizationStage: needsSummaryRegeneration ? "request" : "persist",
        finalizationStatus: "pending",
        providerOutput: needsSummaryRegeneration ? null : content,
        parsedExtraction: needsSummaryRegeneration ? null : this.serializeExtraction(extraction)
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
    if (!this.isFinalizationCurrent(context)) return null;
    const safeId = String(context.conversationId || createMemoryId("conversation")).replace(/[^a-zA-Z0-9_-]/g, "_");
    const filePath = path.join(this.store.paths.recovery, `conversation_${safeId}.json`);
    const existing = this.store.readJson(filePath, {});
    const lastError = error instanceof Error ? error.message : error ? String(error) : state.lastError || existing.lastError || null;
    const providerOutput = Object.prototype.hasOwnProperty.call(state, "providerOutput") ? state.providerOutput : existing.providerOutput ?? null;
    const parsedExtraction = Object.prototype.hasOwnProperty.call(state, "parsedExtraction") ? state.parsedExtraction : existing.parsedExtraction ?? null;
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
      finalInstructions: context.finalInstructions || existing.finalInstructions || "",
      summaryOutputLimit: context.summaryOutputLimit || existing.summaryOutputLimit || null,
      rawMessages: context.messages || [],
      summaryProviderSnapshot: context.summaryProviderSnapshot || existing.summaryProviderSnapshot || null,
      summaryChunkState: state.summaryChunkState || context.summaryChunkState || existing.summaryChunkState || null,
      finalizationStage: state.finalizationStage || existing.finalizationStage || "request",
      finalizationStatus: state.finalizationStatus || existing.finalizationStatus || "pending",
      providerOutput,
      parsedExtraction,
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

  async recoverFailedFinalization(filePath, { requestSummary, buildPrompt, persistCharacterFolders, resolveParticipantProfiles, getSummaryCapabilities, automatic = false } = {}) {
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
      finalInstructions: snapshot.finalInstructions || "",
      summaryOutputLimit: snapshot.summaryOutputLimit || 4096,
      summaryProviderSnapshot: snapshot.summaryProviderSnapshot || null,
      summaryChunkState: snapshot.summaryChunkState || null,
      getSummaryCapabilities,
      retryCount: Number(snapshot.retryCount || 0) + 1,
      preferChunkedSummary: /^(truncated_final_summary_response|final_summary_quality_failed:)/.test(snapshot.lastError || ""),
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
    if (result.cancelled) return result;
    const retryCount = context.retryCount;
    this.writeRecoverySnapshot(context, {
      finalizationStage: this.store.readJson(filePath, snapshot)?.finalizationStage || snapshot.finalizationStage || "request",
      finalizationStatus: automatic && retryCount >= RECOVERY_MAX_ATTEMPTS ? "failed_manual" : "failed_retryable",
      retryCount,
      lastTriedAt: new Date().toISOString()
    }, result.error);
    return { ...result, recoveryPath: filePath };
  }

  async recoverPendingFinalizations(options = {}) {
    if (this.pendingRecovery) return this.pendingRecovery;
    this.pendingRecovery = this.runPendingFinalizations(options);
    try { return await this.pendingRecovery; }
    finally { this.pendingRecovery = null; }
  }

  async runPendingFinalizations({ requestSummary, buildPrompt, persistCharacterFolders, resolveParticipantProfiles, getSummaryCapabilities, manual = false, isConversationActive = () => false } = {}) {
    const results = [];
    const generation = this.memoryGeneration;
    for (const filePath of this.listRecoverySnapshots()) {
      if (generation !== this.memoryGeneration) break;
      let snapshot = this.store.readJson(filePath, null);
      if (!snapshot) continue;
      if (isConversationActive(snapshot.conversationId)) continue;
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
      if (!manual && Number(snapshot.retryCount || 0) >= RECOVERY_MAX_ATTEMPTS) {
        if (snapshot.finalizationStatus !== "failed_manual") this.writeRecoverySnapshot(this.prepareFinalizationContext({ ...snapshot, messages: snapshot.rawMessages }), { finalizationStatus: "failed_manual", retryCount: snapshot.retryCount });
        continue;
      }
      results.push(await this.recoverFailedFinalization(filePath, { requestSummary, buildPrompt, persistCharacterFolders, resolveParticipantProfiles, getSummaryCapabilities, automatic: !manual }));
    }
    return results;
  }

  getRouteMemoryKey(memory) {
    if (memory.type === "folder_summary") return memory.memoryId;
    const finalizationId = memory.provenance?.finalizationId;
    return finalizationId ? `${memory.provenance?.folderOwnerId ?? "internal"}|${finalizationId}` : memory.memoryId;
  }

  getMemoryRecency(memory) {
    const totalDays = Number(memory.totalDays);
    if (Number.isFinite(totalDays) && totalDays > 0) return totalDays;
    return normalizeGameDate(memory.eventDate)?.serial || 0;
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
      const routed = { ...fitted, routeKind: mode === "direct_legacy" ? "direct" : mode, routeCharacterIds: [Number(routeCharacterId)] };
      selected.push(routed);
      selectedByKey.set(key, routed);
      usedTokens += fitted.tokens;
      return { added: true, merged: false };
    };

    const recentByRoute = new Map(groups.map(([routeId, entries]) => [routeId, [...entries].sort((left, right) => this.getMemoryRecency(right.memory) - this.getMemoryRecency(left.memory))]));
    const baselineRounds = mode === "direct_legacy" ? 3 : mode === "direct" ? 2 : 1;
    const recentKeys = new Set([...recentByRoute.values()].flatMap(entries => entries.slice(0, baselineRounds).map(entry => this.getRouteMemoryKey(entry.memory))));
    const pinnedPool = mode === "direct_legacy" ? groups.flatMap(([routeId, entries]) => entries.map(entry => ({ routeId, entry })))
      .filter(({ entry }) => !recentKeys.has(this.getRouteMemoryKey(entry.memory)) && (entry.memory.importance >= 0.9 || entry.memory.status === "open" || entry.memory.unresolved))
      .sort((left, right) => right.entry.score - left.entry.score) : [];
    const extraLimit = mode === "direct_legacy" ? groups.length === 1 ? 1 : 2 : 0;
    const baselineAllowance = Math.max(1, Math.floor(tokenBudget / Math.max(1, recentKeys.size + Math.min(extraLimit, pinnedPool.length))));
    for (let round = 0; round < baselineRounds; round++) {
      for (const [routeId] of groups) add(recentByRoute.get(routeId)?.[round], routeId, baselineAllowance);
    }

    if (mode === "direct_legacy") {
      let added = 0;
      for (const candidate of pinnedPool) {
        if (added >= extraLimit || usedTokens >= tokenBudget) break;
        if (add(candidate.entry, candidate.routeId).added) added++;
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

  retrieveForResponder({ characterId, query = "", directCounterpartIds = [], mentionedEntityIds = [], mentionedEntityNames = {}, mentionedRecallCache = null, sessionRecallCache = null, ownerFolderMemories = null, currentGameDate = null, currentTotalDays = null, memoryEngine3Enabled = true, temporalSummaryRecallEnabled = true, tokenBudget = 800, estimateTokens } = {}) {
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
    const frozenBudget = memoryEngine3Enabled ? Math.floor(budget * 0.65) : budget;
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
      : this.selectRoutedMemories(directGroups, { tokenBudget: directBudget, estimateTokens, mode: memoryEngine3Enabled ? "direct" : "direct_legacy" });
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
    const extraBudget = Math.max(0, budget - frozenSelectedTokens);
    const temporal = memoryEngine3Enabled && temporalSummaryRecallEnabled ? resolveTemporalWindow(query, { currentGameDate, currentTotalDays }) : { triggered: false, reason: "DISABLED" };
    const directMemories = [...directGroups.values()].flat().map((entry) => entry.memory);
    const temporalCandidates = temporal.triggered ? selectTemporalExtras(
      directIds.flatMap((counterpartId) => this.store.getSummaryDateIndexForPair(ownerId, counterpartId, { currentGameDate, currentTotalDays, ownerFolderMemories: folderMemories })),
      directMemories, temporal, selectedFolderKeys, 3
    ) : [];
    const rankedExtras = this.ranker.rank(folderMemories, { query, entityIds: mentionedIds, participantIds: directIds, currentTotalDays });
    const topicCandidates = query.trim() ? rankedExtras.filter((entry) => Number(entry.reason?.query) >= 0.28).map((entry) => entry.memory) : [];
    const routedKeys = new Set([...directGroups.values(), ...mentionedGroups.values()].flat().map((entry) => this.getRouteMemoryKey(entry.memory)));
    const importantCandidates = rankedExtras.filter((entry) => routedKeys.has(this.getRouteMemoryKey(entry.memory)) && (entry.memory.importance >= 0.9 || entry.memory.status === "open" || entry.memory.unresolved || entry.memory.content?.includes("【需要长期记住的事项】"))).map((entry) => entry.memory);
    const extra = [];
    let extraTokens = 0;
    for (const [source, candidates] of memoryEngine3Enabled ? [["temporal", temporalCandidates], ["topic", topicCandidates], ["important", importantCandidates]] : []) {
      for (const memory of candidates) {
        if (extra.length >= 3 || extraTokens >= extraBudget) break;
        const key = this.getRouteMemoryKey(memory);
        if (selectedFolderKeys.has(key)) continue;
        const [fitted] = this.ranker.selectWithinBudget([{ memory, score: 0, reason: { source } }], {
          tokenBudget: extraBudget - extraTokens, estimateTokens, allowTruncate: true
        });
        if (!fitted) continue;
        extra.push({ ...fitted, routeKind: "dynamic_extra", routeCharacterIds: directIds });
        extraTokens += fitted.tokens;
        selectedFolderKeys.add(key);
      }
    }
    let topicPatch = memoryEngine3Enabled ? [] : Array.isArray(responderCache.topicPatch) ? responderCache.topicPatch : [];
    if (!memoryEngine3Enabled && !responderCache.topicPatchLocked && query.trim()) {
      const rankedPatch = this.ranker.rank(folderMemories, { query, entityIds: mentionedIds, participantIds: directIds, currentTotalDays })
        .filter((entry) => !selectedFolderKeys.has(this.getRouteMemoryKey(entry.memory)) && Number(entry.reason?.query) >= 0.28);
      topicPatch = this.ranker.selectWithinBudget(rankedPatch.slice(0, 1), { tokenBudget: Math.max(0, Math.min(Math.floor(budget * 0.12), budget - frozenSelectedTokens)), estimateTokens, allowTruncate: true })
        .map((entry) => ({ ...entry, routeKind: "session_topic_anchor", routeCharacterIds: uniqueIds([...directIds, ...mentionedIds]) }));
      if (topicPatch.length) { responderCache.topicPatch = topicPatch; responderCache.topicPatchLocked = true; }
    }
    if (sessionRecallCache instanceof Map) sessionRecallCache.set(ownerId, responderCache);
    const relevant = [...direct, ...deduplicatedMentioned, ...extra, ...topicPatch];
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
      patchInserted: extra.length > 0,
      temporalTriggered: temporal.triggered,
      temporalExtraCount: extra.filter((entry) => entry.reason?.source === "temporal").length,
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
      extra,
      temporal,
      temporalExtraText: this.formatMemoryBlock("动态时间与话题摘要（最多三篇）", extra),
      stableText: this.formatMemoryBlock("长期稳定记忆", stable),
      directText: this.formatMemoryBlock("与当前在场人物的直接记忆", direct),
      directStableText: this.formatMemoryBlock("冻结的直接关系最近两篇摘要", direct),
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
        topicPatch: memoryEngine3Enabled ? extra.length > 0 ? "dynamic_extra" : "empty" : topicPatch.length > 0 ? "locked" : "empty",
        budgets: { direct: directBudget, mentioned: mentionedBudget, stable: stableBudget, extra: extraBudget }
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

  retrieveThirdPartyEvidence({ characterId, query = "", mentionedEntityIds = [], mentionedEntityNames = {}, ownerFolderMemories = null, currentTotalDays = null, tokenBudget = 512, estimateTokens } = {}) {
    const ownerId = Number(characterId);
    const memories = Array.isArray(ownerFolderMemories) ? ownerFolderMemories : this.store.loadFolderSummariesForCharacter(ownerId);
    const entities = uniqueIds(mentionedEntityIds).map((entityId) => {
      const aliases = Array.isArray(mentionedEntityNames) ? mentionedEntityNames : mentionedEntityNames?.[entityId] || mentionedEntityNames?.[String(entityId)] || [];
      return {
        id: entityId,
        aliases,
        memories: this.store.searchOwnerFolderForEntity(ownerId, entityId, aliases, memories)
      };
    });
    const result = buildThirdPartyEvidencePatch({ query, entities, currentTotalDays, tokenBudget, estimateTokens });
    this.trace.record("third_party_evidence", { characterId: ownerId, reason: result.reason, entityCount: result.entities.length, selectedCount: result.candidateCount, tokens: result.tokens, conflict: result.conflict });
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
        "直接参与者按自己的目录精确召回最近 3 条；预算内补充钉住记忆，超长摘要优先保留长期事项。",
        "首次提到场外人物时，每名 NPC 分别从自己的目录建立记忆快照；Session Topic Anchor 首次命中后整场冻结。",
        "明确回忆问题可在当前用户消息之后追加 Top1 Turn Recall；默认 256 token、硬上限 320 token，同回合查询复用缓存。",
        "终局摘要按每名目录所有者的知情边界生成视角投影；不知情角色不会获得他人的私密内容。",
        "同一场群聊仅合并正文相同的关系副本，保留不同知情投影；内容长度由每次 800–2400 token 的动态预算约束。"
      ],
      routingPolicy: {
        stablePrefix: "同一场对话每轮保持一致；新会话重新读取",
        directPair: "直接关系：最近 3 条 + 预算内钉住记忆，整场冻结",
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
