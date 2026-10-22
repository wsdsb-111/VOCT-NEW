"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const i18next = require("../resources/app/node_modules/i18next");
const { isPotentialCurrentState, normalizeCanonPayload } = require("../src/app/main/worldline/canon-contract");

const root = path.resolve(__dirname, "..");
const historyTitle = "建炎四年（1130 年）宋主赵构与金国对峙，局势危急。";
const history = `1130 年为南宋建炎四年。此前一年，金军大举南下搜山检海，追击赵构，赵构辗转奔逃，一度避于海上。
建炎四年，黄天荡之战爆发，宋金两军激烈交战。韩世忠率军截击北归金军，金军苦战方才突围。此时赵构数次遣使赴金谋求停战，宋金战事仍在持续，中原、江南战场形势紧绷。金国扶植刘豫建立伪齐政权，以傀儡势力掌控中原，宋金之间仍处于激烈的军事对峙状态。`;

async function testHistoricalNarrativeContext() {
  assert.ok(history.includes("宋金战事仍在持续"), "the user's exact historical continuation phrase must remain in the fixture");
  assert.equal(isPotentialCurrentState(`${historyTitle}\n${history}`), false, "the full historical narrative should not be mistaken for a current character claim");
  const normalized = normalizeCanonPayload({
    title: historyTitle,
    content: history,
    temporalMode: "SPECIFIC_DATE",
    temporalSemantics: "PAST_EVENT",
    gameDate: "1130.4.1"
  });
  assert.equal(normalized.temporalSemantics, "PAST_EVENT");

  assert.equal(isPotentialCurrentState("宋金战事仍在持续。"), false, "a controlled event continuation is not a character-state claim");
  assert.equal(isPotentialCurrentState("战争依旧在进行。"), false, "the explicit event-continuation variants remain narrowly exempt");
  assert.equal(isPotentialCurrentState("此前一年，赵构仍在海上避难。"), true, "a historical time phrase must not suppress the existing ambiguous-state guard");
  assert.equal(isPotentialCurrentState("宋金之间仍处于激烈的军事对峙状态。"), false, "a geopolitical condition is not a structured character-state claim");
}

async function testIndependentCurrentClaimsRemainBlocked() {
  const claims = [
    "韩世忠现在在临安。",
    "目前赵构现居临安。",
    "目前赵构已去世。",
    "目前赵构信奉佛教。",
    "目前赵构属于汉文化。",
    "目前赵构是宋国领主。",
    "赵构仍在临安。",
    "曾先生仍在临安。",
    "赵构此前已离开临安，韩世忠仍在临安。",
    "宋金战事仍在持续。赵构仍在临安。",
    "宋金战事仍在持续，赵构仍在临安。",
    "战争仍在持续赵构仍在临安。",
    "赵构已经迁往临安。",
    "The character is now in Lin'an.",
    "The character is currently in Lin'an."
  ];
  for (const content of claims) assert.equal(isPotentialCurrentState(content), true, `current-state cue should be detected: ${content}`);
  assert.equal(isPotentialCurrentState("This historical record is unknown."), false, "the word 'unknown' must not match the English 'now' cue");

  const historicalPlusCurrent = `${history} 目前赵构现居临安。`;
  assert.equal(isPotentialCurrentState(historicalPlusCurrent), true, "historical framing must not hide a separate explicit current location");
  assert.throws(() => normalizeCanonPayload({
    title: "历史与现状",
    content: historicalPlusCurrent,
    temporalMode: "SPECIFIC_DATE",
    temporalSemantics: "PAST_EVENT",
    gameDate: "1130.4.1"
  }), /current_state_needs_structured_confirmation/);

  const datedWithoutHistoricalQualifier = "1130年赵构仍在临安。";
  assert.equal(isPotentialCurrentState(datedWithoutHistoricalQualifier), true, "a year alone must not suppress current-state detection");
  assert.throws(() => normalizeCanonPayload({
    title: "带年份的当前状态",
    content: datedWithoutHistoricalQualifier,
    temporalMode: "SPECIFIC_DATE",
    temporalSemantics: "PAST_EVENT",
    gameDate: "1130.4.1"
  }), /current_state_needs_structured_confirmation/);
}

async function testBilingualActionableCurrentStateErrors() {
  const moduleUrl = pathToFileURL(path.join(root, "src/app/renderer/v95/i18n/index.js")).href;
  const { createUiTranslator, UI_CATALOGS } = await import(moduleUrl);
  const instance = i18next.createInstance();
  await instance.init({ lng: "en-US", fallbackLng: "zh-CN", initImmediate: false, interpolation: { escapeValue: false } });
  const en = createUiTranslator(instance, "en-US");
  const zh = createUiTranslator(instance, "zh-CN");
  const keys = [
    "supplemental_current_state_needs_structured_confirmation",
    "supplemental_current_claim_required",
    "supplemental_current_claim_semantics_invalid",
    "supplemental_current_claim_requires_current_date",
    "supplemental_current_claim_character_required",
    "supplemental_current_claim_value_mismatch",
    "supplemental_current_claim_checkpoint_unavailable",
    "supplemental_current_claim_invalid",
    "supplemental_current_truth_field_unsupported",
    "supplemental_current_truth_character_unavailable",
    "supplemental_current_truth_life_status_conflict",
    "supplemental_current_truth_value_unavailable",
    "supplemental_current_truth_value_invalid"
  ];
  for (const key of keys) {
    const enText = en(`worldMemoryEditor.errors.${key}`);
    const zhText = zh(`worldMemoryEditor.errors.${key}`);
    assert.ok(enText && enText !== UI_CATALOGS["en-US"].common.unavailable, `English translation is missing for ${key}`);
    assert.ok(zhText && zhText !== UI_CATALOGS["zh-CN"].common.unavailable, `Chinese translation is missing for ${key}`);
  }
  assert.match(en("worldMemoryEditor.errors.supplemental_current_state_needs_structured_confirmation"), /historical|current-state option|CK3/i);
  assert.match(zh("worldMemoryEditor.errors.supplemental_current_state_needs_structured_confirmation"), /历史|当前状态|CK3/);

  const editor = fs.readFileSync(path.join(root, "src/app/renderer/world-memory-editor.js"), "utf8");
  assert.match(editor, /copy\(`errors\.\$\{error\}`, canonErrorFallback\(error\)\)/);
  for (const key of keys) assert.ok(editor.includes(`${key}:`), `WorldMemoryEditor must safely map ${key}`);
}

(async () => {
  await testHistoricalNarrativeContext();
  await testIndependentCurrentClaimsRemainBlocked();
  await testBilingualActionableCurrentStateErrors();
  console.log("V9.5 Canon historical/current-state boundary PASS");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
