"use strict";

const assert = require("assert");
const { buildSubjectiveWorldTurnRecall } = require("../resources/app/out/main/worldline/subjective-prompt-context");

const view = { allowedFacts: [
  { factId: "truth", sourceTier: "GAME_TRUTH", value: "甲当前在临安，身份资料完备。" },
  { factId: "state", sourceTier: "GAMESTATE", value: "甲正参与当前场景。" },
  { factId: "delta", sourceTier: "ANNUAL_DELTA", value: "年度变化记录了一场相关战争。" },
  { factId: "supp", sourceTier: "PLAYER_SUPPLEMENTAL", value: "玩家补充的背景设定。" }
] };
const full = buildSubjectiveWorldTurnRecall(view);
const trimmed = buildSubjectiveWorldTurnRecall(view, { tokenBudget: Math.max(1, full.tokens - 12) });
assert.equal(trimmed.trimmed[0].factId, "supp", "Supplemental must trim before annual deltas and Game Truth");
assert(!trimmed.text.includes("玩家补充"), "trimmed Supplemental cannot remain in the prompt");
console.log("V8.6.1 Worldline Trim Priority: PASS (Supplemental yields first)");
