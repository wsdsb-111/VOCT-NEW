"use strict";

const { dataset, getPeriodByYear } = require("../historical-system/historical-baseline");
const { isEventAvailable, isFigureKnowledgeAvailable, parseGameDateStrict } = require("../historical-system/temporal-knowledge-gate");
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
  if (!reference || typeof reference !== "object") return null;
  const checkpoint = parseCheckpointDate(checkpointAsOf);
  if (!checkpoint) return null;
  const period = getPeriodByYear(checkpoint.year);
  if (!period) return null;
  const eventByKey = new Map(dataset.events.map((event) => [event.eventKey, event]));
  const figureByKey = new Map(dataset.figures.map((figure) => [figure.figureKey, figure]));
  const notableEvents = period.notableEventKeys
    .map((key) => eventByKey.get(key))
    .filter((event) => event && isEventAvailable(event, checkpoint))
    .slice(0, 12)
    .map((event) => event.displayName);
  const notableFigures = period.notableFigureKeys
    .map((key) => figureByKey.get(key))
    .filter((figure) => figure && isFigureKnowledgeAvailable(figure, checkpoint))
    .slice(0, 12)
    .map((figure) => figure.identity.name);
  const asOf = text(checkpointAsOf);
  return {
    period: `截至 ${checkpoint.year} 年的时代背景`,
    context: `仅可采用截至 ${asOf} 已经出现的制度、地理、文化与技术常识；当前人物、头衔、战争与地点必须只依据后续获准的 CK3 事实，不得引用后续事件、人物命运或结局。`,
    notableEvents,
    notableFigures
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
  return `=== 回应角色可知的世界事实（仅限下列获准内容） ===\n这些内容仅截至各自标注的 Checkpoint 日期；不得补全、推断或泄露未列出的角色私密信息。\n${sections.join("\n\n")}`;
}

function buildSubjectiveWorldTurnRecall(view, { tokenBudget = null } = {}) {
  const sourceOrder = { GAME_TRUTH: 0, GAMESTATE: 1, ANNUAL_DELTA: 2, PLAYER_SUPPLEMENTAL: 3 };
  const facts = (Array.isArray(view?.promptFacts) ? view.promptFacts : view?.allowedFacts || []).filter((fact) => WORLD_SOURCE_TIERS.has(fact?.sourceTier) && text(fact?.value)).sort((left, right) =>
    (sourceOrder[left.sourceTier] ?? 99) - (sourceOrder[right.sourceTier] ?? 99)
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
    const index = ["PLAYER_SUPPLEMENTAL", "ANNUAL_DELTA", "GAMESTATE", "GAME_TRUTH"].map((sourceTier) => remaining.map((fact) => fact.sourceTier).lastIndexOf(sourceTier)).find((value) => value >= 0);
    if (index === undefined) break;
    const [removed] = remaining.splice(index, 1);
    trimmed.push({ factId: removed.factId || null, sourceTier: removed.sourceTier || null, reason: "CONTEXT_HEADROOM" });
    textValue = formatSubjectiveWorldFacts(remaining);
  }
  if (textValue && maxTokens !== null && estimateTokens(textValue) > maxTokens) {
    return { text: null, tokens: 0, trimmed: [...trimmed, { factId: null, sourceTier: null, reason: "CONTEXT_HEADROOM_EMPTY" }] };
  }
  return { text: textValue, tokens: textValue ? estimateTokens(textValue) : 0, trimmed };
}

function buildSubjectiveWorldPrompt(view, options = {}) {
  return buildSubjectiveWorldTurnRecall(view, options).text;
}

function buildWorldStablePrompt({ checkpointId = null, checkpointAsOf = null } = {}) {
  const asOf = text(checkpointAsOf);
  if (!asOf) return null;
  return `=== Worldline Checkpoint Anchor ===\n- Checkpoint: ${text(checkpointId) || "unknown"}\n- World facts are valid only through: ${asOf}\n- Only responder-scoped Worldline Turn Recall after the current user message may supply current characters, titles, wars, deltas, or supplemental facts.\n- Do not infer or reveal facts absent from that recall.`;
}

module.exports = { buildHistoricalReferenceReplacement, buildSubjectiveWorldPrompt, buildSubjectiveWorldTurnRecall, buildWorldStablePrompt };
