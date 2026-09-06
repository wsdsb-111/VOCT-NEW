"use strict";

const assert = require("assert");
const { WORLDLINE_HARD_MAX_TOKENS, resolveWorldlineTurnBudget, shouldTrimMemoryTurnRecall } = require("../resources/app/out/main/worldline/worldline-context-budget");

assert.deepEqual(resolveWorldlineTurnBudget({ contextLimit: 1000, basePromptTokens: 850, stableWorldTokens: 60 }), { remainingContext: 150, turnBudget: 90 });
assert.deepEqual(resolveWorldlineTurnBudget({ contextLimit: 1000, basePromptTokens: 1200, stableWorldTokens: 0 }), { remainingContext: 0, turnBudget: 0 });
assert.equal(resolveWorldlineTurnBudget({ contextLimit: 99999, basePromptTokens: 0 }).turnBudget, WORLDLINE_HARD_MAX_TOKENS);
assert.equal(resolveWorldlineTurnBudget({ contextLimit: 1000, basePromptTokens: 500, hardMax: 0 }).turnBudget, 0, "an explicit zero Worldline budget must stay zero");
assert.equal(shouldTrimMemoryTurnRecall({ contextLimit: 1000, basePromptTokens: 900, worldlineEnabled: true }), false, "Worldline must shrink before an in-budget Memory Turn Recall");
assert.equal(shouldTrimMemoryTurnRecall({ contextLimit: 1000, basePromptTokens: 1001, worldlineEnabled: true }), true, "Memory Turn Recall is considered only when the Memory-only prompt already exceeds the hard limit");
assert.equal(shouldTrimMemoryTurnRecall({ contextLimit: 1000, basePromptTokens: 900, worldlineEnabled: false }), true, "legacy Memory-only 192-token headroom behavior remains compatible");
console.log("V8.6.1 Global Budget: PASS (headroom first, Worldline hard cap enforced)");
