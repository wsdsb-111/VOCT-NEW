"use strict";

const STALE_AFTER_DAYS = 366;

function parseCK3Date(value) {
  const text = String(value || "").trim();
  const match = text.match(/^(\d+)\.(\d+)\.(\d+)$/) || text.match(/^(\d+)年(\d+)月(\d+)日$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day) || year < 1 || month < 1 || month > 12) return null;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const monthLengths = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (day < 1 || day > monthLengths[month - 1]) return null;
  const completedYears = year - 1;
  const completedMonths = monthLengths.slice(0, month - 1).reduce((total, length) => total + length, 0);
  return completedYears * 365 + Math.floor(completedYears / 4) - Math.floor(completedYears / 100) + Math.floor(completedYears / 400) + completedMonths + day - 1;
}

function getCheckpointFreshness({ pipelineState, checkpointAsOf, liveDate } = {}) {
  const checkpointDay = parseCK3Date(checkpointAsOf);
  const liveDay = parseCK3Date(liveDate);
  const base = {
    pipelineState: pipelineState || "UNCONFIGURED",
    checkpointAsOf: checkpointAsOf || null,
    liveDate: liveDate || null,
    ageDays: null,
    freshnessStatus: "UNAVAILABLE",
    reason: "CHECKPOINT_UNAVAILABLE"
  };
  if (checkpointDay === null) return base;
  if (pipelineState !== "ACTIVE") return { ...base, freshnessStatus: "STALE", reason: "PIPELINE_NOT_ACTIVE" };
  if (!liveDate) return { ...base, freshnessStatus: "FRESH", reason: "LIVE_DATE_UNAVAILABLE" };
  if (liveDay === null) return { ...base, freshnessStatus: "STALE", reason: "LIVE_DATE_INVALID" };
  const ageDays = liveDay - checkpointDay;
  if (ageDays < 0) return { ...base, ageDays, freshnessStatus: "STALE", reason: "LIVE_DATE_BEFORE_CHECKPOINT" };
  if (ageDays === 0) return { ...base, ageDays, freshnessStatus: "FRESH", reason: "SAME_DAY" };
  if (ageDays < STALE_AFTER_DAYS) return { ...base, ageDays, freshnessStatus: "AGING", reason: "LIVE_AHEAD_OF_CHECKPOINT" };
  return { ...base, ageDays, freshnessStatus: "STALE", reason: "CHECKPOINT_TOO_OLD" };
}

module.exports = { STALE_AFTER_DAYS, getCheckpointFreshness, parseCK3Date };
