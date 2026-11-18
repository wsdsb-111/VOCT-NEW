"use strict";

const { requirePlan } = require("./prompt-plan-errors");
const LAYOUT_IDS = Object.freeze(["v5", "v6", "v7", "v813", "glm_cache_v2"]);
const COMPAT_REVISION = "v9_4_compat_1";
const STATIC_FIRST_REVISION = "v9_4_static_first_1";
const HISTORY_PREFIX_REVISION = "v9_7_3_history_prefix_1";
const COMPATIBLE_HISTORY_PREFIX_REVISION = "v9_7_3_compatible_history_prefix_2";

function resolvePlanMode(value) {
  const mode = value || process.env.VOTC_PROMPT_PLAN_MODE || "v9";
  requirePlan(["legacy", "shadow", "v9"].includes(mode), "PLAN_MODE_INVALID");
  return mode;
}

function canExtendHistoryPrefix(blocks, { layoutId, mode, requestType, profile, providerConfig }) {
  if (layoutId !== "v813" || mode !== "v9" || requestType !== "chat" || !profile?.adapterEnabled) return false;
  const { providerType, defaultModel } = providerConfig || {};
  if (!["deepseek", "openai-compatible"].includes(providerType)
    && !(providerType === "zhipu" && defaultModel === "glm-5.3-flash")) return false;
  const history = blocks.filter(block => block.kind === "APPEND_ONLY_HISTORY");
  const input = blocks.filter(block => block.legacyType === "current_user");
  const instruction = blocks.findIndex(block => block.legacyType === "instruction"
    && block.messages.length === 1 && block.messages[0].role === "user");
  // On the opening turn there is no previous-history block yet. Keep that
  // first player message at the same boundary it occupies on later turns.
  const hasHistoryBoundary = history.length === 1 || providerType === "openai-compatible" && history.length === 0;
  if (!hasHistoryBoundary || input.length !== 1 || input[0].messages.length !== 1 || input[0].messages[0].role !== "user"
    || instruction <= blocks.indexOf(input[0])) return false;
  // Do not reorder role-bearing examples or custom turns relative to the real turn.
  return blocks.every((block, index) => block === input[0] || block === history[0]
    || index === instruction || block.messages.every(message => message.role === "system"));
}

function orderPlanBlocks(blocks, { layoutId, mode, extendHistoryPrefix }) {
  requirePlan(LAYOUT_IDS.includes(layoutId), "PLAN_LAYOUT_UNSUPPORTED");
  if (mode !== "v9") return blocks;
  const rank = block => block.kind === "GLOBAL_STATIC" ? 0 : block.kind === "CONVERSATION_FROZEN" ? 1
    : block.kind === "RESPONDER_FROZEN" ? 2 : block.kind === "APPEND_ONLY_HISTORY" ? 3
    : block.id === "responder-disclosures-current" ? 4 : extendHistoryPrefix && block.legacyType === "current_user" ? 5 : 6;
  // Stable sort retains every role, message and relative position within a category.
  return [...blocks].sort((left, right) => rank(left) - rank(right));
}

module.exports = { LAYOUT_IDS, COMPAT_REVISION, STATIC_FIRST_REVISION, HISTORY_PREFIX_REVISION, COMPATIBLE_HISTORY_PREFIX_REVISION, resolvePlanMode, canExtendHistoryPrefix, orderPlanBlocks };
