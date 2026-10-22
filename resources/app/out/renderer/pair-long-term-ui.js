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
  const ERROR_KEYS = {
    pair_index_preview_stale: "previewStale",
    pair_ledger_preview_stale: "previewStale",
    source_unavailable_or_stale: "sourceStale",
    pair_memory_campaign_not_loaded: "campaignNotLoaded",
    pair_memory_owner_not_in_current_campaign: "ownerNotVerified",
    pair_memory_game_data_unavailable: "gameDataUnavailable",
    pair_memory_read_only: "readOnly",
    pair_memory_preview_failed: "previewFailed",
    pair_memory_apply_failed: "applyFailed"
  };
  const SKIP_KEYS = {
    no_important_matters: "noImportantMatters",
    no_title: "noTitle",
    no_important_matters_title: "noTitle",
    missing_date: "missingDate",
    missing_or_invalid_date: "missingDate",
    campaign_unbound: "campaignUnbound",
    campaign_mismatch: "campaignMismatch",
    campaign_unresolved: "campaignUnresolved",
    missing_campaign: "campaignUnresolved",
    unauthorized_owner: "unauthorizedOwner",
    source_authorization_unverified: "sourceAuthorizationUnverified",
    official_summary: "officialSummary",
    official_recollection: "officialSummary",
    forgotten: "forgotten",
    forgotten_source: "forgotten",
    source_identity_ambiguous: "sourceIdentityAmbiguous",
    source_identity_conflict: "sourceIdentityConflict",
    source_pair_mismatch: "sourcePairMismatch",
    source_revision_mismatch: "sourceRevisionUnverified",
    source_file_unverified: "sourceFileUnverified",
    memory_scope_mismatch: "memoryScopeMismatch",
    invalid_json: "invalidSummaryFormat",
    invalid_format: "invalidSummaryFormat",
    summary_content_invalid: "invalidSummaryContent",
    future_date: "futureDate",
    ambiguous_item_boundary: "ambiguousItemBoundary",
    source_unavailable_or_stale: "sourceStale"
  };

  function localized(translate, key, fallback, params = {}) {
    if (typeof translate !== "function") return fallback;
    try {
      const value = translate(key, params);
      return typeof value === "string" && value && value !== key ? value : fallback;
    } catch (_ignored) {
      return fallback;
    }
  }

  function captureUiState(host) {
    const controls = Array.from(host.querySelectorAll("input, textarea, select"));
    const focusables = Array.from(host.querySelectorAll("input, textarea, select, button, summary, a[href], [tabindex]"));
    const active = host.ownerDocument?.activeElement;
    return {
      focusIndex: focusables.indexOf(active),
      controls: controls.map((control) => ({
        value: control.value,
        checked: control.checked,
        selectionStart: typeof control.selectionStart === "number" ? control.selectionStart : null,
        selectionEnd: typeof control.selectionEnd === "number" ? control.selectionEnd : null
      })),
      details: Array.from(host.querySelectorAll("details")).map((details) => details.open),
      scrollTop: host.scrollTop
    };
  }

  function restoreUiState(host, snapshot) {
    const controls = Array.from(host.querySelectorAll("input, textarea, select"));
    snapshot.controls.forEach((state, index) => {
      const control = controls[index];
      if (!control) return;
      control.value = state.value;
      control.checked = state.checked;
      if (state.selectionStart !== null && typeof control.setSelectionRange === "function") {
        try { control.setSelectionRange(state.selectionStart, state.selectionEnd); } catch (_ignored) { }
      }
    });
    Array.from(host.querySelectorAll("details")).forEach((details, index) => {
      if (snapshot.details[index] !== undefined) details.open = snapshot.details[index];
    });
    const focusable = Array.from(host.querySelectorAll("input, textarea, select, button, summary, a[href], [tabindex]"))[snapshot.focusIndex];
    if (focusable && typeof focusable.focus === "function") focusable.focus({ preventScroll: true });
    host.scrollTop = snapshot.scrollTop;
  }

  function displayPersonName(value, translate) {
    const name = String(value ?? "").trim();
    if (!name || name === UNKNOWN_NAME || /^(?:id\s*[:：]?\s*)?\d+$/i.test(name)) return localized(translate, "common.unknownName", UNKNOWN_NAME);
    return name;
  }

  function errorTextSpec(error) {
    const code = String(error ?? "").trim();
    const key = code.toLowerCase();
    if (ERROR_LABELS[key]) return { key: `errors.${ERROR_KEYS[key]}`, fallback: ERROR_LABELS[key] };
    if (key.includes("stale")) return { key: "errors.previewStale", fallback: ERROR_LABELS.pair_index_preview_stale };
    if (key.includes("campaign") && (key.includes("unavailable") || key.includes("not_loaded"))) return { key: "errors.campaignNotLoaded", fallback: ERROR_LABELS.pair_memory_campaign_not_loaded };
    if (key.includes("read_only") || key.includes("readonly")) return { key: "errors.readOnly", fallback: ERROR_LABELS.pair_memory_read_only };
    return { key: "errors.generic", fallback: "操作失败，请刷新摘要后重试；原始摘要不会被此操作修改。" };
  }

  function friendlyError(error, translate) {
    const spec = errorTextSpec(error);
    return localized(translate, spec.key, spec.fallback, spec.params);
  }

  function toCountRows(data, translate) {
    const counts = data?.counts && typeof data.counts === "object" ? data.counts : {};
    const output = [];
    const seen = new Set();
    for (const [key, label] of Object.entries(COUNT_LABELS)) {
      if (seen.has(label)) continue;
      const value = counts[key] ?? data?.[key];
      if (Number.isFinite(Number(value))) {
        output.push({ label: localized(translate, `counts.${key}`, label), value: Number(value) });
        seen.add(label);
      }
    }
    return output;
  }

  function reasonLabel(reason, translate) {
    const key = String(reason?.reason ?? reason?.code ?? reason ?? "").toLowerCase();
    if (SKIP_LABELS[key]) return localized(translate, `reasons.${SKIP_KEYS[key]}`, SKIP_LABELS[key]);
    return localized(translate, "reasons.other", "其他跳过原因");
  }

  function toReasonRows(data, translate) {
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
          const label = reasonLabel(item, translate);
          if (Number.isFinite(count)) counts.set(label, (counts.get(label) || 0) + count);
        }
      } else if (source && typeof source === "object") {
        for (const [reason, rawCount] of Object.entries(source)) {
          const count = Number(rawCount);
          const label = reasonLabel(reason, translate);
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

  function formatInteractionEvidence(value, translate) {
    const keys = { DIRECT_PAIR: "directPair", GROUP_WITNESSED: "groupWitnessed", UNDETERMINED: "undetermined" };
    const key = String(value || "").toUpperCase();
    const fallbacks = { DIRECT_PAIR: "直接交流", GROUP_WITNESSED: "共同见证", UNDETERMINED: "无法判定" };
    return localized(translate, `evidence.${keys[key] || "unrecorded"}`, fallbacks[key] || "交流方式未记录");
  }

  function createController(api, options, onChange) {
    const mode = options.mode === "owner" ? "owner" : "pair";
    const translate = options.t;
    const ownerId = Number(options.ownerId);
    const counterpartId = mode === "pair" ? Number(options.counterpartId) : undefined;
    const scope = { ownerId, ...(counterpartId ? { counterpartId } : {}) };
    let disposed = false;
    let cancelRequested = false;
    let refreshSequence = 0;
    let sourceSequence = 0;
    let messageSpec = null;
    let errorSpec = null;
    let sourceErrorSpec = null;
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

    const translateSpec = spec => localized(translate, spec.key, spec.fallback, spec.params);
    const emit = (patch, specs = {}) => {
      if (Object.hasOwn(patch, "message")) messageSpec = specs.message || null;
      if (Object.hasOwn(patch, "error")) errorSpec = specs.error || null;
      if (Object.hasOwn(patch, "sourceModal")) {
        sourceErrorSpec = patch.sourceModal?.error ? specs.sourceError || null : null;
      }
      state = { ...state, ...patch };
      if (messageSpec) state.message = translateSpec(messageSpec);
      if (errorSpec) state.error = translateSpec(errorSpec);
      if (sourceErrorSpec && state.sourceModal) state.sourceModal = { ...state.sourceModal, error: translateSpec(sourceErrorSpec) };
      if (!disposed) onChange(state);
    };
    const emitText = (patch, field, key, fallback, params = {}) => {
      const spec = { key, fallback, params };
      emit({ ...patch, [field]: translateSpec(spec) }, { [field]: spec });
    };
    const emitFriendlyError = (patch, code) => {
      const spec = errorTextSpec(code);
      emit({ ...patch, error: translateSpec(spec) }, { error: spec });
    };
    const emitSourceError = (patch, spec) => {
      emit({ ...patch, sourceModal: { ...patch.sourceModal, error: translateSpec(spec) } }, { sourceError: spec });
    };
    const refreshTranslations = () => {
      if (messageSpec) state.message = translateSpec(messageSpec);
      if (errorSpec) state.error = translateSpec(errorSpec);
      if (sourceErrorSpec && state.sourceModal) state.sourceModal = { ...state.sourceModal, error: translateSpec(sourceErrorSpec) };
      if (!disposed) onChange(state);
    };

    const basePayload = () => ({ ...scope });

    async function refresh(page = state.page, sort = state.sort) {
      const sequence = ++refreshSequence;
      if (mode !== "pair") return { success: true };
      if (!Number.isSafeInteger(ownerId) || ownerId <= 0 || !Number.isSafeInteger(counterpartId) || counterpartId <= 0 || ownerId === counterpartId) {
        emitText({ errorCode: "invalid_scope" }, "error", "ui.invalidScope", "当前摘要关系缺少有效身份信息。");
        return { success: false, error: "invalid_scope" };
      }
      if (typeof api.getPairMemoryIndex !== "function") {
        emitText({ errorCode: "api_unavailable" }, "error", "ui.apiUnavailable", "长期事项簿接口尚未连接，请确认应用版本后刷新。");
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
        if (disposed || sequence !== refreshSequence) return response;
        if (!response?.success) {
          const code = response?.error || "pair_memory_index_failed";
          emitFriendlyError({ ledger: null, errorCode: code }, code);
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
        if (disposed || sequence !== refreshSequence) return { success: false, error: error instanceof Error ? error.message : "pair_memory_index_failed" };
        const code = error instanceof Error ? error.message : "pair_memory_index_failed";
        emitFriendlyError({ ledger: null, errorCode: code }, code);
        return { success: false, error: code };
      } finally {
        if (!disposed && sequence === refreshSequence && state.operation === "load") emit({ busy: false, operation: "" });
      }
    }

    async function preview(showRefreshMessage = false) {
      const method = api.previewPairMemoryBackfill;
      if (typeof method !== "function") {
        emitText({ errorCode: "api_unavailable" }, "error", "ui.previewApiUnavailable", "长期事项预览接口尚未连接，请确认应用版本后刷新。");
        return { success: false, error: "api_unavailable" };
      }
      emit({ busy: true, operation: "preview", error: "", errorCode: "", preview: null, result: showRefreshMessage ? state.result : null, message: "" });
      try {
        const response = await method.call(api, basePayload());
        if (!response?.success) {
          const code = response?.error || "pair_memory_preview_failed";
          emitFriendlyError({ errorCode: code, preview: null }, code);
          return response || { success: false, error: code };
        }
        if (showRefreshMessage) emitText({
          preview: response,
          error: "",
          errorCode: "",
        }, "message", "ui.previewRefreshed", "原预览已过期，已重新扫描。请检查新结果后再次确认。");
        else emit({ preview: response, error: "", errorCode: "", message: "" });
        return response;
      } catch (error) {
        const code = error instanceof Error ? error.message : "pair_memory_preview_failed";
        emitFriendlyError({ errorCode: code, preview: null }, code);
        return { success: false, error: code };
      } finally {
        emit({ busy: false, operation: "" });
      }
    }

    function cancelPreview() {
      emitText({ preview: null, result: null, error: "", errorCode: "" }, "message", "ui.previewCancelled", "预览已取消，未写入事项簿。");
    }

    function cancelBatch() {
      cancelRequested = true;
      emitText({ progress: { ...state.progress, cancelRequested: true } }, "message", "ui.cancelRequested", "已请求取消；当前关系完成后将停止后续写入。");
    }

    function previewRevisionFor(pair, allowOverallRevision = true) {
      return pair?.previewRevision || pair?.preview?.previewRevision || (allowOverallRevision ? state.preview?.previewRevision : undefined);
    }

    async function applySingle() {
      const method = api.applyPairMemoryBackfill;
      const revision = previewRevisionFor(state.preview?.pairs?.[0]) || state.preview?.previewRevision;
      if (typeof method !== "function" || !revision) {
        emitText({ errorCode: "missing_preview_revision" }, "error", "ui.missingPreviewRevision", "预览缺少可用版本，未执行写入；请重新预览。");
        return { success: false, error: "missing_preview_revision" };
      }
      const writable = state.preview?.writable ?? state.ledger?.writable;
      if (writable === false) {
        emitFriendlyError({ errorCode: "pair_memory_read_only" }, "pair_memory_read_only");
        return { success: false, error: "pair_memory_read_only" };
      }
      emitText({ busy: true, operation: "apply", error: "", errorCode: "", result: null }, "message", "ui.updatingPair", "正在更新此关系的长期事项簿…");
      try {
        const response = await method.call(api, { ...basePayload(), previewRevision: revision });
        const code = response?.error || "";
        if (!response?.success && String(code).toLowerCase().includes("stale")) {
          emitText({ preview: null }, "message", "ui.previewExpired", "预览已过期，正在重新扫描；旧方案未写入。");
          if (!disposed) await preview(true);
          return response;
        }
        if (!response?.success) {
          emitFriendlyError({ errorCode: code || "pair_memory_apply_failed" }, code || "pair_memory_apply_failed");
          return response || { success: false, error: "pair_memory_apply_failed" };
        }
        emitText({ preview: null, result: response }, "message", "ui.pairUpdated", "此关系的长期事项簿已更新。");
        if (typeof root.dispatchEvent === "function" && typeof root.CustomEvent === "function") root.dispatchEvent(new root.CustomEvent("votc:pair-memory-index-updated", { detail: { ownerId, counterpartId } }));
        await refresh(0, state.sort);
        return response;
      } catch (error) {
        const code = error instanceof Error ? error.message : "pair_memory_apply_failed";
        if (code.toLowerCase().includes("stale")) {
          emitText({ preview: null }, "message", "ui.previewExpired", "预览已过期，正在重新扫描；旧方案未写入。");
          if (!disposed) await preview(true);
          return { success: false, error: code };
        }
        emitFriendlyError({ errorCode: code }, code);
        return { success: false, error: code };
      } finally {
        emit({ busy: false, operation: "" });
      }
    }

    async function applyBatch() {
      const method = api.applyPairMemoryBackfill;
      const pairs = Array.isArray(state.preview?.pairs) ? state.preview.pairs : [];
      if (typeof method !== "function" || !pairs.length) {
        emitText({ errorCode: "missing_preview_pairs" }, "error", "ui.missingPreviewPairs", "批量预览没有可执行的 Pair 或预览版本；请重新预览。");
        return { success: false, error: "missing_preview_pairs" };
      }
      if (state.preview?.writable === false) {
        emitFriendlyError({ errorCode: "pair_memory_read_only" }, "pair_memory_read_only");
        return { success: false, error: "pair_memory_read_only" };
      }
      const invalidPair = pairs.find((pair) => !Number.isSafeInteger(Number(pair.counterpartId)) || Number(pair.counterpartId) <= 0 || !previewRevisionFor(pair, false));
      if (invalidPair) {
        emitText({ errorCode: "invalid_preview_pair" }, "error", "ui.invalidPreviewPair", "批量预览缺少有效关系身份或预览版本，未执行写入；请重新预览。");
        return { success: false, error: "invalid_preview_pair" };
      }

      cancelRequested = false;
      const rows = [];
      emitText({
        busy: true,
        operation: "batch",
        error: "",
        errorCode: "",
        result: null,
        progress: { completedPairs: 0, totalPairs: pairs.length, rows: [], cancelRequested: false }
      }, "message", "ui.updatingBatch", "正在逐个关系更新。可取消后续关系；当前关系完成后停止。");
      try {
        for (const pair of pairs) {
          if (cancelRequested || disposed) break;
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
        const batchMessage = cancelled
          ? { key: "ui.batchCancelled", fallback: `已处理 ${rows.length}/${pairs.length} 个关系；已取消剩余关系。`, params: { completed: rows.length, total: pairs.length } }
          : { key: "ui.batchFinished", fallback: `已处理 ${rows.length}/${pairs.length} 个关系：成功 ${successes}，失败 ${failures}。`, params: { completed: rows.length, total: pairs.length, successes, failures } };
        emit({
          preview: null,
          result: { success: failures === 0 && !cancelled, pairs: rows },
          message: translateSpec(batchMessage)
        }, { message: batchMessage });
        if (typeof root.dispatchEvent === "function" && typeof root.CustomEvent === "function") root.dispatchEvent(new root.CustomEvent("votc:pair-memory-index-updated", { detail: { ownerId } }));
        if (!disposed && rows.some((row) => String(row.error).toLowerCase().includes("stale"))) {
          emitText({}, "message", "ui.batchPreviewStale", "部分关系的预览已过期；已完成的关系保留，本次未写入的关系正在重新预览。");
          await preview(true);
        }
        return { success: failures === 0 && !cancelled, pairs: rows, cancelled };
      } finally {
        emit({ busy: false, operation: "" });
      }
    }

    async function openSource(item) {
      const sequence = ++sourceSequence;
      const isCurrent = () => !disposed && sequence === sourceSequence;
      const source = item?.source || {};
      const sourceSummaryKey = source.sourceSummaryKey;
      const sourceRevision = source.sourceRevision;
      if (!sourceSummaryKey || !sourceRevision) {
        emitSourceError({ sourceModal: { item, errorCode: "source_identity_missing" }, ...(state.operation === "source" ? { busy: false, operation: "" } : {}) }, { key: "ui.sourceVersionMissing", fallback: "此事项缺少可验证的来源版本，无法安全打开原摘要。" });
        return;
      }
      const openMethod = typeof api.openPairMemorySource === "function";
      const resolver = openMethod ? api.openPairMemorySource : api.resolvePairMemorySource;
      if (typeof resolver !== "function") {
        emitSourceError({ sourceModal: { item, errorCode: "api_unavailable" }, ...(state.operation === "source" ? { busy: false, operation: "" } : {}) }, { key: "ui.sourceApiUnavailable", fallback: "原摘要来源验证接口尚未连接，请确认应用版本后重试。" });
        return;
      }
      emit({ busy: true, operation: "source", sourceModal: { item, loading: true, error: "" } });
      try {
        const response = await resolver.call(api, {
          ...basePayload(),
          sourceSummaryKey,
          ...(openMethod ? { expectedSourceRevision: sourceRevision } : { sourceRevision })
        });
        if (!isCurrent()) return response;
        if (!response?.success) {
          const code = response?.error || "SOURCE_UNAVAILABLE_OR_STALE";
          const stale = String(code).toLowerCase().includes("stale") || String(code).toLowerCase().includes("unavailable");
          const spec = stale ? { key: "ui.sourceStale", fallback: "来源已变化或已删除，未显示缓存内容。事项簿正在刷新，请重新打开。" } : errorTextSpec(code);
          emitSourceError({ sourceModal: { item, errorCode: code } }, spec);
          if (stale && isCurrent()) await refresh(state.page, state.sort);
          return response || { success: false, error: code };
        }
        const summary = response.summary && typeof response.summary === "object" ? response.summary : {};
        const content = typeof response.content === "string" ? response.content : typeof summary.content === "string" ? summary.content : "";
        if (!content) {
          emitSourceError({ sourceModal: { item, errorCode: "source_content_missing" } }, { key: "ui.sourceContentMissing", fallback: "已验证来源没有可显示的摘要正文。" });
          return { success: false, error: "source_content_missing" };
        }
        emit({ sourceModal: { item, response, summary, content, loading: false, error: "" } });
        return response;
      } catch (error) {
        if (!isCurrent()) return { success: false, error: error instanceof Error ? error.message : "SOURCE_UNAVAILABLE_OR_STALE" };
        const code = error instanceof Error ? error.message : "SOURCE_UNAVAILABLE_OR_STALE";
        const stale = code.toLowerCase().includes("stale") || code.toLowerCase().includes("unavailable");
        const spec = stale ? { key: "ui.sourceStale", fallback: "来源已变化或已删除，未显示缓存内容。事项簿正在刷新，请重新打开。" } : errorTextSpec(code);
        emitSourceError({ sourceModal: { item, errorCode: code } }, spec);
        if (stale && isCurrent()) await refresh(state.page, state.sort);
        return { success: false, error: code };
      } finally {
        if (isCurrent() && state.operation === "source") emit({ busy: false, operation: "" });
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
      showSourceError: (_message, errorCode = "source_navigation_failed") => emitSourceError({ sourceModal: { ...state.sourceModal, errorCode } }, errorTextSpec(errorCode)),
      refreshTranslations,
      changeSort: (sort) => refresh(0, sort === "oldest" ? "oldest" : "newest"),
      changePage: (page) => refresh(page, state.sort),
      setFilters: (query, fromDate, toDate) => {
        emit({ query: String(query || "").trim(), fromDate: String(fromDate || "").trim(), toDate: String(toDate || "").trim() });
        return refresh(0, state.sort);
      },
      closeSource: () => {
        sourceSequence++;
        emit({ sourceModal: null, ...(state.operation === "source" ? { busy: false, operation: "" } : {}) });
      },
      dispose: () => { disposed = true; cancelRequested = true; refreshSequence++; sourceSequence++; }
    };
  }

  function appendCounts(container, data, translate) {
    const rows = toCountRows(data, translate);
    if (rows.length) {
      const list = makeElement("dl", "pair-ledger-counts");
      for (const row of rows) {
        list.append(makeElement("dt", "", row.label), makeElement("dd", "", row.value));
      }
      container.append(list);
    }
    const reasons = toReasonRows(data, translate);
    if (reasons.length) {
      const list = makeElement("ul", "pair-ledger-skip-reasons");
      for (const row of reasons) list.append(makeElement("li", "", `${row.label}：${row.count}`));
      container.append(makeElement("h6", "", localized(translate, "ui.skippedReasons", "跳过原因")), list);
    }
  }

  function safeDiagnostic(value) {
    if (Array.isArray(value)) return value.map(safeDiagnostic);
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(Object.entries(value)
      .filter(([key, entry]) => {
        if (/(?:error|message|stack|path|folder|directory|(?:^|_)dir(?:$|_))/i.test(key)) return false;
        return !(/file/i.test(key) && typeof entry === "string" && /[\\/:]/.test(entry));
      })
      .map(([key, entry]) => [key, safeDiagnostic(entry)]));
  }

  function renderDiagnostics(parent, value, title = "来源诊断详情") {
    if (!value || typeof value !== "object") return;
    const details = makeElement("details", "pair-ledger-diagnostics");
    details.append(makeElement("summary", "", title));
    const pre = makeElement("pre", "", JSON.stringify(safeDiagnostic(value), null, 2));
    details.append(pre);
    parent.append(details);
  }

  function renderSourceModal(host, state, controller, names, options, translate) {
    const modal = makeElement("div", "pair-source-modal-backdrop");
    modal.setAttribute("role", "presentation");
    const panel = makeElement("section", "pair-source-modal");
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    panel.setAttribute("aria-label", localized(translate, "ui.verifiedSourceAria", "已验证的 Legacy 摘要来源"));
    const sourceState = state.sourceModal;
    const title = sourceState.summary?.date || sourceState.response?.conversationDate || sourceState.item?.conversationDate || localized(translate, "ui.sourceSummary", "来源摘要");
    const close = makeButton(localized(translate, "ui.close", "关闭"), () => controller.closeSource(), "");
    const header = makeElement("div", "pair-source-modal-header");
    header.append(makeElement("div", "", localized(translate, "ui.verifiedSourceTitle", "已验证的 Legacy 摘要")), close);
    panel.append(header, makeElement("p", "pair-source-modal-route", `${displayPersonName(sourceState.response?.ownerName || names.ownerName, translate)} → ${displayPersonName(sourceState.response?.counterpartName || names.counterpartName, translate)} · ${title}`));
    if (sourceState.loading) {
      panel.append(makeElement("p", "pair-ledger-status", localized(translate, "ui.verifyingSource", "正在向主进程验证来源身份与版本…")));
    } else if (sourceState.error) {
      panel.append(makeElement("p", "pair-ledger-error", sourceState.error));
      panel.append(makeButton(localized(translate, "ui.refreshLedger", "刷新事项簿"), () => controller.refresh(state.page, state.sort), ""));
    } else {
      const itemText = String(sourceState.item?.text || "");
      if (itemText) {
        const highlighted = makeElement("p", "pair-source-matched-item");
        highlighted.append(makeElement("strong", "", localized(translate, "ui.matchedItem", "对应事项：")), makeElement("mark", "", itemText));
        panel.append(highlighted);
      }
      const content = makeElement("pre", "pair-source-content", sourceState.content);
      panel.append(content);
      const locate = makeButton(localized(translate, "ui.locateAndEdit", "定位到此摘要并编辑"), async () => {
        if (typeof options.onLocateSource !== "function") return;
        const result = await options.onLocateSource(sourceState.response, sourceState.item);
        if (result?.success) controller.closeSource();
        else controller.showSourceError(result?.message || localized(translate, "ui.sourceNavigationFailed", "源摘要已刷新，但无法在当前摘要列表中唯一定位。请刷新后重试。"), result?.error || "source_navigation_failed");
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
      renderDiagnostics(panel, locator, localized(translate, "ui.sourceLocatorDetails", "来源定位详情"));
    }
    modal.append(panel);
    modal.addEventListener("click", (event) => {
      if (event.target === modal) controller.closeSource();
    });
    host.append(modal);
  }

  function mount(host, options = {}) {
    let disposed = false;
    let controller;
    let completedResult = null;
    let languageT = typeof options.t === "function" ? options.t : null;
    const translate = (key, params = {}) => {
      if (!languageT) return undefined;
      try {
        const fullKey = `legacyPair.${key}`;
        const value = languageT(fullKey, params);
        return typeof value === "string" && value && value !== fullKey ? value : undefined;
      } catch (_ignored) {
        return undefined;
      }
    };
    const childDisposers = [];
    const catalogHintUpdates = [];
    const catalogRouteLabels = [];
    let catalogEmptyMessage = null;
    let maintenanceSummary = null;
    let catalogRelationshipCount = 0;
    const rawNames = { ownerName: options.ownerName, counterpartName: options.counterpartName };
    const names = {
      ownerName: displayPersonName(rawNames.ownerName, translate),
      counterpartName: displayPersonName(rawNames.counterpartName, translate)
    };
    const modalHost = makeElement("div", "pair-ledger-modal-host");
    const contentHost = makeElement("div", "pair-ledger-folder-content");
    const folder = options.inline ? null : makeElement("details", "pair-ledger-folder");
    const folderLabel = makeElement("span", "pair-ledger-folder-label");
    const folderStatus = makeElement("span", "pair-ledger-folder-status");
    if (folder) {
      const summary = makeElement("summary", "pair-ledger-folder-summary");
      summary.append(makeElement("span", "pair-ledger-folder-icon", "📁"), folderLabel, folderStatus);
      folder.append(summary, contentHost);
    }
    const operationHost = makeElement("div", "pair-ledger-operation-host");
    const maintenance = options.mode === "owner" ? makeElement("details", "pair-ledger-maintenance") : null;
    if (maintenance) {
      const catalog = makeElement("div", "pair-ledger-catalog");
      const seen = new Set();
      for (const relation of options.counterparts || []) {
        const counterpartId = Number(relation.counterpartId);
        if (!Number.isSafeInteger(counterpartId) || counterpartId <= 0 || counterpartId === Number(options.ownerId) || seen.has(counterpartId)) continue;
        seen.add(counterpartId);
        const group = makeElement("details", "pair-ledger-group");
        const summary = makeElement("summary", "pair-ledger-group-summary");
        const hint = makeElement("span", "pair-ledger-group-hint");
        const route = makeElement("span", "pair-ledger-route");
        summary.append(route, hint);
        catalogRouteLabels.push({ node: route, counterpartName: relation.counterpartName });
        const childHost = makeElement("div", "pair-ledger-group-content");
        let mounted = false;
        let lastStatus = {};
        const updateHint = status => {
          lastStatus = status || {};
          hint.textContent = lastStatus.error ? localized(translate, "ui.readFailedExpand", "读取失败 · 请展开查看") : lastStatus.busy ? localized(translate, "ui.reading", "读取中…")
            : lastStatus.ledger ? localized(translate, "ui.itemCount", `${lastStatus.ledger.totalCount || 0} 条事项`, { count: lastStatus.ledger.totalCount || 0 }) : localized(translate, "ui.viewItems", "查看事项");
          hint.className = lastStatus.error ? "pair-ledger-group-hint is-error" : "pair-ledger-group-hint";
        };
        catalogHintUpdates.push(() => updateHint(lastStatus));
        updateHint(lastStatus);
        group.addEventListener("toggle", () => {
          if (disposed || !group.open || mounted) return;
          mounted = true;
          childDisposers.push(mount(childHost, { ...options, mode: "pair", inline: true, counterpartId,
            counterpartName: relation.counterpartName, onStatus: updateHint }));
        });
        group.append(summary, childHost);
        catalog.append(group);
      }
      catalogRelationshipCount = seen.size;
      folderStatus.textContent = localized(translate, "ui.relationshipCount", `${seen.size} 个关系`, { count: seen.size });
      if (!seen.size) {
        catalogEmptyMessage = makeElement("p", "pair-ledger-empty", localized(translate, "ui.noRelationships", "暂无可浏览的人物关系。"));
        catalog.append(catalogEmptyMessage);
      }
      maintenanceSummary = makeElement("summary", "", localized(translate, "ui.maintenance", "生成与更新"));
      maintenance.append(maintenanceSummary, operationHost);
      contentHost.append(catalog, maintenance);
    } else contentHost.append(operationHost);
    const updateStaticLabels = () => {
      names.ownerName = displayPersonName(rawNames.ownerName, translate);
      names.counterpartName = displayPersonName(rawNames.counterpartName, translate);
      folderLabel.textContent = options.mode === "owner"
        ? localized(translate, "ui.folderTitle", "长期事项簿")
        : localized(translate, "ui.pairFolderTitle", `${names.ownerName} → ${names.counterpartName} · 长期事项`, { owner: names.ownerName, counterpart: names.counterpartName });
      for (const route of catalogRouteLabels) {
        route.node.textContent = `${names.ownerName} → ${displayPersonName(route.counterpartName, translate)}`;
      }
      if (catalogEmptyMessage) catalogEmptyMessage.textContent = localized(translate, "ui.noRelationships", "暂无可浏览的人物关系。");
      if (maintenanceSummary) maintenanceSummary.textContent = localized(translate, "ui.maintenance", "生成与更新");
      if (maintenance && !folderStatus.classList.contains("is-error")) {
        folderStatus.textContent = localized(translate, "ui.relationshipCount", `${catalogRelationshipCount} 个关系`, { count: catalogRelationshipCount });
      }
      for (const update of catalogHintUpdates) update();
    };
    updateStaticLabels();
    host.replaceChildren(folder || contentHost, modalHost);

    function render(state) {
      if (disposed) return;
      if (typeof options.onStatus === "function") options.onStatus(state);
      folderStatus.className = state.error || state.result?.success === false
        ? "pair-ledger-folder-status is-error" : "pair-ledger-folder-status";
      operationHost.replaceChildren();
      modalHost.replaceChildren();
      const section = makeElement("section", `pair-ledger-panel is-${state.mode}`);
      const header = makeElement("div", "pair-ledger-header");
      if (state.mode === "owner") {
        header.append(makeElement("h5", "", localized(translate, "ui.updateOwnerLedger", `更新 ${names.ownerName} 的长期事项簿`, { owner: names.ownerName })));
        section.append(header);
      }

      if (state.mode === "pair") renderPairLedger(section, state, controller, names);
      if (state.busy && state.operation === "batch") {
        const progress = makeElement("div", "pair-ledger-batch-progress");
        progress.append(makeElement("p", "pair-ledger-status", localized(translate, "ui.batchProgress", `批量进度：${state.progress.completedPairs}/${state.progress.totalPairs} 个关系已处理。`, { completed: state.progress.completedPairs, total: state.progress.totalPairs })));
        if (state.progress.rows.length) {
          const list = makeElement("ul", "pair-ledger-apply-results");
          for (const row of state.progress.rows) {
            const route = `${displayPersonName(row.ownerName || names.ownerName, translate)} → ${displayPersonName(row.counterpartName, translate)}`;
            const status = row.success ? localized(translate, "ui.completed", "已完成") : localized(translate, "ui.failed", `失败：${friendlyError(row.error, translate)}`, { error: friendlyError(row.error, translate) });
            list.append(makeElement("li", row.success ? "is-success" : "is-error", `${route}：${status}`));
          }
          progress.append(list);
        }
        const cancel = makeButton(state.progress.cancelRequested ? localized(translate, "ui.stoppingBatch", "正在停止后续关系…") : localized(translate, "ui.cancelRemaining", "取消后续关系"), () => controller.cancelBatch(), "");
        cancel.disabled = state.progress.cancelRequested;
        progress.append(cancel);
        section.append(progress);
      }
      if (state.mode === "owner") renderBackfill(section, state, controller);
      else {
        const tools = makeElement("details", "pair-ledger-maintenance");
        tools.open = !!state.preview || state.busy && state.operation !== "load" || !!state.error;
        tools.append(makeElement("summary", "", localized(translate, "ui.maintenance", "生成与更新")));
        renderBackfill(tools, state, controller);
        section.append(tools);
      }
      if (state.message) section.append(makeElement("p", "pair-ledger-status", state.message));
      if (state.error) {
        folderStatus.textContent = localized(translate, "ui.attentionRequired", "需要处理 · 请展开查看");
        folderStatus.className = "pair-ledger-folder-status is-error";
        if (maintenance) maintenance.open = true;
        section.append(makeElement("p", "pair-ledger-error", state.error));
      }
      if (state.result) {
        if (state.result.success === false) {
          folderStatus.textContent = localized(translate, "ui.notCompleted", "未完成 · 请展开查看");
          if (maintenance) maintenance.open = true;
        }
        const details = makeElement("details", "pair-ledger-result-details");
        details.open = state.result.success === false;
        details.append(makeElement("summary", "", localized(translate, "ui.resultDetails", "本次处理详情")));
        renderApplyResult(details, state.result, state.progress, state.mode, translate);
        section.append(details);
        if (!state.busy && state.result.success === true && completedResult !== state.result) {
          completedResult = state.result;
          if (folder) folder.open = false;
          if (maintenance) maintenance.open = false;
          folderStatus.textContent = state.mode === "owner" ? localized(translate, "ui.updated", "已更新") : localized(translate, "ui.itemTotal", `共 ${state.ledger?.totalCount || 0} 条`, { count: state.ledger?.totalCount || 0 });
        }
      }
      operationHost.append(section);
      if (state.sourceModal) renderSourceModal(modalHost, state, controller, names, options, translate);
    }

    function renderPairLedger(section, state, controls) {
      if (state.busy && state.operation === "load" && !state.ledger) {
        section.append(makeElement("p", "pair-ledger-status", localized(translate, "ui.loadingLedger", "正在读取长期事项簿…")));
        return;
      }
      if (state.ledger?.writable === false) section.append(makeElement("p", "pair-ledger-readonly", localized(translate, "ui.readOnlyArchive", "只读归档：可以查看事项和来源，不能回填。")));
      if (state.ledger) {
        if (folder && !state.result) folderStatus.textContent = localized(translate, "ui.itemTotal", `共 ${state.ledger.totalCount || 0} 条`, { count: state.ledger.totalCount || 0 });
        const top = makeElement("div", "pair-ledger-controls");
        const count = Number(state.ledger.totalCount || 0);
        top.append(makeElement("span", "pair-ledger-total", localized(translate, "ui.itemTotal", `共 ${count} 条`, { count })));
        const sort = makeElement("select", "pair-ledger-sort");
        sort.setAttribute("aria-label", localized(translate, "ui.sortAria", "事项日期排序"));
        for (const [value, label] of [["newest", localized(translate, "ui.newestFirst", "由新到旧")], ["oldest", localized(translate, "ui.oldestFirst", "由旧到新")]]) {
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
        search.placeholder = localized(translate, "ui.searchPlaceholder", "搜索人物、物品、事件或年份");
        search.value = state.query;
        search.setAttribute("aria-label", localized(translate, "ui.searchAria", "搜索长期事项"));
        const from = makeElement("input", "", "");
        from.type = "text";
        from.placeholder = localized(translate, "ui.fromDatePlaceholder", "起始日期，如 1090.01.01");
        from.value = state.fromDate;
        from.setAttribute("aria-label", localized(translate, "ui.fromDateAria", "事项开始日期"));
        const to = makeElement("input", "", "");
        to.type = "text";
        to.placeholder = localized(translate, "ui.toDatePlaceholder", "结束日期，如 1099.12.31");
        to.value = state.toDate;
        to.setAttribute("aria-label", localized(translate, "ui.toDateAria", "事项结束日期"));
        const applyFilters = makeButton(localized(translate, "ui.filter", "筛选"), () => {}, "");
        applyFilters.type = "submit";
        filters.append(search, from, to, applyFilters);
        filters.addEventListener("submit", (event) => {
          event.preventDefault();
          controls.setFilters(search.value, from.value, to.value);
        });
        section.append(filters);

        const items = Array.isArray(state.ledger.items) ? state.ledger.items : [];
        if (items.length === 0) section.append(makeElement("p", "pair-ledger-empty", localized(translate, "ui.noItems", "当前筛选范围没有长期事项。没有事项不代表没有其他 Legacy 叙事记忆。")));
        const list = makeElement("ol", "pair-ledger-items");
        for (const item of items) {
          const row = makeElement("li", "pair-ledger-item");
          row.append(makeElement("p", "pair-ledger-item-text", item.text || ""),
            makeElement("time", "pair-ledger-item-date", item.conversationDate || localized(translate, "ui.dateUnrecorded", "日期未记录")));
          const actions = makeElement("div", "pair-ledger-item-actions");
          actions.append(makeButton(localized(translate, "ui.viewOriginalSummary", "查看原摘要"), () => controls.openSource(item), ""));
          const sourceDetails = makeElement("details", "pair-ledger-source-details");
          sourceDetails.append(makeElement("summary", "", localized(translate, "ui.expandSourceEvidence", "展开来源与证据")));
          sourceDetails.append(makeElement("p", "", localized(translate, "ui.sourceDateAndEvidence", `来源日期：${item.conversationDate || "未记录"} · ${formatInteractionEvidence(item.interactionEvidence, translate)}`, { date: item.conversationDate || localized(translate, "ui.unrecorded", "未记录"), evidence: formatInteractionEvidence(item.interactionEvidence, translate) })));
          renderDiagnostics(sourceDetails, item.source || {}, localized(translate, "ui.sourceDiagnostics", "来源诊断详情"));
          actions.append(sourceDetails);
          const sourceActions = makeElement("details", "pair-ledger-item-source");
          sourceActions.append(makeElement("summary", "", localized(translate, "ui.source", "来源")), actions);
          row.append(sourceActions);
          list.append(row);
        }
        section.append(list);

        const page = Number(state.ledger.page ?? state.page);
        const pageSize = Number(state.ledger.pageSize ?? state.pageSize);
        const pageCount = Math.ceil(count / Math.max(1, pageSize));
        if (pageCount > 1) {
          const nav = makeElement("nav", "pair-ledger-pagination");
          nav.setAttribute("aria-label", localized(translate, "ui.paginationAria", "长期事项分页"));
          nav.append(makeButton(localized(translate, "ui.previousPage", "上一页"), () => controls.changePage(page - 1), ""));
          nav.append(makeElement("span", "", localized(translate, "ui.pageCount", `第 ${page + 1} / ${pageCount} 页`, { page: page + 1, total: pageCount })));
          nav.append(makeButton(localized(translate, "ui.nextPage", "下一页"), () => controls.changePage(page + 1), ""));
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
        ? localized(translate, "ui.generateOwnerLedger", "批量生成长期事项簿（仅当前合法战役）")
        : currentCount > 0 ? localized(translate, "ui.rescanLedger", "重新扫描并更新长期事项簿") : localized(translate, "ui.extractLedger", "自动提取长期事项");
      if (!state.preview) {
        const button = makeButton(state.busy && state.operation === "preview" ? localized(translate, "ui.readOnlyPreviewLoading", "正在只读预览…") : buttonText, () => controls.preview(), "pair-ledger-preview-button");
        button.disabled = state.busy;
        section.append(button);
        return;
      }

      const preview = state.preview;
      const previewCard = makeElement("div", "pair-ledger-preview");
      previewCard.append(makeElement("h6", "", localized(translate, "ui.backfillPreview", "回填预览（尚未写入）")));
      if (preview.writable === false) previewCard.append(makeElement("p", "pair-ledger-readonly", localized(translate, "ui.previewReadOnly", "当前来源仅可查看：所属战役未绑定、存在歧义或当前角色无法验证，不能确认写入。")));
      if (preview.offlineBackfill === true) previewCard.append(makeElement("p", "pair-ledger-offline", localized(translate, "ui.offlineBackfill", "已验证历史摘要的唯一战役绑定，无需连接游戏；确认后只生成本地事项簿。")));
      appendCounts(previewCard, preview, translate);
      const reasons = toReasonRows(preview, translate);
      if (!reasons.length && Number(preview.skippedCount ?? preview.counts?.skippedCount) > 0) {
        previewCard.append(makeElement("p", "pair-ledger-status", localized(translate, "ui.skippedDiagnosticsHint", "有摘要被跳过；请展开诊断详情查看服务端返回的原因。")));
      }
      const previewItems = getPreviewItems(preview);
      if (previewItems.length) {
        const list = makeElement("ul", "pair-ledger-preview-items");
        for (const item of previewItems.slice(0, 8)) {
          const li = makeElement("li", "");
          const dateAndRoute = makeElement("div", "pair-ledger-preview-source");
          dateAndRoute.append(makeElement("time", "", item.conversationDate || item.date || localized(translate, "ui.dateUnrecorded", "日期未记录")));
          const owner = item.ownerName || options.ownerName;
          const counterpart = item.counterpartName || options.counterpartName;
          if (owner || counterpart) dateAndRoute.append(makeElement("span", "", ` · ${displayPersonName(owner, translate)} → ${displayPersonName(counterpart, translate)}`));
          li.append(dateAndRoute);
          li.append(makeElement("p", "", item.text || ""));
          const sourcePreview = item.sourceSummaryPreview || item.summaryPreview || item.source?.summaryPreview;
          if (sourcePreview) li.append(makeElement("small", "", localized(translate, "ui.sourceSummaryPreview", `来源摘要：${sourcePreview}`, { summary: sourcePreview })));
          if (item.source) renderDiagnostics(li, item.source, localized(translate, "ui.sourceLocatorDetails", "来源定位详情"));
          list.append(li);
        }
        const previewTitle = previewItems.length > 8
          ? localized(translate, "ui.candidatePreviewLimited", `候选事项预览（前 ${Math.min(previewItems.length, 8)} 条）`, { limit: 8 })
          : localized(translate, "ui.candidatePreview", "候选事项预览");
        previewCard.append(makeElement("h6", "", previewTitle), list);
      }
      if (Array.isArray(preview.pairs) && preview.pairs.length) {
        const pairs = makeElement("ul", "pair-ledger-preview-pairs");
        for (const pair of preview.pairs) {
          const label = `${displayPersonName(pair.ownerName || options.ownerName, translate)} → ${displayPersonName(pair.counterpartName, translate)}`;
          const counts = toCountRows(pair, translate).map((entry) => `${entry.label} ${entry.value}`).join(" · ");
          pairs.append(makeElement("li", "", counts ? `${label}：${counts}` : label));
        }
        previewCard.append(makeElement("h6", "", localized(translate, "ui.relationshipScope", `关系范围：${preview.pairs.length}`, { count: preview.pairs.length })), pairs);
      }
      renderDiagnostics(previewCard, preview, localized(translate, "ui.previewDiagnostics", "预览诊断详情"));
      const actions = makeElement("div", "pair-ledger-preview-actions");
      actions.append(makeButton(localized(translate, "ui.cancelNoWrite", "取消（不写入）"), () => controls.cancelPreview(), ""));
      if (state.mode === "owner") {
        const apply = makeButton(state.busy ? localized(translate, "ui.executing", "正在执行…") : localized(translate, "ui.confirmOwnerLedger", "确认生成此 Owner 的长期事项簿"), () => controls.applyBatch(), "primary-button");
        apply.disabled = state.busy || preview.writable === false || !Array.isArray(preview.pairs) || preview.pairs.length === 0;
        actions.append(apply);
      } else {
        const apply = makeButton(state.busy ? localized(translate, "ui.executing", "正在执行…") : localized(translate, "ui.confirmPairLedger", "确认生成此关系的长期事项簿"), () => controls.applySingle(), "primary-button");
        apply.disabled = state.busy || preview.writable === false || state.ledger?.writable === false;
        actions.append(apply);
      }
      previewCard.append(actions);
      section.append(previewCard);
    }

    function renderApplyResult(section, result, progress, mode, translate) {
      const rows = Array.isArray(result?.pairs) ? result.pairs : [];
      if (mode === "owner" && progress.totalPairs > 0) {
        section.append(makeElement("p", "pair-ledger-status", localized(translate, "ui.batchProgress", `批量进度：${progress.completedPairs}/${progress.totalPairs} 个关系已处理。`, { completed: progress.completedPairs, total: progress.totalPairs })));
      }
      if (!rows.length) {
        appendCounts(section, result, translate);
        if (result?.error) section.append(makeElement("p", "pair-ledger-error", friendlyError(result.error, translate)));
        return;
      }
      const list = makeElement("ul", "pair-ledger-apply-results");
      for (const row of rows) {
        const name = `${displayPersonName(row.ownerName, translate)} → ${displayPersonName(row.counterpartName, translate)}`;
        const status = row.success ? localized(translate, "ui.completed", "已完成") : localized(translate, "ui.failed", `失败：${friendlyError(row.error, translate)}`, { error: friendlyError(row.error, translate) });
        const summary = makeElement("li", row.success ? "is-success" : "is-error", `${name}：${status}`);
        const counts = toCountRows(row, translate);
        if (Number.isFinite(Number(row.totalCount))) counts.push({ label: localized(translate, "counts.finalItems", "最终事项"), value: Number(row.totalCount) });
        if (counts.length) summary.append(makeElement("small", "", counts.map((entry) => `${entry.label} ${entry.value}`).join(" · ")));
        list.append(summary);
      }
      section.append(list);
    }

    controller = createController(root.conversationAPI || {}, { ...options, t: translate }, render);
    render(controller.state);
    if (options.mode !== "owner") controller.refresh();
    const progressEvent = (event) => {
      const detail = event.detail || {};
      if (Number(detail.ownerId) !== Number(options.ownerId)) return;
      if (detail.counterpartId && options.counterpartId && Number(detail.counterpartId) !== Number(options.counterpartId)) return;
      if (controller.state.operation === "apply") return;
      controller.refresh(0, controller.state.sort);
    };
    root.addEventListener("votc:pair-memory-index-updated", progressEvent);
    const cleanup = () => {
      disposed = true;
      root.removeEventListener("votc:pair-memory-index-updated", progressEvent);
      controller.dispose();
      for (const dispose of childDisposers) dispose();
      host.replaceChildren();
    };
    cleanup.updateLanguage = (nextT) => {
      if (disposed) return;
      languageT = typeof nextT === "function" ? nextT : null;
      const snapshot = captureUiState(host);
      updateStaticLabels();
      controller.refreshTranslations();
      for (const dispose of childDisposers) {
        if (typeof dispose.updateLanguage === "function") dispose.updateLanguage(nextT);
      }
      restoreUiState(host, snapshot);
    };
    return cleanup;
  }

  const api = { mount, createController, displayPersonName, friendlyError, toCountRows, toReasonRows, getPreviewItems };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.VOTCPairLongTermUi = api;
})(typeof window !== "undefined" ? window : globalThis);
