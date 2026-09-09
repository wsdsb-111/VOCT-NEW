"use strict";

const nodeFs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { normalizeGameDate } = require("./character-temporal-facts");
const { BOOLEAN_CLAIM_FIELDS, CURRENT_CLAIM_FIELDS, TEMPORAL_MODES, TEMPORAL_SEMANTICS } = require("./canon-contract");

const TYPES = new Set(["PLAYER_CANON", "RP_POLITICAL_DECISION", "SECRET_AGREEMENT", "NARRATIVE_EVENT", "WORLD_ANNOTATION", "MANUAL_CORRECTION", "PLANNED_DECISION"]);
const VISIBILITIES = new Set(["PUBLIC_WORLD", "REALM_PUBLIC", "COURT_PUBLIC", "PERSONAL", "SECRET"]);
const IMPORTANCES = new Set(["LOW", "NORMAL", "HIGH", "CRITICAL"]);
const STATUSES = new Set(["ACTIVE", "SUPERSEDED", "HIDDEN", "RETIRED", "CONFLICTED", "TEMPORAL_BLOCKED"]);
const WRITABLE = new Set(["NEW_CAMPAIGN", "SAME_BRANCH", "BRANCH_FORK_DETECTED", "BRANCH_RENAMED", "BRANCH_RESUMED"]);
const EDITABLE = new Set(["title", "content", "type", "entities", "entityRefs", "visibility", "importance", "gameDate", "totalDays", "validFrom", "validUntil", "status", "knownBy", "conflictKey", "revisionReason", "scopeEntityId", "currentClaim", "conversationStable", "temporalMode", "temporalSemantics", "legacyMigrationId", "legacyContentFingerprint"]);
const queues = new Map();
const clone = (value) => JSON.parse(JSON.stringify(value));
const hash = (value) => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
function canonicalizeGameDate(record) {
  if (record.gameDate === null || record.gameDate === undefined) return record;
  const normalized = normalizeGameDate(record.gameDate);
  return normalized ? { ...record, gameDate: normalized.canonical } : record;
}

function validate(record) {
  if (record.temporalMode != null && !TEMPORAL_MODES.has(record.temporalMode)) throw new Error("supplemental_temporal_mode_invalid");
  if (record.temporalSemantics != null && !TEMPORAL_SEMANTICS.has(record.temporalSemantics)) throw new Error("supplemental_temporal_semantics_invalid");
  if (record.temporalSemantics === "CURRENT_STRUCTURED_CLAIM" && !record.currentClaim) throw new Error("supplemental_current_claim_required");
  if (record.temporalSemantics && record.temporalSemantics !== "CURRENT_STRUCTURED_CLAIM" && record.currentClaim) throw new Error("supplemental_current_claim_semantics_invalid");
  if (record.temporalSemantics === "CURRENT_STRUCTURED_CLAIM" && record.temporalMode !== "CURRENT_DATE") throw new Error("supplemental_current_claim_requires_current_date");
  if (record.conversationStable != null && typeof record.conversationStable !== "boolean") throw new Error("supplemental_stable_flag_invalid");
  if (record.conversationStable === true && (!["WORLD_ANNOTATION", "RP_POLITICAL_DECISION"].includes(record.type) || !["HIGH", "CRITICAL"].includes(record.importance))) throw new Error("supplemental_stable_requires_high_priority_world_rule");
  if (record.scopeEntityId != null && (typeof record.scopeEntityId !== "string" || !/^\d+$/.test(record.scopeEntityId))) throw new Error("supplemental_scope_entity_invalid");
  if (record.currentClaim != null) {
    const claim = record.currentClaim;
    if (!claim || typeof claim !== "object" || !/^\d+$/.test(claim.entityId) || !CURRENT_CLAIM_FIELDS.has(claim.field) || typeof claim.value !== (BOOLEAN_CLAIM_FIELDS.has(claim.field) ? "boolean" : "string") || String(claim.value).length > 160 || claim.displayValue != null && (typeof claim.displayValue !== "string" || claim.displayValue.length > 160)) throw new Error("supplemental_current_claim_invalid");
  }
  if (typeof record.title !== "string" || !record.title.trim() || record.title.length > 160) throw new Error("supplemental_title_invalid");
  if (typeof record.content !== "string" || !record.content.trim() || record.content.length > 12000) throw new Error("supplemental_content_invalid");
  if (!TYPES.has(record.type) || !VISIBILITIES.has(record.visibility) || !IMPORTANCES.has(record.importance) || !STATUSES.has(record.status)) throw new Error("supplemental_enum_invalid");
  for (const field of ["entities", "entityRefs", "knownBy"]) {
    if (!Array.isArray(record[field]) || record[field].length > 32) throw new Error("supplemental_list_invalid");
  }
  if (!record.entities.every((item) => typeof item === "string" && /^\d+$/.test(item))) throw new Error("supplemental_entities_invalid");
  if (!record.entityRefs.every((item) => item && typeof item === "object" && ["character", "title"].includes(item.namespace) && typeof item.id === "string" && /^[a-zA-Z0-9_-]{1,100}$/.test(item.id))) throw new Error("supplemental_entity_refs_invalid");
  if (!record.knownBy.every((item) => typeof item === "string" && /^\d+$/.test(item))) throw new Error("supplemental_acl_invalid");
  if (record.type === "SECRET_AGREEMENT" && record.visibility !== "SECRET") throw new Error("supplemental_secret_visibility_required");
  if (["SECRET", "PERSONAL"].includes(record.visibility) && !record.knownBy.length) throw new Error("supplemental_acl_required");
  for (const field of ["totalDays", "validFrom", "validUntil"]) {
    if (record[field] !== null && (!Number.isSafeInteger(record[field]) || record[field] < 0)) throw new Error("supplemental_time_invalid");
  }
  if (record.validFrom !== null && record.validUntil !== null && record.validUntil < record.validFrom) throw new Error("supplemental_time_range_invalid");
  if (record.gameDate !== null && (typeof record.gameDate !== "string" || !normalizeGameDate(record.gameDate))) throw new Error("supplemental_date_invalid");
  if (record.conflictKey !== null && (typeof record.conflictKey !== "string" || record.conflictKey.length > 256)) throw new Error("supplemental_conflict_key_invalid");
  if (record.legacyMigrationId != null && (typeof record.legacyMigrationId !== "string" || !/^[a-f0-9-]{1,100}$/i.test(record.legacyMigrationId))) throw new Error("supplemental_legacy_migration_invalid");
  if (record.legacyContentFingerprint != null && (typeof record.legacyContentFingerprint !== "string" || !/^[a-f0-9]{64}$/.test(record.legacyContentFingerprint))) throw new Error("supplemental_legacy_migration_invalid");
  if (typeof record.revisionReason !== "string" || record.revisionReason.length > 500) throw new Error("supplemental_revision_reason_invalid");
}

function indexes(records) {
  const index = { byRecordId: {}, byEntityId: {}, byType: {}, byVisibility: {}, byImportance: {}, byGameDate: {}, byConflictKey: {} };
  const add = (field, key, id) => {
    if (key === null || key === undefined) return;
    if (!Object.hasOwn(index[field], key)) Object.defineProperty(index[field], key, { value: [], enumerable: true });
    index[field][key].push(id);
  };
  for (const record of records) {
    for (const [field, value] of [["byRecordId", record.recordId], ["byType", record.type], ["byVisibility", record.visibility], ["byImportance", record.importance], ["byGameDate", record.gameDate], ["byConflictKey", record.conflictKey]]) add(field, value, record.recordId);
    for (const entity of record.entities) add("byEntityId", entity, record.recordId);
  }
  return index;
}

class SupplementalStore {
  constructor({ root, fs = nodeFs, clock = () => new Date().toISOString() }) {
    if (!root) throw new Error("supplemental_root_required");
    this.root = path.resolve(root);
    this.fs = fs;
    this.clock = clock;
  }

  file(scope) {
    if (![scope?.campaignId, scope?.branchId].every((value) => typeof value === "string" && /^[a-zA-Z0-9_-]{1,100}$/.test(value))) throw new Error("supplemental_scope_invalid");
    return path.join(this.root, "campaigns", scope.campaignId, "branches", scope.branchId, "state.json");
  }

  read(scope) {
    const file = this.file(scope);
    let state;
    try { state = JSON.parse(this.fs.readFileSync(file, "utf8")); }
    catch (error) {
      if (error.code === "ENOENT") return { schemaVersion: 1, campaignId: scope.campaignId, branchId: scope.branchId, revision: 0, records: [], revisions: [] };
      throw new Error("supplemental_store_unreadable");
    }
    if (state.schemaVersion !== 1 || state.campaignId !== scope.campaignId || state.branchId !== scope.branchId || !Number.isSafeInteger(state.revision) || !Array.isArray(state.records) || !Array.isArray(state.revisions)) throw new Error("supplemental_store_invalid");
    const ids = new Set();
    const latest = new Map();
    for (const record of state.revisions) {
      validate(record);
      const previous = latest.get(record.recordId);
      if (record.campaignId !== scope.campaignId || record.branchId !== scope.branchId || record.revision !== (previous?.revision || 0) + 1 || record.previousRevisionHash !== (previous ? hash(previous) : null)) throw new Error("supplemental_revision_history_invalid");
      latest.set(record.recordId, record);
    }
    for (const record of state.records) {
      validate(record);
      if (record.campaignId !== scope.campaignId || record.branchId !== scope.branchId || !/^swm_[a-f0-9-]+$/.test(record.recordId) || ids.has(record.recordId) || !Number.isSafeInteger(record.revision) || record.revision < 1) throw new Error("supplemental_record_invalid");
      ids.add(record.recordId);
      if (!latest.has(record.recordId) || hash(latest.get(record.recordId)) !== hash(record)) throw new Error("supplemental_revision_history_invalid");
    }
    if (latest.size !== ids.size) throw new Error("supplemental_revision_history_invalid");
    return state;
  }

  commit(scope, state) {
    const file = this.file(scope);
    this.fs.mkdirSync(path.dirname(file), { recursive: true });
    const temp = `${file}.${crypto.randomUUID()}.tmp`;
    let fd;
    try {
      fd = this.fs.openSync(temp, "wx");
      this.fs.writeFileSync(fd, JSON.stringify({ ...state, index: indexes(state.records) }));
      this.fs.fsyncSync(fd);
      this.fs.closeSync(fd);
      fd = undefined;
      this.fs.renameSync(temp, file);
    } finally {
      if (fd !== undefined) this.fs.closeSync(fd);
      if (this.fs.existsSync(temp)) this.fs.unlinkSync(temp);
    }
  }

  transaction(scope, operation) {
    let key;
    try {
      key = this.file(scope);
      if (!WRITABLE.has(scope.state)) throw new Error("branch_write_blocked");
    } catch (error) { return Promise.reject(error); }
    const captured = { ...scope };
    const pending = (queues.get(key) || Promise.resolve()).catch(() => {}).then(() => {
      const state = this.read(captured);
      const result = operation(state);
      state.revision++;
      this.commit(captured, state);
      return clone(result);
    });
    queues.set(key, pending);
    pending.finally(() => { if (queues.get(key) === pending) queues.delete(key); }).catch(() => {});
    return pending;
  }

  create(scope, payload) {
    try { this.checkPayload(payload); payload = clone(payload); } catch (error) { return Promise.reject(error); }
    return this.transaction(scope, (state) => {
      this.checkPayload(payload);
      if (payload.legacyMigrationId) {
        const existing = state.records.find((record) => record.legacyMigrationId === payload.legacyMigrationId);
        if (existing) {
          if (existing.legacyContentFingerprint !== payload.legacyContentFingerprint) throw new Error("supplemental_legacy_migration_conflict");
          return existing;
        }
      }
      const timestamp = this.clock();
      const record = canonicalizeGameDate({ schemaVersion: 1, recordId: `swm_${crypto.randomUUID()}`, campaignId: state.campaignId, branchId: state.branchId, type: "PLAYER_CANON", entities: [], entityRefs: [], knownBy: [], visibility: "PUBLIC_WORLD", importance: "NORMAL", gameDate: null, totalDays: null, validFrom: null, validUntil: null, temporalMode: null, temporalSemantics: null, status: "ACTIVE", source: "PLAYER", createdBy: "PLAYER", conflictKey: null, supersedes: null, supersededBy: null, revision: 1, previousRevisionHash: null, revisionReason: "create", createdAt: timestamp, updatedAt: timestamp, ...clone(payload) });
      if (record.status !== "ACTIVE") throw new Error("supplemental_initial_status_invalid");
      validate(record);
      state.records.push(record);
      state.revisions.push(clone(record));
      return record;
    });
  }

  checkPayload(payload) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("supplemental_payload_invalid");
    for (const key of Object.keys(payload)) if (!EDITABLE.has(key)) throw new Error("supplemental_immutable_scope_or_field");
  }

  update(scope, id, payload, expectedRevision) {
    try { this.checkPayload(payload); payload = clone(payload); } catch (error) { return Promise.reject(error); }
    return this.transaction(scope, (state) => {
      this.checkPayload(payload);
      const index = state.records.findIndex((record) => record.recordId === id);
      if (index < 0) throw new Error("supplemental_not_found");
      const old = state.records[index];
      if (old.revision !== expectedRevision) throw new Error("supplemental_revision_conflict");
      if (old.status === "SUPERSEDED") throw new Error("supplemental_superseded_immutable");
      if (payload.status === "SUPERSEDED") throw new Error("supplemental_supersession_transaction_required");
      const record = canonicalizeGameDate({ ...old, ...clone(payload), revision: old.revision + 1, previousRevisionHash: hash(old), revisionReason: payload.revisionReason || "edit", updatedAt: this.clock() });
      validate(record);
      state.records[index] = record;
      state.revisions.push(clone(record));
      return record;
    });
  }

  supersede(scope, id, replacement, expectedRevision) {
    try { this.checkPayload(replacement); replacement = clone(replacement); } catch (error) { return Promise.reject(error); }
    return this.transaction(scope, (state) => {
      const index = state.records.findIndex((record) => record.recordId === id);
      if (index < 0) throw new Error("supplemental_not_found");
      const old = state.records[index];
      if (old.revision !== expectedRevision) throw new Error("supplemental_revision_conflict");
      if (old.status === "SUPERSEDED") throw new Error("supplemental_superseded_immutable");
      const timestamp = this.clock();
      const next = canonicalizeGameDate({ ...old, ...replacement, recordId: `swm_${crypto.randomUUID()}`, status: "ACTIVE", revision: 1, supersedes: old.recordId, supersededBy: null, previousRevisionHash: null, revisionReason: replacement.revisionReason || "supersede", createdAt: timestamp, updatedAt: timestamp });
      validate(next);
      const retired = { ...old, status: "SUPERSEDED", supersededBy: next.recordId, revision: old.revision + 1, previousRevisionHash: hash(old), revisionReason: "superseded", updatedAt: timestamp };
      state.records[index] = retired;
      state.records.push(next);
      state.revisions.push(clone(retired), clone(next));
      return next;
    });
  }

  list(scope, { includeInactive = false, offset = 0, limit = 50 } = {}) {
    const state = this.read(scope);
    const records = state.records.filter((record) => includeInactive || record.status === "ACTIVE");
    const start = Number.isSafeInteger(offset) && offset >= 0 ? offset : 0;
    const size = Number.isSafeInteger(limit) ? Math.max(1, Math.min(50, limit)) : 50;
    return { revision: state.revision, total: records.length, records: clone(records.slice(start, start + size)) };
  }

  history(scope, id, { offset = 0, limit = 20 } = {}) {
    const records = this.read(scope).revisions.filter((record) => record.recordId === id).sort((left, right) => right.revision - left.revision);
    const start = Number.isSafeInteger(offset) && offset >= 0 ? offset : 0;
    const size = Number.isSafeInteger(limit) ? Math.max(1, Math.min(20, limit)) : 20;
    return clone(records.slice(start, start + size));
  }
}

module.exports = { SupplementalStore };
