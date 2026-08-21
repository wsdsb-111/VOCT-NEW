"use strict";

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
      lastUpdatedAt: initial.lastUpdatedAt || null
    };
  }

  getUncommittedHistory(state, history) {
    return (Array.isArray(history) ? history : []).slice(state.committedThroughHistoryIndex);
  }

  selectBatch(state, history, tokensToSummarize, estimateMessageTokens) {
    const startIndex = state.committedThroughHistoryIndex;
    const batch = [];
    let tokenCount = 0;
    let endIndex = startIndex;
    for (let index = startIndex; index < history.length; index++) {
      const messageTokens = Math.max(1, estimateMessageTokens(history[index]));
      if (batch.length > 0 && tokenCount + messageTokens > tokensToSummarize) break;
      batch.push(history[index]);
      tokenCount += messageTokens;
      endIndex = index + 1;
      if (tokenCount >= tokensToSummarize) break;
    }
    return { batch, startIndex, endIndex, tokenCount };
  }

  async checkpoint({ state, history, tokensToSummarize, estimateMessageTokens, buildPrompt, requestSummary }) {
    const selection = this.selectBatch(state, history, tokensToSummarize, estimateMessageTokens);
    if (selection.batch.length === 0) return { committed: false, reason: "no_messages" };
    this.trace?.record("checkpoint", { reason: `selected_${selection.startIndex}_${selection.endIndex}` });
    try {
      const result = await requestSummary(buildPrompt(selection.batch, state.currentSummary));
      const content = typeof result?.content === "string" ? result.content.trim() : "";
      if (!content) return { committed: false, reason: "invalid_summary_response" };
      state.currentSummary = content;
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
