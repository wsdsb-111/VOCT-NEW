"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { MemoryStore } = require("../resources/app/out/main/memory-system/memory-store");
const { Memory4Coordinator } = require("../resources/app/out/main/memory-system/memory4-coordinator");
const { Memory4RecallPlanner } = require("../resources/app/out/main/memory-system/memory4-recall-planner");
const { projectVisibleTranscript, updateKnownEntities } = require("../resources/app/out/main/memory-system/memory4-visibility");
const { hash, validateEntry, legacySourceHash } = require("../resources/app/out/main/memory-system/memory4-contract");
const { normalizeGameDate } = require("../resources/app/out/main/worldline/character-temporal-facts");
const { createPromptBuilder } = require("../resources/app/out/main/prompts/prompt-builder");
const { createSummariesManager } = require("../resources/app/out/main/summaries/summaries-manager");
const { buildSummaryCatalogEntry } = require("../resources/app/out/main/memory-system/summary-catalog");
const { MemoryEngine } = require("../resources/app/out/main/memory-system/memory-engine");
const { Conversation } = require("../resources/app/out/main/conversation/conversation");
const { createMemoryRecord } = require("../resources/app/out/main/memory-system/memory-types");

const PromptBuilder = createPromptBuilder({ TemplateEngine: class {}, PromptScriptLoader: class {} });
const root = fs.mkdtempSync(path.join(os.tmpdir(), "votc-memory4-de-independent-"));
let checks = 0;
let failures = 0;
let fixtures = 0;
let sources = 0;

async function check(name, run) {
  try {
    await run();
    checks++;
    console.log(`PASS ${name}`);
  } catch (error) {
    failures++;
    console.error(`FAIL ${name}: ${error.stack || error.message}`);
  }
}

function fixture() {
  const directory = path.join(root, String(++fixtures));
  const folders = path.join(directory, "summaries");
  for (const id of [1, 2, 3, 4]) fs.mkdirSync(path.join(folders, `${id}_fixture`), { recursive: true });
  const base = new MemoryStore({ baseDir: path.join(directory, "memory"), summaryFoldersDir: folders });
  const coordinator = new Memory4Coordinator(base);
  const planner = new Memory4RecallPlanner(coordinator);
  const scope = { campaignToken: "qa-campaign", ownerId: 2 };
  const options = { ...scope, currentGameDate: "1184.8.11", currentTotalDays: normalizeGameDate("1184.8.11").serial,
    conversationId: "present-query", sceneRevision: "present-scene", turnEpoch: 1, querySpeakerId: 1,
    entityIds: [99], legacyMemories: [], memoryEngineRemainingBudget: 1200, providerRemainingSafeBudget: 1200,
    estimateTokens: text => Math.ceil(text.length / 2) };
  return { base, coordinator, planner, scope, options };
}

function addSource(sample, { date = "1170.1.1", text = "玩家讲述九十九号人物的经历。", entityIds = [99],
  ownerId = 2, campaignToken = sample.scope.campaignToken, speakerId = 1, eventTime = null,
  conversationId = `qa-source-${++sources}`, durable = false, sourceType = "spoken" } = {}) {
  const context = { campaignToken, ownerId, conversationId, finalizationId: conversationId,
    episodeId: `episode-${conversationId}`, date, totalDays: normalizeGameDate(date)?.serial || null,
    participants: [{ id: speakerId }, { id: ownerId }],
    participantPresence: [{ characterId: speakerId, joinedAtMessageId: 0 }, { characterId: ownerId, joinedAtMessageId: 0 }],
    messages: [{ id: 1, role: "user", speakerCharacterId: speakerId, content: text,
      memory4Fragments: [{ start: 0, end: text.length, visibility: "participants", sourceType,
        recipientIds: [ownerId], entityIds }] }] };
  const snapshot = { ...context, ...projectVisibleTranscript(context, ownerId), counterpartIds: [speakerId] };
  const result = sample.coordinator.store.commitOwner(snapshot, { status: durable ? "STORE" : "NO_DURABLE_CONTENT",
    entries: durable ? [{ memoryType: "MAJOR_EXPERIENCE", text, fragmentIds: [snapshot.fragments[0].fragmentId],
      entityIds, participantIds: [speakerId, ownerId], topics: ["经历"], eventTime: eventTime || { status: "unknown" } }] : [] });
  return { snapshot, entryId: result.entryIds[0] || null };
}

function identityFixture() {
  const player = { id: 1, shortName: "玩家", fullName: "后台真名", parents: [], children: [], siblings: [] };
  const npc = { id: 2, shortName: "回应者", parents: [], children: [], siblings: [],
    relationsToPlayer: [], relationsToCharacters: [] };
  return { player, npc, data: { playerID: 1, characters: new Map([[1, player], [2, npc]]) } };
}

function identityEvidence(sample) {
  return PromptBuilder.buildPlayerIdentityKnowledge(sample.npc, sample.data).match(/身份识别关系证据：([^。]+)/)[1];
}

function addEvent(sample, { year = 1164, text = `${year}年九十九号人物迁居。`, ...options } = {}) {
  return addSource(sample, { text, durable: true, eventTime: { from: `${year}.1.1`, to: `${year}.12.31`,
    precision: "year", status: "reported" }, ...options });
}

function rewriteEntry(sample, entryId, change) {
  const index = sample.coordinator.store.loadIndex(sample.scope);
  const entry = sample.coordinator.store.readEntry(sample.scope, entryId, index);
  change(entry);
  const directory = sample.coordinator.store.directory(sample.scope);
  sample.base.writeJson(sample.coordinator.store.entryPath(directory, entryId), entry);
  index.entries[entryId] = sample.coordinator.store.indexRow(entry);
  index.revision++;
  sample.coordinator.store.reindex(index);
  const metadata = sample.coordinator.store.read(path.join(directory, "metadata.json"));
  sample.base.writeJson(path.join(directory, "index.json"), index);
  sample.base.writeJson(path.join(directory, "metadata.json"), { ...metadata, revision: index.revision, indexHash: hash(index) });
}

function compressionPause() {
  let entered, release;
  const ready = new Promise(resolve => { entered = resolve; });
  const paused = new Promise(resolve => { release = resolve; });
  let calls = 0;
  return { ready, release,
    requestCompression: async prompt => {
      const items = JSON.parse(prompt[1].content).items;
      if (++calls === 1) { entered(); await paused; }
      return JSON.stringify({ items: [{ text: "STALE_BUILD 压缩前版本。", sourceEntryIds: items.flatMap(item => item.sourceEntryIds) }] });
    } };
}

async function waitForCompression(paused, running) {
  await Promise.race([paused.ready, running.then(result => { throw new Error(`compression never started: ${result.status}`); })]);
}

function select(sample, entryIds, query = {}) {
  return sample.coordinator.derived.selectSlice(sample.scope, { index: sample.coordinator.store.loadIndex(sample.scope),
    eligibleEntryIds: entryIds, currentGameDate: sample.options.currentGameDate, estimateTokens: sample.options.estimateTokens,
    query: { axis: "EVENT", granularity: "YEAR", entityIds: [99], window: { from: "1164.1.1", to: "1164.12.31" }, ...query } });
}

async function drainJobs() {
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
}

function management(sample) {
  const state = { responderRecallCache: new Map([[2, { stableText: "FROZEN_OWNER_2", directStableText: "FROZEN_DIRECT_2",
    seenDynamicSummaries: new Set(["old-owner-2"]), dynamicExtra: [], memory4Focus: {} }],
  [3, { stableText: "FROZEN_OWNER_3", seenDynamicSummaries: new Set(["keep-owner-3"]), memory4Focus: {} }]]),
    mentionedRecallCache: new Map([[2, {}], [3, {}]]), turnRecallCache: new Map() };
  const conversation = { id: "qa-management", isActive: true, memoryState: state,
    cacheV2FrozenSnapshots: { prefixByResponder: new Map([["2", { directMemory: "FROZEN_DIRECT_2" }],
      ["3", { directMemory: "FROZEN_DIRECT_3" }]]) },
    dynamicRecallHistory: new Map([[2, new Map([[1, { keys: ["old-owner-2"] }]])], [3, new Map([[1, { keys: ["keep-owner-3"] }]])]]),
    gameData: { campaignToken: sample.scope.campaignToken, date: sample.options.currentGameDate, playerID: 1,
      characters: new Map([1, 2, 3, 4, ...Array.from({ length: 40 }, (_, index) => index + 99)]
        .map(id => [id, { id, shortName: `人物${id}` }])) } };
  const context = { current: conversation };
  const engine = { store: sample.base, memory4: sample.coordinator, memory4Recall: sample.planner,
    pruneConversationDisclosures: MemoryEngine.prototype.pruneConversationDisclosures,
    ensureConversationState: () => state, invalidateConversationRecallState: () => {}, invalidateSummaryFolderCache: () => {} };
  const manager = createSummariesManager({ fs, path, summariesDir: sample.base.summaryFoldersDir, memoryEngine: engine,
    memorySystem: { buildSummaryCatalogEntry }, getCurrentConversation: () => context.current,
    requestSummary: async () => { throw new Error("official provider must never be called"); } });
  return { manager, conversation, context, state };
}

function populateLargeOwner(sample) {
  const index = sample.coordinator.store.loadIndex(sample.scope);
  const directory = sample.coordinator.store.directory(sample.scope);
  const knownEvidenceRevisions = {};
  let known = null;
  for (let batch = 0; batch < 125; batch++) {
    const entityIds = Array.from({ length: 8 }, (_, offset) => 99 + (batch * 8 + offset) % 40);
    const text = entityIds.map((entityId, offset) => `1164年人物${entityId}经历${batch * 8 + offset}。`).join("\n");
    const context = { ...sample.scope, conversationId: `large-${batch}`, finalizationId: `large-${batch}`, episodeId: `large-${batch}`,
      date: "1170.1.1", participants: [{ id: 1 }, { id: 2 }],
      participantPresence: [{ characterId: 1, joinedAtMessageId: 0 }, { characterId: 2, joinedAtMessageId: 0 }],
      messages: [{ id: 1, role: "user", speakerCharacterId: 1, content: text,
        memory4Fragments: [{ start: 0, end: text.length, visibility: "participants", sourceType: "spoken", recipientIds: [2], entityIds }] }] };
    const snapshot = { ...context, ...projectVisibleTranscript(context, 2), counterpartIds: [1] };
    const entryIds = entityIds.map((entityId, offset) => {
      const entry = validateEntry({ memoryType: "MAJOR_EXPERIENCE", text: `1164年人物${entityId}经历${batch * 8 + offset}。`,
        fragmentIds: [snapshot.fragments[0].fragmentId], entityIds: [entityId], participantIds: [1, 2], topics: ["经历"],
        eventTime: { from: "1164.1.1", to: "1164.12.31", precision: "year", status: "reported" } }, snapshot);
      sample.base.writeJson(sample.coordinator.store.entryPath(directory, entry.entryId), entry);
      index.entries[entry.entryId] = sample.coordinator.store.indexRow(entry);
      return entry.entryId;
    });
    index.finalizations[hash(snapshot.finalizationId)] = { status: "STORE", sourceRevision: snapshot.sourceRevision, entryIds };
    knownEvidenceRevisions[hash([snapshot.conversationId, 2])] = snapshot.sourceRevision;
    known = updateKnownEntities(known, snapshot);
  }
  index.revision = 125;
  sample.coordinator.store.reindex(index);
  sample.base.writeJson(path.join(directory, "index.json"), index);
  sample.base.writeJson(path.join(directory, "metadata.json"), { memory4SchemaVersion: 1, ...sample.scope,
    revision: index.revision, indexHash: hash(index), knownEvidenceRevisions, derivedDirty: true });
  sample.base.writeJson(path.join(directory, "known-entities.json"), known);
}

async function main() {
  await check("identity: plain negative relationship prose and opinion never authorize familiarity", () => {
    for (const value of ["陌生人", "无明确关系", "好感：90", "No relationship", "unknown", "neutral", "无", ""]) {
      const sample = identityFixture();
      sample.npc.relationsToPlayer = [value];
      assert.equal(identityEvidence(sample), "未提供", `unauthorized relationship prose: ${value}`);
    }
  });
  await check("identity: reverse negative prose and name-only relatives never authorize familiarity", () => {
    const sample = identityFixture();
    sample.player.relationsToCharacters = [{ id: 2, relations: ["陌生人", "No relationship"] }];
    sample.npc.parents = [{ id: -1, name: sample.player.fullName }];
    sample.npc.siblings = [{ id: -1, name: sample.player.fullName }];
    sample.npc.spouses = [{ id: -1, name: sample.player.fullName }];
    assert.equal(identityEvidence(sample), "未提供");
  });
  await check("identity: current encounter and high opinion do not grant the runtime name", () => {
    const sample = identityFixture();
    sample.npc.opinionOfPlayer = 100;
    const guard = PromptBuilder.buildPlayerIdentityKnowledge(sample.npc, sample.data);
    assert.equal(identityEvidence(sample), "未提供");
    assert(guard.includes("当前回合开始交谈、同场、好感数值"));
    assert(guard.includes("介绍中的化名不等于已得知后台真名"));
    assert(guard.includes("不得据此解锁整包玩家资料"));
  });
  await check("identity: explicit formal relationships and runtime parents retain recognition", () => {
    for (const relationship of ["friend", "rival", "lover"]) {
      const sample = identityFixture();
      sample.npc.relationsToPlayer = [relationship];
      assert(identityEvidence(sample).includes(relationship));
    }
    const sample = identityFixture();
    sample.npc.parents = [{ id: 1, name: sample.player.fullName, gender: "male" }];
    sample.player.children = [{ id: 2, name: sample.npc.shortName, gender: "male" }];
    assert(identityEvidence(sample).includes("父亲"));
  });
  await check("known entity: future-only zero-durable mention is UNKNOWN after a game rewind", () => {
    const sample = fixture();
    addSource(sample, { date: "1190.1.1" });
    const packet = sample.planner.plan({ ...sample.options, query: "你还记得九十九号人物吗？" });
    assert.equal(packet.items.length, 0);
    assert(packet.profileText.includes("认知 UNKNOWN"));
    assert.equal(packet.profileText.includes("MENTION_ONLY"), false);
  });
  await check("known entity: mixed past/future contributions preserve only historical counts", () => {
    const sample = fixture();
    addSource(sample, { date: "1164.3.12" });
    addSource(sample, { date: "1172.8.7" });
    addSource(sample, { date: "1190.1.1" });
    const profile = sample.coordinator.getKnownEntityProfile(sample.scope, 99, { currentGameDate: sample.options.currentGameDate });
    assert.equal(profile.recognition.level, "MENTION_ONLY");
    assert.equal(profile.recognition.mentionCount, 2);
    assert.equal(profile.recognition.firstSeen, "1164.3.12");
    assert.equal(profile.recognition.lastSeen, "1172.8.7");
  });
  await check("known entity: an undated contribution cannot prove pre-rewind acquaintance", () => {
    const sample = fixture();
    addSource(sample, { date: null });
    const profile = sample.coordinator.getKnownEntityProfile(sample.scope, 99, { currentGameDate: sample.options.currentGameDate });
    assert.equal(profile.recognition.level, "UNKNOWN");
    assert.equal(profile.recognition.mentionCount, 0);
  });
  await check("known entity: an authorized live relationship remains usable after future history is withheld", () => {
    const sample = fixture();
    addSource(sample, { date: "1190.1.1" });
    const gameData = { campaignToken: sample.scope.campaignToken, date: sample.options.currentGameDate,
      characters: new Map([[2, { id: 2, relationsToCharacters: [{ id: 99, relations: ["friend"] }] }], [99, { id: 99 }]]) };
    const profile = sample.coordinator.getKnownEntityProfile(sample.scope, 99, { gameData, currentGameDate: sample.options.currentGameDate });
    assert.equal(profile.recognition.level, "DIRECT_RELATIONSHIP");
    assert.equal(profile.recognition.mentionCount, 0);
    assert.deepEqual(profile.relationship.types, ["friend"]);
  });
  await check("known entity: past zero-durable recognition does not depend on Year or Life content", () => {
    const sample = fixture();
    addSource(sample, { date: "1164.1.1" });
    const profile = sample.coordinator.getKnownEntityProfile(sample.scope, 99, { currentGameDate: sample.options.currentGameDate });
    assert.equal(profile.recognition.level, "MENTION_ONLY");
    assert.equal(profile.recognition.mentionCount, 1);
    assert.deepEqual(profile.memoryPointers.detailIds, []);
    assert.deepEqual(profile.memoryPointers.yearKeys, []);
    assert.deepEqual(profile.memoryPointers.lifeItemIds, []);
  });
  await check("derived: Year is keyed by known event year and excludes planned or unknown event time", async () => {
    const sample = fixture();
    addEvent(sample, { year: 1154, date: "1164.1.1", text: "1154年九十九号人物曾迁居。" });
    addSource(sample, { date: "1164.1.1", text: "当时商谈了另一件事，但发生年份未知。", durable: true });
    addSource(sample, { date: "1191.1.1", text: "1190年出发 PLANNED_TIME。", durable: true,
      eventTime: { from: "1190.1.1", to: "1190.12.31", precision: "year", status: "planned" } });
    assert.equal((await sample.coordinator.derived.rebuild(sample.scope)).status, "COMPLETE");
    const views = sample.coordinator.derived.list(sample.scope);
    assert.deepEqual(views.years.map(view => view.eventYear), [1154]);
    assert(views.years[0].items[0].text.includes("1154年"));
    assert.equal(JSON.stringify(views).includes("PLANNED_TIME"), false);
    assert.equal(JSON.stringify(views).includes("发生年份未知"), false);
  });
  await check("derived: related slice withholds other entities and future-acquired facts", async () => {
    const sample = fixture();
    const target = addEvent(sample, { text: "1164年九十九号人物迁居 TARGET_ONLY。" });
    addEvent(sample, { entityIds: [100], text: "1164年一百号人物隐居 OTHER_ENTITY_SECRET。" });
    addEvent(sample, { date: "1190.1.1", text: "1164年旧事到1190年才获知 FUTURE_KNOWLEDGE。" });
    assert.equal((await sample.coordinator.derived.rebuild(sample.scope)).status, "COMPLETE");
    const slice = select(sample, [target.entryId]);
    assert(slice.memory.content.includes("TARGET_ONLY"));
    assert.equal(slice.memory.content.includes("OTHER_ENTITY_SECRET"), false);
    assert.equal(slice.memory.content.includes("FUTURE_KNOWLEDGE"), false);
    assert.equal(sample.coordinator.derived.validateRef(sample.scope, slice.sourceRef, { currentGameDate: "1160.1.1" }), false);
  });
  await check("derived: canonical edit invalidates views, profile pointers and retained history", async () => {
    const sample = fixture();
    const { entryId } = addEvent(sample, { text: "1164年迁居 EDITED_AWAY。" });
    await sample.coordinator.derived.rebuild(sample.scope);
    const slice = select(sample, [entryId]);
    assert(sample.coordinator.derived.validateRef(sample.scope, slice.sourceRef, { currentGameDate: sample.options.currentGameDate }));
    assert.deepEqual(sample.coordinator.derived.getPointers(sample.scope, 99, { currentGameDate: sample.options.currentGameDate }).yearKeys, [1164]);
    sample.coordinator.store.updateEntry(sample.scope, entryId, "1164年迁居后经用户修订 NEW_DETAIL。", { expectedRevision: 1 });
    const views = sample.coordinator.derived.list(sample.scope);
    assert(views.years[0].dirty && views.life.dirty);
    assert.equal(select(sample, [entryId]), null);
    assert.deepEqual(sample.coordinator.derived.getPointers(sample.scope, 99, { currentGameDate: sample.options.currentGameDate }).yearKeys, []);
    assert.deepEqual(sample.coordinator.derived.getPointers(sample.scope, 99, { currentGameDate: sample.options.currentGameDate }).lifeItemIds, []);
    assert.equal(sample.coordinator.derived.validateRef(sample.scope, slice.sourceRef, { currentGameDate: sample.options.currentGameDate }), false);
    assert.throws(() => sample.coordinator.store.updateEntry(sample.scope, entryId, "stale edit", { expectedRevision: 1 }), /edit_stale/);
  });
  await check("derived: keepManual retains edited text and dirty status after source mutation", async () => {
    const sample = fixture();
    const { entryId } = addEvent(sample);
    await sample.coordinator.derived.rebuild(sample.scope);
    const view = sample.coordinator.derived.list(sample.scope).years[0];
    sample.coordinator.derived.updateYear(sample.scope, { eventYear: 1164, itemId: view.items[0].itemId,
      text: "手工保留 MANUAL_TEXT。", expectedRevision: view.revision });
    sample.coordinator.store.updateEntry(sample.scope, entryId, "1164年新的来源内容。", { expectedRevision: 1 });
    const dirty = sample.coordinator.derived.list(sample.scope).years[0];
    sample.coordinator.derived.keepManual(sample.scope, { kind: "year", eventYear: 1164, expectedRevision: dirty.revision });
    const kept = sample.coordinator.derived.list(sample.scope).years[0];
    assert(kept.dirty);
    assert.equal(kept.manual.mode, "manual_override");
    assert(kept.items[0].text.includes("MANUAL_TEXT"));
    assert.equal(select(sample, [entryId]), null);
    assert.equal((await sample.coordinator.derived.rebuild(sample.scope, { kind: "year", eventYear: 1164 })).status, "MANUAL_OVERRIDE");
    assert.equal(sample.coordinator.derived.list(sample.scope).years[0].items[0].text, kept.items[0].text);
  });
  await check("derived: async compression cannot publish after the canonical source changes", async () => {
    const sample = fixture();
    const paused = compressionPause();
    sample.coordinator.configureDerived({ requestCompression: paused.requestCompression, estimateTokens: sample.options.estimateTokens });
    const { entryId } = addEvent(sample, { text: `1164年旧来源 ${"长篇经历".repeat(600)}` });
    const running = sample.coordinator.derived.rebuild(sample.scope, { kind: "year", eventYear: 1164 });
    await waitForCompression(paused, running);
    sample.coordinator.store.updateEntry(sample.scope, entryId, "1164年修订后的短来源 NEW_SOURCE。", { expectedRevision: 1 });
    paused.release();
    assert.equal((await running).status, "REQUEUED");
    await drainJobs();
    const view = sample.coordinator.derived.list(sample.scope).years[0];
    assert(view.items[0].text.includes("NEW_SOURCE"));
    assert.equal(JSON.stringify(view).includes("STALE_BUILD"), false);
  });
  await check("derived: async compression cannot overwrite a concurrent manual edit", async () => {
    const sample = fixture();
    const { entryId } = addEvent(sample);
    await sample.coordinator.derived.rebuild(sample.scope, { kind: "year", eventYear: 1164 });
    sample.coordinator.store.updateEntry(sample.scope, entryId, `1164年长来源 ${"长篇经历".repeat(600)}`, { expectedRevision: 1 });
    const paused = compressionPause();
    sample.coordinator.configureDerived({ requestCompression: paused.requestCompression, estimateTokens: sample.options.estimateTokens });
    const running = sample.coordinator.derived.rebuild(sample.scope, { kind: "year", eventYear: 1164 });
    await waitForCompression(paused, running);
    const view = sample.coordinator.derived.list(sample.scope).years[0];
    sample.coordinator.derived.updateYear(sample.scope, { eventYear: 1164, itemId: view.items[0].itemId,
      text: "并发手工编辑 MANUAL_WINS。", expectedRevision: view.revision });
    paused.release();
    assert.equal((await running).status, "REQUEUED");
    await drainJobs();
    const kept = sample.coordinator.derived.list(sample.scope).years[0];
    assert(kept.dirty && kept.manual.mode === "manual_override");
    assert(kept.items[0].text.includes("MANUAL_WINS"));
    assert.equal(JSON.stringify(kept).includes("STALE_BUILD"), false);
  });
  await check("derived: cancellation stays isolated from another owner's completed job", async () => {
    const sample = fixture();
    const paused = compressionPause();
    sample.coordinator.configureDerived({ requestCompression: paused.requestCompression, estimateTokens: sample.options.estimateTokens });
    addEvent(sample, { text: `1164年长来源 ${"长篇经历".repeat(600)}` });
    addEvent(sample, { ownerId: 3, text: "1164年三号人物的独立来源。" });
    const running = sample.coordinator.derived.rebuild(sample.scope, { kind: "year", eventYear: 1164 });
    await waitForCompression(paused, running);
    const otherScope = { ...sample.scope, ownerId: 3 };
    assert.equal((await sample.coordinator.derived.rebuild(otherScope, { kind: "year", eventYear: 1164 })).status, "COMPLETE");
    assert.equal(sample.coordinator.derived.cancel(sample.scope).cancelled, true);
    paused.release();
    assert.equal((await running).status, "CANCELLED");
    assert.deepEqual(sample.coordinator.derived.list(sample.scope).years, []);
    assert.equal(sample.coordinator.derived.list(otherScope).years.length, 1);
  });
  await check("derived: rebuilding one Life period cannot revive stale text in another period", async () => {
    const sample = fixture();
    const old = addEvent(sample, { year: 1140, text: "1140年旧迁居 STALE_OTHER_PERIOD。" });
    addEvent(sample, { year: 1150, text: "1150年另一段经历 TARGET_PERIOD。" });
    await sample.coordinator.derived.rebuild(sample.scope);
    sample.coordinator.store.updateEntry(sample.scope, old.entryId, "1140年修订迁居 CURRENT_OTHER_PERIOD。", { expectedRevision: 1 });
    await sample.coordinator.derived.rebuild(sample.scope, { kind: "year", eventYear: 1140 });
    await sample.coordinator.derived.rebuild(sample.scope, { kind: "life", segmentId: "life_1150s" });
    const slice = select(sample, [old.entryId], { granularity: "LIFE", window: { from: "1140.1.1", to: "1149.12.31" } });
    assert.equal(slice?.memory.content.includes("STALE_OTHER_PERIOD") || false, false);
    if (slice) assert(slice.memory.content.includes("CURRENT_OTHER_PERIOD"));
  });
  await check("derived: tombstones cannot return through Year, Life or a new background rebuild", async () => {
    const sample = fixture();
    const { entryId } = addEvent(sample, { text: "1164年应被删除 DELETED_FACT。" });
    await sample.coordinator.derived.rebuild(sample.scope);
    const slice = select(sample, [entryId]);
    sample.coordinator.store.deleteEntry(sample.scope, entryId, { expectedRevision: 1 });
    assert.equal(sample.coordinator.derived.validateRef(sample.scope, slice.sourceRef, { currentGameDate: sample.options.currentGameDate }), false);
    await sample.coordinator.derived.rebuild(sample.scope);
    assert.equal(select(sample, [entryId]), null);
    assert.equal(JSON.stringify(sample.coordinator.derived.list(sample.scope)).includes("DELETED_FACT"), false);
    assert.equal(sample.coordinator.store.readEntry(sample.scope, entryId).deleted, true);
  });
  await check("derived: source visibility revision changes invalidate overview even when body is unchanged", async () => {
    const sample = fixture();
    const source = addEvent(sample);
    await sample.coordinator.derived.rebuild(sample.scope);
    const slice = select(sample, [source.entryId]);
    sample.coordinator.store.recordKnownEvidence({ ...source.snapshot, sourceRevision: "new-visible-source-revision", fragments: [], interactionEvidence: [] });
    assert.equal(select(sample, [source.entryId]), null);
    assert.equal(sample.coordinator.derived.validateRef(sample.scope, slice.sourceRef, { currentGameDate: sample.options.currentGameDate }), false);
    assert.deepEqual(sample.coordinator.derived.getPointers(sample.scope, 99, { currentGameDate: sample.options.currentGameDate }).yearKeys, []);
  });
  await check("derived: old Legacy conversions without source hashes never become authoritative views", async () => {
    const sample = fixture();
    const { entryId } = addEvent(sample, { text: "1164年旧格式转换 UNPROVEN_LEGACY_COPY。" });
    rewriteEntry(sample, entryId, entry => { entry.source.legacyMemoryIds = ["legacy-without-proof"]; entry.source.legacyRefs = []; });
    await sample.coordinator.derived.rebuild(sample.scope);
    assert.equal(select(sample, [entryId]), null);
    assert.equal(JSON.stringify(sample.coordinator.derived.list(sample.scope)).includes("UNPROVEN_LEGACY_COPY"), false);
  });
  await check("derived: source body mismatch fails closed before history or overview reuse", async () => {
    const sample = fixture();
    const { entryId } = addEvent(sample);
    await sample.coordinator.derived.rebuild(sample.scope);
    const slice = select(sample, [entryId]);
    const entry = sample.coordinator.store.readEntry(sample.scope, entryId);
    sample.base.writeJson(sample.coordinator.store.entryPath(sample.coordinator.store.directory(sample.scope), entryId), { ...entry, text: "unindexed source corruption" });
    let historyValid = false, selected = null;
    try { historyValid = sample.coordinator.derived.validateRef(sample.scope, slice.sourceRef, { currentGameDate: sample.options.currentGameDate }); } catch {}
    try { selected = select(sample, [entryId]); } catch {}
    assert.equal(historyValid, false);
    assert.equal(selected, null);
  });
  await check("derived: scope DTO never persists or returns UI context, game data or messages", async () => {
    const sample = fixture();
    addEvent(sample);
    const oversizedScope = { ...sample.scope, conversation: { messages: [{ content: "PRIVATE_CONVERSATION_SENTINEL" }] },
      gameData: { playerName: "PRIVATE_GAME_DATA_SENTINEL", provider: { apiKey: "FIXTURE_SECRET_SENTINEL" } },
      sourcePrompt: "PRIVATE_SOURCE_PROMPT_SENTINEL" };
    assert.equal((await sample.coordinator.derived.rebuild(oversizedScope)).status, "COMPLETE");
    const listed = sample.coordinator.derived.list(oversizedScope);
    const diskYear = sample.coordinator.derived.read(sample.scope, "year", 1164);
    const diskLife = sample.coordinator.derived.read(sample.scope, "life");
    for (const record of [listed, diskYear, diskLife]) {
      assert.equal(Object.hasOwn(record, "conversation"), false);
      assert.equal(Object.hasOwn(record, "gameData"), false);
      assert.equal(Object.hasOwn(record, "sourcePrompt"), false);
      assert.equal(JSON.stringify(record).includes("PRIVATE_"), false);
      assert.equal(JSON.stringify(record).includes("FIXTURE_SECRET_SENTINEL"), false);
    }
  });
  await check("derived: Year and Life preserve rumor knowledge labels around plain source assertions", async () => {
    const sample = fixture();
    const { entryId } = addEvent(sample, { text: "1164年九十九号人物已死。" });
    rewriteEntry(sample, entryId, entry => { entry.evidence.sourceType = "rumor"; });
    await sample.coordinator.derived.rebuild(sample.scope);
    const year = select(sample, [entryId]);
    const life = select(sample, [entryId], { granularity: "LIFE", window: null });
    for (const slice of [year, life]) {
      assert(slice);
      assert(/rumor|传闻/i.test(`${slice.annotation}\n${slice.memory.content}`), "a derived slice must retain rumor epistemic status");
      assert.equal(slice.memory.content.includes("CK3已确认"), false);
    }
  });
  await check("derived: compressor receives canonical rumor status even without uncertainty words in the body", async () => {
    const sample = fixture();
    const { entryId } = addEvent(sample, { text: `1164年九十九号人物已死。${"旧事细节。".repeat(600)}` });
    rewriteEntry(sample, entryId, entry => { entry.evidence.sourceType = "rumor"; });
    const inputEvidence = [];
    sample.coordinator.configureDerived({ estimateTokens: sample.options.estimateTokens, requestCompression: async prompt => {
      const items = JSON.parse(prompt[1].content).items;
      inputEvidence.push(...items.flatMap(item => item.evidence || []));
      return JSON.stringify({ items: [{ text: "1164年九十九号人物已死。", sourceEntryIds: [entryId] }] });
    } });
    assert.equal((await sample.coordinator.derived.rebuild(sample.scope)).status, "COMPLETE");
    assert(inputEvidence.some(evidence => evidence.sourceEntryId === entryId
      && evidence.sourceType === "rumor" && evidence.epistemicStatus === "reported"));
    assert(/rumor|传闻/i.test(select(sample, [entryId]).memory.content));
  });
  await check("diagnostics: source bodies, prompts and query text never enter D/E recall traces", async () => {
    const sample = fixture();
    const events = [];
    sample.coordinator.trace = { record: (stage, details) => events.push({ stage, details }) };
    addEvent(sample, { text: "1164年九十九号人物经历 SOURCE_BODY_PRIVATE_SENTINEL。" });
    await sample.coordinator.derived.rebuild(sample.scope);
    sample.planner.plan({ ...sample.options, query: "1164年发生了什么？QUERY_PRIVATE_SENTINEL" });
    assert(events.some(event => event.stage === "memory4_derived"));
    assert(events.some(event => event.stage === "memory4_recall"));
    const serialized = JSON.stringify(events);
    for (const marker of ["SOURCE_BODY_PRIVATE_SENTINEL", "QUERY_PRIVATE_SENTINEL", "Return JSON only", "Compress this owner"]) {
      assert.equal(serialized.includes(marker), false);
    }
  });
  await check("management: stale campaigns, inactive sessions and duplicate owners fail closed", async () => {
    const sample = fixture();
    const { entryId } = addEvent(sample);
    const { manager, context, conversation } = management(sample);
    const request = { ownerId: 2, expectedCampaignToken: sample.scope.campaignToken, entryId };
    assert.equal((await manager.getMemory4Entry(request)).entry.entryId, entryId);
    await assert.rejects(manager.getMemory4Entry({ ...request, expectedCampaignToken: "other-campaign" }), /campaign_changed/);
    await assert.rejects(manager.getMemory4Entry({ ...request, ownerId: 3 }), /index_body_mismatch/);
    conversation.isActive = false;
    const archivedEntry = await manager.getMemory4Entry(request);
    assert.equal(archivedEntry.readOnlyArchive, true);
    await assert.rejects(manager.mutateMemory4({ ...request, operation: "deleteDetail", expectedRevision: 1 }), /conversation_not_active/);
    conversation.isActive = true;
    conversation.gameData.characters.set("duplicate", { id: 2 });
    await assert.rejects(manager.getMemory4Entry(request), /owner_not_unique_in_current_campaign/);
    context.current = null;
    await assert.rejects(manager.getMemory4Entry(request), /conversation_not_active/);
  });
  await check("management: canonical mutation clears its owner's frozen and dynamic memory, preserving other owners", async () => {
    const sample = fixture();
    const { entryId } = addEvent(sample);
    const { manager, conversation, state } = management(sample);
    const result = await manager.mutateMemory4({ ownerId: 2, expectedCampaignToken: sample.scope.campaignToken,
      operation: "updateDetail", entryId, expectedRevision: 1, text: "1164年手工修订。" });
    assert(result.success);
    assert.equal(state.responderRecallCache.has(2), false);
    assert.equal(state.mentionedRecallCache.has(2), false);
    assert.equal(conversation.cacheV2FrozenSnapshots.prefixByResponder.has("2"), false);
    assert.equal(conversation.cacheV2FrozenSnapshots.prefixByResponder.get("3").directMemory, "FROZEN_DIRECT_3");
    assert(state.mentionedRecallCache.has(3));
    assert.equal(conversation.dynamicRecallHistory.has(2), false);
    assert(conversation.dynamicRecallHistory.has(3));
    assert(state.responderRecallCache.get(3).seenDynamicSummaries.has("keep-owner-3"));
    await assert.rejects(manager.mutateMemory4({ ownerId: 2, expectedCampaignToken: sample.scope.campaignToken,
      operation: "updateDetail", entryId, expectedRevision: 1, text: "stale edit" }), /edit_stale/);
  });
  await check("management: every Official alias is read-only including whole-file deletion", async () => {
    for (const marker of [{ sourceType: "CK3_OFFICIAL_RECOLLECTION" }, { type: "official_recollection" }, { subtype: "official_recollection" }]) {
      const sample = fixture();
      const { manager } = management(sample);
      const file = path.join(sample.base.summaryFoldersDir, "2_fixture", "与人物1的对话.json");
      const records = [{ playerId: 2, characterId: 1, content: "普通记录。", date: "1164.1.1" },
        { playerId: 2, characterId: 1, content: "CK3只读事实。", date: "1164.1.1", ...marker }];
      sample.base.writeJson(file, records);
      const bytes = fs.readFileSync(file);
      for (const result of [await manager.updateSummary(2, 1, 1, "changed"), await manager.deleteSummary(2, 1, 1),
        await manager.regenerateSummary(2, 1, 1, records[1].content), await manager.deleteCharacterSummaries(2, 1)]) {
        assert.equal(result.success, false);
        assert(result.error.startsWith("official_recollection_"));
        assert.deepEqual(fs.readFileSync(file), bytes);
      }
    }
  });
  await check("derived: normal detached finalization builds historical views without reading the active campaign", async () => {
    const sample = fixture();
    const source = addEvent(sample, { text: "1164年旧战役来源 DETACHED_FINALIZATION。" });
    const index = sample.coordinator.store.loadIndex(sample.scope);
    delete index.finalizations[hash(source.snapshot.finalizationId)];
    index.entries = {};
    sample.coordinator.store.reindex(index);
    const directory = sample.coordinator.store.directory(sample.scope);
    const metadata = sample.coordinator.store.read(path.join(directory, "metadata.json"));
    sample.base.writeJson(path.join(directory, "index.json"), index);
    sample.base.writeJson(path.join(directory, "metadata.json"), { ...metadata, indexHash: hash(index) });
    sample.coordinator.configureDerived({ isCampaignCurrent: () => false });
    const result = await sample.coordinator.finishOwner(source.snapshot, async () => JSON.stringify({ status: "STORE", entries: [{
      memoryType: "MAJOR_EXPERIENCE", text: source.snapshot.fragments[0].text, fragmentIds: [source.snapshot.fragments[0].fragmentId],
      entityIds: [99], eventTime: { from: "1164.1.1", to: "1164.12.31", precision: "year", status: "reported" }
    }] }));
    assert.equal(result.status, "STORE");
    await drainJobs();
    const views = sample.coordinator.derived.list(sample.scope);
    assert.equal(views.years.length, 1);
    assert(views.life.segments[0].text.includes("DETACHED_FINALIZATION"));
    assert.deepEqual(sample.coordinator.derived.list({ ...sample.scope, campaignToken: "other-campaign" }).years, []);
  });
  await check("lazy: only successfully injected Legacy evidence queues recompression", () => {
    const sample = fixture();
    const engine = new MemoryEngine({ store: sample.base, trace: { record() {} } });
    const state = engine.createConversationState("qa-lazy-retention");
    const memory = createMemoryRecord({ memoryId: "legacy-lazy-hit", type: "folder_summary", content: "旧摘要真实注入内容。",
      eventDate: "1164.1.1", knownBy: [2], subjects: [99], provenance: { ...sample.scope, folderOwnerId: 2 } });
    const entry = { memory, tokens: 20 };
    const ref = { kind: "legacy", id: memory.memoryId, parentId: memory.memoryId, bodyHash: "qa-parent-proof" };
    state.responderRecallCache.set(2, { dynamicTurn: 1, dynamicExtra: [entry], seenDynamicSummaries: new Set(),
      memory4Packet: { items: [entry], sourceRefs: [ref], focus: null } });
    const queued = [];
    engine.memory4.queueLegacyRecompression = (scope, request) => { queued.push({ scope, request }); };
    const conversation = Object.create(Conversation.prototype);
    conversation.id = "qa-lazy-retention";
    conversation.gameData = { campaignToken: sample.scope.campaignToken };
    conversation.memoryState = state;
    Conversation.configure({ memoryEngine: engine, TokenCounter: { estimateTokens: sample.options.estimateTokens } });
    assert.equal(queued.length, 0);
    assert.equal(engine.commitDynamicSummaryRecall(2, state.responderRecallCache, 1, { providerSucceeded: false,
      injectedBlockIds: ["memory-temporal-extra"], injectedMemoryIds: [memory.memoryId], injectedTokens: 20 }).committedCount, 0);
    assert.equal(queued.length, 0);
    conversation.retainDynamicSummaryRecall(2, 1, { blocks: [{ block: { id: "memory-temporal-extra" },
      content: "budget removed the selected ID", tokens: 20 }] }, 1);
    assert.equal(queued.length, 0);
    conversation.retainDynamicSummaryRecall(2, 2, { blocks: [{ block: { id: "memory-temporal-extra" },
      content: `${memory.memoryId}\n${memory.content}`, tokens: 20 }] }, 1);
    assert.equal(queued.length, 1);
    assert.deepEqual(queued[0].scope, sample.scope);
    assert.deepEqual(queued[0].request.sourceRefs, [ref]);
    assert(state.responderRecallCache.get(2).seenDynamicSummaries.has(engine.getRouteMemoryKey(memory)));
  });
  await check("lazy: partial conversion preserves other facts and a tombstone never converts the deleted fact again", async () => {
    const sample = fixture();
    const facts = ["A", "B", "C", "D", "E"].map(label => sample.base.saveMemory({ memoryId: `legacy-fact-${label}`,
      type: "information", content: `1164年九十九号人物事件${label}。`, knownBy: [2], subjects: [99], updatedBy: "user",
      provenance: { campaignToken: sample.scope.campaignToken, folderOwnerId: 2, speakerIds: [2] } }));
    const parent = createMemoryRecord({ memoryId: "legacy-five-facts", type: "folder_summary", eventDate: "1170.1.1",
      content: `【回应者能够知道并记住的本场内容】\n${facts.map(fact => `- ${fact.content}`).join("\n")}`,
      knownBy: [2], subjects: [99], provenance: { campaignToken: sample.scope.campaignToken, folderOwnerId: 2,
        perspectiveMemoryIds: facts.map(fact => fact.memoryId) } });
    const before = JSON.stringify(parent);
    sample.base.loadFolderSummariesForCharacter = () => [parent];
    const offered = [];
    sample.coordinator.configureDerived({ isCampaignCurrent: () => true, requestExtraction: async prompt => {
      const fragments = JSON.parse(prompt[1].content).fragments;
      offered.push(fragments.map(fragment => fragment.text));
      const target = fragments.find(fragment => fragment.text === facts[2].content);
      return JSON.stringify({ status: target ? "STORE" : "NO_DURABLE_CONTENT", entries: target ? [{ memoryType: "MAJOR_EXPERIENCE",
        text: target.text, fragmentIds: [target.fragmentId], entityIds: [99],
        eventTime: { from: "1164.1.1", to: "1164.12.31", precision: "year", status: "reported" } }] : [] });
    } });
    const converted = await sample.coordinator.recompressLegacy(sample.scope, { memoryId: parent.memoryId, expectedSourceHash: legacySourceHash(parent) });
    assert.equal(converted.status, "COMPLETE", converted.reason);
    await drainJobs();
    const coverage = sample.coordinator.getLegacyCoverage(sample.scope, [parent]).items[0];
    assert.equal(coverage.suppressedFacts, 1);
    assert.equal(coverage.retainedFacts, 4);
    assert(coverage.partial && coverage.eligible);
    const remaining = sample.planner.legacyCandidates([parent], sample.scope, sample.coordinator.store.loadIndex(sample.scope));
    assert.equal(remaining.length, 4);
    assert.equal(remaining.some(memory => memory.content === facts[2].content), false);
    sample.coordinator.store.deleteEntry(sample.scope, converted.entryIds[0], { expectedRevision: 1 });
    await sample.coordinator.recompressLegacy(sample.scope, { memoryId: parent.memoryId });
    assert.equal(offered[1].includes(facts[2].content), false);
    assert(sample.coordinator.store.readEntry(sample.scope, converted.entryIds[0]).deleted);
    assert.equal(sample.coordinator.getLegacyCoverage(sample.scope, [parent]).items[0].retainedFacts, 4);
    assert.equal(JSON.stringify(parent), before);
  });
  await check("lazy: Legacy source edit withdraws derived overview, coverage and retained history", async () => {
    const sample = fixture();
    const source = sample.base.saveMemory({ memoryId: "legacy-edited-source", type: "information", content: "1164年九十九号人物迁居。",
      eventDate: "1170.1.1", knownBy: [2], subjects: [99], updatedBy: "user",
      provenance: { campaignToken: sample.scope.campaignToken, folderOwnerId: 2, extractionMode: "user_edited_summary" } });
    sample.coordinator.configureDerived({ isCampaignCurrent: () => true, requestExtraction: async prompt => {
      const fragment = JSON.parse(prompt[1].content).fragments[0];
      return JSON.stringify({ status: "STORE", entries: [{ memoryType: "MAJOR_EXPERIENCE", text: fragment.text,
        fragmentIds: [fragment.fragmentId], entityIds: [99],
        eventTime: { from: "1164.1.1", to: "1164.12.31", precision: "year", status: "reported" } }] });
    } });
    const result = await sample.coordinator.recompressLegacy(sample.scope, { memoryId: source.memoryId });
    assert.equal(result.status, "COMPLETE", result.reason);
    await drainJobs();
    const slice = select(sample, result.entryIds);
    assert(slice);
    sample.base.updateMemory(source.memoryId, { content: "1164年用户已修订另一件事。" });
    assert.equal(select(sample, result.entryIds), null);
    assert.equal(sample.coordinator.derived.validateRef(sample.scope, slice.sourceRef, { currentGameDate: sample.options.currentGameDate }), false);
    assert.equal(sample.coordinator.getLegacyCoverage(sample.scope, [sample.base.getMemory(source.memoryId)]).items[0].suppressedFacts, 0);
    sample.base.deleteMemory(source.memoryId);
    assert.equal(select(sample, result.entryIds), null);
  });
  await check("lazy: relative event time uses original source acquisition date, not the current runtime", async () => {
    const sample = fixture();
    const source = sample.base.saveMemory({ memoryId: "legacy-relative-source", content: "十年前九十九号人物迁居。",
      eventDate: "1170.1.1", knownBy: [2], subjects: [99], updatedBy: "user",
      provenance: { campaignToken: sample.scope.campaignToken, folderOwnerId: 2, extractionMode: "user_edited_summary" } });
    sample.coordinator.configureDerived({ isCampaignCurrent: () => true, requestExtraction: async prompt => {
      const input = JSON.parse(prompt[1].content), fragment = input.fragments[0];
      assert.equal(input.conversationDate, "1170.1.1");
      return JSON.stringify({ status: "STORE", entries: [{ memoryType: "MAJOR_EXPERIENCE", text: fragment.text,
        fragmentIds: [fragment.fragmentId], entityIds: [99],
        eventTime: { from: "1160.1.1", to: "1160.12.31", precision: "year", status: "reported" } }] });
    } });
    const result = await sample.coordinator.recompressLegacy(sample.scope, { memoryId: source.memoryId });
    assert.equal(result.status, "COMPLETE", result.reason);
    const entry = sample.coordinator.store.readEntry(sample.scope, result.entryIds[0]);
    assert.equal(entry.eventTime.from, "1160.1.1");
    assert.equal(entry.acquiredDate, "1170.1.1");
    assert.deepEqual(entry.source.messageIds, []);
    assert(entry.temporalRefs.some(ref => ref.fromGameDate === "1160.1.1"));
    await drainJobs();
  });
  await check("lazy: unsupported guessed event years remain Legacy without a derived view", async () => {
    const sample = fixture();
    const source = sample.base.saveMemory({ memoryId: "legacy-guessed-date", content: "1164年九十九号人物迁居。",
      eventDate: "1170.1.1", knownBy: [2], subjects: [99], updatedBy: "user",
      provenance: { campaignToken: sample.scope.campaignToken, folderOwnerId: 2, extractionMode: "user_edited_summary" } });
    const sourceFile = sample.base.memoryPath(source.memoryId);
    const original = fs.readFileSync(sourceFile);
    sample.coordinator.configureDerived({ isCampaignCurrent: () => true, requestExtraction: async prompt => {
      const fragment = JSON.parse(prompt[1].content).fragments[0];
      return JSON.stringify({ status: "STORE", entries: [{ memoryType: "MAJOR_EXPERIENCE", text: fragment.text,
        fragmentIds: [fragment.fragmentId], entityIds: [99],
        eventTime: { from: "1165.1.1", to: "1165.12.31", precision: "year", status: "reported" } }] });
    } });
    const result = await sample.coordinator.recompressLegacy(sample.scope, { memoryId: source.memoryId });
    assert.equal(result.status, "EXTRACTION_FAILED");
    assert.equal(result.reason, "memory4_unsupported_event_date");
    assert.deepEqual(result.entryIds, []);
    assert.deepEqual(sample.coordinator.derived.list(sample.scope).years, []);
    assert.equal(sample.coordinator.getLegacyCoverage(sample.scope, [source]).items[0].suppressedFacts, 0);
    assert.deepEqual(fs.readFileSync(sourceFile), original);
  });
  await check("lazy: source hash changed during extraction never publishes an old converted fact", async () => {
    const sample = fixture();
    const source = sample.base.saveMemory({ memoryId: "legacy-async-edit", content: "1164年九十九号人物迁居。",
      eventDate: "1170.1.1", knownBy: [2], subjects: [99], updatedBy: "user",
      provenance: { campaignToken: sample.scope.campaignToken, folderOwnerId: 2, extractionMode: "user_edited_summary" } });
    let entered, release;
    const ready = new Promise(resolve => { entered = resolve; });
    const paused = new Promise(resolve => { release = resolve; });
    sample.coordinator.configureDerived({ isCampaignCurrent: () => true, requestExtraction: async prompt => {
      const fragment = JSON.parse(prompt[1].content).fragments[0];
      entered(); await paused;
      return JSON.stringify({ status: "STORE", entries: [{ memoryType: "MAJOR_EXPERIENCE", text: fragment.text,
        fragmentIds: [fragment.fragmentId], entityIds: [99] }] });
    } });
    const running = sample.coordinator.recompressLegacy(sample.scope, { memoryId: source.memoryId });
    await ready;
    sample.base.updateMemory(source.memoryId, { content: "1164年来源已经手工修订。" });
    release();
    assert.equal((await running).status, "STALE");
    assert.deepEqual(Object.keys(sample.coordinator.store.loadIndex(sample.scope).entries), []);
    assert.equal((await sample.coordinator.recompressLegacy(sample.scope, { memoryId: source.memoryId,
      expectedSourceHash: legacySourceHash(source) })).status, "STALE");
  });
  await check("management: renderer cannot forge detached-finalization permission for a changing campaign", async () => {
    const sample = fixture();
    const { manager, conversation } = management(sample);
    const paused = compressionPause();
    sample.coordinator.configureDerived({ requestCompression: paused.requestCompression, estimateTokens: sample.options.estimateTokens,
      isCampaignCurrent: token => conversation.gameData.campaignToken === token });
    addEvent(sample, { text: `1164年长来源 ${"长篇经历".repeat(600)}` });
    const running = manager.mutateMemory4({ ownerId: 2, expectedCampaignToken: sample.scope.campaignToken, operation: "rebuild",
      kind: "year", eventYear: 1164, overwriteManual: false, expectedRevision: 0, committedFinalization: true });
    await waitForCompression(paused, running);
    conversation.gameData.campaignToken = "new-campaign";
    paused.release();
    await assert.rejects(running, /campaign_changed/);
    assert.deepEqual(sample.coordinator.derived.list(sample.scope).years, []);
  });
  await check("performance: 1000 canonical bodies plus real Year/Life keep recall reads bounded", async () => {
    const sample = fixture();
    populateLargeOwner(sample);
    sample.coordinator.configureDerived({ estimateTokens: sample.options.estimateTokens, isCampaignCurrent: () => true,
      requestCompression: async prompt => {
        const grouped = new Map();
        for (const item of JSON.parse(prompt[1].content).items) {
          const entityId = item.entityIds[0];
          if (!grouped.has(entityId)) grouped.set(entityId, []);
          grouped.get(entityId).push(...item.sourceEntryIds);
        }
        return JSON.stringify({ items: [...grouped].map(([entityId, sourceEntryIds]) => ({
          text: `1164年人物${entityId}有重要经历。`, sourceEntryIds })) });
      } });
    assert.equal((await sample.coordinator.derived.rebuild(sample.scope)).status, "COMPLETE");
    assert(sample.coordinator.derived.list(sample.scope).life.segments.length);
    const originalRead = fs.readFileSync;
    const entriesDirectory = path.join(sample.coordinator.store.directory(sample.scope), "entries") + path.sep;
    let bodyReads = 0;
    fs.readFileSync = function(file, ...args) {
      if (typeof file === "string" && path.resolve(file).startsWith(entriesDirectory)) bodyReads++;
      return originalRead.call(this, file, ...args);
    };
    let packet;
    const started = process.hrtime.bigint();
    try { packet = sample.planner.plan({ ...sample.options, query: "1164年发生了什么？" }); }
    finally { fs.readFileSync = originalRead; }
    assert(packet.overview && ["year", "life"].includes(packet.overview.sourceRef.kind));
    assert(packet.details.length <= 2 && packet.tokens <= 1200);
    assert(bodyReads <= 32, `all selected canonical reads count: ${bodyReads}`);
    const recallMs = Number(process.hrtime.bigint() - started) / 1e6;
    const profilesStarted = process.hrtime.bigint();
    for (let id = 99; id < 139; id++) sample.coordinator.getKnownEntityProfile(sample.scope, id, { currentGameDate: sample.options.currentGameDate });
    const profile40Ms = Number(process.hrtime.bigint() - profilesStarted) / 1e6;
    const { manager } = management(sample);
    const ownerStarted = process.hrtime.bigint();
    const data = await manager.getMemory4OwnerData({ ownerId: 2, expectedCampaignToken: sample.scope.campaignToken });
    const ownerDataMs = Number(process.hrtime.bigint() - ownerStarted) / 1e6;
    assert.equal(data.detail.total, 1000);
    assert.equal(data.detail.items.length, 40);
    assert.equal(data.known.items.length, 40);
    console.log(`MEASURE memory4-1000 ${JSON.stringify({ bodyReads, recallMs: Math.round(recallMs), profile40Ms: Math.round(profile40Ms), ownerDataMs: Math.round(ownerDataMs) })}`);
  });
}

main().then(() => {
  console.log(`V8.14 D/E independent QA: ${checks} PASS, ${failures} FAIL (deterministic fixtures only)`);
  if (failures) process.exitCode = 1;
}).catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
}).finally(() => {
  const resolved = path.resolve(root);
  assert(resolved.startsWith(path.resolve(os.tmpdir()) + path.sep));
  assert(path.basename(resolved).startsWith("votc-memory4-de-independent-"));
  fs.rmSync(resolved, { recursive: true, force: true });
});
