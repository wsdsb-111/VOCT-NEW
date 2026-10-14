"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { buildCoverageSummary, getCoveragePage } = require("../src/app/main/memory-system/memory4-coverage");
const { hash, legacySourceHash } = require("../src/app/main/memory-system/memory4-contract");
const { coverageProof } = require("../src/app/main/memory-system/memory4-evidence-planner");
const { createProjectionLineage } = require("../src/app/main/memory-system/memory4-forget");

const scope = { ownerId: 11, campaignToken: "coverage-test-campaign" };
const conversationId = "coverage-test-conversation";
const finalizationId = "coverage-test-finalization";
const sourceRevision = "a".repeat(64);
const lineage = createProjectionLineage({ campaignToken: scope.campaignToken, ownerId: scope.ownerId, counterpartId: 12,
  conversationId, finalizationId, segmentIds: ["seg-1"], legacyMemoryIds: ["legacy-fact-1"],
  sourceSegmentIds: ["seg-1"], sourceMessageIds: [7] });
const fact = { memoryId: "legacy-fact-1", version: 1, content: "The source statement.", knownBy: [scope.ownerId],
  provenance: { campaignToken: scope.campaignToken, folderOwnerId: scope.ownerId, sourceMessageIds: [7], sourceSegmentIds: ["seg-1"] } };
const summary = { memoryId: "legacy-summary-1", version: 1, content: "A legacy summary.", knownBy: [scope.ownerId],
  provenance: { campaignToken: scope.campaignToken, folderOwnerId: scope.ownerId, counterpartId: 12, conversationId,
    finalizationId, perspectiveMemoryIds: [fact.memoryId], projectionLineages: [lineage] } };
const proof = coverageProof({ ...scope, conversationId, finalizationId, sourceRevision, completeness: "complete",
  fragments: [{ fragmentId: "fragment-1", text: fact.content }] }, ["fragment-1"], 1);
const record = { status: "STORE", entryIds: ["m4_coverage_1"], sourceRevision, completeness: "complete",
  evaluatedFragmentCount: 1, extractionPolicyVersion: "9.3.3", coverageProof: proof };
const entry = { entryId: "m4_coverage_1", ownerId: scope.ownerId, campaignToken: scope.campaignToken, revision: 1,
  deleted: false, memoryType: "DURABLE_KNOWLEDGE", text: "Private durable text must not enter coverage DTO.",
  evidence: { knownBy: [scope.ownerId] },
  source: { finalizationId, conversationId, messageIds: [7], segmentIds: ["seg-1"], projectionLineages: [lineage],
    legacyRefs: [{ memoryId: fact.memoryId, sourceHash: legacySourceHash(fact), complete: true }] } };
const row = { entryId: entry.entryId, bodyHash: "b".repeat(64), revision: entry.revision, deleted: false,
  finalizationId, conversationId, visibility: "private", knownBy: [scope.ownerId], legacyMemoryIds: [fact.memoryId],
  legacyRefs: entry.source.legacyRefs };
const index = { ownerId: scope.ownerId, campaignToken: scope.campaignToken, revision: 4,
  finalizations: { [hash(finalizationId)]: record }, entries: { [entry.entryId]: row } };
const metadata = { knownEvidenceRevisions: { [hash([conversationId, scope.ownerId])]: sourceRevision } };
let forgotten = false;
const store = {
  isEntryForgotten: () => forgotten,
  isProjectionLineageForgotten: () => false,
  readEntry: (_scope, entryId) => {
    if (forgotten) throw new Error("memory4_projection_forgotten");
    assert.equal(entryId, entry.entryId);
    return entry;
  }
};
const baseStore = { getMemory: memoryId => memoryId === fact.memoryId ? fact : null };
const options = { scope, index, metadata, legacyMemories: [summary], getLegacyFacts: () => [fact], store, baseStore,
  legacyRevision: 5, forgetGeneration: 2, latestFinalizationId: finalizationId };

const built = buildCoverageSummary(options);
assert.equal(built.latest.durable.coverageState, "FULL_MODEL_EVALUATED");
assert.equal(built.latest.durable.sourceCountPrecision, "EXACT");
assert.equal(built.latest.durableOnly.relation, "DURABLE_ONLY");
assert.equal(built.latest.durableOnly.count, 0);
assert.equal(built.summaries[0].legacy.provenSourceLinkedCount, 1);
assert.equal(built.summaries[0].legacy.importantItemCount, 1);
let coverageBodyReads = 0;
const countingOptions = { ...options, store: { ...store, readEntry: (...args) => {
  coverageBodyReads++;
  return store.readEntry(...args);
} } };
buildCoverageSummary(countingOptions);
assert.equal(coverageBodyReads, 1, "coverage validates each bounded finalization body once per summary request");
const oversizedRecord = structuredClone(index);
oversizedRecord.finalizations[hash(finalizationId)].entryIds = Array(1000).fill(entry.entryId);
let invalidRecordReads = 0;
const invalidRecord = buildCoverageSummary({ ...options, index: oversizedRecord, store: { ...store,
  readEntry: () => { invalidRecordReads++; throw new Error("oversized canonical record must not read bodies"); } } });
assert.equal(invalidRecordReads, 0);
assert.equal(invalidRecord.latest.durable.commitState, "UNVERIFIED");
assert.equal(invalidRecord.latest.durable.sourceCountPrecision, "UNKNOWN");
const oversizedSummary = { ...summary, memoryId: "legacy-summary-oversized", provenance: { ...summary.provenance,
  perspectiveMemoryIds: Array.from({ length: 513 }, (_, index) => `legacy-${index}`) } };
let oversizedFactReads = 0;
const oversizedCoverage = buildCoverageSummary({ ...options, legacyMemories: [oversizedSummary], latestFinalizationId: null,
  getLegacyFacts: () => { oversizedFactReads++; throw new Error("oversized facts must not be loaded"); } });
assert.equal(oversizedFactReads, 0, "oversized legacy source maps are not expanded by coverage");
assert.equal(oversizedCoverage.legacy.importantItemCount, null, "oversized source denominators stay unknown");
const summaryHash = built.summaries[0].summaryHash;
const page = getCoveragePage({ ...options, finalizationId, legacyMemoryId: summary.memoryId,
  expectedIndexRevision: index.revision, expectedSummaryHash: summaryHash });
assert.equal(page.status, "OK");
assert.equal(page.items[0].relation, "LEGACY_SOURCE_EXACT");
assert.equal(page.items[0].semanticEquivalence, "NOT_ASSERTED");
assert.equal(page.items[0].durableEntries[0].bodyHash, row.bodyHash);
assert(!JSON.stringify(page).includes(entry.text), "coverage pages never return Durable private text");
coverageBodyReads = 0;
getCoveragePage({ ...countingOptions, finalizationId, legacyMemoryId: summary.memoryId });
assert.equal(coverageBodyReads, 1, "coverage pages reuse bounded finalization validation");
assert.equal(getCoveragePage({ ...options, finalizationId, legacyMemoryId: summary.memoryId,
  expectedIndexRevision: index.revision - 1 }).status, "STALE");
assert.equal(getCoveragePage({ ...options, finalizationId, legacyMemoryId: summary.memoryId,
  expectedIndexRevision: index.revision, expectedSummaryHash: "f".repeat(64) }).status, "STALE");
assert.throws(() => buildCoverageSummary({ ...options, scope: { ...scope, ownerId: 99 } }), /scope_mismatch/);

forgotten = true;
const forgottenSummary = buildCoverageSummary(options);
assert.equal(forgottenSummary.latest.durable.coverageState, "UNVERIFIED_LEGACY");
assert.equal(forgottenSummary.latest.durable.retractedCount, 1);
assert.equal(forgottenSummary.summaries[0].legacy.forgottenCount, 1);
assert(!JSON.stringify(forgottenSummary).includes(entry.text), "Forget never returns retracted body text");
forgotten = false;

const sharedFact = { memoryId: "legacy-shared-fact", version: 1, content: "Shared source statement.", knownBy: [scope.ownerId],
  provenance: { campaignToken: scope.campaignToken, folderOwnerId: scope.ownerId, sourceMessageIds: [9], sourceSegmentIds: ["legacy-shared-segment"] } };
const sharedLineage = createProjectionLineage({ campaignToken: scope.campaignToken, ownerId: scope.ownerId, counterpartId: 12,
  conversationId, finalizationId, segmentIds: ["shared-projection"], legacyMemoryIds: [sharedFact.memoryId],
  sourceSegmentIds: ["legacy-shared-segment"], sourceMessageIds: [9] });
const sharedSummary = { memoryId: "legacy-shared-summary", knownBy: [scope.ownerId], provenance: { campaignToken: scope.campaignToken,
  folderOwnerId: scope.ownerId, conversationId, finalizationId, counterpartId: 12, perspectiveMemoryIds: [sharedFact.memoryId],
  projectionLineages: [sharedLineage] } };
const sharedEntryId = "m4_" + "e".repeat(64);
const sharedRow = { entryId: sharedEntryId, bodyHash: "e".repeat(64), revision: 1, deleted: false, finalizationId, conversationId,
  visibility: "private", knownBy: [scope.ownerId], legacyRefs: [] };
const sharedIndex = { ownerId: scope.ownerId, campaignToken: scope.campaignToken, revision: 9,
  finalizations: { [hash(finalizationId)]: { status: "STORE", entryIds: [sharedEntryId], sourceRevision } }, entries: { [sharedEntryId]: sharedRow } };
const sharedMetadata = { knownEvidenceRevisions: { [hash([conversationId, scope.ownerId])]: sourceRevision } };
const sharedEntry = { entryId: sharedEntryId, ownerId: scope.ownerId, campaignToken: scope.campaignToken, revision: 1, deleted: false,
  text: "Private shared-source body.", evidence: { knownBy: [scope.ownerId] },
  source: { finalizationId, conversationId, messageIds: [9], segmentIds: ["legacy-shared-segment"], projectionLineages: [sharedLineage], legacyRefs: [] } };
const sharedOptions = { scope, index: sharedIndex, metadata: sharedMetadata, legacyMemories: [sharedSummary],
  getLegacyFacts: () => [sharedFact], store: { ...store, readEntry: () => sharedEntry }, baseStore };
const sharedPage = getCoveragePage({ ...sharedOptions, finalizationId, legacyMemoryId: sharedSummary.memoryId });
assert.equal(sharedPage.items[0].relation, "SHARED_FRAGMENT_SOURCE");
assert.equal(sharedPage.items[0].semanticEquivalence, "NOT_ASSERTED", "shared source does not assert semantic equivalence");
const forgedLineage = { ...sharedLineage, sourceMessageIds: [90], sourceSegmentIds: ["forged-segment"] };
const forgedEntry = { ...sharedEntry, source: { ...sharedEntry.source, messageIds: [10], segmentIds: ["different-segment"], projectionLineages: [forgedLineage] } };
const forgedPage = getCoveragePage({ ...sharedOptions, store: { ...store, readEntry: () => forgedEntry }, finalizationId,
  legacyMemoryId: sharedSummary.memoryId });
assert.equal(forgedPage.items[0].relation, "RELATED_FINALIZATION_ONLY",
  "same projection ID with altered source IDs cannot forge shared-source coverage");
assert.equal(forgedPage.durableOnly.count, 1, "unlinked valid Durable entries are reported separately as Durable-only");

const oldFinalizationId = "legacy-capped-finalization";
const oldSourceRevision = "c".repeat(64);
const oldEntryIds = Array.from({ length: 8 }, (_, index) => `m4_old_${index}`);
const oldEntries = Object.fromEntries(oldEntryIds.map((entryId, index) => [entryId, {
  entryId, ownerId: scope.ownerId, campaignToken: scope.campaignToken, revision: 1, deleted: false,
  memoryType: "DURABLE_KNOWLEDGE", text: `old-${index}`, evidence: { knownBy: [scope.ownerId] },
  source: { finalizationId: oldFinalizationId, conversationId, messageIds: [], segmentIds: [], legacyRefs: [] }
}]));
const oldRows = Object.fromEntries(oldEntryIds.map(entryId => [entryId, { entryId, bodyHash: "d".repeat(64), revision: 1,
  deleted: false, finalizationId: oldFinalizationId, conversationId, visibility: "private", knownBy: [scope.ownerId], legacyRefs: [] }]));
const oldIndex = { ownerId: scope.ownerId, campaignToken: scope.campaignToken, revision: 8, entries: oldRows,
  finalizations: { [hash(oldFinalizationId)]: { status: "STORE", entryIds: oldEntryIds, sourceRevision: oldSourceRevision,
    completeness: "complete", evaluatedFragmentCount: 38, extractionPolicyVersion: "9.3.2", extractionCoverage: "CAPPED" } } };
const oldStore = { ...store, readEntry: (_scope, id) => oldEntries[id] };
const oldMetadata = { knownEvidenceRevisions: { [hash([conversationId, scope.ownerId])]: oldSourceRevision } };
const oldLegacy = { ...summary, memoryId: "old-summary", provenance: { ...summary.provenance,
  finalizationId: oldFinalizationId, perspectiveMemoryIds: [] } };
const oldCoverage = buildCoverageSummary({ ...options, index: oldIndex, metadata: oldMetadata, store: oldStore,
  legacyMemories: [oldLegacy], latestFinalizationId: oldFinalizationId });
assert.equal(oldCoverage.latest.durable.coverageState, "CAPPED");
assert.equal(oldCoverage.latest.durable.capReached, true);
assert.equal(oldCoverage.latest.durable.sourceCountPrecision, "LEGACY_PARTIAL");
assert.equal(oldCoverage.latest.durable.sourceCounts.authorized, null);
assert.equal(oldCoverage.latest.durable.sourceCounts.planned, null);
assert.equal(oldCoverage.latest.durable.sourceCounts.modelEvaluated, 38);

const rendererPath = path.join(__dirname, "../src/app/renderer/memory4-manager.js");
const rendererSource = fs.readFileSync(rendererPath, "utf8");
const sandbox = { window: { conversationAPI: {} }, module: { exports: {} } };
vm.runInNewContext(rendererSource.replace("export function Memory4Manager", "function Memory4Manager")
  + "\nmodule.exports.Memory4Manager = Memory4Manager;", sandbox, { filename: rendererPath });
function render(tab, ownerData) {
  let stateIndex = 0;
  const react = { Fragment: "fragment", createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) }),
    useState: initial => [stateIndex++ === 0 ? tab : stateIndex === 2 ? ownerData : initial, () => {}],
    useRef: current => ({ current }), useEffect: () => {} };
  return sandbox.module.exports.Memory4Manager({ react, ownerId: scope.ownerId, refreshKey: 0 });
}
const nodes = (node, predicate) => !node || typeof node !== "object" ? [] : [ ...(predicate(node) ? [node] : []), ...(node.children || []).flatMap(child => nodes(child, predicate)) ];
const text = node => typeof node === "string" ? node : (node?.children || []).map(text).join("");
const defaultTree = render("known", null);
assert.deepEqual(nodes(defaultTree, node => node.type === "button" && node.props.role === "tab").map(node => text(node)),
  ["人物认知", "官方追忆", "详细长期记忆", "Legacy 对话摘要"]);
assert(!rendererSource.includes("updateYear") && !rendererSource.includes("updateLife")
  && !rendererSource.includes("cancelDerived"), "Renderer does not expose retired operations");
assert(rendererSource.includes("selection !== tabSelection.current")
  && rendererSource.includes("tabSelection.current++; setCoverageLoading(false); setEntityId(profile.entityId); setTab(\"detail\")"),
  "stale coverage entry responses cannot override explicit navigation to another pane");

const uiData = { ownerId: scope.ownerId, campaignToken: scope.campaignToken, contextId: "ctx", readOnlyArchive: false,
  indexRevision: index.revision, coverageSummary: { indexRevision: index.revision, offset: 0, total: 1,
    latest: { durable: built.latest.durable }, summaries: built.summaries, legacy: built.legacy, recovery: { pending: 0, manual: 0 } },
  detail: { total: 0, offset: 0, items: [] }, generation: { lastStatus: null }, known: { total: 0, offset: 0, items: [] },
  official: [], legacy: { total: 0, counts: {}, items: [], recompressionCoverage: { total: 0, offset: 0, items: [] } } };
const detailTree = render("detail", uiData);
assert(text(detailTree).includes("全部计划来源已通过模型评估；当前有效保存 1 条。"));
const legacyTree = render("legacy", uiData);
assert(text(legacyTree).includes("Legacy 来源关联"));
assert(text(legacyTree).includes("旧摘要重压缩状态"), "legacy recompression coverage remains separately labeled");
const css = fs.readFileSync(path.join(__dirname, "../src/app/renderer/memory4-manager.css"), "utf8");
assert(!css.includes("memory4-derived"), "retired Year/Life renderer styles are removed");
assert(fs.readFileSync(path.join(__dirname, "../src/app/preload/preload.js"), "utf8").includes("getMemory4Coverage"));
assert(fs.readFileSync(path.join(__dirname, "../src/app/main/ipc/register-ipc.js"), "utf8").includes("memory4:getCoverage"));

console.log("V9.3.3 Memory4 coverage/UI: PASS");
