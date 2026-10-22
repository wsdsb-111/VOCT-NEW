/** Stable, keyed list row presentation. Display layer only. */
import { defaultIconRegistry } from "../icons/icon-registry.js";
import {
  el, tSafe, setText, uniqueDomId, formatMetricValue
} from "./dom.js";
import { createBadge, createStatusBadge } from "./status-indicator.js";
import { createIconButton, createTextButton } from "./icon-button.js";

const ACTION_META = Object.freeze({
  OPEN_DETAIL: { icon: "chevron-right", labelKey: "common.detail", tone: "quiet", text: false },
  OPEN_SOURCE: { icon: "source", labelKey: "common.source", tone: "quiet", text: false },
  SELECT_ROW: { icon: "check", labelKey: "common.select", tone: "quiet", text: false },
  REQUEST_EDIT: { icon: "edit", labelKey: "common.edit", tone: "quiet", text: false },
  REQUEST_APPROVAL: { icon: "approval", labelKey: "common.approve", tone: "danger", text: true }
});

const HIDDEN_UNKNOWN_KINDS = new Set(["conversation-feed", "provider-diagnostics", "settings-section"]);

function rowIconId(row, kind) {
  if (kind === "conversation-feed") {
    if (row.role === "player") return "user";
    if (row.role === "system") return "system";
    return "users";
  }
  return row.icon;
}

function render(iconRegistry, iconId, options) {
  if (iconRegistry && typeof iconRegistry.renderIcon === "function") {
    return iconRegistry.renderIcon(iconId, options);
  }
  return defaultIconRegistry.renderIcon(iconId, options);
}

function isAllowedAction(row, action, view) {
  return Boolean(row && view && view.state === "ready" && !row.disabled
    && Array.isArray(row.actions) && row.actions.includes(action));
}

function shouldShowBadge(row, kind) {
  if (!row.badge) return false;
  if (HIDDEN_UNKNOWN_KINDS.has(kind) && row.badge.textKey === "status.UNKNOWN") return false;
  if ((kind === "letter-list" || kind === "action-activity") && (row.stage || row.effectState)) return false;
  return true;
}

function metricText(metric, t) {
  if (!metric || !Number.isFinite(metric.value)) return tSafe(t, "common.unknown");
  const value = formatMetricValue(metric.value);
  return value === null ? tSafe(t, "common.unknown") : value;
}

function createMetric(metric, { t, iconRegistry, label }) {
  const node = el("div", { className: "v95-metric" });
  const value = metricText(metric, t);
  const unit = metric && typeof metric.unit === "string" ? metric.unit : "";
  node.appendChild(el("div", { className: "v95-metric-headline" }, [
    el("span", { className: "v95-metric-value", text: value }),
    unit ? el("span", { className: "v95-metric-unit", text: unit }) : null
  ]));
  const estimateKind = metric && ["native", "estimated", "unknown"].includes(metric.estimateKind)
    ? metric.estimateKind : "unknown";
  node.appendChild(el("span", {
    className: ["v95-metric-estimate", `v95-metric-estimate--${estimateKind}`].join(" "),
    text: tSafe(t, `diagnostics.${estimateKind}`)
  }));
  if (metric && Number.isFinite(metric.progress)) {
    const progress = Math.min(1, Math.max(0, metric.progress));
    const track = el("div", {
      className: "v95-meter",
      attrs: {
        role: "progressbar",
        "aria-valuemin": "0",
        "aria-valuemax": "100",
        "aria-valuenow": String(Math.round(progress * 100)),
        "aria-label": `${label || tSafe(t, "diagnostics.title")} ${Math.round(progress * 100)}%`
      }
    }, [el("span", { className: "v95-meter-fill", style: { width: `${(progress * 100).toFixed(1)}%` } })]);
    node.appendChild(track);
  }
  return node;
}

function createStatusMeta(row, { t, iconRegistry, kind }) {
  const statuses = [];
  const generic = shouldShowBadge(row, kind) ? createBadge(row.badge, { t, iconRegistry }) : null;
  if (generic) statuses.push(generic);
  const hasStage = (kind === "letter-list" || kind === "action-activity") && Boolean(row.stage);
  const hasEffect = (kind === "letter-list" || kind === "action-activity") && Boolean(row.effectState);
  if (hasStage && hasEffect && row.stage === row.effectState) {
    statuses.push(createStatusBadge(row.stage, { t, iconRegistry, className: "v95-status--stage" }));
  } else {
    if (hasStage) statuses.push(createStatusBadge(row.stage, { t, iconRegistry, className: "v95-status--stage" }));
    if (hasStage && hasEffect) {
      statuses.push(el("span", {
        className: "v95-status-arrow",
        attrs: { "aria-hidden": "true" },
        text: "→"
      }));
    }
    if (hasEffect) statuses.push(createStatusBadge(row.effectState, { t, iconRegistry, className: "v95-status--effect" }));
  }
  return statuses.length ? el("div", { className: "v95-row-status" }, statuses) : null;
}

function createMetaLine(row, { t, iconRegistry }) {
  const items = [];
  if (row.dateText) {
    items.push(el("span", { className: "v95-meta-item" }, [
      render(iconRegistry, "calendar", { size: 12, decorative: true }),
      el("span", { text: row.dateText })
    ]));
  }
  if (row.timeText) {
    items.push(el("span", { className: "v95-meta-item" }, [
      render(iconRegistry, "history", { size: 12, decorative: true }),
      el("span", { text: row.timeText })
    ]));
  }
  if (row.queueTimeText) {
    items.push(el("span", { className: "v95-meta-item" }, [
      render(iconRegistry, "queued", { size: 12, decorative: true }),
      el("span", { text: row.queueTimeText })
    ]));
  }
  if (row.streaming) {
    items.push(el("span", { className: "v95-streaming" }, [
      render(iconRegistry, "refresh", { size: 12, decorative: true, className: "v95-spin" }),
      el("span", { text: tSafe(t, "conversation.streaming") })
    ]));
  }
  return items.length ? el("div", { className: "v95-row-meta" }, items) : null;
}

function createControlView({ getRow, getView, t, emit, iconRegistry }) {
  const row = getRow();
  const control = row.control;
  const controlId = uniqueDomId("v95-control");
  const helpId = control.helpTextKey ? uniqueDomId("v95-control-help") : "";
  const label = el("label", { className: "v95-control-label", attrs: { for: controlId } });
  const help = control.helpTextKey ? el("p", { className: "v95-control-help", attrs: { id: helpId } }) : null;
  const wrapper = el("div", { className: "v95-control" });
  let input = null;

  function changed(value) {
    if (typeof emit !== "function") return;
    const current = getRow();
    const view = getView();
    if (!isAllowedAction(current, "CHANGE_FILTER", view)) return;
    try {
      emit({
        type: "CHANGE_FILTER",
        viewKind: view.kind,
        rowId: current.id,
        scopeTag: view.scopeTag,
        revisionTag: view.revisionTag,
        filterKey: "value",
        value
      });
    } catch (_ignored) {
      // Container validation errors are not visual failures.
    }
  }

  if (control.type === "select") {
    input = el("select", {
      className: "v95-select",
      attrs: { id: controlId, "aria-label": row.title },
      on: { change: () => changed(input.value) }
    });
    const options = Array.isArray(control.options) ? control.options : [];
    input.appendChild(el("option", {
      text: tSafe(t, "common.unavailable"),
      attrs: { value: "", disabled: "disabled" }
    }));
    for (const option of options) {
      input.appendChild(el("option", {
        text: tSafe(t, option.labelKey),
        attrs: { value: option.value }
      }));
    }
    wrapper.append(label, input);
  } else if (control.type === "toggle") {
    input = el("input", {
      className: "v95-toggle",
      attrs: { id: controlId, type: "checkbox", role: "switch", "aria-label": row.title },
      on: { change: () => changed(Boolean(input.checked)) }
    });
    wrapper.append(label, el("span", { className: "v95-toggle-wrap" }, [input]));
  } else if (control.type === "text") {
    input = el("input", {
      className: "v95-text-field",
      attrs: { id: controlId, type: "text", "aria-label": row.title },
      on: { change: () => changed(input.value) }
    });
    wrapper.append(label, input);
  } else {
    input = el("div", { className: "v95-readonly", attrs: { id: controlId } });
    wrapper.append(label, input);
  }
  if (help) {
    wrapper.appendChild(help);
    if (input.setAttribute) input.setAttribute("aria-describedby", helpId);
  }

  function update() {
    const next = getRow();
    const view = getView();
    const nextControl = next.control || {};
    const allowed = isAllowedAction(next, "CHANGE_FILTER", view);
    label.textContent = next.title || tSafe(t, "common.unavailable");
    if (help) help.textContent = tSafe(t, nextControl.helpTextKey || "");
    if (input) {
      input.disabled = !allowed;
      input.setAttribute("aria-label", next.title || tSafe(t, "common.unavailable"));
    }
    if (nextControl.type === "select" && input) {
      if (document.activeElement !== input) {
        const values = Array.from(input.options, option => option.value);
        input.value = values.includes(nextControl.value) ? nextControl.value : "";
      }
    } else if (nextControl.type === "toggle" && input) {
      if (document.activeElement !== input) input.checked = nextControl.value === true;
      input.setAttribute("aria-checked", String(input.checked));
    } else if (nextControl.type === "text" && input) {
      if (document.activeElement !== input) {
        input.value = typeof nextControl.value === "string" ? nextControl.value : "";
      }
    } else if (input) {
      input.textContent = nextControl.value === true ? tSafe(t, "common.unknown")
        : typeof nextControl.value === "string" && nextControl.value ? nextControl.value
          : tSafe(t, "common.unknown");
      input.setAttribute("aria-label", next.title || tSafe(t, "common.unavailable"));
    }
  }

  update();
  return { element: wrapper, update };
}

function createActionBar({ getRow, getView, t, emit, iconRegistry }) {
  const node = el("div", { className: "v95-row-actions" });
  let signature = "";
  const buttons = [];

  function signatureOf(row) {
    return (Array.isArray(row.actions) ? row.actions : []).join("|");
  }

  let lastAction = "";
  let lastActionAt = 0;

  function emitIntent(action) {
    const row = getRow();
    const view = getView();
    if (!isAllowedAction(row, action, view) || typeof emit !== "function") return;
    const now = Date.now();
    if (action === lastAction && now - lastActionAt < 350) return;
    lastAction = action;
    lastActionAt = now;
    try {
      emit({
        type: action,
        viewKind: view.kind,
        rowId: row.id,
        scopeTag: view.scopeTag,
        revisionTag: view.revisionTag
      });
    } catch (_ignored) {
      // Container validation errors are not visual failures.
    }
  }

  function build(row) {
    node.replaceChildren();
    buttons.length = 0;
    const actions = (Array.isArray(row.actions) ? row.actions : []).filter(action => Object.hasOwn(ACTION_META, action));
    for (const action of actions) {
      const meta = ACTION_META[action];
      const label = tSafe(t, meta.labelKey);
      let button;
      if (meta.text) {
        button = createTextButton({
          label,
          iconId: meta.icon,
          iconRegistry,
          tone: meta.tone,
          onClick: () => emitIntent(action)
        });
      } else {
        button = createIconButton({
          iconId: meta.icon,
          label,
          iconRegistry,
          tone: "quiet",
          size: 16,
          onClick: () => emitIntent(action)
        });
      }
      button.element.dataset.action = action;
      node.appendChild(button.element);
      buttons.push({ action, button });
    }
    signature = signatureOf(row);
  }

  function update() {
    const row = getRow();
    const view = getView();
    if (signatureOf(row) !== signature) build(row);
    for (const entry of buttons) {
      const allowed = isAllowedAction(row, entry.action, view);
      entry.button.setDisabled(!allowed, allowed ? "" : tSafe(t, "common.unavailable"));
    }
  }

  build(getRow());
  update();
  return { element: node, update };
}

/** Create one keyed row; updater preserves text nodes, focus and caret. */
export function createRow({ row, view, t, emit, iconRegistry, kind = view?.kind || "" }) {
  let currentRow = row;
  let currentView = view;
  const article = el("article", {
    className: ["v95-row", `v95-row--${kind}`].join(" "),
    attrs: { "data-row-id": row.id, "data-kind": kind, tabindex: "-1" }
  });
  const rail = el("div", { className: "v95-row-rail" });
  const title = el("h3", { className: "v95-row-title" });
  const subtitle = el("p", { className: "v95-row-subtitle" });
  const text = el("div", { className: "v95-row-text" });
  const heading = el("div", { className: "v95-row-heading" }, [title, subtitle]);
  const statusSlot = el("div", { className: "v95-row-status-slot" });
  const metaSlot = el("div", { className: "v95-row-meta-slot" });
  const body = el("div", { className: "v95-row-main" }, [heading, statusSlot, text, metaSlot]);
  const actionsSlot = el("div", { className: "v95-row-actions-slot" });
  const controlSlot = el("div", { className: "v95-row-control-slot" });
  article.append(rail, body, actionsSlot, controlSlot);

  const getRow = () => currentRow;
  const getView = () => currentView;
  let iconId = "";
  let iconNode = null;
  let controlView = null;
  let controlSignature = "";
  let actionBar = null;
  let actionBarSignature = "";

  function paintIcon() {
    const nextIconId = rowIconId(currentRow, kind) || currentRow.icon;
    if (iconId === nextIconId && iconNode) return;
    iconId = nextIconId;
    iconNode = render(iconRegistry, nextIconId, { size: 18, decorative: true, className: "v95-row-icon" });
    rail.replaceChildren(iconNode);
  }

  function ensureControl() {
    if (kind !== "settings-section" || !currentRow.control) {
      controlView = null;
      controlSignature = "";
      controlSlot.replaceChildren();
      return;
    }
    const control = currentRow.control;
    const signature = JSON.stringify({
      type: control.type,
      options: control.options || null,
      helpTextKey: control.helpTextKey || null
    });
    if (!controlView || signature !== controlSignature) {
      controlView = createControlView({ getRow, getView, t, emit, iconRegistry });
      controlSignature = signature;
      controlSlot.replaceChildren(controlView.element);
    }
    controlView.update();
  }

  function ensureActions() {
    const signature = (Array.isArray(currentRow.actions) ? currentRow.actions : []).join("|");
    if (!actionBar || signature !== actionBarSignature) {
      actionBar = createActionBar({ getRow, getView, t, emit, iconRegistry });
      actionBarSignature = signature;
      actionsSlot.replaceChildren(actionBar.element);
    }
    actionBar.update();
  }

  function paintStatus() {
    statusSlot.replaceChildren();
    const status = createStatusMeta(currentRow, { t, iconRegistry, kind });
    if (status) statusSlot.appendChild(status);
  }

  function paintMeta() {
    metaSlot.replaceChildren();
    const meta = createMetaLine(currentRow, { t, iconRegistry });
    if (meta) metaSlot.appendChild(meta);
    if (kind === "provider-diagnostics" && currentRow.metric) {
      metaSlot.appendChild(createMetric(currentRow.metric, {
        t,
        iconRegistry,
        label: currentRow.title
      }));
    }
  }

  function paint() {
    setText(title, currentRow.title || "");
    setText(subtitle, currentRow.subtitle || "");
    subtitle.hidden = !currentRow.subtitle || (kind === "provider-diagnostics" && Boolean(currentRow.metric));
    setText(text, currentRow.text || "");
    text.hidden = !currentRow.text;
    paintIcon();
    paintStatus();
    paintMeta();
    ensureControl();
    ensureActions();
    article.classList.toggle("v95-row--disabled", Boolean(currentRow.disabled));
    if (currentRow.disabled) article.setAttribute("aria-disabled", "true");
    else article.removeAttribute("aria-disabled");
    article.dataset.state = currentView.state;
    if (currentRow.role) article.dataset.role = currentRow.role;
    else delete article.dataset.role;
    article.dataset.streaming = String(Boolean(currentRow.streaming));
  }

  function update(nextRow, nextView = currentView) {
    if (!nextRow || nextRow.id !== currentRow.id) return;
    const focusedElement = document.activeElement;
    const hadFocus = article.contains(focusedElement);
    const focusedAction = hadFocus ? focusedElement.dataset?.action || "" : "";
    currentRow = nextRow;
    currentView = nextView;
    paint();
    if (!hadFocus || article.contains(document.activeElement)) return;
    if (document.activeElement !== document.body && document.activeElement !== focusedElement) return;
    const candidates = Array.from(article.querySelectorAll("[data-action]")).filter(element => !element.disabled);
    const replacement = focusedAction
      ? candidates.find(element => element.dataset.action === focusedAction) || candidates[0]
      : null;
    (replacement || article).focus({ preventScroll: true });
  }

  paint();
  return {
    element: article,
    update,
    get rowId() { return currentRow.id; },
    destroy() { article.remove(); }
  };
}
