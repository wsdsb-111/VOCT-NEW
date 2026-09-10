"use strict";

const assert = require("assert");
const { buildKinshipGraph } = require("../resources/app/out/main/worldline/character-kinship-graph");
const { parseRelationIntent } = require("../resources/app/out/main/worldline/relation-intent-parser");
const { resolveAnchoredRelationMention } = require("../resources/app/out/main/worldline/anchored-relation-resolver");
const { buildFamilyFactBlock } = require("../resources/app/out/main/worldline/character-family-facts");

const characters = {
  1: { id: 1, fullName: "甲君", gender: "male", alive: true, spouses: [2], formerSpouses: [3], deceasedSpouses: [4] },
  2: { id: 2, fullName: "乙氏", gender: "female", alive: true, spouses: [1] },
  3: { id: 3, fullName: "丙氏", gender: "female", alive: true, formerSpouses: [1] },
  4: { id: 4, fullName: "丁氏", gender: "female", alive: false, deathDate: "1170.1.1", spouses: [1] }
};
const graph = buildKinshipGraph(characters);

const cases = [
  ["甲君的妻子是谁", "CURRENT", "SPOUSE_OF", "2"],
  ["甲君的配偶是谁", "CURRENT", "SPOUSE_OF", "2"],
  ["甲君的前妻是谁", "FORMER", "FORMER_SPOUSE_OF", "3"],
  ["甲君的前配偶是谁", "FORMER", "FORMER_SPOUSE_OF", "3"],
  ["甲君的亡妻是谁", "DECEASED", "DECEASED_SPOUSE_OF", "4"],
  ["甲君的已故妻子是谁", "DECEASED", "DECEASED_SPOUSE_OF", "4"],
  ["甲君的已故配偶是谁", "DECEASED", "DECEASED_SPOUSE_OF", "4"]
];

for (const [query, spouseStatus, relationType, targetRuntimeId] of cases) {
  const intent = parseRelationIntent(query);
  assert.equal(intent.spouseStatus, spouseStatus, query);
  assert.deepStrictEqual(intent.relationTypes, [relationType], query);
  const result = resolveAnchoredRelationMention({ query, responderId: 1, graph });
  assert.equal(result.status, "RELATION_RESOLVED", query);
  assert.equal(result.targetRuntimeId, targetRuntimeId, query);
  assert.equal(result.relation.type, relationType, query);
}

const responderCases = [
  ["你的妻子是谁", "CURRENT", "2"],
  ["你的前妻是谁", "FORMER", "3"],
  ["你的亡妻是谁", "DECEASED", "4"],
  ["你的已故配偶是谁", "DECEASED", "4"]
];
for (const [query, spouseStatus, targetRuntimeId] of responderCases) {
  const intent = parseRelationIntent(query);
  assert.equal(intent.anchorMode, "RESPONDER", query);
  assert.equal(intent.spouseStatus, spouseStatus, query);
  const result = resolveAnchoredRelationMention({ query, responderId: 1, graph });
  assert.equal(result.status, "RELATION_RESOLVED", query);
  assert.equal(result.targetRuntimeId, targetRuntimeId, query);
}

const gameData = { date: "1175.1.1", characters };
const currentFact = buildFamilyFactBlock(characters[1], gameData, { query: "甲君的妻子是谁" });
const formerFact = buildFamilyFactBlock(characters[1], gameData, { query: "甲君的前妻是谁" });
const deceasedFact = buildFamilyFactBlock(characters[1], gameData, { query: "甲君的亡妻是谁" });
assert.match(currentFact, /查询关系：妻子；目标人物：乙氏/);
assert.match(currentFact, /在世/);
assert.match(formerFact, /查询关系：前妻；目标人物：丙氏/);
assert.match(deceasedFact, /查询关系：亡妻；目标人物：丁氏/);
assert.match(deceasedFact, /1170年1月1日去世/);

console.log("V8.8.2 Spouse Intent Status: PASS");
