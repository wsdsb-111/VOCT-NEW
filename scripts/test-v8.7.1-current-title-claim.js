"use strict";

const assert = require("assert");
const { normalizeCanonPayload } = require("../resources/app/out/main/worldline/canon-contract");

for (const [field, value] of [["primaryTitle", "c_linan"], ["courtEmployer", "1"], ["liege", "1"], ["faith", "han"], ["culture", "han"]]) {
  const record = normalizeCanonPayload({ title: "当前结构化事实", content: "已选择结构化字段", temporalSemantics: "CURRENT_STRUCTURED_CLAIM", currentClaim: { entityId: "2", field, value } }, { gameDate: "1175.1.1", totalDays: 430000 });
  assert.equal(record.currentClaim.field, field);
}
for (const [field, value] of [["alive", true], ["imprisoned", false]]) {
  const record = normalizeCanonPayload({ title: "当前结构化事实", content: "已选择结构化字段", temporalSemantics: "CURRENT_STRUCTURED_CLAIM", currentClaim: { entityId: "2", field, value } }, { gameDate: "1175.1.1", totalDays: 430000 });
  assert.equal(record.currentClaim.value, value);
}
console.log("V8.7.1 current title claim PASS");
