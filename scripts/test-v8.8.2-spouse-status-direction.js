"use strict";

const assert = require("assert");
const { buildKinshipGraph } = require("../resources/app/out/main/worldline/character-kinship-graph");
const { resolveAnchoredRelationMention } = require("../resources/app/out/main/worldline/anchored-relation-resolver");

const spouseTypes = ["SPOUSE_OF", "FORMER_SPOUSE_OF", "DECEASED_SPOUSE_OF"];
const characters = {
  1: { id: 1, fullName: "甲君", gender: "male", alive: true, spouses: [{ id: 2, fullName: "乙氏", gender: "female", alive: false }] },
  2: { id: 2, fullName: "乙氏", gender: "female", alive: false, spouses: [{ id: 1, fullName: "甲君", gender: "male", alive: true }] }
};
const graph = buildKinshipGraph(characters);

assert.equal(graph.relationBetweenOfTypes(2, 1, spouseTypes).diagnostic, null, "spouse-status variants must not conflict in the same direction");
assert.equal(graph.relationBetweenOfTypes(1, 2, spouseTypes).diagnostic, null, "reciprocal spouse-status variants must not conflict in the same direction");
assert.equal(graph.relationBetweenOfTypes(1, 2, spouseTypes).relation.type, "SPOUSE_OF");
assert.equal(graph.relationBetweenOfTypes(1, 2, spouseTypes).relation.label, "丈夫");
assert.equal(graph.relationBetweenOfTypes(2, 1, spouseTypes).relation.type, "DECEASED_SPOUSE_OF");
assert.equal(graph.relationBetweenOfTypes(2, 1, spouseTypes).relation.label, "亡妻");

const deceased = resolveAnchoredRelationMention({ query: "甲君的已故配偶是谁", responderId: 1, graph });
assert.equal(deceased.status, "RELATION_RESOLVED");
assert.equal(deceased.targetRuntimeId, "2");
const deceasedWife = resolveAnchoredRelationMention({ query: "甲君的已故妻子是谁", responderId: 1, graph });
assert.equal(deceasedWife.status, "RELATION_RESOLVED");
assert.equal(deceasedWife.targetRuntimeId, "2");
const survivingPartner = resolveAnchoredRelationMention({ query: "乙氏的配偶是谁", responderId: 2, graph });
assert.equal(survivingPartner.status, "RELATION_RESOLVED");
assert.equal(survivingPartner.targetRuntimeId, "1");

const ordinary = buildKinshipGraph({
  10: { id: 10, fullName: "丙君", alive: true, spouses: [11] },
  11: { id: 11, fullName: "丁氏", alive: true, spouses: [10] }
});
assert.equal(ordinary.relationBetweenOfTypes(10, 11, spouseTypes).relation.type, "SPOUSE_OF");
assert.equal(ordinary.relationBetweenOfTypes(11, 10, spouseTypes).relation.type, "SPOUSE_OF");

const bothDeceased = buildKinshipGraph({
  12: { id: 12, fullName: "故男", gender: "male", alive: false, spouses: [13] },
  13: { id: 13, fullName: "故女", gender: "female", alive: false, spouses: [12] }
});
assert.equal(bothDeceased.relationBetweenOfTypes(12, 13, spouseTypes).relation.type, "DECEASED_SPOUSE_OF");
assert.equal(bothDeceased.relationBetweenOfTypes(13, 12, spouseTypes).relation.type, "DECEASED_SPOUSE_OF");

const former = buildKinshipGraph({
  20: { id: 20, fullName: "戊君", formerSpouses: [21] },
  21: { id: 21, fullName: "己氏", formerSpouses: [20] }
});
assert.equal(former.relationBetweenOfTypes(20, 21, spouseTypes).relation.type, "FORMER_SPOUSE_OF");
assert.equal(former.relationBetweenOfTypes(21, 20, spouseTypes).relation.type, "FORMER_SPOUSE_OF");

const multipleStatuses = buildKinshipGraph({
  30: { id: 30, fullName: "庚君", alive: true, spouses: [31], formerSpouses: [32], deceasedSpouses: [{ id: 33, alive: false }] },
  31: { id: 31, fullName: "现任", alive: true },
  32: { id: 32, fullName: "前任", alive: true },
  33: { id: 33, fullName: "故配", alive: false }
});
assert.equal(multipleStatuses.relationBetweenOfTypes(30, 31, spouseTypes).relation.type, "SPOUSE_OF");
assert.equal(multipleStatuses.relationBetweenOfTypes(30, 32, spouseTypes).relation.type, "FORMER_SPOUSE_OF");
assert.equal(multipleStatuses.relationBetweenOfTypes(30, 33, spouseTypes).relation.type, "SPOUSE_OF");
assert.equal(multipleStatuses.relationBetweenOfTypes(33, 30, spouseTypes).relation.type, "DECEASED_SPOUSE_OF");

const deceasedCousins = buildKinshipGraph({
  40: { id: 40, fullName: "祖父", children: [41, 42] },
  41: { id: 41, fullName: "伯父", children: [43] },
  42: { id: 42, fullName: "叔父", children: [44] },
  43: { id: 43, fullName: "辛君", gender: "male", alive: true, spouse: 44 },
  44: { id: 44, fullName: "壬氏", gender: "female", alive: false, spouse: 43 }
});
assert.equal(deceasedCousins.relationBetween(44, 43).diagnostic.code, "RELATION_CONFLICT_TYPE");
assert.equal(deceasedCousins.relationBetweenOfTypes(44, 43, spouseTypes).diagnostic, null);
assert.equal(deceasedCousins.relationBetweenOfTypes(44, 43, spouseTypes).relation.type, "DECEASED_SPOUSE_OF");
const deceasedCousinResult = resolveAnchoredRelationMention({ query: "辛君的亡妻是谁", responderId: 43, graph: deceasedCousins });
assert.equal(deceasedCousinResult.status, "RELATION_RESOLVED");
assert.equal(deceasedCousinResult.targetRuntimeId, "44");

console.log("V8.8.2 Spouse Status Direction: PASS");
