"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const versionPath = require.resolve("../src/app/main/version");
require.cache[versionPath] = { exports: require("../resources/app/out/main/version") };

const { MemoryStore } = require("../src/app/main/memory-system/memory-store");
const { Memory4Coordinator } = require("../src/app/main/memory-system/memory4-coordinator");
const { hash, legacySourceHash } = require("../src/app/main/memory-system/memory4-contract");
const { createProjectionLineage } = require("../src/app/main/memory-system/memory4-forget");
const { planEvidence, coverageProof, validCoverageProof } = require("../src/app/main/memory-system/memory4-evidence-planner");
const { buildCoverageSummary, getCoveragePage } = require("../src/app/main/memory-system/memory4-coverage");

const temporaryRoot = fs.mkdtempSync(path.join(__dirname, ".tmp-votc-v933-independent-qa-"));
const OWNER_ID = 2;
const COUNTERPART_ID = 1;
let sequence = 0;
let failures = 0;
let passed = 0;

function fragment(id, text, overrides = {}) {
  const messageId = Number(id.replace(/\D/g, "")) || 1;
  return { fragmentId: id, messageId, sourceMessageIds: [messageId], text,
    speakerId: OWNER_ID, speakerIds: [OWNER_ID], sourceTextVerified: true, sourceRole: "assistant",
    presentIds: [OWNER_ID, COUNTERPART_ID], knownBy: [OWNER_ID, COUNTERPART_ID], visibility: "participants",
    sourceType: "spoken", recipientIds: [COUNTERPART_ID], entityIds: [COUNTERPART_ID],
    visibilityEvidence: "application_fragment", ...overrides };
}

function snapshot(label, fragments, { ownerId = OWNER_ID, campaignToken = `campaign-${label}`,
  finalizationId = `finalization-${label}`, date = "1181.1.1" } = {}) {
  return { campaignToken, ownerId, conversationId: `conversation-${label}`, finalizationId,
    episodeId: `episode-${label}`, date, totalDays: 431000,
    sourceRevision: hash([campaignToken, ownerId, finalizationId, fragments]), presentMessageCount: fragments.length,
    completeness: "complete", summaryIds: [], counterpartIds: [COUNTERPART_ID], fragments,
    projectionLineages: [], activeCommitments: [], relationshipChangeEntityIds: [], entityNameEvidence: [], relationshipEvidence: [],
    skipKnownEvidence: true };
}

function fixture(label) {
  const directory = path.join(temporaryRoot, `${label}-${++sequence}`);
  const summaryFoldersDir = path.join(directory, "summaries");
  for (const ownerId of [1, 2, 3, 9]) fs.mkdirSync(path.join(summaryFoldersDir, `${ownerId}_fixture`), { recursive: true });
  const baseStore = new MemoryStore({ baseDir: path.join(directory, "memory"), summaryFoldersDir });
  const coordinator = new Memory4Coordinator(baseStore);
  return { directory, summaryFoldersDir, baseStore, coordinator };
}

function candidate(source, text) {
  const observedDate = source.sourceType === "witnessed" && source.eventDate;
  return { memoryType: "DURABLE_KNOWLEDGE", text, fragmentIds: [source.fragmentId],
    entityIds: [COUNTERPART_ID], participantIds: [OWNER_ID, COUNTERPART_ID], topics: [],
    eventTime: observedDate ? { from: observedDate, to: observedDate, precision: "day", status: "observed" }
      : { from: null, to: null, precision: "unknown", status: "reported" } };
}

function coverageProvenanceFixture(label) {
  const { coordinator, baseStore } = fixture(label);
  const scope = { campaignToken: `campaign-${label}`, ownerId: OWNER_ID };
  const factsBySummary = new Map();

  function addLegacy({ label: itemLabel, conversationId, finalizationId, messageId, segmentId,
    includeLineage = true, lineageOwnerId = OWNER_ID, lineageCampaignToken = scope.campaignToken }) {
    const fact = baseStore.saveMemory({ memoryId: `legacy-fact-${itemLabel}`, type: "folder_summary",
      subtype: "conversation_summary", content: `Legacy fact ${itemLabel}`, eventDate: "1181.1.1",
      participants: [OWNER_ID, COUNTERPART_ID], subjects: [OWNER_ID], knownBy: [OWNER_ID],
      visibility: "known_group", source: "imported", tags: [],
      provenance: { campaignToken: scope.campaignToken, campaignBinding: { status: "bound" },
        folderOwnerId: OWNER_ID, counterpartId: COUNTERPART_ID, counterpartIds: [COUNTERPART_ID],
        sourceMessageIds: [messageId], sourceSegmentIds: [segmentId] } });
    const lineage = includeLineage ? createProjectionLineage({ campaignToken: lineageCampaignToken,
      ownerId: lineageOwnerId, conversationId, finalizationId, counterpartId: COUNTERPART_ID,
      legacyMemoryIds: [fact.memoryId], sourceMessageIds: [messageId], sourceSegmentIds: [segmentId] }) : null;
    const summary = { memoryId: `legacy-summary-${itemLabel}`, content: `Legacy summary ${itemLabel}`,
      finalizationId, conversationId, knownBy: [OWNER_ID], perspectiveMemoryIds: [fact.memoryId],
      provenance: { campaignToken: scope.campaignToken, folderOwnerId: OWNER_ID, counterpartId: COUNTERPART_ID,
        counterpartIds: [COUNTERPART_ID], conversationId, finalizationId, perspectiveMemoryIds: [fact.memoryId],
        projectionLineages: lineage ? [lineage] : [] } };
    factsBySummary.set(summary.memoryId, [fact]);
    return { fact, lineage, summary };
  }

  function commitSource({ label: itemLabel, conversationId, finalizationId, messageId, segmentId,
    projectionLineages = [] }) {
    const source = fragment(segmentId, `Durable source ${itemLabel}`, { messageId, sourceMessageIds: [messageId] });
    const current = { ...snapshot(itemLabel, [source], { campaignToken: scope.campaignToken, finalizationId }),
      conversationId, projectionLineages };
    const committed = coordinator.store.commitOwner(current, { status: "STORE", entries: [candidate(source, source.text)] });
    assert.equal(committed.entryIds.length, 1, `fixture ${itemLabel} must commit one Durable entry`);
    return committed.entryIds[0];
  }

  function args(legacyMemories, overrides = {}) {
    const index = coordinator.store.loadIndex(scope);
    const metadata = coordinator.store.read(path.join(coordinator.store.directory(scope), "metadata.json"), null);
    return { scope, index, metadata, legacyMemories,
      getLegacyFacts: (_scope, memory) => factsBySummary.get(memory.memoryId) || [],
      store: coordinator.store, baseStore, legacyRevision: 1, forgetGeneration: 0, ...overrides };
  }

  return { scope, coordinator, baseStore, addLegacy, commitSource, args };
}

function resigned(proof, changes) {
  const { checksum: _checksum, ...body } = proof;
  return { ...body, ...changes, checksum: hash({ ...body, ...changes }) };
}

async function check(name, run) {
  try {
    await run();
    passed++;
    console.log(`PASS ${name}`);
  } catch (error) {
    failures++;
    console.error(`FAIL ${name}: ${error?.stack || error}`);
  }
}

async function testPlannerPreservesSourceIdentityAndRanksLateConsequences() {
  const chatter = Array.from({ length: 96 }, (_, index) => fragment(`f-${index}`, "你好。", {
    messageId: index + 1, sourceMessageIds: [index + 1], speakerId: index % 2 ? OWNER_ID : COUNTERPART_ID,
    speakerIds: [index % 2 ? OWNER_ID : COUNTERPART_ID]
  }));
  const sameTextDifferentSource = fragment("f-same-text", "同一句话仍有独立来源。", { messageId: 97 });
  const sameTextDifferentSpeaker = fragment("f-same-text-other-speaker", "同一句话仍有独立来源。", {
    messageId: 98, speakerId: COUNTERPART_ID, speakerIds: [COUNTERPART_ID]
  });
  const lateEvent = fragment("f-late-event", "昨夜旧约已正式取消，全部条件一并作废。", { messageId: 99 });
  const source = [...chatter, sameTextDifferentSource, sameTextDifferentSpeaker, lateEvent];
  const value = snapshot("planner-identity", source);
  const before = structuredClone(value);
  const plan = planEvidence(value);

  assert.deepEqual(value, before, "planning cannot mutate private source text, scope, or authorization");
  assert.deepEqual([...plan.orderedFragmentIds].sort(), source.map(row => row.fragmentId).sort(),
    "planning may rank sources but must not remove or merge source identities");
  assert.equal(new Set(plan.orderedFragmentIds).size, source.length);
  assert.equal(plan.authorizedSourceCount, source.length);
  assert.equal(plan.screenedSourceCount, source.length);
  assert.equal(plan.plannedSourceCount, source.length);
  assert.equal(plan.locallyExcludedSourceCount, 0);
  assert.equal(plan.orderedFragmentIds[0], lateEvent.fragmentId, "late high-consequence evidence must outrank early chatter");
  assert.deepEqual(plan.originalOrder, source.map(row => row.fragmentId));
  assert.equal(plan.rows.find(row => row.fragmentId === lateEvent.fragmentId).originalIndex, source.length - 1);
  assert.equal(plan.rows.find(row => row.fragmentId === lateEvent.fragmentId).priority, "P0");
  assert.equal(plan.rows.find(row => row.fragmentId === "f-same-text-other-speaker").fragmentId, "f-same-text-other-speaker");
}

async function testCoverageProofRejectsFalseFullAndForgedCounts() {
  const sources = Array.from({ length: 5 }, (_, index) => fragment(`proof-${index}`, `第${index}条授权来源。`));
  const current = snapshot("proof-contract", sources);
  const entryIds = ["entry-1"];
  const record = { sourceRevision: current.sourceRevision, evaluatedFragmentCount: 3, entryIds };
  const partial = coverageProof(current, sources.slice(0, 3).map(row => row.fragmentId), entryIds.length);
  assert.equal(partial.coverageState, "PARTIAL_SOURCE");
  assert.equal(partial.unmodeledSourceCount, 2);
  assert.equal(validCoverageProof(partial, record, current), true);
  assert.equal(validCoverageProof(partial, record), true, "canonical proof must also be valid without a live snapshot");

  const falseFull = resigned(partial, { coverageState: "FULL_MODEL_EVALUATED", unmodeledSourceCount: 0 });
  assert.equal(validCoverageProof(falseFull, record, current), false,
    "an authenticated checksum cannot turn an incompletely evaluated plan into FULL");
  assert.equal(validCoverageProof(falseFull, record), false,
    "record-only validation must reject inconsistent state/count combinations");
  const localSkip = resigned(partial, { locallyExcludedSourceCount: 1, plannedSourceCount: 4,
    modelEvaluatedSourceCount: 4, unmodeledSourceCount: 0, evaluatedSourceIds: sources.slice(0, 4).map(row => row.fragmentId),
    coverageState: "FULL_MODEL_EVALUATED" });
  assert.equal(validCoverageProof(localSkip, { ...record, evaluatedFragmentCount: 4 }, current), false,
    "local skips must never be counted as model-evaluated FULL coverage");
  const wrongSource = resigned(partial, { evaluatedSourceIds: [...partial.evaluatedSourceIds.slice(0, 2), "foreign-source"] });
  assert.equal(validCoverageProof(wrongSource, record, current), false,
    "proof source IDs must belong to the current authorized snapshot");
  assert.equal(validCoverageProof(resigned(partial, { ownerId: OWNER_ID + 1 }), record, current), false,
    "proofs are bound to their Owner");
  assert.equal(validCoverageProof(resigned(partial, { campaignToken: "foreign-campaign" }), record, current), false,
    "proofs are bound to their Campaign");
  assert.equal(validCoverageProof(resigned(partial, { finalizationId: "foreign-finalization" }), record, current), false,
    "proofs are bound to their finalization");
  assert.equal(validCoverageProof(resigned(partial, { sourceRevision: hash("stale revision") }), record, current), false,
    "proofs are bound to their source revision");
  assert.equal(validCoverageProof(resigned(partial, { sourceDigest: "a".repeat(64) }), record, current), false,
    "a well-formed but forged source digest is rejected against the current snapshot");
  assert.equal(validCoverageProof(resigned(partial, { committedEntryCount: 2 }), record, current), false,
    "proof committed-entry count must agree with the canonical commit record");
  const fractionalCount = resigned(partial, { modelEvaluatedSourceCount: 3.5 });
  assert.equal(validCoverageProof(fractionalCount, record, current), false, "source counts must be whole numbers");
  assert.equal(validCoverageProof({ ...partial, checksum: "0".repeat(64) }, record, current), false,
    "a checksum mismatch must fail closed");
}

async function testCheckpointPlanTamperCannotReuseOldLeaves() {
  const { coordinator } = fixture("checkpoint-plan");
  const source = [fragment("checkpoint-a", "你好。"), fragment("checkpoint-b", "昨夜发生了秘密泄露。")];
  const current = snapshot("checkpoint-plan", source);
  const fresh = coordinator.restoreDurableCheckpoint(current, {});
  assert.equal(fresh.plannerVersion, planEvidence(current).version);
  assert.deepEqual(fresh.orderedFragmentIds, planEvidence(current).orderedFragmentIds);

  const changedPlan = { ...fresh, orderedFragmentIds: [...fresh.orderedFragmentIds].reverse(), chunks: [] };
  const reset = coordinator.restoreDurableCheckpoint(current, { extractionCheckpoint: changedPlan });
  assert.deepEqual(reset.orderedFragmentIds, fresh.orderedFragmentIds,
    "a plan change must discard prior leaves and reconstruct the canonical plan");
  assert.deepEqual(reset.chunks, []);

  const corrupt = { ...fresh, chunks: [{ sources: [], result: {}, digest: "bad" }] };
  assert.throws(() => coordinator.restoreDurableCheckpoint(current, { extractionCheckpoint: corrupt }),
    /memory4_checkpoint_corrupt/);
}

async function testLegacyCappedCommitRemainsProvenButNewCoverageIsUnknown() {
  const { coordinator } = fixture("legacy-capped");
  const sources = Array.from({ length: 10 }, (_, index) => fragment(`legacy-cap-${index}`, `历史来源 ${index}。`));
  const current = snapshot("legacy-capped", sources);
  const result = coordinator.store.commitOwner(current, { status: "STORE",
    entries: sources.slice(0, 8).map((source, index) => candidate(source, `已提交的旧条目 ${index}。`)),
    evaluatedFragmentCount: 4, extractionPolicyVersion: "9.3.2" });
  assert.equal(result.entryIds.length, 8);
  const proof = coordinator.inspectCommittedSnapshot(current);
  assert.equal(proof.state, "COMMITTED", `legacy V9.3.2 CAPPED proof must remain valid: ${proof.reason || ""}`);
  const record = coordinator.store.loadIndex(current).finalizations[hash(current.finalizationId)];
  assert.equal(record.extractionCoverage, "CAPPED");
  assert.equal(record.evaluatedFragmentCount, 4);
  assert.equal(record.coverageProof, undefined, "old records must not be fabricated into a V9.3.3 plan");
  const scope = { campaignToken: current.campaignToken, ownerId: current.ownerId };
  const index = coordinator.store.loadIndex(scope);
  const metadata = coordinator.store.read(path.join(coordinator.store.directory(scope), "metadata.json"), null);
  const summary = buildCoverageSummary({ scope, index, metadata, store: coordinator.store, baseStore: coordinator.baseStore,
    latestFinalizationId: current.finalizationId });
  const durable = summary.latest.durable;
  assert.equal(durable.coverageState, "CAPPED");
  assert.equal(durable.sourceCountPrecision, "LEGACY_PARTIAL");
  assert.equal(durable.sourceCounts.modelEvaluated, 4, "only the historical raw evaluated count is reportable");
  for (const name of ["authorized", "screened", "planned", "unmodeled", "locallyExcluded", "noiseLikely", "uncertain"]) {
    assert.equal(durable.sourceCounts[name], null, `legacy CAPPED ${name} denominator must remain UNKNOWN`);
  }
}

async function testYearLifeIntentUsesCurrentDetailsAndRejectsOldRefs() {
  const { coordinator } = fixture("year-life-recall");
  const detailSource = fragment("recall-detail", "边境议和正式完成。", { eventDate: "1181.1.1", sourceType: "witnessed" });
  const detailSnapshot = snapshot("recall-detail", [detailSource], { campaignToken: "campaign-recall", date: "1181.1.1" });
  const committed = coordinator.store.commitOwner(detailSnapshot, { status: "STORE", entries: [
    candidate(detailSource, detailSource.text)
  ] });
  assert.equal(committed.entryIds.length, 1);

  const planner = new (require("../src/app/main/memory-system/memory4-recall-planner").Memory4RecallPlanner)(coordinator);
  const plannerSource = fs.readFileSync(require.resolve("../src/app/main/memory-system/memory4-recall-planner"), "utf8");
  assert.equal(plannerSource.includes("memory4-derived"), false, "production recall cannot load the retired Year/Life store");
  assert.match(plannerSource, /ref\.kind === "year" \|\| ref\.kind === "life"/,
    "old Year/Life source references must be explicitly rejected");
  const scope = { campaignToken: "campaign-recall", ownerId: OWNER_ID };
  for (const kind of ["year", "life"]) {
    assert.equal(planner.validateHistory(scope, [{ kind, id: "legacy-derived-ref", bodyHash: "stale" }],
      { currentGameDate: "1182.1.1" }), false, `old ${kind} references are invalid`);
  }
  const options = { campaignToken: scope.campaignToken, ownerId: scope.ownerId, currentGameDate: "1182.1.1",
    currentTotalDays: 431365, conversationId: "recall-query", sceneRevision: "v1", turnEpoch: 1,
    querySpeakerId: COUNTERPART_ID, entityIds: [COUNTERPART_ID], legacyMemories: [],
    memoryEngineRemainingBudget: 1200, providerRemainingSafeBudget: 1200, estimateTokens: text => Math.ceil(String(text).length / 2) };
  const year = planner.plan({ ...options, query: "1181年发生了什么？" });
  const life = planner.plan({ ...options, query: "此人一生有哪些重要经历？" });
  assert(year.items.some(item => item.sourceRef?.kind === "detail" && item.sourceRef.id === committed.entryIds[0]),
    "YEAR intent must still retrieve Detail");
  assert(life.items.some(item => item.sourceRef?.kind === "detail" && item.sourceRef.id === committed.entryIds[0]),
    "LIFE intent must still retrieve Detail");
}

async function testCoveragePageRejectsWrongScopeStaleBodiesAndForget() {
  const { coordinator, baseStore } = fixture("coverage-security");
  const scope = { campaignToken: "campaign-coverage-security", ownerId: OWNER_ID };
  const finalizationId = "coverage-security-finalization";
  const conversationId = "coverage-security-conversation";
  const sourceText = "旧摘要来源事实：边境议和正式完成。";
  let fact = baseStore.saveMemory({ memoryId: "legacy-coverage-fact", type: "folder_summary", subtype: "conversation_summary",
    content: sourceText, eventDate: "1181.1.1", participants: [OWNER_ID, COUNTERPART_ID], subjects: [OWNER_ID],
    knownBy: [OWNER_ID], visibility: "known_group", source: "imported", tags: ["议和"],
    provenance: { campaignToken: scope.campaignToken, campaignBinding: { status: "bound" }, folderOwnerId: OWNER_ID,
      counterpartId: COUNTERPART_ID, counterpartIds: [COUNTERPART_ID] } });
  const source = fragment("coverage-source", sourceText, { messageId: 41, sourceMessageIds: [41], legacyMemoryId: fact.memoryId,
    legacySourceHash: legacySourceHash(fact), sourceType: "reported" });
  const lineage = createProjectionLineage({ campaignToken: scope.campaignToken, ownerId: OWNER_ID, conversationId,
    finalizationId, counterpartId: COUNTERPART_ID, legacyMemoryIds: [fact.memoryId], sourceMessageIds: [41, 42] });
  source.sourceMessageIds = [41, 42];
  const current = { ...snapshot("coverage-security", [source], { campaignToken: scope.campaignToken, finalizationId }),
    conversationId, projectionLineages: [lineage] };
  const committed = coordinator.store.commitOwner(current, { status: "STORE", entries: [candidate(source, sourceText)] });
  assert.equal(committed.entryIds.length, 1);
  const legacy = { memoryId: "legacy-coverage-summary", content: "摘要事项；私密正文不得进入 Coverage DTO。",
    finalizationId, knownBy: [OWNER_ID], perspectiveMemoryIds: [fact.memoryId],
    provenance: { campaignToken: scope.campaignToken, folderOwnerId: OWNER_ID, finalizationId,
      perspectiveMemoryIds: [fact.memoryId] } };
  const getLegacyFacts = () => [fact];
  const index = coordinator.store.loadIndex(scope);
  const metadata = coordinator.store.read(path.join(coordinator.store.directory(scope), "metadata.json"), null);
  const args = { scope, index, metadata, legacyMemories: [legacy], getLegacyFacts, store: coordinator.store, baseStore,
    finalizationId, legacyRevision: 1, forgetGeneration: 0 };
  const page = getCoveragePage(args);
  assert.equal(page.status, "OK");
  assert.equal(page.items.length, 1);
  assert.equal(page.items[0].relation, "LEGACY_SOURCE_EXACT");
  assert.deepEqual(page.items[0].durableEntryIds, committed.entryIds);
  assert.equal(page.items[0].completeMigrationProof, true);
  assert.equal(JSON.stringify(page).includes(sourceText), false, "coverage DTO cannot contain source or summary body text");
  assert.equal(JSON.stringify(page).includes(legacy.content), false);

  const originalFact = fact;
  fact = baseStore.saveMemory({ ...fact, content: "手动编辑后的 Legacy 事实。" });
  const editedLegacy = getCoveragePage({ ...args, index: coordinator.store.loadIndex(scope) });
  assert.equal(editedLegacy.items[0]?.relation, "UNVERIFIED",
    "a Legacy fact hash edit invalidates the Durable exact-source proof");
  assert.deepEqual(editedLegacy.items[0]?.durableEntryIds || [], []);
  fact = baseStore.saveMemory(originalFact);

  const revisionKey = hash([conversationId, OWNER_ID]);
  const staleSourceRevision = getCoveragePage({ ...args, metadata: { ...metadata,
    knownEvidenceRevisions: { ...metadata.knownEvidenceRevisions, [revisionKey]: "f".repeat(64) } } });
  assert.equal(staleSourceRevision.items[0]?.relation, "UNVERIFIED",
    "a stale source revision cannot retain a Legacy-to-Durable source link");
  assert.deepEqual(staleSourceRevision.items[0]?.durableEntryIds || [], []);

  const unrelatedFact = baseStore.saveMemory({ memoryId: "legacy-coverage-unrelated-fact", type: "folder_summary",
    subtype: "conversation_summary", content: "不同 Legacy 事实来源。", eventDate: "1181.1.1",
    participants: [OWNER_ID, COUNTERPART_ID], subjects: [OWNER_ID], knownBy: [OWNER_ID], visibility: "known_group",
    source: "imported", tags: ["粮食"], provenance: { campaignToken: scope.campaignToken, folderOwnerId: OWNER_ID,
      counterpartId: COUNTERPART_ID, counterpartIds: [COUNTERPART_ID], sourceMessageIds: [42] } });
  const verifiedLineage = createProjectionLineage({ campaignToken: scope.campaignToken, ownerId: OWNER_ID, conversationId,
    finalizationId, counterpartId: COUNTERPART_ID, legacyMemoryIds: [unrelatedFact.memoryId], sourceMessageIds: [41] });
  const unrelatedLegacy = { memoryId: "legacy-coverage-unrelated-summary", content: "另一份旧摘要。", finalizationId,
    knownBy: [OWNER_ID], perspectiveMemoryIds: [unrelatedFact.memoryId],
    provenance: { campaignToken: scope.campaignToken, folderOwnerId: OWNER_ID, finalizationId,
      counterpartId: COUNTERPART_ID, counterpartIds: [COUNTERPART_ID], perspectiveMemoryIds: [unrelatedFact.memoryId],
      projectionLineages: [verifiedLineage] } };
  const mismatchedLineage = getCoveragePage({ ...args, legacyMemories: [legacy, unrelatedLegacy],
    getLegacyFacts: (_scope, memory) => memory.memoryId === unrelatedLegacy.memoryId ? [unrelatedFact] : [fact] });
  assert.equal(mismatchedLineage.items[1]?.relation, "RELATED_FINALIZATION_ONLY",
    "same projectionId cannot authenticate mismatched message IDs in a Durable lineage");
  assert.deepEqual(mismatchedLineage.items[1]?.durableEntryIds, [],
    "a lineage with source IDs absent from the verified Legacy lineage cannot establish a shared-source link");

  assert.throws(() => getCoveragePage({ ...args, scope: { campaignToken: scope.campaignToken, ownerId: 9 } }),
    /memory4_coverage_scope_mismatch/, "an index cannot be read through another Owner scope");
  assert.throws(() => getCoveragePage({ ...args, scope: { campaignToken: "foreign-campaign", ownerId: OWNER_ID } }),
    /memory4_coverage_scope_mismatch/, "an index cannot cross Campaign scope");
  const foreignRows = getCoveragePage({ ...args, legacyMemories: [
    { ...legacy, memoryId: "foreign-owner-summary", provenance: { ...legacy.provenance, folderOwnerId: 9 } },
    { ...legacy, memoryId: "foreign-campaign-summary", provenance: { ...legacy.provenance, campaignToken: "other-campaign" } }
  ] });
  assert.deepEqual(foreignRows.items, [], "foreign Owner/Campaign Legacy rows cannot appear in the page");

  const staleRevision = getCoveragePage({ ...args, expectedIndexRevision: index.revision - 1 });
  assert.equal(staleRevision.status, "STALE");
  assert.deepEqual(staleRevision.items, [], "stale index revision must not return cached rows");
  const staleHash = getCoveragePage({ ...args, expectedIndexRevision: index.revision, expectedSummaryHash: "f".repeat(64) });
  assert.equal(staleHash.status, "STALE");
  assert.deepEqual(staleHash.items, [], "stale Legacy summary hash must not return cached rows");

  const entry = coordinator.store.readEntry(scope, committed.entryIds[0], index);
  const entryPath = coordinator.store.entryPath(coordinator.store.directory(scope), committed.entryIds[0]);
  fs.writeFileSync(entryPath, JSON.stringify({ ...entry, text: "tampered body" }, null, 2), "utf8");
  const tampered = getCoveragePage({ ...args, index: coordinator.store.loadIndex(scope) });
  assert.notEqual(tampered.items[0]?.relation, "LEGACY_SOURCE_EXACT", "index bodyHash mismatch must remove the Durable source link");
  assert.deepEqual(tampered.items[0]?.durableEntryIds || [], []);
  fs.writeFileSync(entryPath, JSON.stringify(entry, null, 2), "utf8");

  coordinator.store.persistForgottenProjection(scope, lineage);
  const forgotten = getCoveragePage({ ...args, index: coordinator.store.loadIndex(scope), forgetGeneration: 1 });
  assert.equal(forgotten.status, "OK");
  assert.notEqual(forgotten.items[0]?.relation, "LEGACY_SOURCE_EXACT", "current Forget tombstone must sever the Durable link");
  assert.deepEqual(forgotten.items[0]?.durableEntryIds || [], []);
}

async function testCoverageSharedSourceRejectsConversationIdCollisions() {
  const h = coverageProvenanceFixture("coverage-conversation-collision");
  const finalizationId = "conversation-collision-finalization";
  const messageId = 7;
  const segmentId = "segment-reused-between-conversations";
  const legacy = h.addLegacy({ label: "conversation-collision", conversationId: "legacy-conversation",
    finalizationId, messageId, segmentId });
  h.commitSource({ label: "conversation-collision", conversationId: "durable-conversation",
    finalizationId, messageId, segmentId });

  const page = getCoveragePage({ ...h.args([legacy.summary]), finalizationId });
  assert.equal(page.status, "OK");
  assert.equal(page.items[0]?.relation, "RELATED_FINALIZATION_ONLY",
    "same Owner/Campaign/finalization and reused message/segment IDs cannot bridge conversations");
  assert.deepEqual(page.items[0]?.durableEntryIds, []);
}

async function testCoverageSharedSourceRejectsConflictingSummaryProvenance() {
  for (const [label, conflict] of [
    ["conversation", { provenance: { conversationId: "conflicting-conversation" } }],
    ["finalization", { provenance: { finalizationId: "conflicting-finalization" } }]
  ]) {
    const h = coverageProvenanceFixture(`coverage-summary-provenance-${label}`);
    const conversationId = `trusted-conversation-${label}`;
    const finalizationId = `trusted-finalization-${label}`;
    const messageId = 23;
    const segmentId = `segment-summary-provenance-${label}`;
    const legacy = h.addLegacy({ label, conversationId, finalizationId, messageId, segmentId });
    h.commitSource({ label, conversationId, finalizationId, messageId, segmentId });
    const summary = { ...legacy.summary, provenance: { ...legacy.summary.provenance, ...conflict.provenance } };

    const page = getCoveragePage({ ...h.args([summary]), finalizationId });
    assert.equal(page.items[0]?.relation, "RELATED_FINALIZATION_ONLY",
      `top-level and provenance ${label} identities must agree before shared-source association`);
    assert.deepEqual(page.items[0]?.durableEntryIds, []);
  }
}

async function testCoverageSharedSourceRejectsConflictingFactProvenance() {
  for (const [label, identity] of [
    ["conversation", { topLevel: "conversationId", provenance: "conversationId" }],
    ["finalization", { topLevel: "finalizationId", provenance: "finalizationId" }]
  ]) {
    const h = coverageProvenanceFixture(`coverage-fact-provenance-${label}`);
    const conversationId = `trusted-conversation-${label}`;
    const finalizationId = `trusted-finalization-${label}`;
    const messageId = 29;
    const segmentId = `segment-fact-provenance-${label}`;
    const legacy = h.addLegacy({ label, conversationId, finalizationId, messageId, segmentId });
    h.commitSource({ label, conversationId, finalizationId, messageId, segmentId });
    const conflictingFact = { ...legacy.fact, [identity.topLevel]: identity.topLevel === "conversationId"
      ? conversationId : finalizationId,
    provenance: { ...legacy.fact.provenance, [identity.provenance]: `conflicting-${label}` } };

    const page = getCoveragePage({ ...h.args([legacy.summary], {
      getLegacyFacts: () => [conflictingFact]
    }), finalizationId });
    assert.equal(page.items[0]?.relation, "RELATED_FINALIZATION_ONLY",
      `fact top-level and provenance ${label} identities must agree before shared-source association`);
    assert.deepEqual(page.items[0]?.durableEntryIds, []);
  }
}

async function testCoverageSharedSourceCannotBorrowAnotherSummaryLineage() {
  const h = coverageProvenanceFixture("coverage-page-lineage-collision");
  const messageId = 7;
  const segmentId = "segment-reused-between-finalizations";
  const target = h.addLegacy({ label: "page-target", conversationId: "target-conversation",
    finalizationId: "target-finalization", messageId, segmentId, includeLineage: false });
  const other = h.addLegacy({ label: "page-other", conversationId: "other-conversation",
    finalizationId: "other-finalization", messageId, segmentId });
  h.commitSource({ label: "page-target", conversationId: "target-conversation",
    finalizationId: "target-finalization", messageId, segmentId });
  h.commitSource({ label: "page-other", conversationId: "other-conversation",
    finalizationId: "other-finalization", messageId, segmentId });

  const summary = buildCoverageSummary({ ...h.args([target.summary, other.summary]) });
  const targetRow = summary.summaries.find(row => row.summaryId === target.summary.memoryId);
  const otherRow = summary.summaries.find(row => row.summaryId === other.summary.memoryId);
  assert.equal(targetRow?.legacy.provenSourceLinkedCount, 0,
    "a different summary's verified lineage cannot authenticate this summary's reused IDs");
  assert.equal(targetRow?.legacy.sourceRelatedOnlyCount, 1);
  assert.equal(otherRow?.legacy.provenSourceLinkedCount, 1,
    "the summary that owns the valid lineage remains source-linked");
}

async function testCoverageSharedSourceRetainsScopeAndForgetBoundaries() {
  const h = coverageProvenanceFixture("coverage-shared-scope-forget");
  const finalizationId = "shared-scope-finalization";
  const conversationId = "shared-scope-conversation";
  const messageId = 19;
  const segmentId = "segment-shared-scope";
  const valid = h.addLegacy({ label: "shared-valid", conversationId, finalizationId, messageId, segmentId });
  h.commitSource({ label: "shared-valid", conversationId, finalizationId, messageId, segmentId,
    projectionLineages: [valid.lineage] });

  const validPage = getCoveragePage({ ...h.args([valid.summary]), finalizationId });
  assert.equal(validPage.items[0]?.relation, "SHARED_FRAGMENT_SOURCE",
    "a same-scope, same-conversation, same-finalization lineage still links by shared source IDs");
  assert.equal(validPage.items[0]?.durableEntryIds.length, 1);

  for (const [label, lineageOverrides] of [
    ["wrong-owner", { lineageOwnerId: OWNER_ID + 1 }],
    ["wrong-campaign", { lineageCampaignToken: "foreign-campaign" }]
  ]) {
    const forged = h.addLegacy({ label, conversationId, finalizationId, messageId, segmentId, ...lineageOverrides });
    const page = getCoveragePage({ ...h.args([forged.summary]), finalizationId });
    assert.equal(page.items[0]?.relation, "RELATED_FINALIZATION_ONLY",
      `${label} lineage cannot prove a shared source within the current scope`);
    assert.deepEqual(page.items[0]?.durableEntryIds, []);
  }

  h.coordinator.store.persistForgottenProjection(h.scope, valid.lineage);
  const forgotten = getCoveragePage({ ...h.args([valid.summary]), finalizationId, forgetGeneration: 1 });
  assert.equal(forgotten.items[0]?.relation, "FORGOTTEN",
    "a current Forget tombstone severs a previously valid shared-source link");
  assert.deepEqual(forgotten.items[0]?.durableEntryIds, []);
}

async function testRetirementMigrationFailsClosedAndCanRollback() {
  const modulePath = "../src/app/main/memory-system/memory4-retirement-migration";
  assert(fs.existsSync(path.resolve(__dirname, `${modulePath}.js`)), "V9.3.3 retirement migration module must exist");
  const { planYearLifeRetirement, executeYearLifeRetirement, recoverYearLifeRetirement } = require(modulePath);
  assert.equal(typeof planYearLifeRetirement, "function");
  assert.equal(typeof executeYearLifeRetirement, "function");

  const makeRoot = label => {
    const { directory, summaryFoldersDir, baseStore, coordinator } = fixture(label);
    const scope = { campaignToken: `campaign-${label}`, ownerId: OWNER_ID };
    coordinator.store.ensureDisclosureScope(scope);
    const sidecar = coordinator.store.directory(scope);
    const metadataPath = path.join(sidecar, "metadata.json");
    const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
    fs.writeFileSync(metadataPath, JSON.stringify({ ...metadata, derivedDirty: true, derivedRevision: 2 }, null, 2), "utf8");
    const yearsDir = path.join(sidecar, "years");
    fs.mkdirSync(yearsDir, { recursive: true });
    const yearPath = path.join(yearsDir, "1181.json");
    const lifePath = path.join(sidecar, "life.json");
    const manualYear = { memory4SchemaVersion: 1, ...scope, eventYear: 1181, revision: 1, dirty: true,
      sourceRevisionSet: [], items: [{ itemId: "manual-year", text: "USER_PRIVATE_YEAR_TEXT" }],
      generationMode: "manual_override", manual: { mode: "manual_override", editedAt: "2026-10-14T00:00:00.000Z" } };
    const autoLife = { memory4SchemaVersion: 1, ...scope, revision: 1, dirty: false,
      sourceRevisionSet: [], segments: [], generationMode: "auto", manual: { mode: "auto", editedAt: null } };
    fs.writeFileSync(yearPath, JSON.stringify(manualYear, null, 2), "utf8");
    fs.writeFileSync(lifePath, JSON.stringify(autoLife, null, 2), "utf8");
    return { directory, summaryFoldersDir, baseStore, coordinator, scope, sidecar, yearsDir, yearPath, lifePath, metadataPath };
  };

  const clean = makeRoot("retirement-rollback");
  const beforeYear = fs.readFileSync(clean.yearPath);
  const beforeLife = fs.readFileSync(clean.lifePath);
  const beforeMetadata = fs.readFileSync(clean.metadataPath);
  const dryRun = planYearLifeRetirement({ summaryFoldersDir: clean.summaryFoldersDir, ownerIds: [OWNER_ID] });
  assert.equal(dryRun.version, 1);
  assert.match(dryRun.planHash, /^[a-f0-9]{64}$/);
  assert.equal(dryRun.counts.yearFiles, 1);
  assert.equal(dryRun.counts.lifeFiles, 1);
  assert.equal(dryRun.counts.manualFiles, 1, "dry-run reports manual text by count only");
  assert.deepEqual(fs.readFileSync(clean.yearPath), beforeYear, "dry-run must not mutate manual Year data");
  assert.deepEqual(fs.readFileSync(clean.lifePath), beforeLife, "dry-run must not mutate Life data");
  assert.equal(JSON.stringify(dryRun).includes("USER_PRIVATE_YEAR_TEXT"), false, "dry-run output cannot expose bodies");
  assert.throws(() => executeYearLifeRetirement({ store: clean.baseStore, ownerIds: [OWNER_ID], hooks: {} }),
    /memory4_retirement_confirm_required/, "execution requires an explicit matching plan hash");

  assert.throws(() => executeYearLifeRetirement({ store: clean.baseStore, ownerIds: [OWNER_ID],
    confirmPlanHash: dryRun.planHash, hooks: { beforeCommit: () => { throw new Error("qa_rollback_injection"); } } }),
  /qa_rollback_injection/);
  assert.deepEqual(fs.readFileSync(clean.yearPath), beforeYear, "pre-commit failure must restore manual Year bytes exactly");
  assert.deepEqual(fs.readFileSync(clean.lifePath), beforeLife, "pre-commit failure must restore Life bytes exactly");
  assert.deepEqual(fs.readFileSync(clean.metadataPath), beforeMetadata, "pre-commit failure must restore old metadata byte-for-byte");

  const indexPath = path.join(clean.sidecar, "index.json");
  const knownPath = path.join(clean.sidecar, "known-entities.json");
  const beforeIndex = fs.readFileSync(indexPath);
  const beforeKnown = fs.readFileSync(knownPath);
  const completed = executeYearLifeRetirement({ store: clean.baseStore, ownerIds: [OWNER_ID], confirmPlanHash: dryRun.planHash });
  assert.equal(completed.status, "COMPLETED");
  assert.equal(fs.existsSync(clean.yearPath), false);
  assert.equal(fs.existsSync(clean.lifePath), false);
  assert.equal(fs.existsSync(clean.yearsDir), false, "successful cleanup removes the empty years directory");
  assert.deepEqual(fs.readFileSync(indexPath), beforeIndex, "migration must preserve canonical Durable index bytes");
  assert.deepEqual(fs.readFileSync(knownPath), beforeKnown, "migration must preserve known-entity evidence bytes");
  const metadataAfter = JSON.parse(fs.readFileSync(clean.metadataPath, "utf8"));
  assert.equal(Object.hasOwn(metadataAfter, "derivedDirty"), false);
  assert.equal(Object.hasOwn(metadataAfter, "derivedRevision"), false);
  assert.equal(fs.existsSync(clean.baseStore.summaryMutationPath), false, "committed retirement leaves no rollback journal");
  const auditPath = path.join(clean.baseStore.baseDir, "memory4-retirement-v933.json");
  const audit = fs.readFileSync(auditPath, "utf8");
  assert.equal(audit.includes("USER_PRIVATE_YEAR_TEXT"), false, "audit retains counts/hashes but never historical bodies");
  const remainingFiles = [];
  const scan = directory => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) scan(target);
      else remainingFiles.push(target);
    }
  };
  scan(clean.directory);
  assert(remainingFiles.every(file => !fs.readFileSync(file).includes(Buffer.from("USER_PRIVATE_YEAR_TEXT"))),
    "successful commit leaves no hidden copy of retired Year text under the fixture roots");
  const repeated = planYearLifeRetirement({ summaryFoldersDir: clean.summaryFoldersDir, ownerIds: [OWNER_ID] });
  assert.equal(repeated.counts.yearFiles, 0);
  assert.equal(repeated.counts.lifeFiles, 0, "second dry-run is idempotent and cannot discover stale production copies");

  const tamper = makeRoot("retirement-tamper");
  const originalPlan = planYearLifeRetirement({ summaryFoldersDir: tamper.summaryFoldersDir, ownerIds: [OWNER_ID] });
  const changedYear = JSON.parse(fs.readFileSync(tamper.yearPath, "utf8"));
  changedYear.items[0].text = "changed after dry-run";
  fs.writeFileSync(tamper.yearPath, JSON.stringify(changedYear, null, 2), "utf8");
  assert.throws(() => executeYearLifeRetirement({ store: tamper.baseStore, ownerIds: [OWNER_ID],
    confirmPlanHash: originalPlan.planHash }), /memory4_retirement_(?:plan_changed|confirm_required)/,
  "any body/scope/file change after dry-run invalidates confirmation");
  assert(fs.existsSync(tamper.yearPath), "tamper detection must preserve the changed source file");

  const interrupted = makeRoot("retirement-recovery");
  const interruptedPlan = planYearLifeRetirement({ summaryFoldersDir: interrupted.summaryFoldersDir, ownerIds: [OWNER_ID] });
  const interruptedYear = fs.readFileSync(interrupted.yearPath);
  const interruptedLife = fs.readFileSync(interrupted.lifePath);
  const interruptedMetadata = fs.readFileSync(interrupted.metadataPath);
  const originalRestore = interrupted.baseStore.restoreSummaryMutation.bind(interrupted.baseStore);
  interrupted.baseStore.restoreSummaryMutation = () => { throw new Error("qa_restore_failure_injection"); };
  assert.throws(() => executeYearLifeRetirement({ store: interrupted.baseStore, ownerIds: [OWNER_ID],
    confirmPlanHash: interruptedPlan.planHash, hooks: { beforeCommit: () => { throw new Error("qa_commit_failure_injection"); } } }),
  /qa_restore_failure_injection/, "failed automatic rollback must retain its recoverable journal");
  interrupted.baseStore.restoreSummaryMutation = originalRestore;
  const lockPath = path.join(interrupted.baseStore.baseDir, "memory4-retirement-v933.lock");
  assert(fs.existsSync(lockPath), "a failed rollback keeps the retirement lock for explicit recovery");
  assert(fs.existsSync(interrupted.baseStore.summaryMutationPath), "a failed rollback keeps its journal");
  const staleLock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
  staleLock.pid = 2147483647;
  fs.writeFileSync(lockPath, JSON.stringify(staleLock), "utf8");
  const recoveryStore = { baseDir: interrupted.baseStore.baseDir, summaryFoldersDir: interrupted.summaryFoldersDir };
  assert.throws(() => recoverYearLifeRetirement({ store: recoveryStore, ownerIds: [OWNER_ID],
    restoreJournal: () => { throw new Error("qa_recovery_callback_failure"); } }), /qa_recovery_callback_failure/);
  assert(fs.existsSync(lockPath), "failed explicit recovery keeps the lock");
  assert(fs.existsSync(interrupted.baseStore.summaryMutationPath), "failed explicit recovery keeps the journal");
  const recoveryWriter = Object.create(MemoryStore.prototype);
  recoveryWriter.baseDir = recoveryStore.baseDir;
  recoveryWriter.summaryFoldersDir = recoveryStore.summaryFoldersDir;
  recoveryWriter.summaryMutationPath = interrupted.baseStore.summaryMutationPath;
  const recovered = recoverYearLifeRetirement({ store: recoveryStore, ownerIds: [OWNER_ID],
    restoreJournal: () => recoveryWriter.restoreSummaryMutation() });
  assert.equal(recovered.status, "ROLLED_BACK");
  assert.equal(recovered.planHash, interruptedPlan.planHash, "recovery verifies the restored plan before clearing the lock");
  assert.equal(fs.existsSync(lockPath), false, "verified recovery clears the stale lock");
  assert.equal(fs.existsSync(interrupted.baseStore.summaryMutationPath), false, "verified recovery clears the journal");
  assert.deepEqual(fs.readFileSync(interrupted.yearPath), interruptedYear);
  assert.deepEqual(fs.readFileSync(interrupted.lifePath), interruptedLife);
  assert.deepEqual(fs.readFileSync(interrupted.metadataPath), interruptedMetadata);

  const unknown = makeRoot("retirement-unknown-path");
  fs.writeFileSync(path.join(unknown.yearsDir, "notes.txt"), "unknown file", "utf8");
  assert.throws(() => planYearLifeRetirement({ summaryFoldersDir: unknown.summaryFoldersDir, ownerIds: [OWNER_ID] }),
    /memory4_retirement_unknown_derived_path/);

  const corrupt = makeRoot("retirement-corrupt-json");
  fs.writeFileSync(corrupt.lifePath, "{not-json", "utf8");
  assert.throws(() => planYearLifeRetirement({ summaryFoldersDir: corrupt.summaryFoldersDir, ownerIds: [OWNER_ID] }),
    /memory4_retirement_view_invalid/);

  const foreign = makeRoot("retirement-foreign-scope");
  const wrongScope = JSON.parse(fs.readFileSync(foreign.yearPath, "utf8"));
  wrongScope.campaignToken = "foreign-campaign";
  fs.writeFileSync(foreign.yearPath, JSON.stringify(wrongScope, null, 2), "utf8");
  assert.throws(() => planYearLifeRetirement({ summaryFoldersDir: foreign.summaryFoldersDir, ownerIds: [OWNER_ID] }),
    /memory4_retirement_(?:scope_ambiguous|view_invalid)/);

  const linked = makeRoot("retirement-junction");
  const outside = path.join(linked.directory, "outside-years");
  fs.mkdirSync(outside, { recursive: true });
  const originalYear = fs.readFileSync(linked.yearPath);
  fs.unlinkSync(linked.yearPath);
  fs.rmdirSync(linked.yearsDir);
  fs.symlinkSync(outside, linked.yearsDir, "junction");
  try {
    assert.throws(() => planYearLifeRetirement({ summaryFoldersDir: linked.summaryFoldersDir, ownerIds: [OWNER_ID] }),
      /memory4_retirement_symlink_path/);
  } finally {
    if (fs.existsSync(linked.yearsDir) && fs.lstatSync(linked.yearsDir).isSymbolicLink()) fs.rmdirSync(linked.yearsDir);
    fs.mkdirSync(linked.yearsDir, { recursive: true });
    fs.writeFileSync(linked.yearPath, originalYear);
  }
}

const tests = [
  ["planner preserves source identity and ranks late consequences", testPlannerPreservesSourceIdentityAndRanksLateConsequences],
  ["coverage proof rejects false FULL, local skips, forged IDs, and invalid counts", testCoverageProofRejectsFalseFullAndForgedCounts],
  ["checkpoint plan tampering cannot reuse old leaves", testCheckpointPlanTamperCannotReuseOldLeaves],
  ["legacy CAPPED proof remains valid without fabricated V9.3.3 counts", testLegacyCappedCommitRemainsProvenButNewCoverageIsUnknown],
  ["YEAR/LIFE intents use Detail while old derived refs fail closed", testYearLifeIntentUsesCurrentDetailsAndRejectsOldRefs],
  ["coverage page rejects wrong scope, stale bodies, and Forget", testCoveragePageRejectsWrongScopeStaleBodiesAndForget],
  ["shared-source links reject repeated IDs across conversations", testCoverageSharedSourceRejectsConversationIdCollisions],
  ["shared-source links reject conflicting summary provenance", testCoverageSharedSourceRejectsConflictingSummaryProvenance],
  ["shared-source links reject conflicting fact provenance", testCoverageSharedSourceRejectsConflictingFactProvenance],
  ["same-page rows cannot borrow another Legacy summary lineage", testCoverageSharedSourceCannotBorrowAnotherSummaryLineage],
  ["shared-source links retain positive, scope, and Forget checks", testCoverageSharedSourceRetainsScopeAndForgetBoundaries],
  ["retirement migration fails closed and supports rollback", testRetirementMigrationFailsClosedAndCanRollback]
];

async function main() {
  try {
    for (const [name, run] of tests) await check(name, run);
    console.log(`V9.3.3 independent QA: ${passed}/${tests.length} PASS, ${failures} FAIL`);
    if (failures) process.exitCode = 1;
  } finally {
    assert(path.resolve(temporaryRoot).startsWith(path.resolve(__dirname) + path.sep),
      "test cleanup must remain inside its dedicated scripts temp directory");
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

main().catch(error => { console.error(error?.stack || error); process.exitCode = 1; });
