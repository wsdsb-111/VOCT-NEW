"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { MemoryStore } = require("../resources/app/out/main/memory-system/memory-store");
const { MemoryEngine } = require("../resources/app/out/main/memory-system/memory-engine");
const { Memory4Coordinator } = require("../resources/app/out/main/memory-system/memory4-coordinator");
const { hash } = require("../resources/app/out/main/memory-system/memory4-contract");
const { disclosureFactId } = require("../resources/app/out/main/memory-system/memory4-disclosure");
const { createProjectionLineage, disclosureProofForgetMatch } = require("../resources/app/out/main/memory-system/memory4-forget");
const { createSummariesManager } = require("../resources/app/out/main/summaries/summaries-manager");

const root = fs.mkdtempSync(path.join(__dirname, ".tmp-votc-v815-forget-"));
const campaignToken = "campaign-forget-fixture";
const ownerId = 2;
const conversationId = "conversation-group";
const context = (finalizationId, { shared = false } = {}) => {
  const projectionA = createProjectionLineage({ campaignToken, ownerId, conversationId, finalizationId,
    counterpartId: 1, segmentIds: [`summary-${finalizationId}-a`] });
  const projectionC = createProjectionLineage({ campaignToken, ownerId, conversationId, finalizationId,
    counterpartId: 3, segmentIds: [`summary-${finalizationId}-c`] });
  const fragmentA = { fragmentId: `fragment-${finalizationId}-a`, messageId: 10, sourceMessageIds: [10], text: "forgotten fact A",
    speakerId: ownerId, speakerIds: [ownerId], sourceTextVerified: true, sourceRole: "assistant", presentIds: [ownerId, 1],
    knownBy: [ownerId, 1], visibility: "participants", sourceType: "spoken", recipientIds: [1], entityIds: [1],
    visibilityEvidence: "application_fragment" };
  const fragmentC = { fragmentId: `fragment-${finalizationId}-c`, messageId: 30, sourceMessageIds: [30], text: "retained fact C",
    speakerId: ownerId, speakerIds: [ownerId], sourceTextVerified: true, sourceRole: "assistant", presentIds: [ownerId, 3],
    knownBy: [ownerId, 3], visibility: "participants", sourceType: "spoken", recipientIds: [3], entityIds: [3],
    visibilityEvidence: "application_fragment" };
  const sharedFragment = { fragmentId: `fragment-${finalizationId}-shared`, messageId: 40, sourceMessageIds: [40], text: "shared scene fact",
    speakerId: ownerId, speakerIds: [ownerId], sourceTextVerified: true, sourceRole: "assistant", presentIds: [ownerId, 1, 3],
    knownBy: [ownerId, 1, 3], visibility: "participants", sourceType: "spoken", recipientIds: [1, 3], entityIds: [1, 3],
    visibilityEvidence: "application_fragment" };
  const fragments = shared ? [sharedFragment] : [fragmentA, fragmentC];
  return {
    snapshot: { campaignToken, ownerId, conversationId, finalizationId, episodeId: `episode-${finalizationId}`,
      date: "1164.1.1", totalDays: 425000, sourceRevision: hash([finalizationId, "source"]), presentMessageCount: shared ? 1 : 2,
      completeness: "complete", summaryIds: [], counterpartIds: [1, 3], fragments,
      projectionLineages: [
        { ...projectionA, sourceSegmentIds: [shared ? sharedFragment.fragmentId : fragmentA.fragmentId], sourceMessageIds: [shared ? 40 : 10] },
        { ...projectionC, sourceSegmentIds: [shared ? sharedFragment.fragmentId : fragmentC.fragmentId], sourceMessageIds: [shared ? 40 : 30] }
      ] },
    candidateA: { memoryType: "DURABLE_KNOWLEDGE", text: "remembered fact A", fragmentIds: [fragmentA.fragmentId],
      participantIds: [ownerId, 1], entityIds: [1], topics: ["A"], eventTime: { status: "unknown" } },
    candidateC: { memoryType: "DURABLE_KNOWLEDGE", text: "remembered fact C", fragmentIds: [fragmentC.fragmentId],
      participantIds: [ownerId, 3], entityIds: [3], topics: ["C"], eventTime: { status: "unknown" } },
    candidateShared: { memoryType: "DURABLE_KNOWLEDGE", text: "remembered shared fact", fragmentIds: [sharedFragment.fragmentId],
      participantIds: [ownerId, 1, 3], entityIds: [1, 3], topics: ["shared"], eventTime: { status: "unknown" } },
    summaryA: { campaignToken, conversationId, finalizationId, perspectiveOwnerId: ownerId, characterId: 1,
      projectionId: projectionA.projectionId, perspectiveSummarySegmentIds: [`summary-${finalizationId}-a`] },
    summaryC: { campaignToken, conversationId, finalizationId, perspectiveOwnerId: ownerId, characterId: 3,
      projectionId: projectionC.projectionId, perspectiveSummarySegmentIds: [`summary-${finalizationId}-c`] }
  };
};

function createCoordinator(name) {
  const summaryFoldersDir = path.join(root, `${name}-summaries`);
  fs.mkdirSync(path.join(summaryFoldersDir, `${ownerId}_owner`), { recursive: true });
  const store = new MemoryStore({ baseDir: path.join(root, `${name}-memory`), summaryFoldersDir });
  return new Memory4Coordinator(store);
}

function knownDisclosure({ sourceId, conversationId, sourceRevision, sourceMessageIds, sourceFragmentIds, projectionLineages = [] }) {
  const scope = { campaignToken, ownerId }, entityId = 9;
  const factId = disclosureFactId(scope, entityId, "TITLE", "title_kingdom_of_x");
  const proof = { sourceKind: "CONVERSATION", sourceId, sourceFinalizationId: sourceId, sourceConversationId: conversationId,
    sourceRevision, acquiredDate: "1164.1.1", knownBy: [ownerId], sourceMessageIds, sourceFragmentIds,
    sourceTextHashes: [hash("source")], visibilityEvidence: ["application_fragment"], projectionLineages };
  const fact = { factId, factType: "TITLE", factKey: "title_kingdom_of_x", value: "Kingdom of X", status: "AUTO_DISCLOSED",
    firstAcquiredDate: "1164.1.1", lastConfirmedDate: "1164.1.1", knownBy: [ownerId], revision: 1,
    evidenceBySource: { [hash(["CONVERSATION", sourceId])]: proof } };
  return { campaignToken, ownerId, revision: 1, entities: { [entityId]: { entityId, revision: 1, disclosedFacts: { [factId]: fact } } } };
}

function createManagerFixture(name, summaryRecord, ownerFolderName = `${ownerId}_owner`) {
  const directory = path.join(root, `manager-${name}`);
  const summariesDir = path.join(directory, "summaries");
  const ownerFolder = path.join(summariesDir, ownerFolderName);
  fs.mkdirSync(ownerFolder, { recursive: true });
  const summaryPath = path.join(ownerFolder, "pair.json");
  const record = { playerId: ownerId, characterId: 1, ...summaryRecord };
  fs.writeFileSync(summaryPath, JSON.stringify([record], null, 2), "utf8");
  const engine = new MemoryEngine({ baseDir: path.join(directory, "memory"), summaryFoldersDir: summariesDir,
    trace: { record() {} } });
  const manager = createSummariesManager({ fs, path, summariesDir, memoryEngine: engine, memorySystem: {},
    getCurrentConversation: () => null });
  return { directory, summariesDir, ownerFolder, summaryPath, record, engine, manager };
}

function snapshotTree(directory) {
  if (!fs.existsSync(directory)) return null;
  const rows = [];
  const visit = (current, relative = "") => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const child = path.join(current, entry.name);
      const childRelative = path.join(relative, entry.name);
      if (entry.isSymbolicLink()) rows.push([childRelative, `symlink:${fs.readlinkSync(child)}`]);
      else if (entry.isDirectory()) {
        rows.push([childRelative, "directory"]);
        visit(child, childRelative);
      } else rows.push([childRelative, `file:${fs.readFileSync(child).toString("base64")}`]);
    }
  };
  visit(directory);
  return rows.sort(([left], [right]) => left.localeCompare(right));
}

async function testProductionManagerForgetGate() {
  const incomplete = createManagerFixture("incomplete-lineage", {
    campaignToken, perspectiveOwnerId: ownerId, content: "Lineage-less summary with a live Memory4 scope.", date: "1164.1.1"
  });
  const incompleteScope = { campaignToken, ownerId };
  const incompleteScopeDir = incomplete.engine.memory4.store.ensureDisclosureScope(incompleteScope);
  const incompleteVisibleBefore = snapshotTree(incomplete.summariesDir);
  const incompleteStoreBefore = snapshotTree(incomplete.engine.store.baseDir);
  const incompleteResult = await incomplete.manager.deleteSummary(ownerId, 1, 0);
  assert.equal(incompleteResult.success, false);
  assert.equal(incompleteResult.error, "MEMORY4_FORGET_INCOMPLETE:PROJECTION_LINEAGE_UNAVAILABLE");
  assert.deepEqual(snapshotTree(incomplete.summariesDir), incompleteVisibleBefore,
    "unmapped visible summary and every sidecar must remain byte-for-byte unchanged");
  assert.deepEqual(snapshotTree(incomplete.engine.store.baseDir), incompleteStoreBefore,
    "failed delete must not alter base index or recovery files");
  assert.equal(fs.existsSync(path.join(incompleteScopeDir, "forgotten-projections.json")), false,
    "unknown lineage must not create a projection tombstone");

  const unavailable = createManagerFixture("owner-folder-unavailable", {
    campaignToken, perspectiveOwnerId: ownerId, finalizationId: "owner-folder-unavailable-finalization",
    content: "Lineage points at an unavailable owner folder.", date: "1164.1.1"
  }, "OwnerName");
  const unavailableVisibleBefore = snapshotTree(unavailable.summariesDir);
  const unavailableStoreBefore = snapshotTree(unavailable.engine.store.baseDir);
  const unavailableResult = await unavailable.manager.deleteSummary(ownerId, 1, 0);
  assert.equal(unavailableResult.success, false);
  assert.equal(unavailableResult.error, "MEMORY4_FORGET_INCOMPLETE:OWNER_FOLDER_UNAVAILABLE");
  assert.deepEqual(snapshotTree(unavailable.summariesDir), unavailableVisibleBefore);
  assert.deepEqual(snapshotTree(unavailable.engine.store.baseDir), unavailableStoreBefore);

  const legacy = createManagerFixture("pure-legacy", {
    campaignToken, perspectiveOwnerId: ownerId, content: "Legacy summary with no Memory4 references.", date: "1164.1.1"
  });
  const legacyResult = await legacy.manager.deleteSummary(ownerId, 1, 0);
  assert.equal(legacyResult.success, true, JSON.stringify(legacyResult));
  assert.equal(legacyResult.diagnostics.status, "SKIPPED_SAFE_NO_FOOTPRINT");
  assert.equal(fs.existsSync(legacy.summaryPath), false);
  assert.equal(fs.existsSync(path.join(legacy.summariesDir, ".memory4", String(ownerId), hash(campaignToken))), false,
    "pure Legacy deletion must not manufacture an empty Memory4 sidecar");

  const rollback = context("manager-rollback");
  const rollbackFixture = createManagerFixture("post-forget-failure", {
    ...rollback.summaryA, content: "Rollback summary", date: "1164.1.1", playerId: ownerId,
    sourceSegmentIds: [rollback.snapshot.fragments[0].fragmentId], sourceMessageIds: [10]
  });
  const rollbackScope = { campaignToken, ownerId };
  rollbackFixture.engine.memory4.store.commitOwner(rollback.snapshot, { status: "STORE", entries: [rollback.candidateA] });
  const rollbackScopeDir = rollbackFixture.engine.memory4.store.directory(rollbackScope);
  rollbackFixture.engine.store.writeJson(path.join(rollbackScopeDir, "known-entities.json"), knownDisclosure({
    sourceId: rollback.snapshot.finalizationId, conversationId: rollback.snapshot.conversationId,
    sourceRevision: rollback.snapshot.sourceRevision, sourceMessageIds: [10],
    sourceFragmentIds: [rollback.snapshot.fragments[0].fragmentId],
    projectionLineages: [rollback.snapshot.projectionLineages[0]]
  }));
  rollbackFixture.engine.memory4.saveRecovery(rollback.snapshot, { status: "PENDING", retryCount: 0 });
  const rollbackVisibleBefore = snapshotTree(rollbackFixture.summariesDir);
  const rollbackStoreBefore = snapshotTree(rollbackFixture.engine.store.baseDir);
  const forget = rollbackFixture.engine.memory4.forgetSummaryProjection.bind(rollbackFixture.engine.memory4);
  rollbackFixture.engine.memory4.forgetSummaryProjection = (...args) => {
    const result = forget(...args);
    assert.equal(result.status, "FORGOTTEN", JSON.stringify(result));
    throw new Error("INJECTED_POST_FORGET_FAILURE");
  };
  const rollbackResult = await rollbackFixture.manager.deleteSummary(ownerId, 1, 0);
  assert.equal(rollbackResult.success, false);
  assert.equal(rollbackResult.error, "INJECTED_POST_FORGET_FAILURE");
  assert.deepEqual(snapshotTree(rollbackFixture.summariesDir), rollbackVisibleBefore,
    "post-forget failure must restore the visible file, canonical entries, metadata and known entities");
  assert.deepEqual(snapshotTree(rollbackFixture.engine.store.baseDir), rollbackStoreBefore,
    "post-forget failure must restore recovery snapshots and all MemoryStore files");
  assert.equal(fs.existsSync(path.join(rollbackScopeDir, "forgotten-projections.json")), false,
    "rollback must remove the transient tombstone");
}

async function run() {
  try {
    await testProductionManagerForgetGate();
    console.log("PASS production SummariesManager blocks uncertain skips, permits proven pure Legacy and fully rolls back failures");

    const pending = context("finalization-pending");
    const coordinator = createCoordinator("pending");
    coordinator.saveRecovery(pending.snapshot, { status: "PENDING", retryCount: 0 });
    const forgetPending = coordinator.forgetSummaryProjection(pending.summaryA, { ownerId, counterpartId: 1 });
    assert.equal(forgetPending.status, "FORGOTTEN");
    assert.equal(forgetPending.recoveryUpdated, 1);

    const restarted = createCoordinator("pending");
    let durablePrompt = "";
    const recovered = await restarted.recoverPending(async (prompt) => {
      durablePrompt = JSON.stringify(prompt);
      return JSON.stringify({ status: "STORE", entries: [pending.candidateA, pending.candidateC] });
    }, { activeCampaignToken: campaignToken, isNarrativeCommitted: () => true });
    assert.equal(recovered.length, 1);
    assert.equal(recovered[0].status, "STORE", JSON.stringify(recovered[0]));
    assert.equal(durablePrompt.includes("forgotten fact A"), false);
    assert.deepEqual(restarted.store.query({ campaignToken, ownerId }).map(entry => entry.text), ["remembered fact C"]);

    const canonical = context("finalization-canonical");
    const beforeForget = createCoordinator("canonical");
    beforeForget.store.commitOwner(canonical.snapshot, { status: "STORE", entries: [canonical.candidateA, canonical.candidateC] });
    assert.equal(beforeForget.store.query({ campaignToken, ownerId }).length, 2);
    beforeForget.forgetSummaryProjection(canonical.summaryA, { ownerId, counterpartId: 1 });

    const afterRestart = createCoordinator("canonical");
    assert.deepEqual(afterRestart.store.query({ campaignToken, ownerId }).map(entry => entry.text), ["remembered fact C"]);

    const shared = context("finalization-shared", { shared: true });
    const sharedStore = createCoordinator("shared");
    sharedStore.store.commitOwner(shared.snapshot, { status: "STORE", entries: [shared.candidateShared] });
    const sharedScope = { campaignToken, ownerId };
    const sharedFolder = path.join(sharedStore.baseStore.summaryFoldersDir, `${ownerId}_owner`);
    const pairSummary = row => ({ ...row, playerId: ownerId, content: "same visible source projection", date: "1164.1.1",
      totalDays: 425000, sourceSegmentIds: [shared.snapshot.fragments[0].fragmentId], sourceMessageIds: [40] });
    sharedStore.baseStore.writeJson(path.join(sharedFolder, "pair-a.json"), [pairSummary(shared.summaryA)]);
    sharedStore.baseStore.writeJson(path.join(sharedFolder, "pair-c.json"), [pairSummary(shared.summaryC)]);
    sharedStore.baseStore.writeJson(path.join(sharedStore.store.directory(sharedScope), "known-entities.json"), knownDisclosure({
      sourceId: shared.snapshot.finalizationId, conversationId, sourceRevision: shared.snapshot.sourceRevision,
      sourceMessageIds: [40], sourceFragmentIds: [shared.snapshot.fragments[0].fragmentId]
    }));
    const preDeleteReadContext = Object.freeze(sharedStore.createProfileReadContext(sharedScope));
    const before = sharedStore.store.query({ campaignToken, ownerId })[0];
    assert.deepEqual(before.counterpartIds, [1, 3]);
    const forgetShared = sharedStore.forgetSummaryProjection(shared.summaryA, { ownerId, counterpartId: 1 });
    assert.equal(forgetShared.canonicalEntriesForgotten, 0);
    const staleContextDisclosure = sharedStore.store.getDisclosedFacts(sharedScope, 9, { readContext: preDeleteReadContext })[0];
    assert.deepEqual(Object.values(staleContextDisclosure.evidenceBySource)[0].projectionLineages.map(lineage => lineage.counterpartId), [3]);
    const afterShared = createCoordinator("shared").store.query({ campaignToken, ownerId })[0];
    assert.equal(afterShared.text, "remembered shared fact");
    assert.deepEqual(afterShared.counterpartIds, [3]);
    assert.deepEqual(afterShared.source.projectionLineages.map(lineage => lineage.counterpartId), [3]);
    assert.deepEqual(afterShared.evidence.knownBy, [1, ownerId, 3]);
    const retainedDisclosure = createCoordinator("shared").store.getDisclosedFacts(sharedScope, 9)[0];
    assert.deepEqual(Object.values(retainedDisclosure.evidenceBySource)[0].projectionLineages.map(lineage => lineage.counterpartId), [3]);
    const retainedSummary = createCoordinator("shared").baseStore.loadFolderSummariesForCharacter(ownerId)[0];
    assert.deepEqual(retainedSummary.provenance.sourceMessageIds, [40]);
    assert.deepEqual(retainedSummary.provenance.sourceSegmentIds, [shared.snapshot.fragments[0].fragmentId]);
    const filtered = createCoordinator("shared").store.filterForgottenSnapshot(shared.snapshot).snapshot;
    assert.equal(filtered.sourceRevision, shared.snapshot.sourceRevision);
    assert.deepEqual(filtered.counterpartIds, [3]);
    assert.deepEqual(filtered.fragments[0].knownBy, [ownerId, 1, 3]);
    assert.deepEqual(filtered.fragments[0].presentIds, [ownerId, 1, 3]);

    const sourceTarget = createProjectionLineage({ campaignToken, ownerId, conversationId, finalizationId: "old-proof",
      counterpartId: 1, segmentIds: ["summary-old-proof-a"], sourceMessageIds: [0, 10] });
    assert.equal(disclosureProofForgetMatch(sourceTarget, { sourceKind: "CONVERSATION", sourceFinalizationId: "old-proof",
      sourceMessageIds: [0, 10], sourceFragmentIds: ["opaque-segment"] }), true);
    assert.equal(disclosureProofForgetMatch(sourceTarget, { sourceKind: "CONVERSATION", sourceFinalizationId: "old-proof",
      sourceMessageIds: [0, 11], sourceFragmentIds: ["opaque-segment"] }), null);
    assert.equal(disclosureProofForgetMatch(sourceTarget, { sourceKind: "CONVERSATION", sourceFinalizationId: "old-proof",
      sourceMessageIds: [30], sourceFragmentIds: ["opaque-segment"] }), false);
    assert.equal(disclosureProofForgetMatch(createProjectionLineage({ campaignToken, ownerId, conversationId,
      finalizationId: "old-proof", counterpartId: 1, segmentIds: ["summary-old-proof-a"] }),
    { sourceKind: "CONVERSATION", sourceFinalizationId: "old-proof", sourceMessageIds: [11], sourceFragmentIds: ["opaque-segment"] }), null);
    const letterDisclosureTarget = createProjectionLineage({ campaignToken, ownerId, conversationId: "letter-conversation",
      finalizationId: "letter-finalization", sourceLetterId: "letter-42", counterpartId: 1 });
    assert.equal(disclosureProofForgetMatch(letterDisclosureTarget, { sourceKind: "LETTER", sourceLetterId: "letter-42",
      senderId: 1, recipientId: ownerId }), true);
    assert.equal(disclosureProofForgetMatch(letterDisclosureTarget, { sourceKind: "LETTER", sourceLetterId: "letter-42",
      senderId: 3, recipientId: ownerId }), false);

    const letter = createCoordinator("legacy-letter");
    const letterSnapshot = { campaignToken, ownerId, sourceKind: "LETTER", letterId: "letter-42", senderId: 1, recipientId: ownerId,
      conversationId: "letter-conversation-42", finalizationId: "letter-finalization-42", episodeId: "letter-episode-42",
      date: "1164.1.1", totalDays: 425000, sourceRevision: hash(["letter-42", "source"]), presentMessageCount: 0,
      completeness: "complete", summaryIds: ["narrative-memory-42"], counterpartIds: [], projectionLineages: [], fragments: [{
        fragmentId: "letter-fragment-42", messageId: null, sourceMessageIds: [], text: "The old letter's exact source remains mapped.",
        speakerId: 1, speakerIds: [1], sourceTextVerified: true, sourceRole: "user", presentIds: [], knownBy: [ownerId],
        visibility: "private", sourceType: "spoken", recipientIds: [], entityIds: [], visibilityEvidence: "validated_letter",
        sourceLetterId: "letter-42", eventDate: "1164.1.1"
      }] };
    const letterCandidate = { memoryType: "DURABLE_KNOWLEDGE", text: "letter fact", fragmentIds: ["letter-fragment-42"],
      participantIds: [], entityIds: [], topics: ["letter"], eventTime: { status: "unknown" } };
    letter.store.commitOwner(letterSnapshot, { status: "STORE", entries: [letterCandidate] });
    const oldLetterSummary = { campaignToken, conversationId: letterSnapshot.conversationId,
      finalizationId: letterSnapshot.finalizationId, perspectiveOwnerId: ownerId, characterId: 1,
      perspectiveMemoryIds: ["narrative-memory-42"] };
    letter.forgetSummaryProjection(oldLetterSummary, { ownerId, counterpartId: 1 });
    assert.deepEqual(createCoordinator("legacy-letter").store.query({ campaignToken, ownerId }), []);

    const proofCoordinator = createCoordinator("old-disclosure");
    const oldProofContext = context("old-proof");
    proofCoordinator.store.commitOwner(oldProofContext.snapshot, { status: "NO_DURABLE_CONTENT", entries: [] });
    proofCoordinator.baseStore.writeJson(path.join(proofCoordinator.store.directory(sharedScope), "known-entities.json"), knownDisclosure({
      sourceId: oldProofContext.snapshot.finalizationId, conversationId, sourceRevision: oldProofContext.snapshot.sourceRevision,
      sourceMessageIds: [0], sourceFragmentIds: ["opaque-segment"]
    }));
    const oldProjection = createProjectionLineage({ campaignToken, ownerId, conversationId,
      finalizationId: oldProofContext.snapshot.finalizationId, counterpartId: 1,
      segmentIds: ["summary-old-proof-a"], sourceMessageIds: [0] });
    proofCoordinator.store.persistForgottenProjection(sharedScope, oldProjection);
    assert.deepEqual(Object.values(proofCoordinator.store.getDisclosedFacts(sharedScope, 9)[0].evidenceBySource), []);
    proofCoordinator.store.revokeProjectionDisclosures(sharedScope, oldProjection);
    assert.deepEqual(proofCoordinator.store.getDisclosedFacts(sharedScope, 9), []);

    const unmappedCoordinator = createCoordinator("unmapped-disclosure");
    const unmappedContext = context("unmapped-proof");
    unmappedCoordinator.store.commitOwner(unmappedContext.snapshot, { status: "NO_DURABLE_CONTENT", entries: [] });
    unmappedCoordinator.baseStore.writeJson(path.join(unmappedCoordinator.store.directory(sharedScope), "known-entities.json"), knownDisclosure({
      sourceId: unmappedContext.snapshot.finalizationId, conversationId, sourceRevision: unmappedContext.snapshot.sourceRevision,
      sourceMessageIds: [31], sourceFragmentIds: ["unmapped-fragment"]
    }));
    const unmappedProjection = createProjectionLineage({ campaignToken, ownerId, conversationId,
      finalizationId: unmappedContext.snapshot.finalizationId, counterpartId: 1, segmentIds: ["summary-unmapped-a"] });
    unmappedCoordinator.store.persistForgottenProjection(sharedScope, unmappedProjection);
    assert.throws(() => unmappedCoordinator.store.getDisclosedFacts(sharedScope, 9), /memory4_projection_disclosure_unmapped/);
    assert.throws(() => unmappedCoordinator.store.revokeProjectionDisclosures(sharedScope, unmappedProjection), /memory4_projection_disclosure_unmapped/);

    const unknown = context("finalization-unknown-source");
    const retryCoordinator = createCoordinator("unknown-source");
    const failed = await retryCoordinator.finishOwner(unknown.snapshot, async () => JSON.stringify({ status: "STORE", entries: [
      { ...unknown.candidateC, fragmentIds: [...unknown.candidateC.fragmentIds, "unrecognized-source"] }
    ] }));
    assert.equal(failed.status, "EXTRACTION_FAILED");
    assert.equal(failed.error, "memory4_response_source_mismatch");
    const retried = await retryCoordinator.recoverPending(async () => JSON.stringify({ status: "STORE", entries: [unknown.candidateC] }),
      { activeCampaignToken: campaignToken, isNarrativeCommitted: () => true });
    assert.equal(retried[0].status, "STORE");
    assert.deepEqual(retryCoordinator.store.query({ campaignToken, ownerId }).map(entry => entry.text), ["remembered fact C"]);

    const derived = context("finalization-derived");
    const derivedCoordinator = createCoordinator("derived");
    derivedCoordinator.store.commitOwner(derived.snapshot, { status: "STORE", entries: [derived.candidateA, derived.candidateC] });
    const derivedScope = { campaignToken, ownerId };
    const derivedEntries = derivedCoordinator.store.query(derivedScope);
    const derivedA = derivedEntries.find(entry => entry.text === "remembered fact A");
    const derivedC = derivedEntries.find(entry => entry.text === "remembered fact C");
    derivedCoordinator.baseStore.writeJson(derivedCoordinator.derived.file(derivedScope, "year", 1164), {
      memory4SchemaVersion: 1, campaignToken, ownerId, revision: 1, eventYear: 1164, sourceRevisionSet: [], sourceHash: "stale",
      items: [{ segmentId: "year-a", sourceEntryIds: [derivedA.entryId], text: "FORGOTTEN_WRONG_FACT" },
        { segmentId: "year-c", sourceEntryIds: [derivedC.entryId], text: "retained year fact" }]
    });
    derivedCoordinator.baseStore.writeJson(derivedCoordinator.derived.file(derivedScope, "life"), {
      memory4SchemaVersion: 1, campaignToken, ownerId, revision: 1, sourceRevisionSet: [], sourceHash: "stale",
      segments: [{ segmentId: "life-a", sourceEntryIds: [derivedA.entryId], text: "FORGOTTEN_WRONG_FACT" },
        { segmentId: "life-c", sourceEntryIds: [derivedC.entryId], text: "retained life fact" }]
    });
    derivedCoordinator.forgetSummaryProjection(derived.summaryA, { ownerId, counterpartId: 1 });
    const derivedDto = JSON.stringify(createCoordinator("derived").derived.list(derivedScope));
    assert.equal(derivedDto.includes("FORGOTTEN_WRONG_FACT"), false);
    assert.equal(derivedDto.includes("retained year fact"), true);
    assert.equal(derivedDto.includes("retained life fact"), true);
    console.log("PASS pending recovery forget survives restart without reviving A");
    console.log("PASS deleting B-A leaves same-finalization B-C canonical projection intact");
    console.log("PASS shared source retains B-C lineage and factual presence after deleting B-A");
    console.log("PASS shared disclosure evidence retains B-C lineage after deleting B-A");
    console.log("PASS unknown source fails closed and recovery retry succeeds");
    console.log("PASS old disclosure mapping handles message ID 0 and fails closed when unmapped");
    console.log("PASS old pair disclosure is not revoked by same-finalization B-C message");
    console.log("PASS historical letter canonical is removed by exact summary source ID");
    console.log("PASS persisted derived year/life text is scrubbed while unrelated items remain");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
