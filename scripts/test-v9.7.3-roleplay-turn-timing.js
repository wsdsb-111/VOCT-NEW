"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const { buildTurnTiming, elapsedBand } = require("../src/app/main/memory-system/roleplay-turn-timing");
const { normalizeGameDate } = require("../src/app/main/worldline/character-temporal-facts");
const { createFixture, createPromptRuntime } = require("./fixtures/v9.4/legacy-layout-fixtures");
const { createAdversarialFixtureData, createFixtureEngine, makeCandidateRequest, seedAdversarialFixture } = require("./test-v9.3.6-independent-qa");

const starts = [0, 1, 2, 4, 7, 15, 30, 90, 180, 365];
for (const [i, start] of starts.entries()) {
  assert.equal(elapsedBand(start)[0], start);
  if (i) assert.equal(elapsedBand(start - 1)[0], starts[i - 1]);
}
assert.equal(elapsedBand(1300)[0], 365);
assert.equal(new Set(starts.map(day => elapsedBand(day)[1])).size, 10);

const timing = (content, currentGameDate = "1200.3.1", extra = {}) => buildTurnTiming({
  trustedPlayerTurn: { trusted: true, isCurrent: true, content, conversationId: "current" }, currentGameDate, ...extra
});
assert.equal(timing("今天的茶真香。"), null);
assert.equal(timing("那本书叫《两年》，“多久”是第一个标题。"), null);
assert.equal(timing("那件事办妥了", "wrong"), null);
assert.equal(timing("那件事办妥了", undefined, { trustedPlayerTurn: { trusted: false } }), null);
assert.match(timing("从北京到巴黎的行程要多久？"), /路线、交通方式、季节与难度.*跨大陆行程可能需要数年/u);
assert.match(timing("I’m back."), /若谈到任务进展/u);
const sources = {
  direct: [
    { memory: { eventDate: "1200.2.28", provenance: { conversationId: "old" } } },
    { memory: { eventDate: "1200.2.29", provenance: { sourceLetterId: "letter" } } },
    { memory: { eventDate: "1200.3.2", provenance: { conversationId: "future" } } }
  ],
  items: [{ conversationDate: "1200.2.28", text: "我答应去买红绸，明日交给你。", source: { conversationId: "old" } },
    { conversationDate: "1200.3.2", text: "未来买红绸 FUTURE_SENTINEL", source: { conversationId: "future" } }]
};
const elapsed = timing("红绸买到了。", undefined, sources);
assert.match(elapsed, /共同交谈：2个游戏日.*两三天/u);
assert.match(elapsed, /2月28日的谈话记录（距今2日）.*明日交给你/u);
assert.match(elapsed, /明确肯定回报须按当事人已报告的结果回应/u);
assert.doesNotMatch(elapsed, /FUTURE_SENTINEL/u);
assert.doesNotMatch(timing("上次那件事办得如何？", undefined, { items: [...sources.items,
  { conversationDate: "1200.2.1", text: "承诺修建大桥 UNKNOWN_TASK" }] }), /UNKNOWN_TASK|红绸/u);
assert.doesNotMatch(timing("上次见面是什么时候？", "1200.2.1", sources), /共同交谈/u);

const fixture = createAdversarialFixtureData();
const base = fixture.pairSummaries[0].summaries[0];
const makeSummary = (day, tag, task, counterpart = 1) => ({
  ...base, characterId: counterpart, characterName: counterpart === 1 ? "甲" : "玛蒂尔达",
  participants: [{ id: 2, name: "乙" }, { id: counterpart, name: counterpart === 1 ? "甲" : "玛蒂尔达" }],
  date: day, totalDays: normalizeGameDate(day).serial, conversationId: tag, finalizationId: tag,
  content: "这是一段双方在场的谈话。\n【需要长期记住的事项】\n- " + task
});
fixture.pairSummaries = [
  { ownerId: 2, counterpartId: 1, summaries: [makeSummary("1199.12.30", "cloth", "玩家答应替他买红绸，明日交付。")] },
  { ownerId: 2, counterpartId: 3, summaries: [makeSummary("1199.12.31", "private", "玛蒂尔达答应采购红绸 PRIVATE_SENTINEL。", 3)] }
];
const rig = createFixtureEngine("roleplay-turn-timing");
try {
  seedAdversarialFixture(rig.engine, fixture);
  const cache = new Map();
  const retrieve = overrides => rig.engine.retrieveForResponder(makeCandidateRequest(fixture, "nameOnly", {
    budgetPolicyRevision: "v9.3.9", tokenBudget: 80000, sessionRecallCache: cache, ...overrides
  }));
  const plain = retrieve({ playerContent: "坐下喝茶吧。" });
  const relevant = retrieve({ playerContent: "红绸买到了。", turnEpoch: 2 });
  assert.equal(plain.turnTimingText, undefined);
  assert.match(relevant.turnTimingText, /共同交谈：2个游戏日.*两三天/u);
  assert.match(relevant.turnTimingText, /明日交付/u);
  assert.doesNotMatch(relevant.turnTimingText, /PRIVATE_SENTINEL/u);
  assert.equal(relevant.baselineSnapshotId, plain.baselineSnapshotId);
  assert(relevant.selectedTokens > plain.selectedTokens);
  const wrongCampaign = retrieve({ playerContent: "红绸买到了。", campaignToken: "other-campaign", turnEpoch: 3 });
  assert.doesNotMatch(wrongCampaign.turnTimingText || "", /红绸|共同交谈/u);
  const after = retrieve({ playerContent: "我想喝茶。", turnEpoch: 4 });
  assert.equal(after.turnTimingText, undefined);

  const prompt = createFixture("v813-success-frozen");
  prompt.promptSettings.blocks.find(block => block.type === "examples").enabled = false;
  const runtime = createPromptRuntime(path.resolve(__dirname, "../src/app/main"), prompt);
  const build = (timingText, memoryMode) => runtime.PromptBuilder.buildMessagesWithTokenCount(prompt.history,
    prompt.responder, prompt.gameData, prompt.currentSessionSummary, { ...prompt.memoryContext, turnTimingText: timingText },
    { providerType: "openai-compatible", defaultModel: "deepseek-v4-flash-0731" }, { memoryMode });
  const ordinary = build(undefined);
  const timed = build(relevant.turnTimingText);
  const block = timed.promptPlan.blocks.find(block => block.id === "memory-roleplay-turn-timing");
  assert.equal(block.lifecycle.state, "DYNAMIC");
  assert.deepEqual(ordinary.messages, timed.messages.filter(message => message.content !== relevant.turnTimingText));
  assert.equal(build(relevant.turnTimingText, "exclude").promptPlan.blocks.some(item => item.id === block.id), false);
} finally { rig.cleanup(); }
console.log("PASS roleplay turn timing: all boundaries, dated player/NPC evidence, task estimates, topic gate, campaign isolation and dynamic PromptPlan");
