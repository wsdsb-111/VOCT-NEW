"use strict";

function textFeatures(value) {
  const normalized = String(value || "").toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
  const features = new Set();
  for (let index = 0; index < normalized.length; index++) {
    features.add(normalized[index]);
    if (index + 1 < normalized.length) features.add(normalized.slice(index, index + 2));
  }
  return features;
}

function overlapScore(left, right) {
  if (left.size === 0 || right.size === 0) return 0;
  let overlap = 0;
  for (const feature of left) if (right.has(feature)) overlap++;
  return overlap / Math.max(1, Math.min(left.size, right.size));
}

class MemoryRanker {
  rank(memories, context = {}) {
    const queryFeatures = textFeatures(context.query);
    const entityIds = new Set((context.entityIds || []).map(Number));
    const participantIds = new Set((context.participantIds || []).map(Number));
    const currentDays = Number(context.currentTotalDays);
    return (Array.isArray(memories) ? memories : []).map((memory) => {
      const memoryFeatures = textFeatures(`${memory.canonicalText || memory.content} ${(memory.tags || []).join(" ")}`);
      const query = overlapScore(queryFeatures, memoryFeatures);
      const entity = memory.subjects?.some((id) => entityIds.has(Number(id))) ? 1 : 0;
      const importance = Number(memory.importance) || 0;
      const elapsed = Number.isFinite(currentDays) && Number.isFinite(Number(memory.totalDays)) ? Math.max(0, currentDays - Number(memory.totalDays)) : 180;
      const recency = 1 / (1 + elapsed / 180);
      const relationship = memory.participants?.some((id) => participantIds.has(Number(id))) ? 1 : 0;
      const confidence = Number(memory.confidence) || 0;
      const score = 0.30 * query + 0.20 * entity + 0.20 * importance + 0.15 * recency + 0.10 * relationship + 0.05 * confidence;
      return { memory, score, reason: { query, entity, importance, recency, relationship, confidence } };
    }).sort((left, right) => {
      const criticalDifference = Number(right.memory.importance >= 0.9) - Number(left.memory.importance >= 0.9);
      return criticalDifference || right.score - left.score;
    });
  }

  selectWithinBudget(ranked, { tokenBudget, estimateTokens } = {}) {
    const budget = Math.max(0, Number(tokenBudget) || 0);
    const estimate = estimateTokens || ((text) => Math.ceil(String(text || "").length / 2));
    const selected = [];
    let used = 0;
    const ordered = [...ranked].sort((left, right) => {
      const criticalDifference = Number(right.memory.importance >= 0.9) - Number(left.memory.importance >= 0.9);
      return criticalDifference || right.score - left.score;
    });
    for (const entry of ordered) {
      let memory = entry.memory;
      let tokens = Math.max(1, estimate(memory.content));
      const remaining = budget - used;
      if (tokens > remaining && memory.importance >= 0.9 && remaining > 0) {
        let low = 1;
        let high = memory.content.length;
        let fitted = "";
        while (low <= high) {
          const middle = Math.floor((low + high) / 2);
          const candidate = `${memory.content.slice(0, middle)}…`;
          if (estimate(candidate) <= remaining) {
            fitted = candidate;
            low = middle + 1;
          } else {
            high = middle - 1;
          }
        }
        if (fitted) {
          memory = { ...memory, content: fitted };
          tokens = Math.max(1, estimate(fitted));
        }
      }
      if (used + tokens > budget) continue;
      selected.push({ ...entry, memory, tokens });
      used += tokens;
    }
    return selected;
  }
}

module.exports = { MemoryRanker, textFeatures };
