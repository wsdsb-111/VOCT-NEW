"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const sourceVersionPath = require.resolve("../src/app/main/version");
require.cache[sourceVersionPath] = { id: sourceVersionPath, filename: sourceVersionPath, loaded: true,
  exports: require("../resources/app/out/main/version") };
const { MemoryEngine } = require("../src/app/main/memory-system/memory-engine");
const { retrievePairMemorySources } = require("../src/app/main/memory-system/pair-memory-source-retrieval");
const { normalizeGameDate } = require("../src/app/main/worldline/character-temporal-facts");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v936-player-ledger-"));
const campaignToken = "qa-v936-player-ledger-campaign";
const currentGameDate = "1200.1.1";
const names = new Map([[1, "甲"], [2, "乙"]]);
let passed = 0;

function check(name, fn) {
  fn();
  passed++;
  console.log("PASS " + name);
}

function makeFixture(name) {
  const baseDir = path.join(root, name, "memory");
  const summaryFoldersDir = path.join(root, name, "summaries");
  for (const [id, characterName] of names) fs.mkdirSync(path.join(summaryFoldersDir, `${id}_${characterName}`), { recursive: true });
  return new MemoryEngine({ baseDir, summaryFoldersDir, trace: { record() {} } });
}

function legacySummary(ownerId, counterpartId, { finalizationId, date = "1190.1.1", matters, narrative = "合成叙事。" } = {}) {
  const dateSerial = normalizeGameDate(date)?.serial;
  return {
    date,
    totalDays: dateSerial,
    content: `${narrative}\n\n【需要长期记住的事项】\n${matters.map(item => `- ${item}`).join("\n")}\n【其他事项】\n合成来源。`,
    playerId: ownerId,
    playerName: names.get(ownerId),
    characterId: counterpartId,
    characterName: names.get(counterpartId),
    perspectiveOwnerId: ownerId,
    campaignToken,
    campaignBinding: { status: "bound", source: "qa_fixture", version: 1 },
    finalizationId,
    conversationId: `conversation-${finalizationId}`,
    conversationType: "pair",
    participants: [{ id: ownerId, name: names.get(ownerId) }, { id: counterpartId, name: names.get(counterpartId) }]
  };
}

function writePairSummaries(engine, ownerId, counterpartId, summaries) {
  const folder = `${ownerId}_${names.get(ownerId)}`;
  const file = path.join(engine.store.summaryFoldersDir, folder, `与${names.get(counterpartId)}的对话.json`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(summaries, null, 2), "utf8");
  return file;
}

function confirmAmbiguousPairItem(engine, ownerId, counterpartId, marker) {
  const summary = legacySummary(ownerId, counterpartId, { finalizationId: marker, matters: [] });
  summary.content = `合成叙事。\n\n【需要长期记住的事项】\n事项边界需要人工确认。\n- ${marker}：双方讨论了税收安排。\n【其他事项】\n合成来源。`;
  writePairSummaries(engine, ownerId, counterpartId, [summary]);
  const scope = { campaignToken, ownerId, counterpartId };
  const options = { currentGameDate, currentTotalDays: normalizeGameDate(currentGameDate).serial,
    memories: engine.store.loadFolderSummariesForCharacter(ownerId) };
  const preview = engine.store.pairLedger.preview(scope, options);
  assert.equal(preview.pairs[0].items.length, 1);
  assert.equal(preview.pairs[0].items[0].ambiguous, true);
  assert.equal(preview.pairs[0].items[0].confirmed, false);
  // The sandbox blocks atomic rename; persist this valid test index without changing the apply logic.
  const originalWriteIndex = engine.store.pairLedger.writeIndex;
  engine.store.pairLedger.writeIndex = (targetScope, index) => {
    const indexPath = engine.store.pairLedger.indexPath(targetScope);
    fs.mkdirSync(path.dirname(indexPath), { recursive: true });
    fs.writeFileSync(indexPath, JSON.stringify(index), "utf8");
  };
  try {
    engine.store.pairLedger.apply(scope, { ...options, previewRevision: preview.previewRevision });
  } finally {
    engine.store.pairLedger.writeIndex = originalWriteIndex;
  }
  engine.store.pairLedger.invalidate([ownerId]);
  const confirmed = engine.store.pairLedger.read(scope, { ...options, readOnly: true });
  assert.equal(confirmed.items.length, 1);
  assert.equal(confirmed.items[0].ambiguous, true);
  assert.equal(confirmed.items[0].confirmed, true);
  return confirmed.items[0];
}

function tokenCount(value) {
  return Math.ceil(String(value || "").length / 2);
}

function retrieve(engine, overrides = {}) {
  const memories = engine.store.loadFolderSummariesForCharacter(2);
  return retrievePairMemorySources({
    mode: "PLAYER_BASELINE_LEDGER",
    store: engine.store,
    ownerId: 2,
    counterpartIds: [1],
    campaignToken,
    currentGameDate,
    currentTotalDays: normalizeGameDate(currentGameDate).serial,
    memories,
    tokenBudget: 100000,
    estimateTokens: tokenCount,
    ...overrides
  });
}

check("full unpaginated player ledger includes more than 16 matters and ignores Recent source exclusion", () => {
  const engine = makeFixture("all-items");
  const matters = Array.from({ length: 55 }, (_, index) => `QA_LEDGER_ITEM_${String(index + 1).padStart(2, "0")}_独特事项。`);
  writePairSummaries(engine, 2, 1, [legacySummary(2, 1, { finalizationId: "fifty-five", matters })]);
  const memories = engine.store.loadFolderSummariesForCharacter(2);
  const fullIndex = engine.store.pairLedger.read({ campaignToken, ownerId: 2, counterpartId: 1 }, {
    currentGameDate, currentTotalDays: normalizeGameDate(currentGameDate).serial, memories, readOnly: true
  });
  assert.equal(fullIndex.items.length, 55);
  let sourceResolveCount = 0;
  engine.store.pairLedger.resolveSource = () => { sourceResolveCount++; throw new Error("baseline must not open Legacy source"); };
  const result = retrieve(engine, { excludedMemoryIds: [fullIndex.items[0].source.sourceMemoryId] });
  assert.equal(result.fallbackStatus, "INDEX_HIT_ITEMS");
  assert.equal(result.legacyFallbackEligible, false);
  assert.equal(result.metrics.totalVisibleItems, 55);
  assert.equal(result.metrics.injectedItems, 55);
  assert.equal(result.metrics.omittedItems, 0);
  assert.equal(result.items.length, 55);
  assert(result.text.includes("QA_LEDGER_ITEM_01_独特事项。"));
  assert(result.text.includes("QA_LEDGER_ITEM_55_独特事项。"));
  assert.equal(sourceResolveCount, 0);
  assert(result.text.includes("谈话记录日期"));
  assert(result.text.includes("承诺或打算不表示已履行"));
});

check("baseline retains an ambiguous matter after the real PairLedger confirmation flow", () => {
  const engine = makeFixture("confirmed-ambiguous-item");
  const confirmedItem = confirmAmbiguousPairItem(engine, 2, 1, "QA_CONFIRMED_AMBIGUOUS_BASELINE");
  const result = retrieve(engine);
  assert.equal(result.metrics.totalVisibleItems, 1);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].itemId, confirmedItem.itemId);
  assert.equal(result.items[0].ambiguous, true);
  assert.equal(result.items[0].confirmed, true);
  assert(result.text.includes("QA_CONFIRMED_AMBIGUOUS_BASELINE"));
});

check("budget fitting keeps whole matters, represents separate years, and is independent of query", () => {
  const engine = makeFixture("budget-fit");
  const matters = [
    "QA_YEAR_1100_" + "旧史事项。".repeat(16),
    "QA_YEAR_1150_" + "中史事项。".repeat(16),
    "QA_YEAR_1190_" + "新史事项。".repeat(16)
  ];
  writePairSummaries(engine, 2, 1, matters.map((matter, index) => legacySummary(2, 1, {
    finalizationId: `year-${index}`, date: ["1100.1.1", "1150.1.1", "1190.1.1"][index], matters: [matter]
  })));
  const twoItemBudget = tokenCount(`【与玩家的长期事项】以下日期是谈话记录日期；事项为当时记录，承诺或打算不表示已履行。\n- 1100.1.1（交谈方式未确定）：${matters[0]}\n- 1190.1.1（交谈方式未确定）：${matters[2]}`);
  const args = { tokenBudget: twoItemBudget };
  const first = retrieve(engine, args);
  const second = retrieve(engine, { ...args, query: "只匹配很久以前的事项" });
  assert.equal(first.fallbackStatus, "BUDGET_OMITTED");
  assert(first.metrics.finalInjectedTokens <= twoItemBudget);
  assert.equal(first.metrics.injectedItems, 2, "the fit favors recent and distant-year representatives when only two fit");
  assert.equal(first.metrics.omittedItems, 1);
  assert.equal(first.metrics.omittedByBudget, 1);
  assert(first.text.includes("QA_YEAR_1190_"));
  assert(first.text.includes("QA_YEAR_1100_"));
  assert(!first.text.includes("QA_YEAR_1150_"));
  assert.equal(first.text, second.text);
  assert.equal(first.metrics.orderDigest, second.metrics.orderDigest);
  for (const selected of first.items) {
    assert(first.text.includes(selected.text), "included matter text must be complete");
    assert(first.text.split("\n").slice(1).some(line => line.endsWith(selected.text)), "each formatted matter line ends with the full item text");
  }
});

check("empty player ledger reports a miss without enabling Legacy fallback", () => {
  const engine = makeFixture("empty-ledger");
  writePairSummaries(engine, 2, 1, [legacySummary(2, 1, { finalizationId: "no-matters", matters: [] })]);
  const result = retrieve(engine);
  assert.equal(result.fallbackStatus, "INDEX_MISS");
  assert.equal(result.legacyFallbackEligible, false);
  assert.equal(result.text, "");
  assert.deepEqual(result.items, []);
  assert.equal(result.metrics.totalVisibleItems, 0);
});

check("missing campaign, date, or player scope fail closed", () => {
  const engine = makeFixture("invalid-input");
  const unbound = retrieve(engine, { campaignToken: "" });
  assert.equal(unbound.fallbackStatus, "CAMPAIGN_UNBOUND");
  const noDate = retrieve(engine, { currentGameDate: null });
  assert.equal(noDate.fallbackStatus, "CURRENT_DATE_REQUIRED");
  const broadScope = retrieve(engine, { counterpartIds: [1, 3] });
  assert.equal(broadScope.fallbackStatus, "IDENTITY_UNRESOLVED");
  for (const result of [unbound, noDate, broadScope]) {
    assert.equal(result.text, "");
    assert.equal(result.legacyFallbackEligible, false);
  }
});

check("source revision changes during baseline construction discard the complete block", () => {
  const engine = makeFixture("source-race");
  writePairSummaries(engine, 2, 1, [legacySummary(2, 1, {
    finalizationId: "source-race", matters: ["QA_SOURCE_RACE_MATTER。"]
  })]);
  const originalRead = engine.store.pairLedger.read.bind(engine.store.pairLedger);
  let calls = 0;
  engine.store.pairLedger.read = (...args) => {
    const result = originalRead(...args);
    calls++;
    return calls === 2 ? { ...result, sourceRevision: "changed-during-build" } : result;
  };
  const result = retrieve(engine);
  assert.equal(calls, 2);
  assert.equal(result.fallbackStatus, "SOURCE_STALE");
  assert.equal(result.text, "");
  assert.deepEqual(result.items, []);
  assert.equal(result.metrics.omittedItems, 1);
  assert.equal(result.legacyFallbackEligible, false);
});

console.log("V9.3.6 player baseline ledger: PASS (" + passed + " checks)");

assert(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep));
fs.rmSync(root, { recursive: true, force: true });
