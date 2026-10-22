import {
  mountConversation, mountMemory, mountKnowledge, mountWorldline,
  mountLetters, mountActions, mountProvider, mountSettings,
  createStatusBadge, createBadge, createIconButton, createTextButton,
  renderIcon, listIcons, defaultIconRegistry, swapView
} from "../../src/app/renderer/v95/visual/index.js";
import { mountDialog, mountConfirmDialog } from "../../src/app/renderer/v95/visual/dialog-shell.js";
import { el } from "../../src/app/renderer/v95/visual/dom.js";
import { createDemoTranslator, createDemoViews, createDemoStateView } from "./fixtures/demo-fixtures.mjs";

const MOUNTERS = Object.freeze({
  "conversation-feed": mountConversation,
  "memory-list": mountMemory,
  "knowledge-facts": mountKnowledge,
  "worldline-timeline": mountWorldline,
  "letter-list": mountLetters,
  "action-activity": mountActions,
  "provider-diagnostics": mountProvider,
  "settings-section": mountSettings
});

const KIND_LABELS = Object.freeze({
  "conversation-feed": "Conversation feed",
  "memory-list": "Memory list",
  "knowledge-facts": "Knowledge facts",
  "worldline-timeline": "Worldline timeline",
  "letter-list": "Letter list",
  "action-activity": "Action activity",
  "provider-diagnostics": "Provider diagnostics",
  "settings-section": "Settings section"
});

const LANE_KINDS = Object.freeze(Object.keys(MOUNTERS));
const state = {
  language: "zh-CN",
  theme: "knight",
  asyncState: "ready",
  density: "standard",
  t: createDemoTranslator("zh-CN"),
  readyViews: createDemoViews("zh-CN")
};
const lanes = new Map();
const page = { kind: "conversation-feed", instance: null, destroyed: false };
let activeDialog = null;
let primitivesRendered = false;

const $ = selector => document.querySelector(selector);
const shell = $("#demo-shell");
const logList = $("#demo-log");

function currentView(kind) {
  if (state.asyncState === "ready") return state.readyViews[kind];
  return createDemoStateView(kind, state.asyncState, state.language);
}

function log(message, detail = "") {
  const line = el("li", { text: detail ? `${message} · ${detail}` : message });
  logList.prepend(line);
  while (logList.children.length > 8) logList.removeChild(logList.lastElementChild);
}

function closeActiveDialog() {
  if (activeDialog && typeof activeDialog.close === "function") {
    activeDialog.close("language-or-theme-change");
    activeDialog = null;
  }
}

function applyDensity() {
  const nodes = [shell, ...document.querySelectorAll(".v95-ui"), ...document.querySelectorAll(".v95-dialog-layer")];
  for (const node of nodes) {
    if (!(node instanceof HTMLElement)) continue;
    if (state.density === "compact") node.dataset.density = "compact";
    else delete node.dataset.density;
  }
}

function setTheme(theme) {
  state.theme = theme;
  document.documentElement.dataset.votcTheme = theme;
  document.querySelectorAll("[data-demo-theme]").forEach(button => {
    button.setAttribute("aria-pressed", String(button.dataset.demoTheme === theme));
  });
  closeActiveDialog();
  applyDensity();
}

function setLanguage(language) {
  if (!["zh-CN", "en-US"].includes(language) || language === state.language) return;
  closeActiveDialog();
  state.language = language;
  state.t = createDemoTranslator(language);
  state.readyViews = createDemoViews(language);
  document.documentElement.lang = language;
  document.querySelectorAll("[data-demo-language]").forEach(button => {
    button.setAttribute("aria-pressed", String(button.dataset.demoLanguage === language));
  });
  renderPrimitives();
  renderAll();
  renderPage();
  log("UI language changed", language);
}

function setAsyncState(nextState) {
  closeActiveDialog();
  state.asyncState = nextState;
  for (const [kind, lane] of lanes.entries()) {
    lane.view = currentView(kind);
    lane.instance.update(lane.view);
  }
  renderPage();
  applyDensity();
  log("Async state", nextState);
}

function mountOne(kind, mountNode, animate = false) {
  const view = currentView(kind);
  const mount = () => {
    const instance = MOUNTERS[kind](mountNode, view, {
      t: state.t,
      emit: handleIntent,
      iconRegistry: defaultIconRegistry
    });
    laneStore(kind, { instance, view, mountNode });
    return instance;
  };
  if (animate) {
    return swapView(mountNode, mount, { duration: 120 });
  }
  return mount();
}

function laneStore(kind, data) {
  const existing = lanes.get(kind);
  if (existing && existing.instance !== data.instance) existing.instance.destroy();
  lanes.set(kind, data);
  applyDensity();
}

function buildLanes() {
  const grid = $("#demo-grid");
  for (const kind of LANE_KINDS) {
    const lane = el("section", { className: "demo-lane", attrs: { "data-lane-kind": kind } });
    const head = el("div", { className: "demo-lane-head" }, [
      el("strong", { text: KIND_LABELS[kind] }),
      el("span", { text: kind })
    ]);
    const mount = el("div", { className: "demo-lane-mount" });
    lane.append(head, mount);
    grid.appendChild(lane);
    mountOne(kind, mount);
    laneStore(kind, { ...lanes.get(kind), lane });
  }
}

function renderAll(animate = false) {
  for (const kind of LANE_KINDS) {
    const lane = lanes.get(kind);
    if (!lane) continue;
    lane.instance.destroy();
    lanes.delete(kind);
    mountOne(kind, lane.mountNode, animate);
  }
  applyDensity();
}

function renderPage(animate = false) {
  const stage = $("#demo-page-stage");
  if (!stage) return;
  const mount = () => {
    if (page.instance) page.instance.destroy();
    const view = currentView(page.kind);
    const instance = MOUNTERS[page.kind](stage, view, {
      t: state.t,
      emit: handleIntent,
      iconRegistry: defaultIconRegistry
    });
    page.instance = instance;
    applyDensity();
  };
  document.querySelectorAll("[data-page-kind]").forEach(button => {
    button.setAttribute("aria-selected", String(button.dataset.pageKind === page.kind));
  });
  if (animate) swapView(stage, mount, { duration: 120 });
  else mount();
}

function findRow(view, rowId) {
  return Array.isArray(view.rows) ? view.rows.find(row => row.id === rowId) : null;
}

function updateView(kind, view) {
  const lane = lanes.get(kind);
  if (lane) {
    lane.view = view;
    lane.instance.update(view);
  }
  if (page.kind === kind && page.instance) page.instance.update(view);
  if (state.asyncState === "ready") state.readyViews[kind] = view;
}

function openDetailDialog(intent) {
  const lane = lanes.get(intent.viewKind) || { view: currentView(intent.viewKind) };
  const view = lane.view || currentView(intent.viewKind);
  const row = findRow(view, intent.rowId);
  if (!row) return;
  closeActiveDialog();
  const body = el("div", { className: "demo-dialog-detail" });
  if (row.dateText) body.appendChild(el("p", { className: "demo-dialog-meta", text: row.dateText }));
  if (row.subtitle) body.appendChild(el("p", { className: "demo-dialog-subtitle", text: row.subtitle }));
  body.appendChild(el("p", { className: "demo-dialog-text", text: row.text || row.subtitle || "" }));
  const synthetic = el("p", { className: "demo-dialog-note" }, [
    el("strong", { text: "Synthetic preview. " }),
    document.createTextNode("No real source, character, memory or IPC payload is attached.")
  ]);
  body.appendChild(synthetic);
  activeDialog = mountDialog(document.body, {
    title: row.title,
    eyebrow: intent.type === "OPEN_SOURCE" ? "Synthetic source review" : "Synthetic detail",
    icon: row.icon,
    variant: "detail",
    size: "medium",
    t: state.t,
    iconRegistry: defaultIconRegistry,
    body,
    onClose: () => { activeDialog = null; }
  });
  applyDensity();
  log(intent.type, row.title);
}

function openApprovalDialog(intent) {
  closeActiveDialog();
  const lane = lanes.get(intent.viewKind) || { view: currentView(intent.viewKind) };
  const row = findRow(lane.view || currentView(intent.viewKind), intent.rowId);
  activeDialog = mountConfirmDialog(document.body, {
    title: state.t("common.approve"),
    message: row
      ? `${row.title}\n\nThis is a synthetic review only. A real review, approval or effect stays with the Codex container.`
      : "This is a synthetic review only.",
    confirmLabel: state.t("common.approve"),
    cancelLabel: state.t("common.cancel"),
    t: state.t,
    iconRegistry: defaultIconRegistry,
    onConfirm: () => log("REQUEST_APPROVAL", row ? row.title : "demo"),
    onCancel: () => log("CANCEL_UI", "demo"),
    danger: true
  });
  applyDensity();
}

function handleIntent(intent) {
  if (!intent || typeof intent !== "object") return;
  log(intent.type, intent.viewKind);
  if (intent.type === "OPEN_DETAIL" || intent.type === "OPEN_SOURCE" || intent.type === "SELECT_ROW" || intent.type === "REQUEST_EDIT") {
    openDetailDialog(intent);
    return;
  }
  if (intent.type === "REQUEST_APPROVAL") {
    openApprovalDialog(intent);
    return;
  }
  if (intent.type === "CHANGE_PAGE") {
    const lane = lanes.get(intent.viewKind);
    const base = lane?.view || currentView(intent.viewKind);
    const totalPages = Math.max(1, Math.ceil(base.pagination.total / base.pagination.pageSize));
    const nextPage = Math.min(totalPages, Math.max(1, intent.page));
    updateView(intent.viewKind, { ...base, pagination: { ...base.pagination, page: nextPage } });
    return;
  }
  if (intent.type === "CHANGE_FILTER") {
    if (intent.viewKind === "settings-section" && intent.rowId === "demo-setting-1" && intent.filterKey === "value"
      && ["zh-CN", "en-US"].includes(intent.value)) {
      setLanguage(intent.value);
      return;
    }
    const lane = lanes.get(intent.viewKind);
    const base = lane?.view || currentView(intent.viewKind);
    const nextRows = base.rows.map(row => row.id === intent.rowId && row.control
      ? { ...row, control: { ...row.control, value: intent.value } }
      : row);
    updateView(intent.viewKind, { ...base, rows: nextRows });
    return;
  }
  if (intent.type === "REQUEST_REFRESH") {
    const lane = lanes.get(intent.viewKind);
    if (!lane) return;
    const previous = lane.view;
    lane.instance.update({ ...previous, state: "refreshing", errorCode: null });
    log("Refreshing (synthetic)", intent.viewKind);
    window.setTimeout(() => {
      const currentLane = lanes.get(intent.viewKind);
      if (!currentLane || currentLane.instance !== lane.instance) return;
      currentLane.instance.update(currentView(intent.viewKind));
    }, 700);
  }
}

function renderPrimitives() {
  const iconGrid = $("#demo-icon-grid");
  iconGrid.replaceChildren();
  const icons = listIcons();
  for (const iconId of icons) {
    const cell = el("div", { className: "demo-icon-cell", attrs: { title: iconId } }, [
      renderIcon(iconId, { size: 22, decorative: true }),
      el("span", { text: iconId })
    ]);
    iconGrid.appendChild(cell);
  }
  const fallback = $("#demo-fallback");
  fallback.replaceChildren(
    renderIcon("unrecognized-offline-icon", { size: 24, decorative: false, label: "Unknown icon fallback" }),
    el("code", { text: "unrecognized-offline-icon → unknown" })
  );
  const statusRow = $("#demo-status-row");
  statusRow.replaceChildren();
  for (const code of ["IDLE", "QUEUED", "DISPATCHED", "ACKNOWLEDGED", "CONFIRMED", "UNCONFIRMED", "UNKNOWN", "SOURCE_BOUND", "BLOCKED", "STALLED"]) {
    statusRow.appendChild(createStatusBadge(code, { t: state.t, iconRegistry: defaultIconRegistry }));
  }
  statusRow.appendChild(createBadge({ tone: "success", textKey: "memory.verified" }, { t: state.t, iconRegistry: defaultIconRegistry }));
  const buttonRow = $("#demo-button-row");
  buttonRow.replaceChildren();
  const iconButtons = [
    { iconId: "refresh", labelKey: "common.refresh" },
    { iconId: "edit", labelKey: "common.edit" },
    { iconId: "source", labelKey: "common.source" }
  ];
  for (const item of iconButtons) {
    buttonRow.appendChild(createIconButton({
      ...item, t: state.t, iconRegistry: defaultIconRegistry, onClick: () => log("demo button", item.iconId)
    }).element);
  }
  buttonRow.appendChild(createTextButton({
    labelKey: "common.detail", t: state.t, iconId: "chevron-right", iconRegistry: defaultIconRegistry,
    onClick: () => log("demo button", "detail")
  }).element);
  buttonRow.appendChild(createTextButton({
    label: state.t("common.approve"), t: state.t, iconId: "approval", tone: "danger", iconRegistry: defaultIconRegistry,
    onClick: () => openApprovalDialog({ viewKind: "action-activity", rowId: "" })
  }).element);
  primitivesRendered = true;
}

function setupPageTabs() {
  document.querySelectorAll("[data-page-kind]").forEach(button => {
    button.addEventListener("click", () => {
      if (button.dataset.pageKind === page.kind) return;
      page.kind = button.dataset.pageKind;
      renderPage(true);
      log("Page switch", page.kind);
    });
  });
}

function setupControls() {
  document.querySelectorAll("[data-demo-theme]").forEach(button => {
    button.addEventListener("click", () => setTheme(button.dataset.demoTheme));
  });
  document.querySelectorAll("[data-demo-language]").forEach(button => {
    button.addEventListener("click", () => setLanguage(button.dataset.demoLanguage));
  });
  $("#demo-state").addEventListener("change", event => setAsyncState(event.target.value));
  $("#demo-density").addEventListener("change", event => {
    state.density = event.target.checked ? "compact" : "standard";
    applyDensity();
    log("Density", state.density);
  });
  $("#demo-open-detail").addEventListener("click", () => {
    const view = lanes.get("memory-list")?.view;
    const row = view?.rows[0];
    openDetailDialog({ viewKind: "memory-list", rowId: row?.id || "demo-memory-1", type: "OPEN_DETAIL" });
  });
  $("#demo-open-confirm").addEventListener("click", () => openApprovalDialog({ viewKind: "action-activity", rowId: "" }));
}

function exposeTestApi() {
  window.__v95demo = Object.freeze({
    contract: "v95-view-v1",
    revision: 1,
    kinds: [...LANE_KINDS],
    getState: () => ({ ...state, readyViews: undefined, t: undefined }),
    t: (key, params) => state.t(key, params),
    iconRegistry: defaultIconRegistry,
    laneCount: () => lanes.size,
    currentViews: () => Object.fromEntries(Array.from(lanes.entries(), ([kind, lane]) => [kind, lane.view])),
    setAsyncState,
    setLanguage,
    setTheme,
    renderAll,
    destroyLanes: () => {
      for (const lane of lanes.values()) lane.instance.destroy();
      lanes.clear();
    },
    pageKind: () => page.kind,
    icons: listIcons(),
    dialogOpen: () => Boolean(activeDialog)
  });
}

function init() {
  document.documentElement.dataset.votcTheme = state.theme;
  setTheme(state.theme);
  renderPrimitives();
  setupPageTabs();
  setupControls();
  buildLanes();
  renderPage();
  applyDensity();
  exposeTestApi();
  document.documentElement.dataset.demoReady = "true";
  log("Showcase ready", "synthetic data only");
}

init();
