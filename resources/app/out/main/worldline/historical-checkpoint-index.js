"use strict";

const fs = require("fs");
const path = require("path");
const { SCHEMA_VERSION } = require("./historical-query-projection");
const { normalizeGameDate } = require("./character-temporal-facts");
const MAX_INDEX_BYTES = 64 * 1024 * 1024;
const MAX_NODES = 2000;

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
    if (!fs.existsSync(this.file)) return { schemaVersion: SCHEMA_VERSION, ...this.scope, archiveRevision: 0, migrationCompleted: false, nodes: [] };
    try {
      const index = JSON.parse(boundedRead(this.file, MAX_INDEX_BYTES).toString("utf8"));
      if (index.schemaVersion !== SCHEMA_VERSION || index.campaignId !== this.scope.campaignId || index.branchId !== this.scope.branchId || !Array.isArray(index.nodes) || index.nodes.length > MAX_NODES || index.archiveRevision !== index.nodes.length) throw new Error("invalid_index");
      const dates = new Set();
      const checkpoints = new Set();
      for (const node of index.nodes) {
        const date = normalizeGameDate(node.gameDate);
        if (!date || date.canonical !== node.gameDate || node.totalDays !== date.serial || node.year !== date.year || dates.has(node.gameDate) || checkpoints.has(node.checkpointId) || !/^[a-f0-9]{24}$/.test(node.checkpointId || "") || node.file !== `${node.gameDate}_${node.checkpointId}.json.gz` || !/^[a-f0-9]{64}$/.test(node.sourceFingerprint || "") || !/^[a-f0-9]{64}$/.test(node.sha256 || "") || node.campaignId !== index.campaignId || node.branchId !== index.branchId || node.schemaVersion !== SCHEMA_VERSION || node.archiveRevision !== 1 || ![node.characterIds, node.titleIds, node.warIds].every(Array.isArray)) throw new Error("invalid_node_index");
        dates.add(node.gameDate);
        checkpoints.add(node.checkpointId);
      }
      return index;
    } catch (_error) { throw new Error("HISTORY_INDEX_CORRUPT"); }
  }

  find({ checkpointId, gameDate, characterId, limit = 20 } = {}) {
    return this.load().nodes.filter(node => (!checkpointId || node.checkpointId === checkpointId) && (!gameDate || node.gameDate === gameDate) && (!characterId || node.characterIds.includes(String(characterId)))).slice(-Math.min(100, Math.max(1, Number(limit) || 20)));
  }
}

module.exports = { HistoricalCheckpointIndex, MAX_INDEX_BYTES, MAX_NODES, boundedRead };
