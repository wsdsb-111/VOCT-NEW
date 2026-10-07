"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { createMemoryUiFixture } = require("./v8.14-memory-ui-fixture");
const { Memory4RecallPlanner } = require("../resources/app/out/main/memory-system/memory4-recall-planner");

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function uiRace(rejectOld = false) {
  const old = deferred();
  let reads = 0, revision = 1;
  const catalogue = () => ({ success: true, ownerId: 2, campaignToken: "fixture", contextId: "fixture-context",
    indexRevision: revision, readOnlyArchive: false, known: { items: [], total: 0 }, official: [],
    legacy: { total: 0, counts: {}, items: [] }, derived: { years: [], life: null }, generation: {},
    detail: { total: 1, items: [{ entryId: "fixture-entry", memoryType: "DURABLE_KNOWLEDGE", revision }] } });
  const api = { getMemory4OwnerData: async () => catalogue(), getMemory4Entry: async () => {
    reads++;
    return reads === 1 ? old.promise : { success: true, entry: { entryId: "fixture-entry", revision: 2, text: "NEW_BODY" } };
  } };
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
  const sandbox = { window: { conversationAPI: api, confirm: () => false }, setTimeout, clearTimeout };
  const source = fs.readFileSync(path.join(__dirname, "../resources/app/out/renderer/memory4-manager.js"), "utf8")
    .replace("export function Memory4Manager", "function Memory4Manager");
  vm.runInNewContext(`${source}\nthis.component = Memory4Manager;`, sandbox);
  const render = () => { cursor = 0; tree = sandbox.component({ react, ownerId: 2, refreshKey: 0 }); while (effects.length) effects.shift()(); };
  const flush = async () => { await new Promise(resolve => setImmediate(resolve)); render(); };
  const nodes = (node, predicate) => {
    if (!node || typeof node !== "object") return [];
    return [...(predicate(node) ? [node] : []), ...(node.children || []).flatMap(child => nodes(child, predicate))];
  };
  const text = node => typeof node === "string" ? node : (node?.children || []).map(text).join("");
  const summary = () => nodes(tree, node => node.type === "details" && node.props.className === "memory4-detail")[0].children[0];
  render();
  await flush();
  nodes(tree, node => node.type === "button" && node.props.role === "tab" && text(node) === "详细长期记忆")[0].props.onClick();
  render();
  const pending = summary().props.onClick({ preventDefault() {} });
  revision = 2;
  await nodes(tree, node => node.type === "button" && node.props["aria-label"] === "刷新人物记忆")[0].props.onClick();
  await flush();
  if (rejectOld) old.reject(new Error("OLD_FAILURE"));
  else old.resolve({ success: true, entry: { entryId: "fixture-entry", revision: 1, text: "OLD_BODY" } });
  await pending;
  render();
  assert(!text(tree).includes("OLD_BODY"), "stale detail body must not return after same-owner refresh");
  assert(!text(tree).includes("OLD_FAILURE"), "stale request error must not replace refreshed UI state");
  await summary().props.onClick({ preventDefault() {} });
  render();
  assert.equal(reads, 2, "opening the refreshed entry must fetch its current body");
  assert(text(tree).includes("NEW_BODY"));
}

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "votc-v8151-recall-ui-"));
  try {
    const { engine, scope, summariesDir } = await createMemoryUiFixture(root);
    const planner = new Memory4RecallPlanner(engine.memory4);
    const options = { ...scope, query: "粮食约定", currentGameDate: "1164.1.1", conversationId: "fixture",
      sceneRevision: "fixture", turnEpoch: 1, explicitTargetEntityIds: [1],
      queryModel: { text: "粮食约定", axis: "EVENT", granularity: "EVENT", entityIds: [1], topics: ["粮食"] },
      memoryEngineRemainingBudget: 1200, providerRemainingSafeBudget: 1200, estimateTokens: text => Math.ceil(text.length / 2) };
    const before = planner.plan(options);
    assert(before.details.length > 0);
    fs.renameSync(path.join(summariesDir, "2_乙"), path.join(root, "legacy-away"));
    const canonical = planner.plan(options);
    assert.notEqual(canonical.diagnostics.reason, "OWNER_FOLDER_MISSING");
    assert.deepEqual(canonical.details.map(item => item.entryId), before.details.map(item => item.entryId));
    assert.equal(planner.plan({ ...options, ownerId: 99 }).diagnostics.reason, "OWNER_FOLDER_MISSING");
    assert.equal(planner.plan({ ...options, campaignToken: "other" }).details.length, 0);
    const directory = engine.memory4.store.directory(scope);
    const indexFile = path.join(directory, "index.json");
    const bytes = fs.readFileSync(indexFile);
    fs.writeFileSync(indexFile, "{invalid", "utf8");
    assert.throws(() => planner.plan(options), /parse|JSON|invalid|corrupt/i);
    fs.writeFileSync(indexFile, bytes);
    await uiRace();
    await uiRace(true);
    console.log("V8.15.1 canonical-only recall and same-owner detail response isolation: PASS");
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
