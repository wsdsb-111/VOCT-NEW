"use strict";

const { parseGameDateStrict } = require("../historical-system/temporal-knowledge-gate");
const { estimateTokens } = require("../token-estimator");

const WORLD_SOURCE_TIERS = new Set(["GAME_TRUTH", "GAMESTATE", "ANNUAL_DELTA", "PLAYER_SUPPLEMENTAL"]);

function text(value) {
  return String(value ?? "").trim();
}

function parseCheckpointDate(value) {
  const source = text(value);
  const ck3 = source.match(/^(\d{1,6})[.-](\d{1,2})[.-](\d{1,2})$/);
  const normalized = ck3 ? `${ck3[1]}-${ck3[2].padStart(2, "0")}-${ck3[3].padStart(2, "0")}` : source;
  const parsed = parseGameDateStrict(normalized);
  return parsed.valid ? parsed : null;
}

function buildHistoricalReferenceReplacement(reference, checkpointAsOf) {
  const checkpoint = parseCheckpointDate(checkpointAsOf);
  if (!checkpoint) return null;
  const asOf = text(checkpointAsOf);
  return {
    period: `截至 ${checkpoint.year} 年的时代背景`,
    context: `仅可采用截至 ${asOf} 已经出现的制度、地理、文化与技术常识；当前人物、头衔、战争与地点必须只依据后续获准的 CK3 事实，不得引用后续事件、人物命运或结局。游戏为先，历史为次：即使已过历史死亡年份，游戏资料仍在世的人物就仍然在世；缺少当前证据不等于死亡。行踪只依据本角色获准的游戏记录，不得套用历史传记；未知时明确不知。`,
    notableEvents: [],
    notableFigures: []
  };
}

function formatSubjectiveWorldFacts(facts) {
  if (!facts.length) return null;
  const current = facts.filter((fact) => ["GAME_TRUTH", "GAMESTATE"].includes(fact.sourceTier));
  const history = facts.filter((fact) => fact.sourceTier === "ANNUAL_DELTA");
  const supplemental = facts.filter((fact) => fact.sourceTier === "PLAYER_SUPPLEMENTAL");
  const sections = [];
  if (current.length) sections.push(`【当前获准 CK3 事实】\n${current.map((fact) => `- ${fact.value}`).join("\n")}`);
  if (history.length) sections.push(`【相关 CK3 年度变化】\n${history.map((fact) => `- ${fact.value}`).join("\n")}`);
  if (supplemental.length) sections.push(`【获准补充知识】\n${supplemental.map((fact) => `- ${fact.value}`).join("\n")}`);
  if (!sections.length) return null;
  return `=== 回应角色可知的世界事实（仅限下列获准内容） ===\n这些内容仅截至各自标注的 Checkpoint 日期；不得补全、推断或泄露未列出的角色私密信息。\n回答本轮问题时采用下列已获准的游戏事实，不得无视明确战事或生死证据而泛称不知。游戏为先，历史为次：历史传记不能决定此局人物的生死、行踪和战争结局。未列出的行踪应答未知；亲友也只能知道所列日期的记录地点，不能推测旅程。\n${sections.join("\n\n")}`;
}

function buildSubjectiveWorldTurnRecall(view, { tokenBudget = null } = {}) {
  const sourceOrder = { GAME_TRUTH: 0, GAMESTATE: 1, ANNUAL_DELTA: 2, PLAYER_SUPPLEMENTAL: 3 };
  const facts = (Array.isArray(view?.promptFacts) ? view.promptFacts : view?.allowedFacts || []).filter((fact) => WORLD_SOURCE_TIERS.has(fact?.sourceTier) && text(fact?.value)).sort((left, right) =>
    (Number(right.queryPriority) || 0) - (Number(left.queryPriority) || 0)
    || (sourceOrder[left.sourceTier] ?? 99) - (sourceOrder[right.sourceTier] ?? 99)
    || text(left.entityId).localeCompare(text(right.entityId), "zh-Hans-CN")
    || text(left.field).localeCompare(text(right.field), "en")
    || text(left.factId).localeCompare(text(right.factId), "en")
    || text(left.value).localeCompare(text(right.value), "zh-Hans-CN")
  ).slice(0, 16);
  const maxTokens = tokenBudget !== null && tokenBudget !== undefined && Number.isFinite(Number(tokenBudget)) ? Math.max(0, Math.floor(Number(tokenBudget))) : null;
  const trimmed = [];
  let remaining = facts.slice();
  let textValue = formatSubjectiveWorldFacts(remaining);
  while (textValue && maxTokens !== null && estimateTokens(textValue) > maxTokens) {
    const lowestPriority = Math.min(...remaining.map(fact => Number(fact.queryPriority) || 0));
    const index = ["PLAYER_SUPPLEMENTAL", "ANNUAL_DELTA", "GAMESTATE", "GAME_TRUTH"].map((sourceTier) => remaining.map((fact) => fact.sourceTier === sourceTier && (Number(fact.queryPriority) || 0) === lowestPriority).lastIndexOf(true)).find((value) => value >= 0);
    if (index === undefined) break;
    const [removed] = remaining.splice(index, 1);
    trimmed.push({ factId: removed.factId || null, sourceTier: removed.sourceTier || null, reason: "CONTEXT_HEADROOM" });
    textValue = formatSubjectiveWorldFacts(remaining);
  }
  if (textValue && maxTokens !== null && estimateTokens(textValue) > maxTokens) {
    return { text: null, tokens: 0, trimmed: [...trimmed, { factId: null, sourceTier: null, reason: "CONTEXT_HEADROOM_EMPTY" }] };
  }
  const boundary = view?.queryIntent === "CHARACTER_LOCATION"
    ? "【本轮行踪回答边界】只可使用获准的地点或直接观察；没有记录或没有亲友知情证据时明确说不知行踪。不得用历史传记补齐去向，也不能把未知说成已死。"
    : view?.queryIntent === "WAR_STATUS" && !remaining.some(fact => fact.field === "WAR")
      ? "【本轮战争回答边界】未获得可回答本次问题的活跃战争事实；资料不足不代表没有战争，也不能用历史战役推断当前战况。" : null;
  if (boundary && (maxTokens === null || estimateTokens([textValue, boundary].filter(Boolean).join("\n")) <= maxTokens)) textValue = [textValue, boundary].filter(Boolean).join("\n");
  return { text: textValue, tokens: textValue ? estimateTokens(textValue) : 0, trimmed, selectedCount: remaining.length };
}

function buildSubjectiveWorldPrompt(view, options = {}) {
  return buildSubjectiveWorldTurnRecall(view, options).text;
}

function buildWorldStablePrompt({ checkpointId = null, checkpointAsOf = null, hasStableCanon = false } = {}) {
  const asOf = text(checkpointAsOf);
  if (!asOf) return null;
  return `=== Worldline Checkpoint Anchor${hasStableCanon ? " / Canon V8.7" : ""} ===\n- Checkpoint: ${text(checkpointId) || "unknown"}\n- World facts are valid only through: ${asOf}\n- Only responder-scoped Worldline recall in this prompt may supply characters, titles, wars, deltas, or supplemental facts.\n- Do not infer or reveal facts absent from that recall.${hasStableCanon ? "\n- Canon V8.7 exception: explicitly pinned responder-authorized RP rules below may supply non-CK3 narrative rules. Current CK3 facts still take priority; personal beliefs remain subjective." : ""}`;
}

module.exports = { buildHistoricalReferenceReplacement, buildSubjectiveWorldPrompt, buildSubjectiveWorldTurnRecall, buildWorldStablePrompt };
