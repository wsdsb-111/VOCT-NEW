"use strict";

const WORLDLINE_HARD_MAX_TOKENS = 900;

function resolveWorldlineTurnBudget({ contextLimit, basePromptTokens, stableWorldTokens = 0, hardMax = WORLDLINE_HARD_MAX_TOKENS } = {}) {
  const limit = Number.isFinite(Number(contextLimit)) ? Math.max(0, Math.floor(Number(contextLimit))) : 0;
  const baseline = Number.isFinite(Number(basePromptTokens)) ? Math.max(0, Math.floor(Number(basePromptTokens))) : 0;
  const stable = Number.isFinite(Number(stableWorldTokens)) ? Math.max(0, Math.floor(Number(stableWorldTokens))) : 0;
  const remainingContext = Math.max(0, limit - baseline);
  return {
    remainingContext,
    turnBudget: Math.min(Number.isFinite(Number(hardMax)) ? Math.max(0, Math.floor(Number(hardMax))) : WORLDLINE_HARD_MAX_TOKENS, Math.max(0, remainingContext - stable))
  };
}

function shouldTrimMemoryTurnRecall({ contextLimit, basePromptTokens, worldlineEnabled = false } = {}) {
  const limit = Number.isFinite(Number(contextLimit)) ? Math.max(0, Math.floor(Number(contextLimit))) : 0;
  const baseline = Number.isFinite(Number(basePromptTokens)) ? Math.max(0, Math.floor(Number(basePromptTokens))) : 0;
  return worldlineEnabled ? baseline > limit : limit - baseline < 192;
}

module.exports = { WORLDLINE_HARD_MAX_TOKENS, resolveWorldlineTurnBudget, shouldTrimMemoryTurnRecall };
