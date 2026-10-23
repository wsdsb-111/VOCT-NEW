/**
 * V9.5 offline icon registry.
 *
 * Pure display module. All icons are original, inline SVG built with DOM APIs.
 * No external files, fonts, sprites, global IDs, CSS masks or network access.
 * Unknown IDs fall back to the neutral "unknown" symbol and never throw.
 */

const SVG_NS = "http://www.w3.org/2000/svg";

const icon = (category, labelKey, description, shapes) => Object.freeze({
  category, labelKey, description, shapes: Object.freeze(shapes)
});

const path = (d, extra = {}) => Object.freeze(["path", Object.freeze({ d, ...extra })]);
const circle = (cx, cy, r, extra = {}) => Object.freeze(["circle", Object.freeze({ cx, cy, r, ...extra })]);
const rect = (x, y, width, height, rx, extra = {}) => Object.freeze(["rect", Object.freeze({ x, y, width, height, rx, ...extra })]);
const line = (x1, y1, x2, y2, extra = {}) => Object.freeze(["line", Object.freeze({ x1, y1, x2, y2, ...extra })]);
const filled = (tag, attrs) => Object.freeze([tag, Object.freeze({ fill: "currentColor", stroke: "none", ...attrs })]);

/* Canonical contract IDs first. */
const DEFINITIONS = {
  optimization: icon("navigation", "legacyUi.nav.optimization", "Performance gauge", [
    path("M4 18a9 9 0 1 1 16 0"), path("M12 13l5-5"), circle(12, 13, 1.5), path("M5 20h14")
  ]),
  worldbook: icon("navigation", "legacyUi.nav.worldline", "Open world book", [
    path("M12 5c-3-2-6-2-9-1v15c3-1 6-1 9 1 3-2 6-2 9-1V4c-3-1-6-1-9 1v15"), path("M6 8h3M15 8h3M6 12h3M15 12h3")
  ]),
  conversation: icon("conversation", "navigation.conversation", "Speech bubble", [
    path("M4.5 5.5h15v9.5H9l-4.5 3.5z"),
    path("M8 9h8M8 11.7h5")
  ]),
  memory: icon("history", "navigation.memory", "Layered summary cards", [
    path("M5 4.2h10.5v13.6H5z"),
    path("M8 7.4h11.5v13.4H8z"),
    path("M11 3v4.8l2-1.3 2 1.3V3")
  ]),
  knowledge: icon("knowledge", "navigation.knowledge", "Person with known-fact check", [
    circle(9, 8, 3.2),
    path("M3.6 19.2c0-3.7 2.4-6.2 5.4-6.2 1.7 0 3.1.7 4.2 1.9"),
    path("M14.4 16.4l2 2 4.2-4.6")
  ]),
  worldline: icon("history", "navigation.worldline", "Worldline timeline", [
    path("M6 3.5v17"),
    circle(6, 7.5, 1.5),
    circle(6, 16.5, 1.5),
    path("M7.5 7.5h4.8v4h4.2M7.5 16.5h8v-5h3")
  ]),
  letter: icon("letter", "navigation.letters", "Envelope", [
    rect(3.5, 5.5, 17, 13, 1.2),
    path("M4.2 6.5l7.8 6 7.8-6")
  ]),
  action: icon("action", "navigation.actions", "Action spark", [
    path("M13.4 2.5L5 13.4h5L9.6 21.5 19 9.4h-5.6z")
  ]),
  provider: icon("provider", "navigation.provider", "Provider server", [
    rect(4, 4, 16, 6, 1.2),
    rect(4, 14, 16, 6, 1.2),
    circle(7.4, 7, 0.65, { fill: "currentColor", stroke: "none" }),
    circle(7.4, 17, 0.65, { fill: "currentColor", stroke: "none" }),
    path("M11 7h5.6M11 17h5.6")
  ]),
  settings: icon("navigation", "navigation.settings", "Sliders", [
    path("M4 7h16M4 12h16M4 17h16"),
    circle(9, 7, 1.9),
    circle(15, 12, 1.9),
    circle(8, 17, 1.9)
  ]),
  refresh: icon("navigation", "common.refresh", "Circular refresh", [
    path("M19.4 12a7.4 7.4 0 1 1-2.1-5.2"),
    path("M19.4 4.5V9h-4.5")
  ]),
  search: icon("navigation", "common.filter", "Search", [
    circle(10.5, 10.5, 5.6),
    path("M14.7 14.7L20 20")
  ]),
  edit: icon("navigation", "common.edit", "Pencil", [
    path("M4.5 19.5l1-4.2L16.5 4.3a2 2 0 0 1 2.8 0l.4.4a2 2 0 0 1 0 2.8L8.7 18.5z"),
    path("M14.7 6.1l3.2 3.2")
  ]),
  source: icon("history", "common.source", "Linked source", [
    path("M10 14l4-4"),
    path("M8.6 11.4L6.4 13.6a3 3 0 0 0 4.2 4.2l2.2-2.2"),
    path("M15.4 12.6l2.2-2.2a3 3 0 0 0-4.2-4.2l-2.2 2.2")
  ]),
  check: icon("status", "status.CONFIRMED", "Check", [
    path("M4.5 12.5l4.7 4.7 10.3-11")
  ]),
  warning: icon("status", "status.STALLED", "Warning", [
    path("M12 3.5L21 20H3z"),
    path("M12 9v5"),
    circle(12, 17.1, 0.8, { fill: "currentColor", stroke: "none" })
  ]),
  error: icon("status", "status.ERROR", "Error", [
    circle(12, 12, 8.5),
    path("M9 9l6 6M15 9l-6 6")
  ]),
  unknown: icon("status", "status.UNKNOWN", "Unknown", [
    circle(12, 12, 8.5),
    path("M9.6 9.3a2.5 2.5 0 1 1 3.4 2.4c-.8.3-1 .9-1 1.8"),
    circle(12, 16.8, 0.9, { fill: "currentColor", stroke: "none" })
  ]),
  close: icon("navigation", "common.close", "Close", [
    path("M6 6l12 12M18 6L6 18")
  ]),
  "chevron-left": icon("navigation", "common.previous", "Previous", [
    path("M14.5 5.5L8 12l6.5 6.5")
  ]),
  "chevron-right": icon("navigation", "common.next", "Next", [
    path("M9.5 5.5L16 12l-6.5 6.5")
  ]),

  /* Optional visual/system icons (unknown to the frozen ICON_NAMES are still
     valid row.icon values per the v1 contract; unknown names fall back safely). */
  info: icon("status", "common.unknown", "Information", [
    circle(12, 12, 8.5),
    path("M12 10.5v6"),
    circle(12, 7.5, 0.9, { fill: "currentColor", stroke: "none" })
  ]),
  success: icon("status", "status.CONFIRMED", "Confirmed", [
    circle(12, 12, 8.5),
    path("M8 12.2l2.7 2.7L16.4 9")
  ]),
  plus: icon("navigation", "common.detail", "Add", [
    path("M12 5v14M5 12h14")
  ]),
  copy: icon("navigation", "common.detail", "Copy", [
    rect(8, 8, 11.5, 11.5, 1.2),
    path("M16 8V5.5A1.5 1.5 0 0 0 14.5 4H5.5A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8")
  ]),
  send: icon("conversation", "common.detail", "Send", [
    path("M3.5 11.5L20.5 4l-6 17-3.4-6.6z"),
    path("M11.1 14.4L20.5 4")
  ]),
  approval: icon("action", "common.approve", "Approval stamp", [
    path("M5 18.5h14"),
    path("M7 14h10v3.5H7z"),
    path("M9.2 14V9.5h5.6V14"),
    path("M12 3.5v4")
  ]),
  queued: icon("status", "status.QUEUED", "Queued clock", [
    circle(12, 12, 8.5),
    path("M12 7v5.3l3.4 2")
  ]),
  confirmed: icon("status", "status.CONFIRMED", "Confirmed check", [
    circle(12, 12, 8.5),
    path("M8 12.2l2.7 2.7L16.4 9")
  ]),
  unconfirmed: icon("status", "status.UNCONFIRMED", "Unconfirmed", [
    circle(12, 12, 8.5, { strokeDasharray: "2.2 2.8" }),
    path("M9.6 9.3a2.5 2.5 0 1 1 3.4 2.4c-.8.3-1 .9-1 1.8"),
    circle(12, 16.8, 0.9, { fill: "currentColor", stroke: "none" })
  ]),
  received: icon("letter", "status.ACKNOWLEDGED", "Inbox", [
    path("M4 5.5h16v13H4z"),
    path("M4 13h4.4l1.3 2.2h4.6l1.3-2.2H20")
  ]),
  blocked: icon("status", "status.BLOCKED", "Blocked", [
    circle(12, 12, 8.5),
    path("M6 6l12 12")
  ]),
  model: icon("provider", "navigation.provider", "Model chip", [
    rect(7, 7, 10, 10, 1.2),
    path("M9.5 3.5v3.5M14.5 3.5v3.5M9.5 17v3.5M14.5 17v3.5M3.5 9.5H7M17 9.5h3.5M3.5 14.5H7M17 14.5h3.5")
  ]),
  connection: icon("provider", "status.READY", "Connection", [
    path("M9 15l6-6"),
    path("M7.4 12.4l-1.8 1.8a3.4 3.4 0 0 0 4.8 4.8l1.8-1.8"),
    path("M16.6 11.6l1.8-1.8a3.4 3.4 0 0 0-4.8-4.8l-1.8 1.8")
  ]),
  usage: icon("provider", "diagnostics.title", "Usage bars", [
    path("M4 20V10M10 20V4M16 20v-7M20 20H4")
  ]),
  cache: icon("provider", "diagnostics.cacheRate", "Cache cylinder", [
    path("M4 6.5c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3z"),
    path("M4 6.5v11c0 1.7 3.6 3 8 3s8-1.3 8-3v-11"),
    path("M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3")
  ]),
  diagnostics: icon("provider", "diagnostics.title", "Pulse line", [
    path("M3 12h4l2.2-5 3.6 10 2.4-5H21")
  ]),
  filter: icon("navigation", "common.filter", "Filter funnel", [
    path("M3.5 5h17l-6.5 7.5v6l-4 2v-8z")
  ]),
  sort: icon("navigation", "common.filter", "Sort arrows", [
    path("M8 4v16M8 4L5 7M8 4l3 3"),
    path("M16 20V4M16 20l-3-3M16 20l3-3")
  ]),
  calendar: icon("history", "common.unknown", "Calendar", [
    rect(3.5, 5, 17, 15.5, 1.5),
    path("M3.5 9.5h17M8 3v4M16 3v4")
  ]),
  history: icon("history", "common.unknown", "History", [
    path("M4.5 7.5A8 8 0 1 1 4 14"),
    path("M4.5 3.5v4.5H9"),
    path("M12 8v4.5l3 1.8")
  ]),
  difference: icon("history", "common.unknown", "Difference", [
    path("M5 8h6M8 5v6"),
    path("M13 16h6"),
    path("M8 20h-.1M16 4h-.1")
  ]),
  timeline: icon("history", "navigation.worldline", "Timeline", [
    path("M5 4v16"),
    circle(5, 7, 1.5),
    circle(5, 12, 1.5),
    circle(5, 17, 1.5),
    path("M6.5 7H12M6.5 12H15M6.5 17H10")
  ]),
  user: icon("conversation", "conversation.player", "Player", [
    circle(12, 8, 3.6),
    path("M5 20c0-4 3.1-7 7-7s7 3 7 7")
  ]),
  users: icon("conversation", "conversation.npc", "Participants", [
    circle(9, 8.5, 3),
    path("M3.5 19c0-3.4 2.4-5.6 5.5-5.6 2 0 3.6.9 4.5 2.5"),
    path("M14.5 5.7a3 3 0 0 1 0 5.6M16.5 13.8c2.3.5 4 2.5 4 5.2")
  ]),
  system: icon("conversation", "conversation.system", "System", [
    rect(4, 4, 16, 13, 1.2),
    path("M8 20h8M12 17v3M8 9h8M8 12h5")
  ]),
  lock: icon("status", "status.BLOCKED", "Locked", [
    rect(5.5, 10.5, 13, 9, 1.2),
    path("M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"),
    circle(12, 15, 1.2, { fill: "currentColor", stroke: "none" })
  ]),
  external: icon("navigation", "common.detail", "External", [
    path("M14 4h6v6M20 4l-8.5 8.5"),
    path("M18 14v5.5A1.5 1.5 0 0 1 16.5 21h-11A1.5 1.5 0 0 1 4 19.5v-11A1.5 1.5 0 0 1 5.5 7H11")
  ]),
  dots: icon("navigation", "common.detail", "More", [
    circle(6, 12, 1.2, { fill: "currentColor", stroke: "none" }),
    circle(12, 12, 1.2, { fill: "currentColor", stroke: "none" }),
    circle(18, 12, 1.2, { fill: "currentColor", stroke: "none" })
  ]),
  "chevron-down": icon("navigation", "common.detail", "Expand", [
    path("M5.5 9.5L12 16l6.5-6.5")
  ]),
  "chevron-up": icon("navigation", "common.detail", "Collapse", [
    path("M5.5 14.5L12 8l6.5 6.5")
  ]),
  "arrow-left": icon("navigation", "common.previous", "Back", [
    path("M20 12H4M10 6l-6 6 6 6")
  ])
};

export const ICON_ALIASES = Object.freeze({
  chat: "conversation",
  message: "conversation",
  summary: "memory",
  bookmark: "memory",
  known: "knowledge",
  disclosure: "knowledge",
  timeline: "worldline",
  letters: "letter",
  send: "send",
  regenerate: "refresh",
  retry: "refresh",
  approved: "approval",
  success: "confirmed",
  error: "error",
  danger: "error",
  notices: "info",
  question: "unknown",
  close: "close",
  more: "dots",
  next: "chevron-right",
  previous: "chevron-left"
});

const FALLBACK_ID = "unknown";

export const ICON_CATALOG = Object.freeze(Object.entries(DEFINITIONS).map(([id, definition]) => Object.freeze({
  id,
  category: definition.category,
  labelKey: definition.labelKey,
  description: definition.description,
  license: "original / VOCT V9.5"
})));

function resolveDefinition(iconId) {
  const requested = typeof iconId === "string" ? iconId : "";
  const alias = ICON_ALIASES[requested];
  const canonical = alias && DEFINITIONS[alias] ? alias : requested;
  if (Object.hasOwn(DEFINITIONS, canonical)) {
    return { requested, resolved: canonical, definition: DEFINITIONS[canonical], fallback: false };
  }
  return { requested, resolved: FALLBACK_ID, definition: DEFINITIONS[FALLBACK_ID], fallback: true };
}

export function hasIcon(iconId) {
  if (typeof iconId !== "string" || !iconId) return false;
  return Object.hasOwn(DEFINITIONS, ICON_ALIASES[iconId] || iconId);
}

export function listIcons() {
  return ICON_CATALOG.map(entry => entry.id);
}

export function getIconCatalog() {
  return ICON_CATALOG;
}

function appendShape(svg, shape) {
  const [tag, attributes] = shape;
  const node = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (value === undefined || value === null) continue;
    node.setAttribute(name, String(value));
  }
  svg.appendChild(node);
}

/**
 * Render an icon as a standalone SVG element.
 * @param {string} iconId
 * @param {{size?: number, label?: string, decorative?: boolean, className?: string}} [options]
 */
export function renderIcon(iconId, options = {}) {
  const {
    size = 20,
    label = "",
    decorative = true,
    className = ""
  } = options && typeof options === "object" ? options : {};
  const svg = document.createElementNS(SVG_NS, "svg");
  const { requested, resolved, definition, fallback } = resolveDefinition(iconId);
  const numericSize = Number.isFinite(Number(size)) ? Math.min(48, Math.max(12, Number(size))) : 20;
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", String(numericSize));
  svg.setAttribute("height", String(numericSize));
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.7");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("focusable", "false");
  svg.setAttribute("class", `v95-icon${className ? ` ${className}` : ""}`);
  svg.dataset.icon = requested || FALLBACK_ID;
  if (fallback) svg.dataset.iconFallback = FALLBACK_ID;
  else if (resolved !== requested) svg.dataset.iconResolved = resolved;

  if (!decorative && typeof label === "string" && label.trim()) {
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", label.trim());
    const title = document.createElementNS(SVG_NS, "title");
    title.textContent = label.trim();
    svg.appendChild(title);
  } else {
    svg.setAttribute("aria-hidden", "true");
  }
  for (const shape of definition.shapes) appendShape(svg, shape);
  return svg;
}

export const defaultIconRegistry = Object.freeze({
  hasIcon,
  renderIcon,
  listIcons,
  getIconCatalog
});

export default defaultIconRegistry;
