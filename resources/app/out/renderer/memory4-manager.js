const TABS = [["known", "人物认知"], ["official", "官方追忆"], ["life", "人生记忆"], ["year", "年度记忆"], ["detail", "详细长期记忆"], ["legacy", "Legacy 对话摘要"]];
const TYPES = { RELATIONSHIP_CHANGE: "关系变化", COMMITMENT: "承诺", DURABLE_KNOWLEDGE: "长期事实", MAJOR_EXPERIENCE: "重要经历", LONG_TERM_GOAL: "长期目标", EMOTIONAL_ANCHOR: "重要情感" };
const LEVELS = { DIRECT_INTERACTION: "直接交谈", DIRECT_OBSERVATION: "见过", SHARED_SCENE: "见过", MENTION_ONLY: "听说过", DIRECT_RELATIONSHIP: "关系证据", UNKNOWN: "未知（证据不足）" };
const RELATIONS = { friend: "朋友", best_friend: "至交", rival: "仇敌", nemesis: "死敌", lover: "情人", soulmate: "灵魂伴侣", spouse: "配偶" };
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
  memory4_derived_revision_conflict: "来源或版本已变化，未覆盖内容。请刷新后重试。",
  memory4_disclosure_revision_conflict: "人物认知已发生变化，未覆盖标记。请刷新后重试。",
  memory4_owner_folder_not_unique: "此人物的摘要目录存在缺失或冲突。",
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
  const [editor, setEditor] = R.useState(null);
  const [sources, setSources] = R.useState(null);
  const requestSequence = R.useRef(0);
  const contextEpoch = R.useRef(0);
  const expectedScope = data?.ownerId === ownerId ? { expectedCampaignToken: data.campaignToken, expectedContextId: data.contextId } : {};
  const scope = { ownerId, ...expectedScope };
  const load = async (options = {}) => {
    const sequence = ++requestSequence.current;
    setLoading(true);
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
    } catch (cause) {
      if (sequence === requestSequence.current) { setData(null); setError(errorText(cause?.message)); }
    } finally {
      if (sequence === requestSequence.current) setLoading(false);
    }
  };
  R.useEffect(() => {
    contextEpoch.current++;
    setData(null); setEditor(null); setSources(null); setEntries({}); setOpenEntryId(null); setBusy(false); setMessage(""); setEntityId(null);
    load({ entityId: null });
    return () => { requestSequence.current++; contextEpoch.current++; };
  }, [ownerId, refreshKey]);
  R.useEffect(() => { if (searchActive) setTab("legacy"); }, [searchActive]);
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
      setData(null); setEditor(null); setSources(null); setEntries({}); setOpenEntryId(null); setBusy(false); setLoading(false); setMessage("");
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
    const isCancel = payload.operation === "cancelDerived";
    if (!isCancel) setBusy(true);
    setError("");
    setMessage("");
    const refreshTimer = payload.operation === "rebuild" ? setTimeout(() => {
      if (epoch === contextEpoch.current) load({ entityId });
    }, 150) : null;
    try {
      const result = await api.mutateMemory4({ ...scope, ...payload });
      if (epoch !== contextEpoch.current) return;
      if (!result?.success) throw new Error(result?.error);
      const status = result.result?.status;
      if (["FAILED", "EXTRACTION_FAILED", "STALE"].includes(status)) throw new Error(result.result.reason || status);
      setMessage(["setManualDisclosure", "deleteDisclosure"].includes(payload.operation) ? "人物认知标记已更新。"
        : payload.operation === "cancelDerived" ? "已请求停止派生记忆任务。" : payload.operation === "keepManual" ? "已保留手工文本；底层记忆变化仍待处理。"
        : status === "IN_PROGRESS" ? "已有重压缩任务正在进行。" : status === "ALREADY_CONVERTED" ? "可核验内容已转为长期记忆，原摘要继续保留。"
          : status === "RETAINED_LEGACY" ? result.result.reason === "NO_DURABLE_CONTENT" ? "未提取出可确认的长期记忆，原摘要继续保留。" : "来源证据不足，原摘要继续保留。"
          : status === "CANCELLED" ? "任务已停止。" : status === "MANUAL_OVERRIDE" ? "手工版本已保留，自动生成未覆盖。"
            : payload.operation === "deleteDetail" ? "已删除长期记忆。" : "记忆已更新。" );
      if (closeEditor) setEditor(null);
      await load({ entityId });
    } catch (cause) { if (epoch === contextEpoch.current) setError(errorText(cause?.message)); }
    finally { clearTimeout(refreshTimer); if (!isCancel && epoch === contextEpoch.current) setBusy(false); }
  };
  const regenerate = (kind, view, extra = {}) => {
    if (!data || data.readOnlyArchive) { setError(errorText(data ? "memory4_archive_read_only" : "memory4_unavailable")); return; }
    const manual = kind === "year" ? view.generationMode === "manual_override" || view.manual?.mode === "manual_override"
      : extra.segmentId ? view.segments?.find(segment => segment.segmentId === extra.segmentId)?.manual?.mode === "manual_override" : view.manual?.mode === "manual_override";
    if (!window.confirm(manual ? "重新生成将覆盖这个阶段的手工版本，并使用当前摘要模型。继续？" : "将使用当前摘要模型从有效来源生成记忆，可能产生 API 费用。继续？")) return;
    mutate({ operation: "rebuild", kind, expectedRevision: view.revision || 0, overwriteManual: !!manual, ...extra });
  };
  const conflict = (kind, view, extra = {}) => {
    const manual = kind === "year" ? view.generationMode === "manual_override" || view.manual?.mode === "manual_override"
      : view.segments?.find(segment => segment.segmentId === extra.segmentId)?.manual?.mode === "manual_override" || view.manual?.mode === "manual_override";
    if (!view.dirty) return null;
    return h("div", { className: "memory4-conflict", role: "status" }, h("strong", null, "底层记忆已变化"),
      button("查看来源变化", () => showSources({ kind, ...extra })),
      manual && writeButton("保留手工版本", () => mutate({ operation: "keepManual", kind, expectedRevision: view.revision, ...extra })),
      writeButton(manual ? "重新生成并覆盖" : "从来源重新生成", () => regenerate(kind, view, extra)));
  };
  const pages = (section, option) => section?.total > 40 && h("div", { className: "memory4-pager" },
    button("上一页", () => load({ [option]: Math.max(0, section.offset - 40), entityId }), { disabled: busy || loading || !section.offset }),
    h("span", null, `${section.offset + 1} - ${Math.min(section.total, section.offset + 40)} / ${section.total}`),
    button("下一页", () => load({ [option]: section.offset + 40, entityId }), { disabled: busy || loading || section.offset + 40 >= section.total }));
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
    data && h("details", { className: "memory4-coverage" }, h("summary", null, "Legacy 来源与覆盖"),
      h("p", null, `旧摘要：${data.legacy.total}；可重压缩：${data.legacy.counts.eligible || 0}；部分覆盖：${data.legacy.counts.partial || 0}；保留原文：${data.legacy.counts.retained || 0}。`),
      data.legacy.items.map(item => h("div", { className: "memory4-legacy-row", key: item.memoryId },
        h("code", null, item.memoryId), h("span", null, item.partial ? "部分覆盖，剩余事实保留" : item.eligible ? "来源可核验" : "来源证据不足，保留原文"),
        writeButton("重压缩为长期记忆", () => {
          if (window.confirm("将使用当前摘要模型重压缩这篇旧摘要中可核验的内容，可能产生 API 费用。原摘要继续保留。继续？")) mutate({ operation: "recompressLegacy", memoryId: item.memoryId, expectedSourceHash: item.sourceHash });
        }, { disabled: busy || loading || !item.eligible })))), legacyContent);
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
        button("查看相关记忆", () => { setEntityId(profile.entityId); setTab("detail"); load({ entityId: profile.entityId }); }));
    }) : h("p", { className: "memory4-empty" }, "暂无可确认的人物认知记录。"), pages(data.known, "knownOffset"));
  else if (tab === "official") content = h(R.Fragment, null,
    h("p", { className: "memory4-meta" }, "来源：CK3 · 只读"),
    data.official.length ? data.official.map((record, index) => h("section", { className: "memory4-official", key: index },
      h("small", null, `采集日期：${record.captureGameDate || "未知"}`), h("p", { className: "memory4-text" }, record.content))) : h("p", { className: "memory4-empty" }, "当前战役尚未导出此人物的官方追忆。"));
  else if (tab === "year") content = h(R.Fragment, null,
    !data.derived.years.length && h("p", { className: "memory4-empty" }, data.detail.total ? "暂无年度记忆。" : "暂无可用于生成年度记忆的详细长期记忆来源。"),
    writeButton("从长期记忆生成年度与人生记忆", () => regenerate("all", { revision: data.derived.derivedRevision || 0 }), { disabled: !data.detail.total }),
    data.derived.years.map(year => h("details", { className: "memory4-derived", key: year.eventYear },
      h("summary", null, `${year.eventYear} 年`, year.dirty && h("span", { className: "memory4-status" }, "底层记忆已变化"),
        year.generationMode === "manual_override" && h("span", { className: "memory4-status" }, "手工版本")),
      conflict("year", year, { eventYear: year.eventYear }),
      h("div", { className: "memory4-actions" }, button("查看来源", () => showSources({ kind: "year", eventYear: year.eventYear })),
        writeButton("从 Detail 重新生成", () => regenerate("year", year, { eventYear: year.eventYear }), { disabled: !data.detail.total })),
      year.items.map(item => h("section", { className: "memory4-derived-item", key: item.itemId }, h("p", { className: "memory4-text" }, item.text),
        editButton({ operation: "updateYear", eventYear: year.eventYear, itemId: item.itemId, expectedRevision: year.revision }, item.text, `${year.eventYear} 年`))))));
  else if (tab === "life") {
    const life = data.derived.life;
    content = h(R.Fragment, null, writeButton("从年度记忆生成人生记忆", () => regenerate("life", life || { revision: 0 }), { disabled: !data.derived.years.length }),
      life?.segments?.length ? life.segments.map(segment => h("details", { className: "memory4-derived", key: segment.segmentId },
        h("summary", null, `${segment.period.fromYear} - ${segment.period.toYear}`, life.dirty && h("span", { className: "memory4-status" }, "底层记忆已变化"),
          segment.manual?.mode === "manual_override" && h("span", { className: "memory4-status" }, "手工版本")),
        conflict("life", life, { segmentId: segment.segmentId }), h("p", { className: "memory4-text" }, segment.text),
        h("div", { className: "memory4-actions" }, editButton({ operation: "updateLife", segmentId: segment.segmentId, expectedRevision: life.revision }, segment.text, `${segment.period.fromYear} - ${segment.period.toYear}`),
          button("查看来源", () => showSources({ kind: "life", segmentId: segment.segmentId })), writeButton("重新生成当前阶段", () => regenerate("life", life, { segmentId: segment.segmentId }),
            { disabled: !data.derived.years.length }))))
        : h("p", { className: "memory4-empty" }, data.derived.years.length ? "暂无人生记忆。" : "暂无人生记忆；当前没有可用的年度记忆来源。"));
  } else if (tab === "detail") content = h(R.Fragment, null,
    entityId && h("div", { className: "memory4-actions" }, h("span", null, "仅显示相关人物记忆"), button("显示全部", () => { setEntityId(null); load({ entityId: null }); })),
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
            const result = await api.getMemory4Entry({ ...scope, entryId: row.entryId });
            if (epoch !== contextEpoch.current || sequence !== requestSequence.current) return;
            if (!result?.success) throw new Error(result?.error);
            setEntries(previous => ({ ...previous, [row.entryId]: result.entry }));
          } catch (cause) { if (epoch === contextEpoch.current && sequence === requestSequence.current) setError(errorText(cause?.message)); }
        } }, `${TYPES[row.memoryType] || "长期记忆"} · ${eventDate(row.eventTime)}`),
        entry ? h(R.Fragment, null, h("p", { className: "memory4-text" }, entry.text),
          h("p", { className: "memory4-meta" }, `交谈日期：${entry.conversationDate || "未知"} · 获知日期：${entry.acquiredDate || "未知"}`),
          h("div", { className: "memory4-actions" }, editButton({ operation: "updateDetail", entryId: entry.entryId, expectedRevision: entry.revision }, entry.text, "详细长期记忆"),
            button("查看来源", () => showSources({ kind: "detail", entryId: entry.entryId })), writeButton("删除", () => {
              if (window.confirm("删除这条长期记忆？相关年度与人生记忆会重新核对来源。")) mutate({ operation: "deleteDetail", entryId: entry.entryId, expectedRevision: entry.revision });
            }, { className: "danger-button" }))) : h("p", null, "读取正文中…"));
    }) : h("p", { className: "memory4-empty" }, data.generation.lastStatus === "NO_DURABLE_CONTENT"
      ? `最近一次归档未提取出可确认的长期事实；Legacy 对话摘要仍保留（${data.generation.noDurableContentCount} 次无长期事实结果）。`
      : "暂无详细长期记忆。"), pages(data.detail, "detailOffset"));
  return h("div", { className: `memory4-manager${data ? "" : " memory4-context-unavailable"}` },
    h("div", { className: "memory4-heading" }, h("strong", null, "人物记忆"), button("\u21bb", () => load({ entityId, refreshCurrentFacts: true }), { title: "刷新人物记忆", "aria-label": "刷新人物记忆" })),
    h("nav", { className: "memory4-tabs", role: "tablist", "aria-label": "人物记忆" }, TABS.map(([key, label]) => h("button", {
      key, type: "button", role: "tab", "aria-selected": tab === key, onClick: () => setTab(key), className: tab === key ? "active" : ""
    }, label))),
    data?.readOnlyArchive && h("div", { className: "memory4-conflict memory4-archive-notice", role: "status" },
      data.readOnlyReason === "conversation_ended"
        ? `已结束对话所属战役的已保存归档${data.archiveAsOfDate ? `（截至 ${data.archiveAsOfDate}）` : ""}，仅供查阅；当前关系和 CK3 人物状态未重新回读。`
        : `此为已加载战役中该人物的已保存归档${data.archiveAsOfDate ? `（截至 ${data.archiveAsOfDate}）` : ""}，仅供查阅；当前人物关系和状态未重新回读。`),
    error && h("p", { className: "memory4-error", role: "alert" }, error), message && h("p", { role: "status" }, message),
    (busy || loading) && h("p", { role: "status" }, busy ? "处理中…" : "读取中…"),
    data?.derived.jobs?.some(job => ["QUEUED", "RUNNING", "FAILED", "REQUEUED"].includes(job.status)) && h("p", { className: "memory4-meta", role: "status" },
      data.derived.jobs.some(job => job.status === "FAILED") ? "派生记忆生成失败，可重新生成。" : data.derived.jobs.some(job => job.status === "RUNNING") ? "派生记忆正在生成，完成后刷新。" : "派生记忆已排队，等待生成。",
      data.derived.jobs.some(job => ["RUNNING", "QUEUED", "REQUEUED"].includes(job.status)) && writeButton("停止任务", () => mutate({ operation: "cancelDerived" }), { title: "停止当前人物的派生记忆任务" })),
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
