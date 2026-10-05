"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { MemoryStore } = require("../resources/app/out/main/memory-system/memory-store");
const { Memory4Coordinator } = require("../resources/app/out/main/memory-system/memory4-coordinator");
const { MemoryTrace } = require("../resources/app/out/main/memory-system/memory-trace");
const { createMemoryRecord } = require("../resources/app/out/main/memory-system/memory-types");
const { hash, legacySourceHash, validateEntry } = require("../resources/app/out/main/memory-system/memory4-contract");

let passed = 0;
function check(name) {
  passed++;
  console.log(`PASS ${name}`);
}

function createEnvironment(profile, name) {
  const root = path.join(profile, name);
  const baseDir = path.join(root, "memory");
  const summariesDir = path.join(root, "summaries");
  fs.mkdirSync(path.join(summariesDir, "2_乙"), { recursive: true });
  const store = new MemoryStore({ baseDir, summaryFoldersDir: summariesDir });
  const trace = new MemoryTrace({ logger: { log() {} } });
  const coordinator = new Memory4Coordinator(store, { trace });
  return { baseDir, summariesDir, store, trace, coordinator };
}

function createContext(name, { content = "1164年1月1日，甲向乙说明，谷物已经送抵仓库。", date = "1164.2.1" } = {}) {
  return {
    campaignToken: `qa-campaign-${name}`,
    conversationId: `qa-conversation-${name}`,
    finalizationId: `qa-finalization-${name}`,
    episodeId: `qa-episode-${name}`,
    date,
    totalDays: 425000,
    participants: [{ id: 1, name: "甲" }, { id: 2, name: "乙" }, { id: 3, name: "丙" }],
    participantPresence: [1, 2, 3].map(characterId => ({ characterId, joinedAtMessageId: 0, leftAtMessageId: null })),
    messages: [{ id: 1, role: "assistant", speakerCharacterId: 1, content,
      memory4Fragments: [{ start: 0, end: content.length, visibility: "participants", sourceType: "spoken",
        recipientIds: [2], knownBy: [1, 2], entityIds: [99] }] }]
  };
}

function candidate(snapshot, overrides = {}) {
  return {
    memoryType: "MAJOR_EXPERIENCE",
    text: "甲向乙交代了一件长久留存的旧事。",
    fragmentIds: [snapshot.fragments[0].fragmentId],
    participantIds: [],
    entityIds: [],
    topics: ["旧事"],
    eventTime: { status: "unknown" },
    ...overrides
  };
}

function response(entries = [], extra = {}) {
  return { status: entries.length ? "STORE" : "NO_DURABLE_CONTENT", entries, ...extra };
}

function asGeneration(value) {
  return { content: JSON.stringify(value), complete: true, truncated: false };
}

function promptPayload(prompt) {
  assert.equal(prompt[0].role, "system");
  assert.equal(prompt[1].role, "user");
  return JSON.parse(prompt[1].content);
}

function derivedKey(scope) { return hash([scope.campaignToken, scope.ownerId]); }

async function waitForDerived(coordinator, scope) {
  for (let attempt = 0; attempt < 30; attempt++) {
    const job = coordinator.derived.jobs.get(derivedKey(scope));
    const views = coordinator.derived.list(scope);
    if (job?.status === "COMPLETE" && views.years.length && views.life) return views;
    await new Promise(resolve => setImmediate(resolve));
  }
  throw new Error("memory4_derived_timeout");
}

async function main() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v8142-incident-independent-"));
  try {
    {
      const env = createEnvironment(profile, "allowlist");
      const snapshot = env.coordinator.buildOwnerSnapshot(createContext("allowlist"), 2);
      const fragment = snapshot.fragments[0];
      assert.deepEqual(fragment.knownBy, [1, 2]);
      assert.deepEqual(fragment.presentIds, [1, 2, 3]);
      const payload = promptPayload(env.coordinator.buildPrompt(snapshot, snapshot.fragments));
      assert.deepEqual(payload.fragments[0].allowedEntityIds, [1, 2, 99]);
      assert.deepEqual(payload.fragments[0].participantIds, [1, 2, 3]);
      assert.deepEqual(payload.fragments[0].presentIds, [1, 2, 3], "the original presence evidence remains available");
      assert.deepEqual(payload.fragments[0].entityIds, [99], "the original cited-entity evidence remains available");
      const legacyFragment = { fragmentId: "legacy-minimal", text: "旧版最小证据。", speakerId: 1, sourceType: "spoken",
        entityIds: [], presentIds: [1, 2, 3] };
      const legacyPrompt = promptPayload(env.coordinator.buildPrompt({ ownerId: 2, campaignToken: "legacy-minimal",
        date: "1164.2.1", completeness: "partial" }, [legacyFragment]));
      assert.deepEqual(legacyPrompt.fragments[0].allowedEntityIds, [1], "absent knownBy must neither crash prompt construction nor grant Owner 2");
      assert.match(env.coordinator.buildPrompt(snapshot, snapshot.fragments)[0].content, /allowedEntityIds/);
      assert.match(env.coordinator.buildPrompt(snapshot, snapshot.fragments)[0].content, /never authorize entityIds/);
      assert.doesNotThrow(() => validateEntry(candidate(snapshot, { entityIds: [2] }), snapshot), "cited owner may be named");
      assert.doesNotThrow(() => validateEntry(candidate(snapshot, { entityIds: [1, 99] }), snapshot), "speaker and cited fragment entities keep their prior allowance");
      assert.doesNotThrow(() => validateEntry(candidate(snapshot, { participantIds: [3] }), snapshot), "presence may support participantIds");
      assert.throws(() => validateEntry(candidate(snapshot, { entityIds: [3] }), snapshot), /memory4_unknown_entity/, "presence alone must not authorize entityIds");
      assert.throws(() => validateEntry(candidate(snapshot, { entityIds: [3] }), { ...snapshot, ownerId: 3 }), /memory4_invisible_source/,
        "the current owner is only added after the cited fragment ACL check");
      check("owner-scoped entity allowlist keeps presence separate from identity");
    }

    {
      const env = createEnvironment(profile, "all-rejected");
      const context = createContext("all-rejected");
      const snapshot = env.coordinator.buildOwnerSnapshot(context, 2);
      const sourceText = snapshot.fragments[0].text;
      const result = await env.coordinator.finishOwner(snapshot, async prompt => {
        const payload = promptPayload(prompt);
        assert.deepEqual(payload.fragments[0].allowedEntityIds, [1, 2, 99]);
        return asGeneration(response([candidate(snapshot, { entityIds: [3] })]));
      });
      assert.equal(result.status, "EXTRACTION_FAILED");
      assert.equal(result.error, "memory4_response_no_valid_entries");
      const recovery = env.coordinator.readRecovery(result.recoveryPath);
      assert.equal(recovery.status, "EXTRACTION_FAILED");
      assert.equal(recovery.retryCount, 1);
      assert.deepEqual(recovery.snapshot.fragments, snapshot.fragments, "retry snapshot must retain the exact source projection");
      assert.equal(env.coordinator.store.query({ campaignToken: context.campaignToken, ownerId: 2 }).length, 0);
      assert.equal(env.coordinator.store.loadIndex(snapshot).finalizations[hash(snapshot.finalizationId)], undefined);
      const rejection = env.trace.list().find(entry => entry.stage === "memory4_candidate_rejected");
      assert.equal(rejection?.memory4RejectedUnknownEntityCount, 1);
      assert.equal(JSON.stringify(env.trace.list()).includes(sourceText), false, "trace must not retain source prose");
      check("all unknown_entity candidates fail closed with a recoverable snapshot");
    }

    {
      const env = createEnvironment(profile, "empty");
      const context = createContext("empty");
      const snapshot = env.coordinator.buildOwnerSnapshot(context, 2);
      const result = await env.coordinator.finishOwner(snapshot, async () => asGeneration(response()));
      assert.equal(result.status, "NO_DURABLE_CONTENT");
      assert.equal(result.entryIds.length, 0);
      assert.equal(result.noDetailIsNotUnknown, true);
      assert.equal(fs.existsSync(env.coordinator.recoveryPath(snapshot)), false);
      assert.equal(env.coordinator.store.query({ campaignToken: context.campaignToken, ownerId: 2 }).length, 0);
      assert.equal(env.coordinator.store.loadIndex(snapshot).finalizations[hash(snapshot.finalizationId)].status, "NO_DURABLE_CONTENT");
      check("a genuine empty response remains NO_DURABLE_CONTENT");
    }

    {
      const env = createEnvironment(profile, "mixed-entry");
      env.coordinator.derived.schedule = () => {};
      const context = createContext("mixed-entry");
      const snapshot = env.coordinator.buildOwnerSnapshot(context, 2);
      const result = await env.coordinator.finishOwner(snapshot, async () => asGeneration(response([
        candidate(snapshot, { entityIds: [2], participantIds: [3] }),
        candidate(snapshot, { text: "无依据地指称丙", entityIds: [3] })
      ])));
      assert.equal(result.status, "STORE");
      assert.equal(result.entryIds.length, 1);
      assert.equal(env.coordinator.store.query({ campaignToken: context.campaignToken, ownerId: 2 }).length, 1);
      assert.equal(env.trace.list().find(entry => entry.stage === "memory4_candidate_rejected")?.memory4RejectedUnknownEntityCount, 1);
      check("mixed candidates retain the valid Detail and rejection count");
    }

    {
      const env = createEnvironment(profile, "mixed-transition");
      env.coordinator.derived.schedule = () => {};
      const firstContext = createContext("commitment-source", { content: "甲承诺向乙运粮。", date: "1164.1.2" });
      const firstSnapshot = env.coordinator.buildOwnerSnapshot(firstContext, 2);
      const original = candidate(firstSnapshot, { memoryType: "COMMITMENT", text: "甲承诺向乙运粮。", entityIds: [2] });
      const created = await env.coordinator.finishOwner(firstSnapshot, async () => asGeneration(response([original])));
      assert.equal(created.status, "STORE");
      const storedCommitment = env.coordinator.store.query({ campaignToken: firstContext.campaignToken, ownerId: 2 })[0];

      const secondContext = createContext("commitment-proof", {
        content: "甲已经如约向乙运粮，谷物已交到仓库。", date: "1164.2.1"
      });
      secondContext.campaignToken = firstContext.campaignToken;
      const secondSnapshot = env.coordinator.buildOwnerSnapshot(secondContext, 2);
      const transition = { entryId: storedCommitment.entryId, expectedRevision: storedCommitment.revision,
        status: "fulfilled", fragmentIds: [secondSnapshot.fragments[0].fragmentId],
        commitmentQuote: "向乙运粮", evidenceQuote: "甲已经如约向乙运粮" };
      const invalid = candidate(secondSnapshot, { text: "把丙误列为本事当事人", entityIds: [3] });
      const transitioned = await env.coordinator.finishOwner(secondSnapshot, async () =>
        asGeneration(response([invalid], { commitmentTransitions: [transition] })));
      assert.equal(transitioned.status, "NO_DURABLE_CONTENT", "transition-only success has no new Detail");
      assert.equal(transitioned.commitmentTransitionCount, 1);
      assert.equal(transitioned.changedEntryIds.length, 1);
      assert.equal(env.coordinator.store.query({ campaignToken: firstContext.campaignToken, ownerId: 2 }).length, 1);
      assert.equal(env.trace.list().find(entry => entry.stage === "memory4_candidate_rejected")?.memory4RejectedUnknownEntityCount, 1);
      check("a valid transition survives an unknown_entity sibling candidate");
    }

    {
      const env = createEnvironment(profile, "legacy-recompress");
      const scope = { campaignToken: "qa-legacy-campaign", ownerId: 2 };
      const original = createMemoryRecord({ memoryId: "qa-edited-legacy", type: "folder_summary", updatedBy: "user",
        content: "甲曾告知乙，谷物抵达仓库。", knownBy: [2], subjects: [1],
        provenance: { campaignToken: scope.campaignToken, folderOwnerId: 2, extractionMode: "user_edited_summary" } });
      env.store.saveMemory(original);
      env.coordinator.configureDerived({ isCampaignCurrent: () => true,
        requestExtraction: async prompt => asGeneration(response([{
          memoryType: "DURABLE_KNOWLEDGE", text: "丙曾与乙议定此事。", fragmentIds: promptPayload(prompt).fragments.map(fragment => fragment.fragmentId),
          participantIds: [], entityIds: [3], topics: [], eventTime: { status: "unknown" }
        }])) });
      const source = env.store.getMemory(original.memoryId);
      const failure = await env.coordinator.recompressLegacy(scope, { memoryId: original.memoryId, expectedSourceHash: legacySourceHash(source) });
      assert.equal(failure.status, "EXTRACTION_FAILED");
      assert.equal(failure.reason, "memory4_response_no_valid_entries");
      assert.equal(failure.retained, true);
      assert.equal(env.coordinator.store.query(scope).length, 0);
      assert.equal(Object.keys(env.coordinator.store.loadIndex(scope).finalizations).length, 0);
      assert.equal(env.store.getMemory(original.memoryId).content, original.content);
      check("all-rejected legacy recompression fails while preserving the source summary");
    }

    {
      const env = createEnvironment(profile, "legacy-empty");
      const scope = { campaignToken: "qa-empty-legacy-campaign", ownerId: 2 };
      const original = createMemoryRecord({ memoryId: "qa-empty-edited-legacy", type: "folder_summary", updatedBy: "user",
        content: "甲曾告知乙，谷物抵达仓库。", knownBy: [2], subjects: [1],
        provenance: { campaignToken: scope.campaignToken, folderOwnerId: 2, extractionMode: "user_edited_summary" } });
      env.store.saveMemory(original);
      env.coordinator.configureDerived({ isCampaignCurrent: () => true, requestExtraction: async () => asGeneration(response()) });
      const empty = await env.coordinator.recompressLegacy(scope, { memoryId: original.memoryId });
      assert.equal(empty.status, "RETAINED_LEGACY");
      assert.equal(empty.reason, "NO_DURABLE_CONTENT");
      assert.equal(empty.retained, true);
      assert.equal(env.coordinator.store.query(scope).length, 0);
      assert.equal(env.store.getMemory(original.memoryId).content, original.content);
      check("a genuine empty legacy extraction remains retained as NO_DURABLE_CONTENT");
    }

    {
      const env = createEnvironment(profile, "derived-positive");
      const context = createContext("derived-positive", {
        content: "1164年1月1日，甲向乙交付了谷物。", date: "1164.2.1"
      });
      const snapshot = env.coordinator.buildOwnerSnapshot(context, 2);
      const detail = candidate(snapshot, { text: "甲向乙交付了谷物。", entityIds: [2],
        eventTime: { from: "1164.1.1", to: "1164.1.1", precision: "day", status: "reported" } });
      env.coordinator.configureDerived({ isCampaignCurrent: () => true, estimateTokens: text => Math.ceil(text.length / 4) });
      const result = await env.coordinator.finishOwner(snapshot, async () => asGeneration(response([detail])));
      assert.equal(result.status, "STORE");
      const scope = { campaignToken: context.campaignToken, ownerId: 2 };
      const canonical = env.coordinator.store.query(scope);
      assert.equal(canonical.length, 1, "finishOwner must persist canonical Detail");
      assert.deepEqual(canonical[0].eventTime, { from: "1164.1.1", to: "1164.1.1", precision: "day", status: "reported" });
      const views = await waitForDerived(env.coordinator, scope);
      assert.equal(views.dirty, false);
      assert.equal(views.years.length, 1);
      assert.equal(views.years[0].eventYear, 1164);
      assert.equal(views.years[0].dirty, false);
      assert.deepEqual(views.years[0].items[0].sourceEntryIds, [canonical[0].entryId]);
      assert(views.life);
      assert.equal(views.life.dirty, false);
      assert.equal(views.life.segments.length, 1);
      assert.equal(views.life.segments[0].segmentId, "life_1160s");
      assert.deepEqual(views.life.segments[0].sourceEntryIds, [canonical[0].entryId]);
      assert.equal(env.coordinator.derived.options.requestCompression, undefined, "small derived views must complete without provider access");
      check("finishOwner persists canonical Detail and builds real Year and Life views");
    }

    console.log(`Memory4 incident independent QA: ${passed} checks passed`);
  } finally {
    const target = path.resolve(profile);
    assert(target.startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(target, { recursive: true, force: true });
  }
}

main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
