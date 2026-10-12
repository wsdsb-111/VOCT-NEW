"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const appRoot = process.env.VOTC_V923_TEST_SOURCE_ROOT || path.resolve(__dirname, "../src/app");
const appPackagePath = path.resolve(appRoot, "main", "../../package.json");
if (!fs.existsSync(appPackagePath)) {
  const resolveFilename = Module._resolveFilename;
  const versionFile = path.join(appRoot, "main", "version.js");
  const workspacePackage = path.resolve(__dirname, "../package.json");
  Module._resolveFilename = function(request, parent, ...args) {
    if (request === "../../package.json" && parent?.filename === versionFile) return workspacePackage;
    return resolveFilename.call(this, request, parent, ...args);
  };
}
const fromApp = (...parts) => require(path.join(appRoot, ...parts));
const { MemoryStore } = fromApp("main", "memory-system", "memory-store");
const { Memory4Coordinator } = fromApp("main", "memory-system", "memory4-coordinator");
const { Memory4RecallPlanner } = fromApp("main", "memory-system", "memory4-recall-planner");
const { createMemoryRecord } = fromApp("main", "memory-system", "memory-types");
const { hash } = fromApp("main", "memory-system", "memory4-contract");
const { normalizeGameDate } = fromApp("main", "worldline", "character-temporal-facts");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v923-derived-retirement-"));
const estimateTokens = text => Math.ceil(String(text).length / 2);
let checks = 0, failures = 0, sequence = 0;

async function check(name, run) {
  try {
    await run();
    checks++;
    console.log("PASS " + name);
  } catch (error) {
    failures++;
    console.error("FAIL " + name + ": " + (error.stack || error.message));
  }
}

function fixture(name = "fixture") {
  const directory = path.join(root, `${name}-${++sequence}`);
  const summaryFoldersDir = path.join(directory, "summaries");
  for (const id of [1, 2, 3, 4]) fs.mkdirSync(path.join(summaryFoldersDir, `${id}_fixture`), { recursive: true });
  const base = new MemoryStore({ baseDir: path.join(directory, "memory"), summaryFoldersDir });
  const coordinator = new Memory4Coordinator(base);
  const derivedCalls = [];
  coordinator.configureDerived({ isCampaignCurrent: () => true, estimateTokens,
    requestCompression: async (_prompt, options) => {
      derivedCalls.push(options.requestType || "UNKNOWN");
      throw new Error("qa_derived_llm_sentinel");
    } });
  return { base, coordinator, directory, summaryFoldersDir, derivedCalls };
}

function contextFor({ campaignToken, conversationId, date, participants = [1, 2], messages }) {
  return { campaignToken, conversationId, finalizationId: `${conversationId}-final`, episodeId: `${conversationId}-episode`,
    date, totalDays: normalizeGameDate(date).serial, participants: participants.map(id => ({ id, name: `人物${id}` })),
    participantPresence: participants.map(characterId => ({ characterId, joinedAtMessageId: 0, leftAtMessageId: null })), messages };
}

function durableResponse(prompt) {
  const payload = JSON.parse(prompt[1].content);
  const entries = payload.fragments.map(fragment => ({ memoryType: "MAJOR_EXPERIENCE", text: fragment.text,
    fragmentIds: [fragment.fragmentId], entityIds: fragment.entityIds, participantIds: fragment.participantIds,
    topics: ["合成经历"], eventTime: { status: "unknown" } }));
  return { content: JSON.stringify({ status: entries.length ? "STORE" : "NO_DURABLE_CONTENT", entries }), finish_reason: "stop" };
}

function makeThreeOwnerContext() {
  const participants = [1, 2, 3];
  const messages = participants.map((ownerId, index) => {
    const content = `OWNER_${ownerId}_PRIVATE_FACT ` + `人物${ownerId}的私人记录只属于本人。`.repeat(220);
    return { id: index + 1, role: "user", speakerCharacterId: ownerId, content,
      memory4Fragments: [{ start: 0, end: content.length, visibility: "private", sourceType: "spoken", recipientIds: [], entityIds: [] }] };
  });
  return contextFor({ campaignToken: "v923-three-owner-campaign", conversationId: "v923-three-owner-finalization",
    date: "1174.1.1", participants, messages });
}

function addDetail(sample, { ownerId = 2, campaignToken = "v923-recall-campaign", date, text, memoryType = "MAJOR_EXPERIENCE",
  topics = ["粮食"], counterpartId = 1 } = {}) {
  const conversationId = `v923-detail-${++sequence}`;
  const content = text || `人物${counterpartId}留下了一段可追溯的个人记录。`;
  const context = contextFor({ campaignToken, conversationId, date, participants: [1, ownerId], messages: [{ id: 1, role: "user",
    speakerCharacterId: ownerId, content, memory4Fragments: [{ start: 0, end: content.length, visibility: "private",
      sourceType: "spoken", recipientIds: [], entityIds: [counterpartId] }] }] });
  const snapshot = sample.coordinator.buildOwnerSnapshot(context, ownerId);
  const fragment = snapshot.fragments[0];
  const committed = sample.coordinator.store.commitOwner(snapshot, { status: "STORE", entries: [{ memoryType, text: content,
    fragmentIds: [fragment.fragmentId], entityIds: [counterpartId], participantIds: fragment.presentIds,
    topics, eventTime: { status: "unknown" } }] });
  return { scope: { campaignToken, ownerId }, snapshot, entryId: committed.entryIds[0], conversationId, content };
}

function installLegalYearView(sample, scope, eventYear, { itemText = "预先存在的合法年度视图片段。", itemId = `fixture-${eventYear}` } = {}) {
  const derived = sample.coordinator.derived;
  const index = sample.coordinator.store.loadIndex(scope);
  const snapshot = derived.snapshot(scope, { eventYear }, index);
  assert(snapshot.entryIds.length > 0, "fixture must have a source in the requested acquisition year");
  const sources = snapshot.entryIds.map(id => sample.coordinator.store.readEntry(scope, id, index));
  const view = { memory4SchemaVersion: 1, ...scope, eventYear, revision: 1, dirty: false, generationMode: "auto",
    sourceRevisionSet: snapshot.sourceRevisionSet, sourceHash: snapshot.sourceHash,
    items: [{ itemId, text: itemText, sourceEntryIds: snapshot.entryIds, entityIds: [...new Set(sources.flatMap(entry => entry.entityIds))],
      topics: [...new Set(sources.flatMap(entry => entry.topics))], importance: Math.max(...sources.map(entry => entry.importance)),
      timeAxis: "acquired" }],
    manual: { mode: "auto", editedAt: null }, tokens: estimateTokens(itemText) };
  sample.base.writeJson(derived.file(scope, "year", eventYear), view);
  return view;
}

function installLegalLifeView(sample, scope, yearView) {
  const derived = sample.coordinator.derived;
  const index = sample.coordinator.store.loadIndex(scope);
  const fromYear = Math.floor(yearView.eventYear / 10) * 10;
  const period = { fromYear, toYear: fromYear + 9 };
  const source = derived.snapshot(scope, { period }, index);
  const all = derived.snapshot(scope, {}, index);
  const segment = { segmentId: `life_${fromYear}s`, period, text: yearView.items.map(item => item.text).join("\n"),
    sourceYearItemIds: yearView.items.map(item => `${yearView.eventYear}:${item.itemId}`),
    sourceEntryIds: source.entryIds, entityIds: [...new Set(yearView.items.flatMap(item => item.entityIds))],
    topics: [...new Set(yearView.items.flatMap(item => item.topics))], items: yearView.items,
    sourceRevisionSet: source.sourceRevisionSet, sourceHash: source.sourceHash,
    sourceYears: [{ eventYear: yearView.eventYear, viewHash: hash(yearView) }], manual: { mode: "auto", editedAt: null } };
  const years = derived.list(scope).years;
  const view = { memory4SchemaVersion: 1, ...scope, revision: 1, dirty: false,
    sourceRevisionSet: all.sourceRevisionSet, sourceHash: all.sourceHash,
    yearStamp: hash(years.map(item => [item.eventYear, item.revision, item.sourceHash, item.items])),
    segments: [segment], generationMode: "auto", manual: { mode: "auto", editedAt: null } };
  sample.base.writeJson(derived.file(scope, "life"), view);
  return view;
}

async function flushImmediateQueue() {
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
}

async function main() {
  await check("DER-02: real Coordinator commits three private owner scopes and keeps Durable STORE independent from retired Derived", async () => {
    const sample = fixture("three-owner");
    const context = makeThreeOwnerContext();
    const durableCalls = [];
    const result = await sample.coordinator.finalizeCommitted(context, async (prompt, options) => {
      durableCalls.push(options.ownerId);
      return durableResponse(prompt);
    }, { isNarrativeCommitted: true, isCurrent: () => true });

    assert.equal(result.owners.length, 3);
    assert.deepEqual([...durableCalls].sort((a, b) => a - b), [1, 2, 3]);
    const ownerOutcomes = [];
    for (const ownerId of [1, 2, 3]) {
      const scope = { campaignToken: context.campaignToken, ownerId };
      const index = sample.coordinator.store.loadIndex(scope);
      const entries = Object.entries(index.entries).filter(([, row]) => !row.deleted);
      assert.equal(entries.length, 1, `owner ${ownerId} has one committed private fact`);
      const entry = sample.coordinator.store.readEntry(scope, entries[0][0], index);
      assert.deepEqual(entry.evidence.knownBy, [ownerId]);
      assert(entry.text.includes(`OWNER_${ownerId}_PRIVATE_FACT`));
      assert.equal(index.finalizations[hash(context.finalizationId)].status, "STORE");
      ownerOutcomes.push(result.owners.find(item => item.ownerId === ownerId));
    }
    assert(ownerOutcomes.every(item => item.status === "STORE" && item.durableStatus === "STORE"),
      "Coordinator outcomes must preserve the actual Durable commit status");
    assert(ownerOutcomes.every(item => item.derivedGenerationStatus === "SKIPPED_DERIVED_POLICY"
      && item.derived?.status === "SKIPPED_DERIVED_POLICY"));
    assert.equal(result.status, "COMPLETE");
    assert.deepEqual(sample.derivedCalls, [], "no Derived provider request is permitted after the three real Store commits");
  });

  await check("DER-01: one-owner Finalization commits Durable Detail without Year/Life requests", async () => {
    const sample = fixture("single-owner-finalization");
    const content = "单人会话中的合成耐久事实。".repeat(500);
    const context = contextFor({ campaignToken: "v923-single-owner-campaign", conversationId: "v923-single-owner-finalization",
      date: "1174.1.1", participants: [2], messages: [{ id: 1, role: "user", speakerCharacterId: 2, content,
        memory4Fragments: [{ start: 0, end: content.length, visibility: "private", sourceType: "spoken", recipientIds: [], entityIds: [] }] }] });
    const calls = [];
    const result = await sample.coordinator.finalizeCommitted(context, async (prompt, options) => {
      calls.push(options.ownerId);
      return durableResponse(prompt);
    }, { isNarrativeCommitted: true, isCurrent: () => true });
    const scope = { campaignToken: context.campaignToken, ownerId: 2 };
    const index = sample.coordinator.store.loadIndex(scope);
    assert.deepEqual(calls, [2]);
    assert.equal(result.status, "COMPLETE");
    assert.equal(result.owners[0].status, "STORE");
    assert.equal(index.finalizations[hash(context.finalizationId)].status, "STORE");
    assert.equal(Object.values(index.entries).filter(row => !row.deleted).length, 1);
    assert.deepEqual(sample.derivedCalls, []);
  });

  await check("DER-15/16: direct all/year/life and scheduled old APIs return typed skip before the compression sentinel", async () => {
    const sample = fixture("direct-api");
    const detail = addDetail(sample, { date: "1169.1.1", text: "直接 API 退役门禁样本。".repeat(700) });
    const service = sample.coordinator.derived;
    const scheduled = await service.schedule(detail.snapshot, { committedFinalization: true });
    assert.equal(scheduled.status, "SKIPPED_DERIVED_POLICY");
    assert.equal(scheduled.generated, false);
    assert.equal(scheduled.providerRequests, 0);
    for (const kind of ["all", "year", "life"]) {
      const result = await service.rebuild(detail.scope, { kind, eventYear: 1169 });
      assert.equal(result.status, "SKIPPED_DERIVED_POLICY", `kind=${kind}`);
      assert.equal(result.generated, false);
      assert.equal(result.providerRequests, 0);
    }
    const directTask = { controller: new AbortController(), cancelled: false };
    const directBuilds = [];
    for (const build of [() => service.buildYear(detail.scope, 1169, directTask, {}, null),
      () => service.buildLife(detail.scope, directTask, {}, null)]) {
      try { directBuilds.push(await build()); }
      catch (error) { directBuilds.push({ status: "THREW", reason: error.message }); }
    }
    for (const result of directBuilds) {
      assert.equal(result.status, "SKIPPED_DERIVED_POLICY");
      assert.equal(result.generated, false);
      assert.equal(result.providerRequests, 0);
    }
    const policyView = service.list(detail.scope);
    assert.equal(policyView.generationPolicy, "RETIRED");
    assert.deepEqual(sample.derivedCalls, []);
  });

  await check("DER-06: active plus queued and source-changed self-requeue cannot call buildYear/buildLife or reschedule", async () => {
    const sample = fixture("queue-path");
    const detail = addDetail(sample, { date: "1169.1.1", text: "调度队列退役门禁样本。".repeat(50) });
    const service = sample.coordinator.derived;
    let buildCalls = 0;
    service.buildYear = async () => { buildCalls++; throw new Error("memory4_derived_source_changed"); };
    const key = hash([detail.scope.campaignToken, detail.scope.ownerId]);
    const task = { controller: new AbortController(), cancelled: false, queuedRequest: { kind: "life" } };
    service.active.set(key, task);
    const scheduled = await service.schedule(detail.snapshot, { committedFinalization: true });
    const queued = await service.rebuild(detail.scope, { kind: "life" });
    service.active.delete(key);
    await flushImmediateQueue();

    assert.equal(scheduled.status, "SKIPPED_DERIVED_POLICY");
    assert.equal(queued.status, "SKIPPED_DERIVED_POLICY");
    assert.equal(task.cancelled, true, "retirement must cancel a pre-existing active job");
    assert.equal(task.controller.signal.aborted, true, "retirement must abort a pre-existing compression request");
    assert.equal(buildCalls, 0, "legacy active/queued/requeued work must not enter either builder");
    assert.equal(service.active.size, 0);
    assert.deepEqual(sample.derivedCalls, []);
    const source = fs.readFileSync(path.join(appRoot, "main", "memory-system", "memory4-derived.js"), "utf8");
    assert.match(source, /!this\.isAutoGenerationRetired\(\)\s*&&\s*status === "REQUEUED"/,
      "legacy source-change self-requeue must be guarded by the retired policy");
    assert.match(source, /!this\.isAutoGenerationRetired\(\)\s*&&\s*task\.queuedRequest/,
      "legacy queued work must not drain after cancellation under the retired policy");
  });

  await check("DER-07/08/10/14: legal old Year/Life fixture stays readable, manual text survives dirty/source change, and Forget invalidates it", async () => {
    const sample = fixture("old-view");
    const detail = addDetail(sample, { date: "1169.1.1", text: "预存历史来源。" });
    const year = installLegalYearView(sample, detail.scope, 1169, { itemText: "预生成的合法年度记忆。" });
    const life = installLegalLifeView(sample, detail.scope, year);
    const yearFile = sample.coordinator.derived.file(detail.scope, "year", 1169);
    const lifeFile = sample.coordinator.derived.file(detail.scope, "life");
    const before = [fs.readFileSync(yearFile), fs.readFileSync(lifeFile)];
    const selected = sample.coordinator.derived.selectSlice(detail.scope, { query: { axis: "MEMORY_RECALL", granularity: "LIFE",
      entityIds: [1], firstMeeting: false, window: null }, index: sample.coordinator.store.loadIndex(detail.scope),
      eligibleEntryIds: [detail.entryId], currentGameDate: "1174.1.1", maxTokens: 400, estimateTokens });
    assert(selected);
    assert(selected.memory.content.includes("预生成的合法年度记忆"));
    assert.deepEqual(fs.readFileSync(yearFile), before[0], "recall must not rewrite a pre-existing Year file");
    assert.deepEqual(fs.readFileSync(lifeFile), before[1], "recall must not rewrite a pre-existing Life file");
    assert.equal(sample.coordinator.derived.validView(detail.scope, year, "year"), true);
    assert.equal(sample.coordinator.derived.validView(detail.scope, life, "life"), true);

    const edited = sample.coordinator.derived.updateYear(detail.scope, { eventYear: 1169, itemId: year.items[0].itemId,
      text: "用户手工保留的年度文字。", expectedRevision: year.revision });
    assert.equal(edited.success, true);
    const metadataFile = path.join(sample.coordinator.store.directory(detail.scope), "metadata.json");
    sample.coordinator.store.updateEntry(detail.scope, detail.entryId, "来源被修订后仍属于原 Owner。", { expectedRevision: 1 });
    sample.base.writeJson(metadataFile, { ...JSON.parse(fs.readFileSync(metadataFile, "utf8")), derivedDirty: false });
    const dirty = sample.coordinator.derived.list(detail.scope).years[0];
    assert.equal(dirty.dirty, true);
    assert.equal(dirty.items[0].text, "用户手工保留的年度文字。");
    assert.equal(JSON.parse(fs.readFileSync(metadataFile, "utf8")).derivedDirty, false,
      "a dirty file/clean metadata mismatch must remain explicit after read-only validation");
    assert.equal(sample.coordinator.derived.selectSlice(detail.scope, { query: { axis: "MEMORY_RECALL", granularity: "LIFE",
      entityIds: [1], firstMeeting: false, window: null }, index: sample.coordinator.store.loadIndex(detail.scope),
      eligibleEntryIds: [detail.entryId], currentGameDate: "1174.1.1", maxTokens: 400, estimateTokens }), null);

    sample.coordinator.store.deleteEntry(detail.scope, detail.entryId, { expectedRevision: 2 });
    assert.equal(sample.coordinator.derived.validView(detail.scope, sample.coordinator.derived.read(detail.scope, "year", 1169), "year"), false);
    assert.deepEqual(sample.derivedCalls, []);
  });

  await check("DER-08: wrong scope and stale source revision fail closed for old Derived files", async () => {
    const sample = fixture("scope-source");
    const detail = addDetail(sample, { date: "1169.1.1", text: "范围校验来源。" });
    const view = installLegalYearView(sample, detail.scope, 1169);
    const file = sample.coordinator.derived.file(detail.scope, "year", 1169);

    sample.base.writeJson(file, { ...view, campaignToken: "foreign-campaign" });
    assert.throws(() => sample.coordinator.derived.read(detail.scope, "year", 1169), /memory4_derived_invalid/);
    sample.base.writeJson(file, view);
    sample.base.writeJson(file, { ...view, sourceHash: "stale-source-hash" });
    const stale = sample.coordinator.derived.list(detail.scope).years[0];
    assert.equal(stale.dirty, true);
    assert.equal(sample.coordinator.derived.validView(detail.scope, stale, "year"), false);
    assert.deepEqual(sample.derivedCalls, []);
  });

  await check("DER-09: five-year Detail, ten-year Legacy and Commitment remain recallable without generating views", async () => {
    const sample = fixture("long-recall");
    const campaignToken = "v923-recall-campaign";
    const fiveYear = addDetail(sample, { campaignToken, date: "1169.3.1", text: "五年前的粮食会面已按约完成。", topics: ["粮食"] });
    const tenYearCommitment = addDetail(sample, { campaignToken, date: "1164.3.1", memoryType: "COMMITMENT",
      text: "我答应向甲送粮，但必须先修复驿道。", topics: ["诺言"] });
    const legacy = createMemoryRecord({ memoryId: "fixture-legacy-ten-year", type: "folder_summary", subtype: "conversation_summary",
      content: "旧档记载：1164年甲乙在北境举行会盟，双方留下了一份粮食纪要。", eventDate: "1164.3.1",
      participants: [1, 2], subjects: [1], knownBy: [2], visibility: "known_group", source: "imported", tags: ["旧档", "会盟"],
      provenance: { campaignToken, campaignBinding: { status: "bound" }, folderOwnerId: 2, counterpartId: 1,
        counterpartIds: [1], extractionMode: "folder_summary_v2_5" } });
    const planner = new Memory4RecallPlanner(sample.coordinator);
    const scope = { campaignToken, ownerId: 2 };
    assert.deepEqual(sample.coordinator.derived.list(scope).years, [], "recall fixture intentionally has no Year views");
    assert.equal(sample.coordinator.derived.read(scope, "life"), null, "recall fixture intentionally has no Life view");
    const options = { campaignToken, ownerId: 2, currentGameDate: "1174.3.1",
      currentTotalDays: normalizeGameDate("1174.3.1").serial, conversationId: "v923-query", sceneRevision: "v1",
      turnEpoch: 1, querySpeakerId: 1, entityIds: [1], legacyMemories: [legacy], memoryEngineRemainingBudget: 1200,
      providerRemainingSafeBudget: 1200, estimateTokens };

    const five = planner.plan({ ...options, topics: ["粮食"], query: "1169年我们聊过的粮食会面是什么？" });
    assert(five.details.some(item => item.memory.memoryId === fiveYear.entryId && item.sourceRef.kind === "detail"));
    const promise = planner.plan({ ...options, topics: ["诺言"], query: "1164年我们聊过什么？" });
    assert.equal(sample.coordinator.store.loadIndex(scope).entries[tenYearCommitment.entryId].memoryType, "COMMITMENT");
    assert(promise.details.some(item => item.memory.memoryId === tenYearCommitment.entryId && item.sourceRef.kind === "detail"));
    assert(promise.text.includes("必须先修复驿道"));
    const oldLegacy = planner.plan({ ...options, topics: ["旧档"], query: "1164年我们聊过的旧档纪要是什么？" });
    assert(oldLegacy.items.some(item => item.memory.memoryId === legacy.memoryId && item.sourceRef.kind === "legacy"));
    assert.deepEqual(sample.derivedCalls, []);
  });

  await check("DER-11: the legacy Derived rebuild UI is visibly retired and never offers a paid confirmation", async () => {
    const source = fs.readFileSync(path.join(appRoot, "renderer", "memory4-manager.js"), "utf8");
    const data = { ownerId: 2, campaignToken: "v923-ui-campaign", contextId: "v923-ui-context", readOnlyArchive: false,
      derived: { generationPolicy: "RETIRED", derivedRevision: 2, jobs: [],
        years: [{ eventYear: 1169, revision: 1, dirty: true, generationMode: "auto", manual: { mode: "auto" },
          items: [{ itemId: "v923-ui-item", text: "合法预生成年度视图。" }] }],
        life: { revision: 1, dirty: false, manual: { mode: "auto" },
          segments: [{ segmentId: "v923-ui-segment", period: { fromYear: 1160, toYear: 1169 },
            text: "合法预生成生命视图。", manual: { mode: "auto" } }] } },
      detail: { total: 1, items: [] } };
    let confirmed = 0, mutateCalls = 0;
    const sandbox = { module: { exports: {} }, window: { confirm: () => { confirmed++; return true; }, conversationAPI: {
      mutateMemory4: async () => { mutateCalls++; return { success: true }; }
    } } };
    vm.runInNewContext(source.replace("export function Memory4Manager", "function Memory4Manager")
      + "\nmodule.exports.Memory4Manager = Memory4Manager;", sandbox, { filename: "memory4-manager.js" });
    const findButtons = (tree, labels, found = []) => {
      if (Array.isArray(tree)) { for (const child of tree) findButtons(child, labels, found); return found; }
      if (!tree || typeof tree !== "object") return found;
      if (tree.type === "button" && labels.includes(tree.children?.[0])) found.push(tree);
      for (const child of tree.children || []) findButtons(child, labels, found);
      return found;
    };
    const render = tab => {
      let stateIndex = 0;
      const react = { Fragment: "Fragment", createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
        useState: initial => { const index = stateIndex++; return [index === 0 ? tab : index === 1 ? data : initial, () => {}]; },
        useRef: current => ({ current }), useEffect: () => {} };
      return sandbox.module.exports.Memory4Manager({ react, ownerId: 2, refreshKey: 0 });
    };
    for (const [tab, labels] of [["year", ["从长期记忆生成年度与人生记忆", "从 Detail 重新生成"]],
      ["life", ["从年度记忆生成人生记忆", "重新生成当前阶段"]]]) {
      const buttons = findButtons(render(tab), labels);
      assert.equal(buttons.length, labels.length, `all retired rebuild controls render on ${tab}`);
      for (const button of buttons) {
        assert.equal(button.props.disabled, true, `${button.children[0]} is visibly disabled`);
        button.props.onClick();
      }
    }
    assert.equal(confirmed, 0, "retired actions never open a paid confirmation");
    assert.equal(mutateCalls, 0, "retired actions never reach the mutation IPC");
  });
}

main().then(() => {
  console.log(`V9.2.3 derived retirement QA: ${checks} PASS, ${failures} FAIL`);
  if (failures) process.exitCode = 1;
}).catch(error => { console.error(error.stack || error.message); process.exitCode = 1; })
  .finally(() => {
    assert(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(root, { recursive: true, force: true });
  });
