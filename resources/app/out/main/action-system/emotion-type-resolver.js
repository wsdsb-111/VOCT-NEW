"use strict";

const EMOTION_PATTERNS = [
  ["toast", /(?:举杯|敬酒|碰杯|祝酒)/],
  ["drinking", /(?:饮酒|喝酒|饮茶|喝茶|小酌|痛饮|畅饮|一饮而尽|饮尽|饮罢)/],
  ["laugh", /(?:轻笑|大笑|失笑|笑出声)/],
  ["happy", /(?:微笑|(?<!轻|大|失)笑了)/],
  ["crying", /(?:哭泣|流泪|抽泣|哽咽)/],
  ["rage", /(?:暴怒|勃然大怒)/],
  ["anger", /(?:怒视|怒目而视|瞪着)/],
  ["stunned", /(?:惊呆|愣住)/],
  ["fear", /(?:恐惧|惊恐)/],
  ["praying", /(?:跪下祈祷|祈祷|诵经)/],
  ["reading", /(?:读书|翻书)/],
  ["writing", /(?:写字|执笔|伏案(?:书写|写字))/],
  ["eavesdrop", /(?:偷听|侧耳倾听)/],
  ["debating", /(?:争辩|争论)/],
  ["storyteller", /讲故事/],
  ["dancing", /(?:跳舞|起舞|翩翩起舞)/],
  ["eyeroll", /翻白眼/],
  ["stayback", /后退/],
  ["holdingstaff", /举杖/],
  ["scepter", /(?:手持权杖|权杖)/]
];

const AMBIGUOUS_PATTERNS = /(?:神情复杂|若有所思|表情微妙|默默看着)/;

function resolve(text) {
  const evidenceText = typeof text === "string" ? text.trim() : "";
  if (!evidenceText) return { resolved: false, reason: "empty_emotion_evidence" };
  if (AMBIGUOUS_PATTERNS.test(evidenceText)) return { resolved: false, reason: "ambiguous_emotion_evidence" };
  const matches = EMOTION_PATTERNS.filter(([, pattern]) => pattern.test(evidenceText)).map(([emotion]) => emotion);
  const unique = Array.from(new Set(matches));
  if (unique.length !== 1) return { resolved: false, reason: unique.length === 0 ? "unknown_emotion_evidence" : "multiple_emotion_candidates", candidates: unique };
  return { resolved: true, emotion: unique[0], reason: "exact_emotion_phrase" };
}

module.exports = { resolve, EMOTION_PATTERNS, AMBIGUOUS_PATTERNS };
