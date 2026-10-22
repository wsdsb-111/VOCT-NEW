"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { pathToFileURL } = require("node:url");
const i18next = require("../resources/app/node_modules/i18next");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "src/app/renderer/world-memory-editor.js"), "utf8")
  .replace("export function WorldMemoryEditor", "function WorldMemoryEditor");

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => { resolve = resolvePromise; reject = rejectPromise; });
  return { promise, resolve, reject };
}

function createRenderer(api, { developerMode = false } = {}) {
  const fibers = new Map();
  let currentFiber = null;
  let hookIndex = 0;
  let scheduledEffects = [];
  let activeFibers = new Set();
  let tree = null;
  let translator = undefined;
  const react = {
    Fragment: "fragment",
    createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) }),
    useState(initial) {
      const fiber = currentFiber;
      const index = hookIndex++;
      if (!fiber.hooks[index]) fiber.hooks[index] = { value: typeof initial === "function" ? initial() : initial };
      const slot = fiber.hooks[index];
      return [slot.value, value => { slot.value = typeof value === "function" ? value(slot.value) : value; }];
    },
    useRef(initial) {
      const fiber = currentFiber;
      const index = hookIndex++;
      if (!fiber.hooks[index]) fiber.hooks[index] = { value: { current: initial } };
      return fiber.hooks[index].value;
    },
    useEffect(callback, dependencies) {
      const fiber = currentFiber;
      const index = hookIndex++;
      const slot = fiber.hooks[index] || (fiber.hooks[index] = {});
      const changed = !slot.initialized || dependencies.some((value, position) => value !== slot.dependencies[position]);
      if (changed) {
        slot.initialized = true;
        slot.dependencies = dependencies;
        scheduledEffects.push(() => { slot.cleanup?.(); slot.cleanup = callback(); });
      }
    }
  };
  const sandbox = {
    window: { worldlineAPI: api, localStorage: { getItem: key => key === "votc-developer-mode" && developerMode ? "true" : null }, confirm: () => false },
    console
  };
  vm.runInNewContext(source + "\nthis.component = WorldMemoryEditor;", sandbox, { filename: "world-memory-editor.js" });

  function renderNode(node, key) {
    if (node == null || typeof node === "boolean") return null;
    if (Array.isArray(node)) return node.map((item, index) => renderNode(item, `${key}.${index}`)).filter(Boolean);
    if (typeof node !== "object") return node;
    if (typeof node.type === "function") {
      const fiber = fibers.get(key) || { hooks: [], mounted: false };
      fibers.set(key, fiber);
      activeFibers.add(key);
      fiber.mounted = true;
      const previousFiber = currentFiber;
      const previousIndex = hookIndex;
      currentFiber = fiber;
      hookIndex = 0;
      const rendered = node.type({ ...node.props, children: node.children });
      currentFiber = previousFiber;
      hookIndex = previousIndex;
      return renderNode(rendered, `${key}.render`);
    }
    return { ...node, children: (node.children || []).map((child, index) => renderNode(child, `${key}.${index}`)).filter(child => child !== null) };
  }

  function render() {
    activeFibers = new Set();
    scheduledEffects = [];
    tree = renderNode({ type: sandbox.component, props: { react, t: translator }, children: [] }, "root");
    for (const [key, fiber] of fibers) {
      if (activeFibers.has(key)) continue;
      fiber.mounted = false;
      for (const slot of fiber.hooks) slot?.cleanup?.();
      fibers.delete(key);
    }
    for (const effect of scheduledEffects) effect();
    return tree;
  }

  return {
    render(nextTranslator) {
      if (arguments.length) translator = nextTranslator;
      return render();
    },
    get tree() { return tree; },
    async flush() { await Promise.resolve(); await Promise.resolve(); return render(); },
    unmount() {
      for (const fiber of fibers.values()) {
        fiber.mounted = false;
        for (const slot of fiber.hooks) slot?.cleanup?.();
      }
      fibers.clear();
    }
  };
}

function nodes(node, predicate) {
  if (node == null || typeof node !== "object") return [];
  return [...(predicate(node) ? [node] : []), ...(node.children || []).flatMap(child => nodes(child, predicate))];
}

function text(node) {
  if (node == null) return "";
  if (typeof node !== "object") return String(node);
  return (node.children || []).map(text).join("");
}

function button(tree, label, within = tree) {
  const found = nodes(within, node => node.type === "button" && text(node) === label)[0];
  assert(found, `button missing: ${label}`);
  return found;
}

function recordArticle(tree, recordId) {
  const found = nodes(tree, node => node.props.className?.startsWith("world-memory-record ") && text(node).includes(recordId))[0];
  assert(found, `record article missing: ${recordId}`);
  return found;
}

function memoryRecord(recordId, title) {
  return { recordId, title, content: `${title}正文`, status: "ACTIVE", revision: 1, type: "PLAYER_CANON", visibility: "PUBLIC_WORLD", importance: "NORMAL", temporalMode: "TIMELESS", entities: [], knownBy: [], branchId: "branch-a" };
}

function makeData(branchToken = "token-a") {
  return {
    success: true,
    branch: { campaignId: "campaign-a", branchId: "branch-a", token: branchToken, state: "BOUND", gameDate: "1066.1.1" },
    promptEnabled: true,
    total: 2,
    offset: 0,
    records: [memoryRecord("record-a", "记忆甲"), memoryRecord("record-b", "记忆乙")],
    renameCandidates: [],
    revision: 1
  };
}

async function testPickerSearchWinsOverInitialLoad() {
  const initial = deferred();
  const search = deferred();
  let emptyCalls = 0;
  const api = {
    onUpdated: () => () => {},
    listCanon: async () => makeData(),
    listSupplemental: async () => ({ supplemental: [], readOnly: true, legacyCount: 0 }),
    listCanonCharacterOptions: payload => {
      if (!payload.query) return ++emptyCalls === 1
        ? Promise.resolve({ options: [{ runtimeId: "form-npc", displayName: "表单人物" }] })
        : initial.promise;
      return search.promise;
    },
    testCanonRecall: async () => ({ matched: true, reason: "RELEVANT_TEXT_MATCH", visibility: "ALLOW", temporal: "SAFE", branch: "MATCH", currentTruth: "OK", tokens: 3 })
  };
  const renderer = createRenderer(api);
  renderer.render();
  await button(renderer.tree, "打开世界记忆").props.onClick();
  renderer.render();
  const article = recordArticle(renderer.tree, "记忆甲");
  button(renderer.tree, "测试这条记忆", article).props.onClick();
  renderer.render();
  const panel = nodes(renderer.tree, node => node.props.className === "world-memory-test-panel")[0];
  const searchInput = nodes(panel, node => node.type === "input" && node.props.placeholder === "搜索人物姓名")[0];
  searchInput.props.onChange({ target: { value: "较新查询" } });
  renderer.render();
  const searchingPanel = nodes(renderer.tree, node => node.props.className === "world-memory-test-panel")[0];
  const pendingSearch = button(renderer.tree, "搜索", searchingPanel).props.onClick();
  search.resolve({ options: [{ runtimeId: "new-npc", displayName: "最新 NPC" }] });
  await pendingSearch;
  renderer.render();
  initial.resolve({ options: [{ runtimeId: "old-npc", displayName: "旧 NPC" }] });
  await renderer.flush();
  const finalPanel = nodes(renderer.tree, node => node.props.className === "world-memory-test-panel")[0];
  assert(text(finalPanel).includes("最新 NPC"), "a completed search must remain visible after the older initial list resolves");
  assert(!text(finalPanel).includes("旧 NPC"), "the late initial list must not replace the search result");
  renderer.unmount();
}

async function testRecallResultIsBoundToRecordAndClose() {
  const requests = [];
  let emptyCalls = 0;
  const api = {
    onUpdated: () => () => {},
    listCanon: async () => makeData(),
    listSupplemental: async () => ({ supplemental: [], readOnly: true, legacyCount: 0 }),
    listCanonCharacterOptions: payload => !payload.query && ++emptyCalls === 1
      ? Promise.resolve({ options: [{ runtimeId: "npc", displayName: "测试 NPC" }] })
      : Promise.resolve({ options: [{ runtimeId: "npc", displayName: "测试 NPC" }] }),
    testCanonRecall: payload => {
      const request = deferred();
      requests.push({ payload, ...request });
      return request.promise;
    }
  };
  const renderer = createRenderer(api);
  renderer.render();
  await button(renderer.tree, "打开世界记忆").props.onClick();
  renderer.render();
  await renderer.flush();

  const articleA = recordArticle(renderer.tree, "记忆甲");
  button(renderer.tree, "测试这条记忆", articleA).props.onClick();
  renderer.render();
  await renderer.flush();
  let panel = nodes(renderer.tree, node => node.props.className === "world-memory-test-panel")[0];
  button(renderer.tree, "测试 NPC", panel).props.onClick();
  renderer.render();
  panel = nodes(renderer.tree, node => node.props.className === "world-memory-test-panel")[0];
  const pendingA = button(renderer.tree, "运行召回测试", panel).props.onClick();
  assert.strictEqual(requests[0].payload.recordId, "record-a");
  assert.strictEqual(requests[0].payload.token, "token-a");

  const articleB = recordArticle(renderer.tree, "记忆乙");
  button(renderer.tree, "测试这条记忆", articleB).props.onClick();
  renderer.render();
  await renderer.flush();
  panel = nodes(renderer.tree, node => node.props.className === "world-memory-test-panel")[0];
  button(renderer.tree, "测试 NPC", panel).props.onClick();
  renderer.render();
  panel = nodes(renderer.tree, node => node.props.className === "world-memory-test-panel")[0];
  requests[0].resolve({ matched: true, reason: "RELEVANT_TEXT_MATCH", visibility: "ALLOW", temporal: "SAFE", branch: "MATCH", currentTruth: "OK", tokens: 3, promptText: "过期的记忆甲结果" });
  await pendingA;
  renderer.render();
  assert(!text(renderer.tree).includes("过期的记忆甲结果"), "a recall result for record A cannot appear in record B's panel");

  const pendingB = button(renderer.tree, "运行召回测试", panel).props.onClick();
  assert.strictEqual(requests[1].payload.recordId, "record-b");
  requests[1].resolve({ matched: true, reason: "RELEVANT_TEXT_MATCH", visibility: "ALLOW", temporal: "SAFE", branch: "MATCH", currentTruth: "OK", tokens: 3, promptText: "记忆乙结果" });
  await pendingB;
  renderer.render();
  assert(text(renderer.tree).includes("记忆乙结果"), "the current record's completed result remains visible");

  const articleAAgain = recordArticle(renderer.tree, "记忆甲");
  button(renderer.tree, "测试这条记忆", articleAAgain).props.onClick();
  renderer.render();
  await renderer.flush();
  panel = nodes(renderer.tree, node => node.props.className === "world-memory-test-panel")[0];
  button(renderer.tree, "测试 NPC", panel).props.onClick();
  renderer.render();
  panel = nodes(renderer.tree, node => node.props.className === "world-memory-test-panel")[0];
  const pendingClose = button(renderer.tree, "运行召回测试", panel).props.onClick();
  const closePanel = nodes(renderer.tree, node => node.props.className === "world-memory-test-panel")[0];
  button(renderer.tree, "关闭", closePanel).props.onClick();
  renderer.render();
  requests[2].resolve({ matched: true, reason: "RELEVANT_TEXT_MATCH", visibility: "ALLOW", temporal: "SAFE", branch: "MATCH", currentTruth: "OK", tokens: 3, promptText: "关闭后的结果" });
  await pendingClose;
  renderer.render();
  assert(!text(renderer.tree).includes("关闭后的结果"), "closing the test panel invalidates its pending recall result");
  renderer.unmount();
}

async function testBranchReloadInvalidatesRecall() {
  const requests = [];
  let branchToken = "token-a";
  let emptyCalls = 0;
  const api = {
    onUpdated: () => () => {},
    listCanon: async () => makeData(branchToken),
    listSupplemental: async () => ({ supplemental: [], readOnly: true, legacyCount: 0 }),
    listCanonCharacterOptions: () => ++emptyCalls === 1
      ? Promise.resolve({ options: [{ runtimeId: "npc", displayName: "测试 NPC" }] })
      : Promise.resolve({ options: [{ runtimeId: "npc", displayName: "测试 NPC" }] }),
    testCanonRecall: payload => {
      const request = deferred();
      requests.push({ payload, ...request });
      return request.promise;
    }
  };
  const renderer = createRenderer(api);
  renderer.render();
  await button(renderer.tree, "打开世界记忆").props.onClick();
  renderer.render();
  await renderer.flush();
  const article = recordArticle(renderer.tree, "记忆甲");
  button(renderer.tree, "测试这条记忆", article).props.onClick();
  renderer.render();
  await renderer.flush();
  let panel = nodes(renderer.tree, node => node.props.className === "world-memory-test-panel")[0];
  button(renderer.tree, "测试 NPC", panel).props.onClick();
  renderer.render();
  panel = nodes(renderer.tree, node => node.props.className === "world-memory-test-panel")[0];
  const pending = button(renderer.tree, "运行召回测试", panel).props.onClick();

  branchToken = "token-b";
  await button(renderer.tree, "刷新").props.onClick();
  renderer.render();
  assert.strictEqual(requests[0].payload.token, "token-a");
  requests[0].resolve({ matched: true, reason: "RELEVANT_TEXT_MATCH", visibility: "ALLOW", temporal: "SAFE", branch: "MATCH", currentTruth: "OK", tokens: 3, promptText: "旧分支结果" });
  await pending;
  renderer.render();
  assert(!text(renderer.tree).includes("旧分支结果"), "a test result cannot cross a branch reload");
  assert(!nodes(renderer.tree, node => node.props.className === "world-memory-test-panel").length, "branch reload closes the old test panel");
  renderer.unmount();
}

async function createEditorTranslators() {
  const moduleUrl = pathToFileURL(path.join(root, "src/app/renderer/v95/i18n/index.js")).href;
  const { createUiTranslator } = await import(moduleUrl);
  const instance = i18next.createInstance();
  await instance.init({ lng: "en-US", fallbackLng: "zh-CN", initImmediate: false, interpolation: { escapeValue: false } });
  return { en: createUiTranslator(instance, "en-US"), zh: createUiTranslator(instance, "zh-CN") };
}

function labeledField(tree, label, controlType) {
  const field = nodes(tree, node => node.type === "label" && text(node.children?.[0]) === label)[0];
  assert.ok(field, `field label missing: ${label}`);
  const control = nodes(field, node => node.type === controlType)[0];
  assert.ok(control, `${controlType} missing for field: ${label}`);
  return control;
}

async function testWorldMemoryLanguageRerender(translators) {
  const calls = { canon: 0, supplemental: 0, picker: 0, write: 0 };
  const data = makeData();
  data.records = [{ ...memoryRecord("fact-record", "Mara Venn"), content: "Mara Venn's council met at the river crossing." }];
  const api = {
    onUpdated: () => () => {},
    async listCanon() { calls.canon++; return data; },
    async listSupplemental() { calls.supplemental++; return { supplemental: [], readOnly: true, legacyCount: 0 }; },
    async listCanonCharacterOptions() { calls.picker++; return { options: [] }; },
    async mutateCanon() { calls.write++; throw new Error("unexpected world-memory write"); }
  };
  const renderer = createRenderer(api, { developerMode: true });
  renderer.render(translators.en);
  try {
    await button(renderer.tree, "Open world memory").props.onClick();
    renderer.render();
    await renderer.flush();
    assert.ok(text(renderer.tree).includes("World Memory"));
    assert.ok(text(renderer.tree).includes("Memory type"));
    assert.ok(nodes(renderer.tree, node => node.type === "input" && node.props.placeholder === "Search character names").length > 0);
    assert.ok(text(renderer.tree).includes("Record: fact-record"));
    assert.ok(text(renderer.tree).includes("Mara Venn"), "record names remain factual source text");
    assert.ok(text(renderer.tree).includes("Mara Venn's council met at the river crossing."), "Canon memory content remains unchanged");

    button(renderer.tree, "Start from a template").props.onClick();
    renderer.render();
    button(renderer.tree, "An event not recorded by CK3").props.onClick();
    renderer.render();
    const sampleText = "发生了什么、涉及谁，以及事件带来的长期影响。";
    assert.equal(labeledField(renderer.tree, "Content the world should remember", "textarea").props.value, sampleText, "template sample content stays in its source language");
    const beforeTemplateLanguageChange = { ...calls };
    renderer.render(translators.zh);
    assert.equal(labeledField(renderer.tree, "希望世界长期记住的内容", "textarea").props.value, sampleText);
    renderer.render(translators.en);
    assert.equal(labeledField(renderer.tree, "Content the world should remember", "textarea").props.value, sampleText);
    assert.deepEqual(calls, beforeTemplateLanguageChange, "changing template language must not repeat IPC");

    labeledField(renderer.tree, "Title", "input").props.onChange({ target: { value: "Unsaved draft title" } });
    renderer.render();
    labeledField(renderer.tree, "Content the world should remember", "textarea").props.onChange({ target: { value: "Unsaved draft body" } });
    renderer.render();
    const beforeLanguageChange = { ...calls };

    renderer.render(translators.zh);
    assert.ok(text(renderer.tree).includes("世界记忆"), "the same mounted component should render Chinese UI after the translator changes");
    assert.ok(text(renderer.tree).includes("记忆类型"));
    assert.ok(nodes(renderer.tree, node => node.type === "input" && node.props.placeholder === "搜索人物姓名").length > 0);
    assert.ok(text(renderer.tree).includes("记录：fact-record"));
    assert.ok(text(renderer.tree).includes("Mara Venn"));
    assert.ok(text(renderer.tree).includes("Mara Venn's council met at the river crossing."));
    assert.equal(labeledField(renderer.tree, "标题", "input").props.value, "Unsaved draft title", "the title draft should survive a locale rerender");
    assert.equal(labeledField(renderer.tree, "希望世界长期记住的内容", "textarea").props.value, "Unsaved draft body", "the body draft should survive a locale rerender");
    renderer.render(translators.en);
    assert.ok(text(renderer.tree).includes("World Memory"));
    assert.equal(labeledField(renderer.tree, "Title", "input").props.value, "Unsaved draft title");
    assert.equal(labeledField(renderer.tree, "Content the world should remember", "textarea").props.value, "Unsaved draft body");
    assert.deepEqual(calls, beforeLanguageChange, "changing languages must not reload, write, or otherwise repeat IPC");
    assert.ok(!text(renderer.tree).includes("Unavailable"), "rendered UI copy should resolve through the English catalog");
  } finally {
    renderer.unmount();
  }
}

async function testWorldMemoryUnknownErrorIsSafe(translators) {
  const secretPath = "C:\\private\\api-token.json";
  const api = {
    onUpdated: () => () => {},
    async listCanon() { throw new Error(`UNKNOWN_ERROR ${secretPath}`); },
    async listSupplemental() { return { supplemental: [], readOnly: true, legacyCount: 0 }; }
  };
  const renderer = createRenderer(api);
  renderer.render(translators.en);
  try {
    await button(renderer.tree, "Open world memory").props.onClick();
    renderer.render();
    assert.ok(text(renderer.tree).includes(translators.en("worldMemoryEditor.errors.generic")));
    assert.ok(!text(renderer.tree).includes(secretPath), "unknown IPC details and paths must not reach either error area");
    renderer.render(translators.zh);
    assert.ok(text(renderer.tree).includes(translators.zh("worldMemoryEditor.errors.generic")));
    assert.ok(!text(renderer.tree).includes(secretPath));
  } finally {
    renderer.unmount();
  }
}

async function main() {
  const translators = await createEditorTranslators();
  await testPickerSearchWinsOverInitialLoad();
  await testRecallResultIsBoundToRecordAndClose();
  await testBranchReloadInvalidatesRecall();
  await testWorldMemoryLanguageRerender(translators);
  await testWorldMemoryUnknownErrorIsSafe(translators);
  console.log("V9.5 Legacy UI async sequencing and i18n: PASS");
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
