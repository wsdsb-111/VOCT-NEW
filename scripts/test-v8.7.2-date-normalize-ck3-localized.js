"use strict";

const assert = require("assert");
const { normalizeGameDate } = require("../resources/app/out/main/worldline/character-temporal-facts");
const { parseCK3Date } = require("../resources/app/out/main/worldline/checkpoint-freshness");
const { canonicalDate } = require("../resources/app/out/main/worldline/runtime-name-index");
const { dateValue } = require("../resources/app/out/main/worldline/game-state-adapter");

const accepted = ["1175年8月23日", "1175.8.23", "1175-08-23", "1175/8/23"];
for (const value of accepted) {
  const normalized = normalizeGameDate(value);
  assert.equal(normalized?.canonical, "1175.8.23", `${value} must canonicalize`);
  assert.equal(normalized?.display, "1175年8月23日");
  assert.equal(parseCK3Date(value), normalized.serial, `${value} must use the shared ordinal parser`);
  assert.equal(dateValue(value), normalized.serial, `${value} must use the shared game-state date parser`);
  assert.equal(canonicalDate(value), "1175.8.23", `${value} must use the shared runtime-name date parser`);
}

for (const value of ["1175年13月1日", "1175年2月31日", "1175年0月1日", "1175年8月0日", "1175年8月", "abc"]) {
  assert.equal(normalizeGameDate(value), null, `${value} must fail closed`);
}

console.log("V8.7.2 localized CK3 date normalization PASS");
