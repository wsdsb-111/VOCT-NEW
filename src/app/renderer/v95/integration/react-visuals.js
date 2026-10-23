/**
 * React adapters for the reviewed V9.5 icon and status primitives.
 * Page containers still own the labels and status values passed here.
 */
import { defaultIconRegistry } from "../icons/icon-registry.js";
import { createStatusBadge, normalizeMachineStatus } from "../visual/status-indicator.js";

function reactPropName(name) {
  if (name === "class") return "className";
  if (name === "for") return "htmlFor";
  if (name === "tabindex") return "tabIndex";
  if (name.startsWith("aria-") || name.startsWith("data-")) return name;
  return name.replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
}

function toReactNode(node, jsxRuntime, key) {
  if (!node) return null;
  if (node.nodeType === 3) return node.nodeValue ?? node.textContent ?? "";
  if (node.nodeType !== 1) return null;

  const props = {};
  for (const attribute of Array.from(node.attributes || [])) {
    props[reactPropName(attribute.name)] = attribute.value;
  }
  const children = Array.from(node.childNodes || [])
    .map((child, index) => toReactNode(child, jsxRuntime, `${key}.${index}`))
    .filter(child => child !== null);
  if (children.length === 1) props.children = children[0];
  else if (children.length > 1) props.children = children;

  const createElement = children.length > 1 && typeof jsxRuntime.jsxs === "function"
    ? jsxRuntime.jsxs
    : jsxRuntime.jsx;
  return createElement(node.tagName.toLowerCase(), props, key);
}

export function createReactVisuals({ jsxRuntime, iconRegistry = defaultIconRegistry } = {}) {
  if (!jsxRuntime || typeof jsxRuntime.jsx !== "function") {
    throw new TypeError("createReactVisuals requires a React JSX runtime");
  }
  const registry = iconRegistry && typeof iconRegistry.renderIcon === "function"
    ? iconRegistry
    : defaultIconRegistry;

  function Icon({ name, icon, size = 14, className = "" } = {}) {
    const iconId = name || icon || "unknown";
    const node = registry.renderIcon(iconId, {
      size,
      decorative: true,
      className: ["v95-page-row-icon", className].filter(Boolean).join(" ")
    });
    return toReactNode(node, jsxRuntime, `v95-icon-${iconId}`);
  }

  function StatusBadge({ code, label, className = "" } = {}) {
    if (typeof label !== "string" || !label) return null;
    const status = normalizeMachineStatus(code);
    const node = createStatusBadge(code, {
      iconRegistry: registry,
      t: key => key === `status.${status}` ? label : "",
      className: ["v95-page-status", className].filter(Boolean).join(" ")
    });
    return toReactNode(node, jsxRuntime, `v95-status-${status}`);
  }

  function decorateLegacyRow(row, { target, icon: iconId } = {}) {
    if (!row || !target || !iconId || typeof target.insertBefore !== "function") return null;
    if (typeof row.contains === "function" && !row.contains(target)) return null;
    if (target.getAttribute("data-v95-page-icon") === iconId) return null;

    const node = registry.renderIcon(iconId, { size: 14, decorative: true, className: "v95-page-row-icon" });
    target.insertBefore(node, target.firstChild);
    target.setAttribute("data-v95-page-icon", iconId);
    return node;
  }

  return Object.freeze({ Icon, StatusBadge, decorateLegacyRow });
}
