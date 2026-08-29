"use strict";

const BASIC_BLOCKERS = Object.freeze([
  /(?:如果|假如|要是).{0,80}/i,
  /(?:会不会|是否应该|该不该|能不能).{0,80}/i,
  /(?:不要|别).{0,40}(?:给|杀|伤|囚|关|任命|罢免|脱|离开|前往)/i,
  /(?:我曾经|昨天我|昔日我|过去我).{0,80}/i,
  /\b(?:if|suppose|what if|should we|do not|don't|yesterday i|i once)\b/i
]);
const ACTION_SIGNAL = /(?:支付|交给|给了?|付给|金币|囚禁|关进|关押|押入|押进|刺伤|砍伤|打伤|杀死|处死|任命|罢免|解雇|脱下|脱掉|宽衣|进入|抵达|离开|微笑|大笑|哭泣|pay|gave|imprison|arrest|injur|kill|appoint|dismiss|undress|enter|arrive)/i;
const CLAUSE_BLOCKER = /(?:如果|假如|要是|会不会|是否应该|该不该|能不能|不要|别|我曾经|昨天|昔日|过去|what if|suppose|should we|do not|don't|yesterday|i once)/i;

function clauses(content) {
  return content.split(/[，,。；;！!？?\n]+|—{1,2}/).map((clause) => clause.trim()).filter(Boolean);
}

function evaluate(text) {
  const content = String(text || "").trim();
  if (!content) return { status: "BLOCK", allowed: false, reason: "empty_message" };
  const hasBlocker = BASIC_BLOCKERS.some((pattern) => pattern.test(content));
  if (!hasBlocker) return { status: "ALLOW", allowed: true, reason: "pass" };
  const parts = clauses(content);
  const mixedCurrentAction = parts.some((clause) => !CLAUSE_BLOCKER.test(clause) && ACTION_SIGNAL.test(clause));
  return mixedCurrentAction
    ? { status: "MAYBE", allowed: true, reason: "mixed_clause_action_signal" }
    : { status: "BLOCK", allowed: false, reason: "basic_execution_form_guard" };
}

module.exports = { BASIC_BLOCKERS, ACTION_SIGNAL, CLAUSE_BLOCKER, clauses, evaluate };
