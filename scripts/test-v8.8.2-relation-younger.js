"use strict";

const assert = require("assert");
const { buildKinshipGraph } = require("../resources/app/out/main/worldline/character-kinship-graph");
const { resolveAnchoredRelationMention } = require("../resources/app/out/main/worldline/anchored-relation-resolver");

const graph = buildKinshipGraph({
  10: { id: 10, fullName: "父亲", children: [1, 2, 3] },
  1: { id: 1, fullName: "回应者", gender: "male", birthDateTotalDays: 200 },
  2: { id: 2, fullName: "兄长", gender: "male", birthDateTotalDays: 100 },
  3: { id: 3, fullName: "弟弟", gender: "male", birthDateTotalDays: 300 }
});

const result = resolveAnchoredRelationMention({ query: "你弟弟是谁", responderId: 1, graph });
assert.equal(result.status, "RELATION_RESOLVED");
assert.equal(result.targetRuntimeId, "3", "younger must be compared with the anchor birth day");

console.log("V8.8.2 Relation Younger: PASS");
