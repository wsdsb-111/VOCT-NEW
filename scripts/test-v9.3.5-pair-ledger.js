"use strict";

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const Module = require("module");
const os = require("os");
const path = require("path");
const PairLongTermLedger = require("../src/app/main/memory-system/pair-long-term-ledger");
const originalResolveFilename = Module._resolveFilename;
const sourceVersionPath = path.resolve(__dirname, "../src/app/main/version.js");
const sourcePackagePath = path.resolve(__dirname, "../src/app/package.json");
Module._resolveFilename = function (request, parent, isMain, options) {
  if (request === "../../package.json" && parent?.filename === sourceVersionPath) return sourcePackagePath;
  return originalResolveFilename.call(this, request, parent, isMain, options);
};
const { MemoryStore } = require("../src/app/main/memory-system/memory-store");
Module._resolveFilename = originalResolveFilename;
const pairMatters = require("../src/app/shared/pair-important-matters");

function summary({ ownerId = 100, counterpartId = 200, campaignToken = "campaign-a", finalizationId,
  date = "1090.2.1", importantMatter, conversationType = "pair", participants, ...extra } = {}) {
  return {
    date,
    totalDays: 100000,
    content: `摘要全文仅供源回查 ${finalizationId}\n\n【需要长期记住的事项】\n- ${importantMatter}\n【其他事项】\n这段完整摘要正文不应写入派生索引。`,
    playerId: ownerId,
    characterId: counterpartId,
    perspectiveOwnerId: ownerId,
    campaignToken,
    finalizationId,
    conversationId: `conversation-${finalizationId}`,
    conversationType,
    participants: participants || [{ id: ownerId }, { id: counterpartId }],
    ...extra
  };
}

function writeSummaries(filePath, values) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(values, null, 2), "utf8");
}

function expectCode(fn, code) {
  assert.throws(fn, error => error?.code === code || error?.message === code);
}

function run() {
  const parsed = pairMatters.parseImportantMatters(
    "前文\n【 需要 长期 记住的事项 】\n- 赵子绅没有承诺送出长命锁，\n  只有在春日宴后才会考虑。\n1) 保罗答应登记礼单。\n【其他事项】\n无"
  );
  assert.equal(parsed.status, "PARSED");
  assert.equal(parsed.items.length, 2);
  assert.match(parsed.items[0].text, /没有承诺/u);
  assert.match(parsed.items[0].text, /只有在春日宴后/u);
  assert.deepEqual(pairMatters.parseImportantMatters("【需要长期记住的事项】\n无特别事项").items, []);
  assert.equal(pairMatters.parseImportantMatters("【需要长期记住的事项】\n没有特别事项").items[0].text, "没有特别事项");
  const ambiguous = pairMatters.parseImportantMatters("【需要长期记住的事项】\n甲在冬日归还钥匙。\n\n乙后来答应保管钥匙。\n【其他】");
  assert.equal(ambiguous.status, "AMBIGUOUS_ITEM_BOUNDARY");
  assert.equal(ambiguous.items.length, 1);
  assert.equal(ambiguous.items[0].ambiguous, true);
  assert.equal(pairMatters.parseImportantMatters("没有标准标题").status, "NO_TITLE");
  assert(pairMatters.searchTerms("未曾失约").includes("未曾"));
  assert(pairMatters.searchTerms("第41项安排").includes("41"), "numbers next to Chinese words retain their own search token");

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "votc-pair-ledger-"));
  const resolvedRoot = path.resolve(tempRoot);
  assert.equal(path.dirname(resolvedRoot), path.resolve(os.tmpdir()));
  assert(path.basename(resolvedRoot).startsWith("votc-pair-ledger-"));
  try {
    const memoryDir = path.join(resolvedRoot, "memory");
    const summaryDir = path.join(resolvedRoot, "summaries");
    const ownerFile = path.join(summaryDir, "100_保罗", "与赵子绅的对话.json");
    const sameDayA = summary({ finalizationId: "same-day-a", importantMatter: "赵子绅将长命锁交给保罗。" });
    const sameDayB = summary({ finalizationId: "same-day-b", importantMatter: "保罗答应替赵子绅保管另一枚戒指。" });
    const monthTwo = summary({ finalizationId: "month-2", date: "1090.2.1", importantMatter: "二月约定在王宫相见。" });
    const monthTen = summary({ finalizationId: "month-10", date: "1090.10.1", importantMatter: "十月约定在边境相见。" });
    const unnumbered = summary({ finalizationId: "ambiguous", date: "1090.11.1",
      content: "摘要全文不应写进派生索引\n【需要长期记住的事项】\n保罗先答应冬日归还长命锁。\n\n后来赵子绅改变主意，要求先行登记。\n【其他事项】" });
    const noCampaign = summary({ finalizationId: "unbound", campaignToken: null, importantMatter: "未绑定战役事项。" });
    const otherCampaign = summary({ finalizationId: "campaign-b", campaignToken: "campaign-b", importantMatter: "另一战役事项。" });
    const otherPair = summary({ finalizationId: "other-pair", counterpartId: 300, importantMatter: "第三人事项。" });
    const noDate = summary({ finalizationId: "no-date", date: "not-a-date", importantMatter: "无日期事项。" });
    const future = summary({ finalizationId: "future", date: "1201.1.1", importantMatter: "未来事项。" });
    const legacyDistinctA = summary({ finalizationId: undefined, date: "1080.1.1", importantMatter: "旧摘要甲记录边境会面。" });
    const legacyDistinctB = summary({ finalizationId: undefined, date: "1080.1.1", importantMatter: "旧摘要乙记录交换礼物。" });
    delete legacyDistinctA.conversationId;
    delete legacyDistinctB.conversationId;
    const bulk = Array.from({ length: 205 }, (_, index) => summary({
      finalizationId: `bulk-${index}`,
      date: `${800 + index}.1.1`,
      importantMatter: `保罗长期记住第${index}项安排。`
    }));
    writeSummaries(ownerFile, [sameDayA, sameDayB, monthTwo, monthTen, unnumbered, legacyDistinctA, legacyDistinctB, noCampaign,
      otherCampaign, otherPair, noDate, future, ...bulk]);
    const legacyDuplicate = summary({ ownerId: 110, counterpartId: 210, campaignToken: "campaign-a",
      finalizationId: undefined, date: "1080.1.1", importantMatter: "相同旧摘要无法确定来源身份。" });
    delete legacyDuplicate.conversationId;
    writeSummaries(path.join(summaryDir, "110_保罗", "与赵子绅的对话.json"), [legacyDuplicate, { ...legacyDuplicate }]);
    writeSummaries(path.join(summaryDir, "200_赵子绅", "与保罗的对话.json"), [summary({
      ownerId: 200, counterpartId: 100, finalizationId: "reverse", importantMatter: "赵子绅的反向视角事项。"
    })]);

    const store = new MemoryStore({ baseDir: memoryDir, summaryFoldersDir: summaryDir });
    const ledger = store.pairLedger;
    const scope = { campaignToken: "campaign-a", ownerId: 100, counterpartId: 200 };
    const ambiguousLegacy = ledger.preview({ campaignToken: "campaign-a", ownerId: 110, counterpartId: 210 }, {
      currentGameDate: "1200.1.1"
    });
    assert.equal(ambiguousLegacy.counts.candidateItemCount, 0);
    assert(ambiguousLegacy.counts.skipReasons.SOURCE_IDENTITY_AMBIGUOUS >= 2,
      "identical legacy records without stable IDs must fail closed");
    const indexFile = ledger.indexPath(scope);
    const previewOnly = ledger.get(scope, { currentGameDate: "1200.1.1", readOnly: true });
    assert(!fs.existsSync(indexFile), "readOnly must not persist an index");
    assert.equal(previewOnly.items.some(item => item.ambiguous), false, "unconfirmed ambiguous items must not be retrievable");

    const preview = ledger.preview(scope, { currentGameDate: "1200.1.1" });
    assert.equal(preview.counts.candidateItemCount, 212);
    assert.equal(preview.counts.scannedSummaryCount, 216);
    assert.equal(preview.pairs[0].items.filter(item => item.ambiguous).length, 1);
    assert(!fs.existsSync(indexFile), "preview must not persist an index");
    ledger.apply(scope, { currentGameDate: "1200.1.1", previewRevision: preview.previewRevision });
    assert(fs.existsSync(indexFile));

    const diskIndex = fs.readFileSync(indexFile, "utf8");
    assert(!diskIndex.includes("摘要全文仅供源回查"));
    assert(!diskIndex.includes("这段完整摘要正文不应写入派生索引"));
    const listed = ledger.get(scope, { currentGameDate: "1200.1.1", page: 0, pageSize: 500 });
    assert.equal(listed.totalCount, 212);
    assert.equal(listed.pageSize, 50);
    assert.equal(listed.items.filter(item => item.ambiguous && item.confirmed).length, 1);
    const legacyItems = ledger.get(scope, { currentGameDate: "1200.1.1", fromDate: "1080.1.1", toDate: "1080.1.1" });
    assert.equal(legacyItems.totalCount, 2, "distinct same-day legacy sources without IDs must remain separately addressable");
    assert.notEqual(legacyItems.items[0].source.sourceSummaryKey, legacyItems.items[1].source.sourceSummaryKey);
    assert.equal(ledger.get(scope, { currentGameDate: "1200.1.1", page: 4, pageSize: 50 }).items.length, 12);
    assert.equal(ledger.get(scope, { currentGameDate: "1200.1.1", search: "未来事项" }).totalCount, 0);
    assert.equal(ledger.get(scope, { currentGameDate: "1200.1.1" }).pageSize, 20);
    const keywordMatch = ledger.get(scope, { currentGameDate: "1200.1.1", search: "保罗 41" });
    assert.equal(keywordMatch.totalCount, 1, "list search must require all query terms, not every item sharing one common name");
    assert.equal(keywordMatch.items[0].source.finalizationId, "bulk-41");
    const numericMatch = ledger.get(scope, { currentGameDate: "1200.1.1", search: "41" });
    assert.equal(numericMatch.totalCount, 1, "numeric search must not match 141 through a substring shortcut");
    assert.equal(numericMatch.items[0].source.finalizationId, "bulk-41");
    assert.equal(ledger.get(scope, { currentGameDate: "1200.1.1", search: "保罗 9999" }).totalCount, 0);
    assert.equal(ledger.get(scope, { currentGameDate: "1200.1.1", search: "鶴" }).totalCount, 0,
      "a single unmatched character must not vacuously match an empty n-gram list");

    const monthItems = ledger.get(scope, { currentGameDate: "1200.1.1", fromDate: "1090.1.1", toDate: "1090.12.31" }).items;
    const monthTwoItem = monthItems.find(item => item.source.finalizationId === "month-2");
    const monthTenItem = monthItems.find(item => item.source.finalizationId === "month-10");
    assert(monthItems.indexOf(monthTenItem) < monthItems.indexOf(monthTwoItem), "newest sorting must compare game-date serials");
    assert(monthItems.some(item => item.source.finalizationId === "same-day-a"));
    assert(monthItems.some(item => item.source.finalizationId === "same-day-b"));

    const sourcePointers = listed.sourceSummaries.filter(source => ["same-day-a", "same-day-b"].includes(source.finalizationId));
    assert.equal(sourcePointers.length, 2);
    assert.notEqual(sourcePointers[0].sourceSummaryKey, sourcePointers[1].sourceSummaryKey);
    for (const pointer of sourcePointers) {
      const resolved = ledger.resolveSource(scope, pointer, { currentGameDate: "1200.1.1" });
      assert.equal(resolved.summary.finalizationId, pointer.finalizationId);
      assert.equal(resolved.locator.relativeSummaryPath, "100_保罗/与赵子绅的对话.json");
    }
    expectCode(() => ledger.resolveSource(scope, {
      ...sourcePointers[0], sourceRevision: crypto.createHash("sha256").update("stale").digest("hex")
    }, { currentGameDate: "1200.1.1" }), "SOURCE_UNAVAILABLE_OR_STALE");

    const otherCampaignItems = ledger.get({ ...scope, campaignToken: "campaign-b" }, { currentGameDate: "1200.1.1" });
    assert.equal(otherCampaignItems.totalCount, 1);
    assert.equal(otherCampaignItems.items[0].text, "另一战役事项。");
    assert.equal(ledger.get({ ...scope, counterpartId: 300 }, { currentGameDate: "1200.1.1" }).totalCount, 1);
    assert.equal(ledger.get({ campaignToken: "campaign-a", ownerId: 200, counterpartId: 100 }, {
      currentGameDate: "1200.1.1"
    }).items[0].text, "赵子绅的反向视角事项。");

    const priorRevision = store.getFolderSummaryRevision(100);
    const changed = JSON.parse(fs.readFileSync(ownerFile, "utf8"));
    changed[0].content = changed[0].content.replace("交给保罗", "赠与保罗");
    writeSummaries(ownerFile, changed);
    assert(store.getFolderSummaryRevision(100) > priorRevision, "external source edits must invalidate the folder revision before engine cache reads");
    expectCode(() => ledger.resolveSource(scope, sourcePointers.find(source => source.finalizationId === "same-day-a"), {
      currentGameDate: "1200.1.1"
    }), "SOURCE_UNAVAILABLE_OR_STALE");
    assert(ledger.get(scope, { currentGameDate: "1200.1.1" }).items.some(item => item.text === "赵子绅将长命锁赠与保罗。"));

    const forgottenSummary = changed.find(source => source.finalizationId === "same-day-b");
    store.recordForgottenSummaryProjection(forgottenSummary, { ownerId: 100, counterpartId: 200 });
    assert.equal(ledger.get(scope, { currentGameDate: "1200.1.1" }).items.some(item => item.source.finalizationId === "same-day-b"), false);

    const stalePreview = ledger.preview(scope, { currentGameDate: "1200.1.1" });
    const appended = JSON.parse(fs.readFileSync(ownerFile, "utf8"));
    appended.push(summary({ finalizationId: "after-preview", date: "1091.1.1", importantMatter: "预览之后新增的事项。" }));
    writeSummaries(ownerFile, appended);
    expectCode(() => ledger.apply(scope, { currentGameDate: "1200.1.1", previewRevision: stalePreview.previewRevision }), "PAIR_INDEX_PREVIEW_STALE");
  } finally {
    fs.rmSync(resolvedRoot, { recursive: true, force: true });
  }
  process.stdout.write("V9.3.5 Pair Ledger tests passed.\n");
}

run();
