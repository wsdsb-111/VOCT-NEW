"use strict";

const fs = require("fs");
const path = require("path");
const { assertScope, ids, sourceRevisionCurrent } = require("./memory4-contract");
const { assertNoLinks } = require("./scoped-path");

const AUDIT_LIMIT = 1000;
const AUDIT_REASONS = new Set([
  "memory4_scope_required", "memory4_symlink_path", "memory4_owner_folder_not_unique",
  "memory4_owner_sidecar_not_unique", "memory4_corrupt_json", "memory4_index_invalid",
  "memory4_index_missing_rebuild_required", "memory4_metadata_index_mismatch",
  "memory4_index_body_mismatch", "memory4_projection_forgotten", "memory4_known_index_invalid",
  "memory4_forgotten_projections_invalid", "memory4_entry_denied", "memory4_source_stale",
  "summary_mutation_in_progress", "memory4_candidate_stale", "memory4_invalid_entry_id"
]);

class ScopedJsonRepository {
  constructor({ memory4Store, memoryStore }) {
    if (!memory4Store || memory4Store.store !== memoryStore) throw new Error("memory4_repository_owner_required");
    this.memory4Store = memory4Store;
    this.memoryStore = memoryStore;
  }

  assertReadable(scope) {
    assertScope(scope);
    assertNoLinks(this.memoryStore.summaryMutationPath);
    if (this.memoryStore.summaryMutation || fs.existsSync(this.memoryStore.summaryMutationPath)) {
      throw new Error("summary_mutation_in_progress");
    }
  }

  queryCandidates(scope, filters = {}) {
    this.assertReadable(scope);
    return this.memory4Store.queryCandidates(scope, filters);
  }

  readEntry(scope, id, { candidates = null } = {}) {
    this.assertReadable(scope);
    const index = candidates ? this.memory4Store.validateCandidates(scope, candidates) : this.memory4Store.loadIndex(scope);
    if (candidates && !candidates.entryIds.includes(id)) throw new Error("memory4_candidate_not_selected");
    const entry = this.memory4Store.readEntry(scope, id, index);
    if (entry.deleted || !ids(entry.evidence?.knownBy).includes(scope.ownerId)
      || !["private", "participants", "known_group"].includes(entry.evidence?.visibility)) throw new Error("memory4_entry_denied");
    const metadata = this.memory4Store.read(path.join(this.memory4Store.directory(scope), "metadata.json"), null);
    if (!sourceRevisionCurrent(entry.source, scope, index, metadata)
      || entry.state?.source && !sourceRevisionCurrent(entry.state.source, scope, index, metadata)) throw new Error("memory4_source_stale");
    return entry;
  }

  readCandidateEntries(scope, candidates, entryIds = candidates?.entryIds) {
    this.assertReadable(scope);
    this.memory4Store.validateCandidates(scope, candidates);
    if (!Array.isArray(entryIds) || new Set(entryIds).size !== entryIds.length
      || entryIds.some(id => !candidates.entryIds.includes(id))) throw new Error("memory4_candidate_not_selected");
    return entryIds.map(id => this.readEntry(scope, id, { candidates }));
  }

  // The original Store remains the only writer and journal recovery authority.
  commitOwner(snapshot, result) {
    assertScope(snapshot);
    return this.memory4Store.commitOwner(snapshot, result);
  }

  updateEntry(scope, id, text, options) {
    assertScope(scope);
    return this.memory4Store.updateEntry(scope, id, text, options);
  }

  deleteEntry(scope, id, options) {
    assertScope(scope);
    return this.memory4Store.deleteEntry(scope, id, options);
  }

  audit(scope) {
    const report = { schemaVersion: 1, scopeLabel: "ANONYMIZED", result: "OK",
      counts: { entriesExamined: 0, hashMismatch: 0, forgottenCandidate: 0, unauthorized: 0 },
      reasonCodes: [], legacyAudit: "EXISTING_ORPHAN_AUDIT_REQUIRED" };
    const record = error => {
      const reason = AUDIT_REASONS.has(error.message) ? error.message : "MEMORY4_AUDIT_BLOCKED";
      if (!report.reasonCodes.includes(reason)) report.reasonCodes.push(reason);
      if (reason === "memory4_projection_forgotten") report.counts.forgottenCandidate++;
      else {
        report.result = "BLOCKED";
        if (reason === "memory4_index_body_mismatch") report.counts.hashMismatch++;
        if (reason === "memory4_entry_denied") report.counts.unauthorized++;
      }
    };
    try {
      this.assertReadable(scope);
      const store = this.memory4Store, index = store.loadIndex(scope);
      store.readKnownEntities(scope);
      const entryIds = Object.keys(index.entries);
      if (entryIds.length > AUDIT_LIMIT) {
        report.result = "DEGRADED";
        report.reasonCodes.push("AUDIT_LIMIT_REACHED");
      }
      for (const id of entryIds.slice(0, AUDIT_LIMIT)) {
        report.counts.entriesExamined++;
        try {
          const entry = store.readEntry(scope, id, index);
          if (!entry.deleted) this.readEntry(scope, id);
        } catch (error) { record(error); }
      }
      if (report.result === "OK" && report.counts.forgottenCandidate) report.result = "DEGRADED";
    } catch (error) { record(error); }
    return report;
  }
}

module.exports = { ScopedJsonRepository, AUDIT_LIMIT };
