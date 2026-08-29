"use strict";

const BASIC_BLOCKERS = Object.freeze([
  /(?:如果|假如|要是).{0,80}/i,
  /(?:会不会|是否应该|该不该|能不能).{0,80}/i,
  /(?:不要|别).{0,40}(?:给|杀|伤|囚|关|任命|罢免|脱|离开|前往)/i,
  /(?:我曾经|昨天我|昔日我|过去我).{0,80}/i,
  /\b(?:if|suppose|what if|should we|do not|don't|yesterday i|i once)\b/i
]);

function evaluate(text) {
  const content = String(text || "").trim();
  if (!content) return { allowed: false, reason: "empty_message" };
  return BASIC_BLOCKERS.some((pattern) => pattern.test(content))
    ? { allowed: false, reason: "basic_execution_form_guard" }
    : { allowed: true, reason: "pass" };
}

module.exports = { BASIC_BLOCKERS, evaluate };
