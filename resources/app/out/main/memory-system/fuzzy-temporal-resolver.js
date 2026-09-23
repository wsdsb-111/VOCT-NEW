"use strict";

const { normalizeGameDate } = require("../worldline/character-temporal-facts");

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
  const today = Number(currentTotalDays);
  if (!current || !Number.isFinite(today) || today <= 0) return { triggered: false, reason: "GAME_DATE_UNAVAILABLE" };
  const text = String(query || "").replace(/\s+/g, "");
  const day = 1;
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
  const fullDate = text.match(/(\d{3,6})年(\d{1,2})月(\d{1,2})日/) || text.match(/(\d{3,6})[.\/-](\d{1,2})[.\/-](\d{1,2})/);
  if (fullDate) return target(fullDate[0], "EXPLICIT_DATE", atDate(+fullDate[1], +fullDate[2], +fullDate[3]), 30, 90);
  const yearMonth = text.match(/(\d{3,6})年(\d{1,2})月/);
  if (yearMonth) {
    const from = atDate(+yearMonth[1], +yearMonth[2], 1);
    const nextYear = +yearMonth[2] === 12 ? +yearMonth[1] + 1 : +yearMonth[1];
    const nextMonth = +yearMonth[2] === 12 ? 1 : +yearMonth[2] + 1;
    const to = atDate(nextYear, nextMonth, 1);
    return Number.isFinite(from) && Number.isFinite(to) && from <= today ? result(yearMonth[0], "EXPLICIT_MONTH", "TARGET_DATE", window(from, to - 1), window(from - month, to + month), "TARGET_DISTANCE", (from + to) / 2) : { triggered: false, reason: "INVALID_DATE" };
  }
  const explicitYear = text.match(/(\d{3,6})年(?!前|来|间)/);
  if (explicitYear) {
    const from = atDate(+explicitYear[1], 1, 1);
    const to = atDate(+explicitYear[1] + 1, 1, 1);
    return Number.isFinite(from) && Number.isFinite(to) && from <= today ? result(explicitYear[0], "EXPLICIT_YEAR", "TARGET_DATE", window(from, to - 1), window(from, to - 1), "TARGET_DISTANCE", (from + to) / 2) : { triggered: false, reason: "INVALID_DATE" };
  }
  const naturalYear = text.match(/去年|前年/);
  if (naturalYear) {
    const selected = current.year - (naturalYear[0] === "去年" ? 1 : 2);
    return result(naturalYear[0], "PREVIOUS_YEAR", "TARGET_DATE", window(atDate(selected, 1, 1), atDate(selected + 1, 1, 1) - 1), undefined, "TARGET_DISTANCE", atDate(selected, 7, 1));
  }
  const number = "[\\d零〇一二两三四五六七八九十百]+";
  const ago = text.match(new RegExp("(" + number + ")(年|个月|月|天)前"));
  if (ago) {
    const amount = count(ago[1]);
    if (!Number.isFinite(amount) || amount <= 0) return { triggered: false, reason: "INVALID_INTERVAL" };
    const unitDays = ago[2] === "年" ? year : ago[2] === "天" ? day : month;
    const tolerance = ago[2] === "年" ? 183 : ago[2] === "天" ? 7 : 30;
    return target(ago[0], "INTERVAL_AGO", today - amount * unitDays, tolerance, tolerance * 2);
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

module.exports = { resolveTemporalWindow };
