/** Status, badge and async-state primitives. Display only; no inference. */
import { errorTextKey } from "../contracts/async-states.v1.js";
import { defaultIconRegistry } from "../icons/icon-registry.js";
import { el, tSafe } from "./dom.js";
import { createTextButton } from "./icon-button.js";

const MACHINE_STATUSES = Object.freeze([
  "IDLE", "LOADING", "REFRESHING", "READY", "EMPTY", "ERROR", "STALE", "QUEUED",
  "DISPATCHED", "ACKNOWLEDGED", "CONFIRMED", "UNCONFIRMED", "UNKNOWN", "SOURCE_BOUND",
  "BLOCKED", "STALLED"
]);
const STATUS_SET = new Set(MACHINE_STATUSES);

const STATUS_META = Object.freeze({
  IDLE: { tone: "neutral", icon: "info" },
  LOADING: { tone: "info", icon: "refresh" },
  REFRESHING: { tone: "info", icon: "refresh" },
  READY: { tone: "info", icon: "info" },
  EMPTY: { tone: "neutral", icon: "info" },
  ERROR: { tone: "danger", icon: "error" },
  STALE: { tone: "warning", icon: "history" },
  QUEUED: { tone: "info", icon: "queued" },
  DISPATCHED: { tone: "info", icon: "send" },
  ACKNOWLEDGED: { tone: "info", icon: "received" },
  CONFIRMED: { tone: "success", icon: "confirmed" },
  UNCONFIRMED: { tone: "warning", icon: "unconfirmed" },
  UNKNOWN: { tone: "neutral", icon: "unknown" },
  SOURCE_BOUND: { tone: "info", icon: "source" },
  BLOCKED: { tone: "warning", icon: "blocked" },
  STALLED: { tone: "warning", icon: "warning" }
});

const BADGE_TONES = new Set(["neutral", "info", "success", "warning", "danger"]);
const TONE_ICONS = Object.freeze({
  neutral: "info",
  info: "info",
  success: "check",
  warning: "warning",
  danger: "error"
});

function render(iconRegistry, iconId, options) {
  if (iconRegistry && typeof iconRegistry.renderIcon === "function") {
    return iconRegistry.renderIcon(iconId, options);
  }
  return defaultIconRegistry.renderIcon(iconId, options);
}

export function normalizeMachineStatus(value) {
  if (typeof value !== "string") return "UNKNOWN";
  const status = value.trim().toUpperCase();
  return STATUS_SET.has(status) ? status : "UNKNOWN";
}

export function createStatusBadge(statusCode, { t, iconRegistry, className = "" } = {}) {
  const status = normalizeMachineStatus(statusCode);
  const meta = STATUS_META[status] || STATUS_META.UNKNOWN;
  const label = tSafe(t, `status.${status}`);
  const node = el("span", {
    className: ["v95-status", `v95-status--${meta.tone}`, className].filter(Boolean).join(" "),
    attrs: {
      "data-status": status,
      ...(status === "UNKNOWN" && String(statusCode).toUpperCase() !== "UNKNOWN" ? { "data-status-fallback": "true" } : {})
    }
  }, [
    render(iconRegistry, meta.icon, { size: 12, decorative: true }),
    el("span", { className: "v95-status-label", text: label })
  ]);
  return node;
}

export function createBadge(badge, { t, iconRegistry, className = "" } = {}) {
  if (!badge || typeof badge !== "object") return null;
  const tone = BADGE_TONES.has(badge.tone) ? badge.tone : "neutral";
  const label = tSafe(t, badge.textKey);
  if (!label) return null;
  return el("span", {
    className: ["v95-badge", `v95-badge--${tone}`, className].filter(Boolean).join(" "),
    attrs: { "data-tone": tone }
  }, [
    render(iconRegistry, TONE_ICONS[tone] || "info", { size: 12, decorative: true }),
    el("span", { className: "v95-badge-label", text: label })
  ]);
}

export function createSkeletonRows(count = 3, { compact = false } = {}) {
  const fragment = document.createDocumentFragment();
  for (let index = 0; index < count; index += 1) {
    fragment.appendChild(el("div", {
      className: ["v95-skeleton-row", compact ? "v95-skeleton-row--compact" : ""].filter(Boolean).join(" "),
      attrs: { "aria-hidden": "true" }
    }, [
      el("span", { className: "v95-skeleton v95-skeleton--marker" }),
      el("span", { className: "v95-skeleton-main" }, [
        el("span", { className: "v95-skeleton v95-skeleton--title" }),
        el("span", { className: "v95-skeleton v95-skeleton--line" }),
        el("span", { className: "v95-skeleton v95-skeleton--line v95-skeleton--short" })
      ])
    ]));
  }
  return fragment;
}

function refreshButton(t, onRefresh, iconRegistry, disabled = false) {
  if (typeof onRefresh !== "function") return null;
  return createTextButton({
    labelKey: "common.refresh",
    t,
    iconId: "refresh",
    iconRegistry,
    tone: "surface",
    disabled,
    onClick: onRefresh
  }).element;
}

/**
 * Full-body state panel for idle/loading/empty/error/stale.
 * `refreshing` is intentionally not a blocking panel.
 */
export function createStatePanel({
  state, t, errorCode = null, emptyTextKey = "", kindIcon = "info",
  iconRegistry, onRefresh, className = ""
} = {}) {
  const normalized = typeof state === "string" ? state : "idle";
  const panel = el("div", {
    className: ["v95-state-panel", `v95-state-panel--${normalized}`, className].filter(Boolean).join(" "),
    attrs: { role: "status", "aria-live": "polite" }
  });

  if (normalized === "loading") {
    panel.appendChild(el("div", { className: "v95-state-heading" }, [
      render(iconRegistry, "refresh", { size: 16, decorative: true, className: "v95-spin" }),
      el("span", { text: tSafe(t, "common.loading") })
    ]));
    panel.appendChild(createSkeletonRows(3));
    return panel;
  }

  if (normalized === "empty") {
    panel.appendChild(el("div", { className: "v95-state-medallion" }, [
      render(iconRegistry, kindIcon, { size: 22, decorative: true })
    ]));
    panel.appendChild(el("p", { className: "v95-state-title", text: tSafe(t, emptyTextKey) }));
    return panel;
  }

  if (normalized === "error" || normalized === "stale") {
    const isError = normalized === "error";
    panel.appendChild(el("div", { className: "v95-state-medallion" }, [
      render(iconRegistry, isError ? "error" : "warning", { size: 22, decorative: true })
    ]));
    panel.appendChild(el("p", {
      className: "v95-state-title",
      text: tSafe(t, isError ? "common.error" : "common.stale")
    }));
    if (errorCode) {
      panel.appendChild(el("p", {
        className: "v95-state-detail",
        text: tSafe(t, errorTextKey(errorCode))
      }));
    }
    const retry = refreshButton(t, onRefresh, iconRegistry);
    if (retry) panel.appendChild(el("div", { className: "v95-state-actions" }, [retry]));
    return panel;
  }

  // idle (contract state) is a calm placeholder, never a fake loading state.
  panel.appendChild(el("div", { className: "v95-state-medallion" }, [
    render(iconRegistry, kindIcon, { size: 22, decorative: true })
  ]));
  panel.appendChild(el("p", { className: "v95-state-title", text: tSafe(t, "common.unavailable") }));
  const retry = refreshButton(t, onRefresh, iconRegistry);
  if (retry) panel.appendChild(el("div", { className: "v95-state-actions" }, [retry]));
  return panel;
}

export function createInlineStatus(state, { t, errorCode = null, iconRegistry } = {}) {
  if (state === "refreshing") {
    const label = tSafe(t, "common.refreshing");
    return el("div", {
      className: "v95-inline-status v95-inline-status--refreshing",
      attrs: { role: "status", "aria-live": "polite" }
    }, [
      render(iconRegistry, "refresh", { size: 13, decorative: true, className: "v95-spin" }),
      el("span", { text: label })
    ]);
  }
  if (state === "stale" && errorCode) {
    return el("div", {
      className: "v95-inline-status v95-inline-status--stale",
      attrs: { role: "status", "aria-live": "polite" }
    }, [
      render(iconRegistry, "warning", { size: 13, decorative: true }),
      el("span", { text: tSafe(t, "common.stale") })
    ]);
  }
  return null;
}
