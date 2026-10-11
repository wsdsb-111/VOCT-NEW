"use strict";

const TEMPORAL_STATUS = Object.freeze({
  ALLOW: "allow",
  DENY: "deny",
  UNKNOWN: "unknown"
});

function invalidDate(reason) {
  return { valid: false, year: null, month: null, day: null, precision: "unknown", reason };
}

function validateDateParts(year, month = null, day = null) {
  if (!Number.isInteger(year) || year < 1) return invalidDate("year_invalid");
  if (month === null && day !== null) return invalidDate("day_without_month");
  if (month !== null && (!Number.isInteger(month) || month < 1 || month > 12)) return invalidDate("month_invalid");
  if (day !== null) {
    if (!Number.isInteger(day)) return invalidDate("day_invalid");
    const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
    if (day < 1 || day > daysInMonth) return invalidDate("day_invalid");
  }
  return {
    valid: true,
    year,
    month,
    day,
    precision: day !== null ? "day" : month !== null ? "month" : "year",
    reason: null
  };
}

function parseGameDateStrict(date) {
  if (typeof date !== "string" || !date.trim()) return invalidDate("game_date_missing");
  const normalized = date.trim();
  const chinese = normalized.match(/^(\d{1,6})年(?:\s*(\d{1,2})月(?:\s*(\d{1,2})日)?)?$/);
  if (chinese) return validateDateParts(Number(chinese[1]), chinese[2] === undefined ? null : Number(chinese[2]), chinese[3] === undefined ? null : Number(chinese[3]));
  const iso = normalized.match(/^(\d{1,6})-(\d{2})-(\d{2})$/);
  if (iso) return validateDateParts(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  return invalidDate("game_date_unrecognized");
}

function normalizeSourceDate(sourceDate) {
  if (Number.isInteger(sourceDate)) return validateDateParts(sourceDate);
  if (typeof sourceDate === "string") return parseGameDateStrict(sourceDate);
  if (!sourceDate || typeof sourceDate !== "object" || Array.isArray(sourceDate)) return invalidDate("source_date_missing");
  return validateDateParts(sourceDate.year, sourceDate.month ?? null, sourceDate.day ?? null);
}

function evaluateDateAvailability(sourceDate, gameDate) {
  const current = typeof gameDate === "string" ? parseGameDateStrict(gameDate) : normalizeSourceDate(gameDate);
  if (!current.valid) return { status: TEMPORAL_STATUS.UNKNOWN, reason: "current_date_invalid", source: null, current };
  const source = normalizeSourceDate(sourceDate);
  if (!source.valid) return { status: TEMPORAL_STATUS.UNKNOWN, reason: "source_date_invalid", source, current };
  if (source.year < current.year) return { status: TEMPORAL_STATUS.ALLOW, reason: "source_year_before_current", source, current };
  if (source.year > current.year) return { status: TEMPORAL_STATUS.DENY, reason: "source_year_after_current", source, current };
  if (source.month === null) return { status: TEMPORAL_STATUS.ALLOW, reason: "same_year_year_precision", source, current };
  if (current.month === null) return { status: TEMPORAL_STATUS.UNKNOWN, reason: "current_month_unknown", source, current };
  if (source.month < current.month) return { status: TEMPORAL_STATUS.ALLOW, reason: "source_month_before_current", source, current };
  if (source.month > current.month) return { status: TEMPORAL_STATUS.DENY, reason: "source_month_after_current", source, current };
  if (source.day === null) return { status: TEMPORAL_STATUS.UNKNOWN, reason: "source_day_unknown_in_current_month", source, current };
  if (current.day === null) return { status: TEMPORAL_STATUS.UNKNOWN, reason: "current_day_unknown", source, current };
  return source.day <= current.day
    ? { status: TEMPORAL_STATUS.ALLOW, reason: "source_day_not_after_current", source, current }
    : { status: TEMPORAL_STATUS.DENY, reason: "source_day_after_current", source, current };
}

function isFactAvailable(fact, gameDate) {
  if (!fact || !Number.isInteger(fact.validFrom)) return false;
  return evaluateDateAvailability(fact.validFrom, gameDate).status === TEMPORAL_STATUS.ALLOW;
}

function isEventAvailable(event, gameDate) {
  if (!event?.date) return false;
  return evaluateDateAvailability(event.date, gameDate).status === TEMPORAL_STATUS.ALLOW;
}

function isFigureKnowledgeAvailable(figure, gameDate) {
  const earliestYear = figure?.activeWindow?.earliestYear;
  if (!Number.isInteger(earliestYear)) return false;
  return evaluateDateAvailability(earliestYear, gameDate).status === TEMPORAL_STATUS.ALLOW;
}

function filterFactsForDate(facts, gameDate) {
  return Array.isArray(facts) ? facts.filter((fact) => isFactAvailable(fact, gameDate)) : [];
}

function filterEventsForDate(events, gameDate) {
  return Array.isArray(events) ? events.filter((event) => isEventAvailable(event, gameDate)) : [];
}

module.exports = {
  TEMPORAL_STATUS,
  parseGameDateStrict,
  evaluateDateAvailability,
  isFactAvailable,
  isEventAvailable,
  isFigureKnowledgeAvailable,
  filterFactsForDate,
  filterEventsForDate
};
