"use strict";

class MentionTracker {
  createState() {
    return { processedMessageKeys: [], mentionedCharacterIds: [] };
  }

  update(state, { history = [], candidates = [], excludedIds = [] } = {}) {
    const target = state && typeof state === "object" ? state : this.createState();
    if (!Array.isArray(target.processedMessageKeys)) target.processedMessageKeys = [];
    if (!Array.isArray(target.mentionedCharacterIds)) target.mentionedCharacterIds = [];
    const processed = new Set(target.processedMessageKeys);
    const mentioned = new Set(target.mentionedCharacterIds.map(Number).filter(Number.isFinite));
    const excluded = new Set((excludedIds || []).map(Number).filter(Number.isFinite));
    const profiles = (candidates || []).map((candidate) => ({
      id: Number(candidate?.id),
      names: [...new Set([candidate?.fullName, candidate?.shortName, candidate?.firstName, candidate?.name]
        .map((name) => typeof name === "string" ? name.trim() : "")
        .filter((name) => name.length >= 2))].sort((left, right) => right.length - left.length)
    })).filter((candidate) => Number.isFinite(candidate.id) && candidate.names.length > 0);

    for (let index = 0; index < history.length; index++) {
      const message = history[index];
      if (!message || typeof message.content !== "string" || !message.content) continue;
      const key = message.id != null ? `id:${message.id}` : `index:${index}:${message.role || ""}:${message.content}`;
      if (processed.has(key)) continue;
      processed.add(key);
      for (const candidate of profiles) {
        if (excluded.has(candidate.id)) continue;
        if (candidate.names.some((name) => message.content.includes(name))) mentioned.add(candidate.id);
      }
    }

    target.processedMessageKeys = [...processed];
    target.mentionedCharacterIds = [...mentioned];
    return target.mentionedCharacterIds.filter((characterId) => !excluded.has(characterId));
  }
}

module.exports = { MentionTracker };

