"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { MemoryStore } = require("../resources/app/out/main/memory-system/memory-store");
const { Memory4Coordinator } = require("../resources/app/out/main/memory-system/memory4-coordinator");
const { hash } = require("../resources/app/out/main/memory-system/memory4-contract");
const { projectVisibleTranscript } = require("../resources/app/out/main/memory-system/memory4-visibility");
const { normalizeGameDate } = require("../resources/app/out/main/worldline/character-temporal-facts");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "votc-derived-acquisition-qa-"));
let checks = 0, failures = 0, sequence = 0;
const LABEL = "本年获知，事件日期未知";
const estimateTokens = text => Math.ceil(text.length / 2);

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
  const directory = path.join(root, `fixture-${++sequence}`);
  const summaryFoldersDir = path.join(directory, "summaries");
  for (const id of [1, 2, 3, 99]) fs.mkdirSync(path.join(summaryFoldersDir, `${id}_fixture`), { recursive: true });
  const memoryDir = path.join(directory, "memory");
  const base = new MemoryStore({ baseDir: memoryDir, summaryFoldersDir });
  const coordinator = new Memory4Coordinator(base);
  coordinator.configureDerived({ isCampaignCurrent: () => true });
  return { base, coordinator, memoryDir, summaryFoldersDir, scope: { campaignToken: "qa-acquisition-campaign", ownerId: 2 } };
}

function addEntry(sample, { ownerId = sample.scope.ownerId, campaignToken = sample.scope.campaignToken,
  date = "1164.8.11", acquiredDate = null, text = "此人物留下了一段值得记住的经历。", eventTime = { status: "unknown" },
  entityId = 99, sourceType = "spoken" } = {}) {
  const scope = { campaignToken, ownerId };
  const conversationId = `acquisition-source-${++sequence}`;
  const context = { ...scope, conversationId, finalizationId: conversationId, episodeId: `episode-${conversationId}`,
    date, totalDays: normalizeGameDate(date).serial,
    participants: [{ id: 1 }, { id: ownerId }],
    participantPresence: [{ characterId: 1, joinedAtMessageId: 0 }, { characterId: ownerId, joinedAtMessageId: 0 }],
    messages: [{ id: 1, role: "user", speakerCharacterId: 1, content: text,
      memory4Fragments: [{ start: 0, end: text.length, visibility: "participants", sourceType,
        recipientIds: [ownerId], entityIds: [entityId] }] }] };
  const snapshot = { ...context, ...projectVisibleTranscript(context, ownerId), counterpartIds: [1] };
  const result = sample.coordinator.store.commitOwner(snapshot, { status: "STORE", entries: [{ memoryType: "MAJOR_EXPERIENCE",
    text, fragmentIds: [snapshot.fragments[0].fragmentId], entityIds: [entityId], participantIds: [1, ownerId], topics: ["经历"], eventTime }] });
  const entryId = result.entryIds[0];
  if (acquiredDate && acquiredDate !== date) rewriteEntry(sample, scope, entryId, entry => { entry.acquiredDate = acquiredDate; });
  return { scope, entryId };
}

function rewriteEntry(sample, scope, entryId, update) {
  const store = sample.coordinator.store;
  const index = store.loadIndex(scope);
  const entry = store.readEntry(scope, entryId, index);
  update(entry);
  const directory = store.directory(scope);
  sample.base.writeJson(store.entryPath(directory, entryId), entry);
  index.entries[entryId] = store.indexRow(entry);
  index.revision++;
  store.reindex(index);
  sample.base.writeJson(path.join(directory, "index.json"), index);
  const metadata = sample.coordinator.store.read(path.join(directory, "metadata.json"), null);
  sample.base.writeJson(path.join(directory, "metadata.json"), { ...metadata, revision: index.revision, indexHash: hash(index), derivedDirty: true });
}

function entry(sample, entryId, scope = sample.scope) {
  return sample.coordinator.store.readEntry(scope, entryId);
}

function compressionResponse(items, text) {
  return JSON.stringify({ items: [{ text, sourceEntryIds: items.flatMap(item => item.sourceEntryIds) }] });
}

async function main() {
  await check("undated unknown, reported, and observed details archive by acquisition year without changing event time", async () => {
    const sample = fixture();
    const unknown = addEntry(sample, { date: "1164.8.11", text: "此人物在边境留下了一段未标明日期的经历。" });
    const reported = addEntry(sample, { date: "1164.8.12", text: "信使转述了一件没有确切日期的往事。", eventTime: { status: "reported" } });
    const observed = addEntry(sample, { date: "1164.8.13", text: "乙亲眼见到一次没有日期记载的经历。", eventTime: { status: "observed" }, sourceType: "witnessed" });
    const result = await sample.coordinator.derived.rebuild(sample.scope, { kind: "all" });
    assert.equal(result.status, "COMPLETE");
    assert.equal(result.sourceCount, 3);
    const views = sample.coordinator.derived.list(sample.scope);
    assert.deepEqual(views.years.map(view => view.eventYear), [1164]);
    const ids = new Set([unknown.entryId, reported.entryId, observed.entryId]);
    const year = views.years[0];
    assert.equal(year.items.length, 3);
    for (const item of year.items) {
      const sourceId = item.sourceEntryIds.find(id => ids.has(id));
      const source = entry(sample, sourceId);
      assert.equal(item.timeAxis, "acquired");
      assert(item.text.startsWith(`【${LABEL}；获知日期：${source.acquiredDate}】`));
      assert.equal(source.eventTime.from, null);
      assert.equal(source.eventTime.to, null);
      assert(["unknown", "reported", "observed"].includes(source.eventTime.status));
    }
    assert.equal(views.life.segments.length, 1);
    assert(views.life.segments[0].items.every(item => item.timeAxis === "acquired" && item.text.includes(LABEL)));
  });

  await check("acquisition year, not conversation year, selects the archive bucket", async () => {
    const sample = fixture();
    const source = addEntry(sample, { date: "1160.4.1", acquiredDate: "1162.5.3", text: "这段往事当时没有记下发生日期。" });
    await sample.coordinator.derived.rebuild(sample.scope, { kind: "all" });
    const views = sample.coordinator.derived.list(sample.scope);
    assert.deepEqual(views.years.map(view => view.eventYear), [1162]);
    assert(views.years[0].items[0].text.startsWith("【本年获知，事件日期未知；获知日期：1162.5.3】"));
    assert.equal(entry(sample, source.entryId).conversationDate, "1160.4.1");
    assert.equal(entry(sample, source.entryId).acquiredDate, "1162.5.3");
    assert.equal(entry(sample, source.entryId).eventTime.status, "unknown");
  });

  await check("planned details do not fall back into acquisition years", async () => {
    const sample = fixture();
    addEntry(sample, { date: "1164.8.11", text: "1164年此人被安排出征。", eventTime: { from: "1164.1.1", to: "1164.12.31", precision: "year", status: "planned" } });
    const result = await sample.coordinator.derived.rebuild(sample.scope, { kind: "all" });
    assert.equal(result.status, "COMPLETE");
    assert.equal(result.sourceCount, 0);
    assert.equal(result.reason, "NO_ELIGIBLE_SOURCES");
    assert.deepEqual(sample.coordinator.derived.list(sample.scope).years, []);
    assert.deepEqual(sample.coordinator.derived.list(sample.scope).life?.segments || [], []);
  });

  await check("owner scope, campaign binding, and deleted source records stay out of another owner's Year view", async () => {
    const sample = fixture();
    const revoked = addEntry(sample, { text: "REVOKED_SOURCE 这条来源随后被撤销。" });
    const retained = addEntry(sample, { text: "OWNER_TWO_SOURCE 这条来源仍然有效。" });
    addEntry(sample, { ownerId: 3, text: "OTHER_OWNER_SOURCE 不得进入乙的记忆。" });
    addEntry(sample, { campaignToken: "other-campaign", text: "OTHER_CAMPAIGN_SOURCE 不得跨战役进入。" });
    assert.equal(sample.coordinator.store.deleteEntry(sample.scope, revoked.entryId, { expectedRevision: 1 }), true);
    await sample.coordinator.derived.rebuild(sample.scope, { kind: "all" });
    const views = sample.coordinator.derived.list(sample.scope).years;
    assert.deepEqual(views.map(view => view.eventYear), [1164]);
    assert.equal(views[0].items.length, 1);
    assert.deepEqual(views[0].items[0].sourceEntryIds, [retained.entryId]);
    assert(views[0].items[0].text.includes("OWNER_TWO_SOURCE"));
    for (const forbidden of ["REVOKED_SOURCE", "OTHER_OWNER_SOURCE", "OTHER_CAMPAIGN_SOURCE"]) {
      assert(!JSON.stringify(views).includes(forbidden), `leaked ${forbidden}`);
    }
  });

  await check("Year compression receives acquisition evidence, preserves labels, and stays under budget", async () => {
    const sample = fixture();
    const sourceTexts = ["甲方在边境记录了一件平常经历。", "乙方在城中记录了一件平常经历。"];
    const sources = sourceTexts.map((prefix, index) => addEntry(sample, { date: index ? "1164.3.1" : "1164.1.1",
      text: prefix + "普通事实记录。".repeat(190) }));
    const calls = [];
    sample.coordinator.configureDerived({ estimateTokens, requestCompression: async (prompt, options) => {
      calls.push(options.requestType);
      const input = JSON.parse(prompt[1].content);
      assert(input.items.every(item => item.timeAxis === "acquired"));
      assert(input.items.every(item => item.evidence.every(evidence => evidence.eventTime && evidence.acquiredDate && evidence.timeAxis === "acquired")));
      const labels = input.items.map(item => item.text.match(/【[^】]+】/)?.[0]).filter(Boolean);
      assert.equal(labels.length, input.items.length);
      return compressionResponse(input.items, `${labels[0]} 合并后的事实记录。`);
    } });
    const result = await sample.coordinator.derived.rebuild(sample.scope, { kind: "year", eventYear: 1164 });
    assert.equal(result.status, "COMPLETE", result.reason);
    assert.deepEqual(calls, ["memory4_year"]);
    const year = sample.coordinator.derived.list(sample.scope).years[0];
    assert.equal(year.items.length, 1);
    assert.equal(year.items[0].timeAxis, "acquired");
    assert(year.items[0].text.startsWith("【本年获知，事件日期未知；获知日期：1164.1.1、1164.3.1】"));
    assert.equal(year.items[0].sourceEntryIds.length, 2);
    assert(year.tokens <= 1000);
    assert.equal(sources.length, 2);
  });

  await check("Year compression fails closed when the model removes the unknown-event qualifier", async () => {
    const sample = fixture();
    addEntry(sample, { text: "平常事实记录。".repeat(340) });
    sample.coordinator.configureDerived({ estimateTokens, requestCompression: async prompt => {
      const input = JSON.parse(prompt[1].content);
      return compressionResponse(input.items, "压缩后的文字没有保留事件日期未知标记。" );
    } });
    const result = await sample.coordinator.derived.rebuild(sample.scope, { kind: "year", eventYear: 1164 });
    assert.equal(result.status, "FAILED");
    assert.equal(result.reason, "memory4_compression_quality_failed");
    assert.equal(sample.coordinator.derived.list(sample.scope).years.length, 0);
  });

  await check("Life compression preserves acquired labels and never returns undated sources for an event window", async () => {
    const sample = fixture();
    const acquired = addEntry(sample, { date: "1165.5.1", text: "此人获知一段久远经历。" + "普通事实记录。".repeat(190) });
    const event = addEntry(sample, { date: "1165.1.1", text: "1164年迁居邢州。" + "普通事实记录。".repeat(190),
      eventTime: { from: "1164.1.1", to: "1164.12.31", precision: "year", status: "reported" } });
    let lifeCalls = 0;
    sample.coordinator.configureDerived({ estimateTokens, requestCompression: async (prompt, options) => {
      assert.equal(options.requestType, "memory4_life");
      lifeCalls++;
      const input = JSON.parse(prompt[1].content);
      assert(input.items.some(item => item.timeAxis === "acquired"));
      assert(input.items.some(item => item.timeAxis === "event"));
      assert(input.items.flatMap(item => item.evidence).some(evidence => evidence.eventTime.status === "unknown" && evidence.acquiredDate === "1165.5.1"));
      const acquiredItem = input.items.find(item => item.timeAxis === "acquired");
      const eventItem = input.items.find(item => item.timeAxis === "event");
      return JSON.stringify({ items: [
        { text: `${eventItem.text.slice(0, 22)} 压缩后的发生事实。`, sourceEntryIds: eventItem.sourceEntryIds },
        { text: `${acquiredItem.text.match(/【[^】]+】/)?.[0]} 压缩后的获知事实。`, sourceEntryIds: acquiredItem.sourceEntryIds }
      ] });
    } });
    const result = await sample.coordinator.derived.rebuild(sample.scope, { kind: "all" });
    assert.equal(result.status, "COMPLETE", result.reason);
    assert.equal(lifeCalls, 1);
    const life = sample.coordinator.derived.list(sample.scope).life;
    assert.equal(life.segments.length, 1);
    assert(life.segments[0].text.includes("【本年获知，事件日期未知；获知日期：1165.5.1】"));
    assert.deepEqual(life.segments[0].items.map(item => item.timeAxis).sort(), ["acquired", "event"]);

    const index = sample.coordinator.store.loadIndex(sample.scope);
    const eligibleEntryIds = [acquired.entryId, event.entryId];
    const select = query => sample.coordinator.derived.selectSlice(sample.scope, { query: { entityIds: [99], ...query }, index,
      eligibleEntryIds, currentGameDate: "1170.1.1", estimateTokens });
    const lifeRecall = select({ axis: "MEMORY_RECALL", granularity: "LIFE", window: null, text: "一生经历" });
    assert(lifeRecall);
    assert.equal(lifeRecall.reason.axis, "mixed");
    assert.equal(lifeRecall.reason.from, null);
    assert.equal(lifeRecall.reason.to, null);
    assert.equal(lifeRecall.reason.precision, "unknown");
    assert(lifeRecall.memory.content.includes("获知日期：1165.5.1"));
    const eventWindow = select({ axis: "EVENT", granularity: "LIFE", window: { from: "1165.1.1", to: "1165.12.31" }, text: "1165年发生了什么" });
    assert.equal(eventWindow, null);
    const datedEventWindow = select({ axis: "EVENT", granularity: "LIFE", window: { from: "1164.1.1", to: "1164.12.31" }, text: "1164年发生了什么" });
    assert(datedEventWindow);
    assert.deepEqual(datedEventWindow.sourceRef.sourceEntryIds, [event.entryId]);
    assert.equal(datedEventWindow.reason.axis, "event");
  });

  await check("Life compression fails closed when a response drops an acquisition label", async () => {
    const sample = fixture();
    addEntry(sample, { date: "1165.5.1", text: "此人获知一段久远经历。" + "普通事实记录。".repeat(190) });
    addEntry(sample, { date: "1165.1.1", text: "1164年迁居邢州。" + "普通事实记录。".repeat(190),
      eventTime: { from: "1164.1.1", to: "1164.12.31", precision: "year", status: "reported" } });
    sample.coordinator.configureDerived({ estimateTokens, requestCompression: async (prompt, options) => {
      assert.equal(options.requestType, "memory4_life");
      const input = JSON.parse(prompt[1].content);
      return compressionResponse(input.items, "压缩后丢失了获知日期和未知事件标记。" );
    } });
    const result = await sample.coordinator.derived.rebuild(sample.scope, { kind: "all" });
    assert.equal(result.status, "FAILED");
    assert.equal(result.reason, "memory4_compression_quality_failed");
    assert.equal(sample.coordinator.derived.list(sample.scope).life, null);
  });

  await check("a cross-year event appears once in Life provenance even when it feeds two Year views", async () => {
    const sample = fixture();
    const source = addEntry(sample, { date: "1163.5.1", text: "此人从1161年起一直驻守边境。",
      eventTime: { from: "1161.1.1", to: "1161.12.31", precision: "year", status: "reported" } });
    rewriteEntry(sample, sample.scope, source.entryId, entry => {
      entry.eventTime = { from: "1161.1.1", to: "1162.12.31", precision: "range", status: "reported" };
    });
    const result = await sample.coordinator.derived.rebuild(sample.scope, { kind: "all" });
    assert.equal(result.status, "COMPLETE", result.reason);
    const views = sample.coordinator.derived.list(sample.scope);
    assert.deepEqual(views.years.map(view => view.eventYear), [1161, 1162]);
    assert(views.years.every(view => view.items.length === 1 && view.items[0].sourceEntryIds.includes(source.entryId)));
    const segment = views.life.segments[0];
    assert.deepEqual(segment.sourceEntryIds, [source.entryId]);
    assert.equal(segment.sourceYearItemIds.length, 2);
    assert.deepEqual(segment.items.flatMap(item => item.sourceEntryIds), [source.entryId]);
  });

  await check("manual Year text survives source edits and restart until an explicit revision-checked overwrite", async () => {
    const sample = fixture();
    const source = addEntry(sample, { date: "1164.8.11", text: "来源初始描述了一段日期不详的往事。" });
    await sample.coordinator.derived.rebuild(sample.scope, { kind: "all" });
    const original = sample.coordinator.derived.list(sample.scope).years[0];
    sample.coordinator.derived.updateYear(sample.scope, { eventYear: 1164, itemId: original.items[0].itemId,
      text: "用户保留的年度文字。", expectedRevision: original.revision });
    sample.coordinator.store.updateEntry(sample.scope, source.entryId, "来源修订后仍未标明事件日期。", { expectedRevision: 1 });
    const conflict = await sample.coordinator.derived.rebuild(sample.scope, { kind: "year", eventYear: 1164 });
    assert.equal(conflict.status, "MANUAL_OVERRIDE");

    const restartedBase = new MemoryStore({ baseDir: sample.memoryDir, summaryFoldersDir: sample.summaryFoldersDir });
    const restarted = new Memory4Coordinator(restartedBase);
    restarted.configureDerived({ isCampaignCurrent: () => true });
    const persisted = restarted.derived.list(sample.scope).years[0];
    assert.equal(persisted.dirty, true);
    assert.equal(persisted.items[0].text, "用户保留的年度文字。");
    const overwritten = await restarted.derived.rebuild(sample.scope, { kind: "year", eventYear: 1164,
      overwriteManual: true, expectedRevision: persisted.revision });
    assert.equal(overwritten.status, "COMPLETE", overwritten.reason);
    const current = restarted.derived.list(sample.scope).years[0];
    assert.equal(current.items[0].timeAxis, "acquired");
    assert(current.items[0].text.startsWith("【本年获知，事件日期未知；获知日期：1164.8.11】"));
    assert(current.items[0].text.includes("来源修订后仍未标明事件日期"));
  });

}

main().then(() => {
  console.log(`V8.15.2 derived acquisition independent QA: ${checks} PASS, ${failures} FAIL`);
  if (failures) process.exitCode = 1;
}).catch(error => { console.error(error.stack || error.message); process.exitCode = 1; })
  .finally(() => {
    assert(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(root, { recursive: true, force: true });
  });
