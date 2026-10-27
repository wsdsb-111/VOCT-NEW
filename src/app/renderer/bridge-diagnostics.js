const RUNTIME_VERSION = "9.6.1";
const LOCAL_MOD_BASE_VERSION = "2.0.5";
const OFFICIAL_UPSTREAM_VERSION = "2.0.4";
const POLL_INTERVAL_MS = 15000;
const MAX_PENDING_POLLS = 12;

const STATUSES = new Set(["UNKNOWN", "PENDING", "SUPPORTED", "DEGRADED", "INCOMPATIBLE"]);
const REASONS = new Set([
  "BRIDGE_COMPATIBLE",
  "BRIDGE_NOT_VERIFIED",
  "CAPABILITY_NOT_DECLARED",
  "HELLO_NOT_RECEIVED",
  "HELLO_NOT_VERIFIED",
  "HELLO_TIMEOUT",
  "HELLO_WAITING",
  "HELLO_LOAD_SESSION_MISMATCH",
  "LEGACY_UNVERIFIED",
  "LOAD_SESSION_INVALID",
  "LOG_ATTACHED",
  "LOG_CHANGED_DURING_READ",
  "LOG_IDENTITY_CHANGED",
  "LOG_IDENTITY_UNKNOWN",
  "LOG_LINE_TOO_LONG",
  "LOG_MISSING",
  "LOG_PATH_CHANGED",
  "LOG_PATH_UNAVAILABLE",
  "LOG_READ_FAILED",
  "LOG_REWRITTEN",
  "LOG_ROTATED",
  "LOG_TRUNCATED",
  "CAPABILITY_SUPPORTED",
  "FEATURE_CAPABILITIES_SUPPORTED",
  "REQUIRED_CAPABILITY_REVISION_UNSUPPORTED",
  "REQUIRED_CAPABILITY_MISSING",
  "OPTIONAL_CAPABILITY_MISSING",
  "CAPABILITY_REVISION_UNSUPPORTED",
  "RUNTIME_MANIFEST_UNAVAILABLE",
  "SERVICE_STOPPED",
  "UNKNOWN_OPTIONAL_CAPABILITY_IGNORED",
  "UNKNOWN_REQUIRED_CAPABILITY",
  "UNSUPPORTED_PROTOCOL_OR_SCHEMA",
  "HELLO_TOO_LONG",
  "HELLO_DUPLICATE_MARKER",
  "HELLO_SEPARATOR_INVALID",
  "HELLO_FIELD_INVALID",
  "HELLO_FIELD_DUPLICATE",
  "HELLO_FIELD_ORDER_INVALID",
  "HELLO_FIELD_MISSING",
  "HELLO_UNKNOWN_REQUIRED_FIELD",
  "HELLO_UNKNOWN_FIELD",
  "HELLO_OPTIONAL_FIELD_INVALID",
  "HELLO_SCHEMA_INVALID",
  "HELLO_PROTOCOL_INVALID",
  "HELLO_MOD_VERSION_INVALID",
  "HELLO_UPSTREAM_VERSION_INVALID",
  "HELLO_BRIDGE_REVISION_INVALID",
  "HELLO_LOAD_TOKEN_INVALID",
  "HELLO_CAPABILITIES_INVALID",
  "UNKNOWN_REASON"
]);
const CHANNEL_STATES = new Set(["UNKNOWN", "OBSERVED", "UNAVAILABLE"]);
const CHANNEL_IDS = ["debugLog", "clipboard", "runFileAck", "actionReadback", "letterReceipt"];
const CAPABILITY_IDS = [
  "character_export",
  "trait_export",
  "native_date",
  "load_session",
  "runfile_consumer",
  "run_ack",
  "action_readback",
  "letter_receipt",
  "official_recollection_export"
];
const CAPABILITY_LABELS = {
  character_export: ["人物资料导出", "Character export"],
  trait_export: ["特质导出", "Trait export"],
  native_date: ["CK3 日期", "CK3 date"],
  load_session: ["载入会话边界", "Load session boundary"],
  runfile_consumer: ["RunFile 消费", "RunFile consumer"],
  run_ack: ["RunFile ACK", "RunFile ACK"],
  action_readback: ["动作效果回读", "Action readback"],
  letter_receipt: ["信件回执", "Letter receipt"],
  official_recollection_export: ["官方追忆导出", "Official recollection export"]
};
const FEATURE_LABELS = {
  conversation: ["对话", "Conversation"],
  action: ["动作", "Actions"],
  actions: ["动作", "Actions"],
  actionConfirmation: ["动作确认", "Action confirmation"],
  letter: ["信件", "Letters"],
  letters: ["信件", "Letters"],
  worldline: ["世界线", "Worldline"],
  memory: ["记忆", "Memory"],
  recollection: ["官方追忆", "Official recollection"],
  traits: ["特质", "Traits"],
  officialRecollection: ["官方追忆", "Official recollection"]
};

const COPY = {
  "zh-CN": {
    title: "Bridge 兼容诊断",
    intro: "只读状态与独立业务通道证据。通道观察不代表动作效果已确认或玩家已读取信件。",
    runtime: "Runtime 版本",
    localBase: "VOCT 本地维护 Mod 基线",
    upstreamBase: "官方上游基线",
    detectedBase: "当前会话声明的 Mod 基线",
    detectedUpstream: "当前会话声明的上游基线",
    bridgeRevision: "VOCT Bridge 修订",
    protocol: "Bridge 协议",
    compatibility: "兼容状态",
    reason: "原因",
    nextStep: "下一步",
    sessionTitle: "当前载入会话证据",
    loadSession: "载入边界已出现",
    hello: "Hello 已出现",
    currentHello: "Hello 已绑定当前会话",
    logIdentity: "日志身份可确认",
    capabilityTitle: "Mod 能力声明",
    declaredRevision: "声明修订",
    declaredSupport: "声明支持",
    featureTitle: "功能可用性",
    channelTitle: "独立通道状态",
    lastEvidence: "最近状态证据时间",
    refresh: "刷新状态",
    redetect: "重新检测当前会话",
    copySummary: "复制诊断摘要",
    copied: "诊断摘要已复制。",
    copyUnavailable: "当前无法使用剪贴板。",
    copyFailed: "未能复制诊断摘要。",
    readUnavailable: "Bridge 诊断接口当前不可用。",
    loading: "正在读取当前 Bridge 状态……",
    unknown: "未知／未验证",
    observed: "已观察到",
    unavailable: "不可用",
    yes: "是",
    no: "否",
    notConfirmed: "未确认",
    supported: "协议声明兼容",
    degraded: "部分能力不可用",
    incompatible: "存在不兼容项",
    pending: "等待验证",
    unverifiedLegacy: "旧版／未验证",
    supportTrue: "是",
    supportFalse: "否",
    showGuide: "查看兼容说明",
    hideGuide: "收起兼容说明",
    guideTitle: "兼容与更新说明",
    guideIntro: "Runtime 与 Workshop Mod 是独立工件，请分别核对和更新。",
    guideRuntime: "Runtime：检查应用版本与 Runtime 发布说明。",
    guideMod: "Workshop Mod：检查 VOCT Mod 基线与 Bridge 修订；更新后重新载入游戏并检测。",
    guideLegacy: "旧版 Mod 可能没有 Bridge Hello。此状态标为未验证，只沿用已验证的旧版兼容路径。",
    guideEvidence: "Bridge 兼容不会替代通道证据。ACK、动作效果回读和信件回执分别判断；回执不代表玩家已读。",
    guideNoAutoUpdate: "此处不会自动打开下载页或修改游戏文件。",
    reason_HELLO_NOT_RECEIVED: "当前会话尚未收到 Bridge Hello。",
    reason_LEGACY_UNVERIFIED: "当前 Mod 未声明可验证的 Bridge Hello；旧版路径保持未验证。",
    reason_LOG_IDENTITY_UNKNOWN: "无法确认当前日志身份，Hello 尚不能绑定当前会话。",
    reason_REQUIRED_CAPABILITY_MISSING: "缺少必需能力；仅受影响的功能需要等待或阻止。",
    reason_OPTIONAL_CAPABILITY_MISSING: "缺少可选能力；其他独立功能仍分别判断。",
    reason_CAPABILITY_REVISION_UNSUPPORTED: "能力修订版本不在已验证范围内。",
    reason_UNKNOWN_REASON: "当前状态没有可识别的原因说明。",
    next_wait: "等待游戏载入 VOCT Mod，然后刷新或重新检测。",
    next_legacy: "分别检查应用与 Workshop Mod 更新；重新载入游戏后再次检测。",
    next_boundary: "确认游戏已完成读档，再重新检测当前会话。",
    next_log: "检查 CK3 debug.log 配置与当前游戏载入状态，然后重新检测。",
    next_required: "更新 Workshop Mod 并重新载入游戏；继续遵守受影响功能的现有门禁。",
    next_optional: "查看下方缺失能力；只使用已声明可用的独立功能。",
    next_incompatible: "分别核对 Runtime 与 Workshop Mod 的兼容版本，更新后重新载入游戏。",
    next_compatible: "Bridge 协议声明兼容；仍需分别查看下方各业务通道证据。",
    next_service: "重新打开 Bridge 诊断或重启应用后，再检测当前会话。",
    next_generic: "刷新当前状态；仍不确定时检查应用与游戏的版本。",
    channel_debugLog: "CK3 debug.log",
    channel_clipboard: "剪贴板",
    channel_runFileAck: "RunFile ACK",
    channel_actionReadback: "Action 效果回读",
    channel_letterReceipt: "Letter Receipt",
    note_debugLog: "日志证据状态；不显示日志路径或正文。",
    note_clipboard: "剪贴板通道状态。",
    note_runFileAck: "ACK 只确认对应命令被确认，不确认实际效果。",
    note_actionReadback: "回读证据独立显示，不替代动作状态机的最终确认。",
    note_letterReceipt: "Receipt 证据不表示玩家已阅读信件。",
    evidenceObserved: "存在通道证据",
    evidenceUnknown: "尚无足够证据",
    evidenceUnavailable: "通道不可用",
    featureAllowed: "可用",
    featureBlocked: "受限",
    featureUnknown: "未知",
    missingCapabilities: "缺少能力"
  },
  "en-US": {
    title: "Bridge compatibility diagnostics",
    intro: "Read-only compatibility state and independent channel evidence. An observed channel does not confirm an action effect or that a player read a letter.",
    runtime: "Runtime version",
    localBase: "VOCT maintained local Mod base",
    upstreamBase: "Official upstream base",
    detectedBase: "Mod base declared by this session",
    detectedUpstream: "Upstream base declared by this session",
    bridgeRevision: "VOCT Bridge revision",
    protocol: "Bridge protocol",
    compatibility: "Compatibility status",
    reason: "Reason",
    nextStep: "Next step",
    sessionTitle: "Current load-session evidence",
    loadSession: "Load boundary seen",
    hello: "Hello seen",
    currentHello: "Hello bound to current session",
    logIdentity: "Log identity known",
    capabilityTitle: "Mod capability declarations",
    declaredRevision: "Declared revision",
    declaredSupport: "Declared support",
    featureTitle: "Feature availability",
    channelTitle: "Independent channel status",
    lastEvidence: "Latest state evidence time",
    refresh: "Refresh status",
    redetect: "Re-detect current session",
    copySummary: "Copy diagnostic summary",
    copied: "Diagnostic summary copied.",
    copyUnavailable: "Clipboard is unavailable.",
    copyFailed: "Could not copy the diagnostic summary.",
    readUnavailable: "Bridge diagnostics are currently unavailable.",
    loading: "Reading the current Bridge status…",
    unknown: "Unknown / unverified",
    observed: "Observed",
    unavailable: "Unavailable",
    yes: "Yes",
    no: "No",
    notConfirmed: "Not confirmed",
    supported: "Protocol declaration compatible",
    degraded: "Some capabilities unavailable",
    incompatible: "Incompatibility found",
    pending: "Waiting for verification",
    unverifiedLegacy: "Legacy / unverified",
    supportTrue: "Yes",
    supportFalse: "No",
    showGuide: "View compatibility guide",
    hideGuide: "Hide compatibility guide",
    guideTitle: "Compatibility and update guide",
    guideIntro: "The Runtime and Workshop Mod are separate artifacts. Check and update them independently.",
    guideRuntime: "Runtime: check the app version and Runtime release notes.",
    guideMod: "Workshop Mod: check the VOCT Mod base and Bridge revision; reload the game after updating, then re-detect.",
    guideLegacy: "Older Mods may not emit a Bridge Hello. This state remains unverified and uses only tested legacy compatibility paths.",
    guideEvidence: "Bridge compatibility does not replace channel evidence. ACK, action readback, and letter receipt are assessed separately; a receipt does not mean the player read the letter.",
    guideNoAutoUpdate: "This panel does not open download pages or modify game files automatically.",
    reason_HELLO_NOT_RECEIVED: "No Bridge Hello has been received for the current session.",
    reason_LEGACY_UNVERIFIED: "The current Mod has no verifiable Bridge Hello; the legacy path remains unverified.",
    reason_LOG_IDENTITY_UNKNOWN: "The current log identity is unknown, so Hello cannot be bound to this session yet.",
    reason_REQUIRED_CAPABILITY_MISSING: "A required capability is missing; only affected features need to wait or be blocked.",
    reason_OPTIONAL_CAPABILITY_MISSING: "An optional capability is missing; independent features are assessed separately.",
    reason_CAPABILITY_REVISION_UNSUPPORTED: "A capability revision is outside the verified range.",
    reason_UNKNOWN_REASON: "No recognized reason is available for this state.",
    next_wait: "Wait for the game to load the VOCT Mod, then refresh or re-detect.",
    next_legacy: "Check Runtime and Workshop Mod updates independently; reload the game and re-detect.",
    next_boundary: "Confirm the game has finished loading the save, then re-detect this session.",
    next_log: "Check the CK3 debug.log configuration and current load state, then re-detect.",
    next_required: "Update the Workshop Mod and reload the game; keep existing gates for affected features.",
    next_optional: "Review missing capabilities below; use only independently declared available features.",
    next_incompatible: "Check Runtime and Workshop Mod compatibility independently, update, then reload the game.",
    next_compatible: "The Bridge protocol declaration is compatible; review each business channel below separately.",
    next_service: "Reopen Bridge diagnostics or restart the app, then check the current session again.",
    next_generic: "Refresh the current state; if it remains unclear, check the app and game versions.",
    channel_debugLog: "CK3 debug.log",
    channel_clipboard: "Clipboard",
    channel_runFileAck: "RunFile ACK",
    channel_actionReadback: "Action readback",
    channel_letterReceipt: "Letter Receipt",
    note_debugLog: "Log evidence state; no log path or contents are shown.",
    note_clipboard: "Clipboard channel state.",
    note_runFileAck: "An ACK confirms the corresponding command was acknowledged, not its effect.",
    note_actionReadback: "Readback evidence is shown separately and does not replace the action state machine's final confirmation.",
    note_letterReceipt: "Receipt evidence does not mean the player read the letter.",
    evidenceObserved: "Channel evidence is present",
    evidenceUnknown: "There is not enough evidence yet",
    evidenceUnavailable: "Channel unavailable",
    featureAllowed: "Available",
    featureBlocked: "Restricted",
    featureUnknown: "Unknown",
    missingCapabilities: "Missing capabilities"
  }
};

const ADDITIONAL_REASON_COPY = {
  BRIDGE_COMPATIBLE: ["Bridge 声明兼容；各业务通道仍分别判断。", "The Bridge declaration is compatible; business channels are assessed separately."],
  BRIDGE_NOT_VERIFIED: ["Bridge 尚未验证。", "The Bridge has not been verified."],
  CAPABILITY_NOT_DECLARED: ["Mod 未声明此能力。", "The Mod did not declare this capability."],
  CAPABILITY_SUPPORTED: ["此能力修订处于 Runtime 支持范围内。", "This capability revision is within the Runtime's supported range."],
  FEATURE_CAPABILITIES_SUPPORTED: ["此功能所需能力均已声明支持。", "All capabilities required by this feature are declared supported."],
  HELLO_NOT_VERIFIED: ["当前会话的 Hello 尚未验证。", "The Hello for this session has not been verified."],
  HELLO_TIMEOUT: ["等待 Hello 超时；当前会话仍未验证。", "The Hello wait timed out; this session remains unverified."],
  HELLO_WAITING: ["等待当前游戏载入会话发出 Hello。", "Waiting for a Hello from the current game load session."],
  HELLO_LOAD_SESSION_MISMATCH: ["Hello 的载入标记与当前会话不匹配。", "The Hello load marker does not match the current session."],
  LOAD_SESSION_INVALID: ["未能确认有效的游戏载入边界。", "A valid game load boundary could not be confirmed."],
  LOG_ATTACHED: ["已连接当前日志，等待新的载入边界和 Hello。", "The current log is attached; waiting for a new load boundary and Hello."],
  LOG_CHANGED_DURING_READ: ["读取期间日志发生变化，旧会话证据已失效。", "The log changed during reading, so previous session evidence is invalid."],
  LOG_IDENTITY_CHANGED: ["日志身份已变化，旧会话证据已失效。", "The log identity changed, so previous session evidence is invalid."],
  LOG_LINE_TOO_LONG: ["发现过长日志行；该行未用于 Bridge 验证。", "An oversized log line was ignored for Bridge verification."],
  LOG_MISSING: ["未找到当前 CK3 日志。", "The current CK3 log was not found."],
  LOG_PATH_CHANGED: ["日志路径已变化，正在等待新会话证据。", "The log path changed; waiting for evidence from the new session."],
  LOG_PATH_UNAVAILABLE: ["当前无法读取 CK3 日志路径。", "The CK3 log path is currently unavailable."],
  LOG_READ_FAILED: ["当前无法读取 CK3 日志。", "The CK3 log could not be read."],
  LOG_REWRITTEN: ["日志内容被重写，旧会话证据已失效。", "The log was rewritten, so previous session evidence is invalid."],
  LOG_ROTATED: ["日志已轮转，旧会话证据已失效。", "The log rotated, so previous session evidence is invalid."],
  LOG_TRUNCATED: ["日志被截断，旧会话证据已失效。", "The log was truncated, so previous session evidence is invalid."],
  REQUIRED_CAPABILITY_REVISION_UNSUPPORTED: ["必需能力的修订版本不受支持。", "A required capability revision is unsupported."],
  RUNTIME_MANIFEST_UNAVAILABLE: ["Runtime Bridge Manifest 当前不可用。", "The Runtime Bridge manifest is currently unavailable."],
  SERVICE_STOPPED: ["Bridge 诊断服务已停止。", "The Bridge diagnostics service is stopped."],
  UNKNOWN_OPTIONAL_CAPABILITY_IGNORED: ["忽略了未知可选能力；这不会声明额外功能可用。", "An unknown optional capability was ignored; this does not enable extra features."],
  UNKNOWN_REQUIRED_CAPABILITY: ["Mod 声明了 Runtime 不认识的必需能力。", "The Mod declared a required capability the Runtime does not recognize."],
  UNSUPPORTED_PROTOCOL_OR_SCHEMA: ["Bridge 协议或 Hello schema 不受支持。", "The Bridge protocol or Hello schema is unsupported."],
  HELLO_TOO_LONG: ["Bridge Hello 超出允许长度。", "The Bridge Hello exceeded the allowed length."],
  HELLO_DUPLICATE_MARKER: ["Bridge Hello 标记重复。", "The Bridge Hello marker is duplicated."],
  HELLO_SEPARATOR_INVALID: ["Bridge Hello 分隔格式无效。", "The Bridge Hello separator format is invalid."],
  HELLO_FIELD_INVALID: ["Bridge Hello 字段格式无效。", "A Bridge Hello field has an invalid format."],
  HELLO_FIELD_DUPLICATE: ["Bridge Hello 字段重复。", "A Bridge Hello field is duplicated."],
  HELLO_FIELD_ORDER_INVALID: ["Bridge Hello 必需字段顺序无效。", "The Bridge Hello required fields are out of order."],
  HELLO_FIELD_MISSING: ["Bridge Hello 缺少必需字段。", "A required Bridge Hello field is missing."],
  HELLO_UNKNOWN_REQUIRED_FIELD: ["Bridge Hello 含有未知必需字段。", "The Bridge Hello contains an unknown required field."],
  HELLO_UNKNOWN_FIELD: ["Bridge Hello 含有未允许的未知字段。", "The Bridge Hello contains an unrecognized field."],
  HELLO_OPTIONAL_FIELD_INVALID: ["Bridge Hello 可选扩展字段无效。", "A Bridge Hello optional extension field is invalid."],
  HELLO_SCHEMA_INVALID: ["Bridge Hello schema 版本无效。", "The Bridge Hello schema version is invalid."],
  HELLO_PROTOCOL_INVALID: ["Bridge Hello 协议版本无效。", "The Bridge Hello protocol version is invalid."],
  HELLO_MOD_VERSION_INVALID: ["Bridge Hello Mod 基线版本无效。", "The Bridge Hello Mod base version is invalid."],
  HELLO_UPSTREAM_VERSION_INVALID: ["Bridge Hello 上游版本无效。", "The Bridge Hello upstream version is invalid."],
  HELLO_BRIDGE_REVISION_INVALID: ["Bridge Hello 修订值无效。", "The Bridge Hello revision is invalid."],
  HELLO_LOAD_TOKEN_INVALID: ["Bridge Hello 载入标记无效。", "The Bridge Hello load token is invalid."],
  HELLO_CAPABILITIES_INVALID: ["Bridge Hello 能力清单无效。", "The Bridge Hello capability list is invalid."]
};

for (const [code, [chinese, english]] of Object.entries(ADDITIONAL_REASON_COPY)) {
  COPY["zh-CN"][`reason_${code}`] = chinese;
  COPY["en-US"][`reason_${code}`] = english;
}

function safeVersion(value) {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9.+_-]{0,31}$/.test(value) ? value : null;
}

function safeRevision(value) {
  if (Number.isSafeInteger(value) && value >= 0) return String(value);
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value) ? value : null;
}

function safeProtocol(value) {
  if (value && typeof value === "object") {
    const { major, minor } = value;
    return Number.isSafeInteger(major) && major >= 0 && Number.isSafeInteger(minor) && minor >= 0
      ? `${major}.${minor}`
      : null;
  }
  return typeof value === "string" && /^\d{1,3}\.\d{1,3}$/.test(value) ? value : null;
}

function safeEvidenceBoolean(value) {
  return typeof value === "boolean" ? value : null;
}

function safeTimestamp(value) {
  if (typeof value !== "string" || value.length > 40 || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function safeReason(value) {
  return REASONS.has(value) ? value : "UNKNOWN_REASON";
}

export function normalizeBridgeSnapshot(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const capabilitiesSource = source.capabilities && typeof source.capabilities === "object" ? source.capabilities : {};
  const featuresSource = source.features && typeof source.features === "object" ? source.features : {};
  const session = source.sessionEvidence && typeof source.sessionEvidence === "object" ? source.sessionEvidence : {};
  const channelsSource = source.channels && typeof source.channels === "object" ? source.channels : {};
  const capabilities = {};
  const features = {};
  const channels = {};

  for (const id of CAPABILITY_IDS) {
    const item = capabilitiesSource[id];
    capabilities[id] = {
      revision: safeRevision(item?.revision),
      supported: safeEvidenceBoolean(item?.supported)
    };
  }
  for (const id of Object.keys(FEATURE_LABELS)) {
    const item = featuresSource[id];
    if (!item || typeof item !== "object") continue;
    features[id] = {
      allowed: safeEvidenceBoolean(item.allowed),
      reasonCode: item.reasonCode == null ? null : safeReason(item.reasonCode),
      missing: Array.isArray(item.missing) ? item.missing.filter(capability => CAPABILITY_IDS.includes(capability)) : []
    };
  }
  for (const id of CHANNEL_IDS) channels[id] = CHANNEL_STATES.has(channelsSource[id]) ? channelsSource[id] : "UNKNOWN";

  return {
    status: STATUSES.has(source.status) ? source.status : "UNKNOWN",
    reasonCode: safeReason(source.reasonCode),
    modBaseVersion: safeVersion(source.modBaseVersion),
    upstreamBaseVersion: safeVersion(source.upstreamBaseVersion),
    voctBridgeRevision: safeRevision(source.voctBridgeRevision),
    bridgeProtocol: safeProtocol(source.bridgeProtocol),
    capabilities,
    features,
    sessionEvidence: {
      loadSessionSeen: safeEvidenceBoolean(session.loadSessionSeen),
      helloSeen: safeEvidenceBoolean(session.helloSeen),
      helloBoundToCurrentSession: safeEvidenceBoolean(session.helloBoundToCurrentSession),
      logIdentityKnown: safeEvidenceBoolean(session.logIdentityKnown)
    },
    channels,
    updatedAt: safeTimestamp(source.updatedAt)
  };
}

function evidenceValue(value) {
  return value === true ? "true" : value === false ? "false" : "unknown";
}

export function buildDiagnosticSummary(value, uiLanguage = "en-US") {
  const snapshot = normalizeBridgeSnapshot(value);
  const chinese = uiLanguage === "zh-CN";
  const lines = chinese ? [
    "VOCT Bridge 诊断摘要",
    `Runtime：V${RUNTIME_VERSION}`,
    `VOCT 本地维护 Mod 基线：${LOCAL_MOD_BASE_VERSION}`,
    `官方上游基线：${OFFICIAL_UPSTREAM_VERSION}`,
    `当前会话声明的 Mod 基线：${snapshot.modBaseVersion || "未知"}`,
    `当前会话声明的上游基线：${snapshot.upstreamBaseVersion || "未知"}`,
    `VOCT Bridge 修订：${snapshot.voctBridgeRevision || "未知"}`,
    `Bridge 协议：${snapshot.bridgeProtocol || "未知"}`,
    `兼容状态：${snapshot.reasonCode === "LEGACY_UNVERIFIED" ? "LEGACY_UNVERIFIED" : snapshot.status}`,
    `原因代码：${snapshot.reasonCode}`,
    `载入边界：${evidenceValue(snapshot.sessionEvidence.loadSessionSeen)}`,
    `Hello：${evidenceValue(snapshot.sessionEvidence.helloSeen)}`,
    `Hello 已绑定当前会话：${evidenceValue(snapshot.sessionEvidence.helloBoundToCurrentSession)}`,
    `日志身份：${evidenceValue(snapshot.sessionEvidence.logIdentityKnown)}`
  ] : [
    "VOCT Bridge diagnostic summary",
    `Runtime: V${RUNTIME_VERSION}`,
    `VOCT maintained local Mod base: ${LOCAL_MOD_BASE_VERSION}`,
    `Official upstream base: ${OFFICIAL_UPSTREAM_VERSION}`,
    `Mod base declared by session: ${snapshot.modBaseVersion || "unknown"}`,
    `Upstream base declared by session: ${snapshot.upstreamBaseVersion || "unknown"}`,
    `VOCT Bridge revision: ${snapshot.voctBridgeRevision || "unknown"}`,
    `Bridge protocol: ${snapshot.bridgeProtocol || "unknown"}`,
    `Compatibility: ${snapshot.reasonCode === "LEGACY_UNVERIFIED" ? "LEGACY_UNVERIFIED" : snapshot.status}`,
    `Reason code: ${snapshot.reasonCode}`,
    `Load boundary: ${evidenceValue(snapshot.sessionEvidence.loadSessionSeen)}`,
    `Hello: ${evidenceValue(snapshot.sessionEvidence.helloSeen)}`,
    `Hello bound to current session: ${evidenceValue(snapshot.sessionEvidence.helloBoundToCurrentSession)}`,
    `Log identity: ${evidenceValue(snapshot.sessionEvidence.logIdentityKnown)}`
  ];

  for (const id of CAPABILITY_IDS) {
    const item = snapshot.capabilities[id];
    lines.push(`${chinese ? "能力" : "Capability"} ${id}: ${chinese ? "修订" : "revision"}=${item.revision || "unknown"}; ${chinese ? "支持" : "supported"}=${evidenceValue(item.supported)}`);
  }
  for (const id of CHANNEL_IDS) lines.push(`${chinese ? "通道" : "Channel"} ${id}: ${snapshot.channels[id]}`);
  lines.push(`${chinese ? "最近状态时间" : "Latest state time"}: ${snapshot.updatedAt || "unknown"}`);
  return lines.join("\n");
}

function statusKey(snapshot) {
  if (snapshot.reasonCode === "LEGACY_UNVERIFIED") return "unverifiedLegacy";
  if (snapshot.status === "SUPPORTED") return "supported";
  if (snapshot.status === "DEGRADED") return "degraded";
  if (snapshot.status === "INCOMPATIBLE") return "incompatible";
  if (snapshot.status === "PENDING") return "pending";
  return "unknown";
}

function reasonKey(code) {
  return `reason_${REASONS.has(code) ? code : "UNKNOWN_REASON"}`;
}

function nextStepKey(snapshot) {
  switch (snapshot.reasonCode) {
    case "LEGACY_UNVERIFIED": return "next_legacy";
    case "HELLO_NOT_RECEIVED":
    case "HELLO_WAITING":
    case "HELLO_TIMEOUT": return "next_wait";
    case "LOAD_SESSION_INVALID":
    case "HELLO_LOAD_SESSION_MISMATCH":
    case "LOG_CHANGED_DURING_READ":
    case "LOG_IDENTITY_CHANGED":
    case "LOG_PATH_CHANGED":
    case "LOG_REWRITTEN":
    case "LOG_ROTATED":
    case "LOG_TRUNCATED": return "next_boundary";
    case "LOG_ATTACHED":
    case "LOG_IDENTITY_UNKNOWN":
    case "LOG_LINE_TOO_LONG":
    case "LOG_MISSING":
    case "LOG_PATH_UNAVAILABLE":
    case "LOG_READ_FAILED":
    case "HELLO_NOT_VERIFIED":
    case "BRIDGE_NOT_VERIFIED": return "next_log";
    case "REQUIRED_CAPABILITY_MISSING":
    case "REQUIRED_CAPABILITY_REVISION_UNSUPPORTED":
    case "UNKNOWN_REQUIRED_CAPABILITY": return "next_required";
    case "OPTIONAL_CAPABILITY_MISSING":
    case "CAPABILITY_NOT_DECLARED":
    case "CAPABILITY_REVISION_UNSUPPORTED": return "next_optional";
    case "UNSUPPORTED_PROTOCOL_OR_SCHEMA":
    case "RUNTIME_MANIFEST_UNAVAILABLE": return "next_incompatible";
    case "SERVICE_STOPPED": return "next_service";
    case "BRIDGE_COMPATIBLE":
    case "CAPABILITY_SUPPORTED":
    case "FEATURE_CAPABILITIES_SUPPORTED":
    case "UNKNOWN_OPTIONAL_CAPABILITY_IGNORED": return "next_compatible";
    default:
      if (snapshot.status === "INCOMPATIBLE") return "next_incompatible";
      if (snapshot.status === "SUPPORTED") return "next_compatible";
      return "next_generic";
  }
}

export const BRIDGE_DIAGNOSTIC_REASON_CODES = Object.freeze([...REASONS]);

export function bridgeReasonText(reasonCode, uiLanguage = "en-US") {
  const language = uiLanguage === "zh-CN" ? "zh-CN" : "en-US";
  return COPY[language][reasonKey(safeReason(reasonCode))];
}

function helloBinding(session) {
  return safeEvidenceBoolean(session.helloBoundToCurrentSession);
}

function channelLabelKey(value) {
  return value === "OBSERVED" ? "observed" : value === "UNAVAILABLE" ? "unavailable" : "unknown";
}

function formatTimestamp(value, language) {
  if (!value) return "—";
  try {
    return new Intl.DateTimeFormat(language, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
  } catch {
    return value;
  }
}

export function createBridgeDiagnostics({ React, jsxRuntime } = {}) {
  if (!React || typeof React.useState !== "function" || typeof React.useRef !== "function" || typeof React.useEffect !== "function") {
    throw new TypeError("Bridge diagnostics requires React state, ref, and effect hooks.");
  }
  if (!jsxRuntime || typeof jsxRuntime.jsx !== "function") throw new TypeError("Bridge diagnostics requires a JSX runtime.");

  const jsx = jsxRuntime.jsx;
  const jsxs = typeof jsxRuntime.jsxs === "function" ? jsxRuntime.jsxs : jsx;
  const h = (type, props, ...children) => {
    const list = children.flat(Infinity).filter(child => child !== null && child !== undefined && child !== false);
    const create = list.length > 1 ? jsxs : jsx;
    return create(type, { ...(props || {}), children: list.length > 1 ? list : list[0] });
  };

  return function BridgeDiagnostics({ uiLanguage = "en-US" } = {}) {
    const language = uiLanguage === "zh-CN" ? "zh-CN" : "en-US";
    const text = key => COPY[language][key] || COPY["en-US"][key] || "—";
    const api = typeof window !== "undefined" ? window.bridgeAPI : undefined;
    const apiRef = React.useRef(api);
    apiRef.current = api;
    const mounted = React.useRef(false);
    const sequence = React.useRef(0);
    const inFlight = React.useRef(null);
    const queuedRead = React.useRef(null);
    const pollCount = React.useRef(0);
    const [snapshotRecord, setSnapshotRecord] = React.useState(null);
    const [busy, setBusy] = React.useState(false);
    const [error, setError] = React.useState("");
    const [message, setMessage] = React.useState("");
    const [guideOpen, setGuideOpen] = React.useState(false);
    const snapshot = snapshotRecord && snapshotRecord.api === api ? snapshotRecord.value : null;

    const startRead = request => {
      const method = request.api?.[request.method];
      if (typeof method !== "function") {
        if (mounted.current && request.sequence === sequence.current && request.api === apiRef.current) {
          setSnapshotRecord(null);
          setError("readUnavailable");
          setBusy(false);
        }
        return Promise.resolve(null);
      }

      const flight = { sequence: request.sequence, promise: null };
      inFlight.current = flight;
      const operation = (async () => {
        try {
          const result = await method.call(request.api);
          if (mounted.current && request.sequence === sequence.current && request.api === apiRef.current) {
            setSnapshotRecord({ api: request.api, value: normalizeBridgeSnapshot(result) });
            setError("");
          }
        } catch {
          if (mounted.current && request.sequence === sequence.current && request.api === apiRef.current) {
            setSnapshotRecord(null);
            setError("readUnavailable");
          }
        } finally {
          if (inFlight.current === flight) {
            inFlight.current = null;
            const queued = queuedRead.current;
            queuedRead.current = null;
            if (queued && mounted.current && queued.sequence === sequence.current && queued.api === apiRef.current) {
              startRead(queued);
            } else if (mounted.current && request.sequence === sequence.current) {
              setBusy(false);
            }
          }
        }
        return null;
      })();
      flight.promise = operation;
      return operation;
    };

    const requestRead = (method, resetPolls = false) => {
      if (!mounted.current) return Promise.resolve(null);
      if (resetPolls) pollCount.current = 0;
      const request = { api: apiRef.current, method, sequence: ++sequence.current };
      setSnapshotRecord(null);
      setError("");
      setMessage("");
      setBusy(true);
      if (inFlight.current) {
        queuedRead.current = request;
        return inFlight.current.promise;
      }
      return startRead(request);
    };

    React.useEffect(() => {
      mounted.current = true;
      pollCount.current = 0;
      void requestRead("getState");
      return () => {
        mounted.current = false;
        sequence.current++;
        queuedRead.current = null;
      };
    }, [api]);

    React.useEffect(() => {
      const shouldPoll = !busy && snapshot
        && snapshot.reasonCode !== "LEGACY_UNVERIFIED"
        && pollCount.current < MAX_PENDING_POLLS;
      if (!shouldPoll) return undefined;
      const timer = setTimeout(() => {
        if (!mounted.current || pollCount.current >= MAX_PENDING_POLLS) return;
        pollCount.current++;
        void requestRead("getState");
      }, POLL_INTERVAL_MS);
      return () => clearTimeout(timer);
    }, [api, busy, snapshot]);

    const summarySnapshot = snapshot;
    const copySummary = async () => {
      const clipboard = typeof window !== "undefined" ? window.navigator?.clipboard : null;
      if (typeof clipboard?.writeText !== "function") {
        setMessage("copyUnavailable");
        return;
      }
      try {
        await clipboard.writeText(buildDiagnosticSummary(summarySnapshot, language));
        if (mounted.current) setMessage("copied");
      } catch {
        if (mounted.current) setMessage("copyFailed");
      }
    };

    const showStatus = snapshot || normalizeBridgeSnapshot(null);
    const statusClass = showStatus.reasonCode === "LEGACY_UNVERIFIED"
      ? "unverified"
      : showStatus.status === "SUPPORTED" ? "compatible"
        : showStatus.status === "INCOMPATIBLE" ? "incompatible"
          : showStatus.status === "DEGRADED" ? "degraded" : "unknown";
    const evidence = showStatus.sessionEvidence;
    const boolLabel = value => text(value === true ? "yes" : value === false ? "no" : "notConfirmed");
    const channelNotes = {
      debugLog: "note_debugLog",
      clipboard: "note_clipboard",
      runFileAck: "note_runFileAck",
      actionReadback: "note_actionReadback",
      letterReceipt: "note_letterReceipt"
    };
    const renderChannel = id => h("li", { key: id, className: `bridge-diagnostics__channel bridge-diagnostics__channel--${showStatus.channels[id].toLowerCase()}` },
      h("div", { className: "bridge-diagnostics__channel-heading" },
        h("strong", null, text(`channel_${id}`)),
        h("span", { className: "bridge-diagnostics__evidence" }, text(channelLabelKey(showStatus.channels[id])))),
      h("p", null, text(channelNotes[id])));

    const capRows = CAPABILITY_IDS.map(id => {
      const item = showStatus.capabilities[id];
      const support = item.supported === true ? text("supportTrue") : item.supported === false ? text("supportFalse") : text("notConfirmed");
      return h("li", { key: id, className: "bridge-diagnostics__capability" },
        h("strong", null, text(language === "zh-CN" ? CAPABILITY_LABELS[id][0] : CAPABILITY_LABELS[id][1])),
        h("span", null, `${text("declaredRevision")}: ${item.revision || "—"}`),
        h("span", null, `${text("declaredSupport")}: ${support}`));
    });

    const featureRows = Object.entries(showStatus.features).map(([id, item]) => {
      const label = language === "zh-CN" ? FEATURE_LABELS[id][0] : FEATURE_LABELS[id][1];
      const featureState = item.allowed === true ? text("featureAllowed") : item.allowed === false ? text("featureBlocked") : text("featureUnknown");
      const missing = item.missing.length ? h("span", { className: "bridge-diagnostics__missing" }, `${text("missingCapabilities")}: ${item.missing.join(", ")}`) : null;
      const reason = item.reasonCode ? h("small", null, text(reasonKey(item.reasonCode))) : null;
      return h("li", { key: id, className: "bridge-diagnostics__feature" }, h("strong", null, label), h("span", null, featureState), reason, missing);
    });

    const detectedModBase = showStatus.modBaseVersion || text("unknown");
    const detectedUpstream = showStatus.upstreamBaseVersion || text("unknown");
    const protocol = showStatus.bridgeProtocol || "—";
    const timestamp = formatTimestamp(showStatus.updatedAt, language);
    const redetectDisabled = busy || typeof apiRef.current?.redetect !== "function";
    const refreshDisabled = busy || typeof apiRef.current?.getState !== "function";

    return h("section", { className: "bridge-diagnostics", role: "region", "aria-label": text("title") },
      h("header", { className: "bridge-diagnostics__header" },
        h("div", null, h("h4", null, text("title")), h("p", { className: "bridge-diagnostics__intro" }, text("intro"))),
        h("span", { className: `bridge-diagnostics__status bridge-diagnostics__status--${statusClass}`, role: "status" }, text(statusKey(showStatus)))),
      h("div", { className: "bridge-diagnostics__versions" },
        h("div", null, h("span", null, text("runtime")), h("strong", null, `V${RUNTIME_VERSION}`)),
        h("div", null, h("span", null, text("localBase")), h("strong", null, LOCAL_MOD_BASE_VERSION)),
        h("div", null, h("span", null, text("upstreamBase")), h("strong", null, OFFICIAL_UPSTREAM_VERSION)),
        h("div", null, h("span", null, text("detectedBase")), h("strong", null, detectedModBase)),
        h("div", null, h("span", null, text("bridgeRevision")), h("strong", null, showStatus.voctBridgeRevision || "—")),
        h("div", null, h("span", null, text("protocol")), h("strong", null, protocol)),
        h("div", null, h("span", null, text("detectedUpstream")), h("strong", null, detectedUpstream))),
      h("div", { className: "bridge-diagnostics__reason" },
        h("strong", null, text("reason")),
        h("p", null, text(reasonKey(showStatus.reasonCode)))),
      h("div", { className: "bridge-diagnostics__next-step" },
        h("strong", null, text("nextStep")),
        h("p", null, text(nextStepKey(showStatus)))),
      h("section", { className: "bridge-diagnostics__section", "aria-label": text("sessionTitle") },
        h("h5", null, text("sessionTitle")),
        h("dl", { className: "bridge-diagnostics__evidence-grid" },
          h("div", null, h("dt", null, text("loadSession")), h("dd", null, boolLabel(evidence.loadSessionSeen))),
          h("div", null, h("dt", null, text("hello")), h("dd", null, boolLabel(evidence.helloSeen))),
          h("div", null, h("dt", null, text("logIdentity")), h("dd", null, boolLabel(evidence.logIdentityKnown))),
          h("div", null, h("dt", null, text("currentHello")), h("dd", null, boolLabel(helloBinding(evidence)))))),
      h("section", { className: "bridge-diagnostics__section", "aria-label": text("capabilityTitle") },
        h("h5", null, text("capabilityTitle")), h("ul", { className: "bridge-diagnostics__capabilities" }, capRows)),
      featureRows.length ? h("section", { className: "bridge-diagnostics__section", "aria-label": text("featureTitle") },
        h("h5", null, text("featureTitle")), h("ul", { className: "bridge-diagnostics__features" }, featureRows)) : null,
      h("section", { className: "bridge-diagnostics__section", "aria-label": text("channelTitle") },
        h("h5", null, text("channelTitle")), h("ul", { className: "bridge-diagnostics__channels" }, CHANNEL_IDS.map(renderChannel))),
      h("p", { className: "bridge-diagnostics__timestamp" }, `${text("lastEvidence")}: ${timestamp}`),
      busy ? h("p", { className: "bridge-diagnostics__feedback", role: "status" }, text("loading")) : null,
      error ? h("p", { className: "bridge-diagnostics__feedback bridge-diagnostics__feedback--error", role: "alert" }, text(error)) : null,
      message ? h("p", { className: "bridge-diagnostics__feedback", role: "status" }, text(message)) : null,
      h("div", { className: "bridge-diagnostics__actions" },
        h("button", { type: "button", disabled: refreshDisabled, onClick: () => requestRead("getState", true) }, text("refresh")),
        h("button", { type: "button", disabled: redetectDisabled, onClick: () => requestRead("redetect", true) }, text("redetect")),
        h("button", { type: "button", onClick: copySummary }, text("copySummary")),
        h("button", { type: "button", "aria-expanded": guideOpen, onClick: () => setGuideOpen(value => !value) }, text(guideOpen ? "hideGuide" : "showGuide"))),
      guideOpen ? h("section", { className: "bridge-diagnostics__guide", "aria-label": text("guideTitle") },
        h("h5", null, text("guideTitle")),
        h("p", null, text("guideIntro")),
        h("p", null, text("guideRuntime")),
        h("p", null, text("guideMod")),
        h("p", null, text("guideLegacy")),
        h("p", null, text("guideEvidence")),
        h("p", null, text("guideNoAutoUpdate"))) : null);
  };
}

export const BRIDGE_DIAGNOSTICS_POLL_INTERVAL_MS = POLL_INTERVAL_MS;
export const BRIDGE_DIAGNOSTICS_MAX_PENDING_POLLS = MAX_PENDING_POLLS;

export default createBridgeDiagnostics;
