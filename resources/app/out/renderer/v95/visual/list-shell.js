/** Generic list shell: header, async states, keyed rows, pagination. */
import { normalizeAsyncState } from "../contracts/async-states.v1.js";
import { el, tSafe, setText, setAriaBusy, uniqueDomId } from "./dom.js";
import { createRow } from "./row-components.js";
import { createIconButton } from "./icon-button.js";
import { createStatePanel, createInlineStatus, createSkeletonRows } from "./status-indicator.js";
import { defaultIconRegistry } from "../icons/icon-registry.js";

export const VIEW_CONFIG = Object.freeze({
  "conversation-feed": { icon: "conversation", navKey: "navigation.conversation" },
  "memory-list": { icon: "memory", navKey: "navigation.memory" },
  "knowledge-facts": { icon: "knowledge", navKey: "navigation.knowledge" },
  "worldline-timeline": { icon: "worldline", navKey: "navigation.worldline" },
  "letter-list": { icon: "letter", navKey: "navigation.letters" },
  "action-activity": { icon: "action", navKey: "navigation.actions" },
  "provider-diagnostics": { icon: "provider", navKey: "navigation.provider" },
  "settings-section": { icon: "settings", navKey: "navigation.settings" }
});


function baseIntent(view, type, extra = {}) {
  return {
    type,
    viewKind: view.kind,
    scopeTag: view.scopeTag,
    revisionTag: view.revisionTag,
    ...extra
  };
}

/**
 * Mount a list-like view. `rowFactory` can customise the row (conversation).
 * Returns the contract lifecycle: { update, destroy }.
 */
export function mountListShell(container, view, { t, emit, iconRegistry } = {}, options = {}) {
  if (!container || !view) throw new Error("V95_VISUAL_ARGUMENT");
  const kind = view.kind;
  const config = VIEW_CONFIG[kind] || { icon: "unknown", navKey: "navigation.conversation" };
  const rowFactory = typeof options.rowFactory === "function" ? options.rowFactory : createRow;
  const titleId = uniqueDomId("v95-view-title");
  const listId = uniqueDomId("v95-view-list");
  const stateSlot = el("div", { className: "v95-view-state-slot" });
  const list = el("div", {
    className: "v95-list",
    attrs: { role: "list", id: listId }
  });
  const listSlot = el("div", { className: "v95-list-slot" }, [list]);
  const title = el("h2", { className: "v95-view-title", attrs: { id: titleId } });
  const eyebrow = el("span", { className: "v95-view-eyebrow" });
  const eyebrowWrap = el("div", { className: "v95-view-eyebrow-wrap" });
  const headerMain = el("div", { className: "v95-view-heading" }, [eyebrowWrap, title]);
  const refreshSlot = el("div", { className: "v95-view-tools" });
  const header = el("header", { className: "v95-view-head" }, [headerMain, refreshSlot]);
  const pagination = el("footer", { className: "v95-pagination", attrs: { role: "navigation" } });
  const paginationSlot = el("div", { className: "v95-pagination-slot" }, [pagination]);
  const root = el("section", {
    className: ["v95-ui", "v95-view", `v95-view--${kind}`].join(" "),
    attrs: {
      "data-kind": kind,
      "aria-labelledby": titleId
    }
  }, [header, stateSlot, listSlot, paginationSlot]);
  container.replaceChildren(root);

  let currentView = view;
  let destroyed = false;
  let rowViews = new Map();
  let rowOrder = [];
  let refreshButton = null;
  let prevButton = null;
  let nextButton = null;
  let pageLabel = null;
  let lastEmitAt = 0;
  let lastEmitKey = "";

  function renderIcon(iconId, size) {
    if (iconRegistry && typeof iconRegistry.renderIcon === "function") {
      return iconRegistry.renderIcon(iconId, { size, decorative: true });
    }
    return defaultIconRegistry.renderIcon(iconId, { size, decorative: true });
  }

  function plainIcon(iconId, size) {
    const node = renderIcon(iconId, size);
    if (node) node.classList.add("v95-heading-icon");
    return node;
  }

  eyebrowWrap.replaceChildren(plainIcon(config.icon, 15), eyebrow);
  refreshButton = createIconButton({
    iconId: "refresh",
    labelKey: "common.refresh",
    t,
    iconRegistry,
    tone: "quiet",
    onClick: () => emitIntent("REQUEST_REFRESH")
  });
  refreshSlot.replaceChildren(refreshButton.element);
  prevButton = createIconButton({
    iconId: "chevron-left",
    labelKey: "common.previous",
    t,
    iconRegistry,
    tone: "quiet",
    onClick: () => emitPage(-1)
  });
  nextButton = createIconButton({
    iconId: "chevron-right",
    labelKey: "common.next",
    t,
    iconRegistry,
    tone: "quiet",
    onClick: () => emitPage(1)
  });
  pageLabel = el("span", { className: "v95-page-label" });
  pagination.replaceChildren(prevButton.element, pageLabel, nextButton.element);
  pagination.setAttribute("aria-label", tSafe(t, config.navKey));

  function canEmit() {
    return typeof emit === "function";
  }

  function emitIntent(type, extra = {}) {
    if (!canEmit()) return false;
    const now = Date.now();
    const key = `${type}:${extra.page || ""}:${extra.rowId || ""}`;
    if (key === lastEmitKey && now - lastEmitAt < 350) return false;
    lastEmitKey = key;
    lastEmitAt = now;
    try {
      emit(baseIntent(currentView, type, extra));
      return true;
    } catch (_ignored) {
      return false;
    }
  }

  function emitPage(delta) {
    const total = safeTotal(currentView.pagination);
    const pages = Math.max(1, Math.ceil(total / Math.max(1, currentView.pagination.pageSize)));
    const next = currentView.pagination.page + delta;
    if (next < 1 || next > pages) return;
    emitIntent("CHANGE_PAGE", { page: next });
  }

  function safeTotal(pagination) {
    return pagination && Number.isSafeInteger(pagination.total) && pagination.total >= 0 ? pagination.total : 0;
  }

  function setPageInfo() {
    const paginationData = currentView.pagination || { page: 1, pageSize: 20, total: 0 };
    const state = normalizeAsyncState(currentView.state);
    const total = safeTotal(paginationData);
    const pages = Math.max(1, Math.ceil(total / Math.max(1, paginationData.pageSize)));
    const show = (state === "ready" || state === "refreshing") && pages > 1;
    paginationSlot.hidden = !show;
    if (!show) return;
    const page = Math.min(Math.max(1, paginationData.page), pages);
    setText(pageLabel, tSafe(t, "common.page", { page, total: pages }));
    prevButton.setDisabled(page <= 1, tSafe(t, "common.unavailable"));
    nextButton.setDisabled(page >= pages, tSafe(t, "common.unavailable"));
    pagination.setAttribute("aria-label", `${tSafe(t, currentView.titleKey)} · ${tSafe(t, "common.page", { page, total: pages })}`);
  }

  function showRows() {
    listSlot.hidden = false;
    stateSlot.hidden = true;
    stateSlot.replaceChildren();
  }

  function showStatePanel(state) {
    listSlot.hidden = true;
    stateSlot.hidden = false;
    stateSlot.replaceChildren(createStatePanel({
      state,
      t,
      errorCode: currentView.errorCode,
      emptyTextKey: currentView.emptyTextKey,
      kindIcon: config.icon,
      iconRegistry,
      onRefresh: () => emitIntent("REQUEST_REFRESH")
    }));
    paginationSlot.hidden = true;
  }

  function syncRows() {
    if (destroyed) return;
    const state = normalizeAsyncState(currentView.state);
    const hasRows = Array.isArray(currentView.rows) && currentView.rows.length > 0;
    const shouldShowRows = (state === "ready" || state === "refreshing") && hasRows;
    const isBlocking = state === "loading" || state === "idle" || state === "empty" || state === "error" || state === "stale";
    if (isBlocking || !hasRows && state !== "ready") {
      showStatePanel(state === "refreshing" ? "loading" : state);
      if (state === "refreshing") {
        // Refreshing with no rows is still a non-blocking state; show the
        // inline indicator above a skeleton rather than a fake empty result.
        stateSlot.replaceChildren(
          createInlineStatus("refreshing", { t, iconRegistry }),
          createStatePanel({ state: "loading", t, iconRegistry, kindIcon: config.icon })
        );
      }
      destroyRows();
      return;
    }
    if (state === "ready" && !hasRows) {
      showRows();
      list.replaceChildren(el("p", { className: "v95-no-results", text: tSafe(t, "common.noResults") }));
      destroyRowViews();
      return;
    }
    if (!shouldShowRows) {
      showStatePanel(state);
      destroyRows();
      return;
    }
    showRows();
    if (state === "refreshing") {
      const inline = createInlineStatus("refreshing", { t, iconRegistry });
      stateSlot.hidden = false;
      stateSlot.replaceChildren(inline);
    }
    syncRowViews(state);
  }

  function destroyRowViews() {
    for (const rowView of rowViews.values()) rowView.destroy();
    rowViews.clear();
    rowOrder = [];
    list.replaceChildren();
  }

  function destroyRows() {
    destroyRowViews();
  }

  function syncRowViews() {
    const scrollTop = list.scrollTop;
    const active = document.activeElement;
    const rows = currentView.rows;
    const seen = new Set();
    for (const row of rows) {
      seen.add(row.id);
      let rowView = rowViews.get(row.id);
      if (!rowView) {
        rowView = rowFactory({
          row,
          view: currentView,
          t,
          emit,
          iconRegistry,
          kind
        });
        rowView.element.setAttribute("role", "listitem");
        rowView.element.classList.add("v95-row--enter");
        rowViews.set(row.id, rowView);
        rowOrder.push(row.id);
      }
      rowView.update(row, currentView);
      list.appendChild(rowView.element);
    }
    for (const [id, rowView] of Array.from(rowViews.entries())) {
      if (seen.has(id)) continue;
      rowView.destroy();
      rowViews.delete(id);
      rowOrder = rowOrder.filter(item => item !== id);
    }
    // Keep keyboard focus where the user left it when the row still exists.
    if (active && active !== document.activeElement && list.contains(active)) {
      try { active.focus({ preventScroll: true }); } catch (_ignored) { }
    }
    if (list.scrollTop !== scrollTop) list.scrollTop = scrollTop;
  }

  function render() {
    if (destroyed) return;
    const state = normalizeAsyncState(currentView.state);
    root.dataset.state = state;
    root.setAttribute("aria-busy", state === "loading" || state === "refreshing" ? "true" : "false");
    if (state !== "loading" && state !== "refreshing") root.removeAttribute("aria-busy");
    const titleText = tSafe(t, currentView.titleKey) || tSafe(t, config.navKey);
    const eyebrowText = tSafe(t, config.navKey);
    setText(title, titleText);
    setText(eyebrow, eyebrowText);
    eyebrow.hidden = !eyebrowText || eyebrowText === titleText;
    const count = safeTotal(currentView.pagination);
    title.setAttribute("title", tSafe(t, currentView.titleKey));
    title.dataset.total = String(count);
    refreshButton.setDisabled(state === "loading" || state === "refreshing", tSafe(t, "common.unavailable"));
    syncRows();
    setPageInfo();
    list.setAttribute("aria-label", tSafe(t, currentView.titleKey));
  }

  function update(nextView) {
    if (destroyed || !nextView) return;
    currentView = nextView;
    render();
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    destroyRowViews();
    refreshButton?.destroy();
    prevButton?.destroy();
    nextButton?.destroy();
    root.remove();
  }

  render();
  return { element: root, update, destroy };
}
