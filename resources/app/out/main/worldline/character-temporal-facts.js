"use strict";

function normalizeGameDate(value) {
  const match = String(value || "").trim().match(/^(\d{1,6})[.\-/](\d{1,2})[.\-/](\d{1,2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const serial = daysFromCivil(year, month, day);
  const nextMonth = month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
  if (serial >= daysFromCivil(nextMonth.year, nextMonth.month, 1)) return null;
  return { year, month, day, serial, canonical: `${year}.${month}.${day}`, display: `${year}年${month}月${day}日` };
}

function daysFromCivil(year, month, day) {
  const adjustedYear = year - (month <= 2 ? 1 : 0);
  const era = Math.floor(adjustedYear / 400);
  const yearOfEra = adjustedYear - era * 400;
  const adjustedMonth = month + (month > 2 ? -3 : 9);
  const dayOfYear = Math.floor((153 * adjustedMonth + 2) / 5) + day - 1;
  return era * 146097 + yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
}

function compareGameDates(left, right) {
  const a = normalizeGameDate(left);
  const b = normalizeGameDate(right);
  return a && b ? Math.sign(a.serial - b.serial) : null;
}

function daysBetween(earlier, later) {
  const from = normalizeGameDate(earlier);
  const to = normalizeGameDate(later);
  return from && to ? to.serial - from.serial : null;
}

function relativeTimeLabel(eventDate, currentGameDate) {
  const event = normalizeGameDate(eventDate);
  const current = normalizeGameDate(currentGameDate);
  if (!event || !current) return { daysSinceEvent: null, relativeLabel: null, status: "UNAVAILABLE" };
  const days = current.serial - event.serial;
  if (days < 0) return { daysSinceEvent: days, relativeLabel: null, status: "TEMPORAL_ANOMALY" };
  if (days === 0) return { daysSinceEvent: days, relativeLabel: "今日", status: "OK" };
  if (days === 1) return { daysSinceEvent: days, relativeLabel: "昨日", status: "OK" };
  if (days === 2) return { daysSinceEvent: days, relativeLabel: "前日", status: "OK" };
  if (days <= 6) return { daysSinceEvent: days, relativeLabel: "数日前", status: "OK" };
  if (days <= 13) return { daysSinceEvent: days, relativeLabel: `${days}天前`, status: "OK" };
  if (days <= 30) return { daysSinceEvent: days, relativeLabel: `${Math.floor(days / 7)}周前`, status: "OK" };
  if (days <= 90) return { daysSinceEvent: days, relativeLabel: "数月前", status: "OK" };
  if (event.year === current.year) return { daysSinceEvent: days, relativeLabel: `${Math.max(1, current.month - event.month)}个月前`, status: "OK" };
  const years = current.year - event.year;
  if (years === 1) return { daysSinceEvent: days, relativeLabel: "去年", status: "OK" };
  return { daysSinceEvent: days, relativeLabel: `${years}年前`, status: "OK" };
}

function computeAgeAtDate(birthDate, atDate) {
  const birth = normalizeGameDate(birthDate);
  const at = normalizeGameDate(atDate);
  if (!birth || !at || at.serial < birth.serial) return null;
  let age = at.year - birth.year;
  if (at.month < birth.month || at.month === birth.month && at.day < birth.day) age--;
  return Math.max(0, age);
}

function computeAgeAtDeath(character = {}) {
  return computeAgeAtDate(character.birth || character.birthDate, character.deathDate);
}

function buildDeathFact(character = {}, { currentGameDate = null, characters = null } = {}) {
  const deceasedId = character.id === null || character.id === undefined ? null : String(character.id);
  const deathDate = normalizeGameDate(character.deathDate)?.canonical || null;
  if (!deceasedId || character.alive !== false && !deathDate) return null;
  const reason = character.deathReason && typeof character.deathReason === "object" ? character.deathReason : null;
  const killerIdValue = character.killerId ?? character.killedById ?? reason?.killerId ?? reason?.killer;
  const killerId = killerIdValue === null || killerIdValue === undefined || killerIdValue === "" ? null : String(killerIdValue);
  const lookup = characters instanceof Map ? characters.get(Number(killerId)) || characters.get(killerId) : characters?.[killerId];
  const killerName = character.killerName || reason?.killerName || lookup?.fullName || lookup?.firstName || null;
  const cause = reason?.cause || character.deathCause || (typeof character.deathReason === "string" ? character.deathReason : null);
  const temporal = deathDate ? relativeTimeLabel(deathDate, currentGameDate) : { daysSinceEvent: null, relativeLabel: null, status: "UNAVAILABLE" };
  return {
    deceasedId,
    deathDate,
    killerId,
    killerName,
    cause,
    ageAtDeath: deathDate ? computeAgeAtDeath(character) : null,
    sourceTier: "GAME_TRUTH",
    sourceComplete: deathDate !== null,
    derivedTemporalPresentation: { currentGameDate: normalizeGameDate(currentGameDate)?.canonical || null, eventDate: deathDate, ...temporal }
  };
}

function formatDeathFact(character, options = {}) {
  const fact = buildDeathFact(character, options);
  if (!fact) return null;
  const date = normalizeGameDate(fact.deathDate)?.display || null;
  const details = [date ? `${date}去世` : "已故"];
  if (fact.derivedTemporalPresentation.relativeLabel) details.push(`距今${fact.derivedTemporalPresentation.relativeLabel}`);
  if (fact.ageAtDeath !== null) details.push(`终年${fact.ageAtDeath}岁`);
  if (fact.killerName || fact.killerId) details.push(`致死者：${fact.killerName || `#${fact.killerId}`}`);
  if (fact.cause) details.push(`死因：${fact.cause}`);
  return { fact, text: details.join("；") };
}

module.exports = { buildDeathFact, compareGameDates, computeAgeAtDate, computeAgeAtDeath, daysBetween, formatDeathFact, normalizeGameDate, relativeTimeLabel };
