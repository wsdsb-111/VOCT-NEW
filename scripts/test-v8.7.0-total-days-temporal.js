"use strict";

const assert = require("assert");
const { buildDeathFact } = require("../resources/app/out/main/worldline/character-temporal-facts");
const { resolveCharacterAge } = require("../resources/app/out/main/worldline/character-age-service");

const character = {
  id: 10,
  alive: false,
  birthDateTotalDays: 409000,
  deathDateTotalDays: 428000,
  birthDate: "无法解析的本地化日期",
  deathDate: "1171年9月2日",
  age: 99
};
const fact = buildDeathFact(character, { currentTotalDays: 428018, currentGameDate: "1171年9月20日" });
assert.equal(fact.derivedTemporalPresentation.daysSinceEvent, 18);
assert.equal(fact.derivedTemporalPresentation.relativeLabel, "18天前");
assert.equal(fact.derivedTemporalPresentation.source, "TOTAL_DAYS");
assert.equal(fact.ageAtDeath, null, "ordinal dates do not establish calendar age when birth date cannot be parsed");
const ageAtDeath = resolveCharacterAge(character, { currentTotalDays: 500000, currentGameDate: "1300.1.1" });
assert.equal(ageAtDeath.age, null);
assert.equal(ageAtDeath.reason, "CALENDAR_DAY_MAPPING_UNVERIFIED");

const yesterday = buildDeathFact({ ...character, deathDateTotalDays: 428017 }, { currentTotalDays: 428018 });
assert.equal(yesterday.derivedTemporalPresentation.relativeLabel, "昨日");
console.log("V8.7.0 TotalDays Temporal: PASS (localized-date independent relative time and frozen death age)");
