"use strict";

(function exposeWorldlinePlayerPresentation(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.VOTCWorldlinePlayerPresentation = api;
})(typeof window !== "undefined" ? window : globalThis, function createWorldlinePlayerPresentation() {
  const INTERNAL_VALUES = new Set([
    "DIRECT",
    "LIVE_CONFIRMED",
    "NO_MATCH",
    "CONFLICT",
    "DISPLAY_LITERAL",
    "NOT_CONNECTED",
    "UNKNOWN_WITHOUT_SAVE_AB_GATE",
    "Game Truth",
    "Supplemental",
    "Player Supplemental",
    "PUBLIC_WORLD",
    "COURT_PUBLIC",
    "PERSONAL",
    "SECRET",
    "NORMAL",
    "HIGH"
  ]);

  const isChinese = (locale) => String(locale || "").toLowerCase().startsWith("zh");
  const copyText = (value, fallback) => value === null || value === undefined || value === "" ? fallback : String(value);
  const unique = (values) => [...new Set(values.filter((value) => value !== null && value !== undefined && String(value).trim() !== "").map((value) => String(value).trim()))];
  const isReadable = (value, rawKey) => {
    const candidate = String(value || "").trim();
    if (!candidate || INTERNAL_VALUES.has(candidate)) return false;
    if (/[_#{}]|\(\s*#\d+\s*\)|^[0-9.:-]+$|[A-Za-z]\d|^[A-Z][A-Z0-9_]+$/.test(candidate)) return false;
    return true;
  };

  function labels(locale) {
    const zh = isChinese(locale);
    return {
      unknown: zh ? "暂不可用" : "Unavailable",
      unresolved: zh ? "未解析" : "Unresolved",
      sourceConflict: zh ? "名称来源存在冲突" : "Name sources conflict",
      historicalFigure: zh ? "历史人物" : "Historical figure",
      currentCharacter: zh ? "当前角色" : "Current character",
      noConclusion: zh ? "当前世界线中暂无可确认结论" : "No confirmed conclusion is available for the current worldline"
    };
  }

  function referenceCandidates(reference) {
    const localization = reference?.localization || {};
    return unique([
      reference?.displayName,
      localization.localizedValue,
      ...(Array.isArray(localization.sources) ? localization.sources.map((source) => source?.value || source?.localizedValue) : [])
    ]);
  }

  function reference(reference, fallback, locale) {
    const text = labels(locale);
    const localization = reference?.localization || {};
    const rawKey = reference?.rawKey || null;
    const candidates = referenceCandidates(reference).filter((value) => isReadable(value, rawKey));
    const conflict = localization.confidence === "CONFLICT" || localization.status === "CONFLICT" || candidates.length > 1 && Array.isArray(localization.sources) && localization.sources.length > 1;
    const displayName = conflict && candidates.length > 1 ? candidates.join(" / ") : candidates[0] || fallback || text.unknown;
    return {
      displayName,
      status: conflict ? text.sourceConflict : null,
      warning: conflict,
      detailsAvailable: !!reference,
      rawKey,
      confidence: localization.confidence || null,
      source: localization.sourceMod || localization.sourceFile || null,
      sourceCount: Array.isArray(localization.sources) ? localization.sources.length : 0
    };
  }

  function date(value, locale) {
    const text = copyText(value, "—");
    const match = text.match(/^(\d+)\.(\d+)\.(\d+)$/) || text.match(/^(\d+)年(\d+)月(\d+)日$/);
    if (!match) return text;
    return isChinese(locale) ? `${match[1]}年${match[2]}月${match[3]}日` : `${match[2]}/${match[3]}/${match[1]}`;
  }

  function timestamp(value, locale) {
    if (!value) return "—";
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return String(value);
    return parsed.toLocaleString(isChinese(locale) ? "zh-CN" : "en-US");
  }

  function status(value, locale) {
    const zh = isChinese(locale);
    const map = {
      UNCONFIGURED: zh ? "未配置" : "Unconfigured",
      VALIDATING: zh ? "读取中" : "Reading",
      VALID: zh ? "已连接" : "Connected",
      ACTIVE: zh ? "已就绪" : "Ready",
      READY: zh ? "已就绪" : "Ready",
      PARTIAL: zh ? "来源不完整" : "Sources incomplete",
      BUILDING: zh ? "构建中" : "Building",
      FRESH: zh ? "已同步" : "Synced",
      AGING: zh ? "临近更新" : "Update due soon",
      STALE: zh ? "需要重新读取存档" : "Save needs to be re-read",
      CHECKPOINT_ONLY: zh ? "已读取存档" : "Save read",
      LIVE_VERIFIED: zh ? "实时已确认" : "Live verified",
      UNAVAILABLE: zh ? "暂不可用" : "Unavailable",
      FAILED: zh ? "读取失败" : "Read failed",
      READ_ERROR: zh ? "读取失败" : "Read failed",
      NOT_FOUND: zh ? "未找到存档" : "Save not found",
      NOT_AUTOSAVE: zh ? "不是年度存档" : "Not the annual save",
      UNSUPPORTED_CONTAINER: zh ? "存档格式暂不支持" : "Save format unsupported"
    };
    return map[String(value || "").toUpperCase()] || (value ? (zh ? "状态待确认" : "Status pending") : labels(locale).unknown);
  }

  function source(value, locale) {
    const zh = isChinese(locale);
    const map = {
      GAME_TRUTH: zh ? "存档事实" : "Save facts",
      "GAME TRUTH": zh ? "存档事实" : "Save facts",
      GAMESTATE: zh ? "存档记录" : "Save record",
      DIRECT_GAMESTATE: zh ? "存档事实" : "Save facts",
      LIVE: zh ? "实时游戏状态" : "Live game state",
      LIVE_GAMESTATE: zh ? "实时游戏状态" : "Live game state",
      ANNUAL_DELTA: zh ? "年度变化" : "Annual change",
      SYSTEM_SUPPLEMENTAL: zh ? "系统补充" : "System supplement",
      PLAYER_SUPPLEMENTAL: zh ? "玩家补充" : "Player supplement",
      "PLAYER SUPPLEMENTAL": zh ? "玩家补充" : "Player supplement",
      HISTORICAL_BASELINE: zh ? "历史背景" : "Historical context",
      SUPPLEMENTAL: zh ? "系统补充" : "System supplement"
    };
    return map[String(value || "").toUpperCase()] || (zh ? "世界线来源" : "Worldline source");
  }

  function freshness(value, mode, liveDate, locale) {
    if (String(value || "").toUpperCase() === "CHECKPOINT_ONLY" || !liveDate && ["FRESH", "AGING"].includes(String(value || "").toUpperCase())) return status("FRESH", locale);
    return status(value, locale);
  }

  function identity(value, locale) {
    const zh = isChinese(locale);
    const map = {
      RESOLVED: zh ? "已确认身份" : "Identity confirmed",
      DIRECT: zh ? "已绑定" : "Bound",
      LIVE_CONFIRMED: zh ? "已实时确认" : "Confirmed live",
      AMBIGUOUS: zh ? "存在多个候选" : "Multiple candidates",
      AMBIGUOUS_PROVENANCE: zh ? "存在多个候选" : "Multiple candidates",
      CONFLICT: zh ? "信息存在冲突" : "Conflicting information",
      NO_MATCH: zh ? "暂未找到对应人物" : "No matching character yet",
      REJECTED: zh ? "证据不足，未确认" : "Insufficient evidence"
    };
    return map[String(value || "").toUpperCase()] || (value ? (zh ? "状态待确认" : "Status pending") : labels(locale).unknown);
  }

  function coverage(value, locale) {
    const zh = isChinese(locale);
    const map = {
      RESOLVED: zh ? "已确认身份" : "Identity confirmed",
      AMBIGUOUS: zh ? "存在多个候选，未确认" : "Multiple candidates; not confirmed",
      SOURCE_INCOMPLETE: zh ? "历史来源尚未完整读取" : "Historical sources are incomplete",
      NAME_INDEX_MISS: zh ? "索引中暂无这个完整姓名" : "This full name is not in the index",
      DEFINITION_FOUND_RUNTIME_MISSING: zh ? "找到历史定义，但当前存档没有对应角色" : "Definition found, but no current role is bound",
      REJECTED_BY_EVIDENCE: zh ? "找到候选，但证据不足" : "Candidate found, but evidence is insufficient",
      VOTC_METADATA_MISSING: zh ? "缺少补充历史资料" : "Curated historical metadata is missing"
    };
    return map[String(value || "").toUpperCase()] || identity(value, locale);
  }

  function explanationReason(value, locale) {
    const zh = isChinese(locale);
    const map = {
      NO_HISTORICAL_ALIAS: zh ? "没有命中可确认的历史姓名或别名。" : "No confirmable historical name or alias was matched.",
      HISTORICAL_FIGURE_UNSUPPORTED: zh ? "当前没有足够的历史资料支持确认。" : "There is not enough historical metadata to confirm this identity.",
      NO_RUNTIME_CANDIDATES: zh ? "索引中的历史定义没有对应当前存档角色。" : "The indexed definition has no corresponding current save character.",
      UNIQUE_EVIDENCE_INSUFFICIENT: zh ? "只有一个候选，但年龄、性别或其他第二身份证据不足。" : "There is one candidate, but age, gender, or another secondary identity signal is insufficient.",
      ALL_CANDIDATES_CONFLICT: zh ? "候选之间存在来源或身份绑定冲突。" : "The candidates contain source or identity-binding conflicts.",
      MULTIPLE_CANDIDATES: zh ? "多个候选证据接近，系统不会自动猜测。" : "Multiple candidates have comparable evidence, so the system will not guess.",
      UNIQUE_EVIDENCE_SUFFICIENT: zh ? "姓名、绑定关系与第二身份证据共同支持唯一角色。" : "Name, binding and secondary evidence support one character.",
      NAME_INDEX_MISS: zh ? "当前已读取的历史姓名索引没有收录此姓名；仍可独立查询存档中的普通角色。" : "The loaded historical-name index has no entry for this name; ordinary save characters can still be queried.",
      DEFINITION_RUNTIME_BINDING_CONFLICT: zh ? "同一历史定义的角色绑定不一致，不能据此确认身份。" : "The definition has inconsistent runtime bindings; identity cannot be confirmed.",
      CURATED_METADATA_CONFLICT: zh ? "补充历史资料与游戏人物定义存在冲突。" : "Curated metadata conflicts with the game definition.",
      SOURCE_INCOMPLETE: zh ? "历史来源仍在后台读取或存在缺失，当前结果不代表人物不存在。" : "Historical sources are still loading or incomplete; this does not establish that the person is absent."
    };
    return map[String(value || "").toUpperCase()] || (zh ? "暂无可读判定依据，可在开发者原始数据中查看原因。" : "No readable explanation is available; consult developer data for the reason.");
  }

  function evidenceLabel(value, locale) {
    const zh = isChinese(locale);
    const map = {
      NAME_EXACT: zh ? "历史姓名完全匹配" : "Exact historical-name match",
      NAME_ALIAS: zh ? "历史别名匹配" : "Historical-alias match",
      AGE_MATCH_STRONG: zh ? "出生年份高度符合" : "Birth year strongly matches",
      AGE_MATCH_WEAK: zh ? "出生年份大致符合" : "Birth year is a weak match",
      GENDER_MATCH: zh ? "性别资料一致" : "Gender metadata matches",
      CULTURE_HINT_MATCH: zh ? "文化提示一致" : "Culture hint matches",
      DEFINITION_RUNTIME_BINDING: zh ? "历史定义与当前角色存在绑定" : "Definition is bound to the current role",
      DEFINITION_SOURCE_CONFLICT: zh ? "历史来源互相冲突" : "Historical sources conflict",
      DEFINITION_RUNTIME_BINDING_CONFLICT: zh ? "历史定义与当前角色绑定不一致" : "Definition/runtime binding conflicts",
      AGE_IMPOSSIBLE: zh ? "年龄不可能" : "Impossible age",
      AGE_MISMATCH: zh ? "年龄不一致" : "Age mismatch",
      GENDER_CONFLICT: zh ? "性别资料冲突" : "Gender metadata conflicts"
    };
    return map[String(value || "").toUpperCase()] || (zh ? "其他依据（详见开发者数据）" : "Other evidence (see developer data)");
  }

  function historicalExplanation(promptDiagnostics, locale) {
    const analysis = promptDiagnostics?.queryAnalysis || {};
    const resolution = analysis.identityResolution || promptDiagnostics?.identityResolution || {};
    const coverageItems = Array.isArray(analysis.historicalCoverage) ? analysis.historicalCoverage : Array.isArray(promptDiagnostics?.historicalCoverage) ? promptDiagnostics.historicalCoverage : [];
    const coverageItem = coverageItems[0] || null;
    const rawStatus = coverageItem?.status || resolution.status || "NO_MATCH";
    const candidateItems = Array.isArray(resolution.candidates) ? resolution.candidates : Array.isArray(analysis.candidateCharacters) ? analysis.candidateCharacters : [];
    const candidates = candidateItems.slice(0, 50).map((candidate) => {
      const candidateName = [candidate?.displayName, candidate?.rawName, candidate?.aliasCandidate].find((value) => isReadable(value, candidate?.rawName || candidate?.aliasCandidate));
      return {
        displayName: candidateName || labels(locale).historicalFigure,
        score: candidate?.score ?? null,
        evidence: Array.isArray(candidate?.evidence) ? candidate.evidence.map((item) => evidenceLabel(typeof item === "string" ? item : item?.code || item?.type || item?.kind, locale)).filter(Boolean) : [],
        conflicts: Array.isArray(candidate?.conflicts) ? candidate.conflicts.map((item) => evidenceLabel(typeof item === "string" ? item : item?.code || item?.type || item?.kind, locale)).filter(Boolean) : []
      };
    });
    return {
      status: rawStatus,
      statusLabel: coverage(rawStatus, locale),
      reason: explanationReason(coverageItem?.reason || resolution.reason || rawStatus, locale),
      reasonCode: coverageItem?.reason || resolution.reason || rawStatus,
      candidateCount: Number.isFinite(resolution.candidateTotal) ? resolution.candidateTotal : candidateItems.length,
      candidates,
      sourceComplete: promptDiagnostics?.historicalIndex?.sourceComplete === true,
      indexStatus: promptDiagnostics?.historicalIndex?.status || null,
      indexStatusLabel: promptDiagnostics?.historicalIndex?.status ? status(promptDiagnostics.historicalIndex.status, locale) : labels(locale).unknown,
      detailsAvailable: Boolean(coverageItem || resolution.status || promptDiagnostics?.historicalIndex)
    };
  }

  function connection(sourceInfo, checkpoint, locale) {
    const validation = String(sourceInfo?.validationStatus || "").toUpperCase();
    const pipeline = String(checkpoint?.status || "").toUpperCase();
    if (validation === "VALID" || pipeline === "ACTIVE") return isChinese(locale) ? "已连接" : "Connected";
    if (validation === "VALIDATING" || pipeline === "BUILDING") return isChinese(locale) ? "读取中" : "Reading";
    return status(validation || pipeline || "UNCONFIGURED", locale);
  }

  function visibility(value, locale) {
    const zh = isChinese(locale);
    return ({ PUBLIC_WORLD: zh ? "所有人可知" : "Public", COURT_PUBLIC: zh ? "宫廷内公开" : "Court public", PERSONAL: zh ? "个人信息" : "Personal", SECRET: zh ? "秘密" : "Secret" })[String(value || "").toUpperCase()] || (zh ? "可见范围待确认" : "Visibility pending");
  }

  function importance(value, locale) {
    return ({ NORMAL: isChinese(locale) ? "普通" : "Normal", HIGH: isChinese(locale) ? "重要" : "Important" })[String(value || "").toUpperCase()] || (isChinese(locale) ? "重要程度待确认" : "Importance pending");
  }

  function actor(value, locale) {
    const candidate = typeof value === "object" && value ? value.displayName || value.name || value.rawName : value;
    const clean = String(candidate || "").replace(/\s*\(#\d+\)\s*$/, "").trim();
    if (isReadable(clean)) return clean;
    return isChinese(locale) ? "相关人物" : "Related character";
  }

  function name(value, locale) {
    const text = copyText(value, "");
    const withoutId = text.replace(/\s*\(#\d+\)\s*$/, "").trim();
    return isReadable(withoutId, withoutId) ? withoutId : labels(locale).currentCharacter;
  }

  function bindingStatus(value, locale) {
    const match = String(value || "").match(/^(\d+)/);
    const count = match ? match[1] : null;
    const rawStatus = String(value || "").match(/\b(DIRECT|LIVE_CONFIRMED|CONFLICT|AMBIGUOUS_PROVENANCE|NO_MATCH)\b/)?.[1] || null;
    const label = rawStatus ? identity(rawStatus, locale) : labels(locale).unknown;
    return count ? `${count} · ${label}` : label;
  }

  function knowledge(item, locale) {
    const zh = isChinese(locale);
    const id = String(item?.id || "").toLowerCase();
    const title = ({
      "game-date": zh ? "存档日期" : "Save date",
      player: zh ? "当前玩家" : "Current player",
      "primary-title": zh ? "主头衔" : "Primary title",
      "active-wars": zh ? "进行中的战争" : "Active wars"
    })[id] || (isReadable(item?.title, item?.key) ? item.title : (zh ? "世界知识" : "World knowledge"));
    let value = item?.body || item?.value;
    if (id === "game-date") value = date(value, locale);
    if (id === "player") value = name(value, locale);
    if (id === "primary-title" && !isReadable(value, value)) value = zh ? "名称未解析" : "Name unavailable";
    return { title, value: copyText(value, "—"), source: source(item?.source, locale), visibility: item?.visibility ? visibility(item.visibility, locale) : null };
  }

  function event(item, locale) {
    const zh = isChinese(locale);
    const type = String(item?.type || "").toUpperCase();
    const uncertainWar = type === "WAR_NO_LONGER_ACTIVE" || type === "WAR_ENDED" && String(item?.source || "").toUpperCase() === "DERIVED_GAMESTATE";
    if (uncertainWar) return { title: zh ? "战争疑似结束" : "War may have ended", detail: zh ? "该战争已不在当前活跃战争列表中。系统尚未确认其结束时间或最终结果。" : "The war is no longer in the active-war list. Its end date and result are not confirmed.", status: zh ? "待核实" : "Pending verification", source: source("SYSTEM_SUPPLEMENTAL", locale) };
    const map = {
      WAR_STARTED: [zh ? "战争开始" : "War started", zh ? "已确认" : "Confirmed"],
      WAR_ENDED: [zh ? "战争结束" : "War ended", zh ? "已确认" : "Confirmed"],
      IMPORTANT_CHARACTER_DIED: [zh ? "重要人物去世" : "Important character died", zh ? "已确认" : "Confirmed"],
      TITLE_HOLDER_CHANGED: [zh ? "头衔持有人变更" : "Title holder changed", zh ? "已确认" : "Confirmed"]
    };
    const [title, state] = map[type] || [zh ? "世界线发生变化" : "Worldline changed", zh ? "状态待确认" : "Status pending"];
    return { title, detail: null, status: state, source: source(item?.source, locale) };
  }

  function historical(item, locale) {
    const text = labels(locale);
    const readableFigure = [item?.historicalName, item?.figureName, item?.displayName, item?.name, item?.alias].find((value) => isReadable(value, item?.figureKey));
    const readableCharacter = [item?.currentCharacterName, item?.characterName, item?.character?.displayName, item?.character?.name].find((value) => isReadable(value, item?.runtimeId));
    const rawStatus = item?.identityStatus || item?.status || "NO_MATCH";
    const statusText = identity(rawStatus, locale);
    const confidence = ({ LIVE_CONFIRMED: isChinese(locale) ? "高" : "High", DIRECT: isChinese(locale) ? "中" : "Medium", RESOLVED: isChinese(locale) ? "高" : "High", AMBIGUOUS_PROVENANCE: isChinese(locale) ? "待复核" : "Review", CONFLICT: isChinese(locale) ? "待复核" : "Review" })[String(rawStatus).toUpperCase()] || (isChinese(locale) ? "待确认" : "Pending");
    return {
      figure: readableFigure || text.historicalFigure,
      character: readableCharacter || text.currentCharacter,
      status: statusText,
      confidence,
      note: String(rawStatus).toUpperCase() === "CONFLICT" ? text.sourceConflict : String(rawStatus).toUpperCase() === "AMBIGUOUS_PROVENANCE" ? (isChinese(locale) ? "多个历史定义指向同一角色" : "Multiple historical definitions point to the same character") : null
    };
  }

  function promptSummary(promptDiagnostics, locale) {
    const zh = isChinese(locale);
    const analysis = promptDiagnostics?.queryAnalysis || {};
    const resolution = analysis.identityResolution || promptDiagnostics?.identityResolution || {};
    const resolvedNames = [...(Array.isArray(analysis.resolvedCharacters) ? analysis.resolvedCharacters : []), ...(Array.isArray(analysis.resolvedTitles) ? analysis.resolvedTitles : [])].map((item) => isReadable(item?.displayName) ? item.displayName : (zh ? "名称未解析" : "Name unavailable"));
    const resolvedEntities = (Array.isArray(analysis.resolvedCharacters) ? analysis.resolvedCharacters.length : 0) + (Array.isArray(analysis.resolvedTitles) ? analysis.resolvedTitles.length : 0);
    const unresolvedCandidates = Number.isFinite(resolution.candidateTotal) ? resolution.candidateTotal : Array.isArray(resolution.candidates) ? resolution.candidates.length : (Array.isArray(analysis.candidateCharacters) ? analysis.candidateCharacters.length : 0) + (Array.isArray(analysis.candidateTitles) ? analysis.candidateTitles.length : 0);
    const effectiveStatus = resolvedEntities > 0 && ["", "NO_MATCH"].includes(String(resolution.status || "").toUpperCase()) ? "RESOLVED" : resolution.status;
    const historical = historicalExplanation(promptDiagnostics, locale);
    const candidates = unresolvedCandidates || resolvedEntities;
    const hasFacts = (promptDiagnostics?.gameTruth?.characters || []).length > 0 || (promptDiagnostics?.gameTruth?.titles || []).length > 0;
    let conclusion = zh ? "当前世界线中暂无可确认结论" : "No confirmed conclusion is available for the current worldline";
    if (promptDiagnostics?.localizationPending) conclusion = zh ? "本地化仍在后台解析，请稍后重新诊断；当前结果并非完整检索结论" : "Localization is still running; retry diagnostics shortly. Results are incomplete.";
    else if (promptDiagnostics?.localizationIncomplete) conclusion = zh ? "本地化来源尚未完整核实，当前结果不代表人物不存在" : "Localization sources are incomplete; this does not establish that the character is absent.";
    else if (promptDiagnostics?.available === false) conclusion = zh ? "当前无法安全读取世界知识" : "World knowledge cannot be read safely right now";
    else if (hasFacts && resolvedEntities > 0) conclusion = zh ? "已找到与查询相关的存档事实" : "Relevant save facts were found";
    else if (historical.status === "SOURCE_INCOMPLETE") conclusion = zh ? "历史人物来源仍在读取，当前不能下结论" : "Historical sources are still loading; no conclusion is available yet";
    else if (historical.status === "DEFINITION_FOUND_RUNTIME_MISSING") conclusion = zh ? "找到历史定义，但当前存档没有对应角色" : "The historical definition was found, but no current save character is bound";
    else if (historical.status === "REJECTED_BY_EVIDENCE") conclusion = zh ? "找到历史候选，但证据不足以确认身份" : "A historical candidate was found, but the evidence is insufficient to confirm identity";
    else if (["AMBIGUOUS", "AMBIGUOUS_PROVENANCE"].includes(String(resolution.status || "").toUpperCase())) conclusion = zh ? "当前世界线中无法安全给出唯一结论" : "A unique conclusion cannot be given safely for this worldline";
    else if (hasFacts) conclusion = zh ? "已找到与查询相关的存档事实" : "Relevant save facts were found";
    else if (resolvedEntities > 0) conclusion = zh ? "已确认查询对象，但当前没有可展示的存档事实" : "The query object was resolved, but no save facts are available to display";
    else if (resolution.status === "NO_MATCH") conclusion = zh ? "当前世界线中暂未找到明确对应对象" : "No matching object was found in the current worldline";
    const reason = resolvedEntities > 0 && ["NO_MATCH", "NAME_INDEX_MISS"].includes(historical.status) ? null : resolution.reason === "CONTEXT_UNAVAILABLE" ? (zh ? "当前检查点或实时状态不可用。" : "The checkpoint or live state is unavailable.") : historical.reasonCode !== "NO_MATCH" ? historical.reason : null;
    return {
      query: promptDiagnostics?.query || "",
      recognizedObject: resolvedNames.join(" / ") || promptDiagnostics?.query || "",
      identity: promptDiagnostics?.localizationPending && !resolvedEntities ? (zh ? "正在检索" : "Searching") : identity(effectiveStatus, locale),
      candidateCount: candidates,
      conclusion,
      reason,
      sourceFacts: hasFacts ? (zh ? "已命中" : "Matched") : (zh ? "未命中" : "No match"),
      sourceSupplemental: (promptDiagnostics?.supplemental || []).length ? (zh ? "已命中" : "Matched") : (zh ? "未命中" : "No match"),
      tokens: promptDiagnostics?.worldPromptTokens ?? 0,
      historical
    };
  }

  return {
    create(locale) {
      return {
        reference: (value, fallback) => reference(value, fallback, locale),
        date: (value) => date(value, locale),
        timestamp: (value) => timestamp(value, locale),
        status: (value) => status(value, locale),
        source: (value) => source(value, locale),
        freshness: (value, mode, liveDate) => freshness(value, mode, liveDate, locale),
        identity: (value) => identity(value, locale),
        connection: (sourceInfo, checkpoint) => connection(sourceInfo, checkpoint, locale),
        visibility: (value) => visibility(value, locale),
        importance: (value) => importance(value, locale),
        actor: (value) => actor(value, locale),
        name: (value) => name(value, locale),
        bindingStatus: (value) => bindingStatus(value, locale),
        knowledge: (value) => knowledge(value, locale),
        event: (value) => event(value, locale),
        historical: (value) => historical(value, locale),
        coverage: (value) => coverage(value, locale),
        historicalExplanation: (value) => historicalExplanation(value, locale),
        promptSummary: (value) => promptSummary(value, locale)
      };
    },
    isReadable,
    presentReference: reference,
    formatDate: date,
    formatTimestamp: timestamp
  };
});
