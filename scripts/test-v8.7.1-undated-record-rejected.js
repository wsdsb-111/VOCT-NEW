"use strict";

const assert = require("assert");
const { normalizeCanonPayload } = require("../resources/app/out/main/worldline/canon-contract");

assert.throws(() => normalizeCanonPayload({ title: "指定日期", content: "已经发生", temporalMode: "SPECIFIC_DATE" }, { gameDate: "1175.1.1", totalDays: 430000 }), /specific_date_required/);
console.log("V8.7.1 undated specific-date record rejection PASS");
