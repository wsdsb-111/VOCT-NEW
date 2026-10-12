"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
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

const { LLMManager, TokenCounter } = require("../src/app/main/provider-service");
const { createPromptBuilder } = require("../src/app/main/prompts/prompt-builder");
const { MemoryStore } = require("../src/app/main/memory-system/memory-store");
const { Memory4Coordinator } = require("../src/app/main/memory-system/memory4-coordinator");
const { hash } = require("../src/app/main/memory-system/memory4-contract");
const { createProjectionLineage } = require("../src/app/main/memory-system/memory4-forget");
const { DurableRequestTrace } = require("../src/app/main/analytics/durable-request-trace");

const temporaryRoot = fs.mkdtempSync(path.join(__dirname, ".votc-v922-presend-"));
const PromptBuilder = createPromptBuilder({ TemplateEngine: class {}, PromptScriptLoader: class {},
  TokenCounter, createPromptFingerprint: value => hash(value), defaultChatInstruction: "" });

function deferred() {
  let resolve, reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function makeFragment(fragmentId, text, messageId, counterpartId) {
  return { fragmentId, messageId, sourceMessageIds: [messageId], text,
    speakerId: 2, speakerIds: [2], sourceTextVerified: true, sourceRole: "assistant",
    presentIds: [2, counterpartId], knownBy: [2, counterpartId], visibility: "participants",
    sourceType: "spoken", recipientIds: [counterpartId], entityIds: [counterpartId],
    visibilityEvidence: "application_fragment" };
}

function makeFixture(label) {
  const directory = path.join(temporaryRoot, label);
  const summaryFoldersDir = path.join(directory, "summaries");
  for (const ownerId of [1, 2, 3]) fs.mkdirSync(path.join(summaryFoldersDir, `${ownerId}_fixture`), { recursive: true });
  const baseStore = new MemoryStore({ baseDir: path.join(directory, "memory"), summaryFoldersDir });
  const coordinator = new Memory4Coordinator(baseStore);
  coordinator.derived.schedule = async () => ({ status: "COMPLETE" });
  const campaignToken = `campaign-${label}`;
  const conversationId = `conversation-${label}`;
  const finalizationId = `finalization-${label}`;
  const fragmentA = makeFragment("fragment-A", "PRIVATE_SENTINEL_FORGET_A", 11, 1);
  const fragmentB = makeFragment("fragment-B", "AUTHORIZED_SENTINEL_RETAIN_B", 12, 3);
  const snapshot = { campaignToken, ownerId: 2, conversationId, finalizationId, episodeId: `episode-${label}`,
    date: "1164.8.12", totalDays: 425000, sourceRevision: hash([campaignToken, finalizationId, fragmentA, fragmentB]),
    presentMessageCount: 2, completeness: "complete", summaryIds: [], counterpartIds: [1, 3],
    fragments: [fragmentA, fragmentB], activeCommitments: [], entityNameEvidence: [], relationshipEvidence: [],
    projectionLineages: [], relationshipChangeEntityIds: [], skipKnownEvidence: true };
  const lineageA = createProjectionLineage({ campaignToken, ownerId: 2, conversationId, finalizationId,
    counterpartId: 1, segmentIds: [`summary-${label}-A`], sourceSegmentIds: [fragmentA.fragmentId], sourceMessageIds: [11] });
  const lineageB = createProjectionLineage({ campaignToken, ownerId: 2, conversationId, finalizationId,
    counterpartId: 3, segmentIds: [`summary-${label}-B`], sourceSegmentIds: [fragmentB.fragmentId], sourceMessageIds: [12] });
  snapshot.projectionLineages = [lineageA, lineageB];
  const summaryA = { campaignToken, conversationId, finalizationId, perspectiveOwnerId: 2, characterId: 1,
    projectionId: lineageA.projectionId, perspectiveSummarySegmentIds: lineageA.segmentIds,
    sourceSegmentIds: lineageA.sourceSegmentIds, sourceMessageIds: lineageA.sourceMessageIds };
  return { coordinator, snapshot, fragmentA, fragmentB, summaryA, campaignToken };
}

function makeManager({ listModels, chatCompletion, trace = null }) {
  const config = { instanceId: "v922-presend-fixture", providerType: "deepseek",
    defaultModel: "deepseek-v4-flash", defaultParameters: {} };
  const provider = { listModels, chatCompletion };
  const manager = new LLMManager({
    settingsRepository: { getSummaryProviderConfig: () => config },
    providerRegistry: { createProvider: () => provider },
    usageAnalytics: { record() {} },
    durableRequestTrace: trace,
    TokenCounter,
    PromptBuilder
  });
  return { manager, provider };
}

function durableRequest(manager, prompt, options = {}) {
  return manager.sendSummaryRequest(prompt, options.signal, { requestType: "memory4_durable",
    maxTokens: options.maxTokens, providerSnapshot: options.providerSnapshot,
    durableTrace: options.durableTrace, beforeSendGuard: options.beforeSendGuard });
}

function noDurableContent() {
  return { content: JSON.stringify({ status: "NO_DURABLE_CONTENT", entries: [], commitmentTransitions: [] }),
    finish_reason: "stop", usage: { prompt_tokens: 100, completion_tokens: 10,
      prompt_cache_hit_tokens: 0, prompt_cache_miss_tokens: 100 } };
}

async function testForgetDuringCapabilityLookupDoesNotReachProvider() {
  const fixture = makeFixture("forget-during-capability");
  const trace = new DurableRequestTrace({ enabled: true });
  fixture.coordinator.durableRequestTrace = trace;
  const lookupStarted = deferred();
  const lookupRelease = deferred();
  const transports = [];
  const { manager } = makeManager({
    trace,
    listModels: async () => {
      lookupStarted.resolve();
      return lookupRelease.promise;
    },
    chatCompletion: async (request, _config, control) => {
      control?.beforeSend?.();
      transports.push(request);
      return noDurableContent();
    }
  });
  const originalPrompts = [];
  const requestDurable = async (prompt, options) => {
    originalPrompts.push(prompt);
    return durableRequest(manager, prompt, options);
  };
  const finish = fixture.coordinator.finishOwner(fixture.snapshot, requestDurable);

  await lookupStarted.promise;
  const forgotten = fixture.coordinator.forgetSummaryProjection(fixture.summaryA,
    { ownerId: 2, counterpartId: 1 });
  assert.equal(forgotten.status, "FORGOTTEN", "the fixture must persist a real Memory4 Forget tombstone");
  lookupRelease.resolve([{ id: "deepseek-v4-flash", context_window: 65536, maxCompletionTokens: 8192 }]);
  await finish;

  assert.equal(transports.length, 1, "the still-authorized sibling source must remain sendable");
  const transmitted = JSON.stringify(transports[0].messages);
  assert.equal(transmitted.includes(fixture.fragmentA.text), false,
    "Forget during capability lookup must prevent the stale source from reaching Provider transport");
  assert.equal(transmitted.includes(fixture.fragmentB.text), true,
    "the capability-boundary retry must rebuild from the still-authorized sibling source");
  const refreshed = fixture.coordinator.store.filterForgottenSnapshot(fixture.snapshot).snapshot;
  refreshed.activeCommitments = fixture.coordinator.store.activeCommitments(refreshed);
  const refreshedChunk = refreshed.fragments;
  const expectedPrompt = fixture.coordinator.buildPrompt(refreshed, refreshedChunk, 8, 8);
  assert.deepEqual(transports[0].messages, PromptBuilder.prepareSummaryMessages(expectedPrompt),
    "the transport must receive the rebuilt B-only prompt, not stale messages with edited metadata");
  assert.equal(JSON.stringify(originalPrompts[0]).includes(fixture.fragmentA.text), true,
    "the fixture must prove the source existed in the pre-await request snapshot");
  assert.equal(originalPrompts.length, 2, "one rejected stale attempt may cause only one refreshed request");
  assert.equal(trace.exportReport().attempts.filter(row => row.providerSendStartedAt).length, 1,
    "only the authorized refreshed request may be recorded as sent");
}

async function testForgetDuringCapabilityLookupWithOnlyForgottenSourceStops() {
  const fixture = makeFixture("forget-only-source");
  fixture.snapshot.fragments = [fixture.fragmentA];
  fixture.snapshot.projectionLineages = [fixture.snapshot.projectionLineages[0]];
  fixture.snapshot.counterpartIds = [1];
  fixture.snapshot.presentMessageCount = 1;
  fixture.snapshot.sourceRevision = hash([fixture.snapshot.campaignToken, fixture.snapshot.finalizationId,
    fixture.fragmentA]);
  const lookupStarted = deferred(), lookupRelease = deferred();
  const transports = [];
  const { manager } = makeManager({
    listModels: async () => { lookupStarted.resolve(); return lookupRelease.promise; },
    chatCompletion: async (request, _config, control) => {
      control?.beforeSend?.(); transports.push(request); return noDurableContent();
    }
  });
  const finish = fixture.coordinator.finishOwner(fixture.snapshot,
    (prompt, options) => durableRequest(manager, prompt, options));
  await lookupStarted.promise;
  const forgotten = fixture.coordinator.forgetSummaryProjection(fixture.summaryA,
    { ownerId: 2, counterpartId: 1 });
  assert.equal(forgotten.status, "FORGOTTEN");
  lookupRelease.resolve([{ id: "deepseek-v4-flash", context_window: 65536, maxCompletionTokens: 8192 }]);
  const result = await finish;
  assert.equal(result.status, "FORGOTTEN", "an empty post-Forget source set must remain a terminal Forget result");
  assert.equal(transports.length, 0, "an obsolete non-empty prompt must not be sent when every source is forgotten");
}

async function testUnchangedRequestPreservesExactMessages() {
  const fixture = makeFixture("unchanged-messages");
  const transports = [];
  const { manager } = makeManager({
    listModels: async () => [{ id: "deepseek-v4-flash", context_window: 65536, maxCompletionTokens: 8192 }],
    chatCompletion: async (request, _config, control) => {
      control?.beforeSend?.(); transports.push(request); return noDurableContent();
    }
  });
  const result = await fixture.coordinator.finishOwner(fixture.snapshot,
    (prompt, options) => durableRequest(manager, prompt, options));
  assert.equal(result.status, "NO_DURABLE_CONTENT");
  assert.equal(transports.length, 1);
  const expected = PromptBuilder.prepareSummaryMessages(fixture.coordinator.buildPrompt(
    fixture.snapshot, fixture.snapshot.fragments, 8, 8));
  assert.deepEqual(transports[0].messages, expected,
    "authorization checks must not alter prompt bytes for a source set that did not change");
  const digest = messages => crypto.createHash("sha256").update(JSON.stringify(messages)).digest("hex");
  assert.equal(digest(transports[0].messages), digest(expected));
}

async function testChangedDurableSourceRevisionFailsClosed() {
  const fixture = makeFixture("changed-source-revision");
  const lookupStarted = deferred(), lookupRelease = deferred();
  const transports = [];
  const { manager } = makeManager({
    listModels: async () => { lookupStarted.resolve(); return lookupRelease.promise; },
    chatCompletion: async (request, _config, control) => {
      control?.beforeSend?.(); transports.push(request); return noDurableContent();
    }
  });
  let durableCalls = 0;
  const finish = fixture.coordinator.finishOwner(fixture.snapshot, (prompt, options) => {
    durableCalls++;
    return durableRequest(manager, prompt, options);
  });
  await lookupStarted.promise;
  const changedSnapshot = { ...fixture.snapshot, sourceRevision: hash([fixture.snapshot.sourceRevision, "new-revision"]) };
  fixture.coordinator.saveRecovery(changedSnapshot, { status: "PENDING", retryCount: 0, lastError: null });
  lookupRelease.resolve([{ id: "deepseek-v4-flash", context_window: 65536, maxCompletionTokens: 8192 }]);
  const result = await finish;
  assert.equal(result.status, "EXTRACTION_FAILED");
  assert.equal(result.error, "memory4_request_source_changed_before_send",
    "a changed persisted durable revision must surface the typed pre-send failure");
  assert.equal(durableCalls, 1, "a non-Forget revision change cannot cause an unbounded source refresh retry");
  assert.equal(transports.length, 0, "a capability-wait request with a stale durable revision must fail closed");
  const persisted = fixture.coordinator.readRecovery(fixture.coordinator.recoveryPath(fixture.snapshot));
  assert.equal(persisted.snapshot.sourceRevision, changedSnapshot.sourceRevision,
    "a stale attempt must not overwrite the newer persisted durable source revision while recording failure");
  const recovered = await fixture.coordinator.recoverPending((prompt, options) => {
    durableCalls++;
    return durableRequest(manager, prompt, options);
  }, { manual: true, activeCampaignToken: fixture.campaignToken, isNarrativeCommitted: () => true });
  assert.equal(recovered[0]?.status, "NO_DURABLE_CONTENT",
    "the preserved newer recovery snapshot must remain processable by a later authorized recovery");
  assert.equal(durableCalls, 2);
  assert.equal(transports.length, 1, "recovery from the preserved revision must send exactly one new authorized request");
  const recoveredMessages = JSON.stringify(transports[0].messages);
  assert.equal(recoveredMessages.includes(fixture.fragmentA.text), true);
  assert.equal(recoveredMessages.includes(fixture.fragmentB.text), true);
}

async function testCorruptRecoveryDuringCapabilityWaitFailsWithoutOverwriteOrSend() {
  const fixture = makeFixture("corrupt-recovery-capability-wait");
  const lookupStarted = deferred(), lookupRelease = deferred();
  const transports = [];
  const { manager } = makeManager({
    listModels: async () => { lookupStarted.resolve(); return lookupRelease.promise; },
    chatCompletion: async (request, _config, control) => {
      control?.beforeSend?.(); transports.push(request); return noDurableContent();
    }
  });
  let durableCalls = 0;
  const finish = fixture.coordinator.finishOwner(fixture.snapshot, (prompt, options) => {
    durableCalls++;
    return durableRequest(manager, prompt, options);
  });
  await lookupStarted.promise;
  const recoveryFile = fixture.coordinator.recoveryPath(fixture.snapshot);
  const corruptBytes = "{corrupted during capability wait";
  fs.writeFileSync(recoveryFile, corruptBytes, "utf8");
  lookupRelease.resolve([{ id: "deepseek-v4-flash", context_window: 65536, maxCompletionTokens: 8192 }]);
  const result = await finish;

  assert.equal(result.status, "EXTRACTION_FAILED");
  assert.equal(result.error, "memory4_request_source_changed_before_send",
    "corrupt persisted recovery state must fail closed as a typed pre-send source change");
  assert.equal(durableCalls, 1);
  assert.equal(transports.length, 0, "corrupt recovery state must be detected before any Provider transport");
  assert.equal(fs.readFileSync(recoveryFile, "utf8"), corruptBytes,
    "a stale attempt must not replace or repair corrupt recovery bytes with its local snapshot");
}

async function testCapabilityFailureStillRechecksForgetAndBoundsRetry() {
  for (const [label, failure] of [["failure", new Error("capability lookup failed")],
    ["timeout", Object.assign(new Error("capability lookup timed out"), { name: "TimeoutError" })]]) {
    const fixture = makeFixture(`capability-${label}`);
    const lookupStarted = deferred(), lookupRelease = deferred();
    const transports = [];
    const { manager } = makeManager({
      listModels: async () => { lookupStarted.resolve(); return lookupRelease.promise; },
      chatCompletion: async (request, _config, control) => {
        control?.beforeSend?.(); transports.push(request); return noDurableContent();
      }
    });
    let durableCalls = 0;
    const finish = fixture.coordinator.finishOwner(fixture.snapshot, (prompt, options) => {
      durableCalls++;
      return durableRequest(manager, prompt, options);
    });
    await lookupStarted.promise;
    const forgotten = fixture.coordinator.forgetSummaryProjection(fixture.summaryA,
      { ownerId: 2, counterpartId: 1 });
    assert.equal(forgotten.status, "FORGOTTEN");
    lookupRelease.reject(failure);
    await finish;
    assert.equal(transports.length, 1, `${label} fallback may send only the refreshed authorized request`);
    assert.equal(durableCalls, 2, `${label} may trigger at most one source-refresh retry`);
    const transmitted = JSON.stringify(transports[0].messages);
    assert.equal(transmitted.includes(fixture.fragmentA.text), false, `${label} fallback must not bypass Forget`);
    assert.equal(transmitted.includes(fixture.fragmentB.text), true);
  }
}

async function testCancellationDuringCapabilityWaitDoesNotSend() {
  const fixture = makeFixture("capability-cancelled");
  const controller = new AbortController();
  const lookupStarted = deferred(), lookupRelease = deferred();
  const transports = [];
  const { manager } = makeManager({
    listModels: async () => { lookupStarted.resolve(); return lookupRelease.promise; },
    chatCompletion: async (request, _config, control) => {
      control?.beforeSend?.(); transports.push(request); return noDurableContent();
    }
  });
  const finish = fixture.coordinator.finishOwner(fixture.snapshot,
    (prompt, options) => durableRequest(manager, prompt, { ...options, signal: controller.signal }));
  await lookupStarted.promise;
  controller.abort();
  lookupRelease.resolve([{ id: "deepseek-v4-flash", context_window: 65536, maxCompletionTokens: 8192 }]);
  const result = await finish;
  assert.equal(result.status, "EXTRACTION_FAILED", "cancellation follows the existing failed-extraction recovery path");
  assert.equal(transports.length, 0, "an aborted capability wait must not reach the Provider adapter");
}

async function testForgetAfterTransportNeverCommitsAndRecoveryFiltersAgain() {
  const fixture = makeFixture("forget-after-transport");
  const transportStarted = deferred(), firstResponse = deferred();
  const transports = [];
  let providerCalls = 0;
  const { manager } = makeManager({
    listModels: async () => [{ id: "deepseek-v4-flash", context_window: 65536, maxCompletionTokens: 8192 }],
    chatCompletion: async (request, _config, control) => {
      control?.beforeSend?.();
      transports.push(request);
      providerCalls++;
      if (providerCalls === 1) { transportStarted.resolve(); return firstResponse.promise; }
      return noDurableContent();
    }
  });
  const requestDurable = (prompt, options) => durableRequest(manager, prompt, options);
  const first = fixture.coordinator.finishOwner(fixture.snapshot, requestDurable);
  await transportStarted.promise;
  assert.equal(JSON.stringify(transports[0].messages).includes(fixture.fragmentA.text), true,
    "the fixture must establish that the first request was already sent before Forget");
  const forgotten = fixture.coordinator.forgetSummaryProjection(fixture.summaryA,
    { ownerId: 2, counterpartId: 1 });
  assert.equal(forgotten.status, "FORGOTTEN");
  firstResponse.reject(new Error("mock transport failed after send"));
  const failed = await first;
  assert.equal(failed.status, "EXTRACTION_FAILED");
  const recovered = await fixture.coordinator.recoverPending(requestDurable, {
    manual: true, activeCampaignToken: fixture.campaignToken, isNarrativeCommitted: () => true
  });
  assert.equal(transports.length, 2, "recovery may send one newly filtered request");
  assert.equal(JSON.stringify(transports[0].messages).includes(fixture.fragmentA.text), true,
    "the test must not claim already transmitted bytes were withdrawn");
  const recoveredMessages = JSON.stringify(transports[1].messages);
  assert.equal(recoveredMessages.includes(fixture.fragmentA.text), false,
    "Forget must filter the recovery request before a later send");
  assert.equal(recoveredMessages.includes(fixture.fragmentB.text), true);
  assert.equal(recovered[0]?.status, "NO_DURABLE_CONTENT");
  assert.deepEqual(fixture.coordinator.store.query(fixture.snapshot), [],
    "a failed pre-Forget source response must not persist entries after its projection is forgotten");
}

async function run() {
  try {
    await testForgetDuringCapabilityLookupDoesNotReachProvider();
    await testForgetDuringCapabilityLookupWithOnlyForgottenSourceStops();
    await testUnchangedRequestPreservesExactMessages();
    await testChangedDurableSourceRevisionFailsClosed();
    await testCorruptRecoveryDuringCapabilityWaitFailsWithoutOverwriteOrSend();
    await testCapabilityFailureStillRechecksForgetAndBoundsRetry();
    await testCancellationDuringCapabilityWaitDoesNotSend();
    await testForgetAfterTransportNeverCommitsAndRecoveryFiltersAgain();
    console.log("V9.2.2 pre-send Forget fault injection F-01–F-06: PASS");
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
