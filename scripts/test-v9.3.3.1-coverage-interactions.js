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

function renderComponent(api) {
  const slots = [], effects = [];
  let cursor = 0, tree, ownerId = 11;
  const react = {
    Fragment: "fragment",
    createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) }),
    useState(initial) {
      const index = cursor++;
      slots[index] ||= { value: initial };
      return [slots[index].value, value => { slots[index].value = typeof value === "function" ? value(slots[index].value) : value; }];
    },
    useRef(initial) { return slots[cursor++] ||= { current: initial }; },
    useEffect(callback, dependencies) {
      const index = cursor++;
      if (!slots[index] || dependencies.some((value, position) => value !== slots[index].dependencies[position])) {
        slots[index]?.cleanup?.();
        slots[index] = { dependencies };
        effects.push(() => { slots[index].cleanup = callback(); });
      }
    }
  };
  const sandbox = { window: { conversationAPI: api, confirm: () => false }, console, setTimeout, clearTimeout };
  const source = fs.readFileSync(path.join(__dirname, "../src/app/renderer/memory4-manager.js"), "utf8")
    .replace("export function Memory4Manager", "function Memory4Manager");
  vm.runInNewContext(source + "\nthis.component = Memory4Manager;", sandbox);
  const render = nextOwner => {
    if (nextOwner != null) ownerId = nextOwner;
    cursor = 0;
    tree = sandbox.component({ react, ownerId, refreshKey: 0 });
    while (effects.length) effects.shift()();
    return tree;
  };
  return { render, flush: async () => { await new Promise(resolve => setImmediate(resolve)); return render(); },
    unmount: () => slots.forEach(slot => slot?.cleanup?.()), get tree() { return tree; } };
}

function nodes(node, predicate) {
  return !node || typeof node !== "object" ? [] : [...(predicate(node) ? [node] : []),
    ...(node.children || []).flatMap(child => nodes(child, predicate))];
}
const text = node => typeof node === "string" ? node : (node?.children || []).map(text).join("");
const button = (renderer, label) => {
  const result = nodes(renderer.tree, node => node.type === "button" && text(node) === label)[0];
  assert(result, `button missing: ${label}`);
  return result;
};
const rows = renderer => nodes(renderer.tree, node => node.props.className === "memory4-coverage-row");

function fixture() {
  const summary = { summaryId: "summary-a", finalizationId: "final-a", summaryHash: "b".repeat(64),
    legacy: { importantItemCount: 95, provenSourceLinkedCount: 95, sourceRelatedOnlyCount: 0,
      legacyOnlyCount: 0, unverifiedCount: 0, forgottenCount: 0, revokedCount: 0 } };
  let campaign = "campaign-a", indexRevision = 1;
  const calls = [], entryCalls = [];
  const data = ownerId => ({ success: true, ownerId, campaignToken: campaign, contextId: campaign,
    indexRevision, readOnlyArchive: false, known: { items: [], total: 0, offset: 0 }, official: [],
    detail: { items: [], total: 0, offset: 0 }, generation: {},
    legacy: { total: 0, counts: {}, items: [], recompressionCoverage: { items: [], total: 0, offset: 0 } },
    coverageSummary: { indexRevision, legacyRevision: indexRevision, forgetGeneration: indexRevision,
      summaryHash: "c".repeat(64), offset: 0, total: 1, summaries: [summary], latest: null,
      legacy: { importantItemCount: 95 }, recovery: { pending: 0 } } });
  const page = request => ({ success: true, status: "OK", indexRevision, summaryHash: summary.summaryHash,
    offset: request.offset, limit: request.limit, total: 95, durableOnly: { count: 0, entries: [] },
    items: Array.from({ length: Math.min(request.limit, 95 - request.offset) }, (_, position) => {
      const id = request.offset + position;
      return { legacyMemoryId: `fact-${id}`, relation: "SHARED_FRAGMENT_SOURCE",
        durableEntries: [{ entryId: `detail-${id}`, revision: 1, bodyHash: "d".repeat(64) }] };
    }) });
  const api = { getMemory4OwnerData: async request => data(request.ownerId),
    getMemory4Coverage: async request => { calls.push(request); return page(request); },
    getMemory4Entry: async request => { entryCalls.push(request); return { success: true,
      entry: { entryId: request.entryId, text: `BODY-${request.entryId}`, revision: 1 } }; },
    onConversationUpdate: () => () => {} };
  return { api, calls, entryCalls, page, data, summary,
    changeContext: () => { campaign = "campaign-b"; indexRevision++; summary.summaryHash = "e".repeat(64); } };
}

async function loaded(sample) {
  const renderer = renderComponent(sample.api);
  renderer.render();
  await renderer.flush();
  button(renderer, "Legacy 对话摘要").props.onClick();
  renderer.render();
  await button(renderer, "展开来源覆盖详情").props.onClick();
  await renderer.flush();
  return renderer;
}

async function pagination() {
  const sample = fixture(), renderer = await loaded(sample);
  assert.equal(rows(renderer).length, 40);
  assert.equal(text(rows(renderer)[0]).startsWith("fact-0"), true);
  await button(renderer, "下一页").props.onClick();
  await renderer.flush();
  assert.equal(text(rows(renderer)[0]).startsWith("fact-40"), true, "FIX-03 second page must display new rows");
  await button(renderer, "下一页").props.onClick();
  await renderer.flush();
  assert.equal(rows(renderer).length, 15);
  assert.equal(text(rows(renderer)[0]).startsWith("fact-80"), true);
  assert.equal(button(renderer, "下一页").props.disabled, true);
  await button(renderer, "上一页").props.onClick();
  await renderer.flush();
  assert.equal(text(rows(renderer)[0]).startsWith("fact-40"), true);
  await button(renderer, "上一页").props.onClick();
  await renderer.flush();
  assert.equal(text(rows(renderer)[0]).startsWith("fact-0"), true);
  assert.equal(sample.calls.filter(request => request.limit === 40).length, 3, "return navigation reuses authenticated pages");
  assert.equal(sample.calls.filter(request => request.limit === 1).length, 2, "cached navigation rechecks current source proof");
  assert.equal(button(renderer, "上一页").props.disabled, true);
}

async function navigation() {
  const sample = fixture(), renderer = await loaded(sample);
  await button(renderer, "查看 Durable").props.onClick();
  await renderer.flush();
  assert(text(renderer.tree).includes("BODY-detail-0"));
  assert.equal(button(renderer, "详细长期记忆").props["aria-selected"], true);
  assert.equal(text(renderer.tree).includes("正在读取并验证来源覆盖"), false, "FIX-04 successful navigation must release Loading");
  assert.equal(sample.entryCalls[0].expectedIndexRevision, 1);
  assert.equal(sample.entryCalls[0].expectedEntryRevision, 1);
  assert.equal(sample.entryCalls[0].expectedBodyHash, "d".repeat(64));
  assert.equal(button(renderer, "查看来源").props.disabled, false);
}

async function collapseAndCacheRevocation() {
  const sample = fixture(), renderer = await loaded(sample);
  await button(renderer, "下一页").props.onClick();
  await renderer.flush();
  await button(renderer, "收起来源覆盖详情").props.onClick();
  await renderer.flush();
  assert.equal(rows(renderer).length, 0);
  await button(renderer, "展开来源覆盖详情").props.onClick();
  await renderer.flush();
  assert.equal(text(rows(renderer)[0]).startsWith("fact-40"), true, "collapse preserves the active page");
  const verify = deferred();
  sample.api.getMemory4Coverage = async request => { sample.calls.push(request); return verify.promise; };
  const pending = button(renderer, "上一页").props.onClick();
  renderer.render();
  assert.equal(rows(renderer).length, 0, "cached rows stay hidden until their current source proof is authenticated");
  sample.changeContext();
  verify.resolve({ success: true, status: "STALE" });
  await pending;
  await renderer.flush();
  assert.equal(rows(renderer).length, 0);
  assert(text(renderer.tree).includes("旧详情已撤回"));
  sample.api.getMemory4Coverage = async request => { sample.calls.push(request); return sample.page(request); };
  await button(renderer, "展开来源覆盖详情").props.onClick();
  await renderer.flush();
  assert.equal(sample.calls.at(-1).offset, 0, "new Campaign/revision/Forget resets the selected page");
  assert.equal(sample.calls.at(-1).limit, 40, "a stale page is never reused");
}

async function overlappingEntries(lastFirst = false) {
  const sample = fixture(), renderer = await loaded(sample);
  const first = deferred(), last = deferred();
  sample.api.getMemory4Entry = request => request.entryId === "detail-0" ? first.promise : last.promise;
  const links = nodes(renderer.tree, node => node.type === "button" && text(node) === "查看 Durable");
  const oldRequest = links[0].props.onClick();
  const newRequest = links[1].props.onClick();
  renderer.render();
  const oldBody = { success: true, entry: { entryId: "detail-0", text: "OBSOLETE_BODY", revision: 1 } };
  const newBody = { success: true, entry: { entryId: "detail-1", text: "LATEST_BODY", revision: 1 } };
  if (lastFirst) {
    last.resolve(newBody); await newRequest;
    first.resolve(oldBody); await oldRequest;
  } else {
    first.resolve(oldBody); await oldRequest;
    renderer.render();
    assert(text(renderer.tree).includes("正在读取并验证来源覆盖"), "old finally cannot clear the newer request's Loading");
    assert(!text(renderer.tree).includes("OBSOLETE_BODY"));
    last.resolve(newBody); await newRequest;
  }
  await renderer.flush();
  assert(text(renderer.tree).includes("LATEST_BODY"));
  assert(!text(renderer.tree).includes("OBSOLETE_BODY"));
  assert(!text(renderer.tree).includes("正在读取并验证来源覆盖"));
}

async function invalidatedEntry(kind) {
  const sample = fixture(), renderer = await loaded(sample), response = deferred();
  sample.api.getMemory4Entry = () => response.promise;
  const pending = button(renderer, "查看 Durable").props.onClick();
  if (kind === "tab") { button(renderer, "官方追忆").props.onClick(); renderer.render(); }
  else if (kind === "owner") { renderer.render(12); await renderer.flush(); }
  else if (kind === "refresh") {
    sample.changeContext();
    const refresh = nodes(renderer.tree, node => node.props["aria-label"] === "刷新人物记忆")[0];
    await refresh.props.onClick(); await renderer.flush();
  } else renderer.unmount();
  response.resolve({ success: true, entry: { entryId: "detail-0", text: "INVALIDATED_BODY", revision: 1 } });
  await pending;
  if (kind !== "unmount") {
    await renderer.flush();
    assert(!text(renderer.tree).includes("INVALIDATED_BODY"));
    assert(!text(renderer.tree).includes("正在读取并验证来源覆盖"));
    if (kind === "tab") assert.equal(button(renderer, "官方追忆").props["aria-selected"], true);
  }
}

async function entryFailure(stale = false) {
  const sample = fixture(), renderer = await loaded(sample);
  sample.api.getMemory4Entry = async () => {
    if (stale) return { success: true, status: "STALE" };
    throw new Error("fixture_entry_failure");
  };
  await button(renderer, "查看 Durable").props.onClick();
  await renderer.flush();
  assert(!text(renderer.tree).includes("正在读取并验证来源覆盖"));
  assert(!text(renderer.tree).includes("BODY-detail"));
  if (stale) {
    assert(text(renderer.tree).includes("旧详情已撤回"));
    assert.equal(rows(renderer).length, 0);
  } else assert(text(renderer.tree).includes("fixture_entry_failure"));
}

async function pageCompetition() {
  const sample = fixture(), renderer = await loaded(sample), first = deferred();
  sample.api.getMemory4Coverage = () => first.promise;
  const next = button(renderer, "下一页").props.onClick();
  await renderer.flush();
  assert.equal(rows(renderer).length, 0);
  // A Tab switch invalidates the pending page selection.
  sample.api.getMemory4OwnerData = async request => sample.data(request.ownerId);
  button(renderer, "官方追忆").props.onClick();
  renderer.render();
  first.resolve(sample.page({ offset: 40, limit: 40 }));
  await next;
  await renderer.flush();
  assert.equal(button(renderer, "官方追忆").props["aria-selected"], true);
  assert(!text(renderer.tree).includes("fact-40"));
  assert(!text(renderer.tree).includes("正在读取并验证来源覆盖"));
}

async function supersededPage(kind) {
  const sample = fixture(), renderer = await loaded(sample), response = deferred();
  const previous = button(renderer, "上一页");
  const collapse = button(renderer, "收起来源覆盖详情");
  const before = sample.calls.length;
  sample.api.getMemory4Coverage = request => request.offset === 40 ? response.promise : Promise.resolve(sample.page(request));
  const pending = button(renderer, "下一页").props.onClick();
  if (kind === "back") await previous.props.onClick();
  else if (kind === "collapse") await collapse.props.onClick();
  else if (kind === "owner") { renderer.render(12); await renderer.flush(); }
  else {
    sample.changeContext();
    await nodes(renderer.tree, node => node.props["aria-label"] === "刷新人物记忆")[0].props.onClick();
  }
  response.resolve(sample.page({ offset: 40, limit: 40 }));
  await pending; await renderer.flush();
  assert(!text(renderer.tree).includes("fact-40"), `${kind} must discard superseded page 40`);
  assert(!text(renderer.tree).includes("正在读取并验证来源覆盖"));
  if (kind === "back") assert.equal(text(rows(renderer)[0]).startsWith("fact-0"), true);
  else assert.equal(rows(renderer).length, 0);
  assert.equal(sample.calls.length, before);
}

async function switchSummary() {
  const sample = fixture(), response = deferred();
  sample.api.getMemory4OwnerData = async request => {
    const dto = sample.data(request.ownerId);
    dto.coverageSummary.total = 2;
    dto.coverageSummary.summaries.push({ ...sample.summary, summaryId: "summary-b", finalizationId: "final-b" });
    return dto;
  };
  const renderer = await loaded(sample);
  const expansions = nodes(renderer.tree, node => node.type === "button" && text(node) === "展开来源覆盖详情");
  sample.api.getMemory4Coverage = request => request.legacyMemoryId === "summary-a" ? response.promise
    : Promise.resolve({ ...sample.page(request), items: sample.page(request).items.map(row => ({ ...row, legacyMemoryId: `B-${row.legacyMemoryId}` })) });
  const pending = button(renderer, "下一页").props.onClick();
  await expansions[0].props.onClick(); await renderer.flush();
  response.resolve(sample.page({ offset: 40, limit: 40 }));
  await pending; await renderer.flush();
  assert.equal(text(rows(renderer)[0]).startsWith("B-fact-0"), true);
  assert(!text(renderer.tree).includes("fact-40"));
  assert(!text(renderer.tree).includes("正在读取并验证来源覆盖"));
}

async function refreshAfterNavigation() {
  const sample = fixture(), renderer = await loaded(sample);
  await button(renderer, "查看 Durable").props.onClick(); await renderer.flush();
  await nodes(renderer.tree, node => node.props["aria-label"] === "刷新人物记忆")[0].props.onClick();
  await renderer.flush();
  assert(!text(renderer.tree).includes("BODY-detail"));
  assert(!text(renderer.tree).includes("正在读取并验证来源覆盖"));
  assert.notEqual(button(renderer, "Legacy 对话摘要").props.disabled, true);
}

async function failedCacheAuthentication(throws) {
  const sample = fixture(), renderer = await loaded(sample);
  await button(renderer, "下一页").props.onClick(); await renderer.flush();
  sample.api.getMemory4Coverage = async () => {
    if (throws) throw new Error("fixture_cache_authentication_failed");
    return { success: false, error: "fixture_cache_authentication_failed" };
  };
  await button(renderer, "上一页").props.onClick(); await renderer.flush();
  assert.equal(rows(renderer).length, 0, "a failed source recheck must not reveal the old cached page");
  assert(text(renderer.tree).includes("fixture_cache_authentication_failed"));
  assert(!text(renderer.tree).includes("正在读取并验证来源覆盖"));
  await button(renderer, "收起来源覆盖详情").props.onClick(); await renderer.flush();
  sample.api.getMemory4Coverage = async request => { sample.calls.push(request); return sample.page(request); };
  await button(renderer, "展开来源覆盖详情").props.onClick(); await renderer.flush();
  assert.equal(sample.calls.at(-1).limit, 40, "retry must fetch a new authenticated full page");
  assert.equal(rows(renderer).length, 40);
}

async function main() {
  let failed = 0;
  const cases = [["FIX-03 95-fact pagination", pagination], ["FIX-04 Detail Loading", navigation],
    ["collapse/current cache authentication/STALE", collapseAndCacheRevocation],
    ["old finally cannot release new Loading", () => overlappingEntries(false)],
    ["last valid entry wins reversed completion", () => overlappingEntries(true)],
    ...["tab", "owner", "refresh", "unmount"].map(kind => [`entry invalidation: ${kind}`, () => invalidatedEntry(kind)]),
    ["entry STALE", () => entryFailure(true)], ["entry throw", () => entryFailure(false)],
    ["page response after Tab switch", pageCompetition],
    ...["back", "collapse", "owner", "campaign"].map(kind => [`page superseded: ${kind}`, () => supersededPage(kind)]),
    ["page summary isolation", switchSummary], ["refresh immediately after navigation", refreshAfterNavigation],
    ["cached page authentication throws", () => failedCacheAuthentication(true)],
    ["cached page authentication rejects", () => failedCacheAuthentication(false)]];
  for (const [name, run] of cases) {
    try { await run(); console.log(`PASS ${name}`); }
    catch (error) { failed++; console.error(`FAIL ${name}: ${error.message}`); }
  }
  if (failed) process.exitCode = 1;
  else console.log("V9.3.3.1 Coverage interactions: PASS");
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { fixture, renderComponent, nodes, text, button, rows, loaded, deferred };
