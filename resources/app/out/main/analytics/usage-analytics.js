"use strict";

function createUsageAnalytics({ fs, dataDir, analyticsFile, retention, createPromptFingerprint }) {
  const fs$1 = fs;
  const VOTC_DATA_DIR = dataDir;
  const VOTC_USAGE_ANALYTICS_FILE = analyticsFile;
  const usageAnalyticsRetention = retention;
  class UsageAnalytics {
    constructor() {
      this.maxUsageEntries = usageAnalyticsRetention.DEFAULT_MAX_USAGE_ENTRIES;
      this.maxDiagnosticEntries = usageAnalyticsRetention.DEFAULT_MAX_DIAGNOSTIC_ENTRIES;
    }
    read() {
      try {
        if (!fs$1.existsSync(VOTC_USAGE_ANALYTICS_FILE)) return { version: 1, entries: [] };
        const data = JSON.parse(fs$1.readFileSync(VOTC_USAGE_ANALYTICS_FILE, "utf-8"));
        return Array.isArray(data?.entries) ? data : { version: 1, entries: [] };
      } catch (error) {
        console.warn("[UsageAnalytics] Failed to read analytics:", error);
        return { version: 1, entries: [] };
      }
    }
    write(data) {
      try {
        fs$1.mkdirSync(VOTC_DATA_DIR, { recursive: true });
        fs$1.writeFileSync(VOTC_USAGE_ANALYTICS_FILE, JSON.stringify(data, null, 2), "utf-8");
      } catch (error) {
        console.warn("[UsageAnalytics] Failed to save analytics:", error);
      }
    }
    record(metadata, usage) {
      const promptTokens = Number(usage?.prompt_tokens) || 0;
      const completionTokens = Number(usage?.completion_tokens) || 0;
      const estimatedPromptTokens = Number(metadata?.estimatedPromptTokens) || 0;
      const cacheHitTokens = Number(usage?.prompt_cache_hit_tokens);
      const cacheMissTokens = Number(usage?.prompt_cache_miss_tokens);
      const entry = {
        timestamp: (/* @__PURE__ */ new Date()).toISOString(),
        requestType: metadata?.requestType || "unknown",
        providerType: metadata?.providerType || "unknown",
        model: metadata?.model || "unknown",
        character: metadata?.character || null,
        characterId: Number.isFinite(Number(metadata?.characterId)) ? Number(metadata.characterId) : null,
        actionTrigger: metadata?.actionTrigger || null,
        actionOutcome: metadata?.actionOutcome || null,
        actionCandidateReasons: Array.isArray(metadata?.actionCandidateReasons) ? metadata.actionCandidateReasons : [],
        actionFinishReason: metadata?.actionFinishReason || null,
        selectedActionIds: Array.isArray(metadata?.selectedActionIds) ? metadata.selectedActionIds : [],
        executedActionIds: Array.isArray(metadata?.executedActionIds) ? metadata.executedActionIds : [],
        pendingActionIds: Array.isArray(metadata?.pendingActionIds) ? metadata.pendingActionIds : [],
        failedActionIds: Array.isArray(metadata?.failedActionIds) ? metadata.failedActionIds : [],
        skipReason: metadata?.skipReason || null,
        estimatedPromptTokens,
        promptTokens,
        promptEstimateRatio: promptTokens > 0 && estimatedPromptTokens > 0 ? promptTokens / estimatedPromptTokens : null,
        completionTokens,
        totalTokens: Number(usage?.total_tokens) || promptTokens + completionTokens,
        isUsageRecord: !!usage && typeof usage === "object",
        cacheHitTokens: Number.isFinite(cacheHitTokens) ? cacheHitTokens : null,
        cacheMissTokens: Number.isFinite(cacheMissTokens) ? cacheMissTokens : null,
        historyStartPosition: Number.isFinite(Number(metadata?.historyStartPosition)) ? Number(metadata.historyStartPosition) : null,
        prefixFingerprint: metadata?.prefixFingerprint || null,
        blocks: Array.isArray(metadata?.blocks) ? metadata.blocks.map((block, index) => ({
          id: block.id,
          label: block.label,
          type: block.type,
          position: Number.isFinite(Number(block.position)) ? Number(block.position) : index,
          tokens: Number(block.tokens) || 0,
          fingerprint: block.fingerprint || createPromptFingerprint(block.content)
        })) : []
      };
      const data = this.read();
      data.version = 4;
      data.entries.push(entry);
      data.entries = usageAnalyticsRetention.retainUsageAnalyticsEntries(data.entries, {
        maxUsageEntries: this.maxUsageEntries,
        maxDiagnosticEntries: this.maxDiagnosticEntries
      });
      this.write(data);
      console.log(`[UsageAnalytics] ${entry.requestType}: input=${entry.promptTokens || entry.estimatedPromptTokens}, hit=${entry.cacheHitTokens ?? "n/a"}, miss=${entry.cacheMissTokens ?? "n/a"}, output=${entry.completionTokens}`);
    }
    getReport() {
      const entries = this.read().entries;
      const groups = {};
      const add = (target, entry) => {
        target.requests += Math.max(1, Math.floor(Number(entry.requestCount) || 1));
        target.estimatedPromptTokens += entry.estimatedPromptTokens || 0;
        target.promptTokens += entry.promptTokens || 0;
        target.completionTokens += entry.completionTokens || 0;
        target.totalTokens += entry.totalTokens || 0;
        if (entry.cacheHitTokens != null) {
          target.cacheReportedRequests++;
          target.cacheHitTokens += entry.cacheHitTokens;
          target.cacheMissTokens += entry.cacheMissTokens || 0;
        }
      };
      const create = () => ({ requests: 0, estimatedPromptTokens: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, cacheReportedRequests: 0, cacheHitTokens: 0, cacheMissTokens: 0 });
      const total = create();
      const diagnostics = { total: 0, actionSkipped: 0, byType: {} };
      const reconciliation = { aggregates: 0, requests: 0, totalTokens: 0 };
      const blockTotals = {};
      const missAttributionTotals = {};
      const changesSincePreviousTotals = {};
      const previousByRequest = /* @__PURE__ */ new Map();
      const recentWithAttribution = [];
      const actionOutcomes = {
        evaluated: 0,
        noAvailableAction: 0,
        emptyResponse: 0,
        invalidResponse: 0,
        noActionSelected: 0,
        withSelection: 0,
        executed: 0,
        pendingApproval: 0,
        failed: 0,
        selectedActionIds: {},
        outcomes: {}
      };
      for (const entry of entries) {
        const isUsageRecord = usageAnalyticsRetention.isUsageEntry(entry);
        const isActionOutcome = entry.requestType === "action_outcome";
        if (isUsageRecord) {
          add(total, entry);
          if (entry.isReconciledAggregate) {
            reconciliation.aggregates++;
            reconciliation.requests += Math.max(1, Math.floor(Number(entry.requestCount) || 1));
            reconciliation.totalTokens += entry.totalTokens || 0;
          }
          const key = `${entry.requestType} | ${entry.providerType} | ${entry.model}`;
          if (!groups[key]) groups[key] = create();
          add(groups[key], entry);
        } else if (isActionOutcome) {
          actionOutcomes.evaluated++;
          const outcome = entry.actionOutcome || "unknown";
          actionOutcomes.outcomes[outcome] = (actionOutcomes.outcomes[outcome] || 0) + 1;
          if (outcome === "no_available_action") actionOutcomes.noAvailableAction++;
          if (outcome === "empty_response") actionOutcomes.emptyResponse++;
          if (outcome === "invalid_json" || outcome === "invalid_schema") actionOutcomes.invalidResponse++;
          if (outcome === "no_action_selected") actionOutcomes.noActionSelected++;
          actionOutcomes.executed += entry.executedActionIds?.length || 0;
          actionOutcomes.pendingApproval += entry.pendingActionIds?.length || 0;
          actionOutcomes.failed += entry.failedActionIds?.length || 0;
          if ((entry.selectedActionIds?.length || 0) > 0) actionOutcomes.withSelection++;
          for (const actionId of entry.selectedActionIds || []) {
            actionOutcomes.selectedActionIds[actionId] = (actionOutcomes.selectedActionIds[actionId] || 0) + 1;
          }
        } else {
          diagnostics.total++;
          diagnostics.byType[entry.requestType] = (diagnostics.byType[entry.requestType] || 0) + 1;
          if (entry.requestType === "action_skipped") diagnostics.actionSkipped++;
        }
        if (!isUsageRecord) continue;
        for (const block of entry.blocks || []) {
          const blockKey = `${block.type || "unknown"} | ${block.label || block.id || "unknown"}`;
          if (!blockTotals[blockKey]) blockTotals[blockKey] = { requests: 0, tokens: 0 };
          blockTotals[blockKey].requests++;
          blockTotals[blockKey].tokens += block.tokens || 0;
        }
        const responderKey = entry.characterId ?? entry.character ?? "";
        const previousKey = `${entry.requestType} | ${entry.providerType} | ${entry.model} | ${responderKey}`;
        const previousEntry = previousByRequest.get(previousKey);
        const cacheAttribution = this.attributeCacheMiss(entry, previousEntry);
        previousByRequest.set(previousKey, entry);
        if (!entry.isReconciledAggregate) recentWithAttribution.push({ ...entry, cacheAttribution });
        if (cacheAttribution?.cacheMissTokens > 0) {
          const breakpoint = cacheAttribution.breakpoint;
          const attributionKey = cacheAttribution.coldStart ? `${entry.requestType} | cold_start | No reusable prefix` : breakpoint ? `${entry.requestType} | ${breakpoint.type || "unknown"} | ${breakpoint.label || breakpoint.id || "unknown"}` : `${entry.requestType} | unattributed | No block metadata`;
          if (!missAttributionTotals[attributionKey]) {
            missAttributionTotals[attributionKey] = {
              requests: 0,
              cacheMissTokens: 0,
              breakpointMissTokens: 0,
              downstreamMissTokens: 0,
              changedSincePreviousRequests: 0
            };
          }
          const target = missAttributionTotals[attributionKey];
          target.requests++;
          target.cacheMissTokens += cacheAttribution.cacheMissTokens;
          target.breakpointMissTokens += breakpoint?.attributedMissTokens || 0;
          target.downstreamMissTokens += cacheAttribution.downstreamMissTokens || 0;
          if (cacheAttribution.firstChangedBlock) target.changedSincePreviousRequests++;
          const changedBlock = cacheAttribution.firstChangedBlock;
          if (changedBlock) {
            const changeKey = `${entry.requestType} | ${changedBlock.type || "unknown"} | ${changedBlock.label || changedBlock.id || "unknown"}`;
            if (!changesSincePreviousTotals[changeKey]) {
              changesSincePreviousTotals[changeKey] = { requests: 0, cacheMissTokens: 0, agreesWithBreakpointRequests: 0 };
            }
            changesSincePreviousTotals[changeKey].requests++;
            changesSincePreviousTotals[changeKey].cacheMissTokens += cacheAttribution.cacheMissTokens;
            if (cacheAttribution.fingerprintAgreesWithBreakpoint) changesSincePreviousTotals[changeKey].agreesWithBreakpointRequests++;
          }
        }
      }
      const finish = (value) => ({ ...value, cacheHitRate: value.cacheHitTokens + value.cacheMissTokens > 0 ? value.cacheHitTokens / (value.cacheHitTokens + value.cacheMissTokens) : null });
      return {
        filePath: VOTC_USAGE_ANALYTICS_FILE,
        total: finish(total),
        diagnostics,
        reconciliation,
        byRequest: Object.entries(groups).map(([key, value]) => ({ key, ...finish(value) })).sort((a, b) => b.totalTokens - a.totalTokens),
        blocks: Object.entries(blockTotals).map(([key, value]) => ({ key, ...value })).sort((a, b) => b.tokens - a.tokens),
        missAttribution: Object.entries(missAttributionTotals).map(([key, value]) => ({ key, ...value })).sort((a, b) => b.cacheMissTokens - a.cacheMissTokens),
        changesSincePrevious: Object.entries(changesSincePreviousTotals).map(([key, value]) => ({ key, ...value })).sort((a, b) => b.cacheMissTokens - a.cacheMissTokens),
        actionOutcomes: {
          ...actionOutcomes,
          selectionRate: actionOutcomes.evaluated > 0 ? actionOutcomes.withSelection / actionOutcomes.evaluated : null,
          successfulExecutionRate: actionOutcomes.executed + actionOutcomes.failed > 0 ? actionOutcomes.executed / (actionOutcomes.executed + actionOutcomes.failed) : null
        },
        recent: recentWithAttribution.slice(-100).reverse()
      };
    }
    attributeCacheMiss(entry, previousEntry = null) {
      if (entry?.cacheHitTokens == null || entry?.cacheMissTokens == null) return null;
      const cacheHitTokens = Number(entry?.cacheHitTokens);
      const cacheMissTokens = Number(entry?.cacheMissTokens);
      if (!Number.isFinite(cacheHitTokens) || !Number.isFinite(cacheMissTokens)) return null;
      const cacheTotal = cacheHitTokens + cacheMissTokens;
      const blocks = Array.isArray(entry?.blocks) ? entry.blocks : [];
      if (cacheTotal <= 0 || blocks.length === 0) {
        return {
          method: "ordered_prefix_estimate_v1",
          cacheHitTokens,
          cacheMissTokens,
          coldStart: cacheHitTokens === 0 && cacheMissTokens > 0,
          breakpoint: null,
          downstreamMissTokens: cacheMissTokens,
          firstChangedBlock: null,
          blocks: []
        };
      }
      const estimatedTotal = blocks.reduce((sum, block) => sum + (Number(block.tokens) || 0), 0);
      if (estimatedTotal <= 0) return null;
      let estimatedCursor = 0;
      let actualCursor = 0;
      const attributedBlocks = blocks.map((block, index) => {
        estimatedCursor += Number(block.tokens) || 0;
        const actualEnd = index === blocks.length - 1 ? cacheTotal : Math.round(estimatedCursor / estimatedTotal * cacheTotal);
        const actualTokens = Math.max(0, actualEnd - actualCursor);
        const attributedHitTokens = Math.max(0, Math.min(actualEnd, cacheHitTokens) - Math.min(actualCursor, cacheHitTokens));
        const attributedMissTokens = Math.max(0, actualTokens - attributedHitTokens);
        actualCursor = actualEnd;
        return {
          id: block.id,
          label: block.label,
          type: block.type,
          position: Number.isFinite(Number(block.position)) ? Number(block.position) : index,
          estimatedTokens: Number(block.tokens) || 0,
          attributedTokens: actualTokens,
          attributedHitTokens,
          attributedMissTokens
        };
      });
      const breakpoint = attributedBlocks.find((block) => block.attributedMissTokens > 0) || null;
      const breakpointIndex = breakpoint ? attributedBlocks.indexOf(breakpoint) : -1;
      const downstreamMissTokens = breakpointIndex >= 0 ? attributedBlocks.slice(breakpointIndex + 1).reduce((sum, block) => sum + block.attributedMissTokens, 0) : 0;
      let firstChangedBlock = null;
      const previousBlocks = Array.isArray(previousEntry?.blocks) ? previousEntry.blocks : [];
      if (previousBlocks.length > 0) {
        const maxLength = Math.max(blocks.length, previousBlocks.length);
        for (let index = 0; index < maxLength; index++) {
          const current = blocks[index];
          const previous = previousBlocks[index];
          if (!current || !previous || current.id !== previous.id) {
            if (current) {
              firstChangedBlock = { id: current.id, label: current.label, type: current.type, position: index };
            }
            break;
          }
          // Older analytics entries have no fingerprints. Their token breakpoint
          // remains usable, but an exact content-change comparison is unavailable.
          if (!current.fingerprint || !previous.fingerprint) break;
          if (current.fingerprint !== previous.fingerprint) {
            firstChangedBlock = { id: current.id, label: current.label, type: current.type, position: index };
            break;
          }
        }
      }
      const prefixFingerprintMatchesPrevious = !!(entry?.prefixFingerprint && previousEntry?.prefixFingerprint && entry.prefixFingerprint === previousEntry.prefixFingerprint);
      const firstChangedBeforeHistory = !!(firstChangedBlock && Number.isFinite(Number(entry?.historyStartPosition)) && firstChangedBlock.position < Number(entry.historyStartPosition));
      return {
        method: "ordered_prefix_estimate_v1",
        cacheHitTokens,
        cacheMissTokens,
        estimatedBlockTokens: estimatedTotal,
        scale: cacheTotal / estimatedTotal,
        coldStart: cacheHitTokens === 0 && cacheMissTokens > 0,
        breakpoint,
        downstreamMissTokens,
        firstChangedBlock,
        prefixFingerprintMatchesPrevious,
        firstChangedBeforeHistory,
        fingerprintAgreesWithBreakpoint: !!(breakpoint && firstChangedBlock && breakpoint.id === firstChangedBlock.id),
        blocks: attributedBlocks
      };
    }
    clear() {
      this.write({ version: 4, entries: [] });
    }
  }
  
  return UsageAnalytics;
}

module.exports = { createUsageAnalytics };
