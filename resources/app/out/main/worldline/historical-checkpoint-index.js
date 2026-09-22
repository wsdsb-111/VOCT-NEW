"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const zlib = require("zlib");
const { SCHEMA_VERSION } = require("./historical-query-projection");
const { normalizeGameDate } = require("./character-temporal-facts");
const MAX_INDEX_BYTES = 64 * 1024 * 1024;
const MAX_NODES = 2000;
const MAX_NODE_BYTES = 256 * 1024 * 1024;
const INDEX_LAYOUT_VERSION = 2;

function scopeDirectory(root, scope) {
  if (!/^campaign_[a-f0-9]{64}$/.test(scope?.campaignId || "") || !/^branch_[a-f0-9-]{36}$/.test(scope?.branchId || "")) throw new Error("HISTORY_BRANCH_UNKNOWN");
  return path.join(root, "history", scope.campaignId, scope.branchId);
}

function boundedRead(file, limit) {
  const fd = fs.openSync(file, "r");
  try {
    const size = fs.fstatSync(fd).size;
    if (size > limit) throw new Error("HISTORY_READ_BOUND_EXCEEDED");
    const buffer = Buffer.alloc(size);
    let offset = 0;
    while (offset < size) {
      const count = fs.readSync(fd, buffer, offset, size - offset, offset);
      if (!count) throw new Error("HISTORY_READ_INCOMPLETE");
      offset += count;
    }
    return buffer;
  } finally { fs.closeSync(fd); }
}

class HistoricalCheckpointIndex {
  constructor(root, scope) {
    this.scope = { campaignId: scope?.campaignId, branchId: scope?.branchId };
    this.directory = scopeDirectory(root, scope);
    this.file = path.join(this.directory, "index.json");
  }

  load() {
    if (!fs.existsSync(this.file)) return { schemaVersion: SCHEMA_VERSION, indexLayoutVersion: INDEX_LAYOUT_VERSION, ...this.scope, archiveRevision: 0, migrationCompleted: false, nodes: [] };
    try {
      const index = JSON.parse(boundedRead(this.file, MAX_INDEX_BYTES).toString("utf8"));
      const needsMigration = index.indexLayoutVersion !== INDEX_LAYOUT_VERSION || index.nodes.some(node => Array.isArray(node?.characterIds) || Array.isArray(node?.titleIds) || Array.isArray(node?.warIds));
      if (index.schemaVersion !== SCHEMA_VERSION || index.campaignId !== this.scope.campaignId || index.branchId !== this.scope.branchId || !Array.isArray(index.nodes) || index.nodes.length > MAX_NODES || index.archiveRevision !== index.nodes.length || ![undefined, 1, INDEX_LAYOUT_VERSION].includes(index.indexLayoutVersion)) throw new Error("invalid_index");
      const dates = new Set();
      const checkpoints = new Set();
      const nodes = index.nodes.map(node => {
        const date = normalizeGameDate(node.gameDate);
        const legacyArrays = [node.characterIds, node.titleIds, node.warIds];
        const compactCounts = [node.characterCount, node.titleCount, node.warCount];
        const legacy = legacyArrays.every(Array.isArray);
        const compact = compactCounts.every(value => Number.isSafeInteger(value) && value >= 0);
        if (!legacy && !compact) throw new Error("invalid_node_counts");
        if (legacy && compactCounts.some((value, index) => value !== undefined && value !== legacyArrays[index].length)) throw new Error("invalid_node_count_mismatch");
        if (!date || date.canonical !== node.gameDate || node.totalDays !== date.serial || node.year !== date.year || dates.has(node.gameDate) || checkpoints.has(node.checkpointId) || !/^[a-f0-9]{24}$/.test(node.checkpointId || "") || node.file !== `${node.gameDate}_${node.checkpointId}.json.gz` || !/^[a-f0-9]{64}$/.test(node.sourceFingerprint || "") || !/^[a-f0-9]{64}$/.test(node.sha256 || "") || node.campaignId !== index.campaignId || node.branchId !== index.branchId || node.schemaVersion !== SCHEMA_VERSION || node.archiveRevision !== 1) throw new Error("invalid_node_index");
        dates.add(node.gameDate);
        checkpoints.add(node.checkpointId);
        const normalized = { ...node,
          characterCount: compactCounts[0] ?? legacyArrays[0].length,
          titleCount: compactCounts[1] ?? legacyArrays[1].length,
          warCount: compactCounts[2] ?? legacyArrays[2].length };
        delete normalized.characterIds;
        delete normalized.titleIds;
        delete normalized.warIds;
        return normalized;
      });
      const normalized = { ...index, indexLayoutVersion: INDEX_LAYOUT_VERSION, nodes };
      if (needsMigration) Object.defineProperty(normalized, "needsMigration", { value: true, enumerable: false });
      return normalized;
    } catch (_error) { throw new Error("HISTORY_INDEX_CORRUPT"); }
  }

  find({ checkpointId, gameDate, characterId, limit = 20 } = {}) {
    const index = this.load();
    const candidates = index.nodes.filter(node => (!checkpointId || node.checkpointId === checkpointId) && (!gameDate || node.gameDate === gameDate));
    if (!characterId) return candidates.slice(-Math.min(100, Math.max(1, Number(limit) || 20)));
    const target = String(characterId);
    return candidates.filter(node => this.nodeContainsCharacter(node, target)).slice(-Math.min(100, Math.max(1, Number(limit) || 20)));
  }

  nodeContainsCharacter(node, characterId) {
    try {
      const compressed = boundedRead(path.join(this.directory, node.file), MAX_INDEX_BYTES);
      if (crypto.createHash("sha256").update(compressed).digest("hex") !== node.sha256) return false;
      const projection = JSON.parse(zlib.gunzipSync(compressed, { maxOutputLength: MAX_NODE_BYTES }).toString("utf8"));
      return !!projection.characters && Object.hasOwn(projection.characters, characterId);
    } catch (_error) { return false; }
  }
}

module.exports = { HistoricalCheckpointIndex, INDEX_LAYOUT_VERSION, MAX_INDEX_BYTES, MAX_NODES, boundedRead };
