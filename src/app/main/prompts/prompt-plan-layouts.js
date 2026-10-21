"use strict";

const { requirePlan } = require("./prompt-plan-errors");
const LAYOUT_IDS = Object.freeze(["v5", "v6", "v7", "v813", "glm_cache_v2"]);
const COMPAT_REVISION = "v9_4_compat_1";
const STATIC_FIRST_REVISION = "v9_4_static_first_1";

function resolvePlanMode(value) {
  const mode = value || process.env.VOTC_PROMPT_PLAN_MODE || "v9";
  requirePlan(["legacy", "shadow", "v9"].includes(mode), "PLAN_MODE_INVALID");
  return mode;
}

function orderPlanBlocks(blocks, { layoutId, mode }) {
  requirePlan(LAYOUT_IDS.includes(layoutId), "PLAN_LAYOUT_UNSUPPORTED");
  if (mode !== "v9") return blocks;
  const rank = kind => kind === "GLOBAL_STATIC" ? 0 : kind === "CONVERSATION_FROZEN" ? 1
    : kind === "RESPONDER_FROZEN" ? 2 : kind === "APPEND_ONLY_HISTORY" ? 3 : 4;
  // Stable sort retains every role, message and relative position within a category.
  return [...blocks].sort((left, right) => rank(left.kind) - rank(right.kind));
}

module.exports = { LAYOUT_IDS, COMPAT_REVISION, STATIC_FIRST_REVISION, resolvePlanMode, orderPlanBlocks };
