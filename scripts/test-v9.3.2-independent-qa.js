"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const versionPath = require.resolve("../src/app/main/version");
require.cache[versionPath] = { exports: {
  VOTC_CORE_VERSION: "9.2",
  VOTC_APP_VERSION: require("../package.json").version,
  MEMORY_ENGINE_VERSION: "3.0",
  ACTION_SYSTEM_VERSION: "official-votc-2.0.3",
  SUPPORTED_PERSPECTIVE_SUMMARY_ENGINE_VERSIONS: new Set(["2.3", "2.4", "2.5", "3.0"])
} };

const { TokenCounter } = require("../src/app/main/provider-service");
const { MemoryStore } = require("../src/app/main/memory-system/memory-store");
const { Memory4Coordinator } = require("../src/app/main/memory-system/memory4-coordinator");
const { hash, legacySourceHash } = require("../src/app/main/memory-system/memory4-contract");
const { createProjectionLineage } = require("../src/app/main/memory-system/memory4-forget");

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v932-independent-qa-"));
const OWNER_ID = 2;
const COUNTERPART_ID = 1;
const INPUT_TOKEN_BUDGET = 8192;

function makeFragment(fragmentId, marker, messageId, { ownerId = OWNER_ID, textSize = 0 } = {}) {
  return { fragmentId, messageId, sourceMessageIds: [messageId], text: `${marker}${"x".repeat(textSize)}`,
    speakerId: ownerId, speakerIds: [ownerId], sourceTextVerified: true, sourceRole: "assistant",
    presentIds: [ownerId, COUNTERPART_ID], knownBy: [ownerId, COUNTERPART_ID], visibility: "participants",
    sourceType: "spoken", recipientIds: [COUNTERPART_ID], entityIds: [COUNTERPART_ID],
    visibilityEvidence: "application_fragment" };
}

function makeSnapshot(label, fragments, { ownerId = OWNER_ID, campaignToken = `campaign-${label}`,
  finalizationId = `finalization-${label}`, projectionLineages = [] } = {}) {
  return { campaignToken, ownerId, conversationId: `conversation-${label}`, finalizationId,
    episodeId: `episode-${label}`, date: "1181.1.1", totalDays: 431000,
    sourceRevision: hash([campaignToken, finalizationId, fragments]), presentMessageCount: fragments.length,
    completeness: "complete", summaryIds: [], counterpartIds: [COUNTERPART_ID], fragments,
    projectionLineages, relationshipChangeEntityIds: [], entityNameEvidence: [], relationshipEvidence: [],
    skipKnownEvidence: true };
}

function makeFixture(label) {
  const directory = path.join(temporaryRoot, label);
  const summaryFoldersDir = path.join(directory, "summaries");
  for (const ownerId of [1, 2, 3, 9]) fs.mkdirSync(path.join(summaryFoldersDir, `${ownerId}_fixture`), { recursive: true });
  const baseStore = new MemoryStore({ baseDir: path.join(directory, "memory"), summaryFoldersDir });
  const coordinator = new Memory4Coordinator(baseStore);
  coordinator.derived.schedule = async () => ({ status: "COMPLETE" });
  return { coordinator, baseStore };
}

function candidate(fragment, text, { entityIds = [], status = "unknown", fragmentIds = [fragment.fragmentId],
  participantIds = [OWNER_ID, COUNTERPART_ID] } = {}) {
  return { memoryType: "DURABLE_KNOWLEDGE", text, fragmentIds, entityIds,
    participantIds, topics: [],
    eventTime: { from: null, to: null, precision: "unknown", status } };
}

function completed(entries = [], commitmentTransitions = []) {
  return { content: JSON.stringify({ status: entries.length ? "STORE" : "NO_DURABLE_CONTENT", entries, commitmentTransitions }),
    finish_reason: "stop" };
}

function makeRequest(handler) {
  const calls = [];
  return {
    calls,
    request: async (prompt, options = {}) => {
      options.beforeSendGuard?.();
      const call = { prompt, text: JSON.stringify(prompt), tokens: TokenCounter.calculateTotalTokens(prompt), options };
      calls.push(call);
      return handler(call, calls.length - 1);
    }
  };
}

function query(coordinator, snapshot) {
  return coordinator.store.query({ campaignToken: snapshot.campaignToken, ownerId: snapshot.ownerId });
}

async function testInvalidEventStatusDoesNotDiscardValidCandidate() {
  const { coordinator } = makeFixture("invalid-status-isolated");
  const fragment = makeFragment("status-fragment", "STATUS_SOURCE");
  const snapshot = makeSnapshot("invalid-status-isolated", [fragment]);
  const valid = candidate(fragment, "VALID_CANDIDATE_SURVIVES");
  const invalid = candidate(fragment, "INVALID_STATUS_MUST_NOT_PERSIST", { status: "completed" });
  const pipeline = makeRequest((_call, index) => completed(index === 0 ? [invalid, valid] : []));

  const result = await coordinator.finishOwner(snapshot, pipeline.request);
  assert.equal(result.status, "STORE", JSON.stringify(result));
  assert.equal(pipeline.calls.length, 2, "one typed business repair request should be allowed");
  assert.equal(pipeline.calls[1].text.includes(invalid.text), false, "repair must not receive the rejected model output as evidence");
  assert.deepEqual(query(coordinator, snapshot).map(entry => entry.text), ["VALID_CANDIDATE_SURVIVES"]);
  assert.equal(query(coordinator, snapshot).some(entry => entry.text === "INVALID_STATUS_MUST_NOT_PERSIST"), false);
}

async function testQuotedNumericIdsRemainStrict() {
  const idFixture = makeFixture("quoted-numeric-ids-rejected");
  const idFragment = makeFragment("quoted-id-fragment", "QUOTED_ID_SOURCE");
  const idSnapshot = makeSnapshot("quoted-numeric-ids-rejected", [idFragment]);
  const quotedEntityId = candidate(idFragment, "QUOTED_ENTITY_ID_MUST_NOT_PERSIST", {
    entityIds: [String(COUNTERPART_ID)]
  });
  const quotedParticipantId = candidate(idFragment, "QUOTED_PARTICIPANT_ID_MUST_NOT_PERSIST", {
    entityIds: [COUNTERPART_ID], participantIds: [String(COUNTERPART_ID)]
  });
  const corrected = candidate(idFragment, "NUMERIC_ID_CORRECTION_ONLY", {
    entityIds: [COUNTERPART_ID], participantIds: [COUNTERPART_ID]
  });
  const idPipeline = makeRequest((_call, index) => completed(index === 0
    ? [quotedEntityId, quotedParticipantId] : [corrected]));
  const idResult = await idFixture.coordinator.finishOwner(idSnapshot, idPipeline.request);
  assert.equal(idResult.status, "STORE", JSON.stringify(idResult));
  assert.equal(idPipeline.calls.length, 2, "invalid string IDs should receive one bounded correction attempt");
  const idRepairCodes = JSON.parse(idPipeline.calls[1].prompt[1].content).repair.validationCodes;
  assert(idRepairCodes.includes("memory4_unknown_entity"), "quoted entity IDs must be rejected rather than silently normalized");
  assert(idRepairCodes.includes("memory4_invalid_participant"), "quoted participant IDs must be rejected rather than silently normalized");
  assert.deepEqual(query(idFixture.coordinator, idSnapshot).map(entry => entry.text), [corrected.text]);
}

async function testSourceDerivedMetadataNormalizationIsNarrow() {
  const { coordinator, baseStore } = makeFixture("source-derived-metadata-correction");
  const fragment = makeFragment("metadata-correction-fragment", "METADATA_CORRECTION_SOURCE");
  const snapshot = makeSnapshot("source-derived-metadata-correction", [fragment]);
  const observed = candidate(fragment, "PRESERVE_THE_CANDIDATE_PROSE_VERBATIM", { status: "observed" });
  observed.eventTime.precision = "month";
  assert.throws(() => coordinator.parseResult(completed([observed]), [fragment], snapshot), /memory4_unverified_observation/,
    "direct strict parsing must continue rejecting observed metadata from spoken sources");
  const invalidPrecision = candidate(fragment, "STRICT_PRECISION_CHECK", { status: "reported" });
  invalidPrecision.eventTime.precision = "month";
  assert.throws(() => coordinator.parseResult(completed([invalidPrecision]), [fragment], snapshot), /memory4_invalid_precision/,
    "direct strict parsing must continue rejecting a precision without dates");

  const pipeline = makeRequest(() => completed([observed]));
  const result = await coordinator.finishOwner(snapshot, pipeline.request);
  assert.equal(result.status, "STORE", JSON.stringify(result));
  assert.equal(pipeline.calls.length, 1, "source-derived metadata correction should not trigger another provider call");
  const entry = query(coordinator, snapshot).find(row => row.text === observed.text);
  assert(entry, "the corrected candidate should persist");
  assert.equal(entry.text, observed.text, "metadata correction must leave candidate prose unchanged");
  assert.deepEqual(entry.eventTime, { from: null, to: null, precision: "unknown", status: "reported" });
  assert.deepEqual(entry.source.segmentIds, [fragment.fragmentId]);
  assert.equal(entry.evidence.sourceType, "spoken");
  assert.equal(entry.evidence.epistemicStatus, "reported");
  const record = coordinator.store.loadIndex(snapshot).finalizations[hash(snapshot.finalizationId)];
  assert.equal(record.localMetadataCorrectionCount, 1,
    "the canonical commit record should audit the locally corrected candidate");
  assert.equal(result.localMetadataCorrectionCount, 1);

  const unknown = candidate(fragment, "UNKNOWN_ENTITY_STAYS_REJECTED", { entityIds: [777] });
  const unknownPipeline = makeRequest(() => completed([unknown]));
  const unknownResult = await makeFixture("metadata-correction-does-not-authorize-entities");
  const unknownSnapshot = makeSnapshot("metadata-correction-does-not-authorize-entities", [fragment]);
  const rejected = await unknownResult.coordinator.finishOwner(unknownSnapshot, unknownPipeline.request);
  assert.equal(rejected.status, "EXTRACTION_FAILED");
  assert.equal(query(unknownResult.coordinator, unknownSnapshot).length, 0,
    "metadata-only normalization must not authorize unknown entities");
  assert.equal(unknownPipeline.calls.length, 2, "unknown entity output remains a validation failure with one bounded repair");
}

async function testEventTimeRepairPreservesSourceEvidenceAndOtherContracts() {
  const { coordinator } = makeFixture("event-time-hint-source-boundaries");
  const campaignToken = "campaign-event-time-hint-source-boundaries";
  const originalFragment = makeFragment("event-time-commitment-origin", "承诺归还玉印，须先抵达邺城。", 1);
  const originalSnapshot = makeSnapshot("event-time-commitment-origin", [originalFragment], {
    campaignToken, finalizationId: "event-time-commitment-original"
  });
  const original = coordinator.store.commitOwner(originalSnapshot, { status: "STORE", entries: [{
    ...candidate(originalFragment, originalFragment.text), memoryType: "COMMITMENT", topics: ["玉印"]
  }] });

  const dated = makeFragment("event-time-authorized-date", "1164年6月3日发生议和。", 2);
  const undated = makeFragment("event-time-unsupported-date", "甲说多年前曾经筹粮，日期未明；我已经归还玉印。", 3);
  const future = makeFragment("event-time-future-intention", "乙说，明年准备归还玉印。", 4);
  const snapshot = makeSnapshot("event-time-hint-source-boundaries", [dated, undated, future], {
    campaignToken, finalizationId: "event-time-hint-finalization"
  });
  const exactCandidate = { ...candidate(dated, "EXACT_SOURCE_DATE_REMAINS_AUTHORIZED", { entityIds: [COUNTERPART_ID] }),
    eventTime: { from: "1164.6.3", to: "1164.6.3", precision: "day", status: "reported" } };
  const unsupportedCandidate = { ...candidate(undated, "REPAIR_MUST_KEEP_THIS_PROSE_AND_SOURCE", { entityIds: [COUNTERPART_ID] }),
    eventTime: { from: snapshot.date, to: snapshot.date, precision: "day", status: "reported" } };
  const futureCandidate = { ...candidate(future, "FUTURE_INTENTION_MUST_REMAIN_PLANNED", {
    entityIds: [COUNTERPART_ID], status: "planned"
  }), memoryType: "LONG_TERM_GOAL" };
  const correctedUndated = { ...unsupportedCandidate,
    eventTime: { from: null, to: null, precision: "unknown", status: "reported" } };
  const invalidFulfillment = { entryId: original.entryIds[0], expectedRevision: 1, status: "fulfilled",
    fragmentIds: [undated.fragmentId], commitmentQuote: "归还玉印", evidenceQuote: "我已经归还玉印。" };

  const pipeline = makeRequest((call, index) => {
    if (index === 0) {
      assert.equal(JSON.parse(call.prompt[1].content).repair, undefined,
        "eventTimeHint belongs only to dynamic repair feedback, not the static extraction request");
      return completed([exactCandidate, unsupportedCandidate, futureCandidate], [invalidFulfillment]);
    }
    const payload = JSON.parse(call.prompt[1].content);
    assert(payload.repair.validationCodes.includes("memory4_unsupported_event_date"),
      "the inferred conversation date must be surfaced as a validation failure");
    assert(payload.repair.eventTimeHint.includes("conversationDate and acquiredDate are not event-date evidence"));
    assert(payload.repair.eventTimeHint.includes("Unless the cited source supports the exact event dates"));
    assert(payload.repair.eventTimeHint.includes("Never change the text or turn a future intention into an observed/completed fact"));
    assert(payload.repair.validationCodes.some(code => code.startsWith("memory4_commitment_")),
      "date feedback must coexist with the strict invalid-commitment validation result");
    assert(payload.repair.alreadyAccepted.some(entry => entry.fragmentIds.includes(dated.fragmentId)));
    assert(payload.repair.alreadyAccepted.some(entry => entry.fragmentIds.includes(future.fragmentId)),
      "the valid future plan must remain an accepted candidate while the unrelated date is repaired");
    assert.equal(payload.repair.alreadyAccepted.some(entry => entry.fragmentIds.includes(undated.fragmentId)), false,
      "the rejected undated candidate must be corrected against its original full source");
    assert(payload.fragments.some(fragment => fragment.fragmentId === undated.fragmentId && fragment.text === undated.text),
      "repair must retain the original full source fragment");
    return completed([correctedUndated]);
  });

  const result = await coordinator.finishOwner(snapshot, pipeline.request);
  assert.equal(result.status, "STORE", JSON.stringify(result));
  assert.equal(pipeline.calls.length, 2, "the date error should receive one bounded correction request");
  const entries = query(coordinator, snapshot);
  const exact = entries.find(entry => entry.text === exactCandidate.text);
  const corrected = entries.find(entry => entry.text === unsupportedCandidate.text);
  const planned = entries.find(entry => entry.text === futureCandidate.text);
  assert(exact, "the valid source-backed precise date must survive repair");
  assert.deepEqual(exact.eventTime, exactCandidate.eventTime);
  assert.deepEqual(exact.source.segmentIds, [dated.fragmentId]);
  assert(corrected, "the unsupported event may be stored without fabricated dates");
  assert.equal(corrected.text, unsupportedCandidate.text, "repair must not rewrite candidate prose");
  assert.deepEqual(corrected.eventTime, { from: null, to: null, precision: "unknown", status: "reported" });
  assert.deepEqual(corrected.entityIds, unsupportedCandidate.entityIds, "repair must preserve authorized entity IDs");
  assert.deepEqual(corrected.source.segmentIds, [undated.fragmentId], "repair must preserve canonical source provenance");
  const undatedSourceEntries = entries.filter(entry => entry.source.finalizationId === snapshot.finalizationId
    && entry.source.segmentIds.includes(undated.fragmentId));
  assert.equal(undatedSourceEntries.length, 1, "the source must not produce an additional conversation-date event");
  assert.equal(undatedSourceEntries[0].eventTime.from, null);
  assert(planned, "the valid future intention must remain present");
  assert.equal(planned.eventTime.status, "planned");
  assert.equal(planned.text, futureCandidate.text);
  assert.deepEqual(planned.source.segmentIds, [future.fragmentId]);
  assert.equal(coordinator.store.readEntry(snapshot, original.entryIds[0]).state.status, "active",
    "event-time repair must not bypass missing original commitment conditions");
}

async function testEmptyRepairDoesNotTurnRejectedCandidatesIntoNoContent() {
  const invalidOnlyFixture = makeFixture("invalid-only-empty-repair");
  const invalidOnlyFragment = makeFragment("invalid-only-fragment", "INVALID_ONLY_SOURCE", 1);
  const invalidOnlySnapshot = makeSnapshot("invalid-only-empty-repair", [invalidOnlyFragment]);
  const invalidOnly = candidate(invalidOnlyFragment, "INVALID_ONLY_CANDIDATE", { status: "completed" });
  const invalidOnlyPipeline = makeRequest((_call, index) => completed(index === 0 ? [invalidOnly] : []));
  const invalidOnlyResult = await invalidOnlyFixture.coordinator.finishOwner(invalidOnlySnapshot, invalidOnlyPipeline.request);
  assert.equal(invalidOnlyPipeline.calls.length, 2, "an invalid candidate should get one bounded repair request");
  assert.equal(invalidOnlyResult.status, "EXTRACTION_FAILED",
    "an empty repair cannot establish that an all-invalid initial response contained no durable facts");
  assert.equal(query(invalidOnlyFixture.coordinator, invalidOnlySnapshot).length, 0,
    "all-invalid output must not be committed as NO_DURABLE_CONTENT");

  const mixedFixture = makeFixture("mixed-empty-repair");
  const mixedFragment = makeFragment("mixed-empty-repair-fragment", "MIXED_EMPTY_REPAIR_SOURCE", 2);
  const mixedSnapshot = makeSnapshot("mixed-empty-repair", [mixedFragment]);
  const valid = candidate(mixedFragment, "VALID_MIXED_CANDIDATE_SURVIVES_EMPTY_REPAIR");
  const invalid = candidate(mixedFragment, "INVALID_MIXED_CANDIDATE", { status: "completed" });
  const mixedPipeline = makeRequest((_call, index) => completed(index === 0 ? [invalid, valid] : []));
  const mixedResult = await mixedFixture.coordinator.finishOwner(mixedSnapshot, mixedPipeline.request);
  assert.equal(mixedResult.status, "STORE", JSON.stringify(mixedResult));
  assert.equal(mixedResult.rejectedCandidateCount, 1,
    "a valid candidate should survive while an unrepaired rejected candidate remains visible in commit metadata");
  assert.deepEqual(query(mixedFixture.coordinator, mixedSnapshot).map(entry => entry.text), [valid.text]);
}

async function testUnknownEntityAndForeignSourceRemainClosed() {
  const unknownFixture = makeFixture("unknown-entity-fails-closed");
  const fragment = makeFragment("entity-fragment", "ENTITY_SOURCE");
  const snapshot = makeSnapshot("unknown-entity-fails-closed", [fragment]);
  const unknown = candidate(fragment, "UNAUTHORIZED_ENTITY_MUST_NOT_PERSIST", { entityIds: [777] });
  const unknownRequest = makeRequest(() => completed([unknown]));
  const unknownResult = await unknownFixture.coordinator.finishOwner(snapshot, unknownRequest.request);
  assert.notEqual(unknownResult.status, "STORE");
  assert.equal(query(unknownFixture.coordinator, snapshot).length, 0);

  const sourceFixture = makeFixture("foreign-source-fails-closed");
  const sourceFragment = makeFragment("source-fragment", "AUTHORIZED_SOURCE");
  const sourceSnapshot = makeSnapshot("foreign-source-fails-closed", [sourceFragment]);
  const foreign = candidate(sourceFragment, "FOREIGN_SOURCE_MUST_NOT_PERSIST", { fragmentIds: ["other-owner-fragment"] });
  const sourceRequest = makeRequest(() => completed([foreign]));
  const sourceResult = await sourceFixture.coordinator.finishOwner(sourceSnapshot, sourceRequest.request);
  assert.notEqual(sourceResult.status, "STORE");
  assert.equal(query(sourceFixture.coordinator, sourceSnapshot).length, 0);
}

async function testPromptAndValidationRespectOwnerAndFragmentAuthorization() {
  const { coordinator } = makeFixture("prompt-scope");
  const fragment = makeFragment("owner-two-fragment", "OWNER_TWO_SOURCE");
  const otherFragment = makeFragment("other-owner-fragment", "OTHER_OWNER_SOURCE", 2);
  const snapshot = makeSnapshot("prompt-scope", [fragment, otherFragment]);
  snapshot.entityNameEvidence = [
    { ownerId: OWNER_ID, fragmentId: fragment.fragmentId, entityId: COUNTERPART_ID, name: "AUTHORIZED_OWNER_NAME" },
    { ownerId: 9, fragmentId: fragment.fragmentId, entityId: 99, name: "OTHER_OWNER_PRIVATE_NAME" },
    { ownerId: OWNER_ID, fragmentId: otherFragment.fragmentId, entityId: 99, name: "OTHER_FRAGMENT_PRIVATE_NAME" }
  ];
  snapshot.relationshipEvidence = [
    { ownerId: OWNER_ID, fragmentId: fragment.fragmentId, entityId: COUNTERPART_ID, relation: "authorized relation" },
    { ownerId: 9, fragmentId: fragment.fragmentId, entityId: 99, relation: "OTHER_OWNER_PRIVATE_RELATION" },
    { ownerId: OWNER_ID, fragmentId: otherFragment.fragmentId, entityId: 99, relation: "OTHER_FRAGMENT_PRIVATE_RELATION" }
  ];

  const serialized = JSON.stringify(coordinator.buildPrompt(snapshot, [fragment]));
  assert(serialized.includes("AUTHORIZED_OWNER_NAME"));
  for (const privateValue of ["OTHER_OWNER_PRIVATE_NAME", "OTHER_FRAGMENT_PRIVATE_NAME",
    "OTHER_OWNER_PRIVATE_RELATION", "OTHER_FRAGMENT_PRIVATE_RELATION", "OTHER_OWNER_SOURCE"]) {
    assert.equal(serialized.includes(privateValue), false, `prompt leaked ${privateValue}`);
  }

  const presenceOnlyFragment = { ...fragment, fragmentId: "presence-only-fragment", presentIds: [OWNER_ID, COUNTERPART_ID, 77] };
  const presenceOnlySnapshot = makeSnapshot("presence-does-not-authorize-entity", [presenceOnlyFragment]);
  const rejected = coordinator.parseResult(completed([candidate(presenceOnlyFragment, "PRESENCE_IS_NOT_ENTITY_AUTHORITY", {
    entityIds: [77], participantIds: [OWNER_ID, COUNTERPART_ID, 77]
  })]), [presenceOnlyFragment], presenceOnlySnapshot);
  assert.equal(rejected.entries.length, 0);
  assert.equal(rejected.rejectedUnknownEntityCount, 1);
}

async function testPromptChunksStayInsideConservativeTokenBudget() {
  const { coordinator } = makeFixture("token-budget");
  const fragments = Array.from({ length: 14 }, (_, index) => makeFragment(`budget-fragment-${index}`,
    `TOKEN_BUDGET_SOURCE_${index}_`, index + 1, { textSize: 4500 }));
  const snapshot = makeSnapshot("token-budget", fragments);
  const pipeline = makeRequest(() => completed());

  const result = await coordinator.finishOwner(snapshot, pipeline.request);
  assert.equal(result.status, "NO_DURABLE_CONTENT", JSON.stringify(result));
  for (const call of pipeline.calls) {
    assert(call.tokens <= INPUT_TOKEN_BUDGET, `request exceeded ${INPUT_TOKEN_BUDGET} estimated input tokens: ${call.tokens}`);
  }
  assert(pipeline.calls.length > 1, "large evidence must be divided into more than one request");
  for (const fragment of fragments) {
    const submittedCount = pipeline.calls.reduce((count, call) => count + Number(call.text.includes(fragment.text)), 0);
    assert.equal(submittedCount, 1, `${fragment.fragmentId} must be sent exactly once`);
  }

  const countFixture = makeFixture("fragment-count-budget");
  const countFragments = Array.from({ length: 129 }, (_, index) => makeFragment(`count-fragment-${index}`,
    `COUNT_BUDGET_SOURCE_${index}_`, index + 1));
  const countSnapshot = makeSnapshot("fragment-count-budget", countFragments);
  const countPipeline = makeRequest(() => completed());
  const countResult = await countFixture.coordinator.finishOwner(countSnapshot, countPipeline.request);
  assert.equal(countResult.status, "NO_DURABLE_CONTENT", JSON.stringify(countResult));
  assert(countPipeline.calls.length > 1, "the per-request fragment count cap must split 129 small fragments");
  for (const call of countPipeline.calls) {
    const requestFragments = JSON.parse(call.prompt[1].content).fragments;
    assert(requestFragments.length <= 128, `request exceeded the 128-fragment cap: ${requestFragments.length}`);
  }
  for (const fragment of countFragments) {
    const submittedCount = countPipeline.calls.reduce((count, call) => count + Number(call.text.includes(fragment.text)), 0);
    assert.equal(submittedCount, 1, `${fragment.fragmentId} must be sent exactly once`);
  }
}

async function testRequestLocalFragmentRefsStayWithinSentScope() {
  const forgedFixture = makeFixture("out-of-range-fragment-ref");
  const forgedFragment = makeFragment("out-of-range-ref-source", "OUT_OF_RANGE_REF_SOURCE");
  const forgedSnapshot = makeSnapshot("out-of-range-fragment-ref", [forgedFragment]);
  const forged = candidate(forgedFragment, "OUT_OF_RANGE_ALIAS_MUST_NOT_PERSIST", { fragmentIds: ["f99"] });
  const forgedPipeline = makeRequest((_call, index) => completed(index === 0 ? [forged] : []));
  const forgedResult = await forgedFixture.coordinator.finishOwner(forgedSnapshot, forgedPipeline.request);
  assert.equal(forgedResult.status, "EXTRACTION_FAILED");
  assert.equal(forgedPipeline.calls.length, 2);
  assert(JSON.parse(forgedPipeline.calls[1].prompt[1].content).repair.validationCodes.includes("memory4_response_source_mismatch"));
  assert.equal(query(forgedFixture.coordinator, forgedSnapshot).length, 0,
    "an out-of-range request-local reference cannot be rebound or stored");

  const resolvedFixture = makeFixture("fragment-ref-resolves-source");
  const resolvedFragment = makeFragment("resolved-ref-canonical-source", "RESOLVED_REF_SOURCE");
  const resolvedSnapshot = makeSnapshot("fragment-ref-resolves-source", [resolvedFragment]);
  const shortRefCandidate = candidate(resolvedFragment, "SHORT_REF_RESOLVES_TO_CANONICAL_SOURCE", { fragmentIds: ["f0"] });
  assert.throws(() => resolvedFixture.coordinator.parseResult(completed([shortRefCandidate]), [resolvedFragment], resolvedSnapshot),
    /memory4_response_source_mismatch/, "the public/default strict parser must not accept request-local aliases");
  const resolvedPipeline = makeRequest(call => {
    const payload = JSON.parse(call.prompt[1].content);
    assert.equal(payload.fragments[0].fragmentRef, "f0");
    return completed([shortRefCandidate]);
  });
  const resolvedResult = await resolvedFixture.coordinator.finishOwner(resolvedSnapshot, resolvedPipeline.request);
  assert.equal(resolvedResult.status, "STORE", JSON.stringify(resolvedResult));
  const resolvedEntry = query(resolvedFixture.coordinator, resolvedSnapshot).find(row => row.text === shortRefCandidate.text);
  assert.deepEqual(resolvedEntry.source.segmentIds, [resolvedFragment.fragmentId],
    "an internal short ref must resolve to the original canonical source ID before persistence");
  assert.equal(resolvedEntry.source.segmentIds.includes("f0"), false);

  const forgetFixture = makeFixture("fragment-ref-forget-no-rebind");
  const forgotten = makeFragment("fragment-ref-forgotten-A", "FRAGMENT_REF_FORGOTTEN_A", 1);
  const retained = makeFragment("fragment-ref-retained-B", "FRAGMENT_REF_RETAINED_B", 2);
  const forgetSnapshot = makeSnapshot("fragment-ref-forget-no-rebind", [forgotten, retained]);
  const lineage = sourceLineage(forgetSnapshot, forgotten);
  forgetSnapshot.projectionLineages = [lineage];
  const forgetPipeline = makeRequest((call, index) => {
    const payload = JSON.parse(call.prompt[1].content);
    if (index === 0) {
      assert.deepEqual(payload.fragments.map(fragment => [fragment.fragmentRef, fragment.fragmentId]),
        [["f0", forgotten.fragmentId], ["f1", retained.fragmentId]]);
      forgetFixture.coordinator.store.persistForgottenProjection({ campaignToken: forgetSnapshot.campaignToken, ownerId: OWNER_ID }, lineage,
        "independent-qa-forget-old-short-ref");
      return completed([candidate(retained, "STALE_F0_MUST_NOT_REBIND_AFTER_FORGET", { fragmentIds: ["f0"] })]);
    }
    assert.deepEqual(payload.fragments.map(fragment => [fragment.fragmentRef, fragment.fragmentId]), [["f0", retained.fragmentId]],
      "the surviving-only retry may assign f0 to B only after the old response has been discarded");
    return completed([candidate(retained, "CLEAN_B_AFTER_SHORT_REF_RETRY", { fragmentIds: ["f0"] })]);
  });
  const forgetResult = await forgetFixture.coordinator.finishOwner(forgetSnapshot, forgetPipeline.request);
  assert.equal(forgetResult.status, "STORE", JSON.stringify(forgetResult));
  assert.equal(forgetPipeline.calls.length, 2);
  const forgetEntries = query(forgetFixture.coordinator, forgetSnapshot);
  assert(forgetEntries.some(entry => entry.text === "CLEAN_B_AFTER_SHORT_REF_RETRY"));
  assert.equal(forgetEntries.some(entry => entry.text === "STALE_F0_MUST_NOT_REBIND_AFTER_FORGET"), false);
  assert.deepEqual(forgetEntries.find(entry => entry.text === "CLEAN_B_AFTER_SHORT_REF_RETRY").source.segmentIds, [retained.fragmentId]);
}

async function testPartialValidRepairFitsBudgetWithoutRepeatingText() {
  const { coordinator } = makeFixture("partial-valid-oversized-repair-feedback");
  let fragment, snapshot, baseInput;
  for (let textSize = 500; textSize <= 24000; textSize += 250) {
    fragment = makeFragment("repair-budget-source", "REPAIR_BUDGET_SOURCE_", 1, { textSize });
    snapshot = makeSnapshot("partial-valid-oversized-repair-feedback", [fragment]);
    baseInput = coordinator.estimateDurableInput(coordinator.buildPrompt(snapshot, [fragment]));
    if (baseInput >= 6800) break;
  }
  assert(baseInput >= 6800 && baseInput <= INPUT_TOKEN_BUDGET - 1024,
    `the ordinary source request should leave the 1024-token repair reserve, got ${baseInput}`);

  const longText = `ACCEPTED_LONG_FACT_${"archival-detail-".repeat(350)}`;
  const accepted = candidate(fragment, longText);
  const invalid = candidate(fragment, "INVALID_CANDIDATE_NEEDS_REPAIR", { status: "completed" });
  const repaired = candidate(fragment, "CORRECTED_FACT_FROM_FULL_SOURCE");
  const pipeline = makeRequest((call, index) => {
    if (index === 0) return completed([accepted, invalid]);
    const payload = JSON.parse(call.prompt[1].content);
    assert.equal(payload.fragments.length, 1);
    assert.equal(payload.fragments[0].text, fragment.text, "repair must receive the complete, unchanged source fragment");
    assert.deepEqual(payload.repair.alreadyAccepted, [{ memoryType: accepted.memoryType, fragmentIds: accepted.fragmentIds }]);
    assert.equal(JSON.stringify(payload.repair).includes(longText), false, "repair feedback must not repeat long accepted text");
    assert(coordinator.estimateDurableInput(call.prompt) <= INPUT_TOKEN_BUDGET,
      `repair request exceeded ${INPUT_TOKEN_BUDGET} estimated input tokens`);

    const legacyPayload = structuredClone(payload);
    legacyPayload.repair.alreadyAccepted = [{ memoryType: accepted.memoryType, text: accepted.text,
      fragmentIds: accepted.fragmentIds }];
    const legacyMessages = [...call.prompt];
    legacyMessages[1] = { ...legacyMessages[1], content: JSON.stringify(legacyPayload) };
    const legacyEstimate = coordinator.estimateDurableInput(legacyMessages);
    assert(legacyEstimate > INPUT_TOKEN_BUDGET,
      `the long accepted text would have pushed the prior repeated-text feedback shape over budget (base=${baseInput}, legacy=${legacyEstimate})`);
    return completed([repaired]);
  });

  const result = await coordinator.finishOwner(snapshot, pipeline.request);
  assert.equal(result.status, "STORE", JSON.stringify(result));
  assert.equal(pipeline.calls.length, 2, "partial validation should make exactly one repair request");
  assert(pipeline.calls.every(call => coordinator.estimateDurableInput(call.prompt) <= INPUT_TOKEN_BUDGET));
  assert.deepEqual(query(coordinator, snapshot).map(entry => entry.text), [longText, repaired.text]);
}

async function testSingleLargeFragmentStaysWholeWithinHardLimit() {
  const { coordinator } = makeFixture("single-large-fragment");
  let textSize = 6000;
  let fragment, snapshot, estimatedInput;
  for (let attempt = 0; attempt < 12; attempt++) {
    fragment = makeFragment("single-large-fragment-source", "SINGLE_LARGE_SOURCE_", 1, { textSize });
    snapshot = makeSnapshot("single-large-fragment", [fragment]);
    estimatedInput = coordinator.estimateDurableInput(coordinator.buildPrompt(snapshot, [fragment]));
    if (estimatedInput > INPUT_TOKEN_BUDGET) break;
    textSize = Math.ceil(textSize * 1.5);
  }
  assert(estimatedInput > INPUT_TOKEN_BUDGET, "fixture must exceed the ordinary 8192-token chunk target");
  assert(estimatedInput <= 16384, "fixture must remain within the documented single-fragment hard limit");
  const pipeline = makeRequest(call => {
    const payload = JSON.parse(call.prompt[1].content);
    assert.equal(payload.fragments.length, 1);
    assert.equal(payload.fragments[0].text, fragment.text, "a large source fragment must be sent whole");
    return completed();
  });
  const result = await coordinator.finishOwner(snapshot, pipeline.request);
  assert.equal(result.status, "NO_DURABLE_CONTENT", JSON.stringify(result));
  assert.equal(pipeline.calls.length, 1);

  const tooLarge = makeFragment("over-hard-limit-source", "OVER_HARD_LIMIT_SOURCE_", 2, { textSize: 100000 });
  const tooLargeSnapshot = makeSnapshot("over-hard-limit-single-fragment", [tooLarge]);
  const tooLargeEstimate = coordinator.estimateDurableInput(coordinator.buildPrompt(tooLargeSnapshot, [tooLarge]));
  assert(tooLargeEstimate > 16384, "oversized fixture must exceed the single-fragment hard limit");
  const rejectedPipeline = makeRequest(() => completed());
  const rejected = await coordinator.finishOwner(tooLargeSnapshot, rejectedPipeline.request);
  assert.equal(rejected.status, "EXTRACTION_FAILED");
  assert.equal(rejectedPipeline.calls.length, 0, "an over-limit source must fail before provider access, without truncation");
}

async function testCheckpointDoesNotRepeatCompletedNoContentChunk() {
  const { coordinator } = makeFixture("checkpoint-no-content");
  const fragments = Array.from({ length: 129 }, (_, index) => makeFragment(`empty-checkpoint-${index}`,
    `NO_CONTENT_SOURCE_${index}_`, index + 1));
  const snapshot = makeSnapshot("checkpoint-no-content", fragments);
  let interruptionInjected = false;
  const pipeline = makeRequest((_call, index) => {
    if (index === 0) return completed();
    if (!interruptionInjected) {
      interruptionInjected = true;
      throw new Error("INJECTED_AFTER_NO_CONTENT_CHECKPOINT");
    }
    return completed();
  });

  const interrupted = await coordinator.finishOwner(snapshot, pipeline.request);
  assert.equal(interrupted.status, "EXTRACTION_FAILED");
  const completedSources = fragments.filter(fragment => pipeline.calls[0].text.includes(fragment.text));
  assert(completedSources.length > 0);
  const recovered = await coordinator.recoverPending(pipeline.request, { activeCampaignToken: snapshot.campaignToken,
    isNarrativeCommitted: () => true });
  assert.equal(recovered.length, 1);
  assert.equal(recovered[0].status, "NO_DURABLE_CONTENT", JSON.stringify(recovered[0]));
  for (const fragment of completedSources) {
    assert.equal(pipeline.calls.slice(1).some(call => call.text.includes(fragment.text)), false,
      `recovery reran completed NO_DURABLE_CONTENT source ${fragment.fragmentId}`);
  }
}

async function testCheckpointRejectsChangedSourceContext() {
  const { coordinator } = makeFixture("checkpoint-source-context");
  const fragments = Array.from({ length: 129 }, (_, index) => makeFragment(`source-context-${index}`,
    `SOURCE_CONTEXT_${index}_`, index + 1));
  const snapshot = makeSnapshot("checkpoint-source-context", fragments);
  let interrupted = false;
  const firstRun = makeRequest((_call, index) => {
    if (index === 0) return completed([candidate(fragments[0], "STALE_SOURCE_CONTEXT_CANDIDATE")]);
    if (!interrupted) {
      interrupted = true;
      throw new Error("INJECTED_SOURCE_CONTEXT_INTERRUPTION");
    }
    return completed();
  });
  const firstResult = await coordinator.finishOwner(snapshot, firstRun.request);
  assert.equal(firstResult.status, "EXTRACTION_FAILED");
  const prior = coordinator.readRecovery(coordinator.recoveryPath(snapshot));
  assert(prior, "interrupted extraction must leave recoverable state");

  const changedFragments = fragments.map((fragment, index) => index === 0
    ? { ...fragment, text: "CHANGED_SOURCE_CONTEXT_TEXT" } : fragment);
  const changedSnapshot = { ...snapshot, fragments: changedFragments,
    sourceRevision: hash([snapshot.campaignToken, snapshot.finalizationId, changedFragments]) };
  const resumed = makeRequest(call => call.text.includes("CHANGED_SOURCE_CONTEXT_TEXT")
    ? completed([candidate(changedFragments[0], "CANDIDATE_FROM_CHANGED_SOURCE")]) : completed());
  const result = await coordinator.finishOwner(changedSnapshot, resumed.request, prior);
  assert.equal(result.status, "STORE", JSON.stringify(result));
  assert(resumed.calls.some(call => call.text.includes("CHANGED_SOURCE_CONTEXT_TEXT")),
    "the provider must see changed source evidence");
  assert(query(coordinator, changedSnapshot).some(entry => entry.text === "CANDIDATE_FROM_CHANGED_SOURCE"));
  assert.equal(query(coordinator, changedSnapshot).some(entry => entry.text === "STALE_SOURCE_CONTEXT_CANDIDATE"), false,
    "a checkpoint candidate derived from changed source context must not be reused");
}

async function testCheckpointCannotCrossOwnerScope() {
  const { coordinator } = makeFixture("checkpoint-foreign-owner");
  const fragments = Array.from({ length: 129 }, (_, index) => makeFragment(`owner-two-${index}`,
    `OWNER_TWO_SOURCE_${index}_`, index + 1));
  const snapshot = makeSnapshot("checkpoint-foreign-owner", fragments);
  let interrupted = false;
  const firstRun = makeRequest((_call, index) => {
    if (index === 0) return completed([candidate(fragments[0], "OWNER_TWO_CHECKPOINT_CANDIDATE")]);
    if (!interrupted) {
      interrupted = true;
      throw new Error("INJECTED_FOREIGN_SCOPE_INTERRUPTION");
    }
    return completed();
  });
  const firstResult = await coordinator.finishOwner(snapshot, firstRun.request);
  assert.equal(firstResult.status, "EXTRACTION_FAILED");
  const prior = coordinator.readRecovery(coordinator.recoveryPath(snapshot));
  assert(prior, "Owner 2 extraction must leave recoverable state");

  const foreignFragment = makeFragment("owner-three-fragment", "OWNER_THREE_SOURCE", 1000, { ownerId: 3 });
  const foreignSnapshot = makeSnapshot("checkpoint-foreign-owner-three", [foreignFragment], {
    ownerId: 3, campaignToken: snapshot.campaignToken, finalizationId: snapshot.finalizationId
  });
  let foreignRequests = 0;
  const rejected = await coordinator.finishOwner(foreignSnapshot, async () => {
    foreignRequests++;
    return completed();
  }, prior);
  assert.equal(foreignRequests, 0, "foreign-scope checkpoint must be rejected before provider access");
  assert.equal(query(coordinator, foreignSnapshot).length, 0, "Owner 2 checkpoint data must not be committed for Owner 3");
  assert.notEqual(rejected.status, "STORE");
}

async function testCheckpointRetainsTruncatedLeftBranch() {
  const { coordinator } = makeFixture("checkpoint-truncated-left");
  const fragments = Array.from({ length: 129 }, (_, index) => makeFragment(`truncated-left-${index}`,
    `TRUNCATED_LEFT_SOURCE_${index}_`, index + 1));
  const snapshot = makeSnapshot("checkpoint-truncated-left", fragments);
  const pipeline = makeRequest((_call, index) => {
    if (index === 0) return { content: "{}", finish_reason: "length" };
    if (index === 1) return completed();
    if (index === 2) throw new Error("INJECTED_AFTER_TRUNCATED_LEFT_CHECKPOINT");
    return completed();
  });

  const interrupted = await coordinator.finishOwner(snapshot, pipeline.request);
  assert.equal(interrupted.status, "EXTRACTION_FAILED");
  assert.equal(pipeline.calls.length, 3, "fixture must truncate, checkpoint the left branch, then interrupt the right branch");
  const completedLeft = fragments.filter(fragment => pipeline.calls[1].text.includes(fragment.text));
  assert(completedLeft.length > 0, "truncation recovery must have a successful left branch");
  const recovered = await coordinator.recoverPending(pipeline.request, { activeCampaignToken: snapshot.campaignToken,
    isNarrativeCommitted: () => true });
  assert.equal(recovered.length, 1);
  assert.equal(recovered[0].status, "NO_DURABLE_CONTENT", JSON.stringify(recovered[0]));
  for (const fragment of completedLeft) {
    assert.equal(pipeline.calls.slice(3).some(call => call.text.includes(fragment.text)), false,
      `recovery reran successful truncated-left source ${fragment.fragmentId}`);
  }
}

function sourceLineage(snapshot, fragment) {
  return createProjectionLineage({ campaignToken: snapshot.campaignToken, ownerId: snapshot.ownerId,
    conversationId: snapshot.conversationId, finalizationId: snapshot.finalizationId, counterpartId: COUNTERPART_ID,
    sourceSegmentIds: [fragment.fragmentId], sourceMessageIds: [fragment.messageId] });
}

async function testCheckpointRecoveryRevalidatesForgetAndPreservesManualEdits() {
  const { coordinator } = makeFixture("checkpoint-forget-manual");
  const existingFragment = makeFragment("manual-existing-fragment", "EXISTING_MANUAL_SOURCE", 1);
  const existingSnapshot = makeSnapshot("manual-existing", [existingFragment], {
    campaignToken: "campaign-checkpoint-forget-manual", finalizationId: "manual-finalization"
  });
  const existing = coordinator.store.commitOwner(existingSnapshot, { status: "STORE",
    entries: [candidate(existingFragment, "initial generated wording")] });
  coordinator.store.updateEntry({ campaignToken: existingSnapshot.campaignToken, ownerId: OWNER_ID }, existing.entryIds[0],
    "USER_EDITED_TEXT_MUST_SURVIVE_RECOVERY", { expectedRevision: 1 });

  const fragments = Array.from({ length: 257 }, (_, index) => makeFragment(`checkpoint-fragment-${index}`,
    `CHECKPOINT_SOURCE_${index}_`, index + 10));
  const snapshot = makeSnapshot("checkpoint-forget-manual", fragments, {
    campaignToken: existingSnapshot.campaignToken, finalizationId: "checkpoint-finalization"
  });
  const forgotten = fragments[0];
  const lineage = sourceLineage(snapshot, forgotten);
  snapshot.projectionLineages = [lineage];
  const extractionLeaves = coordinator.chunkFragments(snapshot, coordinator.orderFragments(snapshot, fragments));
  assert(extractionLeaves.length >= 3, "fixture must have two completed leaves and one interrupted leaf");
  const affectedLeafSources = extractionLeaves[0];
  const untouchedLeafSources = extractionLeaves[1];
  const unaffectedCandidateSource = untouchedLeafSources[0];

  let failureInjected = false;
  const pipeline = makeRequest((call, index) => {
    if (index === 0) {
      return completed([candidate(forgotten, "FACT_FROM_FORGOTTEN_CHECKPOINT")]);
    }
    if (index === 1) {
      return completed([candidate(unaffectedCandidateSource, "FACT_FROM_UNTOUCHED_SUCCESSFUL_LEAF")]);
    }
    if (!failureInjected) {
      failureInjected = true;
      throw new Error("INJECTED_RECOVERY_INTERRUPTION");
    }
    const retained = fragments.find(fragment => fragment !== forgotten && call.text.includes(fragment.text));
    return completed(retained ? [candidate(retained, "FACT_FROM_RETAINED_CHECKPOINT")] : []);
  });

  const interrupted = await coordinator.finishOwner(snapshot, pipeline.request);
  assert.equal(interrupted.status, "EXTRACTION_FAILED");
  assert.equal(pipeline.calls.length, 3, "fixture must complete two leaves and interrupt the third");
  assert(affectedLeafSources.length > 1 && affectedLeafSources.includes(forgotten),
    "the forgotten source must share a completed leaf with surviving sources");
  assert(untouchedLeafSources.length > 0, "fixture must have a separate successful leaf unaffected by Forget");
  assert.equal(pipeline.calls[0].text.includes(affectedLeafSources.at(-1).text), true,
    "the first request must use the actual token-budget leaf boundary");
  assert.equal(pipeline.calls[1].text.includes(unaffectedCandidateSource.text), true,
    "the second request must persist a candidate from an untouched successful leaf");
  coordinator.store.persistForgottenProjection({ campaignToken: snapshot.campaignToken, ownerId: OWNER_ID }, lineage,
    "independent-qa-forget-checkpoint-source");

  const recovered = await coordinator.recoverPending(pipeline.request, { activeCampaignToken: snapshot.campaignToken,
    isNarrativeCommitted: () => true });
  assert.equal(recovered.length, 1);
  assert.equal(recovered[0].status, "STORE", JSON.stringify(recovered[0]));
  const problems = [];
  const verify = (condition, message) => { if (!condition) problems.push(message); };
  const recoveryCalls = pipeline.calls.slice(3);
  verify(recoveryCalls.length > 0, "recovery should reevaluate the surviving sources from the forgotten leaf");
  for (const fragment of affectedLeafSources.filter(fragment => fragment !== forgotten)) {
    verify(recoveryCalls.filter(call => call.text.includes(fragment.text)).length === 1,
      `surviving source in a Forget-affected leaf must be reevaluated once: ${fragment.fragmentId}`);
  }
  for (const fragment of untouchedLeafSources) {
    verify(!recoveryCalls.some(call => call.text.includes(fragment.text)),
      `recovery must retain an untouched successful leaf without resending ${fragment.fragmentId}`);
  }
  for (const call of recoveryCalls) {
    verify(!call.text.includes(forgotten.text), "recovery must recheck Forget before sending a checkpointed source");
  }

  const entries = query(coordinator, snapshot);
  verify(!entries.some(entry => entry.text === "FACT_FROM_FORGOTTEN_CHECKPOINT"),
    "a checkpoint tied to a forgotten source must not be committed");
  verify(entries.some(entry => entry.text === "FACT_FROM_RETAINED_CHECKPOINT"),
    "recovery should commit a surviving source candidate");
  verify(entries.some(entry => entry.text === "FACT_FROM_UNTOUCHED_SUCCESSFUL_LEAF"),
    "recovery should preserve a previously successful leaf with no forgotten source");
  const manual = entries.find(entry => entry.entryId === existing.entryIds[0]);
  verify(!!manual, "recovery must retain the unrelated edited entry");
  verify(manual?.text === "USER_EDITED_TEXT_MUST_SURVIVE_RECOVERY", "recovery must preserve manual text");
  verify(manual?.edit.mode === "manual_override", "recovery must preserve the manual edit marker");
  assert.deepEqual(problems, []);
}

async function testForgetDuringOutstandingResponseDiscardsWholeLeaf() {
  const { coordinator } = makeFixture("forget-during-outstanding-response");
  const forgotten = makeFragment("outstanding-forgotten-source", "OUTSTANDING_FORGET_A", 1);
  const retained = makeFragment("outstanding-retained-source", "OUTSTANDING_RETAINED_B", 2);
  const snapshot = makeSnapshot("forget-during-outstanding-response", [forgotten, retained]);
  const lineage = sourceLineage(snapshot, forgotten);
  snapshot.projectionLineages = [lineage];
  const pipeline = makeRequest((call, index) => {
    if (index === 0) {
      assert(call.text.includes(forgotten.text) && call.text.includes(retained.text),
        "the first request must have both same-leaf sources in flight");
      coordinator.store.persistForgottenProjection({ campaignToken: snapshot.campaignToken, ownerId: OWNER_ID }, lineage,
        "independent-qa-forget-outstanding-source");
      return completed([candidate(retained, "CONTAMINATED_B_CANDIDATE_MUST_NOT_COMMIT")]);
    }
    assert.equal(call.text.includes(forgotten.text), false, "the bounded retry must exclude the forgotten source");
    assert(call.text.includes(retained.text), "the bounded retry must re-evaluate the surviving source");
    return completed([candidate(retained, "CLEAN_B_CANDIDATE_AFTER_FORGET")]);
  });

  const result = await coordinator.finishOwner(snapshot, pipeline.request);
  assert.equal(result.status, "STORE", JSON.stringify(result));
  assert.equal(pipeline.calls.length, 2, "a response from a leaf changed by Forget must get one bounded clean retry");
  const entries = query(coordinator, snapshot);
  assert(entries.some(entry => entry.text === "CLEAN_B_CANDIDATE_AFTER_FORGET"));
  assert.equal(entries.some(entry => entry.text === "CONTAMINATED_B_CANDIDATE_MUST_NOT_COMMIT"), false,
    "a citation to B cannot validate output produced while forgotten A was in the same request");
}

async function testInvalidFailureDoesNotAutoRetryUntilForgetChangesSource() {
  const { coordinator } = makeFixture("invalid-failure-forget-recovery");
  const forgotten = makeFragment("invalid-forgotten-source", "INVALID_FORGOTTEN_SOURCE", 1);
  const retained = makeFragment("invalid-retained-source", "INVALID_RETAINED_SOURCE", 2);
  const snapshot = makeSnapshot("invalid-failure-forget-recovery", [forgotten, retained]);
  const lineage = sourceLineage(snapshot, forgotten);
  snapshot.projectionLineages = [lineage];
  const invalid = candidate(forgotten, "INVALID_EVENT_CANDIDATE", { status: "completed" });
  const failingPipeline = makeRequest(() => completed([invalid]));
  const failed = await coordinator.finishOwner(snapshot, failingPipeline.request);
  assert.equal(failed.status, "EXTRACTION_FAILED");
  assert.equal(failingPipeline.calls.length, 2, "initial invalid output should get one correction request");

  const suppressed = await coordinator.recoverPending(failingPipeline.request, { activeCampaignToken: snapshot.campaignToken,
    isNarrativeCommitted: () => true });
  assert.equal(suppressed.length, 1);
  assert.equal(suppressed[0].status, "FAILED_MANUAL", "unchanged all-invalid output must not be retried automatically");
  assert.equal(failingPipeline.calls.length, 2, "failure suppression must avoid an extra provider charge");

  coordinator.store.persistForgottenProjection({ campaignToken: snapshot.campaignToken, ownerId: OWNER_ID }, lineage,
    "independent-qa-change-failed-source-scope");
  const afterForget = makeRequest(call => {
    assert.equal(call.text.includes(forgotten.text), false, "forgotten source must not be sent during resumed extraction");
    assert(call.text.includes(retained.text), "the surviving source must be re-evaluated after Forget changes the scope");
    return completed([candidate(retained, "VALID_AFTER_FORGET_CHANGED_FAILURE_SCOPE")]);
  });
  const recovered = await coordinator.recoverPending(afterForget.request, { activeCampaignToken: snapshot.campaignToken,
    isNarrativeCommitted: () => true });
  assert.equal(recovered.length, 1);
  assert.equal(recovered[0].status, "STORE", JSON.stringify(recovered[0]));
  assert.equal(afterForget.calls.length, 1, "a changed Forget scope should permit one fresh automatic attempt");
  assert(query(coordinator, snapshot).some(entry => entry.text === "VALID_AFTER_FORGET_CHANGED_FAILURE_SCOPE"));
}

async function testCommittedSnapshotRecoveryDoesNotRequestAgain() {
  const { coordinator } = makeFixture("committed-recovery");
  const fragment = makeFragment("committed-fragment", "COMMITTED_SOURCE");
  const snapshot = makeSnapshot("committed-recovery", [fragment]);
  coordinator.derived.schedule = async () => ({ status: "FAILED", reason: "injected derived failure" });
  const initial = makeRequest(() => completed([candidate(fragment, "COMMITTED_FACT")]));
  const result = await coordinator.finishOwner(snapshot, initial.request);
  assert.equal(result.status, "STORE");
  assert.equal(initial.calls.length, 1);

  let recoveryRequests = 0;
  const recovered = await coordinator.recoverPending(async () => {
    recoveryRequests++;
    return completed();
  }, { activeCampaignToken: snapshot.campaignToken, isNarrativeCommitted: () => true });
  assert.equal(recoveryRequests, 0, "recovery must use the verified commit and avoid a duplicate provider extraction");
  assert.equal(recovered.length, 1);
  assert.equal(query(coordinator, snapshot).filter(entry => entry.text === "COMMITTED_FACT").length, 1);
}

async function testCappedCommitProofAndForgedCoverageFailClosed() {
  const { coordinator, baseStore } = makeFixture("capped-commit-proof");
  const fragments = Array.from({ length: 129 }, (_, index) => makeFragment(`capped-proof-${index}`,
    `CAPPED_PROOF_SOURCE_${index}_`, index + 1));
  const snapshot = makeSnapshot("capped-commit-proof", fragments);
  const pipeline = makeRequest(call => {
    const sentFragments = JSON.parse(call.prompt[1].content).fragments;
    assert(sentFragments.length >= 8, "the first request must have room to return the capped eight-entry batch");
    return completed(sentFragments.slice(0, 8).map((sent, index) => candidate(
      fragments.find(fragment => fragment.fragmentId === sent.fragmentId), `CAPPED_EIGHT_FACT_${index}`)));
  });
  const result = await coordinator.finishOwner(snapshot, pipeline.request);
  assert.equal(result.status, "STORE", JSON.stringify(result));
  assert.equal(pipeline.calls.length, 1, "the eight-entry cap should stop before the remaining source fragment is evaluated");
  const directory = coordinator.store.directory(snapshot);
  const indexPath = path.join(directory, "index.json");
  const metadataPath = path.join(directory, "metadata.json");
  const originalIndex = baseStore.readJson(indexPath, null);
  const originalMetadata = baseStore.readJson(metadataPath, null);
  const recordKey = hash(snapshot.finalizationId);
  const record = originalIndex.finalizations[recordKey];
  assert.equal(record.status, "STORE");
  assert.equal(record.extractionCoverage, "CAPPED");
  assert.equal(record.extractionPolicyVersion, "9.3.2");
  assert.equal(record.entryIds.length, 8);
  assert(Number.isSafeInteger(record.evaluatedFragmentCount) && record.evaluatedFragmentCount > 0
    && record.evaluatedFragmentCount < fragments.length);
  assert.equal(coordinator.inspectCommittedSnapshot(snapshot).state, "COMMITTED",
    "a canonical V9.3.2 capped STORE record with eight committed entries is a valid committed proof");

  const persistForgedRecord = forgedRecord => {
    const forgedIndex = structuredClone(originalIndex);
    forgedIndex.finalizations[recordKey] = forgedRecord;
    baseStore.writeJson(indexPath, forgedIndex);
    baseStore.writeJson(metadataPath, { ...originalMetadata, indexHash: hash(forgedIndex) });
    const proof = coordinator.inspectCommittedSnapshot(snapshot);
    assert.equal(proof.state, "UNVERIFIED");
    assert.equal(proof.reason, "DURABLE_COMMIT_RECORD_INVALID");
  };
  try {
    persistForgedRecord({ ...record, entryIds: record.entryIds.slice(0, 7) });
    persistForgedRecord({ ...record, evaluatedFragmentCount: -1 });
    persistForgedRecord({ ...record, extractionPolicyVersion: "unknown-policy" });
  } finally {
    baseStore.writeJson(indexPath, originalIndex);
    baseStore.writeJson(metadataPath, originalMetadata);
  }
}

async function testLegacySourceEditDuringAsyncExtractionReturnsStale() {
  const { coordinator, baseStore } = makeFixture("legacy-source-edit-during-extraction");
  const source = baseStore.saveMemory({ memoryId: "legacy-async-source-edit", content: "无日期旧记忆来源。",
    knownBy: [OWNER_ID], subjects: [COUNTERPART_ID], updatedBy: "user",
    provenance: { campaignToken: "campaign-legacy-source-edit-during-extraction", folderOwnerId: OWNER_ID,
      extractionMode: "user_edited_summary" } });
  let signalEntered, releaseResponse;
  const entered = new Promise(resolve => { signalEntered = resolve; });
  const responsePaused = new Promise(resolve => { releaseResponse = resolve; });
  coordinator.configureDerived({ isCampaignCurrent: () => true, requestExtraction: async prompt => {
    const fragment = JSON.parse(prompt[1].content).fragments[0];
    signalEntered();
    await responsePaused;
    return completed([{ memoryType: "MAJOR_EXPERIENCE", text: "STALE_LEGACY_OUTPUT_MUST_NOT_COMMIT",
      fragmentIds: [fragment.fragmentId], entityIds: [COUNTERPART_ID], participantIds: [],
      eventTime: { from: null, to: null, precision: "unknown", status: "reported" } }]);
  } });
  const running = coordinator.recompressLegacy({ campaignToken: "campaign-legacy-source-edit-during-extraction", ownerId: OWNER_ID },
    { memoryId: source.memoryId, expectedSourceHash: legacySourceHash(source) });
  await entered;
  baseStore.updateMemory(source.memoryId, { content: "来源在异步抽取期间被用户修订。" });
  releaseResponse();
  const result = await running;
  assert.equal(result.status, "STALE", JSON.stringify(result));
  assert.deepEqual(query(coordinator, { campaignToken: "campaign-legacy-source-edit-during-extraction", ownerId: OWNER_ID }), [],
    "an extraction response bound to the old Legacy source hash must not commit after the edit");
}

async function testInvalidLocalCommitmentTransitionIsRepairedWithoutLosingEntry() {
  const { coordinator } = makeFixture("invalid-local-commitment");
  const originalFragment = makeFragment("commitment-original", "COMMITMENT_ORIGINAL_SOURCE", 1);
  const originalSnapshot = makeSnapshot("commitment-original", [originalFragment], {
    campaignToken: "campaign-invalid-local-commitment"
  });
  const original = coordinator.store.commitOwner(originalSnapshot, { status: "STORE", entries: [{
    ...candidate(originalFragment, "承诺归还玉印。", { entityIds: [OWNER_ID] }), memoryType: "COMMITMENT", topics: ["玉印"]
  }] });
  assert.equal(original.entryIds.length, 1);

  const evidenceFragment = makeFragment("commitment-evidence", "我会归还玉印。", 2);
  const snapshot = makeSnapshot("invalid-local-commitment", [evidenceFragment], {
    campaignToken: originalSnapshot.campaignToken, finalizationId: "commitment-followup"
  });
  const validEntry = candidate(evidenceFragment, "VALID_FACT_SURVIVES_INVALID_TRANSITION");
  const invalidTransition = { entryId: original.entryIds[0], expectedRevision: 1, status: "fulfilled",
    fragmentIds: [evidenceFragment.fragmentId], commitmentQuote: "归还玉印", evidenceQuote: evidenceFragment.text };
  const pipeline = makeRequest((_call, index) => completed(index === 0 ? [validEntry] : [],
    index === 0 ? [invalidTransition] : []));

  const result = await coordinator.finishOwner(snapshot, pipeline.request);
  assert.equal(result.status, "STORE", JSON.stringify(result));
  assert.equal(pipeline.calls.length, 2, "invalid local commitment evidence should get one bounded repair");
  const repairPayload = JSON.parse(pipeline.calls[1].prompt[1].content).repair;
  assert(repairPayload, "the second request must carry typed repair guidance");
  assert.equal(JSON.stringify(repairPayload).includes(invalidTransition.evidenceQuote), false,
    "repair must not treat the rejected model transition as new evidence");
  assert(query(coordinator, snapshot).some(entry => entry.text === validEntry.text),
    "the valid Durable candidate must survive a rejected local commitment transition");
  assert.equal(coordinator.store.readEntry(snapshot, original.entryIds[0]).state.status, "active",
    "an invalid transition must not change the stored commitment state");
}

async function testReplacementIndexRemapsAfterInvalidEntryIsFiltered() {
  const { coordinator } = makeFixture("replacement-index-after-invalid-entry");
  const originalFragment = makeFragment("replacement-original", "COMMITMENT_REPLACEMENT_ORIGINAL", 1);
  const originalSnapshot = makeSnapshot("replacement-original", [originalFragment], {
    campaignToken: "campaign-replacement-index-remap"
  });
  const originalText = "约定银矿交给守军，须先收回通行证。";
  const original = coordinator.store.commitOwner(originalSnapshot, { status: "STORE", entries: [{
    ...candidate(originalFragment, originalText, { entityIds: [COUNTERPART_ID] }), memoryType: "COMMITMENT", topics: ["银矿"]
  }] });

  const evidenceFragment = makeFragment("replacement-evidence", "银矿交给守军的原约现改为承诺将银矿交给并州守军；原约全部条件包括收回通行证。", 2);
  const snapshot = makeSnapshot("replacement-index-after-invalid-entry", [evidenceFragment], {
    campaignToken: originalSnapshot.campaignToken, finalizationId: "replacement-index-followup"
  });
  const invalidFirstEntry = candidate(evidenceFragment, "INVALID_ENTRY_MUST_NOT_SHIFT_REPLACEMENT", { status: "completed" });
  const replacement = { ...candidate(evidenceFragment, "承诺将银矿交给并州守军", { entityIds: [COUNTERPART_ID] }),
    memoryType: "COMMITMENT", topics: ["银矿"] };
  const transition = { entryId: original.entryIds[0], expectedRevision: 1, status: "superseded",
    fragmentIds: [evidenceFragment.fragmentId], commitmentQuote: "银矿交给守军",
    evidenceQuote: evidenceFragment.text, replacementEntryIndex: 1 };
  const pipeline = makeRequest((_call, index) => completed(index === 0 ? [invalidFirstEntry, replacement] : [],
    index === 0 ? [transition] : []));

  const result = await coordinator.finishOwner(snapshot, pipeline.request);
  assert.equal(result.status, "STORE", JSON.stringify(result));
  assert.equal(result.rejectedCandidateCount, 1, "the filtered invalid entry remains visible as a rejected candidate");
  assert.equal(pipeline.calls.length, 2, "the invalid entry should receive one bounded repair while preserving valid siblings");
  assert.equal(coordinator.store.readEntry(originalSnapshot, original.entryIds[0]).state.status, "superseded",
    "the transition must still point to the replacement after the earlier invalid array entry is removed");
  const entries = query(coordinator, snapshot);
  assert(entries.some(entry => entry.text === replacement.text));
  assert.equal(entries.some(entry => entry.text === invalidFirstEntry.text), false);
}

async function testRelevantCommitmentsKeepValidTransitionsAndAllConditions() {
  const { coordinator } = makeFixture("relevant-commitments-positive");
  const originals = [
    { key: "fulfilled", text: "承诺归还玉印，须先抵达邺城。", topic: "玉印" },
    { key: "cancelled", text: "答应送来三百石粮食，须先通过验收。", topic: "粮食" },
    { key: "superseded", text: "约定银矿交给守军，须先收回通行证。", topic: "银矿" },
    { key: "irrelevant", text: "承诺修缮东门。", topic: "城门" }
  ];
  const originalFragment = makeFragment("all-commitments-original", originals.map(row => row.text).join("\n"), 1);
  const originalSnapshot = makeSnapshot("all-commitments-original", [originalFragment], {
    campaignToken: "campaign-relevant-commitments"
  });
  const saved = coordinator.store.commitOwner(originalSnapshot, { status: "STORE", entries: originals.map(row => ({
    ...candidate(originalFragment, row.text, { entityIds: [COUNTERPART_ID] }), memoryType: "COMMITMENT", topics: [row.topic]
  })) });
  const entryIds = Object.fromEntries(saved.entryIds.map(id => [coordinator.store.readEntry(originalSnapshot, id).text, id]));

  const fulfilledFragment = makeFragment("fulfilled-condition-evidence", "已归还玉印了，并已抵达邺城。", 2);
  const cancelledFragment = makeFragment("cancelled-condition-evidence",
    "送来三百石粮食的原约已取消，原约全部条件包括通过验收。", 3);
  const supersededFragment = makeFragment("superseded-condition-evidence",
    "银矿交给守军的原约现改为承诺将银矿交给并州守军；原约全部条件包括收回通行证。", 4);
  const fragments = [fulfilledFragment, cancelledFragment, supersededFragment];
  const snapshot = makeSnapshot("all-commitments-followup", fragments, {
    campaignToken: originalSnapshot.campaignToken, finalizationId: "all-commitments-followup"
  });
  const replacement = { ...candidate(supersededFragment, "承诺将银矿交给并州守军", { entityIds: [COUNTERPART_ID] }),
    memoryType: "COMMITMENT", topics: ["银矿"] };
  const transitions = [
    { entryId: entryIds[originals[0].text], expectedRevision: 1, status: "fulfilled",
      fragmentIds: [fulfilledFragment.fragmentId], commitmentQuote: "归还玉印",
      evidenceQuote: fulfilledFragment.text },
    { entryId: entryIds[originals[1].text], expectedRevision: 1, status: "cancelled",
      fragmentIds: [cancelledFragment.fragmentId], commitmentQuote: "送来三百石粮食",
      evidenceQuote: cancelledFragment.text },
    { entryId: entryIds[originals[2].text], expectedRevision: 1, status: "superseded",
      fragmentIds: [supersededFragment.fragmentId], commitmentQuote: "银矿交给守军",
      evidenceQuote: supersededFragment.text, replacementEntryIndex: 0 }
  ];
  const pipeline = makeRequest(call => {
    const active = JSON.parse(call.prompt[1].content).activeCommitments;
    assert.deepEqual(active.map(entry => entry.entryId).sort(), [
      entryIds[originals[0].text], entryIds[originals[1].text], entryIds[originals[2].text]
    ].sort(), "only commitments with an exact source binding should enter the prompt");
    return completed([replacement], transitions);
  });

  const result = await coordinator.finishOwner(snapshot, pipeline.request);
  assert.equal(result.status, "STORE", JSON.stringify(result));
  assert.equal(pipeline.calls.length, 1, "valid transitions with every original condition covered must not be discarded or spuriously repaired");
  assert.equal(coordinator.store.readEntry(snapshot, entryIds[originals[0].text]).state.status, "fulfilled");
  assert.equal(coordinator.store.readEntry(snapshot, entryIds[originals[1].text]).state.status, "cancelled");
  assert.equal(coordinator.store.readEntry(snapshot, entryIds[originals[2].text]).state.status, "superseded");
  assert.equal(coordinator.store.readEntry(snapshot, entryIds[originals[3].text]).state.status, "active",
    "an unrelated historical commitment must remain active and must not enter the extraction prompt");
}

async function testFulfillmentCannotSkipAnOriginalCondition() {
  const { coordinator } = makeFixture("fulfillment-condition-fail-closed");
  const originalFragment = makeFragment("condition-original", "承诺归还玉印，须先抵达邺城。", 1);
  const originalSnapshot = makeSnapshot("condition-original", [originalFragment], {
    campaignToken: "campaign-condition-fail-closed"
  });
  const saved = coordinator.store.commitOwner(originalSnapshot, { status: "STORE", entries: [{
    ...candidate(originalFragment, originalFragment.text, { entityIds: [COUNTERPART_ID] }),
    memoryType: "COMMITMENT", topics: ["玉印"]
  }] });
  const evidenceFragment = makeFragment("condition-incomplete-evidence", "已归还玉印了。", 2);
  const snapshot = makeSnapshot("condition-incomplete-followup", [evidenceFragment], {
    campaignToken: originalSnapshot.campaignToken, finalizationId: "condition-incomplete-followup"
  });
  const invalidTransition = { entryId: saved.entryIds[0], expectedRevision: 1, status: "fulfilled",
    fragmentIds: [evidenceFragment.fragmentId], commitmentQuote: "归还玉印", evidenceQuote: evidenceFragment.text };
  const pipeline = makeRequest((_call, index) => completed([], index === 0 ? [invalidTransition] : []));

  const result = await coordinator.finishOwner(snapshot, pipeline.request);
  assert.equal(result.status, "EXTRACTION_FAILED", JSON.stringify(result));
  assert.equal(pipeline.calls.length, 2, "the invalid fulfillment should receive one bounded correction attempt");
  assert.equal(coordinator.store.readEntry(snapshot, saved.entryIds[0]).state.status, "active",
    "missing fulfillment conditions cannot be inferred or committed");
}

const tests = [
  ["invalid event status isolation", testInvalidEventStatusDoesNotDiscardValidCandidate],
  ["quoted numeric IDs remain strict", testQuotedNumericIdsRemainStrict],
  ["source-derived metadata correction stays narrow and auditable", testSourceDerivedMetadataNormalizationIsNarrow],
  ["event-time repair preserves source dates and other contracts", testEventTimeRepairPreservesSourceEvidenceAndOtherContracts],
  ["empty repair preserves invalid candidate failure evidence", testEmptyRepairDoesNotTurnRejectedCandidatesIntoNoContent],
  ["unknown entity and foreign source fail closed", testUnknownEntityAndForeignSourceRemainClosed],
  ["prompt owner and fragment authorization", testPromptAndValidationRespectOwnerAndFragmentAuthorization],
  ["token budget chunking", testPromptChunksStayInsideConservativeTokenBudget],
  ["request-local fragment refs stay within sent source scope", testRequestLocalFragmentRefsStayWithinSentScope],
  ["partial-valid oversized repair feedback fits budget without repeating text", testPartialValidRepairFitsBudgetWithoutRepeatingText],
  ["single large fragment is kept whole within the hard limit", testSingleLargeFragmentStaysWholeWithinHardLimit],
  ["checkpoint no-content progress", testCheckpointDoesNotRepeatCompletedNoContentChunk],
  ["checkpoint rejects changed source context", testCheckpointRejectsChangedSourceContext],
  ["checkpoint cannot cross owner scope", testCheckpointCannotCrossOwnerScope],
  ["checkpoint retains truncated left branch", testCheckpointRetainsTruncatedLeftBranch],
  ["checkpoint recovery, Forget, and manual edits", testCheckpointRecoveryRevalidatesForgetAndPreservesManualEdits],
  ["Forget during an outstanding response discards the affected leaf", testForgetDuringOutstandingResponseDiscardsWholeLeaf],
  ["failed extraction waits for source change before auto retry", testInvalidFailureDoesNotAutoRetryUntilForgetChangesSource],
  ["committed recovery does not rerun extraction", testCommittedSnapshotRecoveryDoesNotRequestAgain],
  ["canonical capped commit proof and forged coverage rejection", testCappedCommitProofAndForgedCoverageFailClosed],
  ["Legacy source edit during async extraction returns STALE", testLegacySourceEditDuringAsyncExtractionReturnsStale],
  ["invalid local commitment transition repair", testInvalidLocalCommitmentTransitionIsRepairedWithoutLosingEntry],
  ["replacement index remapping after invalid candidate filtering", testReplacementIndexRemapsAfterInvalidEntryIsFiltered],
  ["relevant commitments and valid transition outcomes", testRelevantCommitmentsKeepValidTransitionsAndAllConditions],
  ["fulfillment cannot skip an original condition", testFulfillmentCannotSkipAnOriginalCondition]
];

async function run() {
  const failures = [];
  for (const [name, test] of tests) {
    try {
      await test();
      console.log(`PASS ${name}`);
    } catch (error) {
      failures.push({ name, error });
      console.error(`FAIL ${name}: ${error?.stack || error}`);
    }
  }
  try { fs.rmSync(temporaryRoot, { recursive: true, force: true }); }
  catch { /* A failed Windows temp cleanup must not hide fixture assertions. */ }
  if (failures.length) {
    console.error(`V9.3.2 independent QA: ${failures.length}/${tests.length} failed`);
    process.exitCode = 1;
  } else {
    console.log(`V9.3.2 independent QA: ${tests.length}/${tests.length} passed`);
  }
}

run().catch(error => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
