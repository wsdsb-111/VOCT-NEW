"use strict";

const SOURCE_LABELS = Object.freeze({ GAME_TRUTH: "存档事实", LIVE: "实时游戏状态", GAMESTATE: "存档记录", ANNUAL_DELTA: "年度变化", SYSTEM_SUPPLEMENTAL: "系统补充", PLAYER_SUPPLEMENTAL: "玩家补充", HISTORICAL_BASELINE: "历史背景" });
const FRESHNESS_LABELS = Object.freeze({ FRESH: "已同步", AGING: "临近更新", STALE: "需要重新读取存档", UNAVAILABLE: "暂不可用" });
const IDENTITY_LABELS = Object.freeze({ DIRECT: "已绑定", LIVE_CONFIRMED: "已实时确认", RESOLVED: "已确认身份", AMBIGUOUS: "存在多个候选", AMBIGUOUS_PROVENANCE: "存在多个候选", CONFLICT: "信息存在冲突", NO_MATCH: "暂未找到对应人物", REJECTED: "证据不足，未确认" });

function unique(values) {
  return [...new Set((values || []).map((value) => String(value || "").trim()).filter(Boolean))];
}

function humanLiteral(value) {
  const text = String(value || "").trim();
  return text && (!/^[a-z0-9_.:#-]+$/i.test(text) || /[^\x00-\x7f]/.test(text)) ? text : null;
}

function presentReference(reference) {
  const localization = reference?.localization || {};
  const candidates = unique((localization.sources || []).map((source) => source?.value)).filter(humanLiteral);
  if (String(localization.confidence || "").toUpperCase() === "CONFLICT") return { displayName: candidates.join(" / ") || "名称未解析", humanStatus: "名称来源存在冲突", warning: true, detailsAvailable: true };
  return { displayName: humanLiteral(reference?.displayName) || humanLiteral(localization.localizedValue) || "名称未解析", humanStatus: null, warning: false, detailsAvailable: true };
}

function characterName(snapshot, id) {
  const character = snapshot?.characters?.[String(id)] || null;
  return humanLiteral(character?.fullName) || humanLiteral(character?.firstName) || "当前角色";
}

function createPlayerOverview({ snapshot, politicalContext, checkpoint, deltaPending = 0 } = {}) {
  const primaryTitle = presentReference(politicalContext?.primaryTitle);
  const topRealmTitle = presentReference(politicalContext?.topRealmTitle);
  const directLiege = politicalContext?.directLiege?.ruler?.displayName || politicalContext?.directLiege?.title?.displayName || null;
  return {
    currentDate: checkpoint?.liveDate || checkpoint?.checkpointAsOf || snapshot?.gameDate || null,
    currentPlayer: { displayName: characterName(snapshot, snapshot?.playerId) },
    primaryTitle,
    directLiege: humanLiteral(directLiege) || (politicalContext?.confidence?.directLiege === "INDEPENDENT" ? "无直接领主" : "尚未确认"),
    topRealm: topRealmTitle,
    activeWars: Number(snapshot?.diagnostics?.activeWarCount) || 0,
    freshness: FRESHNESS_LABELS[checkpoint?.freshnessStatus] || "暂不可用",
    pendingDelta: deltaPending,
    detailsAvailable: true
  };
}

function createPlayerWorldKnowledge(items) {
  const fieldLabels = { GAME_DATE: "存档日期", CURRENT_PLAYER: "当前玩家", PRIMARY_TITLE: "主头衔", ACTIVE_WARS: "进行中的战争" };
  return (items || []).map((item) => {
    let value = item.value || item.body || "—";
    if (item.field === "CURRENT_PLAYER") value = String(value).replace(/\s*\(#\d+\)\s*$/, "") || "当前角色";
    const titleReference = item.field === "PRIMARY_TITLE" ? presentReference(item) : null;
    if (titleReference) value = titleReference.displayName;
    return {
      id: item.id,
      title: fieldLabels[item.field] || humanLiteral(item.title) || "世界知识",
      value,
      ...(titleReference ? { warning: titleReference.warning, humanStatus: titleReference.humanStatus } : {}),
      source: SOURCE_LABELS[item.source] || "系统补充",
      visibility: item.visibility === "PUBLIC_WORLD" ? "所有人可知" : item.visibility === "COURT_PUBLIC" ? "宫廷内公开" : item.visibility === "PERSONAL" ? "个人信息" : item.visibility === "SECRET" ? "秘密" : null,
      detailsAvailable: true
    };
  });
}

function createPlayerAnnualDelta(entries) {
  const labels = {
    WAR_STARTED: ["战争开始", "已确认"],
    WAR_ENDED: ["战争结束", "已确认"],
    IMPORTANT_CHARACTER_DIED: ["重要人物去世", "已确认"],
    TITLE_HOLDER_CHANGED: ["头衔持有人变更", "已确认"],
    WAR_NO_LONGER_ACTIVE: ["战争疑似结束", "待核实"]
  };
  return (entries || []).map((entry) => {
    const [title, status] = labels[entry.type] || ["世界线发生变化", "状态待确认"];
    return {
      title,
      status,
      date: entry.date || null,
      source: entry.type === "WAR_NO_LONGER_ACTIVE" ? "系统补充" : SOURCE_LABELS[entry.source] || "存档记录",
      summary: entry.type === "WAR_NO_LONGER_ACTIVE" ? "该战争已不在当前活跃战争列表中，结束时间和最终结果尚未确认。" : null,
      detailsAvailable: true
    };
  });
}

function createPlayerHistoricalCharacters(bindings, snapshot) {
  return (bindings || []).map((binding) => ({
    historicalFigure: humanLiteral(binding?.historicalName) || "历史人物",
    currentCharacter: binding?.runtimeId ? characterName(snapshot, binding.runtimeId) : "当前存档未找到",
    status: IDENTITY_LABELS[binding.status] || "暂未找到对应人物",
    confidence: binding.status === "LIVE_CONFIRMED" || binding.status === "RESOLVED" ? "高" : binding.status === "DIRECT" ? "中" : "待确认",
    warning: binding.status === "CONFLICT" || binding.status === "AMBIGUOUS_PROVENANCE",
    detailsAvailable: true
  }));
}

module.exports = { FRESHNESS_LABELS, IDENTITY_LABELS, SOURCE_LABELS, createPlayerAnnualDelta, createPlayerHistoricalCharacters, createPlayerOverview, createPlayerWorldKnowledge };
