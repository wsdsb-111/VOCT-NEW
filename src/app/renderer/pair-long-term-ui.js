(function attachPairLongTermUi(root) {
  const UNKNOWN_NAME = "姓名未载入";
  const PAGE_SIZE = 20;
  const MAX_PAGE_SIZE = 50;
  const COUNT_LABELS = {
    scannedSummaries: "扫描摘要",
    scannedSummaryCount: "扫描摘要",
    titledSummaries: "含事项标题",
    titledSummaryCount: "含事项标题",
    recognizedTitleCount: "含事项标题",
    candidateItems: "候选事项",
    candidateItemCount: "候选事项",
    candidateCount: "候选事项",
    newCount: "预计新增",
    addedCount: "预计新增",
    updatedCount: "预计更新",
    unchangedCount: "预计保持",
    existingCount: "预计保持",
    removedCount: "移除旧索引",
    skippedCount: "跳过",
    invalidCount: "格式错误",
    completedPairs: "已处理关系",
    totalPairs: "关系总数"
  };
  const ERROR_LABELS = {
    pair_index_preview_stale: "预览期间摘要发生变化，旧方案已作废。已重新扫描，请检查新预览后再次确认。",
    pair_ledger_preview_stale: "预览期间摘要发生变化，旧方案已作废。已重新扫描，请检查新预览后再次确认。",
    source_unavailable_or_stale: "来源已变化或当前不可访问。事项簿已刷新，请重新打开来源。",
    pair_memory_campaign_not_loaded: "历史摘要的所属战役尚未绑定或存在歧义；可以查看，暂不能写入事项簿。",
    pair_memory_owner_not_in_current_campaign: "当前战役无法验证此 Owner，未写入事项簿。",
    pair_memory_game_data_unavailable: "当前游戏数据尚未准备好；只读内容仍可查看，请稍后重试。",
    pair_memory_read_only: "当前档案为只读状态，可以查看事项，不能写入。",
    pair_memory_preview_failed: "预览失败，请刷新摘要后重试。",
    pair_memory_apply_failed: "写入失败。原始摘要未修改；请刷新后检查已完成的关系。"
  };
  const SKIP_LABELS = {
    no_important_matters: "摘要没有重要事项",
    no_title: "没有事项标题",
    no_important_matters_title: "没有事项标题",
    missing_date: "缺少对话日期",
    missing_or_invalid_date: "缺少有效对话日期",
    campaign_unbound: "Campaign 尚未绑定",
    campaign_mismatch: "摘要属于其他 Campaign",
    campaign_unresolved: "Campaign 身份无法验证",
    missing_campaign: "缺少可验证的 Campaign",
    unauthorized_owner: "Owner 未获授权",
    source_authorization_unverified: "摘要来源授权无法验证",
    official_summary: "官方追忆摘要不参与回填",
    official_recollection: "官方追忆摘要不参与回填",
    forgotten: "内容已被 Forget 撤销",
    forgotten_source: "内容已被 Forget 撤销",
    source_identity_ambiguous: "摘要来源身份不明确",
    source_identity_conflict: "摘要来源身份冲突",
    source_pair_mismatch: "摘要关系与当前 Pair 不一致",
    source_revision_mismatch: "摘要版本无法验证",
    source_file_unverified: "摘要文件无法验证",
    memory_scope_mismatch: "摘要记忆范围不匹配",
    invalid_json: "摘要文件格式错误",
    invalid_format: "摘要格式错误",
    summary_content_invalid: "摘要正文格式错误",
    future_date: "摘要日期晚于当前游戏日期",
    ambiguous_item_boundary: "事项边界含糊，需在预览中人工核对",
    source_unavailable_or_stale: "来源已变化或不可访问"
  };

  function displayPersonName(value) {
    const name = String(value ?? "").trim();
    if (!name || /^(?:id\s*[:：]?\s*)?\d+$/i.test(name)) return UNKNOWN_NAME;
    return name;
  }

  function friendlyError(error) {
    const code = String(error ?? "").trim();
    const key = code.toLowerCase();
    if (ERROR_LABELS[key]) return ERROR_LABELS[key];
    if (key.includes("stale")) return ERROR_LABELS.pair_index_preview_stale;
    if (key.includes("campaign") && (key.includes("unavailable") || key.includes("not_loaded"))) return ERROR_LABELS.pair_memory_campaign_not_loaded;
    if (key.includes("read_only") || key.includes("readonly")) return ERROR_LABELS.pair_memory_read_only;
    return "操作失败，请刷新摘要后重试；原始摘要不会被此操作修改。";
  }

  function toCountRows(data) {
    const counts = data?.counts && typeof data.counts === "object" ? data.counts : {};
    const output = [];
    const seen = new Set();
    for (const [key, label] of Object.entries(COUNT_LABELS)) {
      if (seen.has(label)) continue;
      const value = counts[key] ?? data?.[key];
      if (Number.isFinite(Number(value))) {
        output.push({ label, value: Number(value) });
        seen.add(label);
      }
    }
    return output;
  }

  function reasonLabel(reason) {
    const key = String(reason?.reason ?? reason?.code ?? reason ?? "").toLowerCase();
    if (SKIP_LABELS[key]) return SKIP_LABELS[key];
    const normalized = key.replace(/^skip_/, "").replace(/_/g, " ").trim();
    return normalized ? `其他原因：${normalized}` : "其他跳过原因";
  }

  function toReasonRows(data) {
    const sources = [data?.skipReasons || data?.skippedByReason || data?.skippedReasons || data?.counts?.skipReasons || data?.counts?.skippedByReason || data?.counts?.skippedReasons || data?.diagnostics?.skipReasons];
    for (const pair of Array.isArray(data?.pairs) ? data.pairs : []) {
      sources.push(pair?.skipReasons || pair?.counts?.skipReasons || pair?.diagnostics?.skipReasons);
      for (const scope of Array.isArray(pair?.pairs) ? pair.pairs : []) sources.push(scope?.skipReasons || scope?.counts?.skipReasons || scope?.diagnostics?.skipReasons);
    }
    const counts = new Map();
    for (const source of sources) {
      if (Array.isArray(source)) {
        for (const item of source) {
          const count = Number(item?.count ?? item?.total ?? 1);
          const label = reasonLabel(item);
          if (Number.isFinite(count)) counts.set(label, (counts.get(label) || 0) + count);
        }
      } else if (source && typeof source === "object") {
        for (const [reason, rawCount] of Object.entries(source)) {
          const count = Number(rawCount);
          const label = reasonLabel(reason);
          if (Number.isFinite(count)) counts.set(label, (counts.get(label) || 0) + count);
        }
      }
    }
    return [...counts].map(([label, count]) => ({ label, count }));
  }

  function getPreviewItems(data) {
    if (Array.isArray(data?.items) && data.items.length) return data.items;
    if (Array.isArray(data?.candidates) && data.candidates.length) return data.candidates;
    const items = [];
    for (const pair of Array.isArray(data?.pairs) ? data.pairs : []) {
      for (const item of Array.isArray(pair?.items) ? pair.items : []) items.push({ ...item, counterpartName: pair.counterpartName });
      for (const scope of Array.isArray(pair?.pairs) ? pair.pairs : []) {
        for (const item of Array.isArray(scope?.items) ? scope.items : []) {
          items.push({ ...item, ownerName: pair.ownerName || scope.ownerName, counterpartName: pair.counterpartName || scope.counterpartName });
        }
      }
    }
    return items;
  }

  function makeElement(tag, className, text) {
    const element = root.document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined && text !== null) element.textContent = String(text);
    return element;
  }

  function makeButton(label, onClick, className = "") {
    const button = makeElement("button", className, label);
    button.type = "button";
    button.addEventListener("click", onClick);
    return button;
  }

  function formatInteractionEvidence(value) {
    const labels = {
      DIRECT_PAIR: "直接交流",
      GROUP_WITNESSED: "共同见证",
      UNDETERMINED: "无法判定"
    };
    return labels[String(value || "").toUpperCase()] || "交流方式未记录";
  }

  function createController(api, options, onChange) {
    const mode = options.mode === "owner" ? "owner" : "pair";
    const ownerId = Number(options.ownerId);
    const counterpartId = mode === "pair" ? Number(options.counterpartId) : undefined;
    const scope = { ownerId, ...(counterpartId ? { counterpartId } : {}) };
    let disposed = false;
    let cancelRequested = false;
    let state = {
      mode,
      ledger: null,
      preview: null,
      result: null,
      error: "",
      errorCode: "",
      message: "",
      busy: false,
      operation: "",
      page: 0,
      pageSize: PAGE_SIZE,
      sort: "newest",
      query: "",
      fromDate: "",
      toDate: "",
      progress: { completedPairs: 0, totalPairs: 0, rows: [], cancelRequested: false },
      sourceModal: null
    };

    const emit = (patch) => {
      state = { ...state, ...patch };
      if (!disposed) onChange(state);
    };

    const basePayload = () => ({ ...scope });

    async function refresh(page = state.page, sort = state.sort) {
      if (mode !== "pair") return { success: true };
      if (!Number.isSafeInteger(ownerId) || ownerId <= 0 || !Number.isSafeInteger(counterpartId) || counterpartId <= 0 || ownerId === counterpartId) {
        emit({ error: "当前摘要关系缺少有效身份信息。", errorCode: "invalid_scope" });
        return { success: false, error: "invalid_scope" };
      }
      if (typeof api.getPairMemoryIndex !== "function") {
        emit({ error: "长期事项簿接口尚未连接，请确认应用版本后刷新。", errorCode: "api_unavailable" });
        return { success: false, error: "api_unavailable" };
      }
      emit({ busy: true, operation: "load", error: "", errorCode: "" });
      try {
        const response = await api.getPairMemoryIndex({
          ...basePayload(),
          page,
          pageSize: Math.min(MAX_PAGE_SIZE, Math.max(1, state.pageSize)),
          sort,
          search: state.query,
          fromDate: state.fromDate,
          toDate: state.toDate
        });
        if (!response?.success) {
          const code = response?.error || "pair_memory_index_failed";
          emit({ ledger: null, error: friendlyError(code), errorCode: code });
          return response || { success: false, error: code };
        }
        emit({
          ledger: response,
          page: Number.isSafeInteger(response.page) ? response.page : page,
          pageSize: Number.isSafeInteger(response.pageSize) ? response.pageSize : PAGE_SIZE,
          sort: response.sort === "oldest" ? "oldest" : sort,
          error: "",
          errorCode: ""
        });
        return response;
      } catch (error) {
        const code = error instanceof Error ? error.message : "pair_memory_index_failed";
        emit({ ledger: null, error: friendlyError(code), errorCode: code });
        return { success: false, error: code };
      } finally {
        emit({ busy: false, operation: "" });
      }
    }

    async function preview(showRefreshMessage = false) {
      const method = api.previewPairMemoryBackfill;
      if (typeof method !== "function") {
        emit({ error: "长期事项预览接口尚未连接，请确认应用版本后刷新。", errorCode: "api_unavailable" });
        return { success: false, error: "api_unavailable" };
      }
      emit({ busy: true, operation: "preview", error: "", errorCode: "", preview: null, result: showRefreshMessage ? state.result : null, message: "" });
      try {
        const response = await method.call(api, basePayload());
        if (!response?.success) {
          const code = response?.error || "pair_memory_preview_failed";
          emit({ error: friendlyError(code), errorCode: code, preview: null });
          return response || { success: false, error: code };
        }
        emit({
          preview: response,
          error: "",
          errorCode: "",
          message: showRefreshMessage ? "原预览已过期，已重新扫描。请检查新结果后再次确认。" : ""
        });
        return response;
      } catch (error) {
        const code = error instanceof Error ? error.message : "pair_memory_preview_failed";
        emit({ error: friendlyError(code), errorCode: code, preview: null });
        return { success: false, error: code };
      } finally {
        emit({ busy: false, operation: "" });
      }
    }

    function cancelPreview() {
      emit({ preview: null, result: null, error: "", errorCode: "", message: "预览已取消，未写入事项簿。" });
    }

    function cancelBatch() {
      cancelRequested = true;
      emit({ progress: { ...state.progress, cancelRequested: true }, message: "已请求取消；当前关系完成后将停止后续写入。" });
    }

    function previewRevisionFor(pair, allowOverallRevision = true) {
      return pair?.previewRevision || pair?.preview?.previewRevision || (allowOverallRevision ? state.preview?.previewRevision : undefined);
    }

    async function applySingle() {
      const method = api.applyPairMemoryBackfill;
      const revision = previewRevisionFor(state.preview?.pairs?.[0]) || state.preview?.previewRevision;
      if (typeof method !== "function" || !revision) {
        emit({ error: "预览缺少可用版本，未执行写入；请重新预览。", errorCode: "missing_preview_revision" });
        return { success: false, error: "missing_preview_revision" };
      }
      const writable = state.preview?.writable ?? state.ledger?.writable;
      if (writable === false) {
        emit({ error: friendlyError("pair_memory_read_only"), errorCode: "pair_memory_read_only" });
        return { success: false, error: "pair_memory_read_only" };
      }
      emit({ busy: true, operation: "apply", error: "", errorCode: "", result: null, message: "正在更新此关系的长期事项簿…" });
      try {
        const response = await method.call(api, { ...basePayload(), previewRevision: revision });
        const code = response?.error || "";
        if (!response?.success && String(code).toLowerCase().includes("stale")) {
          emit({ preview: null, message: "预览已过期，正在重新扫描；旧方案未写入。" });
          await preview(true);
          return response;
        }
        if (!response?.success) {
          emit({ error: friendlyError(code || "pair_memory_apply_failed"), errorCode: code || "pair_memory_apply_failed" });
          return response || { success: false, error: "pair_memory_apply_failed" };
        }
        emit({ preview: null, result: response, message: "此关系的长期事项簿已更新。" });
        if (typeof root.dispatchEvent === "function" && typeof root.CustomEvent === "function") root.dispatchEvent(new root.CustomEvent("votc:pair-memory-index-updated", { detail: { ownerId, counterpartId } }));
        await refresh(0, state.sort);
        return response;
      } catch (error) {
        const code = error instanceof Error ? error.message : "pair_memory_apply_failed";
        if (code.toLowerCase().includes("stale")) {
          emit({ preview: null, message: "预览已过期，正在重新扫描；旧方案未写入。" });
          await preview(true);
          return { success: false, error: code };
        }
        emit({ error: friendlyError(code), errorCode: code });
        return { success: false, error: code };
      } finally {
        emit({ busy: false, operation: "" });
      }
    }

    async function applyBatch() {
      const method = api.applyPairMemoryBackfill;
      const pairs = Array.isArray(state.preview?.pairs) ? state.preview.pairs : [];
      if (typeof method !== "function" || !pairs.length) {
        emit({ error: "批量预览没有可执行的 Pair 或预览版本；请重新预览。", errorCode: "missing_preview_pairs" });
        return { success: false, error: "missing_preview_pairs" };
      }
      if (state.preview?.writable === false) {
        emit({ error: friendlyError("pair_memory_read_only"), errorCode: "pair_memory_read_only" });
        return { success: false, error: "pair_memory_read_only" };
      }
      const invalidPair = pairs.find((pair) => !Number.isSafeInteger(Number(pair.counterpartId)) || Number(pair.counterpartId) <= 0 || !previewRevisionFor(pair, false));
      if (invalidPair) {
        emit({ error: "批量预览缺少有效关系身份或预览版本，未执行写入；请重新预览。", errorCode: "invalid_preview_pair" });
        return { success: false, error: "invalid_preview_pair" };
      }

      cancelRequested = false;
      const rows = [];
      emit({
        busy: true,
        operation: "batch",
        error: "",
        errorCode: "",
        result: null,
        message: "正在逐个关系更新。可取消后续关系；当前关系完成后停止。",
        progress: { completedPairs: 0, totalPairs: pairs.length, rows: [], cancelRequested: false }
      });
      try {
        for (const pair of pairs) {
          if (cancelRequested) break;
          const pairId = Number(pair.counterpartId);
          let response;
          try {
            response = await method.call(api, {
              ownerId,
              counterpartId: pairId,
              previewRevision: previewRevisionFor(pair, false)
            });
          } catch (error) {
            response = { success: false, error: error instanceof Error ? error.message : "pair_memory_apply_failed" };
          }
          rows.push({
            ownerName: pair.ownerName || options.ownerName,
            counterpartName: pair.counterpartName,
            success: response?.success === true,
            error: response?.success === true ? "" : response?.error || "pair_memory_apply_failed",
            counts: response?.counts || response?.result?.counts || {},
            totalCount: response?.totalCount ?? response?.items?.length,
            result: response
          });
          emit({ progress: { completedPairs: rows.length, totalPairs: pairs.length, rows: [...rows], cancelRequested } });
        }
        const cancelled = cancelRequested && rows.length < pairs.length;
        const successes = rows.filter((row) => row.success).length;
        const failures = rows.length - successes;
        emit({
          preview: null,
          result: { success: failures === 0 && !cancelled, pairs: rows },
          message: cancelled
            ? `已处理 ${rows.length}/${pairs.length} 个关系；已取消剩余关系。`
            : `已处理 ${rows.length}/${pairs.length} 个关系：成功 ${successes}，失败 ${failures}。`
        });
        if (typeof root.dispatchEvent === "function" && typeof root.CustomEvent === "function") root.dispatchEvent(new root.CustomEvent("votc:pair-memory-index-updated", { detail: { ownerId } }));
        if (rows.some((row) => String(row.error).toLowerCase().includes("stale"))) {
          emit({ message: "部分关系的预览已过期；已完成的关系保留，本次未写入的关系正在重新预览。" });
          await preview(true);
        }
        return { success: failures === 0 && !cancelled, pairs: rows, cancelled };
      } finally {
        emit({ busy: false, operation: "" });
      }
    }

    async function openSource(item) {
      const source = item?.source || {};
      const sourceSummaryKey = source.sourceSummaryKey;
      const sourceRevision = source.sourceRevision;
      if (!sourceSummaryKey || !sourceRevision) {
        emit({ sourceModal: { item, error: "此事项缺少可验证的来源版本，无法安全打开原摘要。", errorCode: "source_identity_missing" } });
        return;
      }
      const openMethod = typeof api.openPairMemorySource === "function";
      const resolver = openMethod ? api.openPairMemorySource : api.resolvePairMemorySource;
      if (typeof resolver !== "function") {
        emit({ sourceModal: { item, error: "原摘要来源验证接口尚未连接，请确认应用版本后重试。", errorCode: "api_unavailable" } });
        return;
      }
      emit({ busy: true, operation: "source", sourceModal: { item, loading: true, error: "" } });
      try {
        const response = await resolver.call(api, {
          ...basePayload(),
          sourceSummaryKey,
          ...(openMethod ? { expectedSourceRevision: sourceRevision } : { sourceRevision })
        });
        if (!response?.success) {
          const code = response?.error || "SOURCE_UNAVAILABLE_OR_STALE";
          const stale = String(code).toLowerCase().includes("stale") || String(code).toLowerCase().includes("unavailable");
          emit({ sourceModal: { item, error: stale ? "来源已变化或已删除，未显示缓存内容。事项簿正在刷新，请重新打开。" : friendlyError(code), errorCode: code } });
          if (stale) await refresh(state.page, state.sort);
          return response || { success: false, error: code };
        }
        const summary = response.summary && typeof response.summary === "object" ? response.summary : {};
        const content = typeof response.content === "string" ? response.content : typeof summary.content === "string" ? summary.content : "";
        if (!content) {
          emit({ sourceModal: { item, error: "已验证来源没有可显示的摘要正文。", errorCode: "source_content_missing" } });
          return { success: false, error: "source_content_missing" };
        }
        emit({ sourceModal: { item, response, summary, content, loading: false, error: "" } });
        return response;
      } catch (error) {
        const code = error instanceof Error ? error.message : "SOURCE_UNAVAILABLE_OR_STALE";
        const stale = code.toLowerCase().includes("stale") || code.toLowerCase().includes("unavailable");
        emit({ sourceModal: { item, error: stale ? "来源已变化或已删除，未显示缓存内容。事项簿正在刷新，请重新打开。" : friendlyError(code), errorCode: code } });
        if (stale) await refresh(state.page, state.sort);
        return { success: false, error: code };
      } finally {
        emit({ busy: false, operation: "" });
      }
    }

    return {
      get state() { return state; },
      refresh,
      preview,
      cancelPreview,
      applySingle,
      applyBatch,
      cancelBatch,
      openSource,
      showSourceError: (message, errorCode = "source_navigation_failed") => emit({ sourceModal: { ...state.sourceModal, error: message, errorCode } }),
      changeSort: (sort) => refresh(0, sort === "oldest" ? "oldest" : "newest"),
      changePage: (page) => refresh(page, state.sort),
      setFilters: (query, fromDate, toDate) => {
        emit({ query: String(query || "").trim(), fromDate: String(fromDate || "").trim(), toDate: String(toDate || "").trim() });
        return refresh(0, state.sort);
      },
      closeSource: () => emit({ sourceModal: null }),
      dispose: () => { disposed = true; }
    };
  }

  function appendCounts(container, data) {
    const rows = toCountRows(data);
    if (rows.length) {
      const list = makeElement("dl", "pair-ledger-counts");
      for (const row of rows) {
        list.append(makeElement("dt", "", row.label), makeElement("dd", "", row.value));
      }
      container.append(list);
    }
    const reasons = toReasonRows(data);
    if (reasons.length) {
      const list = makeElement("ul", "pair-ledger-skip-reasons");
      for (const row of reasons) list.append(makeElement("li", "", `${row.label}：${row.count}`));
      container.append(makeElement("h6", "", "跳过原因"), list);
    }
  }

  function renderDiagnostics(parent, value, title = "来源诊断详情") {
    if (!value || typeof value !== "object") return;
    const details = makeElement("details", "pair-ledger-diagnostics");
    details.append(makeElement("summary", "", title));
    const pre = makeElement("pre", "", JSON.stringify(value, null, 2));
    details.append(pre);
    parent.append(details);
  }

  function renderSourceModal(host, state, controller, names, options) {
    const modal = makeElement("div", "pair-source-modal-backdrop");
    modal.setAttribute("role", "presentation");
    const panel = makeElement("section", "pair-source-modal");
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    panel.setAttribute("aria-label", "已验证的 Legacy 摘要来源");
    const sourceState = state.sourceModal;
    const title = sourceState.summary?.date || sourceState.response?.conversationDate || sourceState.item?.conversationDate || "来源摘要";
    const close = makeButton("关闭", () => controller.closeSource(), "");
    const header = makeElement("div", "pair-source-modal-header");
    header.append(makeElement("div", "", "已验证的 Legacy 摘要"), close);
    panel.append(header, makeElement("p", "pair-source-modal-route", `${displayPersonName(sourceState.response?.ownerName || names.ownerName)} → ${displayPersonName(sourceState.response?.counterpartName || names.counterpartName)} · ${title}`));
    if (sourceState.loading) {
      panel.append(makeElement("p", "pair-ledger-status", "正在向主进程验证来源身份与版本…"));
    } else if (sourceState.error) {
      panel.append(makeElement("p", "pair-ledger-error", sourceState.error));
      if (sourceState.errorCode) renderDiagnostics(panel, { error: sourceState.errorCode }, "诊断详情");
      panel.append(makeButton("刷新事项簿", () => controller.refresh(state.page, state.sort), ""));
    } else {
      const itemText = String(sourceState.item?.text || "");
      if (itemText) {
        const highlighted = makeElement("p", "pair-source-matched-item");
        highlighted.append(makeElement("strong", "", "对应事项："), makeElement("mark", "", itemText));
        panel.append(highlighted);
      }
      const content = makeElement("pre", "pair-source-content", sourceState.content);
      panel.append(content);
      const locate = makeButton("定位到此摘要并编辑", async () => {
        if (typeof options.onLocateSource !== "function") return;
        const result = await options.onLocateSource(sourceState.response, sourceState.item);
        if (result?.success) controller.closeSource();
        else controller.showSourceError(result?.message || "源摘要已刷新，但无法在当前摘要列表中唯一定位。请刷新后重试。", result?.error || "source_navigation_failed");
      }, "");
      locate.disabled = typeof options.onLocateSource !== "function";
      panel.append(locate);
      const locator = {
        summaryIndex: sourceState.response?.summaryIndex ?? sourceState.response?.locator?.summaryIndex ?? sourceState.summary?.summaryIndex,
        folderName: sourceState.response?.folderName || sourceState.response?.locator?.folderName,
        conversationFile: sourceState.response?.conversationFile || sourceState.response?.locator?.conversationFile,
        sourceSummaryKey: sourceState.response?.sourceSummaryKey || sourceState.item?.source?.sourceSummaryKey,
        sourceRevision: sourceState.response?.sourceRevision || sourceState.item?.source?.sourceRevision
      };
      renderDiagnostics(panel, locator);
    }
    modal.append(panel);
    modal.addEventListener("click", (event) => {
      if (event.target === modal) controller.closeSource();
    });
    host.append(modal);
  }

  function mount(host, options) {
    let disposed = false;
    let controller;
    const names = {
      ownerName: displayPersonName(options.ownerName),
      counterpartName: displayPersonName(options.counterpartName)
    };

    function render(state) {
      if (disposed) return;
      host.replaceChildren();
      const section = makeElement("section", `pair-ledger-panel is-${state.mode}`);
      const header = makeElement("div", "pair-ledger-header");
      const title = state.mode === "owner" ? "批量生成长期事项簿" : "长期重要事项簿（Owner 视角）";
      header.append(makeElement("h5", "", state.mode === "owner" ? `为 ${names.ownerName} 批量生成长期事项簿` : title));
      if (state.mode === "pair") header.append(makeElement("p", "pair-ledger-route", `${names.ownerName} → ${names.counterpartName}`));
      section.append(header);

      const notice = makeElement("p", "pair-ledger-notice", "本功能只从 Legacy 摘要本地提取，不调用 AI，也不修改原始摘要。事项会随源摘要编辑、删除和 Forget 同步。派生事项不可单独编辑。查看原摘要时会由主进程重新验证来源身份和版本。");
      section.append(notice);

      if (state.mode === "pair") renderPairLedger(section, state, controller, names);
      if (state.busy && state.operation === "batch") {
        const progress = makeElement("div", "pair-ledger-batch-progress");
        progress.append(makeElement("p", "pair-ledger-status", `批量进度：${state.progress.completedPairs}/${state.progress.totalPairs} 个关系已处理。`));
        if (state.progress.rows.length) {
          const list = makeElement("ul", "pair-ledger-apply-results");
          for (const row of state.progress.rows) {
            const route = `${displayPersonName(row.ownerName || names.ownerName)} → ${displayPersonName(row.counterpartName)}`;
            list.append(makeElement("li", row.success ? "is-success" : "is-error", `${route}：${row.success ? "已完成" : friendlyError(row.error)}`));
          }
          progress.append(list);
        }
        const cancel = makeButton(state.progress.cancelRequested ? "正在停止后续关系…" : "取消后续关系", () => controller.cancelBatch(), "");
        cancel.disabled = state.progress.cancelRequested;
        progress.append(cancel);
        section.append(progress);
      }
      renderBackfill(section, state, controller);
      if (state.message) section.append(makeElement("p", "pair-ledger-status", state.message));
      if (state.error) {
        section.append(makeElement("p", "pair-ledger-error", state.error));
        if (state.errorCode) renderDiagnostics(section, { error: state.errorCode }, "诊断详情");
      }
      if (state.result) renderApplyResult(section, state.result, state.progress, state.mode);
      host.append(section);
      if (state.sourceModal) renderSourceModal(host, state, controller, names, options);
    }

    function renderPairLedger(section, state, controls) {
      if (state.busy && state.operation === "load" && !state.ledger) {
        section.append(makeElement("p", "pair-ledger-status", "正在读取长期事项簿…"));
        return;
      }
      if (state.ledger?.writable === false) section.append(makeElement("p", "pair-ledger-readonly", "只读归档：可以查看事项和来源，不能回填。"));
      if (state.ledger?.offlineBackfill === true) section.append(makeElement("p", "pair-ledger-offline", "离线整理：已验证历史摘要的唯一战役绑定，可预览后确认生成事项簿。只更新本地索引，不修改原摘要。"));
      if (state.ledger) {
        const top = makeElement("div", "pair-ledger-controls");
        const count = Number(state.ledger.totalCount || 0);
        top.append(makeElement("span", "pair-ledger-total", `共 ${count} 条`));
        const sort = makeElement("select", "pair-ledger-sort");
        sort.setAttribute("aria-label", "事项日期排序");
        for (const [value, label] of [["newest", "由新到旧"], ["oldest", "由旧到新"]]) {
          const option = makeElement("option", "", label);
          option.value = value;
          option.selected = state.sort === value;
          sort.append(option);
        }
        sort.addEventListener("change", () => controls.changeSort(sort.value));
        top.append(sort);
        section.append(top);

        const filters = makeElement("form", "pair-ledger-filters");
        const search = makeElement("input", "", "");
        search.type = "search";
        search.placeholder = "搜索人物、物品、事件或年份";
        search.value = state.query;
        search.setAttribute("aria-label", "搜索长期事项");
        const from = makeElement("input", "", "");
        from.type = "text";
        from.placeholder = "起始日期，如 1090.01.01";
        from.value = state.fromDate;
        from.setAttribute("aria-label", "事项开始日期");
        const to = makeElement("input", "", "");
        to.type = "text";
        to.placeholder = "结束日期，如 1099.12.31";
        to.value = state.toDate;
        to.setAttribute("aria-label", "事项结束日期");
        const applyFilters = makeButton("筛选", () => {}, "");
        applyFilters.type = "submit";
        filters.append(search, from, to, applyFilters);
        filters.addEventListener("submit", (event) => {
          event.preventDefault();
          controls.setFilters(search.value, from.value, to.value);
        });
        section.append(filters);

        const items = Array.isArray(state.ledger.items) ? state.ledger.items : [];
        if (items.length === 0) section.append(makeElement("p", "pair-ledger-empty", "当前筛选范围没有长期事项。没有事项不代表没有其他 Legacy 叙事记忆。"));
        const list = makeElement("ol", "pair-ledger-items");
        for (const item of items) {
          const row = makeElement("li", "pair-ledger-item");
          const header = makeElement("div", "pair-ledger-item-header");
          header.append(makeElement("time", "", item.conversationDate || "日期未记录"));
          header.append(makeElement("span", "pair-ledger-evidence", formatInteractionEvidence(item.interactionEvidence)));
          row.append(header, makeElement("p", "pair-ledger-item-text", item.text || ""));
          const actions = makeElement("div", "pair-ledger-item-actions");
          actions.append(makeButton("查看原摘要", () => controls.openSource(item), ""));
          const sourceDetails = makeElement("details", "pair-ledger-source-details");
          sourceDetails.append(makeElement("summary", "", "展开来源与证据"));
          sourceDetails.append(makeElement("p", "", `来源日期：${item.conversationDate || "未记录"} · ${formatInteractionEvidence(item.interactionEvidence)}`));
          renderDiagnostics(sourceDetails, item.source || {}, "来源诊断详情");
          actions.append(sourceDetails);
          row.append(actions);
          list.append(row);
        }
        section.append(list);

        const page = Number(state.ledger.page ?? state.page);
        const pageSize = Number(state.ledger.pageSize ?? state.pageSize);
        const pageCount = Math.ceil(count / Math.max(1, pageSize));
        if (pageCount > 1) {
          const nav = makeElement("nav", "pair-ledger-pagination");
          nav.setAttribute("aria-label", "长期事项分页");
          nav.append(makeButton("上一页", () => controls.changePage(page - 1), ""));
          nav.append(makeElement("span", "", `第 ${page + 1} / ${pageCount} 页`));
          nav.append(makeButton("下一页", () => controls.changePage(page + 1), ""));
          nav.children[0].disabled = page <= 0 || state.busy;
          nav.children[2].disabled = page + 1 >= pageCount || state.busy;
          section.append(nav);
        }
      }
    }

    function renderBackfill(section, state, controls) {
      if (state.busy && state.operation === "batch") return;
      const currentCount = Number(state.ledger?.totalCount || 0);
      const buttonText = state.mode === "owner"
        ? "批量生成长期事项簿（仅当前合法战役）"
        : currentCount > 0 ? "重新扫描并更新长期事项簿" : "自动提取长期事项";
      if (!state.preview) {
        const button = makeButton(state.busy && state.operation === "preview" ? "正在只读预览…" : buttonText, () => controls.preview(), "pair-ledger-preview-button");
        button.disabled = state.busy;
        section.append(button);
        return;
      }

      const preview = state.preview;
      const previewCard = makeElement("div", "pair-ledger-preview");
      previewCard.append(makeElement("h6", "", "回填预览（尚未写入）"));
      if (preview.writable === false) previewCard.append(makeElement("p", "pair-ledger-readonly", "当前来源仅可查看：所属战役未绑定、存在歧义或当前角色无法验证，不能确认写入。"));
      if (preview.offlineBackfill === true) previewCard.append(makeElement("p", "pair-ledger-offline", "已验证历史摘要的唯一战役绑定，无需连接游戏；确认后只生成本地事项簿。"));
      appendCounts(previewCard, preview);
      const reasons = toReasonRows(preview);
      if (!reasons.length && Number(preview.skippedCount ?? preview.counts?.skippedCount) > 0) {
        previewCard.append(makeElement("p", "pair-ledger-status", "有摘要被跳过；请展开诊断详情查看服务端返回的原因。"));
      }
      const previewItems = getPreviewItems(preview);
      if (previewItems.length) {
        const list = makeElement("ul", "pair-ledger-preview-items");
        for (const item of previewItems.slice(0, 8)) {
          const li = makeElement("li", "");
          const dateAndRoute = makeElement("div", "pair-ledger-preview-source");
          dateAndRoute.append(makeElement("time", "", item.conversationDate || item.date || "日期未记录"));
          const owner = item.ownerName || options.ownerName;
          const counterpart = item.counterpartName || options.counterpartName;
          if (owner || counterpart) dateAndRoute.append(makeElement("span", "", ` · ${displayPersonName(owner)} → ${displayPersonName(counterpart)}`));
          li.append(dateAndRoute);
          li.append(makeElement("p", "", item.text || ""));
          const sourcePreview = item.sourceSummaryPreview || item.summaryPreview || item.source?.summaryPreview;
          if (sourcePreview) li.append(makeElement("small", "", `来源摘要：${sourcePreview}`));
          if (item.source) renderDiagnostics(li, item.source, "来源定位详情");
          list.append(li);
        }
        previewCard.append(makeElement("h6", "", `候选事项预览${previewItems.length > 8 ? "（前 8 条）" : ""}`), list);
      }
      if (Array.isArray(preview.pairs) && preview.pairs.length) {
        const pairs = makeElement("ul", "pair-ledger-preview-pairs");
        for (const pair of preview.pairs) {
          const label = `${displayPersonName(pair.ownerName || options.ownerName)} → ${displayPersonName(pair.counterpartName)}`;
          const counts = toCountRows(pair).map((entry) => `${entry.label} ${entry.value}`).join(" · ");
          pairs.append(makeElement("li", "", counts ? `${label}：${counts}` : label));
        }
        previewCard.append(makeElement("h6", "", `关系范围：${preview.pairs.length}`), pairs);
      }
      renderDiagnostics(previewCard, preview, "预览诊断详情");
      const actions = makeElement("div", "pair-ledger-preview-actions");
      actions.append(makeButton("取消（不写入）", () => controls.cancelPreview(), ""));
      if (state.mode === "owner") {
        const apply = makeButton(state.busy ? "正在执行…" : "确认生成此 Owner 的长期事项簿", () => controls.applyBatch(), "primary-button");
        apply.disabled = state.busy || preview.writable === false || !Array.isArray(preview.pairs) || preview.pairs.length === 0;
        actions.append(apply);
      } else {
        const apply = makeButton(state.busy ? "正在执行…" : "确认生成此关系的长期事项簿", () => controls.applySingle(), "primary-button");
        apply.disabled = state.busy || preview.writable === false || state.ledger?.writable === false;
        actions.append(apply);
      }
      previewCard.append(actions);
      section.append(previewCard);
    }

    function renderApplyResult(section, result, progress, mode) {
      const rows = Array.isArray(result?.pairs) ? result.pairs : [];
      if (mode === "owner" && progress.totalPairs > 0) {
        section.append(makeElement("p", "pair-ledger-status", `批量进度：${progress.completedPairs}/${progress.totalPairs} 个关系已处理。`));
      }
      if (!rows.length) {
        appendCounts(section, result);
        if (result?.error) section.append(makeElement("p", "pair-ledger-error", friendlyError(result.error)));
        return;
      }
      const list = makeElement("ul", "pair-ledger-apply-results");
      for (const row of rows) {
        const name = `${displayPersonName(row.ownerName)} → ${displayPersonName(row.counterpartName)}`;
        const status = row.success ? "已完成" : `失败：${friendlyError(row.error)}`;
        const summary = makeElement("li", row.success ? "is-success" : "is-error", `${name}：${status}`);
        const counts = toCountRows(row);
        if (Number.isFinite(Number(row.totalCount))) counts.push({ label: "最终事项", value: Number(row.totalCount) });
        if (counts.length) summary.append(makeElement("small", "", counts.map((entry) => `${entry.label} ${entry.value}`).join(" · ")));
        list.append(summary);
      }
      section.append(list);
    }

    controller = createController(root.conversationAPI || {}, options, render);
    render(controller.state);
    if (options.mode !== "owner") controller.refresh();
    const progressEvent = (event) => {
      const detail = event.detail || {};
      if (Number(detail.ownerId) !== Number(options.ownerId)) return;
      if (detail.counterpartId && options.counterpartId && Number(detail.counterpartId) !== Number(options.counterpartId)) return;
      controller.refresh(0, controller.state.sort);
    };
    root.addEventListener("votc:pair-memory-index-updated", progressEvent);
    return () => {
      disposed = true;
      root.removeEventListener("votc:pair-memory-index-updated", progressEvent);
      controller.dispose();
      host.replaceChildren();
    };
  }

  const api = { mount, createController, displayPersonName, friendlyError, toCountRows, toReasonRows, getPreviewItems };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.VOTCPairLongTermUi = api;
})(typeof window !== "undefined" ? window : globalThis);
