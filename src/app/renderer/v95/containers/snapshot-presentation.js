import { createDomainContainer } from "./domain-container.js";
import { projectDomainRecord } from "../adapters/domain-adapters.js";
import { mountByKind } from "../visual/index.js";
import { mountDialog } from "../visual/dialog-shell.js";
import { defaultIconRegistry } from "../icons/icon-registry.js";
import { createContractError } from "../contracts/errors.v1.js";

const RECORDS_READ_METHOD = "snapshot:readCurrentRecords";
const INACTIVE_CONTEXT = Object.freeze({
  campaignTag: null,
  ownerTag: null,
  conversationTag: null,
  conversationEpoch: 0,
  isActive: false
});

function sameContext(left, right) {
  if (left === null || right === null) return left === right;
  return left.campaignTag === right.campaignTag
    && left.ownerTag === right.ownerTag
    && left.conversationTag === right.conversationTag
    && left.conversationEpoch === right.conversationEpoch
    && left.isActive === right.isActive;
}

function visualView(view, hasIntentHandler) {
  const rows = view.rows.map(row => {
    const actions = row.actions.filter(action => action !== "CHANGE_FILTER"
      && (hasIntentHandler || action === "OPEN_DETAIL"));
    return Object.freeze({
      ...row,
      actions: Object.freeze(actions),
      ...(row.control ? { disabled: true } : {})
    });
  });
  return Object.freeze({ ...view, rows: Object.freeze(rows) });
}

function createDetailBody(row, t) {
  const body = document.createElement("div");
  body.className = "v95-snapshot-detail";

  const addText = (value, className = "") => {
    if (value === null || value === undefined || value === "") return;
    const node = document.createElement("p");
    if (className) node.className = className;
    node.textContent = String(value);
    body.appendChild(node);
  };

  if (row.badge?.textKey) addText(t(row.badge.textKey), "v95-snapshot-detail-status");
  if (row.stage || row.effectState) {
    const statusText = [row.stage, row.effectState].filter(Boolean)
      .map(status => t(`status.${status}`)).join(" · ");
    addText(statusText, "v95-snapshot-detail-status");
  }
  addText(row.subtitle, "v95-snapshot-detail-subtitle");
  addText([row.dateText, row.timeText, row.queueTimeText].filter(Boolean).join(" · "), "v95-snapshot-detail-meta");
  if (row.text) {
    const content = document.createElement("pre");
    content.className = "v95-snapshot-detail-text";
    content.textContent = row.text;
    body.appendChild(content);
  }
  if (row.metric) {
    const metric = row.metric.value === null ? t("common.unknown")
      : `${row.metric.value}${row.metric.unit ? ` ${row.metric.unit}` : ""}`;
    addText(`${metric} · ${t(`diagnostics.${row.metric.estimateKind}`)}`, "v95-snapshot-detail-metric");
  }
  if (row.control) {
    const value = typeof row.control.value === "boolean" ? String(row.control.value)
      : row.control.value;
    addText(value, "v95-snapshot-detail-control");
  }
  return body;
}

function capturePresentationState(host) {
  const list = host.querySelector(".v95-list");
  const active = document.activeElement;
  const row = active && host.contains(active) ? active.closest("[data-row-id]") : null;
  const action = active && typeof active.closest === "function" ? active.closest("[data-action]") : null;
  return {
    hostScrollTop: host.scrollTop,
    listScrollTop: list?.scrollTop ?? 0,
    focus: active && host.contains(active) && !active.closest(".v95-dialog-layer") ? {
      rowId: row?.dataset.rowId || null,
      action: action?.dataset.action || null,
      ariaLabel: active.getAttribute?.("aria-label") || "",
      className: typeof active.className === "string" ? active.className : "",
      tagName: active.tagName || ""
    } : null
  };
}

function restorePresentationState(host, state, keepDialogOpen) {
  host.scrollTop = state.hostScrollTop;
  const list = host.querySelector(".v95-list");
  if (list) list.scrollTop = state.listScrollTop;
  if (keepDialogOpen || !state.focus) return;

  let target = null;
  const candidates = Array.from(host.querySelectorAll("button, input, select, [tabindex]"));
  if (state.focus.rowId) {
    const row = Array.from(host.querySelectorAll("[data-row-id]"))
      .find(node => node.dataset.rowId === state.focus.rowId);
    if (row) target = candidates.find(node => row.contains(node)
      && (!state.focus.action || node.dataset.action === state.focus.action));
  }
  if (!target && state.focus.ariaLabel) {
    target = candidates.find(node => node.getAttribute("aria-label") === state.focus.ariaLabel);
  }
  if (!target && state.focus.className) {
    target = candidates.find(node => node.tagName === state.focus.tagName && node.className === state.focus.className);
  }
  try { target?.focus({ preventScroll: true }); } catch (_ignored) { }
}

export function createSnapshotPresentation(host, { kind, runtime, onIntent, onRefresh } = {}) {
  if (!host || typeof host.replaceChildren !== "function" || !runtime
    || typeof runtime.t !== "function" || typeof runtime.getContext !== "function"
    || typeof runtime.syncContext !== "function" || typeof runtime.subscribeContext !== "function"
    || typeof runtime.subscribe !== "function" || onIntent !== undefined && typeof onIntent !== "function") {
    throw createContractError("VALIDATION_ERROR");
  }

  let destroyed = false;
  let records = null;
  let context = runtime.getContext();
  let language = runtime.getPreferences?.().uiLanguage;
  let visual = null;
  let activeDialog = null;
  let activeDetail = null;
  let languageSequence = 0;
  let removeDomainListener = () => {};
  let removeContextListener = () => {};
  let removeRuntimeListener = () => {};

  function openDetail(row) {
    closeDetail(false);
    activeDetail = row;
    let dialog;
    dialog = mountDialog(document.body, {
      title: row.title || runtime.t("common.detail"),
      subtitle: row.subtitle || "",
      icon: row.icon || "unknown",
      variant: "detail",
      body: createDetailBody(row, runtime.t),
      t: runtime.t,
      iconRegistry: defaultIconRegistry,
      onClose: () => {
        if (activeDialog === dialog) {
          activeDialog = null;
          activeDetail = null;
        }
      }
    });
    activeDialog = dialog;
  }

  function closeDetail(preserve = false) {
    const dialog = activeDialog;
    activeDialog = null;
    if (!preserve) activeDetail = null;
    dialog?.destroy();
  }

  function routeIntent(payload) {
    const row = projectDomainRecord(kind, payload.record, {
      id: payload.intent.rowId,
      t: runtime.t
    });
    if (!row) return false;
    if (typeof onIntent !== "function") {
      if (payload.intent.type !== "OPEN_DETAIL") return false;
      openDetail(row);
      return true;
    }
    return onIntent(Object.freeze({ ...payload, record: row }));
  }

  const ipcClient = Object.freeze({
    async read(method, args, options = {}) {
      if (options.signal?.aborted) throw createContractError("REQUEST_CANCELLED");
      if (method === "conversation:getUiContext") {
        await runtime.syncContext();
        return runtime.getContext();
      }
      if (method !== RECORDS_READ_METHOD) throw createContractError("IPC_UNAVAILABLE");
      const source = Array.isArray(records) ? records : [];
      const page = Number.isSafeInteger(args?.page) && args.page > 0 ? args.page : 1;
      const pageSize = Number.isSafeInteger(args?.pageSize) && args.pageSize > 0 ? args.pageSize : 20;
      const start = (page - 1) * pageSize;
      return { records: source.slice(start, start + pageSize), total: source.length };
    }
  });

  const domain = createDomainContainer({
    kind,
    ipcClient,
    readMethod: RECORDS_READ_METHOD,
    selectRecords: response => Array.isArray(response?.records)
      ? { records: response.records, total: response.total }
      : { records: [], total: 0 },
    t: runtime.t,
    onIntent: routeIntent
  });

  domain.setContext(context || INACTIVE_CONTEXT, { viewKey: kind, responderKey: null });

  function render(nextView) {
    if (destroyed || !visual) return;
    visual.update(visualView(nextView, typeof onIntent === "function"));
  }

  function mountVisual() {
    visual = mountByKind(host, visualView(domain.getView(), typeof onIntent === "function"), {
      t: runtime.t,
      emit: intent => { void domain.handleIntent(intent).then(accepted => {
        if (accepted && intent.type === "REQUEST_REFRESH" && typeof onRefresh === "function") onRefresh();
      }); },
      iconRegistry: defaultIconRegistry
    });
  }

  async function remountForLanguage() {
    if (destroyed) return;
    const sequence = ++languageSequence;
    const uiState = capturePresentationState(host);
    const detail = activeDetail;
    closeDetail(true);
    visual?.destroy();
    visual = null;
    // Re-project cached records only; a locale change never re-reads Main.
    if (records) await domain.refresh();
    if (destroyed || sequence !== languageSequence) return;
    mountVisual();
    restorePresentationState(host, uiState, Boolean(detail));
    if (detail) {
      const updated = domain.getView().rows.find(row => row.id === detail.id);
      if (updated) openDetail(updated);
    }
  }

  removeDomainListener = domain.subscribe(render);
  mountVisual();

  removeContextListener = runtime.subscribeContext(next => {
    if (destroyed || sameContext(context, next)) return;
    context = next || null;
    records = null;
    closeDetail();
    domain.setContext(context || INACTIVE_CONTEXT, { viewKey: kind, responderKey: null });
  });

  removeRuntimeListener = runtime.subscribe(state => {
    const nextLanguage = state?.preferences?.uiLanguage;
    if (!nextLanguage || nextLanguage === language) return;
    language = nextLanguage;
    void remountForLanguage();
  });

  async function update(nextRecords) {
    if (destroyed) return domain.getView();
    if (!context) {
      records = null;
      return domain.getView();
    }
    records = Array.isArray(nextRecords) ? nextRecords.slice() : [];
    const pagination = domain.getView().pagination;
    const pageCount = Math.max(1, Math.ceil(records.length / pagination.pageSize));
    return domain.refresh({ page: Math.min(pagination.page, pageCount) });
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    removeContextListener();
    removeRuntimeListener();
    removeDomainListener();
    closeDetail();
    visual?.destroy();
    visual = null;
    domain.destroy();
    records = null;
    context = null;
  }

  function setState(state, errorCode = null) {
    if (destroyed || !["loading", "error", "stale"].includes(state)) return;
    closeDetail();
    visual?.update({ ...domain.getView(), state, rows: [], errorCode,
      pagination: { ...domain.getView().pagination, total: 0 } });
  }

  return Object.freeze({ update, setState, destroy });
}
