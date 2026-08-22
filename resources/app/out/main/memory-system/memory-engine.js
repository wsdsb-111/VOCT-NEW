"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { MEMORY_TYPES, VISIBILITIES, createMemoryId, createMemoryRecord, uniqueIds } = require("./memory-types");
const { MemoryStore } = require("./memory-store");
const { MemoryExtractor } = require("./memory-extractor");
const { MemoryRanker } = require("./memory-ranker");
const { KnowledgeService } = require("./knowledge-service");
const { RollingSummaryManager } = require("./rolling-summary-manager");
const { MemoryConsolidator } = require("./memory-consolidator");
const { MemoryTrace } = require("./memory-trace");

const FINAL_SUMMARY_MAX_ATTEMPTS = 2;
const RECOVERY_MAX_ATTEMPTS = 3;

class MemoryEngine {
  constructor({ baseDir, legacySummariesDir = null, recoveryDir = null, store = null, trace = null } = {}) {
    this.trace = trace || new MemoryTrace();
    this.store = store || new MemoryStore({ baseDir, legacySummariesDir, recoveryDir });
    this.extractor = new MemoryExtractor();
    this.ranker = new MemoryRanker();
    this.knowledge = new KnowledgeService({ store: this.store, trace: this.trace });
    this.rolling = new RollingSummaryManager({ trace: this.trace });
    this.consolidator = new MemoryConsolidator({ store: this.store, trace: this.trace });
  }

  createConversationState(conversationId) {
    return { conversationId, rollingState: this.rolling.createState(), participantPresence: [] };
  }

  ensureConversationState(conversation) {
    if (!conversation.memoryState) conversation.memoryState = this.createConversationState(conversation.id);
    if (!conversation.memoryState.rollingState) conversation.memoryState.rollingState = this.rolling.createState();
    if (!Array.isArray(conversation.memoryState.participantPresence)) conversation.memoryState.participantPresence = [];
    return conversation.memoryState;
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

  syncLegacyRollingFields(conversation) {
    const rollingState = this.ensureConversationState(conversation).rollingState;
    conversation.currentSummary = rollingState.currentSummary;
    conversation.lastSummarizedMessageIndex = rollingState.committedThroughHistoryIndex;
  }

  syncRollingStateFromLegacyFields(conversation) {
    const rollingState = this.ensureConversationState(conversation).rollingState;
    if (conversation.currentSummary && !rollingState.currentSummary) rollingState.currentSummary = conversation.currentSummary;
    if (Number(conversation.lastSummarizedMessageIndex) > rollingState.committedThroughHistoryIndex) {
      rollingState.committedThroughHistoryIndex = Number(conversation.lastSummarizedMessageIndex);
    }
    return rollingState;
  }

  async maybeCreateRollingCheckpoint({ conversation, history, contextLimit, percentage = 0.4, estimateMessageTokens, buildPrompt, requestSummary }) {
    const state = this.syncRollingStateFromLegacyFields(conversation);
    const result = await this.rolling.checkpoint({
      state,
      history,
      tokensToSummarize: Math.floor(contextLimit * percentage),
      estimateMessageTokens,
      buildPrompt,
      requestSummary
    });
    this.syncLegacyRollingFields(conversation);
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
      participantPresence: context.participantPresence || [],
      sessionSummary: extraction.sessionSummary,
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

  async requestFinalSummary(context) {
    const prompt = context.buildPrompt(context);
    let lastError = null;
    for (let attempt = 1; attempt <= FINAL_SUMMARY_MAX_ATTEMPTS; attempt++) {
      try {
        const result = await context.requestSummary(prompt);
        const content = typeof result?.content === "string" ? result.content.trim() : "";
        if (content) return content;
        lastError = new Error("invalid_final_summary_response");
      } catch (error) {
        lastError = error;
      }
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
      memories: (extraction.memories || []).map((memory) => ({ ...memory }))
    };
  }

  restoreExtraction(serialized) {
    if (!serialized || !Array.isArray(serialized.memories)) return null;
    return {
      structured: serialized.structured === true,
      sessionSummary: String(serialized.sessionSummary || ""),
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
      legacySummarySaved: details.legacySummarySaved === true,
      recoveryState: details.recoveryState || null,
      errorCode: details.errorCode || null
    });
  }

  async persistLegacySummary(context, finalSummary) {
    if (typeof context.persistLegacySummary !== "function") return { saved: false, skipped: true };
    const result = await context.persistLegacySummary(finalSummary, context);
    if (result === false || result?.success === false) throw new Error(result?.error || "legacy_summary_persist_failed");
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
    if (!content) {
      try {
        content = await this.requestFinalSummary(context);
      } catch (error) {
        const snapshotPath = this.writeRecoverySnapshot(context, { finalizationStage: "request", finalizationStatus: "pending", providerOutput: null }, error);
        this.traceFinalization(context, "request", { recoveryState: "pending", errorCode: error.message });
        return { success: false, error, recoveryPath: snapshotPath };
      }
    }
    const snapshotPath = recoveryPath || this.writeRecoverySnapshot(context, {
      finalizationStage: "parse",
      finalizationStatus: "pending",
      providerOutput: content
    });
    this.traceFinalization(context, "provider_received", { providerSuccess: true, recoveryState: "pending" });
    let extraction = this.restoreExtraction(parsedExtraction);
    try {
      if (!extraction) extraction = this.assignStableMemoryIds(context, this.extractor.parseOutput(content, context));
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
    try {
      const persisted = this.persistExtraction(context, extraction);
      const legacy = await this.persistLegacySummary(context, extraction.sessionSummary || content);
      this.commitFinalization(context, extraction);
      if (fs.existsSync(snapshotPath)) fs.unlinkSync(snapshotPath);
      this.traceFinalization(context, "committed", {
        providerSuccess: true,
        parseMode: extraction.structured ? "structured" : "prose_fallback",
        memoryCount: extraction.memories.length,
        episodeSaved: !!persisted.episode,
        knowledgeSaved: true,
        legacySummarySaved: legacy.saved === true,
        recoveryState: "committed"
      });
      return { success: true, finalSummary: extraction.sessionSummary || content, extraction };
    } catch (error) {
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
    return this.finalizeWithAvailableOutput(this.prepareFinalizationContext(context));
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
      participantPresence: context.participantPresence || [],
      rollingState: context.rollingState || this.rolling.createState(),
      rawMessages: context.messages || [],
      finalizationStage: state.finalizationStage || existing.finalizationStage || "request",
      finalizationStatus: state.finalizationStatus || existing.finalizationStatus || "pending",
      providerOutput: state.providerOutput ?? existing.providerOutput ?? null,
      parsedExtraction: state.parsedExtraction ?? existing.parsedExtraction ?? null,
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

  async recoverFailedFinalization(filePath, { requestSummary, buildPrompt, persistLegacySummary, automatic = false } = {}) {
    const snapshot = this.store.readJson(filePath, null);
    if (!snapshot) return { success: false, reason: "invalid_recovery_snapshot" };
    const context = this.prepareFinalizationContext({
      conversationId: snapshot.conversationId,
      finalizationId: snapshot.finalizationId,
      summaryRequestId: snapshot.summaryRequestId,
      date: snapshot.date,
      totalDays: snapshot.totalDays,
      participants: snapshot.participants,
      participantPresence: snapshot.participantPresence,
      messages: snapshot.rawMessages,
      rollingState: snapshot.rollingState,
      retryCount: Number(snapshot.retryCount || 0) + 1,
      requestSummary,
      buildPrompt,
      persistLegacySummary
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

  async recoverPendingFinalizations({ requestSummary, buildPrompt, persistLegacySummary } = {}) {
    const results = [];
    for (const filePath of this.listRecoverySnapshots()) {
      const snapshot = this.store.readJson(filePath, null);
      if (!snapshot) continue;
      if (Number(snapshot.retryCount || 0) >= RECOVERY_MAX_ATTEMPTS) {
        if (snapshot.finalizationStatus !== "failed_manual") this.writeRecoverySnapshot(this.prepareFinalizationContext(snapshot), { finalizationStatus: "failed_manual", retryCount: snapshot.retryCount });
        continue;
      }
      results.push(await this.recoverFailedFinalization(filePath, { requestSummary, buildPrompt, persistLegacySummary, automatic: true }));
    }
    return results;
  }

  retrieveForCharacter({ characterId, query = "", entityIds = [], participantIds = [], currentTotalDays = null, tokenBudget = 800, estimateTokens } = {}) {
    const memories = this.store.queryMemories({ characterId, includeLegacy: true });
    const ranked = this.ranker.rank(memories, { query, entityIds, participantIds, currentTotalDays });
    for (const entry of ranked.slice(0, 20)) {
      this.trace.record("rank", { memoryId: entry.memory.memoryId, type: entry.memory.type, score: entry.score, characterId, reason: "hybrid_local_score" });
    }
    const stableCandidates = ranked.filter((entry) => entry.memory.importance >= 0.9 || entry.memory.status === "open" || entry.memory.unresolved);
    const stable = this.ranker.selectWithinBudget(stableCandidates, { tokenBudget: Math.floor(tokenBudget * 0.3), estimateTokens });
    const stableIds = new Set(stable.map((entry) => entry.memory.memoryId));
    const relevant = this.ranker.selectWithinBudget(ranked.filter((entry) => !stableIds.has(entry.memory.memoryId)), { tokenBudget: Math.floor(tokenBudget * 0.5), estimateTokens });
    for (const entry of [...stable, ...relevant]) {
      this.trace.record("retrieve", { memoryId: entry.memory.memoryId, type: entry.memory.type, score: entry.score, characterId, reason: "ranked_in_budget" });
      this.trace.record("inject", { memoryId: entry.memory.memoryId, type: entry.memory.type, score: entry.score, characterId, reason: stableIds.has(entry.memory.memoryId) ? "stable_memory" : "query_relevant" });
    }
    return {
      stable,
      relevant,
      stableText: this.formatMemoryBlock("长期稳定记忆", stable),
      relevantText: this.formatMemoryBlock("与当前话题相关的记忆", relevant),
      tokenBudget
    };
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
    const memory = this.store.updateMemory(memoryId, next);
    this.store.removeKnowledgeForMemory(memoryId, memory.knownBy);
    for (const characterId of memory.knownBy) {
      this.store.markKnownBy(characterId, memory.memoryId, { awareness: "edited", acquiredAt: memory.totalDays, confidence: memory.confidence });
    }
    for (const characterId of uniqueIds([...existing.participants, ...existing.subjects, ...memory.participants, ...memory.subjects])) {
      this.consolidator.consolidateCharacter(characterId);
    }
    this.trace.record("memory_update", { memoryId, advanced, changedFields: Object.keys(next) });
    return { success: true, memory };
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
    const memories = this.store.listAllMemories();
    const episodes = this.store.listAllEpisodes();
    const characterIds = new Set(this.store.listKnowledgeCharacterIds());
    const namesById = new Map();
    const rememberName = (idValue, name, replace = false) => {
      const id = Number(idValue);
      if (!Number.isFinite(id)) return;
      characterIds.add(id);
      if (name && (replace || !namesById.has(id))) namesById.set(id, String(name));
    };
    for (const episode of episodes) {
      for (const participant of episode.participants || []) rememberName(participant?.id, participant?.name || participant?.fullName);
    }
    for (const memory of memories) {
      for (const id of [...memory.participants, ...memory.subjects, ...memory.knownBy]) rememberName(id, null);
    }
    for (const metadata of summaryCatalog) {
      rememberName(metadata.ownerId, metadata.ownerName);
    }
    for (const metadata of summaryCatalog) {
      rememberName(metadata.counterpartId, metadata.counterpartName);
      for (const participant of metadata.participantProfiles || []) rememberName(participant.id, participant.name);
    }
    for (const metadata of summaryCatalog) rememberName(metadata.ownerId, metadata.ownerName, true);
    const characters = [...characterIds].sort((left, right) => left - right).map((characterId) => {
      const accessible = this.store.queryMemories({ characterId, includeLegacy: false });
      const accessibleIds = new Set(accessible.map((memory) => memory.memoryId));
      const ownedFiles = summaryCatalog.filter((metadata) => Number(metadata.ownerId) === characterId);
      const legacyAdaptedCount = ownedFiles.reduce((total, metadata) => total + (metadata.summaries || []).filter((summary) => typeof summary?.content === "string").length, 0);
      const characterName = namesById.get(characterId) || ownedFiles[0]?.ownerName || `角色 ${characterId}`;
      const normalizedName = String(characterName).toLocaleLowerCase();
      const relatedFiles = summaryCatalog.filter((metadata) => {
        if (Number(metadata.ownerId) === characterId) return false;
        return Number(metadata.counterpartId) === characterId || (metadata.participantIds || []).some((id) => Number(id) === characterId) || (metadata.participantNames || []).some((name) => String(name).toLocaleLowerCase() === normalizedName);
      });
      const typeCounts = {};
      for (const memory of accessible) typeCounts[memory.type] = (typeCounts[memory.type] || 0) + 1;
      return {
        characterId,
        characterName,
        structuredAccessibleCount: accessible.length,
        structuredRestrictedCount: memories.filter((memory) => !accessibleIds.has(memory.memoryId)).length,
        legacyAdaptedCount,
        ownedSummaryFolderCount: new Set(ownedFiles.map((metadata) => metadata.folderName)).size,
        ownedSummaryFileCount: ownedFiles.length,
        ownedSummaryRecordCount: ownedFiles.reduce((total, metadata) => total + (metadata.summaries?.length || 0), 0),
        relatedSummaryFileCount: relatedFiles.length,
        relatedSummaryRecordCount: relatedFiles.reduce((total, metadata) => total + (metadata.summaries?.length || 0), 0),
        typeCounts,
        accessibleMemories: accessible.map((memory) => ({
          memoryId: memory.memoryId,
          type: memory.type,
          subtype: memory.subtype,
          eventDate: memory.eventDate,
          content: memory.content,
          importance: memory.importance,
          confidence: memory.confidence,
          unresolved: memory.unresolved,
          tags: memory.tags,
          status: memory.status,
          visibility: memory.visibility,
          participants: memory.participants,
          subjects: memory.subjects,
          knownBy: memory.knownBy
        }))
      };
    });
    return {
      engineVersion: "2.0",
      totals: {
        structuredMemories: memories.length,
        episodes: episodes.length,
        knowledgeCharacters: this.store.listKnowledgeCharacterIds().length,
        summaryFolders: new Set(summaryCatalog.map((metadata) => metadata.folderName)).size,
        summaryFiles: summaryCatalog.length,
        summaryRecords: summaryCatalog.reduce((total, metadata) => total + (metadata.summaries?.length || 0), 0)
      },
      boundaries: [
        "角色只能读取 knowledge 索引中自己已知的结构化记忆；公开/世界记忆对所有角色可见。",
        "旧摘要按回应角色自己的 ID_姓名目录惰性适配，不会回退读取玩家或其他角色的私人目录。",
        "当前话题提到第三者时，只在回应角色可访问的记忆范围内按人物、参与者与语义排序。",
        "每次注入使用动态令牌预算：长期稳定记忆约 30%，当前话题相关记忆约 50%。"
      ],
      characters
    };
  }

  formatMemoryBlock(title, entries) {
    if (!entries || entries.length === 0) return null;
    return `${title}（仅包含当前回应角色应当知道的内容）：\n${entries.map((entry) => `- [${entry.memory.type}/${entry.memory.epistemicStatus}] ${entry.memory.eventDate || "日期不详"}：${entry.memory.content}`).join("\n")}`;
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

  recordLeavingMemory({ characterId, participantIds, content, conversationId, date = null, totalDays = null }) {
    const memory = this.store.saveMemory(createMemoryRecord({
      type: "event", subtype: "participant_leaving_summary", eventDate: date, totalDays,
      participants: participantIds, subjects: [characterId], content,
      importance: 0.5, confidence: 0.75, source: "inferred", visibility: "participants",
      knownBy: participantIds, provenance: { conversationId, extractionMode: "leaving_summary", messageIds: [], speakerIds: [] }
    }));
    this.knowledge.markKnownBy(memory.memoryId, participantIds, { awareness: "witnessed", acquiredAt: totalDays });
    return memory;
  }
}

module.exports = { MemoryEngine };
