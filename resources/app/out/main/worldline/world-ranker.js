"use strict";

const { dateValue } = require("./game-state-adapter");
const { parseCK3Date } = require("./checkpoint-freshness");
const { parseTimeHint } = require("./world-query-planner");

const TOP_K = Object.freeze({ GAME_TRUTH: 7, SUPPLEMENTAL: 3, DELTA: 3 });

function normalizedSet(values) {
  return new Set((values || []).map((value) => String(value || "").trim().toLocaleLowerCase()).filter(Boolean));
}

function overlaps(left, right) {
  const values = normalizedSet(left);
  return (right || []).some((value) => values.has(String(value || "").trim().toLocaleLowerCase()));
}

function entityScore(candidate, plan) {
  const refs = candidate.entityRefs || {};
  if (overlaps(refs.characters, plan.entities?.characters) || overlaps(refs.titles, plan.entities?.titles)) return 40;
  if (overlaps(refs.keys, plan.entityAnchors)) return candidate.category === "SUPPLEMENTAL" ? 24 : 32;
  if (plan.broadWorldIntent && candidate.category === "DELTA") return 8;
  return 0;
}

function temporalScore(candidate, plan, checkpointDate) {
  const mode = plan.time?.mode || "UNSPECIFIED";
  if (mode === "INVALID") return { score: 0, reason: "TEMPORAL_UNSAFE" };
  const requestedHorizon = mode === "AS_OF" ? plan.time.from : mode === "RANGE" ? plan.time.to : checkpointDate;
  const horizon = dateValue(requestedHorizon) < dateValue(checkpointDate) ? requestedHorizon : checkpointDate;
  if (candidate.gameDate && (parseCK3Date(candidate.gameDate) === null || dateValue(candidate.gameDate) > dateValue(horizon))) return { score: 0, reason: "TEMPORAL_UNSAFE" };
  if (candidate.dateRange) {
    const range = parseTimeHint(String(candidate.dateRange));
    if (!["RANGE", "AS_OF"].includes(range.mode) || dateValue(range.to || range.from) > dateValue(horizon) || (mode === "RANGE" && dateValue(range.to || range.from) < dateValue(plan.time.from))) return { score: 0, reason: "TEMPORAL_UNSAFE" };
    if (!candidate.gameDate) candidate = { ...candidate, gameDate: range.to || range.from };
  }
  if (mode === "CURRENT") return { score: candidate.category === "GAME_TRUTH" ? 18 : candidate.category === "DELTA" ? 8 : 6 };
  if (mode === "RECENT") return { score: candidate.category === "DELTA" ? 18 : candidate.category === "SUPPLEMENTAL" ? 10 : 8 };
  if (mode === "AS_OF") {
    const requested = dateValue(plan.time.from);
    const candidateDate = dateValue(candidate.gameDate);
    const checkpoint = dateValue(checkpointDate);
    if (!requested || !candidateDate) return { score: 0, reason: "TEMPORAL_UNSAFE" };
    if (candidate.category === "GAME_TRUTH" && candidateDate !== requested) return { score: 0, reason: "TEMPORAL_UNSAFE" };
    if (candidateDate > requested || checkpoint && requested > checkpoint && candidate.category === "GAME_TRUTH") return { score: 0, reason: "TEMPORAL_UNSAFE" };
    return { score: candidateDate === requested ? 20 : 14 };
  }
  if (mode === "RANGE") {
    const from = dateValue(plan.time.from);
    const to = dateValue(plan.time.to);
    const candidateDate = dateValue(candidate.gameDate);
    if (!candidateDate || candidateDate < from || candidateDate > to) return { score: 0, reason: "TEMPORAL_UNSAFE" };
    return { score: 20 };
  }
  return { score: candidate.category === "GAME_TRUTH" ? 12 : candidate.category === "SUPPLEMENTAL" ? 7 : 5 };
}

function authorityScore(candidate) {
  return ({ GAME_TRUTH: 15, LIVE: 15, GAMESTATE: 12, ANNUAL_DELTA: 10, PLAYER_SUPPLEMENTAL: 7, HISTORICAL_BASELINE: 4 })[candidate.sourceTier] || 0;
}

function intentScore(candidate, plan) {
  if (plan.intent === "WAR_STATUS" && String(candidate.eventType || "").startsWith("WAR_")) return 10;
  if (plan.intent === "TITLE_HOLDER" && candidate.kind === "TITLE") return 10;
  if ((plan.intent === "CHARACTER_LOCATION" || plan.intent === "CHARACTER_STATE") && candidate.kind === "CHARACTER") return 10;
  if (plan.intent === "WORLD_RECENT" && candidate.category === "DELTA") return 10;
  return 0;
}

function recencyScore(candidate, deltaCount) {
  if (candidate.category !== "DELTA" || !deltaCount) return 0;
  return Math.max(1, Math.min(5, 6 - Math.min(5, deltaCount - (candidate.recencyRank || deltaCount))));
}

function rankWorldCandidates(candidates, { plan, checkpointDate } = {}) {
  const trimmed = [];
  const ranked = [];
  const deltaCount = candidates.filter((candidate) => candidate.category === "DELTA").length;
  for (const candidate of candidates) {
    if (candidate.category === "SUPPLEMENTAL" && (candidate.hidden || candidate.visibility !== "PUBLIC_WORLD")) {
      trimmed.push({ type: "SUPPLEMENTAL", id: candidate.payload?.id || candidate.id, title: candidate.title, reason: "VISIBILITY_BLOCKED" });
      continue;
    }
    if (candidate.category === "DELTA" && plan.eventTypes?.length && !plan.eventTypes.some(type => String(candidate.eventType).startsWith(type))) {
      trimmed.push({ type: "DELTA", id: candidate.payload?.id || candidate.id, title: candidate.title, reason: "EVENT_TYPE_MISMATCH" });
      continue;
    }
    const temporal = temporalScore(candidate, plan, checkpointDate);
    if (temporal.reason) {
      trimmed.push({ type: candidate.category, id: candidate.payload?.id || candidate.id, title: candidate.title, reason: temporal.reason });
      continue;
    }
    const entity = entityScore(candidate, plan);
    if (candidate.category === "DELTA" && !plan.broadWorldIntent && entity === 0) {
      trimmed.push({ type: "DELTA", id: candidate.payload?.id || candidate.id, title: candidate.title, reason: "UNRELATED_DELTA" });
      continue;
    }
    if (candidate.category === "SUPPLEMENTAL" && entity === 0 && !candidate.lexicalMatch) {
      trimmed.push({ type: "SUPPLEMENTAL", id: candidate.payload?.id || candidate.id, title: candidate.title, reason: "LOW_RANK" });
      continue;
    }
    const scoreBreakdown = {
      entity,
      time: temporal.score,
      authority: authorityScore(candidate),
      intent: intentScore(candidate, plan),
      recency: recencyScore(candidate, deltaCount),
      importance: candidate.importance === "HIGH" ? 5 : 0,
      responderRelation: Number(candidate.responderRelationScore) || 0
    };
    ranked.push({ ...candidate, score: Object.values(scoreBreakdown).reduce((total, value) => total + value, 0), scoreBreakdown });
  }
  const selected = { gameTruth: [], supplemental: [], delta: [] };
  const categoryMap = { GAME_TRUTH: "gameTruth", SUPPLEMENTAL: "supplemental", DELTA: "delta" };
  for (const category of Object.keys(categoryMap)) {
    const key = categoryMap[category];
    const items = ranked.filter((candidate) => candidate.category === category).sort((left, right) => right.score - left.score || left.id.localeCompare(right.id));
    const limit = TOP_K[category];
    selected[key] = items.slice(0, limit);
    for (const candidate of items.slice(limit)) trimmed.push({ type: category, id: candidate.payload?.id || candidate.id, title: candidate.title, reason: "TOP_K_LIMIT", score: candidate.score });
  }
  return { selected, ranked, trimmed };
}

module.exports = { TOP_K, rankWorldCandidates };
