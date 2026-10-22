const statusValues = new Set([
  "IDLE", "LOADING", "REFRESHING", "READY", "EMPTY", "ERROR", "STALE", "QUEUED",
  "DISPATCHED", "ACKNOWLEDGED", "CONFIRMED", "UNCONFIRMED", "UNKNOWN", "SOURCE_BOUND",
  "BLOCKED", "STALLED"
]);

const rowActions = Object.freeze({
  "conversation-feed": ["OPEN_DETAIL", "SELECT_ROW", "CHANGE_FILTER"],
  "memory-list": ["OPEN_DETAIL", "OPEN_SOURCE", "SELECT_ROW", "CHANGE_FILTER"],
  "knowledge-facts": ["OPEN_DETAIL", "SELECT_ROW", "REQUEST_EDIT", "CHANGE_FILTER"],
  "worldline-timeline": ["OPEN_DETAIL", "SELECT_ROW", "CHANGE_FILTER"],
  "letter-list": ["OPEN_DETAIL", "OPEN_SOURCE", "SELECT_ROW", "REQUEST_APPROVAL", "CHANGE_FILTER"],
  "action-activity": ["OPEN_DETAIL", "SELECT_ROW", "REQUEST_APPROVAL", "CHANGE_FILTER"],
  "provider-diagnostics": ["OPEN_DETAIL", "CHANGE_FILTER"],
  "settings-section": ["SELECT_ROW", "REQUEST_EDIT", "CHANGE_FILTER"]
});

export const DOMAIN_ADAPTERS = Object.freeze({
  "conversation-feed": Object.freeze({
    domain: "conversation", titleKey: "conversation.title", emptyTextKey: "conversation.empty", icon: "conversation",
    fields: Object.freeze(["displayName", "speakerName", "characterName", "role", "text", "content", "message", "dateText", "timeText", "timestampText", "status", "state", "streaming", "disabled"])
  }),
  "memory-list": Object.freeze({
    domain: "memory", titleKey: "memory.title", emptyTextKey: "memory.empty", icon: "memory",
    fields: Object.freeze(["title", "summaryTitle", "label", "summary", "text", "content", "dateText", "conversationDate", "status", "state", "disabled"])
  }),
  "knowledge-facts": Object.freeze({
    domain: "knowledge", titleKey: "knowledge.title", emptyTextKey: "knowledge.empty", icon: "knowledge",
    fields: Object.freeze(["subjectName", "targetName", "title", "factName", "name", "factText", "value", "dateText", "acquiredAt", "status", "state", "disabled"])
  }),
  "worldline-timeline": Object.freeze({
    domain: "worldline", titleKey: "worldline.title", emptyTextKey: "worldline.empty", icon: "worldline",
    fields: Object.freeze(["title", "eventTitle", "label", "description", "text", "dateText", "gameDate", "status", "state", "disabled"])
  }),
  "letter-list": Object.freeze({
    domain: "letters", titleKey: "letters.title", emptyTextKey: "letters.empty", icon: "letter",
    fields: Object.freeze(["title", "subject", "recipientName", "senderName", "preview", "text", "dateText", "createdAt", "stage", "status", "state", "effectState", "queueTimeText", "disabled"])
  }),
  "action-activity": Object.freeze({
    domain: "actions", titleKey: "actions.title", emptyTextKey: "actions.empty", icon: "action",
    fields: Object.freeze(["title", "actionName", "label", "targetName", "dateText", "stage", "status", "state", "effectState", "queueTimeText", "disabled"])
  }),
  "provider-diagnostics": Object.freeze({
    domain: "diagnostics", titleKey: "diagnostics.title", emptyTextKey: "diagnostics.empty", icon: "provider",
    fields: Object.freeze(["metricKey", "value", "unit", "estimateKind", "progress", "disabled"])
  }),
  "settings-section": Object.freeze({
    domain: "settings", titleKey: "settings.title", emptyTextKey: "settings.empty", icon: "settings",
    fields: Object.freeze(["settingKey", "key", "value", "disabled"])
  })
});

function read(record, field) {
  try {
    return record?.[field];
  } catch (_ignored) {
    return undefined;
  }
}

function textFrom(record, fields, limit = 1200) {
  for (const field of fields) {
    const value = read(record, field);
    if (typeof value === "string" && value.trim()) return value.trim().slice(0, limit);
  }
  return "";
}

function titleFrom(record, fields) {
  const value = textFrom(record, fields, 600);
  return /^(?:id\s*[:：]?\s*)?\d+$/i.test(value) ? "" : value;
}

function translated(t, key, fallback, params = {}) {
  try {
    const value = t(key, params);
    if (typeof value === "string" && value && value !== key) return value;
  } catch (_ignored) {
    // Fall back to the frozen V9.5 label.
  }
  return fallback;
}

function normalizeStatus(value) {
  if (typeof value !== "string") return "UNKNOWN";
  const normalized = value.trim().toUpperCase();
  return statusValues.has(normalized) ? normalized : "UNKNOWN";
}

function statusTone(status) {
  if (status === "CONFIRMED" || status === "READY") return "success";
  if (["BLOCKED", "STALLED", "UNCONFIRMED", "ERROR"].includes(status)) return "warning";
  if (["QUEUED", "DISPATCHED", "ACKNOWLEDGED", "SOURCE_BOUND"].includes(status)) return "info";
  return "neutral";
}

function statusBadge(status) {
  const normalized = normalizeStatus(status);
  return { tone: statusTone(normalized), textKey: `status.${normalized}` };
}

function normalizeRole(value) {
  if (typeof value !== "string") return undefined;
  const role = value.trim().toLowerCase();
  if (role === "player" || role === "user") return "player";
  if (role === "system") return "system";
  if (["npc", "assistant", "character"].includes(role)) return "npc";
  return undefined;
}

const settingDefinitions = Object.freeze({
  uiLanguage: Object.freeze({ titleKey: "settings.uiLanguage", type: "select", helpTextKey: "settings.languageHelp" }),
  promptLanguage: Object.freeze({ titleKey: "settings.promptLanguage", type: "readOnly" }),
  gameLanguage: Object.freeze({ titleKey: "settings.gameLanguage", type: "readOnly" })
});
const languageValues = new Set(["zh-CN", "en-US", "en", "zh", "ru", "de", "fr", "es", "pl", "ko", "ja", "简体中文", "繁體中文", "English", "日本語", "한국어", "Français", "Deutsch", "Español", "Русский"]);
const diagnosticTitleKeys = Object.freeze({
  cacheRate: "diagnostics.cacheRate", native: "diagnostics.native", estimated: "diagnostics.estimated", unknown: "diagnostics.unknown"
});
const diagnosticUnits = new Set(["%", "tokens", "ms", "requests", "items"]);

function projectSettings(record, id, t) {
  const settingKey = read(record, "settingKey") || read(record, "key");
  const definition = typeof settingKey === "string" ? settingDefinitions[settingKey] : null;
  if (!definition) return null;
  const rawValue = read(record, "value");
  const value = typeof rawValue === "string" && languageValues.has(rawValue) ? rawValue : null;
  const control = {
    type: definition.type,
    value,
    ...(definition.type === "select" ? { options: [
      { value: "zh-CN", labelKey: "settings.chinese" }, { value: "en-US", labelKey: "settings.english" }
    ] } : {}),
    ...(definition.helpTextKey ? { helpTextKey: definition.helpTextKey } : {})
  };
  return {
    id, title: translated(t, definition.titleKey, "未知"), icon: "settings", disabled: read(record, "disabled") === true,
    actions: [...rowActions["settings-section"]], badge: statusBadge("UNKNOWN"), control
  };
}

function projectDiagnostics(record, id, t) {
  const metricKey = read(record, "metricKey");
  const titleKey = typeof metricKey === "string" ? diagnosticTitleKeys[metricKey] : null;
  const rawValue = read(record, "value");
  const estimateKind = ["native", "estimated", "unknown"].includes(read(record, "estimateKind")) ? read(record, "estimateKind") : "unknown";
  const unit = diagnosticUnits.has(read(record, "unit")) ? read(record, "unit") : "";
  const rawProgress = read(record, "progress");
  const progress = Number.isFinite(rawProgress) ? Math.min(1, Math.max(0, rawProgress)) : null;
  return {
    id,
    title: translated(t, titleKey || "common.unknown", "未知"),
    subtitle: translated(t, `diagnostics.${estimateKind}`, "未知"),
    icon: "provider", disabled: read(record, "disabled") === true,
    actions: [...rowActions["provider-diagnostics"]], badge: statusBadge("UNKNOWN"),
    metric: { value: Number.isFinite(rawValue) ? rawValue : null, unit, estimateKind, progress }
  };
}

export function projectDomainRecord(kind, record, { id, t } = {}) {
  const adapter = DOMAIN_ADAPTERS[kind];
  if (!adapter || typeof id !== "string" || typeof t !== "function"
    || record === null || typeof record !== "object" || Array.isArray(record)) return null;
  const uiTitleKey = read(record, "uiTitleKey");
  const uiTitleParams = read(record, "uiTitleParams");
  const uiFactKindKey = read(record, "uiFactKindKey");
  const factValue = read(record, "factValue");
  const safeRecord = Object.create(null);
  for (const field of adapter.fields) safeRecord[field] = read(record, field);
  record = safeRecord;
  if (kind === "settings-section") return projectSettings(record, id, t);
  if (kind === "provider-diagnostics") return projectDiagnostics(record, id, t);

  const titleFields = {
    "conversation-feed": ["displayName", "speakerName", "characterName"],
    "memory-list": ["title", "summaryTitle", "label"],
    "knowledge-facts": ["subjectName", "targetName", "title", "factName", "name"],
    "worldline-timeline": ["title", "eventTitle", "label"],
    "letter-list": ["title", "subject", "recipientName", "senderName"],
    "action-activity": ["title", "actionName", "label", "targetName"]
  }[kind];
  const subtitleFields = {
    "conversation-feed": [],
    "memory-list": ["conversationDate", "dateText"],
    "knowledge-facts": ["acquiredAt", "dateText"],
    "worldline-timeline": ["gameDate", "dateText"],
    "letter-list": ["recipientName", "senderName", "createdAt", "dateText"],
    "action-activity": ["targetName", "dateText"]
  }[kind];
  const textFields = {
    "conversation-feed": ["text", "content", "message"],
    "memory-list": ["summary", "text", "content"],
    "knowledge-facts": ["factText", "value"],
    "worldline-timeline": ["description", "text"],
    "letter-list": ["preview", "text"],
    "action-activity": []
  }[kind];
  const dateFields = {
    "conversation-feed": ["dateText"],
    "memory-list": ["conversationDate", "dateText"],
    "knowledge-facts": ["dateText"],
    "worldline-timeline": ["gameDate", "dateText"],
    "letter-list": ["dateText", "createdAt"],
    "action-activity": ["dateText"]
  }[kind];
  const rawStatus = read(record, "status") || read(record, "state")
    || (["letter-list", "action-activity"].includes(kind) ? read(record, "stage") : undefined);
  const status = normalizeStatus(rawStatus);
  const row = {
    id,
    title: titleFrom(record, titleFields) || translated(t, "common.unknown", "未知"),
    icon: adapter.icon,
    disabled: read(record, "disabled") === true,
    actions: [...rowActions[kind]],
    badge: statusBadge(status)
  };
  const titleKeys = new Set(["common.unknown", "conversation.player", "conversation.npc", "conversation.system",
    "common.error", "letters.title", "actions.title", "workspace.worldlineEvent", "workspace.events.warStarted",
    "workspace.events.importantCharacterDied", "workspace.events.titleHolderChanged", "workspace.events.warNoLongerActive"]);
  if (titleKeys.has(uiTitleKey)) row.title = translated(t, uiTitleKey, row.title);
  if (kind === "knowledge-facts" && uiTitleKey === "workspace.knowledgeDirection") {
    const owner = textFrom(uiTitleParams, ["owner"], 240) || translated(t, "common.unknown", "未知");
    const target = textFrom(uiTitleParams, ["target"], 240) || translated(t, "common.unknown", "未知");
    row.title = translated(t, uiTitleKey, `${owner} → ${target}`, { owner, target });
  }
  const subtitle = textFrom(record, subtitleFields, 240);
  const text = textFrom(record, textFields, 5000);
  const dateText = textFrom(record, dateFields, 160);
  if (subtitle) row.subtitle = subtitle;
  if (text) row.text = text;
  if (kind === "knowledge-facts" && ["name", "nickname", "title", "trait"].some(value => uiFactKindKey === `legacyKnowledge.kinds.${value}`)
    && typeof factValue === "string") row.text = `${translated(t, uiFactKindKey, "未知")}: ${factValue}`;
  if (dateText) row.dateText = dateText;
  const timeText = kind === "conversation-feed" ? textFrom(record, ["timeText", "timestampText"], 160) : "";
  if (timeText) row.timeText = timeText;
  if (kind === "conversation-feed") {
    const role = normalizeRole(read(record, "role"));
    if (role) row.role = role;
    if (typeof read(record, "streaming") === "boolean") row.streaming = read(record, "streaming");
  }
  if (kind === "letter-list" || kind === "action-activity") {
    row.stage = normalizeStatus(read(record, "stage") || read(record, "status"));
    row.effectState = normalizeStatus(read(record, "effectState"));
    const queueTimeText = textFrom(record, ["queueTimeText"], 160);
    if (queueTimeText) row.queueTimeText = queueTimeText;
  }
  return row;
}
