/** Accessible icon button primitive. No business actions. */
import { el, tSafe } from "./dom.js";
import { defaultIconRegistry } from "../icons/icon-registry.js";

function iconRenderer(iconRegistry) {
  if (iconRegistry && typeof iconRegistry.renderIcon === "function") return iconRegistry.renderIcon;
  return defaultIconRegistry.renderIcon;
}

/**
 * @param {{
 *  iconId: string, label?: string, labelKey?: string, t?: Function,
 *  onClick?: Function, disabled?: boolean, disabledReason?: string, disabledReasonKey?: string,
 *  tone?: "quiet"|"surface"|"accent"|"danger", size?: number, className?: string,
 *  pressed?: boolean, iconRegistry?: object, tooltip?: boolean, attrs?: object
 * }} options
 */
export function createIconButton(options = {}) {
  const {
    iconId, label = "", labelKey = "", t, onClick, disabled = false,
    disabledReason = "", disabledReasonKey = "", tone = "quiet", size = 16,
    className = "", pressed, iconRegistry, tooltip = true, attrs = {}
  } = options;
  let currentLabel = label || tSafe(t, labelKey) || iconId;
  let currentDisabled = Boolean(disabled);
  let currentReason = disabledReason || tSafe(t, disabledReasonKey);
  const button = el("button", {
    className: ["v95-icon-button", `v95-icon-button--${tone}`, className].filter(Boolean).join(" "),
    attrs: {
      type: "button",
      "aria-label": currentLabel,
      ...(pressed === undefined ? {} : { "aria-pressed": String(Boolean(pressed)) }),
      ...attrs
    }
  });
  const render = iconRenderer(iconRegistry);
  const iconNode = el("span", { className: "v95-icon-button-icon" }, [render(iconId, { size, decorative: true })]);
  button.appendChild(iconNode);

  const handler = event => {
    if (currentDisabled) {
      event.preventDefault();
      return;
    }
    if (typeof onClick === "function") onClick(event);
  };
  button.addEventListener("click", handler);

  function applyState() {
    button.disabled = currentDisabled;
    const reasonSuffix = currentDisabled && currentReason ? ` (${currentReason})` : "";
    button.setAttribute("aria-label", `${currentLabel}${reasonSuffix}`);
    if (tooltip) button.setAttribute("title", currentDisabled && currentReason ? currentReason : currentLabel);
    else button.removeAttribute("title");
  }

  applyState();

  return {
    element: button,
    setDisabled(nextDisabled, reason = "") {
      currentDisabled = Boolean(nextDisabled);
      if (reason) currentReason = reason;
      applyState();
    },
    setLabel(nextLabel) {
      currentLabel = nextLabel || currentLabel;
      applyState();
    },
    destroy() {
      button.removeEventListener("click", handler);
      button.remove();
    }
  };
}

export function createTextButton(options = {}) {
  const {
    label, labelKey, t, onClick, disabled = false, disabledReason = "",
    tone = "quiet", iconId, iconRegistry, className = ""
  } = options;
  const text = label || tSafe(t, labelKey) || "";
  const button = el("button", {
    className: ["v95-button", `v95-button--${tone}`, className].filter(Boolean).join(" "),
    attrs: { type: "button" }
  });
  if (iconId) {
    const render = iconRenderer(iconRegistry);
    button.appendChild(render(iconId, { size: 14, decorative: true }));
  }
  button.appendChild(el("span", { className: "v95-button-label", text }));
  if (disabled) {
    button.disabled = true;
    if (disabledReason) button.title = disabledReason;
  }
  const handler = event => {
    if (button.disabled) {
      event.preventDefault();
      return;
    }
    if (typeof onClick === "function") onClick(event);
  };
  button.addEventListener("click", handler);
  return {
    element: button,
    setDisabled(next) { button.disabled = Boolean(next); },
    destroy() { button.removeEventListener("click", handler); button.remove(); }
  };
}
