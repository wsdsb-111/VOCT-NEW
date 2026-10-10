"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { MemoryStore } = require("../resources/app/out/main/memory-system/memory-store");
const { Memory4Coordinator } = require("../resources/app/out/main/memory-system/memory4-coordinator");
const { Memory4DerivedService } = require("../resources/app/out/main/memory-system/memory4-derived");
const { projectVisibleTranscript } = require("../resources/app/out/main/memory-system/memory4-visibility");
const { normalizeGameDate } = require("../resources/app/out/main/worldline/character-temporal-facts");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "votc-derived-compression-qa-"));
const scope = { campaignToken: "qa-derived-compression-campaign", ownerId: 2 };
const estimateTokens = text => Math.ceil(text.length / 2);
let checks = 0, failures = 0, fixtureSequence = 0, conversationSequence = 0;

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

function directEntry(entryId, text, axis = "event", eventYear = 1164) {
  const acquiredDate = eventYear + ".1.1";
  return {
    entryId, text, importance: 1, entityIds: [99], topics: ["经历"],
    evidence: { sourceType: "spoken", epistemicStatus: "reported" }, state: { status: "active" },
    eventTime: axis === "event"
      ? { from: eventYear + ".1.1", to: eventYear + ".12.31", precision: "year", status: "reported" }
      : { from: null, to: null, precision: "unknown", status: "unknown" },
    acquiredDate
  };
}

function sourceItem(entry, text = entry.text) {
  return { itemId: "item_" + entry.entryId, text, sourceEntryIds: [entry.entryId],
    entityIds: [...entry.entityIds], topics: [...entry.topics], importance: entry.importance };
}

function response(items) { return JSON.stringify({ items }); }

function directService(requestCompression) {
  let calls = 0;
  const service = new Memory4DerivedService({ store: {}, baseStore: {} });
  service.configure({ estimateTokens: text => text.length, requestCompression: async (...args) => {
    calls++;
    return requestCompression(...args);
  } });
  return { service, calls: () => calls };
}

function fixture(traceRecords = []) {
  const directory = path.join(root, "fixture-" + (++fixtureSequence));
  const summaryFoldersDir = path.join(directory, "summaries");
  for (const id of [1, 2, 99]) fs.mkdirSync(path.join(summaryFoldersDir, id + "_fixture"), { recursive: true });
  const base = new MemoryStore({ baseDir: path.join(directory, "memory"), summaryFoldersDir });
  const coordinator = new Memory4Coordinator(base, { trace: { record: (...args) => traceRecords.push(args) } });
  coordinator.configureDerived({ isCampaignCurrent: () => true });
  return { base, coordinator, traceRecords, scope: { ...scope } };
}

function addEntry(sample, { date, eventYear, text }) {
  const conversationId = "derived-qa-" + (++conversationSequence);
  const eventTime = eventYear
    ? { from: date, to: date, precision: "day", status: "observed" }
    : { from: null, to: null, precision: "unknown", status: "unknown" };
  const context = { ...sample.scope, conversationId, finalizationId: conversationId, episodeId: conversationId,
    date, totalDays: normalizeGameDate(date).serial, participants: [{ id: 1 }, { id: sample.scope.ownerId }],
    participantPresence: [{ characterId: 1, joinedAtMessageId: 0 }, { characterId: sample.scope.ownerId, joinedAtMessageId: 0 }],
    messages: [{ id: 1, role: "user", speakerCharacterId: 1, content: text,
      memory4Fragments: [{ start: 0, end: text.length, visibility: "participants", sourceType: eventYear ? "witnessed" : "spoken",
        recipientIds: [sample.scope.ownerId], entityIds: [99] }] }] };
  const snapshot = { ...context, ...projectVisibleTranscript(context, sample.scope.ownerId), counterpartIds: [1] };
  const result = sample.coordinator.store.commitOwner(snapshot, { status: "STORE", entries: [{
    memoryType: "MAJOR_EXPERIENCE", text, fragmentIds: [snapshot.fragments[0].fragmentId],
    entityIds: [99], participantIds: [1, sample.scope.ownerId], topics: ["经历"],
    eventTime
  }] });
  return result.entryIds[0];
}

function compressionInput(prompt) { return JSON.parse(prompt[1].content); }

async function testRendererFailedRebuildRefresh() {
  const source = fs.readFileSync(path.join(__dirname, "../resources/app/out/renderer/memory4-manager.js"), "utf8")
    .replace("export function Memory4Manager", "function Memory4Manager");
  const slots = [], effects = [];
  let cursor = 0, tree, ownerReads = 0;
  const react = {
    Fragment: "fragment",
    createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) }),
    useState(initial) {
      const index = cursor++;
      if (!slots[index]) slots[index] = { value: initial };
      return [slots[index].value, value => {
        slots[index].value = typeof value === "function" ? value(slots[index].value) : value;
      }];
    },
    useRef(initial) {
      const index = cursor++;
      return slots[index] ||= { current: initial };
    },
    useEffect(callback, dependencies) {
      const index = cursor++;
      if (!slots[index] || dependencies.some((value, position) => value !== slots[index].dependencies[position])) {
        slots[index]?.cleanup?.();
        slots[index] = { dependencies };
        effects.push(() => { slots[index].cleanup = callback(); });
      }
    }
  };
  const ownerData = status => ({ success: true, ownerId: 2, campaignToken: "qa-ui-campaign", contextId: "qa-ui-context",
    readOnlyArchive: false, known: { items: [], offset: 0, total: 0 }, official: [],
    legacy: { total: 0, counts: {}, items: [] }, generation: {},
    derived: { years: [], life: null, derivedRevision: 4,
      jobs: [{ kind: "all", status, reason: status === "FAILED" ? "memory4_compression_quality_failed" : null, eventYear: 1085 }] },
    detail: { offset: 0, total: 1, items: [{ entryId: "detail-qa", revision: 1, text: "synthetic detail" }] } });
  const api = {
    async getMemory4OwnerData() { ownerReads++; return ownerData(ownerReads === 1 ? "RUNNING" : "FAILED"); },
    async mutateMemory4() { return { success: true, result: { status: "FAILED", reason: "memory4_compression_quality_failed" } }; },
    onConversationUpdate: () => () => {}
  };
  const sandbox = { window: { conversationAPI: api, confirm: () => true }, console: { debug() {} }, setTimeout, clearTimeout };
  vm.runInNewContext(source + "\nthis.component = Memory4Manager;", sandbox);
  const render = () => {
    cursor = 0;
    tree = sandbox.component({ react, ownerId: 2, refreshKey: 0 });
    while (effects.length) effects.shift()();
    return tree;
  };
  const find = (node, predicate) => !node || typeof node !== "object" ? []
    : [...(predicate(node) ? [node] : []), ...(node.children || []).flatMap(child => find(child, predicate))];
  const textOf = node => typeof node === "string" ? node : (node?.children || []).map(textOf).join("");
  render();
  await new Promise(resolve => setTimeout(resolve, 0));
  render();
  const yearTab = find(tree, node => node.type === "button" && node.props.role === "tab" && textOf(node) === "年度记忆")[0];
  assert(yearTab, "annual memory tab should render");
  yearTab.props.onClick();
  render();
  const rebuild = find(tree, node => node.type === "button" && textOf(node) === "从长期记忆生成年度与人生记忆")[0];
  assert(rebuild, "all-derived rebuild action should render");
  rebuild.props.onClick();
  await new Promise(resolve => setTimeout(resolve, 20));
  render();
  assert.equal(ownerReads, 2, "a failed rebuild must reload the final owner job state");
  assert(textOf(tree).includes("派生记忆生成失败（1085 年）"), "the refreshed FAILED job should replace stale RUNNING");
  assert(!textOf(tree).includes("正在生成，完成后刷新"), "the panel must not remain stale RUNNING after failure");
  assert(textOf(tree).includes("模型压缩未通过预算、条件或日期校验"), "the compression failure should remain visible");
}

async function main() {
  await check("strict source ID set rejects duplicate, omitted, or foreign provenance without retry", async () => {
    const a = directEntry("qa-source-a", "a".repeat(900));
    const b = directEntry("qa-source-b", "b".repeat(900));
    const badIdSets = [["qa-source-a", "qa-source-a"], ["qa-source-a"], ["qa-source-a", "qa-source-b", "foreign-source"]];
    for (const ids of badIdSets) {
      const { service, calls } = directService(async () => response([{ text: "compressed", sourceEntryIds: ids }]));
      await assert.rejects(service.compress(scope, "year", [sourceItem(a), sourceItem(b)], [a, b],
        { cancelled: false, controller: { signal: null } }, null),
      error => error.message === "memory4_compression_source_mismatch");
      assert.equal(calls(), 1, "a provenance failure must not trigger the quality correction retry");
    }
  });

  await check("acquisition annotation failure gets one correction and the exact unknown-date label survives", async () => {
    const acquired = directEntry("qa-acquired", "获知了一件久远往事。" + "细节".repeat(900), "acquired", 1164);
    const annotation = "【本年获知，事件日期未知；获知日期：1164.1.1】";
    let secondFeedback;
    const { service, calls } = directService(async prompt => {
      if (calls() === 1) return response([{ text: "压缩后的旧事。", sourceEntryIds: [acquired.entryId] }]);
      secondFeedback = JSON.parse(prompt.at(-1).content);
      return response([{ text: annotation + "压缩后的旧事。", sourceEntryIds: [acquired.entryId] }]);
    });
    const items = await service.compress(scope, "year", [sourceItem(acquired, annotation + acquired.text)], [acquired],
      { cancelled: false, controller: { signal: null } }, null);
    assert.equal(calls(), 2);
    assert.deepEqual(secondFeedback.invalidTimeAxisItems, [0]);
    assert.equal(items[0].timeAxis, "acquired");
    assert(items[0].text.startsWith(annotation));
    assert(items[0].text.includes("压缩后的旧事"));
  });

  await check("event and acquired evidence cannot be collapsed into a mixed-axis output", async () => {
    const event = directEntry("qa-event", "发生于当年的有日期事实。" + "事件细节".repeat(700), "event", 1164);
    const acquired = directEntry("qa-axis-acquired", "今年才获知的无日期往事。" + "获知细节".repeat(700), "acquired", 1164);
    const label = "【本年获知，事件日期未知；获知日期：1164.1.1】";
    let feedback;
    const { service, calls } = directService(async prompt => {
      const input = compressionInput(prompt);
      assert.deepEqual(input.items.map(item => item.evidence[0].timeAxis).sort(), ["acquired", "event"]);
      if (calls() === 1) return response([{ text: label + "合并后的概述。", sourceEntryIds: [event.entryId, acquired.entryId] }]);
      feedback = JSON.parse(prompt.at(-1).content);
      return response([
        { text: "有日期的事件概述。", sourceEntryIds: [event.entryId] },
        { text: label + "无日期往事概述。", sourceEntryIds: [acquired.entryId] }
      ]);
    });
    const items = await service.compress(scope, "life", [sourceItem(event), sourceItem(acquired, label + acquired.text)], [event, acquired],
      { cancelled: false, controller: { signal: null } }, null);
    assert.equal(calls(), 2);
    assert.deepEqual(feedback.invalidTimeAxisItems, [0]);
    assert.deepEqual(items.map(item => item.timeAxis).sort(), ["acquired", "event"]);
    assert(items.find(item => item.timeAxis === "acquired").text.startsWith(label));
  });

  await check("condition and negative clauses require literal source substrings in the correction", async () => {
    const entry = directEntry("qa-condition", "双方答应议和，但须先释放俘虏；并未允许守军进城。" + "普通记事".repeat(900));
    let required = [], feedback;
    const { service, calls } = directService(async prompt => {
      const input = compressionInput(prompt);
      required = input.items[0].evidence[0].requiredVerbatim;
      assert(required.includes("但须先释放俘虏"));
      assert(required.includes("未允许守军进城"));
      if (calls() === 1) return response([{ text: "双方达成议和并恢复往来。", sourceEntryIds: [entry.entryId] }]);
      feedback = JSON.parse(prompt.at(-1).content);
      return response([{ text: "压缩事实；" + required.join("；"), sourceEntryIds: [entry.entryId] }]);
    });
    const result = await service.compress(scope, "year", [sourceItem(entry)], [entry],
      { cancelled: false, controller: { signal: null } }, null);
    assert.equal(calls(), 2);
    for (const phrase of required) assert(result[0].text.includes(phrase), "missing literal: " + phrase);
    assert(feedback.missingGuards.some(item => item.sourceEntryId === entry.entryId && item.text === "但须先释放俘虏"));
    assert(feedback.missingGuards.some(item => item.sourceEntryId === entry.entryId && item.text === "未允许守军进城"));
  });

  await check("hard budget stays strict after one bounded quality retry and diagnostics contain counts only", async () => {
    const entry = directEntry("qa-budget", "原始来源。" + "内容".repeat(1000));
    let secondFeedback;
    const { service, calls } = directService(async prompt => {
      if (calls() === 2) secondFeedback = JSON.parse(prompt.at(-1).content);
      return response([{ text: "x".repeat(1501), sourceEntryIds: [entry.entryId] }]);
    });
    let failure;
    try {
      await service.compress(scope, "year", [sourceItem(entry)], [entry], { cancelled: false, controller: { signal: null } }, null);
    } catch (error) { failure = error; }
    assert(failure, "two over-budget responses should fail");
    assert.equal(failure.message, "memory4_compression_quality_failed");
    assert.equal(calls(), 2, "the corrective retry must be bounded");
    assert.equal(failure.quality.outputTokens, 1501);
    assert.equal(failure.quality.finalTokens, 1501);
    assert.equal(failure.quality.hardLimit, 1500);
    assert.equal(secondFeedback.hardLimit, 1500);
    assert.equal(secondFeedback.outputTokens, 1501);
    assert.equal(secondFeedback.finalTokens, 1501);
    assert.deepEqual(Object.keys(failure.quality).sort(),
      ["finalTokens", "hardLimit", "invalidTimeAxisCount", "missingGuardCount", "outputTokens"]);
    assert(!JSON.stringify(failure.quality).includes(entry.text));
  });

  await check("LIFE preserves required 734-token wording above its 700 soft target under the 1000 hard limit", async () => {
    const requiredText = "必须" + "条款".repeat(366);
    const entry = directEntry("qa-life-required-734", requiredText + "。" + "补充事实。".repeat(160));
    let calls = 0;
    const { service } = directService(async prompt => {
      calls++;
      const input = compressionInput(prompt);
      const guards = input.items[0].evidence[0].requiredVerbatim;
      assert(guards.some(guard => guard.startsWith(requiredText)));
      return response([{ text: requiredText, sourceEntryIds: [entry.entryId] }]);
    });
    const result = await service.compress(scope, "life", [sourceItem(entry)], [entry],
      { cancelled: false, controller: { signal: null } }, null);
    assert.equal(calls, 1);
    assert.equal(result[0].text.length, 734);
    assert(result[0].text.length > 700 && result[0].text.length <= 1000);
    assert(result[0].text.startsWith(requiredText));
  });

  await check("cancellation after the first response prevents a correction request", async () => {
    const sample = fixture();
    const entryId = addEntry(sample, { date: "1164.1.1", eventYear: 1164,
      text: "答应议和，但须先释放俘虏。" + "详细事实".repeat(900) });
    let calls = 0;
    sample.coordinator.configureDerived({ estimateTokens, requestCompression: async prompt => {
      calls++;
      const ids = compressionInput(prompt).items.flatMap(item => item.sourceEntryIds);
      sample.coordinator.derived.cancel(sample.scope);
      return response([{ text: "双方达成议和。", sourceEntryIds: ids }]);
    } });
    const result = await sample.coordinator.derived.rebuild(sample.scope, { kind: "year", eventYear: 1164 });
    assert.equal(result.status, "CANCELLED");
    assert.equal(result.reason, "memory4_derived_cancelled");
    assert.equal(calls, 1);
    assert.equal(sample.coordinator.derived.list(sample.scope).years.length, 0);
    assert(entryId);
  });

  await check("all continues after 1085 compression failure, persists 1086, and does not write incomplete Life", async () => {
    const traceRecords = [];
    const sample = fixture(traceRecords);
    for (const [year, count] of [[1085, 23], [1086, 25]]) {
      for (let index = 1; index <= count; index++) {
        const marker = year === 1085 ? "QA_PRIVATE_SOURCE_BODY_DO_NOT_LOG " : "";
        addEntry(sample, { date: year + ".1.1", eventYear: year,
          text: marker + "事件编号 " + year + "-" + index + "：" + "详细事实记录。".repeat(32) });
      }
    }
    const calls = [];
    sample.coordinator.configureDerived({ estimateTokens, requestCompression: async (prompt, options) => {
      const input = compressionInput(prompt);
      const ids = input.items.flatMap(item => item.sourceEntryIds);
      const year = Number(input.items[0].evidence[0].eventTime.from.slice(0, 4));
      calls.push({ year, count: input.items.length, requestType: options.requestType });
      assert.equal(ids.length, new Set(ids).size, "the input should carry one exact source ID per detail");
      if (year === 1085) {
        assert.equal(input.items.length, 23);
        assert(estimateTokens(input.items.map(item => item.text).join("\n")) > 1500);
        return response([{ text: "x".repeat(1501), sourceEntryIds: ids }]);
      }
      assert.equal(year, 1086);
      assert.equal(input.items.length, 25);
      assert(estimateTokens(input.items.map(item => item.text).join("\n")) > 1500);
      return response([{ text: "1086 年有效归纳。", sourceEntryIds: ids }]);
    } });
    const result = await sample.coordinator.derived.rebuild(sample.scope, { kind: "all" });
    assert.equal(result.status, "FAILED");
    assert.equal(result.reason, "memory4_compression_quality_failed");
    assert.deepEqual(result.failedYears, [1085]);
    assert.deepEqual(result.results.map(row => [row.eventYear, row.status]), [[1085, "FAILED"], [1086, "COMPLETE"]]);
    assert.deepEqual(calls.map(call => call.year), [1085, 1085, 1086], "1086 must run after the bounded 1085 failure");
    assert(calls.every(call => call.requestType === "memory4_year"), "an incomplete all run must not request Life compression");
    const views = sample.coordinator.derived.list(sample.scope);
    assert.deepEqual(views.years.map(view => view.eventYear), [1086]);
    assert.equal(views.years[0].items.length, 1);
    assert.equal(views.years[0].items[0].text, "1086 年有效归纳。");
    assert.equal(views.life, null, "Life must not be written from an incomplete set of Year views");
    assert(!JSON.stringify(result).includes("QA_PRIVATE_SOURCE_BODY_DO_NOT_LOG"));
    assert(!JSON.stringify(traceRecords).includes("QA_PRIVATE_SOURCE_BODY_DO_NOT_LOG"), "derived traces must never contain source body text");
    const quality = result.results[0].quality;
    assert.deepEqual(Object.keys(quality).sort(),
      ["finalTokens", "hardLimit", "invalidTimeAxisCount", "missingGuardCount", "outputTokens"]);
  });

  await check("standalone Life rebuild refuses to use only a subset of eligible Year views", async () => {
    const sample = fixture();
    addEntry(sample, { date: "1085.1.1", eventYear: 1085, text: "1085 年的合成事实。" });
    addEntry(sample, { date: "1086.1.1", eventYear: 1086, text: "1086 年的合成事实。" });
    const yearResult = await sample.coordinator.derived.rebuild(sample.scope, { kind: "year", eventYear: 1086 });
    assert.equal(yearResult.status, "COMPLETE");
    const lifeResult = await sample.coordinator.derived.rebuild(sample.scope, { kind: "life" });
    assert.equal(lifeResult.status, "FAILED");
    assert.deepEqual(sample.coordinator.derived.list(sample.scope).years.map(view => view.eventYear), [1086]);
    assert.equal(sample.coordinator.derived.list(sample.scope).life, null);
  });

  await check("renderer reloads owner state when an all-derived rebuild returns FAILED", testRendererFailedRebuildRefresh);

  console.log("V8.15.2 derived compression independent QA: " + checks + " PASS, " + failures + " FAIL");
}

main().catch(error => {
  failures++;
  console.error(error.stack || error);
}).finally(() => {
  assert(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep));
  fs.rmSync(root, { recursive: true, force: true });
  if (failures) process.exitCode = 1;
});
