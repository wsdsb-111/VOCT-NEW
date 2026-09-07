const TYPES = { PLAYER_CANON: "玩家确认事实", RP_POLITICAL_DECISION: "政治决定", SECRET_AGREEMENT: "秘密协议", NARRATIVE_EVENT: "剧情事件", WORLD_ANNOTATION: "世界注释", MANUAL_CORRECTION: "补充层纠正", PLANNED_DECISION: "计划（尚未发生）" };
const VISIBILITY = { PUBLIC_WORLD: "所有人可知", REALM_PUBLIC: "同领地", COURT_PUBLIC: "同宫廷", PERSONAL: "个人记忆", SECRET: "秘密授权" };
const IMPORTANCE = { LOW: "低", NORMAL: "普通", HIGH: "高", CRITICAL: "关键" };
const STATUS = { ACTIVE: "生效", HIDDEN: "已隐藏", RETIRED: "已恢复自动来源", SUPERSEDED: "已被替代", CONFLICTED: "冲突", TEMPORAL_BLOCKED: "时间不满足" };
const empty = () => ({ title: "", content: "", type: "PLAYER_CANON", visibility: "PUBLIC_WORLD", importance: "NORMAL", gameDate: "", entities: "", knownBy: "", scopeEntityId: "", conflictKey: "", conversationStable: false });
const ids = value => value.split(/[,，]/).map(item => item.trim()).filter(Boolean);

export function WorldMemoryEditor({ react: R }) {
  const h = R.createElement;
  const [data, setData] = R.useState(null);
  const [busy, setBusy] = R.useState(false);
  const [error, setError] = R.useState("");
  const [draft, setDraft] = R.useState(empty);
  const [editing, setEditing] = R.useState(null);
  const [history, setHistory] = R.useState(null);
  const [renameSource, setRenameSource] = R.useState("");
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
  const load = async (sequence, offset = 0) => {
    const result = await api.listCanon({ offset });
    if (!mounted.current || sequence !== request.current) return;
    setData(result); setHistory(null); setEditing(null); setRenameSource("");
    setDraft({ ...empty(), gameDate: result.defaultGameDate || result.branch.gameDate || "" });
  };
  R.useEffect(() => {
    mounted.current = true;
    const unsubscribe = api?.onUpdated?.(() => {
      request.current++; setData(null); setHistory(null); setEditing(null); setBusy(false);
    });
    return () => { mounted.current = false; request.current++; unsubscribe?.(); };
  }, []);

  const writable = !!data?.branch?.branchId && !busy;
  const button = (label, action, disabled = busy, className = "") => h("button", { type: "button", className, disabled, onClick: action }, label);
  const setField = (key, value) => setDraft(previous => ({ ...previous, [key]: value }));
  const field = (key, label, multiline = false, hint = "") => h("label", { key, className: "world-memory-field" }, h("span", null, label), h(multiline ? "textarea" : "input", { value: draft[key], disabled: busy, maxLength: key === "content" ? 12000 : 500, onChange: event => setField(key, event.target.value) }), hint && h("small", null, hint));
  const select = (key, label, values) => h("label", { key, className: "world-memory-field" }, h("span", null, label), h("select", { value: draft[key], disabled: busy, onChange: event => setField(key, event.target.value) }, Object.entries(values).map(([value, title]) => h("option", { key: value, value }, title))));

  const change = (record, payload) => run(async sequence => {
    await api.mutateCanon({ token: data.branch.token, operation: "update", id: record.recordId, revision: record.revision, payload });
    await load(sequence, data.offset);
  });
  const save = operation => run(async sequence => {
    const payload = { ...draft, entities: ids(draft.entities), knownBy: ids(draft.knownBy), scopeEntityId: draft.scopeEntityId || null, conflictKey: draft.conflictKey || null, gameDate: draft.gameDate || null, revisionReason: editing ? "玩家编辑" : "玩家确认新增" };
    await api.mutateCanon({ token: data.branch.token, operation, id: editing?.recordId, revision: editing?.revision, payload });
    await load(sequence, data.offset);
  });
  const beginEdit = record => {
    setEditing(record);
    setDraft({ ...empty(), ...Object.fromEntries(Object.keys(empty()).map(key => [key, Array.isArray(record[key]) ? record[key].join(",") : record[key] ?? empty()[key]])) });
  };

  const renderRecord = record => h("article", { key: record.recordId, className: `world-memory-record ${record.status !== "ACTIVE" ? "is-inactive" : ""}` },
    h("div", { className: "world-memory-record-heading" }, h("strong", null, record.title), h("span", { className: `world-memory-status-tag status-${String(record.status).toLowerCase()}` }, STATUS[record.status])),
    h("p", { className: "world-memory-record-content" }, record.content),
    h("div", { className: "world-memory-record-meta" }, h("span", null, record.gameDate || "无日期"), h("span", null, TYPES[record.type]), h("span", null, VISIBILITY[record.visibility]), h("span", null, `修订 ${record.revision}`)),
    record.recallWarning && h("p", { className: "world-memory-record-warning", role: "status" }, record.recallWarning),
    record.conflictKey && h("p", { className: "world-memory-record-subnote" }, `冲突标识：${record.conflictKey}`),
    h("div", { className: "world-memory-record-actions" },
      button("编辑", () => beginEdit(record), !writable || record.status === "SUPERSEDED"),
      button(record.status === "ACTIVE" ? "隐藏" : "恢复生效", () => change(record, { status: record.status === "ACTIVE" ? "HIDDEN" : "ACTIVE", revisionReason: "玩家调整显示状态" }), !writable || record.status === "SUPERSEDED"),
      button("恢复自动来源", () => change(record, { status: "RETIRED", revisionReason: "撤销补充层记录，恢复自动来源" }), !writable || record.status === "SUPERSEDED"),
      button("查看修订", () => run(async sequence => { const records = await api.getCanonHistory({ token: data.branch.token, id: record.recordId }); if (mounted.current && sequence === request.current) setHistory({ id: record.recordId, offset: 0, records }); })),
      h("details", { className: "world-memory-developer" }, h("summary", null, "技术信息"), h("p", null, `Record：${record.recordId}`), h("p", null, `Branch：${record.branchId} · 替代：${record.supersedes || "—"}`))));

  const renderHistory = () => !history ? null : h("details", { className: "world-memory-history", open: true },
    h("summary", null, `修订记录 · ${history.records.length} 条`),
    history.records.map(record => h("p", { key: record.revision }, `#${record.revision} · ${record.updatedAt} · ${record.revisionReason} · ${STATUS[record.status]}：${record.content}`)),
    button("加载更早修订", () => run(async sequence => {
      const offset = history.offset + 20;
      const records = await api.getCanonHistory({ token: data.branch.token, id: history.id, offset });
      if (mounted.current && sequence === request.current) setHistory({ ...history, offset, records });
    }), busy || history.records.length < 20));

  const renderForm = () => h("div", { className: "world-memory-form" },
    h("div", { className: "world-memory-form-heading" }, h("h4", null, editing ? "编辑世界记忆" : "新增长期记忆"), editing && h("span", null, `修订 ${editing.revision}`)),
    field("title", "标题"),
    field("content", "RP 事实正文", true, "不要用 Canon 覆盖 CK3 当前地点、生死等结构化状态。"),
    h("div", { className: "world-memory-field-grid is-four" }, field("gameDate", "日期", false, "如 1171.9.20"), select("type", "类型", TYPES), select("visibility", "可见性", VISIBILITY), select("importance", "重要性", IMPORTANCE)),
    h("details", { className: "world-memory-advanced" },
      h("summary", null, "人物、授权与高级选项"),
      h("div", { className: "world-memory-field-grid" }, field("entities", "涉及人物 Runtime ID", false, "多个 ID 用逗号分隔"), field("knownBy", "授权知情人 Runtime ID", false, "个人 / 秘密必填")),
      ["COURT_PUBLIC", "REALM_PUBLIC"].includes(draft.visibility) && field("scopeEntityId", "范围基准人物 Runtime ID", false, "用于验证同宫廷 / 同领地"),
      field("conflictKey", "冲突标识", false, "同一事项的相反记录使用相同标识"),
      h("label", { className: "world-memory-check" }, h("input", { type: "checkbox", checked: draft.conversationStable === true, disabled: busy, onChange: event => setField("conversationStable", event.target.checked) }), h("span", null, "固定为会话高频规则")),
      h("small", { className: "world-memory-help" }, "仅限高 / 关键重要性的世界注释或政治决定；仍受权限、时间和 CK3 当前事实限制。")),
    h("div", { className: "world-memory-form-actions" },
      button(editing ? "保存修订" : "确认新增", () => save(editing ? "update" : "create"), !writable, "primary-button"),
      editing && button("以新记录替代", () => save("supersede"), !writable),
      editing && button("取消", () => { setEditing(null); setDraft({ ...empty(), gameDate: data.defaultGameDate || data.branch.gameDate || "" }); })));

  return h("section", { className: "worldline-card worldline-editor worldline-editor-v87" },
    h("div", { className: "world-memory-heading" }, h("div", null, h("h4", null, "世界记忆"), h("p", null, "保存 CK3 无法表达、但希望长期承认的 RP 事实。")), h("span", { className: `world-memory-version ${data ? "is-ready" : ""}` }, "V8.7")),
    button(data ? "刷新" : "打开世界记忆", () => run(sequence => load(sequence)), busy, "world-memory-refresh"),
    busy && h("p", { className: "world-memory-feedback", role: "status" }, "正在处理，请稍候……"),
    error && h("p", { className: "world-memory-feedback is-error", role: "alert" }, `操作未完成：${error}`),
    data && h("div", null,
      h("div", { className: "world-memory-status-grid" }, h("div", { className: "world-memory-status-card" }, h("span", null, "分支"), h("strong", { className: data.branch.branchId ? "is-ready" : "is-blocked" }, data.branch.branchId ? "已绑定当前分支" : "长期写入已阻止")), h("div", { className: "world-memory-status-card" }, h("span", null, "对话召回"), h("strong", { className: data.promptEnabled ? "is-ready" : "is-muted" }, data.promptEnabled ? "已开启" : "未开启")), h("div", { className: "world-memory-status-card" }, h("span", null, "本分支记录"), h("strong", null, `${data.total} 条`))),
      h("p", { className: "world-memory-quiet-note" }, data.promptEnabled ? "相关 Canon 会按人物权限和当前问题进入对话。" : "保存不会自动开启对话召回；请在设置中启用 Worldline Prompt Integration 和 PRODUCTION 模式。"),
      (!data.branch.branchId || data.branch.reason === "save_continuity_unverified") && h("details", { className: "world-memory-warning", open: true }, h("summary", null, data.branch.reason === "save_continuity_unverified" ? "存档连续性需要确认" : "分支尚未确认"), h("p", null, data.branch.reason === "save_continuity_unverified" ? "存档内容已变更。只有确定这是原分支的继续游玩时才确认；复制存档应建立独立分支。" : "请重新读取存档，或明确建立不继承旧 Canon 的独立分支。"), data.branch.reason === "save_continuity_unverified" && button("确认延续当前分支", () => run(async sequence => { await api.confirmCanonBranch(data.branch.token); await load(sequence); })), !data.branch.branchId && data.branch.campaignId && button("建立独立分支（不继承旧 Canon）", () => run(async sequence => { await api.forkCanonBranch(data.branch.token); await load(sequence); }))),
      data.renameCandidates?.length > 0 && h("details", { className: "world-memory-secondary-details" }, h("summary", null, "存档只是重命名？"), h("p", null, "只有内容指纹相同、且当前分支从未写入时，才保留原分支记忆。复制存档请保持独立。"), h("div", { className: "world-memory-inline-action" }, h("select", { value: renameSource, disabled: busy, onChange: event => setRenameSource(event.target.value), "aria-label": "重命名前的存档" }, h("option", { value: "" }, "选择原存档"), data.renameCandidates.map(item => h("option", { key: item.branchId, value: item.branchId }, item.sourcePath))), button("确认重命名", () => run(async sequence => { await api.renameCanonBranch({ token: data.branch.token, sourceBranchId: renameSource }); await load(sequence); }), busy || !renameSource))),
      h("details", { className: "world-memory-secondary-details" }, h("summary", null, "分支技术信息"), h("p", null, `Campaign：${data.branch.campaignId || "—"} · Branch：${data.branch.branchId || "—"} · Revision：${data.revision}`)),
      renderForm(),
      h("div", { className: "world-memory-list-heading" }, h("strong", null, "已有世界记忆"), h("span", null, `${data.records.length} / ${data.total}`)),
      data.records.length === 0 ? h("p", { className: "worldline-empty" }, "当前分支还没有长期记忆。") : h("div", { className: "world-memory-record-list" }, data.records.map(renderRecord)),
      h("div", { className: "world-memory-pagination" }, button("上一页", () => run(sequence => load(sequence, Math.max(0, data.offset - 20))), busy || !data.offset), button("下一页", () => run(sequence => load(sequence, data.offset + 20)), busy || data.offset + 20 >= data.total)),
      renderHistory())
  );
}
