"use strict";

const fs = require("fs");
const path = require("path");
const { assertScope, hash, validateEntry } = require("./memory4-contract");
const { updateKnownEntities } = require("./memory4-visibility");
const { normalizeGameDate } = require("../worldline/character-temporal-facts");

const INDEX_KEYS = ["byCampaign", "byOwner", "byEntity", "byTopic", "byEventYear", "byEventDate", "byConversationYear", "byAcquiredYear", "byCounterpart", "byMemoryType", "byState", "bySourceFinalization"];

class Memory4Store {
  constructor(store) {
    this.store = store;
  }

  directory(scope) {
    assertScope(scope);
    if (!this.store.summaryFoldersDir) throw new Error("memory4_summary_root_missing");
    const root = path.resolve(this.store.summaryFoldersDir);
    const candidates = fs.existsSync(root) ? fs.readdirSync(root, { withFileTypes: true })
      .filter(entry => entry.isDirectory() && !entry.isSymbolicLink() && entry.name.startsWith(`${scope.ownerId}_`)) : [];
    if (candidates.length !== 1) throw new Error("memory4_owner_folder_not_unique");
    const directory = path.join(root, candidates[0].name, "memory4", hash(scope.campaignToken));
    // Do not follow a sidecar junction outside the summary tree.
    let checked = directory;
    while (checked !== root) {
      if (fs.existsSync(checked) && fs.lstatSync(checked).isSymbolicLink()) throw new Error("memory4_symlink_path");
      checked = path.dirname(checked);
    }
    return directory;
  }

  read(file, fallback) {
    if (!fs.existsSync(file)) return fallback;
    try { return JSON.parse(fs.readFileSync(file, "utf8")); }
    catch { throw new Error("memory4_corrupt_json"); }
  }

  loadIndex(scope) {
    const directory = this.directory(scope);
    const index = this.read(path.join(directory, "index.json"), null);
    if (!index) {
      if (fs.existsSync(path.join(directory, "metadata.json")) || fs.existsSync(path.join(directory, "entries"))) throw new Error("memory4_index_missing_rebuild_required");
      return { campaignToken: scope.campaignToken, ownerId: scope.ownerId, revision: 0, entries: {}, finalizations: {},
        ...Object.fromEntries(INDEX_KEYS.map(key => [key, {}])) };
    }
    if (index.campaignToken !== scope.campaignToken || index.ownerId !== scope.ownerId || !index.entries || !index.finalizations
      || INDEX_KEYS.some(key => !index[key] || typeof index[key] !== "object")) throw new Error("memory4_index_invalid");
    const metadata = this.read(path.join(directory, "metadata.json"), null);
    if (!metadata || metadata.campaignToken !== scope.campaignToken || metadata.ownerId !== scope.ownerId
      || metadata.indexHash !== hash(index) || metadata.revision !== index.revision) throw new Error("memory4_metadata_index_mismatch");
    return index;
  }

  entryPath(directory, id) {
    if (!/^m4_[a-f0-9]{64}$/.test(id)) throw new Error("memory4_invalid_entry_id");
    const entries = path.join(directory, "entries");
    const file = path.join(entries, `${id}.json`);
    for (const target of [entries, file]) {
      if (fs.existsSync(target) && fs.lstatSync(target).isSymbolicLink()) throw new Error("memory4_symlink_path");
    }
    return file;
  }

  reindex(index) {
    for (const key of INDEX_KEYS) index[key] = {};
    const add = (axis, key, id) => {
      if (key == null) return;
      const value = String(key);
      if (!Object.hasOwn(index[axis], value)) Object.defineProperty(index[axis], value, { value: [], enumerable: true, writable: true, configurable: true });
      index[axis][value].push(id);
    };
    for (const [id, row] of Object.entries(index.entries)) {
      if (row.deleted) continue;
      add("byCampaign", index.campaignToken, id); add("byOwner", index.ownerId, id);
      for (const entity of row.entityIds) add("byEntity", entity, id);
      for (const topic of row.topics) add("byTopic", topic, id);
      for (const counterpart of row.counterpartIds) add("byCounterpart", counterpart, id);
      if (row.eventTime.precision === "day") add("byEventDate", row.eventTime.from, id);
      if (row.eventTime.from) {
        const first = Number(row.eventTime.from.split(".")[0]);
        const last = Number(row.eventTime.to.split(".")[0]);
        for (let year = first; year <= last; year++) add("byEventYear", year, id);
      }
      add("byConversationYear", row.conversationDate?.split(".")[0], id);
      add("byAcquiredYear", row.acquiredDate?.split(".")[0], id);
      add("byMemoryType", row.memoryType, id); add("byState", row.status, id);
      add("bySourceFinalization", row.finalizationId, id);
    }
  }

  recordKnownEvidence(snapshot) {
    assertScope(snapshot);
    if (!snapshot.conversationId || !snapshot.sourceRevision) throw new Error("memory4_source_identity_missing");
    const index = this.loadIndex(snapshot);
    const directory = this.directory(snapshot);
    const metadata = this.read(path.join(directory, "metadata.json"), null);
    const evidenceKey = hash([snapshot.conversationId, snapshot.ownerId]);
    if (metadata?.knownEvidenceRevisions?.[evidenceKey] === snapshot.sourceRevision) return { alreadyRecorded: true };
    const known = updateKnownEntities(this.read(path.join(directory, "known-entities.json"), null), snapshot);
    index.revision++;
    const now = new Date().toISOString();
    this.store.withSummaryMutation(null, () => {
      this.store.writeJson(path.join(directory, "known-entities.json"), known);
      const affected = Object.keys(index.entries).filter(id => index.entries[id].conversationId === snapshot.conversationId);
      const derived = this.derived?.markDirty(snapshot, { index, metadata, entryIds: affected }) || {};
      this.store.writeJson(path.join(directory, "metadata.json"), { ...metadata, memory4SchemaVersion: 1,
        campaignToken: snapshot.campaignToken, ownerId: snapshot.ownerId, revision: index.revision, indexHash: hash(index),
        knownEvidenceRevisions: { ...metadata?.knownEvidenceRevisions, [evidenceKey]: snapshot.sourceRevision },
        ...derived, updatedAt: now });
      this.store.writeJson(path.join(directory, "index.json"), index);
    });
    return { alreadyRecorded: false, entityCount: Object.keys(known.entities).length };
  }

  commitOwner(snapshot, result) {
    assertScope(snapshot);
    if (!snapshot.finalizationId || !snapshot.conversationId || !snapshot.sourceRevision) throw new Error("memory4_source_identity_missing");
    if (!["STORE", "NO_DURABLE_CONTENT", "NOT_PRESENT"].includes(result?.status)) throw new Error("memory4_invalid_result_status");
    if (!Array.isArray(result.entries) || result.entries.length > 8 || (result.status === "STORE") !== (result.entries.length > 0)) throw new Error("memory4_invalid_result_entries");
    const hasSource = snapshot.presentMessageCount > 0 || snapshot.fragments.length > 0;
    if (result.status === "NOT_PRESENT" && hasSource || result.status !== "NOT_PRESENT" && !hasSource) throw new Error("memory4_presence_result_mismatch");
    if (!["complete", "partial"].includes(snapshot.completeness)) throw new Error("memory4_visibility_incomplete");
    const index = this.loadIndex(snapshot);
    const key = hash(snapshot.finalizationId);
    const committed = index.finalizations[key];
    if (committed) {
      if (committed.sourceRevision !== snapshot.sourceRevision) throw new Error("memory4_source_revision_conflict");
      return { ...committed, alreadyCommitted: true };
    }
    const entries = result.entries.map(candidate => validateEntry(candidate, snapshot));
    if (new Set(entries.map(entry => entry.entryId)).size !== entries.length) throw new Error("memory4_duplicate_fact");
    const directory = this.directory(snapshot);
    const metadata = this.read(path.join(directory, "metadata.json"), null);
    if (metadata && (metadata.campaignToken !== snapshot.campaignToken || metadata.ownerId !== snapshot.ownerId)) throw new Error("memory4_scope_mismatch");
    const now = new Date().toISOString();
    const record = { status: result.status, entryIds: entries.map(entry => entry.entryId), sourceRevision: snapshot.sourceRevision, committedAt: now,
      completeness: snapshot.completeness, visibilityEvidence: snapshot.visibilityEvidence || null,
      evaluatedFragmentCount: snapshot.fragments.length, legacyRetained: snapshot.legacyRetained === true,
      noDetailIsNotUnknown: true };
    this.store.withSummaryMutation(null, () => {
      for (const entry of entries) {
        // Tombstones survive re-extraction; a stale job cannot resurrect a fact.
        if (index.entries[entry.entryId]?.deleted) continue;
        this.store.writeJson(this.entryPath(directory, entry.entryId), entry);
        index.entries[entry.entryId] = this.indexRow(entry);
      }
      index.finalizations[key] = record;
      index.revision++;
      this.reindex(index);
      const priorKnown = this.read(path.join(directory, "known-entities.json"), null);
      const known = snapshot.skipKnownEvidence ? priorKnown || { campaignToken: snapshot.campaignToken, ownerId: snapshot.ownerId, revision: 0, entities: {} }
        : updateKnownEntities(priorKnown, snapshot);
      this.store.writeJson(path.join(directory, "known-entities.json"), known);
      const derived = this.derived?.markDirty(snapshot, { index, metadata, entryIds: entries.map(entry => entry.entryId) }) || {};
      this.store.writeJson(path.join(directory, "metadata.json"), { ...metadata, memory4SchemaVersion: 1, campaignToken: snapshot.campaignToken,
        ownerId: snapshot.ownerId, revision: index.revision, indexHash: hash(index), lastFinalizationId: snapshot.finalizationId,
        knownEvidenceRevisions: { ...metadata?.knownEvidenceRevisions, [hash([snapshot.conversationId, snapshot.ownerId])]: snapshot.sourceRevision },
        derivedDirty: entries.length > 0 || metadata?.derivedDirty === true, ...derived, updatedAt: now });
      this.store.writeJson(path.join(directory, "index.json"), index);
    });
    this.store.invalidateFolderSummaryCache([snapshot.ownerId]);
    return record;
  }

  indexRow(entry) {
    return { revision: entry.revision, entityIds: entry.entityIds, topics: entry.topics, counterpartIds: entry.counterpartIds,
      eventTime: entry.eventTime, conversationDate: entry.conversationDate, acquiredDate: entry.acquiredDate,
      memoryType: entry.memoryType, status: entry.state.status, finalizationId: entry.source.finalizationId,
      conversationId: entry.source.conversationId, legacyRefs: entry.source.legacyRefs || [],
      legacyMemoryIds: entry.source.legacyMemoryIds || [],
      knownBy: entry.evidence.knownBy, visibility: entry.evidence.visibility, importance: entry.importance,
      supportedByEntryIds: entry.state.supportedByEntryIds, supersedesEntryIds: entry.state.supersedesEntryIds,
      deleted: entry.deleted, bodyHash: hash(entry) };
  }

  getKnownEntityEvidence(scope, entityId, options = null) {
    assertScope(scope);
    if (!options?.readContext) this.loadIndex(scope);
    const known = options?.readContext?.known || this.read(path.join(this.directory(scope), "known-entities.json"), null);
    if (known && (known.campaignToken !== scope.campaignToken || known.ownerId !== scope.ownerId || !known.entities)) throw new Error("memory4_known_index_invalid");
    const entity = known?.entities?.[String(entityId)];
    if (!entity) return { status: "UNKNOWN", reason: "INSUFFICIENT_EVIDENCE", entityId, completeness: "partial" };
    if (options) {
      const current = normalizeGameDate(options.currentGameDate);
      const metadata = options.readContext?.metadata || this.read(path.join(this.directory(scope), "metadata.json"), null);
      const contributions = current ? Object.entries(entity.evidenceByConversation || {}).filter(([conversationId, evidence]) => {
        const date = normalizeGameDate(evidence.date);
        return date && date.serial <= current.serial && evidence.sourceRevision
          && evidence.sourceRevision === metadata?.knownEvidenceRevisions?.[hash([conversationId, scope.ownerId])];
      }).map(([, evidence]) => evidence) : [];
      if (!contributions.length) return { status: "UNKNOWN", reason: "INSUFFICIENT_EVIDENCE", entityId, completeness: "partial" };
      const directConversationCount = contributions.filter(evidence => evidence.types?.includes("direct_conversation")).length;
      const sharedSceneCount = contributions.filter(evidence => evidence.types?.includes("shared_scene")).length;
      const mentionCount = contributions.filter(evidence => evidence.types?.includes("mention")).length;
      const dates = contributions.map(evidence => normalizeGameDate(evidence.date)).sort((a, b) => a.serial - b.serial);
      return { ...entity, status: directConversationCount > 0 ? "DIRECT_INTERACTION" : sharedSceneCount > 0 ? "SHARED_SCENE" : "MENTION_ONLY",
        directConversationCount, sharedSceneCount, mentionCount, firstSeenDate: dates[0].canonical, lastSeenDate: dates.at(-1).canonical };
    }
    return { status: entity.directConversationCount > 0 ? "DIRECT_INTERACTION" : entity.sharedSceneCount > 0 ? "SHARED_SCENE" : "MENTION_ONLY", ...entity };
  }

  query(scope, filters = {}) {
    const index = this.loadIndex(scope);
    let selected = new Set(index.byOwner[String(scope.ownerId)] || []);
    for (const [axis, value] of Object.entries(filters)) {
      if (!INDEX_KEYS.includes(axis)) throw new Error("memory4_invalid_index_axis");
      const allowed = new Set(Object.hasOwn(index[axis], String(value)) ? index[axis][String(value)] : []);
      if (axis === "byEventDate") {
        const target = normalizeGameDate(value);
        if (!target) throw new Error("memory4_invalid_event_date");
        for (const [id, row] of Object.entries(index.entries)) {
          if (!row.deleted && row.eventTime.precision === "range"
            && normalizeGameDate(row.eventTime.from)?.serial <= target.serial
            && normalizeGameDate(row.eventTime.to)?.serial >= target.serial) allowed.add(id);
        }
      }
      selected = new Set([...selected].filter(id => allowed.has(id)));
    }
    const directory = this.directory(scope);
    return [...selected].map(id => {
      if (!/^m4_[a-f0-9]{64}$/.test(id)) throw new Error("memory4_invalid_entry_id");
      const entry = this.read(this.entryPath(directory, id), null);
      if (!entry || entry.entryId !== id || entry.ownerId !== scope.ownerId || entry.campaignToken !== scope.campaignToken
        || entry.deleted || hash(entry) !== index.entries[id]?.bodyHash) throw new Error("memory4_index_body_mismatch");
      return entry;
    });
  }

  readEntry(scope, id, index = this.loadIndex(scope)) {
    const row = index.entries[id];
    const entry = this.read(this.entryPath(this.directory(scope), id), null);
    if (!row || !entry || entry.entryId !== id || entry.ownerId !== scope.ownerId || entry.campaignToken !== scope.campaignToken
      || entry.revision !== row.revision || entry.deleted !== row.deleted || hash(entry) !== row.bodyHash) throw new Error("memory4_index_body_mismatch");
    return entry;
  }

  updateEntry(scope, entryId, text, { expectedRevision } = {}) {
    if (typeof text !== "string" || !text.trim() || text.length > 65536) throw new Error("memory4_entry_text_invalid");
    const index = this.loadIndex(scope), entry = this.readEntry(scope, entryId, index);
    if (entry.deleted || !Number.isInteger(expectedRevision) || entry.revision !== expectedRevision) throw new Error("memory4_entry_edit_stale");
    const directory = this.directory(scope), metadata = this.read(path.join(directory, "metadata.json"), null);
    entry.text = text.trim(); entry.revision++; entry.updatedAt = new Date().toISOString();
    entry.edit = { mode: "manual_override", editedAt: entry.updatedAt, editedBy: "user" };
    index.entries[entryId] = this.indexRow(entry); index.revision++; this.reindex(index);
    this.store.withSummaryMutation(null, () => {
      this.store.writeJson(this.entryPath(directory, entryId), entry);
      const derived = this.derived?.markDirty(scope, { index, metadata, entryIds: [entryId] }) || {};
      this.store.writeJson(path.join(directory, "metadata.json"), { ...metadata, revision: index.revision, indexHash: hash(index), derivedDirty: true, ...derived });
      this.store.writeJson(path.join(directory, "index.json"), index);
    });
    this.store.invalidateFolderSummaryCache([scope.ownerId]);
    return { success: true, entryId, revision: entry.revision };
  }

  deleteEntry(scope, entryId, { expectedRevision } = {}) {
    if (!/^m4_[a-f0-9]{64}$/.test(entryId)) throw new Error("memory4_invalid_entry_id");
    const index = this.loadIndex(scope);
    if (!index.entries[entryId] || index.entries[entryId].deleted) return false;
    const directory = this.directory(scope);
    const file = this.entryPath(directory, entryId);
    const entry = this.read(file, null);
    if (!entry || entry.ownerId !== scope.ownerId || entry.campaignToken !== scope.campaignToken || hash(entry) !== index.entries[entryId].bodyHash) throw new Error("memory4_index_body_mismatch");
    if (expectedRevision != null && entry.revision !== expectedRevision) throw new Error("memory4_entry_edit_stale");
    entry.deleted = true; entry.revision++; entry.updatedAt = new Date().toISOString();
    index.entries[entryId] = this.indexRow(entry);
    index.revision++;
    this.reindex(index);
    const metadata = this.read(path.join(directory, "metadata.json"), null);
    if (!metadata) throw new Error("memory4_metadata_missing");
    this.store.withSummaryMutation(null, () => {
      this.store.writeJson(file, entry);
      const derived = this.derived?.markDirty(scope, { index, metadata, entryIds: [entryId] }) || {};
      this.store.writeJson(path.join(directory, "metadata.json"), { ...metadata, revision: index.revision, indexHash: hash(index), derivedDirty: true, ...derived });
      this.store.writeJson(path.join(directory, "index.json"), index);
    });
    this.store.invalidateFolderSummaryCache([scope.ownerId]);
    return true;
  }
}

module.exports = { Memory4Store, INDEX_KEYS };
