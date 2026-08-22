"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { createMemoryRecord, uniqueIds } = require("./memory-types");

class MemoryStore {
  constructor({ baseDir, legacySummariesDir = null, recoveryDir = null } = {}) {
    if (!baseDir) throw new Error("memory_store_base_dir_required");
    this.baseDir = baseDir;
    this.legacySummariesDir = legacySummariesDir;
    this.paths = {
      episodes: path.join(baseDir, "episodes"),
      characters: path.join(baseDir, "characters"),
      pairs: path.join(baseDir, "pairs"),
      knowledge: path.join(baseDir, "knowledge"),
      recovery: recoveryDir || path.join(baseDir, "recovery"),
      index: path.join(baseDir, "index.json")
    };
    this.ensureDirectories();
    this.index = this.readJson(this.paths.index, { schemaVersion: 2, memories: {}, episodes: {} });
  }

  ensureDirectories() {
    for (const directory of [this.baseDir, this.paths.episodes, this.paths.characters, this.paths.pairs, this.paths.knowledge, this.paths.recovery]) {
      fs.mkdirSync(directory, { recursive: true });
    }
  }

  readJson(filePath, fallback) {
    try {
      if (!fs.existsSync(filePath)) return fallback;
      return JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch (error) {
      console.error(`[MemoryStore] Failed to read ${filePath}:`, error);
      return fallback;
    }
  }

  writeJson(filePath, value) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(value, null, 2), "utf8");
    fs.renameSync(tempPath, filePath);
  }

  saveIndex() {
    this.writeJson(this.paths.index, this.index);
  }

  memoryPath(memoryId) {
    return path.join(this.paths.episodes, `memory_${String(memoryId).replace(/[^a-zA-Z0-9_-]/g, "_")}.json`);
  }

  episodePath(episodeId) {
    return path.join(this.paths.episodes, `episode_${String(episodeId).replace(/[^a-zA-Z0-9_-]/g, "_")}.json`);
  }

  saveEpisode(episode) {
    if (!episode?.episodeId) throw new Error("episode_id_required");
    const record = { schemaVersion: 2, ...episode };
    const filePath = this.episodePath(record.episodeId);
    this.writeJson(filePath, record);
    this.index.episodes[record.episodeId] = { file: path.basename(filePath), conversationId: record.conversationId || null };
    this.saveIndex();
    return record;
  }

  saveMemory(input) {
    const record = createMemoryRecord(input);
    const previous = this.getMemory(record.memoryId);
    this.writeJson(this.memoryPath(record.memoryId), record);
    this.index.memories[record.memoryId] = {
      type: record.type,
      participants: record.participants,
      subjects: record.subjects,
      totalDays: record.totalDays,
      visibility: record.visibility
    };
    this.saveIndex();
    // A corrected memory may change participants/subjects. Remove its old
    // pair references first so edits and recovery retries never leave stale
    // entries that would make an unrelated pair recall it.
    if (previous) this.removeMemoryFromPairIndexes(previous);
    this.updatePairIndexes(record);
    return record;
  }

  getMemory(memoryId) {
    const record = this.readJson(this.memoryPath(memoryId), null);
    return record ? createMemoryRecord(record) : null;
  }

  listAllMemories() {
    return Object.keys(this.index.memories).map((memoryId) => this.getMemory(memoryId)).filter(Boolean);
  }

  listAllEpisodes() {
    return Object.keys(this.index.episodes).map((episodeId) => this.readJson(this.episodePath(episodeId), null)).filter(Boolean);
  }

  listKnowledgeCharacterIds() {
    if (!fs.existsSync(this.paths.knowledge)) return [];
    return fs.readdirSync(this.paths.knowledge).map((name) => Number(path.basename(name, ".json"))).filter(Number.isFinite);
  }

  updateMemory(memoryId, updater) {
    const existing = this.getMemory(memoryId);
    if (!existing) return null;
    const updates = typeof updater === "function" ? updater({ ...existing }) : updater;
    return this.saveMemory({ ...existing, ...updates, memoryId, version: existing.version + 1, updatedAt: new Date().toISOString() });
  }

  updateMemoryStatus(memoryId, status) {
    return this.updateMemory(memoryId, { status });
  }

  deleteMemory(memoryId) {
    const existing = this.getMemory(memoryId);
    if (!existing) return false;
    this.removeMemoryFromPairIndexes(existing);
    this.removeKnowledgeForMemory(memoryId);
    const filePath = this.memoryPath(memoryId);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    delete this.index.memories[memoryId];
    this.saveIndex();
    return true;
  }

  updatePairIndexes(memory) {
    const ids = uniqueIds([...memory.participants, ...memory.subjects]).sort((a, b) => a - b);
    for (let left = 0; left < ids.length; left++) {
      for (let right = left + 1; right < ids.length; right++) {
        const pairPath = path.join(this.paths.pairs, `${ids[left]}_${ids[right]}.json`);
        const memoryIds = this.readJson(pairPath, []);
        if (!memoryIds.includes(memory.memoryId)) {
          memoryIds.unshift(memory.memoryId);
          this.writeJson(pairPath, memoryIds);
        }
      }
    }
  }

  removeMemoryFromPairIndexes(memory) {
    const ids = uniqueIds([...memory.participants, ...memory.subjects]).sort((a, b) => a - b);
    for (let left = 0; left < ids.length; left++) {
      for (let right = left + 1; right < ids.length; right++) {
        const pairPath = path.join(this.paths.pairs, `${ids[left]}_${ids[right]}.json`);
        const memoryIds = this.readJson(pairPath, []);
        if (!Array.isArray(memoryIds) || !memoryIds.includes(memory.memoryId)) continue;
        const remaining = memoryIds.filter((memoryId) => memoryId !== memory.memoryId);
        this.writeJson(pairPath, remaining);
      }
    }
  }

  removeKnowledgeForMemory(memoryId, keepCharacterIds = []) {
    const keep = new Set(uniqueIds(keepCharacterIds));
    for (const characterId of this.listKnowledgeCharacterIds()) {
      if (keep.has(characterId)) continue;
      const records = this.getCharacterKnowledge(characterId);
      const remaining = records.filter((entry) => entry.memoryId !== memoryId);
      if (remaining.length !== records.length) this.writeJson(this.knowledgePath(characterId), remaining);
    }
  }

  findEpisodeByFinalization(conversationId, finalizationId) {
    if (!conversationId || !finalizationId) return null;
    return this.listAllEpisodes().find((episode) => episode.conversationId === conversationId && episode.finalizationId === finalizationId) || null;
  }

  knowledgePath(characterId) {
    return path.join(this.paths.knowledge, `${Number(characterId)}.json`);
  }

  getCharacterKnowledge(characterId) {
    const records = this.readJson(this.knowledgePath(characterId), []);
    return Array.isArray(records) ? records : [];
  }

  markKnownBy(characterId, memoryId, details = {}) {
    const numericId = Number(characterId);
    if (!Number.isFinite(numericId)) return null;
    const records = this.getCharacterKnowledge(numericId);
    const existingIndex = records.findIndex((entry) => entry.memoryId === memoryId);
    const record = {
      schemaVersion: 2,
      characterId: numericId,
      memoryId,
      awareness: details.awareness || "witnessed",
      confidence: Number.isFinite(Number(details.confidence)) ? Number(details.confidence) : 1,
      acquiredAt: details.acquiredAt ?? null,
      sourceCharacterId: Number.isFinite(Number(details.sourceCharacterId)) ? Number(details.sourceCharacterId) : null
    };
    if (existingIndex >= 0) records[existingIndex] = { ...records[existingIndex], ...record };
    else records.push(record);
    this.writeJson(this.knowledgePath(numericId), records);
    return record;
  }

  queryMemories({ characterId = null, type = null, subjectIds = [], participantIds = [], includeLegacy = false } = {}) {
    const knownIds = characterId == null ? null : new Set(this.getCharacterKnowledge(characterId).map((entry) => entry.memoryId));
    const subjects = new Set(uniqueIds(subjectIds));
    const participants = new Set(uniqueIds(participantIds));
    const results = [];
    for (const memoryId of Object.keys(this.index.memories)) {
      const memory = this.getMemory(memoryId);
      if (!memory) continue;
      const visibleWithoutKnowledge = memory.visibility === "public" || memory.visibility === "world";
      if (knownIds && !knownIds.has(memoryId) && !visibleWithoutKnowledge) continue;
      if (type && memory.type !== type) continue;
      if (subjects.size > 0 && !memory.subjects.some((id) => subjects.has(id))) continue;
      if (participants.size > 0 && !memory.participants.some((id) => participants.has(id))) continue;
      results.push(memory);
    }
    if (includeLegacy && characterId != null) results.push(...this.loadLegacyForCharacter(characterId));
    const deduped = new Map(results.map((entry) => [entry.memoryId, entry]));
    return [...deduped.values()];
  }

  getPairMemories(leftId, rightId, options = {}) {
    const ids = [Number(leftId), Number(rightId)].sort((a, b) => a - b);
    const memoryIds = this.readJson(path.join(this.paths.pairs, `${ids[0]}_${ids[1]}.json`), []);
    return memoryIds.map((memoryId) => this.getMemory(memoryId)).filter(Boolean).filter((memory) => {
      if (options.characterId == null || memory.visibility === "public" || memory.visibility === "world") return true;
      return this.getCharacterKnowledge(options.characterId).some((entry) => entry.memoryId === memory.memoryId);
    });
  }

  saveCharacterConsolidation(characterId, consolidation) {
    const filePath = path.join(this.paths.characters, `${Number(characterId)}.json`);
    this.writeJson(filePath, { schemaVersion: 2, characterId: Number(characterId), ...consolidation, updatedAt: new Date().toISOString() });
    return filePath;
  }

  getCharacterConsolidation(characterId) {
    return this.readJson(path.join(this.paths.characters, `${Number(characterId)}.json`), null);
  }

  loadLegacyForCharacter(characterId) {
    if (!this.legacySummariesDir || !fs.existsSync(this.legacySummariesDir)) return [];
    const prefix = `${Number(characterId)}_`;
    const folders = fs.readdirSync(this.legacySummariesDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.startsWith(prefix));
    const results = [];
    for (const folder of folders) {
      const folderPath = path.join(this.legacySummariesDir, folder.name);
      for (const file of fs.readdirSync(folderPath).filter((name) => name.endsWith(".json"))) {
        const summaries = this.readJson(path.join(folderPath, file), []);
        if (!Array.isArray(summaries)) continue;
        for (let index = 0; index < summaries.length; index++) {
          const summary = summaries[index];
          if (!summary || typeof summary.content !== "string") continue;
          const digest = crypto.createHash("sha1").update(`${characterId}|${file}|${index}|${summary.content}`).digest("hex").slice(0, 16);
          results.push(createMemoryRecord({
            schemaVersion: 1,
            memoryId: `legacy_${digest}`,
            type: "legacy_summary",
            subtype: "conversation_summary",
            eventDate: summary.date || null,
            totalDays: summary.totalDays,
            participants: [characterId, summary.characterId, summary.playerId],
            subjects: [summary.characterId],
            content: summary.content,
            canonicalText: summary.content,
            importance: 0.45,
            confidence: 0.7,
            source: "imported",
            visibility: "known_group",
            knownBy: [characterId],
            provenance: { extractionMode: "legacy_adapter", messageIds: [], speakerIds: [] }
          }));
        }
      }
    }
    return results;
  }
}

module.exports = { MemoryStore };
