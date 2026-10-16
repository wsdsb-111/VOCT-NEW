"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const { createAdversarialFixtureData, createFixtureEngine, makeCandidateRequest, seedAdversarialFixture } = require("./test-v9.3.6-independent-qa");
const { normalizeGameDate } = require("../src/app/main/worldline/character-temporal-facts");
const { classifyTemporalIntent } = require("../src/app/main/memory-system/pair-memory-routing");
const { extractTemporalAnchors } = require("../src/app/main/memory-system/temporal-anchor-extractor");

const profiles = [{ id: 1, name: "甲", gender: "male" }, { id: 2, name: "乙", gender: "male", children: [{ id: 3, name: "玛蒂尔达", gender: "male" }] },
  { id: 3, name: "玛蒂尔达", gender: "male", parents: [{ id: 2, name: "乙", gender: "male" }] }, { id: 4, name: "丁大人", gender: "male" }];
function makeFixture() {
  const fixture = createAdversarialFixtureData();
  const template = fixture.pairSummaries.find(pair => pair.ownerId === 2 && pair.counterpartId === 3).summaries[0];
  const summary = (year, count = 1) => ({ ...template, date: year + ".6.1", totalDays: normalizeGameDate(year + ".6.1").serial,
    finalizationId: "integrated-time-" + year, content: "历史谈话。\n【需要长期记住的事项】\n" + Array.from({ length: count }, (_, i) => "- TIME_" + year + "_" + i + "：乙与玛蒂尔达谈过盐税，约定商议边境事务。").join("\n") + "\n【其他事项】\n无。" });
  fixture.pairSummaries = fixture.pairSummaries.filter(pair => !(pair.ownerId === 2 && pair.counterpartId === 3));
  const recent = summary(1199, 24);
  recent.content = recent.content.replace("【其他事项】", "- EVENT_1190：1190年玛蒂尔达发动叛乱，乙记录了当年的经过。\n- EVENT_1199_WEDDING：1199年玛蒂尔达举行婚礼。\n【其他事项】");
  recent.temporalRefs = extractTemporalAnchors("1190年叛乱；1199年婚礼", { anchorGameDate: "1199.6.1", messageId: 1 })
    .map(ref => ({ ...ref, segmentIds: ["synthetic-shared-segment"] }));
  fixture.pairSummaries.push({ ownerId: 2, counterpartId: 3, summaries: [summary(1190), summary(1194), summary(1197), recent, summary(1201)] });
  return fixture;
}
const observations = [];
function runCase(id, fn) {
  try { fn(); observations.push({ id, status: "PASS" }); console.log("PASS " + id); }
  catch (error) { observations.push({ id, status: "FAIL", message: error.message }); console.error("FAIL " + id + ": " + error.message); }
}
function run() {
  const fixture = makeFixture(), test = createFixtureEngine("integrated-time");
  try {
    seedAdversarialFixture(test.engine, fixture);
    const calls = { read: [], resolve: [] }, ledger = test.engine.store.pairLedger;
    for (const [method, bucket] of [["read", "read"], ["resolveSource", "resolve"]]) {
      const original = ledger[method].bind(ledger);
      ledger[method] = (scope, ...args) => { calls[bucket].push(scope); return original(scope, ...args); };
    }
    const retrieve = (query, extra = {}) => {
      calls.read.length = 0; calls.resolve.length = 0;
      const result = test.engine.retrieveForResponder(makeCandidateRequest(fixture, "nameOnly", { playerContent: query, entityProfiles: profiles, ...extra }));
      const level = result.thirdPersonDecision.level;
      const thirdReads = calls.read.filter(scope => scope.counterpartId !== 1), resolves = calls.resolve.filter(scope => scope.counterpartId !== 1);
      assert(calls.read.every(scope => scope.ownerId === 2));
      if (level === "L0") assert.equal(thirdReads.length, 0);
      if (level !== "L2") assert.equal(resolves.length, 0);
      else assert(result.pairMemoryMetrics.totalSourceResolveAttemptCount <= 2);
      assert(result.selectedTokens <= (extra.tokenBudget ?? 50000));
      return result;
    };
    const items = result => result.pairMemoryItems.filter(item => ["third_direct_pair", "third_cross_pair"].includes(item.routeKind));
    const years = result => [...new Set([...items(result).map(item => item.conversationDate),
      ...(result.pairMemorySources || []).filter(source => source.routeKind === "third_person_source")
        .map(source => source.memory.eventDate)].filter(Boolean).map(date => date.split(".")[0]))];
    runCase("T01", () => { const r = retrieve("去年你和玛蒂尔达谈过什么？"); assert.equal(r.thirdPersonDecision.level, "L1"); assert.deepEqual(years(r), ["1199"]); });
    runCase("T02", () => { const r = retrieve("三年前你和玛蒂尔达究竟争论过什么盐税？"); assert.equal(r.thirdPersonDecision.level, "L2"); assert.deepEqual(years(r), ["1197"]); });
    runCase("T03", () => { const r = retrieve("1190年你与玛蒂尔达谈的盐税？"); assert.deepEqual(years(r), ["1190"]); });
    runCase("T04", () => { const r = retrieve("1192年你和玛蒂尔达谈过盐税吗？"); assert.equal(items(r).length, 0); assert.equal(r.pairMemoryMetrics.thirdPersonLegacyFallbackStatus, "TIME_WINDOW_NO_MATCH"); assert(!String(r.temporalExtraText).includes("TIME_1199")); });
    runCase("T05", () => { const r = retrieve("前些年你与玛蒂尔达的关系如何？", { currentGameDate: "1207.1.1", currentTotalDays: normalizeGameDate("1207.1.1").serial }); assert.equal(r.thirdPersonDecision.level, "L1"); assert.deepEqual(years(r).sort(), ["1199", "1201"]); assert.equal(r.pairMemoryMetrics.temporalExpansionUsed, true); });
    runCase("T06", () => { const r = retrieve("去年你和玛蒂尔达谈过什么？"); assert(!String(r.temporalExtraText).includes("CB_PRIVATE_SENTINEL")); assert.deepEqual(r.thirdPersonDecision.targetCharacterIds, [3]); });
    const gameData = { characters: new Map(profiles.map(profile => [profile.id, profile])), getMentionableCharacterProfiles: () => new Map(profiles.map(profile => [profile.id, profile])) };
    runCase("T07", () => { const r = retrieve("你儿子去年说过什么？", { gameData }); assert.equal(r.thirdPersonDecision.level, "L1"); assert.deepEqual(r.thirdPersonDecision.targetCharacterIds, [3]); assert.deepEqual(years(r), ["1199"]); });
    runCase("T08", () => { const duplicate = { ...gameData, characters: new Map(gameData.characters) }; duplicate.characters.set(2, { ...profiles[1], children: [profiles[2], profiles[3]] }); duplicate.getMentionableCharacterProfiles = () => duplicate.characters; const r = retrieve("你儿子去年说过什么？", { gameData: duplicate }); assert.equal(r.thirdPersonDecision.level, "L0"); assert.equal(r.pairMemoryMetrics.targetResolution, "TARGET_AMBIGUOUS"); });
    runCase("T09", () => assert.equal(retrieve("你儿子现在几岁？", { gameData }).thirdPersonDecision.level, "L0"));
    runCase("T10", () => assert.equal(retrieve("去年之后你准备怎么安排玛蒂尔达？").thirdPersonDecision.level, "L0"));
    runCase("T11", () => assert.equal(retrieve("去年玛蒂尔达说了什么？", { trustedPlayerTurn: null }).thirdPersonDecision.level, "L0"));
    runCase("T12", () => { const r = retrieve("1201年你与玛蒂尔达谈过什么？"); assert.equal(items(r).length, 0); assert(!String(r.temporalExtraText).includes("TIME_1201")); });
    runCase("T15", () => { const r = retrieve("去年你和玛蒂尔达谈过什么？", { tokenBudget: 900 }); assert(items(r).length <= 16); assert(r.pairMemoryMetrics.budgetOmittedCount > 0); });
    runCase("T16", () => { ledger.setRetrievalMode("exhaustive-reference"); const a = retrieve("去年你和玛蒂尔达谈过什么？"); ledger.setRetrievalMode("safe-candidate-directory"); const b = retrieve("去年你和玛蒂尔达谈过什么？"); assert.deepEqual(items(a), items(b)); assert.equal(a.temporalExtraText, b.temporalExtraText); });
    runCase("T17", () => { const r = retrieve("去年你和玛蒂尔达谈过什么？"); assert(String(r.temporalExtraText).includes("日期是谈话记录日期")); assert(String(r.temporalExtraText).includes("不表示已履行")); });
    runCase("T18", () => { const cache = new Map(), hashes = Array.from({ length: 3 }, () => crypto.createHash("sha256").update(String(retrieve("去年你和玛蒂尔达谈过什么？", { sessionRecallCache: cache }).temporalExtraText)).digest("hex")); assert.equal(new Set(hashes).size, 1); });
    runCase("T19-event-axis", () => { const r = retrieve("1190年玛蒂尔达发动的叛乱，具体经过是什么？"); assert(String(r.temporalExtraText).includes("EVENT_1190")); assert(!String(r.temporalExtraText).includes("TIME_1190")); });
    runCase("T20-event-not-conversation-date", () => { const r = retrieve("1199年玛蒂尔达发动的叛乱，具体经过是什么？"); assert(!String(r.temporalExtraText).includes("EVENT_1190")); });
    runCase("I03", () => assert.equal(classifyTemporalIntent("审判之后你们有没有再见面？").kind, "PAST_HISTORY"));
    runCase("I04", () => assert.equal(classifyTemporalIntent("继承纠纷结束以后，你们的关系有什么变化？").kind, "PAST_HISTORY"));
  } finally { test.cleanup(); }
  fs.writeFileSync(".build/v9363i-temporal-evidence.json", JSON.stringify({ synthetic: true, observations }, null, 2));
  assert(observations.every(row => row.status === "PASS"), "temporal/kinship matrix failed");
  console.log("PASS integrated temporal/kinship: " + observations.length);
}
if (require.main === module) run();
module.exports = { makeFixture, run };
