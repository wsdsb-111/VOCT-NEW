"use strict";

const assert = require("assert");
const { normalizeCanonPayload } = require("../resources/app/out/main/worldline/canon-contract");

for (const content of ["韩世忠现居临安", "韩世忠现在在临安", "韩世忠仍在临安", "韩世忠已经迁往临安"]) {
  assert.throws(() => normalizeCanonPayload({ title: "现状", content }, { gameDate: "1175.1.1", totalDays: 430000 }), /current_state_needs_structured_confirmation/);
}
console.log("V8.7.1 current location variants PASS");
