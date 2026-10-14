"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const versionPath = require.resolve("../src/app/main/version");
require.cache[versionPath] = { exports: {
  VOTC_CORE_VERSION: "9.2",
  VOTC_APP_VERSION: require("../package.json").version,
  MEMORY_ENGINE_VERSION: "3.0",
  ACTION_SYSTEM_VERSION: "official-votc-2.0.3",
  SUPPORTED_PERSPECTIVE_SUMMARY_ENGINE_VERSIONS: new Set(["2.3", "2.4", "2.5", "3.0"])
} };
const { MemoryStore } = require("../src/app/main/memory-system/memory-store");
const { Memory4Coordinator } = require("../src/app/main/memory-system/memory4-coordinator");
const { hash } = require("../src/app/main/memory-system/memory4-contract");
const { createProjectionLineage } = require("../src/app/main/memory-system/memory4-forget");

const temporaryRoot = fs.mkdtempSync(path.join(__dirname, ".votc-v921-cache-invariants-"));
const participants = [{ id: 1, name: "甲" }, { id: 2, name: "乙" }, { id: 3, name: "丙" }];

function createCoordinator(label) {
  const directory = path.join(temporaryRoot, label);
  const summaryFoldersDir = path.join(directory, "summaries");
  for (const person of participants) fs.mkdirSync(path.join(summaryFoldersDir, `${person.id}_fixture`), { recursive: true });
  const store = new MemoryStore({ baseDir: path.join(directory, "memory"), summaryFoldersDir });
  const coordinator = new Memory4Coordinator(store);
  return { coordinator, store: coordinator.store };
}

function makeFragment({ fragmentId, text, messageId, ownerId = 2, counterpartId = 1, privateSource = false }) {
  return {
    fragmentId,
    messageId,
    sourceMessageIds: [messageId],
    text,
    speakerId: ownerId,
    speakerIds: [ownerId],
    sourceTextVerified: true,
    sourceRole: "assistant",
    presentIds: counterpartId == null ? [ownerId] : [ownerId, counterpartId],
    knownBy: counterpartId == null ? [ownerId] : [ownerId, counterpartId],
    visibility: privateSource ? "private" : "participants",
    sourceType: "spoken",
    recipientIds: privateSource || counterpartId == null ? [] : [counterpartId],
    entityIds: privateSource || counterpartId == null ? [] : [counterpartId],
    visibilityEvidence: "application_fragment"
  };
}

function makeSnapshot({ label, campaignToken = `campaign-${label}`, ownerId = 2, fragments, lineages = [] }) {
  const counterpartIds = [...new Set(fragments.flatMap(fragment => fragment.presentIds).filter(id => id !== ownerId))]
    .sort((left, right) => left - right);
  return {
    campaignToken,
    ownerId,
    conversationId: `conversation-${label}`,
    finalizationId: `finalization-${label}`,
    episodeId: `episode-${label}`,
    date: "1164.8.12",
    totalDays: 425000,
    sourceRevision: hash([campaignToken, ownerId, label, fragments]),
    presentMessageCount: fragments.length,
    completeness: "complete",
    summaryIds: [],
    counterpartIds,
    fragments,
    projectionLineages: lineages,
    relationshipChangeEntityIds: [],
    skipKnownEvidence: true
  };
}

function makeLineage(snapshot, fragment, counterpartId, suffix) {
  const lineage = createProjectionLineage({
    campaignToken: snapshot.campaignToken,
    ownerId: snapshot.ownerId,
    conversationId: snapshot.conversationId,
    finalizationId: snapshot.finalizationId,
    counterpartId,
    segmentIds: [`summary-${snapshot.finalizationId}-${suffix}`],
    sourceSegmentIds: [fragment.fragmentId],
    sourceMessageIds: fragment.sourceMessageIds
  });
  const summary = {
    campaignToken: snapshot.campaignToken,
    conversationId: snapshot.conversationId,
    finalizationId: snapshot.finalizationId,
    perspectiveOwnerId: snapshot.ownerId,
    characterId: counterpartId,
    projectionId: lineage.projectionId,
    perspectiveSummarySegmentIds: lineage.segmentIds,
    sourceSegmentIds: lineage.sourceSegmentIds,
    sourceMessageIds: lineage.sourceMessageIds
  };
  return { lineage, summary };
}

function makeTwoProjectionFixture(label) {
  const { coordinator, store } = createCoordinator(label);
  const fragmentA = makeFragment({ fragmentId: `fragment-${label}-A`, text: `FORGOTTEN_${label}_A`, messageId: 10, counterpartId: 1 });
  const fragmentC = makeFragment({ fragmentId: `fragment-${label}-C`, text: `RETAINED_${label}_C`, messageId: 30, counterpartId: 3 });
  const snapshot = makeSnapshot({ label, fragments: [fragmentA, fragmentC] });
  const projectionA = makeLineage(snapshot, fragmentA, 1, "a");
  const projectionC = makeLineage(snapshot, fragmentC, 3, "c");
  snapshot.projectionLineages = [projectionA.lineage, projectionC.lineage];
  return { coordinator, store, snapshot, fragmentA, fragmentC, summaryA: projectionA.summary };
}

function promptUser(prompt) {
  const message = [...prompt].reverse().find(row => row?.role === "user");
  assert(message && typeof message.content === "string", "Durable Prompt must contain a JSON User payload");
  return { message, payload: JSON.parse(message.content) };
}

function systemBytes(prompt) {
  return prompt.filter(row => row?.role === "system").map(row => row.content).join("\n");
}

function candidate(fragment, text = fragment.text, entityIds = []) {
  return {
    memoryType: "DURABLE_KNOWLEDGE",
    text,
    fragmentIds: [fragment.fragmentId],
    entityIds,
    participantIds: fragment.presentIds,
    topics: [],
    eventTime: { from: null, to: null, precision: "unknown", status: "unknown" }
  };
}

function completeResult(entries = [], commitmentTransitions = []) {
  return {
    content: JSON.stringify({ status: entries.length ? "STORE" : "NO_DURABLE_CONTENT", entries, commitmentTransitions }),
    finish_reason: "stop"
  };
}

async function testForgetDuringBinaryRetryDoesNotReissueSource() {
  const fixture = makeTwoProjectionFixture("late-forget-binary");
  const prompts = [];
  let forgetResult;
  const result = await fixture.coordinator.finishOwner(fixture.snapshot, async prompt => {
    const { payload } = promptUser(prompt);
    prompts.push({ prompt, payload });
    if (prompts.length === 1) {
      assert.deepEqual(payload.fragments.map(fragment => fragment.fragmentId), [fixture.fragmentA.fragmentId, fixture.fragmentC.fragmentId]);
      forgetResult = fixture.coordinator.forgetSummaryProjection(fixture.summaryA, { ownerId: 2, counterpartId: 1 });
      return { content: "{}", finish_reason: "length" };
    }
    const retained = payload.fragments.find(fragment => fragment.fragmentId === fixture.fragmentC.fragmentId);
    return completeResult(retained ? [candidate(fixture.fragmentC, "retained C only")] : []);
  });

  assert.equal(forgetResult?.status, "FORGOTTEN", "the fixture must persist a real Memory4 Forget tombstone");
  for (const request of prompts.slice(1)) {
    assert.equal(request.payload.fragments.some(fragment => fragment.fragmentId === fixture.fragmentA.fragmentId), false,
      "a fragment forgotten while the first request was outstanding must not be included in any retry payload");
    assert.equal(JSON.stringify(request.prompt).includes(fixture.fragmentA.text), false,
      "the forgotten source text must not cross the Provider boundary on retry");
  }
  assert.equal(prompts.length, 2, "binary retry should skip the forgotten half and submit the retained half once");
  assert.equal(result.status, "STORE");
  assert.deepEqual(fixture.store.query(fixture.snapshot).map(entry => entry.text), ["retained C only"],
    "the still-authorized sibling source remains commit eligible");
}

async function testForgetOfNextOuterChunkIsFilteredBeforeRequest() {
  const { coordinator, store } = createCoordinator("late-forget-next-chunk");
  const retainedFragments = Array.from({ length: 128 }, (_, index) => makeFragment({
    fragmentId: `chunk-retained-${index + 1}`,
    text: `RETAINED_CHUNK_SOURCE_${index + 1}`,
    messageId: index + 1,
    counterpartId: 1
  }));
  const forgottenFragment = makeFragment({ fragmentId: "chunk-forgotten-129", text: "FORGOTTEN_NEXT_CHUNK_SOURCE",
    messageId: 129, counterpartId: 3 });
  const snapshot = makeSnapshot({ label: "late-forget-next-chunk", fragments: [...retainedFragments, forgottenFragment] });
  const projection = makeLineage(snapshot, forgottenFragment, 3, "tail");
  snapshot.projectionLineages = [projection.lineage];
  const prompts = [];
  let forgetResult;
  const result = await coordinator.finishOwner(snapshot, async prompt => {
    const { payload } = promptUser(prompt);
    prompts.push({ prompt, payload });
    if (prompts.length === 1) {
      assert(payload.fragments.length > 0 && payload.fragments.length <= 128,
        "the first request must respect both the token budget and fragment cap");
      assert.equal(payload.fragments.some(fragment => fragment.fragmentId === forgottenFragment.fragmentId), false,
        "the fixture must put the forgotten source after the first budgeted chunk");
      forgetResult = coordinator.forgetSummaryProjection(projection.summary, { ownerId: 2, counterpartId: 3 });
    }
    return completeResult();
  });

  assert.equal(forgetResult?.status, "FORGOTTEN", "the fixture must persist a real Memory4 Forget tombstone");
  assert.deepEqual(prompts.flatMap(request => request.payload.fragments.map(fragment => fragment.fragmentId)).sort(),
    retainedFragments.map(fragment => fragment.fragmentId).sort(),
    "later budgeted chunks must retain every authorized fragment exactly once");
  assert.equal(JSON.stringify(prompts).includes(forgottenFragment.text), false,
    "the not-yet-requested forgotten source must never reach a later chunk request");
  assert.equal(result.status, "NO_DURABLE_CONTENT");
  assert.deepEqual(store.query(snapshot), []);
}

function testStablePolicyAndScopeLocalUserPayload() {
  const { coordinator } = createCoordinator("prompt-scopes");
  const fragmentA = makeFragment({ fragmentId: "scope-A-fragment", text: "PRIVATE_SCOPE_A_SENTINEL", messageId: 1, privateSource: true });
  const snapshotA = makeSnapshot({ label: "scope-A", campaignToken: "campaign-A", ownerId: 2, fragments: [fragmentA] });
  const snapshotAOtherLimits = { ...snapshotA };
  const fragmentB = makeFragment({ fragmentId: "scope-B-fragment", text: "PRIVATE_SCOPE_B_SENTINEL", messageId: 2, privateSource: true });
  const snapshotB = makeSnapshot({ label: "scope-B", campaignToken: "campaign-B", ownerId: 2, fragments: [fragmentB] });
  const fragmentC = makeFragment({ fragmentId: "scope-C-fragment", text: "PRIVATE_SCOPE_C_SENTINEL", messageId: 3, ownerId: 3, privateSource: true });
  const snapshotC = makeSnapshot({ label: "scope-C", campaignToken: "campaign-A", ownerId: 3, fragments: [fragmentC] });

  const promptA = coordinator.buildPrompt(snapshotA, snapshotA.fragments, 8, 8);
  const promptARepeat = coordinator.buildPrompt(snapshotA, snapshotA.fragments, 8, 8);
  const promptAOtherLimits = coordinator.buildPrompt(snapshotAOtherLimits, snapshotAOtherLimits.fragments, 6, 3);
  const promptB = coordinator.buildPrompt(snapshotB, snapshotB.fragments, 8, 8);
  const promptC = coordinator.buildPrompt(snapshotC, snapshotC.fragments, 8, 8);
  const userA = promptUser(promptA);
  const userARepeat = promptUser(promptARepeat);
  const userAOtherLimits = promptUser(promptAOtherLimits);
  const userB = promptUser(promptB);
  const userC = promptUser(promptC);

  assert.equal(systemBytes(promptA), systemBytes(promptAOtherLimits), "changing request limits must leave fixed System bytes unchanged");
  assert.equal(systemBytes(promptA), systemBytes(promptB), "Campaign identity and private evidence must stay out of fixed System bytes");
  assert.equal(systemBytes(promptA), systemBytes(promptC), "Owner identity and private evidence must stay out of fixed System bytes");
  assert.equal(userA.message.content, userARepeat.message.content, "identical Durable inputs must serialize to identical User bytes");
  assert.notEqual(userA.message.content, userAOtherLimits.message.content, "request limits remain dynamic User data");
  assert.deepEqual(userA.payload.limits, { maxEntries: 8, maxCommitmentTransitions: 8 });
  assert.deepEqual(userAOtherLimits.payload.limits, { maxEntries: 6, maxCommitmentTransitions: 3 });
  assert.equal(userA.payload.ownerId, 2);
  assert.equal(userA.payload.campaignToken, "campaign-A");
  assert.deepEqual(userA.payload.fragments.map(fragment => fragment.fragmentId), [fragmentA.fragmentId]);
  assert.equal(userA.message.content.includes(fragmentB.text), false);
  assert.equal(userA.message.content.includes(fragmentC.text), false);
  assert.equal(userB.payload.campaignToken, "campaign-B");
  assert.equal(userB.message.content.includes(fragmentA.text), false);
  assert.equal(userB.message.content.includes(fragmentC.text), false);
  assert.equal(userC.payload.ownerId, 3);
  assert.equal(userC.payload.campaignToken, "campaign-A");
  assert.equal(userC.message.content.includes(fragmentA.text), false);
  assert.equal(userC.message.content.includes(fragmentB.text), false);
}

function testEmptyEntryAndTransitionBudgetsStayHardLimits() {
  const { coordinator } = createCoordinator("zero-limits");
  const fragment = makeFragment({ fragmentId: "zero-limit-source", text: "limit fixture source", messageId: 1 });
  const snapshot = makeSnapshot({ label: "zero-limits", fragments: [fragment] });
  const validEntry = candidate(fragment);
  const validTransition = { entryId: "existing-commitment", expectedRevision: 1, status: "fulfilled",
    fragmentIds: [fragment.fragmentId], commitmentQuote: "归还玉印", evidenceQuote: "我已经归还玉印，履行了承诺。" };
  const noContentPayload = { status: "NO_DURABLE_CONTENT", entries: [] };

  assert.throws(() => coordinator.parseResult(JSON.stringify(noContentPayload), [fragment], snapshot),
    error => error.message === "memory4_generation_incomplete", "bare JSON strings lack terminal completion evidence");
  assert.throws(() => coordinator.parseResult({ content: JSON.stringify(noContentPayload) }, [fragment], snapshot),
    error => error.message === "memory4_generation_incomplete", "missing finish reason remains incomplete");

  assert.throws(() => coordinator.parseResult(completeResult([validEntry]),
    [fragment], snapshot, 0, 1), error => error.message === "memory4_response_invalid_shape",
  "zero entry budget must reject an entry before candidate validation");
  assert.throws(() => coordinator.parseResult(completeResult([], [validTransition]), [fragment], snapshot, 0, 0),
  error => error.message === "memory4_response_invalid_transitions",
  "zero transition budget must reject a transition even when entry budget is zero");
  const transitionsOnly = coordinator.parseResult(completeResult([], [validTransition]), [fragment], snapshot, 0, 1);
  assert.equal(transitionsOnly.status, "NO_DURABLE_CONTENT");
  assert.deepEqual(transitionsOnly.entries, []);
  assert.deepEqual(transitionsOnly.commitmentTransitions, [validTransition]);
}

function testUnknownEntityFilteringRemainsCountOnly() {
  const { coordinator } = createCoordinator("unknown-entity-filter");
  const fragment = makeFragment({ fragmentId: "unknown-entity-source", text: "verified source", messageId: 1 });
  const snapshot = makeSnapshot({ label: "unknown-entity-filter", fragments: [fragment] });
  const valid = candidate(fragment, "authorized fact");
  const unknown = candidate(fragment, "unverified third-party fact", [999]);
  const parsed = coordinator.parseResult(completeResult([unknown, valid]),
    [fragment], snapshot, 8, 8);

  assert.equal(parsed.status, "STORE");
  assert.deepEqual(parsed.entries, [valid], "unknown entity IDs remain rejected while authorized candidates survive");
  assert.equal(parsed.rejectedUnknownEntityCount, 1, "rejections stay count-only and do not alter valid candidate semantics");
}

async function testOrdinary129FragmentsRespectTokenAndFragmentBudgets() {
  const { coordinator } = createCoordinator("ordinary-outer-batches");
  const fragments = Array.from({ length: 129 }, (_, index) => makeFragment({
    fragmentId: `ordinary-batch-${index + 1}`,
    text: `ORDINARY_SOURCE_${index + 1}`,
    messageId: index + 1
  }));
  const snapshot = makeSnapshot({ label: "ordinary-outer-batches", fragments });
  const requests = [];
  const result = await coordinator.finishOwner(snapshot, async (prompt, options) => {
    const { payload } = promptUser(prompt);
    requests.push({ fragmentIds: payload.fragments.map(fragment => fragment.fragmentId), maxTokens: options.maxTokens,
      limits: payload.limits, inputBudget: coordinator.estimateDurableInput(prompt) });
    return completeResult();
  });

  assert.equal(result.status, "NO_DURABLE_CONTENT");
  assert(requests.length > 1);
  assert.deepEqual(requests.flatMap(request => request.fragmentIds).sort(), fragments.map(fragment => fragment.fragmentId).sort());
  for (const request of requests) {
    assert(request.fragmentIds.length <= 128 && request.inputBudget <= 8192);
    assert.equal(request.maxTokens, 4096);
    assert.deepEqual(request.limits, { maxEntries: 8, maxCommitmentTransitions: 0 });
  }
}

function conversationContext(label, texts, date) {
  const messages = texts.map(([speakerCharacterId, content], index) => ({ id: index + 1,
    role: speakerCharacterId === 1 ? "user" : "assistant", speakerCharacterId, content }));
  return {
    campaignToken: "commitment-scope",
    conversationId: `conversation-${label}`,
    finalizationId: `finalization-${label}`,
    episodeId: `episode-${label}`,
    date,
    finalizationVisibilityV1: true,
    participants,
    participantPresence: participants.slice(0, 2).map(person => ({ characterId: person.id, joinedAtMessageId: 0, leftAtMessageId: null })),
    messages,
    verifiedSummarySegments: messages.map(message => ({ segmentId: `segment-${label}-${message.id}`, content: message.content,
      participants: [1, 2], visibility: "public", source: "spoken", knownBy: [1, 2],
      provenance: { messageIds: [message.id], speakerIds: [message.speakerCharacterId] } }))
  };
}

async function testCommitmentOnlyBinaryRetryConsumesOnlyTransitionBudget() {
  const { coordinator, store } = createCoordinator("commitment-transition-retry");
  const promiseText = "我承诺归还玉印。";
  const initial = coordinator.buildOwnerSnapshot(conversationContext("promise-start", [
    [1, promiseText], [2, "我记住这个承诺。"]
  ], "1180.1.1"), 2);
  const promiseFragment = initial.fragments.find(fragment => fragment.text === promiseText);
  assert(promiseFragment, "the initial promise fixture must be a verified owner-visible fragment");
  const saved = store.commitOwner(initial, { status: "STORE", entries: [{ memoryType: "COMMITMENT", text: promiseText,
    fragmentIds: [promiseFragment.fragmentId], entityIds: [1], participantIds: [1, 2], topics: ["玉印"],
    eventTime: { from: null, to: null, precision: "unknown", status: "unknown" } }] });
  const evidenceQuote = "我已经归还玉印，履行了归还玉印的承诺。";
  const followup = coordinator.buildOwnerSnapshot(conversationContext("promise-fulfilled", [
    [1, evidenceQuote], [2, "我听见了。"]
  ], "1181.1.1"), 2);
  const prompts = [];
  const result = await coordinator.finishOwner(followup, async prompt => {
    const { payload } = promptUser(prompt);
    prompts.push({ prompt, payload });
    if (prompts.length === 1) return { content: "{}", finish_reason: "length" };
    if (prompts.length === 2) {
      const evidence = payload.fragments.find(fragment => fragment.text === evidenceQuote);
      assert(evidence, "the first binary child must contain the verified completion quote");
      assert(payload.activeCommitments.some(item => item.entryId === saved.entryIds[0] && item.expectedRevision === 1),
        "the transition target must be the active, revision-bound commitment");
      return completeResult([], [{ entryId: saved.entryIds[0], expectedRevision: 1, status: "fulfilled",
        fragmentIds: [evidence.fragmentId], commitmentQuote: "归还玉印", evidenceQuote }]);
    }
    return completeResult();
  });

  assert.equal(prompts.length, 3, "an incomplete pair must split into exactly two source-bounded requests");
  assert.deepEqual(prompts.map(request => request.payload.limits), [
    { maxEntries: 8, maxCommitmentTransitions: 8 },
    { maxEntries: 8, maxCommitmentTransitions: 8 },
    { maxEntries: 8, maxCommitmentTransitions: 7 }
  ], "a transition-only first child decrements only the next child's transition allowance");
  assert.equal(result.status, "NO_DURABLE_CONTENT", "a transition-only result must not be relabeled as STORE");
  assert.deepEqual(result.entryIds, []);
  assert.equal(result.commitmentTransitionCount, 1);
  const committed = store.readEntry(followup, saved.entryIds[0]);
  assert.equal(committed.state.status, "fulfilled");
  assert.equal(committed.revision, 2);
  assert.equal(committed.state.revision, 2);
  assert.equal(committed.state.commitmentQuote, "归还玉印");
  assert.equal(committed.state.evidenceQuote, evidenceQuote);
  assert.deepEqual(committed.state.source.fragmentIds, [followup.fragments.find(fragment => fragment.text === evidenceQuote).fragmentId]);
  assert.deepEqual(committed.state.source.messageIds, [followup.fragments.find(fragment => fragment.text === evidenceQuote).messageId]);
}

async function testPromptScopesPersistOnlyWithinTheirOwnerCampaign() {
  const { coordinator, store } = createCoordinator("scope-persistence");
  const snapshots = [
    makeSnapshot({ label: "persist-A", campaignToken: "campaign-A", ownerId: 2,
      fragments: [makeFragment({ fragmentId: "persist-A-fragment", text: "PERSISTED_SCOPE_A", messageId: 101, privateSource: true })] }),
    makeSnapshot({ label: "persist-B", campaignToken: "campaign-B", ownerId: 2,
      fragments: [makeFragment({ fragmentId: "persist-B-fragment", text: "PERSISTED_SCOPE_B", messageId: 102, privateSource: true })] }),
    makeSnapshot({ label: "persist-C", campaignToken: "campaign-A", ownerId: 3,
      fragments: [makeFragment({ fragmentId: "persist-C-fragment", text: "PERSISTED_SCOPE_C", messageId: 103, ownerId: 3, privateSource: true })] })
  ];

  for (const snapshot of snapshots) {
    const result = await coordinator.finishOwner(snapshot, async prompt => {
      const { payload } = promptUser(prompt);
      const fragment = payload.fragments[0];
      return completeResult([candidate(snapshot.fragments[0], fragment.text)]);
    });
    assert.equal(result.status, "STORE");
  }

  assert.deepEqual(store.query({ campaignToken: "campaign-A", ownerId: 2 }).map(entry => entry.text), ["PERSISTED_SCOPE_A"]);
  assert.deepEqual(store.query({ campaignToken: "campaign-B", ownerId: 2 }).map(entry => entry.text), ["PERSISTED_SCOPE_B"]);
  assert.deepEqual(store.query({ campaignToken: "campaign-A", ownerId: 3 }).map(entry => entry.text), ["PERSISTED_SCOPE_C"]);
  assert.deepEqual(store.query({ campaignToken: "campaign-B", ownerId: 3 }), []);
  assert.deepEqual(store.query({ campaignToken: "campaign-A", ownerId: 1 }), []);
}

async function run() {
  try {
    await testForgetDuringBinaryRetryDoesNotReissueSource();
    console.log("PASS late Forget is removed before binary retry");
    await testForgetOfNextOuterChunkIsFilteredBeforeRequest();
    console.log("PASS late Forget is removed before later outer chunk");
    testStablePolicyAndScopeLocalUserPayload();
    console.log("PASS fixed Durable policy and scoped User payload");
    testEmptyEntryAndTransitionBudgetsStayHardLimits();
    console.log("PASS zero budgets remain hard parse limits");
    testUnknownEntityFilteringRemainsCountOnly();
    console.log("PASS unknown entity filtering remains count-only for rejected candidates");
    await testOrdinary129FragmentsRespectTokenAndFragmentBudgets();
    console.log("PASS ordinary 129 fragments obey token and fragment budgets without losing evidence");
    await testCommitmentOnlyBinaryRetryConsumesOnlyTransitionBudget();
    console.log("PASS transition-only binary retry preserves evidence and consumes transition budget");
    await testPromptScopesPersistOnlyWithinTheirOwnerCampaign();
    console.log("PASS durable results remain isolated by Owner and Campaign");
  } finally {
    const target = path.resolve(temporaryRoot);
    assert(target.startsWith(path.resolve(__dirname) + path.sep), "fixture cleanup target must remain under the scripts directory");
    fs.rmSync(target, { recursive: true, force: true });
  }
}

run().catch(error => {
  console.error("V9.2.1 cache invariants failed:", error.stack || error);
  process.exitCode = 1;
});
