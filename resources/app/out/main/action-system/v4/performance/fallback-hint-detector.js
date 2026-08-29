"use strict";

const ACTION_HINT = /(?:支付|金币|囚禁|关进|逮捕|押入|押进|地牢|牢房|受伤|刺伤|砍伤|杀死|处死|同房|圆房|结拜|义结金兰|情人|恋人|灵魂伴侣|停战|休战|任命|宫廷职位|内阁|议会|罢免|解雇|脱下|脱掉|宽衣|来到|进入|抵达|离开|微笑|大笑|哭泣|pay|gold|imprison|arrest|injur|kill|lover|soulmate|truce|appoint|council|dismiss|undress|arrive|enter)/i;
const SHORT_RESPONSE = /^(?:是|好|好的|我愿意|愿意|同意|接受|不|不要|拒绝|再想想|稍后|yes|okay|accept|no|reject|later)$/i;

function evaluate({ message, activePending = [] }) {
  const text = String(message?.content || "").trim();
  if (activePending.length > 0 && SHORT_RESPONSE.test(text)) return { possibleAction: true, reason: "possible_pending_response" };
  return ACTION_HINT.test(text)
    ? { possibleAction: true, reason: "possible_action_language" }
    : { possibleAction: false, reason: "no_action_hint" };
}

module.exports = { ACTION_HINT, SHORT_RESPONSE, evaluate };
