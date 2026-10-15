"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { MemoryEngine } = require("../resources/app/out/main/memory-system/memory-engine");
const { normalizeGameDate } = require("../resources/app/out/main/worldline/character-temporal-facts");
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v934-legacy-recall-"));
const campaignToken = "anonymous-legacy-campaign";
const traces = [], observations = [], failures = [];
const engine = new MemoryEngine({ baseDir: path.join(temporary, "memory"), summaryFoldersDir: path.join(temporary, "summaries"),
  trace: { record: (kind, data) => traces.push({ kind, data }) } });
function summary(id, year, content, counterpart = 1) {
  return { playerId: 2, characterId: counterpart, perspectiveOwnerId: 2, playerName: "乙", characterName: counterpart === 1 ? "甲" : "陈将军",
    conversationId: `conversation-${id}`, finalizationId: `final-${id}`, date: `${year}.1.1`, totalDays: normalizeGameDate(`${year}.1.1`).serial,
    engineVersion: "3.0", campaignToken, campaignBinding: { status: "bound" }, content,
    participants: [{ id: 2, name: "乙" }, { id: counterpart, name: counterpart === 1 ? "甲" : "陈将军" }] };
}
const records = [summary("war", 1170, "【详细叙述】甲乙在1170年听闻北境战争停火。乙称这只是使者的传闻，并未见到军队撤退；甲要求待可靠回报再判断结果。【需要长期记住的事项】停火尚待核实。"),
  summary("promise", 1180, "【详细叙述】甲请求乙支援粮草，乙因甲允诺保护村民才答应帮忙；双方约定不征用农户种粮，违约即撤回援助。【需要长期记住的事项】支援以保护村民为条件。"),
  summary("argument", 1190, "【详细叙述】甲乙因擅自调走护卫争吵。乙担心乡民安全，甲解释急援受困家属，最后答应事先协商。【需要长期记住的事项】护卫调遣前须共同商议。"),
  summary("recent-a", 1198, "【详细叙述】甲乙确认村民收成尚可；约定沿用既有粮草支援条件，乙仍重视村民安全。【需要长期记住的事项】保留原有支援条件。"),
  summary("recent-b", 1199, "【详细叙述】甲乙复核护卫安排，乙态度谨慎，甲同意先沟通再调整。【需要长期记住的事项】护卫安排需预先沟通。")];
const otherRecords = [summary("chen-a", 1185, "【详细叙述】乙与陈将军在渡口谈判，陈将军担心船只不足；乙答应核实后商议渡河，尚未决定出兵。【需要长期记住的事项】渡河计划仍有条件。", 3),
  summary("chen-b", 1186, "【详细叙述】乙与陈将军谈及渡河后勤，陈将军坚持保护平民，乙同意先筹备运输。【需要长期记住的事项】后勤筹备未完成。", 3)];
const folder = path.join(engine.store.summaryFoldersDir, "2_乙");
fs.mkdirSync(folder, { recursive: true });
engine.store.writeJson(path.join(folder, "与1的对话.json"), records);
engine.store.writeJson(path.join(folder, "与3的对话.json"), otherRecords);
const snapshots = engine.loadOwnerFolderMemories(2);
const cache = new Map();
const args = { characterId: 2, directCounterpartIds: [1], activeParticipantIds: [1, 2], querySpeakerId: 1,
  campaignToken, conversationId: "current-scene", sceneRevision: 1, currentGameDate: "1200.1.1",
  currentTotalDays: normalizeGameDate("1200.1.1").serial, ownerFolderMemories: snapshots, tokenBudget: 1200,
  memoryEngine3Enabled: true, estimateTokens: text => Math.ceil(String(text).length / 2) };
function observe(name, context) {
  const selected = [...context.direct, ...context.stable, ...context.extra, ...(context.pairMemorySources || [])];
  const injectedText = [context.directStableText, context.stableText, context.temporalExtraText].filter(Boolean).join("\n\n");
  assert(selected.every(row => injectedText.includes(row.memory.content)), "each counted source must appear in its final recall block");
  observations.push({ name, directSummaries: context.direct.filter(row => row.routeKind !== "official").length,
    official: context.direct.filter(row => row.routeKind === "official").length, stable: context.stable.length,
    dynamicExtra: context.extra.length, pairSources: (context.pairMemorySources || []).length,
    temporalExtra: context.extra.filter(row => row.reason?.source === "temporal").length,
    entityExtra: context.extra.filter(row => row.routeKind === "entity_target").length, selectedTokens: context.selectedTokens,
    extraIds: context.extra.map(row => row.memory.memoryId),
    pairSourceIds: (context.pairMemorySources || []).map(row => row.memory.memoryId),
    ids: selected.map(row => row.memory.memoryId), contentHashes: selected.map(row => crypto.createHash("sha256").update(row.memory.content).digest("hex")),
    selectedChars: selected.map(row => row.memory.content.length), budgets: context.routing.budgets,
    injectedBlockHash: crypto.createHash("sha256").update(injectedText).digest("hex"), injectedBlockChars: injectedText.length });
  assert(context.extra.length <= 6);
  assert(context.extra.filter(row => row.reason?.source === "temporal").length <= 3);
  assert(context.extra.filter(row => row.routeKind === "entity_target").length <= 3);
  assert(context.selectedTokens <= context.tokenBudget);
  assert(selected.every(row => row.memory.type === "folder_summary" || row.routeKind === "stable_memory"));
  return context;
}
function check(name, test) {
  try { test(); console.log(`PASS ${name}`); } catch (error) { failures.push(name); console.error(`FAIL ${name}: ${error.message}`); }
}
try {
  check("retired modules never initialize", () => assert.equal(!!engine.memory4, false));
  check("direct pair narrative and additional recall", () => {
    const context = observe("ordinary", engine.retrieveForResponder({ ...args, query: "谈谈村民与护卫安排。", sessionRecallCache: cache, turnEpoch: 1 }));
    assert.equal(context.direct.length, 1);
    assert(context.directStableText.includes("护卫安排"));
    assert(context.extra.length > 0);
    engine.commitDynamicSummaryRecall(2, cache, 1, { providerSucceeded: true, injectedBlockIds: ["memory-temporal-extra"],
      injectedTokens: context.extra.reduce((total, row) => total + row.tokens, 0), injectedMemoryIds: context.extra.map(row => row.memory.memoryId) });
  });
  check("retired flag cannot replace Legacy Extra", () => {
    const context = observe("obsolete-flag", engine.retrieveForResponder({ ...args, query: "当初你为什么答应帮我支援粮草？", memory4RecallEnabled: true, sessionRecallCache: new Map(), turnEpoch: 1 }));
    assert(context.temporalExtraText.includes("保护村民"),
      "the historical promise tail must be injected through dynamic recall, not substituted into frozen Recent1");
    assert(context.extra.length > 0 || context.pairMemorySources.length > 0,
      "the historical Memory4 flag cannot suppress narrative recall from Legacy Extra or an exact Pair Source");
  });
  check("query-prioritized original narrative", () => {
    const context = observe("direct-recollection", engine.retrieveForResponder({ ...args, query: "你还记得我们上次为什么会吵架吗？", sessionRecallCache: new Map(), turnEpoch: 1 }));
    assert(context.temporalExtraText.includes("担心乡民安全"),
      "the argument's query-relevant tail must remain in the dynamic recall block");
  });
  check("time recall keeps hearsay and dates", () => {
    const context = observe("year-1170", engine.retrieveForResponder({ ...args, query: "1170年我们谈过的北境战争结果是什么？", sessionRecallCache: new Map(), turnEpoch: 1 }));
    assert(context.temporal.triggered);
    assert([...context.extra, ...context.pairMemorySources].some(row => row.memory.eventDate === "1170.1.1"));
    assert(context.temporalExtraText.includes("传闻"));
    assert(!context.temporalExtraText.includes("【年度记忆】"));
  });
  check("out-of-scene named person uses authorized summary", () => {
    const context = observe("out-of-scene-chen", engine.retrieveForResponder({ ...args, query: "陈将军当时为何不愿立即渡河？", mentionedEntityIds: [3], explicitTargetEntityIds: [3],
      mentionedEntityNames: { 3: ["陈将军"] }, entityProfiles: [{ id: 1, name: "甲" }, { id: 2, name: "乙" }, { id: 3, name: "陈将军" }], sessionRecallCache: new Map(), turnEpoch: 1 }));
    assert(context.extra.some(row => row.memory.content.includes("陈将军")));
    assert(context.temporalExtraText.includes("船只不足") || context.temporalExtraText.includes("保护平民"));
  });
  check("foreign Campaign and Owner cannot recall", () => {
    const context = observe("foreign-campaign", engine.retrieveForResponder({ ...args, campaignToken: "another-campaign", query: "战争与村民", sessionRecallCache: new Map(), turnEpoch: 1 }));
    assert.equal(context.direct.length + context.extra.length + context.pairMemorySources.length, 0);
    const foreign = engine.retrieveForResponder({ ...args, characterId: 4, query: "村民与陈将军", sessionRecallCache: new Map(), turnEpoch: 1 });
    assert.equal(foreign.direct.length + foreign.extra.length + foreign.pairMemorySources.length, 0);
  });
  check("participant admission refreshes the direct snapshot", () => {
    const admissionCache = new Map();
    const empty = engine.retrieveForResponder({ ...args, directCounterpartIds: [], activeParticipantIds: [2],
      query: "尚未开始交谈", sessionRecallCache: admissionCache, turnEpoch: 1 });
    assert.equal(empty.direct.length, 0);
    const joined = engine.retrieveForResponder({ ...args, query: "谈谈护卫", sessionRecallCache: admissionCache, turnEpoch: 2 });
    assert.equal(joined.direct.length, 1);
  });
  check("unresolved identity cannot borrow a target or dynamic narrative", () => {
    const blocked = engine.retrieveForResponder({ ...args, query: "阿布鲁当时为何渡河？", identityUnresolved: true,
      mentionedEntityIds: [3], explicitTargetEntityIds: [3], sessionRecallCache: new Map(), turnEpoch: 1 });
    assert.equal(blocked.extra.length, 0);
    assert.equal(blocked.pairMemorySources.length, 0);
    assert.equal(blocked.entityTargetRecall.selectedIds.length, 0);
    assert(blocked.temporalExtraText.includes("未能唯一识别"));
  });
  check("success-only Extra commit and multi-turn dedupe", () => {
    const context = observe("next-turn", engine.retrieveForResponder({ ...args, query: "那后来护卫安排怎样了？", sessionRecallCache: cache, turnEpoch: 2 }));
    const previous = new Set([...observations[0].extraIds, ...observations[0].pairSourceIds]);
    assert(context.extra.every(row => !previous.has(row.memory.memoryId)));
    for (let turnEpoch = 3; turnEpoch <= 10; turnEpoch++) engine.retrieveForResponder({ ...args, query: "继续谈谈村民", sessionRecallCache: cache, turnEpoch });
  });
  console.log("LEGACY_RECALL_COUNTS " + JSON.stringify(observations));
  if (failures.length) process.exitCode = 1;
  else console.log("V9.3.4 Legacy recall: PASS");
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
