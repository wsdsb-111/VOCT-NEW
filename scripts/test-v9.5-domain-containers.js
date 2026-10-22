const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

function importSource(relativePath) {
  return import(pathToFileURL(path.resolve(__dirname, "..", relativePath)).href);
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => { resolve = resolvePromise; reject = rejectPromise; });
  return { promise, resolve, reject };
}

function makeContext(id = "a", epoch = 1) {
  return {
    campaignTag: `ui-campaign-${id}`,
    ownerTag: `ui-owner-${id}`,
    conversationTag: `ui-conversation-${id}`,
    conversationEpoch: epoch,
    isActive: true
  };
}

function makeInactiveContext(epoch = 0) {
  return {
    campaignTag: null,
    ownerTag: null,
    conversationTag: null,
    conversationEpoch: epoch,
    isActive: false
  };
}

function stringValues(value, output = []) {
  if (typeof value === "string") output.push(value);
  else if (Array.isArray(value)) value.forEach(item => stringValues(item, output));
  else if (value && typeof value === "object") Object.values(value).forEach(item => stringValues(item, output));
  return output;
}

function createIpc(createRendererIpcClient, getLiveContext, readHandler) {
  const client = createRendererIpcClient({
    ipcMap: {
      "domain:read": args => readHandler(args),
      "conversation:getUiContext": () => getLiveContext()
    }
  });
  return client;
}

async function main() {
  const [containerModule, adapterModule, ipcModule, contractModule] = await Promise.all([
    importSource("src/app/renderer/v95/containers/domain-container.js"),
    importSource("src/app/renderer/v95/adapters/domain-adapters.js"),
    importSource("src/app/renderer/v95/ipc/renderer-ipc-client.js"),
    importSource("src/app/renderer/v95/contracts/view-contract.v1.js")
  ]);
  const { createDomainContainer } = containerModule;
  const { DOMAIN_ADAPTERS } = adapterModule;
  const { createRendererIpcClient } = ipcModule;
  const { VIEW_KINDS, validateView } = contractModule;
  const translate = key => key === "common.unknown" ? "未知" : key;
  const fixtures = {
    "conversation-feed": { displayName: "甲", role: "npc", text: "对话正文", status: "READY" },
    "memory-list": { title: "旧摘要", summary: "摘要正文", status: "SOURCE_BOUND" },
    "knowledge-facts": { subjectName: "乙", factText: "获授权事实", status: "UNKNOWN" },
    "worldline-timeline": { title: "事件", description: "只读事实", status: "READY" },
    "letter-list": { title: "来信", stage: "ACKNOWLEDGED", effectState: "ACKNOWLEDGED" },
    "action-activity": { title: "和议", stage: "ACKNOWLEDGED", effectState: "ACKNOWLEDGED" },
    "provider-diagnostics": { metricKey: "cacheRate", value: 0.5, unit: "%", estimateKind: "native", apiKey: "SECRET_PROVIDER_KEY" },
    "settings-section": { settingKey: "uiLanguage", value: "en-US", apiKey: "SECRET_PROVIDER_KEY" }
  };

  assert.deepEqual(Object.keys(DOMAIN_ADAPTERS).sort(), [...VIEW_KINDS].sort(), "all eight view kinds have explicit adapters");
  for (const kind of VIEW_KINDS) {
    const source = { ...fixtures[kind], id: `backend-${kind}`, providerConfig: { token: "SECRET_PROVIDER_KEY" } };
    let liveContext = makeContext(kind);
    const calls = [];
    const ipcClient = createIpc(createRendererIpcClient, () => liveContext, args => {
      calls.push(args);
      return { success: true, items: [source], totalCount: 1 };
    });
    const container = createDomainContainer({
      kind, ipcClient, readMethod: "domain:read",
      selectRecords: response => ({ records: response.items, total: response.totalCount }),
      t: translate, onIntent: async () => true
    });
    container.setContext(liveContext, { viewKey: `view-${kind}`, responderKey: "responder-a" });
    const view = await container.refresh({ pageSize: MAX_PAGE_SIZE_FOR_TEST });
    assert.equal(validateView(view).valid, true, `${kind}: projected view satisfies the frozen contract`);
    assert.equal(view.kind, kind);
    assert.equal(view.state, "ready");
    assert.equal(view.rows.length, 1);
    assert.match(view.scopeTag, /^ui-/);
    assert.match(view.revisionTag, /^ui-/);
    assert.match(view.rows[0].id, /^ui-/);
    assert.equal(calls[0].pageSize, 200, `${kind}: page size is capped at 200`);
    assert.deepEqual(Object.keys(calls[0]).sort(), ["page", "pageSize"]);
    assert.equal(Object.prototype.hasOwnProperty.call(view.rows[0], "id"), true);
    assert.notEqual(view.rows[0].id, source.id, `${kind}: backend identity never becomes the UI row id`);
    assert.equal(stringValues(view).some(value => value.includes("SECRET_PROVIDER_KEY") || value.includes(`backend-${kind}`)), false,
      `${kind}: provider credentials and backend ids do not enter the view`);
    assert.equal(Object.keys(view.rows[0]).some(key => ["apiKey", "providerConfig", "source", "record"].includes(key)), false);
    if (kind === "letter-list" || kind === "action-activity") {
      assert.equal(view.rows[0].stage, "ACKNOWLEDGED");
      assert.equal(view.rows[0].effectState, "ACKNOWLEDGED", "an acknowledgement is never promoted to CONFIRMED");
    }
    container.destroy();
  }

  {
    let liveContext = makeContext("unknown");
    const ipcClient = createIpc(createRendererIpcClient, () => liveContext, () => ({
      success: true, items: [{ id: "backend-123456", title: "123456", unexpectedState: "PRIVATE_ERROR" }], totalCount: 1
    }));
    const container = createDomainContainer({
      kind: "memory-list", ipcClient, readMethod: "domain:read",
      selectRecords: response => response.items, t: translate
    });
    container.setContext(liveContext, { viewKey: "view", responderKey: "npc" });
    const view = await container.refresh();
    assert.equal(view.rows[0].title, "未知", "a missing name uses common.unknown rather than a backend id");
    assert.equal(view.rows[0].badge.textKey, "status.UNKNOWN", "unrecognized machine status maps to the frozen UNKNOWN key");
    container.destroy();
  }

  {
    let liveContext = makeContext("stable-ids");
    const unkeyedOne = { title: "同名无标识" };
    const unkeyedTwo = { title: "同名无标识" };
    let items = [
      { id: "backend-same-name-1", title: "同名" },
      { id: "backend-same-name-2", title: "同名" },
      unkeyedOne,
      unkeyedTwo
    ];
    const ipcClient = createIpc(createRendererIpcClient, () => liveContext, () => ({ success: true, items, totalCount: items.length }));
    const container = createDomainContainer({
      kind: "memory-list", ipcClient, readMethod: "domain:read",
      selectRecords: response => response.items, t: translate
    });
    container.setContext(liveContext, { viewKey: "view", responderKey: "npc" });
    const first = await container.refresh();
    assert.equal(first.rows.length, 4, "same-name records without identifiers remain separate by object identity");
    assert.notEqual(first.rows[0].id, first.rows[1].id, "same-name records with different backend ids have distinct UI ids");
    assert.notEqual(first.rows[2].id, first.rows[3].id, "missing backend ids never fall back to names");

    items = [
      { id: "backend-same-name-1", title: "同名" },
      { id: "backend-same-name-2", title: "同名" },
      unkeyedOne,
      unkeyedTwo
    ];
    const second = await container.refresh();
    assert.deepEqual(second.rows.map(row => row.id), first.rows.map(row => row.id),
      "trusted ids persist across new record objects and unkeyed objects persist through their WeakMap identity");

    liveContext = makeContext("stable-ids-new-scope", 2);
    container.setContext(liveContext, { viewKey: "view", responderKey: "npc" });
    const reset = await container.refresh();
    assert.notEqual(reset.rows[0].id, first.rows[0].id, "scope changes discard prior backend-to-UI mappings");
    assert.equal(stringValues(reset).some(value => value.includes("backend-same-name-1")), false,
      "stable identity values remain private to the container");
    container.destroy();
  }

  {
    const inactiveContext = makeInactiveContext();
    const uniqueCampaignContext = {
      ...inactiveContext,
      campaignTag: "ui-campaign-offline-unique"
    };
    const recordsByKind = {
      "memory-list": [{ id: "offline-summary", title: "Main 返回的离线摘要", summary: "只读摘要" }],
      "provider-diagnostics": [{ id: "offline-metric", metricKey: "cacheRate", value: 0.5, unit: "%" }],
      "settings-section": [{ id: "offline-setting", settingKey: "uiLanguage", value: "en-US" }],
      "worldline-timeline": [{ eventId: "offline-event", title: "离线世界线事实" }],
      "letter-list": [{ letterId: "offline-letter", title: "来信" }]
    };
    for (const [kind, items] of Object.entries(recordsByKind)) {
      const liveContext = kind === "memory-list" ? uniqueCampaignContext : inactiveContext;
      let readCount = 0;
      const ipcClient = createIpc(createRendererIpcClient, () => liveContext, () => {
        readCount += 1;
        return { success: true, items, totalCount: items.length };
      });
      const container = createDomainContainer({
        kind, ipcClient, readMethod: "domain:read",
        selectRecords: response => response.items, t: translate
      });
      container.setContext(liveContext, { viewKey: `offline-${kind}`, responderKey: null });
      const view = await container.refresh();
      assert.equal(readCount, 1, `${kind}: Main-authorized reads remain available with an inactive/null conversation DTO`);
      assert.equal(view.state, "ready", `${kind}: inactive read results can be displayed`);
      assert.equal(view.rows.length, 1);
      container.destroy();
    }
  }

  {
    for (const kind of ["conversation-feed", "knowledge-facts", "action-activity"]) {
      let liveContext = { ...makeContext(`inactive-${kind}`), isActive: false };
      let readCount = 0;
      const ipcClient = createIpc(createRendererIpcClient, () => liveContext, () => {
        readCount += 1;
        return { success: true, items: [{ id: "should-not-read", title: "不可读" }], totalCount: 1 };
      });
      const container = createDomainContainer({
        kind, ipcClient, readMethod: "domain:read",
        selectRecords: response => response.items, t: translate
      });
      const inactiveView = container.setContext(liveContext, { viewKey: `active-only-${kind}`, responderKey: "npc" });
      assert.equal(inactiveView.state, "stale", `${kind}: inactive conversation context stays stale`);
      assert.equal((await container.refresh()).state, "stale");
      assert.equal(readCount, 0, `${kind}: inactive contexts cannot trigger conversation-bound reads`);

      liveContext = { ...makeContext(`missing-scope-${kind}`), ownerTag: null };
      const missingScopeView = container.setContext(liveContext, { viewKey: `active-only-${kind}`, responderKey: "npc" });
      assert.equal(missingScopeView.state, "stale", `${kind}: active DTOs without all required scope tags stay stale`);
      await container.refresh();
      assert.equal(readCount, 0, `${kind}: missing scope tags cannot trigger reads`);
      container.destroy();
    }
  }

  {
    let liveContext = makeContext("states");
    const emptyRead = deferred();
    const refreshRead = deferred();
    let mode = "empty";
    const ipcClient = createIpc(createRendererIpcClient, () => liveContext, () => {
      if (mode === "empty") return emptyRead.promise;
      if (mode === "refreshing") return refreshRead.promise;
      if (mode === "error") return { success: false, errorCode: "PROVIDER_UNAVAILABLE", message: "SECRET_PROVIDER_KEY" };
      return { success: true, items: [{ title: "可见行" }], totalCount: 1 };
    });
    const container = createDomainContainer({
      kind: "memory-list", ipcClient, readMethod: "domain:read",
      selectRecords: response => response.items, t: translate
    });
    assert.equal(container.getView().state, "idle");
    container.setContext(liveContext, { viewKey: "view", responderKey: "npc" });
    const firstRead = container.refresh();
    assert.equal(container.getView().state, "loading");
    emptyRead.resolve({ success: true, items: [], totalCount: 0 });
    assert.equal((await firstRead).state, "empty");
    mode = "ready";
    await container.refresh();
    mode = "refreshing";
    const refresh = container.refresh();
    assert.equal(container.getView().state, "refreshing");
    refreshRead.resolve({ success: true, items: [{ title: "刷新后" }], totalCount: 1 });
    assert.equal((await refresh).state, "ready");
    mode = "error";
    const errorView = await container.refresh();
    assert.equal(errorView.state, "error");
    assert.equal(errorView.errorCode, "PROVIDER_UNAVAILABLE");
    assert.equal(stringValues(errorView).includes("SECRET_PROVIDER_KEY"), false, "raw error details never enter a View");
    const inactiveContext = { ...liveContext, isActive: false };
    const staleView = container.setContext(inactiveContext, { viewKey: "view", responderKey: "npc" });
    assert.equal(staleView.state, "idle", "offline memory reads remain available through Main authorization");
    container.destroy();
  }

  {
    const first = deferred();
    const second = deferred();
    let liveContext = makeContext("latest");
    let calls = 0;
    const ipcClient = createIpc(createRendererIpcClient, () => liveContext, () => (++calls === 1 ? first.promise : second.promise));
    const container = createDomainContainer({
      kind: "conversation-feed", ipcClient, readMethod: "domain:read",
      selectRecords: response => ({ records: response.items, total: response.totalCount }), t: translate
    });
    container.setContext(liveContext, { viewKey: "view", responderKey: "npc" });
    const older = container.refresh();
    await Promise.resolve();
    const newer = container.refresh();
    second.resolve({ success: true, items: [{ displayName: "最新" }], totalCount: 1 });
    await newer;
    first.resolve({ success: true, items: [{ displayName: "迟到" }], totalCount: 1 });
    await older;
    assert.equal(container.getView().rows[0].title, "最新", "late older reads cannot replace the latest page");
    container.destroy();
  }

  {
    const pending = deferred();
    let liveContext = makeContext("scope-old");
    const ipcClient = createIpc(createRendererIpcClient, () => liveContext, () => pending.promise);
    const container = createDomainContainer({
      kind: "memory-list", ipcClient, readMethod: "domain:read",
      selectRecords: response => response.items, t: translate
    });
    container.setContext(liveContext, { viewKey: "view", responderKey: "npc" });
    const oldRead = container.refresh();
    await Promise.resolve();
    liveContext = makeContext("scope-new", 2);
    const nextView = container.setContext(liveContext, { viewKey: "view", responderKey: "npc" });
    assert.equal(nextView.rows.length, 0, "scope change clears rows before the old read settles");
    assert.equal(nextView.state, "idle");
    pending.resolve({ success: true, items: [{ title: "旧战役" }], totalCount: 1 });
    await oldRead;
    assert.equal(container.getView().rows.length, 0, "old-scope completion cannot repopulate the new view");
    container.destroy();
  }

  {
    let liveContext = makeContext("intent");
    const rawRecord = { title: "批准项", id: "backend-only-id", apiKey: "SECRET_PROVIDER_KEY" };
    const callbacks = [];
    let writeCalls = 0;
    const baseIpc = createIpc(createRendererIpcClient, () => liveContext, () => ({ success: true, items: [rawRecord], totalCount: 1 }));
    const ipcClient = Object.freeze({ read: baseIpc.read, write: () => { writeCalls += 1; } });
    const container = createDomainContainer({
      kind: "action-activity", ipcClient, readMethod: "domain:read",
      selectRecords: response => response.items, t: translate,
      onIntent: async payload => { callbacks.push(payload); return true; }
    });
    container.setContext(liveContext, { viewKey: "view", responderKey: "npc" });
    const ready = await container.refresh();
    const staleIntent = {
      type: "REQUEST_APPROVAL", viewKind: ready.kind, scopeTag: ready.scopeTag,
      revisionTag: ready.revisionTag, rowId: ready.rows[0].id
    };
    container.setContext(makeContext("intent-new"), { viewKey: "view", responderKey: "npc" });
    assert.equal(await container.handleIntent(staleIntent), false, "old scope/revision intent is rejected");
    assert.equal(callbacks.length, 0);

    liveContext = makeContext("intent-new");
    const newView = await container.refresh();
    const approvalIntent = {
      type: "REQUEST_APPROVAL", viewKind: newView.kind, scopeTag: newView.scopeTag,
      revisionTag: newView.revisionTag, rowId: newView.rows[0].id
    };
    assert.equal(await container.handleIntent(approvalIntent), true);
    assert.equal(callbacks.length, 1);
    assert.equal(callbacks[0].record, rawRecord, "row UI id resolves to the original record only inside onIntent");
    assert.equal(writeCalls, 0, "REQUEST_APPROVAL is delegated and never writes through IPC here");
    assert.equal(stringValues(container.getView()).includes("SECRET_PROVIDER_KEY"), false);
    container.destroy();
  }

  {
    let liveContext = makeContext("paging");
    const calls = [];
    const ipcClient = createIpc(createRendererIpcClient, () => liveContext, args => {
      calls.push(args);
      return { success: true, items: [{ title: "筛选行" }], totalCount: 25 };
    });
    const container = createDomainContainer({
      kind: "memory-list", ipcClient, readMethod: "domain:read",
      selectRecords: response => ({ records: response.items, total: response.totalCount }), t: translate
    });
    container.setContext(liveContext, { viewKey: "view", responderKey: "npc" });
    const initial = await container.refresh({ page: 2, pageSize: 20 });
    assert.equal(initial.pagination.page, 2);
    assert.equal(await container.handleIntent({
      type: "CHANGE_FILTER", viewKind: initial.kind, scopeTag: initial.scopeTag,
      revisionTag: initial.revisionTag, rowId: initial.rows[0].id, filterKey: "search", value: "锁"
    }), true);
    assert.deepEqual(calls.at(-1), { page: 1, pageSize: 20, filterKey: "search", value: "锁" });
    const filtered = container.getView();
    assert.equal(await container.handleIntent({
      type: "CHANGE_PAGE", viewKind: filtered.kind, scopeTag: filtered.scopeTag,
      revisionTag: filtered.revisionTag, page: 2
    }), true);
    assert.deepEqual(calls.at(-1), { page: 2, pageSize: 20, filterKey: "search", value: "锁" });
    container.destroy();
  }

  {
    let liveContext = makeContext("stable-id-lru");
    const allRecords = Array.from({ length: 1001 }, (_, index) => ({ id: `backend-row-${index + 1}`, title: `第 ${index + 1} 行` }));
    let openedRecord = null;
    const ipcClient = createIpc(createRendererIpcClient, () => liveContext, args => {
      const start = (args.page - 1) * args.pageSize;
      return { success: true, items: allRecords.slice(start, start + args.pageSize), totalCount: allRecords.length };
    });
    const container = createDomainContainer({
      kind: "memory-list", ipcClient, readMethod: "domain:read",
      selectRecords: response => ({ records: response.items, total: response.totalCount }), t: translate,
      onIntent: async payload => { openedRecord = payload.record; return true; }
    });
    container.setContext(liveContext, { viewKey: "view", responderKey: "npc" });
    const firstPage = await container.refresh({ page: 1, pageSize: 200 });
    const originalOldestUiId = firstPage.rows[0].id;
    let lastPage = firstPage;
    for (let page = 2; page <= 6; page += 1) lastPage = await container.refresh({ page, pageSize: 200 });
    assert.equal(lastPage.rows.at(-1).title, "第 1001 行");
    const currentPageRowId = lastPage.rows.at(-1).id;
    assert.equal(await container.handleIntent({
      type: "OPEN_DETAIL", viewKind: lastPage.kind, scopeTag: lastPage.scopeTag,
      revisionTag: lastPage.revisionTag, rowId: currentPageRowId
    }), true);
    assert.equal(openedRecord, allRecords[1000], "LRU eviction does not remove current-page private row mappings");

    const returnedFirstPage = await container.refresh({ page: 1, pageSize: 200 });
    assert.notEqual(returnedFirstPage.rows[0].id, originalOldestUiId,
      "the oldest mapping is evicted after more than 1000 confirmed record identities");
    container.destroy();
  }

  {
    let liveContext = makeContext("live-check");
    let pendingRead = deferred();
    const ipcClient = createIpc(createRendererIpcClient, () => liveContext, () => pendingRead.promise);
    const listenerViews = [];
    const container = createDomainContainer({
      kind: "letter-list", ipcClient, readMethod: "domain:read",
      selectRecords: response => response.items, t: translate
    });
    container.subscribe(view => listenerViews.push(view));
    container.setContext(liveContext, { viewKey: "view", responderKey: "npc" });
    const read = container.refresh();
    await Promise.resolve();
    const beforeDestroy = listenerViews.length;
    container.destroy();
    pendingRead.resolve({ success: true, items: [{ title: "卸载后" }], totalCount: 1 });
    await read;
    assert.equal(listenerViews.length, beforeDestroy, "destroy unsubscribes listeners and ignores late responses");
    assert.equal(container.getView().rows.length, 0);
  }

  {
    let liveContext = makeContext("changed-live");
    const ipcClient = createIpc(createRendererIpcClient, () => liveContext, () => ({ success: true, items: [{ title: "旧行" }], totalCount: 1 }));
    let intents = 0;
    const container = createDomainContainer({
      kind: "worldline-timeline", ipcClient, readMethod: "domain:read",
      selectRecords: response => response.items, t: translate, onIntent: () => { intents += 1; }
    });
    container.setContext(liveContext, { viewKey: "view", responderKey: "npc" });
    const view = await container.refresh();
    liveContext = makeContext("changed-live", 2);
    const result = await container.handleIntent({
      type: "OPEN_DETAIL", viewKind: view.kind, scopeTag: view.scopeTag,
      revisionTag: view.revisionTag, rowId: view.rows[0].id
    });
    assert.equal(result, false, "live Main context is checked again immediately before handling an intent");
    assert.equal(intents, 0);
    assert.equal(container.getView().rows.length, 0, "live context mismatch clears old rows");
    container.destroy();
  }

  console.log("V9.5 domain containers: PASS (8 allowlisted projections, scoped latest reads, stable opaque row identity, inactive read scopes, live intent validation)");
}

const MAX_PAGE_SIZE_FOR_TEST = 500;
main().catch(error => {
  const code = typeof error?.code === "string" ? error.code : "UNKNOWN_ERROR";
  process.stderr.write(`V9.5 domain container regression failed: ${code}\n`);
  process.exitCode = 1;
});
