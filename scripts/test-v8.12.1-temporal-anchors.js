"use strict";

const assert = require("node:assert/strict");
const { normalizeGameDate } = require("../resources/app/out/main/worldline/character-temporal-facts");
const { extractTemporalAnchors, extractTemporalAnchorsFromMessages, normalizeTemporalRefs, detectTemporalAxisIntent, gameDateFromSerial } = require("../resources/app/out/main/memory-system/temporal-anchor-extractor");
const { resolveTemporalWindow, resolveTemporalFocus, detectTemporalAxisIntent: resolverAxis } = require("../resources/app/out/main/memory-system/fuzzy-temporal-resolver");

let groups = 0;
function test(name, run) {
  run();
  groups++;
  console.log(`PASS ${name}`);
}
const context = { anchorGameDate: "1150.6.12", messageId: 21, speakerId: 1 };
const anchors = (text, anchorGameDate = context.anchorGameDate) => extractTemporalAnchors(text, { ...context, anchorGameDate });
const span = ref => [ref.precision, ref.fromGameDate, ref.toGameDate];
const serial = date => normalizeGameDate(date).serial;
const options = { currentGameDate: "1152.6.12", currentTotalDays: 5000, conversationId: "conversation-a", sceneRevision: "scene-a", turnEpoch: 10 };

test("absolute dates, exact precision and source message proof", () => {
  assert.deepEqual(span(anchors("1145年3月2日开战")[0]), ["day", "1145.3.2", "1145.3.2"]);
  for (const expression of ["1145.3.2", "1145/3/2", "1145-3-2", "1145 年 3 月 2 日"]) {
    const ref = anchors(expression)[0];
    assert.deepEqual(span(ref), ["day", "1145.3.2", "1145.3.2"]);
    assert.equal(ref.expression, expression);
    assert.deepEqual(ref.messageIds, [21]);
    assert.deepEqual(ref.segmentIds, []);
    assert.equal(ref.kind, "event_time");
    assert.equal(ref.source, "deterministic_message_parse");
  }
  assert.deepEqual(span(anchors("1145年3月")[0]), ["month", "1145.3.1", "1145.3.31"]);
  assert.deepEqual(span(anchors("1145年")[0]), ["year", "1145.1.1", "1145.12.31"]);
  assert.deepEqual(span(anchors("3月2日")[0]), ["day", "1150.3.2", "1150.3.2"]);
});

test("Gregorian leap rules and inverse serial at year/month boundaries", () => {
  for (const date of ["1.1.1", "4.2.29", "100.3.1", "400.2.29", "1148.2.29", "1150.12.31", "1200.2.29", "1900.3.1", "2000.2.29", "999999.12.31"]) {
    assert.equal(gameDateFromSerial(serial(date)).canonical, date);
  }
  assert.deepEqual(span(anchors("1148年2月")[0]), ["month", "1148.2.1", "1148.2.29"]);
  assert.deepEqual(span(anchors("1100年2月")[0]), ["month", "1100.2.1", "1100.2.28"]);
  for (const date of ["1145.2.29", "1100.2.29", "1145年4月31日", "1145年13月", "1145年0月", "1145年1月0日", "0年", "1234567年", "1145年123月", "1145年3月200日"]) {
    assert.deepEqual(anchors(date), [], date);
  }
  assert.equal(gameDateFromSerial(serial("1.1.1") - 1), null);
});

test("relative years subtract game years, months are calendar months, days cross leap boundaries", () => {
  assert.equal(anchors("五年前")[0].targetGameYear, 1145);
  assert.equal(anchors("七年前", "1152.1.1")[0].targetGameYear, 1145);
  assert.equal(anchors("去年", "1152.1.1")[0].targetGameYear, 1151);
  assert.equal(anchors("前年", "1152.1.1")[0].targetGameYear, 1150);
  assert.equal(anchors("五年前", "1160.2.29")[0].targetGameYear, 1155);
  assert.equal(anchors("一百零五年前")[0].targetGameYear, 1045);
  assert.deepEqual(span(anchors("三个月前", "1152.1.31")[0]), ["month", "1151.10.1", "1151.10.31"]);
  assert.deepEqual(span(anchors("上个月", "1152.3.31")[0]), ["month", "1152.2.1", "1152.2.29"]);
  assert.deepEqual(span(anchors("一天前", "1152.3.1")[0]), ["day", "1152.2.29", "1152.2.29"]);
  assert.deepEqual(span(anchors("二十天前", "1152.3.1")[0]), ["day", "1152.2.10", "1152.2.10"]);
  assert.equal(anchors("昨天", "1152.1.1")[0].fromGameDate, "1151.12.31");
  assert.equal(anchors("前天", "1151.3.1")[0].fromGameDate, "1151.2.27");
  assert.deepEqual(anchors("0年前，五年前", "3.1.1"), []);
});

test("all nonoverlapping mentions and no manufactured fuzzy years", () => {
  const refs = anchors("1145年3月2日开战，1147年议和，五年前还有1148年2月的旧事。");
  assert.deepEqual(refs.map(ref => ref.expression), ["1145年3月2日", "1147年", "五年前", "1148年2月"]);
  assert.deepEqual(refs.map(ref => ref.targetGameYear), [1145, 1147, 1145, 1148]);
  assert.deepEqual(anchors("很久以前，早些年，当初，年轻时"), []);
  assert.deepEqual(anchors("过去5年，持续3年，1145年间"), []);
  assert.deepEqual(anchors("1145年2月30日，1147年议和").map(ref => ref.targetGameYear), [1147]);
});

test("conversation clauses, event references, ambiguity and hypothetical rejection", () => {
  const refs = anchors("1145年我们聊过战争，1147年发生战争，1148年你告诉过我。");
  assert.deepEqual(refs.map(ref => ref.timeRole), ["past_conversation", "event", "past_conversation"]);
  assert.deepEqual(anchors("1145年我们聊过1142年的战争").map(ref => ref.timeRole), ["past_conversation", "event"]);
  assert.equal(anchors("1145年")[0].timeRole, "event", "bare years are references, not factual confirmation");
  assert.equal(anchors("你记得1145年的战争吗？")[0].timeRole, "event");
  assert.equal(anchors("大概1145年发生战争")[0].timeRole, "unknown");
  assert.equal(anchors("我们谈过1145年")[0].timeRole, "unknown");
  assert.equal(anchors("1145年我们讨论了战争")[0].timeRole, "past_conversation");
  for (const text of ["如果1145年开战", "假如五年前开战，1147年议和", "1145年计划开战", "1145年会开战", "1151年开战", "1150年7月开战", "明年那场战争"]) {
    assert.deepEqual(anchors(text), [], text);
  }
  assert.deepEqual(anchors("如果1145年开战。1147年议和").map(ref => ref.targetGameYear), [1147]);
});

test("message map and metadata validation retain source/ACL proof", () => {
  const map = extractTemporalAnchorsFromMessages([{ id: 21, content: "五年前", name: "玩家" }, { id: 22, content: "1147年" }, { id: 23, content: "无日期" }, { content: "1148年" }], context);
  assert.ok(map instanceof Map);
  assert.deepEqual([...map.keys()], [21, 22, 23]);
  assert.deepEqual(map.get(21)[0].messageIds, [21]);
  assert.deepEqual(map.get(23), []);
  assert.deepEqual(extractTemporalAnchors("1145年", { anchorGameDate: context.anchorGameDate }), []);
  const ref = anchors("1145年")[0];
  assert.deepEqual(normalizeTemporalRefs([ref, ref]), [ref]);
  const normalized = normalizeTemporalRefs([{ ...ref, segmentIds: ["seg-a"], extra: "not persisted" }])[0];
  assert.deepEqual(normalized.segmentIds, ["seg-a"]);
  assert.equal(normalized.extra, undefined);
  normalized.messageIds.push(99);
  assert.deepEqual(ref.messageIds, [21]);
  for (const invalid of [null, {}, { ...ref, source: "model" }, { ...ref, kind: "conversation_time" }, { ...ref, timeRole: "" },
    { ...ref, messageIds: [] }, { ...ref, messageIds: [21, null] }, { ...ref, messageIds: [true] }, { ...ref, segmentIds: [{}] },
    { ...ref, targetGameYear: 1146 }, { ...ref, toGameDate: "1144.12.31" }, { ...ref, fromGameDate: "1145.2.1" }]) {
    assert.deepEqual(normalizeTemporalRefs([invalid]), []);
  }
  assert.deepEqual(normalizeTemporalRefs({ refs: [ref] }), []);
});

test("axis intent is separate from per-clause evidence role", () => {
  assert.equal(resolverAxis, detectTemporalAxisIntent);
  assert.equal(detectTemporalAxisIntent("七年前那场战争"), "EVENT");
  assert.equal(detectTemporalAxisIntent("七年前我们聊了什么"), "CONVERSATION");
  assert.equal(detectTemporalAxisIntent("七年前你跟我说过什么"), "CONVERSATION");
  assert.equal(detectTemporalAxisIntent("七年前我们是不是聊过那场战争"), "MIXED");
  assert.equal(detectTemporalAxisIntent("那一年谁被俘了"), "EVENT");
});

test("query exact windows never expand; totalDays offset and fuzzy API preserved", () => {
  for (const [query, from, to] of [["1148年2月29日", "1148.2.29", "1148.2.29"], ["1148年2月", "1148.2.1", "1148.2.29"],
    ["七年前", "1145.1.1", "1145.12.31"], ["三个月前", "1152.3.1", "1152.3.31"], ["二十天前", "1152.5.23", "1152.5.23"]]) {
    const resolved = resolveTemporalWindow(query, options);
    assert.equal(resolved.triggered, true);
    assert.equal(resolved.mode, "TARGET_DATE");
    assert.deepEqual(resolved.primaryWindow, { fromTotalDays: 5000 + serial(from) - serial(options.currentGameDate), toTotalDays: 5000 + serial(to) - serial(options.currentGameDate) });
    assert.deepEqual(resolved.expansionWindow, resolved.primaryWindow);
  }
  assert.equal(resolveTemporalWindow("1145年2月29日", options).triggered, false);
  assert.equal(resolveTemporalWindow("1145年3月200日", options).triggered, false);
  assert.equal(resolveTemporalWindow("1145年123月", options).triggered, false);
  const fuzzy = resolveTemporalWindow("前些年", options);
  assert.equal(fuzzy.mode, "FUZZY_RECENCY");
  assert.ok(fuzzy.expansionWindow.fromTotalDays < fuzzy.primaryWindow.fromTotalDays);
  assert.equal(resolveTemporalWindow("过去5年", options).mode, "FUZZY_RECENCY");
  assert.equal(resolveTemporalWindow("今天天气如何", options).triggered, false);
});

test("focus proposal is pure, follows anaphora, and replaces explicit dates", () => {
  const first = resolveTemporalFocus("七年前那场战争", null, options);
  assert.equal(first.axisIntent, "EVENT");
  assert.equal(first.focusReused, false);
  assert.equal(first.nextFocus.targetGameYear, 1145);
  const before = JSON.stringify(first.nextFocus);
  const second = resolveTemporalFocus("后来呢", first.nextFocus, { ...options, turnEpoch: 11 });
  assert.equal(second.focusReused, true);
  assert.deepEqual(second.primaryWindow, first.primaryWindow);
  assert.equal(JSON.stringify(first.nextFocus), before);
  assert.equal(second.nextFocus.lastUsedTurn, 11);
  assert.equal(second.nextFocus.establishedTurn, 10);
  assert.equal(resolveTemporalFocus("那一年他是不是被俘了", second.nextFocus, { ...options, turnEpoch: 12 }).targetGameYear, 1145);
  const replaced = resolveTemporalFocus("三年前议和之后呢", second.nextFocus, { ...options, turnEpoch: 12 });
  assert.equal(replaced.focusReused, false);
  assert.equal(replaced.nextFocus.targetGameYear, 1149);
  const conversation = resolveTemporalFocus("七年前我们聊了什么", null, options);
  assert.equal(resolveTemporalFocus("后来呢", conversation.nextFocus, { ...options, turnEpoch: 11 }).axisIntent, "CONVERSATION");
  assert.equal(resolveTemporalFocus("那年谁被俘了", conversation.nextFocus, { ...options, turnEpoch: 11 }).axisIntent, "EVENT");
});

test("focus expiry, scope changes, recent and unrelated turns clear focus", () => {
  const focus = resolveTemporalFocus("七年前", null, options).nextFocus;
  assert.equal(resolveTemporalFocus("之后呢", focus, { ...options, turnEpoch: 13 }).focusReused, true);
  assert.equal(resolveTemporalFocus("之后呢", focus, { ...options, turnEpoch: 11, currentGameDate: "1152.6.13", currentTotalDays: 5001 }).focusReused, true);
  assert.equal(resolveTemporalFocus("之后呢", focus, { ...options, turnEpoch: 11, currentGameDate: "1153.1.1", currentTotalDays: 5203 }).targetGameYear, 1145);
  for (const changed of [{ turnEpoch: 14 }, { turnEpoch: 9 }, { conversationId: "conversation-b" }, { sceneRevision: "scene-b" }, { currentGameDate: null }, { sceneRevision: null }]) {
    const result = resolveTemporalFocus("之后呢", focus, { ...options, ...changed });
    assert.equal(result.focusReused, false);
    assert.equal(result.nextFocus, null);
  }
  for (const query of ["你最近怎么样", "我们聊聊税收", "最近那年有什么事情", "换个话题，后来呢", "1151年2月29日之后呢", "1200年之后呢", "12月之后呢", "五年后那年呢"]) {
    const result = resolveTemporalFocus(query, focus, { ...options, turnEpoch: 11 });
    assert.equal(result.focusReused, false, query);
    assert.equal(result.nextFocus, null, query);
  }
});

test("no current CK3 date or source ID means fail closed, with no OS clock", () => {
  const OriginalDate = global.Date;
  global.Date = class ForbiddenDate { constructor() { throw new Error("OS date forbidden"); } static now() { throw new Error("OS clock forbidden"); } };
  try {
    assert.equal(anchors("五年前")[0].targetGameYear, 1145);
    assert.equal(resolveTemporalFocus("七年前", null, options).targetGameYear, 1145);
    for (const currentGameDate of [null, "", "invalid", "1151.2.29"]) {
      assert.deepEqual(anchors("1145年和五年前", currentGameDate), []);
      const result = resolveTemporalFocus("1145年", null, { ...options, currentGameDate });
      assert.equal(result.triggered, false);
      assert.equal(result.reason, "GAME_DATE_UNAVAILABLE");
      assert.equal(result.nextFocus, null);
    }
  } finally {
    global.Date = OriginalDate;
  }
});

test("missing CK3 date retains requested intent without affecting the legacy window API", () => {
  for (const query of ["七年前那场战争", "1145年3月2日", "1145.3.2", "三个月前", "二十天前", "去年", "前年", "很久以前", "夙昔", "最近", "之后呢", "那一年呢"]) {
    const result = resolveTemporalFocus(query, null, { ...options, currentGameDate: null });
    assert.equal(result.requested, true, query);
    assert.equal(result.triggered, false);
    assert.equal(result.nextFocus, null);
    assert.equal(result.reason, "GAME_DATE_UNAVAILABLE");
  }
  assert.equal(resolveTemporalFocus("谈谈税收", null, { ...options, currentGameDate: null }).requested, false);
  assert.equal(resolveTemporalFocus("花园里的乙后来如何？", null, { ...options, currentGameDate: null }).requested, false);
  assert.deepEqual(resolveTemporalWindow("七年前", { currentTotalDays: 5000 }), { triggered: false, reason: "GAME_DATE_UNAVAILABLE" });
});

console.log(`V8.12.1 temporal anchors: ${groups} groups passed`);
