"use strict";

const { getCharacterMentionAliases } = require("./character-identity");

function uniqueNumericIds(values) {
  return [...new Set((values || []).map(Number).filter(Number.isFinite))];
}

class MentionTracker {
  createState() {
    return { processedThroughIndex: 0, lastProcessedMessageKey: null, mentionedCharacterIds: [] };
  }

  getMessageKey(message, index) {
    if (message?.id != null) return `id:${message.id}`;
    return `index:${index}:${message?.role || ""}:${message?.content || ""}`;
  }

  buildAliases(candidates = []) {
    const ownersByAlias = new Map();
    for (const candidate of candidates) {
      const id = Number(candidate?.id);
      if (!Number.isFinite(id)) continue;
      const names = getCharacterMentionAliases(candidate);
      for (const name of names) {
        if (!ownersByAlias.has(name)) ownersByAlias.set(name, new Set());
        ownersByAlias.get(name).add(id);
      }
    }
    return [...ownersByAlias.entries()]
      .filter(([, ids]) => ids.size === 1)
      .map(([name, ids]) => ({ name, id: [...ids][0] }))
      .sort((left, right) => right.name.length - left.name.length || left.name.localeCompare(right.name));
  }

  hasValidBoundary(content, start, name) {
    if (!/[A-Za-z0-9]/.test(name)) return true;
    const before = start > 0 ? content[start - 1] : "";
    const after = start + name.length < content.length ? content[start + name.length] : "";
    return !/[A-Za-z0-9_]/.test(before) && !/[A-Za-z0-9_]/.test(after);
  }

  findMentionedCharacterIds(history = [], { candidates = [], excludedIds = [] } = {}) {
    const excluded = new Set(uniqueNumericIds(excludedIds));
    const aliases = this.buildAliases(candidates).filter((alias) => !excluded.has(alias.id));
    const mentioned = [];
    const seen = new Set();

    for (const message of history || []) {
      const content = typeof message?.content === "string" ? message.content : "";
      if (!content) continue;
      const matches = [];
      for (const alias of aliases) {
        let start = content.indexOf(alias.name);
        while (start !== -1) {
          if (this.hasValidBoundary(content, start, alias.name)) {
            matches.push({ start, end: start + alias.name.length, ...alias });
          }
          start = content.indexOf(alias.name, start + alias.name.length);
        }
      }
      matches.sort((left, right) => left.start - right.start || right.name.length - left.name.length);
      const occupied = [];
      for (const match of matches) {
        if (occupied.some(([start, end]) => match.start < end && match.end > start)) continue;
        occupied.push([match.start, match.end]);
        if (!seen.has(match.id)) {
          seen.add(match.id);
          mentioned.push(match.id);
        }
      }
    }
    return mentioned;
  }

  update(state, { history = [], candidates = [], excludedIds = [] } = {}) {
    const target = state && typeof state === "object" ? state : this.createState();
    let cursor = Number.isInteger(target.processedThroughIndex) ? target.processedThroughIndex : 0;
    const historyChanged = cursor < 0 || cursor > history.length ||
      (cursor > 0 && target.lastProcessedMessageKey !== this.getMessageKey(history[cursor - 1], cursor - 1));
    if (historyChanged) {
      cursor = 0;
      target.mentionedCharacterIds = [];
    }

    const newlyMentioned = this.findMentionedCharacterIds(history.slice(cursor), { candidates, excludedIds });
    target.mentionedCharacterIds = uniqueNumericIds([...(target.mentionedCharacterIds || []), ...newlyMentioned]);
    target.processedThroughIndex = history.length;
    target.lastProcessedMessageKey = history.length > 0 ? this.getMessageKey(history[history.length - 1], history.length - 1) : null;
    delete target.processedMessageKeys;

    const excluded = new Set(uniqueNumericIds(excludedIds));
    return target.mentionedCharacterIds.filter((characterId) => !excluded.has(characterId));
  }
}

module.exports = { MentionTracker };
