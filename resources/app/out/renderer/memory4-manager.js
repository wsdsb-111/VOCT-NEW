const TABS = [["known", "人物认知"], ["official", "官方追忆"], ["detail", "详细长期记忆"], ["legacy", "Legacy 对话摘要"]];
const TYPES = { RELATIONSHIP_CHANGE: "关系变化", COMMITMENT: "承诺", DURABLE_KNOWLEDGE: "长期事实", MAJOR_EXPERIENCE: "重要经历", LONG_TERM_GOAL: "长期目标", EMOTIONAL_ANCHOR: "重要情感" };
const LEVELS = { DIRECT_INTERACTION: "直接交谈", DIRECT_OBSERVATION: "见过", SHARED_SCENE: "见过", MENTION_ONLY: "听说过", DIRECT_RELATIONSHIP: "关系证据", UNKNOWN: "未知（证据不足）" };
const RELATIONS = { friend: "朋友", best_friend: "至交", rival: "仇敌", nemesis: "死敌", lover: "情人", soulmate: "灵魂伴侣", spouse: "配偶" };
const COVERAGE_RELATIONS = { LEGACY_SOURCE_EXACT: "Legacy 来源已精确核对", SHARED_FRAGMENT_SOURCE: "共享来源有证据，事实未逐条核验",
  RELATED_FINALIZATION_ONLY: "同场相关，来源未逐条核验", LEGACY_ONLY: "仅 Legacy 保留", UNVERIFIED: "来源映射未验证",
  DURABLE_ONLY: "仅 Durable 保留", FORGOTTEN: "关联已撤销（Forget）", REVOKED: "关联条目已删除" };
const ERRORS = {
  legacy_binding_conversation_not_active: "尚未加载游戏对话。",
  legacy_binding_game_data_unavailable: "当前游戏数据尚不可用。",
  legacy_binding_campaign_not_loaded: "当前游戏数据缺少可确认的战役标识。",
  legacy_summary_binding_owner_not_in_current_campaign: "当前战役中无法确认此人物。",
  legacy_summary_binding_owner_not_unique_in_current_campaign: "当前战役中的人物标识存在冲突，已停止读取。",
  memory4_archive_scope_not_persisted: "找不到与已加载战役和人物完全匹配的已保存记忆。",
  memory4_archive_proof_unavailable: "无法验证已保存记忆的战役归属，已停止读取。",
  memory4_archive_read_only: "已加载战役归档仅供查阅，不能修改或重新生成。",
  memory4_campaign_changed: "战役已切换，请刷新后重试。",
  legacy_binding_conversation_changed: "游戏对话已切换，请刷新后重试。",
  memory4_revision_conflict: "记忆已发生变化，未覆盖内容。请刷新后重试。",
  memory4_disclosure_revision_conflict: "人物认知已发生变化，未覆盖标记。请刷新后重试。",
  memory4_owner_folder_not_unique: "此人物的摘要目录存在缺失或冲突。",
  memory4_compression_quality_failed: "模型压缩未通过预算、条件或日期校验，原始记忆已保留。可重新生成。",
  memory4_coverage_stale: "来源覆盖已变化，正在重新读取。",
  memory4_entry_expectation_invalid: "长期记忆版本已变化，请刷新后重试。",
  memory4_unavailable: "人物记忆暂不可用。"
};
const errorText = value => ERRORS[value] || (/revision|stale|source_changed/.test(String(value)) ? "来源或版本已变化，未覆盖内容。请刷新后重试。" : `操作未完成：${String(value || "未知错误").slice(0, 180)}`);
const eventDate = value => value?.from ? `${value.from}${value.to && value.to !== value.from ? ` - ${value.to}` : ""}` : "事件日期未知";

export function Memory4Manager({ react: R, ownerId, refreshKey, searchActive = false, legacyContent }) {
  const h = R.createElement;
  const api = window.conversationAPI;
  const [tab, setTab] = R.useState(searchActive ? "legacy" : "known");
  const [data, setData] = R.useState(null);
  const [loading, setLoading] = R.useState(false);
  const [busy, setBusy] = R.useState(false);
  const [message, setMessage] = R.useState("");
  const [error, setError] = R.useState("");
  const [entityId, setEntityId] = R.useState(null);
  const [entries, setEntries] = R.useState({});
  const [openEntryId, setOpenEntryId] = R.useState(null);
  const [expandedCoverageId, setExpandedCoverageId] = R.useState(null);
  const [coveragePages, setCoveragePages] = R.useState({});
  const [activeCoverageOffsets, setActiveCoverageOffsets] = R.useState({});
  const [coverageLoading, setCoverageLoading] = R.useState(false);
  const [coverageEntry, setCoverageEntry] = R.useState(null);
  const [editor, setEditor] = R.useState(null);
  const [sources, setSources] = R.useState(null);
  const requestSequence = R.useRef(0);
  const contextEpoch = R.useRef(0);
  const tabSelection = R.useRef(0);
  const coverageRequest = R.useRef(0);
  const expectedScope = data?.ownerId === ownerId ? { expectedCampaignToken: data.campaignToken, expectedContextId: data.contextId } : {};
  const scope = { ownerId, ...expectedScope };
  const load = async (options = {}) => {
    const sequence = ++requestSequence.current;
    coverageRequest.current++;
    setCoveragePages({});
    setActiveCoverageOffsets({});
    setExpandedCoverageId(null);
    setCoverageEntry(null);
    setEntries({});
    setOpenEntryId(null);
    setSources(null);
    setLoading(true);
    setCoverageLoading(false);
    setError("");
    try {
      const result = await api.getMemory4OwnerData({ ownerId, entityId, ...expectedScope, ...options });
      if (sequence !== requestSequence.current) return;
      if (!result?.success) { setData(null); setError(errorText(result?.error)); return; }
      if (data && (data.contextId !== result.contextId || data.readOnlyArchive !== result.readOnlyArchive || data.readOnlyReason !== result.readOnlyReason)) {
        setEditor(null); setSources(null);
      }
      setData(result);
      setEntries({});
      setOpenEntryId(null);
      setExpandedCoverageId(null);
      setCoveragePages({});
      setActiveCoverageOffsets({});
      setCoverageEntry(null);
    } catch (cause) {
      if (sequence === requestSequence.current) { setData(null); setError(errorText(cause?.message)); }
    } finally {
      if (sequence === requestSequence.current) setLoading(false);
    }
  };
  R.useEffect(() => {
    contextEpoch.current++;
    setData(null); setEditor(null); setSources(null); setEntries({}); setOpenEntryId(null); setExpandedCoverageId(null);
    setCoveragePages({}); setCoverageEntry(null); setBusy(false); setMessage(""); setEntityId(null);
    load({ entityId: null });
    return () => { requestSequence.current++; contextEpoch.current++; coverageRequest.current++; };
  }, [ownerId, refreshKey]);
  R.useEffect(() => { if (searchActive) { tabSelection.current++; coverageRequest.current++; setCoverageLoading(false); setTab("legacy"); } }, [searchActive]);
  R.useEffect(() => api.onConversationUpdate?.(async () => {
    const epoch = contextEpoch.current;
    let result;
    try { result = await api.getMemory4OwnerData({ ownerId, contextOnly: true }); }
    catch (cause) { result = { success: false, error: cause?.message }; }
    if (epoch !== contextEpoch.current) return;
    const contextChanged = data && (!result?.success || result.campaignToken !== data.campaignToken
      || result.contextId !== data.contextId || result.readOnlyArchive !== data.readOnlyArchive
      || result.readOnlyReason !== data.readOnlyReason);
    if (!result?.success || contextChanged) {
      requestSequence.current++;
      contextEpoch.current++;
      coverageRequest.current++;
      setData(null); setEditor(null); setSources(null); setEntries({}); setOpenEntryId(null); setExpandedCoverageId(null);
      setCoveragePages({}); setActiveCoverageOffsets({}); setCoverageEntry(null); setBusy(false); setLoading(false); setCoverageLoading(false); setMessage("");
      setError(errorText(result?.error || "memory4_campaign_changed"));
    }
  }), [ownerId, data?.campaignToken, data?.contextId, data?.readOnlyArchive, data?.readOnlyReason]);
  const button = (label, onClick, extra = {}) => h("button", { type: "button", onClick, disabled: busy || loading, ...extra }, label);
  const writeButton = (label, onClick, extra = {}) => button(label, onClick,
    { ...extra, disabled: !data || !!data.readOnlyArchive || busy || loading || !!extra.disabled });
  const showSources = async payload => {
    const epoch = contextEpoch.current;
    const sequence = requestSequence.current;
    const isCurrentRequest = () => epoch === contextEpoch.current && sequence === requestSequence.current;
    const recordStaleDrop = () => console.debug("[Memory4] sources_stale_response_dropped", { ownerId });
    setBusy(true);
    try {
      const result = await api.getMemory4Sources({ ...scope, ...payload });
      if (!isCurrentRequest()) { recordStaleDrop(); return; }
      if (!result?.success) throw new Error(result?.error);
      setSources(result.sources);
    } catch (cause) {
      if (isCurrentRequest()) setError(errorText(cause?.message));
      else recordStaleDrop();
    }
    finally { if (isCurrentRequest()) setBusy(false); }
  };
  const mutate = async (payload, closeEditor = false) => {
    if (!data || data.readOnlyArchive) { setError(errorText(data ? "memory4_archive_read_only" : "memory4_unavailable")); return; }
    const epoch = contextEpoch.current;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await api.mutateMemory4({ ...scope, ...payload });
      if (epoch !== contextEpoch.current) return;
      if (!result?.success) throw new Error(result?.error);
      const status = result.result?.status;
      if (["FAILED", "EXTRACTION_FAILED", "STALE"].includes(status)) throw new Error(result.result.reason || status);
      setMessage(["setManualDisclosure", "deleteDisclosure"].includes(payload.operation) ? "人物认知标记已更新。"
        : status === "IN_PROGRESS" ? "已有重压缩任务正在进行。" : status === "ALREADY_CONVERTED" ? "可核验内容已转为长期记忆，原摘要继续保留。"
          : status === "RETAINED_LEGACY" ? result.result.reason === "NO_DURABLE_CONTENT" ? "未提取出可确认的长期记忆，原摘要继续保留。" : "来源证据不足，原摘要继续保留。"
            : payload.operation === "deleteDetail" ? "已删除长期记忆。" : "记忆已更新。" );
      if (closeEditor) setEditor(null);
      await load({ entityId });
    } catch (cause) {
      if (epoch === contextEpoch.current) {
        setError(errorText(cause?.message));
      }
    }
    finally { if (epoch === contextEpoch.current) setBusy(false); }
  };
  const pages = (section, option) => section?.total > 40 && h("div", { className: "memory4-pager" },
    button("上一页", () => load({ [option]: Math.max(0, section.offset - 40), entityId }), { disabled: busy || loading || !section.offset }),
    h("span", null, `${section.offset + 1} - ${Math.min(section.total, section.offset + 40)} / ${section.total}`),
    button("下一页", () => load({ [option]: section.offset + 40, entityId }), { disabled: busy || loading || section.offset + 40 >= section.total }));
  const loadCoverage = async (summary, offset = 0, toggle = false) => {
    const token = ++coverageRequest.current;
    if (toggle && expandedCoverageId === summary.summaryId) {
      setExpandedCoverageId(null); setCoverageLoading(false); return;
    }
    if (!summary.summaryId) { setError("此旧摘要没有可验证的来源标识。"); return; }
    setExpandedCoverageId(summary.summaryId);
    setActiveCoverageOffsets(previous => ({ ...previous, [summary.summaryId]: offset }));
    const cached = coveragePages[summary.summaryId]?.[offset];
    const epoch = contextEpoch.current;
    const sequence = requestSequence.current;
    const selection = tabSelection.current;
    const isCurrent = () => epoch === contextEpoch.current && sequence === requestSequence.current
      && selection === tabSelection.current && token === coverageRequest.current;
    setCoverageLoading(true);
    setError("");
    try {
      const result = await api.getMemory4Coverage({ ...scope, finalizationId: summary.finalizationId,
        legacyMemoryId: summary.summaryId, offset, limit: cached ? 1 : 40,
        expectedIndexRevision: data.coverageSummary.indexRevision, expectedSummaryHash: summary.summaryHash });
      if (!isCurrent()) return;
      if (!result?.success) throw new Error(result?.error);
      if (result.status === "STALE") {
        setCoveragePages({});
        setActiveCoverageOffsets({});
        setMessage("来源版本已变化，旧详情已撤回。");
        setError(errorText("memory4_coverage_stale"));
        await load({ entityId, legacyOffset: data.coverageSummary.offset });
        return;
      }
      const page = cached && cached.indexRevision === result.indexRevision && cached.summaryHash === result.summaryHash ? cached : result;
      if (cached && page !== cached) { await load({ entityId }); return; }
      setCoveragePages(previous => ({ ...previous, [summary.summaryId]: { ...(previous[summary.summaryId] || {}), [offset]: page } }));
    } catch (cause) {
      if (isCurrent()) {
        if (cached) setCoveragePages(previous => {
          const pages = { ...previous[summary.summaryId] };
          delete pages[offset];
          return { ...previous, [summary.summaryId]: pages };
        });
        setError(errorText(cause?.message));
      }
    } finally {
      if (isCurrent()) setCoverageLoading(false);
    }
  };
  const showCoverageEntry = async (entryRef, page) => {
    const epoch = contextEpoch.current;
    const sequence = requestSequence.current;
    const selection = tabSelection.current;
    const token = ++coverageRequest.current;
    const isCurrent = () => epoch === contextEpoch.current && sequence === requestSequence.current
      && selection === tabSelection.current && token === coverageRequest.current;
    setCoverageLoading(true);
    setError("");
    try {
      const result = await api.getMemory4Entry({ ...scope, entryId: entryRef.entryId,
        expectedIndexRevision: page.indexRevision, expectedEntryRevision: entryRef.revision, expectedBodyHash: entryRef.bodyHash });
      if (!isCurrent()) return;
      if (!result?.success) throw new Error(result?.error);
      if (result.status === "STALE") {
        setCoverageEntry(null);
        setMessage("来源版本已变化，旧详情已撤回。");
        setError(errorText("memory4_coverage_stale"));
        await load({ entityId, legacyOffset: data.coverageSummary.offset });
        return;
      }
      setCoverageEntry(result.entry);
      setCoverageLoading(false);
      tabSelection.current++;
      setTab("detail");
    } catch (cause) {
      if (isCurrent()) setError(errorText(cause?.message));
    } finally {
      if (isCurrent()) setCoverageLoading(false);
    }
  };
  const durable = data?.coverageSummary?.latest?.durable;
  const durableOnly = data?.coverageSummary?.latest?.durableOnly;
  const recovery = data?.coverageSummary?.recovery || {};
  const durableStatusText = !durable ? "没有可验证的 Durable 提交记录。"
    : durable.commitState === "UNVERIFIED" || durable.coverageState === "UNVERIFIED_LEGACY" ? "旧记录没有足够的来源证明，无法计算覆盖情况。"
      : durable.commitState === "NOT_PRESENT" ? "本次没有可处理的对话来源，未进行 Durable 提取。"
      : durable.coverageState === "FULL_MODEL_EVALUATED" ? `全部计划来源已通过模型评估；当前有效保存 ${durable.committed ?? "未知"} 条。`
        : durable.coverageState === "CAPPED" ? `8 条配额已满；仍有 ${durable.sourceCounts?.unmodeled ?? "未知"} 个来源片段未经过模型评估，对话与 Legacy 保留。`
          : durable.coverageState === "NO_DURABLE_CONTENT_VERIFIED" ? durable.sourceCounts?.authorized === 0
            ? "没有已授权来源片段可供模型评估；Legacy 对话摘要仍保留。"
            : "本次模型评估后没有符合存储条件的长期事项。"
            : durable.coverageState === "LOCAL_FILTERED" ? `部分来源由本地规则排除；模型评估 ${durable.sourceCounts?.modelEvaluated ?? "未知"} 个来源。`
              : durable.coverageState === "PARTIAL_SOURCE" ? `部分来源经过模型评估；尚有 ${durable.sourceCounts?.unmodeled ?? "未知"} 个来源未完整评估。`
                : durable.coverageState === "FAILED" ? "Durable 提取失败，恢复记录已保留；Legacy 对话摘要仍可查看。"
                : "Durable 覆盖状态未知。";
  const disclosureKnown = fact => !!fact.currentDirectObservation || !!fact.effectiveKnown && fact.status !== "MANUAL_HIDDEN";
  const disclosureFactRef = fact => ({ factType: fact.factType, factKey: fact.factKey, value: fact.value });
  const disclosureAction = (profile, fact) => {
    const request = { entityId: profile.entityId, factRef: disclosureFactRef(fact), expectedRevision: fact.revision };
    if (fact.effectiveKnown && fact.status !== "MANUAL_HIDDEN") {
      if (!window.confirm("将此事实从该人物的 Owner 认知中设为未知？")) return;
      mutate({ operation: "deleteDisclosure", ...request });
    }
    else mutate({ operation: "setManualDisclosure", status: "MANUAL_KNOWN", ...request });
  };
  const disclosureFactRow = (profile, fact) => {
    const directlyObservable = !!fact.currentDirectObservation;
    const known = disclosureKnown(fact);
    const evidence = Object.values(fact.evidenceBySource || {});
    const hasObservationEvidence = fact.sourceKind === "DIRECT_OBSERVATION" || !!fact.evidenceBySource?.DIRECT_OBSERVATION;
    const source = directlyObservable ? "当前可直接观察" : hasObservationEvidence ? "直接观察"
      : fact.status === "AUTO_DISCLOSED" ? [...new Set(evidence.map(row => row.sourceKind)
      .filter(Boolean).map(kind => kind === "LETTER" ? "信件公开" : kind === "CONVERSATION" ? "对话公开" : "结构化来源"))].join("、") || "对话公开"
      : fact.status === "MANUAL_KNOWN" ? "手动标记" : "尚未获知";
    const acquiredDate = fact.firstAcquiredDate || fact.manualMarkedDate || evidence[0]?.acquiredDate || "未知";
    return h("div", { className: "memory4-disclosure-row", key: fact.factId },
      h("strong", null, fact.factType === "AGE" ? `披露时年龄：${fact.value}岁` : `${fact.factType === "TITLE" ? "头衔" : "特质"}：${fact.value}`),
      h("span", { className: "memory4-meta" }, fact.factType === "AGE"
        ? `来源：${source} · 获知时间：${acquiredDate} · 历史披露记录`
        : data.readOnlyArchive
        ? `${fact.status === "MANUAL_HIDDEN" ? "手动设为未知" : `来源：${source}`} · 获知时间：${acquiredDate} · 当前状态未回读`
        : known ? `来源：${source} · 获知时间：${acquiredDate}`
          : fact.status === "MANUAL_HIDDEN" ? "你已将此项设为未知。" : "当前未标记为已知。"),
      fact.factType !== "AGE" && !data.readOnlyArchive && !directlyObservable && writeButton(known ? "设为未知" : "设为已知", () => disclosureAction(profile, fact),
        { disabled: busy || loading, title: known ? "从此 Owner 的人物认知中隐藏此事实" : "将此当前事实标记为此 Owner 已知" }));
  };
  const editButton = (payload, text, title) => writeButton("编辑", () => setEditor({ ...payload, text, title }));
  let content;
  if (tab === "legacy") content = h(R.Fragment, null,
    data && h("section", { className: "memory4-coverage" }, h("h5", null, "Legacy 来源关联"),
      h("p", { className: "memory4-meta" }, "只显示当前人物与战役中可验证的来源关系。来源关联不代表两份文字语义等价；未评估不代表内容丢失。"),
      data.coverageSummary.summaries.length ? data.coverageSummary.summaries.map(summary => {
        const stats = summary.legacy;
        const page = coverageLoading ? null : coveragePages[summary.summaryId]?.[activeCoverageOffsets[summary.summaryId] ?? 0];
        return h("article", { className: "memory4-coverage-summary", key: summary.summaryId || summary.finalizationId || "unverified" },
          h("div", { className: "memory4-coverage-summary-heading" },
            h("strong", null, summary.summaryId || "来源标识未知的旧摘要"),
            h("span", null, `重要事项：${stats.importantItemCount == null ? "未知" : stats.importantItemCount}`)),
          h("p", null, `来源可证实关联：${stats.importantItemCount == null ? `${stats.provenSourceLinkedCount} 条（分母未知）` : `${stats.provenSourceLinkedCount} / ${stats.importantItemCount}`}；同场相关 ${stats.sourceRelatedOnlyCount}；仅 Legacy 保留 ${stats.legacyOnlyCount}；映射未知 ${stats.unverifiedCount}；已撤销 ${stats.forgottenCount + stats.revokedCount}。`),
          button(expandedCoverageId === summary.summaryId ? "收起来源覆盖详情" : "展开来源覆盖详情", () => loadCoverage(summary, activeCoverageOffsets[summary.summaryId] ?? 0, true),
            { disabled: coverageLoading || !summary.summaryId }),
          expandedCoverageId === summary.summaryId && h("div", { className: "memory4-coverage-page" },
            coverageLoading && h("p", { className: "memory4-meta", role: "status" }, "正在验证来源…"),
            page?.durableOnly && h("div", { className: "memory4-durable-only" },
              h("span", null, page.durableOnly.count == null ? "仅 Durable 保留数量未知（部分 Legacy 来源无法验证）。"
                : `仅 Durable 保留：${page.durableOnly.count} 条；没有可读 Legacy 事项与之对应。`),
              (page.durableOnly.entries || []).map(entryRef => button("查看 Durable", () => showCoverageEntry(entryRef, page),
                { key: `durable-only-${entryRef.entryId}`, disabled: coverageLoading }))),
            page?.items.map((item, index) => h("div", { className: "memory4-coverage-row", key: item.legacyMemoryId || `${summary.summaryId}-${index}` },
              h("span", null, item.legacyMemoryId || "旧记录来源未知"),
              h("span", null, COVERAGE_RELATIONS[item.relation] || "来源映射未知"),
              item.completeMigrationProof && h("span", { className: "memory4-meta" }, "完整迁移证明"),
              (item.durableEntries || []).map(entryRef => button("查看 Durable", () => showCoverageEntry(entryRef, page),
                { key: entryRef.entryId, disabled: coverageLoading })))),
            page && page.total > 40 && h("div", { className: "memory4-pager" },
              button("上一页", () => loadCoverage(summary, Math.max(0, page.offset - 40)), { disabled: coverageLoading || !page.offset }),
              h("span", null, `${page.offset + 1} - ${Math.min(page.total, page.offset + 40)} / ${page.total}`),
              button("下一页", () => loadCoverage(summary, page.offset + 40), { disabled: coverageLoading || page.offset + 40 >= page.total })),
            page && !page.items.length && h("p", { className: "memory4-empty" }, "没有可显示的来源关联。")));
      }) : h("p", { className: "memory4-empty" }, data.coverageSummary.legacy.importantItemCount == null
        ? "旧摘要没有可验证的重要事项标识，来源关联数量未知。" : "当前页没有可验证的 Legacy 来源关联。"),
      data.coverageSummary.total > 40 && h("div", { className: "memory4-pager" },
        button("上一页旧摘要", () => load({ legacyOffset: Math.max(0, data.coverageSummary.offset - 40), entityId }),
          { disabled: loading || data.coverageSummary.offset === 0 }),
        h("span", null, `${data.coverageSummary.offset + 1} - ${Math.min(data.coverageSummary.total, data.coverageSummary.offset + 40)} / ${data.coverageSummary.total}`),
        button("下一页旧摘要", () => load({ legacyOffset: data.coverageSummary.offset + 40, entityId }),
          { disabled: loading || data.coverageSummary.offset + 40 >= data.coverageSummary.total }))),
    data && h("details", { className: "memory4-coverage memory4-recompression-coverage" }, h("summary", null, "旧摘要重压缩状态"),
      h("p", null, `旧摘要：${data.legacy.total}；可重压缩：${data.legacy.counts.eligible ?? "未知"}；部分覆盖：${data.legacy.counts.partial ?? "未知"}；保留原文：${data.legacy.counts.retained ?? "未知"}。`),
      data.legacy.recompressionCoverage.items.map(item => h("div", { className: "memory4-legacy-row", key: item.memoryId },
        h("code", null, item.memoryId), h("span", null, item.partial ? "部分覆盖，剩余事实保留" : item.eligible ? "来源可核验" : "来源证据不足，保留原文"),
        writeButton("重压缩为长期记忆", () => {
          if (window.confirm("将使用当前摘要模型重压缩这篇旧摘要中可核验的内容，可能产生 API 费用。原摘要继续保留。继续？")) mutate({ operation: "recompressLegacy", memoryId: item.memoryId, expectedSourceHash: item.sourceHash });
        }, { disabled: busy || loading || !item.eligible }))), pages(data.legacy.recompressionCoverage, "legacyOffset")), legacyContent);
  else if (!data) content = h("p", { className: "memory4-empty" }, loading ? "读取人物记忆中…" : "人物记忆尚不可用。");
  else if (tab === "known") content = h(R.Fragment, null,
    data.known.items.length ? data.known.items.map(profile => {
      const recognition = profile.recognition;
      const relation = profile.relationship?.status === "CONFIRMED" ? profile.relationship.types.map(type => RELATIONS[type] || type).join(" / ") : "未知";
      const count = value => `${value || 0} 次${recognition.evidenceCompleteness === "complete" ? "" : "（部分记录）"}`;
      const facts = Array.isArray(profile.disclosedFacts) ? profile.disclosedFacts.filter(fact => data.readOnlyArchive
        ? fact.current === false : fact.current === true || fact.factType === "AGE" && fact.effectiveKnown) : [];
      const titles = facts.filter(fact => fact.factType === "TITLE");
      const traits = facts.filter(fact => fact.factType === "TRAIT");
      const ages = facts.filter(fact => fact.factType === "AGE" && fact.effectiveKnown);
      const currentAge = !data.readOnlyArchive && ages.find(fact => Number.isSafeInteger(fact.currentKnownAge)
        && fact.currentKnownAge >= 0 && fact.currentAgeReadDate);
      const knownTitles = titles.filter(disclosureKnown);
      const knownTraits = traits.filter(disclosureKnown);
      return h("article", { className: "memory4-entity", key: profile.entityId }, h("h5", null, profile.displayName),
        h("dl", null, ...[["认识方式", LEVELS[recognition.level] || "未知（证据不足）"], [data.readOnlyArchive ? "当前关系（未回读）" : "当前关系", relation], ["直接交谈", count(recognition.directConversationCount)],
          ["共同场景", count(recognition.sharedSceneCount)], ["提及", count(recognition.mentionCount)], ["首次记录", recognition.firstSeen || "未知"],
          ["最近记录", recognition.lastSeen || "未知"], ["证据完整度", recognition.evidenceCompleteness === "complete" ? "完整" : recognition.evidenceCompleteness === "legacy_partial" ? "旧记录不完整" : "部分"]]
          .flatMap(([label, value]) => [h("dt", { key: label }, label), h("dd", { key: `${label}-value` }, value)])),
        profile.nickname && h("p", { className: "memory4-meta memory4-nickname" }, `称号：${profile.nickname} · 默认可见`),
        h("section", { className: "memory4-disclosures" }, h("h6", null, "人物认知"), data.readOnlyArchive
          ? h(R.Fragment, null, h("strong", null, "归档披露记录"), facts.length ? facts.map(fact => disclosureFactRow(profile, fact))
            : h("p", { className: "memory4-empty" }, "没有已保存的披露记录。"))
          : h(R.Fragment, null,
            h("strong", null, "已知头衔"), knownTitles.length ? knownTitles.map(fact => disclosureFactRow(profile, fact)) : h("p", { className: "memory4-empty" }, "暂无已知头衔。"),
            h("details", null, h("summary", null, `当前头衔候选（${titles.length - knownTitles.length}）`),
              titles.filter(fact => !knownTitles.includes(fact)).map(fact => disclosureFactRow(profile, fact))),
            h("strong", null, "已知特质"), knownTraits.length ? knownTraits.map(fact => disclosureFactRow(profile, fact)) : h("p", { className: "memory4-empty" }, "暂无已知特质。"),
            h("details", null, h("summary", null, `当前特质候选（${traits.length - knownTraits.length}）`),
              traits.filter(fact => !knownTraits.includes(fact)).map(fact => disclosureFactRow(profile, fact))),
            h("strong", null, "已披露年龄"), currentAge && h("div", { className: "memory4-disclosure-row" },
              h("strong", null, `当前年龄：${currentAge.currentKnownAge}岁`),
              h("span", { className: "memory4-meta" }, `来源：CK3 · 读取日期：${currentAge.currentAgeReadDate}`)),
            ages.length ? ages.map(fact => disclosureFactRow(profile, fact))
              : h("p", { className: "memory4-empty" }, "暂无已披露年龄。"))),
        button("查看相关记忆", () => { tabSelection.current++; coverageRequest.current++; setCoverageLoading(false); setEntityId(profile.entityId); setTab("detail"); load({ entityId: profile.entityId }); }));
    }) : h("p", { className: "memory4-empty" }, "暂无可确认的人物认知记录。"), pages(data.known, "knownOffset"));
  else if (tab === "official") content = h(R.Fragment, null,
    h("p", { className: "memory4-meta" }, "来源：CK3 · 只读"),
    data.official.length ? data.official.map((record, index) => h("section", { className: "memory4-official", key: index },
      h("small", null, `采集日期：${record.captureGameDate || "未知"}`), h("p", { className: "memory4-text" }, record.content))) : h("p", { className: "memory4-empty" }, "当前战役尚未导出此人物的官方追忆。"));
  else if (tab === "detail") content = h(R.Fragment, null,
    h("section", { className: "memory4-durable-status", "aria-label": "Durable 状态" },
      h("strong", null, "Durable 状态"), h("p", null, durableStatusText),
      durable && durable.sourceCounts && durable.sourceCountPrecision !== "UNKNOWN" && h("p", { className: "memory4-meta" },
        `来源：${durable.sourceCounts.authorized ?? "未知"} 个授权片段；${durable.sourceCounts.modelEvaluated ?? "未知"} 个经过模型评估；${durable.sourceCounts.unmodeled ?? "未知"} 个未评估。`),
      durableOnly && h("p", { className: "memory4-meta" }, durableOnly.count == null
        ? "仅 Durable 保留数量未知（部分 Legacy 来源无法验证）。" : `仅 Durable 保留：${durableOnly.count} 条。`),
      recovery.pending > 0 && h("p", { className: "memory4-meta", role: "status" },
        `Durable 尚未全部成功写入：本人物有 ${recovery.pending} 个恢复任务待处理，其中 ${recovery.manual || 0} 个需要人工处理${recovery.balanceBlocked ? `，${recovery.balanceBlocked} 个因余额不足暂缓` : ""}。`),
      durable?.retractedCount > 0 && h("p", { className: "memory4-meta" }, `已匿名排除 ${durable.retractedCount} 个 Forget 或删除的条目。`)),
    entityId && h("div", { className: "memory4-actions" }, h("span", null, "仅显示相关人物记忆"), button("显示全部", () => { setEntityId(null); load({ entityId: null }); })),
    coverageEntry && h("article", { className: "memory4-detail memory4-coverage-entry" },
      h("strong", null, "来自 Legacy 来源覆盖的 Durable"), h("p", { className: "memory4-text" }, coverageEntry.text),
      h("p", { className: "memory4-meta" }, `交谈日期：${coverageEntry.conversationDate || "未知"} · 获知日期：${coverageEntry.acquiredDate || "未知"}`),
      h("div", { className: "memory4-actions" }, editButton({ operation: "updateDetail", entryId: coverageEntry.entryId,
        expectedRevision: coverageEntry.revision }, coverageEntry.text, "详细长期记忆"),
      button("查看来源", () => showSources({ kind: "detail", entryId: coverageEntry.entryId })),
      writeButton("删除", () => {
        if (window.confirm("删除这条长期记忆？")) mutate({ operation: "deleteDetail", entryId: coverageEntry.entryId, expectedRevision: coverageEntry.revision });
      }, { className: "danger-button" }))),
    data.detail.items.length ? data.detail.items.map(row => {
      const entry = entries[row.entryId];
      return h("details", { className: "memory4-detail", key: row.entryId, open: openEntryId === row.entryId },
        h("summary", { onClick: async event => {
          event.preventDefault();
          if (openEntryId === row.entryId) { setOpenEntryId(null); return; }
          setOpenEntryId(row.entryId);
          if (entry) return;
          const epoch = contextEpoch.current;
          const sequence = requestSequence.current;
          try {
            const result = await api.getMemory4Entry({ ...scope, entryId: row.entryId,
              expectedIndexRevision: data.indexRevision, expectedEntryRevision: row.revision, expectedBodyHash: row.bodyHash });
            if (epoch !== contextEpoch.current || sequence !== requestSequence.current) return;
            if (!result?.success) throw new Error(result?.error);
            if (result.status === "STALE") {
              setError(errorText("memory4_coverage_stale"));
              await load({ entityId });
              return;
            }
            setEntries(previous => ({ ...previous, [row.entryId]: result.entry }));
          } catch (cause) { if (epoch === contextEpoch.current && sequence === requestSequence.current) setError(errorText(cause?.message)); }
        } }, `${TYPES[row.memoryType] || "长期记忆"} · ${eventDate(row.eventTime)}`),
        entry ? h(R.Fragment, null, h("p", { className: "memory4-text" }, entry.text),
          h("p", { className: "memory4-meta" }, `交谈日期：${entry.conversationDate || "未知"} · 获知日期：${entry.acquiredDate || "未知"}`),
          h("div", { className: "memory4-actions" }, editButton({ operation: "updateDetail", entryId: entry.entryId, expectedRevision: entry.revision }, entry.text, "详细长期记忆"),
            button("查看来源", () => showSources({ kind: "detail", entryId: entry.entryId })), writeButton("删除", () => {
              if (window.confirm("删除这条长期记忆？")) mutate({ operation: "deleteDetail", entryId: entry.entryId, expectedRevision: entry.revision });
            }, { className: "danger-button" }))) : h("p", null, "读取正文中…"));
    }) : h("p", { className: "memory4-empty" }, data.generation.lastStatus === "NO_DURABLE_CONTENT"
      ? `最近一次归档未提取出可确认的长期事实；Legacy 对话摘要仍保留（${data.generation.noDurableContentCount} 次无长期事实结果）。`
      : "暂无详细长期记忆。"), pages(data.detail, "detailOffset"));
  return h("div", { className: `memory4-manager${data ? "" : " memory4-context-unavailable"}` },
    h("div", { className: "memory4-heading" }, h("strong", null, "人物记忆"), button("\u21bb", () => load({ entityId, refreshCurrentFacts: true }), { title: "刷新人物记忆", "aria-label": "刷新人物记忆" })),
    h("nav", { className: "memory4-tabs", role: "tablist", "aria-label": "人物记忆" }, TABS.map(([key, label]) => h("button", {
      key, type: "button", role: "tab", "aria-selected": tab === key, onClick: () => { tabSelection.current++; coverageRequest.current++; setCoverageLoading(false); setTab(key); }, className: tab === key ? "active" : ""
    }, label))),
    data?.readOnlyArchive && h("div", { className: "memory4-conflict memory4-archive-notice", role: "status" },
      data.readOnlyReason === "conversation_ended"
        ? `已结束对话所属战役的已保存归档${data.archiveAsOfDate ? `（截至 ${data.archiveAsOfDate}）` : ""}，仅供查阅；当前关系和 CK3 人物状态未重新回读。`
        : `此为已加载战役中该人物的已保存归档${data.archiveAsOfDate ? `（截至 ${data.archiveAsOfDate}）` : ""}，仅供查阅；当前人物关系和状态未重新回读。`),
    error && h("p", { className: "memory4-error", role: "alert" }, error), message && h("p", { role: "status" }, message),
    (busy || loading) && h("p", { role: "status" }, busy ? "处理中…" : "读取中…"),
    coverageLoading && h("p", { className: "memory4-meta", role: "status" }, "正在读取并验证来源覆盖…"),
    h("div", { className: "memory4-panel", role: "tabpanel" }, content),
    editor && h("div", { className: "modal-overlay" }, h("form", { className: "modal-content memory4-modal", onSubmit: event => { event.preventDefault(); mutate(editor, true); } },
      h("div", { className: "modal-header" }, h("h4", null, `编辑${editor.title}`), button("\u00d7", () => setEditor(null), { title: "关闭编辑", "aria-label": "关闭编辑" })),
      h("div", { className: "modal-body" }, h("textarea", { "aria-label": "记忆正文", value: editor.text, rows: 10, maxLength: 16384,
        disabled: busy || data?.readOnlyArchive, onChange: event => setEditor({ ...editor, text: event.target.value }) }),
        error && h("p", { role: "alert", className: "memory4-error" }, error)),
      h("div", { className: "modal-footer" }, button("取消", () => setEditor(null)), h("button", { type: "submit", className: "primary-button",
        disabled: busy || data?.readOnlyArchive || !editor.text.trim() }, busy ? "保存中…" : "保存")))),
    sources && h("div", { className: "modal-overlay" }, h("section", { className: "modal-content memory4-modal", role: "dialog", "aria-label": "记忆来源" },
      h("div", { className: "modal-header" }, h("h4", null, "记忆来源"), button("\u00d7", () => setSources(null), { title: "关闭来源", "aria-label": "关闭来源" })),
      h("div", { className: "modal-body" }, sources.changed && h("p", { className: "memory4-conflict" }, "底层来源或版本已变化。"),
        (sources.missingEntryIds || []).length > 0 && h("p", null, `缺失来源：${sources.missingEntryIds.length} 条`),
        sources.entries.map(entry => h("article", { className: "memory4-source", key: entry.entryId },
          h("strong", null, `${eventDate(entry.eventTime)} · 版本 ${entry.revision}`),
          h("p", { className: "memory4-meta" }, `交谈日期：${entry.conversationDate || "未知"} · 获知日期：${entry.acquiredDate || "未知"}`),
          (entry.deleted || entry.sourceValid === false) && h("p", { className: "memory4-error" }, entry.deleted ? "来源已删除" : "来源已失效"),
          h("p", { className: "memory4-text" }, entry.text), h("details", null, h("summary", null, "来源标识与可见性"),
            h("pre", null, JSON.stringify({ entryId: entry.entryId, source: entry.source, evidence: entry.evidence }, null, 2))))),
        !sources.entries.length && h("p", null, "暂无有效来源。")))));
}
