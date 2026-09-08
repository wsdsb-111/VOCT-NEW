const TYPES = {
  PLAYER_CANON: "普通剧情事实",
  RP_POLITICAL_DECISION: "政治决定",
  SECRET_AGREEMENT: "秘密约定",
  NARRATIVE_EVENT: "剧情事件",
  WORLD_ANNOTATION: "长期世界规则",
  PLANNED_DECISION: "未来计划",
  MANUAL_CORRECTION: "开发者纠正（兼容旧记录）"
};
const TYPE_HELP = {
  PLAYER_CANON: "已经发生、但 CK3 没有记录的剧情事实。",
  RP_POLITICAL_DECISION: "玩家确认过的政治安排或决定。",
  SECRET_AGREEMENT: "只有授权人物可以知道的约定。",
  NARRATIVE_EVENT: "一件需要长期保留的剧情事件。",
  WORLD_ANNOTATION: "长期有效的世界规则，不代表某个角色的当前状态。",
  PLANNED_DECISION: "已经计划但尚未发生的事情。",
  MANUAL_CORRECTION: "旧版本或开发者维护记录。"
};
const VISIBILITY = {
  PUBLIC_WORLD: "所有人都知道",
  REALM_PUBLIC: "同一领地的人知道",
  COURT_PUBLIC: "同一宫廷的人知道",
  PERSONAL: "指定人物知道",
  SECRET: "秘密"
};
const VISIBILITY_HELP = {
  PUBLIC_WORLD: "任何 NPC 都可以在问题相关时知道。",
  REALM_PUBLIC: "只对与范围人物同一领地的 NPC 开放。",
  COURT_PUBLIC: "只对与范围人物同一宫廷的 NPC 开放。",
  PERSONAL: "只对“知情人物”列表中的 NPC 开放。",
  SECRET: "按知情人物列表严格授权，不会因相关问题泄露。"
};
const IMPORTANCE = { LOW: "低", NORMAL: "普通", HIGH: "重要", CRITICAL: "关键" };
const STATUS = { ACTIVE: "生效", HIDDEN: "已隐藏", RETIRED: "已恢复自动来源", SUPERSEDED: "已被替代", CONFLICTED: "冲突", TEMPORAL_BLOCKED: "时间未满足" };
const TEMPORAL_MODES = { CURRENT_DATE: "当前游戏日期", SPECIFIC_DATE: "指定日期", TIMELESS: "长期规则（无日期）", PLANNED: "未来计划" };
const RECALL_REASONS = {
  RECALL_DISABLED: "当前对话召回尚未开启",
  QUERY_NOT_RELEVANT: "问题与这条记忆没有明显关联",
  NPC_NOT_AUTHORIZED: "这个 NPC 没有权限知道",
  TEMPORAL_BLOCKED: "这条记忆在当前时间尚未生效或已失效",
  CURRENT_TRUTH_CONFLICT: "这条记忆与 CK3 当前事实冲突",
  RECORD_NOT_ACTIVE: "这条记忆当前未生效",
  NOT_SELECTED: "候选已找到，但未进入本次召回",
  RELEVANT_ENTITY_MATCH: "问题涉及这条记忆中的人物",
  RELEVANT_TEXT_MATCH: "问题与这条记忆的文字相关"
};
const CURRENT_CLAIM_FIELDS = {
  location: "所在地",
  alive: "是否在世",
  faith: "信仰",
  culture: "文化",
  liege: "直属领主",
  courtEmployer: "所在宫廷"
};
const TEMPLATES = [
  { name: "某人答应过一件事", values: { title: "一项约定", content: "谁在什么场合答应了什么事情。", type: "PLAYER_CANON", visibility: "PUBLIC_WORLD", importance: "NORMAL", temporalMode: "CURRENT_DATE" } },
  { name: "两个人达成秘密约定", values: { title: "秘密约定", content: "两人私下约定了什么，以及约定何时成立。", type: "SECRET_AGREEMENT", visibility: "SECRET", importance: "HIGH", temporalMode: "TIMELESS" } },
  { name: "世界发生了一件 CK3 没记录的事件", values: { title: "未记录的剧情事件", content: "发生了什么、涉及谁，以及事件带来的长期影响。", type: "NARRATIVE_EVENT", visibility: "PUBLIC_WORLD", importance: "NORMAL", temporalMode: "CURRENT_DATE" } },
  { name: "长期世界规则", values: { title: "长期世界规则", content: "希望世界长期遵守的规则或约束。", type: "WORLD_ANNOTATION", visibility: "PUBLIC_WORLD", importance: "HIGH", temporalMode: "TIMELESS" } },
  { name: "未来计划", values: { title: "未来计划", content: "谁计划在未来做什么；这件事目前尚未发生。", type: "PLANNED_DECISION", visibility: "PUBLIC_WORLD", importance: "NORMAL", temporalMode: "PLANNED" } }
];

const empty = (gameDate = "") => ({
  title: "",
  content: "",
  type: "PLAYER_CANON",
  visibility: "PUBLIC_WORLD",
  importance: "NORMAL",
  temporalMode: "CURRENT_DATE",
  gameDate,
  selectedEntities: [],
  selectedKnownBy: [],
  scopeEntityId: "",
  conflictKey: "",
  conversationStable: false,
  currentStateEnabled: false,
  currentClaimEntityId: "",
  currentClaimField: "location",
  currentTruth: null
});

const cloneOption = (value) => ({ runtimeId: String(value?.runtimeId || value?.id || ""), displayName: value?.displayName || value?.name || `#${value?.runtimeId || value?.id || "?"}`, title: value?.title || null, recentlyMentioned: value?.recentlyMentioned === true, currentlyPresent: value?.currentlyPresent === true });
const optionsFromIds = (values) => (Array.isArray(values) ? values : []).map((value) => cloneOption({ runtimeId: value, displayName: `#${value}` })).filter((item) => item.runtimeId);

function CharacterPicker({ react: R, api, label, help, value, onChange, multiple = true, initialOptions = [], disabled = false }) {
  const h = R.createElement;
  const [query, setQuery] = R.useState("");
  const [options, setOptions] = R.useState(initialOptions);
  const [loading, setLoading] = R.useState(false);
  const [error, setError] = R.useState("");
  R.useEffect(() => { if (initialOptions.length) setOptions(initialOptions); }, [initialOptions]);
  const search = async () => {
    if (typeof api?.listCanonCharacterOptions !== "function") { setError("当前版本没有角色选择接口。"); return; }
    setLoading(true); setError("");
    try {
      const result = await api.listCanonCharacterOptions({ query: query.trim().slice(0, 120) });
      setOptions((result?.options || []).map(cloneOption));
    } catch (cause) { setError(String(cause?.message || cause).slice(0, 160)); }
    finally { setLoading(false); }
  };
  const selected = Array.isArray(value) ? value : [];
  const pick = (option) => {
    const next = multiple ? [...selected.filter((item) => item.runtimeId !== option.runtimeId), option] : [option];
    onChange(next);
  };
  const remove = (runtimeId) => onChange(selected.filter((item) => item.runtimeId !== runtimeId));
  return h("div", { className: "world-memory-picker" },
    h("div", { className: "world-memory-picker-heading" }, h("span", null, label), help && h("small", null, help)),
    h("div", { className: "world-memory-picker-search" },
      h("input", { value: query, disabled: disabled || loading, placeholder: "搜索人物姓名", onChange: event => setQuery(event.target.value), onKeyDown: event => { if (event.key === "Enter") { event.preventDefault(); search(); } } }),
      h("button", { type: "button", disabled: disabled || loading, onClick: search }, loading ? "搜索中…" : "搜索")
    ),
    error && h("small", { className: "world-memory-picker-error" }, error),
    selected.length > 0 && h("div", { className: "world-memory-chips" }, selected.map(option => h("span", { className: "world-memory-chip", key: option.runtimeId }, option.displayName, h("button", { type: "button", disabled, "aria-label": `移除${option.displayName}`, onClick: () => remove(option.runtimeId) }, "×")))),
    options.length > 0 && h("div", { className: "world-memory-picker-options" }, options.slice(0, 20).map(option => h("button", { type: "button", key: option.runtimeId, disabled: disabled || selected.some(item => item.runtimeId === option.runtimeId && !multiple), className: selected.some(item => item.runtimeId === option.runtimeId) ? "is-selected" : "", onClick: () => pick(option) }, h("strong", null, option.displayName), option.currentlyPresent && h("small", null, "当前场景"), !option.currentlyPresent && option.recentlyMentioned && h("small", null, "最近提及"))))
  );
}

export function WorldMemoryEditor({ react: R }) {
  const h = R.createElement;
  const developerMode = window.localStorage?.getItem("votc-developer-mode") === "true";
  const [data, setData] = R.useState(null);
  const [busy, setBusy] = R.useState(false);
  const [error, setError] = R.useState("");
  const [draft, setDraft] = R.useState(empty);
  const [editing, setEditing] = R.useState(null);
  const [history, setHistory] = R.useState(null);
  const [renameSource, setRenameSource] = R.useState("");
  const [templateOpen, setTemplateOpen] = R.useState(false);
  const [recallGuideOpen, setRecallGuideOpen] = R.useState(false);
  const [resumeBranchId, setResumeBranchId] = R.useState("");
  const [testState, setTestState] = R.useState(null);
  const [legacyState, setLegacyState] = R.useState({ supplemental: [], readOnly: true, legacyCount: 0 });
  const [legacyMigration, setLegacyMigration] = R.useState(null);
  const request = R.useRef(0);
  const mounted = R.useRef(true);
  const api = window.worldlineAPI;

  const run = async action => {
    const sequence = ++request.current;
    setBusy(true); setError("");
    try { await action(sequence); }
    catch (cause) { if (mounted.current && sequence === request.current) setError(String(cause?.message || cause).slice(0, 300)); }
    finally { if (mounted.current && sequence === request.current) setBusy(false); }
  };
  const defaultDate = result => result?.defaultGameDate || result?.branch?.gameDate || "";
  const load = async (sequence, offset = 0) => {
    const legacyPromise = typeof api?.listSupplemental === "function" ? api.listSupplemental().catch(() => ({ supplemental: [], readOnly: true, legacyCount: 0 })) : Promise.resolve({ supplemental: [], readOnly: true, legacyCount: 0 });
    const [result, legacyResult] = await Promise.all([api.listCanon({ offset }), legacyPromise]);
    if (!mounted.current || sequence !== request.current) return;
    setData(result); setLegacyState(legacyResult || { supplemental: [], readOnly: true, legacyCount: 0 }); setLegacyMigration(null); setHistory(null); setEditing(null); setRenameSource(""); setResumeBranchId(""); setTestState(null);
    setDraft(empty(defaultDate(result)));
  };
  R.useEffect(() => {
    mounted.current = true;
    const unsubscribe = api?.onUpdated?.((payload) => { if (payload?.reason === "recall_settings_updated") return; request.current++; setData(null); setLegacyState({ supplemental: [], readOnly: true, legacyCount: 0 }); setLegacyMigration(null); setHistory(null); setEditing(null); setBusy(false); });
    return () => { mounted.current = false; request.current++; unsubscribe?.(); };
  }, []);

  const branchState = data?.branch?.state || "BRANCH_UNKNOWN";
  const branchNeedsAction = !data?.branch?.branchId || !!data?.branch?.reason || ["ROLLBACK_CANDIDATE", "BRANCH_RESUME_AMBIGUOUS", "LOAD_BOUNDARY_CANDIDATE"].includes(branchState);
  const writable = !!data?.branch?.branchId && !branchNeedsAction && !busy;
  const button = (label, action, disabled = busy, className = "") => h("button", { type: "button", className, disabled, onClick: action }, label);
  const setField = (key, value) => setDraft(previous => ({ ...previous, [key]: value }));
  const field = (key, label, multiline = false, hint = "") => h("label", { key, className: "world-memory-field" }, h("span", null, label), h(multiline ? "textarea" : "input", { value: draft[key] || "", disabled: busy, maxLength: key === "content" ? 12000 : 500, onChange: event => setField(key, event.target.value) }), hint && h("small", null, hint));
  const select = (key, label, values, help = "", locked = false) => h("label", { key, className: "world-memory-field" }, h("span", null, label), h("select", { value: draft[key], disabled: busy || locked, onChange: event => setField(key, event.target.value) }, Object.entries(values).map(([value, title]) => h("option", { key: value, value }, title))), help && h("small", null, help));
  const typeOptions = Object.fromEntries(Object.entries(TYPES).filter(([key]) => key !== "MANUAL_CORRECTION" || draft.type === key));
  const stableEligible = ["WORLD_ANNOTATION", "RP_POLITICAL_DECISION"].includes(draft.type) && ["HIGH", "CRITICAL"].includes(draft.importance);

  const change = (record, payload) => run(async sequence => {
    await api.mutateCanon({ token: data.branch.token, operation: "update", id: record.recordId, revision: record.revision, payload });
    await load(sequence, data.offset);
  });
  const save = operation => run(async sequence => {
    if (!draft.title.trim() || !draft.content.trim()) throw new Error("请填写标题和希望世界长期记住的内容。");
    if (draft.temporalMode === "SPECIFIC_DATE" && !draft.gameDate.trim()) throw new Error("指定日期记忆必须填写日期。");
    const entities = draft.selectedEntities.map(item => item.runtimeId).filter(Boolean);
    const knownBy = draft.selectedKnownBy.map(item => item.runtimeId).filter(Boolean);
    let currentClaim = null;
    if (draft.currentStateEnabled) {
      const entityId = draft.currentClaimEntityId || entities[0] || "";
      const truth = draft.currentTruth;
      if (!entityId) throw new Error("当前状态需要先选择一名涉及人物。");
      if (!truth?.available || String(truth.entityId) !== String(entityId) || truth.field !== draft.currentClaimField) throw new Error("请先读取并确认 CK3 当前事实；当前值不允许手动填写。");
      currentClaim = { entityId: truth.entityId, field: truth.field, value: truth.rawValue };
    }
    const payload = {
      title: draft.title.trim(), content: draft.content.trim(), type: draft.type, visibility: draft.visibility, importance: draft.importance,
      temporalMode: draft.currentStateEnabled ? "CURRENT_DATE" : draft.temporalMode, gameDate: draft.currentStateEnabled || draft.temporalMode === "TIMELESS" ? null : draft.gameDate.trim() || null,
      temporalSemantics: draft.currentStateEnabled ? "CURRENT_STRUCTURED_CLAIM" : null, currentClaim,
      entities, knownBy, scopeEntityId: ["COURT_PUBLIC", "REALM_PUBLIC"].includes(draft.visibility) ? draft.scopeEntityId || entities[0] || null : null,
      conflictKey: draft.conflictKey.trim() || null, conversationStable: stableEligible && draft.conversationStable === true,
      revisionReason: editing ? "玩家编辑" : "玩家确认新增"
    };
    await api.mutateCanon({ token: data.branch.token, operation, id: editing?.recordId, revision: editing?.revision, payload });
    await load(sequence, data.offset);
  });
  const beginEdit = record => {
    const selectedEntities = optionsFromIds(record.entities);
    if (record.currentClaim?.entityId && !selectedEntities.some((item) => item.runtimeId === String(record.currentClaim.entityId))) selectedEntities.push(cloneOption({ runtimeId: record.currentClaim.entityId }));
    setEditing(record);
    setDraft({ ...empty(data.defaultGameDate || data.branch.gameDate || ""), ...record, selectedEntities, selectedKnownBy: optionsFromIds(record.knownBy), temporalMode: record.temporalMode || (record.gameDate ? "SPECIFIC_DATE" : "CURRENT_DATE"), gameDate: record.gameDate || "", conflictKey: record.conflictKey || "", currentStateEnabled: !!record.currentClaim, currentClaimEntityId: String(record.currentClaim?.entityId || ""), currentClaimField: record.currentClaim?.field || "location", currentTruth: record.currentClaim ? { available: false, entityId: String(record.currentClaim.entityId), field: record.currentClaim.field || "location", displayValue: record.currentClaim.displayValue || "已保存的当前事实", reason: "NEEDS_RECHECK" } : null });
  };
  const applyTemplate = template => {
    setDraft(previous => ({ ...empty(data?.defaultGameDate || data?.branch?.gameDate || ""), ...previous, ...template.values, gameDate: template.values.temporalMode === "CURRENT_DATE" ? defaultDate(data) : "" }));
    setTemplateOpen(false);
  };
  const cancelEdit = () => { setEditing(null); setDraft(empty(defaultDate(data))); };

  const openTest = record => {
    setTestState({ recordId: record.recordId, query: record.title, responder: null, options: [], result: null, loadingOptions: true });
    if (typeof api?.listCanonCharacterOptions !== "function") return;
    api.listCanonCharacterOptions({ query: "" }).then(result => setTestState(previous => previous?.recordId === record.recordId ? { ...previous, options: (result?.options || []).map(cloneOption), loadingOptions: false } : previous)).catch(() => setTestState(previous => previous?.recordId === record.recordId ? { ...previous, loadingOptions: false } : previous));
  };
  const runTest = () => run(async sequence => {
    if (!testState?.responder?.runtimeId) throw new Error("请先选择要测试的 NPC。");
    if (!testState.query.trim()) throw new Error("请填写一个测试问题。");
    if (typeof api?.testCanonRecall !== "function") throw new Error("当前版本没有召回测试接口。");
    const result = await api.testCanonRecall({ token: data.branch.token, recordId: testState.recordId, responderId: testState.responder.runtimeId, query: testState.query.trim().slice(0, 1000) });
    if (mounted.current && sequence === request.current) setTestState(previous => ({ ...previous, result }));
  });
  const enableRecall = () => run(async sequence => {
    if (typeof api?.setRecallSettings !== "function") { setRecallGuideOpen(true); return; }
    await api.setRecallSettings({ promptIntegrationEnabled: true, subjectiveWorldMode: "PRODUCTION" });
    await load(sequence, data.offset);
  });

  const readCurrentTruth = () => run(async sequence => {
    const entityId = draft.currentClaimEntityId || draft.selectedEntities[0]?.runtimeId || "";
    const field = draft.currentClaimField;
    if (!entityId) {
      setDraft(previous => ({ ...previous, currentTruth: { available: false, entityId: "", field, reason: "请先选择一名涉及人物。" } }));
      return;
    }
    if (typeof api?.getCanonCurrentTruth !== "function") {
      setDraft(previous => ({ ...previous, currentTruth: { available: false, entityId, field, reason: "当前版本没有 CK3 当前事实读取接口。" } }));
      return;
    }
    try {
      const truth = await api.getCanonCurrentTruth({ entityId, field });
      if (mounted.current && sequence === request.current) setDraft(previous => ({ ...previous, currentTruth: truth }));
    } catch (cause) {
      if (mounted.current && sequence === request.current) setDraft(previous => ({ ...previous, currentTruth: { available: false, entityId, field, reason: String(cause?.message || cause).slice(0, 160) } }));
    }
  });

  const editWithoutCurrentClaim = (record, mode) => { beginEdit(record); setDraft(previous => ({ ...previous, currentStateEnabled: false, currentClaimEntityId: "", currentTruth: null, temporalMode: mode })); setTestState(null); };
  const renderTestResult = (result, record) => result && h("div", { className: `world-memory-test-result ${result.matched ? "is-matched" : "is-unmatched"}` },
    h("strong", null, result.matched ? "这条记忆会被召回" : "这条记忆不会被召回"),
    h("p", null, `原因：${RECALL_REASONS[result.reason] || result.reason || "未说明"}`),
    h("div", { className: "world-memory-test-metrics" }, h("span", null, `权限：${result.visibility === "ALLOW" ? "允许" : "阻止"}`), h("span", null, `时间：${result.temporal === "SAFE" ? "安全" : "阻止"}`), h("span", null, `分支：${result.branch === "MATCH" ? "一致" : "不一致"}`), h("span", null, `CK3 当前事实：${result.currentTruth === "CONFLICT" ? "冲突" : "无冲突"}`), h("span", null, `Token：${result.tokens || 0}`)),
    result.currentTruth === "CONFLICT" && h("div", { className: "world-memory-test-conflict" }, h("p", { className: "world-memory-test-warning" }, "当前状态与 CK3 冲突，回答将服从 CK3。"), record.currentClaim && h("p", null, `CK3 当前状态：${String(result.currentTruthValue ?? "无法读取")} · 世界记忆：${String(result.claimValue ?? record.currentClaim.value)}`), h("p", { className: "world-memory-help" }, "改为过去事件时，请同时把正文中的“现在 / 目前”等措辞改成过去时。"), h("div", { className: "world-memory-inline-action" }, button("改为过去事件", () => editWithoutCurrentClaim(record, record.gameDate ? "SPECIFIC_DATE" : "CURRENT_DATE"), busy), button("取消当前状态声明", () => editWithoutCurrentClaim(record, "CURRENT_DATE"), busy), button("隐藏此记录", () => change(record, { status: "HIDDEN", revisionReason: "当前状态与 CK3 冲突，玩家隐藏记录" }), !writable))),
    result.promptText && h("details", { className: "world-memory-test-preview" }, h("summary", null, "查看最终召回预览"), h("pre", null, result.promptText))
  );
  const renderTestPanel = record => {
    if (!testState || testState.recordId !== record.recordId) return null;
    return h("div", { className: "world-memory-test-panel" },
      h("div", { className: "world-memory-test-heading" }, h("strong", null, "测试这条记忆"), button("关闭", () => setTestState(null), false)),
      h("p", { className: "world-memory-help" }, "选择一个 NPC，输入它可能会问的问题；测试只读，不会修改存档或记忆。"),
      h(CharacterPicker, { react: R, api, label: "测试 NPC", help: "可以搜索当前存档人物。", value: testState.responder ? [testState.responder] : [], initialOptions: testState.options, multiple: false, disabled: busy, onChange: values => setTestState(previous => ({ ...previous, responder: values[0] || null, result: null })) }),
      h("label", { className: "world-memory-field" }, h("span", null, "测试问题"), h("input", { value: testState.query, disabled: busy, onChange: event => setTestState(previous => ({ ...previous, query: event.target.value, result: null })) })),
      button("运行召回测试", runTest, busy || !testState.responder),
      renderTestResult(testState.result, record)
    );
  };

  const renderRecord = record => h("article", { key: record.recordId, className: `world-memory-record ${record.status !== "ACTIVE" ? "is-inactive" : ""}` },
    h("div", { className: "world-memory-record-heading" }, h("strong", null, record.title), h("span", { className: `world-memory-status-tag status-${String(record.status).toLowerCase()}` }, STATUS[record.status] || record.status)),
    h("p", { className: "world-memory-record-content" }, record.content),
    h("div", { className: "world-memory-record-meta" }, h("span", null, record.temporalMode === "TIMELESS" ? "长期规则" : record.temporalMode === "PLANNED" ? "未来计划" : record.gameDate || "无日期"), h("span", null, TYPES[record.type] || record.type), h("span", null, VISIBILITY[record.visibility] || record.visibility), h("span", null, `修订 ${record.revision}`)),
    record.recallWarning && h("p", { className: "world-memory-record-warning", role: "status" }, record.recallWarning),
    h("div", { className: "world-memory-record-actions" },
      record.status === "ACTIVE" && button("测试这条记忆", () => openTest(record), !data.branch.branchId),
      button("编辑", () => beginEdit(record), !writable || record.status === "SUPERSEDED"),
      button(record.status === "ACTIVE" ? "隐藏" : "恢复生效", () => change(record, { status: record.status === "ACTIVE" ? "HIDDEN" : "ACTIVE", revisionReason: "玩家调整显示状态" }), !writable || record.status === "SUPERSEDED"),
      button("恢复自动来源", () => change(record, { status: "RETIRED", revisionReason: "撤销补充层记录，恢复自动来源" }), !writable || record.status === "SUPERSEDED"),
      button("查看修订", () => run(async sequence => { const records = await api.getCanonHistory({ token: data.branch.token, id: record.recordId }); if (mounted.current && sequence === request.current) setHistory({ id: record.recordId, offset: 0, records, hasMore: records.length === 20 }); })),
      developerMode && h("details", { className: "world-memory-developer" }, h("summary", null, "开发者详情"), h("p", null, `Record：${record.recordId}`), h("p", null, `Branch：${record.branchId} · Revision：${record.revision}`), h("p", null, `涉及人物：${(record.entities || []).join(", ") || "—"} · 知情人物：${(record.knownBy || []).join(", ") || "—"}`), h("p", null, `冲突标识：${record.conflictKey || "自动生成 / 无"}`)),
      renderTestPanel(record)
    ));

  const renderHistory = () => !history ? null : h("details", { className: "world-memory-history", open: true },
    h("summary", null, `修订记录 · ${history.records.length} 条`),
    history.records.map(record => h("p", { key: `${record.recordId || history.id}-${record.revision}` }, `#${record.revision} · ${record.updatedAt} · ${record.revisionReason} · ${STATUS[record.status] || record.status}：${record.content}`)),
    button("加载更早版本", () => run(async sequence => {
      const offset = history.offset + 20;
      const records = await api.getCanonHistory({ token: data.branch.token, id: history.id, offset });
      if (mounted.current && sequence === request.current) setHistory(previous => previous ? { ...previous, offset, records: [...previous.records, ...records], hasMore: records.length === 20 } : previous);
    }), busy || history.hasMore === false));

  const renderForm = () => h("div", { className: "world-memory-form" },
    h("div", { className: "world-memory-form-heading" }, h("div", null, h("h4", null, editing ? "编辑世界记忆" : "新增长期记忆"), h("p", null, "用玩家能理解的语言描述这件事。")), editing && h("span", null, `修订 ${editing.revision}`)),
    !editing && h("div", { className: "world-memory-template-bar" }, button(templateOpen ? "收起模板" : "从模板开始", () => setTemplateOpen(value => !value), busy), templateOpen && h("div", { className: "world-memory-template-list" }, TEMPLATES.map(template => button(template.name, () => applyTemplate(template), busy)))),
    field("title", "标题"),
    field("content", "希望世界长期记住的内容", true, "写清楚发生了什么、涉及谁、达成了什么约定；不要覆盖 CK3 当前地点、生死、领主等状态。"),
    h("div", { className: "world-memory-field-grid is-two" }, select("temporalMode", "这件事从什么时候成立？", TEMPORAL_MODES, draft.currentStateEnabled ? "当前状态必须使用当前游戏日期，并由 CK3 核对。" : "当前游戏日期会随当前检查点写入；长期规则不绑定日期。", draft.currentStateEnabled), select("type", "记忆类型", typeOptions, TYPE_HELP[draft.type] || "")),
    draft.temporalMode === "SPECIFIC_DATE" && field("gameDate", "具体日期", false, "格式如 1171.9.20"),
    draft.temporalMode === "PLANNED" && field("gameDate", "计划日期（可选）", false, "留空表示尚未确定日期。"),
    draft.temporalMode === "CURRENT_DATE" && h("p", { className: "world-memory-date-note" }, `将以当前游戏日期 ${defaultDate(data) || "读取中的日期"} 成立。`),
    h("div", { className: "world-memory-field-grid is-two" }, select("visibility", "谁可以知道？", VISIBILITY, VISIBILITY_HELP[draft.visibility] || ""), select("importance", "重要性", IMPORTANCE, "重要 / 关键记忆更适合固定在本次对话中提醒。")),
    h(CharacterPicker, { react: R, api, label: "涉及人物（可选）", help: draft.currentStateEnabled ? "当前状态至少需要选择一名人物。" : "搜索并选择这条记忆涉及的人物；不选择也可以保存。", value: draft.selectedEntities, onChange: values => setDraft(previous => ({ ...previous, selectedEntities: values, scopeEntityId: values.some(item => item.runtimeId === previous.scopeEntityId) ? previous.scopeEntityId : "", currentClaimEntityId: values.some(item => item.runtimeId === previous.currentClaimEntityId) ? previous.currentClaimEntityId : values[0]?.runtimeId || "", currentTruth: null })), disabled: busy }),
    h("div", { className: "world-memory-current-claim" },
      h("label", { className: "world-memory-check" }, h("input", { type: "checkbox", checked: draft.currentStateEnabled === true, disabled: busy, onChange: event => setDraft(previous => ({ ...previous, currentStateEnabled: event.target.checked, temporalMode: event.target.checked ? "CURRENT_DATE" : previous.temporalMode, currentClaimEntityId: event.target.checked ? previous.currentClaimEntityId || previous.selectedEntities[0]?.runtimeId || "" : previous.currentClaimEntityId, currentTruth: event.target.checked ? previous.currentTruth : null })) }), h("span", null, "这是人物当前状态，需要用 CK3 核对")),
      h("small", { className: "world-memory-help" }, "只支持所在地、生死、信仰、文化、领主和所在宫廷。状态值由 CK3 只读返回，不能手动填写；过去事件不要开启。"),
      draft.currentStateEnabled && h("div", { className: "world-memory-current-truth" },
        h("div", { className: "world-memory-field-grid is-two" },
          h("label", { className: "world-memory-field" }, h("span", null, "要核对哪个人物？"), h("select", { value: draft.currentClaimEntityId || draft.selectedEntities[0]?.runtimeId || "", disabled: busy || draft.selectedEntities.length === 0, onChange: event => setDraft(previous => ({ ...previous, currentClaimEntityId: event.target.value, currentTruth: null })) }, h("option", { value: "" }, "请先选择涉及人物"), draft.selectedEntities.map(option => h("option", { key: option.runtimeId, value: option.runtimeId }, option.displayName)))),
          h("label", { className: "world-memory-field" }, h("span", null, "要核对哪项状态？"), h("select", { value: draft.currentClaimField, disabled: busy, onChange: event => setDraft(previous => ({ ...previous, currentClaimField: event.target.value, currentTruth: null })) }, Object.entries(CURRENT_CLAIM_FIELDS).map(([value, title]) => h("option", { key: value, value }, title))))
        ),
        button("读取 CK3 当前事实", readCurrentTruth, busy || !draft.currentClaimEntityId && draft.selectedEntities.length === 0),
        draft.currentTruth?.available ? h("div", { className: "world-memory-test-result is-matched", role: "status" }, h("strong", null, "当前事实只读预览"), h("p", null, `CK3 当前${CURRENT_CLAIM_FIELDS[draft.currentTruth.field] || draft.currentTruth.field}：${String(draft.currentTruth.displayValue ?? "—")}`), h("small", { className: "world-memory-help" }, "保存时由服务端再次核验；不会接受手动填写的当前值。")) : draft.currentTruth ? h("div", { className: "world-memory-test-result is-unmatched", role: "status" }, h("strong", null, "暂时无法读取当前事实"), h("p", null, draft.currentTruth.reason === "NEEDS_RECHECK" ? "编辑已有记录时需要重新读取 CK3 当前事实。" : `原因：${String(draft.currentTruth.reason || "未知")}`)) : h("p", { className: "world-memory-quiet-note" }, "选择人物和状态后，点击“读取 CK3 当前事实”生成只读预览。")
      )
    ),
    ["PERSONAL", "SECRET"].includes(draft.visibility) && h(CharacterPicker, { react: R, api, label: "谁明确知道？", help: "个人记忆和秘密必须用人物列表授权；不会自动把正文共享给其他 NPC。", value: draft.selectedKnownBy, onChange: values => setField("selectedKnownBy", values), disabled: busy }),
    ["COURT_PUBLIC", "REALM_PUBLIC"].includes(draft.visibility) && h("label", { className: "world-memory-field" }, h("span", null, "范围以谁为准？"), h("select", { value: draft.scopeEntityId || draft.selectedEntities[0]?.runtimeId || "", disabled: busy || draft.selectedEntities.length === 0, onChange: event => setField("scopeEntityId", event.target.value) }, h("option", { value: "" }, draft.selectedEntities.length ? "默认使用第一个涉及人物" : "请先选择涉及人物"), draft.selectedEntities.map(option => h("option", { key: option.runtimeId, value: option.runtimeId }, option.displayName)))),
    h("details", { className: "world-memory-advanced" }, h("summary", null, "对话提醒"), h("label", { className: "world-memory-check" }, h("input", { type: "checkbox", checked: stableEligible && draft.conversationStable === true, disabled: busy || !stableEligible, onChange: event => setField("conversationStable", event.target.checked) }), h("span", null, "在本次对话中持续提醒 NPC")), h("small", { className: "world-memory-help" }, stableEligible ? "仍受权限、时间和 CK3 当前事实限制。" : "仅适合重要 / 关键级别的长期世界规则或政治决定。"), developerMode && h("div", { className: "world-memory-developer-fields" }, h("p", null, `涉及人物 Runtime ID：${draft.selectedEntities.map(item => item.runtimeId).join(", ") || "—"}`), h("p", null, `知情人物 Runtime ID：${draft.selectedKnownBy.map(item => item.runtimeId).join(", ") || "—"}`), h("p", null, `范围人物 Runtime ID：${draft.scopeEntityId || draft.selectedEntities[0]?.runtimeId || "—"}`), field("conflictKey", "冲突标识（通常留空）", false, "系统会按人物、类型和标题自动生成；只有需要合并同一事项时才覆盖。"))),
    h("div", { className: "world-memory-form-actions" }, button(editing ? "保存修订" : "确认新增", () => save(editing ? "update" : "create"), !writable, "primary-button"), editing && button("以新记录替代", () => save("supersede"), !writable), editing && button("取消", cancelEdit, busy))
  );

  const renderBranchStatus = () => {
    if (!data.branch?.branchId) return h("strong", { className: "is-blocked" }, "未连接当前存档");
    if (branchState === "ROLLBACK_CANDIDATE") return h("strong", { className: "is-warning" }, "检测到存档回档");
    if (branchState === "BRANCH_FORK_DETECTED") return h("strong", { className: "is-warning" }, "检测到复制存档 / 新分支");
    if (branchState === "BRANCH_RESUME_AMBIGUOUS") return h("strong", { className: "is-warning" }, "需要选择要恢复的分支");
    if (branchState === "LOAD_BOUNDARY_CANDIDATE") return h("strong", { className: "is-warning" }, "需要确认载入边界");
    return h("strong", { className: "is-ready" }, "已安全绑定");
  };
  const renderRecallGuidance = () => !data.promptEnabled && h("div", { className: "world-memory-recall-guide" }, h("p", null, "NPC 暂时不会读取世界记忆。"), button(recallGuideOpen ? "收起开启步骤" : "前往开启", () => setRecallGuideOpen(value => !value), busy), recallGuideOpen && h("div", { className: "world-memory-recall-steps" }, h("p", null, "请开启以下两项："), h("ol", null, h("li", null, "Worldline Prompt Integration = ON"), h("li", null, "Subjective World Mode = PRODUCTION")), h("small", null, "只会改变世界线召回设置，不会改变模型，也不会修改 CK3 存档。"), button("一键开启推荐设置", enableRecall, busy, "primary-button")));
  const renderBranchWarning = () => {
    if (!branchNeedsAction) return null;
    const loadBoundary = branchState === "LOAD_BOUNDARY_CANDIDATE";
    const canConfirm = data.branch.reason === "save_continuity_unverified" || loadBoundary;
    return h("details", { className: "world-memory-warning", open: true },
      h("summary", null, branchState === "ROLLBACK_CANDIDATE" ? "检测到存档回档" : branchState === "BRANCH_RESUME_AMBIGUOUS" ? "选择要恢复的存档分支" : loadBoundary ? "检测到新的 CK3 载入会话" : data.branch.reason === "save_continuity_unverified" ? "存档连续性需要确认" : "当前存档尚未安全绑定"),
      h("p", null, branchState === "ROLLBACK_CANDIDATE" ? "当前存档看起来回到了更早的检查点。请确认是否继续原分支；在确认前不会写入世界记忆。" : branchState === "BRANCH_RESUME_AMBIGUOUS" ? "检测到多个可能的历史分支，请明确选择；系统不会自动猜测。" : loadBoundary ? "检测到 CK3 重新载入或新的游戏会话。请明确选择继续当前分支，或建立不继承旧 Canon 的独立分支；系统不会自动把两段存档接在一起。" : data.branch.reason === "save_continuity_unverified" ? "只有确定这是原分支的继续游玩时才确认；复制存档应建立独立分支。" : "请重新读取存档，或明确建立不继承旧 Canon 的独立分支。"),
      branchState === "BRANCH_RESUME_AMBIGUOUS" && h("div", { className: "world-memory-inline-action" }, h("select", { value: resumeBranchId, disabled: busy, onChange: event => setResumeBranchId(event.target.value), "aria-label": "选择要恢复的分支" }, h("option", { value: "" }, "选择历史分支"), (data.branch.resumeCandidates || []).map(item => h("option", { key: item.branchId, value: item.branchId }, `${item.sourcePath || item.branchId} · ${item.gameDate || "无日期"}`))), button("恢复所选分支", () => run(async sequence => { if (!resumeBranchId) throw new Error("请先选择历史分支。"); await api.resumeCanonBranch({ token: data.branch.token, branchId: resumeBranchId }); await load(sequence); }), busy || !resumeBranchId)),
      canConfirm && button(loadBoundary ? "继续当前分支" : "确认延续当前分支", () => run(async sequence => { await api.confirmCanonBranch(data.branch.token); await load(sequence); }), busy),
      (loadBoundary || !data.branch.branchId) && data.branch.campaignId && button("建立独立分支（不继承旧 Canon）", () => run(async sequence => { await api.forkCanonBranch(data.branch.token); await load(sequence); }), busy)
    );
  };

  const openLegacyMigration = id => run(async sequence => {
    if (typeof api?.getLegacySupplementalMigration !== "function") throw new Error("当前版本没有旧版 Supplemental 迁移接口。");
    const plan = await api.getLegacySupplementalMigration({ id });
    if (mounted.current && sequence === request.current) setLegacyMigration({ ...plan, reviewKnownBy: [], reviewScope: [] });
  });
  const confirmLegacyMigration = () => run(async sequence => {
    if (!legacyMigration?.legacyId) throw new Error("请先选择一条旧版 Supplemental。");
    if (typeof api?.migrateLegacySupplemental !== "function") throw new Error("当前版本没有旧版 Supplemental 迁移接口。");
    let payload = null;
    if (legacyMigration.requiresReview) {
      const visibility = legacyMigration.draft.visibility;
      const knownBy = (legacyMigration.reviewKnownBy || []).map((item) => item.runtimeId);
      const scopeEntityId = legacyMigration.reviewScope?.[0]?.runtimeId || null;
      if (["PERSONAL", "SECRET"].includes(visibility) && !knownBy.length) throw new Error("请重新选择至少一名明确知情人物。");
      if (["COURT_PUBLIC", "REALM_PUBLIC"].includes(visibility) && !scopeEntityId) throw new Error("请重新选择宫廷或领地范围人物。");
      payload = { ...legacyMigration.draft, knownBy, scopeEntityId, reviewConfirmed: true };
    }
    const result = await api.migrateLegacySupplemental({ token: data.branch.token, id: legacyMigration.legacyId, payload });
    if (result?.status === "MIGRATED") await load(sequence, data.offset);
    else if (mounted.current && sequence === request.current) setLegacyMigration(result);
  });
  const renderLegacySupplemental = () => {
    const entries = Array.isArray(legacyState?.supplemental) ? legacyState.supplemental : [];
    if (entries.length === 0) return null;
    return h("details", { className: "world-memory-secondary-details world-memory-legacy", open: entries.length > 0 },
      h("summary", null, `发现 ${entries.length} 条旧版补充知识（只读）`),
      h("p", { className: "world-memory-help" }, "这些是旧版本留下的兼容记录，只能查看；迁移为 Canon 前不会修改原文，也不会自动覆盖当前 CK3 事实。"),
      legacyMigration && h("div", { className: "world-memory-test-panel", role: "dialog" },
        h("div", { className: "world-memory-test-heading" }, h("strong", null, legacyMigration.requiresReview ? "迁移审阅" : "迁移确认"), button("取消", () => setLegacyMigration(null), busy)),
        legacyMigration.status === "MIGRATION_REVIEW_REQUIRED" && h("p", { className: "world-memory-test-warning" }, "这条记录包含非公开可见范围，请确认迁移后的权限和知情人物；确认后才会进入 Canon。"),
        legacyMigration.draft && h("div", { className: "world-memory-record" }, h("strong", null, legacyMigration.draft.title), h("p", { className: "world-memory-record-content" }, legacyMigration.draft.content), h("p", { className: "world-memory-record-meta" }, `可见范围：${VISIBILITY[legacyMigration.draft.visibility] || legacyMigration.draft.visibility} · 重要性：${IMPORTANCE[legacyMigration.draft.importance] || legacyMigration.draft.importance}`)),
        legacyMigration.requiresReview && ["PERSONAL", "SECRET"].includes(legacyMigration.draft?.visibility) && h(CharacterPicker, { react: R, api, label: "重新选择明确知情人物", help: "旧记录不会自动沿用可能不准确的权限；请按当前存档重新授权。", value: legacyMigration.reviewKnownBy || [], onChange: values => setLegacyMigration(previous => ({ ...previous, reviewKnownBy: values })), disabled: busy }),
        legacyMigration.requiresReview && ["COURT_PUBLIC", "REALM_PUBLIC"].includes(legacyMigration.draft?.visibility) && h(CharacterPicker, { react: R, api, label: "重新选择范围人物", help: "系统会按该人物当前所属宫廷或领地判断可见范围。", value: legacyMigration.reviewScope || [], onChange: values => setLegacyMigration(previous => ({ ...previous, reviewScope: values })), multiple: false, disabled: busy }),
        legacyMigration.status === "MIGRATED" ? h("p", { className: "world-memory-feedback", role: "status" }, "这条旧记录已经迁移为 Canon。") : button("确认迁移为 Canon", confirmLegacyMigration, busy || !writable, "primary-button")
      ),
      h("div", { className: "world-memory-record-list" }, entries.map(entry => h("article", { key: entry.id, className: "world-memory-record" }, h("div", { className: "world-memory-record-heading" }, h("strong", null, entry.title || "无标题"), h("span", { className: "world-memory-status-tag" }, entry.migration?.status === "MIGRATED" ? "已迁移" : entry.hidden ? "已隐藏" : "只读")), h("p", { className: "world-memory-record-content" }, entry.body || ""), h("div", { className: "world-memory-record-meta" }, h("span", null, entry.gameDate || "无日期"), h("span", null, VISIBILITY[entry.visibility] || entry.visibility || "所有人都知道")), entry.migration?.status === "MIGRATED" ? h("p", { className: "world-memory-record-subnote" }, "已迁移为世界记忆") : button("查看迁移草稿", () => openLegacyMigration(entry.id), !writable))))
    );
  };

  const dataChildren = data ? [
    h("div", { className: "world-memory-status-grid" },
      h("div", { className: "world-memory-status-card" }, h("span", null, "当前存档"), renderBranchStatus()),
      h("div", { className: "world-memory-status-card" }, h("span", null, "NPC 世界记忆"), h("strong", { className: data.promptEnabled ? "is-ready" : "is-muted" }, data.promptEnabled ? "已开启" : "未开启")),
      h("div", { className: "world-memory-status-card" }, h("span", null, "已保存记忆"), h("strong", null, String(data.total) + " 条"))),
    renderRecallGuidance(),
    renderBranchWarning(),
    renderLegacySupplemental(),
    data.renameCandidates?.length > 0 ? h("details", { className: "world-memory-secondary-details" }, h("summary", null, "存档只是重命名？"), h("p", null, "只有内容指纹相同、且当前分支从未写入时，才保留原分支记忆。复制存档请保持独立。"), h("div", { className: "world-memory-inline-action" }, h("select", { value: renameSource, disabled: busy, onChange: event => setRenameSource(event.target.value), "aria-label": "重命名前的存档" }, h("option", { value: "" }, "选择原存档"), data.renameCandidates.map(item => h("option", { key: item.branchId, value: item.branchId }, item.sourcePath))), button("确认重命名", () => run(async sequence => { await api.renameCanonBranch({ token: data.branch.token, sourceBranchId: renameSource }); await load(sequence); }), busy || !renameSource))) : null,
    developerMode && h("details", { className: "world-memory-secondary-details" }, h("summary", null, "分支技术信息"), h("p", null, "Campaign：" + (data.branch.campaignId || "—") + " · Branch：" + (data.branch.branchId || "—") + " · Revision：" + data.revision)),
    renderForm(),
    h("div", { className: "world-memory-list-heading" }, h("strong", null, "已有世界记忆"), h("span", null, String(data.records.length) + " / " + data.total)),
    data.records.length === 0 ? h("p", { className: "worldline-empty" }, "当前存档还没有长期记忆。") : h("div", { className: "world-memory-record-list" }, data.records.map(renderRecord)),
    h("div", { className: "world-memory-pagination" }, button("上一页", () => run(sequence => load(sequence, Math.max(0, data.offset - 20))), busy || !data.offset), button("下一页", () => run(sequence => load(sequence, data.offset + 20)), busy || data.offset + 20 >= data.total)),
    renderHistory()
  ] : [];
  return h("section", { className: "worldline-card worldline-editor worldline-editor-v87 worldline-editor-luna" },
    h("div", { className: "world-memory-heading" }, h("div", null, h("h4", null, "世界记忆"), h("p", null, "记录 CK3 没有保存、但希望世界长期承认的 RP 事实。")), h("span", { className: "world-memory-version " + (data ? "is-ready" : "") }, "V8.7.2")),
    button(data ? "刷新" : "打开世界记忆", () => run(sequence => load(sequence)), busy, "world-memory-refresh"),
    busy && h("p", { className: "world-memory-feedback", role: "status" }, "正在处理，请稍候……"),
    error && h("p", { className: "world-memory-feedback is-error", role: "alert" }, "操作未完成：" + error),
    ...dataChildren
  );
}
