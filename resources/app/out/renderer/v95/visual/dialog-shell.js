/**
 * Accessible, theme-aware dialog shell.
 * The visual layer only presents content and invokes caller callbacks; it never
 * performs approvals, writes, IPC or destructive actions itself.
 */
import { el, tSafe, uniqueDomId, focusableElements, isReducedMotion } from "./dom.js";
import { defaultIconRegistry } from "../icons/icon-registry.js";
import { createIconButton, createTextButton } from "./icon-button.js";

let openDialogs = 0;
const dialogStack = [];

function render(iconRegistry, iconId, options) {
  if (iconRegistry && typeof iconRegistry.renderIcon === "function") {
    return iconRegistry.renderIcon(iconId, options);
  }
  return defaultIconRegistry.renderIcon(iconId, options);
}

function lockDocumentScroll() {
  if (openDialogs === 0) document.documentElement.classList.add("v95-dialog-open");
  openDialogs += 1;
}

function unlockDocumentScroll() {
  openDialogs = Math.max(0, openDialogs - 1);
  if (openDialogs === 0) document.documentElement.classList.remove("v95-dialog-open");
}

/**
 * @param {HTMLElement} host
 * @param {{
 *  title?: string, titleKey?: string, subtitle?: string, subtitleKey?: string,
 *  eyebrow?: string, body?: Node|Node[]|string, text?: string,
 *  icon?: string, variant?: "detail"|"confirm", size?: "small"|"medium"|"large",
 *  dismissible?: boolean, t?: Function, iconRegistry?: object,
 *  actions?: Array<{label?:string,labelKey?:string,icon?:string,tone?:string,onClick?:Function,disabled?:boolean,autofocus?:boolean}>,
 *  onClose?: Function, initialFocus?: HTMLElement, className?: string
 * }} options
 */
export function mountDialog(host, options = {}) {
  const mountHost = host && typeof host.appendChild === "function" ? host : document.body;
  const {
    title = "", titleKey = "", subtitle = "", subtitleKey = "", eyebrow = "",
    body, text = "", icon = "info", variant = "detail", size = "medium",
    dismissible = true, t, iconRegistry, actions = [], onClose, initialFocus, className = ""
  } = options;
  const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const titleId = uniqueDomId("v95-dialog-title");
  const descId = uniqueDomId("v95-dialog-desc");
  const resolvedTitle = title || tSafe(t, titleKey) || tSafe(t, "common.detail");
  const resolvedSubtitle = subtitle || tSafe(t, subtitleKey);
  const layer = el("div", {
    className: ["v95-ui", "v95-dialog-layer", `v95-dialog-layer--${variant}`].filter(Boolean).join(" "),
    attrs: { "data-v95-dialog": "true" }
  });
  const backdrop = el("div", { className: "v95-dialog-backdrop", attrs: { "aria-hidden": "true" } });
  const closeButton = createIconButton({
    iconId: "close",
    labelKey: "common.close",
    t,
    iconRegistry,
    tone: "quiet",
    onClick: () => close("close-button")
  });
  const header = el("header", { className: "v95-dialog-head" }, [
    el("div", { className: "v95-dialog-emblem" }, [
      render(iconRegistry, icon, { size: 22, decorative: true })
    ]),
    el("div", { className: "v95-dialog-heading" }, [
      eyebrow ? el("span", { className: "v95-dialog-eyebrow", text: eyebrow }) : null,
      el("h2", { className: "v95-dialog-title", attrs: { id: titleId }, text: resolvedTitle }),
      resolvedSubtitle ? el("p", { className: "v95-dialog-subtitle", attrs: { id: descId }, text: resolvedSubtitle }) : null
    ]),
    dismissible ? closeButton.element : null
  ]);
  const content = el("div", { className: "v95-dialog-content", attrs: { tabindex: "0" } });
  if (body !== undefined && body !== null) {
    if (Array.isArray(body)) body.forEach(item => item && content.appendChild(item));
    else if (body instanceof Node) content.appendChild(body);
    else content.appendChild(el("p", { text: String(body) }));
  }
  if (text) content.appendChild(el("p", { className: "v95-dialog-text", text }));
  const footer = el("footer", { className: "v95-dialog-foot" });
  const panel = el("section", {
    className: [
      "v95-dialog", `v95-dialog--${variant}`, `v95-dialog--${size}`, className
    ].filter(Boolean).join(" "),
    attrs: {
      role: "dialog",
      "aria-modal": "true",
      "aria-labelledby": titleId,
      ...(resolvedSubtitle ? { "aria-describedby": descId } : {}),
      tabindex: "-1"
    }
  }, [header, content]);
  const actionNodes = [];
  for (const action of Array.isArray(actions) ? actions : []) {
    const label = action.label || tSafe(t, action.labelKey) || "";
    if (!label) continue;
    const button = createTextButton({
      label,
      iconId: action.icon,
      tone: action.tone || "quiet",
      iconRegistry,
      disabled: action.disabled === true,
      onClick: () => {
        if (typeof action.onClick === "function") action.onClick();
      }
    });
    if (action.autofocus) button.element.dataset.autofocus = "true";
    footer.appendChild(button.element);
    actionNodes.push(button);
  }
  if (!actionNodes.length && dismissible) {
    const footerClose = createTextButton({
      labelKey: "common.close",
      t,
      tone: "surface",
      iconId: "close",
      iconRegistry,
      onClick: () => close("footer-close")
    });
    footer.appendChild(footerClose.element);
    actionNodes.push(footerClose);
  }
  if (actionNodes.length) panel.appendChild(footer);
  layer.append(backdrop, panel);
  mountHost.appendChild(layer);
  dialogStack.push(layer);
  lockDocumentScroll();

  let closed = false;
  let closing = false;
  let closeTimer = 0;
  let focusTimer = 0;

  function focusInitial() {
    if (initialFocus && panel.contains(initialFocus) && typeof initialFocus.focus === "function") {
      initialFocus.focus();
      return;
    }
    const autofocus = footer.querySelector("[data-autofocus='true']");
    if (autofocus) {
      autofocus.focus();
      return;
    }
    if (variant === "confirm") {
      const firstAction = footer.querySelector("button");
      if (firstAction) {
        firstAction.focus();
        return;
      }
    }
    panel.focus();
  }

  function finishClose() {
    if (closed) return;
    closed = true;
    if (closeTimer) window.clearTimeout(closeTimer);
    if (focusTimer) window.clearTimeout(focusTimer);
    closeTimer = 0;
    focusTimer = 0;
    const stackIndex = dialogStack.indexOf(layer);
    if (stackIndex >= 0) dialogStack.splice(stackIndex, 1);
    document.removeEventListener("keydown", onDocumentKeyDown, true);
    document.removeEventListener("focusin", onDocumentFocusIn, true);
    closeButton.destroy();
    actionNodes.forEach(button => button.destroy());
    layer.remove();
    unlockDocumentScroll();
    if (previousFocus && document.contains(previousFocus)) {
      try { previousFocus.focus({ preventScroll: true }); } catch (_ignored) { }
    }
    if (typeof onClose === "function") {
      try { onClose(); } catch (_ignored) { }
    }
  }

  function close(reason = "close") {
    if (closed || closing) return;
    closing = true;
    layer.classList.add("v95-dialog-layer--closing");
    const delay = isReducedMotion() ? 0 : 170;
    if (delay === 0) finishClose();
    else closeTimer = window.setTimeout(finishClose, delay);
    layer.dataset.closeReason = reason;
  }

  function trapFocus(event) {
    if (event.key !== "Tab") return;
    const items = focusableElements(panel);
    if (!items.length) {
      event.preventDefault();
      panel.focus();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const activeIndex = items.indexOf(document.activeElement);
    if (activeIndex < 0) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
    } else if (event.shiftKey && activeIndex === 0) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && activeIndex === items.length - 1) {
      event.preventDefault();
      first.focus();
    }
  }

  function onDocumentKeyDown(event) {
    if (closed || dialogStack[dialogStack.length - 1] !== layer) return;
    if (event.key === "Escape" && dismissible) {
      event.preventDefault();
      close("escape");
      return;
    }
    trapFocus(event);
  }

  function onDocumentFocusIn(event) {
    if (closed || dialogStack[dialogStack.length - 1] !== layer || panel.contains(event.target)) return;
    const items = focusableElements(panel);
    (items[0] || panel).focus({ preventScroll: true });
  }

  backdrop.addEventListener("click", () => {
    if (dismissible) close("backdrop");
  });
  document.addEventListener("keydown", onDocumentKeyDown, true);
  document.addEventListener("focusin", onDocumentFocusIn, true);

  // Animate after the first paint so transitions run.
  window.requestAnimationFrame(() => {
    if (!closed) layer.classList.add("v95-dialog-layer--open");
  });
  focusTimer = window.setTimeout(focusInitial, 0);

  return {
    element: layer,
    panel,
    close,
    update(next = {}) {
      if (next.title || next.titleKey) {
        panel.querySelector(".v95-dialog-title").textContent = next.title || tSafe(t, next.titleKey);
      }
      if (next.subtitle !== undefined || next.subtitleKey) {
        const node = panel.querySelector(".v95-dialog-subtitle");
        if (node) node.textContent = next.subtitle || tSafe(t, next.subtitleKey);
      }
    },
    destroy() {
      if (closed) return;
      if (closeTimer) window.clearTimeout(closeTimer);
      finishClose();
    }
  };
}

export function mountConfirmDialog(host, options = {}) {
  const {
    title = "", titleKey = "", message = "", messageKey = "", confirmLabel = "",
    confirmLabelKey = "common.approve", cancelLabel = "", cancelLabelKey = "common.cancel",
    onConfirm, onCancel, t, iconRegistry, danger = true, closeOnConfirm = true, dismissible = true
  } = options;
  const body = el("div", { className: "v95-confirm-body" }, [
    el("p", { text: message || tSafe(t, messageKey) })
  ]);
  let dialog;
  dialog = mountDialog(host, {
    title,
    titleKey,
    icon: danger ? "warning" : "info",
    variant: "confirm",
    size: "small",
    dismissible,
    t,
    iconRegistry,
    body,
    actions: [
      {
        label: cancelLabel || tSafe(t, cancelLabelKey),
        tone: "surface",
        onClick: () => {
          if (typeof onCancel === "function") onCancel();
          dialog.close("cancel");
        }
      },
      {
        label: confirmLabel || tSafe(t, confirmLabelKey),
        icon: danger ? "warning" : "check",
        tone: danger ? "danger" : "accent",
        onClick: () => {
          const outcome = typeof onConfirm === "function" ? onConfirm() : undefined;
          if (closeOnConfirm && outcome !== false) dialog.close("confirm");
        }
      }
    ]
  });
  return dialog;
}
