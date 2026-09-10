"use strict";

const assert = require("assert");
const { normalizeSpouseRecords } = require("../resources/app/out/main/worldline/canonical-spouse-record");
const { buildKinshipGraph } = require("../resources/app/out/main/worldline/character-kinship-graph");
const { resolveAnchoredRelationMention } = require("../resources/app/out/main/worldline/anchored-relation-resolver");

const normalizedFormer = normalizeSpouseRecords({
  formerSpouses: [{ id: 5, fullName: "戊氏", gender: "female", alive: false, deathDate: "1170.1.1" }]
});
assert.equal(normalizedFormer[0].relationType, "FORMER_SPOUSE", "a deceased former spouse must remain a former spouse");
assert.equal(normalizedFormer[0].alive, false, "a deceased former spouse must retain deceased life status");

const normalizedDeceased = normalizeSpouseRecords({
  deceasedSpouses: [{ id: 4, fullName: "丁氏", gender: "female", alive: false, deathDate: "1170.1.1" }]
});
assert.equal(normalizedDeceased[0].relationType, "DECEASED_SPOUSE", "an explicit deceased spouse must remain deceased");

const characters = {
  1: { id: 1, fullName: "甲君", gender: "male", alive: true, spouses: [2], formerSpouses: [3, 5], deceasedSpouses: [4] },
  2: { id: 2, fullName: "乙氏", gender: "female", alive: true, spouses: [1] },
  3: { id: 3, fullName: "丙氏", gender: "female", alive: true, formerSpouses: [1] },
  4: { id: 4, fullName: "丁氏", gender: "female", alive: false, deathDate: "1170.1.1", spouses: [1] },
  5: { id: 5, fullName: "戊氏", gender: "female", alive: false, deathDate: "1170.1.1", formerSpouses: [1] }
};
const graph = buildKinshipGraph(characters);
const spouseTypes = ["SPOUSE_OF", "FORMER_SPOUSE_OF", "DECEASED_SPOUSE_OF"];

assert.equal(graph.relationBetweenOfTypes(5, 1, spouseTypes).relation.type, "FORMER_SPOUSE_OF", "dead former spouse graph edge must remain former");
assert.equal(graph.relationBetweenOfTypes(4, 1, spouseTypes).relation.type, "DECEASED_SPOUSE_OF", "deceased spouse graph edge must remain deceased");

const former = resolveAnchoredRelationMention({ query: "甲君的前妻是谁", responderId: 1, graph });
assert.equal(former.status, "RELATION_AMBIGUOUS", "multiple former wives must remain explicitly ambiguous");
assert.deepStrictEqual(former.candidates.map((candidate) => candidate.runtimeId).sort(), ["3", "5"], "former wife candidates must include alive and deceased former spouses only");

const deceased = resolveAnchoredRelationMention({ query: "甲君的亡妻是谁", responderId: 1, graph });
assert.equal(deceased.status, "RELATION_RESOLVED");
assert.equal(deceased.targetRuntimeId, "4", "deceased spouse lookup must exclude a deceased former spouse");

const deadFormerOnlyGraph = buildKinshipGraph({
  10: { id: 10, fullName: "己君", gender: "male", formerSpouses: [11] },
  11: { id: 11, fullName: "庚氏", gender: "female", alive: false, deathDate: "1170.1.1", formerSpouses: [10] }
});
const deadFormerOnly = resolveAnchoredRelationMention({ query: "己君的前妻是谁", responderId: 10, graph: deadFormerOnlyGraph });
assert.equal(deadFormerOnly.status, "RELATION_RESOLVED");
assert.equal(deadFormerOnly.targetRuntimeId, "11", "a unique deceased former spouse must resolve as former wife");

console.log("V8.8.2 Dead Former Spouse: PASS");
