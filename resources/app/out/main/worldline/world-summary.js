"use strict";

function characterLine(candidate) {
  const { id, character, match } = candidate.payload;
  const displayName = match.displayName || character.fullName || character.firstName || `#${id}`;
  return `- ${displayName} (#${id})：${character.alive ? "存活" : "已死亡"}${character.location ? `；位置 ${character.location}` : ""}`;
}

function titleLine(candidate) {
  const { title, match, holderId, holder } = candidate.payload;
  const displayName = match.displayName || title.key || `#${candidate.payload.id}`;
  const holderName = holder ? `${holder.firstName || holder.fullName || `#${holderId}`} (#${holderId})` : null;
  return `- 头衔 ${displayName}${match.rawKey && match.displayName !== match.rawKey ? `（${match.rawKey}）` : ""}${holderName ? `；持有者 ${holderName}` : ""}`;
}

function deltaLine(candidate) {
  const entry = candidate.payload;
  if (entry.type === "WAR_NO_LONGER_ACTIVE") return `- ${entry.date || "日期未知"}：一场战争已不再出现在活跃战争记录中；结束时间和结果仍待核实。`;
  if (entry.type === "WAR_STARTED") return `- ${entry.date || "日期未知"}：记录到一场新战争。`;
  if (entry.type === "IMPORTANT_CHARACTER_DIED") return `- ${entry.date || "日期未知"}：记录到重要人物去世。`;
  if (entry.type === "TITLE_HOLDER_CHANGED") return `- ${entry.date || "日期未知"}：记录到头衔持有人变更。`;
  return `- ${entry.type || "WORLD_DELTA"}（${entry.date || "日期未知"}）`;
}

function buildDeterministicWorldSummary({ selected = {} } = {}) {
  const topicItems = (selected.gameTruth || []).map((candidate) => ({ candidate, text: candidate.kind === "TITLE" ? titleLine(candidate) : characterLine(candidate) }));
  const supplementalItems = (selected.supplemental || []).map((candidate) => ({ candidate, text: `- ${candidate.payload.title}：${candidate.payload.body}` }));
  const deltaItems = (selected.delta || []).map((candidate) => ({ candidate, text: deltaLine(candidate) }));
  const summaryLines = deltaItems.length > 1 ? [`- 本轮查询选取 ${deltaItems.length} 条相关年度变化，以下按相关度列出。`] : [];
  return { topicItems, supplementalItems, deltaItems, summaryLines };
}

module.exports = { buildDeterministicWorldSummary };
