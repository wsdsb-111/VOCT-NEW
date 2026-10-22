"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const ui = require(path.join(root, "src", "app", "renderer", "pair-long-term-ui.js"));
const parser = require(path.join(root, "src", "app", "shared", "pair-important-matters.js"));

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => { resolve = resolvePromise; reject = rejectPromise; });
  return { promise, resolve, reject };
}

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

class MiniElement {
  constructor(tagName) {
    this.tagName = String(tagName).toUpperCase();
    this.children = [];
    this.attributes = new Map();
    this.listeners = new Map();
    this.parentElement = null;
    this.className = "";
    this.value = "";
    this.disabled = false;
    this.selected = false;
    this.type = "";
    this.placeholder = "";
    this.dataset = {};
    this._textContent = "";
    this._open = false;
    this.classList = {
      add: (...names) => { this.className = [...new Set([...this.className.split(/\s+/u).filter(Boolean), ...names])].join(" "); },
      remove: (...names) => { this.className = this.className.split(/\s+/u).filter(name => name && !names.includes(name)).join(" "); },
      contains: name => this.className.split(/\s+/u).includes(name),
      toggle: (name, force) => {
        const enabled = force === undefined ? !this.classList.contains(name) : !!force;
        if (enabled) this.classList.add(name); else this.classList.remove(name);
        return enabled;
      }
    };
  }

  get textContent() {
    return this._textContent + this.children.map(child => child.textContent || "").join("");
  }

  set textContent(value) {
    this._textContent = String(value ?? "");
    this.replaceChildren();
  }

  get open() { return this._open; }
  set open(value) {
    this._open = !!value;
    if (this._open) this.attributes.set("open", ""); else this.attributes.delete("open");
  }

  append(...nodes) {
    for (const node of nodes) {
      if (!node || typeof node !== "object") continue;
      node.parentElement = this;
      this.children.push(node);
    }
  }

  replaceChildren(...nodes) {
    for (const child of this.children) child.parentElement = null;
    this.children = [];
    this.append(...nodes);
  }

  setAttribute(name, value) { this.attributes.set(String(name), String(value)); }
  getAttribute(name) { return this.attributes.has(String(name)) ? this.attributes.get(String(name)) : null; }
  hasAttribute(name) { return this.attributes.has(String(name)); }
  removeAttribute(name) { this.attributes.delete(String(name)); if (name === "open") this._open = false; }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    if (!listeners.includes(listener)) listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type, listener) {
    this.listeners.set(type, (this.listeners.get(type) || []).filter(candidate => candidate !== listener));
  }

  dispatchEvent(event) {
    if (!event.target) event.target = this;
    for (const listener of [...(this.listeners.get(event.type) || [])]) listener.call(this, event);
    return !event.defaultPrevented;
  }

  click() {
    if (this.disabled) return;
    const event = { type: "click", target: this, defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; } };
    this.dispatchEvent(event);
    if (this.tagName === "SUMMARY" && this.parentElement?.tagName === "DETAILS") {
      this.parentElement.open = !this.parentElement.open;
      this.parentElement.dispatchEvent({ type: "toggle", target: this.parentElement });
    }
  }
}

class MiniDocument {
  createElement(tagName) { return new MiniElement(tagName); }
}

function miniFindAll(node, predicate) {
  const found = [];
  const visit = current => {
    if (predicate(current)) found.push(current);
    for (const child of current.children || []) visit(child);
  };
  visit(node);
  return found;
}

function miniFindText(node, tagName, text) {
  return miniFindAll(node, item => item.tagName === String(tagName).toUpperCase() && item.textContent.includes(text));
}

function miniFindClass(node, className) {
  return miniFindAll(node, item => item.classList.contains(className));
}

function clickDetails(details) {
  assert.ok(details?.children?.[0]?.tagName === "SUMMARY", "details should begin with a summary");
  details.children[0].click();
}

function findButton(host, label) {
  const button = miniFindAll(host, item => item.tagName === "BUTTON" && item.textContent === label)[0];
  assert.ok(button, `button should exist: ${label}`);
  return button;
}

async function flushDomEvents() {
  await new Promise(resolve => setImmediate(resolve));
}

async function withMiniDom(api, callback) {
  const keys = ["document", "conversationAPI", "addEventListener", "removeEventListener", "dispatchEvent", "CustomEvent"];
  const saved = new Map(keys.map(key => [key, { hadOwn: Object.hasOwn(globalThis, key), value: globalThis[key] }]));
  const listeners = new Map();
  globalThis.document = new MiniDocument();
  globalThis.conversationAPI = api;
  globalThis.addEventListener = (type, listener) => {
    const rows = listeners.get(type) || [];
    if (!rows.includes(listener)) rows.push(listener);
    listeners.set(type, rows);
  };
  globalThis.removeEventListener = (type, listener) => {
    listeners.set(type, (listeners.get(type) || []).filter(candidate => candidate !== listener));
  };
  globalThis.dispatchEvent = event => {
    for (const listener of [...(listeners.get(event.type) || [])]) listener.call(globalThis, event);
    return true;
  };
  globalThis.CustomEvent = class MiniCustomEvent {
    constructor(type, options = {}) { this.type = type; this.detail = options.detail; }
  };
  try {
    return await callback({ listeners, makeHost: () => new MiniElement("div") });
  } finally {
    for (const [key, value] of saved) {
      if (value.hadOwn) globalThis[key] = value.value;
      else delete globalThis[key];
    }
  }
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

async function testRefreshLatestWins() {
  const first = deferred();
  const second = deferred();
  const late = deferred();
  const latest = deferred();
  const responses = new Map([[0, first], [2, second], [3, late], [4, latest]]);
  const { controller } = createHarness({ getPairMemoryIndex: payload => responses.get(payload.page).promise });
  const older = controller.refresh(0, "newest");
  const newer = controller.refresh(2, "oldest");
  first.resolve({ success: true, page: 0, sort: "newest", items: [{ text: "旧结果" }] });
  await older;
  assert.strictEqual(controller.state.busy, true, "an older page response cannot clear the latest request's loading state");
  second.resolve({ success: true, page: 2, sort: "oldest", items: [{ text: "最新结果" }] });
  await newer;
  assert.strictEqual(controller.state.ledger.items[0].text, "最新结果");

  const pendingOld = controller.refresh(3, "newest");
  const pendingNew = controller.refresh(4, "oldest");
  latest.resolve({ success: true, page: 4, sort: "oldest", items: [{ text: "最后结果" }] });
  await pendingNew;
  late.resolve({ success: true, page: 3, sort: "newest", items: [{ text: "迟到结果" }] });
  await pendingOld;
  assert.strictEqual(controller.state.ledger.items[0].text, "最后结果", "a late older page cannot overwrite the latest successful refresh");
  controller.dispose();
}

async function testSourceLatestCloseAndDispose() {
  const first = deferred();
  const second = deferred();
  const closed = deferred();
  const disposed = deferred();
  const { controller, changes } = createHarness({
    openPairMemorySource: payload => ({
      first: first.promise,
      second: second.promise,
      closed: closed.promise,
      disposed: disposed.promise
    })[payload.sourceSummaryKey]
  });
  const sourceItem = sourceSummaryKey => ({ source: { sourceSummaryKey, sourceRevision: `rev-${sourceSummaryKey}` } });
  const older = controller.openSource(sourceItem("first"));
  const newer = controller.openSource(sourceItem("second"));
  second.resolve({ success: true, summary: { content: "最新来源" } });
  await newer;
  first.resolve({ success: true, summary: { content: "过期来源" } });
  await older;
  assert.strictEqual(controller.state.sourceModal.content, "最新来源", "late source reads cannot replace the latest modal content");

  const pendingClose = controller.openSource(sourceItem("closed"));
  controller.closeSource();
  closed.resolve({ success: true, summary: { content: "关闭后的来源" } });
  await pendingClose;
  assert.strictEqual(controller.state.sourceModal, null, "closing the modal invalidates its pending source read");
  assert.strictEqual(controller.state.busy, false, "closing a pending source read releases its loading state");

  const pendingDispose = controller.openSource(sourceItem("disposed"));
  const changesBeforeDispose = changes.length;
  controller.dispose();
  disposed.resolve({ success: true, summary: { content: "卸载后的来源" } });
  await pendingDispose;
  assert.strictEqual(changes.length, changesBeforeDispose, "a disposed source read cannot emit into an unmounted panel");
}

async function testDisposeStopsBatchAfterInflightPair() {
  const firstWrite = deferred();
  const writes = [];
  const { controller } = createHarness({
    previewPairMemoryBackfill: async () => ({ success: true, writable: true, pairs: [
      { counterpartId: 101, previewRevision: "rev-101" },
      { counterpartId: 202, previewRevision: "rev-202" }
    ] }),
    applyPairMemoryBackfill: payload => { writes.push(payload); return firstWrite.promise; }
  }, { mode: "owner", counterpartId: undefined });
  await controller.preview();
  const applying = controller.applyBatch();
  assert.deepStrictEqual(writes.map(item => item.counterpartId), [101]);
  controller.dispose();
  firstWrite.resolve({ success: true, totalCount: 1 });
  const result = await applying;
  assert.deepStrictEqual(writes.map(item => item.counterpartId), [101], "dispose stops before issuing a later Pair write");
  assert.strictEqual(result.pairs.length, 1, "the already in-flight Pair write is retained in the result");
  assert.strictEqual(result.cancelled, true);
}

async function testSingleSuccessRefreshesOnce() {
  await withMiniDom({}, async ({ makeHost }) => {
    let indexReads = 0;
    globalThis.conversationAPI = {
      getPairMemoryIndex: async payload => { indexReads++; return { success: true, ...payload, totalCount: 0, items: [] }; },
      previewPairMemoryBackfill: async () => ({ success: true, writable: true, previewRevision: "pair-rev", items: [] }),
      applyPairMemoryBackfill: async () => ({ success: true, totalCount: 0 })
    };
    const host = makeHost();
    const dispose = ui.mount(host, { mode: "pair", ownerId: 77754, counterpartId: 12345, ownerName: "保罗", counterpartName: "甲" });
    await flushDomEvents();
    assert.strictEqual(indexReads, 1, "mount performs the initial index read once");
    findButton(host, "自动提取长期事项").click();
    await flushDomEvents();
    findButton(host, "确认生成此关系的长期事项簿").click();
    await flushDomEvents();
    assert.strictEqual(indexReads, 2, "a successful single write triggers exactly one follow-up index read");
    dispose();
  });
}

async function testOwnerCatalogIsolationPagingSourceAndDispose() {
  await withMiniDom({}, async ({ listeners, makeHost }) => {
    const calls = [];
    const sourceCalls = [];
    const api = {
      getPairMemoryIndex: async payload => {
        calls.push({ ...payload });
        const item = payload.counterpartId === 12345
          ? payload.page === 0
            ? { text: "仅属于甲关系的第 1 页", conversationDate: "1090.02.03", source: { sourceSummaryKey: "source-b", sourceRevision: "rev-b" } }
            : { text: "仅属于甲关系的第 2 页", conversationDate: "1091.03.04", source: { sourceSummaryKey: "source-b-2", sourceRevision: "rev-b-2" } }
          : { text: "仅属于乙关系的事项", conversationDate: "1092.04.05", source: { sourceSummaryKey: "source-c", sourceRevision: "rev-c" } };
        return { success: true, ...payload, totalCount: payload.counterpartId === 12345 ? 41 : 1, page: payload.page, pageSize: 20, items: [item] };
      },
      openPairMemorySource: async payload => {
        sourceCalls.push({ ...payload });
        return {
          success: true,
          sourceSummaryKey: payload.sourceSummaryKey,
          sourceRevision: payload.expectedSourceRevision,
          summary: { content: `已验真的 ${payload.sourceSummaryKey}`, date: "1090.02.03" }
        };
      }
    };
    globalThis.conversationAPI = api;
    const host = makeHost();
    const dispose = ui.mount(host, {
      mode: "owner",
      ownerId: 77754,
      ownerName: "保罗",
      counterparts: [
        { counterpartId: 12345, counterpartName: "甲" },
        { counterpartId: 23456, counterpartName: "乙" }
      ]
    });

    const folder = miniFindClass(host, "pair-ledger-folder")[0];
    const groups = miniFindClass(host, "pair-ledger-group");
    const maintenance = miniFindClass(host, "pair-ledger-maintenance")[0];
    assert.ok(folder && !folder.open, "Owner catalog should be a default-collapsed folder");
    assert.strictEqual(groups.length, 2, "Owner mount should preserve both known relationships");
    assert.ok(groups.every(group => !group.open), "relationship groups should start collapsed");
    assert.ok(maintenance && !maintenance.open, "generation and update controls should start collapsed");
    assert.match(groups[0].textContent, /保罗 → 甲/);
    assert.match(groups[1].textContent, /保罗 → 乙/);
    assert.strictEqual(calls.length, 0, "catalog mount must not fetch Pair pages before a group opens");
    assert.strictEqual((listeners.get("votc:pair-memory-index-updated") || []).length, 1);

    folder.open = true;
    clickDetails(groups[0]);
    await flushDomEvents();
    assert.deepStrictEqual(calls.map(call => [call.ownerId, call.counterpartId, call.page]), [[77754, 12345, 0]]);
    assert.ok(miniFindClass(groups[0], "pair-ledger-item-text")[0].textContent.includes("仅属于甲关系"));
    assert.strictEqual(miniFindClass(groups[1], "pair-ledger-item-text").length, 0, "甲的事项 must stay out of 乙's group");

    findButton(groups[0], "查看原摘要").click();
    await flushDomEvents();
    assert.deepStrictEqual(sourceCalls[0], {
      ownerId: 77754,
      counterpartId: 12345,
      sourceSummaryKey: "source-b",
      expectedSourceRevision: "rev-b"
    }, "source verification must use the opened relationship and expected revision");
    assert.strictEqual(miniFindClass(groups[0], "pair-source-content")[0].textContent, "已验真的 source-b");

    findButton(groups[0], "下一页").click();
    await flushDomEvents();
    assert.deepStrictEqual(calls.map(call => [call.counterpartId, call.page]), [[12345, 0], [12345, 1]], "paging must stay within the selected Pair");
    assert.ok(miniFindClass(groups[0], "pair-ledger-item-text")[0].textContent.includes("第 2 页"));

    clickDetails(groups[0]);
    clickDetails(groups[0]);
    await flushDomEvents();
    assert.strictEqual(calls.length, 2, "closing and reopening an already mounted Pair must not duplicate its initial fetch");
    assert.strictEqual((listeners.get("votc:pair-memory-index-updated") || []).length, 2, "reopening must not add child event listeners");

    clickDetails(groups[1]);
    await flushDomEvents();
    assert.deepStrictEqual(calls.slice(2).map(call => [call.ownerId, call.counterpartId]), [[77754, 23456]]);
    assert.ok(miniFindClass(groups[1], "pair-ledger-item-text")[0].textContent.includes("仅属于乙关系"));
    assert.ok(!groups[1].textContent.includes("仅属于甲关系"), "乙's group must not display 甲's records");
    assert.strictEqual((listeners.get("votc:pair-memory-index-updated") || []).length, 3);

    dispose();
    assert.strictEqual((listeners.get("votc:pair-memory-index-updated") || []).length, 0, "Owner disposal must remove its own and all child listeners");
    assert.strictEqual(host.children.length, 0);

    const remountHost = makeHost();
    const disposeRemount = ui.mount(remountHost, {
      mode: "owner",
      ownerId: 77754,
      ownerName: "保罗",
      counterparts: [
        { counterpartId: 12345, counterpartName: "甲" },
        { counterpartId: 23456, counterpartName: "乙" }
      ]
    });
    assert.strictEqual(miniFindClass(remountHost, "pair-ledger-group").length, 2, "a fresh mount should still expose the existing relationship catalog");
    assert.strictEqual(miniFindClass(remountHost, "pair-ledger-group").filter(group => group.open).length, 0);
    clickDetails(miniFindClass(remountHost, "pair-ledger-group")[1]);
    await flushDomEvents();
    assert.deepStrictEqual(calls.at(-1) && [calls.at(-1).ownerId, calls.at(-1).counterpartId], [77754, 23456], "remounted catalog should load the selected existing Pair");
    disposeRemount();
    assert.strictEqual((listeners.get("votc:pair-memory-index-updated") || []).length, 0);
  });
}

async function testOwnerSuccessFoldsAndFailureRemainsVisible() {
  await withMiniDom({}, async ({ makeHost }) => {
    let failNext = false;
    const api = {
      previewPairMemoryBackfill: async () => ({
        success: true,
        writable: true,
        previewRevision: "owner-preview",
        counts: { scannedSummaryCount: 2, candidateItemCount: 1 },
        skipReasons: { no_title: 1 },
        pairs: [{ counterpartId: 12345, counterpartName: "甲", previewRevision: "pair-preview" }]
      }),
      applyPairMemoryBackfill: async payload => ({
        success: !failNext,
        ownerId: payload.ownerId,
        counterpartId: payload.counterpartId,
        counterpartName: "甲",
        totalCount: 1,
        ...(failNext ? { error: "pair_memory_apply_failed" } : {})
      })
    };
    globalThis.conversationAPI = api;
    const host = makeHost();
    const dispose = ui.mount(host, { mode: "owner", ownerId: 77754, ownerName: "保罗", counterparts: [{ counterpartId: 12345, counterpartName: "甲" }] });
    const folder = miniFindClass(host, "pair-ledger-folder")[0];
    const maintenance = miniFindClass(host, "pair-ledger-maintenance")[0];

    folder.open = true;
    clickDetails(maintenance);
    findButton(maintenance, "批量生成长期事项簿（仅当前合法战役）").click();
    await flushDomEvents();
    assert.strictEqual(miniFindClass(host, "pair-ledger-folder")[0], folder, "preview state updates must keep the outer folder DOM stable");
    assert.strictEqual(miniFindClass(host, "pair-ledger-maintenance")[0], maintenance, "preview state updates must keep the maintenance details stable");
    assert.ok(miniFindClass(maintenance, "pair-ledger-diagnostics").every(details => !details.open), "preview diagnostics should be collapsed by default");
    findButton(maintenance, "确认生成此 Owner 的长期事项簿").click();
    await flushDomEvents();
    const resultDetails = miniFindClass(host, "pair-ledger-result-details")[0];
    assert.ok(resultDetails && !resultDetails.open, "successful batch details should start collapsed");
    assert.strictEqual(miniFindClass(host, "pair-ledger-folder")[0], folder, "success rendering must update the existing folder rather than replace it");
    assert.strictEqual(miniFindClass(host, "pair-ledger-maintenance")[0], maintenance, "success rendering must update the existing maintenance details rather than replace it");
    assert.ok(!folder.open && !maintenance.open, "successful generation should fold the folder and maintenance controls");
    assert.match(miniFindClass(host, "pair-ledger-folder-summary")[0].textContent, /已更新/);

    folder.open = true;
    clickDetails(maintenance);
    failNext = true;
    findButton(maintenance, "批量生成长期事项簿（仅当前合法战役）").click();
    await flushDomEvents();
    findButton(maintenance, "确认生成此 Owner 的长期事项簿").click();
    await flushDomEvents();
    const failedDetails = miniFindClass(host, "pair-ledger-result-details")[0];
    assert.ok(failedDetails?.open, "failed or partial batch result should be expanded so the failure remains discoverable");
    assert.match(failedDetails.textContent, /失败|操作失败/);
    assert.ok(folder.open && maintenance.open, "failed generation should leave the user's current work area open");
    assert.ok(!miniFindClass(host, "pair-ledger-diagnostics").some(details => details.open), "technical diagnostics should remain opt-in even when failure details are visible");
    dispose();
  });
}

async function testClosedRelationshipStillSurfacesLoadError() {
  await withMiniDom({}, async ({ makeHost }) => {
    globalThis.conversationAPI = {
      getPairMemoryIndex: async () => ({ success: false, error: "PAIR_MEMORY_INDEX_UNAVAILABLE" })
    };
    const host = makeHost();
    const dispose = ui.mount(host, {
      mode: "owner",
      ownerId: 77754,
      ownerName: "保罗",
      counterparts: [{ counterpartId: 12345, counterpartName: "甲" }]
    });
    const group = miniFindClass(host, "pair-ledger-group")[0];
    clickDetails(group);
    await flushDomEvents();
    const groupSummary = group.children[0];
    clickDetails(group);
    assert.match(groupSummary.textContent, /失败|错误|处理|重试|读取/, "closing a relationship must retain a visible hint that its load failed");
    clickDetails(group);
    assert.ok(miniFindClass(group, "pair-ledger-error").length > 0, "reopening a failed relationship should reveal the original error");
    dispose();
  });
}

async function testStandalonePairEntryIsFolded() {
  await withMiniDom({}, async ({ makeHost }) => {
    globalThis.conversationAPI = {
      getPairMemoryIndex: async payload => ({
        success: true,
        ...payload,
        totalCount: 1,
        page: 0,
        pageSize: 20,
        items: [{ text: "单独 Pair 可继续浏览", conversationDate: "1090.02.03", source: { sourceSummaryKey: "pair-source", sourceRevision: "pair-revision" } }]
      })
    };
    const host = makeHost();
    const dispose = ui.mount(host, { mode: "pair", ownerId: 77754, counterpartId: 12345, ownerName: "保罗", counterpartName: "甲" });
    await flushDomEvents();
    const folder = miniFindClass(host, "pair-ledger-folder")[0];
    const maintenance = miniFindClass(host, "pair-ledger-maintenance")[0];
    assert.ok(folder && !folder.open, "standalone Pair entry should remain folded by default");
    assert.match(miniFindClass(host, "pair-ledger-folder-summary")[0].textContent, /保罗 → 甲/);
    assert.ok(maintenance && !maintenance.open, "standalone generation controls should also be folded");
    assert.ok(miniFindClass(host, "pair-ledger-item-text")[0].textContent.includes("单独 Pair 可继续浏览"), "folding the entry must preserve the loaded catalog in the DOM");
    assert.strictEqual(miniFindClass(host, "pair-ledger-item-date")[0].textContent, "1090.02.03");
    dispose();
  });
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
  const pairUiCss = fs.readFileSync(path.join(root, "src", "app", "renderer", "pair-long-term-ui.css"), "utf8");
  const folderRule = pairUiCss.match(/\.pair-ledger-folder\s*\{([^}]*)\}/)?.[1] || "";
  assert.match(folderRule, /background:\s*var\(--votc-surface\s*,/,
    "folder surface should use the active VOTC theme token");
  assert.match(folderRule, /color:\s*var\(--votc-text-body\s*,/,
    "folder text should use the paired body-text token");
  assert.doesNotMatch(folderRule, /var\(--votc-panel\s*(?:,|\))/,
    "folder background must not regress to the legacy panel token");
  assert.doesNotMatch(folderRule, /var\(--votc-text\s*(?:,|\))/,
    "folder text must not regress to the legacy text token");
  assert.match(pairUiCss, /\.pair-ledger-item\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+max-content/s,
    "matter rows should reserve a right-side date column");
  assert.match(pairUiCss, /\.pair-ledger-item-text\s*\{[^}]*grid-column:\s*1[^}]*grid-row:\s*1/s,
    "matter text should occupy the first column");
  assert.match(pairUiCss, /\.pair-ledger-item-date\s*\{[^}]*grid-column:\s*2[^}]*grid-row:\s*1[^}]*text-align:\s*right/s,
    "matter date should share the first row and align to the right");
  const reactEntry = fs.readFileSync(path.join(root, "src", "app", "renderer", "assets", "index-Dn3qWlAB.js"), "utf8");
  assert.match(reactEntry, /mode: "owner", ownerId: Number\(playerId\),[\s\S]*?counterparts: ownerSummaries\.map\(metadata => \(\{ counterpartId: Number\(metadata\.counterpartId \?\? metadata\.characterId\),[\s\S]*?counterpartName: summaryPersonName\(metadata\.counterpartName \|\| metadata\.characterName\) \}\)\),[\s\S]*?onLocateSource: \(resolvedSource, item\) => handleLocateResolvedSource\(resolvedSource, item\)/,
    "Owner catalog mount must use all persisted owner conversation metadata and preserve verified source navigation");

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
  await testRefreshLatestWins();
  await testSourceLatestCloseAndDispose();
  await testDisposeStopsBatchAfterInflightPair();
  await testSingleSuccessRefreshesOnce();
  await testOwnerCatalogIsolationPagingSourceAndDispose();
  await testOwnerSuccessFoldsAndFailureRemainsVisible();
  await testClosedRelationshipStillSurfacesLoadError();
  await testStandalonePairEntryIsFolded();
  process.stdout.write("V9.3.5 Pair Memory Renderer UI: PASS\n");
}

main().catch(error => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
