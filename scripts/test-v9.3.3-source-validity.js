"use strict";

const assert = require("node:assert/strict");
const { memory4SourceValid } = require("../src/app/main/memory-system/memory4-source-validity");
const { hash, legacySourceHash } = require("../src/app/main/memory-system/memory4-contract");
const scope = { ownerId: 2, campaignToken: "fixture-campaign" };
const fact = { memoryId: "legacy-fact", content: "独立合成来源", knownBy: [2],
  provenance: { campaignToken: scope.campaignToken, folderOwnerId: 2 } };
const revision = "a".repeat(64);
const row = { knownBy: [2], visibility: "private", conversationId: "conversation", finalizationId: "finalization",
  legacyMemoryIds: [fact.memoryId], legacyRefs: [{ memoryId: fact.memoryId, sourceHash: legacySourceHash(fact) }] };
const index = { finalizations: { [hash(row.finalizationId)]: { sourceRevision: revision } } };
const metadata = { knownEvidenceRevisions: { [hash([row.conversationId, 2])]: revision } };
const base = () => ({ scope, row: structuredClone(row), index: structuredClone(index), metadata: structuredClone(metadata),
  store: { isEntryForgotten: () => false }, baseStore: { getMemory: () => fact } });
const cases = [
  ["authorized independent Legacy source", data => {}, true],
  ["deleted source row", data => { data.row.deleted = true; }, false],
  ["other Owner knowledge", data => { data.row.knownBy = [3]; }, false],
  ["unrecognized visibility", data => { data.row.visibility = "public"; }, false],
  ["Forget revoked source", data => { data.store.isEntryForgotten = () => true; }, false],
  ["missing canonical finalization", data => { data.index.finalizations = {}; }, false],
  ["changed evidence revision", data => { data.metadata.knownEvidenceRevisions[hash([row.conversationId, 2])] = "b".repeat(64); }, false],
  ["Legacy reference cardinality", data => { data.row.legacyMemoryIds.push("unproven"); }, false],
  ["missing Legacy source", data => { data.baseStore.getMemory = () => null; }, false],
  ["deleted Legacy source", data => { data.baseStore.getMemory = () => ({ ...fact, deleted: true }); }, false],
  ["cross Campaign source", data => { data.baseStore.getMemory = () => ({ ...fact,
    provenance: { ...fact.provenance, campaignToken: "foreign" } }); }, false],
  ["cross Owner source", data => { data.baseStore.getMemory = () => ({ ...fact,
    provenance: { ...fact.provenance, folderOwnerId: 3 } }); }, false],
  ["Legacy knownBy revoked", data => { data.baseStore.getMemory = () => ({ ...fact, knownBy: [3] }); }, false],
  ["edited Legacy source hash", data => { data.baseStore.getMemory = () => ({ ...fact, content: "新内容" }); }, false],
  ["historical predicate retains missing-revision compatibility", data => { data.metadata = {}; }, true]
];
for (const [name, change, expected] of cases) {
  const data = base(); change(data); assert.equal(memory4SourceValid(data), expected, name);
}
console.log(`V9.3.3 source validity frozen contract: ${cases.length}/${cases.length} PASS`);
