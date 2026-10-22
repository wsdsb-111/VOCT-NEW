import { ASYNC_STATES, ERROR_CODES } from "./async-states.v1.js";

export const CONTRACT_VERSION = "v95-view-v1";
export const CONTRACT_REVISION = 1;
export const VIEW_KINDS = Object.freeze([
  "conversation-feed", "memory-list", "knowledge-facts", "worldline-timeline",
  "letter-list", "action-activity", "provider-diagnostics", "settings-section"
]);
export const UI_INTENTS = Object.freeze([
  "OPEN_DETAIL", "OPEN_SOURCE", "SELECT_ROW", "CHANGE_PAGE", "CHANGE_FILTER",
  "REQUEST_REFRESH", "REQUEST_EDIT", "REQUEST_APPROVAL", "CANCEL_UI"
]);
export const ICON_NAMES = Object.freeze([
  "conversation", "memory", "knowledge", "worldline", "letter", "action", "provider",
  "settings", "refresh", "search", "edit", "source", "check", "warning", "error",
  "unknown", "close", "chevron-left", "chevron-right"
]);
const tones = ["neutral", "info", "success", "warning", "danger"];
const viewKeys = ["contractVersion", "kind", "state", "scopeTag", "revisionTag", "titleKey", "rows", "emptyTextKey", "errorCode", "pagination"];
const rowKeys = ["id", "title", "subtitle", "dateText", "badge", "icon", "disabled", "actions", "role", "text", "streaming", "timeText", "metric", "control", "stage", "effectState", "queueTimeText"];
const string = value => typeof value === "string";
const record = value => value !== null && typeof value === "object" && !Array.isArray(value);
const onlyKeys = (value, keys) => record(value) && Object.keys(value).every(key => keys.includes(key));
const opaque = value => string(value) && /^[A-Za-z0-9_-]{1,160}$/.test(value);
const key = value => string(value) && /^[a-zA-Z][a-zA-Z0-9_.-]*$/.test(value);
const optionalString = (value, name) => value[name] === undefined || string(value[name]);

function validRow(row) {
  if (!onlyKeys(row, rowKeys) || !opaque(row.id) || !string(row.title)
    || !["subtitle", "dateText", "text", "timeText", "stage", "effectState", "queueTimeText"].every(name => optionalString(row, name))
    || !string(row.icon) || !/^[a-z][a-z0-9-]{0,79}$/.test(row.icon) || typeof row.disabled !== "boolean"
    || !Array.isArray(row.actions) || row.actions.some(action => !UI_INTENTS.includes(action))) return false;
  if (row.badge !== null && row.badge !== undefined
    && (!onlyKeys(row.badge, ["tone", "textKey"]) || !tones.includes(row.badge.tone) || !key(row.badge.textKey))) return false;
  if (row.role !== undefined && !["player", "npc", "system"].includes(row.role)) return false;
  if (row.streaming !== undefined && typeof row.streaming !== "boolean") return false;
  if (row.metric !== undefined) {
    const metric = row.metric;
    if (!onlyKeys(metric, ["value", "unit", "estimateKind", "progress"])
      || !(metric.value === null || Number.isFinite(metric.value)) || !string(metric.unit)
      || !["native", "estimated", "unknown"].includes(metric.estimateKind)
      || !(metric.progress === undefined || metric.progress === null || (Number.isFinite(metric.progress) && metric.progress >= 0 && metric.progress <= 1))) return false;
  }
  if (row.control !== undefined) {
    const control = row.control;
    if (!onlyKeys(control, ["type", "value", "options", "helpTextKey"])
      || !["readOnly", "select", "toggle", "text"].includes(control.type)
      || !(control.value === null || string(control.value) || typeof control.value === "boolean")
      || !(control.helpTextKey === undefined || key(control.helpTextKey))
      || !(control.options === undefined || Array.isArray(control.options) && control.options.every(option =>
        onlyKeys(option, ["value", "labelKey"]) && string(option.value) && key(option.labelKey)))) return false;
  }
  return true;
}

export function validateView(view) {
  if (!onlyKeys(view, viewKeys) || view.contractVersion !== CONTRACT_VERSION || !VIEW_KINDS.includes(view.kind)
    || !ASYNC_STATES.includes(view.state) || !opaque(view.scopeTag) || !opaque(view.revisionTag)
    || !key(view.titleKey) || !key(view.emptyTextKey)
    || !(view.errorCode === null || ERROR_CODES.includes(view.errorCode))
    || !Array.isArray(view.rows) || !view.rows.every(validRow)
    || new Set(view.rows.map(row => row.id)).size !== view.rows.length
    || !onlyKeys(view.pagination, ["page", "pageSize", "total"])
    || !Number.isSafeInteger(view.pagination.page) || view.pagination.page < 1
    || !Number.isSafeInteger(view.pagination.pageSize) || view.pagination.pageSize < 1 || view.pagination.pageSize > 200
    || !Number.isSafeInteger(view.pagination.total) || view.pagination.total < 0
    || view.rows.length > view.pagination.pageSize
    || view.rows.length > view.pagination.total
    || ["idle", "loading", "empty", "error", "stale"].includes(view.state) && view.rows.length !== 0
    || view.state === "empty" && view.pagination.total !== 0
    || ["error", "stale"].includes(view.state) && view.errorCode === null
    || !["error", "stale"].includes(view.state) && view.errorCode !== null) return { valid: false, errorCode: "VALIDATION_ERROR" };
  return { valid: true, errorCode: null };
}

export function assertView(view) {
  if (!validateView(view).valid) {
    const error = new Error("V95_INVALID_VIEW");
    error.code = "VALIDATION_ERROR";
    throw error;
  }
  return view;
}

export function validateIntent(intent, view) {
  const rowIntents = ["OPEN_DETAIL", "OPEN_SOURCE", "SELECT_ROW", "REQUEST_EDIT", "REQUEST_APPROVAL"];
  const keys = ["type", "viewKind", "scopeTag", "revisionTag"];
  if (rowIntents.includes(intent?.type) || intent?.type === "CHANGE_FILTER") keys.push("rowId");
  if (intent?.type === "CHANGE_PAGE") keys.push("page");
  if (intent?.type === "CHANGE_FILTER") keys.push("filterKey", "value");
  if (!validateView(view).valid || !onlyKeys(intent, keys)
    || !UI_INTENTS.includes(intent.type) || intent.viewKind !== view.kind
    || intent.scopeTag !== view.scopeTag || intent.revisionTag !== view.revisionTag) return false;
  if (intent.type === "CHANGE_PAGE" && (!Number.isSafeInteger(intent.page) || intent.page < 1)) return false;
  if (intent.type === "CHANGE_FILTER" && (!string(intent.filterKey) || !(intent.value === null || string(intent.value) || typeof intent.value === "boolean"))) return false;
  if (intent.rowId !== undefined) {
    const row = view.rows.find(entry => entry.id === intent.rowId);
    if (!row || row.disabled || view.state !== "ready" || !row.actions.includes(intent.type)) return false;
  } else if (!["CHANGE_PAGE", "CHANGE_FILTER", "REQUEST_REFRESH", "CANCEL_UI"].includes(intent.type)) return false;
  return true;
}
