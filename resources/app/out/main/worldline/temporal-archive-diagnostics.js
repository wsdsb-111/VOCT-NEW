"use strict";

const { HistoricalCheckpointIndex } = require("./historical-checkpoint-index");

function inspectTemporalArchive(store, scope) {
  const index = new HistoricalCheckpointIndex(store.root, scope).load();
  const latest = index.nodes.at(-1);
  return { status: "INSPECTED", campaignId: scope.campaignId, branchId: scope.branchId, nodeCount: index.nodes.length,
    archiveRevision: index.archiveRevision, indexLayoutVersion: index.indexLayoutVersion, migrationCompleted: index.migrationCompleted,
    latestReadable: latest ? !!store.read(scope, latest.checkpointId) : null,
    nodes: index.nodes.slice(-20).map(({ checkpointId, gameDate, sourceFingerprint, characterCount, titleCount, warCount }) => ({ checkpointId, gameDate, sourceFingerprint, characters: characterCount, titles: titleCount, wars: warCount })) };
}

module.exports = { inspectTemporalArchive };
