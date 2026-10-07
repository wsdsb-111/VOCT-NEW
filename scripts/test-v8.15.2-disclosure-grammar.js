"use strict";

const assert = require("node:assert/strict");
const { scanVisibleDisclosures } = require("../resources/app/out/main/memory-system/memory4-disclosure");

const campaignToken = "v8.15.2-disclosure-grammar-fixture";
const characters = new Map([
  [1, { id: 1, fullName: "甲", firstName: "甲", shortName: "甲", traits: [] }],
  [2, { id: 2, fullName: "赵光义", firstName: "乙", shortName: "乙", titles: ["皇帝", "宰相"],
    traits: [{ id: "brave", name: "勇敢" }, { id: "diligent", name: "勤勉" }] }]
]);
const gameData = { campaignToken, date: "1164.5.20", characters };

function snapshot(text, { sourceRole = "assistant", speakerId = 2, targetIds = [1, 2] } = {}) {
  return {
    campaignToken,
    conversationId: "grammar-fixture",
    ownerId: 1,
    date: gameData.date,
    sourceRevision: "a".repeat(64),
    fragments: [{ fragmentId: `fragment-${sourceRole}-${speakerId}`, messageId: 0, sourceMessageIds: [0],
      sourceRole, speakerId, text, sourceType: "spoken", knownBy: [1, 2], recipientIds: [1], entityIds: targetIds,
      visibility: "participants", visibilityEvidence: "application_fragment" }]
  };
}

function disclosure(text, factType, value, options) {
  return scanVisibleDisclosures(snapshot(text, options), gameData);
}

for (const [text, factType, value] of [
  ["我将成为皇帝。", "TITLE", "皇帝"],
  ["我将会成为皇帝。", "TITLE", "皇帝"],
  ["我会成为皇帝。", "TITLE", "皇帝"],
  ["我以后会成为皇帝。", "TITLE", "皇帝"],
  ["我以后会是皇帝。", "TITLE", "皇帝"],
  ["我之后会担任皇帝。", "TITLE", "皇帝"],
  ["我届时会是皇帝。", "TITLE", "皇帝"],
  ["我未来会成为皇帝。", "TITLE", "皇帝"],
  ["我将任宰相。", "TITLE", "宰相"],
  ["我将担任宰相。", "TITLE", "宰相"],
  ["我以后会变得勇敢。", "TRAIT", "勇敢"],
  ["我将成为一个勤勉的人。", "TRAIT", "勤勉"]
]) {
  for (const sourceRole of ["user", "assistant"]) {
    const result = disclosure(text, factType, value, { sourceRole });
    assert.equal(result.disclosures.some(row => row.factType === factType && row.value === value), false,
      `future expressions never authorize a matching backend fact (${sourceRole}): ${text}`);
  }
}

for (const text of ["赵光义将成为皇帝。", "赵光义会成为皇帝。", "赵光义以后会是皇帝。",
  "赵光义将任宰相。", "赵光义将担任宰相。"]) {
  const result = disclosure(text, "TITLE", "皇帝", { sourceRole: "user", speakerId: 1, targetIds: [2] });
  assert.equal(result.disclosures.some(row => row.factType === "TITLE"), false,
    `a named third party's future role is not a current disclosure: ${text}`);
}

for (const [text, factType, value] of [
  ["我很勇敢地冲锋。", "TRAIT", "勇敢"],
  ["我十分勤勉地处理公务。", "TRAIT", "勤勉"]
]) {
  const result = disclosure(text, factType, value);
  assert.equal(result.disclosures.some(row => row.factType === factType && row.value === value), false,
    `an adverbial 地 must not disclose a trait: ${text}`);
  assert(result.diagnostics?.some(row => row.code === "disclosure_adverb_rejected" && row.ownerId === 1
    && row.targetId === 2 && row.factKey.startsWith("trait_")), "the rejection includes a safe reason diagnostic");
}

for (const text of ["我即将成为皇帝。", "我准备成为皇帝。", "我打算成为皇帝。", "我马上要成为皇帝。"] ) {
  const result = disclosure(text, "TITLE", "皇帝");
  assert.equal(result.disclosures.some(row => row.factType === "TITLE" && row.value === "皇帝"), false,
    `a future or intent statement must not disclose a current title: ${text}`);
  assert(result.diagnostics?.some(row => row.code === "disclosure_future_rejected" && row.ownerId === 1
    && row.targetId === 2 && row.factKey.startsWith("title_")), "the rejection includes a safe reason diagnostic");
}

const namedFuture = disclosure("赵光义将要成为皇帝。", "TITLE", "皇帝", { sourceRole: "user", speakerId: 1, targetIds: [2] });
assert.equal(namedFuture.disclosures.some(row => row.factType === "TITLE" && row.value === "皇帝"), false);
assert(namedFuture.diagnostics?.some(row => row.code === "disclosure_future_rejected" && row.targetId === 2),
  "a named character's future title claim is rejected too");

for (const [text, factType, value] of [
  ["我很勇敢。", "TRAIT", "勇敢"],
  ["我是勇敢的。", "TRAIT", "勇敢"],
  ["我现在是皇帝。", "TITLE", "皇帝"],
  ["我确实是皇帝。", "TITLE", "皇帝"],
  ["我就是皇帝。", "TITLE", "皇帝"],
  ["我已经成为皇帝了。", "TITLE", "皇帝"],
  ["我如今担任宰相。", "TITLE", "宰相"],
  ["我目前是宰相。", "TITLE", "宰相"],
  ["我的特质是勇敢。", "TRAIT", "勇敢"]
]) {
  const result = disclosure(text, factType, value);
  assert(result.disclosures.some(row => row.factType === factType && row.value === value),
    `a current positive assertion remains accepted: ${text}`);
}

for (const text of ["我很勇敢地冲锋。", "我即将成为皇帝。", "我准备成为皇帝。", "赵光义将要成为皇帝。"] ) {
  const result = disclosure(text, "TRAIT", "勇敢", { sourceRole: "user", speakerId: 1, targetIds: [2] });
  assert(!JSON.stringify(result.diagnostics || []).includes(text), "diagnostics never contain source text");
  assert((result.diagnostics || []).every(row => !Object.hasOwn(row, "text") && !Object.hasOwn(row, "message")),
    "diagnostics expose reason codes, not private message content");
}

console.log("V8.15.2 disclosure grammar: PASS (adverb and future guards, current positive assertions, safe diagnostics)");
