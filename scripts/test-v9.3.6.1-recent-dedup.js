"use strict";

const assert = require("node:assert/strict");
const {
  createAdversarialFixtureData,
  createFixtureEngine,
  seedAdversarialFixture
} = require("./test-v9.3.6-independent-qa");
const { retrievePairMemorySources } = require("../src/app/main/memory-system/pair-memory-source-retrieval");
const { normalizeGameDate } = require("../src/app/main/worldline/character-temporal-facts");
const { parseImportantMatters } = require("../src/app/shared/pair-important-matters");

const ownerId = 2;
const playerId = 1;
const conversationDate = "1199.1.1";
const repeatedMatter = "RD_REPEATED：乙与甲核对了边境税收账册。";
const nearMatter = "RD_NEAR：乙与甲核对边境税收的账册。";

function makeSummary(fixture, finalizationId, matters) {
  return {
    date: conversationDate,
    totalDays: normalizeGameDate(conversationDate).serial,
    content: `RD_SOURCE_${finalizationId}：合成 Recent1 来源。\n\n【需要长期记住的事项】\n${matters.map(matter => `- ${matter}`).join("\n")}\n【其他事项】\n独立合成 QA。`,
    playerId: ownerId,
    playerName: "乙",
    characterId: playerId,
    characterName: "甲",
    perspectiveOwnerId: ownerId,
    campaignToken: fixture.campaignToken,
    campaignBinding: { status: "bound", source: "qa_fixture", version: 1 },
    finalizationId,
    conversationId: "conversation-" + finalizationId,
    conversationType: "pair",
    participants: [{ id: ownerId, name: "乙" }, { id: playerId, name: "甲" }]
  };
}

function prepareFixture() {
  const fixture = createAdversarialFixtureData();
  fixture.pairSummaries = [{ ownerId, counterpartId: playerId, summaries: [
    makeSummary(fixture, "rd-primary", [repeatedMatter, repeatedMatter, nearMatter]),
    makeSummary(fixture, "rd-same-day-other", [repeatedMatter])
  ] }];
  return fixture;
}

function sourcePointer(item, overrides = {}) {
  return {
    sourceSummaryKey: item.source.sourceSummaryKey,
    sourceRevision: item.source.sourceRevision,
    ...overrides
  };
}

function readIndex(engine, fixture, memories) {
  return engine.store.pairLedger.read({ campaignToken: fixture.campaignToken, ownerId, counterpartId: playerId }, {
    currentGameDate: fixture.currentGameDate,
    currentTotalDays: fixture.currentTotalDays,
    memories,
    readOnly: true
  });
}

function renderActualRecent(engine, memory, visibleMatters) {
  const content = memory.content.replace(
    /【需要长期记住的事项】[\s\S]*?(?=【其他事项】)/u,
    `【需要长期记住的事项】\n${visibleMatters.map(matter => `- ${matter}`).join("\n")}\n`
  );
  const text = engine.formatMemoryBlock("与玩家最近一篇 Legacy 摘要", [{ memory: { ...memory, content } }]);
  return { text, content };
}

function retrieve(engine, fixture, memories, recentSummary, tokenBudget = 50000) {
  return retrievePairMemorySources({
    mode: "PLAYER_BASELINE_LEDGER",
    store: engine.store,
    ownerId,
    counterpartIds: [playerId],
    campaignToken: fixture.campaignToken,
    currentGameDate: fixture.currentGameDate,
    currentTotalDays: fixture.currentTotalDays,
    memories,
    tokenBudget,
    estimateTokens: value => Math.ceil(String(value || "").length / 2),
    recentSummary
  });
}

function run() {
  const fixture = prepareFixture();
  const test = createFixtureEngine("v9361-recent-dedup");
  try {
    seedAdversarialFixture(test.engine, fixture);
    const memories = test.engine.store.loadFolderSummariesForCharacter(ownerId);
    const primaryMemory = memories.find(memory => memory.content.includes("RD_SOURCE_rd-primary"));
    assert(primaryMemory, "the real owner folder must expose the fixture's primary Legacy source");
    const index = readIndex(test.engine, fixture, memories);
    const primaryItems = index.items.filter(item => item.source.finalizationId === "rd-primary");
    const otherSourceItem = index.items.find(item => item.source.finalizationId === "rd-same-day-other");
    assert.deepEqual(primaryItems.map(item => item.source.sourceItemOrdinal), [1, 2, 3]);
    assert(otherSourceItem, "the second same-day Legacy source must have an independent source key");

    const recent = renderActualRecent(test.engine, primaryMemory, [repeatedMatter]);
    const parsedRecent = parseImportantMatters(recent.text).items;
    assert.deepEqual(parsedRecent.map(item => [item.ordinal, item.text]), [[1, repeatedMatter]],
      "fixture must model a Recent1 render truncated after its first complete matter");
    const recentSources = [sourcePointer(primaryItems[0])];
    const result = retrieve(test.engine, fixture, memories, { text: recent.text, sources: recentSources });
    const primaryOne = result.items.find(item => item.source.finalizationId === "rd-primary" && item.source.sourceItemOrdinal === 1);
    const primaryTwo = result.items.find(item => item.source.finalizationId === "rd-primary" && item.source.sourceItemOrdinal === 2);
    const sameDayOther = result.items.find(item => item.source.finalizationId === "rd-same-day-other");
    const primaryThree = result.items.find(item => item.source.finalizationId === "rd-primary" && item.source.sourceItemOrdinal === 3);
    assert.equal(primaryOne?.recentSummaryReference, true, "the complete exact same-source ordinal may be referenced");
    assert.notEqual(primaryTwo?.recentSummaryReference, true, "same text at another ordinal was not rendered and must remain whole");
    assert.notEqual(sameDayOther?.recentSummaryReference, true, "same-day text from another source cannot be collapsed");
    assert.notEqual(primaryThree?.recentSummaryReference, true, "a nearby matter absent from Recent1 must remain whole");
    assert(result.text.includes(primaryTwo.text), "the duplicate ordinal must keep its complete ledger body");
    assert(result.text.includes(sameDayOther.text), "a distinct source must keep its complete ledger body");
    assert(result.text.includes(primaryThree.text), "an unrendered similar matter must keep its complete ledger body");

    const revisionMismatch = retrieve(test.engine, fixture, memories, { text: recent.text,
      sources: [sourcePointer(primaryItems[0], { sourceRevision: "0".repeat(64) })] });
    assert(revisionMismatch.items.every(item => item.recentSummaryReference !== true),
      "same source key with a changed revision cannot authorize dedupe");
    assert(revisionMismatch.text.includes(primaryItems[0].text), "revision mismatch preserves the full matter");

    const keyMismatch = retrieve(test.engine, fixture, memories, { text: recent.text,
      sources: [sourcePointer(primaryItems[0], { sourceSummaryKey: "unrelated-source-key" })] });
    assert(keyMismatch.items.every(item => item.recentSummaryReference !== true),
      "same revision with a different source key cannot authorize dedupe");

    const substringRecent = renderActualRecent(test.engine, primaryMemory, ["RD_REPEATED：乙与甲核对了边境税收"]);
    const substring = retrieve(test.engine, fixture, memories, { text: substringRecent.text, sources: recentSources });
    assert(substring.items.every(item => item.recentSummaryReference !== true),
      "a source truncated inside an item cannot authorize a partial-text reference");
    assert(substring.text.includes(primaryItems[0].text), "a mid-item truncation preserves the complete indexed item");

    const tight = retrieve(test.engine, fixture, memories, { text: recent.text, sources: [] }, 1);
    assert.equal(tight.items.length, 0, "a too-small ledger budget drops a whole item");
    assert.equal(tight.text.includes("详见近期摘要"), false, "budget omission cannot create false Recent1 evidence");
    assert(tight.metrics.omittedItems > 0, "budget omission remains visible in diagnostics");

    console.log("V9.3.6.1 Recent1 dedup: PASS (6 adversarial checks)");
    console.log(JSON.stringify({ exactOrdinal: primaryOne.recentSummaryReference,
      duplicateOrdinalPreserved: !primaryTwo.recentSummaryReference,
      sameDaySourcePreserved: !sameDayOther.recentSummaryReference,
      revisionMismatchPreserved: true, keyMismatchPreserved: true,
      midItemTruncationPreserved: true, tightBudgetOmitsWholeItem: true }));
  } finally {
    test.cleanup();
  }
}

if (require.main === module) {
  try { run(); } catch (error) {
    console.error(error.stack || error.message || error);
    process.exitCode = 1;
  }
}

module.exports = { run };
