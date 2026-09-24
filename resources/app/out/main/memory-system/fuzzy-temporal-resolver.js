"use strict";

const { normalizeGameDate } = require("../worldline/character-temporal-facts");
const { extractTemporalAnchors, detectTemporalAxisIntent, gameDateFromSerial } = require("./temporal-anchor-extractor");

const DIGITS = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };

function count(value) {
  if (/^\d+$/.test(value)) return Number(value);
  if (value === "十") return 10;
  const hundreds = value.match(/^([一二两三四五六七八九])百(.*)$/);
  if (hundreds) return DIGITS[hundreds[1]] * 100 + (hundreds[2] ? count(hundreds[2]) : 0);
  const tens = value.match(/^([一二两三四五六七八九])?十(.*)$/);
  if (tens) return (DIGITS[tens[1]] || 1) * 10 + (tens[2] ? count(tens[2]) : 0);
  return [...value].reduce((total, digit) => total * 10 + (DIGITS[digit] ?? NaN), 0);
}

function resolveTemporalWindow(query, { currentGameDate, currentTotalDays, earliestTotalDays = null } = {}) {
  const current = normalizeGameDate(currentGameDate);
  const rawToday = Number(currentTotalDays);
  const today = Number.isFinite(rawToday) && rawToday > 0 ? rawToday : current?.serial;
  if (!current || !Number.isFinite(today) || today <= 0) return { triggered: false, reason: "GAME_DATE_UNAVAILABLE" };
  const text = String(query || "").replace(/\s+/g, "");
  const year = 365;
  const month = 30;
  const result = (expression, concept, mode, primaryWindow, expansionWindow = primaryWindow, order = "RECENT_FIRST", targetTotalDays = null) => ({
    triggered: true, expression, normalizedConcept: concept, mode, primaryWindow, expansionWindow,
    targetTotalDays, maxResults: 3, order
  });
  const window = (from, to) => ({ fromTotalDays: Math.round(from), toTotalDays: Math.min(today, Math.round(to)) });
  const atDate = (y, m, d) => {
    const date = normalizeGameDate(String(y) + "." + String(m) + "." + String(d));
    return date ? today + date.serial - current.serial : null;
  };
  const target = (expression, concept, targetTotalDays, primaryToleranceDays, expansionToleranceDays) => {
    if (!Number.isFinite(targetTotalDays) || targetTotalDays > today) return { triggered: false, reason: "FUTURE_DATE" };
    return result(expression, concept, "TARGET_DATE",
      window(targetTotalDays - primaryToleranceDays, targetTotalDays + primaryToleranceDays),
      window(targetTotalDays - expansionToleranceDays, targetTotalDays + expansionToleranceDays),
      "TARGET_DISTANCE", targetTotalDays);
  };
  const fullDate = text.match(/(?<!\d)(\d+)年(\d+)月(\d+)[日号]/) || text.match(/(?<![\d.\/-])(\d+)[.\/-](\d+)[.\/-](\d+)/);
  if (fullDate) return target(fullDate[0], "EXPLICIT_DATE", atDate(+fullDate[1], +fullDate[2], +fullDate[3]), 0, 0);
  const yearMonth = text.match(/(?<!\d)(\d+)年(\d+)月/);
  if (yearMonth) {
    const from = atDate(+yearMonth[1], +yearMonth[2], 1);
    const nextYear = +yearMonth[2] === 12 ? +yearMonth[1] + 1 : +yearMonth[1];
    const nextMonth = +yearMonth[2] === 12 ? 1 : +yearMonth[2] + 1;
    const to = atDate(nextYear, nextMonth, 1);
    return Number.isFinite(from) && Number.isFinite(to) && from <= today ? result(yearMonth[0], "EXPLICIT_MONTH", "TARGET_DATE", window(from, to - 1), undefined, "TARGET_DISTANCE", (from + to - 1) / 2) : { triggered: false, reason: "INVALID_DATE" };
  }
  const explicitYear = text.match(/(?<!\d)(\d+)年(?!前|来|间|后)/);
  if (explicitYear && !/(过去|最近|近些来|历时|持续)$/.test(text.slice(0, explicitYear.index))) {
    const from = atDate(+explicitYear[1], 1, 1);
    const to = atDate(+explicitYear[1] + 1, 1, 1);
    return Number.isFinite(from) && Number.isFinite(to) && from <= today ? result(explicitYear[0], "EXPLICIT_YEAR", "TARGET_DATE", window(from, to - 1), window(from, to - 1), "TARGET_DISTANCE", (from + to) / 2) : { triggered: false, reason: "INVALID_DATE" };
  }
  const naturalYear = text.match(/去年|前年/);
  if (naturalYear) {
    const selected = current.year - (naturalYear[0] === "去年" ? 1 : 2);
    const from = atDate(selected, 1, 1), to = atDate(selected + 1, 1, 1);
    return Number.isFinite(from) && Number.isFinite(to) ? { ...result(naturalYear[0], "PREVIOUS_YEAR", "TARGET_DATE",
      window(from, to - 1), undefined, "TARGET_DISTANCE", atDate(selected, 7, 1)), targetGameYear: selected } : { triggered: false, reason: "INVALID_DATE" };
  }
  const number = "[\\d零〇一二两三四五六七八九十百]+";
  const ago = text.match(new RegExp("(" + number + ")(年|个月|月|天)前"));
  if (ago) {
    const amount = count(ago[1]);
    if (!Number.isFinite(amount) || amount <= 0) return { triggered: false, reason: "INVALID_INTERVAL" };
    if (ago[2] === "年") {
      const selected = current.year - amount;
      const from = atDate(selected, 1, 1), to = atDate(selected + 1, 1, 1);
      if (!Number.isFinite(from) || !Number.isFinite(to)) return { triggered: false, reason: "INVALID_DATE" };
      return { ...result(ago[0], "INTERVAL_AGO", "TARGET_DATE", window(from, to - 1), undefined, "TARGET_DISTANCE",
        atDate(selected, current.month, current.day) ?? atDate(selected, current.month, 28)), targetGameYear: selected };
    }
    const ref = extractTemporalAnchors(ago[0], { anchorGameDate: current.canonical, messageId: 0 })[0];
    if (!ref) return { triggered: false, reason: "INVALID_DATE" };
    const from = today + normalizeGameDate(ref.fromGameDate).serial - current.serial;
    const to = today + normalizeGameDate(ref.toGameDate).serial - current.serial;
    return { ...result(ago[0], "INTERVAL_AGO", "TARGET_DATE", window(from, to), undefined, "TARGET_DISTANCE", (from + to) / 2), targetGameYear: ref.targetGameYear };
  }
  const calendarRef = extractTemporalAnchors(text, { anchorGameDate: current.canonical, messageId: 0 })[0];
  if (calendarRef) {
    const from = today + normalizeGameDate(calendarRef.fromGameDate).serial - current.serial;
    const to = today + normalizeGameDate(calendarRef.toGameDate).serial - current.serial;
    return { ...result(calendarRef.expression, "CALENDAR_DATE", "TARGET_DATE", window(from, to), undefined, "TARGET_DISTANCE", (from + to) / 2), targetGameYear: calendarRef.targetGameYear };
  }
  const interval = text.match(new RegExp("(过去|最近|近些来)(" + number + ")年"));
  if (interval) {
    const amount = count(interval[2]);
    if (!Number.isFinite(amount) || amount <= 0) return { triggered: false, reason: "INVALID_INTERVAL" };
    return result(interval[0], "RECENT_YEARS", "FUZZY_RECENCY", window(today - amount * year, today));
  }
  const fuzzy = [
    [/一晃好多年|一晃许多年过去了|倏经数载|阅岁既久/u, "MANY_YEARS", 10 * year, 5 * year, 25 * year, 5 * year],
    [/很久以前|夙昔|囊昔|往昔/u, "LONG_AGO", 40 * year, 7 * year, 80 * year, 7 * year],
    [/早先的时候|早先那会儿|早先|旧时|曩昔|曩日/u, "EARLIER", 8 * year, 3 * year, 20 * year, 3 * year],
    [/当初那时候|当初|始时|曩初|向初/u, "ORIGIN_PERIOD", 10 * year, 2 * year, 40 * year, 2 * year],
    [/前些日子|前阵子|日前|顷来|前时/u, "PREVIOUS_PERIOD", 6 * month, month, 2 * year, month],
    [/隔了一阵子|过了一段日子之后|居顷之|既而|逾时/u, "INTERVAL_PERIOD", 5 * month, 2 * month, year, 2 * month],
    [/前些年|顷年|顷岁/u, "PREVIOUS_YEARS", 4 * year, year, 8 * year, year],
    [/这些年|近些年来|这几年|比来|比年|迩岁/u, "THESE_YEARS", 3 * year, 6 * month, 5 * year, 0],
    [/往年的时候|往年曾经|往年|往岁|旧岁/u, "PAST_YEARS", 6 * year, 2 * year, 15 * year, 2 * year],
    [/早年|年轻那时候|早岁|少日/u, "YOUTH", 30 * year, 12 * year, 60 * year, 10 * year],
    [/前不久|向者|迩来|昨来/u, "NOT_LONG_AGO", 20, 5, 40, 0],
    [/近来/u, "LATELY", 2 * month, 10, 6 * month, 10],
    [/最近|近日/u, "RECENT", 10, 3, month, 0],
    [/许久|多时/u, "LONG_TIME", 3 * year, 3 * month, 5 * year, 3 * month]
  ];
  for (const [pattern, concept, from, to, expandedFrom, expandedTo] of fuzzy) {
    const matched = text.match(pattern);
    if (matched) return result(matched[0], concept, "FUZZY_RECENCY",
      window(today - from, today - to), window(today - expandedFrom, today - expandedTo));
  }
  const past = text.match(/从前|曩时|昔时|往时/u);
  if (past) return result(past[0], "FROM_PAST", "FUZZY_RECENCY",
    window(Number.isFinite(Number(earliestTotalDays)) ? Number(earliestTotalDays) : 0, today - 2 * year));
  return { triggered: false, reason: "NO_TIME_EXPRESSION" };
}

// Pure proposal only: the caller owns per-responder storage and successful-reply commit.
function resolveTemporalFocus(query, previousFocus, { currentGameDate, currentTotalDays, turnEpoch, sceneId } = {}) {
  const text = typeof query === "string" ? query : "";
  const axisIntent = detectTemporalAxisIntent(query);
  const temporal = resolveTemporalWindow(query, { currentGameDate, currentTotalDays });
  // Intent detection needs no anchor: missing CK3 dates must not turn time requests into topic recall.
  const requested = temporal.triggered || /\d+\s*年|\d+[./-]\d+[./-]\d+|\d+\s*月|[零〇一二两三四五六七八九十百\d]+\s*(?:年|个月|月|天|日)\s*前|去年|前年|上个月|上月|昨天|昨日|前天|前日|那一年|那年|当年|那时|当时|好多年|许多年|倏经数载|阅岁既久|很久以前|夙昔|囊昔|往昔|早先|旧时|曩昔|曩日|当初|始时|曩初|向初|前些日子|前阵子|日前|顷来|前时|隔了一阵子|过了一段日子|居顷之|既而|逾时|前些年|顷年|顷岁|这些年|近些年来|这几年|比来|比年|迩岁|往年|往岁|旧岁|早年|年轻那时候|早岁|少日|前不久|向者|迩来|昨来|近来|最近|近日|许久|多时|从前|曩时|昔时|往时|过去[零〇一二两三四五六七八九十百\d]+年/.test(text)
    || ((previousFocus != null || /^(?:后来|之后|随后)(?:呢|如何|怎么样|发生了什么)?[？?。]*$/.test(text.trim())) && /后来|之后|随后/.test(text));
  const result = { ...temporal, requested, axisIntent, focusReused: false, nextFocus: null };
  const current = normalizeGameDate(currentGameDate);
  if (!current) return result;
  const rawToday = Number(currentTotalDays);
  const today = Number.isFinite(rawToday) && rawToday > 0 ? rawToday : current.serial;
  const canStore = Number.isSafeInteger(turnEpoch) && turnEpoch >= 0 && sceneId != null;
  if (temporal.triggered) {
    if (temporal.mode !== "TARGET_DATE" || !canStore) return result;
    const from = gameDateFromSerial(current.serial + temporal.primaryWindow.fromTotalDays - today);
    const to = gameDateFromSerial(current.serial + temporal.primaryWindow.toTotalDays - today);
    if (!from || !to) return result;
    result.targetGameYear = from.year;
    result.nextFocus = {
      targetGameYear: from.year, fromGameDate: from.canonical, toGameDate: to.canonical,
      axisIntent, axis: axisIntent.toLowerCase(), establishedTurn: turnEpoch, lastUsedTurn: turnEpoch,
      sceneId, currentGameDate: current.canonical
    };
    return result;
  }
  if (temporal.reason !== "NO_TIME_EXPRESSION" || !canStore || !previousFocus ||
      /最近|近日|近来|现在|今天|明天|明年|未来|换个话题|说点别的|不说这个/.test(text) ||
      /\d+\s*(?:年|月)|[零〇一二两三四五六七八九十百\d]+\s*(?:年|个月|月|天|日)\s*[前后]|今年|本月/.test(text) ||
      !/那一年|那年|当年|那时|当时|后来|之后|随后/.test(text)) return result;
  const gap = turnEpoch - previousFocus.lastUsedTurn;
  if (!Number.isSafeInteger(previousFocus.lastUsedTurn) || gap < 0 || gap > 3 ||
      previousFocus.sceneId !== sceneId || previousFocus.currentGameDate !== current.canonical ||
      !["EVENT", "CONVERSATION", "MIXED"].includes(previousFocus.axisIntent)) return result;
  const from = normalizeGameDate(previousFocus.fromGameDate), to = normalizeGameDate(previousFocus.toGameDate);
  if (!from || !to || from.serial > to.serial || to.serial > current.serial) return result;
  const primaryWindow = { fromTotalDays: today + from.serial - current.serial, toTotalDays: today + to.serial - current.serial };
  const inheritedAxis = /聊|谈|说|讨论|讲过|告诉|提过|提到|问过|回答|对话|发生|战争|战役|叛乱|婚礼|死亡|出生|被俘|继承|加冕|盟约|事件|那件事|那场/.test(text)
    ? axisIntent : previousFocus.axisIntent;
  return {
    triggered: true, requested: true, expression: text, normalizedConcept: "TEMPORAL_FOCUS", mode: "TARGET_DATE",
    primaryWindow, expansionWindow: { ...primaryWindow }, targetTotalDays: (primaryWindow.fromTotalDays + primaryWindow.toTotalDays) / 2,
    targetGameYear: from.year, maxResults: 3, order: "TARGET_DISTANCE", axisIntent: inheritedAxis, focusReused: true,
    nextFocus: { ...previousFocus, axisIntent: inheritedAxis, axis: inheritedAxis.toLowerCase(), lastUsedTurn: turnEpoch }
  };
}

module.exports = { resolveTemporalWindow, detectTemporalAxisIntent, resolveTemporalFocus };
