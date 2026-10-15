"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const ui = require(path.join(root, "src", "app", "renderer", "pair-long-term-ui.js"));
const parser = require(path.join(root, "src", "app", "shared", "pair-important-matters.js"));

function createHarness(api, options = {}) {
  const changes = [];
  const controller = ui.createController(api, {
    mode: "pair",
    ownerId: 77754,
    counterpartId: 12345,
    ownerName: "保罗",
    counterpartName: "赵子绅",
    ...options
  }, state => changes.push(state));
  return { controller, changes };
}

async function testCancelPreviewDoesNotApply() {
  let applyCount = 0;
  const { controller } = createHarness({
    previewPairMemoryBackfill: async () => ({ success: true, writable: true, previewRevision: "pair-rev-1", items: [] }),
    applyPairMemoryBackfill: async () => { applyCount += 1; return { success: true }; }
  });

  await controller.preview();
  controller.cancelPreview();

  assert.strictEqual(applyCount, 0, "cancelling the preview must never call apply");
  assert.strictEqual(controller.state.preview, null);
  assert.match(controller.state.message, /未写入/);
  controller.dispose();
}

async function testConfirmUsesPreviewRevision() {
  let applyPayload;
  const { controller } = createHarness({
    previewPairMemoryBackfill: async () => ({
      success: true,
      writable: true,
      previewRevision: "overall-revision",
      pairs: [{ counterpartId: 12345, previewRevision: "pair-revision" }]
    }),
    applyPairMemoryBackfill: async payload => { applyPayload = payload; return { success: true, totalCount: 4 }; },
    getPairMemoryIndex: async payload => ({ success: true, ...payload, totalCount: 4, items: [] })
  });

  await controller.preview();
  await controller.applySingle();

  assert.strictEqual(applyPayload.previewRevision, "pair-revision");
  assert.strictEqual(applyPayload.ownerId, 77754);
  assert.strictEqual(applyPayload.counterpartId, 12345);
  controller.dispose();
}

async function testStalePreviewIsRebuilt() {
  let previewCount = 0;
  const payloads = [];
  const { controller } = createHarness({
    previewPairMemoryBackfill: async () => {
      previewCount += 1;
      return { success: true, writable: true, previewRevision: `revision-${previewCount}`, items: [] };
    },
    applyPairMemoryBackfill: async payload => {
      payloads.push(payload);
      return { success: false, error: "PAIR_INDEX_PREVIEW_STALE" };
    }
  });

  await controller.preview();
  await controller.applySingle();

  assert.strictEqual(previewCount, 2, "stale confirmation must request a fresh preview");
  assert.strictEqual(payloads[0].previewRevision, "revision-1");
  assert.strictEqual(controller.state.preview.previewRevision, "revision-2");
  assert.match(controller.state.message, /旧预览已过期|过期/);
  controller.dispose();
}

async function testOwnerBatchUsesPerPairRevisionsAndStopsBetweenPairs() {
  let releaseFirst;
  let markStarted;
  const started = new Promise(resolve => { markStarted = resolve; });
  const calls = [];
  const { controller } = createHarness({
    previewPairMemoryBackfill: async () => ({
      success: true,
      writable: true,
      previewRevision: "overall-revision-must-not-be-used",
      pairs: [
        { counterpartId: 101, ownerName: "保罗", counterpartName: "甲", previewRevision: "pair-rev-101" },
        { counterpartId: 202, ownerName: "保罗", counterpartName: "乙", previewRevision: "pair-rev-202" },
        { counterpartId: 303, ownerName: "保罗", counterpartName: "丙", previewRevision: "pair-rev-303" }
      ]
    }),
    applyPairMemoryBackfill: payload => {
      calls.push(payload);
      if (calls.length === 1) {
        markStarted();
        return new Promise(resolve => { releaseFirst = resolve; });
      }
      return Promise.resolve({ success: true });
    }
  }, { mode: "owner", counterpartId: undefined });
  await controller.preview();

  const applying = controller.applyBatch();
  await started;
  controller.cancelBatch();
  releaseFirst({ success: true, totalCount: 2 });
  const result = await applying;

  assert.deepStrictEqual(calls.map(call => call.counterpartId), [101], "cancel should stop before the next pair");
  assert.deepStrictEqual(calls.map(call => call.previewRevision), ["pair-rev-101"], "batch must use each pair's revision");
  assert.strictEqual(result.cancelled, true);
  assert.strictEqual(controller.state.progress.completedPairs, 1);
  assert.strictEqual(controller.state.progress.totalPairs, 3);
  assert.match(controller.state.message, /1\/3/);
  assert.strictEqual(controller.state.result.pairs.length, 1);
  controller.dispose();
}

async function testSourceRevalidationAndFilterPayload() {
  let sourcePayload;
  let listPayload;
  const { controller } = createHarness({
    getPairMemoryIndex: async payload => {
      listPayload = payload;
      return { success: true, ...payload, totalCount: 0, page: payload.page, pageSize: payload.pageSize, items: [] };
    },
    openPairMemorySource: async payload => {
      sourcePayload = payload;
      return { success: false, error: "SOURCE_UNAVAILABLE_OR_STALE" };
    }
  });

  await controller.setFilters("长命锁", "1090.01.01", "1099.12.31");
  await controller.changeSort("oldest");
  await controller.changePage(2);
  await controller.openSource({
    text: "赠予长命锁",
    source: { sourceSummaryKey: "key-1", sourceRevision: "source-rev-1" }
  });

  assert.strictEqual(listPayload.search, "长命锁");
  assert.strictEqual(listPayload.fromDate, "1090.01.01");
  assert.strictEqual(listPayload.toDate, "1099.12.31");
  assert.strictEqual(listPayload.sort, "oldest");
  assert.strictEqual(listPayload.page, 2);
  assert.ok(listPayload.pageSize <= 50);
  assert.strictEqual(sourcePayload.expectedSourceRevision, "source-rev-1");
  assert.strictEqual(sourcePayload.sourceRevision, undefined, "renderer must use the expected revision field");
  assert.strictEqual(controller.state.sourceModal.content, undefined, "stale source text must not be shown from cached ledger data");
  assert.match(controller.state.sourceModal.error, /来源已变化/);
  controller.dispose();
}

async function testVerifiedSourceBodyIsOpened() {
  const verifiedContent = "这段正文来自已验证的 Legacy 摘要。";
  const { controller } = createHarness({
    openPairMemorySource: async payload => ({
      success: true,
      sourceSummaryKey: payload.sourceSummaryKey,
      sourceRevision: payload.expectedSourceRevision,
      summary: { content: verifiedContent, date: "1090.11.10" },
      locator: { summaryIndex: 2, folderName: "保罗", conversationFile: "赵子绅.json" }
    })
  });

  await controller.openSource({ text: "对应事项", source: { sourceSummaryKey: "key-2", sourceRevision: "rev-2" } });

  assert.strictEqual(controller.state.sourceModal.content, verifiedContent);
  assert.strictEqual(controller.state.sourceModal.response.sourceRevision, "rev-2");
  controller.dispose();
}

function testSharedParserAndNameLabels() {
  assert.strictEqual(ui.displayPersonName("12345"), "姓名未载入");
  assert.strictEqual(ui.displayPersonName("ID:12345"), "姓名未载入");
  assert.strictEqual(ui.displayPersonName("赵子绅"), "赵子绅");

  const source = fs.readFileSync(path.join(root, "src", "app", "renderer", "summary-date-order.js"), "utf8");
  const script = source.replace(/^export function /gm, "function ")
    + "\nglobalThis.getSummaryImportantMatters = getSummaryImportantMatters;";
  const withParser = { globalThis: { VOTCPairImportantMatters: parser } };
  vm.runInNewContext(script, withParser, { filename: "summary-date-order.js" });
  assert.strictEqual(
    withParser.globalThis.getSummaryImportantMatters("标题\n【需要长期记住的事项】\n- 未履行的约定\n【其他】\n后文"),
    "未履行的约定",
    "summary UI must use the shared deterministic parser"
  );
  const withoutParser = { globalThis: {} };
  vm.runInNewContext(script, withoutParser, { filename: "summary-date-order.js" });
  assert.strictEqual(withoutParser.globalThis.getSummaryImportantMatters("【需要长期记住的事项】\n- 未知事项"), "", "missing parser global must fail closed without a duplicate parser");

  const html = fs.readFileSync(path.join(root, "src", "app", "renderer", "index.html"), "utf8");
  assert.ok(html.indexOf("../shared/pair-important-matters.js") < html.indexOf("./pair-long-term-ui.js"), "shared parser must load before the new UI module");
  assert.ok(html.indexOf("./pair-long-term-ui.js") < html.indexOf("assets/index-Dn3qWlAB.js"), "pair UI module must load before the bundled React entry");
  assert.ok(html.includes("./pair-long-term-ui.css"), "pair UI stylesheet must be linked");

  const preview = {
    pairs: [
      { ownerName: "保罗", counterpartName: "甲", diagnostics: { skipReasons: { NO_TITLE: 2 } }, pairs: [{ items: [{ text: "事项甲" }] }] },
      { ownerName: "保罗", counterpartName: "乙", diagnostics: { skipReasons: { NO_TITLE: 3 } }, pairs: [{ items: [{ text: "事项乙" }] }] }
    ],
    counts: { scannedSummaryCount: 5, candidateItemCount: 2 }
  };
  assert.deepStrictEqual(ui.getPreviewItems(preview).map(item => [item.text, item.ownerName, item.counterpartName]), [
    ["事项甲", "保罗", "甲"],
    ["事项乙", "保罗", "乙"]
  ]);
  assert.deepStrictEqual(ui.toCountRows(preview).map(row => row.value), [5, 2]);
  assert.deepStrictEqual(ui.toReasonRows(preview), [{ label: "没有事项标题", count: 5 }], "batch skip reasons should be readable and aggregated across pairs");
}

async function main() {
  testSharedParserAndNameLabels();
  await testCancelPreviewDoesNotApply();
  await testConfirmUsesPreviewRevision();
  await testStalePreviewIsRebuilt();
  await testOwnerBatchUsesPerPairRevisionsAndStopsBetweenPairs();
  await testSourceRevalidationAndFilterPayload();
  await testVerifiedSourceBodyIsOpened();
  process.stdout.write("V9.3.5 Pair Memory Renderer UI: PASS\n");
}

main().catch(error => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
