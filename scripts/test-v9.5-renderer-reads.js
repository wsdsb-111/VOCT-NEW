"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { pathToFileURL } = require("node:url");
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

(async () => {
  const { createReadBoundary } = await import(pathToFileURL(path.resolve(__dirname, "../src/app/renderer/v95/state/read-boundary.js")));
  let context = { campaignTag: "a", ownerTag: "owner", conversationTag: "conversation", conversationEpoch: 1, isActive: true };
  const listeners = new Set();
  const runtime = { getContext: () => context, subscribeContext: callback => { listeners.add(callback); callback(context); return () => listeners.delete(callback); } };
  const boundary = createReadBoundary(runtime, "memory");
  const older = deferred();
  const pending = boundary.run("dashboard", () => older.promise);
  await Promise.resolve();
  const latest = await boundary.run("dashboard", () => "new");
  assert.equal(latest.value, "new");
  older.resolve("old");
  assert.equal((await pending).committed, false);
  const locate = await boundary.run("dashboard", () => "source");
  assert.equal(locate.isCurrent(), true);
  await boundary.run("dashboard", () => "revised source");
  assert.equal(locate.isCurrent(), false, "a delayed DOM locator cannot target a newer page");
  const scopeToken = boundary.capture();
  const delayed = deferred();
  const oldScope = boundary.run("statuses", () => delayed.promise);
  await Promise.resolve();
  context = { ...context, campaignTag: "b", conversationEpoch: 2 };
  for (const listener of listeners) listener(context);
  delayed.resolve("previous campaign");
  assert.equal((await oldScope).committed, false);
  assert.equal(scopeToken(), false, "a completed old write cannot announce success in a new scope");
  const beforeCancel = await boundary.run("bindings", () => []);
  boundary.cancel("bindings");
  assert.equal(beforeCancel.isCurrent(), false, "debounced input changes invalidate immediately");
  boundary.dispose();
  assert.equal(listeners.size, 0);
  assert.equal((await boundary.run("dashboard", () => assert.fail("disposed read"))).committed, false);

  const source = fs.readFileSync(path.resolve(__dirname, "../src/app/renderer/assets/index-Dn3qWlAB.js"), "utf8");
  const fetchBlock = source.slice(source.indexOf("      fetchModels: async (config2) => {"), source.indexOf("      getCachedModels:"));
  const selectionBlock = source.slice(source.indexOf("      selectProvider: async (type) => {"), source.indexOf("      // Update editing config"));
  let state = { modelCache: new Map(), modelRequestSequence: 0, providerSelectionSequence: 0,
    appSettings: { llmSettings: { providers: [{ providerType: "a", instanceId: "a" }, { providerType: "b", instanceId: "b" }], presets: [] } } };
  const models = new Map(); const selections = new Map(); const modelCalls = [];
  const functions = vm.runInNewContext(`({${fetchBlock}${selectionBlock}})`, {
    get2: () => state, set: update => { Object.assign(state, typeof update === "function" ? update(state) : update); },
    getCacheKey$2: config => config.instanceId, Map, console: { log() {}, error() {} },
    window: { llmConfigAPI: {
      listModels(id) { modelCalls.push(id); const item = deferred(); models.set(id, item); return item.promise; },
      setActiveProvider(id) { const item = deferred(); selections.set(id, item); return item.promise; }
    } }
  });
  Object.assign(state, functions);
  const selectionA = state.selectProvider("a");
  const selectionB = state.selectProvider("b");
  selections.get("b").resolve(); await selectionB;
  selections.get("a").resolve(); await selectionA;
  assert.deepEqual(modelCalls, ["b"], "late provider selection cannot fetch models for another active provider");
  models.get("b").resolve([{ id: "b-model" }]); await new Promise(resolve => setImmediate(resolve));
  assert.equal(state.appSettings.llmSettings.activeProviderInstanceId, "b");
  state.modelCache.clear();
  const fetchA = state.fetchModels({ providerType: "a", instanceId: "a" });
  const fetchB = state.fetchModels({ providerType: "b", instanceId: "b" });
  state.modelCache.set("unrelated", [{ id: "retained" }]);
  models.get("b").resolve([{ id: "b-new" }]); await fetchB;
  models.get("a").resolve([{ id: "a-late" }]); await fetchA;
  assert.equal(state.modelCache.has("a"), false);
  assert.equal(state.modelCache.get("b")[0].id, "b-new");
  assert.equal(state.modelCache.has("unrelated"), true, "cache commits merge current state");
  assert.equal(state.isLoadingModels, false);
  console.log("V9.5 actual renderer reads: PASS (scope, debounce invalidation, delayed source location, provider selection and model cache races)");
})().catch(error => { console.error(error); process.exitCode = 1; });
