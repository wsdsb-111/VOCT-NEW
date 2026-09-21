"use strict";

const { HistoricalCheckpointIndex } = require("./historical-checkpoint-index");

function inspectTemporalArchive(store, scope) {
  const index = new HistoricalCheckpointIndex(store.root, scope).load();
  const latest = index.nodes.at(-1);
  return { status: "INSPECTED", campaignId: scope.campaignId, branchId: scope.branchId, nodeCount: index.nodes.length,
    archiveRevision: index.archiveRevision, migrationCompleted: index.migrationCompleted,
    latestReadable: latest ? !!store.read(scope, latest.checkpointId) : null,
    nodes: index.nodes.slice(-20).map(({ checkpointId, gameDate, sourceFingerprint, characterIds, titleIds, warIds }) => ({ checkpointId, gameDate, sourceFingerprint, characters: characterIds.length, titles: titleIds.length, wars: warIds.length })) };
}

module.exports = { inspectTemporalArchive };
