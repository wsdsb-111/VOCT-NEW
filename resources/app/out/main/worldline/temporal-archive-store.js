"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const zlib = require("zlib");
const { HistoricalCheckpointIndex, MAX_INDEX_BYTES, MAX_NODES, boundedRead } = require("./historical-checkpoint-index");
const { SCHEMA_VERSION, digest, createHistoricalQueryProjection } = require("./historical-query-projection");
const { normalizeGameDate } = require("./character-temporal-facts");
const MAX_COMPRESSED_BYTES = 64 * 1024 * 1024;
const MAX_NODE_BYTES = 256 * 1024 * 1024;
const ACCEPTED_BRANCH_STATES = new Set(["SAME_BRANCH", "NEW_CAMPAIGN", "BRANCH_FORK_DETECTED", "BRANCH_RESUMED", "BRANCH_RENAMED"]);

function durableWrite(file, bytes) {
  const temporary = `${file}.${crypto.randomUUID()}.tmp`;
  let fd;
  try {
    fd = fs.openSync(temporary, "wx");
    fs.writeFileSync(fd, bytes);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(temporary, file);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

function validateArchiveInput({ checkpoint, scope, parserComplete, pipelineState, freshness, sourceMatches }) {
  const snapshot = checkpoint?.snapshot;
  if (!ACCEPTED_BRANCH_STATES.has(scope?.state) || scope.reason || !snapshot?.playthroughId || scope.campaignId !== `campaign_${digest(String(snapshot.playthroughId))}`) throw new Error("HISTORY_BRANCH_UNKNOWN");
  if (parserComplete !== true || pipelineState !== "ACTIVE" || checkpoint.state !== "ACTIVE" || !["FRESH", "AGING"].includes(freshness) || sourceMatches !== true) throw new Error("HISTORY_CHECKPOINT_INELIGIBLE");
  if (snapshot.schemaVersion !== 1 || !normalizeGameDate(snapshot.gameDate) || !/^[a-f0-9]{24}$/.test(checkpoint.id || "") || !/^[a-f0-9]{64}$/.test(checkpoint.source?.fingerprint || "") || checkpoint.source.fingerprint !== snapshot.contentFingerprint) throw new Error("HISTORY_SOURCE_INVALID");
  if (checkpoint.id !== digest(`${snapshot.playthroughId}|${snapshot.gameDate}|${snapshot.contentFingerprint}`).slice(0, 24)) throw new Error("HISTORY_SOURCE_INVALID");
  for (const [field, count, bound] of [["characters", "characterCount", 300000], ["titles", "titleCount", 100000], ["wars", "activeWarCount", 20000]]) {
    const records = snapshot[field];
    if (!records || typeof records !== "object" || Array.isArray(records) || Object.keys(records).length !== snapshot.diagnostics?.[count] || Object.keys(records).length > bound || Object.entries(records).some(([id, item]) => !item || typeof item !== "object" || Array.isArray(item) || String(item.id) !== id)) throw new Error("HISTORY_SNAPSHOT_INVALID");
  }
  if (!Object.keys(snapshot.characters).length || (snapshot.diagnostics?.missingFields || []).length) throw new Error("HISTORY_SNAPSHOT_INVALID");
}

class TemporalArchiveStore {
  constructor({ root, onDiagnostic = () => {} }) {
    this.root = root;
    this.onDiagnostic = onDiagnostic;
  }

  commit(input) {
    validateArchiveInput(input);
    const { checkpoint, scope } = input;
    const indexStore = new HistoricalCheckpointIndex(this.root, scope);
    fs.mkdirSync(indexStore.directory, { recursive: true });
    const lock = path.join(indexStore.directory, "commit.lock");
    const fd = fs.openSync(lock, "wx");
    try {
      const index = indexStore.load();
      const gameDate = normalizeGameDate(checkpoint.snapshot.gameDate).canonical;
      const existing = index.nodes.find(node => node.gameDate === gameDate);
      if (existing) {
        if (existing.sourceFingerprint !== checkpoint.source.fingerprint) throw new Error("HISTORY_SAME_DATE_REVISION_CONFLICT");
        if (!this.read(scope, existing.checkpointId)) throw new Error("HISTORY_CHECKPOINT_CORRUPT");
        return { status: "IDEMPOTENT", checkpointId: existing.checkpointId, nodeCount: index.nodes.length, migrationCompleted: true };
      }
      if (index.nodes.length >= MAX_NODES) throw new Error("HISTORY_INDEX_BOUND_EXCEEDED");
      const projection = createHistoricalQueryProjection(checkpoint, scope);
      const raw = Buffer.from(JSON.stringify(projection));
      if (raw.length > MAX_NODE_BYTES) throw new Error("HISTORY_NODE_BOUND_EXCEEDED");
      const bytes = zlib.gzipSync(raw);
      if (bytes.length > MAX_COMPRESSED_BYTES) throw new Error("HISTORY_NODE_BOUND_EXCEEDED");
      const { characters, titles, wars, ...metadata } = projection;
      const entry = { ...metadata, characterIds: Object.keys(characters), titleIds: Object.keys(titles), warIds: Object.keys(wars),
        file: `${gameDate}_${checkpoint.id}.json.gz`, sha256: digest(bytes) };
      const next = { ...index, archiveRevision: index.archiveRevision + 1, migrationCompleted: true, firstCheckpointId: index.firstCheckpointId || checkpoint.id, nodes: [...index.nodes, entry] };
      const indexBytes = Buffer.from(JSON.stringify(next));
      if (indexBytes.length > MAX_INDEX_BYTES) throw new Error("HISTORY_INDEX_BOUND_EXCEEDED");
      const file = path.join(indexStore.directory, entry.file);
      if (fs.existsSync(file)) {
        // An orphan after a failed index commit is reusable, never overwritten.
        if (digest(boundedRead(file, MAX_COMPRESSED_BYTES)) !== entry.sha256) throw new Error("HISTORY_IMMUTABLE_NODE_CONFLICT");
      } else durableWrite(file, bytes);
      this.commitIndex(indexStore.file, indexBytes);
      return { status: "COMMITTED", checkpointId: checkpoint.id, nodeCount: next.nodes.length, migrationCompleted: true };
    } finally { fs.closeSync(fd); fs.unlinkSync(lock); }
  }

  commitIndex(file, bytes) { durableWrite(file, bytes); }

  read(scope, checkpointId) {
    if (!/^[a-f0-9]{24}$/.test(checkpointId || "")) return null;
    try {
      const index = new HistoricalCheckpointIndex(this.root, scope);
      const entry = index.find({ checkpointId, limit: 1 })[0];
      if (!entry) return null;
      const compressed = boundedRead(path.join(index.directory, entry.file), MAX_COMPRESSED_BYTES);
      if (digest(compressed) !== entry.sha256) throw new Error("checksum_mismatch");
      const node = JSON.parse(zlib.gunzipSync(compressed, { maxOutputLength: MAX_NODE_BYTES }).toString("utf8"));
      for (const key of ["campaignId", "branchId", "checkpointId", "gameDate", "sourceFingerprint", "schemaVersion", "totalDays", "year"]) if (node[key] !== entry[key]) throw new Error("node_identity_mismatch");
      if (node.schemaVersion !== SCHEMA_VERSION || !["characters", "titles", "wars"].every(key => node[key] && typeof node[key] === "object" && !Array.isArray(node[key]))) throw new Error("node_invalid");
      return node;
    } catch (error) {
      this.onDiagnostic({ code: error.message === "HISTORY_INDEX_CORRUPT" ? error.message : "HISTORY_CHECKPOINT_CORRUPT", checkpointId });
      return null;
    }
  }
}

module.exports = { TemporalArchiveStore, validateArchiveInput, MAX_COMPRESSED_BYTES, MAX_NODE_BYTES };
