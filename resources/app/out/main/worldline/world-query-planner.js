"use strict";

const { parseCK3Date } = require("./checkpoint-freshness");
const RETRIEVAL_POLICY_VERSION = "v8.5-retrieval-2";
const INTENTS = Object.freeze({
  CHARACTER_STATE: "CHARACTER_STATE",
  CHARACTER_LOCATION: "CHARACTER_LOCATION",
  CHARACTER_IDENTITY: "CHARACTER_IDENTITY",
  TITLE_HOLDER: "TITLE_HOLDER",
  REALM_STATUS: "REALM_STATUS",
  WAR_STATUS: "WAR_STATUS",
  WORLD_RECENT: "WORLD_RECENT",
  HISTORY_LOOKUP: "HISTORY_LOOKUP",
  GENERAL_WORLD: "GENERAL_WORLD"
});

function normalize(value) {
  return String(value || "").trim().toLocaleLowerCase();
}

function uniqueStrings(values) {
  return [...new Set((values || []).map((value) => String(value || "").trim()).filter(Boolean))];
}

function dateText(year, month = 1, day = 1) {
  return `${Number(year)}.${Number(month)}.${Number(day)}`;
}

function parseTimeHint(text) {
  const range = text.match(/(?<![a-z0-9_#])(\d{3,4})\s*年?\s*(?:到|至|[-~—])\s*(\d{3,4})(?![a-z0-9_])\s*年?/u);
  if (range) return { mode: Number(range[1]) <= Number(range[2]) ? "RANGE" : "INVALID", from: dateText(range[1]), to: dateText(range[2], 12, 31), year: null };
  const explicit = text.match(/(?<![a-z0-9_#])(\d{3,4})\s*[.年]\s*(\d{1,2})\s*[.月]\s*(\d{1,2})(?![a-z0-9_])/u) || text.match(/(?<![a-z0-9_#])(\d{3,4})\s*年/u);
  if (explicit) {
    const from = dateText(explicit[1], explicit[2] || 1, explicit[3] || 1);
    return { mode: parseCK3Date(from) === null ? "INVALID" : "AS_OF", from, to: null, year: Number(explicit[1]) };
  }
  if (/(最近|近来|近日|今年)/u.test(text)) return { mode: "RECENT", from: null, to: null, year: null };
  if (/(现在|当前|如今|此刻)/u.test(text)) return { mode: "CURRENT", from: null, to: null, year: null };
  return { mode: "UNSPECIFIED", from: null, to: null, year: null };
}

function inferIntent(text, analysis, time) {
  const hasCharacter = (analysis?.resolvedCharacters || analysis?.characters || []).length > 0 || (analysis?.candidateCharacters || []).length > 0;
  const hasTitle = (analysis?.resolvedTitles || analysis?.titles || []).length > 0 || (analysis?.candidateTitles || []).length > 0;
  const broadWorldIntent = !hasCharacter && !hasTitle && /(天下|局势|发生了什么|最近.*(?:发生|战争|谁死)|今年.*(?:发生|战争|谁死)|最近有哪些战争)/u.test(text);
  if (time.mode === "AS_OF" || time.mode === "RANGE") return { intent: INTENTS.HISTORY_LOOKUP, broadWorldIntent: false };
  if (broadWorldIntent) return { intent: INTENTS.WORLD_RECENT, broadWorldIntent: true };
  if (/(战争|战事|交战|开战|停战)/u.test(text)) return { intent: INTENTS.WAR_STATUS, broadWorldIntent: false };
  if (/(谁拥有|谁持有|归谁|领主|持有人|拥有者)/u.test(text)) return { intent: INTENTS.TITLE_HOLDER, broadWorldIntent: false };
  if (/(在哪里|在哪儿|何处|位置|所在地)/u.test(text) && hasCharacter) return { intent: INTENTS.CHARACTER_LOCATION, broadWorldIntent: false };
  if (/(活着吗|还活着|是否存活|死了|死亡|去世)/u.test(text) && hasCharacter) return { intent: INTENTS.CHARACTER_STATE, broadWorldIntent: false };
  if (/(是谁|哪一位|身份)/u.test(text) && hasCharacter) return { intent: INTENTS.CHARACTER_IDENTITY, broadWorldIntent: false };
  if (hasTitle) return { intent: INTENTS.REALM_STATUS, broadWorldIntent: false };
  if (hasCharacter) return { intent: INTENTS.CHARACTER_STATE, broadWorldIntent: false };
  return { intent: INTENTS.GENERAL_WORLD, broadWorldIntent: false };
}

function eventTypesForIntent(intent, text) {
  if (intent === INTENTS.WAR_STATUS || /战争|战事|交战/.test(text)) return ["WAR"];
  if (intent === INTENTS.TITLE_HOLDER) return ["TITLE_HOLDER_CHANGED"];
  if (intent === INTENTS.CHARACTER_STATE && /(死|去世|死亡)/u.test(text)) return ["IMPORTANT_CHARACTER_DIED"];
  return [];
}

function buildWorldQueryPlan({ query = "", assistContext = "", analysis = {} } = {}) {
  const text = normalize(`${query}\n${assistContext}`);
  const time = parseTimeHint(text);
  const inferred = inferIntent(text, analysis, time);
  const resolvedCharacters = analysis?.resolvedCharacters || analysis?.characters || [];
  const resolvedTitles = analysis?.resolvedTitles || analysis?.titles || [];
  return {
    version: RETRIEVAL_POLICY_VERSION,
    intent: inferred.intent,
    entities: {
      characters: uniqueStrings(resolvedCharacters.map((item) => item?.id)),
      titles: uniqueStrings(resolvedTitles.map((item) => item?.id)),
      realms: uniqueStrings(resolvedTitles.map((item) => item?.rawKey)),
      wars: [],
      candidateCharacters: uniqueStrings((analysis?.candidateCharacters || []).map((item) => item?.runtimeId)),
      candidateTitles: uniqueStrings((analysis?.candidateTitles || []).map((item) => item?.id))
    },
    entityAnchors: uniqueStrings(analysis?.entityAnchoredTerms),
    time,
    eventTypes: eventTypesForIntent(inferred.intent, text),
    broadWorldIntent: inferred.broadWorldIntent,
    ambiguity: analysis?.identityResolution?.status === "AMBIGUOUS" ? {
      status: "AMBIGUOUS",
      reason: analysis.identityResolution.reason || "MULTIPLE_CANDIDATES",
      candidateCount: (analysis.identityResolution.candidates || []).length
    } : null
  };
}

module.exports = { INTENTS, RETRIEVAL_POLICY_VERSION, buildWorldQueryPlan, parseTimeHint };
