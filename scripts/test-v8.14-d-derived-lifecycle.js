"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { MemoryStore } = require("../resources/app/out/main/memory-system/memory-store");
const { Memory4Coordinator } = require("../resources/app/out/main/memory-system/memory4-coordinator");
const { Memory4RecallPlanner } = require("../resources/app/out/main/memory-system/memory4-recall-planner");
const { MemoryTrace } = require("../resources/app/out/main/memory-system/memory-trace");
const { extractTemporalAnchors, normalizeTemporalRefs } = require("../resources/app/out/main/memory-system/temporal-anchor-extractor");
const { projectVisibleTranscript } = require("../resources/app/out/main/memory-system/memory4-visibility");
const { hash, legacySourceHash } = require("../resources/app/out/main/memory-system/memory4-contract");
const { normalizeGameDate } = require("../resources/app/out/main/worldline/character-temporal-facts");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "votc-memory4-d-"));
const tick = () => new Promise(resolve => setImmediate(resolve));
let checks = 0, sequence = 0;
async function check(name, run) { await run(); checks++; console.log("PASS " + name); }
function fixture() {
  const directory = path.join(root, "fixture-" + sequence++);
  const summaries = path.join(directory, "summaries");
  for (const id of [1, 2, 3]) fs.mkdirSync(path.join(summaries, id + "_fixture"), { recursive: true });
  const base = new MemoryStore({ baseDir: path.join(directory, "memory"), summaryFoldersDir: summaries });
  const coordinator = new Memory4Coordinator(base);
  const scope = { campaignToken: "campaign-D", ownerId: 2 };
  const snapshot = (text, { eventYear = 1158, date = "1164.8.11", ownerId = 2 } = {}) => {
    const context = { campaignToken: scope.campaignToken, conversationId: "conversation-" + sequence++, finalizationId: "finalization-" + sequence++,
      date, totalDays: normalizeGameDate(date).serial, participants: [{ id: 1 }, { id: ownerId }],
      participantPresence: [{ characterId: 1, joinedAtMessageId: 0 }, { characterId: ownerId, joinedAtMessageId: 0 }],
      messages: [{ id: 0, role: "user", speakerCharacterId: 1, content: text,
        memory4Fragments: [{ start: 0, end: text.length, visibility: "participants", sourceType: "spoken", recipientIds: [ownerId], entityIds: [1] }] }] };
    const projection = projectVisibleTranscript(context, ownerId);
    const entry = { memoryType: "MAJOR_EXPERIENCE", text, entityIds: [1], topics: [], fragmentIds: [projection.fragments[0].fragmentId],
      eventTime: eventYear ? { from: eventYear + ".1.1", to: eventYear + ".12.31", precision: "year", status: "reported" } : { status: "unknown" } };
    return { source: { ...context, ...projection, ownerId, counterpartIds: [1] }, entry };
  };
  const add = (text, options) => {
    const data = snapshot(text, options);
    const result = coordinator.store.commitOwner(data.source, { status: "STORE", entries: [data.entry] });
    return { ...data, id: result.entryIds[0] };
  };
  return { base, coordinator, scope, snapshot, add };
}

async function main() {
  try {
    await check("structured Year and Life preserve provenance without a Provider request", async () => {
      const f = fixture(); let calls = 0;
      f.coordinator.configureDerived({ requestCompression: async () => { calls++; throw new Error("unexpected_provider"); } });
      f.add("1158年迁居邢州。"); f.add("1158年参与议和。");
      const result = await f.coordinator.derived.rebuild(f.scope, { kind: "all" });
      assert.equal(result.status, "COMPLETE"); assert.equal(calls, 0);
      const views = f.coordinator.derived.list(f.scope);
      assert.equal(views.years.length, 1); assert.equal(views.years[0].items.length, 2);
      assert(views.years[0].tokens <= 1000); assert.equal(views.life.segments[0].segmentId, "life_1150s");
      assert.equal(views.years[0].dirty, false); assert.equal(views.life.dirty, false);
      assert.equal(views.life.segments[0].sourceEntryIds.length, 2);
    });
    await check("unknown event time never acquires the conversation year", async () => {
      const f = fixture(); f.add("答应以后再讨论此事。", { eventYear: null });
      await f.coordinator.derived.rebuild(f.scope, { kind: "all" });
      assert.deepEqual(f.coordinator.derived.list(f.scope).years, []);
      assert.deepEqual(f.coordinator.derived.list(f.scope).life.segments, []);
    });
    await check("normal detached finalization schedules only its proven private scope", async () => {
      const f = fixture(); f.coordinator.configureDerived({ isCampaignCurrent: () => false });
      const data = f.snapshot("1158年迁居邢州。");
      const result = await f.coordinator.finishOwner(data.source, async () => JSON.stringify({ status: "STORE", entries: [data.entry] }));
      assert.equal(result.status, "STORE");
      for (let index = 0; index < 8; index++) await tick();
      assert.equal(f.coordinator.derived.list(f.scope).years[0].dirty, false);
      assert.equal(f.coordinator.derived.list(f.scope).life.dirty, false);
      assert.equal((await f.coordinator.derived.rebuild(f.scope, { kind: "all", committedFinalization: true })).status, "CANCELLED");
    });
    await check("a clear before a scheduled build cannot recreate a committed sidecar", async () => {
      const f = fixture(); f.coordinator.configureDerived({ isCampaignCurrent: () => false });
      const data = f.snapshot("1158年迁居邢州。");
      await f.coordinator.finishOwner(data.source, async () => JSON.stringify({ status: "STORE", entries: [data.entry] }));
      const directory = f.coordinator.store.directory(f.scope);
      fs.rmSync(directory, { recursive: true, force: true });
      for (let index = 0; index < 8; index++) await tick();
      assert.equal(fs.existsSync(directory), false);
    });
    await check("over-budget compression uses real purpose and source IDs with a hard cap", async () => {
      const f = fixture(); let calls = 0, purpose;
      f.add("1158年迁居邢州。" + "路途详细记录。".repeat(220));
      f.coordinator.configureDerived({ getProviderSnapshot: async () => ({ providerId: "fixture", modelId: "fixture" }),
        requestCompression: async (prompt, options) => {
          calls++; purpose = options.requestType; assert(options.signal instanceof AbortSignal);
          assert.equal(options.providerSnapshot.providerId, "fixture");
          const input = JSON.parse(prompt[1].content);
          return JSON.stringify({ items: [{ text: "1158年迁居邢州。", sourceEntryIds: input.items.flatMap(item => item.sourceEntryIds) }] });
        } });
      assert.equal((await f.coordinator.derived.rebuild(f.scope, { kind: "year", eventYear: 1158 })).status, "COMPLETE");
      assert.equal(calls, 1); assert.equal(purpose, "memory4_year");
      assert(f.coordinator.derived.list(f.scope).years[0].tokens <= 1000);
    });
    await check("compression cannot discard a commitment condition to meet its budget", async () => {
      const f = fixture();
      f.add("1158年答应议和，但须先释放俘虏。" + "详细记录。".repeat(300));
      f.coordinator.configureDerived({ requestCompression: async prompt => JSON.stringify({ items: [{
        text: "1158年答应议和。", sourceEntryIds: JSON.parse(prompt[1].content).items.flatMap(item => item.sourceEntryIds)
      }] }) });
      const result = await f.coordinator.derived.rebuild(f.scope, { kind: "year", eventYear: 1158 });
      assert.equal(result.status, "FAILED"); assert.equal(result.reason, "memory4_compression_quality_failed");
      assert.equal(f.coordinator.derived.list(f.scope).dirty, true);
    });
    await check("compression cannot move one source condition to an unrelated output item", async () => {
      const f = fixture();
      const commitment = f.add("1158年答应议和，但须先释放俘虏。" + "详细记录。".repeat(300));
      const unrelated = f.add("1158年迁居邢州。");
      f.coordinator.configureDerived({ requestCompression: async prompt => {
        const items = JSON.parse(prompt[1].content).items;
        assert.equal(items.find(item => item.sourceEntryIds.includes(commitment.id)).evidence[0].epistemicStatus, "reported");
        return JSON.stringify({ items: [{ text: "1158年答应议和。", sourceEntryIds: [commitment.id] },
          { text: "1158年迁居邢州，但须先释放俘虏。", sourceEntryIds: [unrelated.id] }] });
      } });
      const result = await f.coordinator.derived.rebuild(f.scope, { kind: "year", eventYear: 1158 });
      assert.equal(result.status, "FAILED"); assert.equal(result.reason, "memory4_compression_quality_failed");
      assert.equal(f.coordinator.derived.list(f.scope).dirty, true);
    });
    await check("manual conflict keeps user text dirty until an explicit revision-checked overwrite", async () => {
      const f = fixture(), detail = f.add("1158年迁居邢州。");
      await f.coordinator.derived.rebuild(f.scope, { kind: "all" });
      const year = f.coordinator.derived.list(f.scope).years[0];
      f.coordinator.derived.updateYear(f.scope, { eventYear: 1158, itemId: year.items[0].itemId, text: "用户的年度文字。", expectedRevision: year.revision });
      f.coordinator.store.updateEntry(f.scope, detail.id, "1158年迁居途中停留。", { expectedRevision: 1 });
      const changed = f.coordinator.derived.list(f.scope).years[0];
      assert.equal((await f.coordinator.derived.rebuild(f.scope, { kind: "year", eventYear: 1158 })).status, "MANUAL_OVERRIDE");
      f.coordinator.derived.keepManual(f.scope, { kind: "year", eventYear: 1158, expectedRevision: changed.revision });
      const kept = f.coordinator.derived.list(f.scope).years[0];
      assert.equal(kept.dirty, true); assert.equal(kept.items[0].text, "用户的年度文字。");
      assert.equal((await f.coordinator.derived.rebuild(f.scope, { kind: "year", eventYear: 1158, overwriteManual: true,
        expectedRevision: kept.revision })).status, "COMPLETE");
      assert.equal(f.coordinator.derived.list(f.scope).years[0].items[0].text, "1158年迁居途中停留。");
    });
    await check("canonical edit and derived dirty flags roll back together after a write failure", async () => {
      const f = fixture(), detail = f.add("1158年迁居邢州。");
      await f.coordinator.derived.rebuild(f.scope, { kind: "all" });
      const write = f.base.writeJson.bind(f.base); let injected = false;
      f.base.writeJson = (file, value) => {
        if (!injected && file.endsWith("metadata.json")) { injected = true; throw new Error("fixture_write_failure"); }
        return write(file, value);
      };
      assert.throws(() => f.coordinator.store.updateEntry(f.scope, detail.id, "用户更改。", { expectedRevision: 1 }), /fixture_write_failure/);
      f.base.writeJson = write;
      assert.equal(f.coordinator.store.readEntry(f.scope, detail.id).text, "1158年迁居邢州。");
      assert.equal(f.coordinator.derived.list(f.scope).years[0].dirty, false);
      assert.equal(f.coordinator.derived.list(f.scope).life.dirty, false);
    });
    await check("Planner overview and Detail share verified reads and one dynamic budget", async () => {
      const f = fixture();
      for (let index = 0; index < 24; index++) f.add("1158年记录事项" + index + "。");
      await f.coordinator.derived.rebuild(f.scope, { kind: "all" });
      const read = f.coordinator.store.readEntry.bind(f.coordinator.store); let reads = 0;
      f.coordinator.store.readEntry = (...arguments_) => { reads++; return read(...arguments_); };
      const planner = new Memory4RecallPlanner(f.coordinator);
      const packet = planner.plan({ ...f.scope, currentGameDate: "1184.8.11", currentTotalDays: normalizeGameDate("1184.8.11").serial,
        query: "1158年发生了什么？", querySpeakerId: 1, entityIds: [1], legacyMemories: [], memoryEngineRemainingBudget: 1200,
        providerRemainingSafeBudget: 1200, conversationId: "current", sceneRevision: "scene", turnEpoch: 1 });
      assert(packet.overview); assert.equal(packet.overview.sourceRef.kind, "year");
      assert(reads <= 32); assert.equal(reads, packet.diagnostics.bodyReads);
      assert(packet.details.length <= 2); assert(packet.tokens <= 1200);
      assert(planner.validateHistory(f.scope, packet.sourceRefs, { currentGameDate: "1184.8.11" }));
    });
    await check("a shared profile read context is bounded and new requests revalidate edited sources", async () => {
      const f = fixture(), detail = f.add("1158年迁居邢州。");
      await f.coordinator.derived.rebuild(f.scope, { kind: "all" });
      const loadIndex = f.coordinator.store.loadIndex.bind(f.coordinator.store);
      const read = f.coordinator.store.read.bind(f.coordinator.store); let indexReads = 0, metadataReads = 0, knownReads = 0, viewReads = 0;
      f.coordinator.store.loadIndex = (...args) => { indexReads++; return loadIndex(...args); };
      f.coordinator.store.read = (file, fallback) => {
        if (file.endsWith("metadata.json")) metadataReads++;
        if (file.endsWith("known-entities.json")) knownReads++;
        if (file.endsWith("life.json") || path.basename(path.dirname(file)) === "years") viewReads++;
        return read(file, fallback);
      };
      const readContext = f.coordinator.createProfileReadContext(f.scope);
      for (let index = 0; index < 40; index++) {
        const profile = f.coordinator.getKnownEntityProfile(f.scope, 1, { currentGameDate: "1184.8.11", readContext });
        assert.deepEqual(profile.memoryPointers.yearKeys, [1158]);
        assert.deepEqual(profile.memoryPointers.lifeItemIds, ["life_1150s"]);
      }
      assert.equal(indexReads, 1); assert(metadataReads <= 2); assert.equal(knownReads, 1); assert.equal(viewReads, 2);
      assert.throws(() => f.coordinator.getKnownEntityProfile({ ...f.scope, ownerId: 3 }, 1, { readContext }), /memory4_profile_scope_mismatch/);
      const rewind = f.coordinator.getKnownEntityProfile(f.scope, 1, { currentGameDate: "1158.1.1", readContext });
      assert.equal(rewind.recognition.level, "UNKNOWN"); assert.deepEqual(rewind.memoryPointers.yearKeys, []);
      f.coordinator.store.updateEntry(f.scope, detail.id, "1158年改为途中停留。", { expectedRevision: 1 });
      const fresh = f.coordinator.createProfileReadContext(f.scope);
      assert.equal(fresh.derived.years[0].dirty, true);
      assert.deepEqual(f.coordinator.getKnownEntityProfile(f.scope, 1, { currentGameDate: "1184.8.11", readContext: fresh }).memoryPointers.yearKeys, []);
    });
    await check("derived slices retain source rumor status even without a rumor word in the text", async () => {
      const f = fixture(), data = f.snapshot("1158年迁居邢州。");
      for (const fragment of data.source.fragments) fragment.sourceType = "rumor";
      const committed = f.coordinator.store.commitOwner(data.source, { status: "STORE", entries: [data.entry] });
      await f.coordinator.derived.rebuild(f.scope, { kind: "all" });
      const slice = f.coordinator.derived.selectSlice(f.scope, { query: { granularity: "YEAR", axis: "EVENT", entityIds: [1],
        window: { from: "1158.1.1", to: "1158.12.31" } }, index: f.coordinator.store.loadIndex(f.scope),
        eligibleEntryIds: committed.entryIds, currentGameDate: "1184.8.11" });
      assert(slice); assert.match(slice.memory.content, /rumor（传闻）\/reported/);
    });
    await check("a Year key never hides the original source range and precision", async () => {
      const f = fixture(), detail = f.add("1158年曾经迁居。"), index = f.coordinator.store.loadIndex(f.scope);
      const entry = f.coordinator.store.readEntry(f.scope, detail.id, index), directory = f.coordinator.store.directory(f.scope);
      entry.text = "曾经迁居。";
      entry.eventTime = { from: "1150.1.1", to: "1160.12.31", precision: "range", status: "reported" };
      index.entries[detail.id] = f.coordinator.store.indexRow(entry); f.coordinator.store.reindex(index);
      f.base.writeJson(f.coordinator.store.entryPath(directory, detail.id), entry);
      f.base.writeJson(path.join(directory, "index.json"), index);
      const metadata = f.coordinator.store.read(path.join(directory, "metadata.json"), null);
      f.base.writeJson(path.join(directory, "metadata.json"), { ...metadata, indexHash: hash(index) });
      await f.coordinator.derived.rebuild(f.scope, { kind: "year", eventYear: 1158 });
      const slice = f.coordinator.derived.selectSlice(f.scope, { query: { granularity: "YEAR", axis: "EVENT", entityIds: [1],
        window: { from: "1158.1.1", to: "1158.12.31" } }, index, eligibleEntryIds: [detail.id], currentGameDate: "1184.8.11" });
      assert(slice); assert.equal(slice.sourceRef.eventYear, 1158);
      assert.match(slice.memory.content, /1150\.1\.1~1160\.12\.31 range\/reported/);
    });
    await check("derived diagnostics retain sanitized revision counts without source text or configuration", async () => {
      const trace = new MemoryTrace({ logger: null });
      const data = trace.record("memory4_derived", { ownerId: 2, status: "COMPLETE", kind: "year", count: 1,
        indexRevision: 3, derivedRevision: 5, sourceHash: hash("safe"), durationMs: 12,
        text: "SECRET_BODY", query: "SECRET_QUERY", reason: "SECRET_REASON", alias: "SECRET_ALIAS", conversationId: "SECRET_CONVERSATION",
        providerSnapshot: { apiKey: "SECRET_KEY" }, errorCode: "SECRET_ERROR" });
      assert.deepEqual(data.memory4Derived, { ownerId: 2, status: "COMPLETE", kind: "year", count: 1,
        indexRevision: 3, derivedRevision: 5, sourceHash: hash("safe"), durationMs: 12 });
      assert.equal(data.error, null); assert(!JSON.stringify(data).includes("SECRET"));
      assert.equal(trace.record("memory4_legacy_recompression", { status: "EXTRACTION_FAILED", errorCode: "memory4_provider_unavailable" }).error,
        "memory4_provider_unavailable");
      const f = fixture(); f.coordinator.trace = trace; f.add("1158年迁居邢州。");
      await f.coordinator.derived.rebuild(f.scope, { kind: "all" });
      const logged = trace.list().at(-1).memory4Derived;
      assert.equal(logged.status, "COMPLETE"); assert.equal(logged.count, 2); assert(logged.indexRevision > 0);
      assert(logged.derivedRevision > 0); assert(logged.durationMs >= 0);
    });
    await check("Lazy conversion progresses remaining proven facts and preserves original bytes", async () => {
      const f = fixture();
      const parts = Array.from({ length: 10 }, (_, index) => f.base.saveMemory({ memoryId: "legacy-part-" + index,
        content: "独立旧约定" + index + "。", knownBy: [2], subjects: [1], updatedBy: "user",
        provenance: { campaignToken: f.scope.campaignToken, folderOwnerId: 2, extractionMode: "user_edited_summary", finalizationId: "legacy-source" } }));
      const parent = { memoryId: "legacy-parent", type: "folder_summary", eventDate: "1164.8.11", knownBy: [2],
        content: "【乙能够知道并记住的本场内容】\n" + parts.map(part => "- " + part.content).join("\n"),
        provenance: { campaignToken: f.scope.campaignToken, folderOwnerId: 2, perspectiveMemoryIds: parts.map(part => part.memoryId) } };
      const before = JSON.stringify(parent);
      f.base.loadFolderSummariesForCharacter = () => [parent];
      let sourceBatches = [];
      f.coordinator.configureDerived({ isCampaignCurrent: () => true, requestExtraction: async prompt => {
        const fragments = JSON.parse(prompt[1].content).fragments; sourceBatches.push(fragments.length);
        return JSON.stringify({ status: "STORE", entries: [{ memoryType: "COMMITMENT", text: fragments[0].text,
          fragmentIds: [fragments[0].fragmentId], entityIds: [1], topics: [] }] });
      } });
      const first = await f.coordinator.recompressLegacy(f.scope, { memoryId: parent.memoryId, expectedSourceHash: legacySourceHash(parent) });
      const second = await f.coordinator.recompressLegacy(f.scope, { memoryId: parent.memoryId, expectedSourceHash: legacySourceHash(parent) });
      assert.equal(first.status, "COMPLETE"); assert.equal(second.status, "COMPLETE");
      assert.notEqual(first.entryIds[0], second.entryIds[0]); assert(sourceBatches.every(count => count <= 8));
      const coverage = f.coordinator.getLegacyCoverage(f.scope, [parent]).items[0];
      assert.equal(coverage.suppressedFacts, 2); assert.equal(coverage.retainedFacts, 8); assert.equal(coverage.eligible, true);
      f.coordinator.store.deleteEntry(f.scope, first.entryIds[0]);
      assert.equal(f.coordinator.getLegacyCoverage(f.scope, [parent]).items[0].suppressedFacts, 2);
      assert.equal(f.coordinator.store.getKnownEntityEvidence(f.scope, 1).status, "UNKNOWN");
      assert.equal(JSON.stringify(parent), before);
    });
    await check("unsafe Legacy and edited source remain retained without a guessed migration", async () => {
      const f = fixture();
      const memory = f.base.saveMemory({ memoryId: "unsafe", content: "无法分段的叙事。", knownBy: [2],
        provenance: { campaignToken: f.scope.campaignToken, folderOwnerId: 2 } });
      f.base.loadFolderSummariesForCharacter = () => [memory];
      assert.equal((await f.coordinator.recompressLegacy(f.scope, { memoryId: memory.memoryId })).status, "RETAINED_LEGACY");
      assert.equal((await f.coordinator.recompressLegacy(f.scope, { memoryId: memory.memoryId, expectedSourceHash: hash("old") })).status, "STALE");
    });
    await check("Lazy explicit and relative dates use exact Legacy proofs rather than invented chat IDs", async () => {
      const f = fixture();
      const facts = [f.base.saveMemory({ memoryId: "legacy-year", content: "1164年迁居邢州。", eventDate: "1170.1.1",
        knownBy: [2], subjects: [1], provenance: { campaignToken: f.scope.campaignToken, folderOwnerId: 2 } }),
      f.base.saveMemory({ memoryId: "legacy-relative", content: "去年参与议和。", eventDate: "1164.1.1",
        knownBy: [2], subjects: [1], provenance: { campaignToken: f.scope.campaignToken, folderOwnerId: 2 } })];
      const parent = { memoryId: "legacy-dated-parent", eventDate: "1170.1.1", knownBy: [2],
        content: "【乙能够知道并记住的本场内容】\n" + facts.map(fact => "- " + fact.content).join("\n"),
        provenance: { campaignToken: f.scope.campaignToken, folderOwnerId: 2, perspectiveMemoryIds: facts.map(fact => fact.memoryId) } };
      f.base.loadFolderSummariesForCharacter = () => [parent];
      f.coordinator.configureDerived({ isCampaignCurrent: () => true, requestExtraction: async prompt => {
        const fragments = JSON.parse(prompt[1].content).fragments;
        assert.equal(fragments.find(fragment => fragment.text.startsWith("去年")).sourceAsOf, "1164.1.1");
        return JSON.stringify({ status: "STORE", entries: fragments.map(fragment => ({ memoryType: "MAJOR_EXPERIENCE", text: fragment.text,
          fragmentIds: [fragment.fragmentId], entityIds: [1], eventTime: { from: fragment.text.startsWith("1164") ? "1164.1.1" : "1163.1.1",
            to: fragment.text.startsWith("1164") ? "1164.12.31" : "1163.12.31", precision: "year", status: "reported" } })) });
      } });
      const result = await f.coordinator.recompressLegacy(f.scope, { memoryId: parent.memoryId });
      assert.equal(result.status, "COMPLETE", result.reason);
      const entries = result.entryIds.map(id => f.coordinator.store.readEntry(f.scope, id));
      assert.deepEqual(entries.map(entry => Number(entry.eventTime.from.split(".")[0])).sort(), [1163, 1164]);
      for (const entry of entries) {
        assert.deepEqual(entry.source.messageIds, []); assert.equal(entry.evidence.sourceType, "reported"); assert.equal(entry.evidence.completeness, "partial");
        const ref = entry.temporalRefs[0]; assert.equal(ref.source, "deterministic_legacy_parse"); assert.deepEqual(ref.messageIds, []);
        assert.equal(ref.sourceMemoryIds[0], entry.source.legacyMemoryIds[0]); assert.equal(ref.segmentIds[0], entry.source.segmentIds[0]);
        assert.equal(ref.legacySourceHash, entry.source.legacyRefs[0].sourceHash);
        assert.deepEqual(normalizeTemporalRefs([ref]), []);
      }
      assert.deepEqual(extractTemporalAnchors("1164年迁居邢州。", { anchorGameDate: "1170.1.1", messageId: null }), []);
      assert.deepEqual(extractTemporalAnchors("1164年迁居邢州。", { anchorGameDate: "1170.1.1", legacySource: {
        memoryId: "legacy-year", fragmentId: "proof", sourceHash: "missing-proof" } }), []);
      const unsupported = fixture();
      const source = unsupported.base.saveMemory({ memoryId: "unsupported", content: "旧日迁居邢州。", eventDate: "1170.1.1",
        updatedBy: "user", knownBy: [2], subjects: [1], provenance: { campaignToken: unsupported.scope.campaignToken,
          folderOwnerId: 2, extractionMode: "user_edited_summary" } });
      unsupported.base.loadFolderSummariesForCharacter = () => [source];
      unsupported.coordinator.configureDerived({ requestExtraction: async prompt => {
        const fragment = JSON.parse(prompt[1].content).fragments[0];
        return JSON.stringify({ status: "STORE", entries: [{ memoryType: "MAJOR_EXPERIENCE", text: fragment.text,
          fragmentIds: [fragment.fragmentId], eventTime: { from: "1164.1.1", to: "1164.12.31", precision: "year", status: "reported" } }] });
      } });
      assert.equal((await unsupported.coordinator.recompressLegacy(unsupported.scope, { memoryId: source.memoryId })).reason, "memory4_unsupported_event_date");
    });
    console.log("V8.14-D lifecycle: " + checks + " PASS (deterministic fixtures only)");
  } finally {
    for (let index = 0; index < 8; index++) await tick();
    assert(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch(error => { console.error(error.stack); process.exitCode = 1; });
