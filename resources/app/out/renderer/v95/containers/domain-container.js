import { createContextEpoch } from "../state/context-epoch.js";
import { createScopedResourceStore } from "../state/scoped-resource-store.js";
import { createRequestController } from "../state/request-controller.js";
import { CONTRACT_VERSION, assertView, validateIntent } from "../contracts/view-contract.v1.js";
import { createContractError, normalizeErrorCode } from "../contracts/errors.v1.js";
import { DOMAIN_ADAPTERS, projectDomainRecord } from "../adapters/domain-adapters.js";

const RESOURCE_KEY = "domain-records";
const CONTEXT_METHOD = "conversation:getUiContext";
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 200;
const MAX_STABLE_UI_IDS = 1000;
const ACTIVE_CONVERSATION_KINDS = new Set(["conversation-feed", "knowledge-facts", "action-activity"]);
const RECORD_ID_FIELDS = Object.freeze({
  "conversation-feed": ["entryId", "messageId", "recordId", "id"],
  "memory-list": ["itemId", "summaryId", "recordId", "id"],
  "knowledge-facts": ["factId", "recordId", "id"],
  "worldline-timeline": ["eventId", "recordId", "id"],
  "letter-list": ["letterId", "recordId", "id"],
  "action-activity": ["activityId", "actionId", "recordId", "id"],
  "provider-diagnostics": ["metricId", "recordId", "id"],
  "settings-section": ["settingId", "id", "settingKey"]
});

function createUiId() {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi && typeof cryptoApi.randomUUID === "function") return `ui-${cryptoApi.randomUUID()}`;
  if (cryptoApi && typeof cryptoApi.getRandomValues === "function") {
    const bytes = new Uint8Array(16);
    cryptoApi.getRandomValues(bytes);
    return `ui-${Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("")}`;
  }
  return `ui-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

function encodeParts(values) {
  return values.map(value => {
    const part = value === null || value === undefined ? "" : String(value);
    return `${part.length}:${part}`;
  }).join("|");
}

function validTag(value) {
  return value === null || typeof value === "string" && value.length > 0 && value.length <= 160;
}

function validLocalKey(value) {
  return value === null || typeof value === "string" && value.length > 0 && value.length <= 160
    || Number.isSafeInteger(value);
}

function readMainContext(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || !validTag(value.campaignTag) || !validTag(value.ownerTag) || !validTag(value.conversationTag)
    || !Number.isSafeInteger(value.conversationEpoch) || value.conversationEpoch < 0
    || typeof value.isActive !== "boolean") return null;
  return Object.freeze({
    campaignTag: value.campaignTag,
    ownerTag: value.ownerTag,
    conversationTag: value.conversationTag,
    conversationEpoch: value.conversationEpoch,
    isActive: value.isActive
  });
}

function sameMainContext(left, right) {
  return Boolean(left && right && left.campaignTag === right.campaignTag && left.ownerTag === right.ownerTag
    && left.conversationTag === right.conversationTag && left.conversationEpoch === right.conversationEpoch
    && left.isActive === right.isActive);
}

function safeTotal(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function readRecordField(record, field) {
  try {
    return record?.[field];
  } catch (_ignored) {
    return undefined;
  }
}

function freezeRow(row) {
  if (row.badge) Object.freeze(row.badge);
  if (row.actions) Object.freeze(row.actions);
  if (row.metric) Object.freeze(row.metric);
  if (row.control) {
    if (row.control.options) {
      row.control.options.forEach(Object.freeze);
      Object.freeze(row.control.options);
    }
    Object.freeze(row.control);
  }
  return Object.freeze(row);
}

export function createDomainContainer({ kind, ipcClient, readMethod, selectRecords, t, onIntent } = {}) {
  const adapter = DOMAIN_ADAPTERS[kind];
  if (!adapter || !ipcClient || typeof ipcClient.read !== "function" || typeof readMethod !== "string"
    || !readMethod || typeof selectRecords !== "function" || typeof t !== "function"
    || onIntent !== undefined && typeof onIntent !== "function") throw createContractError("VALIDATION_ERROR");

  const contextEpoch = createContextEpoch();
  const resourceStore = createScopedResourceStore(contextEpoch);
  const requestController = createRequestController({ contextEpoch, resourceStore });
  const listeners = new Set();
  let currentContext = null;
  let currentScope = null;
  let localView = null;
  let scopeIdentity = null;
  let resourceScopeKey = null;
  let scopeTag = createUiId();
  let revisionTag = createUiId();
  let currentPage = 1;
  let currentPageSize = DEFAULT_PAGE_SIZE;
  let currentFilter = null;
  let liveVerified = false;
  let staleErrorCode = null;
  let refreshSequence = 0;
  let destroyed = false;
  let stableUiIds = new Map();
  let weakUiIds = new WeakMap();

  function isReadableContext(context) {
    if (!context) return false;
    // This is only the local scope gate; Main's read IPC remains authoritative for offline data.
    if (!ACTIVE_CONVERSATION_KINDS.has(kind)) return true;
    return Boolean(context.isActive && context.campaignTag && context.ownerTag && context.conversationTag);
  }

  function recordIdentity(record) {
    for (const field of RECORD_ID_FIELDS[kind]) {
      const value = readRecordField(record, field);
      if (typeof value === "string" && value.trim() && value.length <= 160) return `${field}:s:${value}`;
      if (Number.isSafeInteger(value)) return `${field}:n:${value}`;
    }
    return null;
  }

  function stageUiId(record, stableUpdates, weakUpdates) {
    const identity = recordIdentity(record);
    if (identity) {
      if (stableUpdates.has(identity)) return stableUpdates.get(identity);
      const known = stableUiIds.get(identity);
      const id = known || createUiId();
      stableUpdates.set(identity, id);
      return id;
    }
    if (weakUpdates.has(record)) return weakUpdates.get(record);
    const known = weakUiIds.get(record);
    const id = known || createUiId();
    weakUpdates.set(record, id);
    return id;
  }

  function commitUiIds(data) {
    for (const [identity, id] of data.stableUpdates) {
      stableUiIds.delete(identity);
      stableUiIds.set(identity, id);
    }
    while (stableUiIds.size > MAX_STABLE_UI_IDS) {
      stableUiIds.delete(stableUiIds.keys().next().value);
    }
    for (const [record, id] of data.weakUpdates) {
      if (!weakUiIds.has(record)) weakUiIds.set(record, id);
    }
  }

  function buildScope(mainContext, viewKey, responderKey) {
    return Object.freeze({ ...mainContext, viewKey, responderKey });
  }

  function notify() {
    if (destroyed) return;
    const view = getView();
    for (const listener of Array.from(listeners)) {
      try {
        listener(view);
      } catch (_ignored) {
        // A broken view listener must not interrupt another view.
      }
    }
  }

  function getView() {
    const entry = resourceStore.get(RESOURCE_KEY);
    let state = currentContext ? (isReadableContext(currentContext) && liveVerified ? "idle" : "stale") : "idle";
    let rows = [];
    let total = 0;
    let errorCode = state === "stale" ? staleErrorCode || "STALE_CONTEXT" : null;
    if (entry) {
      state = entry.state;
      if (entry.data && ["ready", "empty", "refreshing"].includes(state)) {
        rows = entry.data.rows;
        total = entry.data.total;
      }
      errorCode = state === "error" ? entry.errorCode || "UNKNOWN_ERROR" : null;
    }
    if (currentContext && (!liveVerified || !isReadableContext(currentContext))) {
      state = "stale";
      rows = [];
      total = 0;
      errorCode = staleErrorCode || "STALE_CONTEXT";
    }
    const view = {
      contractVersion: CONTRACT_VERSION,
      kind,
      state,
      scopeTag,
      revisionTag,
      titleKey: adapter.titleKey,
      rows,
      emptyTextKey: adapter.emptyTextKey,
      errorCode,
      pagination: { page: currentPage, pageSize: currentPageSize, total }
    };
    return assertView(view);
  }

  function setContext(mainDto, { viewKey = null, responderKey = null } = {}) {
    if (destroyed) return getView();
    const mainContext = readMainContext(mainDto);
    if (!mainContext || !validLocalKey(viewKey) || !validLocalKey(responderKey)) throw createContractError("VALIDATION_ERROR");
    const nextScope = buildScope(mainContext, viewKey, responderKey);
    const nextScopeKey = encodeParts([
      mainContext.campaignTag, mainContext.ownerTag, mainContext.conversationTag,
      mainContext.conversationEpoch, mainContext.isActive, viewKey, responderKey
    ]);
    const changed = scopeIdentity !== nextScopeKey;
    const wasLiveVerified = liveVerified;
    currentContext = mainContext;
    currentScope = nextScope;
    liveVerified = isReadableContext(mainContext);
    staleErrorCode = liveVerified ? null : "STALE_CONTEXT";
    if (changed) {
      refreshSequence += 1;
      requestController.cancelAll();
      contextEpoch.setContext({
        campaignKey: encodeParts([mainContext.campaignTag, mainContext.ownerTag]),
        conversationKey: encodeParts([mainContext.conversationTag, mainContext.conversationEpoch]),
        viewKey: encodeParts([viewKey, responderKey])
      });
      scopeIdentity = nextScopeKey;
      resourceScopeKey = createUiId();
      if (liveVerified) resourceStore.activateScope(resourceScopeKey);
      else resourceStore.clear();
      stableUiIds.clear();
      weakUiIds = new WeakMap();
      currentPage = 1;
      currentPageSize = DEFAULT_PAGE_SIZE;
      currentFilter = null;
      scopeTag = createUiId();
    }
    if (changed || !wasLiveVerified && liveVerified) revisionTag = createUiId();
    notify();
    return getView();
  }

  function currentReadArgs() {
    return {
      page: currentPage,
      pageSize: currentPageSize,
      ...(currentFilter ? { filterKey: currentFilter.key, value: currentFilter.value } : {})
    };
  }

  function updateReadArgs(args) {
    if (!args || typeof args !== "object" || Array.isArray(args)) return false;
    let nextPage = currentPage;
    let nextPageSize = currentPageSize;
    let nextFilter = currentFilter;
    if (Object.hasOwn(args, "page")) {
      if (!Number.isSafeInteger(args.page) || args.page < 1) return false;
      nextPage = args.page;
    }
    if (Object.hasOwn(args, "pageSize")) {
      if (!Number.isSafeInteger(args.pageSize) || args.pageSize < 1) return false;
      nextPageSize = Math.min(MAX_PAGE_SIZE, args.pageSize);
    }
    if (Object.hasOwn(args, "filterKey")) {
      if (typeof args.filterKey !== "string" || args.filterKey.length < 1 || args.filterKey.length > 120
        || !(args.value === null || typeof args.value === "boolean" || typeof args.value === "string" && args.value.length <= 500)) return false;
      nextFilter = { key: args.filterKey, value: args.value };
      nextPage = 1;
    }
    currentPage = nextPage;
    currentPageSize = nextPageSize;
    currentFilter = nextFilter;
    return true;
  }

  function makeSelection(response, readArgs) {
    if (response && typeof response === "object" && response.success === false) {
      throw createContractError(normalizeErrorCode({ errorCode: response.errorCode || response.code }));
    }
    const selected = selectRecords(response, Object.freeze({ ...readArgs }));
    let records;
    let total;
    if (Array.isArray(selected)) {
      records = selected;
      total = safeTotal(response?.totalCount) ?? safeTotal(response?.total) ?? records.length;
    } else if (selected && typeof selected === "object" && !Array.isArray(selected) && Array.isArray(selected.records)) {
      records = selected.records;
      total = safeTotal(selected.total) ?? safeTotal(response?.totalCount) ?? safeTotal(response?.total) ?? records.length;
    } else {
      throw createContractError("VALIDATION_ERROR");
    }
    const rows = [];
    const recordByRowId = new Map();
    const seenRowIds = new Set();
    const stableUpdates = new Map();
    const weakUpdates = new Map();
    for (const record of records.slice(0, currentPageSize)) {
      if (record === null || typeof record !== "object" || Array.isArray(record)) continue;
      const id = stageUiId(record, stableUpdates, weakUpdates);
      if (seenRowIds.has(id)) continue;
      const row = projectDomainRecord(kind, record, { id, t });
      if (!row) continue;
      seenRowIds.add(id);
      rows.push(freezeRow(row));
      recordByRowId.set(id, record);
    }
    return Object.freeze({ rows: Object.freeze(rows), recordByRowId, stableUpdates, weakUpdates, total: Math.max(total, rows.length) });
  }

  async function refresh(args = {}) {
    if (destroyed) return getView();
    if (!updateReadArgs(args) || !liveVerified || !isReadableContext(currentContext)) return getView();
    const sequence = ++refreshSequence;
    const capturedScopeTag = scopeTag;
    const readArgs = currentReadArgs();
    revisionTag = createUiId();
    const pending = requestController.read(RESOURCE_KEY, async ({ signal }) => {
      const response = await ipcClient.read(readMethod, readArgs, { signal });
      if (signal.aborted) throw createContractError("REQUEST_CANCELLED");
      return makeSelection(response, readArgs);
    }, { isEmpty: data => data.total === 0 });
    notify();
    const result = await pending;
    if (!destroyed && sequence === refreshSequence && capturedScopeTag === scopeTag) {
      if (result.committed && result.value) commitUiIds(result.value);
      revisionTag = createUiId();
      notify();
    }
    return getView();
  }

  function markLiveContextUnavailable(errorCode) {
    refreshSequence += 1;
    requestController.cancelAll();
    resourceStore.clear();
    if (liveVerified && resourceScopeKey) resourceStore.activateScope(resourceScopeKey);
    liveVerified = false;
    staleErrorCode = errorCode;
    revisionTag = createUiId();
    notify();
  }

  async function handleIntent(intent) {
    if (destroyed) return false;
    const before = getView();
    if (!validateIntent(intent, before)) return false;
    const expectedScopeTag = before.scopeTag;
    const expectedRevisionTag = before.revisionTag;
    let liveDto;
    try {
      liveDto = readMainContext(await ipcClient.read(CONTEXT_METHOD, null));
    } catch (_error) {
      markLiveContextUnavailable("IPC_UNAVAILABLE");
      return false;
    }
    if (destroyed) return false;
    if (!liveDto) {
      markLiveContextUnavailable("STALE_CONTEXT");
      return false;
    }
    if (!sameMainContext(currentContext, liveDto)) {
      setContext(liveDto, { viewKey: currentScope?.viewKey ?? null, responderKey: currentScope?.responderKey ?? null });
      return false;
    }
    liveVerified = isReadableContext(liveDto);
    staleErrorCode = liveVerified ? null : "STALE_CONTEXT";
    const currentView = getView();
    if (currentView.scopeTag !== expectedScopeTag || currentView.revisionTag !== expectedRevisionTag
      || !validateIntent(intent, currentView)) return false;

    if (intent.type === "REQUEST_REFRESH") {
      await refresh();
      return true;
    }
    if (intent.type === "CHANGE_PAGE") {
      await refresh({ page: intent.page });
      return true;
    }
    if (intent.type === "CHANGE_FILTER") {
      await refresh({ page: 1, filterKey: intent.filterKey, value: intent.value });
      return true;
    }
    if (intent.type === "CANCEL_UI") {
      refreshSequence += 1;
      requestController.cancelAll();
      resourceStore.clear();
      if (liveVerified && resourceScopeKey) resourceStore.activateScope(resourceScopeKey);
      revisionTag = createUiId();
      notify();
      return true;
    }
    const record = currentView.rows.some(row => row.id === intent.rowId)
      ? resourceStore.get(RESOURCE_KEY)?.data?.recordByRowId?.get(intent.rowId)
      : undefined;
    if (!record || typeof onIntent !== "function") return false;
    try {
      const outcome = await onIntent(Object.freeze({
        intent: Object.freeze({ ...intent }),
        record,
        context: currentScope,
        view: Object.freeze({ kind, scopeTag, revisionTag })
      }));
      return outcome !== false;
    } catch (_ignored) {
      return false;
    }
  }

  function subscribe(listener) {
    if (typeof listener !== "function") throw createContractError("VALIDATION_ERROR");
    if (destroyed) return () => {};
    listeners.add(listener);
    try {
      listener(getView());
    } catch (_ignored) {
      // Subscriber errors are isolated from the container.
    }
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      listeners.delete(listener);
    };
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    refreshSequence += 1;
    requestController.dispose();
    resourceStore.clear();
    listeners.clear();
    currentContext = null;
    currentScope = null;
    scopeIdentity = null;
    resourceScopeKey = null;
    stableUiIds.clear();
    weakUiIds = new WeakMap();
  }

  return Object.freeze({ setContext, refresh, getView, subscribe, handleIntent, destroy });
}
