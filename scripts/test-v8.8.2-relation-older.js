"use strict";

const assert = require("assert");
const { buildKinshipGraph } = require("../resources/app/out/main/worldline/character-kinship-graph");
const { resolveAnchoredRelationMention } = require("../resources/app/out/main/worldline/anchored-relation-resolver");

const graph = buildKinshipGraph({
  10: { id: 10, fullName: "母亲", children: [1, 2, 3] },
  1: { id: 1, fullName: "回应者", gender: "female", birthDateTotalDays: 200 },
  2: { id: 2, fullName: "哥哥", gender: "male", birthDateTotalDays: 100 },
  3: { id: 3, fullName: "姐姐", gender: "female", birthDateTotalDays: 150 }
});

const brother = resolveAnchoredRelationMention({ query: "你哥哥是谁", responderId: 1, graph });
assert.equal(brother.status, "RELATION_RESOLVED");
assert.equal(brother.targetRuntimeId, "2");
const sister = resolveAnchoredRelationMention({ query: "你姐姐是谁", responderId: 1, graph });
assert.equal(sister.status, "RELATION_RESOLVED");
assert.equal(sister.targetRuntimeId, "3");

const missingAnchorBirth = buildKinshipGraph({
  20: { id: 20, fullName: "父亲", children: [21, 22] },
  21: { id: 21, fullName: "回应者", gender: "male" },
  22: { id: 22, fullName: "兄长", gender: "male", birthDateTotalDays: 100 }
});
const unresolved = resolveAnchoredRelationMention({ query: "你哥哥是谁", responderId: 21, graph: missingAnchorBirth });
assert.equal(unresolved.status, "RELATION_AMBIGUOUS");
assert.equal(unresolved.reason, "ANCHOR_BIRTH_ORDER_UNAVAILABLE");

console.log("V8.8.2 Relation Older: PASS");
