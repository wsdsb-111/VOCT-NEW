"use strict";

const assert = require("assert");
const { buildKinshipGraph } = require("../resources/app/out/main/worldline/character-kinship-graph");
const { resolveAnchoredRelationMention } = require("../resources/app/out/main/worldline/anchored-relation-resolver");

const graph = buildKinshipGraph({
  1: { id: 1, fullName: "回应者" },
  10: { id: 10, fullName: "燕王", children: [11, 12] },
  11: { id: 11, fullName: "长候选", gender: "male", birthDateTotalDays: 100 },
  12: { id: 12, fullName: "次候选", gender: "male", birthDateTotalDays: 100 }
});
for (const query of ["燕王的长子是谁", "燕王的次子是谁", "燕王最近得的儿子是谁"]) {
  const result = resolveAnchoredRelationMention({ query, responderId: 1, graph });
  assert.equal(result.status, "RELATION_AMBIGUOUS");
  assert.equal(result.reason, "BIRTH_ORDER_TIE");
  assert.equal(result.candidateTotal, 2);
}

const missing = buildKinshipGraph({
  1: { id: 1, fullName: "回应者" },
  20: { id: 20, fullName: "赵王", children: [21, 22] },
  21: { id: 21, fullName: "候选一", gender: "male" },
  22: { id: 22, fullName: "候选二", gender: "male" }
});
assert.equal(resolveAnchoredRelationMention({ query: "赵王的长子是谁", responderId: 1, graph: missing }).reason, "BIRTH_ORDER_UNAVAILABLE");

console.log("V8.8.2 Birth-order Tie: PASS");
