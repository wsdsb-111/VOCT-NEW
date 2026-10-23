"use strict";

(function () {
  const STATUS_LABELS = {
    KNOWN: "已知",
    AUTO_DISCLOSED: "对话已披露",
    MANUAL_KNOWN: "人工标记已知",
    MANUAL_HIDDEN: "人工设为未知",
    UNKNOWN: "未确认",
    STALE: "来源已变化"
  };

  const SOURCE_LABELS = {
    CONVERSATION_DISCLOSURE: "原始对话披露记录",
    UNDISCLOSED: "原始对话没有披露记录",
    MANUAL: "人工认知设置",
    GAME_DATA_KNOWN_SECRET: "运行数据的披露记录",
    IN_PERSON_OBSERVATION: "在场可见的外貌／身体白名单特质",
    PUBLIC_CLOSE_FAMILY: "已公开的父母子女／亲兄弟姐妹关系",
    PUBLIC_NICKNAME: "公开称号",
    SOURCE_STALE: "对应的原始对话来源已变化"
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

  function element(tagName, className, text) {
    const node = document.createElement(tagName);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function errorTextSpec(error) {
    const code = String(error?.message || error || "").toLowerCase();
    if (code.includes("conversation_changed")) return { key: "errors.conversationChanged", fallback: "当前对话已切换，请重新选择人物。" };
    if (code.includes("campaign_changed")) return { key: "errors.campaignChanged", fallback: "当前战役已切换，请刷新人物认知后重试。" };
    if (code.includes("campaign_unavailable")) return { key: "errors.campaignUnavailable", fallback: "当前对话缺少可验证的战役信息，暂不能管理人物认知。" };
    if (code.includes("source_changed")) return { key: "errors.sourceChanged", fallback: "原始对话证据已变化，请重新载入人物认知。" };
    if (code.includes("revision_conflict")) return { key: "errors.revisionConflict", fallback: "这项认知刚刚发生变化，请刷新后重试。" };
    if (code.includes("conversation_unavailable")) return { key: "errors.conversationUnavailable", fallback: "当前没有可读取的活动对话。" };
    if (code.includes("state_invalid")) return { key: "errors.stateInvalid", fallback: "人物认知数据无法验证，已停止读取或写入。" };
    if (code.includes("automatic_access")) return { key: "errors.automaticAccess", fallback: "此特质由可见白名单或公开直系亲属关系提供，请刷新查看。" };
    return { key: "errors.generic", fallback: "人物认知暂时不可用，请刷新本场对话后重试。" };
  }

  function sourceText(fact, translate) {
    if (fact.sourceStatus === "STALE" || fact.status === "STALE") return localized(translate, "sources.stale", SOURCE_LABELS.SOURCE_STALE);
    const keys = {
      CONVERSATION_DISCLOSURE: "conversationDisclosure",
      UNDISCLOSED: "undisclosed",
      MANUAL: "manual",
      GAME_DATA_KNOWN_SECRET: "gameDataKnownSecret",
      IN_PERSON_OBSERVATION: "inPersonObservation",
      PUBLIC_CLOSE_FAMILY: "publicCloseFamily",
      PUBLIC_NICKNAME: "publicNickname"
    };
    return localized(translate, `sources.${keys[fact.source] || "unknown"}`, SOURCE_LABELS[fact.source] || "来源未分类");
  }

  function renderFact(fact, onChange, disabled, translate) {
    const row = element("article", "character-knowledge-fact");
    const title = element("div", "character-knowledge-fact-heading");
    const kindKey = fact.factType === "NAME" ? "name" : fact.factType === "NICKNAME" ? "nickname" : fact.factType === "TITLE" ? "title" : "trait";
    const kindFallback = fact.factType === "NAME" ? "姓名" : fact.factType === "NICKNAME" ? "称号" : fact.factType === "TITLE" ? "头衔" : "特质";
    const kind = localized(translate, `kinds.${kindKey}`, kindFallback);
    const value = fact.value || localized(translate, "common.unknownName", "名称未载入");
    title.append(element("strong", "", localized(translate, "ui.factValue", `${kind}：${value}`, { kind, value })));
    const status = fact.sourceStatus === "STALE" ? "STALE" : fact.status;
    const statusKeys = { KNOWN: "known", AUTO_DISCLOSED: "autoDisclosed", MANUAL_KNOWN: "manualKnown", MANUAL_HIDDEN: "manualHidden", UNKNOWN: "unknown", STALE: "stale" };
    const label = fact.currentDirectObservation
      ? localized(translate, "statuses.directKnown", "直接可知")
      : localized(translate, `statuses.${statusKeys[status] || "unavailable"}`, STATUS_LABELS[status] || "状态未载入");
    title.append(element("span", `character-knowledge-status is-${String(status || "unknown").toLowerCase()}`, label));
    row.append(title);

    const details = [sourceText(fact, translate)];
    if (fact.hasDisclosureRecord && fact.source !== "CONVERSATION_DISCLOSURE") details.push(localized(translate, "ui.hasDisclosureRecord", "已有对话披露记录"));
    if (fact.firstAcquiredDate) details.push(localized(translate, "ui.acquiredAt", `获知时间：${fact.firstAcquiredDate}`, { date: fact.firstAcquiredDate }));
    row.append(element("small", "character-knowledge-source", details.join(" · ")));

    if (fact.factType === "TRAIT" && !fact.currentDirectObservation) {
      const button = element("button", "character-knowledge-toggle", fact.effectiveKnown
        ? localized(translate, "ui.setUnknown", "设为未知")
        : localized(translate, "ui.markKnown", "标记已知"));
      button.type = "button";
      button.disabled = disabled || status === "STALE" || !fact.factSourceSnapshotId || fact.revision === undefined;
      button.title = fact.effectiveKnown
        ? localized(translate, "ui.setUnknownTooltip", "只改变“谁知道”所选人物对这项特质的认知")
        : localized(translate, "ui.markKnownTooltip", "只将“谁知道”所选人物标记为明确知道这项特质");
      button.addEventListener("click", () => onChange(fact, fact.effectiveKnown ? "MANUAL_HIDDEN" : "MANUAL_KNOWN"));
      row.append(button);
    }
    window.VOTCV95PageVisuals?.decorateLegacyRow(row, { target: title, icon: "knowledge" });
    return row;
  }

  function runtimeIdKey(person) {
    if (!person || person.runtimeId === null || person.runtimeId === undefined) return "";
    return String(person.runtimeId);
  }

  function normalizeConversationView(view) {
    if (!view || view.available !== true) {
      const reason = String(view?.reason || "no_active_conversation");
      return { available: false, reason, signature: JSON.stringify(["unavailable", reason]) };
    }
    const scope = view.scope;
    const conversationId = scope?.conversationId;
    if (conversationId === null || conversationId === undefined || String(conversationId).trim() === "" || !Array.isArray(view.participants)) {
      return { available: false, reason: "conversation_view_invalid", signature: "invalid" };
    }
    const participants = [];
    const seen = new Set();
    for (const person of view.participants) {
      const key = runtimeIdKey(person);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const displayName = String(person.displayName || "").trim();
      participants.push({
        runtimeId: person.runtimeId,
        key,
        displayName,
        isPlayer: person.isPlayer === true
      });
    }
    const participantSignature = participants.map((person) => [person.key, person.displayName, person.isPlayer]).sort((a, b) => a[0].localeCompare(b[0]));
    const signature = JSON.stringify([
      String(conversationId),
      scope.campaignToken ?? null,
      scope.sourceSnapshotId ?? null,
      participantSignature
    ]);
    return { available: true, scope, participants, signature };
  }

  function sameScopeValue(actual, expected) {
    return actual !== null && actual !== undefined && String(actual) === String(expected);
  }

  function mount(host, options = {}) {
    let languageT = typeof options.t === "function" ? options.t : null;
    const translate = (key, fallback, params) => {
      if (!languageT) return fallback;
      try {
        const fullKey = `legacyKnowledge.${key}`;
        const value = languageT(fullKey, params || {});
        return typeof value === "string" && value && value !== fullKey ? value : fallback;
      } catch (_ignored) {
        return fallback;
      }
    };
    const translateSpec = spec => {
      const params = { ...spec.params };
      if (spec.missingOwnerName) params.owner = translate("common.unknownName", "姓名未载入");
      if (spec.missingTargetName) params.target = translate("common.unknownName", "姓名未载入");
      return localized(translate, spec.key, spec.fallback, params);
    };
    let disposed = false;
    let conversationView = null;
    let conversationSignature = "";
    let conversationError = "";
    let conversationErrorSpec = null;
    let conversationLoading = true;
    let selectedOwnerId = "";
    let selectedTargetId = "";
    let ownerView = null;
    let targetView = null;
    let ownerLoading = false;
    let targetLoading = false;
    let busy = false;
    let error = "";
    let errorSpec = null;
    let message = "";
    let messageSpec = null;
    let refreshTimer = null;
    let conversationRequestId = 0;
    let ownerRequestId = 0;
    let targetRequestId = 0;
    let mutationRequestId = 0;

    const selectedOwner = () => conversationView?.participants.find((person) => person.key === selectedOwnerId) || null;
    const selectedTarget = () => conversationView?.participants.find((person) => person.key === selectedTargetId) || null;
    const personName = person => {
      const name = String(typeof person === "string" ? person : person?.displayName || "").trim();
      return !name || name === "姓名未载入" ? translate("common.unknownName", "姓名未载入") : name;
    };

    const clearPairState = () => {
      ownerRequestId += 1;
      targetRequestId += 1;
      mutationRequestId += 1;
      selectedOwnerId = "";
      selectedTargetId = "";
      ownerView = null;
      targetView = null;
      ownerLoading = false;
      targetLoading = false;
      busy = false;
      error = "";
      errorSpec = null;
      message = "";
      messageSpec = null;
    };

    const availableTargets = () => {
      if (!ownerView?.available || !selectedOwnerId) return [];
      const allowed = new Set((ownerView.targets || []).map(runtimeIdKey).filter(Boolean));
      return (conversationView?.participants || []).filter((person) => person.key !== selectedOwnerId && allowed.has(person.key));
    };

    const addPicker = (section, labelText, ariaLabel, people, selectedId, disabled, onChange) => {
      const label = element("label", "character-knowledge-picker");
      label.append(element("span", "", labelText));
      const select = element("select", "");
      select.setAttribute("aria-label", ariaLabel);
      const placeholder = element("option", "", translate("ui.choosePerson", "选择人物姓名"));
      placeholder.value = "";
      select.append(placeholder);
      for (const person of people) {
        const option = element("option", "", personName(person));
        option.value = person.key;
        select.append(option);
      }
      select.value = selectedId;
      select.disabled = disabled;
      select.addEventListener("change", () => onChange(select.value));
      label.append(select);
      section.append(label);
    };

    const render = () => {
      if (disposed) return;
      host.replaceChildren();
      const section = element("section", "character-knowledge-panel");
      const header = element("div", "character-knowledge-header");
      const heading = element("div", "character-knowledge-heading");
      heading.append(element("h5", "", translate("ui.title", "人物认知 · 当前对话")));
      heading.append(element("p", "", translate("ui.intro", "认知按“谁知道谁”分别记录。公开披露让实际在场的听众获知；私语只传给指定对象，候场和缺席人物不会获知。")));
      header.append(heading);
      const refreshButton = element("button", "character-knowledge-refresh", conversationLoading
        ? translate("ui.refreshing", "正在刷新…") : translate("ui.refresh", "刷新本场"));
      refreshButton.type = "button";
      refreshButton.disabled = conversationLoading || busy;
      refreshButton.addEventListener("click", () => { void refreshCurrentScope(); });
      header.append(refreshButton);
      section.append(header);

      section.append(element("p", "character-knowledge-help", translate("ui.help", "分别选择“谁知道”和“关于谁”。姓名、头衔显示披露记录，称号保持公开可见。外貌／身体白名单及已公开的父母子女、亲兄弟姐妹关系可直接提供特质信息；其他特质可逐人手动设为已知或未知。")));

      if (conversationLoading && !conversationView) {
        section.append(element("p", "character-knowledge-state", translate("ui.loadingParticipants", "正在读取本场对话参与者…")));
      } else if (conversationError) {
        section.append(element("p", "character-knowledge-error", conversationError));
      } else if (!conversationView?.available) {
        const unavailableMessage = conversationView?.reason?.includes("campaign_unavailable")
          ? translate("ui.campaignUnavailable", "当前对话缺少可验证的战役信息，暂不能查看人物认知。")
          : translate("ui.noConversation", "当前没有活动对话。开始对话后，可查看本场人物之间的一对一披露。");
        section.append(element("p", "character-knowledge-state", unavailableMessage));
      } else if (conversationView.participants.length < 2) {
        section.append(element("p", "character-knowledge-state", translate("ui.notEnoughParticipants", "当前会话还没有其他参与者，暂时没有可查看的一对一披露。")));
      } else {
        addPicker(section, translate("ui.ownerLabel", "谁知道"), translate("ui.ownerAria", "选择谁知道"), conversationView.participants, selectedOwnerId, busy || conversationLoading, async (value) => {
          if (busy || value === selectedOwnerId) return;
          selectedOwnerId = value;
          selectedTargetId = "";
          ownerView = null;
          targetView = null;
          ownerLoading = false;
          targetLoading = false;
          error = "";
          errorSpec = null;
          message = "";
          messageSpec = null;
          render();
          if (value) await loadOwnerView();
        });

        const targetPeople = availableTargets();
        addPicker(section, translate("ui.targetLabel", "关于谁"), translate("ui.targetAria", "选择关于谁"), targetPeople, selectedTargetId, busy || !ownerView?.available || ownerLoading || targetLoading || conversationLoading, async (value) => {
          if (busy || value === selectedTargetId) return;
          selectedTargetId = value;
          targetView = null;
          error = "";
          errorSpec = null;
          message = "";
          messageSpec = null;
          render();
          if (value) await loadTargetView();
        });

        if (ownerLoading) section.append(element("p", "character-knowledge-state", translate("ui.loadingOwner", "正在读取所选方向的对话披露…")));
        if (targetLoading) section.append(element("p", "character-knowledge-state", translate("ui.loadingTarget", "正在读取这组人物的认知记录…")));
        if (error) section.append(element("p", "character-knowledge-error", error));
        if (message) section.append(element("p", "character-knowledge-message", message));

        if (!selectedOwnerId) {
          section.append(element("p", "character-knowledge-state", translate("ui.chooseOwner", "请选择一位本场听众，再独立选择披露内容涉及的人物。")));
        } else if (ownerView?.available && !selectedTargetId && !ownerLoading) {
          section.append(element("p", "character-knowledge-state", translate("ui.chooseTarget", "请选择一位与所选听众不同的人物；不会自动反转或配对披露方向。")));
        }

        if (targetView?.available) {
          const ownerName = personName(targetView.owner?.displayName || selectedOwner());
          const targetName = personName(targetView.target?.displayName || selectedTarget());
          const facts = element("div", "character-knowledge-facts");
          facts.append(element("div", "character-knowledge-target-heading", translate("ui.targetHeading", `对${ownerName}而言，关于${targetName}的披露记录`, { owner: ownerName, target: targetName })));
          const visibleFacts = (targetView.facts || []).filter((fact) => ["NAME", "NICKNAME", "TITLE", "TRAIT"].includes(fact.factType));
          if (!visibleFacts.length) facts.append(element("p", "character-knowledge-state", translate("ui.noFacts", "这组人物之间没有可显示的姓名、头衔或特质披露记录。")));
          for (const fact of visibleFacts) facts.append(renderFact(fact, changeStatus, busy || conversationLoading, translate));
          section.append(facts);
          if (targetView.checkpointAsOf) section.append(element("p", "character-knowledge-asof", translate("ui.recordsAsOf", `记录截至：${targetView.checkpointAsOf}`, { date: targetView.checkpointAsOf })));
        }
      }
      host.append(section);
    };

    const viewScopeMatches = (scope, ownerId, targetId) => {
      if (!scope || !conversationView?.available) return false;
      if (!sameScopeValue(scope.conversationId, conversationView.scope.conversationId)) return false;
      if (!sameScopeValue(scope.ownerRuntimeId, ownerId)) return false;
      if (scope.campaignToken !== undefined && String(scope.campaignToken ?? "") !== String(conversationView.scope.campaignToken ?? "")) return false;
      if (scope.sourceSnapshotId !== undefined && String(scope.sourceSnapshotId ?? "") !== String(conversationView.scope.sourceSnapshotId ?? "")) return false;
      if (targetId !== undefined && !sameScopeValue(scope.targetRuntimeId, targetId)) return false;
      return true;
    };

    const loadOwnerView = async (preserveTargetId = "") => {
      const owner = selectedOwner();
      if (!owner || !conversationView?.available) return;
      const conversationAtStart = conversationSignature;
      const requestId = ++ownerRequestId;
      targetRequestId += 1;
      ownerView = null;
      targetView = null;
      ownerLoading = true;
      targetLoading = false;
      error = "";
      errorSpec = null;
      render();
      try {
        const result = await window.characterKnowledgeAPI.getOwnerView({
          conversationId: conversationView.scope.conversationId,
          ownerRuntimeId: owner.runtimeId
        });
        if (disposed || requestId !== ownerRequestId || conversationAtStart !== conversationSignature || selectedOwnerId !== owner.key) return;
        if (!result?.available) throw new Error("character_knowledge_owner_unavailable");
        if (!viewScopeMatches(result.scope, owner.runtimeId) || runtimeIdKey(result.owner) !== owner.key) {
          throw new Error("conversation_changed");
        }
        ownerView = result;
        const allowed = new Set((ownerView.targets || []).map(runtimeIdKey).filter(Boolean));
        selectedTargetId = preserveTargetId && allowed.has(preserveTargetId) && conversationView.participants.some((person) => person.key === preserveTargetId)
          ? preserveTargetId
          : "";
      } catch (cause) {
        if (disposed || requestId !== ownerRequestId || conversationAtStart !== conversationSignature || selectedOwnerId !== owner.key) return;
        errorSpec = errorTextSpec(cause);
        error = translateSpec(errorSpec);
        ownerView = null;
        selectedTargetId = "";
      } finally {
        if (!disposed && requestId === ownerRequestId && conversationAtStart === conversationSignature && selectedOwnerId === owner.key) {
          ownerLoading = false;
          render();
        }
      }
      if (!disposed && selectedTargetId && ownerView?.available) await loadTargetView();
    };

    const loadTargetView = async () => {
      const owner = selectedOwner();
      const target = selectedTarget();
      if (!owner || !target || !ownerView?.scope || !availableTargets().some((person) => person.key === target.key)) return;
      const conversationAtStart = conversationSignature;
      const ownerAtStart = selectedOwnerId;
      const targetAtStart = selectedTargetId;
      const ownerScope = ownerView.scope;
      const requestId = ++targetRequestId;
      targetView = null;
      targetLoading = true;
      error = "";
      errorSpec = null;
      render();
      try {
        const result = await window.characterKnowledgeAPI.getTargetView({
          ...ownerScope,
          targetRuntimeId: target.runtimeId
        });
        if (disposed || requestId !== targetRequestId || conversationAtStart !== conversationSignature || selectedOwnerId !== ownerAtStart || selectedTargetId !== targetAtStart) return;
        if (!result?.available) throw new Error("character_knowledge_target_unavailable");
        if (!viewScopeMatches(result.scope, owner.runtimeId, target.runtimeId) || runtimeIdKey(result.owner) !== owner.key || runtimeIdKey(result.target) !== target.key) {
          throw new Error("conversation_changed");
        }
        targetView = result;
      } catch (cause) {
        if (disposed || requestId !== targetRequestId || conversationAtStart !== conversationSignature || selectedOwnerId !== ownerAtStart || selectedTargetId !== targetAtStart) return;
        errorSpec = errorTextSpec(cause);
        error = translateSpec(errorSpec);
        targetView = null;
      } finally {
        if (!disposed && requestId === targetRequestId && conversationAtStart === conversationSignature && selectedOwnerId === ownerAtStart && selectedTargetId === targetAtStart) {
          targetLoading = false;
          render();
        }
      }
    };

    const changeStatus = async (fact, status) => {
      const owner = selectedOwner();
      const target = selectedTarget();
      if (!owner || !target || fact.factType !== "TRAIT" || !targetView?.scope || busy) return;
      const conversationAtStart = conversationSignature;
      const ownerAtStart = selectedOwnerId;
      const targetAtStart = selectedTargetId;
      const requestId = ++mutationRequestId;
      busy = true;
      messageSpec = { key: "ui.saving", fallback: "正在保存这组人物之间的特质认知…" };
      message = translateSpec(messageSpec);
      error = "";
      errorSpec = null;
      render();
      try {
        const result = await window.characterKnowledgeAPI.setManualStatus({
          ...targetView.scope,
          factType: fact.factType,
          factKey: fact.factKey,
          factSourceSnapshotId: fact.factSourceSnapshotId,
          status,
          expectedRevision: fact.revision
        });
        if (disposed || requestId !== mutationRequestId || conversationAtStart !== conversationSignature || selectedOwnerId !== ownerAtStart || selectedTargetId !== targetAtStart) return;
        if (!result?.available || !viewScopeMatches(result.scope, owner.runtimeId, target.runtimeId)) throw new Error("conversation_changed");
        targetView = result;
        const ownerName = personName(owner);
        const targetName = personName(target);
        const missingOwnerName = !owner.displayName || owner.displayName === "姓名未载入";
        const missingTargetName = !target.displayName || target.displayName === "姓名未载入";
        messageSpec = {
          key: "ui.saved",
          fallback: `已更新“${ownerName} → ${targetName}”的特质认知；只影响这个方向。`,
          params: { owner: missingOwnerName ? undefined : owner.displayName, target: missingTargetName ? undefined : target.displayName },
          missingOwnerName,
          missingTargetName
        };
        message = translateSpec(messageSpec);
      } catch (cause) {
        if (disposed || requestId !== mutationRequestId || conversationAtStart !== conversationSignature || selectedOwnerId !== ownerAtStart || selectedTargetId !== targetAtStart) return;
        errorSpec = errorTextSpec(cause);
        error = translateSpec(errorSpec);
        targetView = null;
      } finally {
        if (!disposed && requestId === mutationRequestId && conversationAtStart === conversationSignature && selectedOwnerId === ownerAtStart && selectedTargetId === targetAtStart) {
          busy = false;
          render();
        }
      }
    };

    const acceptConversationView = (view) => {
      if (view.signature === conversationSignature) {
        conversationView = view;
        return false;
      }
      conversationSignature = view.signature;
      conversationView = view;
      clearPairState();
      return true;
    };

    const refreshConversationView = async () => {
      const requestId = ++conversationRequestId;
      conversationLoading = true;
      conversationError = "";
      conversationErrorSpec = null;
      render();
      try {
        const api = window.characterKnowledgeAPI;
        if (!api || typeof api.getConversationView !== "function") throw new Error("conversation_unavailable");
        const view = normalizeConversationView(await api.getConversationView());
        if (disposed || requestId !== conversationRequestId) return false;
        const changed = acceptConversationView(view);
        conversationError = "";
        conversationErrorSpec = null;
        return changed;
      } catch (cause) {
        if (disposed || requestId !== conversationRequestId) return false;
        const failedView = { available: false, reason: "conversation_read_failed", signature: JSON.stringify(["error", "conversation_read_failed"]) };
        acceptConversationView(failedView);
        conversationErrorSpec = errorTextSpec(cause);
        conversationError = translateSpec(conversationErrorSpec);
        return true;
      } finally {
        if (!disposed && requestId === conversationRequestId) {
          conversationLoading = false;
          render();
        }
      }
    };

    const refreshCurrentScope = async () => {
      const previousSignature = conversationSignature;
      const ownerId = selectedOwnerId;
      const targetId = selectedTargetId;
      await refreshConversationView();
      if (disposed || !conversationView?.available || conversationSignature !== previousSignature || selectedOwnerId !== ownerId || !ownerId) return;
      await loadOwnerView(targetId);
    };

    const scheduleConversationCheck = () => {
      if (refreshTimer !== null) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => {
        refreshTimer = null;
        if (busy) { scheduleConversationCheck(); return; }
        void refreshCurrentScope();
      }, 100);
    };

    render();
    let unsubscribe = null;
    if (typeof window.conversationAPI?.onConversationUpdate === "function") {
      unsubscribe = window.conversationAPI.onConversationUpdate(scheduleConversationCheck);
    }
    void refreshConversationView();
    const cleanup = () => {
      disposed = true;
      conversationRequestId += 1;
      ownerRequestId += 1;
      targetRequestId += 1;
      mutationRequestId += 1;
      if (refreshTimer !== null) clearTimeout(refreshTimer);
      if (typeof unsubscribe === "function") unsubscribe();
      host.replaceChildren();
    };
    cleanup.updateLanguage = (nextT) => {
      if (disposed) return;
      languageT = typeof nextT === "function" ? nextT : null;
      if (conversationErrorSpec) conversationError = translateSpec(conversationErrorSpec);
      if (errorSpec) error = translateSpec(errorSpec);
      if (messageSpec) message = translateSpec(messageSpec);
      const snapshot = captureUiState(host);
      render();
      restoreUiState(host, snapshot);
    };
    return cleanup;
  }

  window.VOTCCharacterKnowledgeUi = Object.freeze({ mount });
})();
