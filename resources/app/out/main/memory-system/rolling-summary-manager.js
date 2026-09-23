"use strict";

const { validateGenerationOutcome } = require("../providers/generation-outcome");

class RollingSummaryManager {
  constructor({ trace = null } = {}) {
    this.trace = trace;
  }

  createState(initial = {}) {
    return {
      committedThroughMessageId: initial.committedThroughMessageId ?? null,
      committedThroughHistoryIndex: Number.isFinite(Number(initial.committedThroughHistoryIndex)) ? Number(initial.committedThroughHistoryIndex) : 0,
      summaryVersion: Number.isFinite(Number(initial.summaryVersion)) ? Number(initial.summaryVersion) : 0,
      currentSummary: String(initial.currentSummary || ""),
      legacySummary: String(initial.legacySummary ?? (initial.segments?.length ? "" : initial.currentSummary || "")),
      segments: Array.isArray(initial.segments) ? initial.segments : [],
      cacheEpoch: Number.isFinite(Number(initial.cacheEpoch)) ? Number(initial.cacheEpoch) : 0,
      lastUpdatedAt: initial.lastUpdatedAt || null
    };
  }

  getUncommittedHistory(state, history) {
    return (Array.isArray(history) ? history : []).slice(state.committedThroughHistoryIndex);
  }

  selectBatch(state, history, tokensToSummarize, estimateMessageTokens, { participantPresence = null, minRecentRawMessages = 0 } = {}) {
    const startIndex = state.committedThroughHistoryIndex;
    const batch = [];
    let tokenCount = 0;
    let endIndex = startIndex;
    const limit = Math.max(startIndex, history.length - minRecentRawMessages);
    let firstSignature = null;
    const signatureFor = (message) => !participantPresence?.length ? "all" : participantPresence
      .filter((window) => Number(window.joinedAtMessageId ?? 0) <= Number(message.id)
        && (window.leftAtMessageId == null || Number(message.id) < Number(window.leftAtMessageId)))
      .map((window) => Number(window.characterId)).filter(Number.isFinite).sort((a, b) => a - b).join(",");
    for (let index = startIndex; index < limit; index++) {
      const signature = signatureFor(history[index]);
      if (batch.length > 0 && signature !== firstSignature) break;
      const messageTokens = Math.max(1, estimateMessageTokens(history[index]));
      if (batch.length > 0 && tokenCount + messageTokens > tokensToSummarize) break;
      batch.push(history[index]);
      firstSignature = signature;
      tokenCount += messageTokens;
      endIndex = index + 1;
      if (tokenCount >= tokensToSummarize) break;
    }
    return { batch, startIndex, endIndex, tokenCount, presenceSignature: firstSignature };
  }

  async checkpoint({ state, history, tokensToSummarize, estimateMessageTokens, buildPrompt, requestSummary, participantPresence = null, minRecentRawMessages = 0 }) {
    const selection = this.selectBatch(state, history, tokensToSummarize, estimateMessageTokens, { participantPresence, minRecentRawMessages });
    if (selection.batch.length === 0) return { committed: false, reason: "no_messages" };
    this.trace?.record("checkpoint", { reason: `selected_${selection.startIndex}_${selection.endIndex}` });
    try {
      const result = await requestSummary(buildPrompt(selection.batch, participantPresence ? "" : state.currentSummary));
      const outcome = validateGenerationOutcome(result);
      const content = outcome.content.trim();
      if (!content || !outcome.complete) return { committed: false, reason: "invalid_summary_response" };
      if (participantPresence) {
        const knownBy = selection.presenceSignature.split(",").map(Number).filter(Number.isFinite);
        state.segments.push({
          segmentId: `rolling_${state.summaryVersion + 1}_${selection.batch[0].id}_${selection.batch.at(-1).id}`,
          content,
          sourceMessageIds: selection.batch.map((message) => message.id),
          knownBy,
          presenceSignature: selection.presenceSignature,
          fromMessageId: selection.batch[0].id,
          toMessageId: selection.batch.at(-1).id
        });
        state.currentSummary = [state.legacySummary, ...state.segments.map((segment) => segment.content)].filter(Boolean).join("\n\n");
        state.cacheEpoch += 1;
      } else state.currentSummary = content;
      state.committedThroughHistoryIndex = selection.endIndex;
      state.committedThroughMessageId = selection.batch[selection.batch.length - 1]?.id ?? null;
      state.summaryVersion += 1;
      state.lastUpdatedAt = new Date().toISOString();
      this.trace?.record("checkpoint", { reason: "commit_after_success" });
      return { committed: true, selection, summary: content };
    } catch (error) {
      this.trace?.record("checkpoint", { reason: "summary_request_failed" });
      return { committed: false, reason: "summary_request_failed", error };
    }
  }
}

module.exports = { RollingSummaryManager };
