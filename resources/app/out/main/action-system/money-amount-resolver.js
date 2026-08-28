"use strict";

const amountPattern = /(\d+(?:\.\d+)?)\s*(金币?|银币?|铜钱|文钱?|贯钱?|两(?:银子?)?|银子|钱|金|银)/i;

function resolve(text) {
  const match = amountPattern.exec(String(text || ""));
  if (!match) return { resolved: false, reason: "money_amount_not_found" };
  const rawAmount = Number(match[1]);
  if (!Number.isFinite(rawAmount) || rawAmount <= 0) return { resolved: false, reason: "money_amount_invalid" };
  return {
    resolved: true,
    rawAmount,
    rawUnit: match[2],
    // V7.9.1 compatibility behavior. Historical currency normalization is deferred to V8.
    normalizedAmount: rawAmount,
    normalizationMode: "direct_game_unit",
    confidence: 0.99
  };
}

module.exports = { resolve, amountPattern };
