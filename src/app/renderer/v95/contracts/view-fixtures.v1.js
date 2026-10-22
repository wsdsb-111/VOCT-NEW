import { CONTRACT_VERSION, VIEW_KINDS } from "./view-contract.v1.js";

const domains = ["conversation", "memory", "knowledge", "worldline", "letters", "actions", "diagnostics", "settings"];
const icons = ["conversation", "memory", "knowledge", "worldline", "letter", "action", "provider", "settings"];
export function createViewFixtures(language = "zh-CN") {
  const chinese = language === "zh-CN";
  return VIEW_KINDS.flatMap((kind, index) => ["ready", "empty", "loading", "error", "stale"].map(state => {
    const row = {
      id: `fixture-${index}-a`, title: chinese ? "同名人物".repeat(20) : "Long character name ".repeat(8),
      subtitle: chinese ? "未知时间与来源，仅展示获授权信息。" : "Unknown date and source; authorized information only.",
      dateText: chinese ? "日期未知" : "Date unknown", badge: { tone: "neutral", textKey: "status.UNKNOWN" },
      icon: icons[index], disabled: state !== "ready", actions: ["OPEN_DETAIL"],
      text: chinese ? "这是虚构的长文本，用于换行与滚动测试。".repeat(110) : "Synthetic long text for wrapping and scrolling. ".repeat(50)
    };
    if (kind === "conversation-feed") Object.assign(row, { role: "npc", streaming: true, timeText: "" });
    if (kind === "provider-diagnostics") row.metric = { value: null, unit: "%", estimateKind: "unknown", progress: null };
    if (kind === "settings-section") { row.actions = ["CHANGE_FILTER"]; row.control = { type: "select", value: language, options: [
      { value: "zh-CN", labelKey: "settings.chinese" }, { value: "en-US", labelKey: "settings.english" }
    ], helpTextKey: "settings.languageHelp" }; }
    if (kind === "letter-list" || kind === "action-activity") Object.assign(row, { stage: "ACKNOWLEDGED", effectState: "UNKNOWN", queueTimeText: "" });
    const second = { id: `fixture-${index}-b`, title: row.title, subtitle: "X".repeat(2000), dateText: "",
      badge: null, icon: "unrecognized-offline-icon", disabled: true, actions: [] };
    return {
      contractVersion: CONTRACT_VERSION, kind, state, scopeTag: `fixture-scope-${language}`, revisionTag: "fixture-revision-1",
      titleKey: `${domains[index]}.title`, rows: state === "ready" ? [row, second] : [],
      emptyTextKey: `${domains[index]}.empty`, errorCode: state === "error" ? "IPC_UNAVAILABLE" : state === "stale" ? "STALE_CONTEXT" : null,
      pagination: { page: 1, pageSize: 20, total: state === "ready" ? 50000 : 0 }
    };
  }));
}

export function createInvalidViewFixtures() {
  const valid = createViewFixtures("en-US")[0];
  return [
    { ...valid, state: "UNRECOGNIZED_STATE" },
    { ...valid, kind: "execute-action" },
    { ...valid, rows: [{ ...valid.rows[0], id: "C:\\private\\source.json" }] },
    { ...valid, rows: [{ ...valid.rows[0], actions: ["EXECUTE_ACTION"] }] },
    { ...valid, rawSourceKey: "never-pass-source-keys" }
  ];
}
