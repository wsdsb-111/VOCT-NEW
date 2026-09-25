"use strict";

const { normalizeGameDate } = require("../worldline/character-temporal-facts");

const SOURCE = "deterministic_message_parse";
const NUMBER = "[\\d零〇一二两三四五六七八九十百]+";
const CONVERSATION = /聊(?:过|了|到)|谈(?:过|了|话|论|及)|讨论|交谈|说过|讲过|告诉|提过|提到|问过|回答|对话|见面时说|对我说|跟我说/;
const EVENT = /发生|战争|开战|战役|叛乱|婚礼|死亡|出生|被俘|继承|加冕|盟约|事件|那件事|那场|议和|停战|处决/;
const CONVERSATION_CUE = /聊(?:过|了|到|起)|谈(?:过|了|话|论|及|起)|讨论|交谈|说(?:了|过|起|到)|讲(?:了|过|起)|问(?:了|过|起)|告知|告诉|提(?:了|过|到|起)|回答|对话|见面时说|对我说|跟我说/;
const EVENT_CUE = /发生|战争|开战|战役|叛乱|婚礼|成婚|死亡|去世|出生|被俘|继承|登基|即位|加冕|盟约|事件|那件事|那场|议和|停战|处决/;
const MEMORY_RECALL_CUE = /记得|记不记得|记忆|回忆|想起|想起来|印象|经历|往事|故事|事情|那段(?:时间|经历|往事)|可还记得/;

function hasTemporalAxisCue(query) {
  const text = typeof query === "string" ? query : "";
  return CONVERSATION_CUE.test(text) || EVENT_CUE.test(text) || MEMORY_RECALL_CUE.test(text);
}

function detectTemporalAxisIntent(query) {
  const text = typeof query === "string" ? query : "";
  const conversation = CONVERSATION_CUE.test(text);
  const event = EVENT_CUE.test(text);
  if (conversation && event) return "MIXED";
  if (event) return "EVENT";
  if (conversation) return "CONVERSATION";
  return MEMORY_RECALL_CUE.test(text) ? "MEMORY_RECALL" : "EVENT";
}

function count(value) {
  if (/^\d+$/.test(value)) return Number(value);
  const digits = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  const hundreds = value.match(/^([一二两三四五六七八九])百(.*)$/);
  if (hundreds) return digits[hundreds[1]] * 100 + (hundreds[2] ? count(hundreds[2]) : 0);
  const tens = value.match(/^([一二两三四五六七八九])?十([一二两三四五六七八九])?$/);
  if (tens) return (digits[tens[1]] || 1) * 10 + (digits[tens[2]] || 0);
  return [...value].reduce((total, digit) => total * 10 + (digits[digit] ?? NaN), 0);
}

// Inverse of normalizeGameDate's March-based Gregorian serial; never use OS dates.
function gameDateFromSerial(serial) {
  if (!Number.isSafeInteger(serial)) return null;
  const era = Math.floor(serial / 146097);
  const dayOfEra = serial - era * 146097;
  const yearOfEra = Math.floor((dayOfEra - Math.floor(dayOfEra / 1460) + Math.floor(dayOfEra / 36524) - Math.floor(dayOfEra / 146096)) / 365);
  const dayOfYear = dayOfEra - (365 * yearOfEra + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100));
  const monthIndex = Math.floor((5 * dayOfYear + 2) / 153);
  const day = dayOfYear - Math.floor((153 * monthIndex + 2) / 5) + 1;
  const month = monthIndex + (monthIndex < 10 ? 3 : -9);
  const year = era * 400 + yearOfEra + (month <= 2 ? 1 : 0);
  return normalizeGameDate(`${year}.${month}.${day}`);
}

function dateRange(year, month, day) {
  const from = normalizeGameDate(`${year}.${month ?? 1}.${day ?? 1}`);
  if (!from) return null;
  const precision = day == null ? (month == null ? "year" : "month") : "day";
  let to = from;
  if (precision === "year") to = normalizeGameDate(`${year}.12.31`);
  if (precision === "month") {
    let lastDay = 31;
    while (!(to = normalizeGameDate(`${year}.${month}.${lastDay}`))) lastDay--;
  }
  return { precision, fromGameDate: from.canonical, toGameDate: to.canonical, targetGameYear: year };
}

function messageNumber(value) {
  if (typeof value !== "number" && !(typeof value === "string" && /^\d+$/.test(value))) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) && id >= 0 ? id : null;
}

function normalizeTemporalRefs(refs) {
  if (!Array.isArray(refs)) return [];
  const result = [];
  const seen = new Set();
  for (const ref of refs) {
    if (!ref || typeof ref !== "object" || ref.kind !== "event_time" || ref.source !== SOURCE ||
        !["year", "month", "day"].includes(ref.precision) ||
        !["event", "past_conversation", "unknown"].includes(ref.timeRole) ||
        typeof ref.expression !== "string" || !ref.expression.trim() ||
        typeof ref.fromGameDate !== "string" || typeof ref.toGameDate !== "string") continue;
    const from = normalizeGameDate(ref.fromGameDate), to = normalizeGameDate(ref.toGameDate);
    if (!from || !to || from.serial > to.serial || ref.targetGameYear !== from.year) continue;
    const expected = dateRange(from.year, ref.precision === "year" ? null : from.month, ref.precision === "day" ? from.day : null);
    if (expected.fromGameDate !== from.canonical || expected.toGameDate !== to.canonical) continue;
    // Do not drop invalid proof IDs and accidentally widen the visibility of a ref.
    if (!Array.isArray(ref.messageIds) || !ref.messageIds.length || ref.messageIds.some(id => messageNumber(id) == null)) continue;
    if (ref.segmentIds != null && (!Array.isArray(ref.segmentIds) || ref.segmentIds.some(id =>
      !(typeof id === "string" && id.trim()) && !(Number.isSafeInteger(id) && id >= 0)))) continue;
    if (ref.sourceMemoryIds != null && (!Array.isArray(ref.sourceMemoryIds) || ref.sourceMemoryIds.some(id => typeof id !== "string" || !id.trim()))) continue;
    const normalized = {
      kind: "event_time", ...expected, expression: ref.expression,
      messageIds: [...new Set(ref.messageIds.map(messageNumber))], segmentIds: [...new Set(ref.segmentIds || [])],
      sourceMemoryIds: [...new Set(ref.sourceMemoryIds || [])],
      source: SOURCE, timeRole: ref.timeRole
    };
    const key = JSON.stringify(normalized);
    if (!seen.has(key)) result.push(normalized);
    seen.add(key);
  }
  return result;
}

function extractTemporalAnchors(text, { anchorGameDate, messageId, speakerId } = {}) {
  const current = normalizeGameDate(anchorGameDate);
  const id = messageNumber(messageId);
  if (!current || id == null || typeof text !== "string") return [];
  // Longest alternatives consume invalid dates too, so they cannot fall back to a valid year.
  const pattern = new RegExp("(?<![\\d./-])(?:" + NUMBER + "\\s*(?:年|个月|月|天|日)\\s*前|" +
    "\\d+\\s*[./-]\\s*\\d+\\s*[./-]\\s*\\d+|" +
    "\\d+\\s*年(?:\\s*\\d+\\s*月(?:\\s*\\d+\\s*[日号])?)?|" +
    "\\d+\\s*月(?:\\s*\\d+\\s*[日号])?|去年|前年|上个月|上月|昨天|昨日|前天|前日)", "g");
  const mentions = [...text.matchAll(pattern)];
  const refs = [];
  for (let i = 0; i < mentions.length; i++) {
    const mention = mentions[i], expression = mention[0], end = mention.index + expression.length;
    if (/^[前年后内间来]/.test(text.slice(end))) continue;
    const clean = expression.replace(/\s+/g, "");
    let range = null, match;
    if ((match = clean.match(/^(\d+)[./-](\d+)[./-](\d+)$/)) ||
        (match = clean.match(/^(\d+)年(?:(\d+)月(?:(\d+)[日号])?)?$/))) {
      range = dateRange(+match[1], match[2] == null ? null : +match[2], match[3] == null ? null : +match[3]);
    } else if ((match = clean.match(/^(\d+)月(?:(\d+)[日号])?$/))) {
      range = dateRange(current.year, +match[1], match[2] == null ? null : +match[2]);
    } else {
      match = clean.match(new RegExp("^(" + NUMBER + ")(年|个月|月|天|日)前$"));
      const amount = match ? count(match[1]) : (/前年|前天|前日/.test(clean) ? 2 : 1);
      const unit = match ? match[2] : (/年/.test(clean) ? "年" : /月/.test(clean) ? "月" : "天");
      if (!Number.isSafeInteger(amount) || amount <= 0) continue;
      if (unit === "年") range = dateRange(current.year - amount);
      else if (/月/.test(unit)) {
        const index = current.year * 12 + current.month - 1 - amount;
        range = dateRange(Math.floor(index / 12), ((index % 12) + 12) % 12 + 1);
      } else {
        const date = gameDateFromSerial(current.serial - amount);
        if (date) range = dateRange(date.year, date.month, date.day);
      }
    }
    if (!range || normalizeGameDate(range.fromGameDate).serial > current.serial) continue;
    const before = text.slice(0, mention.index).split(/[，,。！？!?；;\n]/).pop();
    const after = text.slice(end, mentions[i + 1]?.index).split(/[，,。！？!?；;\n]/)[0];
    const sentenceBefore = text.slice(0, mention.index).split(/[。！？!?；;\n]/).pop();
    const clause = before + expression + after;
    if (/过去\s*$|最近\s*$|近\s*$|历时\s*$|持续\s*$/.test(before)) continue;
    if (/如果|假如|假设|假定|假使|假若|设想|倘若|要是|若是|若在/.test(sentenceBefore + after) ||
        /将会|将要|(?:会|将)(?:在|于|发生|开战|举行|继承|加冕)|计划|打算|准备|预计|届时|未来|明年|后年/.test(clause)) continue;
    const conversationAt = after.search(CONVERSATION), eventAt = after.search(EVENT);
    let timeRole = conversationAt >= 0 && (eventAt < 0 || conversationAt < eventAt) ? "past_conversation" : "event";
    if (conversationAt < 0 && eventAt < 0 && CONVERSATION.test(before)) timeRole = "unknown";
    if (/大约|大概|约莫|也许|或许|可能|不确定|似乎|左右/.test(clause) || /约\s*$/.test(before)) timeRole = "unknown";
    // An event reference (including a bare year or a question) is NOT proof the event happened.
    refs.push({ kind: "event_time", ...range, expression, messageIds: [id], segmentIds: [], source: SOURCE, timeRole });
  }
  return normalizeTemporalRefs(refs);
}

function extractTemporalAnchorsFromMessages(messages, { anchorGameDate } = {}) {
  const result = new Map();
  if (!Array.isArray(messages)) return result;
  for (const message of messages) {
    if (!message || typeof message !== "object") continue;
    const id = messageNumber(message.id ?? message.messageId);
    if (id == null) continue;
    const refs = extractTemporalAnchors(message.content, { anchorGameDate, messageId: id, speakerId: message.speakerId });
    result.set(id, normalizeTemporalRefs([...(result.get(id) || []), ...refs]));
  }
  return result;
}

module.exports = { extractTemporalAnchors, extractTemporalAnchorsFromMessages, normalizeTemporalRefs, detectTemporalAxisIntent, hasTemporalAxisCue, gameDateFromSerial };
