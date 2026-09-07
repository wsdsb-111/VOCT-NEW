"use strict";

const { getCharacterMentionAliases } = require("./character-identity");

const UNIQUE_TITLE_TERMS = new Set(["陛下", "殿下", "阁下", "官家", "皇帝", "皇后", "太上皇", "太子", "国王", "女王"]);

function uniqueNumericIds(values) {
  return [...new Set((values || []).filter((value) => value !== null && value !== undefined && value !== "").map(Number).filter(Number.isFinite))];
}

class MentionTracker {
  constructor({ onUnresolved = null } = {}) {
    this.onUnresolved = typeof onUnresolved === "function" ? onUnresolved : null;
    this.lastAmbiguousAliases = [];
    this.lastScanRecentCharacterId = null;
  }

  createState() {
    return { processedThroughIndex: 0, lastProcessedMessageKey: null, mentionedCharacterIds: [], currentTurnMentionedCharacterIds: [], recentThirdPersonCharacterId: null };
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
    this.lastAmbiguousAliases = [...ownersByAlias.entries()]
      .filter(([, ids]) => ids.size > 1)
      .map(([name, ids]) => ({ name, characterIds: [...ids].sort((left, right) => left - right) }))
      .sort((left, right) => right.name.length - left.name.length || left.name.localeCompare(right.name));
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

  hasValidChineseBoundary(content, start, name) {
    if (UNIQUE_TITLE_TERMS.has(name)) return true;
    if (/[A-Za-z0-9]/.test(name)) return this.hasValidBoundary(content, start, name);
    if (name.length >= 2) return true;
    const before = start > 0 ? content[start - 1] : "";
    const after = start + name.length < content.length ? content[start + name.length] : "";
    const boundary = /[\s，。！？、；：,.!?;:“”‘’（）()【】\[\]…—]/;
    const beforeCue = /[向问与和同对见请叫称找是乃]/;
    const afterCue = /[说道问答称来去的啊呀呢吗吧]/;
    return (!before || boundary.test(before) || beforeCue.test(before)) && (!after || boundary.test(after) || afterCue.test(after));
  }

  recordUnresolved(alias, reason, characterIds = []) {
    const entry = { alias, reason, characterIds: uniqueNumericIds(characterIds) };
    this.onUnresolved?.(entry);
    return entry;
  }

  findMentionedCharacterIds(history = [], { candidates = [], excludedIds = [], recentCharacterId = null } = {}) {
    const excluded = new Set(uniqueNumericIds(excludedIds));
    const aliases = this.buildAliases(candidates).filter((alias) => !excluded.has(alias.id));
    const mentioned = [];
    const seen = new Set();

    let recentId = recentCharacterId !== null && recentCharacterId !== undefined && recentCharacterId !== "" && Number.isFinite(Number(recentCharacterId)) ? Number(recentCharacterId) : null;
    for (const message of history || []) {
      const content = typeof message?.content === "string" ? message.content : "";
      if (!content) continue;
      for (const ambiguous of this.lastAmbiguousAliases) {
        if (content.includes(ambiguous.name)) this.recordUnresolved(ambiguous.name, "ambiguous_alias", ambiguous.characterIds);
      }
      const matches = [];
      for (const alias of aliases) {
        let start = content.indexOf(alias.name);
        while (start !== -1) {
          if (this.hasValidChineseBoundary(content, start, alias.name)) {
            matches.push({ start, end: start + alias.name.length, ...alias });
          }
          start = content.indexOf(alias.name, start + alias.name.length);
        }
      }
      matches.sort((left, right) => left.start - right.start || right.name.length - left.name.length);
      const occupied = [];
      let lastMessageMentionId = null;
      for (const match of matches) {
        if (occupied.some(([start, end]) => match.start < end && match.end > start)) continue;
        occupied.push([match.start, match.end]);
        if (!seen.has(match.id)) {
          seen.add(match.id);
          mentioned.push(match.id);
        }
        lastMessageMentionId = match.id;
      }
      if (lastMessageMentionId != null) recentId = lastMessageMentionId;
      const hasCoreference = /(?:那个人|那人|此人|刚才说的那位)/.test(content) || /(?<![其吉])[他她](?![们人者])/.test(content);
      if (hasCoreference) {
        if (recentId != null && !excluded.has(recentId)) {
          if (!seen.has(recentId)) {
            seen.add(recentId);
            mentioned.push(recentId);
          }
        } else {
          this.recordUnresolved("那个人", "recent_third_person_unresolved");
        }
      }
    }
    this.lastScanRecentCharacterId = recentId;
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

    const previousRecentCharacterId = target.recentThirdPersonCharacterId;
    const newlyMentioned = this.findMentionedCharacterIds(history.slice(cursor), { candidates, excludedIds, recentCharacterId: previousRecentCharacterId });
    target.mentionedCharacterIds = uniqueNumericIds([...(target.mentionedCharacterIds || []), ...newlyMentioned]);
    target.processedThroughIndex = history.length;
    target.lastProcessedMessageKey = history.length > 0 ? this.getMessageKey(history[history.length - 1], history.length - 1) : null;
    const latestUserMessage = [...history].reverse().find((message) => message?.role === "user");
    target.currentTurnMentionedCharacterIds = latestUserMessage
      ? this.findMentionedCharacterIds([latestUserMessage], { candidates, excludedIds, recentCharacterId: previousRecentCharacterId })
      : [];
    target.recentThirdPersonCharacterId = this.lastScanRecentCharacterId ?? previousRecentCharacterId ?? null;
    delete target.processedMessageKeys;

    const excluded = new Set(uniqueNumericIds(excludedIds));
    return target.mentionedCharacterIds.filter((characterId) => !excluded.has(characterId));
  }
}

module.exports = { MentionTracker };
