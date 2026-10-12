"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { MemoryEngine } = require("../resources/app/out/main/memory-system/memory-engine");
const { seedDerivedHistory } = require("./fixtures/v923-derived-history");

const root = fs.mkdtempSync(path.join(__dirname, ".v8.15.1-memory-recovery-"));
let checks = 0;

function check(name, condition) {
  assert.equal(condition, true, name);
  checks++;
  console.log(`PASS ${name}`);
}

function ensureSummaryFolders(dir) {
  for (const [id, name] of [[1, "甲"], [2, "乙"]]) fs.mkdirSync(path.join(dir, `${id}_${name}`), { recursive: true });
}

function fixtureContext(campaignToken, suffix = "main") {
  const first = "甲在1164年向乙送来粮食。";
  const second = "乙在1164年向甲确认粮食已收。";
  return {
    campaignToken,
    conversationId: `recovery-${suffix}`,
    finalizationId: `recovery-${suffix}-finalization`,
    episodeId: `recovery-${suffix}-episode`,
    date: "1164.12.31",
    totalDays: 424000,
    finalizationVisibilityV1: true,
    participants: [{ id: 1, name: "甲" }, { id: 2, name: "乙" }],
    participantPresence: [1, 2].map(characterId => ({ characterId, joinedAtMessageId: 1, leftAtMessageId: null })),
    messages: [
      { id: 1, role: "user", speakerCharacterId: 1, content: first,
        memory4Fragments: [{ start: 0, end: first.length, visibility: "participants", sourceType: "spoken", recipientIds: [2], entityIds: [2] }] },
      { id: 2, role: "assistant", speakerCharacterId: 2, content: second,
        memory4Fragments: [{ start: 0, end: second.length, visibility: "participants", sourceType: "spoken", recipientIds: [1], entityIds: [1] }] }
    ]
  };
}

function narrativeOutput(context) {
  return JSON.stringify({ summarySegments: context.messages.map(message => ({
    content: message.content,
    participants: [1, 2],
    visibility: "participants",
    source: "spoken",
    messageIds: [message.id],
    speakerIds: [message.speakerCharacterId]
  })), memories: [] });
}

function durableOutput(prompt) {
  const payload = JSON.parse(prompt[1].content);
  const entries = payload.fragments.map(fragment => ({
    memoryType: "MAJOR_EXPERIENCE",
    text: fragment.text,
    fragmentIds: [fragment.fragmentId],
    entityIds: [fragment.speakerId].filter(id => fragment.allowedEntityIds.includes(id)),
    participantIds: fragment.participantIds,
    topics: ["粮食"],
    eventTime: { from: "1164.1.1", to: "1164.12.31", precision: "year", status: "reported" }
  }));
  return { content: JSON.stringify({ status: entries.length ? "STORE" : "NO_DURABLE_CONTENT", entries }), finish_reason: "stop" };
}

function makeEngine(dir) {
  const summariesDir = path.join(dir, "summaries");
  ensureSummaryFolders(summariesDir);
  const engine = new MemoryEngine({ baseDir: path.join(dir, "memory"), summaryFoldersDir: summariesDir, trace: { record() {} } });
  engine.memory4.configureDerived({ isCampaignCurrent: () => true });
  return engine;
}

async function transientForgetReadRetainsNarrative(rootDir) {
  const engine = makeEngine(path.join(rootDir, "forget-read"));
  const context = fixtureContext("v8151-forget-read");
  let narrativeCalls = 0, durableOwnerOne = 0, durableOwnerTwo = 0;
  const store = engine.memory4.store;
  const filter = store.filterForgottenSnapshot.bind(store);
  let failOnce = true;
  store.filterForgottenSnapshot = snapshot => {
    if (failOnce) { failOnce = false; throw new Error("fixture_transient_forget_read"); }
    return filter(snapshot);
  };
  const finalized = await engine.finalizeConversation({ ...context,
    buildPrompt: () => [],
    requestSummary: async () => { narrativeCalls++; return { content: narrativeOutput(context), finish_reason: "stop" }; },
    persistCharacterFolders: async () => ({ success: true }),
    requestDurable: async (prompt, options) => {
      if (options.ownerId === 1) durableOwnerOne++;
      if (options.ownerId === 2) durableOwnerTwo++;
      return durableOutput(prompt);
    }
  });
  check("transient Forget read does not roll back the narrative commit", finalized.success && !!engine.isCommitted(engine.prepareFinalizationContext(context)));
  check("transient Forget read cannot create an unfiltered durable recovery snapshot", fs.readdirSync(engine.memory4.recoveryDir).length === 0);
  check("narrative recovery remains until each owner is durably handed off", engine.listRecoverySnapshots().length === 1);
  assert.equal(finalized.durable.durableHandoffComplete, false);

  store.filterForgottenSnapshot = filter;
  const recovered = await engine.recoverPendingFinalizations({
    activeCampaignToken: context.campaignToken,
    isConversationActive: () => false,
    requestSummary: async () => { throw new Error("committed narrative must not call its provider again"); },
    requestDurable: async (prompt, options) => {
      if (options.ownerId === 1) durableOwnerOne++;
      if (options.ownerId === 2) durableOwnerTwo++;
      return durableOutput(prompt);
    },
    persistCharacterFolders: async () => ({ success: true })
  });
  check("committed narrative recovery completes without a second narrative request", narrativeCalls === 1);
  check("only the owner missing durable handoff is extracted again", durableOwnerOne === 1 && durableOwnerTwo === 1);
  check("recovery result reports durable handoff completion", recovered.every(result => result.success === true));
  check("narrative recovery clears only after durable recovery finishes", engine.listRecoverySnapshots().length === 0);
}

function committedSnapshot(engine, context, ownerId = 2) {
  return engine.memory4.buildOwnerSnapshot(engine.prepareFinalizationContext(context), ownerId);
}

function candidateFor(snapshot) {
  const fragment = snapshot.fragments[0];
  return {
    memoryType: "MAJOR_EXPERIENCE",
    text: fragment.text,
    fragmentIds: [fragment.fragmentId],
    entityIds: [fragment.speakerId].filter(id => [snapshot.ownerId, ...fragment.entityIds].includes(id)),
    participantIds: fragment.presentIds,
    topics: ["粮食"],
    eventTime: { from: "1164.1.1", to: "1164.12.31", precision: "year", status: "reported" }
  };
}

async function committedRecoveryRetiresDerivedWork(rootDir) {
  const engine = makeEngine(path.join(rootDir, "derived-restart"));
  const context = fixtureContext("v8151-derived-restart", "derived");
  const coordinator = engine.memory4;
  const snapshot = committedSnapshot(engine, context);
  const recoveryFile = coordinator.saveRecovery(snapshot, { status: "PENDING", retryCount: 0 });
  coordinator.store.commitOwner(snapshot, { status: "STORE", entries: [candidateFor(snapshot)] });

  const restarted = new MemoryEngine({ store: engine.store, trace: { record() {} } }).memory4;
  let scheduleCalls = 0, compressionCalls = 0;
  restarted.configureDerived({ isCampaignCurrent: () => true,
    requestCompression: async () => { compressionCalls++; throw new Error("retired_derived_provider_must_not_run"); } });
  restarted.derived.schedule = async () => { scheduleCalls++; return { status: "UNEXPECTED_SCHEDULE" }; };
  let extractionCalls = 0;
  const recoveryPromise = restarted.recoverPending(async () => { extractionCalls++; throw new Error("committed owner must not be extracted twice"); }, {
    activeCampaignToken: context.campaignToken,
    isNarrativeCommitted: () => true
  });
  const results = await recoveryPromise;
  const derived = restarted.derived.list(snapshot);
  check("verified Durable recovery retires Derived work and clears only its committed recovery record",
    restarted.inspectCommittedSnapshot(snapshot).state === "COMMITTED" && !fs.existsSync(recoveryFile)
      && results.length === 1 && results[0].status === "SKIPPED_DERIVED_POLICY"
      && results[0].durableStatus === "STORE" && results[0].derivedGenerationStatus === "SKIPPED_DERIVED_POLICY");
  check("recovery does not schedule Year/Life work or call its Provider", scheduleCalls === 0 && compressionCalls === 0
    && derived.generationPolicy === "RETIRED" && derived.years.length === 0 && derived.life === null);
  check("already-committed canonical owner does not repeat provider extraction", extractionCalls === 0);
}

async function preserveManualOverrideAndForget(rootDir) {
  const engine = makeEngine(path.join(rootDir, "manual-forget"));
  const firstContext = fixtureContext("v8151-manual", "manual-first");
  const first = committedSnapshot(engine, firstContext);
  const coordinator = engine.memory4;
  coordinator.store.commitOwner(first, { status: "STORE", entries: [candidateFor(first)] });
  seedDerivedHistory(engine, { campaignToken: first.campaignToken, ownerId: first.ownerId });
  let year = coordinator.derived.list(first).years.find(view => view.eventYear === 1164);
  assert(year?.items.length);
  coordinator.derived.updateYear(first, { eventYear: 1164, itemId: year.items[0].itemId,
    expectedRevision: year.revision, text: "手工保留的年度记忆。" });

  const secondContext = fixtureContext("v8151-manual", "manual-second");
  secondContext.conversationId = "manual-second-conversation";
  secondContext.finalizationId = "manual-second-finalization";
  secondContext.messages[0].content = "甲在1164年再次记下粮食交付。";
  secondContext.messages[0].memory4Fragments[0].end = secondContext.messages[0].content.length;
  const second = committedSnapshot(engine, secondContext);
  const recoveryFile = coordinator.saveRecovery(second, { status: "PENDING", retryCount: 0 });
  coordinator.store.commitOwner(second, { status: "STORE", entries: [candidateFor(second)] });
  const restarted = new MemoryEngine({ store: engine.store, trace: { record() {} } }).memory4;
  assert.equal(restarted.inspectCommittedSnapshot(second).state, "COMMITTED",
    "recovery cleanup requires a matching Durable commit, source revision, and current Forget proof");
  const recovered = await restarted.recoverPending(async () => { throw new Error("canonical retry must not invoke provider"); }, {
    activeCampaignToken: second.campaignToken,
    isNarrativeCommitted: () => true
  });
  year = restarted.derived.read(second, "year", 1164);
  check("manual historical Year text survives as dirty data after verified Durable recovery",
    year.items[0].text === "手工保留的年度记忆。" && restarted.derived.list(second).years[0].dirty);
  check("retired Derived work does not pin or mislabel a verified recovery record",
    !fs.existsSync(recoveryFile) && recovered[0].status === "SKIPPED_DERIVED_POLICY"
      && recovered[0].durableStatus === "STORE" && recovered[0].derivedGenerationStatus === "SKIPPED_DERIVED_POLICY");

  const forgetContext = fixtureContext("v8151-forgotten", "forgotten");
  const forgottenSnapshot = committedSnapshot(engine, forgetContext);
  const originalFilter = coordinator.store.filterForgottenSnapshot.bind(coordinator.store);
  coordinator.store.filterForgottenSnapshot = snapshot => ({ snapshot: { ...snapshot, fragments: [] },
    forgottenProjectionIds: ["fixture-forgotten-projection"], removedFragmentCount: 1,
    removedFragmentIds: snapshot.fragments.map(fragment => fragment.fragmentId) });
  let forbiddenProviderCalls = 0;
  const forgotten = await coordinator.finishOwner(forgottenSnapshot, async () => { forbiddenProviderCalls++; return durableOutput([]); });
  coordinator.store.filterForgottenSnapshot = originalFilter;
  check("Forget tombstone remains an absolute extraction gate", forgotten.status === "FORGOTTEN" && forbiddenProviderCalls === 0);

  const transient = committedSnapshot(engine, fixtureContext("v8151-forget-read-existing", "forget-read-existing"));
  const transientFile = coordinator.saveRecovery(transient, { status: "PENDING", retryCount: 0 });
  coordinator.store.filterForgottenSnapshot = () => { throw new Error("fixture_transient_forget_read"); };
  const failedRead = await coordinator.finishOwner(transient, async () => { forbiddenProviderCalls++; return durableOutput([]); },
    coordinator.readRecovery(transientFile));
  coordinator.store.filterForgottenSnapshot = originalFilter;
  check("failed Forget reads cannot claim handoff from an older recovery record", failedRead.status === "EXTRACTION_FAILED"
    && !failedRead.recoveryPath && fs.existsSync(transientFile) && forbiddenProviderCalls === 0);
}

async function staleCampaignAndRevisionDoNotHandoff(rootDir) {
  const engine = makeEngine(path.join(rootDir, "stale-scope"));
  const context = fixtureContext("v8151-stale", "stale");
  const snapshot = committedSnapshot(engine, context);
  const file = engine.memory4.saveRecovery(snapshot, { status: "PENDING", retryCount: 0 });
  let calls = 0;
  const mismatch = await engine.memory4.recoverPending(async () => { calls++; return durableOutput([]); }, {
    activeCampaignToken: "another-campaign", isNarrativeCommitted: () => true
  });
  check("stale campaign recovery is retained without Provider work", mismatch[0].status === "CAMPAIGN_MISMATCH" && calls === 0 && fs.existsSync(file));

  const fresh = makeEngine(path.join(rootDir, "stale-revision"));
  const changed = fixtureContext("v8151-revision", "revision");
  const current = committedSnapshot(fresh, changed);
  const stale = { ...current, sourceRevision: "stale-source-revision" };
  fresh.memory4.saveRecovery(stale, { status: "PENDING", retryCount: 0 });
  const originalFilter = fresh.memory4.store.filterForgottenSnapshot.bind(fresh.memory4.store);
  fresh.memory4.store.filterForgottenSnapshot = () => { throw new Error("fixture_transient_snapshot_read"); };
  const handoff = await fresh.memory4.finalizeCommitted(changed, async () => { calls++; return durableOutput([]); }, {
    isNarrativeCommitted: true, isCurrent: () => true, handoffOnly: true
  });
  fresh.memory4.store.filterForgottenSnapshot = originalFilter;
  check("recovery handoff rejects a different sourceRevision even with matching scope IDs", handoff.durableHandoffComplete === false && calls === 0);
}

async function explicitForgottenOwnerIsTerminal(rootDir) {
  const engine = makeEngine(path.join(rootDir, "forgotten-owner"));
  const context = fixtureContext("v8151-explicit-exclusion", "excluded");
  context.excludedSummaryOwnerIds = [2, 999];
  let providerCalls = 0;
  const handoff = await engine.memory4.finalizeCommitted(context, async () => { providerCalls++; return durableOutput([]); }, {
    isNarrativeCommitted: true, isCurrent: () => true, handoffOnly: true
  });
  check("explicitly excluded owner is terminal without recreating its Memory4 scope", handoff.durableHandoffComplete === true
    && handoff.owners.length === 1 && handoff.owners[0].ownerId === 1 && providerCalls === 0
    && !fs.readdirSync(engine.memory4.recoveryDir).some(name => engine.memory4.readRecovery(path.join(engine.memory4.recoveryDir, name)).snapshot.ownerId === 2));
}

async function explicitExclusionDoesNotPinNarrativeRecovery(rootDir) {
  const engine = makeEngine(path.join(rootDir, "excluded-no-loop"));
  const context = fixtureContext("v8151-excluded-no-loop", "excluded-no-loop");
  context.excludedSummaryOwnerIds = [2];
  const store = engine.memory4.store;
  const filter = store.filterForgottenSnapshot.bind(store);
  let failOnce = true;
  store.filterForgottenSnapshot = snapshot => {
    if (failOnce) { failOnce = false; throw new Error("fixture_transient_forget_read"); }
    return filter(snapshot);
  };
  let narrativeCalls = 0;
  const durableCalls = new Map();
  const finalized = await engine.finalizeConversation({ ...context,
    buildPrompt: () => [],
    requestSummary: async () => { narrativeCalls++; return { content: narrativeOutput(context), finish_reason: "stop" }; },
    persistCharacterFolders: async () => ({ success: true }),
    requestDurable: async (prompt, options) => {
      durableCalls.set(options.ownerId, (durableCalls.get(options.ownerId) || 0) + 1);
      return durableOutput(prompt);
    }
  });
  check("a transient failure with an explicitly excluded owner retains narrative recovery", finalized.success
    && finalized.durable.durableHandoffComplete === false && engine.listRecoverySnapshots().length === 1);
  store.filterForgottenSnapshot = filter;
  await engine.recoverPendingFinalizations({
    activeCampaignToken: context.campaignToken,
    isConversationActive: () => false,
    requestSummary: async () => { throw new Error("committed narrative must not be regenerated"); },
    requestDurable: async (prompt, options) => {
      durableCalls.set(options.ownerId, (durableCalls.get(options.ownerId) || 0) + 1);
      return durableOutput(prompt);
    },
    persistCharacterFolders: async () => ({ success: true })
  });
  check("explicit exclusion hands off only eligible owners and does not loop narrative recovery", narrativeCalls === 1
    && durableCalls.get(1) === 1 && !durableCalls.has(2) && engine.listRecoverySnapshots().length === 0
    && engine.memory4.getRecoveryStatus(context.campaignToken).pending === 0);
}

async function run() {
  try {
    await transientForgetReadRetainsNarrative(root);
    await committedRecoveryRetiresDerivedWork(root);
    await preserveManualOverrideAndForget(root);
    await staleCampaignAndRevisionDoNotHandoff(root);
    await explicitForgottenOwnerIsTerminal(root);
    await explicitExclusionDoesNotPinNarrativeRecovery(root);
    console.log(`V8.15.1 Memory recovery: ${checks} checks passed`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
