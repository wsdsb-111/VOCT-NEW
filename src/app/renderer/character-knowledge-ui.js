"use strict";

(function () {
  const STATUS_LABELS = {
    KNOWN: "已知",
    MANUAL_KNOWN: "手动标记已知",
    MANUAL_HIDDEN: "手动设为未知",
    UNKNOWN: "未知",
    STALE: "来源已变化"
  };

  const SOURCE_LABELS = {
    MANUAL: "人工确认",
    WORLDLINE_REALM_PUBLIC: "同一领地公开事实",
    GAME_DATA_KNOWN_SECRET: "当前运行数据已明确披露给此 Owner",
    VISIBLE_TRAIT_CANDIDATE: "可见外貌候选，尚无认知证据",
    CHECKPOINT_CANDIDATE: "当前存档候选，尚无认知证据",
    SOURCE_STALE: "原认知记录对应的存档已变化"
  };

  function element(tagName, className, text) {
    const node = document.createElement(tagName);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function errorMessage(error) {
    const code = String(error?.message || error || "");
    if (code.includes("campaign_changed")) return "战役已切换，请刷新摘要后重试。";
    if (code.includes("source_changed")) return "当前存档已变化，请重新载入人物认知。";
    if (code.includes("revision_conflict")) return "此项认知刚刚发生变化，请刷新后重试。";
    if (code.includes("checkpoint_unavailable")) return "当前没有可验证的 Worldline 存档。";
    if (code.includes("campaign_unavailable")) return "当前存档缺少可靠的战役标识，人物认知保持只读。";
    if (code.includes("state_invalid")) return "人物认知数据无法验证，已停止读取或写入。";
    return "人物认知暂时不可用，请刷新后重试。";
  }

  function sourceText(fact) {
    if (fact.sourceStatus === "STALE") return SOURCE_LABELS.SOURCE_STALE;
    return SOURCE_LABELS[fact.source] || "来源未验证";
  }

  function renderFact(fact, onChange, disabled) {
    const row = element("article", "character-knowledge-fact");
    const title = element("div", "character-knowledge-fact-heading");
    const kind = fact.factType === "TITLE" ? "头衔" : "特质";
    title.append(element("strong", "", `${kind}：${fact.value || "名称未载入"}`));
    const status = fact.sourceStatus === "STALE" ? "STALE" : fact.status;
    title.append(element("span", `character-knowledge-status is-${status.toLowerCase()}`, STATUS_LABELS[status] || "未知"));
    row.append(title);

    const details = [sourceText(fact)];
    if (fact.firstAcquiredDate) details.push(`获知时间：${fact.firstAcquiredDate}`);
    if (fact.manualMarkedDate && fact.source === "MANUAL") details.push(`人工标记日期：${fact.manualMarkedDate}`);
    row.append(element("small", "character-knowledge-source", details.join(" · ")));

    const button = element("button", "character-knowledge-toggle", fact.effectiveKnown ? "设为未知" : "标记此 Owner 已知");
    button.type = "button";
    button.disabled = disabled;
    button.title = fact.effectiveKnown
      ? "仅将此 Owner 对当前事实的认知设为未知"
      : "仅将此 Owner 标记为明确知道当前事实";
    button.addEventListener("click", () => onChange(fact, fact.effectiveKnown ? "MANUAL_HIDDEN" : "MANUAL_KNOWN"));
    row.append(button);
    return row;
  }

  function mount(host, { ownerRuntimeId } = {}) {
    let disposed = false;
    let ownerView = null;
    let targetView = null;
    let selectedTargetId = "";
    let loading = false;
    let busy = false;
    let error = "";
    let message = "";
    let expanded = false;

    const render = () => {
      if (disposed) return;
      host.replaceChildren();
      const section = element("section", "character-knowledge-panel");
      const header = element("div", "character-knowledge-header");
      const heading = element("div", "character-knowledge-heading");
      heading.append(element("h5", "", "人物认知"));
      heading.append(element("p", "", `Owner：${ownerView?.owner?.displayName || "姓名未载入"}。每位 Owner 的认知单独保存。`));
      header.append(heading);
      const openButton = element("button", "character-knowledge-open", expanded ? "收起" : "管理认知");
      openButton.type = "button";
      openButton.setAttribute("aria-expanded", String(expanded));
      openButton.addEventListener("click", async () => {
        expanded = !expanded;
        if (expanded) await loadOwnerView();
        render();
      });
      header.append(openButton);
      if (expanded) {
        const refreshButton = element("button", "character-knowledge-refresh", "刷新");
        refreshButton.type = "button";
        refreshButton.disabled = loading || busy;
        refreshButton.addEventListener("click", async () => {
          await loadOwnerView();
          if (selectedTargetId && ownerView) await loadTargetView();
          render();
        });
        header.append(refreshButton);
      }
      section.append(header);
      if (error && !expanded) section.append(element("p", "character-knowledge-error", error));

      if (expanded) {
        section.append(element("p", "character-knowledge-help", "只使用当前 Worldline 存档中的候选。领地公开头衔和当前日志明确披露给此 Owner 的秘密可自动标为已知；可见外貌特质可由你明确确认。未授权的秘密特质与未分类特质不会作为未知候选显示。角色身份按 Runtime ID 绑定，姓名仅作显示。"));
        if (loading) section.append(element("p", "character-knowledge-state", "正在验证当前战役和存档修订…"));
        if (error) section.append(element("p", "character-knowledge-error", error));
        if (message) section.append(element("p", "character-knowledge-message", message));
        if (ownerView?.available) {
          const selection = element("label", "character-knowledge-target-picker");
          selection.append(element("span", "", "认知对象"));
          const select = element("select", "");
          select.setAttribute("aria-label", "选择认知对象");
          const placeholder = element("option", "", "选择人物姓名");
          placeholder.value = "";
          select.append(placeholder);
          for (const target of ownerView.targets || []) {
            const option = element("option", "", target.displayName || "姓名未载入");
            option.value = target.runtimeId;
            select.append(option);
          }
          select.value = selectedTargetId;
          select.disabled = busy || loading;
          select.addEventListener("change", async () => {
            selectedTargetId = select.value;
            targetView = null;
            message = "";
            if (selectedTargetId) await loadTargetView();
            render();
          });
          selection.append(select);
          section.append(selection);
        }
        if (targetView?.available) {
          const targetName = targetView.target?.displayName || "姓名未载入";
          const facts = element("div", "character-knowledge-facts");
          facts.append(element("div", "character-knowledge-target-heading", `关于${targetName}的当前存档事实`));
          const sourceEvidence = targetView.recognition?.evidenceCompleteness === "PARTIAL_SOURCE_CHANGED"
            ? "部分人工认知来源已变化，需在当前存档重新确认"
            : "按当前存档和运行来源验证";
          facts.append(element("p", "character-knowledge-recognition", `认识方式：当前战役存档${targetView.recognition?.historyCountsAvailable ? "，已验证互动记录" : "；历史对话次数无可信记录，未计数"} · 当前来源：${sourceEvidence}`));
          if (!targetView.facts?.length) facts.append(element("p", "character-knowledge-state", "当前存档没有可验证的特质或头衔记录。"));
          for (const fact of targetView.facts || []) facts.append(renderFact(fact, changeStatus, busy));
          section.append(facts);
          section.append(element("p", "character-knowledge-asof", `事实截至：${targetView.checkpointAsOf || "日期未载入"}。存档修订改变后，旧人工状态不会自动沿用。`));
        } else if (selectedTargetId && !loading && !error) {
          section.append(element("p", "character-knowledge-state", "正在读取该人物的当前事实…"));
        }
      }
      host.append(section);
    };

    const loadOwnerView = async () => {
      loading = true;
      error = "";
      render();
      try {
        ownerView = await window.characterKnowledgeAPI.getOwnerView({ ownerRuntimeId });
        if (!ownerView?.available) throw new Error("character_knowledge_checkpoint_unavailable");
      } catch (cause) {
        error = errorMessage(cause);
        ownerView = null;
      } finally {
        loading = false;
        render();
      }
    };

    const loadTargetView = async () => {
      if (!ownerView?.scope || !selectedTargetId) return;
      loading = true;
      error = "";
      render();
      try {
        targetView = await window.characterKnowledgeAPI.getTargetView({
          ...ownerView.scope,
          targetRuntimeId: selectedTargetId
        });
        if (!targetView?.available) throw new Error("character_knowledge_target_unavailable");
      } catch (cause) {
        error = errorMessage(cause);
        targetView = null;
      } finally {
        loading = false;
      }
    };

    const changeStatus = async (fact, status) => {
      if (!targetView?.scope || busy) return;
      busy = true;
      message = "正在保存认知状态…";
      error = "";
      render();
      try {
        targetView = await window.characterKnowledgeAPI.setManualStatus({
          ...targetView.scope,
          factType: fact.factType,
          factKey: fact.factKey,
          factSourceSnapshotId: fact.factSourceSnapshotId,
          status,
          expectedRevision: fact.revision
        });
        message = status === "MANUAL_KNOWN" ? "已将此事实标记为该 Owner 已知。" : "已将此事实从该 Owner 的认知中隐藏。";
      } catch (cause) {
        error = errorMessage(cause);
        targetView = null;
      } finally {
        busy = false;
        render();
      }
    };

    render();
    loadOwnerView();
    return () => {
      disposed = true;
      host.replaceChildren();
    };
  }

  window.VOTCCharacterKnowledgeUi = Object.freeze({ mount });
})();
