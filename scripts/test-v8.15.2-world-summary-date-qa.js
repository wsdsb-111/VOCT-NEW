"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createCanonFixture } = require("./v8.7.1-canon-test-fixture");
const { normalizeCanonPayload } = require("../resources/app/out/main/worldline/canon-contract");

function createWorldEditorRenderer() {
  const state = [];
  const refs = [];
  const mountedEffects = new Set();
  let cursor = 0;
  const react = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) }),
    useState(initial) {
      const index = cursor++;
      if (!(index in state)) state[index] = typeof initial === "function" ? initial() : initial;
      return [state[index], value => { state[index] = typeof value === "function" ? value(state[index]) : value; }];
    },
    useRef(initial) {
      const index = cursor++;
      return refs[index] ||= { current: initial };
    },
    useEffect(callback) {
      const index = cursor++;
      if (!mountedEffects.has(index)) {
        mountedEffects.add(index);
        callback();
      }
    }
  };
  return {
    render(WorldMemoryEditor) {
      cursor = 0;
      return WorldMemoryEditor({ react });
    }
  };
}

function findNodes(node, predicate) {
  if (Array.isArray(node)) return node.flatMap(child => findNodes(child, predicate));
  if (!node || typeof node !== "object") return [];
  return [...(predicate(node) ? [node] : []), ...findNodes(node.children || [], predicate)];
}

function getText(node) {
  if (Array.isArray(node)) return node.map(getText).join("");
  if (typeof node === "string" || typeof node === "number") return String(node);
  return node && typeof node === "object" ? getText(node.children || []) : "";
}

function findLabeledControl(tree, labelText, controlType) {
  const label = findNodes(tree, node => node.type === "label" && getText(node).includes(labelText))[0];
  assert(label, `expected form label: ${labelText}`);
  const control = findNodes(label, node => node.type === controlType)[0];
  assert(control, `expected ${controlType} under form label: ${labelText}`);
  return control;
}

async function testWorldMemoryCurrentDatePersistence() {
  const fixture = createCanonFixture({ gameDate: "1175年8月23日", totalDays: 429334 });
  const previousWindow = globalThis.window;
  try {
    const { WorldMemoryEditor } = await import("../resources/app/out/renderer/world-memory-editor.js");
    const requests = [];
    const updates = [];
    let onUpdated = () => {};
    globalThis.window = {
      localStorage: { getItem: () => null },
      worldlineAPI: {
        listCanon: options => fixture.service.list(options),
        listSupplemental: async () => ({ supplemental: [], readOnly: true, legacyCount: 0 }),
        mutateCanon: async request => {
          requests.push(JSON.parse(JSON.stringify(request)));
          const result = await fixture.service.mutate(request);
          if (requests.length === 1) {
            updates.push("checkpoint_active");
            onUpdated({ reason: "checkpoint_active" });
          }
          return result;
        },
        onUpdated: listener => { onUpdated = listener; return () => {}; }
      }
    };
    const renderer = createWorldEditorRenderer();
    let tree = renderer.render(WorldMemoryEditor);
    const openButton = findNodes(tree, node => node.type === "button" && getText(node) === "打开世界记忆")[0];
    await openButton.props.onClick();

    tree = renderer.render(WorldMemoryEditor);
    findLabeledControl(tree, "标题", "input").props.onChange({ target: { value: "当前日期约定" } });
    tree = renderer.render(WorldMemoryEditor);
    findLabeledControl(tree, "希望世界长期记住的内容", "textarea").props.onChange({ target: { value: "韩世忠答应在八月二十三日履行约定" } });
    tree = renderer.render(WorldMemoryEditor);
    const currentSave = findNodes(tree, node => node.type === "button" && getText(node) === "确认新增")[0];
    await currentSave.props.onClick();

    assert.equal(requests[0].payload.temporalMode, "CURRENT_DATE");
    assert.equal(requests[0].payload.gameDate, "1175年8月23日", "the UI submits the displayed current game date");
    assert.deepEqual(updates, ["checkpoint_active"], "the checkpoint notification arrives after the worker writes but before the IPC call returns");
    assert.equal(requests.length, 1, "a successful save is never replayed after the checkpoint notification");
    let page = await fixture.service.list();
    let current = page.records.find(record => record.title === "当前日期约定");
    if (!current) {
      tree = renderer.render(WorldMemoryEditor);
      const errors = findNodes(tree, node => node.props?.role === "alert").map(getText);
      assert.fail(`renderer save was not readable after worker completion: ${JSON.stringify({ request: requests[0], records: page.records, errors })}`);
    }
    assert.equal(current.temporalMode, "CURRENT_DATE");
    assert.equal(current.gameDate, "1175.8.23");
    assert.equal(current.totalDays, 429334);
    tree = renderer.render(WorldMemoryEditor);
    assert(findNodes(tree, node => String(node.props?.className || "").includes("world-memory-record")
      && getText(node).includes("当前日期约定")).length > 0, "the successful result remains visible after the update event refresh");
    assert.equal(findNodes(tree, node => node.props?.role === "alert").length, 0, "a successful refresh must not surface a stale-operation error");

    tree = renderer.render(WorldMemoryEditor);
    findLabeledControl(tree, "标题", "input").props.onChange({ target: { value: "指定日期约定" } });
    tree = renderer.render(WorldMemoryEditor);
    findLabeledControl(tree, "希望世界长期记住的内容", "textarea").props.onChange({ target: { value: "韩世忠答应在指定日期履行约定" } });
    tree = renderer.render(WorldMemoryEditor);
    findLabeledControl(tree, "这件事从什么时候成立？", "select").props.onChange({ target: { value: "SPECIFIC_DATE" } });
    tree = renderer.render(WorldMemoryEditor);
    findLabeledControl(tree, "具体日期", "input").props.onChange({ target: { value: "1175年8月24日" } });
    tree = renderer.render(WorldMemoryEditor);
    const specificSave = findNodes(tree, node => node.type === "button" && getText(node) === "确认新增")[0];
    await specificSave.props.onClick();

    assert.equal(requests[1].payload.temporalMode, "SPECIFIC_DATE");
    assert.equal(requests[1].payload.gameDate, "1175年8月24日");
    page = await fixture.service.list();
    const specific = page.records.find(record => record.title === "指定日期约定");
    assert(specific, "the specified-date save is persisted and readable");
    assert.equal(specific.temporalMode, "SPECIFIC_DATE");
    assert.equal(specific.gameDate, "1175.8.24");
    assert.equal(specific.totalDays, null);

    assert.throws(() => normalizeCanonPayload({ title: "无当前日期", content: "拒绝", temporalMode: "CURRENT_DATE" }, { gameDate: null }),
      /supplemental_current_date_unavailable/);
    assert.throws(() => normalizeCanonPayload({ title: "无效当前日期", content: "拒绝", temporalMode: "CURRENT_DATE" }, { gameDate: "1175年2月31日" }),
      /supplemental_current_date_invalid/);
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
    fixture.dispose();
  }
}

async function testCrossBranchSaveIsNotReplayed() {
  const fixture = createCanonFixture({ gameDate: "1175.1.1", totalDays: 430000 });
  const previousWindow = globalThis.window;
  let onUpdated = () => {};
  const requests = [];
  const updates = [];
  try {
    const { WorldMemoryEditor } = await import("../resources/app/out/renderer/world-memory-editor.js");
    globalThis.window = {
      localStorage: { getItem: () => null },
      worldlineAPI: {
        listCanon: options => fixture.service.list(options),
        listSupplemental: async () => ({ supplemental: [], readOnly: true, legacyCount: 0 }),
        mutateCanon: async request => {
          requests.push(JSON.parse(JSON.stringify(request)));
          const checkpoint = fixture.checkpoint();
          checkpoint.id = "v8152-next-campaign-checkpoint";
          checkpoint.source.path = "C:\\saves\\next-campaign.ck3";
          checkpoint.source.fingerprint = "c".repeat(64);
          checkpoint.snapshot.playthroughId = "v8152-next-campaign";
          checkpoint.snapshot.gameDate = "1175.1.2";
          checkpoint.snapshot.totalDays = 430001;
          for (const reason of ["checkpoint_building", "source_changed"]) {
            updates.push(reason);
            onUpdated({ reason });
          }
          return fixture.service.mutate(request);
        },
        onUpdated: listener => { onUpdated = listener; return () => {}; }
      }
    };
    const originalPage = await fixture.service.list();
    const oldCheckpoint = JSON.parse(JSON.stringify(fixture.checkpoint()));
    const renderer = createWorldEditorRenderer();
    let tree = renderer.render(WorldMemoryEditor);
    await findNodes(tree, node => node.type === "button" && getText(node) === "打开世界记忆")[0].props.onClick();

    tree = renderer.render(WorldMemoryEditor);
    findLabeledControl(tree, "标题", "input").props.onChange({ target: { value: "旧分支草稿不得写入新战役" } });
    tree = renderer.render(WorldMemoryEditor);
    findLabeledControl(tree, "希望世界长期记住的内容", "textarea").props.onChange({ target: { value: "两位人物在宴会上订下共同守城的约定" } });
    tree = renderer.render(WorldMemoryEditor);
    const saveButton = findNodes(tree, node => node.type === "button" && getText(node) === "确认新增")[0];
    await saveButton.props.onClick();

    assert.deepEqual(updates, ["checkpoint_building", "source_changed"]);
    assert.equal(requests.length, 1, "the stale-token save attempt is not replayed against the new branch");
    tree = renderer.render(WorldMemoryEditor);
    const alerts = findNodes(tree, node => node.props?.role === "alert").map(getText);
    assert(alerts.some(message => message.includes("branch_write_blocked_reload_editor")),
      "the stale-token error remains visible after the new branch reload");
    assert.equal(findLabeledControl(tree, "标题", "input").props.value, "", "the previous branch draft is cleared after reload");

    const newBranchPage = await fixture.service.list();
    assert.notEqual(newBranchPage.branch.branchId, originalPage.branch.branchId, "the source change binds reads to a different branch");
    assert.equal(newBranchPage.total, 0, "the stale draft does not appear in the new branch");
    assert.equal(newBranchPage.records.some(record => record.title === "旧分支草稿不得写入新战役"), false);

    Object.assign(fixture.checkpoint(), oldCheckpoint);
    const oldBranchPage = await fixture.service.list();
    assert.equal(oldBranchPage.branch.branchId, originalPage.branch.branchId);
    assert.equal(oldBranchPage.total, 0, "the stale token is rejected before writing the old branch as well");
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
    fixture.dispose();
  }
}

async function testSummaryDisplayOrderingAndSourceIndices() {
  const { getSummaryDisplayEntries } = await import("../resources/app/out/renderer/summary-date-order.js");
  assert.equal(typeof getSummaryDisplayEntries, "function", "the renderer date-order helper is importable as an ES module");

  const source = [
    { date: "1174.12.31", content: "old" },
    { date: "1175年8月23日", content: "same day first" },
    { date: "1175-08-23", content: "same day second" },
    { date: "1175/8/24", content: "newest" },
    { content: "undated" },
    { date: "1175年2月31日", content: "invalid date" },
    { date: "1175.8.23", content: "same day third" }
  ].map(Object.freeze);
  Object.freeze(source);

  const entries = getSummaryDisplayEntries(source);
  assert.deepEqual(entries.map(entry => entry.index), [3, 1, 2, 6, 0, 4, 5],
    "the default date view is newest-first, keeps same-day file order, and puts undated/invalid entries last");
  assert(entries.every(entry => entry.summary === source[entry.index]), "each display entry retains its original summary and file index");
  assert.deepEqual(getSummaryDisplayEntries(source, false).map(entry => entry.index), [0, 1, 2, 3, 4, 5, 6],
    "the unsorted mode returns original file order");

  const rendererRoot = path.join(__dirname, "../resources/app/out/renderer");
  const rendererHtml = fs.readFileSync(path.join(rendererRoot, "index.html"), "utf8");
  const bundlePath = rendererHtml.match(/src=["']\.\/assets\/(index-[^"']+\.js)["']/)?.[1];
  assert(bundlePath, "the shipped renderer bundle is referenced by index.html");
  const renderer = fs.readFileSync(path.join(rendererRoot, "assets", bundlePath), "utf8");
  assert.ok(/getSummaryDisplayEntries/.test(renderer));
  assert.ok(/const \[sortByDate,\s*setSortByDate\] = reactExports\.useState\(true\)/.test(renderer),
    "date sorting is enabled by default so retry reloads still show newest first");
  assert.ok(/"aria-pressed": sortByDate/.test(renderer));
  assert.ok(/onClick: \(\) => setSortByDate\(value => !value\)/.test(renderer),
    "the date button toggles back to original file order");
  assert.ok(/getSummaryDisplayEntries\(metadata\.summaries, sortByDate\)/.test(renderer),
    "the summary list uses a display projection rather than sorting the source records in place");
  assert.ok(/retryFailedSummaries\(\);[\s\S]{0,300}await loadSummaries\(true\);/.test(renderer),
    "retry reloads the source array and the default date projection remains active");
  assert.ok(/handleEditSummary\(metadata, index, summary\.content\)/.test(renderer),
    "edit receives the helper's original file index");
  assert.ok(/handleDeleteSummary\(\s*metadata\.playerId,\s*metadata\.characterId,\s*index\s*\)/.test(renderer),
    "delete receives the helper's original file index");
  assert.ok(/handleRegenerateSummary\(metadata, index, summary\)/.test(renderer),
    "regenerate receives the helper's original file index");
}

async function main() {
  await testWorldMemoryCurrentDatePersistence();
  await testCrossBranchSaveIsNotReplayed();
  await testSummaryDisplayOrderingAndSourceIndices();
  console.log("V8.15.2 world memory and summary date QA: PASS");
}

main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
