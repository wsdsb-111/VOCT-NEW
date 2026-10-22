/**
 * Small DOM and display helpers for the V9.5 visual layer.
 * No HTML string parsing, no global APIs, no storage, no network.
 */

let idCounter = 0;

export function uniqueDomId(prefix = "v95") {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

export function el(tag, options = {}, children = []) {
  const node = document.createElement(tag);
  if (!options || typeof options !== "object") return appendChildren(node, children);
  const {
    className, text, attrs, dataset, style, on, role, title
  } = options;
  if (className) setClassName(node, className);
  if (text !== undefined && text !== null) node.textContent = String(text);
  if (role) node.setAttribute("role", role);
  if (title) node.setAttribute("title", title);
  if (attrs && typeof attrs === "object") {
    for (const [name, value] of Object.entries(attrs)) {
      if (value === undefined || value === null || value === false) continue;
      node.setAttribute(name, value === true ? "" : String(value));
    }
  }
  if (dataset && typeof dataset === "object") {
    for (const [name, value] of Object.entries(dataset)) {
      if (value === undefined || value === null) continue;
      node.dataset[name] = String(value);
    }
  }
  if (style && typeof style === "object") {
    for (const [name, value] of Object.entries(style)) {
      if (value === undefined || value === null) continue;
      node.style.setProperty(name, String(value));
    }
  }
  if (on && typeof on === "object") {
    for (const [type, handler] of Object.entries(on)) {
      if (typeof handler === "function") node.addEventListener(type, handler);
    }
  }
  return appendChildren(node, children);
}

function appendChildren(node, children) {
  const list = Array.isArray(children) ? children : children === undefined || children === null ? [] : [children];
  for (const child of list) {
    if (child === undefined || child === null || child === false) continue;
    node.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return node;
}

export function setClassName(node, className) {
  const value = Array.isArray(className) ? className.filter(Boolean).join(" ") : String(className || "");
  node.setAttribute("class", value);
}

export function addClass(node, ...names) {
  for (const name of names) {
    if (name) node.classList.add(name);
  }
}

export function removeClass(node, ...names) {
  for (const name of names) {
    if (name) node.classList.remove(name);
  }
}

export function clearNode(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

export function replaceChildren(node, children) {
  clearNode(node);
  return appendChildren(node, children);
}

export function setText(node, value) {
  const next = value === undefined || value === null ? "" : String(value);
  if (node.textContent !== next) node.textContent = next;
  return node;
}

export function bindEvent(target, type, handler, options) {
  target.addEventListener(type, handler, options);
  return () => target.removeEventListener(type, handler, options);
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function isReducedMotion() {
  try {
    return Boolean(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  } catch (_ignored) {
    return false;
  }
}

export function focusableElements(root) {
  if (!root) return [];
  return Array.from(root.querySelectorAll(
    "button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])"
  )).filter(element => !element.hidden && element.getAttribute("aria-hidden") !== "true"
    && (element.offsetWidth > 0 || element.offsetHeight > 0 || element.getClientRects().length > 0));
}

/**
 * Translate without ever surfacing a raw key, undefined or an uninterpolated
 * template. Codex's translator already returns common.unavailable for misses;
 * this guard is for absent or earlier demo translators.
 */
export function tSafe(t, key, params = {}) {
  if (typeof t !== "function" || typeof key !== "string" || !key) return "";
  try {
    const value = t(key, params);
    if (typeof value === "string" && value && value !== key && !value.includes("{{")) return value;
  } catch (_ignored) {
    // Fall through to the current language's unavailable label.
  }
  try {
    const fallback = t("common.unavailable", {});
    if (typeof fallback === "string" && fallback && fallback !== "common.unavailable" && !fallback.includes("{{")) {
      return fallback;
    }
  } catch (_ignored) {
    // Nothing else to display safely.
  }
  return "";
}

export function formatMetricValue(value) {
  if (!Number.isFinite(value)) return null;
  try {
    return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value);
  } catch (_ignored) {
    return String(value);
  }
}

export function setAriaBusy(node, busy) {
  if (!node) return;
  if (busy) node.setAttribute("aria-busy", "true");
  else node.removeAttribute("aria-busy");
}

export function isElementWithin(node, parent) {
  return Boolean(node && parent && (node === parent || parent.contains(node)));
}
