"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function createRenderer(api, ownerId = 1, diagnostics = []) {
  const slots = [], effects = [];
  let cursor = 0, tree;
  const react = {
    Fragment: "fragment",
    createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) }),
    useState(initial) {
      const index = cursor++;
      if (!slots[index]) slots[index] = { value: initial };
      return [slots[index].value, value => { slots[index].value = typeof value === "function" ? value(slots[index].value) : value; }];
    },
    useRef(initial) {
      const index = cursor++;
      return slots[index] ||= { current: initial };
    },
    useEffect(callback, dependencies) {
      const index = cursor++;
      if (!slots[index] || dependencies.some((value, position) => value !== slots[index].dependencies[position])) {
        slots[index]?.cleanup?.();
        slots[index] = { dependencies };
        effects.push(() => { slots[index].cleanup = callback(); });
      }
    }
  };
  const sandbox = { window: { conversationAPI: api, confirm: () => false }, console: { debug: (...args) => diagnostics.push(args) },
    setTimeout, clearTimeout };
  const source = fs.readFileSync(path.join(__dirname, "../resources/app/out/renderer/memory4-manager.js"), "utf8")
    .replace("export function Memory4Manager", "function Memory4Manager");
  vm.runInNewContext(`${source}\nthis.component = Memory4Manager;`, sandbox);
  const render = () => {
    cursor = 0;
    tree = sandbox.component({ react, ownerId, refreshKey: 0 });
    while (effects.length) effects.shift()();
    return tree;
  };
  const flush = async () => { await new Promise(resolve => setImmediate(resolve)); return render(); };
  return { render, flush, get tree() { return tree; } };
}

function nodes(node, predicate) {
  if (!node || typeof node !== "object") return [];
  return [...(predicate(node) ? [node] : []), ...(node.children || []).flatMap(child => nodes(child, predicate))];
}

function text(node) {
  return typeof node === "string" ? node : (node?.children || []).map(text).join("");
}

function ownerData() {
  return { success: true, ownerId: 1, campaignToken: "fixture", contextId: "fixture-context", readOnlyArchive: false,
    known: { items: [{ entityId: 2, displayName: "赵光义", recognition: { level: "DIRECT_OBSERVATION", evidenceCompleteness: "complete",
      directConversationCount: 0, sharedSceneCount: 1, mentionCount: 0 }, disclosedFacts: [
      { factId: "current-visible", factType: "TRAIT", factKey: "trait_one_eyed", value: "独眼", current: true,
        currentDirectObservation: true, sourceKind: "DIRECT_OBSERVATION", acquisitionKind: "VISIBLE_TRAIT",
        status: "MANUAL_HIDDEN", effectiveKnown: true, firstAcquiredDate: "1164.3.12", revision: 2 },
      { factId: "historical-visible", factType: "TRAIT", factKey: "trait_beauty_good_3", value: "倾国倾城", current: true,
        currentDirectObservation: false, sourceKind: "DIRECT_OBSERVATION", acquisitionKind: "VISIBLE_TRAIT",
        status: "AUTO_DISCLOSED", effectiveKnown: true, firstAcquiredDate: "1164.3.12", revision: 1 },
      { factId: "known-age", factType: "AGE", factKey: "age_13", value: "13", current: false,
        status: "AUTO_DISCLOSED", effectiveKnown: true, firstAcquiredDate: "1164.3.12",
        currentKnownAge: 14, currentAgeReadDate: "1165.3.12", revision: 1 }
    ] }], offset: 0, total: 1 },
    official: [], legacy: { total: 0, counts: {}, items: [] },
    derived: { years: [{ eventYear: 1164, revision: 1, items: [] }], life: null, derivedRevision: 1 },
    generation: {}, detail: { offset: 0, total: 0, items: [] } };
}

async function createLoadedRenderer(api) {
  const renderer = createRenderer(api);
  renderer.render();
  await renderer.flush();
  return renderer;
}

async function testSourcesRace(rejectOld = false) {
  const old = deferred();
  const diagnostics = [];
  const api = { getMemory4OwnerData: async () => ownerData(), getMemory4Sources: () => old.promise,
    onConversationUpdate: () => () => {} };
  const renderer = createRenderer(api, 1, diagnostics);
  renderer.render();
  await renderer.flush();
  let tree = renderer.tree;
  const yearTab = nodes(tree, node => node.type === "button" && node.props.role === "tab"
    && text(node) === "年度记忆")[0];
  yearTab.props.onClick();
  tree = renderer.render();
  const sourceButton = nodes(tree, node => node.type === "button" && text(node) === "查看来源")[0];
  const sourceRequest = sourceButton.props.onClick();
  const refresh = nodes(tree, node => node.type === "button" && node.props["aria-label"] === "刷新人物记忆")[0];
  await refresh.props.onClick();
  if (rejectOld) old.reject(new Error("OLD_SOURCE_FAILURE"));
  else old.resolve({ success: true, sources: { changed: false, entries: [{ entryId: "old-source", eventTime: {}, revision: 1,
    text: "OLD_SOURCE_BODY" }], missingEntryIds: [] } });
  await sourceRequest;
  tree = renderer.render();
  assert.equal(text(tree).includes("OLD_SOURCE_BODY"), false, "a pre-refresh source response cannot open a stale modal");
  assert.equal(text(tree).includes("OLD_SOURCE_FAILURE"), false, "a pre-refresh source error cannot replace current UI state");
  assert.equal(diagnostics.length, 1, "a stale source success or failure is counted once");
  assert.equal(diagnostics[0][0], "[Memory4] sources_stale_response_dropped");
  assert.equal(diagnostics[0][1].ownerId, 1);
  assert.deepEqual(Object.keys(diagnostics[0][1]).sort(), ["ownerId"], "stale diagnostics never include source bodies");
}

async function main() {
  const renderer = await createLoadedRenderer({ getMemory4OwnerData: async () => ownerData(),
    onConversationUpdate: () => () => {} });
  const rows = nodes(renderer.tree, node => node.type === "div" && node.props.className === "memory4-disclosure-row");
  const currentRow = rows.find(row => text(row).includes("独眼"));
  const historicalRow = rows.find(row => text(row).includes("倾国倾城"));
  assert(currentRow && text(currentRow).includes("当前可直接观察"), "current observation overrides a saved hidden marker in the UI");
  assert.equal(nodes(currentRow, node => node.type === "button").length, 0, "current observation has no hide/known control");
  assert(historicalRow && text(historicalRow).includes("直接观察"), "historical observation is labeled as direct observation");
  assert.equal(nodes(historicalRow, node => node.type === "button").length, 1, "historical knowledge remains manually manageable");
  assert(text(renderer.tree).includes("当前年龄：14岁") && text(renderer.tree).includes("读取日期：1165.3.12"));
  assert(text(renderer.tree).includes("披露时年龄：13岁") && text(renderer.tree).includes("获知时间：1164.3.12"));
  const archive = await createLoadedRenderer({ getMemory4OwnerData: async () => ({ ...ownerData(), readOnlyArchive: true }),
    onConversationUpdate: () => () => {} });
  assert(!text(archive.tree).includes("当前年龄："), "an archive cannot render a stale current age even if a DTO contains it");
  assert(text(archive.tree).includes("披露时年龄：13岁"), "archival age evidence remains visible");
  await testSourcesRace();
  await testSourcesRace(true);
  console.log("V8.15.2 Memory4 UI races: PASS (direct observation labeling/control and stale source success/error isolation)");
}

main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
