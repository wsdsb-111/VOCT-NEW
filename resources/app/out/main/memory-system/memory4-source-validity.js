"use strict";

const { hash, ids, legacySourceHash, sourceRevisionCurrent } = require("./memory4-contract");

function memory4SourceValid({ store, baseStore, scope, row, index, metadata }) {
  if (!row || row.deleted || !ids(row.knownBy).includes(scope.ownerId)
    || !["private", "participants", "known_group"].includes(row.visibility)) return false;
  if (store.isEntryForgotten(scope, row)) return false;
  const record = index.finalizations[hash(row.finalizationId)];
  const revision = metadata?.knownEvidenceRevisions?.[hash([row.conversationId, scope.ownerId])];
  if (!record || revision && revision !== record.sourceRevision
    || row.stateSource && !sourceRevisionCurrent(row.stateSource, scope, index, metadata)
    || row.legacyMemoryIds?.length && row.legacyMemoryIds.length !== (row.legacyRefs || []).length) return false;
  return (row.legacyRefs || []).every(ref => {
    const memory = baseStore.getMemory(ref.memoryId);
    return memory && !memory.deleted && memory.provenance?.campaignToken === scope.campaignToken
      && memory.provenance?.folderOwnerId === scope.ownerId && ids(memory.knownBy).includes(scope.ownerId)
      && legacySourceHash(memory) === ref.sourceHash;
  });
}

module.exports = { memory4SourceValid };
