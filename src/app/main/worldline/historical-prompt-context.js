"use strict";

const { estimateTokens } = require("../token-estimator");

function label(candidate) {
  return candidate.displayName ? `${candidate.displayName} (#${candidate.entityId})` : `#${candidate.entityId}`;
}

function list(value, displayed = null) {
  const values = Array.isArray(value) ? value : value === null || value === undefined || value === "" ? [] : [value];
  const labels = Array.isArray(displayed) ? displayed : null;
  return values.length ? values.map((item, index) => labels?.[index] || `#${item}`).join("、") : "无记录";
}

function changeValue(field, value, displayed = null) {
  if (value === null || value === undefined || value === "") return "无记录";
  if (Array.isArray(value)) return ["TITLE_IDS", "SPOUSE", "WAR_PARTICIPATION"].includes(field) ? list(value, displayed) : value.join("、") || "无记录";
  if (displayed && typeof displayed !== "object") return displayed;
  return ["PRIMARY_TITLE", "LIEGE", "COURT_EMPLOYER"].includes(field) ? `#${value}` : String(value);
}

function actorLabel(actor = {}) {
  if (actor.displayName) return `${actor.displayName}${actor.runtimeId ? ` (#${actor.runtimeId})` : actor.titleId ? `（头衔 #${actor.titleId}）` : ""}`;
  if (actor.type === "CHARACTER") return `角色 #${actor.runtimeId}`;
  if (actor.type === "TITLE") return `头衔 #${actor.titleId}`;
  if (actor.type === "FACTION") return `派系 ${actor.factionId}`;
  return "未解析战争方";
}

function warSides(war = {}) {
  const attackers = (war.attackerActors || []).map(actorLabel).join("、") || "未解析进攻方";
  const defenders = (war.defenderActors || []).map(actorLabel).join("、") || "未解析防守方";
  return `进攻方：${attackers}；防守方：${defenders}`;
}

function stateLine(candidate) {
  const name = label(candidate);
  if (candidate.field === "LOCATION") return `- 截至 ${candidate.asOf}，${name}的存档位置编号为 ${candidate.value}；地名未解析时不得猜测。`;
  if (candidate.field === "PRIMARY_TITLE") return `- 截至 ${candidate.asOf}，${name}持有的头衔记录中可确认的一项为 ${candidate.valueDisplay || "无记录"}。`;
  if (candidate.field === "TITLE_IDS") return `- 截至 ${candidate.asOf}，${name}持有的头衔：${list(candidate.value, candidate.valueDisplay)}。`;
  if (candidate.field === "LIEGE") return `- 截至 ${candidate.asOf}，${name}的直属领主为 ${candidate.valueDisplay || "无记录"}。`;
  if (candidate.field === "COURT_EMPLOYER") return `- 截至 ${candidate.asOf}，${name}所在宫廷的雇主为 ${candidate.valueDisplay || "无记录"}。`;
  if (candidate.field === "LIFE_STATUS") return `- 截至 ${candidate.asOf}，${name}在此存档中的生死状态为 ${candidate.value}。`;
  if (candidate.field === "SPOUSE") return `- 截至 ${candidate.asOf}，${name}的配偶记录：${list(candidate.value, candidate.valueDisplay)}。`;
  if (candidate.field === "FRIEND") return `- 截至 ${candidate.asOf}，${name}的朋友记录：${list(candidate.value, candidate.valueDisplay)}。`;
  if (candidate.field === "RIVAL") return `- 截至 ${candidate.asOf}，${name}的宿敌记录：${list(candidate.value, candidate.valueDisplay)}。`;
  if (candidate.field === "WAR_PARTICIPATION") return `- 截至 ${candidate.asOf}，${name}参与的活跃战争：${list(candidate.value)}。`;
  return `- 截至 ${candidate.asOf}，${name}的 ${candidate.field}：${JSON.stringify(candidate.value)}。`;
}

function changeLine(candidate) {
  const name = label(candidate);
  const value = candidate.value || {};
  const warning = candidate.integrityWarning ? `；完整性警告：${candidate.integrityWarning}，仍以游戏记录为准` : "";
  if (candidate.eventType === "TITLE_GAINED") return `- ${candidate.asOf}：${name}获得头衔 ${candidate.valueDisplay?.after || `#${value.after}`}${warning}。`;
  if (candidate.eventType === "TITLE_LOST") return `- ${candidate.asOf}：${name}失去头衔 ${candidate.valueDisplay?.before || `#${value.before}`}${warning}。`;
  return `- ${candidate.asOf}：${name}的 ${candidate.field} 从 ${changeValue(candidate.field, value.before, candidate.valueDisplay?.before)} 变为 ${changeValue(candidate.field, value.after, candidate.valueDisplay?.after)}${warning}。`;
}

function titleLine(candidate) {
  const title = candidate.displayName ? `${candidate.displayName}（#${candidate.entityId}）` : `头衔 #${candidate.entityId}`;
  if (candidate.type === "HISTORICAL_TITLE_STATE") return `- 截至 ${candidate.asOf}，${title}的持有者为 ${candidate.valueDisplay?.holderId || "无记录"}；直属上级头衔 ${candidate.valueDisplay?.liegeTitleId || "无记录"}。`;
  return `- ${candidate.asOf}：${title}发生 ${candidate.eventType}，从 ${changeValue("PRIMARY_TITLE", candidate.value?.before, candidate.valueDisplay?.before)} 变为 ${changeValue("PRIMARY_TITLE", candidate.value?.after, candidate.valueDisplay?.after)}。`;
}

function warLine(candidate) {
  const value = candidate.value || {};
  const war = value.war || value;
  const name = candidate.displayName || war.displayName || `战争 #${candidate.entityId}`;
  if (candidate.eventType === "WAR_NO_LONGER_ACTIVE") return `- ${candidate.asOf}：${name}已不再出现在活跃战争列表中；最后确认活跃于 ${value.lastActiveAt || candidate.validFrom}。${value.result ? `存档明确结果：${value.result}。` : "存档未提供胜负，不得推断谁获胜。"}`;
  if (candidate.eventType === "WAR_SIDE_CHANGED") return `- ${candidate.asOf}：${name}的战争参与方发生变化；${warSides(war)}。`;
  if (candidate.eventType === "WAR_FIRST_SEEN") return `- ${candidate.asOf}：首次在归档节点中发现 ${name}；${warSides(war)}。这不等于精确开战日，除非存档另有 startDate。`;
  return `- 截至 ${candidate.asOf}，${name}仍在活跃战争列表中；${warSides(war)}${war.startDate ? `；存档开战日期：${war.startDate}` : ""}。未提供的胜负与结果不得补全。`;
}

function candidateLine(candidate) {
  if (candidate.field === "WAR") return warLine(candidate);
  if (candidate.entityType === "TITLE") return titleLine(candidate);
  if (candidate.type === "HISTORICAL_CHARACTER_CHANGE") return changeLine(candidate);
  return stateLine(candidate);
}

function buildHistoricalPrompt(result, { tokenBudget = 900, canonText = null } = {}) {
  if (!result?.success || !Array.isArray(result.selected) || !result.selected.length) return { text: null, tokens: 0, selected: [], trimmed: result?.trimmed || [] };
  const diagnostics = result.diagnostics || {};
  const checkpointText = Array.isArray(diagnostics.checkpointDate) ? `${diagnostics.checkpointDate[0]} 至 ${diagnostics.checkpointDate.at(-1)}` : diagnostics.checkpointDate;
  const header = `=== 本轮历史检索（CK3 存档时间线 / Dynamic Tail） ===\n查询时间模式：${diagnostics.timeMode}；请求时间：${diagnostics.requestedDate || "未指定"}；实际可用节点：${checkpointText || "未知"}。\n以下事实来自当前 Campaign / Branch 的不可变历史 Checkpoint。只可陈述列出的状态或变化；不得读取未来节点，不得用现实人物传记补全 CK3 沙盒命运，也不得从战争消失推断胜负。`;
  const selected = [];
  const rows = [];
  const trimmed = [...(result.trimmed || [])];
  for (const candidate of result.selected) {
    const row = candidateLine(candidate);
    const nextText = [header, ...rows, row, canonText].filter(Boolean).join("\n");
    if (estimateTokens(nextText) > tokenBudget) {
      trimmed.push({ candidateId: candidate.candidateId, reason: "HISTORY_TOKEN_BUDGET" });
      continue;
    }
    rows.push(row);
    selected.push(candidate);
  }
  const text = rows.length ? [header, rows.join("\n"), canonText].filter(Boolean).join("\n\n") : null;
  return { text, tokens: text ? estimateTokens(text) : 0, selected, trimmed };
}

module.exports = { buildHistoricalPrompt, candidateLine };
