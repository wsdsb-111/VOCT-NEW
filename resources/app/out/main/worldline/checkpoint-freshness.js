"use strict";

const STALE_AFTER_DAYS = 366;
const { normalizeGameDate } = require("./character-temporal-facts");

function parseCK3Date(value) {
  return normalizeGameDate(value)?.serial ?? null;
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
    verificationMode: "STALE",
    reason: "CHECKPOINT_UNAVAILABLE"
  };
  if (checkpointDay === null) return base;
  if (pipelineState !== "ACTIVE") return { ...base, freshnessStatus: "STALE", verificationMode: "STALE", reason: "PIPELINE_NOT_ACTIVE" };
  if (!liveDate) return { ...base, freshnessStatus: "FRESH", verificationMode: "CHECKPOINT_ONLY", reason: "LIVE_DATE_UNAVAILABLE" };
  if (liveDay === null) return { ...base, freshnessStatus: "STALE", reason: "LIVE_DATE_INVALID" };
  const ageDays = liveDay - checkpointDay;
  if (ageDays < 0) return { ...base, ageDays, freshnessStatus: "STALE", reason: "LIVE_DATE_BEFORE_CHECKPOINT" };
  if (ageDays === 0) return { ...base, ageDays, freshnessStatus: "FRESH", verificationMode: "LIVE_VERIFIED", reason: "SAME_DAY" };
  if (ageDays < STALE_AFTER_DAYS) return { ...base, ageDays, freshnessStatus: "AGING", verificationMode: "LIVE_VERIFIED", reason: "LIVE_AHEAD_OF_CHECKPOINT" };
  return { ...base, ageDays, freshnessStatus: "STALE", reason: "CHECKPOINT_TOO_OLD" };
}

module.exports = { STALE_AFTER_DAYS, getCheckpointFreshness, parseCK3Date };
