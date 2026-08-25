"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { createMemoryRecord, uniqueIds } = require("./memory-types");
const { CURRENT_MEMORY_SCHEMA_VERSION } = require("./memory-schema");

function removeDirectoryTree(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const child = path.join(directory, entry.name);
    if (entry.isDirectory() && !entry.isSymbolicLink()) removeDirectoryTree(child);
    else fs.unlinkSync(child);
  }
  fs.rmdirSync(directory);
}

function mergeCharacterProfiles(...groups) {
  const profiles = new Map();
  for (const profile of groups.flat()) {
    const id = Number(profile?.id ?? profile?.characterId);
    if (!Number.isFinite(id)) continue;
    const previous = profiles.get(id) || { id };
    const next = { ...previous };
    for (const key of ["name", "shortName", "firstName", "fullName", "primaryTitle", "heldCourtAndCouncilPositions", "titleRankConcept"]) {
      if (profile?.[key]) next[key] = profile[key];
    }
    profiles.set(id, next);
  }
  return [...profiles.values()];
}

class MemoryStore {
  constructor({ baseDir, summaryFoldersDir = null, recoveryDir = null } = {}) {
    if (!baseDir) throw new Error("memory_store_base_dir_required");
    this.baseDir = baseDir;
    this.summaryFoldersDir = summaryFoldersDir;
    this.paths = {
      episodes: path.join(baseDir, "episodes"),
      characters: path.join(baseDir, "characters"),
      pairs: path.join(baseDir, "pairs"),
      knowledge: path.join(baseDir, "knowledge"),
      ownerStatus: path.join(baseDir, "owner-status"),
      recovery: recoveryDir || path.join(baseDir, "recovery"),
      index: path.join(baseDir, "index.json")
    };
    this.ensureDirectories();
    this.index = this.readJson(this.paths.index, { schemaVersion: CURRENT_MEMORY_SCHEMA_VERSION, memories: {}, episodes: {} });
    this.folderSummaryCache = new Map();
  }

  ensureDirectories() {
    for (const directory of [this.baseDir, this.paths.episodes, this.paths.characters, this.paths.pairs, this.paths.knowledge, this.paths.ownerStatus, this.paths.recovery]) {
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
    const record = { schemaVersion: CURRENT_MEMORY_SCHEMA_VERSION, ...episode };
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
      schemaVersion: CURRENT_MEMORY_SCHEMA_VERSION,
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

  queryMemories({ characterId = null, type = null, subjectIds = [], participantIds = [], includeFolderSummaries = false } = {}) {
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
    if (includeFolderSummaries && characterId != null) results.push(...this.loadFolderSummariesForCharacter(characterId));
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
    this.writeJson(filePath, { schemaVersion: CURRENT_MEMORY_SCHEMA_VERSION, characterId: Number(characterId), ...consolidation, updatedAt: new Date().toISOString() });
    return filePath;
  }

  getCharacterConsolidation(characterId) {
    return this.readJson(path.join(this.paths.characters, `${Number(characterId)}.json`), null);
  }

  deleteOwnedSummaryFolders(characterId) {
    const numericId = Number(characterId);
    if (!Number.isFinite(numericId)) throw new Error("character_id_required");
    this.invalidateFolderSummaryCache([numericId]);
    if (!this.summaryFoldersDir || !fs.existsSync(this.summaryFoldersDir)) return { removedFolderCount: 0 };
    const root = path.resolve(this.summaryFoldersDir);
    const prefix = `${numericId}_`;
    const folders = fs.readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.startsWith(prefix));
    for (const folder of folders) {
      const target = path.resolve(root, folder.name);
      if (path.dirname(target) !== root) throw new Error("unsafe_summary_folder_target");
      removeDirectoryTree(target);
    }
    return { removedFolderCount: folders.length };
  }

  summaryOwnerStatusPath(characterId) {
    return path.join(this.paths.ownerStatus, `${Number(characterId)}.json`);
  }

  markSummaryOwnerDeceased(characterId, details = {}) {
    const numericId = Number(characterId);
    if (!Number.isFinite(numericId)) throw new Error("character_id_required");
    const record = {
      schemaVersion: CURRENT_MEMORY_SCHEMA_VERSION,
      characterId: numericId,
      status: "deceased",
      reason: details.reason || "dead",
      markedAt: details.markedAt || new Date().toISOString()
    };
    this.writeJson(this.summaryOwnerStatusPath(numericId), record);
    return record;
  }

  reviveSummaryOwner(characterId) {
    const numericId = Number(characterId);
    if (!Number.isFinite(numericId)) throw new Error("character_id_required");
    const filePath = this.summaryOwnerStatusPath(numericId);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    return { characterId: numericId, status: "active" };
  }

  isSummaryOwnerDeceased(characterId) {
    return this.readJson(this.summaryOwnerStatusPath(characterId), null)?.status === "deceased";
  }

  getSummaryFolderProfile(characterId) {
    const numericId = Number(characterId);
    if (!Number.isFinite(numericId) || !this.summaryFoldersDir || !fs.existsSync(this.summaryFoldersDir)) return null;
    const prefix = `${numericId}_`;
    const folders = fs.readdirSync(this.summaryFoldersDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.startsWith(prefix))
      .map((entry) => entry.name.slice(prefix.length).trim())
      .filter(Boolean)
      .sort((left, right) => left.length - right.length || left.localeCompare(right));
    return folders.length > 0 ? { id: numericId, name: folders[0], shortName: folders[0] } : null;
  }

  invalidateFolderSummaryCache(characterIds = null) {
    if (characterIds == null) {
      this.folderSummaryCache.clear();
      return;
    }
    for (const characterId of uniqueIds(characterIds)) this.folderSummaryCache.delete(characterId);
  }

  loadFolderSummariesForCharacter(characterId) {
    const ownerId = Number(characterId);
    if (!Number.isFinite(ownerId)) return [];
    if (this.folderSummaryCache.has(ownerId)) return this.folderSummaryCache.get(ownerId).slice();
    if (!this.summaryFoldersDir || !fs.existsSync(this.summaryFoldersDir)) {
      this.folderSummaryCache.set(ownerId, []);
      return [];
    }
    const prefix = `${ownerId}_`;
    const folders = fs.readdirSync(this.summaryFoldersDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.startsWith(prefix));
    const sessions = new Map();
    for (const folder of folders) {
      const folderPath = path.join(this.summaryFoldersDir, folder.name);
      for (const file of fs.readdirSync(folderPath).filter((name) => name.endsWith(".json"))) {
        const summaries = this.readJson(path.join(folderPath, file), []);
        if (!Array.isArray(summaries)) continue;
        for (let index = 0; index < summaries.length; index++) {
          const summary = summaries[index];
          if (!summary || typeof summary.content !== "string") continue;
          const playerId = Number(summary.playerId);
          const summaryCharacterId = Number(summary.characterId);
          const counterpartId = playerId === ownerId && Number.isFinite(summaryCharacterId) ? summaryCharacterId : summaryCharacterId === ownerId && Number.isFinite(playerId) ? playerId : Number.isFinite(summaryCharacterId) ? summaryCharacterId : null;
          const filenameMatch = file.match(/^与(.+)的对话\.json$/);
          const counterpartName = filenameMatch?.[1] || summary.characterName || null;
          const participantProfiles = Array.isArray(summary.participants) ? summary.participants : [];
          const summaryProfiles = mergeCharacterProfiles(
            participantProfiles,
            [{ id: playerId, name: summary.playerName, shortName: summary.playerName }],
            [{ id: summaryCharacterId, name: summary.characterName, shortName: summary.characterName }]
          );
          const participants = uniqueIds([
            ownerId,
            counterpartId,
            playerId,
            summaryCharacterId,
            ...participantProfiles.map((participant) => participant && typeof participant === "object" ? participant.id ?? participant.characterId : participant)
          ]);
          const participantNames = participantProfiles.flatMap((participant) => participant && typeof participant === "object" ? [participant.name, participant.shortName, participant.fullName] : []).filter(Boolean);
          const finalizationId = summary.finalizationId || null;
          const sessionKey = finalizationId ? `${ownerId}|${finalizationId}` : `${ownerId}|${summary.date || ""}|${summary.totalDays ?? ""}|${summary.content}`;
          const digest = crypto.createHash("sha1").update(sessionKey).digest("hex").slice(0, 16);
          const existing = sessions.get(sessionKey);
          if (existing) {
            existing.participants = uniqueIds([...existing.participants, ...participants]);
            existing.subjects = uniqueIds([...existing.subjects, ...participants.filter((id) => id !== ownerId)]);
            existing.tags = [...new Set([...existing.tags, counterpartName, ...participantNames].filter(Boolean))];
            existing.provenance.conversationFiles = [...new Set([...existing.provenance.conversationFiles, file])];
            existing.provenance.counterpartIds = uniqueIds([...existing.provenance.counterpartIds, counterpartId]);
            existing.provenance.counterpartNames = [...new Set([...existing.provenance.counterpartNames, counterpartName].filter(Boolean))];
            existing.provenance.participantProfiles = mergeCharacterProfiles(existing.provenance.participantProfiles || [], summaryProfiles);
            continue;
          }
          sessions.set(sessionKey, createMemoryRecord({
            schemaVersion: CURRENT_MEMORY_SCHEMA_VERSION,
            memoryId: `folder_${digest}`,
            type: "folder_summary",
            subtype: "conversation_summary",
            eventDate: summary.date || null,
            totalDays: summary.totalDays,
            participants,
            subjects: participants.filter((id) => id !== ownerId),
            content: summary.content,
            canonicalText: summary.content,
            importance: summary.pinned === true ? 0.95 : 0.65,
            confidence: 0.9,
            source: "imported",
            visibility: "known_group",
            knownBy: [ownerId],
            tags: [counterpartName, ...participantNames].filter(Boolean),
            provenance: {
              finalizationId,
              folderOwnerId: ownerId,
              folderName: folder.name,
              conversationFile: file,
              conversationFiles: [file],
              counterpartId,
              counterpartName,
              counterpartIds: [counterpartId],
              counterpartNames: [counterpartName],
              participantProfiles: summaryProfiles,
              extractionMode: summary.engineVersion === "2.4" ? "folder_summary_v2_4" : summary.engineVersion === "2.3" ? "folder_summary_v2_3" : "folder_summary_v2_1",
              perspectiveMemoryIds: summary.perspectiveMemoryIds || [],
              projectionHash: summary.projectionHash || null,
              messageIds: [],
              speakerIds: []
            },
            status: summary.open === true ? "open" : null
          }));
        }
      }
    }
    const memories = [...sessions.values()];
    this.folderSummaryCache.set(ownerId, memories);
    return memories.slice();
  }

  loadDirectPairSummaries(ownerId, counterpartId, ownerMemories = null) {
    const numericCounterpartId = Number(counterpartId);
    if (!Number.isFinite(numericCounterpartId)) return [];
    const memories = Array.isArray(ownerMemories) ? ownerMemories : this.loadFolderSummariesForCharacter(ownerId);
    return memories.filter((memory) => {
      const ids = uniqueIds([memory.provenance?.counterpartId, ...(memory.provenance?.counterpartIds || [])]);
      return ids.includes(numericCounterpartId);
    });
  }

  searchOwnerFolderForEntity(ownerId, entityId, entityNames = [], ownerMemories = null) {
    const numericEntityId = Number(entityId);
    const names = [...new Set((entityNames || []).map((name) => String(name || "").trim()).filter(Boolean))];
    const memories = Array.isArray(ownerMemories) ? ownerMemories : this.loadFolderSummariesForCharacter(ownerId);
    return memories.filter((memory) => {
      const counterpartIds = uniqueIds([memory.provenance?.counterpartId, ...(memory.provenance?.counterpartIds || [])]);
      if (Number.isFinite(numericEntityId) && (counterpartIds.includes(numericEntityId) || memory.participants.includes(numericEntityId) || memory.subjects.includes(numericEntityId))) return true;
      if (names.length === 0) return false;
      const searchable = [
        memory.content,
        memory.canonicalText,
        ...(memory.tags || []),
        memory.provenance?.counterpartName,
        ...(memory.provenance?.counterpartNames || []),
        ...(memory.provenance?.conversationFiles || [])
      ].filter(Boolean).join("\n");
      return names.some((name) => searchable.includes(name));
    });
  }

}

module.exports = { MemoryStore };
